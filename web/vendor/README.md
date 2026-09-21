# Vendored emulator

A copy of [v86](https://github.com/copy/v86) 0.5.462, taken from the npm package,
plus the two BIOS images its demos use. Vendored rather than installed because
there is no build step on purpose: what is in `web/` is what runs.

| File | What it is |
|---|---|
| `libv86.js` | The emulator. A standalone bundle that exposes `V86` globally. |
| `v86.wasm` | Its WebAssembly core — the build used when the browser supports it. |
| `v86-fallback.wasm` | The compatibility build. **Do not delete.** See below. |
| `seabios.bin` | Firmware the machine needs before anything else can load. |
| `vgabios.bin` | The video BIOS, which is what gets a picture onto the canvas. |
| `LICENSE.v86` | BSD-2-Clause. Must ship with any bundle of the emulator. |

## Do not delete the fallback

`libv86.js` is not given a path for the fallback — it **derives** one from
`wasm_path` by string replacement:

```js
let m = "v86.wasm", l = "v86-fallback.wasm";
if (a.wasm_path) {
  m = a.wasm_path;
  l = m.replace("v86.wasm", "v86-fallback.wasm");
}
```

So because the page sets `wasm_path: "vendor/v86.wasm"`, the fallback is looked
for at `vendor/v86-fallback.wasm`, and it is loaded automatically when the main
build fails to instantiate — on a browser whose WebAssembly is missing the
features that build requires. It looks unused, and it is not: delete it and those
browsers get a failed fetch instead of an emulator, on the one path where nothing
else can save them. It is 2 MB, and it is worth it.

## Re-vendoring

```bash
cd web
npm install --no-save v86@0.5.462   # or npm pack, then unpack
cp node_modules/v86/build/{libv86.js,v86.wasm,v86-fallback.wasm,seabios.bin,vgabios.bin} vendor/
cp node_modules/v86/LICENSE vendor/LICENSE.v86
```

`package.json` records the version that is vendored; the Pages workflow never
installs anything. There is a stale-check risk here worth naming: the vendored
copy and the version in `package.json` can drift apart, and only a human reading
this table would notice. When the emulator is next updated, update both.
