# 01 — The reuse map

What the present code offers to the new learner page, module by module: what to take as-is, what
to wrap, what to cut out, what to rewrite, and the exact seams (members, DOM ids, globals, storage
keys, line numbers) that the people designing and implementing the new page will hit.

This document merges eight subsystem maps (board3d, explain, engine, story-drawings, cores,
views-dock, build-tools, content). Where two maps disagreed, the code was checked and the checked
value is given. Line numbers are from the working tree at commit `036454c` (the last code commit is
`666ae92`, "A learner-first pass"); sizes are `wc -l` of the same tree. Paths are relative to the
repository root. Nothing in `src/` was modified to make this map.

Reading order for a designer: sections 1, 5, 7. For an implementer: sections 2, 3, 4, 6.

Contents

1. The reuse table
2. The facade contract
3. The engine to extract from app.js (Playback)
4. The director API of the board
5. The content inventory
6. Build and test constraints for a second page
7. Open risks, ranked
8. Key facts

---

## 0. How the present page is put together (the facts every section relies on)

- **One file, one scope.** `build.mjs` concatenates 44 classic scripts (`SCRIPTS`, build.mjs:11-56)
  into one `(function () { 'use strict'; ... })()` spliced into `src/index.html` at `/*SCRIPT*/`
  (index.html:428), after a top-level `const THREE = (function () { ... })()` made by rewriting
  three.js r160's export statement (build.mjs:59-71, 81). There are no ES modules. Every top-level
  `const`/`class`/`function` of a file is visible to all later files. A duplicate top-level name is
  a SyntaxError that blanks the page.
- **The model is frozen at parse time.** `src/ui/theme.js` (first UI file) decides `CPU_MODEL`
  (`'8086' | '80286' | '80386' | '80486' | '80586' | '80686'`) and `VIDEO_CARD` (`'cga' | 'vga'`)
  from `?cpu=` / `?video=` or `localStorage a86:cpu` / `a86:video` (theme.js:142-188), mutates
  `THEME` in place with the per-model palette and tags `<html>` with `m286 m386 m486 m586 m686`
  (166-183). story.js (7-13), board3d.js (18-30, 110), explain3d.js (10, 38-39), blocks.js (644),
  die/timing/memmap/dock capture the model while they are parsed. Switching machines is
  `storage.set('cpu')` + `syncUrl` + `location.reload()` (app.js:964-1007). The core files never
  read these globals: a machine's model is a constructor choice.
- **The emulator is DOM-free** and driven by about ten calls (section 2.7, 3.2). `Story.build` is
  DOM-free too and runs in Node (`tests/story.test.mjs`).
- **The view contract** (app.js `makeViews` 154-172): `new Cls(host, api)` with
  `show() hide() resize() reset() instr(events, info) event(e, clockMs) frame(now, dt) fast(stats)
  setReducedMotion(on)` and optional `traceStep(story, i, info)`, `traceDur(step, ms)`, `modeSlot`,
  `ok`. `api` is the small object from `makeApi()` (app.js:112-130; section 2.2). `StateDock`,
  `DiskPanel` and `Explain` receive the real `App` instead (app.js:86, 94, 95).
- **Two clocks.** `AnimClock` / `animNow()` (theme.js:340-345) is `performance.now()` scaled by
  `AnimClock.scale` (slow motion, pause). Signals, flows, cards, story timing and the Explain beats
  run on it; camera flights, decap wear, die tiles, hover and `setTimeout` run on real time.
- **`this.mode` is only `'explain'` or `'fast'`** (app.js:4-15, 64, 1231). The `'clock'` mode that
  ARCHITECTURE.md's view contract names does not exist (verified: the only `'clock'` literals are a
  cursor kind in timing.js:2001-2367 and a glossary term). Manual clocking is `play.manual = true`
  with `clockMs = 400` (app.js:1287-1307); views infer it from `clockMs >= 300`.

---

## 1. The reuse table

Verdicts: **as-is** (load the file unchanged), **facade** (unchanged file, the new shell provides an
object/element it expects), **extract** (lift named parts into a new file; the rest is not loaded),
**rewrite** (write new; mine the old for texts or ideas), **drop** (not in the new page).

### 1.1 Vendor

| Module | Lines | Verdict | Reason |
|---|---|---|---|
| `src/vendor/three.module.min.js` (r160, 671 KB) | 6 | as-is | `board3d.js` line 6 needs `THREE`; the build already wraps it into a namespace `const` (build.mjs:59-71). Keep the wrapper. |
| `src/vendor/LICENSE-three.txt` | 21 | as-is | Emitted into the page by the wrapper (build.mjs:70). |

### 1.2 Assembler and disassembler

| Module | Lines | Verdict | Reason |
|---|---|---|---|
| `src/asm/assembler.js` (`Asm86`) | 1673 | as-is | Pure. `Asm86.assemble(src, { origin = 0x100, cpu = '8086'..'686', bits = 16 })` → `{ ok, bytes, origin, errors:[{line,col,msg}], lineMap:[{line,addr,len}], symbols }` (assembler.js:3-4, 1344-1404). Assembles the BIOS (bios.js is assembly text) and every lesson program at run time. Bad `cpu`/`bits` options throw (1347-1350). |
| `src/asm/disasm.js` (`Disasm86`) | 511 | as-is | Pure. `Disasm86.decode(readByte, off, { cpu, bits })` → `{ len, text, mnem }`. Without it the cores' decode text becomes `op xx` (cpu8086.js:421-424). |

### 1.3 Emulator cores (`src/core/`)

All DOM-free, no `CPU_MODEL` reads, Node-tested. Verdict for the whole directory: **as-is**, loaded
in the present order (inheritance chains).

| Module | Lines | Verdict | Reason |
|---|---|---|---|
| `fpu8087.js` (`FPU8087`, `F80`) | 1125 | as-is | 80-bit soft-float; `typeof`-guarded in machine.js:132-139, so optional, but the BIOS then reports no FPU. |
| `cpu8086.js` (`CPU8086`) | 881 | as-is | Base of every core; emits the micro-events (section 3.5). |
| `cpu80286.js` (`CPU80286`, `Fault286`) | 1571 | as-is | `extends CPU8086`. |
| `cpu80386.js` (`CPU80386`) | 2595 | as-is | `extends CPU80286`; `regs32` mirror rules (section 2.7). |
| `cpu80486.js` (`CPU80486`) | 882 | as-is | cache486, pipe events. |
| `cpu80586.js` (`CPU80586`) | 1389 | as-is | U/V pipes, BTB, MESI caches. LF file. |
| `p6ooo.wasm.js` (`P6OOO_WASM`) + `p6ooo.c` | 3 + 421 | as-is (optional) | The C out-of-order timing model; `cpu80686.js` uses it only when `trace === null` (cpu80686.js:1464), so a step-only lesson page never runs it. Keep for a fast-run mode; harmless otherwise. |
| `cpu80686.js` (`CPU80686`) | 1808 | as-is | ROB/RS/RAT µop model in JS when tracing. |
| `devices.js` (`PIC8259 PIT8253 PPI8255 DMA8237 CRTC6845 Keyboard`) | 482 | as-is | Mixed CRLF/LF file (288 CRLF of 482): patch in place, never normalise. |
| `disk.js` (`FLOPPY_TYPES FloppyDisk Fat12 fat12Blank fat12AddFiles fat12List HardDisk hdBlank hdFs`) | 567 | as-is | Also holds the FAT12 helpers the disks panel uses (`fat12Blank` is here, not in bios.js). |
| `fdc765.js` (`FDC765`) | 597 | as-is | Optional by `typeof`, but **without it the POST needs 9,976,356 clocks** (INT 13h reset timeout) instead of 428,861 (verified in Node); app.js's 4,000,000-clock boot guard assumes it. Load it. |
| `soundblaster.js` (`SoundBlaster OPL2 OPL_RATE`) | 757 | as-is (optional) | `typeof`-guarded; on by default (`opts.soundCard !== false`, machine.js:144). Pass `{ soundCard: false }` for lessons that do not need `sb`/`opl` events. |
| `vga.js` (`VGA VGA_EXPAND`) | 357 | as-is | Needed for `video: 'vga'`; `typeof`-guarded. |
| `x86core.wasm.js` (`X86CORE_WASM`) + `x86wasm.js` (`X86W`) + `x86core.c` | 3 + 382 + 3202 | as-is (optional) | Used only by `Machine.run()` without trace/breakpoints on 386+ (machine386.js:73-76; `Core.usable()` x86wasm.js:141-144). `Machine.step()` is always JS. When loaded, every Machine386+ instance allocates a 21 MB `WebAssembly.Memory` (machine386.js:27, machine486.js:29) unless `{ wasm: false }`. Include for a "run at full speed" workbench; omit or pass `wasm: false` in lesson-only builds. |
| `machine.js` (`Machine`, `CPU_HZ`, `PROG_SEG`, `ROM_BASE`, `RAM_TOP`, ...) | 635 | as-is | The machine API (section 3.2). Its file-level consts are used by machine286.js and app.js (`PROG_SEG`). |
| `devices286.js` (`RTC146818 KBC8042`) | 136 | as-is | Must precede `Machine286`. |
| `machine286.js` … `machine686.js` (`Machine286 Machine386 Machine486 Machine586 Machine686`) | 274 / 108 / 115 / 54 / 41 | as-is | `extends` chain; constructor options in section 5.1. |
| `bios.js` (`BIOS_SOURCE`, `biosSource(model)`, `SAMPLES`) | 8330 (241 KB) | as-is | One NASM source per model by block replacement (3514-3556); the 35 `SAMPLES` (2680, 4481, 4745, 5166, 5772, 6577, 7645) are lesson programs. |
| `vgabios.js` (`VGA_BIOS_SOURCE`, `makeVgaRom(fonts)`) | 2858 | as-is | `makeVgaRom(null)` works in Node (blank fonts). |

### 1.4 UI modules (`src/ui/`)

| Module | Lines | Verdict | Reason |
|---|---|---|---|
| `theme.js` | 354 | **extract** (keep almost all) | Pure helpers (`hex* bin clamp lerp easeOut easeInOut`, stroke font, `svgEl htmlEl`, `pipeAfterHalt`, `storage`, `AnimClock/animNow`, `splitLead`, `THEME*`, `BUS_COLOR`, `URL_PARAMS`) are needed by every reused view. Turn the parse-time palette swap + `<html>` class tagging (166-183) into an explicit `applyTheme(model)` so the new shell decides when; keep `CPU_MODEL`/`VIDEO_CARD` as globals because story.js/board3d.js/blocks.js read them at parse. Must stay the first UI file. |
| `audio.js` (`SpeakerAudio`) | 131 | as-is | No DOM. `setTone(hz)`, `pcm(sp, c0, c1, hz)`, `card(snd)`, `suspend/resume`; storage `a86:sound`; depends on global `CPU_HZ` default only. |
| `crt.js` (`CGA_RGB CP437 SCAN_CODES CHAR_SCAN VgaRenderer CrtScreen makeVgaFont`) | 620 | as-is | `new CrtScreen(host, machine, onKey)`: needs a focusable host, CSS var `--mono`, global `clamp`, and the `.crt` CSS (style.css:767-862 subset). `VgaRenderer` is DOM-free (Node tests). `makeVgaFont(h)` needs `document` (returns zeros in Node). |
| `editor.js` (`CodeEditor`, `highlightAsm`) | 176 | as-is (Workbench only) | `new CodeEditor(textarea, preOverlay, gutterDiv)`; no app, no storage. Highlighter knows 8086/8087 words only (5-13, 63); extend for 32-bit code. ~35 CSS lines (style.css:469-543). |
| `dock.js` (`StateDock`, `DOCK_*`) | 1122 | **extract** | `constructor(app)` takes the raw App (`is286..is686`, `machine`) and builds into 13 fixed ids of index.html:330-360. Lift `DOCK_REGS*` + `read/fmt/show/setReg/renderFlags/hot` (≈120 lines) + ~70 CSS lines (style.css:863-932) for a "registers that changed" widget; the ~125 tooltip strings (`DOCK_FLAGS* DOCK_CR0* DOCK_CR4_* DOCK_OOO_STALLS DOCK_PORTS`) are content. The 386/486/P5/P6 system cards (`buildSys386`, `buildCache*`, `buildBtb*`, `buildOoo686`) can be re-hosted in the Workbench behind an adapter (they only need `machine` + host elements). |
| `disks.js` (`DiskStore DiskPanel makeFont8x8`) | 436 | **extract** | `DiskStore` (4-36, IndexedDB `anatomy86`/`disks`, keys `drive0 drive1 hd0`) as-is; **`makeFont8x8` (402) must move to a core-side file** (app.js:141 needs it to build the ROM); `DiskPanel(app)` is bound to `app.bootDisk/announce/running/bootMode` and 17 ids → rewrite its markup for the Workbench or keep index.html:142-219 verbatim behind an adapter. |
| `tips.js` (`Tips`, `setTip`) | 58 | as-is (optional) | `Tips.init(doc)` rewrites every `title` into `data-tip` page-wide (12-20) — a global side effect; `.tip` CSS style.css:848-862. |
| `sfx.js` (`Sfx`) | 72 | as-is | Installs `pointerdown`/`keydown` capture listeners on `document` at parse (24-26); storage `a86:sfx`. |
| `story.js` (`Story`) | 407 | as-is | `Story.build(events, { prefetch, burst })` → `{ text, cs, ip, cycles, steps }`; exports `busInfo`, `devName`. Only globals: `CPU_MODEL`, `VIDEO_CARD` (7-13). One model per load (or a small, mechanical change to take the model as a parameter — the brief allows "small and clearly needed"). |
| `blocks.js` (`BlockPanel`) | 1753 | as-is | `new BlockPanel(host /* position:relative */, { minKey, minDefault })`; `show(spec) update(u) place(x,y) hide() setMin(on) setReducedMotion(on)`, `BlockPanel.termTip(text, spec)` (1705). Injects `<style id="bk-style">`; needs theme.js helpers + CSS tokens; storage only `a86:<minKey>` (1474, 1494); `CPU_MODEL` at 644 for 32-bit register width. |
| `unitfx.js` (`UnitFx`) | 1950 | as-is | `UnitFx.draw(ctx, w, h, spec, u, t, reduced, zs)` (1909-1946), stateless per call, paints an opaque `rgb(8,10,20)` base; `UnitFx.words` after each call. Needs `THEME clamp hex* lerp easeInOut bin`. No DOM. |
| `die.js` (`DieView` … `Die686View`, `DIE*_INFO`, `DIE*_3D`, …) | 8673 (533 KB) | **facade** (whole) or **extract** (8086 only) | `new DieView(host, api)` picks the right subclass from `api.model` + core sniffing (169-190). Needs only `api.{model, machine, reducedMotion, select, motion, clock}` and `window.__app.selectTab/views.board.focusChip` for double-click-to-3D (1279-1287, guarded by `app &&`). Injects `dv-style[-586/-686]`. The 131 `DIE*_INFO` texts are content (section 5.2). No `build*` method reads the machine, so the drawing is emulator-free; the 8086/8087 alone is ≈900-1000 lines (1-167, 500-1006, 1030-1260, 1799-1900) if a cut is wanted. |
| `timing.js` (`TimingView`, `TV_*`) | 3212 (223 KB) | **facade** (Workbench only) | Needs `api.{model, machine, reducedMotion, clock, select, motion, mode}`; looks for `#crt` (1803) and `#trace` (1829) null-safe; no storage; no `traceStep/traceDur`. Content: 150 signal rows `TV_GROUPS*` (88+) and 132 `TV_INFO*` descriptions (366+). |
| `memmap.js` (`MemoryView`, `MV_*`) | 2116 (123 KB) | **facade** (Workbench only) | Needs `api.{model, machine, reducedMotion, mode, motion}` (42 `machine` reads); `#crt` null-safe (1662); storage `a86:memMode`; no `traceStep/traceDur`. |
| `board3d.js` (`BoardView RunnerView BoardKit`) | 8809 (553 KB) | **facade** for `BoardView`; **extract** the spec builders; **drop** `RunnerView` (brief non-goal) or keep for `dieKit` | One IIFE specialised at parse for one CPU (18-30, 110). `new BoardView(host, facade)` works from a new shell with the ≈15-member facade of section 2.2 plus a positioned host; its chrome (`.bv-top`, presets, Follow, Open chips, legend, focus pill, pop, tooltips) is inside `host` and hides with one CSS rule. The step→spec builders (`tcard`, `CPU_TRACE`, `GLUE`, `*_TRACE`, `*_CARD`, `P5/P6_CARDS`, 1626-2082, ≈450 lines) should be lifted into `specs.js` with `machine` passed explicitly (they read `window.__app.machine` at 1954-1955). Die dives in a trace need `app.view('runner').dieKit` (6046, 6138-6141; `dieKit` is 17 lines at 8182 — lift into BoardView). |
| `explain3d.js` (`Explain3D.Explain`) | 780 | **extract** (engine, plan, caption rules, CSS ideas) / **rewrite** (content, app coupling) | The beat/milestone engine (`loop/next/goNext/togglePause/setSpeed/replay/jump/goBack/key/syncProgress/buildMs/syncMs`, 477-524, 634-677, 719-777, ≈250 lines), `plan(k, steps)` (335-389), `stepMs()` caption rules (407-441), `vget/vset` hide-and-reveal (140-154, 296-298, 399-402) are generic once `app`/`board` are injected. `CPUS` (23-37), `SRC` (11-18), tour/summary captions are content to move into lesson data. Uses ~25 App members and 6 DOM ids; not instantiable from a new shell without the old App. |
| `topview.js` (`TopView`) | 1876 (122 KB) | **drop** for v1 (or facade in Workbench) | 2D renderer of the 3D board's data; hard dependency on ~35 `BoardKit` members and `BlockPanel`; reads `#monitor`, `#trace`, `dialog[open]` null-safe; storage `a86:topFollow`, `topCardMin`; reads `this.app.stepMs` (638) which the api never had. Useful as the no-GPU fallback later (brief principle 8), not needed for v1. |
| `app.js` (`App`, `SPEEDS`, `TRACE_MS`, `MOTION`, `caption`, `startApp`) | 1591 | **extract** the engine (section 3) / **rewrite** the shell | Engine methods (assemble/boot/beginInstr/dispatchUntil/finishInstr/enterStep/trace*/startFF/ffFrame/fastFrame/speedAt/caption/code*) touch the DOM only through a few sinks; everything in `ui() traceUi layoutUi monitorUi popOut modelUi startCard renderTrace shortcut` is DOM. **Must be excluded from the new build** (`startApp` runs at load and needs ~83 ids). |
| `style.css` | 1394 (83 KB) | **extract** | Import the token block and five palettes (1-188) unchanged (every injected view stylesheet uses them), base rules 189-220 minus `html,body{height:100%}`/`body{overflow:hidden}`, and the small components you reuse (`.btn .btn-gold .icon-btn .chip-btn .toggle .pop-menu .card* .tip .crt .sr-only .skip-link kbd`, the editor/dock/monitor families only with their module, 720-766 for board labels). Rewrite `.layout .topbar .transport .stats .tabs .stage-* .dock .trace`, body-class modes and the 900 px phone rules. |
| `index.html` | 430 | **rewrite** | 166 ids; the app resolves 83, dock 13, disks 17, explain 6, board3d 4. Mine the model menu (25-60) and help (389-424) texts; keep the `/*STYLE*/` and `/*SCRIPT*/` markers, `<title>`, viewport, `color-scheme`, favicon. |

### 1.5 The 2D explainer (`src/explain/`)

| Module | Lines | Verdict | Reason |
|---|---|---|---|
| `explain.html` / `explain.js` / `data.js` | 96 / 723 / 2 | **drop** (design reference only) | Not in build.mjs, CI, ARCHITECTURE or README; built only by `tools/explain-build.mjs` into the git-ignored `dist/8086-explain.html`; `data.js` is a frozen 8086 dump of 4 instructions from `tools/explain-data.mjs`. Reusable **ideas**: "picture = pure function of time t" (`stateAt(t)` 266-270, `levels(t)` 256-265), scrubbable bar with chapter ticks (709-717), `meaning(bytes)` byte-field decoder (64-77), and captions the 3D player lost (section 5.5). |

### 1.6 Build, tests, tools

| Item | Lines | Verdict | Reason |
|---|---|---|---|
| `build.mjs` | 104 | **extract** (add a page table) | One entry and one SCRIPTS list today; needs `{ entry, scripts, styles, out }` per page (section 6.1). |
| `.github/workflows/pages.yml` | 42 | as-is + 1 line | Uploads all of `_site`; add a second `node build.mjs … --out _site/<name>.html`. |
| `tests/*.test.mjs` | — | as-is | None loads the shell; keep `src/asm`, `src/core`, `story.js`, `crt.js` names and order (section 6.4). |
| `tools/*.mjs` (51 files) | — | **extract** the launcher + virtual clock | `shot.mjs --file`, `xpmotion.mjs --page`, `blurprobe.mjs --page` take another page; the rest hard-code the dist path, old ids and `__app` members (section 6.5). |

---

## 2. The facade contract

### 2.1 Who receives what today

| Consumer | Receives | Where |
|---|---|---|
| `BoardView`, `RunnerView`, `TopView`, `DieView`, `TimingView`, `MemoryView` | `api` (section 2.2) | app.js:154-165 `new Cls(this.el('view-'+id), this.api)` |
| `StateDock` | the real `App` (`machine`, `is286..is686`) | app.js:86, dock.js:42-54 |
| `DiskPanel` | the real `App` (`machine`, `bootDisk`, `announce`, `running`, `bootMode`) | app.js:94, disks.js:38-67 |
| `Explain3D.Explain` | the real `App` (~25 members, section 2.7.9) | app.js:95, explain3d.js:123 |
| `CrtScreen` | `(host, machine, onKey)` — no app | app.js:87, crt.js:185 |
| `CodeEditor` | `(textarea, pre, gutter)` — no app | app.js:247, editor.js:69 |
| back-doors | `window.__app.machine` (board3d.js:1954-1955), `window.__app.selectTab('die')` (board3d.js:2180), `window.__app.selectTab('board')` + `views.board.focusChip` (die.js:1279-1287) | all guarded by `window.__app &&` / `app &&` |

### 2.2 The `api` object (app.js:112-130) and what each member must be

Verified body:

```js
{ machine,                         // the Machine instance (a value, not a getter)
  get model(),  get video(),       // '8086'.. / 'cga'|'vga'
  get reducedMotion(),
  get mode(),                      // 'explain' | 'fast'
  get running(),                   // bool
  get clock(),                     // play ? play.clock : 0  (manual clock stepping)
  get crtCanvas(),                 // crt.fullCanvas (1024x768 copy) or null
  get crtVersion(),                // crt.version (change counter)
  select(kind, id),                // emits 'select' {kind,id}
  view(name),                      // views[name]
  get motion(),                    // AnimClock.scale
  get tracing(),                   // traceActive()
  on(name, cb) }                   // events: 'follow' | 'select' | 'mode' (+ 'reset', unused)
```

Which view reads which (grep of `this.app.*`, counts in parentheses):

| Member | board3d | topview | die | timing | memmap | Essential? | Notes |
|---|---|---|---|---|---|---|---|
| `machine` | 17 (+RunnerView 2) | 5 | ctor only (`this.m`) | 16 | 42 | **essential** (object) | board3d dereferences `machine.disks` **every frame** (`updateDrives` 3545/3565 from `updateSignals` 4018); die/timing/memmap read `cpu.*`, `mem`, `heat`, `a20`, `bus` in render code. Give the real `Machine`; a stub must carry `mem cpu crtc disks hdisk fdc pic pic2 vga lastTone kbd kbc rtc a20 nmiMask ppi pit dma dma2 fpu ide peek8 clockHz memSize heat bus`. |
| `on(name, cb)` | 3 (ctor 2124-2127) | — | — | — | — | **essential** (fn) | TypeError in the BoardView constructor without it. May store and never emit. |
| `select(kind, id)` | 1 (4443, chip click) | — | 1 (1037, 'block') | 2 | — | **essential** (fn, may be a no-op) | Only BoardView listens to 'select' and only for kind 'chip' (2126). |
| `model` | — (uses `CPU_MODEL`) | — | ctor (170-190) | 12 | 12 | **essential** for die/timing/memmap | Also picks the DieView subclass. |
| `reducedMotion` | ctor 2088 | ctor | ctor | ctor | ctor | stub `false` | Read once; later changes via `setReducedMotion(on)`. |
| `mode` | 4 | 1 | — | 1 | 4 | stub `'explain'` | Compared only to `'fast'`. |
| `running` | 4 | 1 | — | — | — | stub `false` | Chase camera and fast-mode tone. |
| `clock` | 2 (4115, 7782) | — | 1 (367) | 3 | — | stub `0` | Manual clocking only. |
| `tracing` | 1 (3868) | 2 | — | — | — | **essential semantics** | `event()` skips live signals when true; must be true while a story plays. |
| `motion` | 3 | 2 | 1 | 1 | 1 | stub `1` | `AnimClock.scale`; `|| 1` fallbacks exist. |
| `crtCanvas`, `crtVersion` | 1 each (7770) | — | — | — | — | optional | Screen mesh stays black without them. |
| `view(name)` | 4 (`'runner'` 6046, `'board'` 7947) | — | — | — | — | optional | Without a RunnerView, trace steps are flat board paths (no die dives) and `xpFocus(['die:…'])` falls back to a box shot. |
| `stepMs` | **3 (7038, 7041, 7075)** | **1 (638)** | — | — | — | **add it** | Not on the api today → `undefined`; `flowFull` falls back to `ms || 1700` (6612) and the real step time arrives as `s._ms` from `traceDur`. A new facade should expose `stepMs` (or always call `traceDur` before `traceStep`). |
| `video` | — | — | — | — | — | drop | Exposed but never read by a view (board3d uses the `VGA` const). |

### 2.3 DOM the reused modules touch outside their host

All are `getElementById`/`querySelector` and null-checked unless marked.

| Module | Element | Lines | Effect when absent | Essential? |
|---|---|---|---|---|
| board3d | `document.head` (`<style id="bv-style">`) | 1617-1622 | ReferenceError-free but unstyled | **essential** (always present) |
| board3d | `#opt-follow` (checkbox) | 2122, 4139 | `follow` defaults true; `setChase(on)` flips `this.follow` directly | optional |
| board3d | `#opt-decap` (checkbox; the "Open chips" button dispatches `change` on it) | 2159 | the chrome button does nothing; call `decapAll()/restoreAll()` yourself | optional |
| board3d | `#trace` (caption bar) | 7119 `trViewOffset` | no camera view offset | optional (if you name your caption bar `trace` you get the offset for free) |
| board3d | `#monitor` (floating CRT) | 7230 `trCover` | shots use the full width | optional |
| board3d | `.xp3-prog`, `.xp3-bar` inside `bd.root` | 7215 `xpCovers` | `xpTopPx` defaults (card at y 60) | optional, but **class-name coupling**: the director's own bars must use these names or `xpCovers` should take covers as data |
| board3d | `document` `keydown` (Esc leaves focus) | 4340 | — | side effect, never removed |
| board3d | `#board-modes` | (app.js:229 moves it into `modeSlot`) | nothing | drop |
| RunnerView | `storage` `a86:runMode runCam runInto runZoom` | 7931-7934 | — | drop with the Runner |
| explain3d | `#btn-explain`, `#opt-follow`, `#trace`, `#monitor`, `#sample-select`, `#trace-next`; `body.xp-full/.code-hidden/.dock-hidden`; `bd.root` | 136, 173, 178-182, 561-566, 164-168, 528-550 | not instantiable | rewrite |
| die | `.monitor` in `host.parentElement` (`monitorRect` 446-452); `window.matchMedia('(pointer: coarse)')` 1073; `<style id="dv-style[-586|-686]">` 224/5324/6886 | — | layout ignores the monitor | optional |
| topview | `#monitor` 1077, `#trace` 1087, `dialog[open]` 1211, `<style id="tp-style">` | — | — | optional |
| timing | `#crt` 1803, `#trace` 1829 (via `host.ownerDocument`), creates `#tv-card`, `<style id="tv-style">` | — | — | optional |
| memmap | `#crt` 1662, `<style id="mv-style[-586|-686]">` | — | — | optional |
| dock | `#regs #flags #btn-radix #fpu-title #fpu-stack #fpu-sw #stack-list #io-log`, 286: `#sys-regs #seg-cache #sys-mode`, 386+: `#card-sys #sys-title` (+ creates `#sys-tab-*/#sys-pane-*`) | 55-100, 176-195, 238-343 | throws | **essential** for the unmodified dock (or extract, section 1.4) |
| disks | `#disk-file #disk-add #disk-folder #drive-0/1/2 (+ -led -name -meta -path -files, button[data-act])`, `#btn-boot-disk #btn-boot-hd #disk-status`, `#fedit*` | 41-43, 289+ | throws | essential for the unmodified panel |
| crt | only its host (`#crt` in index.html:272, `tabindex=0`); reads `--mono` via `getComputedStyle(documentElement)` 208-209 | — | — | host is the contract |
| editor | its three elements | 69 | — | contract |
| blocks | `document.head` (`bk-style`), host must be `position: relative` | 103-109 | `.bk-panel` is `position:absolute; pointer-events:none` | contract |
| tips | `body` (appends `.tip`), rewrites every `title` on the document | 12-20 | — | side effect |
| sfx | `document` capture listeners at parse | 24-26 | — | side effect |

### 2.4 Globals required (from the one-scope build)

| Needed by | At load (ReferenceError otherwise) | At run time |
|---|---|---|
| board3d.js | `THREE` (6), `THEME` (42-78, via `PAL`), `clamp` (12), `storage` (110, only if `VIDEO_CARD` is undefined); `CPU_MODEL`/`VIDEO_CARD` typeof-guarded (default 8086/CGA) | `htmlEl` (68 uses), `animNow`, `hex hex2 hex4 hex5`, **`Story.busInfo` (7370) and `Story.devName` (5914) unguarded** — every `fetch|bus` event with `UnitFx` defined and every `traceStep` need story.js; `pipeAfterHalt` (1910, P5 cards); optional typeof-guarded: `Sfx`, `BlockPanel`, `UnitFx` |
| story.js | `CPU_MODEL`, `VIDEO_CARD` (7-13) | none |
| blocks.js | `THEME` | `clamp hex hex2 hex4 bin lerp easeOut easeInOut svgEl htmlEl` (theme.js:197-205, 304-331); `CPU_MODEL` at 644 |
| unitfx.js | — | `THEME clamp hex hex2 hex4 lerp easeInOut bin` |
| die.js / timing.js / memmap.js | `THEME` (palette caches: `dieP()` 61-63) | `hex* clamp lerp easeOut strokeTextPath strokeTextWidth svgEl htmlEl storage animNow`; `F80` (die.js 411-422, 8087 values); `Sfx`, `setTip` typeof-guarded |
| crt.js | — | `clamp` (271, 362), `CP437`, `CGA_RGB` (own) |
| dock.js | `CPU_MODEL`-derived flags via `app.is*` | `hex* htmlEl storage` |
| app.js engine parts | `Asm86 Disasm86 biosSource makeFont8x8 makeVgaRom makeVgaFont Machine* Story PROG_SEG AnimClock animNow splitLead clamp` | — |

### 2.5 CSS custom properties the injected stylesheets assume

Define on `:root` (copy style.css:1-37) and per model under `:root.m286 .m386 .m486 .m586 .m686`
(style.css:39-188, mirroring `THEME_286..686` theme.js:27-140):

`--void --panel --panel2 --line --line-soft --ceramic --ceramic-hi --gold --gold-hi --copper --cyan
--magenta --phosphor --lavender --text --muted --faint --mono --sans --r --r-sm --gap --top-h
--transport-h --ease --well --stage-a --stage-b --bezel-a --bezel-b --bezel-c --bezel-line --tip-bg
--glow-a`.

board3d's `CSS`/`CSS2` (1508-1616) use 18 of them; blocks.js (32-101) uses `--text --panel --panel2
--line --void --muted --faint --sans --mono --cyan --gold-hi --gold --magenta --phosphor --lavender
--ease`; die/timing/memmap/topview/explain use the same names. The `<html>` model classes are added
by theme.js:168-182 (cumulative: a 486 page has `m286 m386 m486`; a Pentium page `m286 m386 m586`).

### 2.6 Storage keys (all `localStorage`, JSON values, prefix `a86:` via theme.js `storage` 332-335)

- **app.js (rewrite, choose your own):** `speedPos speed speedSet trace tracePre traceBurst traceRep motion watchBoot follow src sample tab boardMode pane codeHidden dockHidden simple decap traceList monLarge monMin monDetached monPos startSeen cpu video`.
- **theme.js (raw, parse time):** `cpu`, `video` — **written** by `URL_PARAMS` (theme.js:154-155) so the address wins and sticks. A second page on the same origin shares them: the machine choice carries across pages.
- **Reused modules own:** `sound` (audio), `sfx` (sfx), `radix sysPane` (dock), `memMode` (memmap), `topFollow` + `topCardMin` (topview), `runMode runCam runInto runZoom` (RunnerView), `boardCardMin` (board3d 7227 raw + `BlockPanel minKey`), `a86:<minKey>` per BlockPanel (blocks.js 1474/1494), `xpSet` (explain3d 132/663 raw), `src` (explain3d `leaveTo('own')` 625).
- **IndexedDB:** `anatomy86` v1, store `disks`, keys `drive0 drive1 hd0`, values `{ name, bytes: ArrayBuffer }` (`DiskStore` disks.js:4-36).
- Rule: `a86:src` holds the user's program; a lesson that loads a program into the workbench must be deliberate about overwriting it.

### 2.7 Per-component requirements

#### 2.7.1 BoardView (board3d.js:2084-7830)
- **Constructor** `new BoardView(host, app)`: `host` must be a **positioned box with non-zero size** (`.bv-root { position:absolute; inset:0 }` 1509; `resize()` 7755 reads `host.clientWidth/Height`; `frame()` returns while `w` is 0). Reads `app.reducedMotion` (2088), `#opt-follow` (2122), calls `app.on` ×3 (2124-2127), builds the WebGL renderer in try/catch (2112-2117; on failure writes `<p class="bv-fail">` and sets `ok=false`; **every public method starts with `if (!this.ok) return`**).
- **Facade members** (section 2.2): `machine` (essential), `on` (essential), `select` (essential, may no-op), `reducedMotion mode running clock tracing motion crtCanvas crtVersion view stepMs` (tolerate `undefined`).
- **Drivers the shell must run:** `frame(animNow(), dt * AnimClock.scale)` **every rAF** (BoardView owns no loop; it renders lazily only when something is busy, 7819-7821; `dt` clamped 0.05-100 ms at 7786); `resize()` from a `ResizeObserver` on the host (cheap, early exit on same size); `show()/hide()` on visibility; `instr/event/fast/reset` from the engine; `traceDur(s, ms)` **then** `traceStep(story, i, {ms, back, auto})` for stories (same frame; `flowFull` caches on `(s, ms, now)` 6612).
- **Chrome inside host** you can hide with `.bv-top, .bv-pop, .bv-focus, .bv-hint { display:none }` or remove after construction (`this.root.querySelector('.bv-top').remove()`); the code only writes to those elements through null-safe fields (`presetBtns` loops, `followBtn`, `decapBtn`).
- **Reads `window.__app.machine`** in `lineBytes`/`cpuNow` (1954-1955) for the P5/P6 cache cards (guarded → zeros) and `window.__app.selectTab('die')` in the pop button (2180, guarded). Either keep `window.__app = { machine, selectTab }` or patch these lines when lifting the spec builders.
- **No `dispose()`**, no `webglcontextlost` handling; one document `keydown` listener per instance (4340) never removed; `<style id="bv-style">` injected once (guarded by id).
- **Estimated facade:** ~50 lines (emitter + getters + rAF/resize drivers) + ~20 lines of CSS variables + one rule to hide the chrome.

#### 2.7.2 RunnerView (board3d.js:7925-8798) — drop for v1
Has no renderer: `show()` calls `b.attachTo(this.wrap)` (8382) moving BoardView's canvas, adds its group to `b.scene` (8010), renders `b.scene` with its own camera (8500). Needs `app.view('board')` (7947) and `storage`. **Never show both at once.** Its only value to the new page is `dieKit(e)` (8182, 17 lines) which `trJourney` needs for die dives — lift it into BoardView instead.

#### 2.7.3 Story (story.js)
- Define `CPU_MODEL` and `VIDEO_CARD` before the script; call `Story.build(machine.step().events, { prefetch: 'parallel'|'short'|'full'|'hide', burst: 'all'|'fold' })`.
- Returns `{ text, cs, ip, cycles, steps }`; step fields: `i kind lane phase? t title text sum token{tag,val,col} e|evs I? unit? dev? fromName toName bg[] bgStep burst`. **Inside steps carry `evs` (array), not `e`** (219).
- `'parallel'` = `'short'` + every fetch step marked `bgStep` and hosted in `host.bg` of the nearest earlier inside step (392-403), so `steps[]` excludes them.
- Views mutate steps (`_j _ms _xpLead`); build one spec object per step and cache it (BlockPanel and `unitWindow`/`showCard` rebuild on spec **identity**, blocks.js:1503; board3d 7478, 7522).

#### 2.7.4 BlockPanel (blocks.js:1461-1560)
`new BlockPanel(host, { minKey?, minDefault? })` → `show(spec)`, `update(u 0..1)`, `place(x, y)`, `hide()`, `setMin(on)`, `setReducedMotion(on)`, `el`, `size()`. Spec: `{ kind, title (≤40), chip (≤14), sub, col?: 'addr'|'data'|'ctrl'|'eu'|'fpu', lines?, panel?, ...params }`; 18 kinds in `BUILD` (1446-1453): `adder logic alu shift bytes|queue regfile|regs decoder cells|dram|rom mux latch buffer flags status opcode counter wave text`. Kinds `cache bus pipe rat rs rob port` are UnitFx-only and render via `spec.panel` or `spec.lines`. `pointer-events: none` → the caller hit-tests `svg text` rects for tooltips (board3d 4517-4533). Glossary: `BlockPanel.termTip(text, spec)` (1705).

#### 2.7.5 UnitFx (unitfx.js)
`UnitFx.draw(ctx, w, h, spec, u, tMs, reduced, zs)`; `zs` = canvas px per drawing px (1..6), else `clamp(min(w,h)/360, 1, 3)` — drawings are designed for a ~360 px unit. 27 kind names (`KINDS` 1891-1897) incl. the structural `cache bus pipe rat rs rob port`; `wave` draws as text. Module-level state (`G COL PULSE FS ZSC REGS`): not re-entrant; copy `UnitFx.words` right after the call (board3d 7326). Colour: `spec.col` → `'fpu'` for 8087/80287 chips → `'addr'` for adders ≥ 20 bits or titles containing ADDR → `DEF_COL[kind]`.

#### 2.7.6 DieView (die.js)
`new DieView(host, api)` with `api.{ model, machine, reducedMotion, select(){}, clock: 0, motion: 1 }`; call `show()`; then `resize()` on host changes. Injects its styles; needs the CSS tokens. `block(g, id, x, y, w, h, title, cls)` (621-632; 386+ 2852) builds each unit with hard-coded coordinates in a 960×760 die space (8086) — **procedural SVG, not data**; only the P6 has a rect table (`D686_UNITS` 6796). `select(id, g, zoom)` (1030-1045) → tooltip + `zoomToBlock(g)` (1047-1058: `z = clamp(min(B.w/(bw·1.35), B.h/(bh·1.9)), 1, 8)`); double-click / Shift+Enter → `go3D(id)` (1278-1287) via `window.__app` (guarded). `traceStep` exists only in `Die686View` (7759); no die has `traceDur`. Manual-clock inference: `clockMs >= 300` (274, 296).

#### 2.7.7 CrtScreen (crt.js:185-216)
`new CrtScreen(host, machine, onKey)`; `frame(now)` → true when redrawn; `resize()`, `setFit(on)`, `fit/fitCols/fitRows`, `dirty`, `version`, `fullCanvas` (1024×768 copy — **the getter permanently doubles drawing work** after the first read, 216, 302-309; only read it when a 3D monitor shows it), `key(e, down)`, `typeText(text)`. Machine API used: `m.vram()`, `m.crtc {mode,start,cursor,cursorOn,color}`, `m.keyDown/keyUp`, `m.vga` (→ `VgaRenderer`, honours `vga.dirty`). The floating monitor chrome (`#monitor`, drag, size, detach, `#vkbd`, storage `monPos/monMin/monLarge/monDetached`) is app.js `monitorUi` 819-935, not crt.js.

#### 2.7.8 StateDock and DiskPanel
- `StateDock(app)`: needs `app.machine`, `app.is286..is686`, and the 13 ids (section 2.3). Cadence: `dock.event(e)` per micro-event **before** the views (app.js:1381), `dock.sync(false)` after each instruction (1392), on reset (1148), every 120 ms in fast mode (1486). `#card-sys.hidden` is toggled by app.js:976, not the dock. Lift-list for a compact widget in section 1.4.
- `DiskPanel(app)`: needs `app.machine.{disks, hdisk, insertDisk, insertHardDisk, ejectDisk, ejectHardDisk}`, `app.bootDisk('A'|'C')` (60, 62, 370), `app.announce` (239), `app.running`, `app.bootMode` (196, 340), `Fat12 hdFs fat12Blank` from disk.js; polls every 3 s (`persistDirty`, 66), restores from IndexedDB on construction (74-84); `frame()` (391) drives the LEDs from `d.busy`. Boot from disk: `reset()`, optionally `pokeMem(0x4F6, [0x80])` for C:, run until `physIP === 0x7C00`.

#### 2.7.9 An Explain-like director (what explain3d.js needs from its host)
From `App`: `views.board` (with `.ok`), `machine` (`mem`, `vga.vram/dirty`, `cpu.ip/cycles`, `clockHz`), `crt.dirty`, `editor.value` (get/set), `play` (`{ events, idx, cycles, story:{steps,…}, si, stepDur, animMs, auto }`), `traceNext()`, `enterStep(i, back)`, `finishInstr()`, `dispatchUntil(t)`, `assembleAndLoad()`, `stepMs` getter, `spd.stepMs` (mutated to 650 around `enterStep` for a quick shot, 395-398), `setTrace`, `setSpeedPos(20, true)`, `tracePre = 'full'`, `selectTab`, `activeTab`, `traceOn`, `speedPos`, `toggleCode/toggleDock`, `syncTracePanel`, `showDesc`, `announce`, `el`, `samples`; reverse coupling `app.buildStory` reads `explain.on` (app.js:389, `burst: 'all'`). From the board: everything in section 4 marked ⟨xp⟩. Globals: `AnimClock animNow splitLead storage CPU_MODEL VIDEO_CARD Sfx Asm86 Disasm86`. A new director should get the **Playback** of section 3 and the **BoardView** and nothing else.

### 2.8 A minimal facade (sketch, ~50 lines)

```js
function makeFacade(machine, play, crt, views, opts) {
  const handlers = {};
  const api = {
    machine,
    get model() { return CPU_MODEL; },
    get reducedMotion() { return opts.reducedMotion; },
    get mode() { return play.mode; },            // 'explain' | 'fast'
    get running() { return play.running; },
    get clock() { return play.play ? play.play.clock : 0; },
    get tracing() { return play.tracing; },      // true while a story plays
    get motion() { return AnimClock.scale; },
    get stepMs() { return play.stepMs; },        // the member the old api lacked
    get crtCanvas() { return crt && opts.monitor3d ? crt.fullCanvas : null; },
    get crtVersion() { return crt ? crt.version : 0; },
    select: (kind, id) => emit('select', { kind, id }),
    view: name => views[name],
    on: (name, cb) => { (handlers[name] = handlers[name] || []).push(cb); },
  };
  const emit = (name, arg) => { for (const cb of handlers[name] || []) cb(arg); };
  return { api, emit };
}
// drivers: one rAF loop calling activeView.frame(animNow(), dt * AnimClock.scale) and crt.frame(now);
// a ResizeObserver on each host calling view.resize(); play.on('instr'|'event'|'fast'|'reset'|'step')
// fanned out to dock.event(e) first, then every view (hidden views keep state; only the visible one gets frame()).
```

---

## 3. The engine to extract from app.js (`Playback`)

`src/ui/app.js` is one class `App` (lines 32-1553) plus `caption(e)` (1556-1578, pure) and
`startApp()` (1580-1591, `window.__app = new App()`). It mixes three roles: an **engine**
(assemble → boot → `machine.step()` → micro-events → `Story.build` → per-step dispatch, plus
fast-forward and fast mode), a **view host** (six views, dock, CRT, disks, Explain, fan-out), and a
**shell** (~83 DOM ids, 28 storage keys, menus, layout, pop-out, tooltips, shortcuts). The engine is
extractable with light surgery because it touches the DOM only through a few sinks
(`announce/setStatus`, `#now-micro`, `markLine`, `dock.sync`, `renderTrace`, `Sfx`), all of which can
become emitted events.

### 3.1 Construction order today (load-bearing, app.js:33-104)

`buildRom` (needs `Asm86 biosSource makeFont8x8 makeVgaRom makeVgaFont`) → `Tips.init(document)` →
`makeApi` → `ui()` (creates the editor, wires every control, sets `AnimClock` scale from storage,
`traceUi()`, `setSpeedPos(..., true)`, reads `#opt-boot`) → `new StateDock(this)` → `new
CrtScreen(#crt, machine, onKey)` → `monitorUi()` → `machine.onSpeaker(...)` → `makeViews()` →
`decapUi()` → `layoutUi()` → `new DiskPanel(this)` → `new Explain3D.Explain(this)` →
`loadInitialProgram()` (**the first boot**) → `syncUrl()` → explain autostart (400 ms) or
`startCard()` → `raf(loop)`. Before a view can show anything: `machine.setRom` must have run,
`boot()` must have run once (the views' `reset()` is their first sync), and `show()+resize()` must be
called with a laid-out host.

### 3.2 Boot and program loading (the BIOS hand-off, verified)

```js
// buildRom (app.js:133-151)
const r = Asm86.assemble(biosSource(model), { origin: 0 });         // bios.js:3514; exactly 65,536 bytes for every model
const rom = new Uint8Array(0x10000).fill(0xFF); rom.set(r.bytes.subarray(0, 0x10000));
rom.set(makeFont8x8(), r.symbols.font8x8);                          // makeFont8x8 lives in disks.js:402 (move it)
machine.setRom(rom, r.symbols);                                     // machine.js:369-372 → machine.biosSym
if (video === 'vga') machine.setVgaRom(makeVgaRom({ f8, f14, f16 }).bytes);   // vgabios.js:2842; fonts from makeVgaFont (crt.js:543)
// assembleAndLoad (1081-1102)
const p = Asm86.assemble(src, { origin: 0x100, cpu: cpuAsm });      // cpuAsm: '8086'|'286'|'386'|'486'|'586'|'686'
addrLine = new Map(p.lineMap.map(e => [PROG_BASE + e.addr, e.line]));   // PROG_BASE = PROG_SEG << 4 = 0x10000
// boot (1115-1155)
pause(); play = null; ff = null; seen.clear();
machine.reset();                                                    // machine.js:377-406: zeroes RAM 0..9FFFF, reloads ROMs, resets chips and CPU
if (bootMode === 'disk' && bootDrive === 'C') machine.pokeMem(0x4F6, [0x80]);
else { machine.loadProgram(p.bytes, p.origin);                      // machine.js:409-416: 1000:origin, PSP 'CD 20' at 1000:0000
       machine.pokeMem(0x4F0, [ip & 0xFF, ip >> 8, 0x00, 0x10, 0x86]); }   // ENTRY_IP/CS/OK at 0040:00F0 (bios.js:53-56)
syncBreakpoints();
if (!watchBoot) { let c = 0; while (!arrived() && c < 4_000_000 && !(cpu.halted && !(cpu.f & 0x200)))
                    c += machine.tickDevices(machine.cpu.step()) ?? 0; }    // raw loop 1137-1144; arrived: sregs[1] === PROG_SEG (program) or physIP === 0x7C00 (disk)
machine.takeStats(); eachView(v => v.reset()); dock.sync(false); crt.dirty = true; emit('reset');
```

The POST clears the BDA only up to 04EFh (bios.js:113-117) and at its end (171-190) does
`cmp byte [ENTRY_OK], 86h / je .prog / int 19h`; `.prog` sets SS=1000h SP=0, pushes 0 (a top-level
`RET` lands on PSP:0000 = INT 20h), pushes CS and IP, sets DS=ES=CS, zeroes BX CX DX SI DI BP, and
`RETF`. Verified hand-off state on the 8086: `CS=DS=ES=SS=1000h IP=0100h SP=FFFEh` regs 0
`FLAGS=F246h` (IF=1). With the FDC loaded the POST reaches the program after 428,861 clocks /
39,666 instructions (~90 ms in Node). `machine.startProgram()` (machine.js:418-430) sets the same
registers **without** the BIOS (no IVT, PIC, PIT) — only for pure register lessons. **Order matters:**
`reset()` wipes RAM, so load and write the 5 bytes after the last `reset()` (tests/story.test.mjs:41
calls `reset()` again and therefore traces the BIOS boot for every sample — confirmed; a task card to
fix it was queued).

### 3.3 The `Playback` interface (proposed) with the app.js ranges it comes from

```js
class Playback {
  // ---- construction ----------------------------------------------------------------------------
  constructor(machine, { model, cpuAsm, video, tracePre = 'parallel', traceBurst = 'fold',
                         traceRep = 'once', reducedMotion = false })          // app.js:34-76 (fields)
  on(name, cb) / emit(name, arg)                                              // 112-131 (keep the tiny emitter)

  // ---- program ---------------------------------------------------------------------------------
  buildRom() → { rom, symbols, vgaRom? }                                      // 133-151 minus #asm-status; makeFont8x8/makeVgaFont injected
  assemble(src) → { ok, errors, bytes, origin, symbols, lineMap }             // 1081-1099 minus #asm-errors/#asm-status/editor
  load(program)                                                               // 1096-1098: program, bootMode='program', addrLine Map
  boot({ watchBios = false, disk = null, drive = 'A' }) → void                // 1115-1146 minus views/dock/crt/announce → emit('reset')
  setBreakpoints(lines: Set<number>) → void                                   // 1103-1112 (takes lines, not the editor)
  lineOf(phys) → line | 0                                                     // 1502-1505 markLine, minus the editor call

  // ---- one instruction -------------------------------------------------------------------------
  beginInstr(now, clockMs = null, manual = false, single = false) → bool      // 1329-1373; emit('instr', events, info) instead of eachView/updateNow/markLine
  dispatchUntil(t) → void                                                     // 1375-1386: emit('event', e, clockMs) per event, then emit('caption', caption(e))
  finishInstr() → void                                                        // 1387-1402: emit('instrEnd', { play, text, regEvents, pauseReason })
  stepInstr() / stepClock()                                                   // 1278-1307 (stepClock: play.manual=true, clockMs=400, play.clock++)
  skipHalt() → bool                                                           // 1316-1326 (runs ≤3 M clocks until the CPU wakes; false if IF=0 and no NMI)
  stuck() → bool                                                              // 1405-1417 (JMP $ with IF=0)
  pokeKeyboard() → void                                                       // 1542-1552 (paused + halted + IF: step until back in the program)

  // ---- story -----------------------------------------------------------------------------------
  buildStory(events, opt?) → Story                                            // 389: Story.build(events, { prefetch: tracePre, burst })
  enterStep(i, back = false) → void                                           // 638-655: p.si, dispatchUntil(s.t) unless back, animMs = traceDur(s, stepMs) from the director, stepDur = auto ? max(animMs, readMs(s)) : animMs, emit('step', story, i, { ms, back, auto })
  traceNext() / tracePrev() / traceGo(i) / traceSkip()                        // 499-516, 623-630, 631-637, 527-545
  readMs(step) → ms                                                           // 393-396: (900 + lead·50 + rest·22) · clamp(stepMs/1100, 0.12, 4) via splitLead
  get stepMs()                                                                // 398: spd.stepMs || TRACE_MS[speedIdx]
  get tracing()                                                               // 397: traceOn && mode === 'explain' && Story defined

  // ---- fast paths ------------------------------------------------------------------------------
  startFF(why: 'loop'|'skip', until: (physIP) => bool) → void                 // 546-556 → emit('ff', state) instead of renderFF
  ffFrame() → void                                                            // 557-596: ≤12 ms/frame, chunks of 2000 raw cpu.step()+tickDevices, stops on done|break|halt|limit(20 M)
  ffStop(reason) → void                                                       // 604-611
  fastFrame(dt) → { reason, stats: { cps, ips, bus, sample } }                // 1460-1499: machine.run(≤20000) chunks, one machine.step() sample, emit('audio', speakerLog, soundLog); emit('fast', stats)

  // ---- the frame -------------------------------------------------------------------------------
  tick(now, dt) → void                                                        // 1420-1436 loop body minus crt/disks/views: ff ? ffFrame() : running&&fast ? fastFrame(dt) : explainFrame(vnow)
  explainFrame(now) → void                                                    // 1437-1459 (auto-advance a story after stepDur; non-story play advances by clockMs; ≥15 ips chains instructions)

  // ---- speed -----------------------------------------------------------------------------------
  speedAt(pos) → { pos, idx, mode, ips|cps, stepMs, label }                   // 1197-1216 (pure) with SPEEDS/TRACE_MS/MOTION/SLOW (4-30)
  setSpeedPos(pos) / setMotion(i)                                             // 1225-1249 minus #speed/#speed-out/audio retune → emit('speed'), emit('mode') on change (finishInstr + emit('traceClear'))
  start() / pause() / toggleRun()                                             // 1258-1277, 1251

  // ---- address helpers -------------------------------------------------------------------------
  codeMask() codeOpts() linPhys(lin) codePhys(ip, base?) codeByte(ip, i) isSeen(phys)   // 519-524

  // ---- state (read by directors) ---------------------------------------------------------------
  play, ff, running, mode ('explain'|'fast'), spd, speedPos, speedIdx, seen, traceCount, lastTraced,
  addrLine, program, bootMode, bootDrive, ffNote, ffBypass
}
```

Events a new shell/director subscribes to instead of the old DOM sinks: `reset`, `instr(events,
info)`, `event(e, clockMs)`, `caption(text)`, `step(story, i, info)`, `instrEnd(...)`, `ff(state)`,
`fast(stats)`, `audio(spk, snd)`, `speed`, `mode`, `traceClear`, `status(text, cls)` (was
`setStatus`), `announce(text)` (was `#live`). The fan-out order to keep: `dock.event(e)` then every
view's `event(e, clockMs)`, hidden or not (1381-1382); only the active view gets `frame()`.

### 3.4 The `play` object (app.js:1361-1363, fields added later)

`{ events, idx, cycles, clockMs, start, manual, clock, text, cs, ip, lastCaption, story | null, si,
stepT, auto, nextPhys }` + `stepDur`, `animMs` (enterStep), `manual`/`clockMs` (stepClock).
`clockMs` derivation (1354-1359): tracing → `clamp(stepMs/4, 20, 250)`; single → `clamp(1300/cycles,
6, 140)`; running → `clamp((1000/ips)/cycles, 0.6, 250)`; reduced motion floors at 8. `single`
(Next/Instr) sets `auto: true` so the story auto-plays to its end then stops; `traceNext` sets
`auto=false` so it waits for the user.

### 3.5 What reaches the views (the micro-event stream)

`Machine.step()` (machine.js:484-511) sets `cpu.trace = []`, runs one `cpu.step()`, ticks devices,
merges device events with times inside the instruction, sorts by `t`, returns `{ cycles, events }`.
**The trace switch is `cpu.trace` (null | array), not `cpu.tr`** (the Task Register on 286+). Kinds
(emitter lines in section "cores" map; ARCHITECTURE.md is authoritative):
- 8086: `fetch{addr,data,width,seg,dev,q} bus{type: memr|memw|ior|iow|inta|halt, addr,data,width,seg,dev,owner,len?} queue{op: push|pop|flush, n, q} decode{t:0,cs,ip,len,text,bytes} ea{seg,segv,off,phys} alu{op,a,b,r,w} reg{r,v} flags{v,old} int{vec,src: sw|irq|nmi|exc} fpu{text,cycles} end{t}`; the machine adds `fdc dma sb opl`.
- 286: `+ desc sys task iq`; `int.err/name`; `fetch/bus.len` clocks (use `e.len || 4`). 386: `+ page tlb`, `decode.bits`, `ea.lin`, 32-bit `reg`. 486: `+ cache pipe`, `bus.burst/line/beat`. P5: `cache.cache/state/wb`, `pipe.pipe/paired/partner/reason`, `+ btb`, `bus.hi`. P6: `+ uop rat rob`, `decode.uops/decoder/dclk`, `cache.level`, no `pipe`.
- Gotchas: interrupt delivery is its own `cpu.step()` (61 clocks, decode text `INTR xxh`, `{k:'int', src:'irq'}`, `instructions` not incremented); a REP string op is one iteration per step with `cpu.repState` set (breakpoints ignored meanwhile); a halted 8086 step is 2 clocks of `hlt (halted)` with **no `halt` bus event** (only 286/386 cores emit one) — never `machine.step()` in a loop while halted with IF=1 (~131k steps to the next timer tick; use `run()` or `skipHalt`); `halted && !(f & 0x200)` means the program ended (INT 20h prints `[program ended]` then `CLI; HLT; JMP $`, bios.js:2546-2553).
- Consumers by kind (`e.k ===` counts): board3d opl fetch queue pipe uop rob rat decode task fpu bus btb sys sb reg page int flags ea desc cache alu; die fetch fpu bus queue alu decode cache btb reg desc pipe page uop rob rat int ea; timing pipe end bus uop rob queue int fpu fetch decode cache btb; memmap bus tlb int decode cache; dock tlb page decode task sys rob reg pipe fpu flags desc cache btb; app decode reg.

### 3.6 Speed model (pure once the DOM writes leave)

`SPEEDS` (4-15): seven explain stops `{ label, mode:'explain', ips }` (¼ … 60 instr/s) then three
fast stops `{ mode:'fast', cps }` (30 kHz, 1 MHz, real = `machine.clockHz`, patched at 57).
`TRACE_MS` (28) `[4000, 2600, 1700, 1100, 650, 330, 150]` per explain stop. `MOTION` (24) seven
slow-motion scales 1/64…1, `SLOW = 60`: slider `v < SLOW` → `setMotion(round(v/10))` +
`setSpeedPos(0)`; else `setSpeedPos(v − SLOW)`. Explain's `start()` uses `setSpeedPos(20, true)`
(= stop 2, 1 instr/s, 1700 ms). The brief's pacing model (2-4 s per beat) will replace this slider;
keep `speedAt` for the Workbench.

### 3.7 Two clocks and the frame loop

`loop(now)` (1420-1436) runs on `raf` (pip-aware), exits when `!visible` (restarted on
`visibilitychange`, 373-378); `dt = min(running && fast ? 250 : 100, now − last)`; `vnow =
animNow()`, `vdt = dt · AnimClock.scale`; then exactly one of `ffFrame / fastFrame / explainFrame`;
every frame `crt.frame(now)`, `disks.frame()`, drain `machine.takeSpeaker()/takeSound()` when not
fast-running (so the logs do not grow), `activeView.frame(vnow, vdt)`, `updateStats()` every 90 ms.
Explain runs a **second** rAF loop (explain3d.js:477-490). The new shell should own one loop and
pass `animNow()` to everything animated; pause = `AnimClock.setScale(0)`.

### 3.8 Leave behind (rewrite from scratch)

`ui()` 244-384, `traceUi/renderTrace/renderFF/setTraceText/syncTracePanel` 399-497, 598-622,
656-699, `layoutUi/relayout/popOut` 703-812, `monitorUi` 819-929, `startCard` 933-961, `modelUi/
drawBrand` 964-1034, `showDesc/shortcut/setStatus/announce` 1036-1069, `importFile/exportFile`
1173-1196, `updateNow/updateStats/updateClockCaption` 1308-1313, 1507-1541, `selectTab/
syncBoardModes/moveInk/decapUi` 184-243, 472-481, `syncUrl` 212-223 (but keep writing `a86:cpu`/
`a86:video` before a reload, or keep the machine in the address).

---

## 4. The director API of the board (`BoardView`)

Every method no-ops when `!this.ok`. "anim time" = `animNow()`; camera, decap, tiles and hover use
`performance.now()`. ⟨xp⟩ marks members that exist for the Explain director and that a new lesson
player would use the same way.

### 4.1 Lifecycle

| Method | Line | Semantics |
|---|---|---|
| `show()` | 7738 | `visible = true`, shows the trace group, `attachTo(this.wrap)` (takes the shared canvas back from a RunnerView), hides `runnerGroup`, `resize()`. |
| `hide()` | 7749 | `visible = false`, clears hover/pop. Frees nothing. |
| `resize()` | 7753 | Reads `host.clientWidth/Height`; no-op when 0 or unchanged; sets renderer size, aspect, fov 42 (portrait) / 30; re-applies `overview` if `cam.fit`. |
| `frame(now, dt)` | 7803 | **Call every rAF** with anim-clock `now`, `dt` (clamped 0.05-100). Runs `simStep` (signals, die FX, CRT copy, decap wear, die tiles ≤8 ms), trace/xpCard/live-unit update, `trViewOffset`, `updateCamera`, `updateOcclusion`, `updateHover`, exposure dim (0.55 in trace vs 1.05); renders only when busy (idle gap 33 ms, 500 ms reduced); then `placeTrace()` (DOM tokens/labels) and `drawSpot` ⟨xp⟩ or `drawUnitDim`. |
| `reset()` | 3955 | Clears signals, glow levels, `last`, `traceClear()`. |
| `setReducedMotion(on)` | 3970 | Instant flights, no chase, instant decap, no camera springs, longer idle gap. |

### 4.2 Feed from the engine

| Method | Line | Semantics |
|---|---|---|
| `instr(events, { clockMs, cycles, text, cs, ip, trace })` | 3912 | Start of an instruction; `manual = clockMs ≥ 300`; clears the trace. |
| `event(e, clockMs)` | 3863 | One micro-event: always `dieFx(e)`; returns if `app.tracing`; else `liveUnits`, then `fetch|bus` → `busSig` (lights address/data/control chains from `ROUTES/CHAINS`, `chaseNote`, `Sfx.arrive`), `int`, `fpu`, `desc|sys|task`, `queue`. |
| `fast(stats)` | 3925 | `stats.bus = { fetch memr memw ior iow inta fpu dev:{ram rom pic …} }` → steady glow levels; `stats.sample` replayed as pulses every 420 ms. |

### 4.3 Story playback

| Method | Line | Semantics |
|---|---|---|
| `traceDur(s, ms)` | 6313 | Stores `s._ms = ms`; returns the step's total animation ms (Explain: camera lead + work via `xpPlan`; else `flowFull(s).T`). **Call before `traceStep` in the same frame.** |
| `traceStep(story, i, { ms, back, auto })` | 7032 | Builds the journey (`trJourney` 6132: board legs from `ROUTES/CHAINS`, die dives via `chipVisit` 6064 using `CPU_TRACE`/`traceModel(part)` **only if `this.runner` exists**), flow meshes, orbs, DOM labels; sets `this.tr = { story, i, s, v, t0, dur, cyc, rider, shots, cam, camB, … }`; dims exposure; moves the camera (normal: `trTrack`/`trCamGoal` springs; ⟨xp⟩: `xpPlan` scenes). Replays earlier steps on a jump back (7048-7057). `traceStep(null)` ≡ `traceClear()`. |
| `traceClear()` | 7088 | Removes flows/orbs/labels, hides token, unit window, unit tag, card, block glows. |
| `trJourney(s)` → `{ segs, … }` | 6132 | The step's segments: `{ kind:'dwell', at, dive, block, card, label }` for unit visits; cached on `s._j`. Dispatch by `s.kind`: inside → `cm.inside`; page → `PAGE_CARD`; cache → `CACHE_CARD`; btb → `P5_CARDS`; sound → `SOUND_CARD`; fdc|dma → `FDC_CARD`; irq → `PIC_IRQ_TRACE`; bus by phase (addr → `cm.out` + `GLUE.latch` + `tm.addr`; cmd → `cm.status` + bus-controller + `GLUE.pal/dec` + `tm.cmd`; data → `tm.read/write` + `GLUE.xcv` + `cm.in/write`; `'all'` → short form). |
| `trChipKey()`, `trInDie` | 7238, 7596 | Which chip the token is in (Explain keeps the unit caption while the token stays in one chip). |

### 4.4 The ⟨xp⟩ director surface (explain3d.js is its only client today)

| Member | Line | Semantics |
|---|---|---|
| `xpSet(o)` | 6663 | `o = { shots: true, spot: true }` or `null`. Creates the `.bv-spot` canvas, opens (un-minimises) the block card. Precondition for shots and the spotlight. |
| `xpTime` (property) | read 6317, 6337 | `{ travel, work, read }` multipliers for `xpPlan`/`traceDur`. |
| `xpBox(id)` → `THREE.Box3 | null` | 6676 | Ids: any glow id (`cpu fpu clk bus dec lat0-2 xcv0-1 pic pic2 pit ppi dma dma2 nmi kbc rtc romE romO ramE ramO crtc vram0 vram1 cgrom vgac vdram dac vbios fdc hdc sbdsp opl xram bat kbd spk fddA fddB hdd …`), `'monitor'`, `'cga'` (video card group), `'drives'` (bay), `'screenTL'` (top-left quarter of the CRT), `'die:<decapKey>'` (an opened die; call `dieEntry` first). |
| `xpFocus(ids, { fly = true, theta = 0.22, phi = 0.85, keepY })` | 6696 | Spotlight only these parts (`xpIds`, `xpForce`) and fly to their union box (`xpShotBox` 6722); a single `'die:key'` uses the die framing (needs the runner's `dieKit`); `fly: false` keeps the camera; during a step it sets `tr.camB/tr.shot` (1100 ms move) instead of `flyTo`. |
| `xpPlan(s, ms)` → `{ Tm, scenes:[{ts, shot:{tgt,r,th,phi,up}, blend}], segT, runs, lead }` | 6336 | Camera scenes and times of a step; `ms < 1000` = "quick" (one shot, quarter work time, 6338-6343); cached on `s._j._xp` by ms, `xpTime`, viewport. |
| `xpCard` (property) | set by explain3d 263, cleared 506; drawn by `xpCardStep` 6324 | `{ spec, t0, dur }` — a card shown on the anim clock when no trace step is active (tour beats); placed at `(12, xpTopPx || 60)`. |
| `xpNowUnit()` → `{ unit, card, block, dive:{e} } | null` | 6522 | The rider's current segment while the token works in a unit with a card. |
| `xpUnitText(g)` → `{ chip, unit, text }` | 6500 | `chip = e.part` (via `DIE_OF`), `unit = TitleCase(g.block)`, `text = card.sub || g.label` — the "chip · unit" caption. Also `xpUnitCap(g)` 6513, `xpReadMs(g, read)` 6517. |
| `xpPrefetch(s, ms, soon)` | 5581 | Queues high-res die tiles along the step's camera path (`tileQ`, ≤8 ms/frame, capped at 80 jobs). |
| `xpTermTip(text, spec)` | 4558 | Glossary lookup through `BlockPanel.termTip`. |
| `xpCovers()` / `trCover(trace)` | 7208 / 7224 | How much of the view the card, `#monitor`, `.xp3-prog`, `.xp3-bar` cover, so shots centre in the free area; sets `xpTopPx` (used by `unitTag`, `xpCardStep`, labels 7705/7719). **Make this take covers as data.** |
| `xpShotBox`, `xpShot`, `xpCamera`, `xpCutMs`, `xpEase`, `xpCamAt` | 6722, 6737, 6752, 6479, 6489, 5644 | Shot framing, the van Wijk–Nuij zoom path (`zoomPath` 1200), cut duration, token speed ramps. |
| `drawSpot(now)` | 6773 | Internal: the dark overlay with holes for the step's path/dies or the `xpIds` boxes; called from `frame` when `this.xp`. Uses `ctx.filter = 'blur()'` and `roundRect`. |

The board reads `this.xp` in ~20 more places (7039, 7140, 7147, 7443, 7502, 7521, 7569, 7601,
7612, 7705, 7719, 7808, 7822): shot-based camera instead of flow tracking, token label and card
positions, `xpEase`, unit windows suppressed in favour of on-die UnitFx.

### 4.5 Camera

| Member | Line | Semantics |
|---|---|---|
| `this.cam` | 2200-2204 | `{ target: Vector3, theta, phi, r, g: {target, theta, phi, r} (goal), flight, preset, fit, follow }`; `this.camera` (PerspectiveCamera, adaptive near 4287). |
| `applyPreset(name, instant)` | 4197 | `PRESETS` (432-441): `overview | cpu | memory | io | screen`, each `{ label, target, theta, phi, r }` (r = 0 fits). Pauses chase, leaves focus. |
| `flyTo(target, theta, phi, r, instant)` | 4212 | 1300 ms eased flight with a slight pull-back arc. |
| `focusOn(id)` | 4345 | Fly to a glow id / `'monitor'` / `'spk'` and `setFocus` (hides occluders, shows the focus pill). |
| `setFocus(obj, name)`, `applyHidden`, `occluders`, `updateOcclusion` | 2612-2718 | Focus and occlusion. |
| `focusChip(key, blockLabel?)` → bool | 5692 | Decap key or glow id → `openWindow` + `zoomToDie` (5668: straight over the die, rolled upright), optionally zoom to a block by fuzzy label (`bIdx`). False if the chip has no die. Used by die.js:1286. |
| `userMoved()`, `clampGoal()`, `fitRadius()` | 4226, 4239, 4125 | Any drag/wheel/key pauses chase and holds the trace camera; limits phi 0.12-1.55, r 0.1-90, target inside the board box. |
| `setChase(on)`, `chaseOn()`, `pauseChase`, `chaseNote/chasePos/chaseStep` | 4135, 4132, 4154-4196 | Follow camera (frames CPU + chips touched in the last 1.8 s) while `app.running` and not reduced. `setChase` toggles `#opt-follow` if present, else sets `this.follow`. |

### 4.6 Dies, decap, cards, glows

| Member | Line | Semantics |
|---|---|---|
| `dieEntry(key)` → entry | 6048 | `{ key, grp, d:{L,W,H,pins,…}, planeY, part, glowId, cov, mesh, mask, comp, cw, ch, die, tex, mat, win, auto, turn }` (4711-4750) with a round window opened (`openWindow` 5346, 650 ms). Keys: every chip id in `CHIPS`, card chips, `ramE0-7 / ramO0-7`. `this.decaps` is the Map. |
| `decapAll()` / `restoreAll()` | 4790 / 4804 | Open all ~40 packages (700-1200 ms wear) / close them. |
| `showCard(spec, u)` | 7508 | Lazily creates a `BlockPanel` in `this.root` (`.bv-card`, `minKey 'boardCardMin'`), `show(spec)` on identity change, `update(u)`; `showCard(null)` hides. Never minimised under ⟨xp⟩ (7521). `this.bcard` is the panel. |
| `unitTag(spec, r, a)` | 7489 | Floating name+facts label above a unit's screen rect `r = {x,y,w,h}` with opacity `a`. |
| `blockGlows(e, label)` → `[{mesh, mat, v, tgt}]`, `blockGlow(e, bi)` | 7269, 7275 | Set `tgt` 0..1 to light a die block. |
| `unitOverlay(e, label)` + `paintUnit(o, spec, u, now, zs)`, `unitWindow(sg, u)`, `blockScreen(e, label)`, `unitZoom(o, sg)` | 7299, 7320, 7441, 7341, 7333 | A 768-px canvas plane over a unit painted by `UnitFx.draw`; the trace's unit window; a unit's screen rect; `zs` so 1 drawing px ≈ 1 screen px. |
| `liveUnits(ev, now, clockMs)` / `updateLiveUnits` | 7361 / 7404 | Non-trace mode: UnitFx drawings for events when the camera is close (`cam.r ≤ 12`). |
| `layOf(e)`, `bIdx(e, label, n)` | 4888, 4898 | Cached `dieLayout` per chip; block index by label **after the `BLK_286/386/486/586/686` remap** (857-882). |
| Scene handles | — | `this.glows[id] {obj,pos,v,tgt,color,ref}`, `this.chipPos[id]`, `this.facePos[id]`, `this.decaps`, `this.card/dcard/xcard/bay/monitor/scrMesh`, `this.routes[id].path`, `this.scene`, `this.renderer`, `this.camera`. |

### 4.7 Ids are stringly typed across files

Glow ids = `INFO` keys (board3d 210-296); decap keys (`ramE3`); die-plan parts (`DIE_PLANS` keys,
via `DIE_OF`); block labels (`'ALU'`, `'ADDRESS ADDER'`, remapped per model by `BLK_*`); story kinds
and phases; die.js unit ids (`sigma`, `pfq`, `rat`) bridged to board labels only by `DIE*_3D` maps
(die.js:41, 48, 2812, 4061, 5289, 6856) and `focusChip`'s `label.includes(want)` (5701-5702). A
lesson data model must use the exact spellings.

### 4.8 What BoardKit exports (8799-8807) — the pure parts usable without a BoardView

`layRoute zoomPath M286 M386 M486 M586 M686 FPU_ON BLK_286..686 P5_CARDS P6_CARDS VGA NM BW BD
CHIPS BANKS BANK_SPEC RAM_X *_CHIPS CARD VCARD DCARD XCARD ROUTES CHAINS DIE_PLANS DIE_OF dieLayout
drawInterior INFO IO_IN IO_DEV DEV_ALIAS ioBlock busInfo DAC_PORT RB CB ADDR_MASK ADDR_BITS hexA
CPU_TRACE PIC_IRQ_TRACE traceModel TRACE_MODELS FDC_CARD PAGE_CARD SOUND_CARD CACHE_CARD STATUS
CMD_BIT CMD_NAME DEV_NAME DEV_SEL PAL chamfer cumLen project cutAt cutFrom chipDims vramChips
xramChip`. `DIE_PLANS` (733-856) holds 29+ parts as `{ a, tag, b: [[x,y,w,h,'LABEL',kind]] }`;
`drawInterior(g, cw, ch, d, part, S, vis, turn)` (912) paints a die on a 2D canvas; `dieLayout(cw,
ch, d, part)` (1291) → pixel blocks. These are reachable only after loading the whole 553 KB file;
lifting them (with the spec builders) into `dieplans.js` + `specs.js` is the clean cut.

---

## 5. The content inventory

### 5.1 The machines (facts the code states, with the constructor that builds each)

| | 8086 | 80286 | 80386 | 80486 | Pentium | Pentium Pro |
|---|---|---|---|---|---|---|
| Class | `Machine` (machine.js:21) | `Machine286` (machine286.js:11) | `Machine386` (machine386.js:20) | `Machine486` (machine486.js:22) | `Machine586` (machine586.js:24) | `Machine686` (machine686.js:27) |
| Options | `{ video, soundCard }` | same | `+ wasm` | `+ cache, wasm` | `+ cache, fdivBug = true, wasm` | `+ cache, wasm` |
| CPU class / `cpuAsm` | `CPU8086` / `'8086'` | `CPU80286` / `'286'` | `CPU80386` / `'386'` | `CPU80486` / `'486'` | `CPU80586` / `'586'` | `CPU80686` / `'686'` |
| clockHz | 4,772,727 (14.318 MHz ÷ 3, 8284A; 210 ns) | 8,000,000 (82284 16 MHz ÷ 2) | 25,000,000 (82384 CLK2 50 MHz ÷ 2) | 33,000,000 | 66,000,000 | 200,000,000 core; `bus.busRatio = 3` → 66 MHz FSB |
| Data bus / address | 16-bit multiplexed AD0-AD15 + A16-A19, 20-bit, 8282/8286/8288/74LS138, T1-T4 | 16-bit, A0-A23, 74LS573/74LS245/82288/PAL16L8, Ts/Tc, 1 wait state | 16-bit (386SX-like), A1-A23 + BHE/BLE, 1 ws | 16-bit, A2-A31 + BE0-3, line fill = burst of 8 words | 64-bit, A3-A31 + BE0-7, fill = 4 × 8 bytes (2-1-1-1; 3-2-2-2 here) | 64-bit FSB, REQ0-4, L2 miss 22 clocks to first 8 bytes |
| Memory | 1 MB (640 KB RAM in even/odd banks, CGA 16 KB at B8000, ROM 64 KB at F0000) | 16 MB space; 640 KB + 1 MB XRAM card; A20 gate | 16 MB RAM, ROM mirror at FFFF0000 | 16 MB | 16 MB | 16 MB (DOS sees 15,360 KB XMS) |
| Prefetch queue | 6 bytes | 6 (+3 decoded) | 16 | 32 | 32 (two 32-byte buffers) | 32 |
| Caches | none | none | none (32-entry TLB) | 8 KB unified, 4-way, 128 sets × 16 B, write-through | 8 KB code + 8 KB data, 2-way, MESI write-back | + 256 KB L2 (2048 × 4), L1 hit 3 clocks, L2 +4 |
| FPU | 8087 chip (`owner:'fpu'` bus cycles, NMI) | 80287 via ports F8h-FFh, IRQ13 | 80387 | on chip | on chip (FDIV bug switch) | on chip (no FDIV bug) |
| Paging | — | — | 4 KB pages, 32-entry TLB | + PWT/PCD | + 4 MB pages (CR4.PSE) | + global pages |
| Execution | EU + BIU, microcode 512 × 21 | four units | six units | 5 stages PF D1 D2 EX WB | U/V pipes, BTB 256 (64 × 4, 2-bit) | 3 decoders 4-1-1, RAT, ROB 40, RS 20, 5 ports, BTB 512 (128 × 4, 4-bit history), RSB 16 |
| Extra chips (`dev` ids) | ram rom vram pic pit ppi dma crtc cga nmi fdc hdc sb opl | + xram pic2 kbc rtc a20 dma2 fpu | same | same | same | same |
| Menu line (index.html:28-48) | "Intel 8086 + 8087 · 4.77 MHz · 1 MB · real mode · 1978" | "80286 + 80287 · 8 MHz · 16 MB · protected mode · 1982" | "80386 + 80387 · 25 MHz · 32-bit · paging · virtual 8086 · 1985" | "80486DX · 33 MHz · 8 KB cache · FPU on chip · 5-stage pipeline · 1989" | "Pentium (P5) · 66 MHz · U and V pipes · branch prediction · 8 + 8 KB cache · 64-bit bus · 1993" | "Pentium Pro (P6) · 200 MHz · out-of-order µops · register renaming · 256 KB L2 in the package · 1995" |
| BIOS (`biosSource`) | 2,674 lines, 404 symbols | 3,013 / 445 | 3,091 / 456 | 3,293 / 485 | 3,317 / 487 | 3,321 / 488 |

Sentence names per model live in `Story.N` (story.js:14-24: `cpu fpu lat xcv bus abus status dec
aw`) and `board3d.js NM` (30-40); device prose names in `Story.DEV` (29-35). Sources for the table:
index.html:25-60, README.md:42-58, explain3d.js `CPUS` 23-37 and `clockCard/clockText` 443-465,
die.js `DIE*_INFO`, ARCHITECTURE.md per-model sections (667, 741, 909, 1100, 1184, 1449, 1767,
1926, 2315). Accuracy caveats to respect (README.md:127-134; ARCHITECTURE.md:856, 2140-2155):
results and flags exact (640,744 SingleStepTests); cycle counts from the Intel tables, prefetch
timing not cycle-exact; 386 timing from the data sheet only; the P6 shows at least 1 clock per
instruction; the die floor plans are drawings, not photographs; the boards are original designs.

### 5.2 Unit texts

Three independent stores describe the same units in different words and different namespaces:

| Store | Count | Shape | Coupling |
|---|---|---|---|
| `die.js` `DIE_INFO` (21-38), `DIE286_INFO` (1919-1942), `DIE386_INFO` (2781-2810), `DIE486_INFO` (4036-4060), `DIE586_INFO` (5266-5287), `DIE686_INFO` (6831-6854) | **16 + 22 + 28 + 23 + 20 + 22 = 131** `unitId: [title, 1-3 sentences]` (verified; the "169" in one map is wrong) | top-level consts, pure | none; keys are die.js unit ids (`alu flags regs sigma segs busctl queue dec intr rom pads`; 8087 `f87q f87sw f87cw f87neu link`; P5 `icache dcache itlb btb biu pfb dec rom dtlb walker upipe vpipe regs flags seg alu barrel fstk fpx`; P6 `icache itlb btb ifu dec msrom rat rob rs rrf flags fstk p0-p4 mob dcache dtlb biu l2 bsb`) |
| `board3d.js` `tcard(kind, title, chip, sub, o)` calls in the trace models (1626-2082) | **85** `sub` sentences with live values ("CS × 16 plus the offset gives the 20-bit address.", "Address bits 4-10 select set 37 of 128. …", "The RAT renames the registers: …") | functions of `ctx = { I, s, ev, m, e, part, … }` → `[[BLOCK LABEL, spec]]` | closure-local; `window.__app.machine` for cache/P6 cards; exported via `BoardKit` |
| `board3d.js` `INFO_86/286/SB/CARDS/386/486/586/686` → `INFO` (210-296) | **68** `[name, kind, one paragraph]` for every chip, socket, crystal, card, drive, monitor, speaker, keyboard | closure-local, exported on `BoardKit.INFO` | none beyond the model flags |
| `board3d.js` `DIE_PLANS` (733-856) | block labels per part (8086: ALU FLAGS REGISTERS ADDRESS ADDER SEGMENT REGS BUS CONTROL QUEUE DECODER INTERRUPTS TIMING MICROCODE ROM; P5 19 units; P6 18 units; + 8087, 80286, 80386, 80486, DRAMs, EPROMs, 8259A, 8253, 8255, 8237, 8288, 8284A, 8282, 8286, 74LS245/138/74/175, 6845, FDC, 2364, VGAC, RAMDAC, 9216, 82288, 82284, 8042, MC146818, PAL16L8, CT1351, YM3812, YM3014B, CT1336, TDA1013) | data | closure-local |
| `timing.js` `TV_INFO*` (366+) / `TV_GROUPS*` (88+) | 132 signal descriptions `{ n, job, drv, rcv, lvl, chip }` / 150 rows | data | closure |
| `dock.js` `DOCK_*` + inline `title`s (3-40, 177-181, 260-289, 450-925) | ~125 bit-level tips (9 flags + NT/VM/RF/IOPL/ID/AC; CR0 6/11 bits; CR4 4/6; 10 P6 stall names; 5 ports; 4 BTB states; cache/BTB/pipe/OOO statistics) | consts + DOM code | mixed |
| `memmap.js` `MV_REGIONS*` (5, 17, 33), `MV_VECTORS` (48), tips (339, 434, 448, 947) | region names, "20-bit address = segment × 16 + offset.", KEN# note | data + inline | closure |

The bridge between die.js ids and board labels is `DIE*_3D` (`unitId → [decapKey, 'LABEL' | null]`).
Explain's "chip · unit" caption is `xpUnitText(g)` = `{ chip: e.part, unit: g.block, text: card.sub }`
from the 85 subs, not the die.js texts. A content module for the new page should merge the three
into one table keyed by `(part, label)` with `title`, `short` (the sub), `long` (the DIE_INFO text),
and the die.js id.

Sample texts (verbatim, to set the register): `DIE_INFO.queue` "Instruction queue — The BIU
prefetches up to 6 bytes while the EU executes. It fetches a word from an even address. A jump
flushes the queue and the prefetched bytes are lost." `DIE686_INFO.rat` "Register alias table (RAT)
— The RAT renames the registers. For each architectural register it keeps the ROB entry of the
newest µop that writes it. A µop that reads EAX gets the ROB entry of the producer, not EAX itself.
So µops that write the same register do not wait for each other. …" tcard sub (486 CACHE SET
SELECT): "Address bits 4-10 select set 37 of 128. The 4 tags of the set do not have 00104h: a read
miss."

### 5.3 The glossary (`blocks.js`, pure, `BlockPanel.termTip(text, spec) → { term, text } | null`)

- **`GLOSS`** (1567-1704): **120** `[regex, term, text]` rules (verified) written for the words drawn
  on a unit: tag, set, offset, miss, hit, way, comparator, transfer, line buffer, L2, back-side bus,
  bus interface, pipeline, clocks, RAT, RRF, ROB entry, reservation station, µop kinds, ports, head,
  done, latency, queue PUT/TAKE, RAS/CAS, word/bit line, sense amplifiers, capacitor, decoder, MESI,
  HA/FA, cin/cout, Ts/Tc/T1-T4, S2 S1 S0, M/IO, MRDC/MWTC/IORC/IOWC/INTA, ALE, DEN, DT/R, KEN#,
  BLAST#, CACHE#, tri-state, latch/strobe, opcode/w/d/mod/reg/r/m, little endian, PF/D1/D2/EX/WB,
  pairing, chip select, PAL gates, registers, segment registers, CLK, …
- **`kindTip`** (1691-1704): 9 rules by drawing kind (bit n; set/state/tag/no tag; transfer n;
  entry n; stage n; U/V pipe) + 7 fallbacks (hex value, bits, row/column, "No value here.").
- **`KIND_TIP`** (1729-1749): **19** last-resort texts, one per drawing kind.
- Consumers today: board3d `termAt/termShow` (4499-4545: hit-tests `UnitFx.words` on the die canvas
  or `svg text` rects) and `xpTermTip` (4558). Explain never calls it.
- Other tooltip tables: trace-bar tips (app.js:447-463), `Story.DEV`/`STATUS_NAME` (story.js:27-35),
  memmap pills, timing rows, the 2D player's legend (explain.html:87-90) and `meaning()` byte
  decoder (explain.js:64-77 — the only instruction-encoding lesson in the codebase).
- Verdict for the brief's principle 3 ("a term gets a one-line meaning the first time"): the glossary
  is about the drawn words, not a learner's vocabulary; "why" texts are almost absent. A new
  `glossary.js` should wrap `termTip` and add learner terms.

### 5.4 The samples as lessons (`bios.js SAMPLES`, 35 entries, `{ id, name, desc, src, model?, video? }`)

Filtering rule (app.js:252-253; tests/machine.test.mjs:152-155): a machine runs the base samples
plus those of every older-or-equal AT model; `video: 'vga'` only on VGA. Expected screen output per
sample is in tests/machine.test.mjs:70-110 (ready-made lesson checks). Sizes measured by assembling
each with its model's cpu level.

| id | name · desc | model | src lines / bytes | What the trace shows / the idea |
|---|---|---|---|---|
| hello | Hello, 8086 · BIOS teletype output, one character at a time. | all | 15 / 74 | LODSB (Address calculation, T1/T2/T3 read), INT 10h (vector table), the BIOS writes B8000 → the bus cycle, the IVT, BIOS services |
| fib | Fibonacci · Loop, ADD, XCHG and a decimal print routine with DIV. | all | 44 / 63 | ALU steps, flags, JNZ flushing the queue → ALU, flags, loops, division |
| sort | Bubble sort · Nested loops, CMP, conditional jumps and memory swaps. | all | 44 / 83 | CMP ("Only the flags keep the result."), array reads/writes |
| vram | Colour bars in VRAM · Direct writes to B800:0000 with STOSW and REP. | all | 29 / 84 | word writes to the CGA card ("The card in the slot decodes the address itself.") → memory-mapped video, attribute byte |
| movsb | REP MOVSB copy · String instructions: DS:SI to ES:DI, CX times. | all | 17 / 94 | one REP iteration per step group, read then write |
| fact | Recursive factorial · CALL/RET, the stack frame and 32-bit MUL results. | all | 49 / 71 | pushes/pops on SS:SP, CALL/RET, MUL DX:AX → the stack |
| bcd | BCD arithmetic · Packed decimal addition with ADC and DAA. | all | 45 / 82 | ADC, AF/CF |
| clock | Timer interrupt · Hook INT 1Ch: the 8253 fires IRQ0 18.2 times a second. | all | 62 / 121 | the IRQ step, two INTA cycles ("vector 08h on the data bus"), the handler → hardware interrupts, PIT, PIC |
| keys | Keyboard echo · INT 16h waits with HLT until IRQ1 brings a key. | all | 25 / 65 | HALT status, IRQ1, INT 09h, port 60h → HLT, keyboard, I/O read |
| tune | Speaker tune · The 8253 channel 2 square wave drives the speaker. | all | 62 / 92 | I/O writes to 42h/43h/61h (IOWC) → I/O ports, timer as sound |
| sb | Sound Blaster: FM and DMA · find the YM3812 and DSP, chord, then a sample by DMA 1 and IRQ 7. | all | 294 / 825 | OPL2 register steps, DSP command, DMA (HOLD/HLDA), IRQ 7 |
| pi | 8087: pi · FLDPI, FMUL and FBSTP: 18 BCD digits. | all | 41 / 86 | FPU steps with clock counts; the coprocessor takes the bus |
| quad | 8087: quadratic · FSQRT, FDIV and FIST solve x² − 3x − 10 = 0. | all | 71 / 160 | floating point |
| pm286 | 80286: protected mode tour · LGDT, LIDT, LMSW; catch a #GP; return through a CPU reset. | 80286 | 127 / 640 | descriptor cache steps, Protection steps, the 8042 reset |
| ins186 | 80286: 186/286 instructions · PUSH imm, IMUL imm, shifts by count, ENTER/LEAVE, PUSHA/POPA. | 80286 | 54 / 95 | stack frames |
| a20 | 80286: A20 and extended memory · the 1 MB wrap with A20 off, then above 1 MB (port 92h). | 80286 | 70 / 264 | a write at FFFF:0010 lands at 00000h, then at 100000h |
| fib32 | 80386: 32-bit Fibonacci · EAX/EBX/EDX ADD, ROL for hex, 32-bit DIV. | 80386 | 107 / 276 | two bus cycles per dword on the 16-bit bus |
| paging | 80386: paging · a page directory and table send linear 00200000h to B8000h; CR3, CR0.PG, A and D. | 80386 | 161 / 705 | page-walk steps, TLB card |
| bits | 80386: bit instructions · BSF, BSR, BT with SETC, MOVZX, MOVSX, SHLD. | 80386 | 140 / 450 | barrel shifter |
| cpuid | 80486: which CPU is this? · FLAGS 12-15, EFLAGS.AC, EFLAGS.ID, then CPUID. | 80486 | 218 / 1128 | flags as feature tests |
| cache | 80486: the 8 KB cache · small vs big array timed with the 8254, then cache off (CR0.CD, WBINVD). | 80486 | 223 / 742 | cache-miss steps (burst of 8 × 2 bytes), then hits; printed times → why caches |
| atomic | 80486: BSWAP, XADD, CMPXCHG · CMPXCHG as a lock. | 80486 | 152 / 614 | endianness, atomics |
| p5pairs | Pentium: two pipes (U and V) · 8 paired vs dependent ADDs, timed with RDTSC. | 80586 | 171 / 658 | pipe steps ("U pipe: it pairs with …" / "alone: V reads a register that U writes") |
| rdtsc | Pentium: RDTSC finds the clock · clocks for 50 ms of the 8254 → MHz. | 80586 | 143 / 462 | measuring time |
| btb | Pentium: branch prediction (BTB) · one JZ in three patterns; a counter counts wrong predictions. | 80586 | 199 / 829 | btb steps ("… the 2-bit counter learns the new direction"); runs on the P6 too |
| fdiv | Pentium: the FDIV test · 4195835 / 3145727; wrong after the 4th digit with the bug. | 80586 | 108 / 374 | a famous bug |
| 4mbpage | Pentium: a 4 MB page · CR4.PSE, one PDE with PS = 1 maps 004B8000h to B8000h. | 80586 | 164 / 794 | large pages |
| ooo | Pentium Pro: out-of-order execution · a 39-clock DIV and 20 ADDs, independent vs dependent. | 80686 | 204 / 942 | uop steps ("passes 1 older µop … runs out of order on port 0"), rob steps |
| cmov | Pentium Pro: CMOV (no branch) · max() with a jump vs CMOVL, random vs ordered. | 80686 | 211 / 827 | branch cost vs predication |
| rename | Pentium Pro: register renaming · four jobs on EAX, independent vs chained. | 80686 | 195 / 844 | RAT steps ("renames EAX to ROB 12") |
| l2 | Pentium Pro: L1, L2 and memory · 4 KB / 64 KB / 1 MB arrays timed with RDTSC. | 80686 | 216 / 813 | L1 miss → L2 hit → L2 miss steps; clocks per read |
| pmc | Pentium Pro: performance counters · WRMSR selects events, RDPMC reads. | 80686 | 223 / 949 | measuring from inside |
| plasma | VGA: plasma palette (mode 13h) · DAC rotation at vertical retrace. | vga | 126 / 487 | DAC port writes, retrace wait |
| wheel | VGA: colour wheel (mode 12h) · write mode 2, bit mask, palette turns. | vga | 189 / 422 | planar graphics |
| modex | VGA: Mode X page flipping · unchained 256 colours, CRTC start address flip. | vga | 361 / 953 | double buffering |

Every `src` header comment is a mini lesson written for a reader who already reads assembly.
Explain's end screen already offers `Open "<first sample of this model>"` (explain3d.js:561-566).
The Explain program itself is `SRC` (explain3d.js:11-18): `mov ax, 0xB800` / `mov es, ax` /
`mov al, 'A'` / (P5/P6: `mov bl, 0x1F`) / `mov [es:0], al` / (P5/P6: `mov [es:1], bl`), each with a
one-sentence `what`.

### 5.5 The narratives worth keeping

- **The Explain tour** (explain3d.js:259-267, six beats): "The program" ("This program has four
  instructions … The CPU sees only these bytes."), "The CPU" (per-model `CPUS.inside`), "The clock"
  (`clockText` 464: "… Here one clock is 210 ns (4.77 MHz). The crystal gives 14.318 MHz, and the
  8284A divides it by 3." + the `wave` card OSC/CLK/PCLK), "The bus" ("… the 8282 latches hold the
  address, the 8286 transceivers pass the data, the 8288 bus controller makes the commands, and the
  decoder selects the chip that answers."), "The RAM" (two banks, from 10100h), "The CGA card"
  (video memory at B8000h, 60 times a second).
- **Instruction chapters**: "Instruction 1: `mov ax, 0xB800` · Put the number B800h in register AX.
  Its bytes: B8 00 B8." then story steps, with the Explain-only rewrites of later fetches (414-427)
  and the decode "why" ("The BIU fetched these bytes before, so the EU does not wait." / "… came from
  the cache …").
- **"The letter appears"** (310): "The CGA card reads its video memory 60 times a second to draw the
  screen. At its next frame, the first cell holds 41h = the letter A (with the color byte 07h: grey on
  black). The letter appears." — and the P5/P6 colour variant (309).
- **Done** (316): "Done: IP moves to 0103h, the next instruction. This one took 4 clocks."
- **The summary** (274): "Four instructions, N clocks: X µs at 4.77 MHz. The CPU had to fetch each
  code byte over the bus before it could use it, and one byte to the video memory made a letter. That
  is all a program does: move bytes and calculate."
- **Story sentences** (story.js) follow one pattern "The X puts/sends/does … to the Y" with exact
  per-model part names, so captions regenerate for any program on any machine: T1 (104), T2 (92-93),
  T3 read/write (115-120), prefetch short (97), halt (85), inside lines (147-212), IRQ (360), INTA
  (91, 112), cache (280-301), BTB (271), page walk (310-312), burst (327-328), FDC (228-235), DMA
  (245), sound (251-261).
- **The 2D player** (`src/explain/explain.js`) has captions the 3D player lost: "20 address wires, 16
  data wires and control wires" (150); "The BIU fetched the first code bytes before the program
  started. They wait in the prefetch queue (6 bytes)." (156); "The decoder needs 3 bytes. The queue
  has only 2 of them, so the decoder waits for the BIU." (173); "The value B800h goes from AX (in the
  EU) to ES (in the BIU). Nothing goes on the bus: this happens inside the CPU." (227); "The address
  is even, so the byte uses the low 8 wires." (206); "The bus worked N times: F code fetches and 1
  write to the video memory. And a letter is on the screen." (246); footer "the timing is slowed down
  about fifty million times."
- **Help and menu** (index.html:389-424, 25-60), the trace bar's idle sentence "Each step moves one
  value from one part of the machine to the next part." (307), the per-model subtitle (app.js:969).

### 5.6 The gaps (concepts a learner needs that no text covers)

"Partly" = a sentence exists as a tooltip or a sample comment, not a lesson.

1. What a program is, what the CPU does with bytes, instruction vs data, what an assembler is — only "The CPU sees only these bytes." and "move bytes and calculate".
2. Instruction encoding, field by field, for real programs; prefixes, displacements, immediates, little endian — partly (GLOSS mod/reg/r/m/w/d, `meaning()` in the 2D player).
3. Registers as the CPU's own memory, why so few, AX/BX/CX/DX roles, 8-bit halves, SP/BP/SI/DI; flags as the result of the last operation — partly (dock tips, `DIE_INFO.regs/flags`).
4. Segments: why segment × 16 + offset, CS/DS/SS/ES roles, the 1 MB limit, the wrap — partly (adder text, one gloss line, memmap note).
5. What a bus is (shared wires, one talker at a time), why latches/transceivers/decoders exist, tri-state, chip select — pieces in GLOSS and the tour; no build-up.
6. What a clock cycle is, T states, wait states, clocks → seconds — only `clockText`.
7. Memory: RAM vs ROM, bytes and addresses, even/odd banks and why (`INFO_86.romO` has the sentence), memory-mapped video, the memory map — partly.
8. The prefetch queue: why fetch ahead, what a jump costs — good sentences exist, no lesson with a jump.
9. Control flow: how a JNZ decides from the flags, loops — none.
10. The stack: PUSH/POP, SP, CALL/RET, frames, recursion — none (only sample descs).
11. Interrupts as a concept: hardware vs software, the vector table, priorities, IRET, why no polling — fragments (INTR/INTA sentences, `INFO_86.pic/pit/kbd`).
12. I/O ports vs memory, device registers, polling a status bit — sample comments only.
13. DMA: why a device moves bytes without the CPU — one sentence.
14. The BIOS and the boot: the ROM, FFFF:0000, INT 10h/16h/21h, loading DOS, what an OS does — none.
15. The screen: cells, attribute byte, 60 Hz, CRTC; graphics modes; colour bits — text mode covered by the tour and letter beats only.
16. Floating point: why, the 80-bit stack, ST(0), why the 8087 watches the queue — structural texts only.
17. Protected mode: why, descriptors, privilege, faults, tasks, v86 — `DIE286/386_INFO` and the `pm286` header only.
18. Paging: why (virtual memory), linear vs physical, TLB as a cache of translations, page faults — precise but expert-level.
19. Caches: the speed gap, locality, hit/miss, lines/sets/ways, write-through vs write-back, MESI and DMA, L1/L2 latencies — richest area, but every text assumes the reader knows what a cache is for.
20. Pipelining: overlap, why 1 clock per instruction, hazards and stalls — one sentence in three places.
21. Superscalar / pairing: what a dependency is — `p5pairs` header is the best text.
22. Branch prediction: why guess, the cost, counters, history — `btb` header and die texts.
23. Out-of-order, µops, renaming, ROB, retirement, precise state — `ooo`/`rename` headers and `DIE686_INFO`; no "why decode into µops".
24. Measuring a machine: clocks, RDTSC, counters, IPC — sample headers only.
25. Hexadecimal, bits and bytes, KB/MB, MHz/ns — one gloss line; every caption uses hex.
26. Cross-model story: what changed from chip to chip and why — one-line menu entries and `CPUS.inside` only (brief principle 6 has no text).
27. The board as a whole: what each other chip is for, cards and slots — 68 `INFO_*` tooltips are the raw material; no walk beyond the tour.
28. Disks, sectors, the FAT, the floppy controller — FDC step sentences only.
29. Sound: square wave from a timer; FM synthesis — `INFO_SB.opl` and OPL2 steps only.

Also missing in form: check questions, "try it" prompts, definitions on first use, a per-machine
curriculum order.

---

## 6. Build and test constraints for a second page

### 6.1 build.mjs (104 lines, CRLF, no dependencies)

- Usage: `node build.mjs [--out file.html] [--skip a.js,b.js] [--artifact]`. Reads `src/index.html`
  (line 85), inlines `src/ui/style.css` into `<style>/*STYLE*/</style>` (57; index.html:11), emits
  `${threeNamespace()}\n(function () {\n'use strict';\n${app}\n})();` at `/*SCRIPT*/` (80-81) with
  `// ---- src/... ----` markers between files and every `</script` escaped (82). `--skip` removes
  SCRIPTS entries by suffix and warns; missing files are skipped with a warning (76-78) — a partial
  page never fails the build, it fails at run time. `--artifact` writes `<out>.artifact.html`
  (title + style + body inner HTML). Build time 0.15 s; output 4,169,340 bytes (three.js 671 KB,
  board3d.js 553 KB, die.js 533 KB, bios.js 241 KB, timing.js 223 KB, x86core.wasm.js 137 KB,
  memmap.js 123 KB, topview.js 122 KB, unitfx.js 107 KB, blocks.js 104 KB, app.js 84 KB, style.css
  83 KB). `--skip board3d.js,die.js` → 3011 KB.
- **SCRIPTS order** (11-56) and why: `asm/disasm, asm/assembler` → `core/fpu8087` → `cpu8086 …
  cpu80586, p6ooo.wasm, cpu80686` (inheritance) → `devices, disk, fdc765, soundblaster, vga` →
  `x86core.wasm, x86wasm` → `machine, devices286, machine286 … machine686` → `bios, vgabios` →
  `ui/theme` (**first UI file**) → `audio, crt, editor, dock, disks, tips, sfx, story, blocks,
  unitfx` → `die, timing, memmap, board3d, explain3d, topview` → `app`.
- **The change for a second page**: a page table `{ entry, scripts, styles, out }` and a `--page
  learn` (or `--entry` + `--scripts`) switch; share the prefix (vendor three, asm, core, theme.js,
  the reused UI modules) and swap the tail (`src/learn/*.js` instead of `explain3d.js`, `topview.js`,
  `app.js`). Precedent: `tools/explain-build.mjs` (17 lines) builds `src/explain/explain.html` with
  its own two markers; `tools/blocks-demo.mjs`/`unitfx-demo.mjs` build their own copy via `build.mjs
  --out dist/*-test.html` and drive `BlockPanel`/`UnitFx` directly.
- **Constraints the new entry inherits**: theme.js stays first among UI files; `app.js` is excluded
  (its `startApp()` runs at load, `new App()` needs ~83 ids; the failure is caught at 1583-1587 but
  nothing else works); new top-level names must collide with **none** of the ~300 existing
  top-level names in the shared files (die.js alone declares ~120 `D*_*`/`DIE*` tables; excluding
  app.js frees `SPEEDS PROG_BASE VIEW_TABS BOARD_MODES MAIN_TABS MOTION MOTION_LABEL SLOW TRACE_MS
  TRACE_LABEL App caption startApp`); the new HTML carries `/*STYLE*/` and `/*SCRIPT*/`; implicit
  globals throw under `'use strict'`; the only intentional globals are `window.__app` (app.js:1583)
  and the tools' `window.__vt`. Expose an equivalent `window.__learn` for the tools.
- **Size**: without the wasm cores (`--skip x86core.wasm.js,x86wasm.js,p6ooo.wasm.js`), topview and
  explain3d, a lesson page is ~3.6 MB before gzip; GitHub Pages serves gzipped; from `file:` it is
  ~5 s to `load` in headless swiftshader Chrome.

### 6.2 Line endings

`.gitattributes` is `* -text` (byte for byte; `core.autocrlf` unset). CRLF: assembler.js,
disasm.js, bios.js, cpu8086/80286/80386/80486/80686.js, devices286.js, disk.js, fdc765.js,
fpu8087.js, machine.js, machine286.js, machine386.js, soundblaster.js, vga.js, explain.js,
index.html, app.js, audio.js, blocks.js, board3d.js, die.js, disks.js, dock.js, explain3d.js,
memmap.js, sfx.js, story.js, style.css, theme.js, timing.js, tips.js, topview.js, unitfx.js,
build.mjs, ARCHITECTURE.md. LF: cpu80586.js, machine486/586/686.js, p6ooo.wasm.js, vgabios.js,
x86core.c, x86core.wasm.js, x86wasm.js, explain/data.js, explain.html, crt.js, editor.js, vendor,
.gitattributes, pages.yml, README.md. **Mixed**: devices.js (288 CRLF of 482). Rule: new files LF;
patch old files in their own ending; never let an editor normalise (a flip is a 100 % diff). The
built page is byte-transparent so mixing is harmless in the browser.

### 6.3 Deploy (`.github/workflows/pages.yml`, 42 lines)

Trigger: push to `master` (+ `workflow_dispatch`); Node 22; `node build.mjs --out _site/index.html`
(line 28); `upload-pages-artifact` of all of `_site`; `deploy-pages`. No test step, no cache. Live:
`https://omeriko9.github.io/8086-anatomy/`. A second page = one more build line (`--page learn --out
_site/learn.html` or `_site/learn/index.html`); making the learner page the front door = `--out
_site/index.html` for it and `_site/workbench.html` for the present page. Links between pages must
be relative; both share the origin and therefore `localStorage` (`a86:*`). The present page's
`syncUrl` (app.js:212-223) and `URL_PARAMS` (`cpu` with aliases 286/pentium/p5/ppro/p6, `video`,
`view` board/3d/top/runner/die/timing/bus/memory/mem, `explain`) keep working under any file name; a
new page can accept the same names. The working branch is not `master`: nothing deploys until
merged. `dist/` is gitignored; `snapshots/v49-2026-09-27/` keeps the published v49 build.

### 6.4 Tests to keep green (none loads the shell)

Every test loads sources with `vm.runInThisContext` in SCRIPTS order after
`var CPU_MODEL = …; var VIDEO_CARD = …;` (story.test.mjs:13-17). The only UI files any test loads
are `src/ui/story.js` (story.test) and `src/ui/crt.js` (vga.test, for `VgaRenderer`). The rewrite is
test-neutral as long as `src/asm`, `src/core`, `story.js`, `crt.js` keep their top-level names and
load order. Measured here (Node v22):

| Test | Checks | Time | Notes |
|---|---|---|---|
| `tests/story.test.mjs [--model M] [--video vga]` | `Story.build` for every instruction of every sample; bus-step counts vs bus events; no empty text; a traced floppy boot | 8.6-9.8 s (80486); 8086: 87,979 instr / 367,346 steps pass | **latent bug**: second `reset()` at line 41 wipes the program, so it traces the POST for every sample (still "all pass"); machine.test and app.js have the right order |
| `tests/machine.test.mjs [--model M] [--video vga] [--show]` | boots the BIOS, runs each SAMPLES program, checks screen text | 1.3 s (8086) | the expected outputs at 70-110 are lesson checks |
| `tests/fpu.test.mjs` | 8087 vs BigInt references | 0.7 s, 41,836 checks | |
| `tests/cpu486/586/686.test.mjs` | cache, pairing, BTB, OOO, clocks | 0.3 / 5.4 / 6.1 s | |
| `tests/pm286..pm686.test.mjs [--build]` | protected mode, paging with prebuilt `tests/asm*/**.bin` | 0.14-0.52 s each | `--build` needs `tools/nasm` |
| `tests/p6wasm.test.mjs` | P6 wasm vs JS lockstep | 71 s | one part skips without DOS |
| `tests/fdc.test.mjs` | uPD765, DMA 2, INT 13h boot, 3 machines | > 5 min | long |
| `tests/x86wasm.test.mjs` | lockstep per model | 1 s | skips everything without the DOS image, reports success |
| `tests/asm.test.mjs`, `tests/cpu.test.mjs` | vs NASM/ndisasm; 640,744 SingleStepTests | — | **crash** (ENOENT) without `tools/nasm` / `tools/sst8086` |
| `tests/cpu286/cpu386.test.mjs` | SingleStepTests 286/386 | — | exit cleanly with a download message |
| `tests/dos/dos6/hd/vga/sb.test.mjs` | DOS boots, VGA modes, Sound Blaster | — | skip without the user's images (hard-coded Windows path) |

Fast local gate after touching shared files: `story.test --model 80486`, `machine.test --model
8086`, `fpu`, `cpu486/586/686`, `pm*` (all under 10 s each). There is no CI test job to extend.

### 6.5 The headless check recipe

- **Chrome here**: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (also the
  `/opt/pw-browsers/chromium` symlink and `chromium_headless_shell-1194`). All 51 tools import
  `puppeteer-core` 23.11.1 from `tools/node_modules` (`tools/package.json`), run from the repo root
  as `node tools/x.mjs`, and launch with `executablePath: process.env.CHROME || 'C:/Program
  Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader',
  '--enable-unsafe-swiftshader']` (shot.mjs adds `--allow-file-access-from-files`). **None passes
  `--no-sandbox`, so as root every tool fails at launch** ("Running as root without --no-sandbox is
  not supported"). Working launch here:

```js
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: 'new', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
});
```

  Put this in one shared `tools/launch.mjs` (`CHROME` + `CHROME_ARGS`, or `--no-sandbox` when
  `process.getuid() === 0`) and have every tool import it.

- **Virtual clock** (tools/xpfilm.mjs:31-43; same block in uxshots 26-38, xpmotion 28-40, blurprobe
  20-32, flowfilm), installed with `page.evaluateOnNewDocument` before load:

```js
await page.evaluateOnNewDocument(() => {
  let vt = 0, id = 0, last = null; const q = [];
  const realRaf = window.requestAnimationFrame.bind(window), realNow = performance.now.bind(performance);
  performance.now = () => vt;
  window.requestAnimationFrame = cb => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = i => { const k = q.findIndex(x => x[0] === i); if (k >= 0) q.splice(k, 1); };
  const run = () => { for (const [, cb] of q.splice(0)) { try { cb(vt); } catch (e) { console.error(e && e.stack || e); } } };
  const vc = window.__vt = { auto: true, get t() { return vt; }, step(ms) { vt += ms; run(); } };
  const pump = () => { const r = realNow(); if (vc.auto) { vt += last === null ? 16 : Math.min(100, r - last); run(); } last = r; realRaf(pump); };
  realRaf(pump);
});
```

  Then `__vt.auto = false` and `__vt.step(1000 / fps)` per frame gives frame-exact runs independent
  of render speed. It works because all page animation reads `AnimClock.now()` / `animNow()`, which
  wrap `performance.now()`; **the new page must animate from `performance.now()`/`animNow()` too,
  never from `Date.now()`, and avoid `setTimeout` for anything the checks measure** (Explain's
  `screen()`/`chime()` timeouts at 470/474 and `Sfx`'s rate limiter desync under it today).
  blurprobe's variant lets `performance.now()` advance with real time inside a frame callback so
  per-frame budgets behave; xpmotion adds `set(ms)`.

- **Seeding**: `evaluateOnNewDocument` writing JSON into `localStorage` (`a86:cpu`, `a86:video`,
  `a86:tab`, `a86:trace`, `a86:sfx`, `a86:codeHidden`, `a86:dockHidden`, `a86:xpSet`); uxshots
  guards with `sessionStorage['ux:init']` + `localStorage.clear()`. Load the page from `file:` with
  `--file`/`--page`.

- **Budget measured at 1280×800, 80486, Board tab, virtual clock**: launch 0.7 s; `load` with
  `__app.views.board` ready at 4.9 s; first rendered 3D frame 9.6 s (shader compile + textures under
  swiftshader); then 14-26 ms per 33 ms virtual frame; one `page.screenshot()` 8.3 s; 23 s in all.
  So prefer state assertions via `page.evaluate` (captions, camera `cam.target/r/theta/phi`, token
  screen position, DOM) over pixels; budget 20-30 s per headless check that needs a picture.

- **Tools to copy or adapt**: `shot.mjs` (generic: `--file`, prints console + `pageerror`, reports
  horizontal overflow, exit 1 on error); the launch/vclock/`adv`/`shot`/`click` skeleton of
  `uxshots.mjs`; `xpmotion.mjs` (pan/zoom/token speed percentiles from `bd.updateCamera`,
  `bd.riderAt`, `bd.cam`) and `blurprobe.mjs` (die tile sharpness) take `--page`; `xpfilm.mjs`,
  `xpunits.mjs`, `unitsheet.mjs` (`UnitFx.draw` contact sheet — proves the drawings need no 3D and
  no shell), `flowunits.mjs`, `blocks-demo.mjs`, `unitfx-demo.mjs` hard-code the dist path and old
  ids/`__app` members: keep their scaffolding, rewrite their bodies against the new page's surface.
  Offline lesson data can be produced from the real emulator in Node with `loadCore()`
  (tools/vgapng.mjs:12-19), as `tools/explain-data.mjs` did.

---

## 7. Open risks, ranked

1. **One model per page load (parse-time freeze).** `CPU_MODEL`/`VIDEO_CARD` are read while
   theme.js, story.js (7-13), board3d.js (18-30, 110), blocks.js (644), explain3d.js and the
   die/timing/memmap/dock modules are parsed; `THEME` is mutated in place and `dieP()` caches its
   palette. A machine chooser that does not reload, or two machines side by side (brief principle 6,
   "what a Pentium does differently"), needs story.js and board3d.js parameterised or two page loads
   / iframes. Retire early: decide "reload per machine" (cheap, matches today) vs "parameterise
   story.js + `applyTheme(model)`" (small) vs "parameterise board3d.js" (large) in milestone 0.
2. **board3d.js is one 553 KB IIFE with the spec builders, die plans, trace models and the view
   inside it.** The step→spec builders (1626-2082) read `window.__app.machine` (1954-1955), `M286/
   M686/NM/QSIZE/ADDR_BITS` and `pipeAfterHalt`; `BoardKit` exposes them only after the whole file
   loads. Lifting `specs.js` + `dieplans.js` is the one refactor that touches a "keep untouched"
   module; do it first and verify with `tools/unitsheet.mjs`-style output and `xpunits.mjs`.
3. **The trace's die dives depend on `RunnerView.dieKit`** (board3d.js:6046, 6138-6141, 8182): with
   the Runner dropped (brief non-goal) every story step is a flat board path unless `dieKit` (17
   lines) is moved into BoardView. Also `xpFocus(['die:…'])` falls back to a box shot.
4. **The Explain director is not instantiable from a new shell**: it needs ~25 `App` members,
   mutates `spd.stepMs`, hides `#trace`/`#monitor` by hand, and the board measures its DOM by class
   (`xpCovers` 7208-7220 → `.xp3-prog/.xp3-bar`). The generic engine (~250 lines), `plan()`, the
   caption rules and the board's ⟨xp⟩ surface are reusable, but only as a port onto `Playback` +
   `BoardView`; `xpCovers` must take covers as data.
5. **`api.stepMs` is missing today** (board3d 7038/7041/7075, topview 638 read `undefined`; fallback
   1700 ms at 6612). The behaviour works by accident (`traceDur` stores `s._ms`). The new facade must
   add `stepMs` and always call `traceDur` before `traceStep` in the same frame.
6. **Render-loop and clock ownership.** BoardView has no rAF, no ResizeObserver, no `dispose()`, no
   `webglcontextlost` handling; it renders lazily; two clocks (anim vs real) are intended. Explain
   runs a second rAF loop. A new shell that gets any of this wrong sees a black or frozen board.
   Retire early with the facade + `frame()/resize()` harness and a headless smoke test.
7. **Every frame dereferences `app.machine`** (`updateDrives` 3545/3565; hover `stateOf` 4624 reads
   `cpu.ip/flags/sregs/msw/cpl/q/cycles`, `kbd`, `pit.ch`); die/timing/memmap read ~70 machine
   fields in render code. Any facade must pass the real `Machine`; a stub machine throws on hover.
8. **Headless verification blocked by `--no-sandbox` and slow under swiftshader** (first 3D frame
   ~10 s, screenshot ~8 s). Without a shared launcher and a state-based (not pixel-based) check
   style, the team cannot verify the page in this environment. `tests/story.test.mjs` also has the
   double-`reset()` bug, so the "story" gate currently tests the BIOS, not the samples.
9. **Name collisions and load order in the one-scope build.** ~300 existing top-level names; a
   duplicate `const`/`class` blanks the page with no useful error; theme.js must precede every UI
   file; `makeFont8x8` (disks.js:402) and `makeVgaFont` (crt.js:543) are UI files the ROM build
   needs. Fix with a page table in build.mjs and a `tools/names.mjs` that lists top-level
   declarations of the shared prefix.
10. **Content is scattered and structural, not motivated.** 131 die texts (die.js), 85 unit-at-work
    sentences and 68 chip tooltips (board3d closure), 139 glossary rules (blocks.js), ~125 dock tips,
    132 signal descriptions, 35 sample headers — in six files, three unit-id namespaces linked only
    by label strings (`DIE*_3D`, `BLK_*`, `focusChip` `includes()`). No "why" texts for the 29 gap
    topics of section 5.6. The lesson data model needs one content module keyed by `(part, label)`
    before lessons can be written; renaming a label anywhere breaks the bridges silently.
11. **Global side effects of reused modules**: `Sfx` capture listeners and `Tips.init` title-hijack
    at parse; `URL_PARAMS` writes `a86:cpu/video` at parse; injected `<style>`s into `document.head`;
    a document `keydown` per BoardView instance; `CrtScreen.fullCanvas` permanently doubles drawing
    work once read. Manageable, but each must be a conscious choice in the new shell.
12. **Spec identity and step mutation**: BlockPanel/`unitWindow`/`showCard` rebuild on spec identity
    (blocks.js:1503; board3d 7478, 7522); views cache `_j/_ms/_xpLead` on step objects; `UnitFx.words`
    is module-level. A director that builds fresh specs per frame or shares steps between two views
    gets flicker or wrong tooltips.
13. **Storage sharing across the two pages on one origin**: `a86:cpu/video` (good: the machine
    carries), `a86:src` (the user's program — a lesson must not overwrite it casually), `boardCardMin`,
    `xpSet`, `codeHidden/dockHidden` (Explain leaves them set after a crash).
14. **Performance/memory**: die tiles up to scale 96 and 2048-px textures per opened die (4729-4732,
    5432, 5620); `decapAll` opens ~40 dies; Machine386+ allocates 21 MB `WebAssembly.Memory` each when
    the wasm core is loaded (pass `wasm: false` or reuse one machine); `spkLog` capped at 200k,
    `stats` grow until `takeStats()`.
15. **Pop-out / PiP and phone layout** are non-goals, but board3d and the views still look up
    `document.*`/`window.devicePixelRatio` of the main window (2122, 2159, 7119, 7230, 2193…) — a shell
    without PiP avoids the mismatch; a phone layout must not instantiate the WebGL board (brief
    principle 8) and must handle `ok === false`.

---

## 8. Key facts

- The emulator (`src/core/*`, `src/asm/*`, 26 script files, ~28k lines) is DOM-free and drive-able with ~10 calls: `setRom/setVgaRom`, `reset`, `loadProgram`, `pokeMem(0x4F0, [ip lo, ip hi, 0x00, 0x10, 0x86])`, `step() → {cycles, events}`, `run(max) → 'halt'|'break'|'budget'`, `tickDevices`, `keyDown/keyUp`, `insertDisk`, `onSpeaker/takeSpeaker/takeSound`, `takeStats`; reuse it unchanged.
- `Story.build(events, {prefetch, burst})` (story.js, 407 lines), `BlockPanel` (blocks.js, 1753), `UnitFx.draw` (unitfx.js, 1950), `CrtScreen(host, machine, onKey)` (crt.js, 620), `CodeEditor`, `SpeakerAudio`, `Sfx`, `DiskStore` are reusable as-is; their only couplings are theme.js helpers, the CSS tokens of style.css:1-188, and the parse-time `CPU_MODEL`/`VIDEO_CARD`.
- `BoardView` (board3d.js:2084-7830) works from a new shell with a ~50-line facade: `machine` (real), `on`, `select` (essential); `reducedMotion mode running clock tracing motion crtCanvas crtVersion view stepMs` (stubbable); a positioned non-zero host; the shell calls `frame(animNow(), dt*AnimClock.scale)` every rAF and `resize()` on host changes; its chrome hides with one CSS rule.
- `api.stepMs` does not exist today (app.js:112-130) although board3d.js:7038/7041/7075 and topview.js:638 read it; the real step time arrives as `s._ms` from `traceDur(s, ms)`, which must be called before `traceStep(story, i, {ms, back, auto})` in the same frame.
- The step→spec builders (`tcard`, `CPU_TRACE`, `GLUE`, `DRAM/ROM/IO/BUSCTL_TRACE`, `FDC/SOUND/CACHE/PAGE_CARD`, `P5/P6_CARDS`, board3d.js:1626-2082, ≈450 lines, 85 `sub` sentences) and `DIE_PLANS`/`dieLayout`/`drawInterior` (733-856, 912, 1291) are the parts to lift out of the 553 KB IIFE; they read `window.__app.machine` at 1954-1955.
- Die dives in a trace exist only when `app.view('runner')` returns a `RunnerView` with `dieKit` (board3d.js:6046, 6138-6141, 8182); dropping the Runner means moving those 17 lines into BoardView.
- The engine to extract from app.js: `buildRom` 133-151, `assembleAndLoad` 1081-1099, `boot` 1115-1146, `beginInstr/dispatchUntil/finishInstr` 1329-1402, `enterStep` 638-655, `traceNext/Prev/Go/Skip` 499-545, 623-637, `startFF/ffFrame/ffStop` 546-611, `fastFrame/fastStats` 1460-1499, `speedAt/SPEEDS/TRACE_MS/MOTION` 4-30, 1197-1216, `caption()` 1556-1578, `codeMask..isSeen` 519-524, `readMs/stepMs/traceActive` 393-398; everything in `ui/traceUi/layoutUi/monitorUi/popOut/modelUi/startCard/renderTrace/shortcut` is DOM to rewrite.
- `this.mode` is only `'explain'|'fast'`; manual clocking is `play.manual` with `clockMs = 400`, inferred by views from `clockMs >= 300`; interrupt delivery is its own `cpu.step()` (61 clocks, `INTR xxh`), a REP is one iteration per step, a halted 8086 step is 2 clocks with no `halt` bus event.
- Content: 131 `DIE*_INFO` unit texts (16+22+28+23+20+22, die.js), 85 unit-at-work sentences and 68 chip tooltips (board3d), 120 `GLOSS` + 19 `KIND_TIP` rules (blocks.js), ~125 dock tips, 132 `TV_INFO` signals, 35 `SAMPLES` with lesson-grade headers (13 base, 3+3+3 per 286/386/486, 5+5 per P5/P6, 3 VGA); three unit-id namespaces bridged only by label strings.
- Narratives to keep verbatim: the six-beat tour, "The letter appears" (explain3d.js:310, colour variant 309), the summary "That is all a program does: move bytes and calculate." (274), and the 2D player's lost captions (explain.js:150, 156, 173, 227, 246).
- Biggest curriculum gaps: what a program/byte/hex is, register and flag roles, why segments, what a bus and a clock cycle are, the memory map and even/odd banks, the stack and CALL/RET, interrupts as a concept, I/O ports, DMA, BIOS and boot, the "why" of protected mode, paging, caches, pipelining and µops, and a per-machine "what changed" story.
- build.mjs has one entry (index.html, line 85) and one 44-file SCRIPTS list (11-56); a second page needs a page table; app.js must be excluded; theme.js stays the first UI file; new top-level names must not collide with ~300 existing ones; `makeFont8x8` (disks.js:402) must move to the core side; new files LF, old files keep their endings (`* -text`).
- Deploy is one extra `node build.mjs … --out _site/<name>.html` line in pages.yml (master only, no tests in CI); the tests never load the shell — keep `story.test --model 80486` (9 s), `machine.test --model 8086` (1.3 s), `fpu`, `cpu486/586/686`, `pm*` green; `story.test.mjs:41`'s second `reset()` makes it trace the BIOS instead of the samples.
- Headless checks: Chrome `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, flags `--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, `protocolTimeout` 900000, the `__vt` virtual clock via `evaluateOnNewDocument` (xpfilm.mjs:31-43); 4.9 s to load, 9.6 s to the first 3D frame, 14-26 ms per virtual frame, 8.3 s per screenshot — assert state, not pixels.
- The parse-time model freeze (theme.js:142-188 → story.js 7-13, board3d.js 18-30/110, blocks.js 644, die/timing/memmap/dock) is the one architectural fact that limits the new page: one machine per load unless story.js and board3d.js are parameterised.
