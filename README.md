# PA3 — AR product preview with hit-testing

**Student ID:** 241280
**Variant:** Floor lamp (1.60 m) · multi mode (max 5) · surface tolerance 16° · keeps hit-pose orientation
**Device:** [phone model], Android [version], Chrome [version]

## How to run on the device
1. Open the GitHub Pages HTTPS link in Chrome on an ARCore Android phone (or serve locally and use chrome://inspect port forwarding).
2. Tap **START AR**, move the phone over the floor until the ring appears.
3. Green ring = surface within 16° (tap to place), red = too tilted (taps ignored).
4. **Clear** removes all lamps and their anchors; **STOP AR** or the Android back gesture ends the session and resets the page.

Three.js 0.186.1 via an import map. No ARButton, no frameworks, no model files.

## Porting notes (Ch. 7 → Three.js 0.186.1)
1. **WebGLRenderer constructor throws.** Ch. 7 uses `getContext("webgl")`; since r163 Three.js supports only WebGL 2. Fix: `getContext("webgl2", { xrCompatible: true })`, passed with `canvas` to `WebGLRenderer`.
2. **Geometry constructors are undefined.** `RingBufferGeometry` and other `*BufferGeometry` names were removed. Fix: `RingGeometry`, `BoxGeometry`, `CylinderGeometry`.
3. **A new hit-test source is requested every frame.** The flag was not set before the async request. Fix: set `hitTestSourceRequested = true` before `requestHitTestSource`, reset it and call `hitTestSource.cancel()` in `onSessionEnd`.