# 8086 Anatomy

A live, animated 8086 + 8087 computer in one HTML file.

Write 8086 assembly in the left pane. The page assembles it, loads it at 1000:0100,
and runs it on an emulated maximum-mode 8086 computer. The views show each bus cycle:

- **Board (3D):** the motherboard, the chips, the buses, and a CRT monitor.
- **Die:** the 8086 BIU and EU, the 6-byte queue, the ALU, and the 8087 register stack.
- **Bus timing:** a logic analyser for the local bus and the 8288 command lines.
- **Memory:** the 1 MB address map, the access heat, and a hex panel.

## Two machines

Select the title to switch between the two machines. The page reloads with the other
one; your program and your disk images stay.

| | 8086 machine | 80286 machine |
|---|---|---|
| CPU | 8086 at 4.77 MHz, maximum mode (8288) | 80286 at 8 MHz, one wait state (82288, 82284) |
| Coprocessor | 8087 (watches the queue, bus master) | 80287 (operands through I/O ports F8h-FFh, ERROR on IRQ13) |
| Address space | 1 MB | 16 MB, A20 gate (8042 and port 92h), 1 MB extended RAM |
| Board | PC/XT-like: 8259A, 8253, 8255 | AT-like: two 8259A, 8254, 8042, MC146818 clock + CMOS |
| Modes | real mode | real mode and protected mode (GDT/LDT/IDT, rings, gates, tasks) |
| Colours | violet and gold | slate-teal and amber |

## Run an operating system

Open **Disks**, load a bootable floppy image into drive A: (for example an MS-DOS 3.3
disk), copy programs to drive B: with **Add files**, and press **Boot from A:**. The
machine runs at 4.77 MHz. You can then slow it down to watch each bus cycle.
The page does not include any operating system. You load your own image, and it
stays in the browser (IndexedDB).

The BIOS gives the services that DOS 3.3 and CGA games use: INT 10h (text modes 0–3,
graphics modes 4–6), INT 13h (through a simplified disk controller at port E0h), INT 16h,
INT 1Ah, INT 11h/12h, INT 19h boot, and the keyboard IRQ with shift, ctrl, alt and locks.

## Open it

Open `dist/8086-anatomy.html` in a browser. It needs no server and no network.

## Build

```
node build.mjs
```

The build puts all files from `src/` into `dist/8086-anatomy.html`. The page includes
three.js r160 (MIT license) inline.

## Test

| Command | What it checks |
|---|---|
| `node tests/cpu.test.mjs` | The CPU against 640,744 SingleStepTests 8086 cases (real hardware captures). Put the suite in `tools/sst8086` first. |
| `node tests/asm.test.mjs` | The assembler and disassembler against NASM and ndisasm (in `tools/nasm`). |
| `node tests/fpu.test.mjs` | The 8087 soft-float against exact BigInt references and JS doubles. |
| `node tests/machine.test.mjs` | The BIOS boot and all sample programs on the full machine. |
| `node tests/dos.test.mjs [boot.img] [program.exe]` | Boots a DOS floppy, runs DIR, and starts a program from B:. |
| `node tests/vga.test.mjs` | The VGA card, its video BIOS and 2.88 MB disks; then Wolfenstein 3D under DOS 6.22 on the 80286 + VGA (your own files; skipped when missing). `--video vga` also runs the machine and DOS tests on the VGA. |
| `node tools/dosshot.mjs` | The same test in the real page (headless Chrome). |
| `node tools/shot.mjs` | A headless Chrome screenshot and a console-error check of the page. |

## Structure

See `ARCHITECTURE.md` for the module contracts, the memory and I/O maps, and the
micro-event stream that drives the views.

## Accuracy notes

- Instruction results and flags are exact. The undefined flags follow the metadata of the test suite.
- Cycle counts come from the Intel tables. The prefetch queue works, but its timing is not cycle-exact.
- The 8087 uses 80-bit soft-float with BigInt. The transcendental instructions use 140-bit fixed point.
- The board is original. It takes ideas from the IBM PC 5150, with an 8086 in place of the 8088.
- The BIOS is original code. INT 21h is a small DOS-like subset for programs from the editor; a real DOS replaces it.
- The disk controller is simplified: the BIOS passes INT 13h requests to it through port E0h, and it copies sectors like a DMA transfer. A real PC uses an NEC 765 and the 8237 DMA.
- A clock port (E2h) gives the BIOS the time of day, like the add-on clock cards of the time.
