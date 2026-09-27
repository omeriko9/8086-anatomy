# 8086 Anatomy

A live, animated PC in one HTML file, from the 8086 to the Pentium Pro.

The page emulates a complete computer: the CPU, the coprocessor, the bus chips, the memory,
the timer, the interrupt controller, the disks and the screen. It shows each signal on the
board and inside the chips, one step at a time, so you can see how a program runs.

## Start here

Open the page and press **▶ Explain** (above the view). A short program of four
instructions runs one step at a time on the 3D board. A caption tells each step, and the
unit that works shows its work on the chip die: the cache sets and ways, the bus buffer,
the pipeline stages, and more. Use the milestones in the bar to go back and forward.

Or write your own program at the left, press **Assemble & load**, and then **Run**, or
**Next** for one step.

## The views

| Tab | What it shows |
|---|---|
| **Board** | The motherboard and its chips. The switch at the top left shows it three ways: **3D**, **Top** (all the chips from above, always open) or **Runner** (a camera that runs with each signal). **Open chips** takes the lids off, so you see the dies. |
| **Die** | The floor plan of the CPU chip (and its FPU): each unit and its values. Click a unit to zoom to it. |
| **Bus timing** | A logic analyser for the bus signals, clock by clock. |
| **Memory** | The address map, the parts that the program reads and writes, and the bytes. |

The signal colors are the same in all views: address (cyan), data (gold), control (pink),
FPU (violet).

**Trace** (in the top bar) plays each instruction as steps. The text under the view tells
each step, with **Back**, **Next** and **Skip** at its right. The **Speed** slider sets the
time of a step; at its left end it goes on into slow motion (down to 1/64).

The screen of the machine is under the program. Click it and type to send keys to the
machine. The speaker button in the top bar opens the Sound menu (the machine sound and the
effects). The **?** button opens the help with all the keys.

## Six machines

Click the title to choose the machine and the graphics card. The page loads again; your
program and your disks stay.

| Machine | CPU | Main features |
|---|---|---|
| 8086 | 8086 + 8087, 4.77 MHz | 1 MB, real mode, maximum mode with the 8288 (1978) |
| 80286 | 80286 + 80287, 8 MHz | 16 MB, protected mode, the A20 gate, CMOS clock (1982) |
| 80386 | 80386 + 80387, 25 MHz | 32-bit, paging, virtual 8086 mode; a 16-bit data bus as the 386SX (1985) |
| 80486 | 80486DX, 33 MHz | 8 KB cache and the FPU on the chip, a five-stage pipeline (1989) |
| Pentium | Pentium (P5), 66 MHz | U and V pipes, branch prediction, 8 + 8 KB cache, 64-bit bus (1993) |
| Pentium Pro | Pentium Pro (P6), 200 MHz | out-of-order µops, register renaming, 256 KB L2 in the package (1995) |

The graphics card is CGA (320×200 in 4 colours, 80×25 text) or VGA (640×480 in 16,
320×200 in 256 colours). All the machines also have a hard disk controller (drive C:) and a
Sound Blaster 2.0.

### Share a link to one state

The address names the machine, the card and the view, for example
`https://omeriko9.github.io/8086-anatomy/?cpu=80486&video=vga&view=die`.

| Parameter | Values |
|---|---|
| `cpu` | `8086`, `80286`, `80386`, `80486`, `80586` (or `pentium`), `80686` (or `pentiumpro`) |
| `video` | `cga`, `vga` |
| `view` | `board`, `top`, `runner`, `die`, `timing`, `memory` |
| `explain` | `1`: the guided story starts at once |

The page keeps the address in step with your choices, so you can copy it at any time.

## Run an operating system

Open **Disks**, load a bootable floppy image into drive A: (for example your own MS-DOS
disk), copy programs to drive B: with **Add files**, and press **Boot from A:**. You can
also make a bootable drive C:. The page does not include any operating system or game. You
load your own images, and they stay in the browser (IndexedDB). Nothing is uploaded.

## Open it

The live page: https://omeriko9.github.io/8086-anatomy/ (GitHub Pages builds it from
`src/` at each push: `.github/workflows/pages.yml`).

Or build it and open `dist/8086-anatomy.html` in a browser. It needs no server and no
network.

## Build

```
node build.mjs
```

The build puts all files from `src/` into `dist/8086-anatomy.html`. The page includes
three.js r160 (MIT license) inline. `node build.mjs --artifact` also writes the page
content without the document skeleton (`dist/8086-anatomy.artifact.html`).

The CPU cores of the 80386 and later models also run as WebAssembly (`src/core/x86core.c`,
built into `src/core/x86core.wasm.js`); the JavaScript cores stay as the reference.

## Test

| Command | What it checks |
|---|---|
| `node tests/cpu.test.mjs` | The 8086 CPU against 640,744 SingleStepTests cases (real hardware captures). Put the suite in `tools/sst8086` first. |
| `node tests/cpu286.test.mjs`, `cpu386.test.mjs` | The 80286 and 80386 real mode against the SingleStepTests suites (`tools/sst286`, `tools/sst386`). |
| `node tests/cpu486.test.mjs`, `cpu586.test.mjs`, `cpu686.test.mjs` | The new instructions and features of the 486, the Pentium and the Pentium Pro. |
| `node tests/pm286.test.mjs` … `pm686.test.mjs` | Protected mode, paging and the other system features, with small NASM programs (`tests/asm*`). |
| `node tests/x86wasm.test.mjs`, `p6wasm.test.mjs` | The WebAssembly cores in lockstep against the JavaScript cores. |
| `node tests/asm.test.mjs` | The assembler and disassembler against NASM and ndisasm (in `tools/nasm`). |
| `node tests/fpu.test.mjs` | The 8087 soft-float against exact BigInt references and JS doubles. |
| `node tests/machine.test.mjs` | The BIOS boot and all sample programs on the full machine. |
| `node tests/story.test.mjs` | The trace steps of every instruction of the samples. |
| `node tests/fdc.test.mjs`, `hd.test.mjs`, `sb.test.mjs`, `vga.test.mjs` | The floppy controller and DMA, the hard disk, the Sound Blaster, and the VGA card. |
| `node tests/dos.test.mjs [boot.img] [program.exe]` | Boots a DOS floppy, runs DIR, and starts a program from B: (your own files; skipped when missing). |
| `node tools/shot.mjs` | A headless Chrome screenshot and a console-error check of the page. |
| `node tools/uxshots.mjs --out DIR` | Screenshots of all the views and of Explain, for a review of the UI. |

## Structure

See `ARCHITECTURE.md` for the module contracts, the memory and I/O maps, the micro-event
stream that drives the views, the Explain player, and the page layout.

## Accuracy notes

- Instruction results and flags are exact. The undefined flags follow the metadata of the test suites.
- Cycle counts come from the Intel tables. The prefetch queue works, but its timing is not cycle-exact.
- The 8087 uses 80-bit soft-float with BigInt. The transcendental instructions use 140-bit fixed point.
- The boards are original. They take ideas from the IBM PC and AT class machines.
- The BIOS is original code. INT 21h is a small DOS-like subset for programs from the editor; a real DOS replaces it.
- The die floor plans are drawings of the units, not photographs of the real dies.
