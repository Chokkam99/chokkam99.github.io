// The touchdown: the end of every trip from the map, on the planet page it lands on. It
// picks up the flight's cruise and ends exactly on the window view: the scene draws the
// landscape the page's window shows, and the camera pushes in on the rocket's own round
// porthole until it sits exactly where the page's window is; the cabin and the window's ring
// dissolve in around it, the round window opens out into the page's shape, and the page
// takes over. Every move goes one way. A trip from the map plays it in the flight's own
// picture, straight on from the flight's last frame (space.js); a page loaded at the end of a
// trip plays it on its own (world.js). One pure timeline, t in ms, as in the design lab
// (design/flight/land-lab.js):
//   0..1300 the camera cranes down from the flight's chase as the planet becomes the horizon
//   | 900..1700 the flip, tail first, on puffs | 1650..2750 the braking burn, a long soft
//   descent | 2750 touchdown, dust, settle | 2900..3900 push in on the porthole, the rocket
//   falling into shadow so only its lit window shows | 3700..4000 the cabin dissolves in |
//   3950..4300 the window opens | 4300..4450 the page takes over | 4350..4650 the words.
//   Going on from the flight, the flight's last frame fades out over its first frames (0..90),
//   so what the two scenes draw differently (their stars, the rocket's lights) never changes
//   in a single frame; on its own, it fades in over the page's dark cover instead.
// Any tap or key ends it at once, on the page as it is.
import * as THREE from "../vendor/three/three.module.min.js";

// The shared rocket, at the build's version (see world.js).
const { ease, radialTexture, rocket, setThrust, puffSprites, setPuffs } = await import(`./rocket.js${new URL(import.meta.url).search}`);

const T = {
  intro: [0, 90], crane: [0, 1300], flip: [900, 1700], level: [1300, 1950], burn: 1650, land: 2750, settle: 2950,
  push: [2900, 3900], dissolve: [3700, 4000], open: [3950, 4300], handover: [4300, 4450], words: [4350, 4650],
};
// On its own, the page shows itself 3 s after it loaded (world.css): a touchdown that can't
// start well before then doesn't start.
const LATE = 2500;
const tooLate = () => performance.now() > LATE;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const loglerp = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
let seed = 7654321;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const landVert = "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }";
const landFrag = `
  uniform vec3 uUp; uniform float uSinDip; uniform vec3 uOC; uniform float uC2; uniform float uR; uniform float uRs;
  uniform float uMix; uniform float uF; uniform float uCrestG; uniform float uHg; uniform vec3 uFwdH;
  uniform vec3 uSky1; uniform vec3 uSky2; uniform vec3 uSky3; uniform vec3 uGFar; uniform vec3 uG; uniform vec3 uGDeep;
  uniform vec3 uTint; uniform vec3 uLine; uniform vec3 uBg; uniform vec3 uPlanet; uniform vec3 uAtmo; uniform vec3 uLight; uniform mat3 uObj; uniform float uSeed;
  uniform float uOpacity; uniform float uAtmoK; uniform float uLitK; uniform float uSunAt;
  uniform float uCurve; uniform vec2 uEll; uniform float uEyeX; uniform float uDpr;
  varying vec3 vW;
  float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  vec3 toLin(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
  float phi(float x){ return 1.0/(1.0 + exp(-1.702*x)); } // the normal CDF, closely
  void main(){
    vec3 rd = normalize(vW - cameraPosition);
    // The window's CSS, in pixels of the final frame: how far above (or below) the horizon
    // this ray would land on screen, measured straight up the screen like the CSS.
    float mu = dot(rd, uUp);
    vec3 h = rd - mu*uUp; float hl = length(h);
    float cosAz = hl > 1e-4 ? max(dot(h/hl, uFwdH), 0.2) : 1.0;
    float beta = asin(clamp(mu, -1.0, 1.0)) + asin(uSinDip);
    float px = uF * tan(clamp(beta, -1.45, 1.45)) / cosAz;
    // Once the camera is level, bend the line exactly as the window's CSS ellipse does.
    float dx = gl_FragCoord.x / uDpr - uEyeX;
    px += uCurve * uEll.y * (1.0 - sqrt(max(0.0, 1.0 - (dx*dx)/(uEll.x*uEll.x))));
    vec3 css;
    if (px < 0.0) {
      float d = -px;
      css = d < 160.0 ? mix(uGFar, uG, d/160.0) : mix(uG, uGDeep, clamp((d-160.0)/260.0, 0.0, 1.0));
    } else {
      float y = clamp((uCrestG - px)/uHg, 0.0, 1.0);
      css = y < 0.58 ? mix(uSky1, uSky2, y/0.58) : mix(uSky2, uSky3, (y-0.58)/0.42);
      css = mix(css, uTint, 0.24*phi((28.0 - px)/40.0));   // 0 -38px 80px -10px
      css = mix(css, uTint, 0.55*phi((6.0 - px)/13.0));    // 0 -10px 26px -4px
      css = mix(css, uLine, clamp(1.0 - px, 0.0, 1.0));    // the 1px rim
    }
    vec3 col = css;
    if (uMix < 0.999) {
      // Space: the planet as the flight drew it, ray-traced, with its atmosphere: the same
      // clouds and bands (in the planet's own frame, uObj, with its seed), and the glow added
      // on top in display space, as the flight's additive glow layer is.
      vec3 sp = toLin(uBg);
      vec3 glow = vec3(0.0);
      float b = dot(uOC, rd);
      float disc = b*b - uC2;
      vec3 L = normalize(uLight);
      if (disc >= 0.0 && b > 0.0) {
        float t = uC2 / (b + sqrt(disc));
        vec3 N = normalize(rd*t - uOC);
        vec3 O = uObj * N;
        float n = noise(O*2.5+uSeed)*0.6 + noise(O*6.0+uSeed*1.7)*0.4;
        float bands = sin((O.z + n*0.35)*11.0)*0.5+0.5;
        vec3 base = uPlanet * mix(0.68,1.12,bands) * mix(0.92,1.04,n);
        // Lit by the sun as near as the flight had it (uSunAt radii away): a little less than
        // half of it.
        float dl = dot(N, normalize(L * uSunAt - N)); float lit = smoothstep(-0.2, 0.8, dl);
        float rim = pow(1.0 - max(dot(N, -rd), 0.0), 2.6);
        sp = (base*(0.03+lit) + uAtmo*rim*(0.03+0.9*smoothstep(-0.35,0.45,dl))*uAtmoK) * uLitK;
      } else {
        float p = sqrt(max(dot(uOC,uOC) - b*b, 0.0));
        vec3 nn = normalize(rd*b - uOC);
        float a = pow(clamp((uRs - p)/(uRs - uR), 0.0, 1.0), 2.4) * smoothstep(-0.35, 0.6, dot(nn, L));
        glow = a * min(toSRGB(uAtmo*1.3*uAtmoK), 1.0); // capped, as the flight's glow is
      }
      col = mix(toSRGB(sp) + glow, css, uMix);
    }
    gl_FragColor = vec4(col, uOpacity);
  }`;

const CANVAS_STYLE = "position:fixed;inset:0;width:100vw;height:100vh;z-index:40;pointer-events:none;opacity:0";

// The touchdown's lighting environment: the rocket's reflections (the same for every planet).
function environment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0b0e24, side: THREE.BackSide })));
  const warm = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffbf5e }));
  warm.position.set(2, 6, 3);
  const cool = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), new THREE.MeshBasicMaterial({ color: 0x3a4f99 }));
  cool.position.set(-6, -4, 1);
  env.add(warm, cool);
  return new THREE.PMREMGenerator(renderer).fromScene(env, 0.04).texture;
}

// Between two of the flight's frames: once the next one is drawn and on screen, so what's done
// here never holds one up.
const slice = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
// Waits (`wait` between looks) until the renderer has made every shader these materials draw
// with; a lost GPU context ends the wait.
async function made(renderer, materials, wait) {
  while ([...materials].some((m) => !renderer.properties.get(m).currentProgram?.isReady())) {
    await wait();
    if (renderer.getContext().isContextLost()) throw new Error("context lost");
  }
}

// The touchdown's GPU work, done ahead in the map's own renderer while a planet's card is up
// (space.js), since the touchdown goes on to draw in it: its lighting environment, and every
// shader it draws with, compiled on a stand-in scene with the same kinds of materials and the
// same lights. A step at a time, between the map's frames.
let primed = null;
export function prime(renderer) {
  if (!primed) primed = { renderer, steps: primeSteps(renderer).catch(() => null) };
  return primed.steps;
}
async function primeSteps(renderer) {
  await slice();
  const env = environment(renderer);
  await slice();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.05, 6000);
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  const tex = radialTexture([[0, "rgba(255,255,255,1)"], [1, "rgba(255,255,255,0)"]]);
  const plane = new THREE.PlaneGeometry(1, 1);
  const points = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3)).setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
  const ship = rocket({ porthole: { w: 300, h: 360, r: 150, seal: 10, frame: 18, bolt: 7 } });
  puffSprites(ship);
  scene.add(
    ship,
    new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: landVert, fragmentShader: landFrag, uniforms: {}, side: THREE.BackSide })),
    new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: landVert, fragmentShader: landFrag, uniforms: {}, transparent: true })),
    new THREE.Points(points, new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true, map: tex, transparent: true })),
    new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })),
    new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true })),
    new THREE.DirectionalLight(), new THREE.DirectionalLight(), new THREE.HemisphereLight(),
  );
  // The stand-in's materials stay until the touchdown has compiled its own, which then find
  // their programs already made.
  const done = () => scene.traverse((o) => { o.geometry?.dispose(); [o.material].flat().forEach((m) => { m?.map?.dispose(); m?.dispose(); }); });
  await made(renderer, renderer.compile(scene, camera), slice);
  return { env, done };
}

// Builds the touchdown. A trip from the map hands it the flight's renderer (space.js), with
// the planet as the flight leaves it (its light, and its own frame and pattern seed) and the
// skip hint: it is built into that renderer a step at a time between the flight's frames,
// and resolves with its start, which the flight calls in the frame its timeline reaches it.
// On its own it plays at once, and resolves when the page has taken over (or the visitor
// skipped). Throws, with the page untouched, if it can't play or the flight was skipped.
export async function land({ renderer: flight = null, light = null, planet = null, sunAt = 0, hint: flightHint = null, cancelled = () => false } = {}) {
  const step = async () => {
    if (!flight) return;
    await slice();
    if (cancelled()) throw new Error("skipped");
  };
  // Measure only once the page's fonts have settled its layout (the header's height moves
  // the window).
  await document.fonts.ready;
  if (!flight && tooLate()) throw new Error("too late to land");
  scrollTo(0, 0);
  await step();

  // ---- the contract: the window's geometry and colors, read from the page itself

  const W = innerWidth, H = innerHeight;
  const phone = W < 768;
  const root = document.documentElement;
  const world = document.querySelector(".world");
  const porthole = world.querySelector(".porthole");
  const pcs = getComputedStyle(porthole);
  const pr = porthole.getBoundingClientRect();
  const bw = parseFloat(pcs.borderTopWidth);
  const glass = { x: pr.left + bw, y: pr.top + bw, w: pr.width - 2 * bw, h: pr.height - 2 * bw };
  const horizonEl = porthole.querySelector(".horizon-ground");
  const crest = horizonEl.getBoundingClientRect().top;
  // The CSS horizon is the top of a very wide ellipse: its gentle curve, in CSS px.
  const curve = (() => {
    const r = horizonEl.getBoundingClientRect();
    const v = getComputedStyle(horizonEl).borderTopLeftRadius.split(" ").pop();
    return { a: r.width / 2, b: v.endsWith("%") ? (parseFloat(v) / 100) * r.height : parseFloat(v) };
  })();
  const sunBox = porthole.querySelector(".sun").getBoundingClientRect();
  const eyeX = glass.x + glass.w / 2;
  // The colors the browser resolved (color-mix included), as sRGB 0..1.
  function cssColor(expr) {
    const probe = document.createElement("span");
    probe.style.color = expr;
    world.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const n = c.match(/-?[\d.]+(e-?\d+)?/g).map(Number);
    return new THREE.Vector3(...(c.startsWith("color(") ? n.slice(0, 3) : n.slice(0, 3).map((v) => v / 255)));
  }
  const C = {
    sky1: cssColor("var(--sky-1)"), sky2: cssColor("var(--sky-2)"), sky3: cssColor("var(--sky-3)"),
    gFar: cssColor("var(--ground-far)"), g: cssColor("var(--ground)"), gDeep: cssColor("var(--ground-deep)"),
    tint: cssColor("var(--c)"), line: cssColor("color-mix(in srgb, var(--c) 70%, #fff)"),
    cabin: getComputedStyle(world).getPropertyValue("--cabin").trim() || "#0b0d14",
  };
  // The flight's lens: 50 degrees tall on phones, longer on wide screens (as in the flight).
  const F = H / 2 / Math.tan(THREE.MathUtils.degToRad(phone ? 25 : 17));

  // ---- renderer and scene (on its own, this throws without WebGL, before the page is touched)

  const renderer = flight || new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const canvas = renderer.domElement;
  if (!flight) {
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = CANVAS_STYLE;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x070919, 1);
  }
  // Its environment and shaders, made ahead in the flight's renderer when they could be.
  const pre = flight && primed && primed.renderer === flight ? await primed.steps : null;
  const scene = new THREE.Scene();
  scene.environment = pre ? pre.env : environment(renderer);
  scene.environmentIntensity = 0.6;
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 6000);

  // The window, made from the page's own pieces (its frame with the bolts, its seal, its
  // glare) on the cabin wall. It first appears exactly over the rocket's porthole, which is
  // this window in miniature: the part of it the screen shows (when the window runs below
  // the fold, the porthole's bottom corners are below it too). Then it runs on to the
  // window's full length, below the fold, and the page underneath takes over.
  const R_GLASS = Math.min(glass.w / 2, glass.h / 2, parseFloat(getComputedStyle(porthole.querySelector(".seal")).borderTopLeftRadius) || glass.w / 2);
  const H_PORT = glass.y + glass.h <= H ? glass.h : Math.max(2 * R_GLASS, Math.min(glass.h, H - glass.y + R_GLASS));
  const px = (name) => parseFloat(pcs.getPropertyValue(name));
  const WIN = { frame: px("--frame"), seal: px("--seal"), bolt: px("--bolt") };
  const iris = document.createElement("div");
  iris.setAttribute("aria-hidden", "true");
  iris.style.cssText = "position:fixed;inset:0;z-index:41;pointer-events:none;display:none";
  const irisWin = document.createElement("div");
  irisWin.style.cssText = `position:absolute;--frame:${WIN.frame}px;--seal:${WIN.seal}px;--bolt:${WIN.bolt}px;` +
    `--crest:${pcs.getPropertyValue("--crest")};box-shadow:0 0 0 ${WIN.frame + 1}px rgb(0 0 0 / 0.7), 0 16px 34px ${WIN.frame}px rgb(0 0 0 / 0.6), 0 0 0 300vmax ${C.cabin}`;
  const glareBox = document.createElement("div");
  glareBox.style.cssText = "position:absolute;inset:0;border-radius:inherit;overflow:hidden";
  glareBox.append(porthole.querySelector(".glare").cloneNode(true));
  const irisFrame = porthole.querySelector(".frame").cloneNode(true);
  irisWin.append(irisFrame, glareBox, porthole.querySelector(".seal").cloneNode(true));
  iris.append(irisWin);
  irisWin.style.borderRadius = `${R_GLASS}px`;
  irisWin.style.setProperty("--win-r", `${R_GLASS}px`);
  irisWin.style.setProperty("--glass-r", `${R_GLASS}px`);
  irisFrame.style.borderRadius = `${R_GLASS + WIN.frame}px`;
  function placeIris(u) {
    Object.assign(irisWin.style, { left: `${glass.x}px`, top: `${glass.y}px`, width: `${glass.w}px`, height: `${lerp(H_PORT, glass.h, u)}px` });
  }
  // The skip hint, as on the map (the flight's own, going on from it): quiet, at the bottom,
  // gone before the window forms.
  const hint = flightHint || document.createElement("div");
  if (!flightHint) {
    hint.className = "trip-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = matchMedia("(pointer: coarse)").matches ? "Tap to skip" : "Click or press any key to skip";
  }
  // The page's own words, its stars and its far stones wait until the page has taken over.
  const words = [...document.querySelectorAll(".porthole-content, .nearby, .site-header > *, .sky-stars, .horizon-ruins")];

  // ---- the landscape: one shader for the sky dome and the porthole's glass. Far out it
  // ray-traces the planet as the flight drew it; near the ground it draws exactly what the
  // window's CSS draws: the sky gradient, the horizon's rim and glow, the ground gradient.

  // The planet's own frame and pattern seed as the flight drew it (space.js); without them,
  // its bands run round this world's y.
  const OBJ = planet && planet.length === 10 && planet.every(isFinite)
    ? { frame: new THREE.Matrix3().fromArray(planet.slice(0, 9)), seed: planet[9] }
    : { frame: new THREE.Matrix3().set(1, 0, 0, 0, 0, 1, 0, 1, 0), seed: 1.3 };
  const U = {
    uUp: { value: new THREE.Vector3(0, 0, 1) }, uSinDip: { value: 0 }, uOC: { value: new THREE.Vector3() }, uC2: { value: 0 },
    uR: { value: 1 }, uRs: { value: 1.22 }, uMix: { value: 0 }, uF: { value: F }, uCrestG: { value: crest - glass.y }, uHg: { value: glass.h },
    uFwdH: { value: new THREE.Vector3(0, 1, 0) }, uSky1: { value: C.sky1 }, uSky2: { value: C.sky2 }, uSky3: { value: C.sky3 },
    uGFar: { value: C.gFar }, uG: { value: C.g }, uGDeep: { value: C.gDeep }, uTint: { value: C.tint }, uLine: { value: C.line },
    uBg: { value: new THREE.Vector3(7 / 255, 9 / 255, 25 / 255) },
    uPlanet: { value: new THREE.Vector3() }, uAtmo: { value: new THREE.Vector3() }, uLight: { value: new THREE.Vector3(0.3, 0.5, 1) },
    uObj: { value: OBJ.frame }, uSeed: { value: OBJ.seed },
    uOpacity: { value: 1 }, uAtmoK: { value: 1 }, uLitK: { value: 1 }, uSunAt: { value: sunAt > 1 ? sunAt : 1e6 },
    uCurve: { value: 0 }, uEll: { value: new THREE.Vector2(curve.a, curve.b) }, uEyeX: { value: eyeX }, uDpr: { value: renderer.getPixelRatio() },
  };
  {
    const c = new THREE.Color().setRGB(C.tint.x, C.tint.y, C.tint.z, THREE.SRGBColorSpace);
    U.uPlanet.value.set(c.r, c.g, c.b);
    const a = c.clone().lerp(new THREE.Color(0xffffff), 0.35);
    U.uAtmo.value.set(a.r, a.g, a.b);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({ vertexShader: landVert, fragmentShader: landFrag, uniforms: U, side: THREE.BackSide, depthWrite: false, depthTest: false }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // Stars far out; they fade as the sky takes over.
  const starMap = radialTexture([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]]);
  function starLayer(count, size) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, R = 2000 + rand() * 2500, q = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * q * R, Math.sin(a) * q * R, u * R], i * 3);
      const b = 0.35 + Math.pow(rand(), 2.2) * 0.65, warm = rand() < 0.15;
      col.set(warm ? [b, b * 0.9, b * 0.78] : [b * 0.86, b * 0.9, b], i * 3);
    }
    return new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)).setAttribute("color", new THREE.BufferAttribute(col, 3)),
      new THREE.PointsMaterial({ size: size * renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true, map: starMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  }
  const stars = [starLayer(phone ? 380 : 600, 1.0), starLayer(phone ? 140 : 260, 1.6), starLayer(phone ? 48 : 100, 2.2)];
  scene.add(...stars);
  await step();

  // The sun, drawn like the window's CSS sun so the two are the same at the hand-over.
  const sunCss = sunBox.width;
  const sunSprite = (() => {
    const ext = sunCss + 56 * 2.2; // the disc and its widest glow
    const S = 256, k = S / ext;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const r = (sunCss / 2) * k;
    for (const [blur, a] of [[56, 0.18], [20, 0.55]]) {
      g.filter = `blur(${(blur / 2) * k}px)`;
      g.fillStyle = `rgba(255,196,110,${a})`;
      g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.fill();
    }
    g.filter = "none";
    const grad = g.createRadialGradient(S / 2 - r * 0.2, S / 2 - r * 0.28, 0, S / 2 - r * 0.2, S / 2 - r * 0.28, r * 1.25);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.38, "#ffeec2"); grad.addColorStop(1, "#ffbf5e");
    g.fillStyle = grad;
    g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.userData.ext = ext;
    return s;
  })();
  scene.add(sunSprite);

  await step();

  // Going on from the flight: the flight's last frame (copied on the GPU as it's drawn,
  // grab below), over everything, fading out. Its space is the canvas's own dark background
  // (space.js), showing through where the flight drew nothing.
  const lastFrame = flight ? new THREE.FramebufferTexture(...renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()) : null;
  const fromFlight = flight ? new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uMap: { value: lastFrame }, uBg: { value: U.uBg.value }, uOpacity: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uBg; uniform float uOpacity; varying vec2 vUv;
      void main(){ vec4 c = texture2D(uMap, vUv); gl_FragColor = vec4(c.rgb + uBg * (1.0 - c.a), uOpacity); }`,
    transparent: true, depthTest: false, depthWrite: false,
  })) : null;
  if (fromFlight) {
    fromFlight.frustumCulled = false;
    fromFlight.renderOrder = 100;
    scene.add(fromFlight);
  }

  // ---- the rocket, its shadow, the glow of its flame on the ground, the dust

  // The rocket's porthole is the page's window as the screen shows it, in miniature.
  const ship = rocket({ porthole: { w: glass.w, h: H_PORT, r: R_GLASS, seal: WIN.seal, frame: WIN.frame, bolt: WIN.bolt } });
  puffSprites(ship);
  scene.add(ship);
  // A portal over the porthole glass: it draws the landscape behind the rocket, so pushing in
  // through the porthole looks out at the same sky the window shows.
  const portal = new THREE.Mesh(new THREE.ShapeGeometry(ship.userData.port.userData.glassShape, 24), new THREE.ShaderMaterial({ vertexShader: landVert, fragmentShader: landFrag, uniforms: { ...U, uOpacity: { value: 0 } }, transparent: true }));
  portal.position.copy(ship.userData.glass.position).add(new THREE.Vector3(0, 0, 0.004));
  ship.userData.port.add(portal);

  const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
  const rimLight = new THREE.DirectionalLight(0xffd2a0, 1.6);
  const hemi = new THREE.HemisphereLight(0x8ea0ff, 0x10132e, 0.5);
  scene.add(key, key.target, rimLight, rimLight.target, hemi);

  const ground = (tex, size, blending = THREE.NormalBlending) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending, opacity: 0 }));
    m.position.z = 0.01;
    scene.add(m);
    return m;
  };
  const shadow = ground(radialTexture([[0, "rgba(0,0,0,0.75)"], [0.45, "rgba(0,0,0,0.4)"], [1, "rgba(0,0,0,0)"]]), 7);
  const flameGlow = ground(radialTexture([[0, "rgba(255,190,120,0.9)"], [0.3, "rgba(255,150,80,0.35)"], [1, "rgba(0,0,0,0)"]]), 16, THREE.AdditiveBlending);
  const dustTex = radialTexture([[0, "rgba(214,204,196,0.85)"], [0.4, "rgba(200,190,184,0.4)"], [1, "rgba(200,190,184,0)"]], 64, 64);
  const dust = [];
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.a = (i / 12) * Math.PI * 2 + rand() * 0.4;
    s.userData.v = 0.7 + rand() * 0.6;
    scene.add(s);
    dust.push(s);
  }

  // ---- poses. World: the landing site at the origin, +z up; the planet's centre at (0,0,-R).
  // The planet's radius grows instead of the rocket shrinking (the same picture, without
  // float trouble): its limb flattens into the horizon.

  // Upright, landed: nose up, the porthole facing the camera (-y).
  const qUp = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)));
  ship.quaternion.copy(qUp);
  ship.position.set(0, 0, 0);
  ship.updateMatrixWorld(true);
  const FOOT = -new THREE.Box3().setFromObject(ship.userData.body, true).min.z; // fin tips on z = 0
  const glassWorld = ship.userData.glass.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, FOOT));
  const EYE = glassWorld.z;
  const MID = 4.7; // the rocket's middle above its feet, for framing

  // The final camera: level, its eye on the porthole's centre line, the horizon at the crest.
  const D_SIDE = phone ? 34 : 40;
  const sunDir = new THREE.Vector3((sunBox.left + sunBox.width / 2 - eyeX) / F, 1, (crest - (sunBox.top + sunBox.height / 2)) / F).normalize();
  // The first light: the one the flight left the planet in, handed over in the rocket's own
  // frame (space.js), so the planet's glow goes on unchanged; it turns to this page's sun once
  // the planet is the horizon. The rocket starts nose down, porthole -y.
  const LIGHT0 = light && light.length === 3 && light.every(isFinite)
    ? new THREE.Vector3(light[1], -light[2], -light[0]).normalize()
    : new THREE.Vector3(0.3, -0.5, 1).normalize();

  // Feet above the ground: a steady fall toward the planet, then the braking burn takes the
  // speed off evenly to a soft touchdown (the speed matches where the two meet).
  const FALL = (() => {
    const brake = T.land - T.burn, v = 70 / (brake / 2 + T.burn);
    return { v, atBurn: (v * brake) / 2, c: v / (2 * brake) };
  })();
  function rocketAlt(t) {
    if (t < T.burn) return FALL.atBurn + FALL.v * (T.burn - t);
    return t < T.land ? FALL.c * (T.land - t) ** 2 : 0;
  }
  // How high the camera is, as a share of the planet's radius: 4.5 (the planet filling much
  // of the view, as the flight left it) down to almost nothing. The planet is round through
  // the chase, and its limb becomes the horizon while the camera cranes down. It starts
  // growing at the rate the flight leaves it growing at (space.js, nearAt: by 0.84 / 2350 of
  // its size a millisecond; its size goes as 1 / (4.5 + 1) here), and gathers speed.
  const GROW = 0.84 / 2350;
  function altRatio(t) {
    t = Math.max(t, 0);
    return 4.5 * Math.exp(-11.6 * Math.pow((t * (750 / T.crane[1])) / 1000, 1.87) - (5.5 / 4.5) * GROW * t * Math.exp(-t / 60));
  }

  // Camera rigs. Chase: the flight's chase on the porthole side, behind and above the falling
  // rocket, looking down at the planet ahead. Side: level, its eye on the porthole's centre
  // line once landed, a little below the rocket as it comes down. The crane between them
  // keeps world-up as up, so the picture never rolls.
  // Its side offset is far enough round that the fin behind the porthole shows as a fin, not
  // edge-on (less on wide screens, whose shorter view would crop the rocket); the flight's
  // chase ends on it (space.js, CHASE.sideEnd).
  const CHASE = new THREE.Vector3(phone ? 4 : 2.5, -6, 14).divideScalar(0.31);
  const CHASE_AIM = new THREE.Vector3(0, 1, -24).divideScalar(0.31);
  const sph = (v) => ({ r: v.length(), el: Math.asin(v.z / v.length()), az: Math.atan2(v.y, v.x) });
  const fromSph = (o) => new THREE.Vector3(Math.cos(o.el) * Math.cos(o.az), Math.cos(o.el) * Math.sin(o.az), Math.sin(o.el)).multiplyScalar(o.r);
  // At the crane's end the rocket's middle sits 12 degrees above the camera's eye line.
  const ALT_C = rocketAlt(T.crane[1]);
  const DROP = Math.tan(THREE.MathUtils.degToRad(12)) * D_SIDE;
  const K_CAM = (ALT_C + MID - DROP - EYE) / ALT_C; // the camera comes down at this share of the rocket's rate
  const CRANE_END = new THREE.Vector3(0, glassWorld.y - D_SIDE, -DROP);
  const S0 = sph(CHASE), S1 = sph(CRANE_END);
  // Where the push-in stops: the rocket's glass exactly on the page's window glass, so the
  // seal, frame and bolts line up with the page's. The porthole is the window scaled by k
  // (hull units per page pixel, and the rocket's own 0.85), so at this distance one page
  // pixel is one screen pixel; it is set at the seal's depth, which the eye reads as the
  // glass's edge. Its centre sits on the window's middle, its top on the window's top.
  const D_PUSH = F * ship.userData.port.userData.k * 0.85 + ship.userData.port.userData.sealAhead * 0.85;
  const Z_PUSH = glassWorld.z + ((glass.y + H_PORT / 2 - crest) / F) * (D_PUSH - ship.userData.port.userData.sealAhead * 0.85);
  const nlerp = (a, b, u) => a.clone().lerp(b, u).normalize();

  // ---- the pure timeline

  function state(t) {
    const st = {};
    const alt = rocketAlt(t);
    // It settles onto its fins: a small give, then still.
    const settle = t > T.land ? -0.05 * Math.sin(Math.PI * span(t, T.land, T.settle)) : 0;
    const pos = new THREE.Vector3(0, 0, alt + FOOT + settle);
    // The flip: nose-first to tail-first, turned on puffs, seen side-on from the camera.
    const flip = ease.inOut(span(t, ...T.flip));
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * (1 - flip)).multiply(qUp);
    // Engine: cruising, quiet for the flip, then the braking burn eases to a soft burn and
    // stops just after the feet touch.
    let power = 0.3 * (1 - span(t, T.flip[0] - 150, T.flip[0]));
    if (t >= T.burn - 60) power = 0.95 * ease.out(span(t, T.burn - 60, T.burn + 200)) * lerp(1, 0.42, ease.inOut(span(t, T.burn + 200, T.land))) * (1 - span(t, T.land, T.land + 220));
    st.ship = { pos, quat, power, puffs: [{ at: T.flip[0], dir: [-1, 0] }, { at: T.flip[1] - 60, dir: [1, 0] }] };

    const rc = pos.clone().add(new THREE.Vector3(0, 0, MID - FOOT));
    // A gentle ease, so the zoom never rushes in the middle.
    const push = 0.5 - 0.5 * Math.cos(Math.PI * span(t, ...T.push));
    // In log space, so the porthole grows at a steady rate instead of rushing at the end.
    const sideDist = loglerp(D_SIDE, D_PUSH, push);
    let camPos;
    if (t < T.crane[1]) {
      const w = ease.inOut(span(t, ...T.crane));
      camPos = rc.clone().add(fromSph({ r: lerp(S0.r, S1.r, w), el: lerp(S0.el, S1.el, w), az: lerp(S0.az, S1.az, w) }));
    } else {
      camPos = new THREE.Vector3(0, glassWorld.y - sideDist, lerp(EYE + K_CAM * alt, Z_PUSH, push));
    }
    // Aim: ahead at the planet, then onto the rocket as the crane starts, then level.
    const toAim = rc.clone().add(CHASE_AIM).sub(camPos).normalize();
    const toRocket = rc.clone().sub(camPos).normalize();
    const level = ease.smooth(span(t, ...T.level));
    const fwd = nlerp(nlerp(toAim, toRocket, ease.smooth(span(t, T.crane[0], T.crane[0] + 0.8 * T.crane[1]))), new THREE.Vector3(0, 1, 0), level);
    st.cam = { pos: camPos, look: camPos.clone().add(fwd), up: new THREE.Vector3(0, 0, 1), cx: lerp(W / 2, eyeX, level), cy: lerp(H / 2, crest, level), curve: level };
    st.R = Math.max(camPos.z, 1) / altRatio(t);
    // The flight's light holds while the planet is still a globe, and turns to this page's
    // sun once it has become the horizon.
    st.light = LIGHT0.clone().lerp(sunDir, ease.inOut(span(t, T.crane[1], T.land - 50))).normalize();
    st.portal = span(t, T.push[0] + 100, T.push[1] - 60);
    // As the camera closes in, the rocket falls into shadow: by the time its hull fills the
    // view it is nearly the cabin's dark, and only the lit window shows.
    st.shade = ease.inOut(span(t, T.push[0] + 250, T.push[1] - 50));
    st.hideShip = t >= T.dissolve[1];
    st.dust = span(t, T.land - 40, T.land + 760);
    st.dissolve = t < T.dissolve[0] ? -1 : ease.inOut(span(t, ...T.dissolve));
    st.open = ease.inOut(span(t, ...T.open));
    const intro = flight ? 1 : span(t, ...T.intro);
    st.overlay = intro * (1 - span(t, ...T.handover));
    // (Begun a frame back: that frame is the one on screen as this takes over.)
    st.fromFlight = 1 - span(t, -1000 / 60, T.intro[1]);
    st.words = ease.out(span(t, ...T.words));
    st.hint = intro * (1 - span(t, T.dissolve[0] - 250, T.dissolve[0]));
    return st;
  }

  // ---- apply a state

  function apply(s, t) {
    ship.visible = !s.hideShip;
    ship.position.copy(s.ship.pos);
    ship.quaternion.copy(s.ship.quat);
    ship.updateMatrixWorld();
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    const toShip = s.ship.pos.clone().sub(s.cam.pos).normalize();
    setThrust(ship, s.ship.power, t, THREE.MathUtils.smoothstep(Math.abs(axis.dot(toShip)), 0.75, 0.95), 1);
    setPuffs(ship, s.ship.puffs, t);
    ship.userData.halo.material.opacity = 0;
    portal.material.uniforms.uOpacity.value = s.portal;
    if (fromFlight) {
      fromFlight.visible = s.fromFlight > 0;
      fromFlight.material.uniforms.uOpacity.value = s.fromFlight;
    }

    // Camera with its principal point where the window wants the horizon.
    camera.position.copy(s.cam.pos);
    camera.up.copy(s.cam.up);
    camera.lookAt(s.cam.look);
    const cx = s.cam.cx, cy = s.cam.cy;
    const hw = Math.max(cx, W - cx), hh = Math.max(cy, H - cy);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(hh / F));
    camera.aspect = hw / hh;
    camera.setViewOffset(2 * hw, 2 * hh, hw - cx, hh - cy, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // The planet, seen from the camera. Altitude and the horizon's dip in double precision.
    const R = s.R;
    const oc = new THREE.Vector3(0, 0, -R).sub(camera.position);
    const h = Math.hypot(camera.position.x, camera.position.y, camera.position.z + R) - R;
    U.uUp.value.copy(oc).negate().normalize();
    U.uSinDip.value = Math.sqrt(Math.max(0, 1 - (R / (R + h)) ** 2));
    U.uOC.value.copy(oc);
    U.uC2.value = h * (2 * R + h);
    U.uR.value = R;
    U.uRs.value = R * 1.22;
    const q = h / R;
    const mix = THREE.MathUtils.smoothstep(-Math.log(q), -Math.log(0.7), -Math.log(0.02));
    U.uMix.value = mix;
    U.uCurve.value = s.cam.curve;
    // Entering the atmosphere: its glow and the day side fade as the window's dark sky and
    // ground take over.
    U.uAtmoK.value = THREE.MathUtils.smoothstep(q, 0.4, 1.5);
    U.uLitK.value = lerp(0.25, 1, THREE.MathUtils.smoothstep(q, 0.5, 4));
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const fh = fwd.clone().addScaledVector(U.uUp.value, -fwd.dot(U.uUp.value));
    if (fh.lengthSq() > 1e-6) U.uFwdH.value.copy(fh.normalize());
    U.uLight.value.copy(s.light);
    dome.position.copy(camera.position);
    dome.scale.setScalar(5000);
    stars.forEach((p) => { p.material.opacity = 1 - mix; p.position.copy(camera.position); });
    // The sun sits on its direction, sized like the window's CSS sun.
    sunSprite.position.copy(camera.position).addScaledVector(sunDir, 3000);
    sunSprite.scale.setScalar((sunSprite.userData.ext / F) * 3000);
    sunSprite.material.opacity = mix;

    // Lights: a soft key from the camera's side, the sun as a rim from behind; all fading as
    // the rocket falls into shadow at the end of the push.
    const lit = 1 - 0.94 * s.shade;
    key.intensity = 2.4 * lit;
    rimLight.intensity = 1.6 * lit;
    hemi.intensity = 0.5 * lit;
    scene.environmentIntensity = 0.6 * lit;
    key.position.copy(s.ship.pos).add(new THREE.Vector3(-14, -20, 18));
    key.target.position.copy(s.ship.pos);
    rimLight.position.copy(s.ship.pos).addScaledVector(s.light, 30);
    rimLight.target.position.copy(s.ship.pos);

    // Ground effects, only once there is ground to see.
    const alt = s.ship.pos.z - FOOT;
    const near = THREE.MathUtils.smoothstep(14 - alt, 0, 14) * mix;
    shadow.material.opacity = near * 0.9;
    shadow.scale.setScalar(lerp(1.6, 1, clamp01(1 - alt / 12)));
    shadow.scale.y *= 0.7;
    flameGlow.material.opacity = Math.min(1, s.ship.power * 1.2) * near;
    flameGlow.scale.setScalar(lerp(1.5, 0.8, clamp01(1 - alt / 10)));
    dust.forEach((d) => {
      const a = s.dust, k = ease.out(a);
      d.visible = a > 0 && a < 1;
      const r = 1.2 + 5.5 * k * d.userData.v;
      d.position.set(Math.cos(d.userData.a) * r, Math.sin(d.userData.a) * r * 0.9, 0.35 + 0.9 * k);
      d.scale.setScalar(1.4 + 3.2 * k);
      d.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, a * 1.6)) * (1 - a);
    });

    // The window ring closes in, then the page takes over. (In the flight's picture, the page
    // is left alone until the touchdown takes over from the flight.)
    if (!live) return;
    iris.style.display = s.dissolve < 0 || s.overlay <= 0 ? "none" : "block";
    if (s.dissolve >= 0) placeIris(s.open);
    canvas.style.opacity = s.overlay;
    iris.style.opacity = Math.max(0, s.dissolve) * s.overlay;
    words.forEach((el) => { el.style.opacity = s.words; });
    hint.style.opacity = s.hint;
  }

  // ---- play it

  let live = !flight;
  apply(state(0), 0);
  if (flight) {
    // Every shader made (most of them ahead, by prime), each without holding up a frame. Then
    // the first frame drawn into a single pixel of the flight's picture (its next frame covers
    // it), so the scene's textures and buffers are on the GPU before it takes over.
    await made(renderer, renderer.compile(scene, camera), step);
    pre?.done();
    await step();
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 1, 1);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    // Should this GPU not copy the flight's frames, the touchdown goes on without the fade.
    const gl = renderer.getContext();
    for (let i = 0; i < 8 && gl.getError(); i++);
    const size = new THREE.Vector2();
    const grab = () => {
      // At the picture's size now (a phone's address bar can slide in or out mid-flight).
      renderer.getDrawingBufferSize(size);
      if (size.x !== lastFrame.image.width || size.y !== lastFrame.image.height) {
        lastFrame.dispose();
        Object.assign(lastFrame.image, { width: size.x, height: size.y });
      }
      renderer.copyFramebufferToTexture(lastFrame);
    };
    grab();
    if (gl.getError() !== gl.NO_ERROR) fromFlight.removeFromParent();
    await step();
    return { start: play, grab };
  }
  // On its own: every shader compiled and the first frame drawn while the page is still dark,
  // so the trip starts on time.
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  if (tooLate()) {
    renderer.dispose();
    renderer.forceContextLoss();
    words.forEach((el) => { el.style.opacity = ""; });
    throw new Error("too late to land");
  }
  return play(null);

  // Plays it from t0 (the clock time of its t = 0; on its own, its first frame), its first
  // frame drawn now in the flight's picture (at the clock time `now`).
  function play(t0, now) {
    live = true;
    if (flight) {
      // The flight's picture goes on as the touchdown's: at this screen's size (should it have
      // changed since the flight began; drawn over at once), its clear color, its hint.
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== W || size.y !== H) renderer.setSize(W, H, false);
      renderer.setClearColor(0x070919, 1);
      hint.style.transition = "none";
      document.body.append(iris);
    } else {
      document.body.append(canvas, iris, hint);
    }
    return new Promise((resolve) => {
      let raf = 0, uncovered = false, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        removeEventListener("pointerdown", skip, true);
        removeEventListener("keydown", skip, true);
        removeEventListener("wheel", skip, true);
        removeEventListener("resize", resized);
        removeEventListener("pageswap", finish);
        canvas.remove();
        iris.remove();
        hint.remove();
        words.forEach((el) => { el.style.opacity = ""; });
        root.classList.remove("trip-land");
        // The GPU memory goes back once the page has painted without the scene.
        setTimeout(() => { renderer.dispose(); renderer.forceContextLoss(); }, 250);
        resolve();
      };
      // Skipping doesn't cut away: the scene holds its frame and rushes on into the window as it
      // fades, and the page's window and words come up from behind it.
      let skipping = false;
      function skip(e) {
        if (e.type === "keydown" && (e.metaKey || e.ctrlKey || e.altKey)) return;
        // The tap that skips is not also a click on whatever is under it.
        if (e.type === "pointerdown") {
          const swallow = (c) => { c.preventDefault(); c.stopPropagation(); };
          addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => removeEventListener("click", swallow, true), 800);
        }
        if (skipping || done) return;
        skipping = true;
        cancelAnimationFrame(raf);
        hint.remove();
        root.classList.remove("trip-land");
        const r = porthole.getBoundingClientRect();
        const origin = `${Math.round(r.left + r.width / 2)}px ${Math.round(r.top + Math.min(r.height, innerHeight) / 2)}px`;
        const away = [{ transform: "none", opacity: 1 }, { transform: "scale(1.14)", opacity: 0 }];
        const timing = { duration: 420, easing: "cubic-bezier(0.45, 0, 0.85, 0.55)", fill: "forwards" };
        for (const el of [canvas, iris]) { el.style.transformOrigin = origin; el.animate(away, timing); }
        words.forEach((el) => el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 1 }], { duration: 420, easing: "ease-out", fill: "forwards" }));
        setTimeout(() => { words.forEach((el) => el.getAnimations().forEach((a) => a.cancel())); finish(); }, 430);
      }
      addEventListener("pointerdown", skip, true);
      addEventListener("keydown", skip, true);
      addEventListener("wheel", skip, { capture: true, passive: true });
      // A new window size breaks the match with the page: show the page as it is. A phone's
      // address bar sliding in or out changes only the height, a little, and is let be. So
      // does leaving (the Back button), since a WebGL canvas comes out white in the picture
      // the browser takes of the page for the cross-fade.
      function resized() {
        if (innerWidth !== W || Math.abs(innerHeight - H) > H * 0.25) finish();
      }
      addEventListener("resize", resized);
      addEventListener("pageswap", finish);
      const frame = (now) => {
        if (t0 === null) t0 = now;
        const t = Math.max(0, now - t0);
        apply(state(t), t);
        renderer.render(scene, camera);
        // Out of the dark: once the scene covers the screen, the page's dark cover can go.
        if (!uncovered && t >= T.intro[1]) { uncovered = true; root.classList.remove("trip-land"); }
        if (t < T.words[1]) raf = requestAnimationFrame(frame);
        else finish();
      };
      if (flight) frame(now);
      else raf = requestAnimationFrame(frame);
    });
  }
}
