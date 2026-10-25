// The skill view on the home page (design/skill-view/): the skill chips under the map act
// as a lens over the planets. Progressive enhancement only: without this file each chip
// stays a plain link to its skill's page.
//
// Tapping a chip dims the other planets, draws the skill's constellation between the
// planets that use it, and opens "What I did with <skill>". Tapping the chip again, the
// close button, a tap on the map or Escape clears it. Picking a skill in search on the
// home page does the same (site.js calls window.showSkill).

(function () {
  "use strict";

  var galaxy = document.querySelector(".galaxy");
  var section = document.querySelector(".skills");
  var data = document.getElementById("skills-data");
  if (!galaxy || !section || !data) return;

  var card = document.getElementById("skill-card");
  var status = document.getElementById("skill-status");
  var strip = section.querySelector(".skill-chips");
  var wide = matchMedia("(min-width: 48rem)");
  var still = matchMedia("(prefers-reduced-motion: reduce)");
  var SVG = "http://www.w3.org/2000/svg";
  var EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

  var calm = function () { return still.matches; };

  var skills = {};
  var chips = [];
  var lit = [];
  var active = null;
  var veil, lines, preview, bar, home;
  var hinted = [];

  // The build writes each skill's scope and card lines into the page (build.py skills_section).
  try {
    JSON.parse(data.textContent).forEach(function (s) { skills[s.id] = s; });
  } catch (e) {
    return;
  }
  setup();

  function setup() {
    // Chips become toggle buttons in one toolbar: a single tab stop, arrow keys between chips.
    strip.setAttribute("role", "toolbar");
    strip.setAttribute("aria-label", "Skills");
    chips = [].slice.call(strip.querySelectorAll(".skill-chip")).map(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = a.className;
      b.dataset.skill = a.dataset.skill;
      b.tabIndex = i ? -1 : 0;
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-controls", "skill-card");
      while (a.firstChild) b.appendChild(a.firstChild);
      a.parentNode.setAttribute("role", "none");
      a.replaceWith(b);
      return b;
    });
    strip.addEventListener("click", function (e) {
      var b = e.target.closest(".skill-chip");
      if (!b) return;
      if (active === b.dataset.skill) clear(true);
      else show(b.dataset.skill);
    });
    strip.addEventListener("keydown", function (e) {
      var i = chips.indexOf(document.activeElement);
      var j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: chips.length - 1 }[e.key];
      if (i < 0 || j === undefined) return;
      e.preventDefault();
      rove(chips[(j + chips.length) % chips.length], true);
    });

    // On phones the chip row moves into the top of the card while it is open, so switching
    // skills stays one tap and the pressed chip is never hidden behind the card.
    home = document.createComment(" skill chips ");
    strip.before(home);
    bar = document.createElement("div");
    bar.className = "skill-card-bar";
    card.appendChild(bar);

    veil = el("svg", { class: "lens-veil", "aria-hidden": "true" });
    lines = el("svg", { class: "lens-lines", "aria-hidden": "true" });
    var anchor = galaxy.querySelector(".home-star");
    galaxy.insertBefore(veil, anchor);
    galaxy.insertBefore(lines, anchor);

    // Hovering a chip, or reaching it with the keyboard, picks out its planets lightly:
    // their names brighten, the others' fade a little, and a faint ring shows round each.
    // A click draws the whole constellation. Touch screens go straight to the click.
    preview = el("svg", { class: "lens-preview", "aria-hidden": "true" });
    galaxy.insertBefore(preview, anchor);
    var hover = matchMedia("(hover: hover)");
    strip.addEventListener("pointerover", function (e) {
      var b = e.target.closest(".skill-chip");
      if (b && e.pointerType !== "touch" && hover.matches) hint(b.dataset.skill);
    });
    strip.addEventListener("pointerout", function (e) {
      var b = e.target.closest(".skill-chip");
      if (b && !b.contains(e.relatedTarget)) unhint();
    });
    strip.addEventListener("focusin", function (e) {
      var b = e.target.closest(".skill-chip");
      if (b && b.matches(":focus-visible")) hint(b.dataset.skill);
    });
    strip.addEventListener("focusout", unhint);

    // Hovering or focusing a line in the card picks out its planet on the map.
    var hot = function (e) {
      var li = e.type === "pointerout" || e.type === "focusout" ? null : e.target.closest("[data-planet]");
      var slug = li && li.dataset.planet;
      lines.querySelectorAll("circle").forEach(function (c) { c.classList.toggle("is-hot", c.dataset.planet === slug); });
    };
    ["pointerover", "pointerout", "focusin", "focusout"].forEach(function (t) { card.addEventListener(t, hot); });

    // Any tap on the map clears the lens. A planet tap then goes on to its approach, which
    // moves the camera, so the lens must be gone first.
    galaxy.addEventListener("click", function () { if (active !== null) clear(false); }, true);

    addEventListener("keydown", function (e) {
      if (e.key === "Escape" && active !== null && !document.querySelector(".space-card:not([hidden])")) clear(true);
    });
    new ResizeObserver(function () {
      if (active === null) return;
      var m = measure();
      drawVeil(m);
      drawLines(m, false);
    }).observe(galaxy);
    // Phones: once the map has scrolled away, the card goes with it.
    new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting && active !== null && !wide.matches) clear(false);
    }).observe(galaxy);
    wide.addEventListener("change", function () {
      if (active === null) return;
      dock(!wide.matches);
      frame(function () {});
    });

    // Search on this page lights a skill instead of going to its page (site.js).
    window.showSkill = function (id) { return show(id, "search"); };
    // After a trip has put a planet's page in place of the map (swap.js), searches go to the
    // skill's page again.
    document.addEventListener("pageswapped", function () { delete window.showSkill; });
  }

  function rove(chip, focus) {
    chips.forEach(function (b) { b.tabIndex = b === chip ? 0 : -1; });
    if (focus) chip.focus();
  }

  // Phones: while the card is up, the row of skills rides at its top. A still copy keeps the
  // row's place in the page, so nothing under the card moves when it goes or comes back.
  var ghost = null;
  function dock(inCard) {
    if ((strip.parentNode === bar) === inCard) return;
    var f = document.activeElement;
    if (inCard) {
      ghost = strip.cloneNode(true);
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.querySelectorAll("[data-skill]").forEach(function (b) { b.removeAttribute("data-skill"); });
      strip.replaceWith(ghost);
      bar.appendChild(strip);
    } else if (ghost) {
      ghost.replaceWith(strip);
      ghost = null;
    } else {
      home.after(strip);
    }
    if (f && strip.contains(f)) f.focus({ preventScroll: true });
  }

  // Keep the pressed chip in view inside a scrolled row.
  function reveal(chip) {
    var r = chip.getBoundingClientRect(), s = strip.getBoundingClientRect();
    if (r.left < s.left + 16 || r.right > s.right - 48) {
      strip.scrollBy({ left: r.left - s.left - 20, behavior: calm() ? "auto" : "smooth" });
    }
  }

  // ---- the lens layers: a veil with holes over the chosen planets, then the lines

  function el(name, attrs) {
    var n = document.createElementNS(SVG, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // Where everything sits right now, in the map's own pixels.
  function measure() {
    var box = galaxy.getBoundingClientRect();
    var at = function (dot) {
      var r = dot.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, r: r.width / 2 };
    };
    return {
      w: box.width,
      h: box.height,
      sun: at(galaxy.querySelector(".home-star .dot")),
      planets: lit.map(function (li) {
        var p = at(li.querySelector(".dot"));
        p.slug = li.querySelector("a").getAttribute("href").split("/")[2];
        return p;
      }),
    };
  }

  function drawVeil(m) {
    veil.setAttribute("viewBox", "0 0 " + m.w + " " + m.h);
    var hole = function (x, y, r, o) {
      return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#lens-hole)" fill-opacity="' + o + '"/>';
    };
    // The lit planets show through; the sun dims but keeps some of its warmth.
    var holes = hole(m.sun.x, m.sun.y, m.sun.r * 2.6, 0.55) + m.planets.map(function (p) {
      return hole(p.x, p.y, p.r * 3.4 + 8, 1);
    }).join("");
    veil.innerHTML =
      '<defs>' +
      '<radialGradient id="lens-edge" r="0.62"><stop offset="0.8" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>' +
      '<radialGradient id="lens-hole"><stop offset="0.42" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
      '<mask id="lens-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="' + m.w + '" height="' + m.h + '">' +
      '<rect width="' + m.w + '" height="' + m.h + '" fill="url(#lens-edge)"/>' + holes + '</mask>' +
      '</defs>' +
      '<rect width="' + m.w + '" height="' + m.h + '" fill="#070919" fill-opacity="0.66" mask="url(#lens-mask)"/>';
  }

  // A constellation: the chosen planets in order around the sun, skipping the widest gap,
  // so the path wraps the sun instead of crossing it. Segments are nearly straight, and
  // bow outward only as far as they must to clear the sun.
  function route(m) {
    var pts = m.planets.map(function (p) {
      return { p: p, a: Math.atan2(p.y - m.sun.y, p.x - m.sun.x) };
    }).sort(function (u, v) { return u.a - v.a; });
    if (pts.length < 2) return [];
    var cut = 0, gap = -1;
    pts.forEach(function (u, i) {
      var v = pts[(i + 1) % pts.length];
      var g = (v.a - u.a + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
      if (g > gap) { gap = g; cut = i; }
    });
    var order = pts.slice(cut + 1).concat(pts.slice(0, cut + 1)).map(function (u) { return u.p; });
    var clear = m.sun.r * 3 + 16;
    var segs = [];
    for (var i = 0; i < order.length - 1; i++) {
      var A = order[i], B = order[i + 1];
      var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
      var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      var nx = -dy / len, ny = dx / len;
      var side = (mx - m.sun.x) * nx + (my - m.sun.y) * ny;
      if (side < 0) { nx = -nx; ny = -ny; side = -side; }
      // How close the straight segment itself comes to the sun.
      var t = Math.max(0, Math.min(1, ((m.sun.x - A.x) * dx + (m.sun.y - A.y) * dy) / (len * len)));
      var near = Math.hypot(A.x + dx * t - m.sun.x, A.y + dy * t - m.sun.y);
      var h = Math.min(len * 0.035, 14);
      if (near < clear) h = Math.max(h, clear - side);
      var cx = mx + nx * h * 2, cy = my + ny * h * 2;
      var a = trim(A, cx, cy, A.r + 7), b = trim(B, cx, cy, B.r + 7);
      segs.push("M" + a.x.toFixed(1) + " " + a.y.toFixed(1) + "Q" + cx.toFixed(1) + " " + cy.toFixed(1) + " " + b.x.toFixed(1) + " " + b.y.toFixed(1));
    }
    return segs;
  }
  function trim(P, cx, cy, d) {
    var dx = cx - P.x, dy = cy - P.y, l = Math.hypot(dx, dy) || 1;
    return { x: P.x + dx / l * d, y: P.y + dy / l * d };
  }

  function drawLines(m, animate) {
    lines.setAttribute("viewBox", "0 0 " + m.w + " " + m.h);
    lines.textContent = "";
    lines.classList.remove("is-leaving");
    // The parked rocket is in front of the constellation: the lines pass behind it, with a
    // soft gap where it sits (its place comes from the 3D map, space.js).
    var group = lines;
    var rocket = (galaxy.dataset.rocket || "").split(" ").map(Number);
    if (rocket.length === 3 && rocket.every(isFinite)) {
      lines.innerHTML =
        '<defs><radialGradient id="lens-behind-hole"><stop offset="0.7" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
        '<mask id="lens-behind" maskUnits="userSpaceOnUse" x="0" y="0" width="' + m.w + '" height="' + m.h + '">' +
        '<rect width="' + m.w + '" height="' + m.h + '" fill="#fff"/>' +
        '<circle cx="' + rocket[0] + '" cy="' + rocket[1] + '" r="' + rocket[2] + '" style="fill:url(#lens-behind-hole);stroke:none"/></mask></defs>';
      group = lines.appendChild(el("g", { mask: "url(#lens-behind)" }));
    }
    var paths = [];
    m.planets.forEach(function (p) {
      var ring = el("circle", { cx: p.x, cy: p.y, r: p.r + 3.5, "data-planet": p.slug });
      paths.push({ node: group.appendChild(ring), delay: 0, time: 420 });
      // A lone planet has no line to draw, so it gets a second, fainter ring.
      if (m.planets.length === 1) {
        paths.push({ node: group.appendChild(el("circle", { cx: p.x, cy: p.y, r: p.r + 11, class: "halo" })), delay: 120, time: 520 });
      }
    });
    route(m).forEach(function (d, i) {
      var glow = group.appendChild(el("path", { d: d, class: "glow" }));
      var line = group.appendChild(el("path", { d: d, class: "line" }));
      paths.push({ node: glow, delay: 140 + i * 110, time: 560 }, { node: line, delay: 140 + i * 110, time: 560 });
    });
    if (!animate) return;
    paths.forEach(function (q) {
      var len = q.node.getTotalLength();
      q.node.style.strokeDasharray = len + " " + len;
      q.node.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: q.time, delay: q.delay, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "backwards",
      });
    });
  }

  // ---- the card

  function render(s) {
    var body = document.createElement("div");
    body.className = "skill-body";
    body.innerHTML =
      '<div class="skill-card-head"><h3 id="skill-card-title" tabindex="-1">What&nbsp;I&nbsp;did&nbsp;with <span class="skill-name"></span></h3>' +
      '<button type="button" class="skill-close"><svg viewBox="0 0 14 14" aria-hidden="true">' +
      '<path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>' +
      '<p class="skill-scope"><span></span> <a class="skill-more"></a></p><ul class="skill-lines"></ul>';
    body.querySelector(".skill-name").textContent = s.name;
    body.querySelector(".skill-scope span").textContent = s.scope;
    var more = body.querySelector(".skill-more");
    more.href = s.url;
    more.textContent = "More on " + s.name;
    var close = body.querySelector(".skill-close");
    close.setAttribute("aria-label", "Close " + s.name);
    close.addEventListener("click", function () { clear(true); });
    var list = body.querySelector(".skill-lines");
    s.lines.forEach(function (line) {
      var li = document.createElement("li");
      li.className = "g-" + line.group;
      li.dataset.planet = line.planet;
      li.innerHTML = '<a class="skill-line"><span class="where"><span class="dot" aria-hidden="true"></span><span></span></span><span class="text"></span></a>';
      var a = li.querySelector("a");
      a.href = line.url;
      a.querySelector(".where span:last-child").textContent = line.title;
      a.querySelector(".text").textContent = line.text;
      list.appendChild(li);
    });
    return body;
  }

  function hint(id) {
    unhint();
    var s = skills[id];
    if (active !== null || !s) return;
    var hrefs = s.lines.map(function (l) { return "/work/" + l.planet + "/"; });
    galaxy.querySelectorAll(".planet").forEach(function (li) {
      if (hrefs.indexOf(li.querySelector("a").getAttribute("href")) < 0) return;
      li.classList.add("is-hinted");
      hinted.push(li);
    });
    preview.setAttribute("class", "lens-preview g-" + s.group);
    rings();
    galaxy.classList.add("has-hint");
  }

  // The preview's rings, where the planets are now; redrawn each frame while the map moves
  // under them. They stay drawn after the pointer leaves, so they fade out (site.css).
  var ringing = 0;
  function rings() {
    cancelAnimationFrame(ringing);
    preview.textContent = "";
    var box = galaxy.getBoundingClientRect();
    preview.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    hinted.forEach(function (li) {
      var r = li.querySelector(".dot").getBoundingClientRect();
      var x = r.left + r.width / 2 - box.left, y = r.top + r.height / 2 - box.top;
      preview.appendChild(el("circle", { cx: x, cy: y, r: r.width / 2 + 9, class: "glow" }));
      preview.appendChild(el("circle", { cx: x, cy: y, r: r.width / 2 + 3.5 }));
    });
    if (hinted.length && galaxy.querySelector('.planet[style*="left"]')) ringing = requestAnimationFrame(rings);
  }

  function unhint() {
    if (!hinted.length && !galaxy.classList.contains("has-hint")) return;
    galaxy.classList.remove("has-hint");
    hinted.forEach(function (li) { li.classList.remove("is-hinted"); });
    hinted = [];
    cancelAnimationFrame(ringing);
  }

  function show(id, from) {
    var s = skills[id];
    if (!s) return false;
    unhint();
    var swapping = active !== null;
    active = id;

    var chip = null;
    chips.forEach(function (b) {
      var on = b.dataset.skill === id;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) chip = b;
    });
    rove(chip, false);
    var hrefs = s.lines.map(function (l) { return "/work/" + l.planet + "/"; });
    lit = [];
    galaxy.querySelectorAll(".planet").forEach(function (li) {
      var on = hrefs.indexOf(li.querySelector("a").getAttribute("href")) > -1;
      li.classList.toggle("is-lit", on);
      if (on) lit.push(li);
    });

    card.getAnimations().forEach(function (a) { a.cancel(); });
    card.style.removeProperty("overflow");
    var body = render(s);
    var fill = function () {
      card.className = "skill-card g-" + s.group + (swapping ? " is-open" : "");
      var old = card.querySelector(".skill-body");
      if (old) old.replaceWith(body);
      else card.appendChild(body);
    };
    if (swapping && !calm()) {
      // The old contents and constellation fade out, then the new ones come in.
      card.classList.add("is-swapping");
      lines.classList.add("is-leaving");
      setTimeout(function () { if (active === id) { fill(); next(); } }, 150);
    } else {
      card.hidden = false;
      fill();
      next();
    }
    reveal(chip);
    status.textContent = "Showing what I did with " + s.name + ", in " + s.lines.length +
      (s.lines.length === 1 ? " system." : " systems.");

    // Bring the planets into view first, then light them and open the card.
    function next() {
      settled(function () { frame(swapping, function () {
        if (active !== id) return;
        galaxy.classList.add("has-lens");
        lines.setAttribute("class", "lens-lines g-" + s.group);
        var m = measure();
        drawVeil(m);
        drawLines(m, !calm());
        // The row moves into the card (phones) as it rises, keeping the chip's focus.
        dock(!wide.matches);
        if (!calm()) card.getBoundingClientRect();
        card.classList.add("is-open");
        if (from === "search") card.querySelector("h3").focus({ preventScroll: true });
      }); });
    }
    return true;
  }

  // The 3D map moves its labels while the camera moves (a planet's card closing, say).
  // The lens is drawn where the planets are, so it waits for the map to come to rest.
  function settled(then) {
    var start = performance.now();
    (function check() {
      if (!galaxy.querySelector('.planet[style*="left"]') || performance.now() - start > 700) then();
      else requestAnimationFrame(check);
    })();
  }

  function clear(returnFocus) {
    if (active === null) return;
    var was = active;
    active = null;
    chips.forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    galaxy.classList.remove("has-lens");
    lit.forEach(function (li) { li.classList.remove("is-lit"); });
    lit = [];
    lines.classList.add("is-leaving");
    var chip = chips.filter(function (b) { return b.dataset.skill === was; })[0];
    if (chip) reveal(chip);
    if (returnFocus && chip) chip.focus({ preventScroll: true });
    status.textContent = "";

    var done = function () {
      if (active !== null) return;
      dock(false);
      card.hidden = true;
      card.className = "skill-card";
      var old = card.querySelector(".skill-body");
      if (old) old.remove();
      card.style.removeProperty("overflow");
      lines.textContent = "";
    };
    card.classList.remove("is-open", "is-swapping");
    if (calm()) return done();
    if (wide.matches) {
      // Fold the panel away, so the page under it slides up instead of jumping.
      var cs = getComputedStyle(card);
      card.style.overflow = "hidden";
      card.animate([
        { height: card.offsetHeight + "px", marginTop: cs.marginTop, paddingTop: cs.paddingTop, borderTopWidth: cs.borderTopWidth },
        { height: "0px", marginTop: "0px", paddingTop: "0px", borderTopWidth: "0px", borderBottomWidth: "0px" },
      ], { duration: 380, easing: EASE }).onfinish = done;
    } else {
      // Once the card has slid away.
      setTimeout(done, 460);
    }
  }

  // Phones: the whole map goes to the top of the screen and the card takes the rest, the same
  // for every skill, so moving from one skill to the next doesn't move the page.
  // Wide screens: the lit planets and the whole card when they fit, else the card first;
  // moving to another skill leaves the page where it is.
  function frame(swapping, then) {
    var top = Infinity, seen = false;
    lit.forEach(function (li) {
      var r = li.querySelector("a").getBoundingClientRect();
      top = Math.min(top, r.top + scrollY);
      if (r.bottom > 0 && r.top < innerHeight) seen = true;
    });
    if (!lit.length) return then();
    var target;
    if (!wide.matches) {
      var map = galaxy.getBoundingClientRect();
      target = map.top + scrollY - 8;
      card.style.setProperty("--lens-clear", Math.round(map.height + 16) + "px");
    } else {
      // Moving from one skill to the next, the page stays put while the card and some of its
      // planets are in view; so does a first one already wholly in view.
      var box = card.getBoundingClientRect(), cardBottom = box.bottom + scrollY + 24;
      if (swapping && seen && box.top < innerHeight - 80) return then();
      if (top - 24 >= scrollY && cardBottom <= scrollY + innerHeight) return then();
      // When both fit, start at the top of the map if possible.
      var a = top - 24, b = cardBottom - innerHeight;
      var mapTop = galaxy.getBoundingClientRect().top + scrollY - 8;
      target = b <= a ? Math.min(Math.max(mapTop, b), a) : b;
    }
    target = Math.max(0, Math.min(Math.round(target), document.documentElement.scrollHeight - innerHeight));
    if (Math.abs(target - scrollY) < 4) return then();
    if (calm()) { scrollTo({ top: target, behavior: "instant" }); return then(); }
    glide(target, then);
  }

  // The page glides to the map: slower and softer than the browser's own smooth scroll, which
  // reads as a jump over a long way. What comes next starts as it settles, so the two read as
  // one movement. A touch or the wheel stops it where it is.
  function glide(target, then) {
    var from = scrollY, d = target - from, ms = Math.min(1150, 640 + Math.abs(d) * 0.5);
    var t0 = null, called = false, stopped = false;
    var go = function () { if (!called) { called = true; then(); } };
    var stop = function () { stopped = true; };
    addEventListener("touchstart", stop, { passive: true, once: true });
    addEventListener("wheel", stop, { passive: true, once: true });
    requestAnimationFrame(function step(now) {
      if (t0 === null) t0 = now;
      var u = Math.min(1, (now - t0) / ms);
      if (!stopped) scrollTo({ top: from + d * (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2), behavior: "instant" });
      if (u >= 0.8 || stopped) go();
      if (u < 1 && !stopped) requestAnimationFrame(step);
      else {
        removeEventListener("touchstart", stop);
        removeEventListener("wheel", stop);
      }
    });
  }
})();
