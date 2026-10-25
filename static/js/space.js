// The space layer on the home page: the map drawn in 3D, and the trip to a planet.
// Progressive enhancement only. The planets stay plain links; if anything here fails, or
// the browser can't or shouldn't animate, the static map is left exactly as it was.
//
// Each trip is one pure timeline, t in ms from the tap on a planet (every frame depends on
// t alone, as in the design lab, design/flight/flight-lab.js):
//   t < 0        parked by the sun, bobbing gently
//   0..700       the rocket turns to the planet on puffs of gas (it never banks) and edges
//                toward it while the card slides up
//   1000         Fly there
//   +0..350      the engine builds; +350..1000 lift-off while the camera swings in behind
//   +1000..3650  the cruise: a short warp (+1100..3600) with the near stars streaming past;
//                the planet ahead grows from a speck to fill much of the view (+3300) as
//                the camera swings round and the rocket drops out of warp in front of it
//                (+2300..3500, SETTLE). At +3650 (or once it is ready, on a slow connection)
//                the planet's page, readied in the background, takes this page's place
//                without a load, and its touchdown (landing.js) picks up from the flight's
//                last frame exactly.
//                Any tap or key goes straight there.

const galaxy = document.querySelector(".galaxy");
const V = new URL(import.meta.url).search; // the build's version, passed on to what this loads
const FLY = 1000; // Fly there, on the timeline
const HAND_OFF = 3650; // the trip reaches the planet page here (after FLY)
// The cruise's last stretch: the camera swings round to the touchdown's view while the rocket
// settles onto the planet, eases off its burn and the camera catches up with it.
const SETTLE = [2300, 3500];

function canRun() {
  if (!galaxy) return false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (navigator.connection && navigator.connection.saveData) return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* trips just don't carry over */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nothing to clear */ } },
};

if (canRun()) {
  const start = () => {
    Promise.all([
      import("../vendor/three/three.module.min.js"),
      import(`./rocket.js${V}`),
      fetch("/galaxy.json").then((r) => r.json()),
      import(`./swap.js${V}`),
    ]).then(([THREE, R, data, S]) => setup(THREE, R, data, S)).catch(() => {});
  };
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 300);
}

function setup(THREE, R, data, S) {
  const { ease, glow, rocket, setThrust, puffSprites, setPuffs } = R;
  store.del("trip");
  // Everything the map listens to on the page as a whole, ended in one go when a trip's
  // planet page takes this page's place.
  const life = new AbortController();
  const on = { signal: life.signal };
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `/static/css/space.css${V}`;
  document.head.appendChild(css);

  const info = Object.fromEntries(data.planets.map((p) => [p.url, p]));
  const phone = innerWidth < 768;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const span = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, u) => a + (b - a) * u;
  const loglerp = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
  const angleLerp = (a, b, u) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * u; };
  let seed = 1234567;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // The map's layout in the scene (see layout() below).
  const L = {};

  // ---- renderer and scene

  const canvas = document.createElement("canvas");
  canvas.className = "space-canvas";
  canvas.setAttribute("aria-hidden", "true");
  // Sized inline so the map never stretches while space.css is still loading.
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  galaxy.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0x070919, side: THREE.BackSide })));
    const warm = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffbf5e }));
    warm.position.set(-6, 3, 4);
    const cool = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), new THREE.MeshBasicMaterial({ color: 0x3a4f99 }));
    cool.position.set(6, -2, -3);
    env.add(warm, cool);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, 0.04).texture;
    scene.environmentIntensity = 0.6;
  }
  const FOV_MAP = 40;
  const camera = new THREE.PerspectiveCamera(FOV_MAP, 1, 0.1, 9000);
  const boxCam = new THREE.PerspectiveCamera(FOV_MAP, 1, 0.1, 9000);

  const hemi = new THREE.HemisphereLight(0x8ea0ff, 0x10132e, 0.55);
  const sunLight = new THREE.PointLight(0xffdcae, 3.2, 0, 0);
  const rim = new THREE.DirectionalLight(0xc8d4ff, 0);
  scene.add(hemi, sunLight, rim, rim.target);

  // The sun: white-hot at the centre, deep orange at the limb, with a fine granulation so
  // up close it reads as a star and not a lamp. Built at unit size and scaled to the map.
  const sun = new THREE.Group();
  const sunGlow = glow([[0, "rgba(255,242,214,0.9)"], [0.08, "rgba(255,236,190,0.8)"], [0.2, "rgba(255,196,110,0.28)"], [0.55, "rgba(255,170,90,0.06)"], [1, "rgba(0,0,0,0)"]], 4.2);
  const noise = `float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }`;
  const vert = "varying vec3 vN; varying vec3 vW; varying vec3 vObj; void main(){ vObj = normal; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }";
  sun.add(sunGlow, new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 32), new THREE.ShaderMaterial({
    uniforms: { uCore: { value: new THREE.Color(0xfff6e2) }, uEdge: { value: new THREE.Color(0xffa04a) } },
    vertexShader: vert,
    fragmentShader: `uniform vec3 uCore; uniform vec3 uEdge; varying vec3 vN; varying vec3 vW; varying vec3 vObj; ${noise}
      void main(){
        float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
        float g = noise(vObj*22.0)*0.6 + noise(vObj*48.0)*0.4;
        gl_FragColor = vec4(mix(uEdge * 0.8, uCore, pow(mu, 0.35)) * mix(0.93, 1.04, g), 1.0);
        #include <colorspace_fragment>
      }`,
  })));
  scene.add(sun);

  // Planets: bands, a soft terminator, an atmosphere on the lit limb. Unit spheres, scaled.
  const planetFragment = `uniform vec3 uColor; uniform vec3 uAtmo; uniform vec3 uLight; uniform float uSeed; uniform float uDim;
    varying vec3 vN; varying vec3 vW; varying vec3 vObj; ${noise}
    void main(){
      vec3 N = normalize(vN); vec3 L = normalize(uLight - vW); vec3 V = normalize(cameraPosition - vW);
      float n = noise(vObj*2.5+uSeed)*0.6 + noise(vObj*6.0+uSeed*1.7)*0.4;
      float bands = sin((vObj.z + n*0.35)*11.0)*0.5+0.5;
      vec3 base = uColor * mix(0.68,1.12,bands) * mix(0.92,1.04,n);
      float d = dot(N,L); float lit = smoothstep(-0.2,0.8,d);
      float rim = pow(1.0 - max(dot(N,V),0.0), 2.6);
      gl_FragColor = vec4((base*(0.03+lit) + uAtmo*rim*(0.03+0.9*smoothstep(-0.35,0.45,d)))*uDim, 1.0);
      #include <colorspace_fragment>
    }`;
  const atmoFragment = `uniform vec3 uAtmo; uniform vec3 uLight; uniform float uDim; uniform vec3 uCenter; uniform float uR; uniform float uRs;
    varying vec3 vN; varying vec3 vW; varying vec3 vObj;
    void main(){
      vec3 rd = normalize(vW - cameraPosition); vec3 oc = uCenter - cameraPosition;
      float tca = dot(oc, rd); float b = sqrt(max(dot(oc,oc) - tca*tca, 0.0));
      vec3 n = normalize(cameraPosition + rd*tca - uCenter);
      float a = pow(clamp((uRs - b)/(uRs - uR),0.0,1.0),2.4) * smoothstep(-0.35,0.6,dot(n, normalize(uLight - uCenter)));
      gl_FragColor = vec4(uAtmo*1.3*uDim, a);
      #include <colorspace_fragment>
    }`;
  // The orbits: lines on the map plane, one CSS pixel wide on the screen however near or far
  // (worked out in the shader, like the stars), in the colour of the map's own CSS orbits
  // (site.css .orbits): the same picture before and after the scene takes over.
  const orbitCss = getComputedStyle(galaxy.querySelector(".orbits ellipse")).stroke.match(/[\d.]+/g).map(Number);
  const ORBIT_ALPHA = orbitCss[3] ?? 1;
  const orbitMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color().setRGB(orbitCss[0] / 255, orbitCss[1] / 255, orbitCss[2] / 255, THREE.SRGBColorSpace) },
      uOpacity: { value: ORBIT_ALPHA }, uWidth: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
      uBox: { value: new THREE.Vector4() }, uEdge: { value: 0 },
    },
    vertexShader: `attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide;
      uniform vec2 uRes; uniform float uWidth; varying float vDist;
      void main(){
        vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec4 a = projectionMatrix * modelViewMatrix * vec4(aPrev, 1.0);
        vec4 b = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
        vDist = 0.0;
        if (a.w < 1.0 || b.w < 1.0 || c.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 px = uRes * 0.5, d = (b.xy / b.w - a.xy / a.w) * px;
        // Out across the line on the screen, a pixel past its edge for the antialiasing.
        vDist = aSide * (uWidth * 0.5 + 1.0);
        c.xy += normalize(vec2(-d.y, d.x)) * vDist / px * c.w;
        gl_Position = c;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uWidth; uniform vec4 uBox; uniform float uEdge; varying float vDist;
      void main(){
        // Near the map's edges they fade out (by uEdge), rather than stop dead where it ends.
        vec2 p = gl_FragCoord.xy;
        float inside = min(min(p.x - uBox.x, uBox.z - p.x), min(p.y - uBox.y, uBox.w - p.y));
        float edge = mix(1.0, smoothstep(0.0, 24.0 * uWidth, inside), uEdge);
        gl_FragColor = vec4(uColor, clamp(uWidth * 0.5 + 0.5 - abs(vDist), 0.0, 1.0) * uOpacity * edge);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const orbits = [];
  // An orbit's line: two vertices at each point of the ellipse, one either side, each knowing
  // the points before and after it.
  function orbitLine(points) {
    const n = points.length, at = (i) => points[(i + n) % n], pos = [], prev = [], next = [], side = [], index = [];
    for (let i = 0; i <= n; i++) {
      for (const sd of [-1, 1]) {
        pos.push(at(i).x, at(i).y, 0);
        prev.push(at(i - 1).x, at(i - 1).y, 0);
        next.push(at(i + 1).x, at(i + 1).y, 0);
        side.push(sd);
      }
      if (i < n) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aPrev", new THREE.Float32BufferAttribute(prev, 3));
    g.setAttribute("aNext", new THREE.Float32BufferAttribute(next, 3));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
    g.setIndex(index);
    return g;
  }
  const planets = [...galaxy.querySelectorAll(".planet")].map((li, i) => {
    const link = li.querySelector("a");
    const color = new THREE.Color(getComputedStyle(li).getPropertyValue("--c").trim() || "#ffffff");
    const u = { uColor: { value: color }, uAtmo: { value: color.clone().lerp(new THREE.Color(0xffffff), 0.35) },
      uLight: { value: sunLight.position }, uSeed: { value: i * 3.7 + 1.3 }, uDim: { value: 1 },
      uCenter: { value: new THREE.Vector3() }, uR: { value: 1 }, uRs: { value: 1.22 } };
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: planetFragment, uniforms: u })));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.22, 48, 24), new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: atmoFragment, uniforms: u, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    scene.add(group);
    return { li, link, group, u, home: new THREE.Vector3(), radius: 1, dim: 1 };
  });

  // Stars: crisp, antialiased discs worked out in the shader in screen pixels, each with its
  // own size, brightness and colour: the same small dots as the home page's sky (site.css),
  // on every screen and every GPU (a soft texture on a point a few pixels wide is averaged
  // away to almost nothing on some phones). aDot is a star's radius in CSS pixels and its
  // opacity.
  const starVert = `attribute vec3 aColor; attribute vec2 aDot; uniform float uPx; varying vec3 vColor; varying vec2 vDot; varying float vSize;
    void main(){ vColor = aColor; vDot = vec2(aDot.x * uPx, aDot.y); vSize = ceil(vDot.x * 2.0) + 2.0; gl_PointSize = vSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const starFrag = `uniform float uOpacity; varying vec3 vColor; varying vec2 vDot; varying float vSize;
    void main(){
      float d = length(gl_PointCoord - 0.5) * vSize;
      gl_FragColor = vec4(vColor, clamp(vDot.x - d + 0.5, 0.0, 1.0) * vDot.y * uOpacity);
      #include <colorspace_fragment>
    }`;
  function starLayer(stars) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(stars.flatMap((s) => s.pos), 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(stars.flatMap((s) => [s.color.r, s.color.g, s.color.b]), 3));
    g.setAttribute("aDot", new THREE.Float32BufferAttribute(stars.flatMap((s) => [s.r, s.a]), 2));
    const layer = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uPx: { value: renderer.getPixelRatio() }, uOpacity: { value: 0 } }, vertexShader: starVert, fragmentShader: starFrag, transparent: true, depthWrite: false }));
    layer.frustumCulled = false; // always in view
    return layer;
  }
  // The page's sky, read back from it (site.css --stars): each tile's size and its dots.
  const sky = [...getComputedStyle(document.body).getPropertyValue("--stars").matchAll(/url\("data:image\/svg\+xml,(.*?)"\)/g)].map(([, svg]) => {
    const el = new DOMParser().parseFromString(decodeURIComponent(svg), "image/svg+xml").documentElement;
    const dots = [...el.querySelectorAll("circle")].map((c) => ({ x: +c.getAttribute("cx"), y: +c.getAttribute("cy"), r: +c.getAttribute("r"), a: +c.getAttribute("opacity"), color: new THREE.Color(c.getAttribute("fill")) }));
    return { w: +el.getAttribute("width"), h: +el.getAttribute("height"), dots };
  });
  // Open space: a shell of stars all around, in the sky's mix (make-map-stars.py). It fades in
  // as the trip leaves the page's sky behind.
  const COOL = new THREE.Color("#e6ecff"), WARM = new THREE.Color("#fff1dc");
  const dot = () => { const k = rand(); return { r: k < 0.7 ? 0.5 : k < 0.93 ? 0.8 : 1.1, a: 0.45 + rand() ** 2.2 * 0.55, color: rand() < 0.15 ? WARM : COOL }; };
  const shell = () => { const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = 2000 + rand() * 2500, q = Math.sqrt(1 - u * u); return [Math.cos(a) * q * r, Math.sin(a) * q * r, u * r]; };
  const flightStars = starLayer(Array.from({ length: phone ? 570 : 960 }, () => ({ pos: shell(), ...dot() })));
  scene.add(flightStars);

  // The warp: a stream of near stars around the rocket, flowing back past it along its
  // path. Slow while it climbs, stretched into streaks rushing past the camera at full speed,
  // then slowing to points again as it drops out near the planet. Each star is a thin ribbon
  // drawn in screen space, bright at its head and fading toward the planet ahead.
  // A streak's length at full warp, in world units. Phones see the path more from above,
  // where long streaks run nearly parallel, so theirs are shorter.
  const WARP_LEN = phone ? 42 : 70;
  const STREAM = { back: 40, span: 420 }; // from just behind the camera to far ahead
  const streakGeo = new THREE.InstancedBufferGeometry();
  streakGeo.setAttribute("corner", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
  streakGeo.setIndex([0, 2, 1, 2, 3, 1]);
  {
    const count = phone ? 240 : 420;
    const pos = new Float32Array(count * 3), bright = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2, r = 16 + rand() * 112;
      pos.set([Math.cos(a) * r, Math.sin(a) * r, rand() * STREAM.span], i * 3);
      bright[i] = 0.35 + Math.pow(rand(), 2.2) * 0.65;
    }
    streakGeo.setAttribute("aPos", new THREE.InstancedBufferAttribute(pos, 3));
    streakGeo.setAttribute("aBright", new THREE.InstancedBufferAttribute(bright, 1));
    streakGeo.instanceCount = count;
  }
  const streakMat = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(1, 0, 0) }, uRight: { value: new THREE.Vector3(0, 1, 0) }, uUp: { value: new THREE.Vector3(0, 0, 1) },
      uShift: { value: 0 }, uSpan: { value: STREAM.span }, uBack: { value: STREAM.back },
      uLen: { value: 0 }, uWidth: { value: 1.3 }, uRes: { value: new THREE.Vector2(1, 1) }, uOpacity: { value: 0 },
    },
    vertexShader: `attribute vec2 corner; attribute vec3 aPos; attribute float aBright;
      uniform vec3 uCenter; uniform vec3 uAxis; uniform vec3 uRight; uniform vec3 uUp;
      uniform float uShift; uniform float uSpan; uniform float uBack;
      uniform float uLen; uniform float uWidth; uniform vec2 uRes;
      varying float vA; varying float vSide;
      void main(){
        // Each star flows back along the path and comes round again far ahead.
        float z = mod(aPos.z - uShift, uSpan) - uBack;
        vec3 head = uCenter + uAxis * z + uRight * aPos.x + uUp * aPos.y;
        vec4 h = projectionMatrix * viewMatrix * vec4(head, 1.0);
        vec4 t = projectionMatrix * viewMatrix * vec4(head + uAxis * uLen, 1.0);
        vA = 0.0; vSide = corner.y;
        if (h.w < 1.0 || t.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 hs = h.xy / h.w, ts = t.xy / t.w, px = uRes * 0.5;
        vec2 d = (ts - hs) * px; float l = length(d);
        vec2 along = l > 0.001 ? d / l : vec2(1.0, 0.0);
        vec2 across = vec2(-along.y, along.x);
        // The head reaches back half a width, so a streak at rest is a small round star.
        vec2 off = across * corner.y * uWidth * mix(1.0, 0.3, corner.x) - along * (1.0 - corner.x) * uWidth * 0.5;
        gl_Position = vec4(mix(hs, ts, corner.x) + off / px, mix(h.z / h.w, t.z / t.w, corner.x), 1.0);
        // Stars come in softly at the far end of the stream.
        float far = 1.0 - smoothstep(uSpan - uBack - 140.0, uSpan - uBack, z);
        vA = aBright * pow(1.0 - corner.x, 1.4) * far;
      }`,
    fragmentShader: `uniform float uOpacity; varying float vA; varying float vSide;
      void main(){
        float edge = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
        gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * vA * edge * uOpacity, 1.0);
        #include <colorspace_fragment>
        // Light, added over whatever is behind (premultiplied): it covers only as much as it
        // lights, so a streak's dark edges, or all of it while it's faded out, leave the
        // page behind alone instead of painting it black.
        gl_FragColor.a = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
  });
  const stream = new THREE.Mesh(streakGeo, streakMat);
  stream.frustumCulled = false;
  scene.add(stream);
  // The warp on the trip's timeline (ms after Fly there): it builds as the rocket reaches full
  // speed, holds through the cruise, and fades as it drops out right in front of the planet.
  const WARP = { up: [1100, 1600], down: [3100, 3600] };
  const sstep = (u) => u * u * (3 - 2 * u);
  const warpAt = (tau) => sstep(span(tau, ...WARP.up)) * (1 - sstep(span(tau, ...WARP.down)));
  // How far the stars have streamed back past the rocket, in world units: a slow drift, plus
  // the warp's speed added up over time (a smoothstep adds up to u^3 - u^4 / 2).
  const ramp = (u) => u * u * u - (u * u * u * u) / 2;
  const warpSum = (tau) => {
    const [a, b] = WARP.up, [c, d] = WARP.down;
    if (tau <= a) return 0;
    if (tau <= b) return (b - a) * ramp(span(tau, a, b));
    if (tau <= c) return (b - a) / 2 + tau - b;
    const u = span(tau, c, d);
    return (b - a) / 2 + c - b + (d - c) * (u - ramp(u));
  };
  const streamAt = (tau) => 0.05 * Math.max(0, tau - 350) + 0.42 * warpSum(tau);

  // The rocket's porthole is a miniature of the planet page's window (world.css), worked out
  // from this screen: the same width, corners, seal, frame and bolts, and the part of it the
  // screen shows (its bottom corners below the fold). The touchdown builds it from the page.
  const pageWindow = (() => {
    const frame = phone ? 12 : 24;
    const w = (phone ? innerWidth - 12 : Math.min(0.94 * innerWidth, 1088)) - 2 * frame;
    const r = phone ? Math.min(178, w / 2) : Math.min(0.3 * w, 0.5 * (innerHeight - 4.4 * 16 - 64) - frame - 8);
    const top = (document.querySelector(".site-header")?.getBoundingClientRect().bottom || 70) + (phone ? 12 : 20) + frame;
    return { w, h: Math.max(2 * r, innerHeight - top + r), r, seal: phone ? 7 : 15, frame, bolt: phone ? 6 : 9 };
  })();
  const ship = rocket({ porthole: pageWindow });
  puffSprites(ship);
  scene.add(ship);
  const MAP_SCALE = phone ? 4.2 : 4.6;
  const REST_PITCH = 0.35;
  const CHASE_SCALE = 0.31;
  // Wide screens sit the camera further to the side, so the rocket and the planet separate
  // across the frame instead of stacking. Round the end of the flight every screen eases to
  // the touchdown's side offset (sideEnd).
  const CHASE = { back: 14, up: 6, side: phone ? 1.4 : 4.5, sideEnd: phone ? -4 : -2.5, aim: -1 };
  const MID = -0.74; // where the touchdown's camera aims on the rocket, along its nose (model units)
  // The planet as the touchdown first shows it (landing.js at t = 0), in the rocket's own
  // units: its radius, and how far its centre lies ahead along the nose. The flight ends on
  // exactly this, so the two pictures match. They change together with landing.js's fall
  // (70 up at the start), its camera (CHASE) and its first altitude ratio (4.5).
  const TOUCHDOWN_PLANET = { r: 26.64, at: 102.08 };
  const UP = new THREE.Vector3(0, 0, 1);
  const Z = UP;
  const AZ0 = Math.PI / 2;
  const TAU = Math.PI * 2;

  // ---- layout: the 3D map sits exactly over the HTML map, so the labels and the static
  // map line up with it; it is redone when the map changes size.

  const toWorld = (r) => new THREE.Vector3(r.left + r.width / 2 - L.box.left - L.W / 2, L.H / 2 - (r.top + r.height / 2 - L.box.top), 0);
  function layout() {
    // Measure the labels where the map puts them, not where the camera last carried them
    // (the next frame moves them again if it needs to).
    for (const el of [starLink, ...planets.map((p) => p.li)]) el.style.left = el.style.top = "";
    L.box = galaxy.getBoundingClientRect();
    L.W = L.box.width;
    L.H = L.box.height;
    L.D = L.H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV_MAP / 2));
    renderer.setSize(L.W, L.H, false);
    fitLines();
    const sunRect = galaxy.querySelector(".home-star .dot").getBoundingClientRect();
    L.sunPos = toWorld(sunRect);
    L.sunR = sunRect.width / 2;
    sun.position.copy(L.sunPos);
    sun.scale.setScalar(sunRect.width);
    sunLight.position.copy(L.sunPos).setZ(60);
    for (const p of planets) {
      const r = p.li.querySelector(".dot").getBoundingClientRect();
      p.home.copy(toWorld(r));
      p.radius = r.width / 2;
      p.group.position.copy(p.home);
      p.group.scale.setScalar(p.radius);
      p.u.uCenter.value.copy(p.home);
      p.u.uR.value = p.radius;
      p.u.uRs.value = p.radius * 1.22;
    }
    // The orbits the map shows at this size (site.css shows one set), as the scene's lines:
    // the same ellipses, the sun at a focus, stretched to the map.
    for (const o of orbits.splice(0)) {
      scene.remove(o);
      o.geometry.dispose();
    }
    for (const el of galaxy.querySelectorAll(".orbits ellipse")) {
      if (getComputedStyle(el.parentNode).display === "none") continue;
      const a = +el.dataset.a, e = +el.dataset.e, w = THREE.MathUtils.degToRad(+el.dataset.w), points = [];
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * TAU, r = (a * (1 - e * e)) / (1 + e * Math.cos(t - w));
        points.push(new THREE.Vector2((r * Math.cos(t) * L.W) / 2, (-r * Math.sin(t) * L.H) / 2));
      }
      const o = new THREE.Mesh(orbitLine(points), orbitMat);
      o.frustumCulled = false;
      orbits.push(o);
      scene.add(o);
    }
    // Where the rocket waits, beside the sun. On phones it parks above it: no planet lies on the
    // far side of the sun from there (the map's phone slots keep that side for About me), so
    // the sun is never in the line of flight.
    const off = phone
      ? new THREE.Vector3(sunRect.width * 0.64, sunRect.width * 1.75, 8)
      : new THREE.Vector3(-sunRect.width * 1.5, sunRect.width * 1.1, 8);
    L.parked = L.sunPos.clone().add(off);
    L.parkedHeading = Math.atan2(off.y, off.x) - Math.PI / 2; // along the orbit
    // Where the parked rocket sits on the map (its middle, and a radius that covers it), so
    // the skill lens can draw its lines behind it (skills.js).
    const mid = L.parked.clone().add(new THREE.Vector3(Math.cos(L.parkedHeading), Math.sin(L.parkedHeading), 0).multiplyScalar(0.95 * MAP_SCALE));
    galaxy.dataset.rocket = `${(mid.x + L.W / 2).toFixed(1)} ${(L.H / 2 - mid.y).toFixed(1)} ${(4.9 * MAP_SCALE).toFixed(1)}`;
    L.restRig = rig(new THREE.Vector3(), new THREE.Vector3(), AZ0, Math.PI / 2, L.D);
    // The flight's view: 50 degrees tall on phones, a longer lens on wide screens so the
    // rocket holds the frame.
    L.fovEnd = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(phone ? 25 : 17)) * L.H / innerHeight));
  }

  // ---- camera: an orbit rig around a focus point. Facing angle (az), height angle (el),
  // distance, and the point it looks at. Blending these (angles on the short arc, distance
  // in log space) makes the camera arc around the rocket; it never rolls the world.
  const unwrap = (a, near) => a + TAU * Math.round((near - a) / TAU);
  function rig(focus, look, az, el, dist) { return { focus, look, az, el, dist }; }
  function blendRig(a, b, u, uLook = u, uAz = u) {
    return rig(a.focus.clone().lerp(b.focus, u), a.look.clone().lerp(b.look, uLook), lerp(a.az, b.az, uAz), lerp(a.el, b.el, u), loglerp(a.dist, b.dist, u));
  }
  function rigCamera(r) {
    const h = new THREE.Vector3(Math.cos(r.az), Math.sin(r.az), 0);
    const pos = r.focus.clone().addScaledVector(h, -Math.cos(r.el) * r.dist).addScaledVector(Z, Math.sin(r.el) * r.dist);
    const f = r.look.clone().sub(pos).normalize();
    let right = new THREE.Vector3().crossVectors(f, Z);
    if (right.lengthSq() < 1e-6) right = new THREE.Vector3().crossVectors(h, Z);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f.clone().negate())) };
  }

  // ---- a trip to one planet: its path and its timeline

  // The approach (0..700) runs from a pose (where the rocket is, its heading, the camera and
  // the card) to the planet's stop. It starts parked unless `from` says otherwise (another
  // planet chosen while the card is up: it glides straight over), and ends at the stop
  // unless `stop` says otherwise (closing the card plays an approach that ends where the
  // rocket is, backwards).
  function plan(target, from = null, stop = null) {
    const parked = L.parked, parkedHeading = L.parkedHeading;
    const toTarget = target.home.clone().sub(parked).setZ(0);
    const dist = toTarget.length();
    const dir = toTarget.clone().normalize();
    const heading = Math.atan2(dir.y, dir.x);
    const yaw0 = from ? from.yaw : parkedHeading, yaw1 = stop ? stop.yaw : heading;
    const turnSign = Math.sign(angleLerp(yaw0, yaw1, 1) - yaw0) || 1;
    // The rocket never crosses the sun: where it stops for the card, and the first leg of
    // its climb, keep a clear ring around it (the sun's glow plus half the rocket), and the
    // move to that stop bows round the sun when the planet is on its far side.
    const ring = L.sunR * 1.7 + 26 * (MAP_SCALE / 4.2);
    const clearOfSun = (p, k = 1) => {
      const v = p.clone().sub(L.sunPos).setZ(0);
      if (v.length() >= ring * k) return p;
      if (v.lengthSq() < 1e-6) v.set(-dir.y, dir.x, 0);
      return L.sunPos.clone().add(v.setLength(ring * k)).setZ(p.z);
    };
    const approachPos = clearOfSun(parked.clone().addScaledVector(dir, dist * 0.16));
    // In flight the planet's size on screen is set directly. Once the camera is behind the
    // rocket it is a speck far ahead (400 radii); it grows steadily all through the warp
    // and reaches its full size as the warp dies away, then holds it. Out in space it takes
    // the touchdown's radius (it is out of sight while it changes, as the camera swings in
    // behind the rocket) and ends where the touchdown has it, so the planet is the same on
    // both sides of the page change. Even steps in 1 / distance make even steps in size.
    const flightR = TOUCHDOWN_PLANET.r * CHASE_SCALE;
    const camFrom = (d) => Math.sqrt((d + CHASE.back) ** 2 + CHASE.up ** 2 + CHASE.sideEnd ** 2);
    const nearEnd = TOUCHDOWN_PLANET.at * CHASE_SCALE;
    const nearAt = (tau) => {
      const x = 1 - (1 - span(tau, 1300, 3300)) ** 1.4;
      const inv = lerp(1 / camFrom(flightR * 400), 1 / camFrom(nearEnd), x);
      // Back from distance-to-camera to distance ahead of the rocket.
      return Math.sqrt(Math.max(0, 1 / inv ** 2 - CHASE.up ** 2 - CHASE.sideEnd ** 2)) - CHASE.back;
    };
    const p0 = from ? from.pos : parked, p1 = stop ? stop.pos : approachPos;
    const approachVia = clearOfSun(p0.clone().lerp(p1, 0.5), 1.08);
    const approachAt = (u) => { const a = 1 - u; return p0.clone().multiplyScalar(a * a).addScaledVector(approachVia, 2 * a * u).addScaledVector(p1, u * u); };
    // The path: stand up and climb off the map plane, then fly toward the planet high above
    // the plane (well clear of the sun), descending gently as it nears.
    const flightEnd = target.home.clone().addScaledVector(dir, -target.radius * 2.2).add(new THREE.Vector3(0, 0, target.radius * 0.35));
    const B0 = approachPos.clone();
    const B1 = clearOfSun(approachPos.clone().addScaledVector(dir, dist * 0.08)).addScaledVector(UP, 46);
    const B2 = flightEnd.clone().addScaledVector(UP, 26).addScaledVector(dir, -dist * 0.18);
    const B3 = flightEnd.clone();
    const bez = (u) => { const a = 1 - u; return B0.clone().multiplyScalar(a * a * a).addScaledVector(B1, 3 * a * a * u).addScaledVector(B2, 3 * a * u * u).addScaledVector(B3, u * u * u); };
    const arc = (() => {
      const n = 240, len = [0];
      let prev = bez(0);
      for (let i = 1; i <= n; i++) { const p = bez(i / n); len.push(len[i - 1] + p.distanceTo(prev)); prev = p; }
      return len.map((l) => l / len[n]);
    })();
    const uAt = (f) => {
      if (f <= 0) return 0;
      if (f >= 1) return 1;
      let lo = 0, hi = arc.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid] < f) lo = mid; else hi = mid; }
      return (lo + (f - arc[lo]) / (arc[hi] - arc[lo])) / (arc.length - 1);
    };
    const along = (f) => bez(uAt(f));
    const bezTan = (u) => { const a = 1 - u; return B1.clone().sub(B0).multiplyScalar(3 * a * a).addScaledVector(B2.clone().sub(B1), 6 * a * u).addScaledVector(B3.clone().sub(B2), 3 * u * u).normalize(); };
    // Travel along the path, 0..1: still through the anticipation, eased in through lift-off,
    // then a long cruise that starts at lift-off's speed and settles to a slow, steady
    // approach, so the planet grows gently ahead through the warp. In the last stretch the
    // warp carries the rocket in, and the planet rushes up to fill the view.
    const travel = (tau) => {
      if (tau <= 350) return 0;
      if (tau <= 1000) return 0.2 * ((tau - 350) / 650) ** 2;
      const x = tau - 1000;
      return 0.2 + 0.339 * (1 - Math.exp(-x / 600)) + 0.00005 * x;
    };
    // The camera orbits from the map view to behind the rocket, the way round that keeps it
    // away from the sun.
    const swing = (() => {
      const short = ((((heading - AZ0 + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
      const other = short > 0 ? short - TAU : short + TAU;
      const toSun = L.sunPos.clone().sub(parked).setZ(0).normalize();
      const score = (d) => { const m = AZ0 + d * 0.5; return -(Math.cos(m) * toSun.x + Math.sin(m) * toSun.y); };
      return score(short) <= score(other) ? short : other;
    })();
    const approachLook = approachPos.clone().lerp(target.home, 0.5).multiplyScalar(0.22);
    const approachRig = rig(approachLook, approachLook, AZ0, THREE.MathUtils.degToRad(84), L.D * 0.9);
    const launchRig = (p, s) => rig(p.clone(), p.clone(), AZ0 + swing * 0.7, THREE.MathUtils.degToRad(30), (phone ? 34 : 26) * s);
    const aim = target.home.clone().add(new THREE.Vector3(0, 0, target.radius * 0.3));
    // The chase can swing round the line of travel by `turn` (radians): at PI the camera
    // rides behind and below the rocket, the touchdown's opening view (landing.js), so the
    // rocket and planet sit the same way on both sides of the page change.
    const chaseRig = (p, s, turn = 0) => {
      const k = s / CHASE_SCALE;
      const fwd = aim.clone().sub(p).normalize();
      const side = new THREE.Vector3().crossVectors(fwd, Z).normalize();
      const upP = new THREE.Vector3().crossVectors(side, fwd).normalize();
      // Passing the side, it closes in on the line of travel, so the rocket stays in a narrow
      // (phone) frame.
      const c = Math.cos(turn), sn = Math.sin(turn), near = 1 - 0.65 * sn * sn;
      const across = (a, b) => upP.clone().multiplyScalar((a * c - b * sn) * near).addScaledVector(side, (a * sn + b * c) * near);
      // Round to the touchdown's view, the side offset eases to its (phone-sized) one too.
      const sideOff = lerp(CHASE.side, CHASE.sideEnd, turn / Math.PI);
      const v = fwd.clone().multiplyScalar(-CHASE.back * k).add(across(CHASE.up * k, sideOff * k));
      const d = v.length();
      const mid = p.clone().addScaledVector(fwd, MID * s);
      return rig(mid, mid.clone().addScaledVector(fwd, 24 * k).add(across(CHASE.aim * k, 0)), unwrap(Math.atan2(-v.y, -v.x), AZ0 + swing), Math.asin(v.z / d), d);
    };

    return function state(t, clock) {
      const st = { full: false, labels: 1, card: 0, offset: 0, cover: 0, warp: 0, shift: 0, flow: dir, target, dir, planetPos: null, planetShow: 1 };
      const bob = Math.sin(clock * 0.0021) * 2.8;
      let pos = parked.clone().add(new THREE.Vector3(0, bob, 0));
      let yaw = parkedHeading + Math.sin(clock * 0.0017) * 0.03;
      let pitch = -REST_PITCH, roll = 0, scale = MAP_SCALE, power = 0;
      st.rig = L.restRig;
      let cam = rigCamera(L.restRig);
      let mapFade = 1, halo = 1;
      const puffs = [];
      if (t >= 0) {
        const turn = ease.inOut(span(t, 0, 480));
        const move = ease.inOut(span(t, 140, 700));
        yaw = angleLerp(yaw0, yaw1, turn);
        puffs.push({ at: 10, dir: [-turnSign, 0] }, { at: 390, dir: [turnSign, 0] });
        pos = approachAt(move).add(new THREE.Vector3(0, from ? 0 : bob * (1 - move), 0));
        power = from ? 0.28 : 0.28 * ease.out(span(t, 120, 600));
        st.rig = blendRig(from ? from.rig : L.restRig, stop ? stop.rig : approachRig, ease.inOut(span(t, 0, 700)));
        cam = rigCamera(st.rig);
        st.card = lerp(from ? from.card : 0, stop ? stop.card : 1, from ? ease.out(span(t, 0, 300)) : ease.out(span(t, 150, 450)));
      }
      if (t >= FLY) {
        const tau = t - FLY;
        st.full = true;
        // Space darkens over the page, the card and the labels together.
        st.cover = ease.inOut(span(tau, 0, 300));
        st.card = tau < 300 ? 1 : 0;
        st.labels = tau < 300 ? 1 : 0;
        // Full power through the cruise, eased back to the touchdown's cruising burn as the
        // rocket drops out of warp.
        power = lerp(lerp(0.28, 1.0, ease.out(span(tau, 0, 350))), 0.3, ease.inOut(span(tau, ...SETTLE)));
        // It eases back a touch and dips its nose, then pushes off.
        const settle = Math.sin(Math.PI * span(tau, 60, 380)) * 0.8;
        const dip = Math.sin(Math.PI * span(tau, 150, 450)) * 0.12;
        const back = (p) => p.addScaledVector(dir, (-settle * 3 * MAP_SCALE) / 4.2);
        const u = travel(tau);
        pos = back(along(u));
        // The nose follows the path: it stands up for the climb, then pitches over.
        const tan = bezTan(Math.max(uAt(u), 0.002));
        const pathPitch = Math.atan2(tan.z, Math.hypot(tan.x, tan.y));
        const raise = ease.inOut(span(tau, 120, 520));
        yaw = angleLerp(heading, Math.atan2(tan.y, tan.x), raise);
        const cruisePitch = Math.max(pathPitch, THREE.MathUtils.degToRad(-10));
        const climbPitch = Math.min(pathPitch, THREE.MathUtils.degToRad(55));
        pitch = -lerp(REST_PITCH, lerp(climbPitch, cruisePitch, span(tau, 900, 1300)), raise) + dip;
        // Close in on the rocket as it climbs, then swing round behind it as it pitches
        // over; it shrinks to cruise size as the camera closes in, so it holds its size.
        const w = ease.smooth(span(tau, 550, 1400));
        scale = loglerp(MAP_SCALE, CHASE_SCALE, w);
        // The camera trails the rocket a little through the cruise, and catches up with it as
        // it swings round, so the last frame is the touchdown's first.
        const lagPos = back(along(travel(Math.max(0, tau - 110 * span(tau, 900, 1500) * (1 - span(tau, ...SETTLE))))));
        const camRig = blendRig(blendRig(approachRig, launchRig(lagPos, scale), ease.smooth(span(tau, 0, 900))), chaseRig(lagPos, scale, Math.PI * ease.inOut(span(tau, ...SETTLE))), w, ease.smooth(span(w, 0.3, 1)), lerp(w, ease.out(w), 0.6));
        cam = rigCamera(camRig);
        st.offset = ease.inOut(span(tau, 250, 900));
        st.warp = warpAt(tau);
        // The planet slips out of sight as the camera swings in behind the rocket and comes
        // back straight ahead, small and far, then grows through the warp (nearAt above).
        st.planetShow = tau < 900 ? 1 - ease.inOut(span(tau, 450, 850)) : ease.inOut(span(tau, 950, 1400));
        if (tau >= 900) {
          st.planetPos = lagPos.clone().addScaledVector(aim.clone().sub(lagPos).normalize(), nearAt(tau));
          st.planetR = flightR;
        }
        st.shift = streamAt(tau);
        st.flow = tan;
        // It rolls over as it climbs (its porthole turns away from the camera above, so the
        // warp shows its clean back), and as the camera swings round below it the nose
        // settles onto the planet's centre: the touchdown's opening pose, porthole in view.
        roll = Math.PI * ease.inOut(span(tau, 450, 1300));
        const toPlanet = aim.clone().sub(lagPos).normalize(), onPlanet = ease.inOut(span(tau, ...SETTLE));
        yaw = angleLerp(yaw, Math.atan2(toPlanet.y, toPlanet.x), onPlanet);
        pitch = lerp(pitch, -Math.atan2(toPlanet.z, Math.hypot(toPlanet.x, toPlanet.y)), onPlanet);
        // The camera's up eases from the map's up to the rocket's tail, which is the
        // touchdown's up: the same picture, not rolled, on both sides of the page change.
        if (onPlanet > 0) {
          const tail = new THREE.Vector3(-Math.cos(pitch) * Math.cos(yaw), -Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch));
          const m = new THREE.Matrix4().lookAt(cam.pos, camRig.look, tail);
          cam.quat.slerp(new THREE.Quaternion().setFromRotationMatrix(m), onPlanet);
        }
        // Through the long cruise the rocket rides the warp a little, never quite still.
        const side = new THREE.Vector3().crossVectors(tan, Z).normalize();
        const lift = new THREE.Vector3().crossVectors(side, tan);
        pos.addScaledVector(side, Math.sin(tau * 0.0017) * 0.32 * st.warp).addScaledVector(lift, Math.sin(tau * 0.0026 + 1.3) * 0.22 * st.warp);
        mapFade = 1 - ease.inOut(span(tau, 450, 1100));
        halo = 1 - span(tau, 0, 400);
      }
      st.ship = { pos, yaw, pitch, roll, scale, power, puffs };
      st.cam = cam;
      st.mapFade = mapFade;
      st.halo = halo;
      return st;
    };
  }

  // ---- the card: the planet's name, its line, and Fly there

  const card = document.createElement("div");
  card.className = "space-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "space-card-title");
  card.innerHTML = '<h2 id="space-card-title"></h2><p class="space-card-tagline"></p>' +
    '<div class="space-card-actions"><a class="space-land">Fly there</a></div>' +
    '<button type="button" class="space-close">Back to the map</button>';
  document.body.appendChild(card);
  const flyLink = card.querySelector(".space-land");
  const hint = document.createElement("div");
  hint.className = "trip-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = matchMedia("(pointer: coarse)").matches ? "Tap to skip" : "Click or press any key to skip";
  document.body.appendChild(hint);
  // A cover for the scene when the page is left mid-trip (see pageswap).
  const dark = document.createElement("div");
  dark.className = "space-dark";
  dark.setAttribute("aria-hidden", "true");
  document.body.appendChild(dark);
  const starLink = galaxy.querySelector(".home-star");

  // ---- apply a state

  let full = false;
  const v = new THREE.Vector3();
  // The lines drawn a set number of pixels wide (the streaks, the orbits) need the canvas's size.
  const fitLines = () => {
    renderer.getDrawingBufferSize(streakMat.uniforms.uRes.value);
    streakMat.uniforms.uWidth.value = 1.3 * renderer.getPixelRatio();
    orbitMat.uniforms.uRes.value.copy(streakMat.uniforms.uRes.value);
    orbitMat.uniforms.uWidth.value = renderer.getPixelRatio();
  };
  // A trip takes the page's sky over, star for star. As the canvas covers the screen, each of
  // the page's stars on it gets a twin in the scene, far off along the camera's line of sight
  // to it, so it shows in just the same place, and the page's own go (site.css). The same
  // picture; then the twins move with the camera like the rest of the scene.
  let twins = null;
  function takeSky() {
    camera.updateMatrixWorld();
    const c = canvas.getBoundingClientRect(), b = document.body.getBoundingClientRect(), ray = new THREE.Vector3(), stars = [];
    for (const tile of sky) {
      for (let y0 = b.top + Math.floor((c.top - b.top) / tile.h) * tile.h; y0 < c.bottom; y0 += tile.h) {
        for (let x0 = b.left + Math.floor((c.left - b.left) / tile.w) * tile.w; x0 < c.right; x0 += tile.w) {
          for (const d of tile.dots) {
            const x = x0 + d.x, y = y0 + d.y;
            if (x < c.left - 2 || x > c.right + 2 || y < c.top - 2 || y > c.bottom + 2) continue;
            ray.set(((x - c.left) / c.width) * 2 - 1, 1 - ((y - c.top) / c.height) * 2, 0.5).unproject(camera).sub(camera.position).normalize();
            // As deep under the map as its own stars were (far enough that the flight never
            // reaches them).
            const far = ray.z < -0.05 ? (-60 - rand() * 3000 - camera.position.z) / ray.z : 4 * L.D;
            stars.push({ pos: camera.position.clone().addScaledVector(ray, far).toArray(), ...d });
          }
        }
      }
    }
    twins = starLayer(stars);
    twins.material.uniforms.uOpacity.value = 1;
    scene.add(twins);
    // (Should the page's sky not read back, its stars stay and the cover takes them.)
    if (sky.length) document.body.classList.add("in-flight");
  }
  function sizeBox() {
    if (twins) {
      scene.remove(twins);
      twins.geometry.dispose();
      twins.material.dispose();
      twins = null;
    }
    document.body.classList.remove("in-flight");
    galaxy.prepend(canvas);
    canvas.classList.remove("is-flying");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    renderer.setSize(L.W, L.H, false);
    fitLines();
  }
  function sizeFull() {
    // Where the map is on the screen now: the page may have scrolled since it was laid out.
    L.box = galaxy.getBoundingClientRect();
    document.body.appendChild(canvas);
    canvas.classList.add("is-flying");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:30;pointer-events:none";
    renderer.setSize(innerWidth, innerHeight, false);
    fitLines();
  }
  function apply(s, t) {
    ship.position.copy(s.ship.pos);
    ship.rotation.set(0, 0, 0);
    ship.rotateZ(s.ship.yaw);
    ship.rotateY(s.ship.pitch);
    ship.rotateX(s.ship.roll);
    ship.scale.setScalar(s.ship.scale);
    ship.updateMatrixWorld();
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    const toShip = s.ship.pos.clone().sub(s.cam.pos).normalize();
    // The flame's flicker runs on the clock, so a rocket holding its last pose while the
    // planet's page gets ready (a slow connection) still burns.
    setThrust(ship, s.ship.power, s.clock, THREE.MathUtils.smoothstep(Math.abs(axis.dot(toShip)), 0.75, 0.95), s.ship.scale);
    setPuffs(ship, s.ship.puffs, t);
    ship.userData.halo.material.opacity = s.halo;
    // Stars and orbits cross-fade from the map to open space.
    if (twins) twins.material.uniforms.uOpacity.value = s.mapFade;
    flightStars.material.uniforms.uOpacity.value = 1 - s.mapFade;
    const su = streakMat.uniforms;
    su.uOpacity.value = 0.75 * (1 - s.mapFade);
    su.uLen.value = WARP_LEN * s.warp;
    su.uShift.value = s.shift;
    su.uCenter.value.copy(s.ship.pos);
    su.uAxis.value.copy(s.flow).normalize();
    su.uRight.value.crossVectors(su.uAxis.value, Z).normalize();
    su.uUp.value.crossVectors(su.uRight.value, su.uAxis.value);
    orbitMat.uniforms.uOpacity.value = ORBIT_ALPHA * s.mapFade;
    // The orbits run past the map's edges once the camera leans in to a planet: they fade
    // out toward its edges, and as the trip leaves, the fade lifts as space covers the page.
    const ou = orbitMat.uniforms, pr = renderer.getPixelRatio();
    if (s.full) ou.uBox.value.set(L.box.left * pr, (innerHeight - L.box.top - L.H) * pr, (L.box.left + L.W) * pr, (innerHeight - L.box.top) * pr);
    else ou.uBox.value.set(0, 0, ou.uRes.value.x, ou.uRes.value.y);
    ou.uEdge.value = s.full ? 1 - s.cover : Math.min(1, s.card);
    sunGlow.material.opacity = lerp(1, 0.45, 1 - s.mapFade);
    // Planets in focus stay bright and the others step back: a light step for a skill's
    // preview on hover (skills.js marks its planets), a stronger one when a planet is chosen,
    // matching their names (space.css, site.css). In flight the others fade further.
    const hinting = galaxy.classList.contains("has-hint");
    planets.forEach((p) => {
      let focus = 1;
      if (hinting) focus = p.li.classList.contains("is-hinted") ? 1 : 0.55;
      else if (!s.full && s.target && s.card > 0) focus = p === s.target ? 1 : lerp(1, 0.45, s.card);
      p.dim += (focus - p.dim) * 0.2; // eases over a few frames
      p.u.uDim.value = p.dim * (p === s.target ? s.planetShow : lerp(1, 0.3, 1 - s.mapFade));
      // Only the destination moves: in flight it is placed ahead of the rocket.
      p.group.position.copy(p === s.target && s.planetPos ? s.planetPos : p.home);
      p.u.uCenter.value.copy(p.group.position);
      const pr = p === s.target && s.planetR ? s.planetR : p.radius;
      p.group.scale.setScalar(pr);
      p.u.uR.value = pr;
      p.u.uRs.value = pr * 1.22;
      p.group.visible = p !== s.target || s.planetShow > 0.01;
    });
    const f = 1 - s.mapFade;
    hemi.intensity = lerp(0.55, 0.22, f);
    sunLight.intensity = lerp(3.2, 4.5, f);
    sunLight.position.set(L.sunPos.x, L.sunPos.y, lerp(60, 0, f));
    rim.intensity = 1.1 * f;
    if (s.dir) rim.position.copy(s.ship.pos).addScaledVector(s.dir, 20).add(new THREE.Vector3(0, 0, 18));
    rim.target.position.copy(s.ship.pos);
    camera.position.copy(s.cam.pos);
    camera.quaternion.copy(s.cam.quat);
    if (s.full !== full) { full = s.full; if (full) sizeFull(); else sizeBox(); }
    // The page behind fades under space as we leave, never in a single frame.
    canvas.style.backgroundColor = `rgba(7, 9, 25, ${s.cover})`;
    dark.style.opacity = 0;
    boxCam.position.copy(s.cam.pos);
    boxCam.quaternion.copy(s.cam.quat);
    boxCam.aspect = L.W / L.H;
    boxCam.updateProjectionMatrix();
    boxCam.updateMatrixWorld();
    camera.aspect = L.W / L.H;
    if (full) {
      // The canvas covers the screen; the projection still frames the map exactly at
      // first, then eases to a centred frame with the flight's view.
      camera.fov = lerp(FOV_MAP, L.fovEnd, s.offset) * (1 + 0.07 * s.warp);
      camera.setViewOffset(L.W, L.H, lerp(-L.box.left, (L.W - innerWidth) / 2, s.offset), lerp(-L.box.top, (L.H - innerHeight) / 2, s.offset), innerWidth, innerHeight);
    } else {
      camera.fov = FOV_MAP;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    if (full && !twins) takeSky();
    // The labels follow the camera while it moves; at rest they sit where the map puts them.
    const moving = t >= 0;
    galaxy.classList.toggle("is-approach", s.card > 0.01);
    for (const p of planets) {
      if (moving) {
        v.copy(p.home).project(boxCam);
        p.li.style.left = ((v.x + 1) / 2) * L.W + "px";
        p.li.style.top = ((1 - v.y) / 2) * L.H + "px";
      } else {
        p.li.style.left = p.li.style.top = "";
      }
      p.li.classList.toggle("is-chosen", p === s.target && s.card > 0);
      p.li.style.opacity = s.labels < 1 ? s.labels : "";
    }
    if (moving) {
      v.copy(L.sunPos).project(boxCam);
      starLink.style.left = ((v.x + 1) / 2) * L.W + "px";
      starLink.style.top = ((1 - v.y) / 2) * L.H + "px";
    } else {
      starLink.style.left = starLink.style.top = "";
    }
    starLink.style.opacity = s.labels < 1 ? s.labels : "";
    // The card slides up from below the screen, like a bottom sheet. It is there (just below
    // the screen) from the tap, so Fly there can take the focus at once.
    card.hidden = current ? t >= FLY + 300 : s.card <= 0.001;
    card.style.opacity = Math.min(1, s.card * 3);
    card.style.transform = `translateY(${(1 - s.card) * 115}%)`;
  }

  // ---- playing the timeline

  let state = null; // the current trip's timeline, or null when parked with no target
  let current = null; // the planet the card is open for
  let t = -1; // where on the timeline we are
  let run = null; // { from, to, start, duration, done }
  let leaving = null; // the destination, once Fly there is pressed
  let leaveAt = null; // when the trip goes to the planet page, after Fly there
  let swapped = false; // the page is being left (see pageswap below)
  let last = null; // the last frame's state: where a new approach picks up from
  let visible = true;
  let raf = 0;
  const parkedState = () => {
    // Parked with no trip planned yet: the bob only.
    if (!state) state = plan(planets[0]);
    return state;
  };

  function frame(now) {
    raf = 0;
    if (run) {
      const k = Math.min(1, (now - run.start) / run.duration);
      t = run.from + (run.to - run.from) * k;
      if (k >= 1) { const done = run.done; run = null; if (done) done(); }
    }
    const s = (state || parkedState())(t, now);
    s.clock = now;
    if (!current && t < 0) s.target = null;
    apply(s, t);
    last = s;
    renderer.render(scene, camera);
    if (run || leaving || (visible && !document.hidden)) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && !swapped) raf = requestAnimationFrame(frame); }
  function play(from, to, duration, done) {
    run = { from, to, duration, start: performance.now(), done };
    wake();
  }

  // Where the rocket, the camera and the card are right now, for an approach to pick up.
  const pose = (s) => ({ pos: s.ship.pos.clone(), yaw: s.ship.yaw, rig: s.rig, card: s.card });
  function open(p) {
    if (current === p) return;
    current = p;
    // Another planet while the card is up (or the rocket is on its way somewhere): it
    // glides straight over from where it is, and the card stays up with the new words.
    state = t >= 0 && last ? plan(p, pose(last)) : plan(p);
    const meta = info[p.link.getAttribute("href")] || {};
    card.className = "space-card g-" + (meta.group || "none");
    card.querySelector("h2").textContent = meta.title || p.link.textContent;
    card.querySelector(".space-card-tagline").textContent = meta.tagline || "";
    flyLink.href = p.link.getAttribute("href");
    play(0, 700, 700);
    card.hidden = false;
    flyLink.focus({ preventScroll: true });
    // Phones: a planet low on the map would sit under the card, so the page eases up to
    // keep it in view.
    if (phone) {
      const over = p.li.querySelector(".dot").getBoundingClientRect().bottom + 16 - (innerHeight - card.offsetHeight);
      if (over > 0) scrollBy({ top: over, behavior: "smooth" });
    }
  }
  function close(returnFocus) {
    if (!current || leaving) return;
    const p = current;
    current = null;
    // Home from wherever it is: an approach that ends right here, played backwards.
    if (t >= 0 && last) state = plan(p, null, pose(last));
    play(700, 0, 380, () => { t = -1; });
    if (returnFocus) p.link.focus({ preventScroll: true });
  }

  // Fly there: the whole flight, then the planet page lands it. Any tap or key goes straight
  // to the planet.
  const block = (e) => e.preventDefault();
  function fly() {
    if (!current || leaving) return;
    // Pressed while the rocket is still turning: go as soon as it has.
    if (t < 700) { if (run && run.to === 700) run.done = fly; return; }
    const href = flyLink.getAttribute("href");
    // The planet's page, made ready in the background while the rocket flies (swap.js),
    // and the touchdown it plays.
    const next = Promise.all([S.prepare(href), import(`./landing.js${V}`)]).then(([ready]) => ready);
    next.catch(() => { /* the flight's end goes there the ordinary way */ });
    leaving = href;
    leaveAt = HAND_OFF;
    // Nothing else on the page follows a click while it leaves.
    addEventListener("click", block, true);
    const go = (kind) => {
      removeEventListener("pointerdown", skip, true);
      removeEventListener("keydown", skip, true);
      removeEventListener("wheel", skip, true);
      if (kind) store.set("trip", JSON.stringify({ kind, to: href }));
      else store.del("trip");
      location.href = href;
    };
    // The flight's end. The rocket holds its last pose until the planet's page is ready (on
    // a slow connection, as long as that takes); then the page takes this one's place
    // without a load, and the touchdown (landing.js, run by that page's own script) fades in
    // over the flight's last frame from the same pose. Only if the page can't be had does
    // the trip go there the ordinary way.
    const arrive = (ready) => {
      removeEventListener("pointerdown", skip, true);
      removeEventListener("keydown", skip, true);
      removeEventListener("wheel", skip, true);
      removeEventListener("click", block, true);
      life.abort();
      resized.disconnect();
      seen.disconnect();
      swapped = true;
      cancelAnimationFrame(raf);
      raf = 0;
      card.remove();
      hint.remove();
      dark.remove();
      // The flight's last frame, as a plain picture, takes its 3D canvas's place, and the
      // flight's scene lets go of the GPU: the touchdown sets up under that picture with a
      // phone's GPU to itself.
      renderer.render(scene, camera);
      const still = document.createElement("canvas");
      still.width = canvas.width;
      still.height = canvas.height;
      still.style.cssText = canvas.style.cssText;
      still.setAttribute("aria-hidden", "true");
      const g = still.getContext("2d");
      g.fillStyle = "#070919";
      g.fillRect(0, 0, still.width, still.height);
      g.drawImage(canvas, 0, 0);
      canvas.replaceWith(still);
      renderer.dispose();
      renderer.forceContextLoss();
      const root = document.documentElement;
      // The planet as the flight leaves it, for the touchdown to go on drawing it the same
      // way (landing.js): the light on it, in the rocket's own frame; and its own frame (the
      // one its clouds and bands are drawn in) as seen from the touchdown's world, where the
      // rocket starts nose down (-z) with its porthole toward -y, with its pattern's seed.
      if (last && last.planetPos && last.target) {
        const q = ship.quaternion, n = (v) => v.toFixed(4);
        const l = sunLight.position.clone().sub(last.planetPos).normalize().applyQuaternion(q.clone().invert());
        root.dataset.tripLight = [l.x, l.y, l.z].map(n).join(" ");
        const ax = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q);
        const nose = ax(1, 0, 0), side = ax(0, 1, 0), port = ax(0, 0, 1);
        root.dataset.tripPlanet = [side.x, side.y, side.z, -port.x, -port.y, -port.z, -nose.x, -nose.y, -nose.z, last.target.u.uSeed.value].map(n).join(" ");
      }
      S.swap(ready, href);
      root.dataset.tripAt = performance.now();
      root.classList.add("trip-land", "trip-inplace");
      // The picture goes once the touchdown has come up over it.
      const done = () => {
        watch.disconnect();
        clearTimeout(safety);
        root.classList.remove("trip-inplace");
        still.remove();
      };
      const watch = new MutationObserver(() => { if (!root.classList.contains("trip-land")) done(); });
      watch.observe(root, { attributes: true, attributeFilter: ["class"] });
      const safety = setTimeout(done, 8000);
      import(ready.src).catch(() => { root.classList.remove("trip-land"); done(); });
    };
    function skip(e) {
      if (e.type === "keydown" && (e.metaKey || e.ctrlKey || e.altKey)) return;
      run = null;
      go(null);
    }
    addEventListener("pointerdown", skip, true);
    addEventListener("keydown", skip, true);
    addEventListener("wheel", skip, { capture: true, passive: true });
    hint.classList.add("is-shown");
    play(FLY, FLY + leaveAt, leaveAt, () => next.then(arrive, () => go("land")));
    // The page under the flight goes back to its top once the flight covers it, so a phone's
    // address bar has long settled before the planet's page takes over (one sliding in
    // mid-touchdown would move the window the touchdown lands on).
    setTimeout(() => { if (leaving === href) scrollTo(0, 0); }, 350);
  }

  galaxy.addEventListener("click", (e) => {
    const link = e.target.closest(".planet a");
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const p = planets.find((q) => q.link === link);
    if (!p) return;
    e.preventDefault();
    if (current === p) fly();
    else open(p);
  });
  flyLink.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    fly();
  });
  card.querySelector(".space-close").addEventListener("click", () => close(true));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && current) close(true); }, on);
  // A tap anywhere outside the card and the planets puts the card away.
  addEventListener("pointerdown", (e) => {
    if (current && !leaving && !card.contains(e.target) && !e.target.closest(".planet a")) close(false);
  }, on);

  // A page change takes a picture of this page for the cross-fade (site.css), and the
  // scene's canvas (or the skip hint over it) can turn that picture white. A trip doesn't
  // change page (the planet's page takes this one's place, see fly), but a skipped one does,
  // straight from the flight: it skips the cross-fade. For any other change the map shows
  // its static self in the picture. The Back button brings the scene back.
  addEventListener("pageswap", (e) => {
    if (!e.viewTransition) return;
    swapped = true;
    cancelAnimationFrame(raf);
    raf = 0;
    if (leaving) {
      e.viewTransition.skipTransition();
      return;
    }
    canvas.style.display = "none";
    hint.style.display = "none";
    if (full) dark.style.opacity = 1;
    else galaxy.classList.remove("is-3d");
  }, on);

  // Coming back with the Back button restores the page from the cache: park again.
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    swapped = false;
    canvas.style.display = "";
    hint.style.display = "";
    galaxy.classList.add("is-3d");
    store.del("trip");
    removeEventListener("click", block, true);
    run = null;
    leaving = null;
    leaveAt = null;
    current = null;
    t = -1;
    hint.classList.remove("is-shown");
    layout();
    state = plan(planets[0]);
    wake();
  }, on);
  // A new map size moves the planets: lay the map out again and replan the trip.
  const resized = new ResizeObserver(() => {
    if (leaving) return;
    layout();
    state = plan(current || planets[0]);
    wake();
  });
  resized.observe(galaxy);
  const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); });
  seen.observe(galaxy);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); }, on);

  layout();
  // Compile every shader now, so the first tap starts on time.
  parkedState();
  renderer.compile(scene, camera);
  galaxy.classList.add("is-3d");
  wake();
}
