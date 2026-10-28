import * as THREE from "three";

// ================= VARIANT (edit only this line) =================
const STUDENT_ID = "241280";
// =================================================================

const digits = STUDENT_ID.replace(/\D/g, "");
const d = (k) => Number(digits[digits.length - k]); // k=1 -> last digit
const PRODUCT_NAMES = ["Floor lamp", "Bar stool", "Coffee table", "Potted plant", "Bookshelf",
  "Traffic cone", "Office chair", "Bedside table", "Floor speaker", "Standing desk"];
const PRODUCT_ID = d(1);
const MULTI_MODE = d(2) % 2 === 0;              // 0 -> multi (max 5), 1 -> single
const TOLERANCE_DEG = [8, 12, 16][d(3) % 3];    // surface tolerance
const FACE_USER = d(4) % 2 === 0;               // 0 -> face user, 1 -> keep hit pose
const MAX_PRODUCTS = 5;
const VARIANT_TEXT = `${PRODUCT_NAMES[PRODUCT_ID]}, ${MULTI_MODE ? "multi (max " + MAX_PRODUCTS + ")" : "single"}, ` +
  `${TOLERANCE_DEG}°, ${FACE_USER ? "faces user" : "hit-pose orientation"}`;

// global scene values
let btn, gl, glCanvas, camera, scene, renderer, controller, reticle;
// global xr values
let xrSession = null, hitTestSource = null, hitTestSourceRequested = false;
let localSpace = null, viewerSpace = null;
let placeRequested = false;
let anchorsOn = false;
let sessionState = "not started";
let reticleState = "none";
let trackingLost = false;
let firstFrameLogged = false;
const placed = []; // { object, anchor, yaw }

const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const trackingEl = document.getElementById("tracking");
const fallbackEl = document.getElementById("fallback");
const UP = new THREE.Vector3(0, 1, 0);
const COLOR_OK = 0x00e676, COLOR_BAD = 0xff1744;

loadScene();

function loadScene() {
  document.getElementById("title").textContent = `AR product preview – ${STUDENT_ID} – ${VARIANT_TEXT}`;
  document.title = `PA3 – AR Hit-Testing – ${STUDENT_ID}`;

  // Porting fix 1: r163+ supports only WebGL2, and the context must be XR-compatible
  glCanvas = document.createElement("canvas");
  gl = glCanvas.getContext("webgl2", { xrCompatible: true, antialias: true, alpha: true });

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.0));
  const dir = new THREE.DirectionalLight(0xffffff, 2.0);
  dir.position.set(1, 3, 2);
  scene.add(dir);

  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(glCanvas);

  // Porting fix 2: RingBufferGeometry was removed -> RingGeometry
  const ringGeo = new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLOR_OK }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", () => { placeRequested = true; }); // only a flag
  scene.add(controller);

  // size check (Task C)
  const test = buildProduct();
  test.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(test).getSize(new THREE.Vector3());
  console.log(`[size] ${PRODUCT_NAMES[PRODUCT_ID]} W x H x D (m):`, size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));

  btn = document.getElementById("btn");
  btn.addEventListener("click", () => (xrSession ? endXRSession() : onRequestSession()));
  document.getElementById("clear").addEventListener("click", clearAll);
  // taps on the panel must not place a product
  overlay.addEventListener("beforexrselect", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  if (!navigator.xr) {
    showFallback("WebXR is not available in this browser. Use Chrome on an ARCore Android phone over HTTPS.");
  } else {
    navigator.xr.isSessionSupported("immersive-ar").then((ok) => {
      if (ok) { btn.hidden = false; }
      else showFallback("immersive-ar is not supported on this device/browser. Use Chrome on an ARCore Android phone.");
    }).catch(() => showFallback("Could not check immersive-ar support."));
  }
  updateOverlay();
}

function showFallback(msg) {
  fallbackEl.textContent = msg;
  fallbackEl.hidden = false;
  sessionState = "unsupported";
  updateOverlay();
}

// ---------- product: one Group, origin at base centre, metres, front = +z ----------
function mat(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 }); }
function box(w, h, dpt, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dpt), mat(color));
  m.position.set(x, y, z); return m;
}
function cyl(rt, rb, h, color, x, y, z, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z); return m;
}

function buildProduct() {
  const g = new THREE.Group();
  switch (PRODUCT_ID) {
    case 0: { // Floor lamp: H 1.60, base Ø0.30, shade Ø0.40
      g.add(cyl(0.15, 0.15, 0.03, 0x333333, 0, 0.015, 0));
      g.add(cyl(0.012, 0.012, 1.32, 0x999999, 0, 0.03 + 0.66, 0));
      g.add(cyl(0.12, 0.20, 0.25, 0xfff3c4, 0, 1.60 - 0.125, 0));
      break;
    }
    case 1: { // Bar stool: seat height 0.75, seat Ø0.35, 4 legs
      g.add(cyl(0.175, 0.175, 0.04, 0x8d5524, 0, 0.73, 0));
      for (const [x, z] of [[0.11, 0.11], [-0.11, 0.11], [0.11, -0.11], [-0.11, -0.11]])
        g.add(cyl(0.015, 0.015, 0.71, 0x222222, x, 0.355, z, 12));
      g.add(cyl(0.13, 0.13, 0.015, 0x222222, 0, 0.30, 0)); // foot ring
      break;
    }
    case 2: { // Coffee table: top 1.00 x 0.50, height 0.45, 4 legs
      g.add(box(1.0, 0.04, 0.5, 0xa0522d, 0, 0.43, 0));
      for (const [x, z] of [[0.46, 0.21], [-0.46, 0.21], [0.46, -0.21], [-0.46, -0.21]])
        g.add(box(0.04, 0.41, 0.04, 0x3e2723, x, 0.205, z));
      break;
    }
    case 3: { // Potted plant: pot Ø0.30 x 0.35, foliage Ø0.60, total 1.00
      g.add(cyl(0.15, 0.12, 0.35, 0xb5651d, 0, 0.175, 0));
      g.add(cyl(0.14, 0.14, 0.02, 0x4e342e, 0, 0.35, 0));
      const fol = new THREE.Mesh(new THREE.SphereGeometry(0.30, 32, 16), mat(0x2e7d32));
      fol.position.set(0, 0.70, 0); g.add(fol);
      break;
    }
    case 4: { // Bookshelf: 0.80 W x 0.30 D x 1.80 H, 4 shelves
      g.add(box(0.02, 1.80, 0.30, 0x8d6e63, 0.39, 0.90, 0));
      g.add(box(0.02, 1.80, 0.30, 0x8d6e63, -0.39, 0.90, 0));
      g.add(box(0.76, 1.80, 0.01, 0x6d4c41, 0, 0.90, -0.145));
      for (const y of [0.01, 0.60, 1.20, 1.79]) g.add(box(0.76, 0.02, 0.30, 0xa1887f, 0, y, 0));
      break;
    }
    case 5: { // Traffic cone: H 0.70, base 0.40 x 0.40
      g.add(box(0.40, 0.03, 0.40, 0x222222, 0, 0.015, 0));
      g.add(cyl(0.02, 0.15, 0.67, 0xff6d00, 0, 0.03 + 0.335, 0));
      g.add(cyl(0.075, 0.095, 0.08, 0xffffff, 0, 0.40, 0)); // reflective band
      break;
    }
    case 6: { // Office chair: seat 0.50 x 0.50 at 0.48, backrest top 0.95, 5-arm base
      g.add(box(0.50, 0.06, 0.50, 0x263238, 0, 0.45, 0));
      g.add(box(0.45, 0.45, 0.04, 0x263238, 0, 0.725, -0.23));
      g.add(cyl(0.025, 0.025, 0.36, 0x9e9e9e, 0, 0.24, 0, 16));
      for (let i = 0; i < 5; i++) {
        const arm = new THREE.Group();
        arm.add(box(0.22, 0.03, 0.04, 0x424242, 0.11, 0.045, 0));
        arm.add(cyl(0.025, 0.025, 0.03, 0x111111, 0.215, 0.015, 0, 12)); // caster
        arm.rotation.y = (i * 2 * Math.PI) / 5;
        g.add(arm);
      }
      break;
    }
    case 7: { // Bedside table: 0.45 W x 0.40 D x 0.55 H, one drawer front
      g.add(box(0.45, 0.55, 0.38, 0xd7ccc8, 0, 0.275, -0.01));
      g.add(box(0.40, 0.15, 0.01, 0xbcaaa4, 0, 0.42, 0.185));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.01, 12, 8), mat(0x555555));
      knob.position.set(0, 0.42, 0.195); g.add(knob);
      break;
    }
    case 8: { // Floor speaker: 0.25 W x 0.30 D x 1.00 H, 2 driver discs on front
      g.add(box(0.25, 1.00, 0.29, 0x212121, 0, 0.50, -0.005));
      for (const [r, y] of [[0.05, 0.82], [0.09, 0.55]]) {
        const disc = cyl(r, r, 0.01, 0x9e9e9e, 0, y, 0.145);
        disc.rotation.x = Math.PI / 2; g.add(disc);
      }
      break;
    }
    case 9: { // Standing desk: top 1.40 x 0.70 at 1.10, 2 legs with feet
      g.add(box(1.40, 0.04, 0.70, 0xeeeeee, 0, 1.08, 0));
      for (const x of [0.60, -0.60]) {
        g.add(box(0.06, 1.02, 0.06, 0x424242, x, 0.55, 0));
        g.add(box(0.08, 0.04, 0.65, 0x424242, x, 0.02, 0));
      }
      break;
    }
  }
  return g;
}

// ---------- session life cycle (no ARButton) ----------
function onRequestSession() {
  sessionState = "requesting";
  updateOverlay();
  navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["anchors", "dom-overlay"],
    domOverlay: { root: overlay },
  }).then(onSessionStarted).catch((err) => {
    sessionState = "failed: " + err.message;
    updateOverlay();
  });
}

async function onSessionStarted(session) {
  xrSession = session;
  btn.textContent = "STOP AR";
  btn.style.background = "#c62828";
  session.addEventListener("end", onSessionEnd); // fires for STOP and for system end

  const feats = session.enabledFeatures || [];
  anchorsOn = feats.includes("anchors");
  console.log("[session] enabledFeatures:", feats);

  renderer.xr.setReferenceSpaceType("local");
  await renderer.xr.setSession(session);
  localSpace = renderer.xr.getReferenceSpace();
  sessionState = "running";
  firstFrameLogged = false;
  animate();
}

function animate() {
  renderer.setAnimationLoop(render);
}

const tmpPos = new THREE.Vector3(), tmpQuat = new THREE.Quaternion(), tmpScale = new THREE.Vector3();
const normal = new THREE.Vector3();

function render(time, frame) {
  if (frame && xrSession) {
    // viewer pose + tracking-lost check
    const viewerPose = frame.getViewerPose(localSpace);
    trackingLost = !viewerPose || viewerPose.emulatedPosition;

    if (viewerPose && !firstFrameLogged) {
      const p = viewerPose.transform.position;
      console.log("[E1] camera position at start (local):", p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3));
      firstFrameLogged = true;
    }

    // Porting fix 3: request the hit-test source ONCE (flag set before the async call)
    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true;
      xrSession.requestReferenceSpace("viewer").then((vs) => {
        viewerSpace = vs;
        return xrSession.requestHitTestSource({ space: vs });
      }).then((src) => {
        if (xrSession) hitTestSource = src; else src.cancel();
      }).catch((e) => console.warn("hit-test source failed", e));
    }

    let hit = null, hitPose = null, allowed = false, angle = 0;
    if (hitTestSource && !trackingLost) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) {
        hit = results[0];
        hitPose = hit.getPose(localSpace);
      }
    }

    if (hitPose) {
      reticle.visible = true;
      reticle.matrix.fromArray(hitPose.transform.matrix);
      // surface normal = y-axis column of the pose matrix (elements 4,5,6)
      const m = hitPose.transform.matrix;
      normal.set(m[4], m[5], m[6]).normalize();
      angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.dot(UP), -1, 1)));
      allowed = angle <= TOLERANCE_DEG;
      reticle.material.color.setHex(allowed ? COLOR_OK : COLOR_BAD);
      reticleState = allowed ? `valid (${angle.toFixed(1)}°)` : `too tilted (${angle.toFixed(1)}°)`;
    } else {
      reticle.visible = false;
      reticleState = "none";
    }

    // placement happens here, with this frame's hit
    if (placeRequested) {
      placeRequested = false;
      if (hitPose && allowed && !trackingLost) placeProduct(hit, hitPose, viewerPose);
    }

    // anchored products follow their anchors every frame
    if (anchorsOn) {
      for (const item of placed) {
        if (!item.anchor) continue;
        const ap = frame.getPose(item.anchor.anchorSpace, localSpace);
        if (ap) setProductMatrix(item, ap.transform.matrix);
      }
    }
  }
  updateOverlay();
  renderer.render(scene, camera);
}

function setProductMatrix(item, poseMatrixArray) {
  const m = new THREE.Matrix4().fromArray(poseMatrixArray);
  if (FACE_USER) {
    // keep position only; rotate about y by the stored yaw
    m.decompose(tmpPos, tmpQuat, tmpScale);
    item.object.matrix.makeRotationY(item.yaw).setPosition(tmpPos);
  } else {
    item.object.matrix.copy(m); // orientation of the hit pose
  }
}

function placeProduct(hit, hitPose, viewerPose) {
  // facing rule: yaw so the product's front (+z) points at the camera
  const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
  const cam = viewerPose.transform.position;
  const yaw = Math.atan2(cam.x - pos.x, cam.z - pos.z);

  // E1 / E3 evidence
  console.log("[E1] camera position at placement (local):", cam.x.toFixed(3), cam.y.toFixed(3), cam.z.toFixed(3));
  if (viewerSpace) console.log("[E1] hit.getPose(viewerSpace):", Array.from(hit.getPose(viewerSpace).transform.matrix).map((v) => v.toFixed(3)));
  console.log("[E1/E3] hit.getPose(localSpace) (column-major):", Array.from(hitPose.transform.matrix).map((v) => v.toFixed(3)));

  let item;
  if (!MULTI_MODE && placed.length > 0) {
    item = placed[0]; // single mode: move it
    deleteAnchor(item);
  } else {
    if (placed.length >= MAX_PRODUCTS) removeItem(placed[0]); // 6th tap removes oldest
    const object = buildProduct();
    object.matrixAutoUpdate = false;
    scene.add(object);
    item = { object, anchor: null, yaw };
    placed.push(item);
  }
  item.yaw = yaw;
  setProductMatrix(item, hitPose.transform.matrix); // immediate placement (also the fallback)

  if (anchorsOn && hit.createAnchor) {
    hit.createAnchor().then((anchor) => {
      if (placed.includes(item) && !item.anchor) item.anchor = anchor;
      else anchor.delete(); // item removed/moved before the anchor arrived
    }).catch((e) => console.warn("createAnchor failed", e));
  }
}

function deleteAnchor(item) {
  if (item.anchor) {
    try { item.anchor.delete(); } catch (e) { /* session already ended */ }
    item.anchor = null;
  }
}

function removeItem(item) {
  deleteAnchor(item);
  scene.remove(item.object);
  item.object.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  const i = placed.indexOf(item);
  if (i >= 0) placed.splice(i, 1);
}

function clearAll() {
  while (placed.length) removeItem(placed[0]);
  updateOverlay();
}

function endXRSession() {
  if (xrSession) xrSession.end(); // the 'end' event calls onSessionEnd
}

function onSessionEnd() {
  if (hitTestSource) { try { hitTestSource.cancel(); } catch (e) { /* already cancelled */ } }
  hitTestSource = null;
  hitTestSourceRequested = false;
  viewerSpace = null;
  clearAll();
  renderer.setAnimationLoop(null);
  xrSession = null;
  localSpace = null;
  placeRequested = false;
  reticle.visible = false;
  reticleState = "none";
  trackingLost = false;
  sessionState = "ended";
  btn.textContent = "START AR";
  btn.style.background = "#2e7d32";
  updateOverlay();
}

function updateOverlay() {
  trackingEl.textContent = trackingLost ? "Tracking lost — move the phone slowly" : "";
  statusEl.textContent =
    `ID ${STUDENT_ID} | ${VARIANT_TEXT}\n` +
    `session: ${sessionState}\n` +
    `reticle: ${reticleState}\n` +
    `anchors: ${xrSession ? (anchorsOn ? "on" : "off") : "-"}\n` +
    `products: ${placed.length}${MULTI_MODE ? " / " + MAX_PRODUCTS : ""}`;
}