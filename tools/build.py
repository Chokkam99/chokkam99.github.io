#!/usr/bin/env python3
"""Build the site from the private content folder.

    python3 tools/build.py --preview   everything, drafts included, into ../preview/
    python3 tools/build.py --publish   approved pages only, all checks, into docs/

Standard library only. The content and the deny-list live outside this repository
on purpose, so drafts and internal terms never enter its history.
"""

import argparse
import hashlib
import html
import json
import math
import random
import re
import shutil
import sys
import tempfile
import tomllib
from pathlib import Path

CODE = Path(__file__).resolve().parent.parent
WORKSPACE = CODE.parent
TEMPLATES = CODE / "templates"
STATIC = CODE / "static"

TIERS = {"built", "co-developed", "drove", "team", "opinion", "context"}
NO_EVIDENCE_TIERS = {"opinion", "context"}
VARIANTS = ("exact", "rounded", "qualitative")
ROLE_LABELS = {"built": "Built", "co-developed": "Co-developed with my team", "drove": "Drove"}
STATUSES = {"placeholder", "draft", "approved"}
CLAIM_KEYS = {"tier", "ev", "topics", "variant", "confirm", "public"}
SECTION_KEYS = {"id", "depth"}

# Never a topic id or alias (briefs/topic-index.md).
FORBIDDEN_TOPICS = {
    "rds", "go", "javascript", "java", "kotlin", "rust", "react", "gcp", "azure", "bazel",
    "argo cd", "flux", "envoy", "kafka", "activemq", "zookeeper", "puppet", "opentelemetry", "sql",
}

DEFAULT_SITE = {
    "title": "Rithvik Chokkam",
    "description": "Cloud Platform engineer",
    "url": "https://chokkam99.github.io",
    "metrics_mode": "qualitative",
    "indexing": True,
    "lead_planet": "runtime-images",
    "resume_pdf": "",
    "email_allowlist": [],
    "links": {},
}

LINK_NAMES = {"linkedin": "LinkedIn", "github": "GitHub"}

# The planet page: the view out of the landed rocket's window, then the write-up carved
# into weathered stones on the surface (briefs/design-and-interaction.md, "Arrival").
# Far stones on the horizon, seen from the window and again on stepping out. Each is a
# small fixed-size drawing whose feet go behind the ground, so none floats on the curve.
FAR_STONES = (
    '<svg class="far far-1" viewBox="0 0 40 30" aria-hidden="true"><path class="far-stone" d="M2 30V13l2-1h11v18zM20 30V19h7l1 1v10zM31 30V9h7l1 2v19z"/></svg>'
    '<svg class="far far-2" viewBox="0 0 26 30" aria-hidden="true"><path class="far-stone" d="M2 30V15h9l1 1v14zM15 30V21h8v9z"/></svg>'
    '<svg class="far far-3" viewBox="0 0 20 30" aria-hidden="true"><path class="far-stone" d="M4 30V11h11l1 2v17z"/></svg>'
)
STONE_MOSS = "".join(f'<span class="stone-moss m{i}" aria-hidden="true"></span>' for i in range(1, 8))


def worn_outline(n):
    """Stone n's worn outline, as the custom properties world.css clips with: the top edge
    chipped and its corners worn away, the left side and the edge where the face meets the
    side a little uneven, and the back edges of the top and side worn on their own. Heights
    along the top are px and positions down the sides are % of the face, so any stone height
    works. The top and side planes share the face's edge points. The same n always gives
    the same stone."""
    rnd = random.Random(n * 7919)
    top = [[x, rnd.uniform(0, 3)] for x in (0, 4, 9, 15, 22, 29, 36, 43, 50, 57, 64, 71, 78, 85, 91, 96, 100)]
    for i in rnd.sample(range(3, len(top) - 4), 2):  # two bites out of the edge
        top[i][1] += rnd.uniform(5, 9)
        top[i + 1][1] += rnd.uniform(2, 4)
    top[0][1] += rnd.uniform(8, 13)  # the corners worn away
    top[1][1] += rnd.uniform(2, 5)
    top[-1][1] += rnd.uniform(6, 10)
    left = [[rnd.uniform(0, 3.5), y] for y in (4, 10, 17, 25, 33, 42, 50, 59, 67, 76, 84, 92, 100)]
    left[rnd.randrange(3, len(left) - 3)][0] += rnd.uniform(4, 7)
    right = [[rnd.uniform(0, 2.5), y] for y in (5, 15, 27, 40, 53, 66, 79, 91)]
    back = [round(y + rnd.uniform(-1, 2.5), 1) for _, y in top]
    sback = [round(r + rnd.uniform(0, 2.5), 1) for r, _ in right]

    def q(y):
        return f"{y / 100:.2f}"

    front = ([f"{x}% {y:.1f}px" for x, y in top]
             + [f"calc(100% - {r:.1f}px) {y}%" for r, y in right]
             + ["100% 100%", "0 100%"]
             + [f"{lx:.1f}px {y}%" for lx, y in reversed(left)])
    tplane = ([f"calc(var(--fw) * {q(x)}) calc(var(--R) + {y:.1f}px)" for x, y in top]
              + [f"calc(var(--fw) * {q(x)} + var(--W)) {max(b, 0):.1f}px"
                 for (x, _), b in reversed(list(zip(top, back)))])
    splane = ([f"calc(var(--fw)) calc(var(--R) + {top[-1][1]:.1f}px)"]
              + [f"calc(var(--fw) - {r:.1f}px) calc(var(--R) + (100% - var(--R)) * {q(y)})" for r, y in right]
              + ["calc(var(--fw)) 100%", "100% calc(100% - var(--R))"]
              + [f"calc(var(--fw) - {r:.1f}px + var(--W)) calc((100% - var(--R)) * {q(y)})"
                 for r, (_, y) in reversed(list(zip(sback, right)))]
              + [f"100% {max(back[-1], 0):.1f}px"])
    return (f"--front: polygon({', '.join(front)}); --top: polygon({', '.join(tplane)}); "
            f"--side: polygon({', '.join(splane)})")
NB_HYPHEN = "\u2011"  # keeps "Health-gated" on one line in map labels

# Where planets sit on the map, in order (lead planet first): their orbit's size (its
# semi-major axis, as a share of the map), angle in degrees clockwise from three o'clock,
# and which side the label goes. The gaps between orbits widen outward, and the map is
# wider than tall everywhere, so orbits are ovals. The phone slots keep every label and tap
# target clear of the others, the sun and the parked rocket (above the sun, space.js) at
# 360 to 430 px wide; keep the sun out of the rocket's line of flight to each planet; and
# keep the rocket's stop for each card clear of the other planets. Planets beyond the slots
# go on the outer orbit.
MAP_SLOTS = {
    "phone": [(0.33, 0, "right"), (0.45, -120, "left"), (0.58, -175, "right"),
              (0.73, 50, "left"), (0.9, -70, "left"), (0.9, 150, "right")],
    "wide": [(0.4, -63, "right"), (0.52, 125, "left"), (0.65, 40, "right"),
             (0.78, -130, "left"), (0.9, -45, "left"), (0.9, 137, "right")],
}
# Each slot's orbit is an ellipse with the sun at a focus, as real orbits are: its
# eccentricity, and the direction (degrees, as above) of its point nearest the sun. They
# turn gradually from one orbit to the next, so neighbours never crowd, and every orbit
# stays inside the map. The slots above hold their clearances on these shapes.
ORBIT_SHAPES = [(0.15, 75), (0.09, 30), (0.13, 330), (0.08, 270), (0.06, 200), (0.06, 200)]


def orbit_radius(a, e, perihelion, angle):
    """How far from the sun an orbit is at an angle, as a share of the map."""
    return a * (1 - e * e) / (1 + e * math.cos(math.radians(angle - perihelion)))


class Build:
    def __init__(self, mode, content, private):
        self.mode = mode
        self.preview = mode == "preview"
        self.content = content
        self.private = private
        self.problems = []

    def problem(self, where, message):
        self.problems.append(f"{where}: {message}")


def esc(text):
    return html.escape(str(text), quote=True)


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def rel(path):
    """A path for messages, relative to the workspace, never absolute."""
    try:
        return str(Path(path).resolve().relative_to(WORKSPACE))
    except ValueError:
        return Path(path).name


# ---------------------------------------------------------------- content

def load_site(b):
    site = dict(DEFAULT_SITE)
    path = b.content / "site.toml"
    if path.exists():
        site.update(tomllib.loads(path.read_text("utf-8")))
    else:
        b.problem("content/site.toml", "missing; using defaults")
    if site["metrics_mode"] not in VARIANTS:
        b.problem("content/site.toml", f"metrics_mode must be one of {', '.join(VARIANTS)}")
        site["metrics_mode"] = "qualitative"
    site["url"] = site["url"].rstrip("/")
    return site


def load_topics(b):
    path = b.content / "topics.toml"
    if not path.exists():
        b.problem("content/topics.toml", "missing; building with no topics")
        return {}, [], []
    data = tomllib.loads(path.read_text("utf-8"))
    topics = {}
    for t in data.get("topic", []):
        tid = t.get("id", "")
        where = f"content/topics.toml [{tid or '?'}]"
        for key in ("id", "label", "group", "kind", "scope"):
            if not t.get(key):
                b.problem(where, f"missing {key}")
        if tid in topics:
            b.problem(where, "duplicate id")
        t.setdefault("aliases", [])
        t.setdefault("related", [])
        for word in [tid, t.get("label", "")] + t["aliases"]:
            if word.lower() in FORBIDDEN_TOPICS:
                b.problem(where, f"forbidden topic or alias: {word}")
        topics[tid] = t
    for t in topics.values():
        for r in t["related"]:
            if r not in topics:
                b.problem(f"content/topics.toml [{t['id']}]", f"related topic {r} does not exist")
    groups = list(data.get("groups", []))
    for t in topics.values():
        if t["group"] not in groups:
            groups.append(t["group"])
    chips = list(data.get("chips", []))
    for tid in chips:
        if tid not in topics:
            b.problem("content/topics.toml", f"chip {tid} is not a topic")
    return topics, groups, [tid for tid in chips if tid in topics]


COMMENT_LINE = re.compile(r"<!--\s*(\w+):(.*?)-->")


def parse_attrs(text, known):
    """key=value pairs split on semicolons; a semicolon inside a value is kept."""
    attrs, key = {}, None
    for part in text.split(";"):
        k, sep, v = part.partition("=")
        if sep and k.strip() in known:
            key = k.strip()
            attrs[key] = v.strip()
        elif key:
            attrs[key] += ";" + part.rstrip()
    return attrs


def parse_page(b, path):
    where = rel(path)
    text = path.read_text("utf-8")
    m = re.match(r"\+\+\+\n(.*?)\n\+\+\+\n", text, re.S)
    if not m:
        b.problem(where, "no +++ front matter")
        return None
    try:
        meta = tomllib.loads(m.group(1))
    except tomllib.TOMLDecodeError as e:
        b.problem(where, f"front matter: {e}")
        return None
    page = {"meta": meta, "sections": [], "where": where}
    section, claim, pending = None, None, None

    def close_claim():
        nonlocal claim
        if claim is not None:
            while claim["lines"] and not claim["lines"][-1].strip():
                claim["lines"].pop()
            if not claim["lines"]:
                b.problem(where, f"line {claim['line']}: claim with no text")
            else:
                section["items"].append(claim)
        claim = None

    first = text[: m.end()].count("\n") + 1
    for n, line in enumerate(text[m.end():].split("\n"), start=first):
        stripped = line.strip()
        comment = COMMENT_LINE.fullmatch(stripped)
        if comment:
            close_claim()
            kind, body = comment.groups()
            if kind == "section":
                pending = parse_attrs(body, SECTION_KEYS)
            elif kind == "claim":
                if section is None:
                    b.problem(where, f"line {n}: claim before the first section")
                    continue
                claim = parse_attrs(body, CLAIM_KEYS)
                claim.update(line=n, lines=[])
            else:
                b.problem(where, f"line {n}: unknown comment '{kind}'")
        elif stripped.startswith("<!--"):
            b.problem(where, f"line {n}: unreadable comment line")
        elif line.startswith("## "):
            close_claim()
            if not pending or "id" not in pending:
                b.problem(where, f"line {n}: heading without a section line above it")
                pending = {"id": slugify(line[3:]), "depth": "2"}
            depth = pending.get("depth", "2")
            if depth not in ("1", "2", "3"):
                b.problem(where, f"line {n}: depth must be 1, 2 or 3")
                depth = "2"
            section = {"id": pending["id"], "depth": int(depth), "title": line[3:].strip(), "items": []}
            page["sections"].append(section)
            pending = None
        elif line.startswith("### "):
            close_claim()
            if section is None:
                b.problem(where, f"line {n}: subheading before the first section")
                continue
            section["items"].append({"h3": line[4:].strip()})
        elif line.startswith("#"):
            b.problem(where, f"line {n}: only ## and ### headings are allowed")
        elif claim is not None:
            claim["lines"].append(line)
        elif stripped:
            b.problem(where, f"line {n}: text without a claim line")
    close_claim()
    return page


def check_claim(b, page, claim, topics):
    where = f"{page['where']} line {claim['line']}"
    tier = claim.get("tier")
    if tier not in TIERS:
        b.problem(where, f"tier must be one of {', '.join(sorted(TIERS))}")
    if tier not in NO_EVIDENCE_TIERS and not claim.get("ev"):
        b.problem(where, "ev is required for this tier")
    if "variant" in claim and claim["variant"] not in VARIANTS:
        b.problem(where, f"variant must be one of {', '.join(VARIANTS)}")
    claim["topic_ids"] = [t.strip() for t in claim.get("topics", "").split(",") if t.strip()]
    for t in claim["topic_ids"]:
        if t.lower() in FORBIDDEN_TOPICS:
            b.problem(where, f"forbidden topic {t}")
        elif t not in topics:
            b.problem(where, f"unknown topic {t}")
    claim["public"] = claim.get("public", "true").lower() != "false"
    claim["blocks"] = blocks(b, page, claim)
    if claim.get("confirm") and not b.preview:
        b.problem(where, "unanswered confirm=")


def load_pages(b, topics):
    planets, about = [], None
    files = sorted((b.content / "planets").glob("*.md"))
    if (b.content / "about.md").exists():
        files.append(b.content / "about.md")
    for path in files:
        page = parse_page(b, path)
        if page is None:
            continue
        meta, where = page["meta"], page["where"]
        status = meta.get("status")
        if status not in STATUSES:
            b.problem(where, f"status must be one of {', '.join(sorted(STATUSES))}")
            continue
        if not b.preview and status != "approved":
            continue
        is_about = path.name == "about.md"
        required = ("slug", "title", "tagline") if is_about else (
            "slug", "title", "tagline", "role", "order", "topics")
        for key in required:
            if key not in meta:
                b.problem(where, f"front matter is missing {key}")
        if not is_about:
            if meta.get("slug") != path.stem:
                b.problem(where, "slug must match the file name")
            if meta.get("role") not in ROLE_LABELS:
                b.problem(where, f"role must be one of {', '.join(ROLE_LABELS)}")
            for t in meta.get("topics", []):
                if t not in topics:
                    b.problem(where, f"unknown planet topic {t}")
            if meta.get("diagram") and not (b.content / "diagrams" / meta["diagram"]).exists():
                b.problem(where, f"diagram {meta['diagram']} not found")
            if sum(1 for s in page["sections"] if s["depth"] == 1) != 1:
                b.problem(where, "needs exactly one depth=1 summary section")
        for section in page["sections"]:
            for item in section["items"]:
                if "lines" in item:
                    check_claim(b, page, item, topics)
        page.update(meta)
        page.setdefault("status", status)
        if is_about:
            about = page
        else:
            planets.append(page)
    planets.sort(key=lambda p: (p.get("order", 99), p.get("slug", "")))
    if not b.preview and not planets:
        b.problem("content/planets", "no approved planets")
    if about is None:
        b.problem("content/about.md", "missing" if b.preview else "missing or not approved")
    return planets, about


# --------------------------------------------------------------- markdown

def inline(text):
    out = []
    for part in re.split(r"(`[^`]+`)", text):
        if len(part) > 1 and part.startswith("`") and part.endswith("`"):
            out.append(f"<code>{esc(part[1:-1])}</code>")
            continue
        part = esc(part)
        part = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', part)
        part = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", part)
        part = re.sub(r"(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])", r"<em>\1</em>", part)
        part = re.sub(r"(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)", r"<em>\1</em>", part)
        out.append(part)
    return "".join(out)


def blocks(b, page, claim):
    """The small Markdown subset: paragraphs, lists and diagram images."""
    where = f"{page['where']} line {claim['line']}"
    result, para, items, list_kind = [], [], [], None

    def close():
        nonlocal para, items, list_kind
        if para:
            result.append(("p", " ".join(para)))
        if items:
            result.append((list_kind, items))
        para, items, list_kind = [], [], None

    for line in claim["lines"]:
        s = line.strip()
        if not s:
            close()
            continue
        image = re.fullmatch(r"!\[([^\]]*)\]\(([^)\s]+)\)", s)
        bullet = re.match(r"[-*] (.*)", line)
        number = re.match(r"\d+\. (.*)", line)
        if image:
            close()
            src = image.group(2)
            if not src.startswith("diagrams/") or not (b.content / src).exists():
                b.problem(where, f"image must point at an existing file in diagrams/: {src}")
            result.append(("img", (image.group(1), src)))
        elif bullet or number:
            kind = "ul" if bullet else "ol"
            if para or (list_kind and list_kind != kind):
                close()
            list_kind = kind
            items.append((bullet or number).group(1))
        elif s[0] in ">|<" or s.startswith("```"):
            b.problem(where, f"unsupported Markdown: {s[:30]}")
        elif items:
            items[-1] += " " + s
        else:
            para.append(s)
    close()
    return result


def svg_size(path):
    m = re.search(r'viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)', path.read_text("utf-8"))
    return (round(float(m.group(1))), round(float(m.group(2)))) if m else (480, 640)


class Linker:
    """Links the first mention of each topic in a claim block to its page."""

    def __init__(self, topics, live):
        self.map = {a: tid for tid in live for a in topics[tid]["aliases"]}
        words = sorted(self.map, key=len, reverse=True)
        self.pattern = re.compile(
            r"(?<![\w-])(" + "|".join(re.escape(esc(w)) for w in words) + r")(?![\w-])"
        ) if words else None
        self.escaped = {esc(a): tid for a, tid in self.map.items()}

    def __call__(self, fragment, done):
        if not self.pattern:
            return fragment
        out, inside = [], 0
        for token in re.split(r"(<[^>]+>)", fragment):
            if token.startswith("<"):
                tag = re.match(r"</?(a|code)\b", token)
                if tag:
                    inside += -1 if token.startswith("</") else 1
                out.append(token)
            elif inside:
                out.append(token)
            else:
                out.append(self.pattern.sub(lambda m: self.link(m.group(1), done), token))
        return "".join(out)

    def link(self, word, done):
        tid = self.escaped[word]
        if tid in done:
            return word
        done.add(tid)
        return f'<a class="topic-link" href="/skills/{tid}/">{word}</a>'


def render_claim(b, page, claim, linker, diagrams):
    done = set()
    parts = []
    for kind, data in claim["blocks"]:
        if kind == "p":
            parts.append(f"<p>{linker(inline(data), done)}</p>")
        elif kind in ("ul", "ol"):
            lis = "".join(f"<li>{linker(inline(i), done)}</li>" for i in data)
            parts.append(f"<{kind}>{lis}</{kind}>")
        else:
            caption, src = data
            name = src.split("/", 1)[1]
            diagrams.add(name)
            alt = page.get("diagram_alt") if name == page.get("diagram") else caption
            w, h = svg_size(b.content / src)
            parts.append(
                f'<figure class="diagram"><img src="/diagrams/{esc(name)}" alt="{esc(alt or caption)}" '
                f'width="{w}" height="{h}" loading="lazy" decoding="async">'
                f"<figcaption>{inline(caption)}</figcaption></figure>"
            )
    return "".join(parts)


def plain(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


# ---------------------------------------------------------------- render

def template(tpl, **values):
    text = (TEMPLATES / f"{tpl}.html").read_text("utf-8")

    def fill(m):
        if m.group(1) not in values:
            raise KeyError(f"templates/{tpl}.html needs a value for {{{{{m.group(1)}}}}}")
        return str(values[m.group(1)])

    return re.sub(r"\{\{(\w+)\}\}", fill, text)


def file_hash(*paths):
    h = hashlib.sha256()
    for path in paths:
        h.update(path.read_bytes())
    return h.hexdigest()[:10]


def trip_script(name):
    """The map's and the planet page's scripts share one version, passed on to the modules
    they load (space.css too), so a visitor never mixes old and new trip code."""
    v = file_hash(*(STATIC / f for f in ("js/space.js", "js/world.js", "js/landing.js", "js/rocket.js", "js/swap.js", "css/space.css")))
    return f"/static/js/{name}?v={v}"


class Site:
    def __init__(self, b, out):
        self.b = b
        self.out = out
        self.site = load_site(b)
        self.topics, self.groups, self.topic_chips = load_topics(b)
        self.planets, self.about = load_pages(b, self.topics)
        self.diagrams = set()
        self.excerpts = {}  # topic id -> [(planet, claim number, html)]
        self.urls = []

    # ---- helpers

    def group_class(self, page):
        first = next((t for t in page.get("topics", []) if t in self.topics), None)
        return "g-" + slugify(self.topics[first]["group"]) if first else "g-none"

    def role_text(self, page):
        return page.get("role_label") or ROLE_LABELS.get(page.get("role"), "")

    def status_banner(self, page):
        if not self.b.preview or page.get("status") == "approved":
            return ""
        label = {"draft": "Draft", "placeholder": "Placeholder"}[page["status"]]
        confirms = any(item.get("confirm") for s in page["sections"] for item in s["items"]
                       if isinstance(item, dict))
        note = {"draft": "Not reviewed yet." + (" Items to confirm are highlighted." if confirms else ""),
                "placeholder": "Stand-in text. The real write-up replaces it."}[page["status"]]
        return f'<div class="status-banner is-{page["status"]}"><strong>{label}</strong> {note}</div>'

    def chips(self, ids, label, heading=False):
        live = [t for t in ids if t in self.live_topics]
        if not live:
            return ""
        links = "".join(
            f'<li><a class="chip" href="/skills/{t}/">{esc(self.topics[t]["label"])}</a></li>' for t in live)
        nav = f'<nav class="chips" aria-label="{esc(label)}"><ul>{links}</ul></nav>'
        return f'<div class="chip-block"><h2 class="section-label">{esc(label)}</h2>{nav}</div>' if heading else nav

    def page(self, path, title, description, content, body_class, banner="", head=""):
        site = self.site
        canonical = site["url"] + path
        robots = "" if site["indexing"] else '<meta name="robots" content="noindex">\n'
        full_title = title if title == site["title"] else f"{title} | {site['title']}"
        links = "".join(
            f'<li><a href="{esc(url)}">{LINK_NAMES.get(name, name.title())}</a></li>'
            for name, url in site["links"].items())
        if site.get("resume_pdf"):
            links += f'<li><a href="/{esc(site["resume_pdf"])}">Resume</a></li>'
        doc = template(
            "base",
            title=esc(full_title),
            description=esc(description),
            canonical=esc(canonical),
            # Versioned like the other files, so apps that keep a link's preview fetch a new picture.
            og_image=esc(site["url"] + f"/static/img/og.jpg?v={file_hash(STATIC / 'img/og.jpg')}"),
            robots=robots,
            site_title=esc(site["title"]),
            css=f"/static/css/site.css?v={file_hash(STATIC / 'css/site.css')}",
            js=f"/static/js/site.js?v={file_hash(STATIC / 'js/site.js')}",
            body_class=body_class,
            head=head,
            banner=banner,
            content=content,
            footer_links=links,
        )
        target = self.out / path.lstrip("/")
        if path.endswith("/"):
            target = target / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(doc, "utf-8")
        if path != "/404.html":
            self.urls.append(path)

    # ---- claims

    def resolve(self, page):
        """Pick the variant to show from each run of adjacent metric claims."""
        mode = self.site["metrics_mode"]
        n = 0
        for section in page["sections"]:
            items, run = [], []
            for item in section["items"] + [None]:
                if item is not None and "lines" in item:
                    n += 1
                    item["n"] = n
                if item is not None and "variant" in item:
                    run.append(item)
                    continue
                if run:
                    by = {c["variant"]: c for c in run}
                    pick = by.get(mode) or by.get("qualitative")
                    if pick is None:
                        self.b.problem(f"{page['where']} line {run[0]['line']}",
                                       "metric claims need a qualitative variant")
                    items.append({"variants": run, "pick": pick})
                    run = []
                if item is not None:
                    items.append(item)
            section["items"] = items

    def shown_claims(self, page):
        for section in page["sections"]:
            for item in section["items"]:
                if "lines" in item and item["public"]:
                    yield item
                elif "variants" in item and item["pick"] is not None and item["pick"]["public"]:
                    yield item["pick"]

    def claim_html(self, page, claim):
        if "html" not in claim:
            claim["html"] = render_claim(self.b, page, claim, self.linker, self.diagrams)
        return claim["html"]

    def claim_block(self, page, claim, label=""):
        body = self.claim_html(page, claim)
        extra = ""
        if self.b.preview and claim.get("confirm"):
            extra += f'<p class="confirm"><strong>Confirm:</strong> {esc(claim["confirm"])}</p>'
        if self.b.preview and not claim["public"]:
            extra += '<p class="confirm"><strong>Source only:</strong> never published.</p>'
        label = f'<p class="variant-label">{label}</p>' if label else ""
        return f'<div class="claim" id="c-{claim["n"]}">{label}{body}{extra}</div>'

    def section_html(self, page, section):
        out = []
        for item in section["items"]:
            if "h3" in item:
                out.append(f"<h3>{inline(item['h3'])}</h3>")
            elif "variants" in item:
                if self.b.preview:
                    cells = []
                    for c in item["variants"]:
                        chosen = c is item["pick"]
                        label = c["variant"].title() + (" (shown)" if chosen else "")
                        cells.append(self.claim_block(page, c, label).replace(
                            'class="claim"', f'class="claim{" is-shown" if chosen else ""}"', 1))
                    out.append(f'<div class="variants">{"".join(cells)}</div>')
                elif item["pick"] is not None and item["pick"]["public"]:
                    out.append(self.claim_block(page, item["pick"]))
            elif item["public"] or self.b.preview:
                out.append(self.claim_block(page, item))
        return "".join(out)

    # ---- pages

    def build(self):
        for p in self.planets + ([self.about] if self.about else []):
            self.resolve(p)
        self.live_topics = []
        for tid in self.topics:
            if any(tid in c["topic_ids"] for p in self.planets for c in self.shown_claims(p)):
                self.live_topics.append(tid)
        self.linker = Linker(self.topics, self.live_topics)

        for p in self.planets:
            self.planet_page(p)
        self.home()
        self.about_page()
        self.topic_pages()
        self.not_found()
        self.data_files()
        self.assets()

    def map_order(self):
        """Planets in map order: the lead planet first, then by their order key."""
        lead = self.site.get("lead_planet")
        return sorted(self.planets, key=lambda p: (p["slug"] != lead, p.get("order", 99)))

    def nearby(self, p):
        """The two planets that share the most topics with p; ties go to map order."""
        order = self.map_order()
        mine = set(p.get("topics", []))
        others = [o for o in order if o is not p]
        others.sort(key=lambda o: (-len(mine & set(o.get("topics", []))), order.index(o)))
        return others[:2]

    def planet_page(self, p):
        summary, stones = [], []
        for s in p["sections"]:
            inner = self.section_html(p, s)
            n = len(stones) + 1
            if s["depth"] == 1:
                summary.append(f'<div class="window-summary" id="{esc(s["id"])}">{inner}</div>')
                continue
            title = f'<h2 class="stone-title">{inline(s["title"])}</h2>'
            if s["depth"] == 2:
                face = f'<div class="stone-face">{title}{inner}</div>'
            else:
                face = (f'<details class="stone-face deeper"><summary>{title}</summary>'
                        f'<div class="deeper-body">{inner}</div></details>')
            stones.append(
                f'<article class="stone stone--{2 - n % 2}" id="{esc(s["id"])}" style="{worn_outline(n)}">'
                f'{STONE_MOSS}{face}<span class="stone-side" aria-hidden="true"></span>'
                '<span class="stone-foot" aria-hidden="true"></span></article>')
        for c in self.shown_claims(p):
            for t in c["topic_ids"]:
                self.excerpts.setdefault(t, []).append((p, c))
        nearby = "".join(
            f'<li class="nearby-{k} {self.group_class(o)}"><a href="/work/{o["slug"]}/">'
            f'<span class="globe"></span><span class="nearby-name">{esc(o["title"])}</span></a></li>'
            for k, o in enumerate(self.nearby(p), 1))
        content = template(
            "planet",
            group=self.group_class(p),
            title=esc(p["title"]),
            badge=self.placeholder_badge(p),
            role=esc(self.role_text(p)),
            summary="".join(summary),
            bolts="<i></i>" * 12,
            far=FAR_STONES,
            nearby=f'<ul class="nearby" aria-label="Nearby planets">{nearby}</ul>' if nearby else "",
            rocket=(TEMPLATES / "rocket.svg").read_text("utf-8"),
            stones="".join(stones),
            chips=self.chips(p.get("topics", []), "Skills in this system", heading=True),
            script=trip_script("world.js"),
        )
        css = f'<link rel="stylesheet" href="/static/css/world.css?v={file_hash(STATIC / "css/world.css")}">'
        self.page(f"/work/{p['slug']}/", p["title"], p["tagline"], content, "page-planet page-world",
                  self.status_banner(p), head=css)

    def skills_section(self):
        """The skill chips under the map (content/topics.toml `chips`, with `short` names), and
        the data the skill view lights the map with: each skill's scope and its card lines,
        one per planet, linking to the section the line comes from."""
        skills, chips = [], []
        planets = {p["slug"]: p for p in self.planets}
        for tid in self.topic_chips:
            t = self.topics[tid]
            where = f"content/topics.toml [{tid}]"
            if tid not in self.live_topics:
                self.b.problem(where, "is a chip but has no excerpts, so it has no page")
                continue
            used = {p["slug"] for p, _ in self.excerpts.get(tid, [])}
            lines = []
            for line in t.get("card", []):
                p = planets.get(line.get("planet"))
                if not p:
                    self.b.problem(where, f"card line names an unknown planet: {line.get('planet')}")
                    continue
                if line.get("section") not in {sec["id"] for sec in p["sections"]}:
                    self.b.problem(where, f"card line names a section {p['slug']} doesn't have: {line.get('section')}")
                if p["slug"] not in used:
                    self.b.problem(where, f"card line for {p['slug']}, which has no claim tagged {tid}")
                lines.append({"planet": p["slug"], "title": p["title"], "group": self.group_class(p)[2:],
                              "url": f"/work/{p['slug']}/#{line.get('section', '')}", "text": line.get("text", "")})
            if not lines:
                self.b.problem(where, "is a chip with no card lines")
                continue
            name = t.get("short") or t["label"]
            group = slugify(t["group"])
            skills.append({"id": tid, "name": name, "group": group, "scope": t["scope"],
                           "url": f"/skills/{tid}/", "lines": lines})
            chips.append(f'<li><a class="skill-chip g-{group}" href="/skills/{tid}/" data-skill="{tid}">'
                         f'<span class="dot" aria-hidden="true"></span>{esc(name)}</a></li>')
        if not chips:
            return ""
        data = json.dumps(skills, ensure_ascii=False).replace("</", "<\\/")
        return template("skills", chips="".join(chips), data=data)

    def placeholder_badge(self, p):
        if self.b.preview and p.get("status") == "placeholder":
            return '<span class="badge-placeholder">Placeholder</span>'
        return ""

    def galaxy(self):
        """A static map: the home star in the middle, planets on orbits around it."""
        rings, dots = {"phone": [], "wide": []}, []
        for i, p in enumerate(self.map_order()):
            style, sides = [], []
            for size, prefix in (("phone", "m"), ("wide", "")):
                slots = MAP_SLOTS[size]
                k = min(i, len(slots) - 1)
                a, angle, side = slots[k]
                if i >= len(slots):
                    angle, side = i * 137.5, None
                e, perihelion = ORBIT_SHAPES[k]
                r = orbit_radius(a, e, perihelion, angle)
                t = math.radians(angle)
                x, y = 50 + 50 * r * math.cos(t), 50 + 50 * r * math.sin(t)
                side = side or ("left" if x > 50 else "right")
                style.append(f"--{prefix}x:{x:.1f}%;--{prefix}y:{y:.1f}%")
                sides.append(f"{prefix or 'w'}-{side}")
                # The orbit in the map's own units (the sun at 0 0, the map's edges at 1), its
                # centre off the sun toward the far side; the map stretches it to its shape.
                ring = (f'<ellipse cx="{-a * e:.4f}" rx="{a:.4f}" ry="{a * math.sqrt(1 - e * e):.4f}" '
                        f'transform="rotate({perihelion})" data-a="{a}" data-e="{e}" data-w="{perihelion}"/>')
                if ring not in rings[size]:
                    rings[size].append(ring)
            dots.append(
                f'<li class="planet {self.group_class(p)} {" ".join(sides)}" style="{";".join(style)}">'
                f'<a href="/work/{p["slug"]}/"><span class="dot" aria-hidden="true"></span>'
                f'<span class="name">{esc(p["title"]).replace("-", NB_HYPHEN)}</span></a></li>')
        return (
            '<nav class="galaxy" aria-label="Map of systems">'
            '<svg class="orbits" viewBox="-1 -1 2 2" preserveAspectRatio="none" aria-hidden="true">'
            f'<g class="m">{"".join(rings["phone"])}</g><g class="w">{"".join(rings["wide"])}</g></svg>'
            '<a class="home-star" href="/about/"><span class="dot" aria-hidden="true"></span>'
            '<span class="name">About me</span></a>'
            f'<ul>{"".join(dots)}</ul></nav>')

    def home(self):
        cards = []
        for p in self.planets:
            cards.append(
                f'<li class="system {self.group_class(p)}"><a href="/work/{p["slug"]}/">'
                f'<span class="dot" aria-hidden="true"></span>'
                f'<span class="system-text"><span class="system-title">{esc(p["title"])}'
                f'{self.placeholder_badge(p)}</span>'
                f'<span class="system-tagline">{esc(p["tagline"])}</span></span>'
                f'<span class="role">{esc(self.role_text(p))}</span></a></li>')
        positioning = self.about["tagline"] if self.about else self.site["description"]
        content = template(
            "home",
            name=esc(self.site["title"]),
            positioning=esc(positioning),
            galaxy=self.galaxy(),
            cards="".join(cards),
            skills=self.skills_section(),
            skills_js=f"/static/js/skills.js?v={file_hash(STATIC / 'js/skills.js')}",
            script=trip_script("space.js"),
        )
        self.page("/", self.site["title"], self.site["description"], content, "page-home")

    def about_page(self):
        if not self.about:
            if self.b.preview:
                self.about = {"title": "About", "tagline": "", "sections": [], "status": "placeholder",
                              "where": "content/about.md"}
            else:
                return
        a = self.about
        body = "".join(self.section_html(a, s) for s in a["sections"])
        photo = a.get("photo", "")
        if photo and (self.b.content / photo).exists():
            portrait = (f'<img class="portrait" src="/about/{esc(Path(photo).name)}" alt="{esc(self.site["title"])}"'
                        ' width="160" height="160">')
            (self.out / "about").mkdir(parents=True, exist_ok=True)
            shutil.copy(self.b.content / photo, self.out / "about" / Path(photo).name)
        else:
            if photo:
                self.b.problem("content/about.md", f"photo {photo} not found")
            # No photo: the home star from the map stands in, since the star links here.
            portrait = '<div class="portrait is-empty" aria-hidden="true"></div>'
        content = template(
            "about",
            portrait=portrait,
            name=esc(self.site["title"]),
            tagline=esc(a.get("tagline", "")),
            body=body,
            links=self.page_links(),
        )
        self.page("/about/", "About", a.get("tagline") or self.site["description"], content,
                  "page-about" + (" has-portrait" if portrait else ""), self.status_banner(a))

    def page_links(self):
        items = [f'<li><a href="{esc(u)}">{LINK_NAMES.get(k, k.title())}</a></li>'
                 for k, u in self.site["links"].items()]
        return f'<ul class="link-list">{"".join(items)}</ul>' if items else ""

    def topic_pages(self):
        groups = []
        for g in self.groups:
            ids = [t for t in self.live_topics if self.topics[t]["group"] == g]
            if not ids:
                continue
            rows = "".join(
                f'<li><a href="/skills/{t}/">{esc(self.topics[t]["label"])}</a>'
                f'<p>{esc(self.topics[t]["scope"])}</p></li>' for t in ids)
            groups.append(f'<section class="topic-group g-{slugify(g)}"><h2>{esc(g)}</h2><ul>{rows}</ul></section>')
        self.page("/skills/", "Skills", "Every skill across the systems, grouped.",
                  template("topics", groups="".join(groups)), "page-topics")

        for tid in self.live_topics:
            t = self.topics[tid]
            by_planet = {}
            for p, c in self.excerpts.get(tid, []):
                # A diagram on its own isn't shown here (the steps under it say the same), so it
                # would leave only its link behind.
                html = c["html"].strip()
                if html.startswith("<figure") and html.endswith("</figure>"):
                    continue
                by_planet.setdefault(p["slug"], (p, []))[1].append(c)
            planet_chips = "".join(
                f'<li><a class="chip {self.group_class(p)}" href="/work/{p["slug"]}/">'
                f'<span class="dot" aria-hidden="true"></span>{esc(p["title"])}</a></li>'
                for p, _ in by_planet.values())
            sections = []
            for p, claims in by_planet.values():
                items = "".join(
                    f'<li class="excerpt">{c["html"]}'
                    f'<a class="in-context" href="/work/{p["slug"]}/#c-{c["n"]}">Read in context</a></li>'
                    for c in claims)
                sections.append(
                    f'<section class="{self.group_class(p)}"><h2><a href="/work/{p["slug"]}/">{esc(p["title"])}</a></h2>'
                    f'<p class="role">{esc(self.role_text(p))}</p><ul class="excerpts">{items}</ul></section>')
            content = template(
                "topic",
                group=f"g-{slugify(t['group'])}",
                group_name=esc(t["group"]),
                label=esc(t["label"]),
                scope=esc(t["scope"]),
                planets=planet_chips,
                excerpts="".join(sections),
                related=self.chips(t["related"], "Related skills", heading=True),
            )
            self.page(f"/skills/{tid}/", t["label"], t["scope"], content, "page-topic")

    def not_found(self):
        self.page("/404.html", "Lost in space", "This page does not exist.",
                  template("404"), "page-404")

    def data_files(self):
        search = {
            "topics": [{"id": t, "label": self.topics[t]["label"], "aliases": self.topics[t]["aliases"],
                        "url": f"/skills/{t}/", "group": slugify(self.topics[t]["group"])}
                       for t in self.live_topics],
            "excerpts": [{"text": plain(c["html"]), "planet": p["title"], "group": self.group_class(p)[2:],
                          "url": f"/work/{p['slug']}/#c-{c['n']}", "topics": c["topic_ids"]}
                         for p in self.planets for c in self.shown_claims(p)],
            # What search offers before anything is typed: the skills under the map.
            "picks": [{"name": self.topics[t].get("short") or self.topics[t]["label"], "url": f"/skills/{t}/",
                       "group": slugify(self.topics[t]["group"])}
                      for t in self.topic_chips if t in self.live_topics],
        }
        (self.out / "search.json").write_text(json.dumps(search, ensure_ascii=False), "utf-8")
        galaxy = {
            "lead": self.site.get("lead_planet"),
            "planets": [{"slug": p["slug"], "title": p["title"], "tagline": p["tagline"],
                         "role": p["role"], "role_label": self.role_text(p), "order": p.get("order"),
                         "topics": p.get("topics", []),
                         "group": self.group_class(p)[2:], "url": f"/work/{p['slug']}/"}
                        for p in self.planets],
        }
        (self.out / "galaxy.json").write_text(json.dumps(galaxy, ensure_ascii=False), "utf-8")
        robots = "User-agent: *\nAllow: /\n"
        if self.site["indexing"]:
            robots += f"Sitemap: {self.site['url']}/sitemap.xml\n"
            urls = "".join(f"<url><loc>{esc(self.site['url'] + u)}</loc></url>" for u in self.urls)
            (self.out / "sitemap.xml").write_text(
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n', "utf-8")
        (self.out / "robots.txt").write_text(robots, "utf-8")
        (self.out / ".nojekyll").write_text("", "utf-8")

    def assets(self):
        shutil.copytree(STATIC, self.out / "static", ignore=shutil.ignore_patterns(".DS_Store", "README.md"))
        if self.diagrams:
            (self.out / "diagrams").mkdir(exist_ok=True)
            for name in self.diagrams:
                shutil.copy(self.b.content / "diagrams" / name, self.out / "diagrams" / name)


# ----------------------------------------------------------------- checks

CHECKED = {".html", ".json", ".svg", ".xml", ".txt"}
PATTERNS = [
    ("a 12-digit number (account ID?)", re.compile(r"(?<!\d)\d{12}(?!\d)")),
    ("an IPv4 address", re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")),
    ("an AWS ARN", re.compile(r"arn:aws:", re.I)),
    ("an internal hostname", re.compile(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|local|corp)\b", re.I)),
    ("a phone number", re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)")),
]
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
MARKERS = [
    ("a claim comment", re.compile(r"<!--\s*claim")),
    ("a section comment", re.compile(r"<!--\s*section")),
    ("an ev= marker", re.compile(r"\bev=")),
    ("a confirm= marker", re.compile(r"\bconfirm=")),
    ("an evidence reference", re.compile(r"\bPE \d+\b")),
]


def load_denylist(b):
    path = b.private / "denylist.txt"
    if not path.exists():
        b.problem("private/denylist.txt", "missing; the deny-list check did not run")
        return []
    rules = []
    for n, line in enumerate(path.read_text("utf-8").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("re:"):
            rules.append((n, re.compile(line[3:], re.I)))
        else:
            rules.append((n, re.compile(re.escape(line), re.I)))
    return rules


def check_output(b, out, site):
    deny = load_denylist(b)
    allowed = {e.lower() for e in site.get("email_allowlist", [])}
    for path in sorted(out.rglob("*")):
        if path.suffix not in CHECKED or not path.is_file():
            continue
        where = path.relative_to(out).as_posix()
        text = path.read_text("utf-8")
        if "\u2014" in text or "\u2013" in text:
            b.problem(where, "contains an em dash or en dash")
        for n, rule in deny:
            if rule.search(text):
                b.problem(where, f"matches deny-list line {n}")
        visible = re.sub(r"<[^>]+>", " ", text) if path.suffix == ".svg" else text
        for label, pattern in PATTERNS:
            if pattern.search(visible):
                b.problem(where, f"contains {label}")
        for email in EMAIL.findall(text):
            if email.lower() not in allowed:
                b.problem(where, "contains an email address not on the allowlist")
        for label, pattern in MARKERS:
            if pattern.search(text):
                b.problem(where, f"contains {label}")
        if path.suffix == ".html":
            for link in re.findall(r'(?:href|src)="(/[^"#?]*)', text):
                target = out / link.lstrip("/")
                if link.endswith("/"):
                    target = target / "index.html"
                if not target.exists():
                    b.problem(where, f"broken internal link {link}")


# ------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preview", action="store_true", help="drafts included, written to ../preview/")
    mode.add_argument("--publish", action="store_true", help="approved pages only, checked, written to docs/")
    ap.add_argument("--content", type=Path, default=WORKSPACE / "content")
    ap.add_argument("--private", type=Path, default=WORKSPACE / "private")
    args = ap.parse_args()

    b = Build("preview" if args.preview else "publish", args.content.resolve(), args.private.resolve())
    dest = WORKSPACE / "preview" if b.preview else CODE / "docs"

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "site"
        out.mkdir()
        site = Site(b, out)
        site.build()
        check_output(b, out, site.site)

        if b.problems:
            print(f"{len(b.problems)} problem(s):", file=sys.stderr)
            for p in b.problems:
                print(f"  {p}", file=sys.stderr)
            if not b.preview:
                print("Publish stopped. docs/ is unchanged.", file=sys.stderr)
                return 1
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(out, dest)

    pages = len(site.urls) + 1
    print(f"{b.mode}: {pages} pages, {len(site.planets)} planets, {len(site.live_topics)} topics -> {rel(dest)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
