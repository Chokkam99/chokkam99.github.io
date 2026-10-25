// The planet page: loads the surface images as the stones come near, and plays the trips.
// A trip from the map ends here in the touchdown (landing.js), marked trip-land: by
// base.html before the first paint, or by space.js as it puts this page in place of the map.
// A hop to a nearby planet plays whole here, then puts that planet's page in place of this
// one (swap.js), which runs a fresh copy of this file.

// The build's version, for the modules this loads (this file's own address may carry more).
const V = `?v=${new URL(import.meta.url).searchParams.get("v")}`;
const root = document.documentElement;
const store = {
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* the next page just shows itself */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nothing to clear */ } },
};
store.del("trip");

// ---- the surface images, as the stones come near

const stones = document.querySelectorAll(".stone");
if ("IntersectionObserver" in window) {
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add("is-near"); near.unobserve(e.target); }
    }
  }, { rootMargin: "100% 0px" });
  stones.forEach((s) => near.observe(s));
} else {
  stones.forEach((s) => s.classList.add("is-near"));
}

// ---- the short hop, about 3.5 s. Every planet page has the same window in the same place,
// so the window never moves; only the view through it changes. Plain DOM and CSS, no 3D.
// One pure timeline, t in ms (first designed in design/flight/hop-lab.js):
//   0..250 the words fade | 0..700 a short burn, the ground falls away below the glass, the
//   sky darkens to space | 500..1100 the warp builds | 1200 the window takes on the next
//   planet's colours, all space by now | 1200..2000 the warp holds, then settles |
//   2400..3250 the new planet's horizon rises into place, a soft burn as it settles |
//   3250 its page takes this one's place, the window just as it is | 3250..3550 its words
//   fade in.
const HOP = { change: 1200, swap: 3250, end: 3550 };

const porthole = document.querySelector(".porthole");
const outside = porthole.querySelector(".outside");
const words = [...porthole.querySelectorAll(".porthole-content, .nearby, .sky-stars")];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (x, a, b) => clamp01((x - a) / (b - a));
const ease = { in: (x) => x * x * x, out: (x) => 1 - Math.pow(1 - x, 3), inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) };
const bump = (x, a, b, c, d) => span(x, a, b) * (1 - span(x, c, d));

// The stars drift past at a slight slant: the rocket climbs, then leans toward the next
// planet.
const SLANT_X = -Math.tan((12 * Math.PI) / 180);
// A tile of stars: round points of a few sizes.
function tile(w, h, n, seed) {
  let x = seed;
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  let body = "";
  for (let i = 0; i < n; i++) {
    const cx = (r() * w).toFixed(1), cy = (r() * h).toFixed(1), b = (0.45 + 0.55 * r()).toFixed(2);
    body += `<circle cx='${cx}' cy='${cy}' r='${(0.5 + 0.5 * r()).toFixed(2)}' fill='white' opacity='${b}'/>`;
  }
  return `url("data:image/svg+xml,${`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`.replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}

// The warp seen through the glass: stars rushing out from the middle of the window, as on
// the map's flight. Each star has a direction and a depth that comes nearer with time, so
// every frame still depends on t alone.
const WARP = (() => {
  let x = 20241024;
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 64 }, () => ({ a: r() * Math.PI * 2, z: r(), b: 0.45 + 0.55 * r() }));
})();
function drawWarp(canvas, t, strength) {
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  if (strength < 0.01) return;
  const dpr = w / canvas.clientWidth;
  const cx = w / 2, cy = h * 0.42, R = Math.hypot(w, h) * 0.6;
  g.strokeStyle = "#e6ecff";
  g.lineCap = "round";
  for (const s of WARP) {
    const z = 1 - ((s.z + t * 0.0011) % 1); // 1 far .. 0 at the glass
    const head = (R * 0.05) / (0.06 + 0.94 * z);
    const tail = (R * 0.05) / Math.min(1, 0.06 + 0.94 * z + 0.25 * strength);
    if (tail > R * 1.2) continue;
    const ca = Math.cos(s.a), sa = Math.sin(s.a), end = Math.min(head, R * 1.3);
    // Fading in as they leave the middle keeps the vanishing point dark.
    g.globalAlpha = strength * s.b * clamp01((head / R - 0.07) / 0.18);
    g.lineWidth = dpr * (0.6 + 1.4 * (1 - z));
    g.beginPath();
    g.moveTo(cx + ca * tail, cy + sa * tail);
    g.lineTo(cx + ca * end, cy + sa * end);
    g.stroke();
  }
}

// The planet ahead: on a hop it shows as a small globe in its own color at the vanishing
// point while the warp builds, grows as the rocket closes in, and up close becomes the
// ground under the window's horizon, where the page's own horizon and far stones take over.
// Colors are the page's, resolved by the browser (color-mix included).
function rgb(el, expr) {
  const probe = document.createElement("span");
  probe.style.color = expr;
  el.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const n = c.match(/-?[\d.]+(e-?\d+)?/g).map(Number);
  return (c.startsWith("color(") ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3)).map(Math.round);
}
const rgba = (v, a) => `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${a})`;
function planetColors(el, ground) {
  const at = (expr) => rgb(el, expr);
  return {
    c: at("var(--c)"), light: at("color-mix(in srgb, var(--c) 45%, #fff)"), dark: at("color-mix(in srgb, var(--c) 25%, #05060f)"),
    rim: at("color-mix(in srgb, var(--c) 70%, #fff)"),
    ground: ground ? [at("var(--ground-far)"), at("var(--ground)"), at("var(--ground-deep)")] : null,
  };
}
let hopColors = null;
function drawPlanet(canvas, t, col, crest) {
  if (!col) return;
  const g = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height, k = w / canvas.clientWidth;
  const vp = h * 0.42;
  let r, cy, alpha, close = 0;
  if (t < HOP.change) {
    const u = span(t, 600, HOP.change);
    if (u <= 0) return;
    alpha = span(t, 600, 900);
    r = (1.5 + 5.5 * ease.in(u)) * k;
    cy = vp;
  } else {
    // Slowly at first, then faster as it nears; its top edge rises to the horizon line.
    const u = span(t, HOP.change, 2950);
    const r0 = 7 * k, rEnd = 3.2 * w;
    r = r0 * Math.pow(rEnd / r0, Math.pow(u, 1.7));
    cy = r + (vp - r0) + (crest * k - (vp - r0)) * ease.inOut(u);
    close = span(u, 0.55, 0.95);
    alpha = 1 - span(t, 2950, 3250);
  }
  if (alpha <= 0) return;
  const cx = w / 2, TAU = Math.PI * 2;
  const disc = (fill, a) => { g.globalAlpha = alpha * a; g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); };
  // Its atmosphere, then the globe lit from the upper right, where the window's sun is.
  const halo = r * 1.18 + 6 * k;
  const glow = g.createRadialGradient(cx, cy, r * 0.96, cx, cy, halo);
  glow.addColorStop(0, rgba(col.c, 0.45));
  glow.addColorStop(1, rgba(col.c, 0));
  g.globalAlpha = alpha;
  g.fillStyle = glow;
  g.beginPath();
  g.arc(cx, cy, halo, 0, TAU);
  g.fill();
  const lit = g.createRadialGradient(cx + 0.35 * r, cy - 0.4 * r, r * 0.05, cx + 0.2 * r, cy - 0.2 * r, r * 1.15);
  lit.addColorStop(0, rgba(col.light, 1));
  lit.addColorStop(0.45, rgba(col.c, 1));
  lit.addColorStop(1, rgba(col.dark, 1));
  disc(lit, 1);
  // Up close, its night side: the window's ground, with the same bright rim.
  if (close > 0 && col.ground) {
    const top = cy - r;
    const land = g.createLinearGradient(0, top, 0, top + 420 * k);
    land.addColorStop(0, rgba(col.ground[0], 1));
    land.addColorStop(160 / 420, rgba(col.ground[1], 1));
    land.addColorStop(1, rgba(col.ground[2], 1));
    disc(land, close);
    g.globalAlpha = alpha * close;
    g.strokeStyle = rgba(col.rim, 1);
    g.lineWidth = k;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.stroke();
  }
  g.globalAlpha = 1;
}

// Deep space over the sky is the window's own layer (world.css, --space); the stars, the
// warp and the engine's light go in just under the glare while a hop plays.
let hop = null;
function hopLayers() {
  if (hop) return hop;
  const glare = outside.querySelector(".glare");
  const layer = (bg) => {
    const el = document.createElement("span");
    el.className = "hop-layer";
    el.style.background = bg;
    outside.insertBefore(el, glare);
    return el;
  };
  hop = {
    crest: parseFloat(getComputedStyle(porthole).getPropertyValue("--crest")),
    fall: porthole.clientHeight - parseFloat(getComputedStyle(porthole).getPropertyValue("--crest")) + 60,
    stars: layer(`${tile(330, 470, 40, 7)}, ${tile(250, 390, 18, 29)}`),
    warp: (() => {
      const c = document.createElement("canvas");
      c.className = "hop-layer";
      c.width = Math.round(outside.clientWidth * Math.min(devicePixelRatio, 2));
      c.height = Math.round(outside.clientHeight * Math.min(devicePixelRatio, 2));
      outside.insertBefore(c, glare);
      return c;
    })(),
    burn: layer("radial-gradient(70% 34% at 50% 108%, rgb(255 178 102 / .55), rgb(255 140 70 / .18) 45%, transparent 75%)"),
    // The skip hint, as on the map's flight.
    hint: (() => {
      const el = document.createElement("div");
      el.className = "trip-hint";
      el.style.transition = "none";
      el.setAttribute("aria-hidden", "true");
      el.textContent = matchMedia("(pointer: coarse)").matches ? "Tap to skip" : "Click or press any key to skip";
      document.body.appendChild(el);
      return el;
    })(),
  };
  return hop;
}
function hopFrame(t) {
  const h = hopLayers();
  // Leaving the ground falls away; arriving it rises from below. The stars drift down past
  // the glass as the rocket climbs, the warp builds as it leaves and holds through the page
  // change, and both settle before the new ground arrives.
  const leaving = t < HOP.change;
  // Arriving, the page's ground waits below the glass until the planet ahead has become the
  // ground under the horizon, then takes over under it as it fades.
  const drop = leaving ? h.fall * ease.in(span(t, 100, 700)) : t < 2950 ? h.fall : 0;
  outside.style.setProperty("--drop", `${drop}px`);
  outside.style.setProperty("--space", leaving ? span(t, 200, 700) : 1 - ease.inOut(span(t, 2500, 3050)));
  const travel = 0.35 * (leaving ? 700 * ease.in(span(t, 200, 1200)) : 700 + 420 * ease.out(span(t, 1200, 2600)));
  h.stars.style.opacity = 0.9 * (leaving ? span(t, 200, 500) : 1 - span(t, 2700, 3100));
  h.stars.style.backgroundPosition = `${travel * SLANT_X}px ${travel}px, ${travel * 0.6 * SLANT_X}px ${travel * 0.6}px`;
  h.warp.getContext("2d").clearRect(0, 0, h.warp.width, h.warp.height);
  drawPlanet(h.warp, t, hopColors, h.crest);
  drawWarp(h.warp, t, leaving ? ease.in(span(t, 500, 1100)) : 1 - ease.out(span(t, 2000, 2600)));
  h.burn.style.opacity = leaving ? bump(t, 0, 150, 400, 650) : 0.7 * bump(t, 2650, 2800, 2950, 3150);
  const on = leaving ? 1 - span(t, 0, 250) : ease.out(span(t, HOP.swap, HOP.end));
  words.forEach((el) => { el.style.opacity = on; });
  h.hint.style.opacity = leaving ? span(t, 100, 300) : 1 - span(t, 2800, 3100);
}
function hopClear() {
  if (hop) { hop.stars.remove(); hop.warp.remove(); hop.burn.remove(); hop.hint.remove(); hop = null; }
  outside.style.removeProperty("--drop");
  outside.style.removeProperty("--space");
  words.forEach((el) => { el.style.opacity = ""; });
}

// Plays the hop from one time to another, then calls done. Any tap or key skips: done(true).
function play(from, to, done) {
  let t0 = null, raf = 0;
  const end = (skipped) => {
    cancelAnimationFrame(raf);
    removeEventListener("pointerdown", skip, true);
    removeEventListener("keydown", skip, true);
    removeEventListener("wheel", skip, true);
    done(skipped);
  };
  function skip(e) {
    if (e.type === "keydown" && (e.metaKey || e.ctrlKey || e.altKey)) return;
    // The tap that skips is not also a click on whatever is under it.
    if (e.type === "pointerdown") {
      const swallow = (c) => { c.preventDefault(); c.stopPropagation(); };
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, true), 800);
    }
    end(true);
  }
  addEventListener("pointerdown", skip, true);
  addEventListener("keydown", skip, true);
  addEventListener("wheel", skip, { capture: true, passive: true });
  const frame = (now) => {
    if (t0 === null) t0 = now;
    const t = Math.min(to, from + now - t0);
    hopFrame(t);
    if (t < to) raf = requestAnimationFrame(frame);
    else end(false);
  };
  hopFrame(from);
  raf = requestAnimationFrame(frame);
}

// A touchdown that can't play arrives the way a hop does: out of space, as the planet ahead
// becomes the ground.
function arrive() {
  hopColors = planetColors(document.querySelector(".world"), true);
  hopFrame(HOP.change);
  root.classList.remove("trip-land");
  play(HOP.change, HOP.end, hopClear);
}

if (root.classList.contains("trip-land")) {
  import(`./landing.js${V}`).then((m) => m.land()).catch(arrive);
}

// Leaving from the window for a nearby planet: the whole hop plays here while that planet's
// page is made ready in the background (swap.js). When the new ground has arrived, the page
// takes this one's place without a load (holding on the arrived window, on a slow
// connection, until it can) and only its words fade in. Skipping, or a page that can't be
// had, goes there the ordinary way.
let leaving = false;
const block = (e) => e.preventDefault();
porthole.querySelector(".nearby")?.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  e.preventDefault();
  if (leaving) return;
  leaving = true;
  const href = link.getAttribute("href");
  // A module runs once per address: the next page gets a fresh copy of this file.
  const fresh = (src) => `${src}${src.includes("?") ? "&" : "?"}n=${Date.now()}`;
  const next = import(`./swap.js${V}`).then((S) => S.prepare(href, fresh).then((ready) => [S, ready]));
  next.catch(() => { /* the hop's end goes there the ordinary way */ });
  const go = () => { store.del("trip"); location.href = href; };
  const group = [...link.closest("li").classList].find((c) => c.startsWith("g-"));
  hopColors = planetColors(link.closest("li"), false);
  // Nothing else on the page follows a click while it leaves.
  addEventListener("click", block, true);
  play(0, HOP.change, (skipped) => {
    if (skipped) return go();
    // All space in the window now: it takes on the next planet's colours, so the ground that
    // arrives is that planet's own.
    const world = document.querySelector(".world");
    [...world.classList].filter((c) => c.startsWith("g-")).forEach((c) => world.classList.remove(c));
    if (group) world.classList.add(group);
    hopColors = planetColors(world, true);
    play(HOP.change, HOP.swap, (late) => {
      if (late) return go();
      next.then(([S, ready]) => {
        removeEventListener("click", block, true);
        if (hop) { hop.hint.remove(); hop = null; }
        S.swap(ready, href, { keepScroll: true });
        const words = [...document.querySelectorAll(".porthole-content, .nearby, .sky-stars")];
        words.forEach((el) => { el.style.opacity = 0; });
        // Timed from the frame after the new page's first (laying it out is real work, and
        // that frame's clock is read before it), so the words fade rather than appear.
        let t0 = null;
        const fade = (now) => {
          if (t0 === null) t0 = now;
          const u = ease.out(span(now - t0, 0, HOP.end - HOP.swap));
          words.forEach((el) => { el.style.opacity = u < 1 ? u : ""; });
          if (u < 1) requestAnimationFrame(fade);
        };
        requestAnimationFrame(() => requestAnimationFrame(fade));
        import(ready.src).catch(() => { /* the page still reads; its extras just don't run */ });
      }, go);
    });
  });
});

// ---- Explore: through the window toward the far stones, and out onto the surface.
// A same-page view transition: the window's frame and seal, the view outside and the words
// are each pictured on their own (world.css), so the frame rushes past while the view comes
// on more slowly behind it, and the surface's own sky and stones come up out of it. Without
// the transition API, or with reduced motion, the link just goes there.

const surface = document.getElementById("surface");
const stepLayers = [["step-frame", ".frame"], ["step-seal", ".seal"], ["step-sky", ".outside"],
  ["step-words", ".porthole-content"], ["step-nearby", ".nearby"]]
  .map(([name, sel]) => [name, porthole.querySelector(sel)]).filter(([, el]) => el);
let stepping = false;
porthole.querySelector(".step-outside")?.addEventListener("click", (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !surface) return;
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  e.preventDefault();
  if (stepping) return;
  stepping = true;
  // Everything zooms toward the window's far stone (kept on screen if the page has moved).
  const at = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const [fx, fy0] = at(porthole.querySelector(".horizon-ruins .far-1"));
  const fy = Math.min(Math.max(fy0, innerHeight * 0.15), innerHeight * 0.6);
  root.style.setProperty("--step-at", `${fx}px ${fy}px`);
  for (const [name, el] of stepLayers) {
    const r = el.getBoundingClientRect();
    root.style.setProperty(`--${name}`, `${fx - r.left}px ${fy - r.top}px`);
    el.style.viewTransitionName = name;
  }
  root.classList.add("stepping");
  const t = document.startViewTransition(() => {
    for (const [, el] of stepLayers) el.style.viewTransitionName = "";
    // A history entry first, so Back returns to the window where it was.
    history.pushState(null, "", "#surface");
    surface.scrollIntoView({ block: "start" });
    // ...and the surface comes up toward its own far stone.
    const [lx, ly] = at(surface.querySelector(".surface-sky .far-1") || surface);
    root.style.setProperty("--step-land", `${lx}px ${ly}px`);
    root.style.setProperty("--step-move", `${lx - fx}px, ${ly - fy}px`);
    root.style.setProperty("--step-back", `${fx - lx}px, ${fy - ly}px`);
    surface.focus({ preventScroll: true });
  });
  t.finished.finally(() => { root.classList.remove("stepping"); stepping = false; });
});

// Coming back with the Back button restores the page as it was left: put the view back.
addEventListener("pageshow", (e) => {
  if (!e.persisted || !leaving) return;
  leaving = false;
  removeEventListener("click", block, true);
  hopClear();
});
