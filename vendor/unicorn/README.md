# Unicorn.js (vendored)

| File | Source | sha256 |
|---|---|---|
| `unicorn_arm.js` | Unicorn.js v2.1.4 (2026-06-19), ARM-only single-file build (wasm embedded): https://github.com/AlexAltea/unicorn.js/releases/download/v2.1.4/unicorn_arm.js | `13b0852dc0d9bdac7f25728913d57a496feee29b607388ac47d7e3344dec8422` |

Unicorn.js / Unicorn / QEMU are licensed under the GNU GPL v2, see `LICENSE`. Parts of Unicorn
(glib compatibility code, some QEMU files) are under the GNU LGPL v2, see `COPYING.LGPL2` and
`COPYING_GLIB` (copied from the Unicorn engine at commit `8028ec4`, the submodule of Unicorn.js
v2.1.4). The Emscripten runtime glue in the build is under the MIT license.

`unicorn_arm.js` is a compiled build (asm.js glue + embedded wasm), unmodified. Its complete source is
the Unicorn.js tag `v2.1.4` (https://github.com/AlexAltea/unicorn.js/tree/v2.1.4, with the Unicorn
engine as a git submodule), built with that repository's build script. A copy of that source
(the tag with its submodules, `git archive` of each) is attached to this repository's release
`unicorn.js-v2.1.4-source`:
https://github.com/un0btanium/yvio-emulator/releases/download/unicorn.js-v2.1.4-source/unicorn.js-2.1.4-source.tar.gz
(sha256 `a276cc055677a8032af9dce402b71de4328b9c7751c8b3b2e24ebe4f16b7c498`).
`package.json` here marks the directory as CommonJS so Node can `require()` the UMD build.
