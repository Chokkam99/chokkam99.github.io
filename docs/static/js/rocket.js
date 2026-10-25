// The rocket, shared by the flight (space.js, home page) and the landing (landing.js,
// planet page). Built along +x (nose forward), +z up (the porthole faces +z). Its
// proportions match templates/rocket.svg; its porthole matches the planet page's window.
import * as THREE from "../vendor/three/three.module.min.js";

export const ease = {
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  out: (x) => 1 - Math.pow(1 - x, 3),
  in: (x) => x * x,
  smooth: (x) => x * x * (3 - 2 * x),
};

export function radialTexture(stops, w = 256, h = 256) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) / 2);
  stops.forEach(([at, color]) => grad.addColorStop(at, color));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const glow = (stops, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(stops), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
};
export const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.08, ...o });
export const paint = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.25, ...o });

function flameTexture(stops) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d");
  g.translate(64, 40); g.scale(1, 3.4);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  stops.forEach(([at, color]) => grad.addColorStop(at, color));
  g.fillStyle = grad; g.fillRect(-64, -40, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The porthole is the planet page's window in miniature, whatever its shape: recessed
// glass, a thick black rubber seal, a dark bolted metal frame. It takes the window's own
// sizes in page pixels (the glass box, its corner radius, the seal, the frame and its
// bolts) and scales them so the glass is PORTHOLE_W wide on the hull, so the touchdown can
// push in on it and land exactly on the page's window. Without sizes it is round.
export const PORTHOLE_W = 0.84;
const ROUND = { w: 100, h: 100, r: 50, seal: 2.1, frame: 3.6, bolt: 1.8 };

function roundRect(w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

function porthole(p) {
  const port = new THREE.Group();
  const k = PORTHOLE_W / p.w; // hull units per page pixel
  const W = p.w * k, H = p.h * k, R = Math.min(p.r, p.w / 2, p.h / 2) * k, sl = p.seal * k, fr = p.frame * k;
  // Shallow depths (frame face, seal, glass), so seen head-on all three sit nearly in one
  // plane and line up with the page's flat window.
  const face = 0.012, sealZ = -0.005, glassZ = -0.02;
  // Frame: a machined band standing proud of the hull round the glass box, its foot sunk
  // into the curve.
  const band = roundRect(W + 2 * fr, H + 2 * fr, R + fr);
  band.holes.push(roundRect(W, H, R));
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(band, { depth: 0.12 + face - 0.008, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.004, bevelSegments: 2, curveSegments: 24 }),
    mat(0x5d636f, { metalness: 0.3, roughness: 0.4 }));
  frame.position.z = -0.12;
  // Seal: soft round rubber over the edge of the glass, all the way round.
  const sealPath = roundRect(W - sl, H - sl, Math.max(R - sl / 2, 0.001)).getSpacedPoints(160).map((v) => new THREE.Vector3(v.x, v.y, 0));
  const seal = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sealPath, true), 240, (sl / 2) * 1.2, 10, true),
    new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.88, metalness: 0 }));
  seal.position.z = sealZ;
  // Glass, set back, reaching just under the seal.
  const glassShape = roundRect(W - 0.8 * sl, H - 0.8 * sl, Math.max(R - 0.4 * sl, 0.001));
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(glassShape, 24), new THREE.MeshStandardMaterial({ color: 0x1d2c66, roughness: 0.04, metalness: 0.1, envMapIntensity: 2.2, emissive: 0x24387e, emissiveIntensity: 0.25 }));
  glass.position.z = glassZ;
  // Twelve bolts, placed as the page places them (world.css): five round each end (its two
  // corners and the middle between them) and one in the middle of each long side.
  const boltGeo = new THREE.SphereGeometry((p.bolt * k) / 2, 14, 10);
  const boltMat = mat(0xa6acb6, { metalness: 0.45, roughness: 0.3 });
  const rc = R + fr / 2, wide = W > H;
  for (let i = 1; i <= 12; i++) {
    const s = i <= 5 ? -1 : i <= 10 ? 1 : 0;
    const a = (i === 12 ? 90 : [-90, -45, 0, 45, 90][(i - 1) % 5]) * (Math.PI / 180);
    const h = Math.sign(Math.round(Math.sin(a) * 1000));
    // In the page's terms: across from the left, down from the top of the glass box.
    const across = wide ? W / 2 + s * (W / 2 - R + rc * Math.cos(a)) : W / 2 + h * (W / 2 - R) + rc * Math.sin(a);
    const down = wide ? H / 2 + h * (H / 2 - R) + rc * Math.sin(a) : H / 2 + s * (H / 2 - R + rc * Math.cos(a));
    const b = new THREE.Mesh(boltGeo, boltMat);
    b.position.set(across - W / 2, H / 2 - down, face);
    b.scale.z = 0.55;
    port.add(b);
  }
  port.add(frame, seal, glass);
  port.userData = { glass, glassShape, k, size: { w: W, h: H }, sealAhead: sealZ - glassZ };
  return port;
}

export function rocket(opts = {}) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  // Profiles are written nose to tail; a lathe faces outward only when its profile runs tail
  // to nose, so turn them round (flat rings are left as written).
  const lathe = (pts, material, segs = 72) => {
    const up = pts[pts.length - 1][1] < pts[0][1] ? pts.slice().reverse() : pts;
    return new THREE.Mesh(new THREE.LatheGeometry(up.map(([r, y]) => new THREE.Vector2(r, y)), segs), material);
  };
  // Cream and coral, the same paint as the window ring and rocket-upright.svg.
  const coral = paint(0xff7a7a, { roughness: 0.42, clearcoat: 0.35 });
  const shell = paint(0xf1ece2, { roughness: 0.34, metalness: 0.06, clearcoat: 0.35 });
  const seam = mat(0xb9bfd6, { roughness: 0.45, metalness: 0.4 });
  const metal = mat(0x7c83a3, { roughness: 0.35, metalness: 0.55, side: THREE.DoubleSide });
  // Ogive nose: a smooth tangent curve from the tip down to the body.
  const nose = [];
  for (let i = 0; i <= 14; i++) { const k = i / 14; nose.push([1.55 * Math.sin(k * Math.PI / 2) ** 0.9, 6.6 - k * 3.7]); }
  body.add(lathe(nose, coral));
  // Body, a small boat-tail skirt, and the engine bell.
  body.add(lathe([[1.55, 2.9], [1.6, 2.2], [1.6, -2.3], [1.74, -3.0], [1.5, -3.4]], shell));
  body.add(lathe([[0.86, -3.4], [1.08, -4.3], [1.02, -4.36]], metal));
  // The base: a dark heat shield closing the hull round the bell, and the throat deep inside
  // the bell, so from below the rocket is solid, never open to the sky behind it.
  const base = mat(0x2a2d36, { roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  body.add(lathe([[0.86, -3.4], [1.5, -3.4]], base, 48));
  body.add(lathe([[0, -3.55], [0.86, -3.4]], mat(0x14161b, { roughness: 0.9, side: THREE.DoubleSide }), 48));
  // Two panel seams (the upper one above the tallest porthole) and a coral band near the base.
  [2.12, -0.55].forEach((y) => body.add(lathe([[1.612, y + 0.035], [1.612, y - 0.035]], seam)));
  body.add(lathe([[1.615, -1.25], [1.615, -1.95]], coral));
  // Porthole on top, facing +z: the page's window, seal, frame and bolts. Its top sits at the
  // same place whatever its shape, and its glass just proud of the hull's curve.
  const port = porthole(opts.porthole || ROUND);
  port.position.set(0, 1.95 - port.userData.size.h / 2, 1.63);
  body.add(port);
  const glass = port.userData.glass;
  // Three swept fins, rooted flush: two either side of the porthole (60 degrees off it) and
  // one straight behind it, so none stands in front of the window.
  // Their feet reach just below the bell, so the rocket stands on them when it lands.
  const fin = new THREE.Shape();
  fin.moveTo(0, 1.0); fin.quadraticCurveTo(0.95, 0.4, 1.85, -2.0); fin.lineTo(1.95, -3.65); fin.quadraticCurveTo(0.9, -2.4, 0, -2.4); fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.2, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3 });
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    const f = new THREE.Mesh(finGeo, coral);
    f.position.set(1.48, -0.95, -0.1);
    pivot.add(f);
    pivot.rotation.y = (i * Math.PI * 2) / 3 + (Math.PI * 7) / 6;
    body.add(pivot);
  }
  body.rotation.z = -Math.PI / 2;
  body.scale.setScalar(0.85);
  g.add(body);
  // Plume: two crossed soft planes plus a hot glow at the nozzle. Scaled by thrust.
  const plume = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ map: flameTexture([[0, "rgba(255,242,214,0.95)"], [0.18, "rgba(255,191,94,0.75)"], [0.45, "rgba(255,154,60,0.35)"], [1, "rgba(255,120,40,0)"]]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 4.2), flameMat);
    p.rotation.z = -Math.PI / 2;
    p.rotation.x = (i * Math.PI) / 2;
    p.position.x = -4.2 / 2 + 4.2 * 0.16;
    plume.add(p);
  }
  plume.position.x = -3.75;
  g.add(plume);
  const nozzleGlow = glow([[0, "rgba(255,242,214,0.85)"], [0.3, "rgba(255,170,80,0.35)"], [1, "rgba(0,0,0,0)"]], 2.6);
  nozzleGlow.position.x = -3.9;
  g.add(nozzleGlow);
  // A faint warm halo so the rocket is easy to find on the map.
  const halo = glow([[0, "rgba(255,214,170,0.5)"], [0.4, "rgba(255,190,140,0.18)"], [1, "rgba(0,0,0,0)"]], 16);
  g.add(halo);
  // The flame lights the fins and the ground near the nozzle.
  const engineLight = new THREE.PointLight(0xffa860, 0, 6, 0);
  engineLight.position.x = -4.6;
  g.add(engineLight);
  g.userData = { plume, flameMat, nozzleGlow, halo, engineLight, body, glass, port };
  return g;
}

// Thrust 0..1 with a gentle flicker from summed sines (never random per frame).
// endOn is 1 when the camera looks straight down the rocket's axis: the flat flame planes
// would show their edges, so the flame gives way to the round nozzle glow.
export function setThrust(r, power, t, endOn = 0, scale = 1) {
  const flick = 1 + 0.07 * Math.sin(t * 0.031) + 0.045 * Math.sin(t * 0.057 + 1.3) + 0.03 * Math.sin(t * 0.093 + 2.1);
  const p = power * flick;
  r.userData.plume.visible = power > 0.01;
  r.userData.plume.scale.set(0.25 + 0.75 * p, 0.6 + 0.4 * Math.min(p, 1.2), 0.6 + 0.4 * Math.min(p, 1.2));
  r.userData.flameMat.opacity = Math.min(1, power) * (1 - endOn);
  r.userData.nozzleGlow.material.opacity = Math.min(1, power * 1.1);
  r.userData.nozzleGlow.scale.setScalar(1.6 + 1.4 * p);
  r.userData.engineLight.intensity = 2.4 * power * flick;
  r.userData.engineLight.distance = 7 * scale;
}

// Attitude puffs: short bursts of cold gas from small thrusters at the nose and tail, one
// pair to start a turn and one to stop it. Pure in t: each puff's age comes from t alone.
export const PUFF_MS = 380;
const NOSE_X = 2.3, TAIL_X = -2.3, HULL_R = 1.4;
export function puffSprites(r) {
  const tex = radialTexture([[0, "rgba(244,247,255,0.95)"], [0.35, "rgba(228,234,255,0.5)"], [1, "rgba(228,234,255,0)"]], 64, 64);
  const list = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    r.add(s);
    list.push(s);
  }
  r.userData.puffs = list;
}
// events: [{ at, dir }] where dir is the nose exhaust direction in the rocket's frame
// (the tail fires the opposite way, so the pair turns the rocket without pushing it).
export function setPuffs(r, events, t) {
  let k = 0;
  for (const e of events) {
    const a = (t - e.at) / PUFF_MS;
    if (a < 0 || a > 1) continue;
    const grow = ease.out(a);
    for (const [x, sign] of [[NOSE_X, 1], [TAIL_X, -1]]) {
      for (const speed of [0.8, 1.25]) {
        const s = r.userData.puffs[k++];
        if (!s) break;
        const out = HULL_R + 0.3 + 2.4 * speed * grow;
        s.position.set(x + (speed - 1) * 0.6, e.dir[0] * out * sign, e.dir[1] * out * sign);
        s.scale.setScalar(0.5 + 2.2 * speed * grow);
        s.material.opacity = 0.7 * Math.pow(1 - a, 1.6);
        s.visible = true;
      }
    }
  }
  for (; k < r.userData.puffs.length; k++) r.userData.puffs[k].visible = false;
}
