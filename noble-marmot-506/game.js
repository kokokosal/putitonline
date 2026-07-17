/* ============================================================
   SUNSET RUSH — ocean racing mini-game
   arrows steer · space fires laser · everything else is automatic
   ============================================================ */
(() => {
'use strict';

window.addEventListener('error', (e) => {
  const d = document.getElementById('err');
  d.style.display = 'block';
  d.textContent = 'Error: ' + e.message + (e.filename ? '  [' + e.filename.split('/').pop() + ':' + e.lineno + ']' : '');
});

// ---------------------------------------------------------- utils
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260716);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------- renderer / scene
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.classList.add('game');
app.insertBefore(renderer.domElement, app.firstChild);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0x64205c);   // dusky magenta haze
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0011);

const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.3, 9000);
camera.position.set(0, 8, -20);

const SUN_DIR = new THREE.Vector3(0.38, 0.58, -0.55).normalize();
const sunLight = new THREE.DirectionalLight(0xffc98a, 2.3);
sunLight.position.copy(SUN_DIR).multiplyScalar(200);
scene.add(sunLight);
scene.add(new THREE.HemisphereLight(0xff8ecf, 0x2a0f45, 1.0));

// ---------------------------------------------------------- sky
// vaporwave sunset: orange horizon -> magenta -> deep violet zenith, with a
// big striped retro sun and slow psychedelic ripples radiating from it
const timeU = { value: 0 };   // shared clock for sky + grid shaders
const SKY_GLSL = `
vec3 skyGrad(vec3 d, vec3 sd){
  float h = clamp(d.y, -0.05, 1.0);
  vec3 zen = vec3(0.10, 0.03, 0.24);
  vec3 mid = vec3(0.56, 0.12, 0.52);
  vec3 hor = vec3(1.00, 0.42, 0.20);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.24, h));
  col = mix(col, zen, smoothstep(0.16, 0.62, h));
  float s = max(dot(d, sd), 0.0);
  col += vec3(1.0, 0.52, 0.22) * pow(s, 6.0) * 0.55;
  return col;
}`;

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR }, time: timeU },
  vertexShader: `
    varying vec3 vDir;
    void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: SKY_GLSL + `
    varying vec3 vDir; uniform vec3 sunDir; uniform float time;
    void main(){
      vec3 d = normalize(vDir);
      vec3 col = skyGrad(d, sunDir);
      float s = max(dot(d, sunDir), 0.0);
      // big retro sun: yellow top -> hot pink bottom, sliced by horizontal gaps
      float disc = smoothstep(0.9952, 0.9962, s);
      float below = smoothstep(sunDir.y + 0.02, sunDir.y - 0.09, d.y);   // 0 top of disc -> 1 bottom
      float cut = 1.0 - smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(d.y * 320.0)) * smoothstep(0.15, 0.65, below);
      vec3 sunCol = mix(vec3(1.0, 0.86, 0.34), vec3(1.0, 0.22, 0.58), below);
      col += sunCol * disc * cut * 3.4;
      col += vec3(1.0, 0.45, 0.30) * pow(s, 90.0) * 0.9;                 // warm halo
      // slow psychedelic ripples wobbling around the sun
      float ang = atan(d.z, d.x);
      float rip = sin(acos(clamp(s, -1.0, 1.0)) * 46.0 - time * 0.6 + sin(ang * 6.0 + time * 0.23) * 1.1);
      col += vec3(0.95, 0.30, 0.85) * smoothstep(0.35, 1.0, rip) * smoothstep(0.45, 0.92, s) * (1.0 - disc) * 0.10;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 40, 20), skyMat);
scene.add(sky);

// bake the sky into an environment map so metallic paint picks up the sunset
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, skyMat));
  const groundEnv = new THREE.Mesh(new THREE.CircleGeometry(3500, 32),
    new THREE.MeshBasicMaterial({ color: 0x160828 }));
  groundEnv.rotation.x = -Math.PI / 2;
  groundEnv.position.y = -4;
  envScene.add(groundEnv);
  const rt = pmrem.fromScene(envScene, 0.035, 1, 6500);
  scene.environment = rt.texture;
  pmrem.dispose();
}

const glowTex = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0xffa04a, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false
}));
sunSprite.scale.set(1050, 1050, 1);
scene.add(sunSprite);

// ---------------------------------------------------------- neon grid floor
// Tron-style vaporwave plane: dark violet ground with glowing pink grid lines
// (world-space, so the camera-follow snap never makes the pattern swim)
const gridUniforms = {
  time: timeU,
  fogColor: { value: FOG_COLOR }
};
const gridMat = new THREE.ShaderMaterial({
  uniforms: gridUniforms,
  vertexShader: `
    varying vec3 vWp;
    void main(){
      vWp = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 fogColor; uniform float time;
    varying vec3 vWp;
    void main(){
      float dist = length(cameraPosition - vWp);
      vec2 p = vWp.xz / 24.0;                       // 24 m grid cells
      vec2 q = abs(fract(p) - 0.5);
      vec2 fw = fwidth(p) * 1.4 + 1e-5;
      // crisp anti-aliased line core + wide soft glow around it
      vec2 core2 = 1.0 - smoothstep(vec2(0.0), fw, q);
      vec2 glow2 = 1.0 - smoothstep(vec2(0.0), fw * 6.0 + 0.03, q);
      float core = max(core2.x, core2.y);
      float glow = max(glow2.x, glow2.y);
      float pulse = 0.82 + 0.18 * sin(time * 1.8 + (vWp.x + vWp.z) * 0.012);
      vec3 base = vec3(0.045, 0.012, 0.10);         // dark violet ground
      vec3 neon = vec3(1.0, 0.16, 0.72) * pulse;    // hot vaporwave pink
      float att = exp(-dist * 0.0016);               // fade lines toward horizon (anti-moire)
      vec3 col = base + neon * (core * 1.5 + glow * glow * 0.35) * att;
      col = mix(col, fogColor, 1.0 - exp(-dist * 0.0010));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const gridGeo = new THREE.PlaneGeometry(4600, 4600, 1, 1);
gridGeo.rotateX(-Math.PI / 2);
const ocean = new THREE.Mesh(gridGeo, gridMat);   // keeps the "ocean" follow-cam hookup
ocean.frustumCulled = false;
scene.add(ocean);

// ---------------------------------------------------------- track
const TRACK = (() => {
  const ctrl = [];
  const CPN = 26, R = 300;
  for (let i = 0; i < CPN; i++) {
    const a = i / CPN * Math.PI * 2;
    const r = R + 72 * Math.sin(a * 3 + 1.7) + 48 * Math.sin(a * 5 + 4.1) + 26 * Math.sin(a * 2 + 0.6);
    const y = 3.4 + 2.2 * Math.sin(a * 2 + 1.2) + 1.3 * Math.sin(a * 3 + 3.4);
    ctrl.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'catmullrom', 0.5);
  curve.arcLengthDivisions = 3000;
  const L = curve.getLength();
  const N = 2400, step = L / N;
  const pos = [], tan = [], left = [];
  const curv = new Float32Array(N);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const u = i / N;
    pos.push(curve.getPointAt(u));
    const t = curve.getTangentAt(u);
    tan.push(t.clone());
    const l = new THREE.Vector3().crossVectors(up, new THREE.Vector3(t.x, 0, t.z).normalize()).normalize();
    left.push(l);
  }
  for (let i = 0; i < N; i++) {
    const a = tan[(i + 1) % N], b = tan[(i - 1 + N) % N];
    const d = new THREE.Vector3().subVectors(a, b).multiplyScalar(1 / (2 * step));
    curv[i] = d.dot(left[i]);
  }
  for (let pass = 0; pass < 2; pass++) {
    const s2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -6; k <= 6; k++) acc += curv[(i + k + N) % N];
      s2[i] = acc / 13;
    }
    curv.set(s2);
  }
  return { L, N, step, pos, tan, left, curv };
})();
const HALF_W = 7.0;

function frame(s, out) {
  let m = ((s % TRACK.L) + TRACK.L) % TRACK.L;
  const f = m / TRACK.step;
  const i = Math.floor(f) % TRACK.N;
  const r = f - Math.floor(f);
  const j = (i + 1) % TRACK.N;
  out.p.lerpVectors(TRACK.pos[i], TRACK.pos[j], r);
  out.t.lerpVectors(TRACK.tan[i], TRACK.tan[j], r).normalize();
  out.l.lerpVectors(TRACK.left[i], TRACK.left[j], r).normalize();
  out.k = lerp(TRACK.curv[i], TRACK.curv[j], r);
  return out;
}
const mkFrame = () => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), l: new THREE.Vector3(), k: 0 });

// road surface geometry: a ribbon following the track
function ribbon(w0, w1, yOff, vScale) {
  const N = TRACK.N;
  const posA = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const ii = i % N;
    const p = TRACK.pos[ii], l = TRACK.left[ii];
    const o = i * 6;
    posA[o]     = p.x + l.x * w0; posA[o + 1] = p.y + yOff; posA[o + 2] = p.z + l.z * w0;
    posA[o + 3] = p.x + l.x * w1; posA[o + 4] = p.y + yOff; posA[o + 5] = p.z + l.z * w1;
    const v = i * TRACK.step / vScale;
    uv[i * 4] = 0; uv[i * 4 + 1] = v; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = v;
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// vertical skirt along one edge
function skirt(w, yTop, yBot) {
  const N = TRACK.N;
  const posA = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const ii = i % N;
    const p = TRACK.pos[ii], l = TRACK.left[ii];
    const x = p.x + l.x * w, z = p.z + l.z * w;
    const o = i * 6;
    posA[o] = x; posA[o + 1] = p.y + yTop; posA[o + 2] = z;
    posA[o + 3] = x; posA[o + 4] = p.y + yBot; posA[o + 5] = z;
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const roadTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#41454f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5200; i++) {
    const v = 52 + Math.random() * 52;
    g.fillStyle = `rgba(${v},${v},${v + 6},${0.25 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
  }
  // solid edge lines
  g.fillStyle = 'rgba(240,240,245,0.92)';
  g.fillRect(w * 0.045, 0, w * 0.018, h);
  g.fillRect(w * 0.937, 0, w * 0.018, h);
  // dashed center line
  g.fillStyle = 'rgba(255,214,120,0.95)';
  for (let y = 0; y < h; y += 128) g.fillRect(w * 0.494, y, w * 0.012, 74);
});
roadTex.wrapT = THREE.RepeatWrapping;

const kerbTex = canvasTex(32, 64, (g, w, h) => {
  g.fillStyle = '#e03428'; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#f2ede6'; g.fillRect(0, h / 2, w, h / 2);
});
kerbTex.wrapT = THREE.RepeatWrapping;

const road = new THREE.Mesh(ribbon(-HALF_W, HALF_W, 0, 13),
  new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.94, metalness: 0.0 }));
scene.add(road);

const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.8 });
scene.add(new THREE.Mesh(ribbon(-HALF_W - 0.95, -HALF_W + 0.02, 0.03, 3.4), kerbMat));
scene.add(new THREE.Mesh(ribbon(HALF_W - 0.02, HALF_W + 0.95, 0.03, 3.4), kerbMat));

const deckMat = new THREE.MeshStandardMaterial({ color: 0x322b3e, roughness: 0.95, side: THREE.DoubleSide });
scene.add(new THREE.Mesh(skirt(-HALF_W - 0.98, 0.03, -2.4), deckMat));
scene.add(new THREE.Mesh(skirt(HALF_W + 0.98, 0.03, -2.4), deckMat));
scene.add(new THREE.Mesh(ribbon(-HALF_W - 0.98, HALF_W + 0.98, -2.4, 40), deckMat));

// start gate
{
  const f0 = frame(0, mkFrame());
  const gate = new THREE.Group();
  const pillarGeo = new THREE.BoxGeometry(0.6, 7.5, 0.6);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.6, metalness: 0.3 });
  const banTex = canvasTex(512, 96, (g, w, h) => {
    // checkered flag banner — no text
    const sq = 24;
    for (let y = 0; y < h; y += sq) {
      for (let x = 0; x < w; x += sq) {
        g.fillStyle = ((x + y) / sq) % 2 ? '#e8e4dc' : '#181226';
        g.fillRect(x, y, sq, sq);
      }
    }
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 3, 1.6, 0.4),
    [new THREE.MeshStandardMaterial({ color: 0x181226 }), new THREE.MeshStandardMaterial({ color: 0x181226 }),
     new THREE.MeshStandardMaterial({ color: 0x181226 }), new THREE.MeshStandardMaterial({ color: 0x181226 }),
     new THREE.MeshBasicMaterial({ map: banTex }), new THREE.MeshBasicMaterial({ map: banTex })]);
  banner.position.y = 6.8;
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(s * (HALF_W + 1.2), 3.75, 0);
    gate.add(p);
  }
  gate.add(banner);
  gate.position.copy(f0.p);
  gate.rotation.y = Math.atan2(f0.t.x, f0.t.z);
  scene.add(gate);
}

// ---------------------------------------------------------- car builders
function extrudeBody(pts, width, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, steps: 1
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);   // profile x-axis -> world +z (car nose points +z)
  g.computeVertexNormals();
  return g;
}
function wheel(r, w) {
  const grp = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18),
    new THREE.MeshStandardMaterial({ color: 0x131519, roughness: 0.92 }));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.3, metalness: 0.9 }));
  tire.rotation.z = Math.PI / 2; rim.rotation.z = Math.PI / 2;
  grp.add(tire); grp.add(rim);
  return grp;
}
const shadowTex = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,0.62)');
  r.addColorStop(0.7, 'rgba(0,0,0,0.34)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
function blobShadow(lenZ, widX) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(widX, lenZ),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.045;
  m.renderOrder = 1;
  return m;
}

// --- player: Audi e-tron GT ---
function buildEtron() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xa9b8c6, metalness: 0.78, roughness: 0.30 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a0e14, metalness: 0.9, roughness: 0.12 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.55, metalness: 0.4 });

  const body = new THREE.Mesh(extrudeBody([
    [-2.35, 0.24], [2.36, 0.24], [2.46, 0.44], [2.30, 0.64],
    [0.95, 0.80], [-1.85, 0.88], [-2.42, 0.74], [-2.46, 0.46]
  ], 1.94, 0.13), paint);
  car.add(body);

  const canopy = new THREE.Mesh(extrudeBody([
    [1.02, 0.78], [0.34, 1.13], [-0.98, 1.15], [-1.80, 0.84]
  ], 1.66, 0.12), glass);
  car.add(canopy);

  // rocker panel / diffuser hint
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.14, 4.5), trim);
  rocker.position.y = 0.22;
  car.add(rocker);

  // full-width e-tron light bar (rear)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.07, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff2418 }));
  bar.position.set(0, 0.80, -2.44);
  car.add(bar);
  // slim matrix headlights
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.05), hlMat);
    hl.position.set(s * 0.62, 0.60, 2.42);
    hl.rotation.y = s * 0.14;
    car.add(hl);
  }
  // audi rings
  const ringGeo = new THREE.TorusGeometry(0.055, 0.013, 6, 14);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xe6eaee });
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set((i - 1.5) * 0.085, 0.545, 2.51);
    car.add(ring);
  }
  // ducktail spoiler
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.34), trim);
  spoiler.position.set(0, 0.92, -2.18);
  spoiler.rotation.x = 0.14;
  car.add(spoiler);

  const wheels = [];
  for (const [x, z] of [[-0.86, 1.52], [0.86, 1.52], [-0.86, -1.52], [0.86, -1.52]]) {
    const w = wheel(0.375, 0.30);
    w.position.set(x, 0.375, z);
    car.add(w); wheels.push(w);
  }
  car.add(blobShadow(5.6, 2.6));
  car.userData.wheels = wheels;
  return car;
}

// --- opponents: red Mini Coopers, white bonnet stripes ---
function buildMini() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc41220, metalness: 0.55, roughness: 0.38 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b0f14, metalness: 0.85, roughness: 0.15 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45 });

  const body = new THREE.Mesh(extrudeBody([
    [-1.42, 0.26], [1.42, 0.26], [1.52, 0.52], [1.38, 0.76],
    [0.62, 0.82], [0.40, 1.24], [-0.86, 1.27], [-1.32, 0.92], [-1.50, 0.58]
  ], 1.52, 0.12), paint);
  car.add(body);

  const canopy = new THREE.Mesh(extrudeBody([
    [0.50, 0.80], [0.30, 1.20], [-0.78, 1.23], [-1.14, 0.86]
  ], 1.40, 0.09), glass);
  car.add(canopy);

  // white bonnet stripes
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.03, 0.78), white);
    stripe.position.set(s * 0.20, 0.815, 1.00);
    stripe.rotation.x = 0.075;
    car.add(stripe);
  }
  // round headlights
  const hlGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.06, 12);
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2cf });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(s * 0.42, 0.62, 1.50);
    car.add(hl);
  }
  // tail lights
  const tlMat = new THREE.MeshBasicMaterial({ color: 0xff3324 });
  for (const s of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.05), tlMat);
    tl.position.set(s * 0.52, 0.68, -1.49);
    car.add(tl);
  }
  const wheels = [];
  for (const [x, z] of [[-0.68, 0.92], [0.68, 0.92], [-0.68, -0.92], [0.68, -0.92]]) {
    const w = wheel(0.30, 0.24);
    w.position.set(x, 0.30, z);
    car.add(w); wheels.push(w);
  }
  car.add(blobShadow(3.4, 2.0));
  car.userData.wheels = wheels;
  return car;
}

const playerCar = buildEtron();
scene.add(playerCar);

// rear "trunk window" panel that flares bright red when the laser fires
const rearGlow = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 0.5, 0.06),
  new THREE.MeshStandardMaterial({ color: 0x220304, emissive: 0xff0a0a, emissiveIntensity: 0 })
);
rearGlow.position.set(0, 1.02, -2.28);
function attachRearGlow() { playerCar.add(rearGlow); }
attachRearGlow();

// Swap in the real e-tron GT model (CC-BY-4.0, gbarzu) when its payload is present.
// Falls back silently to the procedural car if anything goes wrong.
const ETRON_MODEL_YAW = 0;   // payload model already noses +Z (verified via headlight/brakelight mesh probe)
(function loadEtronModel() {
  if (!window.ETRON_GLB_B64 || !THREE.GLTFLoader) return;
  try {
    const bin = atob(window.ETRON_GLB_B64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer, '', (gltf) => {
      const model = gltf.scene;
      const wrap = new THREE.Group();
      wrap.add(model);

      // The source Sketchfab export bakes an artistic "hero shot" pitch/roll
      // (~5deg nose-up, ~8deg roll) into the Sketchfab_model->fbx->RootNode
      // chain. Measure that chain's world orientation while `model` is still
      // at identity, then cancel it exactly with model's own quaternion so
      // the chassis sits level regardless of what tilt is baked upstream.
      model.updateMatrixWorld(true);
      let chassis = model;
      while (chassis.children.length === 1) chassis = chassis.children[0];
      const bakedTilt = chassis.getWorldQuaternion(new THREE.Quaternion());
      const correction = bakedTilt.clone().invert();

      const plateTex = canvasTex(512, 256, (g, w, h) => {
        g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        const pad = 8;
        g.fillRect(pad, pad, w - pad * 2, h - pad * 2);
        g.fillStyle = '#1858b0';
        g.fillRect(pad, pad, 62, h - pad * 2);
        g.fillStyle = '#ffd23a';
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * Math.PI * 2;
          g.beginPath();
          g.arc(pad + 31 + Math.cos(a) * 20, h / 2 - 26 + Math.sin(a) * 20, 3, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#fff';
        g.font = '700 30px "Avenir Next", "Segoe UI", sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('D', pad + 31, h / 2 + 44);
        g.fillStyle = '#111';
        g.font = '900 118px "Avenir Next", "Segoe UI", sans-serif';
        g.fillText('EEVEE', pad + 62 + (w - pad * 2 - 62) / 2, h / 2 + 6);
      });
      model.traverse((o) => {
        if (o.isMesh && o.material && /^BodyMain/.test(o.material.name)) {
          o.material.color.setHex(0xc7cbd1);   // white -> silver
          o.material.metalness = 0.75;         // metallic shine (was 0, plain dielectric)
          o.material.roughness = Math.min(o.material.roughness, 0.18);
        }
        if (o.isMesh && o.material && o.material.name === 'NumberPlate') {
          o.material.map = plateTex;
          o.material.needsUpdate = true;
        }
      });

      let box = new THREE.Box3().setFromObject(model);
      let size = box.getSize(new THREE.Vector3());
      const axisSwap = size.x > size.z ? Math.PI / 2 : 0;   // long axis -> Z
      const yaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), axisSwap + ETRON_MODEL_YAW);
      model.quaternion.copy(yaw).multiply(correction);

      wrap.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(wrap);
      size = box.getSize(new THREE.Vector3());
      const s = 7.4 / Math.max(size.x, size.z);
      wrap.scale.setScalar(s);
      wrap.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(wrap);
      const center = box.getCenter(new THREE.Vector3());
      wrap.position.set(-center.x, -box.min.y, -center.z);
      playerCar.clear();
      playerCar.userData.wheels = [];
      playerCar.add(wrap);
      playerCar.add(blobShadow(5.6, 2.6));
      rearGlow.position.set(0, 1.1, -2.7);   // sit on the real model's tailgate
      attachRearGlow();
    }, (err) => { console.warn('e-tron model failed, keeping built-in car', err); });
  } catch (e) { console.warn('e-tron model failed, keeping built-in car', e); }
})();

// ---------------------------------------------------------- coins
const coinProto = (() => {
  const gold = new THREE.MeshStandardMaterial({
    color: 0xffc93a, metalness: 1.0, roughness: 0.25,
    emissive: 0x8a5a00, emissiveIntensity: 0.55
  });
  const grp = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.12, 22), gold);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.08, 8, 22), gold);
  face.rotation.x = Math.PI / 2;
  grp.add(face); grp.add(rim);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc23a, transparent: true, opacity: 0.38,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  glow.scale.set(2.7, 2.7, 1);
  grp.add(glow);
  return grp;
})();

// keep-out zones so ordinary coins/cones don't spawn on the giant coins
const GIANT_COIN_S = [TRACK.L * 0.34, TRACK.L * 0.70];
function inGiantZone(cs) {
  const m = ((cs % TRACK.L) + TRACK.L) % TRACK.L;
  return GIANT_COIN_S.some(g => m > g - 12 && m < g + 12);
}

const coins = [];
{
  const cf = mkFrame();
  let s = 130;
  while (s < TRACK.L - 120) {
    const n = 4 + Math.floor(rng() * 3);
    const weave = rng() < 0.3;
    const amp = weave ? 1.6 + rng() * 1.2 : 0;
    const ph = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const cs = s + i * 7.5;
      if (inGiantZone(cs)) continue;
      const d = amp * Math.sin(ph + i * 0.9);
      frame(cs, cf);
      const mesh = coinProto.clone();
      mesh.position.set(cf.p.x + cf.l.x * d, cf.p.y + 1.12, cf.p.z + cf.l.z * d);
      scene.add(mesh);
      coins.push({ s: cs, d, mesh, active: true, respawnT: 0, spin: rng() * Math.PI * 2 });
    }
    s += 95 + rng() * 80;
  }
}

// ---------------------------------------------------------- giant coins
// Oversized gold coins on the track. Touch one -> extreme-speed boost.
const giantCoins = [];
{
  const gf = mkFrame();
  for (const cs of GIANT_COIN_S) {
    frame(cs, gf);
    const mesh = coinProto.clone();
    mesh.scale.set(4.2, 4.2, 4.2);
    mesh.position.set(gf.p.x, gf.p.y + 3.4, gf.p.z);
    scene.add(mesh);
    giantCoins.push({ s: cs, d: 0, mesh, active: true, spin: rng() * Math.PI * 2, baseY: gf.p.y + 3.4 });
  }
}

// ---------------------------------------------------------- traffic cones
// Randomized barriers left/right of centre; clipping one adds CONE_PENALTY
// seconds to the lap time and knocks the cone flying.
const CONE_PENALTY = 0.25;
const coneTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#ff661c'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f5f2ea'; g.fillRect(0, h * 0.36, w, h * 0.22);
});
const coneMat = new THREE.MeshStandardMaterial({ map: coneTex, roughness: 0.7 });
const coneGeo = new THREE.CylinderGeometry(0.1, 0.55, 1.7, 12);
const cones = [];
{
  const cf = mkFrame();
  const N_CONES = 48;
  for (let i = 0; i < N_CONES; i++) {
    const cs = 60 + (i + rng()) / N_CONES * (TRACK.L - 130);
    if (inGiantZone(cs)) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const d = side * (1.2 + rng() * (HALF_W - 2.4));
    frame(cs, cf);
    const m = new THREE.Mesh(coneGeo, coneMat);
    const hx = cf.p.x + cf.l.x * d, hy = cf.p.y + 0.85, hz = cf.p.z + cf.l.z * d;
    m.position.set(hx, hy, hz);
    scene.add(m);
    cones.push({ mesh: m, s: cs, d, hx, hy, hz, active: true, deadT: -1, vx: 0, vy: 0, vz: 0 });
  }
}

// ---------------------------------------------------------- particles
const particleTex = glowTex;
class Burst {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = -1;
    this.dur = 1;
    this.gravity = 18;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      map: particleTex, size: 1.4, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }
  fire(x, y, z, opts) {
    const { speed = 12, up = 6, color = 0xffaa44, size = 1.4, dur = 1.0, gravity = 18 } = opts || {};
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up + up * 0.3;
      this.vel[i * 3 + 2] = Math.sin(a) * r;
    }
    this.mat.color.setHex(color);
    this.mat.size = size;
    this.dur = dur; this.gravity = gravity;
    this.life = 0;
    this.points.visible = true;
  }
  update(dt) {
    if (this.life < 0) return;
    this.life += dt;
    if (this.life >= this.dur) { this.life = -1; this.points.visible = false; return; }
    const f = this.life / this.dur;
    this.mat.opacity = 1 - f * f;
    for (let i = 0; i < this.n; i++) {
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
const bursts = Array.from({ length: 10 }, () => new Burst(48));
let burstIdx = 0;
function spawnBurst(x, y, z, opts) {
  bursts[burstIdx = (burstIdx + 1) % bursts.length].fire(x, y, z, opts);
}

// ---------------------------------------------------------- laser
const LASER_LEN = 150;
const laserBeam = new THREE.Mesh(
  new THREE.BoxGeometry(0.18, 0.18, LASER_LEN),
  new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false })
);
laserBeam.visible = false;
scene.add(laserBeam);
const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0xff4030, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false
}));
muzzle.scale.set(3.4, 3.4, 1);
scene.add(muzzle);

// ---------------------------------------------------------- audio
class SFX {
  constructor() { this.ctx = null; this.muted = false; }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    // base64-embedded m4a samples (fetch() is blocked over file://)
    const decodeSample = (b64, name, done) => {
      if (!b64) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.ctx.decodeAudioData(bytes.buffer, done,
        (e) => { console.warn(name + ' decode failed', e); });
    };
    this.pewBuf = null;
    this.crashBuf = null;
    this.weeBuf = null;
    decodeSample(window.PEW_M4A_B64, 'pew', (buf) => { this.pewBuf = buf; });
    decodeSample(window.CRASHED_M4A_B64, 'crashed', (buf) => { this.crashBuf = buf; });
    decodeSample(window.WEE_M4A_B64, 'wee', (buf) => { this.weeBuf = buf; });
    // engine: smooth electric/UFO hum — sine + triangle through a resonant
    // lowpass, gently swept by an LFO for a pleasant shimmering whir.
    this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 3.5;
    this.osc1 = this.ctx.createOscillator(); this.osc1.type = 'sine'; this.osc1.frequency.value = 72;
    this.osc2 = this.ctx.createOscillator(); this.osc2.type = 'triangle'; this.osc2.frequency.value = 108;
    const o2g = this.ctx.createGain(); o2g.gain.value = 0.22;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g); o2g.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();
    // LFO shimmer on the filter cutoff (the "UFO" wobble)
    this.lfo = this.ctx.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 5.5;
    this.lfoGain = this.ctx.createGain(); this.lfoGain.gain.value = 140;
    this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.engFilter.frequency);
    this.lfo.start();
    // airy high whine layered on top
    this.whine = this.ctx.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 300;
    this.whineGain = this.ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain); this.whineGain.connect(this.master);
    this.whine.start();
    // rumble (off-center warning)
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.rumble = this.ctx.createBufferSource();
    this.rumble.buffer = buf; this.rumble.loop = true;
    this.rumbleFilter = this.ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass'; this.rumbleFilter.frequency.value = 130;
    this.rumbleGain = this.ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumble.connect(this.rumbleFilter); this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);
    this.rumble.start();
  }
  engine(f, load) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(70 + f * 150, t, 0.09);
    this.osc2.frequency.setTargetAtTime(106 + f * 224, t, 0.09);
    this.engFilter.frequency.setTargetAtTime(520 + f * 1200, t, 0.12);
    this.engGain.gain.setTargetAtTime(load * 0.10, t, 0.12);
    this.lfo.frequency.setTargetAtTime(4.5 + f * 6, t, 0.15);
    this.whine.frequency.setTargetAtTime(260 + f * 540, t, 0.12);
    this.whineGain.gain.setTargetAtTime(load * 0.016, t, 0.12);
  }
  rumbleLevel(v) {
    if (!this.ctx || this.muted) return;
    this.rumbleGain.gain.setTargetAtTime(v * 0.16, this.ctx.currentTime, 0.09);
  }
  blip(freq0, freq1, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(freq1, 1), t + dur);
    g.gain.setValueAtTime(vol || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  laser() {
    if (!this.ctx || this.muted) return;
    if (!this.playSample(this.pewBuf, 0.8)) this.blip(1500, 190, 0.20, 'sawtooth', 0.16);  // synth fallback until decoded
  }
  playSample(buf, vol) {
    if (!this.ctx || this.muted || !buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(this.master);
    src.start();
    return true;
  }
  crash() { this.playSample(this.crashBuf, 0.9); }
  wee() { if (!this.playSample(this.weeBuf, 0.9)) this.go(); }
  coin() { this.blip(1318, 1318, 0.09, 'sine', 0.16); setTimeout(() => this.blip(1976, 1976, 0.14, 'sine', 0.16), 70); }
  beep() { this.blip(660, 660, 0.14, 'sine', 0.22); }
  go() { this.blip(990, 990, 0.5, 'sine', 0.25); }
  noiseHit(dur, freq, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }
  boom() { this.noiseHit(0.7, 2400, 0.5); this.blip(120, 40, 0.5, 'sine', 0.4); }
  splash() { this.noiseHit(1.1, 3200, 0.45); }
  bump() { this.noiseHit(0.18, 700, 0.3); }
  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.85;
  }
}
const sfx = new SFX();

// ---------------------------------------------------------- game state
const MAX_SPEED = 62;
const EXTREME_SPEED = MAX_SPEED + 55;    // giant-coin / backflip boost ceiling
const FALL_D = HALF_W + 0.4;   // just past the kerb and you're gone
// Score = lap time in seconds, lower is better. Coins/wrecks are "time bonuses"
// that shave seconds off the final time. No countdown — the clock counts UP.
const COIN_TIME_BONUS = 0.1;    // seconds cut from final time per coin
const WRECK_TIME_BONUS = 0.2;   // seconds cut per opponent wrecked
const GIANT_TIME_BONUS = 2.0;   // seconds cut per giant coin
const SCORES_KEY = 'sunsetRushScores';
const WHEELIE_PITCH = -0.55;  // nose-up tilt (about local X; negative = up here)

const player = {
  s: 0, d: 0, vd: 0, speed: 0,
  boostT: 0, dist: 0, yawVis: 0,
  fallVy: 0, fallY: 0, fallRoll: 0,
  elapsed: 0,                  // seconds elapsed this lap (counts up)
  bonus: 0,                    // seconds of time-bonus accumulated (subtracted)
  extremeT: 0,                 // seconds of extreme-speed boost remaining
  wheelieP: 0,                 // current wheelie/flip pitch (rad)
  flipT: -1,                   // backflip animation clock (-1 = idle)
  frame: mkFrame()
};
let state = 'count';          // count | race | fall | over
let stateT = 0;
let countShown = -1;
let runCoins = 0, runWrecks = 0;
let finishReason = null;      // 'finish' | 'fall'
let fireCooldown = 0, beamT = 0, shake = 0, bumpCd = 0, rearGlowT = 0;
let splashDone = false;
let popT = -1;                // "POP!" prompt clock (-1 = hidden)
let popCd = 4 + rng() * 6;    // countdown to next random POP! prompt

const keys = { left: false, right: false, fire: false, up: false };

// opponents
const OPP_N = 7;
const opps = [];
{
  const spread = [70, 150, 250, 380, 520, 700, 920];
  for (let i = 0; i < OPP_N; i++) {
    const g = buildMini();
    scene.add(g);
    opps.push({
      mesh: g, s: spread[i], d: (rng() * 2 - 1) * 2.4, dTarget: (rng() * 2 - 1) * 2.4,
      speed: MAX_SPEED * (0.55 + rng() * 0.14), state: 'alive', deadT: 0, respawnT: 0,
      vx: 0, vy: 0, vz: 0, frame: mkFrame(), splashed: false
    });
  }
}

// ---------------------------------------------------------- HUD refs
const el = {
  speed: document.getElementById('speedVal'),
  bignum: document.getElementById('bignum'),
  credit: document.getElementById('credit'),
  gameover: document.getElementById('gameover'),
  goHeadline: document.getElementById('goHeadline'),
  goStats: document.getElementById('goStats'),
  goRestart: document.getElementById('goRestart'),
  fadeout: document.getElementById('fadeout'),
  mute: document.getElementById('mute'),
  timer: document.getElementById('timer'),
  timerVal: document.getElementById('timerVal'),
  bonusPop: document.getElementById('bonusPop'),
  popText: document.getElementById('popText'),
  leaderboard: document.getElementById('leaderboard'),
  lbList: document.getElementById('lbList'),
  clearScores: document.getElementById('clearScores')
};
// format seconds as mm:ss.t (or ss.t under a minute)
function fmtTime(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (m > 0) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  return s.toFixed(1) + 's';
}

// ---------------------------------------------------------- leaderboard
function loadScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]');
    // keep only entries in the current {time, coins} shape (drops old score-based saves)
    return raw.filter(s => s && typeof s.time === 'number' && isFinite(s.time))
              .sort((a, b) => a.time - b.time);
  } catch (e) { return []; }
}
function renderLeaderboard() {
  const list = loadScores();
  el.lbList.innerHTML = '';
  if (list.length === 0) {
    el.lbList.innerHTML = '<li class="lbEmpty">No times yet</li>';
    return;
  }
  list.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="lbRank">' + (i + 1) + '</span>' +
      '<span class="lbScore">' + fmtTime(s.time) + '</span>';
    el.lbList.appendChild(li);
  });
}
// lower time wins; leaderboard only ranks by seconds
function saveScore(time) {
  const list = loadScores();
  list.push({ time: +time.toFixed(1), coins: runCoins });
  list.sort((a, b) => a.time - b.time);
  list.length = Math.min(list.length, 5);
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(list)); } catch (e) {}
  renderLeaderboard();
}
el.clearScores.addEventListener('click', () => {
  if (confirm('Clear all saved times?')) {
    try { localStorage.removeItem(SCORES_KEY); } catch (e) {}
    renderLeaderboard();
  }
});
renderLeaderboard();

let bonusPopTimer = null;
function popBonus(text, bad) {
  el.bonusPop.textContent = text;
  el.bonusPop.classList.toggle('bad', !!bad);
  el.bonusPop.classList.remove('show');
  void el.bonusPop.offsetWidth;
  el.bonusPop.classList.add('show');
  clearTimeout(bonusPopTimer);
  bonusPopTimer = setTimeout(() => { el.bonusPop.classList.remove('show'); }, 700);
}

// minimap
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');
const mmBase = document.createElement('canvas');
mmBase.width = mmBase.height = 256;
const mmMap = (() => {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of TRACK.pos) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 24;
  const sc = (256 - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (256 - (maxX - minX) * sc) / 2, oz = (256 - (maxZ - minZ) * sc) / 2;
  const map = (p, out) => { out[0] = ox + (p.x - minX) * sc; out[1] = oz + (p.z - minZ) * sc; };
  const g = mmBase.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 5; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  const pt = [0, 0];
  for (let i = 0; i <= TRACK.N; i += 6) {
    map(TRACK.pos[i % TRACK.N], pt);
    if (i === 0) g.moveTo(pt[0], pt[1]); else g.lineTo(pt[0], pt[1]);
  }
  g.stroke();
  // start notch
  map(TRACK.pos[0], pt);
  g.fillStyle = '#ffd04a';
  g.fillRect(pt[0] - 4, pt[1] - 4, 8, 8);
  return map;
})();

// ---------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
  else if (e.code === 'ArrowUp' || e.code === 'KeyW') { keys.up = true; e.preventDefault(); }
  else if (e.code === 'Space') { keys.fire = true; e.preventDefault(); }
  else if (e.code === 'KeyM') { toggleMute(); }
  sfx.init();
  if (sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  else if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
  else if (e.code === 'Space') keys.fire = false;
});
window.addEventListener('pointerdown', () => {
  sfx.init();
  if (sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
});
function toggleMute() {
  sfx.init();
  sfx.setMuted(!sfx.muted);
  el.mute.innerHTML = sfx.muted ? '&#128263;' : '&#128266;';
}
el.mute.addEventListener('click', toggleMute);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------- touch controls
// on-screen joystick steers (hold left/right); elsewhere a single tap fires
// the laser and a double tap pops a wheelie (timed, since taps can't hold)
let touchSteer = 0;      // analog steer from the joystick, +1 = car-left
let touchWheelieT = 0;   // seconds of double-tap wheelie remaining
let tapFireT = 0;        // brief fire pulse from a tap
const joy = document.getElementById('joy');
const joyKnob = document.getElementById('joyKnob');
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
}
let joyPointer = null;
function joyMove(clientX) {
  const r = joy.getBoundingClientRect();
  const span = r.width / 2 - 34;   // knob travel: pill half-width minus knob radius + pad
  const nx = clamp((clientX - (r.left + r.width / 2)) / span, -1, 1);
  joyKnob.style.transform = 'translateX(' + (nx * span).toFixed(1) + 'px)';
  touchSteer = -nx;   // +d (and +steer) is car-left, screen-right is -steer
}
joy.addEventListener('pointerdown', (e) => {
  joyPointer = e.pointerId;
  joy.setPointerCapture(e.pointerId);
  joyMove(e.clientX);
  e.preventDefault();
});
joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointer) joyMove(e.clientX); });
function joyEnd(e) {
  if (e.pointerId !== joyPointer) return;
  joyPointer = null;
  touchSteer = 0;
  joyKnob.style.transform = '';
}
joy.addEventListener('pointerup', joyEnd);
joy.addEventListener('pointercancel', joyEnd);

let tapId = null, tapDownT = 0, tapDownX = 0, tapDownY = 0, lastTapT = -1e9;
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  if (e.target.closest && e.target.closest('#joy, #mute, #leaderboard')) return;
  document.body.classList.add('touch');   // touch seen — make sure the joystick shows
  tapId = e.pointerId;
  tapDownT = performance.now();
  tapDownX = e.clientX; tapDownY = e.clientY;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerId !== tapId) return;
  tapId = null;
  const now = performance.now();
  if (now - tapDownT > 300) return;                                      // a hold, not a tap
  if (Math.hypot(e.clientX - tapDownX, e.clientY - tapDownY) > 14) return; // a swipe
  tapFireT = 0.06;                                                       // every tap: laser
  if (now - lastTapT < 350) { touchWheelieT = 0.85; lastTapT = -1e9; }   // double tap: wheelie
  else lastTapT = now;
});

// ---------------------------------------------------------- state helpers
function resetRun() {
  player.s = 0; player.d = 0; player.vd = 0; player.speed = 0;
  player.boostT = 0; player.dist = 0; player.yawVis = 0;
  player.fallVy = 0; player.fallRoll = 0;
  player.elapsed = 0; player.bonus = 0;
  player.extremeT = 0; player.wheelieP = 0; player.flipT = -1;
  touchWheelieT = 0; tapFireT = 0;
  runCoins = 0; runWrecks = 0;
  finishReason = null;
  splashDone = false;
  playerCar.visible = true;
  playerCar.rotation.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  popT = -1; popCd = 4 + rng() * 6;
  el.popText.classList.remove('show');
  rearGlowT = 0; rearGlow.material.emissiveIntensity = 0;
  for (let i = 0; i < opps.length; i++) {
    const o = opps[i];
    o.s = [70, 150, 250, 380, 520, 700, 920][i];
    o.d = (rng() * 2 - 1) * 2.4; o.dTarget = o.d;
    o.state = 'alive'; o.mesh.visible = true; o.splashed = false;
  }
  for (const c of coins) { c.active = true; c.mesh.visible = true; }
  for (const gc of giantCoins) { gc.active = true; gc.mesh.visible = true; }
  for (const cn of cones) {
    cn.active = true; cn.deadT = -1;
    cn.mesh.visible = true;
    cn.mesh.position.set(cn.hx, cn.hy, cn.hz);
    cn.mesh.rotation.set(0, 0, 0);
  }
  el.gameover.style.display = 'none';
  el.fadeout.style.opacity = '0';
  el.credit.style.display = 'block';
  state = 'count'; stateT = 0; countShown = -1;
  camSnap = true; camD = 0;
}

function showCount(n) {
  el.bignum.textContent = n === 0 ? 'GO!' : String(n);
  el.bignum.style.color = n === 0 ? '#6dffa0' : '#fff';
  el.bignum.classList.remove('pop');
  void el.bignum.offsetWidth;   // restart CSS animation
  el.bignum.classList.add('pop');
  if (n === 0) sfx.go(); else sfx.beep();
}

function fallOff() {
  state = 'fall';
  stateT = 0;
  player.fallVy = 2.5;
  player.fallY = 0;
  sfx.rumbleLevel(0);
  sfx.crash();
}

// final time score = raw elapsed minus accumulated time bonuses (lower is better)
function finalTime() {
  return Math.max(0, player.elapsed - player.bonus);
}

function endRun(reason) {
  state = 'over'; stateT = 0;
  finishReason = reason;
  if (reason === 'finish') {
    const prev = loadScores();
    const prevBest = prev.length ? prev[0].time : Infinity;
    const t = finalTime();
    saveScore(t);
    // only the final time — no other metrics; call out a new best
    const isHigh = +t.toFixed(1) < prevBest;
    el.goHeadline.textContent = fmtTime(t);
    el.goHeadline.classList.add('finish');
    el.goStats.textContent = isHigh ? 'HIGH SCORE' : '';
    el.goStats.classList.toggle('highscore', isHigh);
  } else {
    el.goHeadline.textContent = 'WIPED OUT';
    el.goHeadline.classList.remove('finish');
    el.goStats.textContent = '';
    el.goStats.classList.remove('highscore');
  }
  el.gameover.style.display = 'block';
  el.credit.style.display = 'none';
  el.popText.classList.remove('show');
}

function finishLap() {
  spawnBurst(playerCar.position.x, playerCar.position.y + 0.8, playerCar.position.z,
    { color: 0xffd45e, speed: 12, up: 10, size: 1.6, dur: 1.0 });
  sfx.go();
  endRun('finish');
}

// ---------------------------------------------------------- update
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 10, -25);
const camLook = new THREE.Vector3(0, 0, 0);
const camFrame = mkFrame(), lookFrame = mkFrame();
let camD = 0;
let camSnap = true;

function updatePlayer(dt) {
  const f = frame(player.s, player.frame);
  const offFrac = clamp(Math.abs(player.d) / HALF_W, 0, 1.35);

  // --- speed: auto-throttle, penalized off-center ---
  let target = MAX_SPEED * (1 - 0.5 * Math.pow(clamp(offFrac, 0, 1), 1.6));
  if (player.boostT > 0) { target += 17; player.boostT -= dt; }
  if (player.extremeT > 0) { target = EXTREME_SPEED; player.extremeT -= dt; }
  const wheelieOn = (keys.up || touchWheelieT > 0) && player.flipT < 0;
  if (wheelieOn) target -= 10;   // wheelie bleeds a little speed
  const rate = player.speed < target ? 21 : 9;
  player.speed = damp(player.speed, target, rate / Math.max(target, 1) * 3.2, dt);

  // --- wheelie / backflip pose ---
  // popping a wheelie while the "POP!" prompt is up triggers a backflip + boost
  if (wheelieOn && popT >= 0 && player.flipT < 0) {
    player.flipT = 0;
    player.extremeT = 5;
    popT = -1;
    el.popText.classList.remove('show');
    sfx.wee();
  }
  if (player.flipT >= 0) {
    player.flipT += dt;
    const FDUR = 0.9;
    if (player.flipT >= FDUR) { player.flipT = -1; player.wheelieP = 0; }
    else player.wheelieP = -(player.flipT / FDUR) * Math.PI * 2;   // full backflip
  } else {
    player.wheelieP = damp(player.wheelieP, wheelieOn ? WHEELIE_PITCH : 0, 10, dt);
  }

  // --- lateral physics ---
  const steer = clamp((keys.left ? 1 : 0) - (keys.right ? 1 : 0) + touchSteer, -1, 1);   // +d is car-left
  const authority = clamp(player.speed / 26, 0.2, 1);
  let steerAcc = steer * 26 * authority;
  // soft shoulder: fight outward steering near the edge
  if (Math.abs(player.d) > HALF_W * 0.82 && Math.sign(steerAcc) === Math.sign(player.d)) steerAcc *= 0.8;
  // centrifugal drift in corners (the core challenge)
  const centrifugal = -f.k * player.speed * player.speed * 0.30;
  // gentle self-centering
  const springK = Math.abs(player.d) > HALF_W * 0.78 ? 1.4 : 0.75;
  player.vd += (steerAcc + centrifugal - player.d * springK - player.vd * 2.5) * dt;
  player.d += player.vd * dt;

  if (Math.abs(player.d) > FALL_D) { fallOff(); return; }

  // --- advance along track ---
  player.s += player.speed * dt;
  player.dist += player.speed * dt;

  // --- place car ---
  frame(player.s, f);
  playerCar.position.set(f.p.x + f.l.x * player.d, f.p.y, f.p.z + f.l.z * player.d);
  const yawTrack = Math.atan2(f.t.x, f.t.z);
  const yawTargetVis = clamp(player.vd * 0.05, -0.4, 0.4);
  player.yawVis = damp(player.yawVis, yawTargetVis, 8, dt);
  playerCar.rotation.set(-Math.asin(clamp(f.t.y, -1, 1)) * 0.9, yawTrack + player.yawVis, -player.yawVis * 0.55, 'YXZ');
  // wheelie / backflip pitch about the car's lateral axis, plus a hop during the flip
  if (player.wheelieP !== 0) playerCar.rotateX(player.wheelieP);
  if (player.flipT >= 0) playerCar.position.y += Math.sin(player.flipT / 0.9 * Math.PI) * 2.4;

  for (const w of playerCar.userData.wheels) w.children[0].rotation.x += player.speed * dt / 0.375 * 0.35;

  // --- coins ---
  for (const c of coins) {
    if (!c.active) {
      c.respawnT -= dt;
      if (c.respawnT <= 0) { c.active = true; c.mesh.visible = true; }
      continue;
    }
    let ds = c.s - (player.s % TRACK.L);
    if (ds < -TRACK.L / 2) ds += TRACK.L;
    if (ds > TRACK.L / 2) ds -= TRACK.L;
    // hide missed coins once passed, before the camera drives through them
    c.mesh.visible = ds > -2.5;
    if (Math.abs(ds) < 2.6 && Math.abs(c.d - player.d) < 1.7) {
      c.active = false; c.mesh.visible = false; c.respawnT = 25;
      runCoins++;
      player.bonus += COIN_TIME_BONUS;
      popBonus('−' + COIN_TIME_BONUS.toFixed(1) + 's');
      player.boostT = Math.min(player.boostT + 1.35, 2.8);
      player.speed = Math.min(player.speed + 4, MAX_SPEED + 17);
      spawnBurst(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z,
        { color: 0xffd45e, speed: 7, up: 5, size: 1.0, dur: 0.7, gravity: 9 });
      sfx.coin();
    }
  }

  // --- giant coins: extreme-speed boost ---
  for (const gc of giantCoins) {
    if (!gc.active) continue;
    let ds = gc.s - (player.s % TRACK.L);
    if (ds < -TRACK.L / 2) ds += TRACK.L;
    if (ds > TRACK.L / 2) ds -= TRACK.L;
    gc.mesh.visible = ds > -5;
    if (Math.abs(ds) < 4.5 && Math.abs(gc.d - player.d) < 4.8) {
      gc.active = false; gc.mesh.visible = false;
      runCoins += 5;
      player.bonus += GIANT_TIME_BONUS;
      player.extremeT = Math.max(player.extremeT, 4.5);
      player.speed = EXTREME_SPEED;
      popBonus('EXTREME SPEED! −' + GIANT_TIME_BONUS.toFixed(1) + 's');
      spawnBurst(gc.mesh.position.x, gc.mesh.position.y, gc.mesh.position.z,
        { color: 0xffe27a, speed: 18, up: 13, size: 2.6, dur: 1.0, gravity: 10 });
      sfx.coin(); sfx.go();
    }
  }

  // --- traffic cones: clipping one adds a time penalty ---
  for (const cn of cones) {
    if (!cn.active) continue;
    let ds = cn.s - (player.s % TRACK.L);
    if (ds < -TRACK.L / 2) ds += TRACK.L;
    if (ds > TRACK.L / 2) ds -= TRACK.L;
    if (Math.abs(ds) < 2.4 && Math.abs(cn.d - player.d) < 1.55) {
      cn.active = false; cn.deadT = 0;
      // fling it forward and away from the car's side of impact
      const away = Math.sign(cn.d - player.d) || 1;
      cn.vx = f.t.x * player.speed * 0.45 + f.l.x * away * 6 + (Math.random() - 0.5) * 2;
      cn.vy = 6 + Math.random() * 3;
      cn.vz = f.t.z * player.speed * 0.45 + f.l.z * away * 6 + (Math.random() - 0.5) * 2;
      player.bonus -= CONE_PENALTY;
      popBonus('+' + CONE_PENALTY.toFixed(2) + 's CONE', true);
      shake = Math.min(shake + 0.18, 0.8);
      sfx.bump();
    }
  }

  // --- laser ---
  fireCooldown -= dt;
  if ((keys.fire || tapFireT > 0) && fireCooldown <= 0) {
    fireCooldown = 0.3;
    beamT = 0.07;
    rearGlowT = 0.28;
    sfx.laser();
    // hitscan in track space: ahead, roughly in front of the nose
    let hit = null, hitDs = 1e9;
    for (const o of opps) {
      if (o.state !== 'alive') continue;
      let ds = o.s - player.s;
      ds = ((ds % TRACK.L) + TRACK.L) % TRACK.L;
      if (ds > 3 && ds < 145) {
        const dd = Math.abs(o.d - player.d);
        if (dd < 3.4 - ds * 0.008 && ds < hitDs) { hit = o; hitDs = ds; }
      }
    }
    if (hit) {
      hit.state = 'dead'; hit.deadT = 0; hit.splashed = false;
      const hp = hit.mesh.position;
      hit.vx = (Math.random() - 0.5) * 6 + hit.frame.l.x * Math.sign(hit.d || 1) * 7;
      hit.vy = 9 + Math.random() * 4;
      hit.vz = (Math.random() - 0.5) * 6 + hit.frame.l.z * Math.sign(hit.d || 1) * 7;
      spawnBurst(hp.x, hp.y + 0.8, hp.z, { color: 0xff9a30, speed: 14, up: 9, size: 1.8, dur: 1.1 });
      spawnBurst(hp.x, hp.y + 0.6, hp.z, { color: 0xfff2c0, speed: 8, up: 6, size: 1.1, dur: 0.7 });
      runWrecks++;
      player.bonus += WRECK_TIME_BONUS;
      popBonus('−' + WRECK_TIME_BONUS.toFixed(1) + 's WRECK');
      shake = Math.min(shake + 0.35, 0.8);
      sfx.boom();
    }
  }
  if (beamT > 0) {
    beamT -= dt;
    laserBeam.visible = beamT > 0;
    muzzle.material.opacity = Math.max(beamT / 0.07, 0) * 0.95;
    tmpV.set(Math.sin(playerCar.rotation.y), 0, Math.cos(playerCar.rotation.y));  // car forward
    // shoot from the nose and reach well down-track
    laserBeam.position.copy(playerCar.position).addScaledVector(tmpV, LASER_LEN / 2 + 3);
    laserBeam.position.y += 0.62;
    laserBeam.rotation.y = playerCar.rotation.y;
    muzzle.position.copy(playerCar.position).addScaledVector(tmpV, 3.0);
    muzzle.position.y += 0.62;
  } else {
    laserBeam.visible = false;
    muzzle.material.opacity = 0;
  }
  // rear trunk-window red flare lingers briefly after each shot
  if (rearGlowT > 0) { rearGlowT -= dt; rearGlow.material.emissiveIntensity = clamp(rearGlowT / 0.28, 0, 1) * 3.4; }
  else rearGlow.material.emissiveIntensity = 0;

  // --- opponent collision (gentle bump) ---
  bumpCd -= dt;
  if (bumpCd <= 0) {
    for (const o of opps) {
      if (o.state !== 'alive') continue;
      let ds = o.s - player.s;
      ds = ((ds + TRACK.L / 2) % TRACK.L + TRACK.L) % TRACK.L - TRACK.L / 2;
      if (Math.abs(ds) < 4.3 && Math.abs(o.d - player.d) < 2.05) {
        player.speed *= 0.55;
        player.vd += Math.sign(player.d - o.d || (Math.random() - 0.5)) * 5.5;
        o.dTarget = clamp(o.d - Math.sign(player.d - o.d) * 2, -HALF_W + 2, HALF_W - 2);
        shake = Math.min(shake + 0.4, 0.8);
        bumpCd = 0.9;
        sfx.bump();
        break;
      }
    }
  }

  // --- lap finish: one full lap of track arc length completes the race ---
  if (player.dist >= TRACK.L) { finishLap(); return; }

  // --- feedback: engine, rumble, HUD handled in updateHUD ---
  sfx.engine(clamp(player.speed / (MAX_SPEED + 17), 0, 1), state === 'race' ? 1 : 0.35);
  sfx.rumbleLevel(clamp((offFrac - 0.45) / 0.55, 0, 1) * clamp(player.speed / 30, 0, 1));
}

function updateFall(dt) {
  player.fallVy -= 26 * dt;
  player.fallY += player.fallVy * dt;
  player.speed = Math.max(player.speed - 12 * dt, 6);
  player.s += player.speed * dt * 0.6;
  player.d += Math.sign(player.d) * dt * 7;
  player.fallRoll += dt * (2.4 * Math.sign(player.d));

  const f = frame(player.s, player.frame);
  playerCar.position.set(
    f.p.x + f.l.x * player.d,
    f.p.y + player.fallY,
    f.p.z + f.l.z * player.d);
  playerCar.rotation.z = -player.fallRoll;

  if (playerCar.position.y < 0.5 && !splashDone) {
    splashDone = true;
    spawnBurst(playerCar.position.x, 0.8, playerCar.position.z,
      { color: 0xff7ad8, speed: 12, up: 12, size: 1.9, dur: 1.3, gravity: 22 });
    spawnBurst(playerCar.position.x, 0.5, playerCar.position.z,
      { color: 0xc95bb8, speed: 7, up: 8, size: 1.4, dur: 1.0, gravity: 16 });
    sfx.splash();
  }
  if (playerCar.position.y < -2.5) {
    playerCar.visible = false;
    endRun('fall');
  }
  sfx.engine(0.2, 0.2);
}

function updateOpponents(dt) {
  for (const o of opps) {
    if (o.state === 'alive') {
      o.s += o.speed * dt;
      if (Math.random() < dt * 0.25) o.dTarget = (rng() * 2 - 1) * 2.6;
      o.d = damp(o.d, o.dTarget, 0.8, dt);
      const f = frame(o.s, o.frame);
      o.mesh.position.set(f.p.x + f.l.x * o.d, f.p.y, f.p.z + f.l.z * o.d);
      o.mesh.rotation.set(-Math.asin(clamp(f.t.y, -1, 1)) * 0.9, Math.atan2(f.t.x, f.t.z), 0, 'YXZ');
      for (const w of o.mesh.userData.wheels) w.children[0].rotation.x += o.speed * dt / 0.3 * 0.35;
      // if far behind the player, respawn ahead
      let rel = o.s - player.s;
      rel = ((rel + TRACK.L / 2) % TRACK.L + TRACK.L) % TRACK.L - TRACK.L / 2;
      if (rel < -60) {
        o.s = player.s + 350 + rng() * 350;
        o.d = (rng() * 2 - 1) * 2.4; o.dTarget = o.d;
      }
    } else if (o.state === 'dead') {
      o.deadT += dt;
      o.vy -= 24 * dt;
      o.mesh.position.x += o.vx * dt;
      o.mesh.position.y += o.vy * dt;
      o.mesh.position.z += o.vz * dt;
      o.mesh.rotation.x += 3.2 * dt;
      o.mesh.rotation.z += 4.1 * dt;
      if (o.mesh.position.y < 0.4 && !o.splashed) {
        o.splashed = true;
        spawnBurst(o.mesh.position.x, 0.7, o.mesh.position.z,
          { color: 0xff7ad8, speed: 9, up: 9, size: 1.5, dur: 1.0, gravity: 20 });
        sfx.splash();
      }
      if (o.mesh.position.y < -3) {
        o.state = 'respawning';
        o.mesh.visible = false;
        o.respawnT = 2.5 + rng() * 2;
      }
    } else {
      o.respawnT -= dt;
      if (o.respawnT <= 0) {
        o.state = 'alive';
        o.mesh.visible = true;
        o.mesh.rotation.set(0, 0, 0);
        o.s = player.s + 380 + rng() * 320;
        o.d = (rng() * 2 - 1) * 2.4; o.dTarget = o.d;
      }
    }
  }
}

function updateCamera(dt) {
  camD = damp(camD, clamp(player.d, -HALF_W, HALF_W) * 0.6, 4, dt);
  camera.up.set(0, 1, 0);


  if (state === 'count') {
    // sweep from the side-front around to the chase position
    const k = clamp(stateT / 3.4, 0, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    const ang = (1 - ease) * 1.30;
    frame(player.s, camFrame);
    const fwd = tmpV.set(camFrame.t.x, 0, camFrame.t.z).normalize();
    const c = Math.cos(ang), s = Math.sin(ang);
    tmpV2.set(fwd.x * c - fwd.z * s, 0, fwd.x * s + fwd.z * c);
    const dist = 8.26 - 2.52 * (1 - ease), height = 3.36 - 1.68 * (1 - ease);
    camPos.copy(playerCar.position).addScaledVector(tmpV2, -dist);
    camPos.y += height;
    camera.position.copy(camPos);
    tmpV.copy(playerCar.position).addScaledVector(tmpV2, 8 * ease);
    tmpV.y += 1.2 + 0.8 * ease;
    camLook.lerp(tmpV, camSnap ? 1 : 1 - Math.exp(-dt * 8));
    camSnap = false;
    camera.lookAt(camLook);
  } else {
    // rigid track-space chase: no smoothing along the direction of travel,
    // otherwise the lag (v/k) drops the car out of frame at speed
    frame(player.s - 8.54, camFrame);
    camPos.copy(camFrame.p).addScaledVector(camFrame.l, camD);
    camPos.y += 3.36;
    if (shake > 0) {
      shake = Math.max(shake - dt * 1.6, 0);
      camPos.x += (Math.random() - 0.5) * shake;
      camPos.y += (Math.random() - 0.5) * shake * 0.6;
      camPos.z += (Math.random() - 0.5) * shake;
    }
    camera.position.copy(camPos);
    if (state === 'fall' || state === 'over') {
      tmpV.copy(playerCar.position);
      tmpV.y = Math.max(tmpV.y, 0.5);
      camLook.lerp(tmpV, camSnap ? 1 : 1 - Math.exp(-dt * 6));
    } else {
      frame(player.s + 13, lookFrame);
      camLook.copy(lookFrame.p).addScaledVector(lookFrame.l, camD * 0.9);
      camLook.y += 2.1;
    }
    camSnap = false;
    camera.lookAt(camLook);
    camera.rotation.z += -player.yawVis * 0.25;
  }

  const speedFrac = clamp(player.speed / MAX_SPEED, 0, 1.3);
  const targetFov = 62 + speedFrac * 11 + (player.boostT > 0 ? 5 : 0);
  camera.fov = damp(camera.fov, targetFov, 4, dt);
  camera.updateProjectionMatrix();

  sky.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 2900);
  ocean.position.set(Math.round(camera.position.x / 20) * 20, 0, Math.round(camera.position.z / 20) * 20);
}

let lastSpeedShown = -1, lastTimeShown = -1;
function updateHUD() {
  const kmh = Math.round(player.speed * 3.6);
  if (kmh !== lastSpeedShown) { el.speed.textContent = kmh; lastSpeedShown = kmh; }
  // live net lap time (elapsed minus time bonuses) — this is your score, lower is better
  const timeShown = fmtTime(finalTime());
  if (timeShown !== lastTimeShown) { el.timerVal.textContent = timeShown; lastTimeShown = timeShown; }

  // minimap
  mmCtx.clearRect(0, 0, 256, 256);
  mmCtx.drawImage(mmBase, 0, 0);
  const pt = [0, 0];
  mmMap(playerCar.position, pt);
  mmCtx.fillStyle = '#7de3ff';
  mmCtx.shadowColor = '#7de3ff'; mmCtx.shadowBlur = 8;
  mmCtx.beginPath(); mmCtx.arc(pt[0], pt[1], 6, 0, Math.PI * 2); mmCtx.fill();
  mmCtx.shadowBlur = 0;
  mmCtx.fillStyle = '#ff5040';
  for (const o of opps) {
    if (o.state !== 'alive') continue;
    mmMap(o.mesh.position, pt);
    mmCtx.beginPath(); mmCtx.arc(pt[0], pt[1], 4, 0, Math.PI * 2); mmCtx.fill();
  }
}

// ---------------------------------------------------------- main loop
const clock = new THREE.Clock();
let coinSpinT = 0;

function step(dt) {
  stateT += dt;
  timeU.value += dt;
  coinSpinT += dt;
  if (touchWheelieT > 0) touchWheelieT -= dt;
  if (tapFireT > 0) tapFireT -= dt;

  if (state === 'count') {
    const n = 3 - Math.floor(stateT);
    if (n !== countShown && n >= 0) { countShown = n; showCount(n); }
    if (stateT >= 3.55) {
      state = 'race'; stateT = 0;
      showCount(0);
      el.credit.style.display = 'none';
    }
    // roll up to the line slowly during countdown
    player.speed = damp(player.speed, 4, 1.2, dt);
    player.s += player.speed * dt;
    const f = frame(player.s, player.frame);
    playerCar.position.set(f.p.x + f.l.x * player.d, f.p.y, f.p.z + f.l.z * player.d);
    playerCar.rotation.set(0, Math.atan2(f.t.x, f.t.z), 0);
    sfx.engine(0.15 + (3 - Math.max(stateT, 0)) * 0.04, 0.4);
  } else if (state === 'race') {
    updatePlayer(dt);
    if (state === 'race') {
      player.elapsed += dt;   // lap stopwatch counts up
      updatePop(dt);
    }
  } else if (state === 'fall') {
    updateFall(dt);
  } else if (state === 'over') {
    const left = Math.ceil(3 - stateT);
    el.goRestart.textContent = 'RESTARTING IN ' + Math.max(left, 0) + '…';
    if (stateT > 2.3) el.fadeout.style.opacity = '1';
    if (stateT >= 3) resetRun();
    sfx.engine(0.1, 0.15);
    sfx.rumbleLevel(0);
  }

  updateOpponents(dt);
  for (const b of bursts) b.update(dt);

  // spin coins
  for (const c of coins) {
    if (!c.active) continue;
    c.mesh.rotation.y = coinSpinT * 2.6 + c.spin;
    c.mesh.position.y = c.mesh.userData.baseY === undefined
      ? (c.mesh.userData.baseY = c.mesh.position.y)
      : c.mesh.userData.baseY + Math.sin(coinSpinT * 2.2 + c.spin) * 0.16;
  }
  // spin the giant coins
  for (const gc of giantCoins) {
    if (!gc.active) continue;
    gc.mesh.rotation.y = coinSpinT * 1.6 + gc.spin;
    gc.mesh.position.y = gc.baseY + Math.sin(coinSpinT * 1.6 + gc.spin) * 0.5;
  }
  // tumble knocked-over cones
  for (const cn of cones) {
    if (cn.deadT < 0) continue;
    cn.deadT += dt;
    cn.vy -= 22 * dt;
    cn.mesh.position.x += cn.vx * dt;
    cn.mesh.position.y += cn.vy * dt;
    cn.mesh.position.z += cn.vz * dt;
    cn.mesh.rotation.x += 6.5 * dt;
    cn.mesh.rotation.z += 5.2 * dt;
    if (cn.deadT > 1.3) { cn.mesh.visible = false; cn.deadT = -1; }
  }

  updateCamera(dt);
  updateHUD();
}

// random "POP!" prompt: pop a wheelie while it's showing to backflip + boost
function updatePop(dt) {
  if (popT >= 0) {
    popT += dt;
    if (popT >= 3) { popT = -1; el.popText.classList.remove('show'); }
    return;
  }
  popCd -= dt;
  if (popCd <= 0) {
    popCd = 9 + rng() * 10;
    popT = 0;
    el.popText.classList.add('show');
  }
}

function tick() {
  requestAnimationFrame(tick);
  step(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}

resetRun();

// debug fast-forward for automated screenshots: ?warp=8&steer=left&fire
{
  const q = new URLSearchParams(location.search);
  const warp = parseFloat(q.get('warp') || '0');
  if (warp > 0) {
    const total = Math.floor(Math.min(warp, 120) * 60);
    const steerDir = q.get('steer');
    const hold = Math.max(parseInt(q.get('hold') || '55', 10) || 55, 1);
    const fire = q.has('fire');
    for (let i = 0; i < total; i++) {
      keys.left = steerDir === 'left' && i > total - hold;
      keys.right = steerDir === 'right' && i > total - hold;
      keys.fire = fire && i > total - 3;
      step(1 / 60);
    }
    keys.left = keys.right = keys.fire = false;
  }
  if (q.has('debug')) {
    const d = document.getElementById('err');
    d.style.display = 'block';
    let nearestOpp = 1e9;
    for (const o of opps) {
      if (o.state !== 'alive') continue;
      let ds = ((o.s - player.s) % TRACK.L + TRACK.L) % TRACK.L;
      if (ds < nearestOpp) nearestOpp = ds;
    }
    d.textContent = JSON.stringify({
      state, s: +player.s.toFixed(1), d: +player.d.toFixed(2), speed: +player.speed.toFixed(1),
      nearestOpp: +nearestOpp.toFixed(1),
      car: playerCar.position.toArray().map(v => +v.toFixed(1)),
      cam: camera.position.toArray().map(v => +v.toFixed(1)),
      look: camLook.toArray().map(v => +v.toFixed(1)),
      camToCar: +camera.position.distanceTo(playerCar.position).toFixed(1)
    });
  }
}
tick();
})();
