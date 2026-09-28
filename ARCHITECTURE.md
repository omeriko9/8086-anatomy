# 8086 Anatomy — architecture and interfaces

This file is the contract between all modules. Keep it true.

## Output

`dist/8086-anatomy.html` — one standalone file. `build.mjs` (Node, no dependencies)
concatenates the files in `src/` into it. three.js r160 (MIT) is inlined from
`src/vendor/three.module.min.js`; the build turns its `export{...}` statement into
`const THREE = {...}`.

## Source file rules

- Plain browser scripts, NOT ES modules. No `import` / `export` / `require`.
- Each file defines its public API as top-level `const`/`class` declarations (names
  below). All files share one global script scope (the build puts them in one
  `<script>` in a fixed order; tests load them with `vm.runInThisContext`).
- No DOM access in `src/core/*` and `src/asm/*` (they must run in Node for tests).
- 2-space indent, semicolons, `'use strict'` is added by the build around everything.

## Build order

```
src/vendor/three.module.min.js   (transformed)
src/asm/disasm.js        -> Disasm86
src/asm/assembler.js     -> Asm86
src/core/fpu8087.js      -> FPU8087, F80 (soft-float helpers)
src/core/cpu8086.js      -> CPU8086
src/core/cpu80286.js     -> CPU80286, Fault286 (see "80286 model")
src/core/cpu80386.js     -> CPU80386 (see "80386 CPU")
src/core/cpu80486.js     -> CPU80486 (see "80486 CPU")
src/core/cpu80586.js     -> CPU80586 (see "Pentium core (CPU80586)")
src/core/cpu80686.js     -> CPU80686 (see "Pentium Pro core (CPU80686)")
src/core/devices.js      -> PIC8259, PIT8253, PPI8255, DMA8237, CRTC6845, Keyboard
src/core/disk.js         -> FLOPPY_TYPES, FloppyDisk, Fat12, fat12Blank, diskService
src/core/fdc765.js       -> FDC765, FDC_RATES, fdcMediaRate (floppy controller + drives)
src/core/soundblaster.js -> SoundBlaster, OPL2, OPL_RATE (Sound Blaster 2.0 + YM3812)
src/core/vga.js          -> VGA, VGA_EXPAND
src/core/machine.js      -> Machine
src/core/devices286.js   -> RTC146818, KBC8042
src/core/machine286.js   -> Machine286 (see "80286 model")
src/core/machine386.js   -> Machine386 (see "80386 model")
src/core/machine486.js   -> Machine486 (see "80486 model")
src/core/machine586.js   -> Machine586 (see "Pentium model (fifth machine)")
src/core/machine686.js   -> Machine686 (see "Pentium Pro model (sixth machine)")
src/core/bios.js         -> BIOS_SOURCE (8086 assembly text), biosSource(model), SAMPLES
src/core/vgabios.js      -> VGA_BIOS_SOURCE, makeVgaRom(fonts)
src/ui/sfx.js            -> Sfx (small sound effects)
src/ui/story.js          -> Story (trace steps; no DOM, runs in Node)
src/ui/blocks.js         -> BlockPanel (block cards for the trace)
src/ui/unitfx.js         -> UnitFx (the work of a unit, drawn on the die)
src/ui/*.js              -> views and app shell
```

## Physical memory map (1 MB)

| Range | Device |
|---|---|
| 00000–003FF | IVT (RAM) |
| 00400–004FF | BIOS data area (RAM) |
| 00500–9FFFF | RAM (640 KB total, even/odd banks) |
| B8000–BBFFF | CGA text RAM (16 KB, 80×25×2 at B8000) |
| F0000–FFFFF | ROM (64 KB, mini BIOS; reset vector FFFF0) |

User programs load in .COM style: segment 1000h, offset 0100h,
CS=DS=ES=SS=1000h, SP=FFFEh, word 0000h pushed. `m.startProgram()` sets FLAGS = 0202h
(IF = 1; the 8086 shows F202h). It does not set bits 12-14: on the 80386 they are IOPL and
NT, and they can change in real mode.

## I/O map

| Port | Device |
|---|---|
| 00–0F | 8237 DMA (channel 2 moves the floppy bytes) |
| 20–21 | 8259A PIC |
| 40–43 | 8253 PIT (input clock = CPU clock / 4 = 1.193182 MHz) |
| 60–63 | 8255 PPI (60 = keyboard scan code, 61 = port B: bit0 gate2, bit1 speaker, bit7 kbd clear) |
| A0 | NMI mask (bit 7 = enable NMI) |
| 80–8F | DMA page registers (81h = channel 2, 82h = 3, 83h = 1, 87h = 0; 4 bits on the XT) |
| 3D4–3D5 | 6845 CRTC index/data |
| 3D8 | CGA mode, 3DA CGA status (bit0 display enable toggles, bit3 vretrace) |
| F0–FF | reserved for 8087 (no function, as on the PC) |
| 3F2 | floppy controller: digital output register (DOR) |
| 3F4 | floppy controller: main status register (MSR) |
| 3F5 | floppy controller: data register (FIFO) |
| E0–E7 | old simplified disk port (tests only; E2h = BIOS clock from the host) |
| 220–22F | Sound Blaster 2.0 DSP ('sb'): 226 reset, 22A read data, 22C write command / data, 22E read-buffer status; 228–229 = the OPL2 ('opl') |
| 388–389 | OPL2 (YM3812, the AdLib ports): 388 address (write) / status (read), 389 data |

IRQ0 = PIT ch0 (INT 08h), IRQ1 = keyboard (INT 09h), IRQ6 = floppy controller (INT 0Eh),
IRQ7 = Sound Blaster (INT 0Fh, all machines). DMA channel 1 (page register 83h) = the
Sound Blaster DSP.
8087 INT -> NMI (INT 02h).

## Assembler (`src/asm/assembler.js`)

```js
Asm86.assemble(source, { origin = 0x100, cpu = '8086', bits = 16 } = {}) => {
  ok: boolean,
  bytes: Uint8Array,          // image starting at origin
  origin: number,             // value of first ORG (or option)
  errors: [{ line, col, msg }],  // line is 1-based
  lineMap: [{ line, addr, len }],  // one entry per source line that emits bytes
  symbols: { name: value }
}
```

NASM syntax and NASM encodings (NASM 2.16 in tools/nasm is the reference: tests/asm.test.mjs
compares the bytes). Case-insensitive mnemonics/registers. Instruction sets: 8086 + 8087,
80186, 80286 + 80287, 80386 + 80387, 80486. Directives: `org`, `db dw dd dq dt` (numbers, strings,
floats in dd/dq/dt), `times`, `equ`, `resb resw resd`, `align`, `cpu`, `bits 16` / `bits 32`
(`use16` / `use32`), `$`, `$$`, local labels `.x`. Size keywords `byte word dword qword tword`
with optional `ptr`. `short`, `near`, `far`, `strict`. Segment override `es:[bx]` and `[es:bx]`.
Prefixes `rep repe repz repne repnz lock es cs ss ds fs gs o16 o32 a16 a32`. Numbers: `123`,
`0x7F`, `7Fh`, `0b101`, `101b`, `'A'`. Expressions: `+ - * / % << >> & | ^ ~ ( )`.

- CPU level: the `cpu` option ('8086' | '186' | '286' | '386' | '486'), then each `cpu` line,
  sets the level of the lines that follow. An instruction, a register (eax, fs, cr0 ...), a 32-bit
  address or a 66h / 67h prefix above the level is an error ("... (use cpu 386)").
- 80486: `bswap r32`, `xadd r/m, r`, `cmpxchg r/m, r` (0F B0 / B1), `invd`, `wbinvd`,
  `invlpg m`, `cpuid` ("... (use cpu 486)" below it). Pentium names (`rdtsc`, `rsm`,
  `cmpxchg8b`, `rdmsr`, `wrmsr`) give "a Pentium instruction (not supported)".
- Code size: the `bits` option (16 | 32; 32 needs cpu 386), then each `bits` / `use16` /
  `use32` line, sets the default operand and address size. The assembler adds 66h (operand
  size) and 67h (address size) when the operands need the other size: `mov eax, 1` in bits 16
  is 66 B8 imm32, `mov ax, [bx]` in bits 32 is 66 67 8B 07. `o16 o32 a16 a32` force a prefix
  (`o32 lgdt [bx]`, `a32 movsb`). Prefix order: 9B (wait), F2/F3, F0, segment, 66h, 67h.
- 80386 operands: eax..edi, fs, gs, cr0-cr7, dr0-dr7, tr0-tr7 (`mov eax, cr0`, no 66h).
  32-bit addresses `[base + index*scale + disp]` (ModR/M + SIB) with the NASM rules: a register
  with a factor is the index; of two registers with factor 1 the first is the base, but one
  written as `r*1` is the index; `[r*2]`, `[r*3]`, `[r*5]`, `[r*9]` become `[r+r*n]` (not with
  `nosplit`); esp is never the index; `[ebp]` gets disp8 0; `[esp]` needs a SIB byte.
  `[byte r+d]` / `[dword r+d]` force the displacement size; `[dword x]` / `[word x]` select
  the address size of a direct address.
- Jumps: short or near is automatic. From cpu 386, a Jcc that does not fit in a byte is
  0F 80+cc rel16/rel32; below it, the inverse Jcc jumps over a near jmp. `jmp dword x`,
  `jz near dword x`, `call word x`, `jmp dword seg:off` (ptr16:32), `call dword far [x]`,
  `loop x, ecx` (address size), `jcxz` / `jecxz`.
- Sized names: `cwde cdq pushad popad pushfd popfd iretd movsd cmpsd stosd lodsd scasd
  insd outsd retnd retfd` and the `w` forms (`pushaw iretw retfw ...`); `pusha pushf popa
  popf iret ret retf` have the code size.
- Differences from NASM: with an explicit `o16` / `o32`, a near jump, a far pointer and
  `push imm` use that size for the displacement or immediate (NASM keeps the code size,
  which the CPU then decodes wrongly); Asm86 rejects 32-bit addresses and 66h / 67h below
  cpu 386 (NASM accepts them); `loadall` is 0F 05 (the 80286 LOADALL, NASM `loadall286`);
  `cpuid` and `cmpxchg` are at cpu 486 (NASM 2.16 puts them at its Pentium level, so the
  tests give NASM `cpu 586` for them); there is no `cmpxchg486` (0F A6 / A7 of the first
  486 steps).

## Disassembler (`src/asm/disasm.js`)

```js
Disasm86.decode(read, off, { cpu = '8086', bits = 16 } = {}) => { len, text, mnem }
// read(i) returns byte i of the instruction (the caller wraps the address, for example
// (off + i) & 0xFFFF in 16-bit code); off is only used for relative jump targets.
// text is NASM-style lower case: "mov ax, [bx+si+0x10]".
```

- cpu '8086' (default): undocumented 8086 aliases decode as the CPU executes them.
  cpu '286': 80186 / 80286 / 80287 opcodes. cpu '386': also the 80386 / 80387 set, the
  prefixes 64h (fs), 65h (gs), 66h, 67h, 32-bit addresses and the 0F xx opcodes; `bits` (16 or 32)
  is the code size (only with cpu '386' or '486'). The 8086 / 286 text does not change.
  cpu '486': also bswap, xadd, cmpxchg (0F B0 / B1), invd, wbinvd, invlpg, cpuid and the test
  registers tr3-tr5; bswap with a 16-bit operand size (no defined function) shows as `db`.
- A 66h / 67h prefix that has no effect shows as `o16 o32 a16 a32` (as in ndisasm); a size
  that is not the code size shows as a keyword (`push dword 0x5`, `jz near dword ...`,
  `call word far [edi]`, `[dword 0x10]`, `loop 0x0101, ecx`). Targets of relative jumps are
  4 hex digits with a 16-bit operand size, 8 with a 32-bit one.
- The text assembles with Asm86 (same cpu and bits) to the same bytes or to an equivalent
  encoding (tests/asm.test.mjs checks this for all opcodes, and compares with ndisasm).
- Encodings with no function on the selected CPU show as `db` with the bytes they use
  (for example cr1, tr0-tr5, sreg 6-7, movzx r16, r/m16, 0F 05 on the 386).

## FPU (`src/core/fpu8087.js`)

```js
const fpu = new FPU8087(mem);   // mem: { read8(phys20), write8(phys20, v) }
fpu.reset();                    // FNINIT state (CW=0x03FF, SW=0, TW=0xFFFF)
fpu.exec(opcode, modrm, ea) => { cycles }   // opcode 0xD8..0xDF
   // ea = null when mod == 3, else { seg, off }:
   // byte i of the operand is at ((seg << 4) + ((off + i) & 0xFFFF)) & 0xFFFFF
fpu.cw, fpu.sw, fpu.tw, fpu.top
fpu.regs[i]   // physical register i as F80 value
fpu.st(i)     // F80 value of ST(i)
fpu.intRequest   // true when an unmasked exception is pending (-> NMI)
F80.toNumber(v), F80.toString(v, digits), F80.fromNumber(x)
```

## CPU (`src/core/cpu8086.js`)

```js
const cpu = new CPU8086(bus);
// bus: { read8(phys), write8(phys, v), in8(port), out8(port, v), in16, out16,
//        fpu (FPU8087 or null), irqPending() -> bool, ackIrq() -> vector,
//        nmiPending() -> bool, ackNmi() }
cpu.reset();          // CS=FFFF IP=0 flags=F002 (8086 flags bits 12-15 read as 1)
cpu.step() => cycles  // one instruction (or one REP iteration group, see below)
cpu.regs: Uint16Array(8)   // AX CX DX BX SP BP SI DI (encoding order)
cpu.sregs: Uint16Array(4)  // ES CS SS DS (encoding order)
cpu.ip, cpu.flags (getter builds the word), cpu.halted
cpu.trace = null | array   // when an array, the CPU pushes micro-events (below)
cpu.cycles                 // total clocks since reset
```

## Micro-event stream (`cpu.trace`)

When `cpu.trace` is an array, `step()` pushes events for that instruction. `t` is
the clock offset from the start of the instruction. Views replay these events.

```js
{ k:'fetch', t, addr, data, width }         // code prefetch bus cycle (4 clocks)
{ k:'bus', t, type, addr, data, width, dev, owner }
   // type: 'memr'|'memw'|'ior'|'iow'|'inta'|'halt'
   // S2..S0 status: inta 000, ior 001, iow 010, halt 011, code 100, memr 101, memw 110
   // dev: 'ram'|'rom'|'vram'|'pic'|'pit'|'ppi'|'dma'|'crtc'|'cga'|'nmi'|'fdc'|'sb'|'opl'|'none'
   // owner: 'cpu'|'fpu'
{ k:'queue', t, op:'push'|'pop'|'flush', n, q:[bytes after op] }
{ k:'decode', t, cs, ip, len, text, bytes }
{ k:'ea', t, seg:'DS', segv, off, phys }
{ k:'alu', t, op:'ADD', a, b, r, w }        // w = 8|16
{ k:'reg', t, r:'AX', v }                   // also 'CS','IP','SP' etc
{ k:'flags', t, v }
{ k:'int', t, vec, src:'sw'|'irq'|'nmi'|'exc' }
{ k:'fpu', t, text, cycles }
{ k:'end', t }                               // t = total clocks of the instruction
```

`Machine.step()` adds the events of the floppy controller, the sound card and the DMA (not the CPU):

```js
{ k:'fdc', t, op, drive, cyl, head, sec, text }
   // op: 'command' (the last command byte came; text = name and C H R N EOT),
   //     'seek' (a SEEK or RECALIBRATE starts), 'step' (one step pulse; cyl = the new track),
   //     'read' | 'write' (a sector starts under the head; sec = R), 'result' (the result
   //     phase starts; text = ST0-ST2 and C H R N), 'irq' (the INT line goes up),
   //     'reset' (DOR bit 2 goes low, or the controller leaves the reset state)
   // cyl, head: the drive's head position and side now; sec = 0 when no sector
{ k:'dma', t, ch, addr, data, read, n, count }
   // ch: 2 (floppy) or 1 (Sound Blaster DSP)
   // the first DMA transfer of this instruction on this channel: addr = physical address,
   // data = the byte, read = true for memory -> device, n = transfers in this instruction,
   // count = the count register after the last of them (FFFFh after TC)
{ k:'sb', t, op, cmd, text, rate, left }
   // the Sound Blaster DSP. op: 'command' (the last byte of a command came; cmd = the
   //   command byte, text = 'D1h speaker on', '14h 8-bit DMA output: 1024 bytes' ...),
   //   'dma' (a DMA transfer starts, or the next block of an auto-init transfer),
   //   'irq' (IRQ 7 goes up: the end of a block, or command F2h), 'dac' (command 10h:
   //   one sample to the DAC), 'reset' (the reset line goes high; the DSP is ready: AAh)
   // cmd = the last command byte (-1 = none), rate = the sample rate (Hz, rounded),
   // left = the bytes left in the block
{ k:'opl', t, reg, val, ch, op, text }
   // an OPL2 register write (the data port 389h / 229h; the address write makes no event).
   // op: 'key-on' | 'key-off' (register B0h-B8h key bit, or a drum bit of BDh) | 'write';
   // ch: the channel 0-8 (BDh key events: 6), -1 for a register of no channel;
   // text: 'OPL2 register B0h = 31h (key-on channel 0: 440.0 Hz)'. At most 4 in one instruction.
```

`t` of an event that a port access makes (command, result, reset of the floppy; 'sb'
command / dac / reset / F2h irq; all 'opl' events) is the time of that 'bus' event of the
same device (+1); the other events have the clock inside the instruction when the
device did the work. At most one 'dma' event for each channel comes in one instruction,
and at most 8 'sb' events.

## Machine (`src/core/machine.js`)

```js
const m = new Machine();
m.loadProgram(bytes, origin)  // copy to 1000:origin and set registers
m.reset()                     // power-on: BIOS runs from FFFF:0000
m.step() => { cycles, events } // one instruction with trace
m.run(maxCycles)              // fast, no trace; stops at breakpoint/halt
m.cpu, m.fpu, m.pic, m.pit, m.ppi, m.dma, m.crtc, m.kbd, m.fdc (FDC765)
m.sb (SoundBlaster), m.opl (OPL2)   // null when m.soundCard = false (see "Sound Blaster")
m.soundCard = true | false       // put in / remove the Sound Blaster (default true;
                                 // new Machine({ soundCard: false }) makes a machine without it)
m.takeSound() -> { rate, samples } // the card audio since the last call (see "Sound Blaster")
m.audioRate = 44100              // the sample rate of takeSound() (the UI sets the AudioContext rate)
m.audioOn = false                // true: the OPL2 makes its samples at each register write
m.diskTiming = 'fast' | 'real'   // floppy timing, see "Floppy controller"
m.mem  (Uint8Array 1 MB)
m.vram() -> Uint8Array view of B8000..B8FA0
m.heat  { read: Float32Array(4096), write: Float32Array(4096) } // per 256-byte page
m.onSpeaker(cb)  // cb(freqHz or 0)
m.keyDown(code), m.keyUp(code)   // scan code set 1
m.breakpoints: Set of physical addresses
m.pokeMem(addr, bytes)   // write bytes (array, Uint8Array or one number) into m.mem at a physical
                         // address, then m.memChanged(addr, bytes.length)
m.memChanged(addr, len)  // RAM changed but not by the CPU (a write to m.mem by the UI, a tool, a
                         // test): the 80486 machine removes the old copies from its cache
                         // (no work on the other machines)
```

The UI and the tools must write memory only with `m.pokeMem`, or call `m.memChanged` after
each direct write to `m.mem`, while a program runs (a write right after `m.reset()` needs
nothing: the reset empties the cache).

## Machine statistics (for fast mode)

`m.stats` is an object of counters that the app reads and then zeroes once per frame:
`{ fetch, memr, memw, ior, iow, inta, fpu, dev: { ram, rom, vram, pic, pit, ppi, dma, crtc, cga, nmi, fdc, sb, opl } }`
(counts of bus cycles; `dev` counts accesses per device; `dev.fdc` counts the CPU port
accesses to the floppy controller, `dev.dma` the DMA port accesses plus one for each DMA
transfer (floppy and Sound Blaster), `dev.sb` the CPU accesses to the DSP ports,
`dev.opl` the accesses to the OPL2 ports).

## UI shell (src/index.html, src/ui/style.css, src/ui/app.js)

Colours come only from `THEME` / `BUS_COLOR` in `src/ui/theme.js` (JS) and the matching
CSS custom properties on `:root` (`--void --panel --panel2 --line --ceramic --gold
--gold-hi --copper --cyan --magenta --phosphor --lavender --text --muted --faint`).
Helpers in theme.js: `hex2 hex4 hex5 bin clamp lerp easeOut easeInOut svgEl htmlEl
strokeTextPath strokeTextWidth strokeTextCanvas storage`.
Fonts: `--mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace`
and `--sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

The stage has four tabs. Each tab hosts one view in a `<div class="view-host">` that fills
the stage (position: relative; the view owns everything inside it).

| Tab | Class | File |
|---|---|---|
| Board | `BoardView` | src/ui/board3d.js (three.js) |
| Top 2D | `TopView` | src/ui/topview.js (canvas 2D) |
| Die | `DieView` | src/ui/die.js (SVG) |
| Bus timing | `TimingView` | src/ui/timing.js (SVG) |
| Memory | `MemoryView` | src/ui/memmap.js (SVG + canvas) |

## View contract

```js
class XView {
  constructor(host, app)   // host: HTMLElement; app: see below
  show()                   // the tab becomes visible (start rendering)
  hide()                   // the tab is hidden (stop rAF work, keep state)
  resize()                 // host size changed
  reset()                  // machine reset / new program: clear transient visuals
  instr(events, info)      // an instruction starts playback. info = { cycles, clockMs, text, cs, ip }
  event(e, clockMs)        // micro-event e reaches its time t. clockMs = real ms per CPU clock
                           // (use it to size animations: a bus cycle lasts 4 * clockMs)
  frame(now, dt)           // each animation frame while shown (ms)
  fast(stats)              // FAST mode, once per frame instead of instr/event:
                           // stats = { cps, ips, bus:{...m.stats}, sample: events[] of one
                           //           traced instruction, or null }
  setReducedMotion(on)
  traceStep(story, i, info) // OPTIONAL. Trace mode: step i of story starts (story = null: clear).
                           // info = { ms, back, auto }. Only BoardView draws it now.
}
app = {
  machine,                 // Machine
  reducedMotion,           // boolean
  mode,                    // 'clock' | 'explain' | 'fast'
  select(kind, id),        // ask the app to show info for a chip / register etc.
  on(name, cb)             // 'reset', 'mode', 'select'
}
```

Views must never step the machine. They only read `app.machine` state and the events.
In `clock` mode the app sends one event group per CPU clock (clockMs is large, ~400).
In `explain` mode clockMs is 5-200 ms. In `fast` mode only `fast()` is called.
Reduced motion: no camera flights, no travelling pulses; show state changes in place.

## Trace mode (src/ui/story.js, app.js, board3d.js)

The "Trace" switch (storage 'trace', default on) changes the explain speeds: each
instruction plays as a list of steps, and the speed slider sets the time of one step
(`TRACE_MS`, 4 s to 0.15 s). `Story.build(events, { prefetch })` makes the list:

```js
{ text, cs, ip, cycles, steps: [
  { i, kind: 'bus'|'inside'|'irq', lane: 'BIU'|'EU'|'8087'|'80287'|'IRQ',
    phase: 'addr'|'cmd'|'data'|'all' (bus only; 'all' = a prefetch in one step),
    t,                     // the app dispatches the micro-events up to this clock when the step starts
    title, text, sum,      // a heading, full sentences, one line for the step list
    token: { tag, val, col: 'addr'|'data'|'ctrl'|'fpu'|'eu' },
    e, I (bus: the event and Story.busInfo(e)), unit ('cpu'|'fpu', inside) } ] }
```

A bus cycle gives three steps (address, command, data; INTA has no address step, halt
one step). Events inside the CPU between bus cycles become one 'inside' step. Prefetch:
'short' (default) = one step per fetch, 'full' = three steps, 'hide' = no steps.
The app keeps `play.story` and `play.si`; Next / Back (keys `.` and `,`) move one step;
Back only replays the picture (the machine cannot go back). Keys: N, period or Space
(next), B or comma (back).

The board draws each step as a JOURNEY (`BoardView.trJourney(step)`): a list of
segments, 'move' (the token moves along points) and 'dwell' (the token waits in a die
block while a BLOCK CARD shows how the block works, with the real values). The weights
of the segments set the time: the blocks get most of it, the travel over the board is
fast. While the token is in a chip, the camera is still and frames the whole die (between
the block card at the left and the floating screen at the right); the active block glows
(BLOCK_FS quad on the die). Over the board, the camera frames the path. Springs move the
camera (target; log r, phi, theta; a roll for dies on the cards).

TRACE MODELS (board3d.js, `traceModel(part)`, `TRACE_MODELS`) say how a step goes through
each kind of chip, by die part: the CPU model (out, status, in, write, inside), DRAM, ROM,
8288/82288 and a generic I/O model (data bus buffer, register select, target register by
`ioBlock`). Each model returns visits `[[block label, card spec], ...]`. To add a chip
(a sound card, a new video chip), add a floor plan to DIE_PLANS and a model to
TRACE_MODELS. Card specs are for `BlockPanel` (src/ui/blocks.js): kinds adder, logic,
shift, bytes, regfile, decoder, cells (mem: 'dram'|'rom'), mux, latch, buffer, flags,
status, opcode, counter, text; `update(u)` draws the state at progress u (0..1).
The same spec also draws ON THE DIE: `UnitFx.draw(g, w, h, spec, u, t, reduced)`
(src/ui/unitfx.js) paints the work of the unit (adder cells and carry, queue slots,
register rows, decoder lines, DRAM word and bit lines ...) on a canvas texture over the
unit rectangle (`BoardView.unitOverlay`). The last unit keeps its picture while the token
is in the same chip. The trace camera always frames the whole die. When the user turns
or zooms the camera (the wheel zooms toward the pointer), `trHold` keeps the user's camera
until the token leaves that chip. A unit with more than one part on the die (DRAM cell
array quarters, row decoders, sense amplifiers) glows in all its parts (`blockGlows`).
The sound effects are short sine tones only (no noise, no continuous hum).
Outside the trace, `liveUnits(ev)` plays the same unit drawings from the live micro-events
(and from the fast-mode sample) on open dies near the camera. `isOpen(e)` counts a package
open when it is scratched open (cov) or opened with a round window (e.win); EPROM quartz
windows hide while the package is open.

FOCUS MODE (board3d.js): a double-click on a component (`focusOn`, `zoomToDie`,
`focusChip`) calls `setFocus(obj, name)`. Until Esc (or a camera preset), `focusOcclude`
hides every part whose box lies on the lines from the camera to the component, or holds
the camera, also the neighbours in the same card; the pins of hidden parts (shared
instanced meshes) hide per instance (`instSets`). The trace uses the same test for the die
that it shows. Mouse: left drag moves the view in the screen plane, right drag / Shift
turns it, the wheel zooms to the pointer; touch: one finger moves, two fingers pinch,
twist and tilt.

SPEED slider: positions 0..90; the known speeds (SPEEDS) sit at multiples of 10 and hold
the slider (±1). Between two stops of the same kind the speed changes on a log scale
(`App.speedAt`); Page Up / Page Down jump between stops. Close to a die (camera r < 5) or while the
token is inside a chip, the Board shows no chip tooltips.

Repeats (trace bar, storage 'traceRep', default 'once'): an instruction whose address the
trace showed in the last 2000 traced instructions runs without trace (`App.ffFrame`, in
12 ms slices) until the CPU gets to new code; a REP counts from `repState.start`. Skip
(key S) runs fast to the instruction after the current one (steps over CALL, INT and the
jump at the end of a loop). The next step tells how many instructions ran fast.

`BoardView.focusChip(key, block)` opens a chip and flies to its die (and to a block on
it); the Die tab uses it on a double-click. The bottom bar has the switches Trace, Decap
(opens all packages: storage 'decap') and Effects.

## Top view (src/ui/topview.js)

A flat top view of the whole machine on two 2D canvases (a still layer and a live
layer). It takes the layout, the die floor plans, `drawInterior`, the trace models and
the bus helpers from `BoardKit` (exported by board3d.js), so the 3D board and the top
view always agree. The expansion cards lie flat in a row above the board, joined by an
ISA rail. Every die is open all the time: small on the screen it is a clean floor plan
(units as coloured rectangles, labelled when they fit); larger, the full die picture
(cached at powers of two); at a close zoom, a sharp picture of the part in view when the
view rests. Bus bundles are labelled lines. Live layer: the clock chip and CLK lines
flash on each clock; busy chips get a coloured edge; each bus cycle draws its address,
command and data paths with the value on the front; each unit plays its `UnitFx` drawing
on the die. In trace mode the same step journeys as the 3D board play (dwell in each
block with its BlockPanel card). "Follow" moves the view to the chip or path that works;
drag, wheel, pinch or keys move it by hand (and turn Follow off); a double-click fits a
chip to the view; Esc or "See all" shows everything.

## Sound effects (src/ui/sfx.js)

`Sfx` (storage 'sfx', on by default; the audio starts after the first user gesture):
`tick(k)`, `step()`, `arrive(kind)` ('addr'|'data'|'ctrl'|'fpu'|'eu'|'irq'), `enter()`,
`leave()`, `edge(high)`, `select()`, `write()`. Each call has its own rate limit. The
views call them only while visible and only when the playback is slow enough to follow
(about 60–120 ms or more of real time per clock). The runner's own sounds follow the
same Effects switch. `tests/story.test.mjs`
checks the step lists on both models and both cards.

## Screen

`src/ui/crt.js` (`CrtScreen`) draws video RAM. The floating monitor (`#monitor`) sits at
the top-right of the stage (on phones it moves into the dock). Small size uses "fit"
mode: it zooms to the rows and columns in use (at least 40 x 10). `app.crtCanvas` is a
separate fixed 1024 x 768 (4:3) full 80 x 25 canvas for the 3D monitor; `app.crtVersion`
changes when it is redrawn.

## Disks and DOS

`src/core/disk.js`: `FloppyDisk` (geometry from the image size), `fat12Blank(label)`,
`fat12AddFiles(img, files)`, `fat12List(img)`. `m.disks[0|1]` are the disks in drives A:
and B: (`busy` 0..1 decays for the LEDs; `reads`, `writes` count sectors; `dirty`;
`lastSector` = the LBA of the last sector). The floppy controller sets these fields.
The BIOS INT 13h drives the real controller (see "Floppy controller"). `diskService(m)`
(the old one-step INT 13h, OUT E0h) stays only for tests; the BIOS does not use it.
OUT E2h sets the BIOS tick count from the host clock (the BIOS does it at start-up).
The BIOS boots from A: (INT 19h) when no program entry is set at 0040:00F4.

### Floppy controller (src/core/fdc765.js) and DMA

`m.fdc = new FDC765(m, { at })`: a NEC uPD765A with two 3.5-inch drives, like the IBM PC/XT
(`at` = false) and AT (`at` = true: port 3F7h). `Machine.tickDevices(c)` calls
`m.fdc.tick(c)` after each instruction.

- Ports: 3F2h DOR (bits 0-1 drive select, bit 2 = 0 holds the controller in reset,
  bit 3 gates IRQ 6 and DRQ 2, bits 4-7 motor A-D), 3F4h MSR (bit 7 RQM, 6 DIO,
  5 NDMA, 4 CB, bits 0-1 drive busy (seek)), 3F5h data. AT: 3F7h write = DCR (data rate:
  0 = 500, 1 = 300, 2 = 250 kbit/s, 3 = 1 Mbit/s), read = DIR (bit 7 = disk change of the
  selected drive). The DOR powers on as 0 (in reset).
- Commands: SPECIFY 03, SENSE DRIVE STATUS 04 (ST3; RY = a disk is in and the motor is at
  full speed; WP when no disk), WRITE DATA 05 (+MT 80h, MF 40h), READ DATA 06
  (+MT, MF, SK 20h), RECALIBRATE 07 (77 steps at most, then EC), SENSE INTERRUPT STATUS 08,
  READ ID 0A, FORMAT TRACK 0D, SEEK 0F. Other codes: ST0 = 80h (invalid). After a reset
  4 SENSE INTERRUPT STATUS give ST0 = C0h-C3h. READ/WRITE end at TC (normal end; C, H, R
  = the next sector: R+1, or with MT the other side, or C+1), or at EOT without TC
  (ST1 EN). Errors: NR (not ready), NW (write protect), ND + WC (wrong cylinder), ND
  (no sector), MA (no ID field: wrong data rate on the AT, no track, no side; after two
  index holes), OR (the DMA did not answer). SEEK and RECALIBRATE run in the drive; the
  controller takes other commands meanwhile. Not in the model: non-DMA mode, the head
  load/unload times, the scan and deleted-data commands.
- Data rate: the AT compares the DCR with the media (250 kbit/s for 360/720 KB, 500 for
  1.2/1.44 MB, 1 Mbit/s for 2.88 MB); the XT has no DCR, so any disk reads.
- DMA: each byte of the execution phase is one DRQ 2; `m.dmaRequest(2, toMem, data)` runs
  `DMA8237.transfer` (mask, mode read/write/verify, auto-init, address decrement, TC and
  status bits, the page register gives address bits 16-23; the address does not carry
  into the page). TC ends the FDC transfer. Each transfer takes 4 clocks from the CPU
  (added to `cpu.cycles`). On the AT the DMA addresses do not go through the A20 gate.
- Timing (`m.diskTiming`), 300 rpm (one turn = 0.2 s of CPU time), a track of rate/8 * 0.2
  bytes (index hole at angle 0, then the sector slots, each with its ID and data fields):
  - 'real': motor spin-up 500 ms, step time from SPECIFY (16 - SRT ms at 500 kbit/s,
    2 ms units at 250 kbit/s: 6 ms with the IBM value Dh on the XT), head settle 15 ms,
    the wait until the sector comes under the head, a byte each 32 / 16 / 8 us
    (250 / 500 / 1000 kbit/s). An 18-sector track: 11.1 ms from sector to sector.
  - 'fast' (default): no spin-up, step 0.2 ms, settle 0.2 ms, no rotation wait (the angle
    jumps to the sector), bytes 8 times faster (at least 8 clocks). The same phases,
    DRQs, DMA cycles and interrupts as 'real'.
- State for the views (read only):
  ```js
  m.fdc.phase    // 'idle' | 'command' | 'execution' | 'result'
  m.fdc.cmd      // the name of the last command ('READ DATA', ...)
  m.fdc.fifo     // the bytes of the current phase (the last 9)
  m.fdc.st       // [ST0, ST1, ST2, ST3] of the last result
  m.fdc.msr, m.fdc.dor, m.fdc.irq (the INT line), m.fdc.dcr (AT)
  m.fdc.drives[0..1] = { present (a disk is in), motor (bool), spin (0..1 speed),
    cyl (the head track now), targetCyl, head (side 0/1), angle (0..1 rotation),
    sector (the sector under the head, 1..spt, 0 in a gap), stepping, reading, writing,
    lastCmd (text), index (true while the index hole passes), dirty (the disk has changes) }
  ```
- BIOS INT 13h (bios.js, like the IBM BIOS): AH 00 reset (DOR, wait for IRQ 6, 4 SENSE
  INTERRUPT STATUS, SPECIFY), 01 status, 02 read, 03 write, 04 verify, 05 format,
  08 parameters (the drive type: 1.44 MB; on the AT from CMOS 10h, type 5 = 2.88 MB
  when a 2.88 MB disk is in the drive), 15 drive type (XT: no change line, AT: change
  line), 16 change line, 17/18 media type. The steps: motor on (DOR) and wait for RY,
  recalibrate the first time and after an error, SEEK, DMA channel 2 (mode 46h read /
  4Ah write / 42h verify; a buffer over a 64 KB boundary gives status 09h), the command
  (E6h / C5h / 4Dh; EOT = the table value or the last sector of the request), wait for
  IRQ 6 (2 s), the result bytes (0040:0042), the status code, up to 3 retries with a
  reset. The AT BIOS sets the DCR from the media state (0040:0090+drive: bits 7-6 the
  rate, bit 4 known) and tries 500, 250, then 1000 kbit/s on an unknown disk.
  INT 0Eh (IRQ 6) sets 0040:003E bit 7. INT 08h counts 0040:0040 down and turns the
  motors off (DOR 0Ch) at 0. 0040:003F = the motors that turn, 0040:0041 = the status.
`src/ui/disks.js`: the Disks panel, IndexedDB storage, and `makeFont8x8()` which draws
the 256-character 8x8 font into the ROM at the `font8x8` label at start-up.
Sound at 4.77 MHz is sampled from `m.takeSpeaker()` (port 61h bit 1 AND 8253 OUT2).
The Sound Blaster audio comes from `m.takeSound()` (see "Sound Blaster 2.0").

## Sound Blaster 2.0 (src/core/soundblaster.js)

`m.sb = new SoundBlaster(m)` on all four machines (the 8086 PC, the 80286 AT, the 80386 AT and
the 80486 AT): a Creative Sound Blaster 2.0 with the DSP version 2.01 at 220h, IRQ 7, 8-bit DMA
channel 1, and its Yamaha YM3812 (OPL2) at 228h-229h and at the AdLib ports 388h-389h.
`m.opl = m.sb.opl` (class `OPL2`). `m.soundCard = false` removes the card: the ports read
FFh ('none'), `m.sb` and `m.opl` are null, `m.takeSound()` gives no samples. DOS programs
find the card with `BLASTER=A220 I7 D1 T3` or by a probe of the ports.

- Clock: `Machine.tickDevices(c)` calls `m.sb.tick(c)` after each instruction (after the
  floppy controller; the DMA cycles of both take clocks from the CPU, see "Floppy
  controller"). `m.sb.clk` counts the clocks since power-on (it does not go back at a
  reset). All times come from `m.clockHz`. `m.reset()` calls `m.sb.powerOn()`.
- ISA I/O time: each CPU access to a card port adds `m.isaIo` clocks (`m.ioStall`), so that
  an access takes about 0.9 us as on the ISA bus: 0 on the 8086 and the 80286, 15 on the
  80386 at 25 MHz, 22 on the 80486 at 33 MHz. (Games wait for the OPL2 with reads of 388h.)
- DSP ports: 226h write bit 0 = 1 then 0: reset (DMA stops, speaker off, the IRQ goes
  low); 20 us later the read buffer holds AAh. 22Ah read = the next byte of the read
  buffer (the last byte again when it is empty). 22Ch write = a command or its data
  (ignored in the reset time and in the high-speed mode); read = 7Fh (bit 7 = 0: not
  busy), FFh in the reset time. 22Eh read = bit 7 set when the read buffer has data;
  the read acknowledges the 8-bit DMA IRQ (IRQ 7 goes low). Other ports of 220h-22Fh
  read FFh (no CMS chips, no SB Pro mixer).
- DSP commands: 10h direct DAC; 14h 8-bit single-cycle DMA output (length - 1, 2 bytes);
  1Ch auto-init DMA output (the block size of 48h); 90h / 91h high-speed auto-init /
  single-cycle output (block size of 48h; the DSP takes no commands until a reset, or
  until a 91h block ends); 24h / 2Ch / 98h / 99h input (the DMA writes 80h, silence);
  48h block size; 40h time constant (rate = 1e6 / (256 - tc) Hz); 80h silence (no DMA,
  IRQ after length samples); D0h pause DMA, D4h continue, DAh exit auto-init after the
  block; D1h / D3h speaker on / off (off mutes the DAC; the DMA continues), D8h speaker
  status (FFh / 00h); E0h identification (the inverted byte), E1h version (02h, 01h),
  E4h / E8h test register, F2h IRQ 7; 20h direct ADC (80h); 74h / 75h / 7Dh 4-bit
  Creative ADPCM (with 75h and 7Dh the first byte is the reference); 76h / 77h / 7Fh
  (2.6-bit) and 16h / 17h / 1Fh (2-bit) ADPCM: the bytes go through DMA at the correct
  rate (3 or 4 samples a byte) and the DAC keeps the reference value (no decoder).
- DMA: the DSP asks for one byte (`m.dmaRequest(1, ...)`, the 8237 `transfer`: mask, mode
  read / write, auto-init, the page register 83h) each `clockHz / rate` clocks (4-bit
  ADPCM: each 2 sample times). When the channel is masked (no DACK) the DSP waits and
  asks again one byte time later. After `length` bytes: IRQ 7; single-cycle: the DSP
  stops; auto-init: the next block starts at once. The DSP counts its own bytes; the TC
  of the 8237 does not stop it (the DMA channel masks itself or reloads).
- OPL2: 388h / 228h write = the register address, read = the status (bit 7 IRQ, bit 6
  timer 1, bit 5 timer 2, bits 1-2 = 1 as on the OPL2: 06h when idle); 389h / 229h write =
  the data, read = FFh. Register 04h: bit 7 resets the flags; bits 6 / 5 mask timer 1 / 2
  (a masked timer sets no flag, and the mask clears its flag); bits 0 / 1 start the
  timers. Timer 1 counts in 80 us steps, timer 2 in 320 us steps, from the preset (02h,
  03h) to 256. The AdLib test (60h, 80h to register 4, FFh to register 2, 21h to register 4,
  wait 80 us or more) reads 00h then C0h. The IRQ output of the chip is not connected.
  CSM (register 08h bit 7): each timer 1 overflow keys all channels on for one sample.
- OPL2 synthesis (`OPL2.render(out, off, n)`, 49716 Hz): the log-sin and exponent ROM
  tables, 4 waveforms (register 01h bit 5 enables E0h-F5h), the multiplier table, KSL
  (0, 3, 1.5, 6 dB per octave), key scale rate, TL, the envelope generator with the rate
  counter of the chip (attack, decay, sustain level, sustain / release by EGT, release),
  feedback, FM and additive connection, tremolo (3.7 Hz, 1 dB or 4.8 dB by BDh bit 7),
  vibrato (6.1 Hz, 7 or 14 cents by BDh bit 6), the rhythm mode (BDh bit 5: bass drum on
  channel 6, hi-hat, snare, tom-tom and cymbal on channels 7-8 with the noise generator
  and the phase bits of the chip; a drum counts 2 times in the mix). The channel outputs
  add to a signed 16-bit value. An operator that is off and not keyed does no work.
- Sound output: `m.takeSound()` -> `{ rate: m.audioRate, samples: Float32Array }`, mono,
  about -1..1, for the emulated time since the last call (the count follows `m.sb.clk`
  exactly: floor(time * rate) in total, no drift; at most 4 s: an older part is dropped).
  The DSP part: the DAC steps (a time log of the DAC values, 32768 entries), averaged
  over each output sample, then a DC block of 10 Hz (the output capacitor); full scale =
  0.5. The OPL2 part: the chip samples at 49716 Hz, linear interpolation to the output
  rate (3 chip samples late), one channel at full level = 0.25. The OPL2 makes samples
  only for takeSound(): with `m.audioOn = true` each register write first makes the
  samples up to the time of the write (exact timing); with `m.audioOn = false` the chip
  makes all the samples of the call with the registers of now (Node tests and fast
  headless runs do no synthesis at all when nobody calls takeSound()).
- State for the views (read only):
  ```js
  m.sb.dspState   // 'reset' (the reset line is high, or the 20 us after it) | 'ready' |
                  // 'params' (a command waits for its data bytes) | 'highspeed'
  m.sb.cmd        // the last command byte (-1 = none)
  m.sb.rate       // the sample rate in Hz, 1e6 / (256 - time constant) (22222 after power-on)
  m.sb.dmaActive  // a DMA transfer (output, input or silence) runs or is paused
  m.sb.paused     // D0h
  m.sb.autoInit   // the transfer starts the next block at its end
  m.sb.blockLeft  // bytes left in the block
  m.sb.speaker    // D1h / D3h
  m.sb.irq        // the IRQ 7 line of the card (up until a read of 22Eh)
  m.sb.lastSample // the last DAC value (0..255, 128 = silence)
  m.sb.level      // recent loudness 0..1 (the peak of |sample - 128| / 128; half in 50 ms)
  m.sb.samples, m.sb.irqs   // counters: DAC samples played, IRQs raised
  m.opl.regs      // Uint8Array(256): the last value written to each register
  m.opl.channels  // 9 x { on (a key or drum key is on), freq (Hz = fnum x 49716 / 2^(20 - block)),
                  //   block, fnum, op: [modulator, carrier] each
                  //   { env (0..1: 1 = full level, 0 = -96 dB; linear in dB),
                  //     stage: 'attack'|'decay'|'sustain'|'release'|'off', wave (0-3) } }
  m.opl.timers    // { t1: { preset, run, flag, mask }, t2: { ... }, irq (a flag is set) }
  m.opl.rhythm    // { on, bd, sd, tom, cym, hh }
  ```
  `env` and `stage` move while the chip makes samples (the app calls `m.takeSound()`
  each frame at all speeds). Without samples, `stage` still shows a key-on ('attack')
  and a key-off ('release') at once.
- UI (src/ui/audio.js `SpeakerAudio.card(snd)`, called from `App.fastFrame`): at the
  real-time speed ("real clock") the app sets `m.audioOn = true` (when the sound is on)
  and `m.audioRate` = the AudioContext rate, and plays each frame's samples as an
  AudioBuffer right after the last one (about 60 ms ahead of the audio clock; a late
  chunk starts again with a 2 ms fade-in; a chunk more than 300 ms ahead is dropped).
  At other speeds the card is silent: the app takes the samples (`App.loop` /
  `fastFrame`) and does not play them. The mute switch mutes the tone, the sampled
  speaker and the card (gain 0 at once). The AudioContext starts after a user gesture.
- Tests: `node tests/sb.test.mjs [--wav dir]` (DSP reset / version / speaker / test
  register, direct DAC, single-cycle / auto-init / high-speed DMA with the sample count
  and the IRQ times, pause / continue, ADPCM, input, silence, the AdLib timer detection,
  the OPL2 pitch (A440 within 1 %), envelope times against the YM3812 data, waveforms,
  FM / AM, rhythm mode, tremolo and vibrato depth, takeSound() counts at 44100 Hz, the
  trace events, and a program on each machine: AdLib detection + auto-init DMA with an
  IRQ 7 handler). `tests/vga.test.mjs` (80286, `--model 80386`): Wolfenstein 3D with
  BLASTER set finds the DSP and the OPL2, plays its menu music on the OPL2, and with
  "Sound Blaster" chosen in its Sound menu plays the pistol shots by DMA (command 14h,
  IRQ 7 handled); the mixed sound goes to tools/wolf3d-sb-<model>.wav.

## 80286 model (second machine)

The user picks the model at the title ("8086 ANATOMY" / "80286 ANATOMY"). The choice is
stored as `storage 'cpu'` ('8086' | '80286') and the page RELOADS to switch. At start-up
`theme.js` sets `CPU_MODEL` and, for the 80286, overwrites the `THEME` values with the
80286 palette (`THEME_286`) BEFORE any view is created; `<html>` gets class `m286`, and
style.css redefines the CSS variables under `:root.m286`. Views must read colours from
`THEME` / CSS variables at construction (no hard-coded hex), and read `app.model`.

### Machine286 (src/core/machine286.js, extends Machine)

An AT-class board: 80286 @ 8 MHz (`m.clockHz = 8000000`; the 8086 machine has
`m.clockHz = 4772727`), 80287, 82284 clock generator, 82288 bus controller, 74LS573
address latches, 74LS245 data transceivers, two 8259A (master 20h, slave A0h, cascade on
IRQ2), 8254 PIT (40h), 8042 keyboard controller (60h data, 64h status/command, A20 and
CPU reset lines), MC146818 RTC + CMOS (70h index, bit 7 = NMI mask; 71h data), port 61h
(speaker, as before), port 92h (fast A20), two 8237 DMA (00h, C0h; channel 2 of the first
one serves the floppy), the uPD765 floppy controller with the AT data rate register (3F7h),
and CGA as before.

- `m.model = '80286'`, `m.memSize = 16 MB` (`m.mem` is 16 MB).
- Map: 000000-09FFFF RAM (640 KB), B8000-BBFFF CGA, F0000-FFFFF ROM, 100000-1FFFFF
  extended RAM (1 MB), FF0000-FFFFFF ROM (mirror; the 80286 starts at FFFFF0).
  Everything else reads FFh. A20 off (`m.a20 = false`, power-on state) forces address
  bit 20 to 0, so addresses wrap at 1 MB like an 8086.
- `m.heat.read/write` have one entry per 256-byte page of the whole 16 MB (65536).
- `m.pic2`, `m.kbc`, `m.rtc` are the new chips. `m.devAt(a)` adds 'xram' (extended RAM);
  `m.ioDevAt(p)` adds 'pic2', 'kbc', 'rtc', 'a20', 'dma2', and 3F7h as 'fdc'.
- CMOS 10h holds the drive types (4 = 1.44 MB, 5 = 2.88 MB when such a disk is in it).
  CMOS 17h-18h and 30h-31h hold the KB of extended RAM (`m.xramEnd` - 1 MB), set at reset.
- Clocks: all device rates come from `m.clockHz` (`m.setRatios()`): `m.pit.ratio` =
  1193182 / clockHz, `m.crtc.scale` = 4772727 / clockHz, the RTC periodic interrupt, the
  VGA line timing, the floppy times, and port 61h bit 4 (refresh; it changes each
  `m.refreshClk` clocks = 8 us). `new Machine286(opts)` also takes `model`, `memSize`,
  `clockHz`, `cpuClass`, `fpuModel` and `xramEnd` (Machine386 uses them).
- INT 15h AH=87h (block move) goes to the machine through OUT E4h (`m.blockMove()`): it
  reads the source and destination bases of the GDT at ES:SI (with byte 7, base bits
  24-31, on the 80386) and copies CX words with A20 on. It writes AH = 0 into `cpu.regs32`
  on the 80386 (the core keeps its registers there during an instruction).

### CPU80286 (src/core/cpu80286.js, extends CPU8086)

Same step()/trace contract as CPU8086, plus:
- All 80186/80286 instructions (PUSH imm, PUSHA/POPA, IMUL r,rm,imm, shifts by imm8
  (count masked to 5 bits for all shifts), ENTER/LEAVE, BOUND, INS/OUTS, 0F xx system
  instructions: SLDT STR LLDT LTR VERR VERW SGDT SIDT LGDT LIDT SMSW LMSW LAR LSL CLTS,
  ARPL, LOADALL (0F 05)), #UD (INT 6) for undefined opcodes, 286 real-mode behaviours
  (PUSH SP pushes the old SP, flags bits 12-15 read 0 in real mode, divide error pushes the
  faulting instruction's address, word access at offset FFFFh -> #GP / #SS (INT 13/12)).
- Protected mode: `cpu.msw` (PE bit 0, MP 1, EM 2, TS 3), `cpu.gdtr {base, limit}`,
  `cpu.idtr {base, limit}`, `cpu.ldtr {sel, base, limit}`, `cpu.tr {sel, base, limit}`,
  segment descriptor caches `cpu.cache[i] = {sel, base, limit, access}` for ES CS SS DS
  (`cpu.sregs[i]` still holds the selector), `cpu.cpl`. (NOT `cpu.seg`: CPU8086 uses
  `cpu.seg` for the segment-override prefix.) Descriptor tables, privilege
  levels, call/interrupt/trap/task gates, TSS task switch, faults with error codes
  (#DE 0, #DB 1, #BP 3, #OF 4, #BR 5, #UD 6, #NM 7, #DF 8, #TS 10, #NP 11, #SS 12, #GP 13,
  #MF 16), shutdown on a triple fault (the machine resets the CPU, as the AT does).
- Physical addresses are 24 bits; the bus hands them to `m.bus.read8/write8`, which
  applies A20.
- 80286 clock counts (Intel 80286 data sheet). A memory bus cycle is 2 clocks (Ts, Tc)
  plus wait states (the machine adds 1 wait state: 3 clocks); every 'fetch' / 'bus'
  event carries `len` (clocks). Views must use `e.len || 4`.
- Extra micro-events:
  `{ k:'desc', t, sreg:'DS', sel, base, limit, access, table:'GDT'|'LDT'|'real' }`
      a descriptor is loaded into a segment cache (the Address Unit);
  `{ k:'sys', t, op:'LGDT'|'LIDT'|'LLDT'|'LTR'|'LMSW'|'CLTS'|..., text }`;
  `{ k:'int', t, vec, src:'exc', err, name:'#GP' }` (exceptions carry the error code);
  `{ k:'task', t, from, to }` task switch; `{ k:'iq', t, n }` decoded-instruction queue
  depth (the Instruction Unit holds up to 3 decoded instructions).
- 80287: `new FPU8087(mem, { model: '80287' })` adds FSTSW AX (DF E0) and FSETPM
  (DB E4) and ignores FENI/FDISI. Like the 8087 it obeys the infinity control bit
  (projective after FNINIT); only the 80387 is affine only. `{ model: '80387' }` (the 80386
  machine) has the same interface and behaviour (see "80386 model").

## 80386 CPU (src/core/cpu80386.js, CPU80386 extends CPU80286)

An instruction-level core with the same `step()` / `finish()` / micro-event contract as
the 80286 core. The 80386 machine (`Machine386`, see "80386 model") uses it. It also runs
on a `Machine286` (`m.cpu = new CPU80386(m.bus)`: the AT BIOS, DOS 3.3 and Alley Cat,
`node tests/dos.test.mjs --model 80286 --cpu 80386`).

### Registers API (read by the views)

```js
cpu.regs32     // Uint32Array(8): EAX ECX EDX EBX ESP EBP ESI EDI (the working registers)
cpu.regs       // Uint16Array(8): the low 16 bits of regs32 (AX..DI), as before. step() writes
               // it at the end of each instruction. A write to cpu.regs[i] from outside (the
               // machine, a debugger) goes into regs32[i] at the start of the next step().
cpu.sregs      // Uint16Array(6): ES CS SS DS FS GS selectors (indexes 0-3 as before, 4 = FS, 5 = GS)
cpu.cache[i]   // i = 0..5: { sel, base (32 bits), limit (bytes, G bit applied), access,
               //   flags (bits 20-23 of the descriptor: 8 = G, 4 = D/B, 1 = AVL), big (D/B),
               //   lo, hi (the valid offsets), rd, wr }
cpu.ip         // EIP (32 bits; up to FFFFh in 16-bit code). cpu.eip is the same value.
cpu.f          // EFLAGS (the working value). cpu.flags = the low 16 bits, cpu.eflags = the
               // 18 bits of the 80386 (CF..OF, IOPL, NT, RF = 10000h, VM = 20000h)
cpu.cr         // Uint32Array(5): CR0..CR4. CR0 reserved bits 5-30 read as 1: after reset
               // CR0 = 7FFFFFF0h (ET = 1 when bus.fpu exists). CR1 and CR4 are always 0
               // (MOV to / from them gives #UD, as on the 80386).
cpu.msw        // = CR0 bits 0-15 (getter and setter); cpu.pe = CR0.PE; cpu.paging = CR0.PG
cpu.dr         // Uint32Array(8): DR0-DR7 (DR4/DR5 are aliases of DR6/DR7); DR6 = FFFF0FF0h after reset
cpu.tr6, cpu.tr7   // the TLB test registers
cpu.gdtr, cpu.idtr { base, limit }, cpu.ldtr { sel, base, limit, access, valid },
cpu.tr { sel, base, limit, access }   // access type 9 / 0Bh = 386 TSS, 1 / 3 = 286 TSS
cpu.cpl        // 0-3; 3 in virtual-8086 mode; cpu.vm = EFLAGS.VM
cpu.tlb        // 32 entries { lin, phys, flags, valid } (see Paging)
cpu.tlbStats   // { hits, misses, flushes } (counters for the views; nothing resets them but reset())
cpu.linearIP   // CS base + EIP; cpu.linear(s, off); cpu.phys(s, off) and cpu.peekPhys(lin)
               // translate with no bus cycles and no faults (-1 = not present) for the views
cpu.halted, cpu.shutdownState, cpu.cycles, cpu.instructions, cpu.repState, cpu.q (prefetch queue)
```

After reset: EIP = FFF0h, CS = F000h with base FFFF0000h (the first fetch is at FFFFFFF0h;
the AT bus masks it to FFFFF0h), EDX = 0308h (component ID 03h, revision 08h),
EFLAGS = 2, CR0 = 7FFFFFF0h (or 7FFFFFE0h without a coprocessor).

### Instructions and modes

- Operand size and address size: the D bit of the CS descriptor, then the 66h / 67h
  prefixes. ModR/M with SIB and 32-bit displacements; segment prefixes 64h (FS), 65h (GS).
- All 80386 instructions: the 286 set in 16-bit and 32-bit forms, MOVZX, MOVSX, BT, BTS,
  BTR, BTC, BSF, BSR, SETcc, SHLD, SHRD, IMUL r, r/m, Jcc rel16/32, JECXZ, LOOPx with
  ECX (address size), the string instructions with ESI / EDI / ECX (address size),
  PUSHAD, POPAD, PUSHFD, POPFD, IRETD, CWDE, CDQ, LSS, LFS, LGS, PUSH / POP FS / GS,
  MOV CRn / DRn / TRn, ENTER / LEAVE, BOUND, the 0F 00 / 0F 01 system groups, SALC (D6),
  ICEBP (F1: INT 1). Undefined opcodes, a wrong LOCK and a register form of a memory-only
  instruction give #UD. An instruction longer than 15 bytes gives #GP(0). Not in the core:
  LOADALL (0F 05 and 0F 07 give #UD), SMM, 486 instructions.
- The 80386 behaviours that the SingleStepTests suite shows (all are in the core): the
  real-mode interrupt reads the vector before it pushes the frame; PUSHAD writes from the
  lowest address up; POPA / POPAD load one register at a time (a fault keeps the loads
  before it); POPAD with a 16-bit stack loads ESP bits 16-31 from the ESP image; a 32-bit
  POP of a segment register reads 2 bytes; a fault in POP r/m or in RETF / IRET restores
  ESP and CS; SHL / SHR of a byte or word with a count above the size: CF = the last bit
  out only when the count is a multiple of the size, else 0; SHLD / SHRD of a word with a
  count above 16 shift dst:src:src (a rotate of src); a SIB byte with no index and a scale
  above 1 scales the base; AAM 0 and the IDIV edge case as the 80286; ENTER writes EBP
  with the operand size; SS limit faults give #SS in real mode too; LOCK BT gives #UD
  (the manual lists BT as lockable, the chip does not accept it).
- Real mode: segment loads change only the base (the cached limit and access stay), so
  "unreal" mode works. FLAGS bits 12-14 (IOPL, NT) can change in real mode; bit 15 is 0.
- Protected mode: 8-byte descriptors (32-bit base, 20-bit limit with G, D/B), 286 and 386
  call gates (a 386 gate pushes dwords and copies dword parameters), 286 / 386 interrupt,
  trap and task gates, 286 and 386 TSS task switches (JMP, CALL, INT, IRET; the 386 TSS has
  CR3, FS, GS, the T bit and the I/O map base; registers loaded from a 286 TSS get FFFFh in
  bits 16-31), privilege checks, the I/O permission bitmap (CPL > IOPL, and always in V86
  mode), exceptions with error codes (#DE #DB #BP #OF #BR #UD #NM #DF #TS #NP #SS #GP #PF
  #MF), RF = 1 in the EFLAGS image of a fault. Double fault: two contributory exceptions,
  or #PF then #PF or a contributory exception. A fault during #DF: shutdown (bus.shutdown()).
- Virtual-8086 mode (EFLAGS.VM): real-mode segments (base = selector * 16, limit FFFFh),
  CPL 3. CLI, STI, PUSHF, POPF, INT n and IRET give #GP(0) when IOPL < 3. IN / OUT / INS /
  OUTS use the bitmap. An interrupt goes to a DPL 0 handler with the frame GS FS DS ES SS
  ESP EFLAGS CS EIP (and the error code) and null DS / ES / FS / GS. IRETD at CPL 0 with
  VM = 1 in the image goes back to V86 mode.
- Debug: DR7 instruction breakpoints (faults), data breakpoints (traps), single step, the
  T bit of a 386 TSS (DR6 bits B0-B3, BS, BT).
- 80387: the FPU8087 object in the 80287 mode, through the same bus hooks as the 286.
  CR0.EM or CR0.TS: ESC gives #NM; CR0.MP and CR0.TS: WAIT gives #NM. With paging, or an
  operand that a 24-bit base and a 16-bit offset cannot address, the core gives the FPU a
  small memory map to the physical bytes (the FPU file does not change).

### Paging and the TLB

CR0.PG = 1 (with PE = 1) turns on paging: CR3 = the page directory, 4 KB pages, two
levels. The directory entry and the table entry are read from physical memory ('memr' bus
cycles); the walk sets A in both entries and D in the table entry on a write. U/S and R/W
are checked for CPL 3 accesses (the AND of both levels); supervisor accesses (CPL 0-2,
and the descriptor-table / TSS / IDT accesses) ignore R/W (the 80386 has no WP bit). A
fault gives #PF with CR2 = the linear address and the error code P (bit 0), W/R (bit 1),
U/S (bit 2). An access that crosses a page translates both pages before it starts.

The TLB has 32 entries in 8 sets of 4 ways, as on the 80386: set = linear address bits
12-14, `cpu.tlb[set * 4 + way]`. An entry is `{ lin (page base), phys (frame base),
flags, valid }`, flags: bit 1 R/W and bit 2 U/S (both levels), bit 5 A, bit 6 D. A new
entry replaces the ways of its set in turn (round robin). A write to CR3, and a change of
CR0.PG, flush the TLB (there is no INVLPG). A write through an entry with D = 0 walks
the tables again to set D. The prefetcher does not walk: it stops at a page that is not
in the TLB, and the fetch that needs the byte walks (and can give #PF). TR6 / TR7 work
as on the 80386: TR6 with C = 1 looks up a linear address (TR7 = frame, PL bit 4, way in
bits 2-3); TR6 with C = 0 writes the entry of TR7 (TR6 bits: 11 V, 10 D, 8 U, 6 W).

### Bus and timing

The bus takes 32-bit physical addresses: `bus.read8(phys)`, `bus.write8(phys, v)`,
`in8 / out8 / in16 / out16` as on the 286. The machine masks the address to its RAM and
ROM (the AT bus of Machine286 masks to 24 bits and applies A20). The data bus is 16 bits
wide, as on the 386SX / 386EX: a bus cycle moves 1 or 2 bytes ('bus' and 'fetch' events
have `width` 1 or 2 and `len` = 2 + bus.waitStates clocks). A dword is two word cycles;
an odd address gives byte, word, byte. The prefetch queue holds 16 bytes and fetches one
aligned word per bus cycle. Clock counts are approximate values from the Intel 386 data
sheet (no cycle accuracy).

### Micro-events (the 286 kinds, with these changes)

```js
{ k:'decode', t, cs, ip, len, text, bytes, bits }   // bits: 16 | 32 (the CS D bit);
     // text from Disasm86.decode(read, ip, { cpu: '386', bits })
{ k:'ea', t, seg, segv, off, lin, phys }             // off up to 32 bits, lin = base + off,
                                                     // phys after paging (32 bits)
{ k:'alu', t, op, a, b, r, w }                       // w = 8 | 16 | 32
{ k:'reg', t, r, v }   // r: 'EAX'..'EDI' (32-bit v), 'ES'..'GS', 'CR0' 'CR2' 'CR3', and
                       // 'EIP' at the end of each instruction (the 286 core sends 'IP')
{ k:'flags', t, v, old }                             // EFLAGS (18 bits)
{ k:'desc', t, sreg, sel, base, limit, access, table:'GDT'|'LDT'|'real'|'v86'|'null' }
{ k:'task', t, from, to, reason:'jmp'|'call'|'int'|'iret', tss:286|386 }
{ k:'sys', t, op, text }   // op: LGDT LIDT LLDT LTR LMSW CLTS CR0 CR3 TR6 CALLGATE RETF
                           // IRET V86INT VERR VERW LAR LSL SGDT SIDT SHUTDOWN
{ k:'page', t, lin, phys, dir, tbl, hit:false, pde, pte, fault, err }
     // one for each linear -> physical translation that is not a TLB hit (a page walk):
     // dir = PDE index, tbl = PTE index, pde / pte = the entries read (before A / D),
     // fault = true (and err = the #PF error code) when the walk faults
{ k:'tlb', t, lin, phys, hit:true }   // only with cpu.trace: the first TLB hit of the instruction
```

The other kinds ('fetch', 'bus', 'queue', 'int', 'fpu', 'iq', 'end') are as on the 286.

### Tests

- `node tests/cpu386.test.mjs [prefix ...] [--max N] [--table]`: the SingleStepTests
  80386 real-mode suite (v1_ex_real_mode, 941 files, made on a 386EX; the files are in
  tools/sst386, not in src). Registers, EFLAGS (undefined flags masked with the RM32
  chunk, else f_umask of 80386.csv) and memory must match; cycles are not compared.
  Result: 1,758,699 tests pass, 0 fail, 1 revoked (revocation_list.txt), no group skipped.
  The test bus models one property of the test board: ports 22h-23h (a 386EX register)
  read 427Fh.
- `node tests/pm386.test.mjs [--build]`: NASM programs in tests/asm386 (assembled with
  tools/nasm into .bin + .sym.json): 32-bit code, a 386 call gate, a 386 interrupt gate,
  386 / 286 task switches, paging (#PF, CR2, error codes, A / D bits, a stale TLB entry,
  TR6 / TR7), V86 mode (IOPL-sensitive instructions, the I/O bitmap, INT and IRETD),
  double faults and a triple fault, the 80387 interface, real-mode 386 behaviours.
- `node tests/bench.mjs`: the speed of the four cores (the 386 core: about 8 to 8.5 M
  instructions / s in Node, the 486 core about 7 M).
- `node tests/cpu386.test.mjs --cpu 486 [--nocache]` runs the suite on the 80486 core (see
  "80486 CPU").

### Hooks for the 80486 core

`CPU80386.prototype.fmask` (the EFLAGS bits) and `xfl` (the bits above 17 that POPFD and
IRETD change: 0 on the 80386) are on the prototype; `exec0Fop(op2)` (the two-byte opcodes),
`exec0Fmore(op2)`, `grp0F01()` (0F 01 after the ModR/M byte) and `rdTR(n)` / `wrTR(n, v)`
(the test registers) let CPU80486 decode its opcodes first. The 80386 behaviour does not
change.

## 80486 CPU (src/core/cpu80486.js, CPU80486 extends CPU80386)

An instruction-level core with the same `step()` / `finish()` / micro-event contract as the
80386 core. It adds the 486 instructions, the 486 flags and CR0 bits, the FPU on the chip,
the 8 KB on-chip cache and the pipeline events. It runs on any bus of the 80386 core (the
machine data bus stays 16 bits wide). `Machine486` uses it (see "80486 model").

### Registers API (the 80386 API, with these additions)

```js
cpu.regs32[2]    // EDX after reset = CPU80486.SIGNATURE = 0415h (family 4, model 1 = 486DX,
                 // stepping 5): the same value as CPUID leaf 1 EAX (the Intel rule)
cpu.cr[0]        // 60000010h after reset (CD = 1, NW = 1, ET = 1). The bits: PG 31, CD 30,
                 // NW 29, AM 18, WP 16, NE 5, ET 4 (always 1), TS 3, EM 2, MP 1, PE 0; the
                 // other bits read 0. MOV CR0 with NW = 1 and CD = 0 gives #GP(0).
cpu.eflags       // + AC (bit 18) and ID (bit 21): POPFD, IRETD and a 386 TSS load them;
                 // PUSHFD pushes them; a real-mode interrupt clears AC
cpu.cacheOn      // CR0.CD = 0
cpu.cache486     // { sets: 128, ways: 4, lineSize: 16,
                 //   lines: [set * 4 + way] = { valid, tag (physical address bits 11-31),
                 //     addr (the physical address of the line) },
                 //   lru: Uint8Array(128) (bit 0 = B0, bit 1 = B1, bit 2 = B2 of each set),
                 //   data: Uint8Array(8192) (line i at data[i * 16]),
                 //   stats: { hits, misses, fills, uncached, writeHits, writeMisses, flushes,
                 //     invalidations } }   // read only for the views; reset sets stats to 0
cpu.cacheInvalidate(phys, len)   // the machine: DMA (or another agent) wrote these bytes;
                 // their lines become invalid (ignored with CR0.NW = 1). Returns the count.
cpu.cacheFlush() // all lines invalid (INVD, WBINVD, TR5 control 3, reset)
cpu.tr3, cpu.tr4, cpu.tr5   // the cache test registers (MOV TRn, r32 / MOV r32, TRn)
cpu.tlb[i].flags // + bit 3 PWT and bit 4 PCD of the page table entry
cpu.q            // the prefetch queue: 32 bytes, filled with 16-byte lines from the cache
```

### Instructions

- BSWAP r32 (a 16-bit operand size has no defined function: the core clears the 16-bit
  register, as Intel CPUs do). XADD r/m, r (TEMP = DEST + SRC, SRC = DEST, DEST = TEMP; the
  flags of ADD). CMPXCHG r/m, r (0F B0 / B1; the flags of CMP accumulator, DEST; equal: DEST =
  SRC, else the accumulator = DEST, and a memory DEST gets its own value again, so a
  read-only page gives #PF). LOCK is permitted with a memory DEST (else #UD).
- INVD, WBINVD (CPL 0): the cache becomes empty. INVLPG m (CPL 0; a register operand gives
  #UD): the TLB entry of the linear address becomes invalid.
- CPUID (all CPLs and modes): leaf 0: EAX = 1, EBX EDX ECX = "GenuineIntel"; leaf 1: EAX =
  0415h, EBX = ECX = 0, EDX = 1 (FPU; 0 when bus.fpu is null, as a 486SX); other leaves: 0.
  EFLAGS.ID can change, so the usual CPUID test works.
- #AC (vector 17, error code 0): at CPL 3 (V86 mode too) with CR0.AM = 1 and EFLAGS.AC = 1,
  a data or stack access of 2 or 4 bytes that is not aligned to its size, an FPU operand of
  8 or 10 bytes that is not aligned to 8, an FPU environment or state that is not aligned to
  the operand size. The descriptor-table, TSS and IDT accesses have no check.
- MOV to / from TR3-TR5 (CPL 0): TR5 bits 0-1 control (0 = the buffers, 1 = cache write,
  2 = cache read, 3 = flush), bits 2-3 entry (a dword of the buffer, or the way), bits 4-10
  the set. TR4: bits 11-31 tag, bit 10 valid, bits 7-9 LRU and bits 3-6 the valid bits of the
  set (after a cache read). TR3: a dword of the fill buffer (write) or of the read buffer
  (read).
- Not in the core: 0F A6 / A7 (the CMPXCHG of the first 486 steps: #UD), CR4, SMM, the
  Pentium instructions. The undefined flags stay as on the 80386 core.

### The on-chip cache

Unified (code and data), 8 KB, 4-way set associative, 128 sets of 16-byte lines: set =
physical address bits 4-10, tag = bits 11-31. The cache holds the data of its lines.

- Read: a hit comes from the line (no bus cycle). A miss fills the line (16 bytes from the
  bus) when CR0.CD = 0, the page has PCD = 0 and the address is cacheable, else it is a bus
  read. `bus.cacheable(pa)` is the KEN# input of the machine; without it A0000h-BFFFFh is
  not cacheable. The page walk reads the PDE and the PTE through the cache (PCD of CR3 and of
  the PDE).
- Write: write-through. A write hit changes the line and goes to the bus; a write miss goes
  to the bus only (no line fill). With CR0.NW = 1 a write hit does not go to the bus.
- Replacement: the first invalid way, else the pseudo-LRU tree of the 486: B0 = 0: B1 selects
  way 0 (B1 = 0) or way 1; B0 = 1: B2 selects way 2 or way 3. An access (read hit, write hit,
  fill) to way 0 sets B0 and B1, to way 1 sets B0 and clears B1, to way 2 clears B0 and sets
  B2, to way 3 clears B0 and B2.
- CR0.CD / NW: 0 / 0 normal; 1 / 0 no fills (hits, write-through and invalidation stay);
  1 / 1 no fills, write hits stay in the cache, cacheInvalidate is ignored; 0 / 1 gives
  #GP(0) at MOV CR0. After reset CD = NW = 1 and the cache is empty: the BIOS must clear the
  two bits to use the cache.
- Memory always has the last CPU write (write-through), but the cache can keep an old copy
  of bytes that another agent wrote. The machine must call `cpu.cacheInvalidate(phys, len)`
  for each such write (see "Notes for Machine486").

### Paging

The 80386 TLB and page walk, and: with CR0.WP = 1 a supervisor write needs R/W = 1 at both
levels (else #PF with error code 3); the TLB keeps PWT and PCD; INVLPG removes one entry.

### FPU

The FPU8087 object of the bus (`bus.fpu`, model '80387') is on the chip: no coprocessor bus
cycles (ports F8h / FAh / FCh). The CPU reads a memory operand before the FPU works and
writes the result after it (normal data cycles through the cache and paging, with the #AC
check). CR0.ET is always 1. CR0.EM / TS give #NM as on the 80386. CR0.NE = 1: an unmasked FPU
exception (ES = 1) gives #MF (vector 16) at the next FPU instruction or WAIT (not at the
control instructions FNINIT, FNCLEX, FNSTSW, FNSTCW, FNSTENV, FNSAVE, FLDCW, FLDENV);
NE = 0: no #MF, and `fpu.intRequest` goes to the machine (IRQ 13, as on the 386 machine).
The FPU core keeps the behaviour of its 80287 interface: the infinity control bit works
(projective after FNINIT). A real 387 or 486 FPU is affine only. The core keeps the 287
behaviour because then the Borland runtime of WOLF3D.EXE takes its 80287 path; with
affine-only infinity it takes the 387 path and uses FSINCOS, which the FPU core does not
have. FPU clocks: the i486 values by mnemonic.

### Bus, timing and the pipeline

- Bus cycles as on the 80386 core (16-bit data bus, `len` = 2 + bus.waitStates). A line fill
  is a burst of 8 word cycles in the 486 order (the dword that the CPU needs first: 0-4-8-C,
  4-0-C-8, 8-C-0-4, C-8-4-0), with `len` 2 + ws for the first cycle and 1 + ws for the others
  (the 2-1-1-1 timing of the 486 bus, on a 16-bit bus). Its 'bus' / 'fetch' events have
  `burst: true`, `line` (the line address) and `beat` (0-7).
- The prefetcher reads from the cache: a hit adds up to 16 bytes to the queue with no bus
  cycle; a miss fills the line (a stall of the EU when the queue is empty, else in the free
  bus time); code that is not cacheable comes one aligned word at a time, as on the 80386.
- Clocks: the i486 value of the instruction with cache hits (MOV, ALU reg, INC, PUSH, POP:
  1 clock; ALU with memory 2-3; Jcc 3 taken / 1 not taken; LOOP 7 / 6; MUL / IMUL 13-28;
  DIV 16-43; BSWAP 1; XADD 3 / 4; CMPXCHG 6 / 7 / 10; CPUID 14; INVD 4; WBINVD 5; INVLPG 12;
  REP MOVS 12 + 3n ...). Protected-mode far transfers, gates and task switches keep the
  80386 values. The instruction takes those clocks plus the bus time of its reads (fills,
  uncached reads, I/O) and of its code stalls, and at least the bus time of all its cycles
  (the writes go into the write buffers, but the 16-bit bus must move them).
- Speed in Node: about 7 M instructions / s (the 386 core: about 8). The 486 needs about
  2.7 clocks for each instruction (the 386: 8.5), so an emulated second needs about 3 times
  more instructions than on the 386 at the same clock.

### Micro-events (the 386 kinds, with these additions)

```js
{ k:'cache', t, phys, set, way, hit, fill, write, code?, nc? }
     // at most two for each instruction: the first data access (read or write) and the
     // first code miss (code: true). way = -1 when the line is not in the cache; nc: true for
     // a read that could not fill (CD = 1, PCD = 1 or not cacheable). t: the first cycle of
     // the fill, else the start of the execution.
{ k:'bus' | 'fetch', ..., burst: true, line, beat }   // the cycles of a line fill
{ k:'pipe', t: 0, stage: [prefetch, decode 1, decode 2, execute, write-back] }
     // one for each instruction: the texts of the next three instructions (from EIP after
     // this one, in the order of the code), this instruction, and the one before it
{ k:'int', ..., vec: 17, name: '#AC', err: 0 }
{ k:'sys', t, op: 'INVD' | 'WBINVD' | 'INVLPG' | 'CPUID' | 'TR5' | 'CR0', text }
```

The 'decode' text uses `Disasm86.decode(..., { cpu: '486', bits })` (it reads the memory with
`bus.peek8` when the bus has it). There are no coprocessor port cycles.

### Tests

- `node tests/cpu486.test.mjs`: the new instructions (all operand forms, the flags), CPUID,
  the 386 / 486 / CPUID detection code of real software (on CPU80386 and CPU80486), AC / ID,
  CR0, the FPU on the chip and #MF with NE, the cache (hit / miss / fill counts, the LRU
  order, write-through, INVD / WBINVD, CD / NW, KEN#, DMA invalidation, TR3-TR5), the
  micro-events and the clocks.
- `node tests/pm486.test.mjs [--build]`: NASM programs in tests/asm486 (pm486.inc uses the
  macros of tests/asm386/pm386.inc): #AC at CPL 3 (data, stack, FPU operands; no check at
  CPL 0, with AC = 0 or with AM = 0), WP, INVLPG (one entry), PCD / PWT, INVLPG / INVD /
  WBINVD at CPL 3 (#GP), CPUID at CPL 3, CMPXCHG to a read-only page, #MF in protected mode,
  an FPU operand across two pages.
- `node tests/cpu386.test.mjs --cpu 486 [--nocache]`: the SingleStepTests 80386 suite on the
  486 core with the cache on (or with CD / NW of the tests). The test EFLAGS load without
  bits 18-21 (a 386 holds 0 there). Result: 1,758,699 pass, 0 fail, as on the 386 core. The
  one 486 difference that these tests could show is AC / ID after POPFD / IRETD (the compare
  covers bits 0-17); the run counts such tests: 0 (no test pops a value with bit 18 or 21).
- There is no SingleStepTests 80486 suite (github.com/SingleStepTests has 8086 to 80386).

### Notes for Machine486 (Machine486 does all of them, see "80486 model")

- `new CPU80486(m.bus)` with `bus.fpu` = an FPU8087 '80387' (the FPU is on the chip; no
  F8h-FFh cycles). Set `bus.cacheable(pa)` (KEN#: the RAM yes; A0000h-FFFFFh no: the video
  memory, the option ROMs and the BIOS ROM, because a CPU write to a cached ROM line changes
  the line) and `bus.peek8(a)` (= m.peek8, for the trace texts with no heat and no counters).
- A cache hit makes no bus cycle: `bus.read8` does not see it, so `m.stats` and `m.heat`
  count only the bus cycles (the fills, the uncached reads and all writes).
- The cache: after each CPU reset (power-on, 8042, port 92h, triple fault) CD = NW = 1 and
  the cache is empty; the BIOS clears CR0.CD / NW ("cache on") after the CPU test. A setup
  switch "cache off" can keep CD = 1 (or give KEN# = 0).
- Each write to memory that does not come from the CPU must call
  `m.cpu.cacheInvalidate(phys, len)`: `dmaWrite` (the floppy and Sound Blaster DMA),
  `blockMove` (INT 15h AH=87h: the destination range), `setClockFromHost` (0040:006C),
  `loadProgram` / `startProgram` (the program and its stack), and each test or tool that
  writes `m.mem`. DMA reads need nothing (write-through keeps memory current; not with
  CR0.NW = 1).
- CPU detection in the BIOS: the AC toggle (486), then the ID toggle and CPUID family 4 give
  "Intel 80486 @ 33 MHz"; EDX after reset = 0415h. The INT 6 message can then name "a
  Pentium or later".
- FPU errors: raise IRQ 13 from `fpu.intRequest` only while CR0.NE = 0 (as the AT chipset
  does with FERR#); with NE = 1 the CPU gives #MF itself.
- Speed: at 33 MHz the 486 needs about 12 M instructions per emulated second; the core gives
  about 7 M / s in Node. With the device timing of the 386 machine (all rates from
  m.clockHz), the emulated time goes slower than real time in fast mode.
- Tested before Machine486: DOS 3.3 + Alley Cat (tests/dos.test.mjs) and DOS 6.22 + Wolf3D
  with the Sound Blaster (tests/vga.test.mjs, all 299 checks) pass on Machine386 with
  `m.cpu = new CPU80486(m.bus)`, the cache on, KEN# = 0 for A0000h-FFFFFh and the
  invalidation above. They take about 2.3 times the real time of the 386 core (the same
  emulated time, about 3 times more instructions).

## 80386 model (third machine)

`CPU_MODEL === '80386'`: the page makes `new Machine386({ video })`, assembles the BIOS
from `biosSource('80386')` and the programs with `{ cpu: '386' }`. The list shows the
80386 samples, then the 80286 samples (they run on the 80386 too), then the others.

### Machine386 (src/core/machine386.js, extends Machine286)

The AT board of Machine286 (the same chips and I/O ports, CGA or VGA, the uPD765 and the
8237 DMA) with an 80386 (CPU80386) at 25 MHz, an 80387 and 16 MB of RAM.

- `m.model = '80386'`, `m.clockHz = 25000000`, `m.memSize = 16 MB` (`m.mem`), `m.xramEnd` =
  16 MB. The CPU core has a 16-bit data bus (as the 386SX) and 1 memory wait state
  (`bus.waitStates = 1`: a bus cycle is 3 clocks).
- Physical map (32-bit addresses):

  | Range | Device |
  |---|---|
  | 00000000-0009FFFF | RAM (640 KB) |
  | 000A0000-000BFFFF | VGA window (CGA: B8000-BBFFF) |
  | 000C0000-000C7FFF | VGA video BIOS (option ROM) |
  | 000F0000-000FFFFF | BIOS ROM (64 KB) |
  | 00100000-00FFFFFF | extended RAM (15 MB, 'xram') |
  | FFFF0000-FFFFFFFF | BIOS ROM again (reset: CS base FFFF0000h, EIP FFF0h) |
  | all other addresses | read FFh, writes go nowhere ('none') |

  A20 off forces address bit 20 to 0 below 16 MB; the top ROM does not go through the
  gate. The DMA addresses are 24 bits and do not go through the gate (as on the AT).
- Clocks: the PIT keeps 1.193182 MHz (`m.pit.ratio` = 1193182 / 25e6), the CGA frame
  timing 4.77 MHz clocks (`m.crtc.scale`), the VGA its dot clocks (`new VGA({ clockHz })`),
  the RTC and the floppy their real times, port 61h bit 4 changes each 200 clocks (8 us).
- `m.fpu`: `new FPU8087(mem, { model: '80387' })` = the 80287 interface (FSTSW AX, FSETPM;
  FENI / FDISI do nothing). The 80387 instructions (FSIN, FCOS, FSINCOS, FPREM1, FUCOM) are
  not in the FPU core, and it keeps the infinity control of the 80287, so the Borland
  runtime (Wolf3D) takes its 80287 path. At reset the CPU sets CR0.ET. A coprocessor
  error goes to IRQ 13 (the slave 8259A), as on the AT.
- `m.heat.read/write`: 65536 entries (256-byte pages of the 16 MB); the top ROM counts on
  the pages of F0000-FFFFF. `m.stats.dev` has the Machine286 names.
- `m.devAt(a)`, `m.peek8(a)`: 32-bit physical addresses (the same map; peek8 reads the top
  ROM from F0000-FFFFF). `m.physOf(lin)`: linear -> physical (`cpu.peekPhys` when CR0.PG = 1,
  the top ROM as F0000-FFFFF, the A20 gate; -1 = the page is not present).
  `m.physIP` = `m.physOf(CS base + EIP)`; the breakpoints (`m.run`) use it.
- CMOS 17h-18h / 30h-31h = 15360 KB; INT 15h AH=88h returns it.

### The 80386 BIOS (`biosSource('80386')`, function `bios386` in bios.js)

The AT BIOS with exact block replacements (like the 80286 BIOS from the 8086 BIOS):
- The CPU test at the start-up screen (`cpu_test`): POPF with bits 12-15 = 0 and then
  with bits 12-14 = 1. The 8086 / 80186 keeps bits 12-15 set, the 80286 keeps bits 12-14
  clear in real mode, the 80386 changes them. The screen shows "CPU   Intel 80386 @ 25 MHz,
  1 wait state, 32-bit, paging" with the name that the test found.
- The 80387 test: CR0.ET, then FNINIT / FNSTSW = 0. When found: CR0.MP = 1, the equipment
  bit 1, "FPU   Intel 80387 present (IRQ13)".
- The extended memory comes from CMOS 30h-31h (`ext_kb`): the start-up screen ("RAM
  640 KB + 15360 KB extended") and INT 15h AH=88h. INT 15h AH=87h is the AT block move.
- The model byte stays FCh (AT). The INT 6 message names the 80386 ("a 486 or later").

### 80386 samples (SAMPLES with `model: '80386'`)

- `fib32`: Fibonacci F(0)-F(47) in EAX / EBX / EDX, 8 hex digits with ROL, F(47) in
  decimal with a 32-bit DIV.
- `paging`: a page directory at 20000h, a page table at 21000h (the first 4 MB map to the
  same addresses, but linear 00200000h goes to B8000h), CR3, CR0.PG + PE, a write of a
  line through linear 00200000h (it shows on the screen), the PTE before and after (the
  CPU sets A and D), then back to real mode.
- `bits`: BSF, BSR, BT + SETC (a bit count), MOVZX, MOVSX, SHLD.

### Tests

- `node tests/machine.test.mjs --model 80386 [--video vga]`: all samples (the 80286 ones
  too) and the memory map checks (the reset vector, the top ROM, 16 MB, A20, heat, CMOS,
  physIP with paging). The time slices scale with the clock (the same emulated time).
- `node tests/dos.test.mjs --model 80386 [--video vga]`: DOS 3.3 and Alley Cat.
- `node tests/dos6.test.mjs [--model 80386|80286] [--video vga]`: the user's DOS 6.22 disk,
  unchanged (HIMEM.SYS, the Oak CD-ROM driver cd1.SYS, MSCDEX). On the 80386 the driver
  finds no drive ("No drives found, aborting installation"), DOS gets to A:\>, and MEM
  shows 15,360K XMS and the HMA. On the 80286 the BIOS INT 6 handler stops at the first
  80386 instruction of the driver (66h prefix) with its message.
- `node tests/vga.test.mjs --model 80386`: Wolfenstein 3D on the 80386 (the DOS 6.22 disk
  unchanged); the video BIOS parts run on all four machines. The Wolfenstein part runs in a
  new Node process (`--wolf-only`): after the parts with four machine models the cores run
  about 3 times slower in the same process (V8 has seen many types at the same places).
- `node tests/fdc.test.mjs` and `node tests/story.test.mjs --model 80386` include the 80386.

## 80486 model (fourth machine)

`CPU_MODEL === '80486'` (storage 'cpu' = "80486"): the page makes `new Machine486({ video })`,
assembles the BIOS from `biosSource('80486')` and the programs with `{ cpu: '486' }`. The list
shows the 80486 samples, then the 80386 and 80286 samples (they run on the 80486 too), then
the others.

### Machine486 (src/core/machine486.js, extends Machine386)

The AT board of Machine386 (the same chips, I/O ports, memory map, 16 MB of RAM, CGA or VGA,
the uPD765, the 8237 DMA and the Sound Blaster) with an Intel 80486DX (`CPU80486`) at 33 MHz.

- `m.model = '80486'`, `m.clockHz = 33000000`. All device rates come from `m.clockHz` as on
  the 80386 machine: `m.pit.ratio` = 1193182 / 33e6, the CGA and VGA timing, the RTC, the
  floppy and Sound Blaster times, port 61h bit 4 (each 264 clocks = 8 us), `m.isaIo` = 22.
  The data bus stays 16 bits wide with 1 wait state (`bus.waitStates = 1`); a line fill is a
  burst of 8 word cycles (3 + 7 x 2 = 17 clocks).
- `new Machine386(opts)` now also takes `model`, `clockHz` and `cpuClass` (Machine486 uses
  them).
- The FPU: `m.fpu` is the FPU8087 object in the '80387' mode, on the CPU chip: the core makes
  no coprocessor port cycles (F8h / FAh / FCh). Port F0h still clears the IRQ 13 latch. An
  FPU error goes to IRQ 13 (the slave 8259A) only while CR0.NE = 0 (`m.fpuErr()`: FERR#;
  Machine286 has the same hook without the NE test). With NE = 1 the CPU gives #MF itself.
- KEN# (`bus.cacheable(pa)`): true for RAM (00000-9FFFF and 100000h up to 16 MB); false for
  A0000-FFFFF (the video memory, the option ROMs and the BIOS ROM), for the ROM at the top of
  the 4 GB and for the addresses with no memory. With A20 off, an address with bit 20 = 1 is
  not cacheable (the bus sends it to the byte with bit 20 = 0). `bus.peek8` = `m.peek8`.
- The A20 gate and the cache: the 80486 cache looks at the address before the gate. With A20
  off, a CPU write to an address with bit 20 = 1 also makes the line of the byte with bit
  20 = 0 invalid (the bus write8 of the machine does it). When A20 goes off, `m.a20Cut()`
  makes all lines of addresses with bit 20 = 1 invalid (`tickDevices` looks at the gate after
  each instruction).
- The writes that do not come from the CPU call `m.memChanged(addr, len)` (=
  `cpu.cacheInvalidate`): `dmaWrite` (the floppy and the Sound Blaster DMA), `blockMove`
  (INT 15h AH=87h: the destination; Machine286.blockMove returns `{ src, dst, n }`),
  `setClockFromHost` (0040:006C), `loadProgram` (the 64 KB of 1000:0000), `startProgram`
  (the stack word), the old disk service (OUT E0h: the 64 KB at ES). The UI must use
  `m.pokeMem` / `m.memChanged` for its own writes (see "Machine").
- `m.stats` and `m.heat` count only the bus cycles: a cache hit makes no bus cycle and no
  heat (the line fills, the uncached reads and all writes count).
- The setup switch: `m.cacheEnabled` (default true; `new Machine486({ cache: false })` for
  off). It sets CMOS 2Dh bit 0 (1 = the internal cache is off; `m.reset()` writes it again
  after the RTC reset). "Off" works at once: KEN# = 0 for all addresses, and the cache
  becomes empty (not with CR0.NW = 1). "On" works at the next reset (the BIOS clears CR0.CD).
- After each CPU reset (power-on, the 8042, port 92h, a triple fault) CR0.CD = NW = 1 and the
  cache is empty (the core does it); the BIOS turns the cache on again.

### The 80486 BIOS (`biosSource('80486')`, function `bios486` in bios.js)

The 80386 BIOS with exact block replacements:
- The CPU test (`cpu_test`): after the FLAGS bits 12-14, `cpu_test486`: the AC flag (bit 18)
  can change: an 80486; the ID flag (bit 21) can change: CPUID; CPUID leaf 1 family 4 gives
  "80486DX" (EDX bit 0 = the FPU on the chip) or "80486SX". BDA 0040:00EE (`CPU_KIND`) = 3
  (80386), 4 (80486 with no CPUID) or 5 (CPUID).
- `cache_init` (in the POST, before the FPU test): on an 80486, unless CMOS 2Dh bit 0 = 1:
  INVD, then CR0.CD = 0 and CR0.NW = 0 (the cache is on, write-through). The resume path of
  a CPU reset (CMOS shutdown codes 05h and 0Ah) clears CD and NW too (inline code, no stack).
- The FPU: CR0.MP = 1 and CR0.NE = 0 (FPU errors go to IRQ 13, as on the AT: DOS programs
  expect this path), then FNINIT / FNSTSW as before.
- The start-up screen:
  ```
  CPU   Intel 80486DX @ 33 MHz, 8 KB cache, FPU on chip
        CPUID GenuineIntel, family 4, model 1, stepping 5
  RAM   640 KB + 15360 KB extended   CMOS clock   CGA
  FPU   on the 80486 chip
  Cache: 8 KB on chip, on
  ```
  (the vendor, the family, the model, the stepping and the FPU part come from CPUID; the
  cache line says "off" when CR0.CD = 1).
- The INT 6 message names the 80486 ("a Pentium or later"). Everything else is as the 80386
  BIOS (the model byte FCh, INT 15h, the extended memory from the CMOS).

### 80486 samples (SAMPLES with `model: '80486'`)

- `cpuid`: the classic CPU test step by step (FLAGS bits 12-15, bits 12-14, EFLAGS.AC,
  EFLAGS.ID), then CPUID leaf 0 (the highest leaf, the vendor string) and leaf 1 (the
  signature: family, model, stepping; EDX bit 0 = FPU) and the answer ("an 80486DX").
- `cache`: reads 128 KB two ways, a 4 KB array 32 times (it fits in the cache) and a 64 KB
  array 2 times (it does not fit), timed with the 8254 channel 2 (mode 2, counter latch; the
  486 has no RDTSC); then the same with CR0.CD = 1 and WBINVD. It prints the times in us, the
  big / small ratios and how many times faster the small array is with the cache. Typical:
  on 3241 / 7318 us, off 18901 / 18877 us (5.8 times).
- `atomic`: BSWAP (12345678h -> 78563412h, a big-endian dword), LOCK XADD (a shared counter:
  the old value comes back) and LOCK CMPXCHG (a lock byte: ZF = 1 for the first owner, ZF = 0
  and AL = the owner for the second).

### Tests

- `node tests/machine.test.mjs --model 80486 [--video vga]`: all samples of the 80486, 80386
  and 80286 and the others (the cache sample must show the effect of the cache), the memory
  map checks of the 80386 (with 33 MHz and CPU80486), and the 80486 checks: the start-up
  screen, the setup switch (CMOS 2Dh, CR0.CD stays 1, no fills), KEN#, no stats and no heat
  for a cache hit, the invalidation by DMA, pokeMem, memChanged, loadProgram and
  setClockFromHost, the A20 cases, IRQ 13 with NE = 0 only.
- `node tests/dos.test.mjs --model 80486 [--video vga]`, `node tests/dos6.test.mjs --model 80486
  [--video vga]`, `node tests/vga.test.mjs --model 80486` (Wolfenstein 3D with the Sound
  Blaster; the DOS 6.22 disk stays unchanged), `node tests/story.test.mjs --model 80486`.
- `node tests/fdc.test.mjs` and `node tests/sb.test.mjs` include the 80486 (fdc: the CPU reads
  a DMA buffer through its cache after READ DATA).
- Speed in Node (one process, no other load): DOS 6.22 to A:\> 5.5 emulated s in 21 s real (the
  80386: 6 s); Wolfenstein 3D to the menu 58 emulated s in 318 s real (the 80386: 88 s); the
  whole `vga.test.mjs --model 80486` 13.3 minutes (the 80386: 2.6 minutes). In the game the
  80486 does about 10 M instructions each emulated second, and the core runs only about 0.7 M
  instructions / s there (the same with Machine386 + CPU80486: the time goes into the core, not
  into the machine); the DOS prompt about 1.7 M / s. `machine.test.mjs --model 80486`: about
  3 minutes (the clock sample alone runs 5 emulated s).

## Graphics card option (CGA / VGA)

The user picks the card in the title menu (next to the machine model). The choice is
stored as `storage 'video'` ('cga' | 'vga') and the page RELOADS to switch, like the
model. `theme.js` sets the global `VIDEO_CARD` ('cga' | 'vga') at start-up; `app.video`
returns it. All machines accept either card (8-bit VGA cards existed for the PC/XT).

- `new Machine({ ..., video })` / `new Machine286({ video })` / `new Machine386({ video })` /
  `new Machine486({ video })`:
  `m.video` = 'cga' | 'vga'.
- CGA (as now): `m.crtc` (6845 + CGA registers), video RAM B8000-BBFFF.
- VGA: `m.vga` (src/core/vga.js, class `VGA`), 256 KB video memory in 4 planes, mapped at
  A0000-BFFFF by the graphics controller memory map select; I/O 3C0-3CF, 3B4/3B5/3BA
  (mono) or 3D4/3D5/3DA (colour); the video BIOS is an option ROM at C0000-C7FFF (55AA
  signature, entry at C000:0003) that the system BIOS POST calls; it installs INT 10h.
  `m.crtc` is null with VGA. `m.devAt(a)` returns 'vram' for A0000-BFFFF and 'vrom' for
  C0000-C7FFF; `m.ioDevAt(p)` returns 'vga' for the VGA ports; `m.stats.dev.vga` counts.
- `m.vram()` keeps returning the text buffer view for tools/tests (B8000 in colour text
  modes); `m.vga.textView()` / `m.vga.mode` describe the current mode for views.
- Floppies: 2.88 MB images (80 cyl, 2 heads, 36 sectors, BIOS drive type 5) are
  supported, and `fat12Blank(label, size)` makes 1.44 MB or 2.88 MB disks.

### VGA details (src/core/vga.js, src/core/vgabios.js, src/ui/crt.js)

```js
const v = new VGA({ clockHz });   // m.vga; clockHz = the CPU clock that tick() counts
v.read8(a) / v.write8(a, x)      // CPU access A0000-BFFFF: memory map, chain 4, odd/even,
                                 // map mask, write modes 0-3, read modes 0-1, the 4 latches
v.ioRead(p) / v.ioWrite(p, x)    // 3C0-3CF, 3B4/3B5/3BA or 3D4/3D5/3DA (misc output bit 0)
v.tick(cycles)                   // retrace timing: line rate from the dot clock and CRTC,
                                 // 70 Hz with 449 lines, 60 Hz with 525 lines
v.status1()                      // 3DA: bit 0 display disabled, bit 3 vertical retrace
v.vram / v.vram32                // 256 KB: vram[offset * 4 + plane]; vram32[offset] = 4 planes
v.seq, v.gc, v.crtc, v.attr, v.dac, v.dacMask, v.misc   // the registers
v.dispStart, v.dispPan           // start address / pixel panning loaded at vertical retrace
v.dirty                          // set by every change of the picture; the screen clears it
v.mode                           // { graphics, text, colors, width, height, lines, cols, rows,
                                 //   charH, chain4, planar, unchained, offset, start,
                                 //   lineCompare, memBase, hz } from the registers only
v.textView()                     // text modes: { cols, rows, cells (char, attr), cursor } | null
v.textBuffer(n)                  // planes 0/1 as odd/even bytes (what B8000 shows); m.vram() uses it
v.peek8(a)                       // a CPU read without loading the latches (views)
```

- Chain 4: CPU address bits 0-1 select the plane, the plane offset is the address with
  bits 0-1 replaced by bits 14-15; the CRTC doubleword mode reads the same way.
- `VgaRenderer` (src/ui/crt.js, no DOM, used by the tests too): `new VgaRenderer(vga)`,
  `render(blinkOn, cursorOn)` -> `buf` (Uint32 RGBA), `w` x `h` = the active display at
  its own pixel grid (720x400 text, 320x200 lines doubled = 320x400, 640x480 ...);
  `border` = the overscan colour. The screen maps the active area to 4:3.
- `makeVgaRom({ f8, f14, f16 } | null)` -> `{ bytes (32 KB, checksum 0), symbols }`;
  `m.setVgaRom(bytes)` before `m.reset()`. The page draws the fonts with
  `makeVgaFont(8 | 14 | 16)` (src/ui/crt.js). The system BIOS POST scans C0000-F4000 in
  2 KB steps for 55AAh + a valid checksum and far-calls offset 3. It skips its own mode
  set when INT 10h then points outside its ROM. The old INT 10h moves to INT 42h.
- Video BIOS INT 10h: 00 (modes 0-7, 0Dh, 0Eh, 10h-13h, bit 7 keeps memory), 01-0Fh,
  10h (00-03, 07-09, 10, 12, 13, 15, 17-19, 1A, 1B), 11h (00-04, 10-14, 20-24, 30),
  12h (BL 10h, 30h-34h, 36h), 13h, 1Ah, 1Bh. BDA 0040:0084/85/87/88/89/8A/A8 as the VGA.
  AH=08h in graphics modes returns 0 (no character recognition).
- `m.stats.dev.vga` counts VGA port accesses, `m.stats.dev.vrom` video BIOS reads,
  `vram` counts A0000-BFFFF accesses. `m.devAt`: 'vram' A0000-BFFFF, 'vrom' C0000-C7FFF.
- SAMPLES entries can have `video: 'vga'`; the list shows a sample when its `model` and
  `video` (when present) match the page.
- 80287 note: like the NMOS 80287, fpu8087.js obeys the infinity control bit (projective
  after FNINIT). Borland C runtimes (for example WOLF3D.EXE) use this to tell an 80287 from
  an 80387; with affine-only behaviour they would pick the 80387 path and run FSINCOS.


## 80386 views (src/ui)

`CPU_MODEL === '80386'` (storage 'cpu'): theme.js adds THEME_386 (graphite and coral) and
the classes m286 + m386 on <html>; `AT_MODEL` is true for the 80286 and the 80386. In app.js
`is286` means "an AT-class machine" (also true on the 386) and `is386` the 386. Code
addresses in the app use `codePhys()` (16-bit IP or 32-bit EIP from the D bit of the CS
cache, then `Machine386.physOf` for paging). board3d.js: `M286` = the AT board, `M386` =
the 386 parts (CHIPS_386: the 80386 in a 132-pin PGA ('pga' kind), the 80387 in a 68-pin
package, the 82384 clock); the die plan '80386' has the units SEGMENT CACHES, LINEAR ADDER,
LIMIT CHECK, TLB, PAGE WALKER, PAGE ADDER, BUS INTERFACE, PREFETCH QUEUE, INSTRUCTION
DECODER, DECODED QUEUE, REGISTERS, ALU, MULTIPLY DIVIDE, PROTECTION TEST, CONTROL ROM;
BLK_386 maps the 8086 unit names of the trace models to them. 'page' events become trace
steps (`Story` kind 'page') and play PAGE_CARD (TLB set lookup, page walker, page adder) in
the Board, the Top view and the live unit drawings. die.js: `Die386View` (six units, TLB 8
sets x 4 ways, page walks, #PF overlay; the 80387 in the 287 plan). dock.js: 32-bit register
card and the "80386 system" card (CR / SEG / TLB panes). timing.js: the 386 bus (CLK2, ADS,
M/IO, D/C, W/R, BHE, BLE, T1/T2) with the 82288 commands. memmap.js: 16 MB map, the
linear -> physical calculation and a Pages tab when paging is on.

## 80486 views (src/ui)

`CPU_MODEL === '80486'`: theme.js adds THEME_486 (indigo and lime) and the classes m286 +
m386 + m486. In app.js `is486` is the 486 only; `is386` and `is286` are also true on it (the
486 uses the 32-bit and AT code paths). board3d.js: `M486` (and `M386` is true too).
CHIPS_486 = CHIPS_386 without the coprocessor (the FPU is on the chip), the CPU is part
'80486' (168-pin PGA); the FPU traces (FPU_ROUTES) are not drawn, and trace steps of the
FPU go to the CPU die. The die plan '80486' has CACHE 8 KB, BUS INTERFACE, PREFETCHER, TLB,
PAGE WALKER, PAGE ADDER, SEGMENT CACHES, LINEAR ADDER, LIMIT CHECK, INSTRUCTION DECODER,
CONTROL ROM, REGISTERS, ALU, BARREL SHIFTER, REGISTER STACK, EXPONENT, MANTISSA; BLK_486
maps the older unit names to them. 'cache' events (miss, line fill, write) become trace
steps (`Story` kind 'cache'; a hit is one line in the CPU step) and play CACHE_CARD (set
select, burst, line fill) in the Board, the Top view and the live unit drawings.
die.js: `Die486View` (the cache as 128 sets x 4 ways with the tag compare and the LRU
bits, the line fill in burst order, a strip of the 5 pipeline stages from 'pipe' events,
the FPU on the die; a second floor plan for narrow screens). dock.js: the "80486 system"
card with a CACHE pane. timing.js: the 486 bus (CLK, ADS, BRDY, RDY, BE0-BE3, BLAST, KEN)
with bursts (2-1-1-1) and a cache row. memmap.js: the cached lines of the hex rows and a
cache card.

## Speed of the run loop (all models)

- `Machine.run` gives the clocks to the devices in groups of 64 or more (`tickDue`,
  `tickPending`), not after each instruction. A port access (bus in8/out8) and
  `Machine.step` give them the waiting clocks first, so a program sees the same device
  state. An interrupt can come up to 64 clocks later than with a tick after each
  instruction.
- The 80386 and 80486 cores copy their registers to the `cpu.regs` mirror of the views only
  at the start and the end of `Machine.run` (`cpu.batch`), not at each instruction.
- The floppy controller sleeps (`fdc.sleep`) when nothing moves, and only counts the clocks
  (`fdc.coast`) when only the disks turn. A port access wakes it (and checks for a new disk).
- The 80486 prefetch queue is a fixed buffer (`qb`, `qh`, `qt`); `cpu.q` is a getter that
  gives a copy for the views.
- **Rule: every field of a machine object starts in its constructor**, with its real value
  type (CPU8086 creates the fields of all the cores; also Machine, FDC765, VGA, the FPU and
  the Sound Blaster). A field that code adds later (for example in a trace path) changes
  the hidden class of the object in V8. One traced step that added 4 CPU fields made the
  80486 3 to 6 times slower for the rest of the session. `node tools/latefields.mjs` must
  print "no late fields" (the test matrix runs it).
- `bus.stats` counts the bus cycles through `countCycle(st, type)` (named fields for memr and
  memw): one keyed access with many different keys becomes slow in V8.
- The one-byte opcodes of the 80386 and 80486 are a table of small functions (`P386_OPS`,
  at the end of cpu80386.js; `exec(op)` calls `P386_OPS[op]`). V8 optimizes each small
  function alone.
- The port log is a ring of 64 fixed objects (`ioRing`, `ioPos`, `ioCount`; the getter
  `ioLog` gives the entries oldest first).
- Speed tools: `node tools/pagebench.mjs [secs] [models] [--prof out]` (the real page in
  Chrome, after its BIOS start: the number that counts), `node tools/machbench.mjs` (the
  machine in Node), `node tests/bench.mjs` (the CPU core alone), `node
  tools/corebench-chrome.mjs [--machine] [--nobios]` (the core or the machine in an empty
  Chrome page).
- **The wait-loop skip** (`Machine.run`, all models; `m.idleSkip = false` turns it off). The
  machine watches one code address (`idleIp`, a new one after 4096 clocks with no pass or
  after 64 passes with no repeat). At each pass it compares the registers, the flags, the
  segments, `wrChg` (the bus writes that change a byte, and `memChanged`) and `ioWrN` (the
  port writes) with the last pass and with the first pass. Equal: the next passes do the
  same, so run() adds whole periods to `cpu.cycles` and `cpu.instructions` and gives the
  clocks to the devices (`tickPending`). The limit is 0.25 ms of CPU time, or 10 us when the
  loop reads a port of `IDLE_TIME_PORTS` (the ports that change with time: the 8253, port
  61h, the keyboard controller, the video status, the OPL2 and DSP status, the floppy
  status). An interrupt or a changed value ends the skip. The bus counters, the heat, the
  cache and BTB counters do not count the skipped passes. `Machine.step` (the trace) never
  skips; breakpoints turn it off. Counters: `m.idleSkips`, `m.idleSaved` (clocks).
  With it, the Wolf3D wait loop takes about 0.1 s (Pentium), 0.2 s (386) and 0.8 s (486)
  for each emulated second (`node tools/wolfspeed.mjs --model 80586 --idle`).
- A 33 MHz 80486 runs about 14 million instructions in each emulated second of a wait loop
  (the 25 MHz 80386 about 3.4 million), so the 486 needs more host speed for real time.
  Measure with `node tools/wolfspeed.mjs --model 80486 [--idle]` (DOS 6.22 + Wolf3D: the real
  ms for each emulated second; --idle adds the skip counters and the ports that the game
  reads).

## Pentium core (CPU80586)

`src/core/cpu80586.js`, `class CPU80586 extends CPU80486`: an Intel Pentium P5 (60 / 66 MHz
steps). It keeps the `step()` / `finish()` / micro-event contract of the 80486 core. The build
puts the file after `src/core/cpu80486.js` (`CPU80586`); `tools/vgapng.mjs` loads it too. The
machine (Machine586, the BIOS) and the views are not in this part. The core only counts the
clocks; the machine gives the clock rate (66 MHz; the P5 bus runs at the core clock).

### Registers API (the 80486 API, with these changes)

```js
cpu.regs32[2]    // EDX after reset = CPU80586.SIGNATURE = 0517h (family 5, model 1, stepping 7)
cpu.cr[0]        // as on the 80486: 60000010h after reset (CD = 1, NW = 1, ET = 1)
cpu.cr[4]        // CR4: TSD (bit 2), DE (bit 3), PSE (bit 4), MCE (bit 6); 0 after reset
cpu.cache486     // null (the P5 has two caches: cpu.dcache and cpu.icache, below)
cpu.fdivBug      // false (default) | true: the FDIV bug of the first P5 steps (see "FPU")
cpu.queueSnoop   // true (default, the P5): a write to the bytes in the prefetch queue empties
                 // the queue. false: the old bytes run (the 386 SingleStepTests set this).
cpu.tr12         // TR12 (MSR 0Eh): bit 0 NBP (no branch prediction), bit 1 SE (one pipe:
                 // no pairs), bit 9 CI (no line fills in either cache)
cpu.tscOff       // BigInt: the TSC = cpu.cycles (+ the clocks of the current instruction) + tscOff
```

Both config fields (`fdivBug`, `queueSnoop`) come from the constructor; `reset()` keeps them.

### Instructions

- RDTSC (0F 31): EDX:EAX = the TSC (64 bits). #GP(0) when CR4.TSD = 1 and CPL > 0 (protected
  mode and virtual-8086 mode). The TSC counts the clocks of the CPU: `cpu.cycles` at the start
  of the instruction (the sum of the clocks that `step()` returned) plus `tscOff`.
- RDMSR / WRMSR (0F 32 / 0F 30): CPL 0 only (#GP(0)), ECX = the MSR:
  00h P5_MC_ADDR and 01h P5_MC_TYPE (read 0: no machine check occurs; a write does nothing),
  0Eh TR12 (the bits above), 10h TSC (WRMSR sets the counter), 11h CESR, 12h CTR0, 13h CTR1.
  Another number gives #GP(0).
- The performance counters (CTR0 / CTR1, 40 bits): CESR bits 0-5 = the event of CTR0, bits 6-8
  = its control (0 = stop), bits 16-21 and 22-24 the same for CTR1. A counter counts the change
  of its event since the last write of the counter or of CESR (the core does not look at the
  CPL). The events: 00h data reads, 01h data writes, 02h data TLB misses, 03h data read misses,
  04h data write misses, 05h write hits to M or E lines, 06h data write-backs, 0Ch code reads,
  0Dh code TLB misses, 0Eh code cache misses, 12h branches, 13h BTB hits, 14h taken branches or
  BTB hits, 15h wrong predictions, 16h instructions, 17h instructions in the V pipe. Other
  events count nothing.
- CMPXCHG8B m64 (0F C7 /1): EDX:EAX = m64: ZF = 1, m64 = ECX:EBX. Else ZF = 0, EDX:EAX = m64,
  and m64 gets its old value again (the P5 always writes it: a read-only page gives #PF). The
  other flags do not change. A register operand or a reg field other than 1: #UD. LOCK is
  permitted. #AC: an m64 that is not aligned to 8.
- MOV to / from CR4 (0F 20 / 0F 22, CPL 0). CR4 keeps TSD, DE, PSE and MCE; a 1 in any other bit
  (VME, PVI, PAE, the reserved bits) gives #GP(0): the core has no VME / PVI. A change of PSE
  flushes the TLBs. CR1, CR5-CR7: #UD.
- CR4.DE = 1: MOV to / from DR4 or DR5 gives #UD (else they are DR6 and DR7), and DR7 R/W = 10
  is an I/O breakpoint: IN, OUT, INS and OUTS to a port in the range (LEN 1, 2 or 4) give a #DB
  trap after the instruction (DR6 B0-B3). CR4.MCE can be 1, but no machine check occurs.
- CPUID: leaf 0 = 1 and "GenuineIntel"; leaf 1: EAX = 0517h, EBX = ECX = 0, EDX =
  `CPU80586.FEATURES` | FPU = 1BDh (FPU 0, DE 2, PSE 3, TSC 4, MSR 5, MCE 7, CX8 8; not VME);
  1BCh with no FPU (bus.fpu = null). Higher leaves give 0.
- MOV TRn (0F 24 / 0F 26): #UD (the P5 moved the test registers to MSRs). RSM (0F AA): #UD (the
  core has no SMM, and outside SMM the P5 gives #UD too).
- Self-modifying code: a data write to a line of the code cache makes that code line invalid,
  and a write to the bytes in the prefetch queue (the linear addresses) empties the queue. So
  the next instruction gets the new bytes, as on the P5 (the 486 core runs the old bytes).

### Paging: 4 MB pages and the TLBs

- CR4.PSE = 1: a PDE with PS = 1 (bit 7) maps a 4 MB page: the frame = PDE bits 22-31, U/S and
  R/W come from the PDE only, the walk sets A (and D on a write) in the PDE, PCD / PWT of the PDE
  are the attributes of the page. Bits 12-21 of such a PDE are reserved: a 1 there gives #PF
  with the error code P | RSVD (bit 3) | W/R | U/S. CR4.PSE = 0: the PS bit has no effect (the
  PDE points to a page table). CR0.WP works as on the 80486.
- Three TLBs (entries `{ lin, phys, flags, valid }`, flags: bit 1 R/W, bit 2 U/S, bit 3 PWT,
  bit 4 PCD, bit 5 A, bit 6 D, bit 7 = a 4 MB page; each set replaces its ways in turn):
  - `cpu.tlb`: the data TLB for 4 KB pages, 64 entries (16 sets x 4 ways, set = linear bits 12-15).
  - `cpu.tlb4m`: the data TLB for 4 MB pages, 8 entries (2 sets x 4 ways, set = linear bit 22;
    `lin` and `phys` are 4 MB aligned).
  - `cpu.itlb`: the code TLB, 32 entries (8 sets x 4 ways, set = bits 12-14). A 4 MB page goes
    in as a 4 KB entry (flags bit 7 = 1).
  - `cpu.tlbStats = { hits, misses, flushes, codeHits, codeMisses, bigHits }` (hits / misses:
    the data TLBs; bigHits: the hits in tlb4m).
- MOV CR3, a change of CR0.PG or CR4.PSE, and a task switch with a new CR3 flush the three TLBs.
  INVLPG removes the data entry, the 4 MB entry and the code entries of the page (with a 4 MB
  entry, also the code entries that came from that 4 MB page).
- `cpu.peekPhys(lin)` (the views) knows the 4 MB pages. The page walk reads the PDE and the PTE
  through the data cache (the PWT / PCD bits of CR3 and of the PDE).

### The two caches (public fields for the views; the core writes them, the views only read)

```js
cpu.dcache = { sets: 128, ways: 2, lineSize: 32,
  tag: Int32Array(256),    // line i = set * 2 + way: physical address bits 12-31, -1 = invalid
  state: Uint8Array(256),  // the MESI state of line i: 0 I, 1 S, 2 E, 3 M
  lru: Uint8Array(128),    // lru[set] = the way that the next fill of the set replaces
  data: Uint8Array(8192),  // line i at data[i * 32]
  stats: { hits, misses, fills, uncached, writeHits, writeMisses, writeHitsME, writeBacks,
           flushes, invalidations } }
cpu.icache = { sets: 128, ways: 2, lineSize: 32, tag, lru, data,   // the code lines are S or I
  stats: { hits, misses, fills, uncached, flushes, invalidations } }  // one hit / miss for each
                                                                      // read of the prefetcher
cpu.dFind(pa), cpu.iFind(pa)   // the line index of a physical address, -1 = not in the cache
cpu.cacheFind(pa)              // = dFind (the 486 name)
cpu.lineAddr(tag, i)           // the physical address of line i
cpu.cacheInvalidate(phys, len) // both caches; returns the number of lines (ignored with CR0.NW = 1)
cpu.cacheFlush()               // both caches empty (INVD, WBINVD, reset)
```

- Set = physical address bits 5-11, tag = bits 12-31. A read miss fills a line when CR0.CD = 0,
  the page has PCD = 0, TR12.CI = 0 and `bus.cacheable(pa)` (KEN#) is true. The new data line is
  E, or S when the page has PWT = 1 (the WB/WT# input is always 1). The replacement: an invalid
  way, else the LRU way (one bit for each set).
- Data writes: a write miss goes to the bus (no fill). A write hit: M stays M and E becomes M with
  no bus cycle; S goes to the bus (write-through) and becomes E when the page has PWT = 0 (it
  stays S with PWT = 1). CR0.CD = 1, NW = 0: no fills; hits still work; each write hit goes to the
  bus and the states stay. CR0.CD = NW = 1: no fills, a write hit has no bus cycle, and
  the core ignores `cacheInvalidate` (as the 80486 core). CD = 0 with NW = 1: #GP(0) at MOV CR0.
- The memory rule of this emulator: the core writes each store to memory at once, so memory
  always has the newest bytes. A write that stays in the cache (an E or M line, or NW = 1) goes
  to memory through `bus.poke8(a, v)` when the bus has it (no bus cycle, no heat, no counters),
  else through `bus.write8`. The M state and the write-back bursts are only for the timing and
  the views: the fill of a line that replaces an M line puts a write-back burst of the old line
  on the bus after the fill; WBINVD writes back all M lines; INVD drops them (memory has the
  bytes anyway). A DMA write needs `cacheInvalidate` only for the stale copies in the caches.
- The code cache: the prefetcher reads it. A miss fills the line (the same rules: CD, PCD of
  the code page, TR12.CI, KEN#); code that the cache cannot keep comes one aligned group of 8 bytes
  at a time.

### The 64-bit bus and the timing

- `len` of a bus cycle = 2 + `bus.waitStates` clocks, as on the other cores. A line fill is a
  burst of 4 transfers of 8 bytes in the Intel order (the 8 bytes that the CPU needs first:
  0-8-10-18, 8-0-18-10, 10-18-0-8, 18-10-8-0), `len` 2 + ws for the first transfer and 1 + ws for
  the others (2-1-1-1). A write-back is the same burst (in address order). Any other access is
  one transfer for each aligned group of 8 bytes that it touches (`width` = its bytes).
- An instruction takes its P5 clocks plus the bus time of its reads (fills, uncached reads, I/O)
  and of its code stalls, and at least the bus time of all its cycles (as on the 80486).
- The prefetch queue: `qb`, `qh`, `qt` as on the 80486 (`cpu.q` for the views). The prefetcher
  fills it to 16 bytes or more in the free bus time, at most 16 bytes for each read of the code
  cache; a code-cache hit takes no bus time.

### The two pipes (U and V)

At the end of each instruction that ran in the U pipe, the core looks at the next instruction
(its bytes in the queue) and decides if it goes into the V pipe. The pair forms when all these
rules are true (else the reason goes into the 'pipe' event and `pipeStats.why`):

- Both are simple: MOV r/m/imm (88-8B, C6/C7 /0, B0-BF, A0-A3), ALU r/m/imm (ADD OR ADC SBB AND
  SUB XOR CMP: 00-3D, 80-83), INC / DEC r and r/m, PUSH / POP r, PUSH imm, LEA, NOP, TEST r, r/m
  (84/85) and TEST acc, imm (A8/A9). U only: ADC, SBB, SHL / SHR / SAR / SAL by 1 or imm, ROL /
  ROR / RCL / RCR by 1. V only: Jcc (short and 0F 8x), JMP near and short, CALL near (direct).
  Another instruction is not simple (for example MUL, a shift by CL, a string instruction).
- No prefix on either (66h, 67h, a segment, LOCK, REP; the 0F of Jcc is not a prefix).
- No instruction with both a displacement and an immediate (for example `mov dword [x], 5`).
- The V instruction is all in the queue (else "V is not in the queue": a code-cache miss).
- No register dependency: V does not read a register that U writes, and they do not both write
  one register (AL, AH, AX and EAX are one register). The flags are no dependency (CMP or TEST in
  U with Jcc in V pairs). PUSH / PUSH (or PUSH / CALL) and POP / POP pair: the P5 adjusts ESP
  for both. An address register counts as a read (`lea si, [di+4]` / `mov ax, [si]` does not pair).
- The FPU pair: FLD, FADD, FSUB, FMUL, FDIV, FCOM, FUCOM, FTST, FABS, FCHS in U with FXCH in V.
  Another FPU instruction does not pair.
- No pair: TR12.SE = 1, EFLAGS.TF = 1, or U does not complete (a fault, an interrupt, a taken
  branch in U: a branch goes only into V).
- An interrupt (IRQ or NMI) that comes up between the two instructions waits until V is done.

The clock rule of a pair: the pair takes P = the clocks of the longer instruction. The step of the
U instruction returns its own clocks minus 1 (at least 1); the step of the V instruction returns P
minus the U step (at least 1). So the two steps give exactly P, but a pair of two 1-clock
instructions gives 2 clocks (a step never returns 0; `pipeStats.floor` counts these extra
clocks). Examples: (3, 1) = 2 + 1; (1, 3) = 1 + 2; (2, 2) = 1 + 1; (1, 1) = 1 + 1. Each step is
one instruction, as on the other cores.

```js
cpu.pipeStats = { u, v,        // the instructions in the U pipe and in the V pipe (v = the pairs)
  floor,                       // the clocks that the 1-clock floor of a step adds (1 + 1 pairs)
  why: Uint32Array(18),        // the U instructions with no pair, by reason (the index of reasons)
  reasons: [...] }             // the reason texts; reasons[0] = '' (a pair)
cpu.pairNext                   // true: the next step is the V instruction of a pair
cpu.isV                        // true: the last step was a V instruction
cpu.lastWhy                    // the reason index of the last U step (0 = a pair)
```

### The branch target buffer (BTB)

- 256 entries, 64 sets of 4 ways: set = bits 2-7 of the linear address of the branch, the tag is
  the whole address. Each entry has the target and a 2-bit counter (0-1: predict not taken, 2-3:
  predict taken). A new entry replaces the ways of a set in turn.
- The branches of the BTB: Jcc (short and near), JMP near / short and CALL near (direct).
  LOOP, JCXZ, RET and the indirect jumps have fixed clocks.
- The prediction for a branch that is not in the BTB is "not taken". When the branch jumps, it
  gets an entry (counter 3). A hit predicts "taken" when the counter is 2 or 3 (and the target
  must be the same). Each branch changes the counter (taken: +1, not taken: -1, from 0 to 3).
- A right prediction costs no extra clocks (a branch is 1 clock); a wrong one costs 3 clocks in
  the U pipe and 4 in the V pipe. TR12.NBP = 1: no BTB (a taken branch is a wrong prediction).

```js
cpu.btb = { sets: 64, ways: 4,
  tag: Int32Array(256),      // entry set * 4 + way: the linear address of the branch | 0, -1 = empty
  target: Uint32Array(256),  // the linear target
  counter: Uint8Array(256),  // the 2-bit counter
  next: Uint8Array(64),      // the way that the next new entry of the set takes
  stats: { lookups, hits, right, wrong, allocs, taken } }   // taken = taken branches or BTB hits
```

### Clocks (`clocks586`, the Intel Pentium manual, with cache hits)

MOV, ALU reg / imm, INC, DEC, PUSH, POP, LEA, NOP, Jcc, JMP, CALL near: 1; ALU reg, mem: 2; ALU
mem, reg or imm: 3 (CMP 2); XCHG acc, reg 2, XCHG r/m 3; MUL / IMUL 11 (10 for 32 bits); IMUL
r, r/m (, imm) 10; DIV 17 / 25 / 41, IDIV 22 / 30 / 46; shifts by 1 or imm 1 (3 with memory), by
CL 4; RET 2; LOOP 5 taken / 6 not; MOVSX / MOVZX 3; BSWAP 1; CMPXCHG 5 / 6; XADD 3 / 4;
CMPXCHG8B 10; CPUID 14; RDTSC 20; RDMSR 20; WRMSR 30; MOV CR0 22, CR3 21, CR4 14; INVD / WBINVD
15 (plus the write-back bursts); INVLPG 25; REP MOVS 13 + 1 for each element, REP STOS 9 + 1.
Each prefix byte (66h, 67h, a segment, LOCK, REP) adds 1 clock. Protected-mode far transfers,
gates and task switches keep the 80386 values. The FPU clocks are the P5 latencies (FADD / FMUL
3, FDIV 39, FLD 1, FST 2, FXCH 1, FSQRT 70 ...); the core does not overlap FPU instructions.

### FPU and the FDIV bug

The FPU8087 object (`bus.fpu`, '80387' mode) is on the chip, as on the 80486 (#MF with CR0.NE,
no coprocessor cycles). `cpu.fdivBug = true` gives the FDIV bug of the first P5 steps for FDIV,
FDIVR and FIDIV with normal operands: the core then divides the significands with a model of the
P5 divider (radix-4 SRT, digits -2..2, the partial remainder in carry-save form, a digit table of
the top 7 bits of the partial remainder and the top 5 bits of the divisor). Five cells of the
table are 0 in place of 2: the top cells of the columns 1.0001, 1.0100, 1.0111, 1.1010 and 1.1101
(where the line p = 8/3 D falls on a row boundary; all cells outside the region hold 0). The
model gives the known results: 4195835 / 3145727 = 1.333739068902037589, 5505001 / 294911 =
18.66600093, 4.999999 / 14.999999 = 0.33332922; other divisions stay correct. At the first FPU
instruction with `fdivBug = true` the FPU object gets its own `_arith` method (one time).

### Micro-events (the 486 kinds, with these changes)

```js
{ k:'decode', ... }   // text from Disasm86.decode(read, ip, { cpu: '586', bits })
{ k:'cache', t, cache: 'data' | 'code', phys, set, way, hit, fill, write, state, code?, nc?, wb?, wbLine? }
     // at most two for each instruction: the first data access and the first code miss.
     // state = the MESI state of the line after the access ('M' | 'E' | 'S' | 'I'; code lines
     // 'S'); way = -1 when the line is not in the cache; nc: a read that could not fill; wb: the
     // fill replaced an M line (wbLine = its address), and a write-back burst follows the fill.
     // code: true for a code miss (as on the 80486).
{ k:'bus', type:'memr' | 'memw', ..., width: 8, burst: true, line, beat: 0-3, hi, wb? }
{ k:'fetch', ..., width: 8, burst: true, line, beat, hi }
     // the transfers of a line fill (and wb: true for a write-back); data = bytes 0-3 of the 8
     // bytes, hi = bytes 4-7. An access that is not a burst has width 1-8 (the bytes of its
     // 8-byte group), and hi when width > 4 (uncached code).
{ k:'pipe', t: 0, stage: [prefetch, decode 1, decode 2, execute, write-back], pipe: 'U' | 'V',
  paired, partner, reason, clocks }
     // one for each instruction. stage: as on the 80486. paired: this instruction is one of a
     // pair; partner: the text of the other instruction of the pair ('' when no pair); reason:
     // why a U instruction has no partner ('' for a pair), for example 'V reads EAX, which U
     // writes', 'U has a prefix', 'U is not a simple instruction'; clocks: the clocks of this
     // instruction alone (before the clock rule of the pair).
{ k:'btb', t, lin, target, taken, hit, predicted, right, set, way, counter, pipe, penalty, alloc }
     // one for each branch of the BTB: lin = its linear address, target (0 when not taken),
     // predicted = the prediction (true = taken), right, set / way of the entry (-1: none),
     // counter after the update (-1: none), penalty = 0 | 3 | 4 clocks, alloc = a new entry
{ k:'page', ..., big?: true, code?: true }   // big: a 4 MB walk (tbl = -1, pte = 0);
                                             // code: a walk of the prefetcher
{ k:'tlb', ..., big?: true }                 // a hit in the 4 MB TLB
{ k:'reg', t, r: 'CR4', v }                  // when CR4 changes
{ k:'sys', t, op: 'CR4' | 'RDTSC' | 'RDMSR' | 'WRMSR' | 'INVD' | 'WBINVD' | 'INVLPG' | 'CPUID', text }
{ k:'alu', t, op: 'CMPXCHG8B', a, b, r, w: 32 }
```

With `cpu.trace = null` the core makes no event objects, arrays or strings; all its fields come
from the constructor and `reset()` (`node tools/latefields.mjs` checks the machines).

### Tests

- `node tests/cpu586.test.mjs`: CPUID and the feature bits, RDTSC (counts up, TSD), RDMSR / WRMSR
  (the TSC, TR12, the performance counters, #GP), CMPXCHG8B, CR4 (the bits, #GP, DE with DR4 /
  DR5 and the I/O breakpoints), the caches (fills, hits, MESI, the write-back at a replacement,
  the burst order and timing, the 64-bit bus, INVD / WBINVD, CD / NW, KEN#, cacheInvalidate, the
  code cache, self-modifying code), a table of 35 pairs (pair or not, the reason, the clocks),
  an IRQ between U and V, the BTB (a loop: the first branch misses, then hits; the last branch
  is a wrong prediction; U = 3 and V = 4 clocks; NBP), the FDIV bug, the P5 clocks, the same
  clocks with and without a trace.
- `node tests/pm586.test.mjs [--build]`: NASM programs in tests/asm586 (pm586.inc uses
  tests/asm486/pm486.inc): 4 MB pages (PSE = 0 and 1, A / D in the PDE, RSVD, WP, PCD / PWT
  with the MESI states S and E, INVLPG, code in a 4 MB page, U/S and R/W at CPL 3), the P5
  instructions at CPL 3 (TSD, RDMSR, WRMSR, MOV CR4, CPUID), and a loop with pairs timed with
  RDTSC: 9 clocks for each pass with two pipes, 11 with TR12.SE = 1.
- `node tests/cpu386.test.mjs --cpu 586 [--p5queue]`: the SingleStepTests 80386 suite on this
  core (the caches on). Result: 1,758,699 pass, 0 fail, as on the 80386 and 80486 cores. The
  run sets `cpu.queueSnoop = false`: in 4 tests a REP MOVS / STOS writes over the HLT after it,
  and the 386EX runs the old HLT from its queue (with --p5queue these 4 tests fail, as they
  would on a real P5).
- `node tests/asm.test.mjs`: the Pentium forms with NASM (cpu 586, bits 16 and 32), the round
  trip Disasm86 -> Asm86 -> NASM and the ndisasm agreement with cpu '586'.
- Speed in Node (tests/bench.mjs program, the core alone): about 10.5 M instructions / s (the
  80486 core about 16.5 M in the same run). The pairing check costs about 14 %
  (TR12.SE = 1: about 12 M / s).

### Assembler and disassembler

- `Asm86.assemble(src, { cpu: '586' })` (also `cpu 586`, `cpu 80586`, `cpu pentium` lines):
  rdtsc, rdmsr, wrmsr, rsm, cmpxchg8b m64 and the register cr4. At a lower level they give "is a
  Pentium instruction, not an 80486 instruction (use cpu 586)" ("'cr4' is a Pentium register").
- `Disasm86.decode(read, off, { cpu: '586' })` decodes them; mov tr3-tr7 shows as "db" (the P5
  has no test registers).

### Notes for Machine586 and the views

- `new CPU80586(m.bus)` with `bus.fpu` = an FPU8087 '80387'. Give `bus.cacheable(pa)` (KEN#, as
  on Machine486), `bus.peek8(a)` (the trace texts, `peekPhys`) and `bus.poke8(a, v)`: a write to
  memory with no bus cycle, no heat and no counters, for the stores that stay in the cache (E / M
  lines). It must do what `bus.write8` does to memory (the RAM, the A20 gate: with A20 off, the
  486 machine makes the line of the byte with bit 20 = 0 invalid; do the same in poke8). Without
  poke8 the core uses write8, and `m.stats` / `m.heat` then count these stores too.
- Call `cpu.cacheInvalidate(phys, len)` for each write that does not come from the CPU (as on
  Machine486: DMA, block move, loadProgram, the UI).
- `m.stats` and `m.heat` see only the bus cycles: cache hits and the stores in E / M lines make
  none. A line fill is 4 bus events of 8 bytes (`width: 8`).
- The BIOS: CPUID family 5 ("Intel Pentium @ 66 MHz"; EDX bit 0 FPU, bit 4 TSC ...), the
  cache on at POST (INVD, then CR0.CD = NW = 0, as the 486 BIOS), and the CPU speed can come
  from RDTSC over a PIT interval.
- A step is one instruction. The V instruction of a pair is its own step (with its own trace);
  between the U step and the V step the core takes no interrupt (`cpu.pairNext` is true then).
  A breakpoint on the V instruction still stops `m.run` before it.
- The clock rule of a pair puts at least 1 clock in each step, so code of 1-clock pairs runs at
  1 instruction for each clock (a real P5 does 2). `pipeStats.floor` gives the difference.
- Not in the core: VME / PVI, SMM, the local APIC, MMX (P55C), the cache bank conflicts of U and V,
  the AGI stall, the write buffers of the pipes, the snoop cycles (HITM#) and the return stack.

## Pentium model (fifth machine)

`CPU_MODEL === '80586'`: the page makes `new Machine586({ video })`, assembles the BIOS from
`biosSource('80586')` and the programs with `{ cpu: '586' }`. The list shows the Pentium samples,
then the 80486, 80386 and 80286 samples (they run on the Pentium too), then the others.

### Machine586 (src/core/machine586.js, extends Machine486)

The AT board of Machine486 (the same chips, I/O ports, memory map, 16 MB of RAM, CGA or VGA, the
uPD765, the 8237 DMA and the Sound Blaster) with an Intel Pentium P5 (`CPU80586`) at 66 MHz.
Machine586 extends Machine486 because the Pentium machine needs all of its parts: KEN#, the A20
work of the cache, memChanged, the cache switch, the FPU on the chip (FERR# and CR0.NE). Only
`bus.poke8`, the clock and the FDIV switch are new.

- `m.model = '80586'`, `m.clockHz = 66000000`. All device rates come from `m.clockHz`:
  `m.pit.ratio` = 1193182 / 66e6, the CGA and VGA timing, the RTC, the floppy and Sound Blaster
  times, port 61h bit 4 (each 528 clocks = 8 us), `m.isaIo` = 51. The P5 bus runs at the core
  clock; the machine keeps `bus.waitStates = 1`: one transfer takes 3 clocks, a line fill is a
  burst of 4 transfers of 8 bytes (3-2-2-2 = 9 clocks).
- `new Machine486(opts)` now also takes `model`, `clockHz` and `cpuClass` (Machine586 uses them).
- The FPU: as on the 80486 machine (`m.fpu` in the '80387' mode on the chip, no coprocessor port
  cycles, IRQ 13 only while CR0.NE = 0, port F0h clears the IRQ 13 latch).
- KEN# (`bus.cacheable`), `bus.peek8`, the A20 rules, `m.a20Cut()` and `m.memChanged(addr, len)`
  are the ones of Machine486. `memChanged` calls `cpu.cacheInvalidate`, which removes the old
  copies from both caches (the code lines and the data lines): `dmaWrite` (the floppy and the
  Sound Blaster DMA), `blockMove`, `setClockFromHost`, `loadProgram`, `startProgram`, the old
  disk service (OUT E0h), `m.pokeMem`.
- `bus.poke8(a, v)`: the core writes a store that stays in the data cache (an E or M line) to
  memory with it: no bus cycle, no heat, no counters. It does the memory work of `bus.write8`
  (RAM, extended RAM, the video memory) and the same A20 work: with A20 off, an address with bit
  20 = 1 writes the byte with bit 20 = 0 and makes the line of that byte invalid.
- `m.stats` and `m.heat` count only the bus cycles: cache hits and the stores in E / M lines make
  none (the line fills, the write-back bursts, the uncached reads and the other writes count).
- The setup switch: `m.cacheEnabled` (default true; `new Machine586({ cache: false })`), CMOS 2Dh
  bit 0, as on the 80486 machine. "Off" empties both caches at once and stops the fills; "on"
  works at the next reset.
- The FDIV switch: `m.fdivBug` (default false; `new Machine586({ fdivBug: true })`) sets
  `cpu.fdivBug`. A CPU reset keeps it. The constructor makes the field `m.fpu._arith` (the
  method of the FPU8087 prototype), so the FDIV hook of the core does not add a field later.
- After each CPU reset CR0.CD = NW = 1 and both caches are empty (the core does it); the BIOS
  turns the caches on again (the POST and the resume path of CMOS shutdown codes 05h and 0Ah).

### The Pentium BIOS (`biosSource('80586')`, function `bios586` in bios.js)

The 80486 BIOS with exact block replacements:
- The CPU test: CPUID family 5 gives the name "Pentium". BDA 0040:00EE (`CPU_KIND`) = 5 (CPUID),
  as on the 80486 BIOS.
- The caches: `cache_init` of the 80486 BIOS (INVD, then CR0.CD = 0 and NW = 0, unless CMOS 2Dh
  bit 0 = 1; the resume path of a CPU reset does it again). The P5 caches are then write-back.
- The start-up screen (the vendor, the family, the model, the stepping and the features come
  from CPUID; family 5 and up also shows EDX of leaf 1):
  ```
  CPU   Intel Pentium @ 66 MHz, 8 KB code + 8 KB data cache, FPU on chip
        CPUID GenuineIntel, family 5, model 1, stepping 7, features 000001BDh
  RAM   640 KB + 15360 KB extended   CMOS clock   CGA
  FPU   on the Pentium chip
  Cache: 8 KB code + 8 KB data on chip, on
  ```
- The INT 6 message names the Pentium ("a Pentium Pro or later"). Everything else is as the
  80486 BIOS.

### Pentium samples (SAMPLES with `model: '80586'`)

- `p5pairs`: 1000 passes of two loops, timed with RDTSC (CLI, one run first to fill the caches).
  Loop 1: 8 `add reg, [mem]` with different registers (4 pairs) and DEC CX / JNZ (a pair). Loop 2:
  the same 8 ADD, all to AX (no pairs; the last ADD pairs with DEC CX, JNZ runs alone). Typical:
  10.0 and 17.0 clocks for each pass, ratio 1.7. (`add reg, [mem]` takes 2 clocks: a pair of two
  1-clock instructions would show no gain, because of the clock rule of a pair.)
- `rdtsc`: RDTSC over 59659 counts of the 8254 channel 2 (mode 2, counter latch; 50 ms), then
  MHz = clocks * 1193182 / (counts * 1000000). Typical: 3299997 clocks, 66.00 MHz.
- `btb`: a loop of 1000 passes with `test dx, dx` / `jz` to the next instruction (so only the
  prediction changes the time), in three patterns: always taken, never taken, taken in turn.
  RDTSC times each second run; the performance counter CTR0 (CESR = 0D5h: event 15h, wrong
  predictions) counts the wrong guesses. Typical: 5.0 / 5.0 / 6.5 clocks for each pass, 2 / 1 /
  501 wrong guesses, "One wrong guess costs about 3.0 clocks" (a JZ in the V pipe costs 4 clocks,
  but the clock rule of the pair hides 1 of them).
- `fdiv`: FDIV of 4195835.0 / 3145727.0 (qwords), then r = x - (x / y) * y (FISTP) and x / y with
  18 digits (FBSTP). The default machine: "1.33382044913624100", r = 0, "Result: FDIV is correct.".
  With `m.fdivBug = true`: "1.33373906890203759", r = 256, "Result: this Pentium has the FDIV bug.".
- `4mbpage`: CPUID EDX bit 3 (PSE), a page directory at 20000h with two 4 MB entries (PDE 0 and
  PDE 1 = 00000083h: P, R/W, PS; both map physical 0) and no page table, CR4.PSE = 1, CR3, CR0.PG +
  PE, a line of text through linear 004B8000h (the screen at B8000h), PDE 1 before and after (the
  CPU sets A and D: 000000E3h), then back to real mode with CR4.PSE = 0.

### Tests

- `node tests/machine.test.mjs --model 80586 [--video vga]`: all samples of the Pentium, 80486,
  80386 and 80286 and the others; the checks of the numbers (p5pairs ratio 1.4 or more, rdtsc
  within 0.2 MHz of `m.clockHz`, btb: 450-550 wrong guesses in turn and a cost of 3 to 4.5
  clocks, fdiv also with `fdivBug: true`; the cache sample of the 80486 with the P5 limits: the
  burst fill is fast and the prefixes of its loop cost clocks), the memory map checks of the
  80386, and the Pentium checks: the start-up screen, the setup switch, the resume after a CPU
  reset (port 92h, shutdown code 0Ah), KEN#, no stats and no heat for a cache hit, `poke8` (E -> M,
  no bus cycle, memory has the byte), the invalidation by DMA, pokeMem, memChanged, loadProgram and
  setClockFromHost in the data cache and in the code cache (a loop at 7C00h), the A20 cases (also
  poke8), IRQ 13 with NE = 0 only, the FDIV switch.
- `node tests/dos.test.mjs --model 80586 [--video vga]`, `node tests/dos6.test.mjs --model 80586
  [--video vga]`, `node tests/vga.test.mjs --model 80586` (Wolfenstein 3D with the Sound Blaster;
  the video BIOS parts run on all five machines), `node tests/story.test.mjs --model 80586`.
- `node tests/fdc.test.mjs` and `node tests/sb.test.mjs` include the Pentium (fdc: the CPU reads a
  DMA buffer through its data cache after READ DATA). `node tools/latefields.mjs` checks
  Machine586.
- The BIOS wait loops: the fall-back counts of `fd_wait` and `fd_ready` (for a stopped timer)
  count passes of a loop. At 66 MHz the old counts end after about 0.2-0.5 s, before the motor
  gets to full speed (0.5 s) with the real disk timing. `bios586` gives them more passes (200 x
  65536 and 8 x 65536); the timer ticks (2 s and 1.5 s) stop the waits first.
- Speed in Node (September 2026, other work on the same host): `node tools/machbench.mjs 2 80586`
  5.5-5.9 M instructions / s, 0.15 x real time (1.72 clocks / instruction); the 80486 in the same
  runs 7.0-10.7 M / s, 0.6-0.9 x real time. `node tools/wolfspeed.mjs --model 80586 --secs 4`: the
  sign-on wait loop of Wolf3D runs 55.75 M instructions in each emulated second (1.18 clocks /
  instruction) in 9.4-15.8 s real (the 80486: 14.03 M instructions in 1.9-5.4 s). The whole
  `vga.test.mjs --model 80586`: DOS 6.22 to A:\> 5.3 emulated s in 35 s real, Wolf3D to the menu 58
  emulated s in 586 s real. `machine.test.mjs --model 80586`: about 90 s.
- Why the Pentium is slower for each emulated second: at 66 MHz and 1.2-1.7 clocks for each
  instruction it runs about 4 times the instructions of the 80486 at 33 MHz, and each instruction
  costs more in the core. A profile (`machbench.mjs --prof`, `wolfspeed.mjs --steady`) shows the
  P5 parts: `pairCheck` + `pairScan` about 10 %, `clocks486` about 3.5 % (CPU80486.exec calculates
  the 486 clocks, then `clocks586` replaces them), `clocks586` about 3.5 %, `branch` (the BTB)
  about 3 %, `finish` about 8 % and `prefetch` about 10 % (the 80486: 6 % and 10 %).

## Pentium views (src/ui)

`CPU_MODEL === '80586'` (storage 'cpu'): theme.js adds THEME_586 (warm charcoal and gold) and
the classes m286 + m386 + m586 (not m486). app.js: `is586` (only the Pentium; `is386` and
`is286` are also true on it, `is486` is false), `cpuAsm` = '586'. board3d.js: `M586`, and
`FPU_ON` (486 or Pentium: no coprocessor chip, the FPU work goes to the CPU die); CHIPS_586
(the P5 in a 273-pin PGA), INFO_586, the die plan '80586' (CODE CACHE 8 KB, CODE TLB, BRANCH
TARGET BUFFER, BUS INTERFACE, PREFETCH BUFFERS, INSTRUCTION DECODE, CONTROL ROM, DATA CACHE 8
KB, DATA TLB, PAGE UNIT, U PIPE, V PIPE, REGISTERS, SEGMENT UNIT, ALU, BARREL SHIFTER, FPU
REGISTERS, FPU ADDER, FPU MULTIPLIER), BLK_586 (the older unit names in that plan),
`P5_CARDS(e)` (the cards of a 'pipe' or 'btb' event) and `CACHE_CARD_P5` (the cache that the
event names, 32-byte lines, 4 × 8-byte bursts, the write-back). story.js: a wrong branch
prediction is a step (kind 'btb'); a right prediction and the pipe of each instruction (the
partner, or the reason for no pair) are lines of the CPU step; cache steps name the code or
the data cache and the MESI state. topview.js plays the same cards.

`CPU_MODEL === '80586'` with the Pentium core (`cpu.dcache`, `cpu.icache`, `cpu.btb`): the
views use their Pentium parts. With another core (a Machine486 on this page) they use the
80486 parts. die.js: `Die586View extends Die486View`. The floor plan follows the P5 die. It
shows the code cache and the data cache (128 sets × 2 ways, MESI colours for the data lines,
tag compare, the line fill of 4 × 8 bytes in burst order, the write-back of an M line), the
code TLB, the data TLBs (4 KB and 4 MB), the page unit (4 MB walks), the BTB (64 × 4
counters, the last lookup, the prediction and the penalty), the bus interface (A31–A3,
BE7#–BE0#, 8 byte lanes, ADS# NA# BRDY# CACHE# KEN#), the prefetch buffers, the decoder (the
pair check and its rules), the U pipe and the V pipe side by side (PF D1 D2 EX WB; the partner
of a pair moves into V; the reason for no pair), the control ROM (CR0, CR4, TSC, TR12), the
registers, the segment unit, ALU U and ALU V, the barrel shifter, and the FPU with X1 X2 WF
ER. D586_ARR has two plans: 'L' and 'P' (for a tall view). The grids are one SVG path for
each class (`mkGrid` / `paintGrid`). In fast mode the die draws at most 10 frames a second
(D586_FAST_MS). dock.js: the "Pentium system" card has the panes CR (CR0, CR4, TSC), SEG, TLB
(three TLBs), CACHE (both caches, MESI counts, line maps), BTB and PIPES (pair rate and the
most frequent reasons, from `pipeStats`); on the Pentium, `physOf` uses `cpu.peekPhys`.
timing.js: `m586`, TV_GROUPS_586 / TV_INFO_586 (the P5 bus signals, bursts and write-back
bursts of 4 × 8 bytes, the cache, pipes and BTB rows). memmap.js: `m586`, two cache bars on
each hex row (code, and data in MESI colours), the ranges with no KEN#, a cache card for both
caches, and 4 MB pages in the Pages tab. style.css: the `:root.m586` rules at the end of the
file. Tools: `tools/p5build.mjs`, `tools/p5shot.mjs`, `tools/tv586shot.mjs`,
`tools/mv586shot.mjs`.

## Pentium Pro core (CPU80686)

`src/core/cpu80686.js`, `class CPU80686 extends CPU80586`: an Intel Pentium Pro (P6: family 6, model 1,
stepping 9, 200 MHz, 256 KB L2 in the package). It keeps the `step()` / `finish()` / micro-event
contract of the other cores. The build puts the file after `src/core/cpu80586.js`; `tools/vgapng.mjs`
loads it too. The machine (Machine686, the BIOS) and the views are not in this part. The core only
counts the clocks; the machine gives the clock rate and the bus clock ratio (`bus.busRatio`).

The class extends CPU80586 because the P6 keeps the Pentium system features: CPUID, RDTSC, the MSR
frame, CMPXCHG8B, CR4, 4 MB pages with the three TLBs, the 8 KB 2-way data cache with the MESI states,
the 64-bit bus events, the snoop of the prefetch queue, the FPU on the chip. The P5 parts that the P6
does not have (the U and V pipes, the P5 BTB, the P5 clocks) never run: CPU80686 replaces `step()`,
`exec()`, `stringOp()` and `finish()`, so `pairCheck()`, `branch()`, `clocks486()` and `clocks586()`
are not called and no clock is computed twice. `exec(op)` calls the 80386 opcode table directly.

The architectural result is always the result of the in-order interpreter of the base classes: the
instruction runs first, then the out-of-order model computes its µops and their times. The model
only gives the clocks and the trace events.

### Registers API (the Pentium API, with these changes)

```js
cpu.regs32[2]    // EDX after reset = CPU80686.SIGNATURE = 0619h (family 6, model 1, stepping 9)
cpu.cr[0]        // as on the P5: 60000010h after reset (CD = 1, NW = 1, ET = 1)
cpu.cr[4]        // CR4: TSD (bit 2), DE (3), PSE (4), MCE (6), PGE (7), PCE (8); 0 after reset
cpu.queueSnoop   // true (the default, as the P5)
cpu.fdivBug      // false: the P6 has no FDIV bug (the P5 switch has no effect)
cpu.busRatio     // the core clocks of one FSB clock: bus.busRatio at the start of each step (3 when
                 // the bus has none). Fractions (2.5) are permitted; the FSB times are rounded up.
cpu.tr12         // 0: the P6 has no TR12 (the P5 MSR 0Eh gives #GP)
```

### Instructions

- CMOVcc r16 / r32, r/m16 / r/m32 (0F 40-4F, the 16 conditions of Jcc). The P6 reads the source
  operand also when the condition is false: a memory operand can fault (#GP, #SS, #PF) and makes a
  load. A false condition does not change the destination (also with a 32-bit operand size). LOCK:
  #UD.
- FCMOVcc ST0, ST(i): DA C0-DF (B: CF = 1, E: ZF = 1, BE: CF or ZF, U: PF = 1) and DB C0-DF (NB,
  NE, NBE, NU). An empty ST0 or ST(i): stack underflow (IE and SF in the status word); with IE
  masked ST0 gets the indefinite NaN. C1 = 0.
- FCOMI / FUCOMI ST0, ST(i) (DB F0-F7 / DB E8-EF) and FCOMIP / FUCOMIP (DF F0-F7 / DF E8-EF, then a
  pop): ZF, PF, CF = 000 (greater), 001 (less), 100 (equal), 111 (unordered); OF, SF and AF are 0. FCOMI
  gives IE for any NaN, FUCOMI only for a signaling NaN (significand bit 62 = 0). An empty register:
  stack underflow. An unmasked IE (or DE) writes no flags and does not pop. C1 = 0; C0, C2 and C3 do
  not change. The compare is affine (the P6 FPU has no projective mode).
- RDPMC (0F 33): EDX:EAX = the performance counter ECX (0 or 1, 40 bits). #GP(0) for another ECX, and
  at CPL > 0 (protected mode and virtual-8086 mode) when CR4.PCE = 0.
- UD2 (0F 0B): #UD (the defined invalid opcode).
- CPUID: leaf 0: EAX = 2 (the highest leaf), "GenuineIntel"; leaf 1: EAX = 0619h, EBX = ECX = 0, EDX =
  `CPU80686.FEATURES` | FPU = E1BDh: FPU (0), DE (2), PSE (3), TSC (4), MSR (5), MCE (7), CX8 (8), PGE (13),
  MCA (14), CMOV (15). Not set: VME, PAE, APIC, SEP (a real Pentium Pro reports SEP, but SYSENTER does not
  work on it), MTRR. E1BCh with no FPU. Leaf 2: EAX = 03020101h, EBX = ECX = 0, EDX = 06040A42h (the cache
  and TLB descriptors of a Pentium Pro with 256 KB L2). Higher leaves: 0.
- MOV CR4 (CPL 0): TSD, DE, PSE, MCE, PGE and PCE can change; VME, PVI, PAE and the reserved bits give
  #GP(0). A change of PSE or PGE removes all TLB entries (also the global ones).
- RDMSR / WRMSR (CPL 0), the P6 numbers:
  - 00h, 01h P5_MC_ADDR / P5_MC_TYPE: read 0 (the P6 keeps them); a write does nothing.
  - 10h TSC: WRMSR writes the low 32 bits and clears the high 32 bits (as on the P6).
  - 79h BIOS_UPDT_TRIG: write only; no microcode update occurs. 8Bh BIOS_SIGN_ID: EDX = the microcode
    revision (0).
  - C1h / C2h PerfCtr0 / 1 (40 bits; WRMSR: bits 32-39 = bit 31 of EAX). 186h / 187h PerfEvtSel0 / 1:
    bits 0-7 the event, 16 USR, 17 OS, 22 EN (PerfEvtSel0 only: it starts both counters; bit 21 is
    reserved). A counter counts the change of its event while EN = 1 and USR or OS = 1 (the core does
    not look at the CPL, the edge bit, the invert bit or the counter mask). The events: 03h LD_BLOCKS,
    12h MUL, 13h DIV, 24h L2_LINES_IN, 26h L2_LINES_OUT, 2Eh L2_RQSTS, 43h DATA_MEM_REFS, 45h
    DCU_LINES_IN, 47h DCU_M_LINES_OUT, 79h CPU_CLK_UNHALTED (the clocks of the steps, not the halted
    steps), 80h IFU_IFETCH, 81h IFU_IFETCH_MISS, 85h ITLB_MISS, A2h RESOURCE_STALLS (ROB, RS, store
    buffer), C0h INST_RETIRED, C1h FLOPS, C2h UOPS_RETIRED, C4h BR_INST_RETIRED, C5h BR_MISS_PRED_RETIRED,
    C9h BR_TAKEN_RETIRED, D0h INST_DECODED, D2h PARTIAL_RAT_STALLS, E2h BTB_MISSES, E6h BACLEARS. Other
    events count nothing. The counter includes the WRMSR that starts it (its µops retire after it).
  - 179h MCG_CAP = 105h (5 banks, MCG_CTL present), 17Ah MCG_STATUS (0), 17Bh MCG_CTL, 400h-413h the
    banks MC0-MC4: CTL (read / write), STATUS and ADDR (read 0; a write of a value that is not 0 gives
    #GP), MISC (#GP, as on the P6). No machine check occurs.
  - Another number gives #GP(0): the P5 MSRs (0Eh TR12, 11h CESR, 12h / 13h CTR0 / 1), APIC_BASE (1Bh),
    the MTRRs, DEBUGCTL and the LBRs.
- The P5 instructions (RDTSC, CMPXCHG8B, MOV TRn = #UD, RSM = #UD) and CR4.TSD / DE work as on the P5.

### Paging: global pages

CR4.PGE = 1: the G bit (bit 8) of a PTE, or of a PDE of a 4 MB page, makes a global page. The TLB entry
of a global page has flags bit 8 (0x100). MOV CR3 (and a task switch with a new CR3) removes only the
entries that are not global (`flushTLB()`); INVLPG removes a global entry too; a change of CR4.PGE,
CR4.PSE or CR0.PG removes all entries (`flushTLBAll()`). With PGE = 0 the G bit has no effect. The TLBs
are those of the P5 (`cpu.tlb` 64, `cpu.tlb4m` 8, `cpu.itlb` 32 entries). A 'page' trace event has
`global: true` when the walk found G = 1.

### The caches (public fields for the views; the core writes them, the views only read)

```js
cpu.dcache = { sets: 128, ways: 2, lineSize: 32,   // L1 data, 8 KB: the P5 layout
  tag: Int32Array(256),    // line i = set * 2 + way: physical address bits 12-31, -1 = invalid
  state: Uint8Array(256),  // MESI: 0 I, 1 S, 2 E, 3 M
  lru: Uint8Array(128),    // the way that the next fill of the set replaces
  data: Uint8Array(8192),  // line i at data[i * 32]
  stats: { hits, misses, fills, uncached, writeHits, writeMisses, writeHitsME, writeBacks, rfo, flushes, invalidations } }
cpu.icache = { sets: 64, ways: 4, lineSize: 32,    // L1 code, 8 KB
  tag: Int32Array(256),    // line i = set * 4 + way: physical address bits 11-31, -1 = invalid
  lru: Uint8Array(64),     // the pseudo-LRU bits of the 80486 tree (B0, B1, B2)
  data: Uint8Array(8192), stats: { hits, misses, fills, uncached, flushes, invalidations } }
cpu.l2 = { sets: 2048, ways: 4, lineSize: 32,      // L2, 256 KB, on the back-side bus
  tag: Int32Array(8192),   // line i = set * 4 + way: physical address bits 16-31, -1 = invalid
  state: Uint8Array(8192), // MESI
  lru: Uint8Array(2048),   // pseudo-LRU bits
  stats: { requests, hits, misses, codeRequests, codeMisses, fills, writeBacks, flushes, invalidations } }
cpu.dFind(pa), cpu.iFind(pa), cpu.l2Find(pa)   // the line index of a physical address, -1 = none
cpu.lineAddr(tag, i), cpu.iLineAddr(tag, i), cpu.l2LineAddr(tag, i)   // the physical address of a line
cpu.cacheInvalidate(phys, len)   // the three caches; returns the number of lines (L1 and L2); ignored with CR0.NW = 1
cpu.cacheFlush()                 // the three caches are empty (INVD, WBINVD, reset)
```

- The L1 data cache works as on the P5 (set = bits 5-11, E after a fill, S with PWT = 1, the MESI rules
  of a write hit, CD / NW, PCD, KEN# from `bus.cacheable`), and it is write-allocate: a write miss to
  a write-back page (PWT = 0, PCD = 0, CD = 0, KEN#) fills the line first (an RFO: `stats.rfo`), then the
  line is M. A write miss to a PWT or PCD page goes to the bus with no fill.
- An M line that an L1 fill replaces goes into the L2 (the L2 line becomes M; no FSB cycle).
- The L2 keeps tags and MESI states only (memory has the newest bytes: the emulator writes each store
  to memory at once). An L1 miss looks in the L2: a hit costs 4 clocks more than an L1 hit and makes no
  bus cycle (the core reads the line from memory with `bus.peek8`: no heat, no counters). A miss fills
  the L2 line (E, or S with PWT = 1) with a burst of 4 transfers of 8 bytes on the front-side bus (the
  8 bytes that the CPU needs first, `bus.read8`); an M line that the L2 fill replaces goes to the FSB
  first in a write-back burst (`wb: true`). Code misses use the same L2.
- The FSB runs at the core clock / `bus.busRatio`. A transfer takes 2 + `bus.waitStates` bus clocks (the
  first of a burst) or 1 + wait states (the others), and each transaction has 2 bus clocks of request
  and snoop phases. So with a ratio of 3 and 1 wait state: an L2 miss load takes 3 + 4 + 6 + 9 = 22
  clocks to the first 8 bytes, and the FSB is busy for 6 + 9 + 3 x 6 = 33 clocks. The FSB does one
  transaction at a time: a load (or a code fetch, or a store commit) waits while it is busy. An access
  that is not cacheable is one FSB transfer for each 8-byte group.
- WBINVD: the M lines of the L1 go to the L2, then all M lines of the L2 go to the FSB (write-back
  bursts); the instruction waits for them. INVD drops the lines. `cacheInvalidate` removes the lines of
  the range from the L1 data, the L1 code and the L2 (a DMA write needs it for the stale copies in the
  two L1 caches, which hold bytes; the L2 holds tags only).
- A write to a line of the L1 code cache makes that line invalid, and a write to the bytes in the
  prefetch queue empties the queue (the P5 rules).

### The out-of-order model

Each step is one x86 instruction (or one REP iteration, an exception, an IRQ / NMI, or a halted clock
group). After the instruction runs, `ooo(mode)` makes its µops from a recipe and from the accesses that
the instruction really made, and gives each µop the clocks of issue, dispatch, done and retire:

- The µops: a load (port 2) for each read of an operand (`rd()`), one ESP µop of a stack instruction
  (PUSH, POP, CALL, RET ...), the compute µops of the recipe (a chain; the last one has the latency and
  the port of the recipe, the others are 1-clock ALU µops), and an STA (port 3) + STD (port 4) pair for
  each write (`wr()`). A memory operand of an instruction adds loads and stores; a register form has
  none. Examples (µops): MOV r, r 1; MOV r, m 1; MOV m, r 2; ADD r, r 1; ADD r, m 2; ADD m, r 4; ADC / SBB
  2; PUSH r 3; POP r 2; CALL 4; RET 3; Jcc 1; LEA 1; MUL r 3; DIV r 4; IMUL r, r/m 1; CMOVcc 2 (3 with
  memory); XCHG r, r 3; MOVZX 1; CLD 4; LOOP 6; CPUID 36; RDTSC 15; RDMSR / RDPMC 20; WRMSR 24. The
  complex instructions (far transfers, gates, task switches, INT, IRET, segment loads in protected mode)
  get more MSROM µops when the 80386 clock count of the base class is larger (1 µop for 4 clocks,
  at most 64 µops in a step).
- Decode (the front end): D0 takes an instruction of up to 4 µops, D1 and D2 take 1-µop instructions
  (the 4-1-1 rule): up to 3 instructions and 16 bytes in a clock. An instruction of more than 4 µops
  (or a REP string, an exception, an interrupt) goes through the MSROM: 4 µops each clock, and the next
  instruction starts a new decode group. A code-cache miss delays the decode by its latency (the FSB
  too). The decoders stop when they are more than 3 clocks ahead of the RAT.
- Issue (the RAT and the ROB allocation): 2 clocks after the decode, 3 µops each clock in program order,
  when the ROB (40 entries, a ring) and the RS (20 entries; an entry becomes free when its µop
  dispatches) have a free entry, and for an STA when the store buffer (12) has a free entry. The RAT
  maps EAX-EDI, EFLAGS, the FPU status word and the 8 FPU registers to the ROB entry of their newest
  producer (the entry number is the physical register).
- Dispatch: the first clock after the issue at which all sources are ready and the port is free. Older
  µops that wait do not stop a younger µop (each port has a calendar of the clocks it is busy). Port 0:
  ALU, shift, LEA, multiply, divide, FPU; port 1: ALU, branch; port 2: load; port 3: store address;
  port 4: store data. A port takes one µop each clock; an ALU µop takes the port that is free (in turn
  when both are). The divider (DIV, IDIV, FDIV, FSQRT) takes one µop at a time; FMUL one each 2 clocks.
- Latencies: ALU, shift, branch, STA, STD 1; load 3 (L1 hit), 7 (L2 hit), more for an L2 miss; ADC,
  CMOV, BSWAP, FCMOV 2; MUL / IMUL 4; DIV / IDIV 19 / 23 / 39 (8 / 16 / 32 bits); FADD 3; FMUL 5; FDIV 17 /
  32 / 37 and FSQRT 29 / 58 / 69 (the precision control: 24 / 53 / 64 bits); FCOM, FCOMI 1; FXCH 0 (the RAT
  exchanges the two registers; no port); the transcendental FPU instructions are MSROM flows.
- Retire: in program order, 3 µops each clock, 1 clock after done at the earliest.
- Loads and stores: a load waits for the addresses (STA) of all older stores (the P6 does not guess). A
  load of bytes that an older store has (the store is in the store buffer) gets them from the STD
  (`wait: 'store data'`); a load of more bytes than the store has waits until the store is in the cache
  (`'store buffer'`, LD_BLOCKS). A store goes into the cache after its retire, in order, one each clock
  (plus the RFO of a miss).
- A read of a register (or an address register) with more bytes than its last write (AL, then AX or
  EAX; SP, then ESP) waits until that write retires: the partial register stall (`oooStats.partial`).
  The Pentium Pro has no zeroing idiom: XOR EAX, EAX reads EAX.
- Serializing (all older µops retire first, then the fetch starts again after the instruction): CPUID,
  WRMSR, MOV CRn / DRn (writes), INVD, WBINVD, INVLPG, LGDT, LIDT, LLDT, LTR, LMSW, CLTS, IRET, HLT, IN,
  OUT, INS, OUTS, a LOCK prefix, XCHG with memory, and each exception and interrupt. These steps also
  start at the reported clock (`cpu.cycles`), not before it. A far JMP / CALL / RET and INT n flush the
  front end: the fetch starts again 8 clocks after the last µop is done. After an exception or an
  interrupt the fetch starts at the retire clock of the step.

### Branch prediction

```js
cpu.btb = { sets: 128, ways: 4,
  tag: Int32Array(512),      // entry set * 4 + way: the linear address of the branch | 0, -1 = empty;
                             // set = linear address bits 0-6
  target: Uint32Array(512),  // the linear target
  hist: Uint8Array(512),     // the last 4 outcomes of the branch (bit 0 = the newest; 1 = taken)
  pht: Uint8Array(8192),     // pht[entry * 16 + hist] = a 2-bit counter (0-1 not taken, 2-3 taken)
  counter: Uint8Array(512),  // the counter that the next prediction of the entry uses (for the views)
  next: Uint8Array(128),     // the way that the next new entry of the set takes (in turn)
  rsb: Uint32Array(16), rsbTop,   // the return stack buffer (the return addresses; the next slot)
  stats: { branches, lookups, hits, misses, right, wrong, allocs, taken, staticRight, staticWrong, rsbRight, rsbWrong } }
```

- Jcc, JMP and CALL (direct and indirect), LOOP, LOOPcc and JCXZ use the BTB; RET uses the return stack
  buffer (a CALL puts its return address in it). A conditional branch in the BTB is predicted by the
  2-bit counter that its 4-bit history selects (the two-level prediction: it learns a pattern such as
  taken, taken, not taken). A taken branch that is not in the BTB gets an entry (history 1, all 16
  counters 2).
- A branch that is not in the BTB: the decoder predicts (static): a backward conditional branch taken,
  a forward one not taken, a direct JMP / CALL taken; an indirect branch is not predicted.
- The cost: a right prediction of the BTB (taken) ends the decode group (the next instruction decodes
  in the next clock); a right taken prediction of the decoder costs 5 clocks (the decoder sends the
  fetch to the target); a wrong prediction: the fetch starts again 8 clocks after the branch µop is
  done. The 'btb' event gives the penalty (the clocks from the decode of the branch to the new fetch:
  about 10-17, more when the branch waits for its flags).

### The clock rule of step()

The model gives M(n) = the retire clock of the last µop of step n (the model clocks start at 0 after
reset). The step returns T = M(n) - S(n-1), where S(n-1) = `cpu.cycles` at the start of the step (the sum
of all earlier steps), but at least 1 clock. So the sum of the steps is S(n) = max(S(n-1) + 1, M(n)):
it follows the model, and it is ahead of the model only when the model retires more than one
instruction in a clock (the P6 retires up to 3 µops each clock). `oooStats.floor` counts the steps that
the floor of 1 clock made longer. The model does not lose these clocks: a later slow instruction (a
divide, a cache miss, a wrong prediction, a serializing instruction) takes them back, because M(n) -
S(n-1) is then smaller (the 'rob' event gives the difference: `debt` = S(n) - M(n)). Serializing
instructions, exceptions and interrupts start at the reported clock; a halted step takes 2 clocks and
the model follows (`oooSync`). Clocks that the machine adds to `cpu.cycles` between the steps (the
wait-loop skip, the DMA cycles, the ISA I/O time) move the model by the same amount at the start of the
next step, so they do not become a debt. So code that retires more than one instruction in a clock shows 1 clock
for each instruction (a real P6 is faster there), and slower code shows the clocks of the model.
RDTSC and CPU_CLK_UNHALTED count the clocks of the steps.

### Public fields of the model (typed arrays and small objects made in the constructor)

```js
cpu.rob = { size: 40, head,               // head = the entry that the next µop takes (= cpu.robPos)
  uop: Float64Array(40),     // the µop id (a counter from reset), -1 = never used
  instr: Float64Array(40),   // the step number of the µop (the 'n' of the events)
  kind: Uint8Array(40),      // the index in kinds: 'alu' 'shift' 'lea' 'mul' 'div' 'branch' 'load' 'sta'
                             // 'std' 'esp' 'fadd' 'fmul' 'fdiv' 'fmov' 'fxch' 'fcmp' 'cmov' 'msrom' 'nop'
  port: Int8Array(40),       // 0-4, -1 = no port (FXCH)
  src1, src2: Int8Array(40), // the ROB entries of the sources (-1 = the RRF or none)
  dst: Int8Array(40),        // the index in regs of the register that it writes (-1 = none)
  issue, dispatch, done, retire: Float64Array(40),   // the model clocks
  kinds, regs }              // the names
  // the state of an entry at model clock t: empty (t < issue or t >= retire), waiting in the RS
  // (issue <= t < dispatch), executing (dispatch <= t < done), done (done <= t < retire)
cpu.rs = { size: 20, uop, rob: Int8Array(20), issue, dispatch }   // an entry holds a µop from its issue to its dispatch
cpu.rat = { rob: Int8Array(18),       // the ROB entry of the newest producer (-1 = the RRF)
  ready: Float64Array(18),            // the clock at which the value is ready
  retire: Float64Array(18),           // the retire clock of the producer (after it: the RRF)
  width: Uint8Array(18),              // the bytes of the last write (1, 2, 4)
  names }                             // EAX ECX EDX EBX ESP EBP ESI EDI EFLAGS FSW R0-R7 (physical FPU registers)
cpu.ports = { busy: Float64Array(5 * 512),   // busy[p * 512 + (t & 511)] = t: port p takes a µop at clock t
  uops: Float64Array(5), names }             // the µops of each port
cpu.sb = { size: 12, addr: Uint32Array(12), bytes, std, commit, rob }   // the store buffer (linear address,
                             // size, the clock of the data, the clock at which the store is in the cache, the STD entry)
cpu.oS                       // Float64Array: the scalar clocks of the model (decode, issue, retire, the
                             // divider, the FSB ...; see the O_* names in the file)
cpu.oooStats = { steps, instructions, uops, floor, robFull, rsFull, sbFull, partial, forwards,
  ldBlocks, splitLoads, serial, mispredicts, baclears, mul, div, flops, haltClk,
  decoders: Float64Array(4) }   // the instructions of D0, D1, D2 and the MSROM
cpu.pipeStats, cpu.pairNext (false), cpu.isV (false)   // the P5 fields stay (no pairs)
```

`reset()` clears all of them. `robFull`, `rsFull` and `sbFull` count the times that the RAT waited for
a free entry.

### Micro-events (the Pentium kinds, with these changes)

With `cpu.trace` set, each step also gives the events below. The model clocks are absolute (from
reset); the 'rob' event gives `base` = the model clock of t = 0 of the step (base = retire - T).

```js
{ k:'decode', ..., uops, decoder: 'D0' | 'D1' | 'D2' | 'MS', dclk }
     // the 386 fields (text from Disasm86.decode(..., { cpu: '686', bits })), the µops of the step, the
     // decoder and the model clock of the decode. A halted step: uops 0, decoder '', dclk -1.
{ k:'uop', t: 0, id, n, text, kind, port, rob, rs, src, srcRegs, dst, issue, dispatch, done, retire, lat, wait, passed }
     // one for each µop: id = the µop number, n = the step number, text = the x86 instruction, kind (the
     // names of cpu.rob.kinds), port (0-4, -1 none), rob / rs = its entries, src = the ROB entries of its
     // sources, srcRegs = their names ('EAX' ... or 'load', 'µop', 'data', 'store': a µop of the same
     // instruction or the store that forwards the data), dst = the register that it writes (''),
     // the model clocks, lat = the latency (with the wait for the FSB), wait = why the dispatch was
     // later than the clock after the issue ('' | 'operand' | 'store data' | 'store buffer' | 'divider' |
     // 'fmul' | 'port'), passed = the older µops that were not yet dispatched when this µop dispatched.
{ k:'rat', t: 0, n, reads: [{ r, rob, ready }], writes: [{ r, rob }] }
     // the RAT for the instruction: the registers that it reads (rob = the ROB entry of the producer,
     // -1 = the RRF) and the new mappings of the registers that it writes
{ k:'rob', t: T - 1, n, uops, first, retire, prev, base, rob, rs, floor, debt }
     // the retire of the step: first = the ROB entry of its first µop, retire = M(n), prev = M(n-1),
     // rob / rs = the entries in use at the issue of the first µop, floor = 1 when the floor of 1 clock
     // made the step longer, debt = S(n) - M(n)
{ k:'btb', t, lin, target, kind, taken, hit, predicted, right, how, set, way, history, counter, penalty, alloc, resolve }
     // one for each branch: kind 'jcc' | 'jmp' | 'call' | 'ret' | 'jmpi' | 'calli' | 'loop', how 'btb' |
     // 'static' (the decoder) | 'rsb', history = the 4 bits before the branch (-1: none), counter = the
     // counter that predicted (-1: none), penalty (clocks), resolve = the model clock at which the
     // branch µop is done; t = that clock in the step
{ k:'cache', t: 0, level: 'L1' | 'L2', cache: 'data' | 'code', phys, set, way, hit, fill, write, state, nc?, wb?, wbLine?, code? }
     // at most four for each step: the first data access and the first code miss of the L1, and their L2
     // parts (level 'L2' when the L1 misses; wb / wbLine: the fill replaced an M line)
{ k:'bus' | 'fetch', ..., len }   // the FSB cycles (the P5 fields: width 8, burst, line, beat, hi, wb); len
     // in core clocks (the FSB clocks x busRatio); t: in order from the first load or store µop of the step
{ k:'page', ..., global? }        // global: true when the PTE (or the 4 MB PDE) has G = 1
{ k:'reg', t, r: 'CR4', v }, { k:'sys', t, op: 'CR4' | 'RDPMC' | 'RDMSR' | 'WRMSR' | ..., text }
{ k:'fpu', t, text, cycles: 0 }   // also for FCMOVcc and FCOMI (text: the condition or the flags)
```

There is no 'pipe' event (the P6 has no U / V pipes). With `cpu.trace = null` the core makes no event
objects, arrays or strings.

### Tests

- `node tests/cpu686.test.mjs`: CPUID and the feature bits, CMOVcc (16 conditions x 11 flag values, the
  32-bit form, a memory operand with a false condition that faults), FCMOVcc (8 conditions, stack
  underflow), FCOMI / FCOMIP / FUCOMI / FUCOMIP (greater, less, equal, unordered, QNaN and SNaN, the pop,
  C1 / C3, an empty register, an unmasked IE), UD2, CR4, the MSRs (the counters and their events, the
  sign extension, MCA, BIOS_SIGN, the TSC, #GP), the µops and the decoder of 24 instructions, the 4-1-1
  rule, the out-of-order timing (a µop that waits for its operand, younger µops that pass it, the
  retire order, 3 each clock), store forwarding, the clock rule, the branch predictor (a pattern of the
  2-level history, the static prediction, the penalty, the return stack buffer), the caches (L1 hit, L2
  hit, L2 miss and the FSB burst, write-allocate, the write-back into the L2, WBINVD, cacheInvalidate on
  L1 and L2, CD, the 4 ways of the code cache), the same clocks with and without a trace, and no late
  fields (traced and untraced steps, an exception, an IRQ, the FPU, REP MOVSB, HLT, reset).
- `node tests/pm686.test.mjs [--build]`: NASM programs in tests/asm686 (pm686.inc uses
  tests/asm586/pm586.inc): global pages (MOV CR3 keeps a global entry; INVLPG, a change of CR4.PGE or
  CR0.PG removes it; PGE = 0), the P6 instructions at CPL 3 (RDPMC with and without CR4.PCE, RDPMC with ECX
  = 2, RDMSR, CMOVE, FCOMIP, UD2), and loops timed with RDTSC: a chain of DIVs with 20 independent ADDs
  takes about 39 clocks for each pass (the ADDs run while the divider works), with 20 dependent ADDs
  about 59, with 60 independent ADDs about 65 (the ROB fills during the DIV).
- `node tests/cpu386.test.mjs --cpu 686`: the SingleStepTests 80386 suite on this core (the caches on,
  `cpu.queueSnoop = false` as with --cpu 586). Result: 1,758,699 pass, 0 fail, 1 revoked.
- `node tests/asm.test.mjs`: the Pentium Pro forms with NASM (cpu 686, bits 16 and 32), the errors at
  cpu 486 / 586, the round trip Disasm86 -> Asm86 -> NASM and the ndisasm agreement with cpu '686'.
- `node tests/bench.mjs`: the speed of the six cores.
- Tried with the Pentium machine and `m.cpu = new CPU80686(m.bus)`, `m.bus.busRatio = 1`: DOS 3.3 + Alley
  Cat (the dos test) and DOS 6.22 with HIMEM (the dos6 test) run.

### Assembler and disassembler

- `Asm86.assemble(src, { cpu: '686' })` (also `cpu 686`, `cpu 80686`, `cpu p6`, `cpu ppro`, `cpu
  pentiumpro` lines): cmovcc r16 / r32, r/m (all the names of Jcc: cmovz, cmovnae ...), fcmovb, fcmove,
  fcmovbe, fcmovu, fcmovnb, fcmovne, fcmovnbe, fcmovnu (`st0, sti` or `sti`), fcomi, fcomip, fucomi,
  fucomip (`st0, sti`, `sti` or no operand = st1), rdpmc, ud2. At a lower level they give "'x' is a
  Pentium Pro instruction, not a Pentium instruction (use cpu 686)". Difference from NASM: NASM has ud2
  at its 186 level; Asm86 wants cpu 686 for it.
- `Disasm86.decode(read, off, { cpu: '686' })` decodes them (`fcmovb st0, st1`, `fcomi st1`); with
  cpu '586' they stay "db".

### Speed

In Node (`node tests/bench.mjs 2`, the core alone, the bench program of tests/asm286, September 2026):
6.2-6.3 M instructions / s (the P5 core 10.6-11.0 M, the 80486 16.6-17.0 M, the 80386 10.6-10.8 M in the
same runs). The core without the model (the interpreter and the caches) runs about 19 M / s: the
out-of-order model takes about 100 ns for each instruction (about 1.7 µops: the recipe, the RAT, the
ROB and RS entries, the port calendars, the retire). The entries for the views take about 7 % of the
time and the port calendars about 5 %.
With the floor rule the bench shows 1.06 clocks for each instruction, so a 200 MHz P6 needs about 190 M
steps for each emulated second of such code.

### Notes for Machine686 and the views

- `new CPU80686(m.bus)` with `bus.fpu` = an FPU8087 '80387'. Give `bus.busRatio` (the core clocks of one
  FSB clock: 3 for 200 / 66 MHz) and `bus.waitStates` (the FSB wait states: they set the memory
  latency), `bus.cacheable(pa)` (KEN#, as on Machine486 / 586), `bus.peek8(a)` (the L2-hit fills, the
  trace texts) and `bus.poke8(a, v)` (as on Machine586: the stores to L1 lines make no bus cycle).
  Machine586 with `m.cpu = new CPU80686(m.bus)` and `m.bus.busRatio = 1` (its bus runs at the core
  clock) runs DOS; a Machine686 should keep the Machine586 parts (KEN#, A20, memChanged, the cache
  switch, the FPU errors).
- `m.stats` and `m.heat` see only the FSB cycles: L1 and L2 hits and the stores to E / M lines make
  none. An L2 miss is 4 bus events of 8 bytes. `memChanged` / `cacheInvalidate` must be called for each
  write that does not come from the CPU (DMA, block move, loadProgram, the UI). A large range (1 MB,
  as in `a20Cut`) scans all 8192 L2 tags.
- The BIOS: CPUID family 6 ("Pentium Pro"); the caches on at POST as on the Pentium BIOS (INVD, then
  CR0.CD = NW = 0); the MTRRs are not in the core (the caches use KEN#, PCD and PWT); the CPU speed can
  come from RDTSC over a PIT interval (the TSC counts the clocks of the steps).
- A step is one x86 instruction. Code that the P6 runs at more than one instruction in a clock shows 1
  clock for each instruction (`oooStats.floor`, the 'rob' event `debt`).
- The views can draw the ROB, the RS and the ports at any model clock t from `cpu.rob`, `cpu.rs` and
  `cpu.ports` (the state rules above), and follow each µop of a traced step from its 'uop' event: the
  wait in the RS (`wait`), the pass of older µops (`passed`), the retire in order. In fast mode they
  can read the counters (`oooStats`, `btb.stats`, the cache stats, `ports.uops`).
- Not in the core: VME / PVI, PAE (36-bit addresses), the local APIC, the MTRRs, SYSENTER / SYSEXIT, SMM,
  MMX, the multi-byte NOP (0F 1F), the zeroing idioms of later CPUs, the data of the L2 (tags only), the 4
  outstanding FSB transactions (one at a time), the µops of a wrong path (they take no resources), the
  rule that all µops of an x86 instruction retire in one clock, the partial stalls of the flags, DEBUGCTL
  and the last-branch records, the performance-counter interrupt.
- The FPU core (fpu8087.js) gives IE for the load of a quiet NaN (FLD m32 / m64); a real P6 gives it only
  for a signaling NaN. FUCOM, FUCOMPP and the 387 transcendental instructions are not in the FPU core (as
  for the P5).

## Pentium Pro model (sixth machine)

`CPU_MODEL === '80686'`: the page makes `new Machine686({ video })`, assembles the BIOS from
`biosSource('80686')` and the programs with `{ cpu: '686' }`. The list shows the Pentium Pro samples,
then the Pentium, 80486, 80386 and 80286 samples (they run on the Pentium Pro too), then the others.

### Machine686 (src/core/machine686.js, extends Machine586)

The AT board of Machine586 (the same chips, I/O ports, memory map, 16 MB of RAM, CGA or VGA, the
uPD765, the 8237 DMA and the Sound Blaster) with an Intel Pentium Pro (`CPU80686`) at 200 MHz.
Machine686 extends Machine586 because the P6 machine needs all of its parts: KEN#, the A20 work of the
caches, memChanged, the cache switch, the FPU on the chip (FERR# and CR0.NE) and `bus.poke8`. Only the
clock, the FSB ratio, the FDIV switch and the halt wait are new.

- `m.model = '80686'`, `m.clockHz = 200000000`. All device rates come from `m.clockHz`: `m.pit.ratio`
  = 1193182 / 200e6 (the BIOS clock tick stays 18.2 each second), the CGA and VGA timing, the RTC, the
  floppy (one turn = 0.2 s = 40,000,000 clocks) and Sound Blaster times, port 61h bit 4 (each 1600
  clocks = 8 us), `m.isaIo` = 172 (0.9 us for each Sound Blaster port access).
- `new Machine586(opts)` now also takes `model`, `clockHz` and `cpuClass` (Machine686 uses them).
- The FSB: `bus.busRatio = 3` (200 MHz core, 66 MHz front-side bus) and `bus.waitStates = 1`. With
  these, an L2 miss takes 22 clocks to the first 8 bytes and keeps the FSB busy for 33 clocks (see "The
  caches" of the core). The core reads both at each step.
- The FPU: as on the 80486 and Pentium machines (`m.fpu` in the '80387' mode on the chip, no
  coprocessor port cycles, IRQ 13 only while CR0.NE = 0, port F0h clears the IRQ 13 latch).
- KEN# (`bus.cacheable`), `bus.peek8`, `bus.poke8`, the A20 rules, `m.a20Cut()` and
  `m.memChanged(addr, len)` are the ones of Machine486 / 586. `memChanged` calls
  `cpu.cacheInvalidate`, which removes the old copies from the three caches (L1 code, L1 data, L2):
  `dmaWrite` (the floppy and the Sound Blaster DMA), `blockMove`, `setClockFromHost`, `loadProgram`,
  `startProgram`, the old disk service (OUT E0h), `m.pokeMem`.
- `m.stats` and `m.heat` count only the FSB cycles: L1 and L2 hits and the stores to E / M lines make
  none. An L2 miss is 4 bus events of 8 bytes.
- The setup switch: `m.cacheEnabled` (default true; `new Machine686({ cache: false })`), CMOS 2Dh bit
  0, as on the 80486 machine. "Off" empties the three caches at once and stops the fills; "on" works
  at the next reset (the BIOS clears CR0.CD and NW).
- No FDIV bug: `m.fdivBug` is always false, a write to it has no effect, and the `fdivBug` option of
  the Pentium machine has no effect. `cpu.fdivBug` stays false.
- 16 MB of RAM, as on the 80386, 80486 and Pentium machines: DOS 6.22 (HIMEM: 15,360 KB of XMS),
  Wolf3D and the samples need less; the heat maps of the views have one entry for each 256 bytes of
  this size; more RAM needs a change in Machine386.
- **The halt wait** (`Machine686.run`, a copy of `Machine.run` with one more rule). A CPU in HLT with
  IF = 1 does nothing until an interrupt comes, but the core gives only 2 clocks for each halted step:
  at 200 MHz that is 100 million steps for each emulated second (4.6 s in Node). `haltWait(room)` gives
  the clocks to the devices in groups of 256 clocks (1.28 us), with no CPU steps, up to the budget of
  the run or 0.25 ms, and stops when an interrupt or an NMI waits (the CPU takes it at most 256 clocks
  late). It adds the clocks to `cpu.cycles` (the core moves its model by them) and to
  `cpu.oooStats.haltClk` (so CPU_CLK_UNHALTED does not count them). `m.idleSkip = false` and
  breakpoints turn it off, as the wait-loop skip; `Machine.step` (the trace) never skips. Counters:
  `m.haltWaits`, `m.haltSaved` (clocks). A halted emulated second now takes about 0.1 s (the Pentium
  machine, with no halt wait: 0.8 s). The other models do not have this rule.
- After each CPU reset CR0.CD = NW = 1 and the three caches are empty (the core does it); the BIOS
  turns the caches on again (the POST and the resume path of CMOS shutdown codes 05h and 0Ah).

### The Pentium Pro BIOS (`biosSource('80686')`, function `bios686` in bios.js)

The Pentium BIOS with exact block replacements:
- The CPU test: CPUID family 6 gives the name "Pentium Pro" (family 5 "Pentium", as before). BDA
  0040:00EE (`CPU_KIND`) = 5 (CPUID).
- The caches: `cache_init` of the 80486 BIOS (INVD, then CR0.CD = 0 and NW = 0, unless CMOS 2Dh bit 0
  = 1; the resume path of a CPU reset does it again). The MTRRs are not in the core: KEN#, PCD and PWT
  select the cacheable memory.
- The start-up screen (the vendor, the family, the model, the stepping and the features come from
  CPUID; each line fits in 80 columns):
  ```
  CPU   Intel Pentium Pro @ 200 MHz, 8+8 KB L1 + 256 KB L2 cache, FPU on chip
        CPUID GenuineIntel, family 6, model 1, stepping 9, features 0000E1BDh
  RAM   640 KB + 15360 KB extended   CMOS clock   CGA
  FPU   on the Pentium Pro chip
  Cache: 8 KB code + 8 KB data (L1), 256 KB L2 in the CPU package, on
  ```
- The INT 6 message names the Pentium Pro ("a newer CPU than the Pentium Pro (a Pentium II or
  later)").
- The fall-back counts of the floppy waits (for a stopped timer): the P6 runs the loops about 4 times
  faster than the Pentium, so `fd_wait` gets 1000 x 65536 passes (about 2.6 s) and `fd_ready` 40 x 65536
  passes. The timer ticks (2 s and 1.5 s) stop the waits first.

### Pentium Pro samples (SAMPLES with `model: '80686'`)

All of them time with RDTSC after CPUID (CPUID is serializing: all older µops are done), with CLI, and
run each loop one time before the timed run (the caches and the branch predictor). The numbers below
are from `machine.test.mjs --model 80686`.
- `ooo`: out-of-order execution. The loops run first (the trace shows them at once): 1000 passes of a
  32-bit DIV (39 clocks, a chain: each DIV needs the EAX of the DIV before it) and 20 ADD. Loop 1: the
  ADD use EBX and ESI, so their µops pass the DIV µop and run while the divider works: 39.1 clocks for
  each pass. Loop 2: each ADD needs EAX: 59.1 clocks. Ratio 1.5. In the trace the ADD µops of loop 1
  have `passed` > 0 (the waiting DIV and the older µops).
- `cmov`: the larger number of each of 512 pairs, with CMP / JGE / MOV and with CMP / CMOVL, on random
  numbers (a linear congruential generator) and on ordered numbers. Typical: branch 12.1 / 8.2, CMOVL
  8.2 / 8.2 clocks for each pair (random / ordered); both give the same sum.
- `rename`: 4 jobs that all use EAX (load EAX, IMUL EAX, EAX two times, store): each job loads a new
  EAX, so the RAT gives it a new physical register and the jobs overlap: 18.1 clocks for each pass.
  The same jobs with a real dependency (each job adds to the EAX of the job before it): 36.1. Ratio 2.0.
- `l2`: the A20 gate on (port 92h), then "unreal mode" (FS gets base 0 and a limit of 4 GB in
  protected mode, then real mode again), a chain of pointers (one in each 32-byte line) in a 4 KB, a 64
  KB and a 1 MB array at 2 MB, 32768 dependent reads (MOV ESI, [FS:ESI]) in each: 3.00 (L1 hits), 7.00
  (L2 hits), 33.01 (L2 misses) clocks for each read; 0.09 / 0.22 / 1.03 for each byte of the line. The
  A20 gate is set back at the end.
- `pmc`: WRMSR to PerfEvtSel0 / 1 (186h / 187h, USR + OS, EN in 186h starts both counters), RDPMC
  (ECX = 0, 1). The counts of an empty routine are subtracted. MOV CX, 100 and 100 passes of ADD r, r /
  ADD m, r / DEC / JNZ: 401 instructions (C0h), 701 µops (C2h), 1.75 µops for each instruction; 100
  passes of a JZ in turn: 200 branches (C4h), 1 wrong prediction (C5h); a JZ at random: 200 branches,
  40 wrong predictions.
- The older samples on the P6: `p5pairs` shows 10.0 / 10.0 clocks for each pass (ratio 1.0: the P6 has
  no U and V pipes, and the out-of-order core hides the chain of loop 2); `btb` now finds the CPU family
  and uses PerfCtr0 with event C5h on the P6 (the P5 counter MSRs 11h / 12h give #GP there; the P5 path
  is the same as before): the P6 learns the pattern "in turn" ("The CPU learned the pattern ...");
  `rdtsc` 199.99 MHz; `fdiv` is correct; `cpuid` shows leaf 0 = 2, 00000619h, 0000E1BDh; `cache` (the
  486 sample): on 288 / 466 us, off 6161 / 6145 us (the 64 KB array fits in the L2).

### Tests

- `node tests/machine.test.mjs --model 80686 [--video vga]`: all samples of the Pentium Pro, Pentium,
  80486, 80386 and 80286 and the others; the checks of the numbers (ooo and rename: loop 1 faster,
  ratio 1.3 or more; cmov: CMOVL 1.2 times faster on random data, the branch not slower on ordered data;
  l2: L1 < L2 - 2 < memory - 10 clocks; pmc: 701 µops, the pattern learned, 20 or more wrong
  predictions at random; p5pairs: no pairing effect; btb: the pattern learned; fdiv: no bug also with
  `fdivBug: true`; the cache sample with the P6 limits), the memory map checks of the 80386, and the
  Pentium Pro checks: the start-up screen (80 columns), the device clocks at 200 MHz (port 61h, isaIo,
  the VGA or CGA timing, the floppy turn, 18 BIOS clock ticks in an emulated second), the FSB ratio,
  the setup switch (no fills in the L1 and the L2), the resume after a CPU reset (the L2 is empty,
  `busRatio` stays), KEN#, L1 and L2 hits with no stats and no heat, an L2 miss of 32 bytes on the FSB,
  `poke8`, the invalidation by DMA, pokeMem, memChanged, loadProgram and setClockFromHost in the L1
  data cache, the L1 code cache (a loop at 7C00h) and the L2 (also a line that is only in the L2), the
  A20 cases (also poke8), IRQ 13 with NE = 0 only, no FDIV bug, and the trace of the ooo sample (ADD
  µops with `passed` > 0).
- `node tests/dos.test.mjs --model 80686 [--video vga]`, `node tests/dos6.test.mjs --model 80686
  [--video vga]`, `node tests/vga.test.mjs --model 80686` (Wolfenstein 3D with the Sound Blaster; the
  DOS 6.22 disk stays unchanged), `node tests/story.test.mjs --model 80686`.
- `node tests/fdc.test.mjs` and `node tests/sb.test.mjs` include the Pentium Pro (fdc: the CPU reads a
  DMA buffer through its caches after READ DATA; the boot with the real disk timing gets 3 emulated s
  also at 200 MHz). `node tools/latefields.mjs` checks Machine686.
- Speed in Node (September 2026): `node tools/machbench.mjs 2 80686` 4.0-5.1 M instructions / s, 0.02-0.03
  x real time (1.06 clocks / instruction); the Pentium in the same runs 9.5-9.7 M / s, 0.25 x real time.
  `node tools/wolfspeed.mjs --model 80686 --secs 4 --idle`: the sign-on wait loop of Wolf3D runs 125 M
  instructions in each emulated second (1.6 clocks / instruction) in 0.38-0.46 s real; the wait-loop
  skip saves 0.98 s of each emulated second (the Pentium: 55.7 M instructions in 0.09 s). DOS 6.22 to
  A:\> 5.3 emulated s in 54-77 s real (the Pentium: 10-11 s); Wolf3D to the menu 58 emulated s in 334-342
  s real (the Pentium: 63 s); the whole `vga.test.mjs --model 80686` about 13-14 minutes;
  `machine.test.mjs --model 80686` about 40 s. A profile of the DOS 6.22 start shows the time in the
  out-of-order model of the core (`sch` 28 %, `ooo` 25 %, `finish` 4 %); the machine part (`run`,
  `tickPending`, the devices) takes less than 8 %.

## Pentium Pro views (src/ui)

`CPU_MODEL === '80686'`: theme.js adds THEME_686 (night blue and aqua) and the classes m286 +
m386 + m686 (not m486, not m586). app.js: `is686` (`is386` and `is286` also true; `is486`,
`is586` false), `cpuAsm` = '686'. board3d.js: `M686` (FPU_ON), CHIPS_686 (a 387-pin package),
INFO_686, the die plan '80686' (L1 CODE CACHE, CODE TLB, BTB, DECODERS, MSROM, RAT, RETIREMENT
REGISTERS, ROB, RESERVATION STATION, PORT 0 IEU FEU, PORT 1 IEU JEU, FPU, LOAD UNIT, STORE UNIT,
MEMORY ORDER BUFFER, L1 DATA CACHE, DATA TLB, BUS INTERFACE), BLK_686, `P6_CARDS(evs)` (the RAT,
the reservation station, the ports and the ROB of one instruction, from its 'rat', 'uop' and
'rob' events) and `CACHE_CARD_P6` (L1 miss, L2 hit on the back-side bus, L2 miss on the
front-side bus). story.js: lines for 'rat' (the renames), 'uop' (a µop that passes older µops,
waits, or goes to its port) and 'rob' (the in-order retire); an L1 miss and its L2 part are
steps (kind 'cache'; an L2 hit too); a wrong prediction is a step (kind 'btb', with the history).

`CPU_MODEL === '80686'` with the P6 core (`cpu.rob`, `cpu.rs`, `cpu.l2`): the views use their
Pentium Pro parts. With a Pentium core on this page, they use the Pentium parts.

die.js: `Die686View extends Die586View`. It shows two dies in one package. The CPU die has two
floor plans in `D686_ARR`: 'L' (landscape) and 'P' (portrait; `off` moves the unit groups). The
L2 die is `build87`. The back-side bus joins the dies (`buildLinks`, `arr.bsb`), and tokens go
to 'l2' through it. The units: L1 code cache (64 × 4), code TLB, BTB (512 counters; the 4
history bits and the 16 counters of the last entry; the return stack), fetch unit (the 32-byte
queue); decoders D0, D1, D2 and MS (the decode group, the µops, the reason for the 4-1-1 rule)
and the MSROM with CR0, CR4, the TSC and the decoder mix; RAT (registers → a ROB entry or RRF),
ROB (a ring of 40 entries in state colours, with the allocate and retire pointers), and a chart
of the µops of the instruction (a row for each older µop that it passes, "passes the DIV", or
waits for); RS (20 entries, source dots), retirement registers (EFLAGS, EIP, the segments, the
FPU stack), five ports with unit lamps and busy bars; MOB (the loads of the instruction and the
store buffer), L1 data cache (128 × 2, MESI), data TLBs with the page miss handler, and the bus
unit (the FSB phases REQ, ERR, SNOOP, RESP and DATA, the P6 signal lamps, A, BE, 8 byte lanes, 4
beats, and the BSB lamp); the L2 die: 8192 lines as a canvas image (one pixel for each line, in
its MESI colour), the tag compare and the counters.

The view keeps its own µop history (`this.oo`: typed arrays of 512 µops), filled from the 'uop'
events and a copy of `cpu.rob`. Each instruction plays its model clocks from `t0` (its decode,
or the dispatch of an older µop that it passes) to `t1` (its retire): in trace mode
`traceStep` and `storyTargets` move the clock to a target for each step; in explain mode the
clock moves during the play time of the instruction; in clock mode it moves with the Clock
button. `renderOoo` draws the ROB, the RS, the RAT, the ports and the store buffer at that clock.
After a wrong prediction, the view draws dashed µops of the wrong path, and they flush at the
check (the core makes no such µops; the ROB tooltip says this). `ooMilestones` sends the tokens
and the sounds. In fast mode the die draws at most 10 frames a second. The view adds no fields
to the CPU or the machine.

dock.js: the "Pentium Pro system" card (`is686`, `p5like`) with the panes CR (CR0, CR4 with
PGE and PCE, the TSC), SEG, TLB (a global entry has a white edge), CACHE (L1 code, L1 data, L2:
counters, MESI counts, the last access of each level, line maps), BTB (the counters, the history
and the counter of the last branch, a map of the 512 entries) and OOO (ROB and RS use, µops for
each instruction, instructions and µops for each clock, the decoder mix, the µops of each
port, the `oooStats` stalls). The FPU card title is "FPU (on the Pentium Pro)".

memmap.js: `m686` uses the Pentium paths and adds three marks on each hex row (L1 code, L1 data
in MESI colours, L2 striped), a card for the three caches with the ranges that have no KEN#,
`lastL2` for 'cache' events of level 'L2', and global pages (G, CR4.PGE) in the Pages tab.

timing.js: `m686` uses TV_GROUPS_686 and TV_INFO_686. One position is one core clock; BCLK has a
period of `bus.busRatio` positions. A simplified pipelined P6 bus with one transaction at a time:
2 BCLKs of request phases (ADS#, A31–A3; REQ4#–REQ0# in phase a; the length and BE7#–BE0# in
phase b), the snoop phase (HIT# and HITM# stay high), RS2#–RS0# (111 normal data, 101 no data)
with the first DRDY#, then 4 transfers with DBSY# for a line read or a write-back and TRDY# for a
write. Decoded rows: transaction, bus phase, L1 · L2, retire (µops for each clock) and BTB.

style.css: `:root.m686` rules at the end of the file. Tools: `tools/p6build.mjs`,
`tools/p6shot.mjs`, `tools/p6dieshot.mjs` (`--until` steps to an instruction), `tools/p6bench.mjs`
(fast-mode speed for each tab; `--gpu`, `--prof`).

## The flow of the trace in the Top view (topview.js)

The goal: one continuous line for each value, never a jump, and the real action of each unit.
- `flowPlan(s, ms)`: the parts of a step from `journey(s, true)`: bond wires (pin -> pad), legs
  in a die routed through its channels (`dieRoute`: Dijkstra over a grid of the die with a cost
  for a unit cell and for each turn; ports on the edges of the units), unit visits (in at the
  port where the leg in ends, a wait at the working part, out at the port where the leg out
  starts), board legs (horizontal and vertical; the chip uses the pin nearest to the board
  trace). A constant screen speed (FLOW_PX_S); a unit with a drawing takes FLOW_UNIT_S.
- `flowFull`: two passes, so the token times come from the real zoom of the camera track; the
  work in parallel (`s.bg`, for example a prefetch) as a second token; the step lasts until
  both are done. `flowCamera`: a track at 60 Hz (the die stays still while the token is in it;
  on the board the camera follows the token), smoothed in both directions, with limits for the
  zoom (CAM_DLZ) and the pan (CAM_DPX); a move to a new value is a van Wijk-Nuij zoom path.
  `bgFollow`: after the main token the camera follows the parallel token when it is in the
  same die. A value that stays (for example the address in the 8282 latches) is a held mark.
- The unit action: `paintUnit` (UnitFx in the unit when it is large enough on the screen), the
  card as a magnifier (`drawLens`: a cone to the unit, and where the input comes from and
  where the output goes), the value tag at the token (`unitIO`: the input before the work, the
  result after it), and operands on their own wires (`feedersOf` / `drawFeeders`, for example
  DS x 16 and the offset into the address adder).
- story.js: the prefetch mode 'parallel' (the default): a prefetch goes with the EU step before
  it (`s.bg`), else with the next step.
- Tests: `node tools/flowfilm.mjs --out DIR --tab top --asm "..." --instr N --speed 2` (a virtual
  clock: exact frames at 30 fps, state.json and film.mp4) and `python tools/flowcheck.py DIR
  [--units]` (token jumps over 40 px in a frame, camera pans over 60 px, zoom steps over 12%,
  the token out of the view: all must be 0; a contact sheet; close-ups of each unit visit).


## The flow of the trace in the Board view (board3d.js)

The same rules as the Top view, in 3D. The constants (FLOW_*, CAM_*) and `zoomPath` are at the
top of board3d.js; `BoardKit.zoomPath` and `BoardKit.layRoute` are shared with the Top view.
- `chipVisit` gives the parts of a chip visit (bond wires, legs, dwells). `trJourney` then picks
  the pins (the pin nearest to the board line of the value), routes the legs through the
  channels of the die (`layRoute` on `layOf(e)`, mapped to the world with `dieW`), and makes each
  dwell a slow part through its unit (`unit: true`, `ci`: the index of the working part). A gap
  over 0.3 units is an arc over the board (a board part).
- `segCtx(sg, bg)`: the camera goal of a part: the whole die (and the points of a bond wire or a
  pin), a unit with a card (FLOW_UNIT_M times the unit), or the ends of a board part (then the
  camera follows the token). `pxAt(r)`: screen px for one world unit at the distance r.
- `flowPlan` / `flowFull` / `flowCamera`: as in the Top view. The track has target, log r,
  theta, phi and up; `trTrack` puts the camera on it (a blend at the start of a step and when
  the user gives the camera back). A reduced motion setting uses the old springs (`trCamGoal`).
- The rider: a constant speed (`riderAt`: in, the work, out for a unit); the head of each flow
  comes from the part index and the distance of the rider. The tokens in parallel (`s.bg`) are
  riders with thin dim lines and a small token; their units glow dimly.
- The unit action: `unitWindow` (the exact card drawing on the unit, as a DOM window at the
  projected rectangle of the unit, with the token as a DOM dot over it), UnitFx on the die
  under it, and the card at the left (it can be minimized: 'boardCardMin').
- Tests: `flowfilm.mjs --tab board` records the projected token, the unit rectangle, and the
  camera target, distance and screen px; `flowcheck.py` measures the pan in screen px, the zoom
  and the turn of the view for each frame.

## The Pentium Pro timing model in WebAssembly (src/core/p6ooo.c)

The out-of-order model (`ooo`, `sch`, `sbCheck`, `branch6` of CPU80686) takes about half of the
time of the P6 core in JavaScript. `src/core/p6ooo.c` is a copy of it in C, without the trace
parts. `node tools/buildwasm.mjs` compiles it (clang --target=wasm32; LLVM for Windows) into
`src/core/p6ooo.wasm.js` (the module as base64 in P6OOO_WASM). The page does not need clang.
- **One state:** at the attach (`w6Attach`), the typed arrays of the model (oS, rob, rs, rat,
  ports, sb, btb, the loads and stores of the step) become views into the module memory.
  `oooStats` and `btb.stats` become objects of getters and setters over the counters there. The
  ring positions (robPos, rsPos, sbPos, rsbTop) are JavaScript fields: `w6Ooo` copies them back
  after each C step, and `w6Push` copies them to the module after a JavaScript step or a reset.
- **Which model:** the fast mode uses the C model (`w6Ooo`: it writes the inputs of the step,
  IN_*, then calls `ooo(mode, recipe index)`). The trace uses the JavaScript model, because only
  it makes the trace events. The recipes have an index (`id`, from `p686Recipes`). A recipe
  without an index uses the JavaScript model.
- **The start:** Chrome does not compile a module over 4 KB synchronously on the main thread. So
  the page compiles it in the background (`p6wModule`), and each CPU instantiates it in the
  background (`w6Start`). The JavaScript model runs until the instance is there; the attach occurs
  between two steps. In Node the compile is synchronous. `cpu.w6Off = true`: never attach.
- **The rule:** a change of the model in cpu80686.js needs the same change in p6ooo.c, then
  `node tools/buildwasm.mjs`. `node tests/p6wasm.test.mjs` runs the benchmark, the five P6
  samples and the start of DOS 6.22 on three machines (only JavaScript, only C, and one that
  changes between the two), and compares all the clocks, the model state and the counters after
  each slice.
- **Speed:** the P6 machine: 3.2 -> 3.9 M instructions/s in Node (+22%); the page in fast mode:
  +25-29%. The rest of the time is in the JavaScript instruction core.

## The hard disk (drive C:)

All six machines have the same IDE hard disk controller (`IDEController` in devices.js), with
one drive (`m.hdisk`, a `HardDisk` from disk.js).
- **Ports:** 1F0h-1F7h (the task file; 1F0h is the 16-bit data port) and 3F6h (device control
  and alternate status). The machines dispatch them as the device `'hdc'`. `bus.in16` and
  `bus.out16` move a whole word at 1F0h; other ports still get two byte accesses. PIO only.
- **Commands:** READ SECTORS, WRITE SECTORS, READ VERIFY, IDENTIFY DEVICE, INITIALIZE DEVICE
  PARAMETERS, RECALIBRATE, SEEK, EXECUTE DIAGNOSTIC, SET FEATURES and the power commands; the
  others end with ABRT. CHS or LBA addresses.
- **IRQ:** the AT models raise IRQ 14 (input 6 of the second 8259A); the 8086 card has no IRQ.
  The BIOS polls the status on all models, and IRQ 14 stays masked.
- **BIOS (bios.js, 8086 code for all models):** `hd_init` (POST) finds the drive with IDENTIFY,
  fills the parameter table at 40:C0h (INT 41h points to it), sets 40:75h = 1 and prints the
  DISK line. `hd_entry` is INT 13h for DL = 80h: functions 00h-05h, 08h, 09h, 0Ch, 0Dh, 10h,
  11h, 14h and 15h; 41h (extensions) gives an error. `int19` boots A: first; with no disk in A:
  it boots the MBR of C:. 40:F6h = 80h (written by the page for "Boot from C:") puts C: first.
  CMOS 12h = F0h and 19h = 47 when there is a hard disk (the AT models).
- **Images (disk.js):**
  - `hdBlank` makes a new 20 MB type-2 disk (615 cylinders, 4 heads, 17 sectors): the MBR
    (`HD_MBR`, from tools/hdmbr.asm) and one active FAT16 partition from head 1, formatted.
  - `hdMakeBootable` copies DOS from a system floppy, as SYS C: does. The two system files go
    first in the root and at cluster 2, then COMMAND.COM. The floppy boot code gets the hard
    disk BPB, with drive 80h at 24h (DOS 4 and later) or at 1FDh (DOS 3).
  - `fatAddTree` copies a folder tree; long names become `NAME~N.EXT` 8.3 names.
  - `Fat12` reads and writes FAT12 and FAT16 (with a partition offset: `hdFs`).
  - The page never contains a DOS image: C: gets DOS from the user's floppy in A:.
- **UI (disks.js):** the Drive C: card: New bootable C:, New empty C:, Load image, Add folder
  (a folder picker, or drop folders on the card), Add files, New file, Save, Remove, and the
  file list with the editor. "Boot from C:". IndexedDB key 'hd0'.
- **Tests:** `node tests/hd.test.mjs` (DOS 3.3 on the 8086 and the 80286, DOS 6.22 on the
  80386 and the Pentium Pro): SYS, the folder tree, the POST line, the boot from C:, DIR, TYPE,
  COPY, and the copy read back from the image.
- **3D board:** the IDE card (`HDCARD`, `HD_CHIPS`: a GAL16V8 decoder, two 74LS245 for the 16
  data lines, a 74LS244) in the next ISA slot, and drive C: as the third bay of the drive cage
  (`paintHardDrive`, LED from `m.hdisk.busy` and `fastLv.hdc`), with the 40-wire cable 'HDD'. A
  bus cycle to 'hdc' lights the card, the cable and the drive. The Top view does not draw them
  yet.
- **Follow (3D board button = the "Follow action" switch of the page):** the same rule as the Top
  view. Each bus cycle notes its target chips in `busSig` (`chaseNote`: the RAM chip of one
  data bit, `ramE0`-`ramO7`, as in the trace; the ROM, the video chips, the IDE card and drive C:,
  the floppy controller, the Sound Blaster ...; the last 6). While the machine runs (not in the
  trace), `chaseStep` frames the CPU and the targets of the last 1.8 s, and moves only when that
  set changes (a slow smooth move; the camera keeps its angle; the floating screen is allowed
  for). A drag or a camera view pauses it (`pauseChase`); the Follow button resumes it.

## The Explain player (src/ui/explain3d.js)

The Explain player shows a small program on the real 3D board and dies, one thing at a time.
The "▶ Explain" button in the view bar starts it; Exit puts back all the settings of the page.
- **The program:** `mov ax,0xB800` / `mov es,ax` / `mov al,'A'` / `mov [es:0],al` on the 8086.
  Asm86 and Disasm86 give the bytes of each instruction. The values come from the emulator.
- **The director (`Explain3D.Explain`):** chapter 0 is a tour (the program, the CPU and the
  clock, the latches and the bus, the two RAM banks, the CGA card and the monitor). Chapters
  1-4 are one instruction each: a caption for the instruction, then one beat for each trace step
  (the 'full' prefetch story: T1/T2/T3 for each code fetch), a screen beat after the write to
  video memory, and a done beat (IP and the clocks). The end is a summary with the total clocks
  (the sum of the clocks of each instruction). `go(c)` reloads the program and runs the
  instructions before chapter c.
- **Timing:** the reading time of a caption sets the time of a beat (1400 ms + 58 ms for each
  character; less for the later, quick code fetches). The speed control and the pause use
  `AnimClock.setScale`, so the animation, the camera and the beats stop together.
- **The board hooks (board3d.js):** `xpSet({shots, spot})` turns on Explain. With `shots`, each
  trace step has a fixed camera shot (`xpShot`: the whole die for a step in one chip, else the
  box of the path) and a 0.9 s move to it (`xpCamera`), not the track of the flow. `xpFocus(ids)`
  lights and frames parts for the tour (`xpBox`: a glow id, 'cga', 'monitor', 'drives',
  'die:<key>', 'screenTL' = the first cells of the screen). `drawSpot` darkens the view on a 2D
  canvas (.bv-spot) and cuts soft holes around the path, the dies and the token, or around the
  parts of `xpFocus`.
- **All six models:** the tour text comes from `CPUS[CPU_MODEL]` (the chip names, the units, the
  caches); the clock rate comes from `machine.clockHz`; the short captions of the later code
  fetches use the values of the story step. The chip ids of the 3D board are the same on all boards.
- **The order of the steps (`plan`):** the code fetches that bring the bytes of the instruction
  play before the decode (with their cache miss steps first, the L1 before the L2). On a model
  with a cache, the first bus cycle of a line fill plays in full and the other cycles of the line
  are one short beat. The steps that prepare a data bus cycle (the address, the cache, the µops)
  play before it. A caption over 230 characters becomes two beats. The P6 µop numbers and the
  absolute clocks become relative clocks.
- **Time and shots (`BoardView.xpPlan`):**
  - The parts become pieces: moves and stops. A stop is the work of a unit (XP_WORK_S, a text
    card 0.8 of it, and at least the time to read the text of the unit: `xpReadMs`), a short
    stop in a unit that only passes the value (XP_PASS), or a camera move (a cut).
  - The moves between two stops are one run. Its time comes from its whole length on the screen
    at XP_PX_S (at least RUN_MIN, at most RUN_MAX), so all its parts have the same speed. The
    length of a part is its projected length (`shotCam`, `projLen`) with the camera of its shot;
    a run into a follow scene uses the camera of the next unit for all its parts.
  - A run speeds up and slows down smoothly (`xpEase`: the speed follows a smoothstep ramp over
    the fraction `a` of the run at each end; a run into a follow scene uses the full S-curve, as
    the camera does).
  - Each unit with work gets its own close shot (`segCtx(sg, false, true)`: the unit fills the
    free view); the parts between go in a die shot or a board shot.
  - The camera moves between two shots while the token waits. The move follows the zoom path of
    van Wijk and Nuij (`xpCamera` with `zoomPath`, a smootherstep in time). Its time grows with
    the length of that path (`xpCutMs`), so a large zoom or a long way does not jump. The same
    rule gives the move at the start of a step (`traceDur` keeps it in `s._xpLead`).
  - The close shot of a unit centers it in the free part of the view (`xpCovers`: the program
    strip at the top and the caption bar at the bottom; a card at the left only for the clock of
    the tour, `xpCard`).
  - A short step (the later code fetches, ms < 1000) has one shot and a quarter of the work time.
    The plan sets `t0`, `t1`, `fin`, `fout` (the in and out parts of a unit) of the parts;
    `riderAt` and the unit progress read `fin`/`fout` (else FLOW_IN).
- **One text for each unit:** while a unit works, the caption shows "chip · unit" and the text
  of that unit (`xpNowUnit`, `xpUnitText`); else the caption is the step text (there is no second
  line). The unit text stays while the token is in the same chip. The 'status' card has a
  text for each role (the bus control of the CPU sends the status; the status decoder of the
  bus controller decodes it). tools/xpunits.mjs lists the units of the program on all models
  and the texts that two units share (there must be none).
- **The meaning of the words of the unit work:** the pointer over a word of the drawing (the
  window on the unit, or the unit card) shows its meaning (`termAt`, `termShow`, the glossary
  `BlockPanel.termTip` in blocks.js). The panels have no pointer events, so the board tests the
  rectangles of the SVG texts. On the drawing but on no known word: the unit and its text.
  `tools/xpunits.mjs --terms file` lists all the words of the drawings and their tips.
- **The unit itself shows its work:** in Explain there is no window over the unit. The drawing
  of its work is on the unit on the die (UnitFx on the overlay canvas of the block, above the
  path lines, under the token), and a tag above the unit (`unitTag`) gives the title and the
  short facts of the card. UnitFx draws at the scale of the unit on the screen (`unitZoom`: 1 px
  of the drawing is about 1 px of the screen, so the words are at least 11 px; the scale changes
  only for a new card or a large zoom); without that scale it draws in a space of about 360 px. Structures of the units (the card kinds):
  - `cache`: the address (TAG | SET | OFFSET), the set decoder, the sets near the selected one
    and the ways of the selected set (state, tag, the bytes of the line). The lookup lights the
    set and compares the tags; the fill takes a way (wide in the selected row), writes the tag,
    the bytes one by one and the state. The tags and states come from the core now
    (`cacheSetNow`: `ctag`, `dcache`/`icache`/`l2` tag and state arrays).
  - `bus`: the pins, the address, the signals (KEN#, BLAST#, CACHE#) and the line buffer that
    fills transfer by transfer; a write goes out; the P6 L2 on the back-side bus.
  - `pipe`: the stages PF D1 D2 EX WB (two rows U and V on the Pentium); the instructions move one
    stage on.
  - `rat` (the table register → ROB entry or RRF), `rs` (20 slots: the µops in their slots,
    waiting, going to their ports), `rob` (40 entries, the head, allocate, done, retire), `port`
    (from the station, the stages of the unit, the result to the ROB).
  A card can keep its old drawing for the side card (`spec.panel`); a kind with no drawing in
  blocks.js shows `spec.lines` there. The words of the die drawing have tooltips too: UnitFx
  records the box of each word (`UnitFx.words`), and `termAt` maps the pointer into the canvas
  of the unit. `BlockPanel.termTip` has the glossary; `kindTip` and `KIND_TIP` give the sense of
  a word from the kind of the drawing. tools/unitsheet.mjs draws all the new kinds of the program
  at three moments (no 3D).
- **No blur in a zoom (detail tiles):** the die texture has 1 px for each base px of the die
  picture; a close view needs more. A pool of detail tiles (`tiles`, at most 20) draws parts of a
  die again at the scale of the view (`beginTile` / `stepTile` / `finishTile`: in horizontal
  strips, about 8 ms of drawing in each frame, so no frame is long); the finer tiles are over the
  coarser ones. When the camera rests, `updateDetail` adds the tile of the view (as before).
  Explain knows its camera path, so `xpPrefetch` queues the tiles ahead: for each view on the path
  (each shot, and 4 points of each move to it: `xpCamAt`, the same zoom path as `xpCamera`), the die
  that the ray through the middle of the view meets (`centerOnDie`), the scale in steps of 1.25,
  and a region 1.35 times the view on a grid of a quarter view (so the views near each other get
  the same tile). The step now is queued first (traceStep); the next step is queued when a beat
  starts (explain3d.js), with a low priority in the pool. A tile of a round window uses the shape of
  the open window (not the mask), so it can be drawn while the window opens; it shows when the
  window is open. `openWindow` does not animate an open window again (that hid the tiles at each
  step). tools/blurprobe.mjs measures it: at each moment, the scale that the view needs and the
  scale that is there (5 x 5 points of the view).
- **The unit names on a die** are always horizontal (`labelLines`: the words on 1 to 5 lines at
  the largest size that fits). In the Top view a turned chip turns its labels back.
- **Tools:** tools/xpmotion.mjs measures the motion (the token speed on the screen, the pan and
  the zoom rate of the camera, the time of each unit); tools/xpfilm.mjs takes pictures on a
  virtual clock.
- **Milestones:** the bar of the player shows the milestones of the chapter (`ms`): the tour
  parts, or for an instruction its intro, each story step in the order of `plan` (with the name
  of the step), the screen beat and Done. The current one fills as it plays. A click (`jump`),
  "◂ Back" and ← (`goBack`) go to a milestone: its beat plays, the beats after it follow; the
  board replays the earlier steps (traceStep), the screen shows the letter only after the write
  (`vRec`), and `firstFetch` follows the target. The steps of an instruction are known after its
  start (`startInstr` puts them into `ms`); the Done beat keeps the instruction open (the next
  instruction, `go` or Exit ends it), so the viewer can go back into it.
- **The viewer's timing:** Timing panel: signal speed, work time (`board.xpTime`), reading time,
  and "wait for Next after each step" (localStorage 'a86:xpSet'). Buttons and keys: Replay the
  step (R), Back (←), Pause (Space), Next (→), Esc. The speed button scales the animation clock (0.25-3×).
  Explain closes the program pane and the dock, and Exit opens them again.
- **VGA:** `vget`/`vset` read and write the text screen in planes 0 and 1 of the VGA (else the CGA
  memory at B8000h). The letter appears on the animation clock (`vShow`).
- **The chips on the way (all trace views of the board):** a bus step now works in the glue
  chips too (`GLUE` in board3d.js): the address goes through the latch lat0 (a `latch` card: ALE,
  A0-A7), the data through xcv0 or xcv1 (a `buffer` card: DT/R, DEN), and the command step goes
  from the bus controller to the decoder (a `decoder` card: Y0-Y7; on the AT boards the PAL16L8
  AND array first for the memory) and on the chip-select line to the target (the command line
  glows as an extra line). The `bytes` card draws more than 8 bytes in rows of 8 (a cache line,
  the 16- or 32-byte queues).

## The page layout after the UI review of v49 (v50)

A review of v49 (screenshots of all the views at 1440×900, 1280×720 and phone size:
`tools/uxshots.mjs`) found that the view had about 20% of the window (12% at 1280×720), that
floating panels covered it, and that many controls had copies. The changes:

- **The run controls are in the top bar** (`.transport` is inside `.topbar`; `--transport-h` is
  0 on a desktop). On a phone they are a bar fixed to the bottom, as before (the top bar has no
  backdrop filter there, so the fixed bar is relative to the window). The rare switches are in
  two small menus (`.pop-menu`): **More** (`#opts-menu`: slow motion, follow action, watch the
  BIOS boot) and **Sound** (`#sound-menu`: the machine sound `#opt-snd`, the effects `#opt-sfx`).
  The decap switch is the **Open chips** button of the 3D board (`decapBtn`; `#opt-decap` is a
  hidden checkbox that keeps the setting). With the trace on, the Instr button hides (Next and
  Skip step; F8 stays).
- **The trace panel is under the view** (in `.pane-stage`, after `#stage`), with a fixed height
  (three lines of text), so the view does not change its size from step to step. The step list
  and the options (repeats, prefetch: the button `#trace-opt`) open over the view. The views
  measure the part of the view that the panel covers (`trViewOffset`, `barH`, `traceCover`): now 0.
- **The screen is under the program** (`.monitor.side` at the end of `.pane-code`: the program
  and its output together). When the program pane is hidden, it floats on the stage as before;
  detach and its own window work as before (`placeMonitor`).
- The program pane is 28% of the width (was 32%). The dock height is `--dock-h`
  (176–232 px: lower in a low window); a card scrolls when it must.
- **The tab bar has four tabs:** Board, Die, Bus timing, Memory (`MAIN_TABS` in app.js). The
  Board tab shows one of three views of the board (`BOARD_MODES`: 'board' = 3D, 'top', 'runner';
  storage `boardMode`). The switch of these modes (`#board-modes`, a radio group) goes to the left
  of the tool bar of the view that is open: each board view gives its place (`modeSlot`), and
  `syncBoardModes` moves the switch there. The view ids, `selectTab(id)` and the keys 1–6 stay as
  they were ('top' and 'runner' are still views; the Board tab is selected for them).
- **Speed and slow motion are one slider** (`#speed`, 0–150). Its left part (0–60, `SLOW`) is
  slow motion (`MOTION`: ½× to 1/64×, the animation clock) at the slowest speed; 60–150 is the speed
  position (`speedPos` 0–90) at 1×. The label says "slow motion ⅛×" in the left part. Storage:
  `motion` (the index) and `speedPos` as before.
- The Runner has no sound switch of its own: the Effects switch of the Sound menu controls its
  sounds too.
- **Die tab:** a click on a unit also zooms to it (`zoomToBlock`), with room for its description.
- **The start card** (`startCard`): on the first visit, two ways in (the guided story, or an own
  program). It covers only the view and does not come back (storage `startSeen`). It does not
  show in a browser under automation (`navigator.webdriver`), so the tools see the page as before;
  `#start` in the address shows it.
- The help is new (all six machines, the views, the trace, Explain keys) and opens at its top.
- The pressed buttons of the board tool bar have a quiet style (the bright fill is for the main
  actions). The mouse hint line of the board is gone (it is in the help).
- Bus timing: a row is at least 15 px high (the names do not touch; the view scrolls).
- **Explain** takes the whole window (`body.xp-full`: no tabs, counters or run controls). The
  program strip is one line of chapter buttons (the machine, each instruction with its bytes, the
  end); the bar has no chips. The bar title is in normal case ("Instruction 1 of 4: `mov ax,
  0xB800`", then the milestone and its number). There is no side card for a unit and no
  second text line: one caption. The spotlight dims the other units of the die while a unit
  works (`drawSpot`, `spotU`: a second dim layer with a hole at the unit). The names of the units
  on the die are at most about 26 px on the screen (`sMax` in `drawInterior`: 26 / S for a
  detail tile). A unit drawing has an opaque base (the name under it does not show through). The
  opcode drawing has a layout for a tall unit (the bits in rows, the other bytes under them).
  The timing panel opens over the view (the bar keeps its size). The letter shot at the end shows
  the top-left quarter of the screen.
- **The trace outside Explain** uses the same unit drawings: a unit of a die with a card shows
  its work on the die (scaled with `unitZoom`) and the tag above it; no window over the unit and
  no side card (a card of text only keeps the side card). While such a unit works and it is at
  least 110 × 70 px on the screen, the rest of the view goes dim (`drawUnitDim`, on the spotlight
  canvas; it fades in and out).
- **The bytes after HLT:** the pipe events of the 486 and the Pentium hold the next instructions
  that the prefetcher took; after a HLT these are the bytes after it (zero bytes decode as
  "add [bx+si], al"). `pipeAfterHalt` (theme.js) makes the stages younger than a HLT empty; the
  board cards (`pipeStages`) and the Die tab use it, and the 486 card says that HLT stops the CPU.
- Text fixes: the 486 has no "U pipe" text (story.js: a 'pipe' event without a pipe), and the
  register card of the 386 and later says that it shows the low 16 bits of 32-bit registers.

## The learner-first pass (v52)

A review of v51 from the side of a person who wants to learn how the machine works (not of the
page as a tool) found that outside Explain the page ran at the pace of an expert: with Run, a
trace step lasted about 1.1 s while its caption had 170 characters (median; up to 485), a cache
line fill on the Pentium was 12 near-identical bus steps, every caption had the same weight, and
the first screen had every control. The changes:

- **The trace plays at a reading pace.** `App.readMs(step)` is the time to read the caption
  (900 ms + 50 ms for each character of the first sentence + 22 ms for each of the rest, scaled
  by the speed slider: 1× at "normal"). When the trace plays by itself (Run, or the auto step
  after Skip) `enterStep` holds the step for `max(animation, readMs)`; the animation keeps its
  own time (`play.animMs`, the `ms` that the views get), so the token does not slow down: the
  step waits after it. Next is not held. Explain has its own reading time and is unchanged.
- **Line fills fold** (story.js `burstStep`, `Story.build` option `burst: 'fold'`): the later
  read transfers of a burst (`e.burst`, `beat > 0`, not a write-back) become one 'bus' step of
  phase 'all' (the views draw it as a short prefetch: the address out, the bytes back) with the
  text "3 more transfers of the burst bring the rest of the 32-byte line ...". The first
  transfer keeps its three steps. The step goes before the steps inside the CPU that came
  during the burst. The default of `Story.build` is `'all'` (the tests see every transfer); the
  page passes `traceBurst` (storage 'traceBurst', default 'fold', the "Line fills" option of the
  trace bar) and `'all'` while Explain runs, because the Explain plan folds the transfers itself.
- **Captions in two layers** (`splitLead` in theme.js: the first sentence, when it is at least
  24 characters, and the rest): the trace bar shows the first sentence in `#trace-text` and the
  rest smaller and muted in `#trace-more` (`App.setTraceText`); the Explain caption wraps the
  rest in `.xp3-more`. The story texts already put what happens first and the details after.
- **The simple view** (`body.view-simple`, storage 'simple', default on; the Simple / Full
  button `#btn-simple` in the stage tools, `App.toggleSimple`): the clock step button, the I/O
  log card and the Runner's Follow / Camera / Into chips rows are away, and the dock has one
  column less (rules in style.css; under 1180 px the page hid the I/O log already). Full shows
  everything as before.
- **The Explain program of the Pentium and the Pentium Pro has six instructions** (`P5` in
  explain3d.js): `mov bl, 0x1F` after `mov al, 'A'` (two simple loads: the Pentium pairs them in
  U and V, and the tour says so: `CPUS[80586].pair`) and `mov [es:1], bl` at the end (the color
  byte of the cell: the letter turns white on blue, a beat "The color on the screen" after the
  write to an odd address). The counts in the tour and the summary come from the list
  (`NUM`). The other models keep the four instructions.
- **The end of Explain leads on** (`.xp3-next`, `Explain.leaveTo`): "Step through it yourself"
  exits with the story program in the editor, the trace on and Next focused; the second button
  opens the first sample of this machine (or the first sample).

## The address of the page (theme.js `URL_PARAMS`, app.js `syncUrl`)

The query of the address can name the state: `?cpu=80486&video=vga&view=die` (and `&explain=1`
starts the guided story). theme.js reads it before the page starts (`URL_PARAMS`): a value in
the address wins over the stored choice and is written to storage, so a reload keeps it. The
names have short forms (486, pentium, p6, bus, mem). app.js keeps the address in step
(`syncUrl`, `history.replaceState`, no new history entry): at the start, at each tab change, and
in the model menu before the reload (the address must name the new model, because it wins at
the load). A file: address does not allow a change of the query; the call is in a try.

## The WebAssembly instruction core (src/core/x86core.c, x86wasm.js)

The 80386, 80486, Pentium and Pentium Pro models run their fast mode (Machine.run, no trace) in C
compiled to WebAssembly. The JavaScript cores (CPU80386 ... CPU80686) stay the reference:
the trace, the steps that the C core sends back, and the faults. The two cores give the same
results, the same clocks, the same prefetch queue, caches, TLBs, bus counters and heat maps.
- **Memory:** Machine486 asks X86W.memory(16 MB) for a WebAssembly.Memory of 336 pages before it
  makes its CPU: the guest RAM (m.mem) is at 4 MB, heat.read / heat.write after it. The machine
  and the bus functions use these views as before. X86W.attach(m) connects the core; after the
  module is ready (a page compiles and instantiates it in the background), the CPU gets views of
  the shared state: cpu.r (regs32), cpu.cr, cpu.dr, cpu.sregs, cpu.qb, cpu.ctag, the 486 cache
  data and LRU bits, cpu.tlbNext, m.idleS / m.idleP.
- **push / pull:** the other fields (EIP, EFLAGS, the segment caches, the TLB entries, the queue
  indices, the REP state, the machine counters) go across before and after each C run and around
  each call back into JavaScript. The C counters (bus.stats, stats.dev, the cache and TLB
  counters) are added to the JavaScript objects in pull(). cache486.lines is only for the views
  (x86wasm.js rebuilds it from cpu.ctag after a run); the cores use cpu.ctag.
- **What goes to JavaScript (needJS):** decided before the instruction starts, from the bytes
  (read with no side effects): INT, INTO, INT3, IRET, the far JMP / CALL / RET, the FPU and WAIT,
  ARPL, POPF in protected mode, IN / OUT / INS / OUTS when the TSS bitmap must be read, the 0F
  system instructions (LGDT, MOV CRn, LAR, CPUID, INVD ...), single step (TF), and the interrupts
  (a pending IRQ or NMI before the instruction). The C core does the rest, also the protected-mode
  loads of data segments and SS, paging and the 486 cache.
- **Faults:** a fault in C (the #GP of a segment check, #PF, #DE, #UD, #AC ...) calls jfault:
  JavaScript delivers it with raise() and ends the instruction with finish(), with the partial
  state of the C instruction (as its own core).
- **Devices:** the machine loop is in C (the 64-clock device groups, the wait-loop skip, the halt
  wait) and calls jtick / jtickn; the ports (jin8 / jout8 / jin16 / jout16) and the VGA window
  (jvrd / jvwr) are JavaScript calls. After each device call the glue sets the IRQ / NMI / A20
  values that the C core reads. A CPU reset in a device call (8042, port 92h) ends the C run.
- **Off:** m.wasmCore = false, X86W.off = true, a trace, breakpoints or the debug registers: the
  JavaScript core runs.
- **The 80386 (V[289] = 1):** Machine386 makes the WebAssembly memory itself (Machine486 gives
  it in opts.wasmMem) and has the run() of the C core. The C core uses the 386 parts:
  - the bus with no cache (memEv386: one cycle for each aligned word or byte, 2 clocks more for a
    word that is not aligned);
  - the 32-entry TLB and the page walk without WP, PCD and PWT;
  - the queue of one bus cycle for each prefetch (prefetch386);
  - the 386 clocks of exec386, and the finish of CPU80386 (the stall fetches in NSTALL = V[288],
    prefetches in the free bus slots, the FPU busy clocks in D[15]).
  The queue of CPU80386 is an array (cpu.q): push / pull copy it to and from the ring (QB, QH,
  QT). XADD, CMPXCHG and BSWAP go to JavaScript (#UD on the 386).
- **The Pentium (V[260] = 1):** the C core has the P5 data and code caches (MESI, write-back,
  the line fill and the write-back burst), the TLBs (the 4 MB TLB, the code TLB), the prefetch
  into cpu.ib, the U / V pairing (pairScan, pairCheck), the BTB and the clock table of the P5
  (clocks586). The glue makes views of dcache, icache, btb, cpu.ib, pipeStats.why and the TLB
  counters; the other P5 fields (pairNext, uClk, wbLine ...) go in push / pull, and the counters
  V[220..239] are added to the JavaScript objects.
- **The Pentium Pro (V[279] = 1, V[260] = 1 too):** x86core.c includes p6ooo.c, so the
  out-of-order model is in the same module. The glue calls cpu.w6Attach with the x86core
  exports (memory, offsets, ooo): the JavaScript core and the C core use the same model state.
  The C core has the P6 front end: the L2 tags (views l2.tag / state / lru), the 4-way code
  cache, the data cache with write-allocate (RFO), the FSB clocks from bus.busRatio and the wait
  states, and the load / store records of the step. The instruction runs as in the 80386 core;
  finish6 gives the inputs to ooo(mode, recipe) as w6Ooo does. The recipe numbers of the opcodes
  (RID1, RIDG1, RID0F, RIDG0F, RIDFP, RIDMISC) come from p686Recipes() in connect6. The decode
  fields (op, op2, mod, reg, rm, osz, a32, rep, lock, seg) go through V[290..299], around each
  JavaScript call and at the start and end of a run.
- **Build:** node tools/buildwasm.mjs (clang with the wasm32 target) makes src/core/x86core.wasm.js.
- **Tests:** tests/x86wasm.test.mjs (tools/x86lockstep.mjs --model 80486 | 80586 | 80686): two
  machines (JavaScript, C) boot DOS 6.22 from drive C: in lockstep, one instruction at a time and
  then in slices of clocks; --long adds DOOM (60 emulated seconds). Machine586 and Machine686
  must give opts.wasm to Machine486 (without it, the JavaScript machine of the test also ran the
  C core). tools/doombench.mjs measures the speed of DOOM (x real time, JavaScript -> C):
  386 1.47 -> 4.40, 486 0.49 -> 1.27, Pentium 0.12 -> 0.29, Pentium Pro 0.028 -> 0.092. On the
  Pentium Pro about half of the time is in the out-of-order model (ooo, sch).
