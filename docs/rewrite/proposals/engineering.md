# Learn: an engineering-first design for the learner page

Designer 3 of 4. Angle: start from the code. The design below fixes the module boundaries, the
build, the interfaces and the checks first, so that five or six people can implement on disjoint
files and a lesson writer can work in data from week two. "The map" is docs/rewrite/01-reuse-map.md
(§ numbers); "the brief" is 00-brief.md. Line numbers are the map's (commit 036454c) and were
re-checked in the working tree where cited as file:line.

## 1 Concept

The new page is a lesson player laid over the machine that already exists. It has five layers and
each layer is one module boundary that one person can own:

1. **Machine** (as-is): the cores, `Asm86`, the BIOS, `Story.build`. Nothing here changes (map §1.2-1.3,
   §2.7.3).
2. **Playback** (extracted): the DOM-free engine now inside `App` (map §3). It assembles, boots,
   steps one instruction, builds the story, and emits events. It has no idea what a screen is. It
   runs in Node, which is how its extraction is tested.
3. **Stage** (new, small): the facade for `BoardView` plus the two drivers the board does not own
   (one rAF loop, one ResizeObserver) and the one method that is allowed to call `traceDur` then
   `traceStep` (map §2.7.1, risk 5). On a machine without WebGL the Stage hosts `DieView` instead
   and every director call becomes a no-op; the lesson still plays as captions and die highlights.
4. **LessonPlayer** (ported): Explain's beat engine, `plan()`, caption rules and `vget/vset`
   (explain3d.js:140-154, 335-441, 477-524, 634-677, 719-777), rewritten to take a lesson object,
   a `Playback` and a `Stage` and nothing else (map §2.7.9, risk 4).
5. **Shell** (new): six screens, the URL, storage. It owns the layout and never touches the machine.

Seven decisions carry the design:

- **One machine per page load.** `theme.js`, `story.js`, `board3d.js`, `blocks.js` and the die
  views freeze `CPU_MODEL` at parse (map §0, risk 1). Switching machines is a link with `?cpu=`;
  `URL_PARAMS` (theme.js:142-160) already writes `a86:cpu` so the choice carries to the old page.
  Cost: zero code. What it buys: story.js, theme.js and board3d.js stay untouched.
- **Zero patches to board3d.js for v1.** Every coupling the map lists is solved outside the file:
  `dieKit` through a `view('runner')` shim (§6.4), `window.__app` through a three-member
  compatibility object, `api.stepMs` on the facade, and `xpCovers`/`trCover` by a layout that puts
  nothing over the stage (so the covers it measures are all zero, board3d.js:7208-7238).
- **Playback is a class with an emitter**, extracted by moving methods, not rewriting them; its
  parity with the old page is checked in Node (deterministic fields) and in Chrome (the old page
  driven by the same script).
- **A lesson is data**: a program, a start point and a list of beats. An `instr` beat expands at
  run time into the story's steps, filtered by the unit stops the lesson names. Captions are
  regenerated from the real machine; a lesson only overrides them.
- **One content module keyed by `'PART/LABEL'`** (the exact `DIE_PLANS` spellings, map §4.7)
  merges the 131 `DIE*_INFO` texts, the 85 card `sub` sentences and the 68 chip tooltips (§5.2), and
  adds the learner's glossary (§5.3, §5.6).
- **Two checkers before any pixel**: a Node script runs every lesson of every machine through
  `Playback` + `Story` + `plan()` and validates every reference; a Chrome script drives a few beats
  per lesson under the virtual clock, asserts state, and screenshots three beats.
- **Spec builders and die plans stay inside board3d.js** for v1 (§6.5). The lift is the one refactor
  that touches a keep-untouched file, and nothing in v1 needs `DIE_PLANS` without `BoardView`.

What this gives the learner, in one paragraph: a screen with three fixed boxes (stage, caption,
controls) and one main button; a beat every 2-4 s that shows one value moving between two named
parts, with a bus step folded to the two or three stops the lesson chose instead of seven; captions
that are true for the program on the screen because the machine computed them; the same lesson
shape on all six machines, so "what a Pentium does differently" is the same program played on a
different board; and a straight path from any beat to Explore (the same stage with the trace) and
to the Workbench (the old page's powers) without losing the machine or the program.

## 2 Screens

All screens share the frame: a 48 px top bar, the stage, a 132 px caption card, a 56 px control
row. At 1280 x 720 the stage is 1280 x 484. The three boxes have fixed heights and never move from
beat to beat (brief principle 4); the caption card scrolls internally if a "More" layer is open.

### 2.1 Lesson (the default screen)

```
+------------------------------------------------------------------------------+
| 8086 Anatomy · Learn      Intel 8086 · 4.77 MHz   [Outline] [Explore] [Wb] [?]| 48
+------------------------------------------------------------------------------+
|                                                                              |
|                         THE 3D BOARD (BoardView host)                        |
|              spotlight on the parts this beat names (xpFocus)                |
|                       token, flow, die window as today                       | 484
|                                                                              |
|   (no toolbar, no legend, no preset buttons, no floating card, no monitor)   |
+------------------------------------------------------------------------------+
| 3 / 27  A code fetch                                       [8086 · Queue]    |
| The BIU sends the address 10102h to the RAM, to keep the queue full.         | 132
| More v   (details layer, opens below the lead, card grows into a scroll box) |
+------------------------------------------------------------------------------+
| [< Back]                 o o o o o O o o o o o o o o o                [Next >]| 56
|            Auto [ ]  1x  (progress dots = beats of this chapter)              |
+------------------------------------------------------------------------------+
```

Rules: `Next` is the main control and has the keyboard (Right, Space). `Back` replays the beat
before (board replays the earlier steps on a jump back, board3d.js:7048-7057). The `[8086 · Queue]`
tag is `xpUnitText(g)` (board3d.js:6500) while the token works in a unit. The details layer is
`splitLead(text)[1]` (theme.js:349-354). A check beat replaces the caption body with the question
and three answer buttons; `Next` is disabled until an answer is chosen.

### 2.2 Outline (the lesson chooser of one machine)

```
+------------------------------------------------------------------------------+
| 8086 Anatomy · Learn      Intel 8086 · 1978                 [Change machine] |
+------------------------------------------------------------------------------+
|  The 8086 PC in eight lessons                            ~70 min in all       |
|                                                                              |
|  1  A letter on the screen          4 instructions   6 min   [done]          |
|  2  The clock and one bus cycle     1 instruction    5 min   [12/19 beats]   |
|  3  Fetch ahead: the queue          a loop           7 min   [Start]         |
|  4  Add, compare, decide            Fibonacci        9 min                   |
|  ...                                                                         |
|                                                                              |
|  Each lesson runs a real program. Open it in the Workbench any time.         |
+------------------------------------------------------------------------------+
```

The list is `LEARN_LESSONS[CPU_MODEL]` (§6.7). Progress is `a86:learn:<model>:<lesson>` (§6.9).

### 2.3 Explore (the same stage with the trace)

```
+------------------------------------------------------------------------------+
| Learn · Explore   hello   instr 7: lodsb    [Lesson] [Workbench]  [Reset]    |
+------------------------------------------------------------------------------+
|                                                                              |
|                        the board, full trace (all stops)                     |
|                                                                              |
+------------------------------------------------------------------------------+
| step 4/15 · data · Memory read     AX 0048 -> 0065   SI 010C -> 010D   ZF 0  |
| The RAM sends the byte 65h ("e") over the data bus. The 8286 transceivers... |
+------------------------------------------------------------------------------+
| [< Step] [Step >]  [< Instr] [Instr >]   [Run to end]   ooooOoooooooooo       |
+------------------------------------------------------------------------------+
```

Explore is `Playback` at its natural pace (`traceNext/tracePrev`, map §3.3) with the chosen unit
stops turned off (every stop plays), the `regs.js` widget (the dock's "registers that changed",
map §1.4 dock row) and the story's own captions unchanged.

### 2.4 Workbench

```
+------------------------------------------------------------------------------+
| Learn · Workbench   8086   [Board] [Die] [Timing] [Memory]   [Lesson] [Explore]|
+---------------------------+--------------------------------------------------+
| ; Hello, 8086             |                                                  |
| start: mov si, message    |                the active view                   |
| next:  lodsb              |                                                  |
|        ...                |                                                  |
| [Assemble+Run] [Load sample v]                                               |
+---------------------------+----------------------+---------------------------+
| Registers  AX BX CX DX .. | Flags  O D I T S Z A P C | CRT (CrtScreen host)   |
| Stack  ...                | Disks  A: B: C: [Boot]   |                        |
+---------------------------+----------------------+---------------------------+
| Reset  Run  Pause  Step  speed ---o----- 1 instr/s                            |
+------------------------------------------------------------------------------+
```

The Workbench is the old page's powers with the old modules behind adapters: `CodeEditor`
(editor.js:69), `StateDock` in its own fixed markup copied from index.html:330-360 (map §2.3 dock
row), `DiskPanel` with index.html:142-219 verbatim (map §1.4 disks row), `TimingView`/`MemoryView`
through the same facade (map §1.4). Speed is `speedAt(pos)` (app.js:1197-1216) unchanged.

### 2.5 Machine chooser

```
+------------------------------------------------------------------------------+
|                    Six PCs, fifteen years. Pick one.                          |
|  [8086 1978]  [80286 1982]  [80386 1985]  [80486 1989]  [Pentium 1993]  [PPro] |
|   4.77 MHz     8 MHz          25 MHz        33 MHz         66 MHz       200 MHz|
|   the start    protected      32-bit,       cache,         two pipes,  µops,  |
|                mode           paging        pipeline       prediction  OOO    |
|  Start with the 8086. Every later machine is told as what changed.            |
+------------------------------------------------------------------------------+
```

Each tile is `<a href="?cpu=80286">` (a reload). The six lines come from index.html:28-48 (§5.1).

### 2.6 First visit

One card over the Lesson screen, once (`a86:learn:seen`): "This page shows what happens inside a
PC when it runs a program. Press Next. Nothing moves until you do." with `[Start lesson 1]` and
`[I know PCs: pick a lesson]`. Under 40 words; no tour of controls, because there are three.

### 2.7 Phone (degrade, brief principle 8)

Below 900 px or when `BoardView.ok === false`: the stage hosts `DieView` (die.js:169-190) with
`select(id)` highlights instead of `xpFocus`; captions and checks unchanged; the Workbench link
hidden. `Stage` decides once at construction (§6.4).

## 3 The lesson data model

### 3.1 Schema (`src/learn/lessons/*.js`, plain object literals, validated by `tools/learn-check.mjs`)

```js
// One lesson. Everything a writer needs is in this object; the player needs no code per lesson.
const Lesson = {
  id: 'letter',                       // [a-z0-9-]+, unique per machine; in the URL (?lesson=letter)
  machine: '8086',                    // the CPU_MODEL this lesson is written for
  title: 'A letter on the screen',
  idea: 'A program is bytes; the CPU moves them over the bus; one byte in the video memory is a letter.',
  minutes: 6,                         // for the outline; the checker compares it with the beat budget
  program: { sample: 'hello' } | { src: '...', name: 'letter' },   // SAMPLES id (bios.js:2680+) or inline
  video: 'cga',                       // optional; 'vga' lessons only on a VGA page
  from: { instr: 0 } | { label: 'again', pass: 2 } | { ip: 0x0113 },  // where tracing starts after boot
  count: 4,                           // instructions traced by this lesson (the rest runs fast)
  beats: [ /* Beat */ ],
};
```

Beat kinds (one key decides the kind; the checker rejects a beat with two):

```js
{ say: 'text', focus: ['cpu', 'clk'], card: { ... }, ms: 6000, fly: true }
   // a tour beat: caption + spotlight; no machine step. focus ids are xpBox ids (board3d.js:6676),
   // 'die:<decapKey>' opens a die. card is a BlockPanel spec (blocks.js:1446-1453) shown as xpCard.
{ instr: 0 | 'lodsb' | { label: 'next', pass: 1 },
  say: 'Instruction 1: mov ax, 0B800h. Put the number B800h in AX.',   // the chapter's intro beat
  stops: ['8086/QUEUE', '8086/DECODER', '8086/REGISTERS', '8282/*'] | 'all' | 'none',
  fold: { fetch: 'quick', cmd: true },        // later fetches quick (650 ms); addr+cmd as one beat
  captions: { 'inside:Decode': '...', 'bus:data:fetch': '...' },   // overrides by step selector
  skip: ['bus:addr:fetch'] }                  // steps not shown at all (their events still dispatch)
   // runs one instruction and expands into: intro beat, the story steps chosen by stops/fold/skip
   // in plan() order, the screen beat if the instruction writes video memory, the Done beat
{ run: { until: { label: 'done' } | { instrs: 12 } | { ip: 0x0120 } }, say: 'The loop repeats 12 times...' }
   // fast-forward with one caption (Playback.startFF, map §3.3)
{ screen: true, say: '...The letter appears.' }
   // reveals the video memory bytes held back by vget/vset; auto-inserted by an instr beat that
   // writes vram, or placed by hand
{ check: { ask: 'Where is the letter now?', options: ['In AX', 'In the RAM at B8000h', 'On the wire'], answer: 1,
           why: 'The CPU wrote it to the video memory. The CGA card reads it from there.' } }
{ term: 'bus' }
   // a one-line meaning from LEARN_TERMS (auto-inserted the first time a caption uses the word;
   // explicit for a term the writer wants early)
{ compare: { machine: '80586', lesson: 'letter', beat: 'instr:0' }, say: 'On a Pentium the same fetch...' }
   // a link beat (reload with ?cpu=...&lesson=...&beat=...)
```

Step selectors (used by `stops`, `captions`, `skip`; matched against `Story` step fields,
story.js:219+ and map §2.7.3): `'<kind>'`, `'<kind>:<phase>'`, `'<kind>:<phase>:<I.kind>'`,
`'inside:<title>'`, `'bus:data:vram'` (the `I.dev`). Examples: `inside:Decode`,
`inside:Address calculation`, `bus:addr:fetch`, `bus:data:memr`, `irq`, `cache`, `page`, `uop`.

Unit stops: `'PART/LABEL'` with `PART` a `DIE_PLANS` key and `LABEL` a block label of that part
after the `BLK_*` remap (board3d.js:733-856, 857-882; map §4.7); `'PART/*'` keeps the chip's visit
with its default first card; a chip not listed is passed through (the token still travels).

Caption templates: `{val} {tag} {from} {to} {addr} {ip} {cycles} {reg} {text}` from
`s.token.val/tag`, `s.fromName/toName`, `s.I.addr` (hex with h), `play.cs/ip`, `play.cycles`, the
last `reg` event, `story.text`. Hex tokens are bolded by the same regex Explain uses
(`/(\b[0-9A-F]{2,5}h\b)/g`, explain3d.js:432). Plain English sentences only; the checker enforces
lead ≤ 110 characters and whole caption ≤ 230 (Explain's split threshold, explain3d.js:426).

### 3.2 How an `instr` beat expands (`LessonPlayer.expand`, §6.6)

1. `play.traceNext()` runs the instruction and builds the story (`Playback.beginInstr` →
   `Story.build(events, { prefetch: 'parallel', burst: 'all' })`, app.js:1329-1373, 389).
2. `LearnPlan.order(steps, { cacheLine, fold })` (the port of `plan(k, steps)`, explain3d.js:335-389)
   returns `[{ i, quick, cap? }]`: fetches that bring this instruction's bytes before Decode, a
   line fill as one full cycle plus one quick beat for the rest.
3. Entries whose selector is in `skip` are removed; their events still reach the views because
   `enterStep(i)` dispatches every event up to `s.t` (app.js:642).
4. For each remaining entry the player calls `stage.showStep(story, i, { ms, back, auto, stops })`
   (§6.4) and `LearnPlan.caption(step, ctx, overrides)` (the port of `stepMs()`, explain3d.js:407-441)
   for the text; a caption over 230 characters splits into two beats at the sentence nearest the
   middle (explain3d.js:426-433).
5. If the story has a `bus:data:vram` write step the player holds the video bytes back
   (`vget(16)` before the instruction, `vset(before)`, explain3d.js:274-278) and reveals them at
   80 % of that step (296-298), then inserts the `screen` beat (306-312) unless the lesson placed one.
6. A `Done` beat closes the chapter (explain3d.js:314-317): "Done: IP moves to {ip}. This one took
   {cycles} clocks."

### 3.3 A full lesson: `letter` on the 8086

```js
const LETTER_SRC = String.raw`; A letter on the screen: four instructions
        org 0x100
        mov ax, 0xB800      ; the segment of the video memory
        mov es, ax          ; ES points at it
        mov al, 'A'         ; the letter
        mov [es:0], al      ; the first cell of the screen
        ret                 ; back to the PSP: INT 20h ends the program
`;

LESSONS_8086.push({
  id: 'letter', machine: '8086', title: 'A letter on the screen', minutes: 6,
  idea: 'A program is bytes in the RAM. The CPU fetches them over the bus, and one byte written to the video memory becomes a letter.',
  program: { src: LETTER_SRC, name: 'letter' },
  from: { instr: 0 }, count: 4,
  beats: [
    { say: 'This program has four instructions. The assembler turned each line into bytes. The CPU sees only these bytes.',
      focus: [], fly: false, ms: 6000 },                                  // explain3d.js:260
    { say: 'The 8086 CPU runs them, at 4.77 MHz. Inside it, the bus interface unit fetches bytes and the execution unit works on them.',
      focus: ['cpu', 'clk'], ms: 7000 },                                  // 261 + CPUS.inside
    { term: 'clock' },
    { say: 'One clock is 210 ns (4.77 MHz). The crystal gives 14.318 MHz and the 8284A divides it by 3.',
      focus: ['die:clk'], card: { kind: 'wave', title: 'Clock', chip: '8284A', lines: ['OSC 14.318 MHz', 'CLK 4.77 MHz', 'PCLK 2.39 MHz'] }, ms: 8000 },
    { term: 'bus' },
    { say: 'The CPU talks to everything through the bus: the 8282 latches hold the address, the 8286 transceivers pass the data, the 8288 makes the commands, and the 74LS138 decoder selects the chip that answers.',
      focus: ['cpu', 'lat0', 'lat1', 'lat2', 'xcv0', 'xcv1', 'bus', 'dec'], ms: 7500 },
    { say: 'The program bytes are in the RAM, in two banks: even addresses and odd addresses, from address 10100h.',
      focus: ['ramE', 'ramO'], ms: 5000 },
    { say: 'The CGA card has its own video memory at B8000h. It draws the screen from it 60 times a second. Now the screen is empty.',
      focus: ['cga', 'monitor'], ms: 6000 },
    { check: { ask: 'Where is the program right now?', options: ['Inside the CPU', 'In the RAM', 'On the screen'], answer: 1,
               why: 'The CPU has not fetched a byte yet. The bytes wait in the RAM at 10100h.' } },

    { instr: 0, say: 'Instruction 1: mov ax, 0B800h. Put the number B800h in register AX. Its bytes: B8 00 B8.',
      stops: ['8086/QUEUE', '8086/DECODER', '8086/REGISTERS', '8282/*', '8288/*', '2118/*'],
      fold: { fetch: 'quick', cmd: true },
      captions: {
        'bus:addr:fetch': 'The BIU puts the address {addr} on the bus. The 8282 latches hold it while the cycle runs.',
        'bus:data:fetch': 'The RAM answers with the code bytes {val}. They go into the queue, 6 bytes deep.',
        'inside:Decode':  'The decoder reads B8: "load a 16-bit number into AX". The number is the next two bytes, low byte first.' } },
    { check: { ask: 'The bytes 00 B8 came back from the RAM. What number is that?', options: ['00B8h', 'B800h', 'B8h'], answer: 1,
               why: 'The 8086 stores the low byte first (little endian): 00 then B8 is B800h.' } },

    { instr: 1, say: 'Instruction 2: mov es, ax. Copy AX into the segment register ES. The value goes from the EU to the BIU. Nothing goes on the bus.',
      stops: ['8086/REGISTERS', '8086/SEGMENT REGS'], fold: { fetch: 'quick' } },   // explain.js:227
    { term: 'segment' },

    { instr: 2, say: 'Instruction 3: mov al, 41h. Put 41h, the code of the letter A, in AL, the low half of AX.',
      stops: ['8086/DECODER', '8086/REGISTERS'], fold: { fetch: 'quick' }, skip: ['bus:addr:fetch', 'bus:cmd:fetch'] },

    { instr: 3, say: 'Instruction 4: mov [es:0], al. Write AL to the first byte of the video memory: ES x 16 + 0 = B8000h.',
      stops: ['8086/ADDRESS ADDER', '8086/BUS CONTROL', '8282/*', '8288/*', '74LS138/*', '2118/*'],
      fold: { fetch: 'quick' },
      captions: {
        'inside:Address calculation': 'The address adder makes B800h x 16 + 0 = B8000h: a 20-bit address from two 16-bit numbers.',
        'bus:cmd:memw': 'The 8288 sends MWTC: memory write. The decoder sees B8xxxh and selects the CGA card, not the RAM.',
        'bus:data:vram': 'The byte 41h travels the data bus into the video memory. The address is even, so it uses the low 8 wires.' } },
    { screen: true, say: 'The CGA card reads its video memory 60 times a second to draw the screen. At its next frame the first cell holds 41h = the letter A (color byte 07h: grey on black). The letter appears.' },
    { check: { ask: 'Which chip put the letter on the screen?', options: ['The 8086', 'The CGA card', 'The 8288'], answer: 1,
               why: 'The CPU only wrote a byte to an address. The card draws from that memory on its own, 60 times a second.' } },
    { say: 'Four instructions, {cycles} clocks: {us} at 4.77 MHz. The CPU had to fetch each code byte over the bus before it could use it, and one byte to the video memory made a letter. That is all a program does: move bytes and calculate.',
      focus: ['screenTL'], ms: 9000 },                                    // explain3d.js:274
    { compare: { machine: '80586', lesson: 'letter', beat: 'instr:0' }, say: 'The same four instructions on a Pentium: 32 bytes arrive in one burst and two instructions run at once.' },
  ],
});
```

Sizes: 52 lines of data for a six-minute lesson. `{cycles}` and `{us}` in the summary are filled
from the chapter totals (explain3d.js:271-273). The same lesson object with `machine: '80586'`
and Pentium stops (`'Pentium/ICACHE'`, `'Pentium/U PIPE'`...) is the Pentium's lesson 3 (§4).

## 4 The curriculum for v1

Nine lessons on the 8086 (the first visit), five or six on each later machine, told as "what
changed". Programs are `SAMPLES` ids (bios.js:2680-7968, map §5.4) unless marked new; new programs
are under 20 lines and live in `src/learn/lessons/programs.js`. `from`/`count` pick the traced
instructions; the rest of the sample runs fast so its screen output stays real (brief principle 5).

### 8086 (`?cpu=8086`, CGA)

| # | id | Title | Program | Traced | The idea | Gap closed (§5.6) |
|---|---|---|---|---|---|---|
| 1 | letter | A letter on the screen | new `letter` (Explain SRC, explain3d.js:11-18) | 4 instr | bytes, registers, bus, RAM, video memory | 1, 7, 15, 25 |
| 2 | cycle | The clock and one bus cycle | `letter` | instr 0 with all stops | T1-T4, ALE, the latches, MRDC, 210 ns | 5, 6 |
| 3 | queue | Fetch ahead, then a jump | `hello` (jmp next, bios.js:2685-2693) | `lodsb`..`jmp` (6) | the 6-byte queue, why fetch ahead, what a jump costs | 8 |
| 4 | alu | Add, compare, decide | `fib` (bios.js:2699+) | `add ax,bx`..`jmp again` (4) | ALU, flags as the result, JC decides from CF | 3, 9 |
| 5 | segs | Where an address comes from | `sort` | one swap pass (5) | segment x 16 + offset, DS vs ES, even/odd banks | 4, 7 |
| 6 | stack | The stack: CALL and RET | `fact` | `call`..`ret` of one level (6) | SS:SP, push/pop, return address, recursion | 10 |
| 7 | irq | The timer interrupt | `clock` (bios.js:2939+) | the IRQ0 step + 4 of the handler | INTA cycles, vector 08h, the IVT, IRET; polling vs interrupts | 11 |
| 8 | ports | Keys, ports and HLT | `keys` | `hlt`, IRQ1, `in al,60h` (5) | I/O ports vs memory, IORC, status bits, waiting | 12 |
| 9 | fpu | The 8087 watches the bus | `pi` | `fldpi`, `fmul` (3) | a second CPU on the same bus, QS0/QS1, BUSY | 16 |

### 80286 (`?cpu=80286`)

| # | id | Title | Program | Traced | The idea |
|---|---|---|---|---|---|
| 1 | changed | What changed: 24 bits, 2 clocks | `letter` | 4 instr | A0-A23, 74LS573/74LS245/82288, Ts/Tc, 1 wait state (§5.1) |
| 2 | pm | Protected mode: a table of descriptors | `pm286` | `lgdt`..first far jump (7) | why protection, GDT, descriptor cache, CPL |
| 3 | fault | Catching a #GP | `pm286` (second part) | the faulting instr + handler (6) | exceptions, error code, the 8042 reset to leave protected mode |
| 4 | a20 | The 1 MB wrap and the A20 gate | `a20` | two writes (6) | FFFF:0010 lands at 0 or at 100000h; port 92h; extended memory |
| 5 | frames | New instructions for the stack | `ins186` | `enter`..`leave` (5) | stack frames, `push imm`, `pusha` |

### 80386 (`?cpu=80386`)

| # | id | Title | Program | Traced | The idea |
|---|---|---|---|---|---|
| 1 | changed | What changed: 32 bits on a 16-bit bus | `fib32` | `add eax,ebx`, one dword store (4) | EAX, two bus cycles per dword, BHE/BLE |
| 2 | paging | Paging: linear to physical | `paging` | `mov cr3`, `mov cr0` (PG), first mapped write (5) | why virtual memory, directory, table, A and D bits |
| 3 | tlb | The TLB is a cache of translations | `paging` (second write) | 3 | hit vs walk, 32 entries, `invlpg` |
| 4 | bits | The barrel shifter | `bits` | `shld`, `bsf` (3) | shifts by count in one pass; bit tests |
| 5 | v86 | Protected mode on a 386 | `pm286` (runs on 386, §5.4) | 5 | descriptors again, now 32-bit; what the 286 could not do |

### 80486 (`?cpu=80486`)

| # | id | Title | Program | Traced | The idea |
|---|---|---|---|---|---|
| 1 | changed | What changed: a cache and a pipeline | `letter` | 4 instr | the 16-byte line fill (burst of 8), hits after the miss, PF D1 D2 EX WB |
| 2 | cache | The 8 KB cache | `cache` | the timed loop's first misses (6) | the speed gap, sets and ways, hit/miss, write-through |
| 3 | pipe | Five stages | new `pipe5` (8 independent `add`s) | 6 | overlap, 1 clock per instruction, a stall on a memory operand |
| 4 | cpuid | Which CPU is this? | `cpuid` | `pushf`..`cpuid` (5) | flags as feature tests; the ID bit |
| 5 | atomic | BSWAP, XADD, CMPXCHG | `atomic` | 4 | endianness; an atomic read-modify-write as a lock |

### Pentium (`?cpu=80586`)

| # | id | Title | Program | Traced | The idea |
|---|---|---|---|---|---|
| 1 | changed | What changed: two pipes | `p5pairs` | 4 paired + 2 dependent | U and V, pairing rules, a dependency |
| 2 | btb | Guessing the jump | `btb` | 3 passes of the `jz` (6) | why predict, the 2-bit counter, the cost of a wrong guess |
| 3 | letter | The letter, 64 bits at a time | `letter` (P5 colour variant, explain3d.js:16-17, 309) | 5 instr | 64-bit bus, 32-byte line, code and data caches, MESI |
| 4 | rdtsc | Counting clocks | `rdtsc` | 3 | RDTSC, 50 ms of the 8254, MHz |
| 5 | fdiv | A famous bug | `fdiv` | `fdiv`, `fbstp` (2) | the FDIV table, why the 4th digit |
| 6 | bigpage | A 4 MB page | `4mbpage` | 3 | PSE, one PDE, fewer walks |

### Pentium Pro (`?cpu=80686`)

| # | id | Title | Program | Traced | The idea |
|---|---|---|---|---|---|
| 1 | changed | What changed: µops out of order | `ooo` | the `div` + 3 `add`s | decode into µops, the ROB, an ADD passes a DIV |
| 2 | rename | Renaming registers | `rename` | 4 | RAT, ROB entries, why writes to EAX do not wait |
| 3 | l2 | L1, L2 and memory | `l2` | one read per array (3) | 3 clocks, 7 clocks, 22+ clocks; the back-side bus |
| 4 | cmov | A move instead of a jump | `cmov` | `cmp`+`jl` vs `cmovl` (4) | the cost of a mispredict; predication |
| 5 | pmc | Counting from inside | `pmc` | `wrmsr`, `rdpmc` (3) | performance counters, IPC |
| 6 | letter | The letter on a P6 | `letter` | 5 instr | decoders 4-1-1, retirement in order, the L2 in the package |

Totals: 36 lessons, 31 from existing SAMPLES, 2 new programs (`letter`, `pipe5`). Machine checks
(tests/machine.test.mjs:70-110) give the expected screen text of every sample, which
`tools/learn-check.mjs` reuses to assert the fast-run part still prints what it should.

## 5 The pacing model

All numbers are in animation-clock ms (`animNow()`, theme.js:340-345); `speed` scales the clock
(`AnimClock.setScale`), so one number set serves 0.5x, 1x, 1.5x.

| Quantity | Value | Where it comes from |
|---|---|---|
| Read time of a caption | `900 + lead·50 + rest·22` ms | app.js:393-396 (`readMs`), at `stepMs/1100 = 1` fixed |
| Caption limits | lead ≤ 110 chars (≈ 6.4 s max read); whole ≤ 230, else split | explain3d.js:426 threshold kept; checker enforces |
| Beat time | `max(animMs, readMs) + 400` settle; target 2-4 s; cap 6 s (a longer beat is split by the checker's report) | explain3d.js:441 shape (`+500` → `+400`) |
| Tour beat (`say`) | `ms` given, default `readMs + 1200` for the camera | explain3d.js:260-267 (5-9 s today → 4-7 s) |
| Unit stop (dwell) | 1400 ms work incl. the card; `xpTime.work = 0.8` | board3d `xpTime` (map §4.4), Explain's `set.work` 1.0 |
| Board leg (token travel) | ≤ 1000 ms per step; `xpTime.travel = 0.6` | map §4.4 |
| Stops per bus step | 2-3 named by the lesson (default when `stops: 'all'`: today's 6-7) | §3.2 step 4 |
| Quick step (a later fetch, a line's other cycles) | `ms = 650`, one shot, quarter work | explain3d.js:395-398, board3d.js:6338-6343 |
| Camera move | at most one per beat; 1100 ms during a step, 1300 ms `flyTo` between chapters; none when `fly: false` | board3d.js:4212, xpFocus (6696) |
| Camera angles | `theta 0.22, phi 0.85` default; summary `theta 0.08, phi 1.42` | xpFocus defaults, explain3d.js:275 |
| Die dive | only at a stop inside a die; the board's own 650 ms window open | board3d.js:5346 |
| Events pace inside a step | `clockMs = clamp(stepMs/4, 20, 250)` | app.js:1355 (unchanged) |
| Auto | on: advance at beat end; pauses on `check`, on `screen`, at the end of a chapter on the first visit; off: `Next` only | explain3d.js `set.wait` semantics (480-486) generalised |
| Speeds | 0.5x, 1x, 1.5x (Explain's `setSpeed`, 743-748); no slow-motion slider in Lesson | app.js `MOTION` stays in the Workbench |
| Reduced motion | `animMs = 0`, instant camera (`setReducedMotion(true)`, board3d.js:3970); beats are read time + 400 | |
| Lesson budget | 8086 lesson 1: 8 tour + 4×(1 intro + ~5 steps + 1 done) + 1 screen + 3 checks + 1 summary ≈ 41 beats × 3.1 s ≈ 2.1 min of animation; with reading at the learner's pace 5-7 min | the `minutes` field; the checker prints both |
| First visit | lessons 1-3 of the 8086 ≈ 18 min | brief: twenty minutes |

The checker (`tools/learn-check.mjs --pace`) prints per lesson: beats, sum of `readMs`, sum of
the modelled `animMs` (with `durOf = (s) => 600 + 1400·stops(s) + 800·legs(s)` in Node, the real
`traceDur` in Chrome), beats over 6 s, captions over the limits.

## 6 The reuse plan and the module list

### 6.1 Layout and build

New directory `src/learn/` (LF). The build gets a page table; `node build.mjs` alone still builds
the old page byte for byte (the `anatomy` page is the present `SCRIPTS`, build.mjs:11-56).

```js
// build.mjs (CRLF file; patch in place). Usage: node build.mjs [--page anatomy|learn] [--out f] [--skip a.js,b.js]
const CORE = SCRIPTS.slice(0, 26);                 // asm + core + bios + vgabios (build.mjs:12-37)
const UI = ['src/ui/theme.js', 'src/ui/audio.js', 'src/ui/crt.js', 'src/ui/editor.js', 'src/ui/dock.js', 'src/ui/disks.js',
  'src/ui/tips.js', 'src/ui/sfx.js', 'src/ui/story.js', 'src/ui/blocks.js', 'src/ui/unitfx.js', 'src/ui/die.js',
  'src/ui/timing.js', 'src/ui/memmap.js', 'src/ui/board3d.js'];            // theme.js first (map §6.1)
const PAGES = {
  anatomy: { entry: 'src/index.html', styles: ['src/ui/style.css'],
             scripts: [...CORE, ...UI, 'src/ui/explain3d.js', 'src/ui/topview.js', 'src/ui/app.js'], out: 'dist/8086-anatomy.html' },
  learn:   { entry: 'src/learn/learn.html', styles: ['src/ui/style.css', 'src/learn/learn.css'],
             scripts: [...CORE, ...UI,
               'src/learn/content.js', 'src/learn/plan.js', 'src/learn/lessons/programs.js',
               'src/learn/lessons/l8086.js', 'src/learn/lessons/l286.js', 'src/learn/lessons/l386.js',
               'src/learn/lessons/l486.js', 'src/learn/lessons/l586.js', 'src/learn/lessons/l686.js', 'src/learn/lessons/index.js',
               'src/learn/playback.js', 'src/learn/facade.js', 'src/learn/regs.js', 'src/learn/player.js',
               'src/learn/explore.js', 'src/learn/workbench.js', 'src/learn/shell.js'], out: 'dist/learn.html' },
};
const page = PAGES[argOf('--page') || 'anatomy'];
```

About 45 lines change in build.mjs: `SCRIPTS`/`STYLES`/`read('src/index.html')`/default `out`
become `page.scripts/styles/entry/out` (build.mjs:11-57, 75-88). `--skip` and `--artifact` stay.
`pages.yml:28` gets one more line: `node build.mjs --page learn --out _site/learn.html`.

Why load `style.css` whole and override: the injected stylesheets of every reused view assume
the tokens and the five palettes of style.css:1-188 (map §2.5); slicing a file in the build or
copying the block into learn.css both drift. `learn.css` loads after and overrides the four rules
that fight a new layout (`html,body{height:100%}`, `body{overflow:hidden}`, map §1.4 style row);
the `.layout .topbar .transport .tabs .dock .trace` families are unused because the new markup does
not use those class names. Cost: ~70 KB before gzip.

`learn.html` (≈120 lines) carries `<style>/*STYLE*/</style>` and `<script>/*SCRIPT*/</script>`
(index.html:11, 428), the `<title>`, viewport, `color-scheme`, favicon, and ~25 ids (§6.8).
`window.__learn = { shell, play, stage, player }` is the tools' surface (the analogue of
`window.__app`, app.js:1583).

Wasm cores: kept in the page (Workbench "run at full speed", map §1.3 x86core row). The one machine
is built with `{ video, soundCard: true, wasm: !phone }`, so the 21 MB `WebAssembly.Memory`
(machine386.js:27) is allocated once, never on a phone.

### 6.2 The module list

| File | Lines (est.) | Verdict | Reuses | Owner (WP) |
|---|---|---|---|---|
| `src/asm/*`, `src/core/*` (26 files) | 28k | as-is | — | — |
| `src/ui/theme.js audio.js crt.js editor.js sfx.js story.js blocks.js unitfx.js die.js timing.js memmap.js board3d.js` | — | as-is, no patch | — | — |
| `src/ui/dock.js`, `disks.js`, `tips.js` | — | as-is behind adapters (Workbench only) | — | WP9 |
| `src/ui/explain3d.js`, `topview.js`, `app.js` | — | not in the learn page | mined | — |
| `build.mjs` | +45 | extract: page table | — | WP0 |
| `src/learn/learn.html` | 120 | new | index.html markers, head | WP0 |
| `src/learn/learn.css` | 450 | new | tokens via style.css; `.btn .card* .tip .crt kbd .sr-only` | WP7 |
| `src/learn/playback.js` | 560 | extracted from app.js | §3 ranges (app.js:4-30, 112-131, 133-151, 389-398, 499-655, 1081-1155, 1197-1307, 1316-1499, 1542-1578) | WP1 |
| `src/learn/facade.js` (`makeFacade`, `Stage`) | 220 | new | map §2.8 sketch; drivers of §2.7.1 | WP2 |
| `src/learn/plan.js` (`LearnPlan`) | 240 | ported, pure | explain3d.js:335-441 | WP3 |
| `src/learn/player.js` (`LessonPlayer`) | 480 | ported + generalised | explain3d.js:140-154, 259-330, 477-524, 634-677, 719-777 | WP3 |
| `src/learn/content.js` (`LEARN_UNITS LEARN_TERMS LEARN_CHIPS`) | 700 (data) | new, merges | die.js `DIE*_INFO`; board3d tcard subs (1626-2082), `INFO` (210-296); blocks.js `GLOSS` via `BlockPanel.termTip` | WP4 |
| `src/learn/lessons/programs.js` | 60 | new | explain3d.js `SRC` 11-18 | WP5 |
| `src/learn/lessons/l8086.js` | 520 (data) | new | SAMPLES, §5.5 narratives verbatim | WP5 |
| `src/learn/lessons/l286.js … l686.js` | 5 × 300-360 (data) | new | SAMPLES headers, `CPUS` explain3d.js:23-37 | WP6 |
| `src/learn/lessons/index.js` (`LEARN_LESSONS`) | 60 | new | — | WP5 |
| `src/learn/regs.js` (`RegsWidget`) | 160 | extracted | dock.js `DOCK_REGS*`, `read/fmt/show/setReg/renderFlags/hot` (≈120 lines, map §1.4) | WP8 |
| `src/learn/explore.js` (`ExploreScreen`) | 300 | new | Playback trace API; story captions | WP8 |
| `src/learn/workbench.js` (`WorkbenchScreen`) | 450 | new + adapters | `CodeEditor`, `StateDock(appShim)`, `DiskPanel(appShim)`, `TimingView`, `MemoryView`, `speedAt` | WP9 |
| `src/learn/shell.js` (`LearnShell`, `startLearn`) | 520 | new | index.html:25-60, 389-424 texts | WP7 |
| `tools/launch.mjs` | 30 | new | map §6.5 launch block | WP0 |
| `tools/names.mjs` | 40 | new | — | WP0 |
| `tools/learn-check.mjs` | 260 | new | tests/story.test.mjs loader (13-17), machine.test expected outputs | WP10 |
| `tools/learn-shots.mjs` | 200 | new | uxshots/xpmotion skeleton, `__vt` clock (xpfilm.mjs:31-43) | WP10 |
| `tools/playback-parity.mjs` | 120 | new | shot.mjs launch | WP1 |
| `tests/playback.test.mjs`, `tests/plan.test.mjs`, `tests/lessons.test.mjs` | 150 / 90 / 60 | new | story.test loader | WP1, WP3, WP10 |

New code ≈ 4,900 lines plus ≈ 2,900 lines of lesson and content data. Nothing in `src/ui/` is
edited for v1 except `build.mjs`.

### 6.3 Playback (`src/learn/playback.js`)

Extraction rule: each method keeps its body from app.js and loses its DOM sinks, which become
events. The map's interface (§3.3) is adopted with these precise changes:

```js
class Playback {
  constructor(machine, { model, cpuAsm, video, tracePre = 'parallel', traceBurst = 'all', traceRep = 'once',
                         reducedMotion = false, durOf = (s, ms) => ms, watchBoot = false })
  on(name, cb) → () => void (unsubscribe);  emit(name, ...args)                // app.js:112-131 emitter shape
  // program
  buildRom({ makeFont8x8, makeVgaFont }) → { rom, symbols, vgaRom }             // 133-151; the two font fns injected
  assemble(src) → { ok, errors, bytes, origin, symbols, lineMap }               // 1081-1099
  load(program) → void                                                           // 1096-1098 (addrLine Map)
  boot({ disk = null, drive = 'A' } = {}) → void                                 // 1115-1146; emit('reset')
  runTo(where: { instr: n } | { label } | { ip } | { pass }) → { instrs, clocks } // NEW: raw cpu.step()+tickDevices until the condition (a lesson's `from`)
  setBreakpoints(lines: Set<number>) lineOf(phys) → number
  // one instruction
  beginInstr(now, clockMs = null, manual = false, single = false) → boolean     // 1329-1373; emit('instr', events, info)
  dispatchUntil(t) → void                                                       // 1375-1386; emit('event', e, clockMs); emit('caption', text)
  finishInstr() → void                                                          // 1387-1402; emit('instrEnd', { play, text, regs, reason })
  stepInstr() stepClock() skipHalt() → boolean  stuck() → boolean  pokeKeyboard()
  // story
  buildStory(events) → Story                                                    // 389
  enterStep(i, { back = false, quick = false } = {}) → void                     // 638-655; ms = quick ? 650 : stepMs; animMs = durOf(s, ms); emit('step', story, i, { ms: animMs, back, auto })
  traceNext() tracePrev() traceGo(i) traceSkip()                                // 499-545, 623-637
  readMs(step) → ms   get stepMs()   get tracing()                              // 393-398
  // fast paths
  startFF(why, until) ffFrame() ffStop(reason)                                  // 546-611; emit('ff', state)
  fastFrame(dt) → void                                                          // 1460-1499; emit('audio', spk, snd); emit('fast', stats)
  // frame
  tick(vnow, vdt, realDt) → void                                                // 1420-1436 minus crt/disks/views
  explainFrame(vnow) → void                                                     // 1437-1459
  // speed
  speedAt(pos) setSpeedPos(pos) setMotion(i) start() pause() toggleRun()        // 1197-1277; emit('speed'), emit('mode')
  // helpers and state (unchanged names)
  codeMask() codeOpts() linPhys() codePhys() codeByte() isSeen()                // 519-524
  play ff running mode spd speedPos speedIdx seen traceCount lastTraced addrLine program bootMode bootDrive
}
function caption(e) → string                                                   // app.js:1556-1578, pure, top-level (name is free once app.js is out, map §6.1)
```

Events (the complete list, fan-out order fixed): `reset` · `instr(events, info)` · `event(e,
clockMs)` (listeners are called in subscription order, so the Stage subscribes `dock.event` before
the views, app.js:1381-1382) · `caption(text)` · `step(story, i, info)` · `instrEnd(x)` · `ff(state)`
· `fast(stats)` · `audio(spk, snd)` · `speed` · `mode` · `traceClear` · `status(text, cls)` ·
`announce(text)`.

`quick` replaces Explain's mutation of `spd.stepMs` (explain3d.js:395-398). `durOf` replaces the
`activeView.traceDur` lookup (app.js:645-646): the Stage passes `(s, ms) => board.traceDur(s, ms)`,
Node tests pass a model. `traceBurst` defaults to `'all'` because the lesson player folds bursts
itself (`plan()`); Explore passes `'fold'`.

Globals Playback needs (map §2.4 app row): `Asm86 Disasm86 biosSource Machine* Story PROG_SEG
AnimClock animNow splitLead clamp hex4` plus `CPU_HZ` for `SPEEDS`. The three names `SPEEDS
TRACE_MS MOTION` move with it (free once app.js is excluded, map §6.1).

How the extraction is tested:

- `tests/playback.test.mjs` (Node, no DOM): loads the story.test.mjs file list (15-17) but **not**
  its `var CPU_MODEL` line (14), because `theme.js` declares `const CPU_MODEL` itself (theme.js:162)
  and a second declaration is a SyntaxError. Instead the test defines, before theme.js,
  `globalThis.localStorage = { getItem: k => k === 'a86:cpu' ? JSON.stringify(MODEL) : k === 'a86:video' ? JSON.stringify(VIDEO) : null, setItem() {} }`
  and `globalThis.document = { documentElement: { classList: { add() {} } } }` (168-182); `location`
  stays undefined, which the `URL_PARAMS` try block swallows (144-158). Then `story.js`, `playback.js`.
  It boots `hello` on the
  8086 with the correct order (reset → loadProgram → poke 4F0, map §3.2, not story.test's 41),
  asserts the hand-off state `CS=DS=ES=SS=1000h IP=0100h` (map §3.2), then `traceNext()` until the
  program ends and checks: every `instr` event carries `events.length ≥ 1` and a decode; the number
  of `event` emissions per instruction equals `events.length`; `step` fires `steps.length` times per
  traced instruction with `i` ascending; `caption(e)` is non-empty for `decode/reg/flags/bus`;
  `startFF('loop', ...)` returns to the trace at the next unseen address; `speedAt(20).stepMs ===
  1700`. Runs in about 2 s.
- `tools/playback-parity.mjs` (Chrome, the OLD page): seeds `a86:src` with `hello`, `a86:trace`
  true, drives `__app.traceNext()` 200 times and records per step `[play.story.text, play.si,
  steps.length, play.clockMs, play.cycles, cpu.ax..flags]`; the same script runs `Playback` in Node
  with the same seed and diffs the records. Fields that depend on the board (`animMs`, `stepDur`)
  are excluded by design. Green parity is the exit criterion of WP1.

### 6.4 The Stage and the facade (`src/learn/facade.js`)

The facade is the map's sketch (§2.8) completed. Every member, with why it exists:

```js
function makeFacade(stage) {
  const { machine, play, crt } = stage, handlers = {};
  const emit = (name, arg) => { for (const cb of handlers[name] || []) cb(arg); };
  const api = {
    machine,                                                       // essential, the real Machine (map §2.2, risk 7)
    get model() { return CPU_MODEL; },                             // die/timing/memmap pick subclasses by it
    get video() { return VIDEO_CARD; },                            // never read by a view; kept for the dock adapter
    get reducedMotion() { return stage.reduced; },                 // read once in constructors
    get mode() { return play.mode; },                              // 'explain' | 'fast'
    get running() { return play.running; },
    get clock() { return play.play ? play.play.clock : 0; },
    get tracing() { return play.tracing; },                        // board3d.js:3868 skips live signals while true
    get motion() { return AnimClock.scale; },
    get stepMs() { return play.stepMs; },                          // the member the old api lacked (board3d.js:7041, 7075; topview.js:638)
    get crtCanvas() { return stage.monitor3d && crt ? crt.fullCanvas : null; },   // only when a 3D monitor shows it (crt.js:216 doubles work)
    get crtVersion() { return crt ? crt.version : 0; },
    select: (kind, id) => emit('select', { kind, id }),            // board3d.js:2126 listens for 'chip'
    view: name => (name === 'runner' ? stage.runnerShim : stage.views[name]),   // see below
    on: (name, cb) => { (handlers[name] = handlers[name] || []).push(cb); },
  };
  return { api, emit };
}
```

**The `dieKit` dependency** (map risk 3): `RunnerView.prototype.dieKit(e)` (board3d.js:8182-8198)
uses only `this.board` (`b.dieScale dieW pinW dieRoute bCtr bIdx`) and the closure's `T`/`lerp`.
So `stage.runnerShim = { dieKit: e => RunnerView.prototype.dieKit.call({ board: stage.board }, e) }`
gives `BoardView.runner` (6046) a truthy object with `dieKit`, and `trJourney` (6138-6141),
`chipVisit` (6065) and `xpFocus(['die:…'])` (6703-6706) take their die-dive paths. No RunnerView is
constructed, nothing is attached to the scene, no storage keys are read (7931-7934). Zero patch.
The 17-line lift into BoardView is the v2 cleanup, done together with the specs lift (§6.5).

**`window.__app`**: `shell.js` sets `window.__app = { machine, views: { board }, selectTab: id =>
shell.go(id === 'die' ? 'explore' : 'lesson') }` so board3d.js:1954-1955 (cache card bytes),
2180 (pop button) and die.js:1279-1287 (`focusChip`) keep working. Removed when the specs lift
lands.

**`xpCovers` / `trCover`** (map risk 4, §4.4): the board measures `.xp3-prog`/`.xp3-bar` inside
`bd.root`, `#monitor` and `#trace` in the document. The learn layout has none of them (the caption
card and controls are siblings of the stage host, outside `bd.root`; there is no floating monitor;
no element is named `trace`). All covers are therefore 0 and shots use the whole stage. The Stage
asserts this once at start (`console.assert(!root.querySelector('.xp3-bar'))`) so a later layout
change fails loudly instead of quietly shifting the camera.

```js
class Stage {
  constructor(host, { machine, play, crt, reducedMotion, webgl = true })
  // host: a positioned, non-zero box (board3d.js:1509, 7755). Builds BoardView (or DieView when !webgl
  // or when board.ok is false after construction), hides the chrome with one CSS rule
  // (.bv-top,.bv-pop,.bv-focus,.bv-hint{display:none}), subscribes play events in the fixed order.
  board, die, views, api, emit, reduced, monitor3d = false, runnerShim, active
  start() / stop()                     // the ONE rAF loop: dt = min(100, now - last); vnow = animNow(); vdt = dt * AnimClock.scale;
                                       // play.tick(vnow, vdt, dt); crt && crt.frame(now); active.frame(vnow, vdt)   (app.js:1420-1436)
  resize()                             // ResizeObserver on host → active.resize()
  show(name) / hide()                  // view.show()/hide(); only the visible view gets frame()
  durOf(s, ms) → ms                    // active.traceDur ? active.traceDur(s, ms) : ms   — given to Playback as `durOf`
  showStep(story, i, info)             // the only caller of traceStep: for each view with traceStep → v.traceStep(story, i, info)
                                       // (Playback.enterStep already called durOf in the same frame, so s._ms is set: risk 5 closed)
  limitStops(story, i, allowed)        // §3.2 step 4: j = board.trJourney(s); j.segs = j.segs.filter(g => g.kind !== 'dwell' || allowed(g)); (before the first traceStep of s)
  clear()                              // board.traceStep(null) (≡ traceClear, board3d.js:7088)
  focus(ids, o) card(spec, ms) xp(on)  // pass-through to xpFocus / xpCard / xpSet; no-ops on the die fallback
  unitNow() → { chip, unit, text } | null   // board.xpNowUnit() → xpUnitText(g) (board3d.js:6500-6522)
  setReducedMotion(on)
}
```

A smoke test of the Stage without lessons is the first thing that runs in Chrome
(`tools/learn-shots.mjs --smoke`): board `ok`, a rendered frame (`bd.renderer.info.render.frame >
0`), a `traceStep` of `hello`'s first instruction with `bd.tr` non-null and a camera move
(`bd.cam.r` changes) under the virtual clock. This retires risk 6 in week one.

### 6.5 Spec builders and die plans: later

The step→spec builders (board3d.js:1626-2082, ≈450 lines) and `DIE_PLANS/dieLayout/drawInterior`
(733-856, 912, 1291) stay where they are for v1 because (a) the learn page loads all of board3d.js
anyway for `BoardView`, (b) `BoardKit` (8799-8807) already exposes every builder and table after
load, which is enough for the Chrome checker to validate lesson stop ids against `DIE_PLANS`, and
(c) the only coupling, `window.__app.machine` at 1954-1955, is served by the shim. The lift becomes
worth it when the phone layout wants die plans without three.js or when the Node checker wants to
validate `(part, label)` without Chrome; both are v2. When it happens it is one work package
(`src/ui/specs.js` + `src/ui/dieplans.js`, `machine` passed explicitly, `dieKit` moved into
BoardView) verified by `tools/unitsheet.mjs`/`xpunits.mjs`-style output before and after (map risk 2).

### 6.6 The lesson player (`src/learn/player.js`, `src/learn/plan.js`)

`plan.js` is pure and Node-loadable (it reads `CPU_MODEL` for the line size, as explain3d.js:337):

```js
const LearnPlan = {
  order(steps, { lineBytes, fold, skip, a0, a1 }) → [{ i, quick, cap? }]     // explain3d.js:335-389 with `ins` → a0/a1 and MODEL → lineBytes as parameters
  caption(step, ctx, overrides) → { lead, rest, unit }                        // explain3d.js:407-441: µop cleanup, the Decode "why", later-fetch rewrites, template fill, split by splitLead
  select(step) → string[]                                                     // the selectors a step matches (§3.1): ['bus', 'bus:data', 'bus:data:fetch', 'bus:data:vram']
  fill(text, ctx) → string                                                    // {val}{tag}{from}{to}{addr}{ip}{cycles}{reg}{text}{us}
  readMs(text) → ms                                                           // §5 row 1
  split(text) → [head, tail] | null                                           // explain3d.js:426-433, 230 threshold
};
```

`player.js` is Explain's engine with `this.app` replaced by `play` and `this.board` by `stage`:

```js
class LessonPlayer {
  constructor({ play, stage, content, ui })
  // ui = { caption({ html, lead, rest, unit, n, of }), progress(k, n, frac), state({ paused, auto, waiting, canBack, done }),
  //        check(q, onAnswer), chapter(k, list) } — plain functions the shell provides; the player owns no DOM
  load(lesson) → Promise<void>          // assemble (or SAMPLES lookup) → play.load → play.boot() → play.runTo(lesson.from) → chapters from beats
  next(now) goNext() back() jump(k) replay() togglePause() setSpeed(v) auto(on) stop()   // explain3d.js:477-524, 634-677, 719-777 (names kept)
  key(e)                                // 730-740; attached by the shell, not at construction
  frame(now)                            // the old loop() body (477-490) minus its rAF: called by the Stage every frame
  expand(beat) → Beat[]                 // §3.2; for instr beats: intro, LearnPlan.order(...) filtered, screen, done
  vget(n) vset(bytes)                   // 140-154 unchanged (machine.mem / vga.vram planes; crt.dirty)
  get state() → { lesson, chapter, beat, k, n, waiting, paused, done }
}
```

Differences from Explain that matter: no second rAF loop (the Stage calls `frame`); no
`setTimeout` (Explain's `screen()`/`chime()` at 470-474 desync under the virtual clock, map §6.5);
`Sfx` calls only when `typeof Sfx !== 'undefined'` and never for timing; captions are strings, not
HTML, until `ui.caption` bolds the hex.

### 6.7 Content (`src/learn/content.js`) and lessons (`src/learn/lessons/`)

```js
const LEARN_UNITS = {                        // key 'PART/LABEL', exact DIE_PLANS spellings (board3d.js:733-856)
  '8086/QUEUE': { die: 'queue', title: 'Instruction queue',
    short: 'Holds up to 6 bytes fetched ahead.',                       // ≤ 60 chars; the tag and the card sub
    long: 'The BIU prefetches up to 6 bytes while the EU executes...',  // die.js DIE_INFO.queue (21-38)
    why: 'Fetching ahead keeps the EU busy: the bus is slow, the EU is not.' },  // NEW: the learner's "why" (§5.6 gap 8)
  '8086/ALU': { die: 'alu', ... }, '8086/ADDRESS ADDER': { die: 'sigma', ... }, ...
  'Pentium/BTB': { die: 'btb', ... }, 'Pentium Pro/RAT': { die: 'rat', ... },
};
const LEARN_TERMS = {                        // first-use one-liners (§5.6 gap 25 and principle 3)
  bus: 'A set of wires shared by every chip. One chip talks at a time; the others listen or stay quiet.',
  clock: 'A steady tick. Every action inside the machine happens on a tick.', segment: '...', byte: '...', hex: '...', ...
};
const LEARN_CHIPS = { cpu: ['Intel 8086', 'The processor...'], lat0: ['8282', '...'], ... };   // from board3d INFO (210-296), the 68 tooltips
const LearnContent = { unit(part, label), term(word), chip(id), firstUse(text, seen: Set) → term | null,
                       gloss(text, spec) → BlockPanel.termTip(text, spec) };                   // blocks.js:1705
```

The die ids in `LEARN_UNITS.*.die` are the same ids the `DIE*_3D` bridges use (die.js:41, 48,
2812, 4061, 5289, 6856), so the phone fallback can `select(die)` for a stop.

`lessons/index.js`: `const LEARN_LESSONS = { '8086': LESSONS_8086, '80286': LESSONS_286, ... };`
and `lessonOf(model, id)`. Every lessons file is a list of literals like §3.3; the files are
loaded in every build but only `LEARN_LESSONS[CPU_MODEL]` is used (they are ~2 k lines of text, a
few tens of KB).

### 6.8 Shell, Explore, Workbench, Regs

`shell.js` (`class LearnShell`, `startLearn()` at load): routing by `?cpu= &lesson= &beat= &view=
lesson|outline|explore|workbench|machines`; builds the machine (`new (Machine class)({ video,
soundCard: true, wasm })`), the ROM through `play.buildRom({ makeFont8x8, makeVgaFont })`
(makeFont8x8 stays in disks.js:402, which the learn page loads; no move needed), `Playback`,
`CrtScreen` (its host is in the Workbench panel, `tabindex=0`, crt.js:185), `Stage`,
`LessonPlayer`, the screens, the first-visit card, `Tips.init(document)` (a conscious global,
map risk 11) and `Sfx` (loaded, off by default: `a86:sfx`). Ids in learn.html (~25): `stage
caption cap-lead cap-more cap-unit cap-n progress btn-next btn-back btn-auto btn-speed outline
machines first-visit explore-regs explore-bar wb-editor wb-pre wb-gutter wb-view wb-dock wb-disks
crt live status`.

`explore.js` (`ExploreScreen`): `Playback` with `traceBurst: 'fold'`, `stops: 'all'`; buttons map
to `traceNext/tracePrev/stepInstr/startFF`; captions are `story.steps[i].text` split by
`splitLead`; `RegsWidget.sync(events)` after each `instrEnd`.

`regs.js` (`RegsWidget`): the dock's `DOCK_REGS*` tables and `read/fmt/show/setReg/renderFlags/hot`
(≈120 lines lifted verbatim from dock.js, map §1.4 dock row), rendering only the registers that
changed in the last instruction plus SP, IP and the flags, in the Explore caption card.

`workbench.js` (`WorkbenchScreen`): `CodeEditor(textarea, pre, gutter)` (editor.js:69);
`StateDock(appShim)` with `appShim = { machine, is286..is686 }` and the 13 ids of index.html:330-360
copied into the panel; `DiskPanel(appShim2)` with `{ machine, bootDisk: d => play.boot({ disk: d }),
announce, running: () => play.running, bootMode }` and index.html:142-219 verbatim; `TimingView` and
`MemoryView` constructed lazily on first tab with the same `api`; the speed slider is `speedAt`.
`a86:src` is written only from the Workbench's own editor (map §2.6 rule); a lesson's "Open in
Workbench" loads the program into the editor without saving until the person edits.

### 6.9 Storage, globals, side effects (decided, map risk 11, 13)

- Read: `a86:cpu a86:video` (theme.js), `a86:sound a86:sfx a86:radix a86:sysPane a86:memMode
  a86:boardCardMin` (owned by reused modules). Written by the learn page: `a86:learn:seen`,
  `a86:learn:<model>:<lesson>` = `{ beat, done }`, `a86:learn:auto`, `a86:learn:speed`, and
  `a86:src` only from the Workbench editor. Never `a86:xpSet codeHidden dockHidden`.
- `tools/names.mjs` prints the top-level `const/let/class/function` names of every file in a page's
  script list and exits 1 on a duplicate (risk 9); it runs in `tools/learn-check.mjs` first.
- Global side effects accepted: `Tips.init`, `Sfx` listeners, injected `<style>`s, one board
  `keydown`. Not accepted: `CrtScreen.fullCanvas` (never read unless `monitor3d`).

### 6.10 The headless checkers (`tools/learn-check.mjs`, `tools/learn-shots.mjs`)

**Node** (`node tools/learn-check.mjs [--model M] [--lesson id] [--pace] [--json out]`): for each
model (a fresh `vm.createContext` per model because `CPU_MODEL` is frozen per context) it loads the
story.test.mjs file list (15-17) + `theme.js` with the `localStorage`/`document` stubs of §6.3 (the
model comes from the stubbed `a86:cpu`, not from a `var`) + `story.js`, `content.js`, `plan.js`,
`lessons/*`, `playback.js`; then for every lesson of that model:

1. `names`: no duplicate top-level names in the page's script list.
2. `program`: `Asm86.assemble` ok with the model's `cpuAsm`; `SAMPLES` id exists and is allowed on
   the model (app.js:252-253 rule).
3. `boot`: `play.boot()`, hand-off state as map §3.2; `play.runTo(lesson.from)` reaches its target
   under 4 M clocks.
4. `beats`: for each `instr` beat: `traceNext()` → the story; `LearnPlan.order` non-empty; every
   `stops` key exists in `LEARN_UNITS` (the `(part,label)` → `DIE_PLANS` check is Chrome's, §6.5);
   every `captions`/`skip` selector matches at least one step; every caption after `fill` has a lead
   ≤ 110 and a whole ≤ 230, no `{...}` left unfilled, no empty text; every `check.answer` is in range;
   every `term` exists; every `compare` target lesson exists in `LEARN_LESSONS`.
5. `screen`: after the lesson's `count` instructions and a fast run to the end, the text screen
   matches tests/machine.test.mjs:70-110 for that sample (when the lesson uses a sample).
6. `pace` (with `--pace`): the §5 model; beats over 6 s and lessons off their `minutes` by > 40 %
   are listed.
7. `--json` writes `dist/learn-beats.json` = per lesson the expanded beat list (captions, step
   indices, stops), the input of the Chrome script and a review artifact for the writers.

`tests/lessons.test.mjs` is a 60-line wrapper that runs the checker for all six models and fails
on any finding. Budget: about 25 s for all six models (Story.build on ≤ 300 instructions per
model; the POST is 90 ms per boot in Node, map §3.2).

**Chrome** (`node tools/learn-shots.mjs [--model M] [--lesson id] [--beats 3] [--smoke]`): imports
`tools/launch.mjs` (`--no-sandbox` when `process.getuid() === 0`, swiftshader flags, map §6.5),
installs the `__vt` virtual clock (xpfilm.mjs:31-43), seeds `a86:cpu`, loads
`dist/learn.html?cpu=M&lesson=id&nofirst=1`, waits for `__learn.stage.board.ok`, then:

- validates every `LEARN_UNITS` key of this model against `BoardKit.DIE_PLANS[part].b` labels
  after the `BLK_*` remap (board3d.js:857-882) and every `focus` id against `bd.xpBox(id) !== null`;
- steps every beat with `__learn.player.goNext()` + `__vt.step(bDur)` and asserts per beat: the
  caption in `#cap-lead` equals `learn-beats.json`; for a step beat `bd.tr` is non-null and
  `bd.tr.i === expected`; the token screen position is inside the stage; the camera moved at most
  once (`bd.cam.flight` transitions counted); no `pageerror`;
- screenshots three beats per lesson (the intro, one unit stop, the screen beat) at 1280 x 720,
  about 8 s each (map §6.5) — so `--beats 3` on one lesson is ~40 s, the whole 8086 curriculum
  ~6 min, run before a merge, not per edit.

## 7 Work packages and milestones

Interfaces fixed in WP0 before anything else (a one-day review, then frozen for v1):
(1) the Playback events and method list (§6.3); (2) the facade members and the Stage methods
(§6.4); (3) the lesson schema and selectors (§3.1) as `docs/rewrite/lesson-schema.md` + the
checker's validator; (4) the content keys (§6.7); (5) the `ui` callbacks the player expects (§6.6);
(6) the `window.__learn` surface and the URL parameters (§6.8). Each is a file owned by one package;
nobody edits another package's file without a note in the interface doc.

| WP | Files owned | Depends on | Size | Exit criterion |
|---|---|---|---|---|
| WP0 Build and skeleton | `build.mjs`, `src/learn/learn.html`, `tools/launch.mjs`, `tools/names.mjs`, `pages.yml` | — | 2 days | `node build.mjs --page learn` builds; the page loads with the board visible and no console error; old page byte-identical |
| WP1 Playback | `src/learn/playback.js`, `tests/playback.test.mjs`, `tools/playback-parity.mjs` | WP0 | 5 days | Node test green; parity diff empty on `hello`, `fib`, `clock` (8086) and `fib32` (386) |
| WP2 Stage and facade | `src/learn/facade.js`, `tools/learn-shots.mjs --smoke` | WP0 | 3 days | smoke green: rendered frame, a traced step with die dive (`bd.tr.segs` has a `dive`), camera moves once, resize works |
| WP3 Player and plan | `src/learn/plan.js`, `src/learn/player.js`, `tests/plan.test.mjs` | WP1 (events), WP2 (Stage API) — starts against stubs | 6 days | `letter` (§3.3) plays end to end with `Next`, Auto, Back, checks, screen reveal |
| WP4 Content | `src/learn/content.js` | — | 5 days (writer + one dev for the merge script) | every `(part,label)` of the six `DIE_PLANS` has `title short long`; 40 terms; Chrome validation green |
| WP5 8086 lessons | `src/learn/lessons/programs.js`, `l8086.js`, `index.js` | schema (WP0), checker (WP10) | 6 days (writer) | 9 lessons, checker green, pace report inside limits |
| WP6 Later machines' lessons | `l286.js l386.js l486.js l586.js l686.js` | WP5 as the model | 5 × 2 days (two writers in parallel) | 27 lessons, checker green |
| WP7 Shell and screens | `src/learn/shell.js`, `src/learn/learn.css` | WP0; player `ui` callbacks | 6 days | Lesson, Outline, Chooser, First visit at 1280 x 720; phone fallback with `DieView`; keyboard and `aria-live` |
| WP8 Explore | `src/learn/explore.js`, `src/learn/regs.js` | WP1, WP2 | 4 days | step/instr/run controls; registers that changed; return to the lesson at the same beat |
| WP9 Workbench | `src/learn/workbench.js` | WP1, WP2 | 6 days | editor, dock, disks, timing, memory, speed slider; the dock adapter with the 13 ids; boot from disk |
| WP10 Checkers | `tools/learn-check.mjs`, `tests/lessons.test.mjs`, `tools/learn-shots.mjs` (full) | WP1, WP3 | 5 days | all six models green in Node in < 30 s; Chrome run of lesson 1 with 3 screenshots |

Milestones (a team of five: two engine/stage devs, one shell dev, one tools dev, one to two writers):

- **M0, end of week 1 — the interfaces hold.** WP0 done; WP1 Node test green on `hello`; WP2 smoke
  green. Risks 1, 3, 5, 6, 9 retired (§8). The writers get the schema and start `letter` on paper.
- **M1, end of week 3 — one lesson end to end.** WP3 with the real Playback and Stage; WP4's 8086
  part; `letter` plays; WP7's Lesson screen and First visit; WP10's Node checker validates `letter`.
  Risks 4, 10, 12 retired. Owner review of pacing on the real board.
- **M2, end of week 5 — the 8086 curriculum, Explore.** WP5's nine lessons; WP8; Outline and
  Chooser; Chrome checker runs the 8086 lessons; deploy to `_site/learn.html` (not the front door).
- **M3, end of week 7 — six machines, Workbench.** WP6 (27 lessons, checker green); WP9; disks
  reachable; reduced motion and phone fallback checked in Chrome (`--reduced`, 390 px viewport).
- **M4, week 8 — the flip.** `learn.html` becomes `_site/index.html`, the old page
  `_site/workbench.html`; links between them relative; `a86:cpu` carries (map §6.3). Gate: all
  tests of §7.1 green, Chrome checker green for all 36 lessons, owner walkthrough.

### 7.1 Tests to keep green

Unchanged and run after any touch of shared files (map §6.4): `tests/story.test.mjs --model 80486`
(9 s), `tests/machine.test.mjs --model 8086` (1.3 s), `tests/fpu.test.mjs`, `tests/cpu486/586/686
.test.mjs`, `tests/pm286..pm686.test.mjs`. New and required for a merge to the learn files:
`tests/playback.test.mjs`, `tests/plan.test.mjs`, `tests/lessons.test.mjs`, `node tools/names.mjs
--page learn`. Before a deploy: `tools/learn-shots.mjs --model 8086` (all lessons) and `--smoke` for
the other five models. The `story.test.mjs:41` double-`reset()` (map §6.4) is out of scope for the
rewrite; the checker boots in the right order and therefore covers what that test meant to.

## 8 Risks and how each is retired early

Ordered by the map's ranking; the week is the milestone at which each is closed.

1. **Parse-time model freeze** (map risk 1). Decided in WP0: one machine per page load; the chooser
   is links; `compare` beats reload. Nothing to retire — the design does not fight it. Cost accepted:
   two machines side by side are not in v1 (§9).
2. **board3d.js as one IIFE** (risk 2). Not lifted in v1; the page loads it whole and uses `BoardKit`
   for validation only. The lift is scheduled as v2 with its own before/after check (§6.5). The
   `window.__app` shim is the only trace of the coupling and is grep-able.
3. **Die dives need `RunnerView.dieKit`** (risk 3). The `runnerShim` (§6.4) is written in WP2 and
   proven by the smoke test's `dive` assertion in week 1.
4. **Explain not instantiable** (risk 4). WP3 ports it onto `Playback` + `Stage` with the `ui`
   callbacks; the `xpCovers` coupling is dissolved by the layout and guarded by the Stage's assert
   (§6.4). Proven at M1 when `letter` plays.
5. **`api.stepMs` missing** (risk 5). The facade has it; `Playback.enterStep` calls `durOf` (which is
   `traceDur`) before emitting `step`, and `Stage.showStep` is the only `traceStep` caller. The
   playback test asserts `s._ms !== undefined` on every `step` event with a spy `durOf`. Week 1.
6. **Render loop and clock ownership** (risk 6). One loop in the Stage, `animNow()` everywhere, no
   `setTimeout` in the player; the smoke test under `__vt` proves a frame renders and the camera
   moves. Week 1.
7. **Every frame reads `app.machine`** (risk 7). The facade passes the real `Machine`; never a stub.
   Hover in the smoke test (`page.mouse.move` over the CPU) exercises `stateOf` (board3d.js:4624).
8. **Headless blocked / slow** (risk 8). `tools/launch.mjs` with `--no-sandbox` as root; state
   assertions first, three screenshots per lesson only before merges; the Node checker carries the
   bulk (36 lessons in < 30 s). Week 1.
9. **Name collisions** (risk 9). `tools/names.mjs` in the checker and in WP0's build script; the
   learn files use the `Learn*`/`LEARN_*`/`LESSONS_*` prefixes; `Playback`, `Stage`, `caption`,
   `SPEEDS`, `TRACE_MS`, `MOTION` are verified free once app.js is out (map §6.1).
10. **Scattered content** (risk 10). WP4 builds `content.js` by a one-off merge script
    (`tools/content-merge.mjs`, run once, output committed) from `DIE*_INFO`, the `tcard` subs
    (extracted by regex from board3d.js:1626-2082) and `INFO`; the Chrome checker validates every
    key against `DIE_PLANS`, so a renamed label fails a check instead of a bridge silently (§4.7).
11. **Global side effects** (risk 11). Enumerated and decided in §6.9; `fullCanvas` never read.
12. **Spec identity and step mutation** (risk 12). One `Playback`, one story per instruction, one
    view with `traceStep` at a time (the Stage shows one view); `limitStops` mutates `s._j` before the
    first `traceStep`, and `plan()` results are cached per story on the player. The playback test
    checks that `traceGo(i)` back and forth reuses the same step objects.
13. **Storage sharing** (risk 13). §6.9; `a86:src` only from the Workbench editor.
14. **Performance/memory** (risk 14). `wasm: !phone`; `decapAll` is not exposed in Lesson; die dives
    open only the dies of the stops. The Chrome checker records `performance.memory.usedJSHeapSize`
    after a lesson and fails over 600 MB.
15. **Phone / PiP** (risk 15). No PiP; the Stage picks `DieView` under 900 px or when `ok` is false;
    the checker runs one lesson at 390 x 844 with `--nowebgl`.

Two risks of this design's own making are in the abstract's list and here in short: `limitStops`
edits a cached journey whose segment shape (`{kind:'dwell', at, dive, block, card, label}`, map
§4.3) is internal to board3d.js — the fallback if a filtered journey breaks the token path is the
Explain behaviour (`quick` for unlisted stops). And the `runnerShim` calls a prototype method with a
fake `this`; if a later board3d change adds a second `this.*` read to `dieKit`, the smoke test's
`dive` assertion catches it.

## 9 What is deliberately left out

- Two machines on one screen, or switching machines without a reload (the parse-time freeze,
  §8.1). "What changed" is told by lessons and `compare` links, not by a split view.
- Lifting `specs.js`/`dieplans.js` out of board3d.js, moving `dieKit` into BoardView, `xpCovers` as
  data, `applyTheme(model)`, parameterising story.js: all v2 refactors of keep-untouched files that
  v1 does not need (§6.5).
- `TopView` (the 2D board) as the no-GPU fallback; v1 degrades to `DieView` + captions.
- The Runner view, pop-out/PiP windows, the floating monitor, the DOS boot UI beyond the disks panel
  in the Workbench, sound design (brief non-goals). The Workbench keeps `Sfx` off by default.
- Lesson authoring UI, progress sync across devices, quizzes with scores: progress is a local
  `{ beat, done }` per lesson.
- Extending the assembler highlighter to 32-bit words (editor.js:5-13) — Workbench polish for v2.
- A change to `tests/story.test.mjs:41`; the map queued a task for it and the new checker does not
  depend on it.
- Rewriting the 85 card `sub` sentences or the 131 die texts: `content.js` merges them and adds
  `why` lines; wording passes are content work after M2.
- Any patch to `src/ui/*.js` for v1; the only edited old file is `build.mjs` (+45 lines, CRLF kept).
