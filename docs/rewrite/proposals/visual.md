# Design 4: scene first — "one shot, one sentence, one value"

Designer 4 of 4. This proposal starts from what is on the stage and works outward to the data
that drives it. Line numbers are from the working tree the reuse map describes (`docs/rewrite/
01-reuse-map.md`, "the map" below; its sections are cited as map §n). Every reuse claim names the
file and line it was checked against.

Contents: 1 Concept · 2 Screens · 3 The lesson data model · 4 The curriculum for v1 · 5 The pacing
model · 6 The reuse plan and the module list · 7 Work packages and milestones · 8 Risks · 9 What is
deliberately left out.

---

## 1 Concept (one page)

**A lesson is a film the learner advances one shot at a time.** Each beat of a lesson is exactly
three things: a *shot* (what the camera frames and what is lit), a *sentence* (the headline of the
caption), and at most one *value* (the number or name that moves, on a token or in a unit). Nothing
else is on the screen. The board, the dies and the unit drawings already exist (board3d.js,
die.js, unitfx.js); this design decides which of them is visible when, for how long, and how big.

**The stage is at the left, the page is at the right.** A 908 × 672 stage and a 372-px column at
1280 × 720. The column holds, top to bottom, the outline (where am I), the program (the lines of
code, the current one lit), the caption card (headline, details, term meanings) and the controls
(Back · Next · Auto). Nothing floats over the stage: no block card, no token bar, no legend. The
stage gets a 1.35 aspect, which suits a die (the 8086 plan is 1.06, board3d.js:734) far better
than the present 2.4-aspect strip above a caption bar. The layout never changes between beats
(brief principle 4); a fixed-height caption box makes a two-word headline and a three-line
headline occupy the same pixels.

**Five shot scales, two kinds of transition.** BOARD (the overview preset or the union box of a
few chips), REGION (a group of chips with labels), CHIP (one package with its lid open, the whole
die framed), UNIT (one block of a die, its UnitFx drawing filling about a third of the stage),
SCREEN (the monitor). A *move* is allowed only between adjacent scales of the same subject and
lasts at most 1100 ms (the duration `xpFocus` already uses during a step, board3d.js:6716). Any
other change of framing is a *cut*: 180 ms to dark, an instant `flyTo(..., true)`
(board3d.js:4220), 180 ms back. Cuts are cheap for the eye and cheap for swiftshader; flights of
1300 ms across the board (the default `flyTo`, 4222) are what made the old Explain feel slow.

**Spotlight, dim, label.** During a beat the board is dimmed (the exposure 0.55 the trace already
sets, map §4.1) and the subjects of the shot are cut out of a dark overlay (`drawSpot`,
board3d.js:6773, fed by `xpFocus(ids)`, 6696). Chips in the spotlight get a stage label "8288 ·
bus controller" from `INFO[id][0..1]` (board3d.js:210-296), at most three per shot. The caption
never contains a chip type number that is not lit on the stage: names appear where the things are
(brief principle 3).

**A bus cycle is three stops, not seven.** The story turns one bus cycle into three steps
(address, command, data: story.js:103-125), and the board's plan gives every glue chip on the
path a stop of 800 ms (`XP_PASS`, board3d.js:1196) and every unit with a card 3.6 s of work
(`XP_WORK_S`). This design keeps the path and drops the stops: **source unit (0.6 s) → the wire
(1.2 to 1.6 s, the latches, the controller and the transceivers glow as the token passes, no stop)
→ target unit (0.8 s)**, 2.6 to 3.0 s in all. The token's label changes colour as it goes: cyan
with the address, magenta with the command, gold with the data (`BUS_COLOR`, theme.js:191-195),
so the three phases are still seen, in the order they happen, without three captions. A lesson
that is *about* the bus cycle asks for `expand: 'cycle'` and gets the three story steps as three
beats with the story's own sentences.

**A unit at work is one picture with one label.** Three things can show a unit today: the on-die
UnitFx drawing (`unitOverlay`/`paintUnit`, board3d.js:7299-7331), the unit tag (`unitTag`, 7489),
the block card (`showCard`, 7508, a 340-px BlockPanel). In Lesson mode only the first two survive:
the drawing is the picture, the tag is the label (name + up to three facts), and the card's
sentence (`spec.sub`, the 85 texts of board3d.js:1626-2082) becomes the *details* layer of the
caption. In Explore the card comes back (it is the expert's view of the same spec).

**Map mode is the same lesson without WebGL.** Every beat names its subjects by ids (glow ids,
decap keys, block labels), never by camera numbers. When `BoardView.ok` is false
(board3d.js:2112-2117) or the page is narrower than 900 px, the stage becomes a 2D map: the die
floor plan of `DieView` (die.js, `select`/`zoomToBlock`/`viewTo`, 1030-1058, 1214) for CHIP and
UNIT beats, and a small board map drawn from `BoardKit.CHIPS`/`ROUTES` (board3d.js:8799-8807) for
BOARD and REGION beats. The captions, the outline and the controls are identical, so a lesson is
written once.

**Numbers are shown when they are the subject.** A headline carries at most two numbers. Hex is
always suffixed with h and padded to the width of the wire it travelled on (5 digits for a 20-bit
address, story.js:24 `aw`); a number is coloured like its wire. The first hex number of a lesson
gets a one-line meaning. Register values that did not change are never shown.

**Motion never competes with reading.** When a beat's animation ends, the stage holds: the token
rests, the unit drawing shows its final state (`u = 1`), the camera does not drift. Auto advances
only after both the animation and the reading time (1400 + 58 ms per character of the headline,
the rule of explain3d.js:439) have passed. Under `prefers-reduced-motion` the token appears at its
three stops instead of travelling, moves become cuts, and Auto is off.

What this buys the learner over the present page: a beat is 2 to 4 s instead of 10 to 25; the eye
has one place to look and one place to read; the same six-word headline works on the 3D board, on
the die map and on a phone; and every picture is still the real machine.

---

## 2 Screens (ASCII wireframes)

All wireframes are 1280 × 720. Sizes in px. The top bar is 48 px; the stage 908 × 672; the column
372 wide with a 16-px gutter.

### 2.1 The lesson screen (default)

```
+------------------------------------------------------------------------------------------+
| 8086 Anatomy  ▸ Learn    [8086 ▾]      Lesson 2 · One byte to the screen        ? ⌨ ⚙   | 48
+---------------------------------------------------------------+--------------------------+
|                                                               | OUTLINE                  |
|                                                               | 2 · One byte to the screen|
|          (stage: 3D board, dimmed; the spotlight on the       | beat 7 of 19             | 140
|           8086 and the two 8282 latches; two labels)          | ▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯      |
|                                                               | ‹ The address leaves     |
|                 [8086 · CPU]                                  |   the CPU                |
|                    ┌────┐                                     |--------------------------|
|                    │▒▒▒▒│ ──(ADDR B8000h)──►  ┌──┐ ┌──┐      | PROGRAM                  |
|                    │▒▒▒▒│                     │  │ │  │      |   mov ax, 0B800h         |
|                    └────┘              [8282 · address latch] |   mov es, ax             | 184
|                                                               |   mov al, 'A'            |
|                                                               | ▶ mov [es:0], al   ← lit |
|                                                               |                          |
|                                                               |--------------------------|
|                                                               | 8086 · BUS INTERFACE     |
|                                                               | The CPU puts the address |
|                                                               | B8000h on its 20 address | 236
|                                                               | wires.                   |
|                                                               |                          |
|                                                               | ALE tells the two 8282   |
|                                                               | latches to keep it, the  |
|                                                               | wires carry data next.   |
|                                                               | [address wires] [ALE]    |
|                                                               |--------------------------|
|                                                               | ‹ Back     [ Next › ]  Auto ○| 64
+---------------------------------------------------------------+--------------------------+
```

The caption card: a 13-px mono kicker (`chip · UNIT`, the tag's text), a 21-px headline box of
exactly three lines (85 px), a 15-px details box of exactly three lines (66 px), a row of term
chips (the terms of this beat; a tap replaces the details with the one-line meaning for 6 s). The
token on the stage reads `ADDR B8000h` in 18-px mono (the size the Explain CSS already gives the
token, explain3d.js:54), cyan.

### 2.2 A UNIT beat (the die fills the stage)

```
+---------------------------------------------------------------+--------------------------+
|   ┌───────────────── 8086 die, lid open ───────────────────┐   | 2 · One byte to the screen|
|   │ ALU      │ REGISTERS │ ADDRESS ADDER ▒▒▒▒▒▒▒▒│BUS CTRL │   | beat 9 of 19             |
|   │          │           │  ES  B800 ×16  B8000  │         │   | ▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯      |
|   │ FLAGS    │           │  +   0000       ────► │ QUEUE   │   |--------------------------|
|   │          │           │  = B8000h  ▒▒▒▒▒▒▒▒▒▒ │         │   | ▶ mov [es:0], al         |
|   │ DECODER                          │ MICROCODE ROM        │   |--------------------------|
|   │ INTERRUPTS TIMING                │                      │   | 8086 · ADDRESS ADDER     |
|   └─────────────────────────────────────────────────────────┘   | The adder makes the      |
|          [Address adder · ES × 16 + 0000h = B8000h]            | address: ES × 16 plus    |
|                                                               | the offset gives B8000h. |
|                                                               | (details: A segment ...) |
|                                                               | [segment] [offset]       |
+---------------------------------------------------------------+--------------------------+
```

The UnitFx drawing (`adder` kind, unitfx.js:1891-1897) is painted on the die at 1 drawing px ≈ 1
screen px (`unitZoom`, board3d.js:7333); the unit tag under it (`unitTag`, 7489) shows the name
and up to three facts from `spec.lines`. No card.

### 2.3 The outline / chooser

```
+------------------------------------------------------------------------------------------+
| 8086 Anatomy  ▸ Learn                                                            ? ⚙   |
+------------------------------------------------------------------------------------------+
|  [ 8086 ]  80286   80386   80486   Pentium   Pentium Pro                 (tabs; the chosen |
|  Intel 8086 + 8087 · 4.77 MHz · 1 MB · 1978                                one is lit)     |
|                                                                                          |
|  1  The board ................ what each chip is for           tour     6 min   ✓        |
|  2  One byte to the screen ... four instructions, one letter   letter   9 min   ● 7/19   |
|  3  Registers and the ALU .... AX, ADD, the flags               fib      8 min            |
|  4  The bus cycle ............ T1, T2, T3 and who answers       vram    10 min            |
|  5  Jumps, flags, the queue .. how JNZ decides                  fib      8 min            |
|  6  The stack ................ CALL, RET, SP                    fact     9 min            |
|  7  A call into the ROM ...... INT 10h and the BIOS             hello    9 min            |
|  8  The timer ticks .......... IRQ0, the 8259A, INTA            clock   10 min            |
|  9  Keys and ports ........... HLT, IRQ1, port 60h              keys     9 min            |
|                                                                                          |
|  [ Continue lesson 2 ]      Explore this machine ›     Workbench ›                       |
+------------------------------------------------------------------------------------------+
```

The list is the lesson data (section 3) rendered; the ticks and the `7/19` come from
`a86:learn:progress`.

### 2.4 Explore (the same stage, the expert's column)

```
+---------------------------------------------------------------+--------------------------+
|                                                               | mov [es:0], al   4 clocks|
|                (stage: the same board; the block card         | STEPS                    |
|                 is allowed back, bottom-left, 340 px;         |  1 Decode                |
|                 the trace path and the token as today)        |  2 Address calculation   |
|                                                               | ▶3 T1 · Address          |
|   ┌ ADDRESS ADDER ───────────────────────┐                    |  4 T2 · Command          |
|   │ (BlockPanel card, spec.sub sentence) │                    |  5 T3 · Data             |
|   └──────────────────────────────────────┘                    |--------------------------|
|                                                               | The 8086 puts the address|
|                                                               | B8000h on AD0–AD15 and   |
|                                                               | A16–A19. ALE makes the   |
|                                                               | 8282 latches hold it ... |
|                                                               |--------------------------|
|                                                               | CHANGED  ES 0000→B800    |
|                                                               |          IP 0106→0108    |
|                                                               |--------------------------|
|                                                               | ‹ Step   Step ›   Instr ›|
|                                                               | [Board][Die]  card ☑     |
+---------------------------------------------------------------+--------------------------+
```

Explore shows every story step (`Story.build`, story.js:380-406) with its full text, the
registers that changed (the `DOCK_REGS*` extract, map §1.4), Board/Die tabs, and the block card.
It is the present trace bar turned into a column.

### 2.5 Workbench

```
+------------------------------------------------------------------------------------------+
| 8086 Anatomy ▸ Workbench   [8086 ▾]   Reset  Run ▶  Step  Clock   speed ───●───   ⚙      |
+------------------+-------------------------------------------------+---------------------+
| EDITOR           |  [Board] [Die] [Memory] [Bus timing] [Screen]    | REGISTERS  FLAGS    |
| (CodeEditor)     |                                                   | AX 0041  ...        |
|  1 mov ax,0B800h |            (the chosen view; BoardView with      | STACK   I/O LOG     |
|  2 mov es,ax     |             its own chrome shown)                 | (StateDock extract) |
|  ...             |                                                   |                     |
| [Assemble] [Load]|                                                   | DISKS  ▸ A: B: C:   |
+------------------+-------------------------------------------------+---------------------+
```

The old page's powers behind the third door: editor.js, the dock extract, memmap.js and
timing.js behind the facade (map §1.4), the disks panel (map §2.7.8). Not designed further here.

### 2.6 The machine chooser (a page, not a menu)

```
+------------------------------------------------------------------------------------------+
|                          Which machine do you want to open?                              |
|  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                   |
|  │ 8086   │  │ 80286  │  │ 80386  │  │ 80486  │  │Pentium │  │ P. Pro │  (a chip drawing |
|  │ 1978   │  │ 1982   │  │ 1985   │  │ 1989   │  │ 1993   │  │ 1995   │   per card, the  |
|  │4.77 MHz│  │ 8 MHz  │  │ 25 MHz │  │ 33 MHz │  │ 66 MHz │  │200 MHz │   die plan from  |
|  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘   drawInterior)  |
|  Start with the 8086: every later chip is explained as a change to it.                   |
|  New in this chip:  the address adder and the 6-byte queue ...  (one line, from the data) |
|                                     [ Open the 8086 ]                                    |
+------------------------------------------------------------------------------------------+
```

Choosing a machine reloads with `?cpu=` (the parse-time freeze, map §7 risk 1; the menu texts
of index.html:28-48 are the raw material). The chooser is a page so the reload is not a surprise.

### 2.7 The first visit

```
+------------------------------------------------------------------------------------------+
|              (the stage behind: the 8086 board at the overview preset, slowly lit)       |
|         ┌──────────────────────────────────────────────────────────────┐                 |
|         │  How a PC runs a program                                     │                 |
|         │  Six real machines, from the 8086 to the Pentium Pro. Every  │                 |
|         │  picture is the machine running; every value is real.        │                 |
|         │                                                              │                 |
|         │  [ Start: the 8086 board (6 min) ]   Choose a machine ›      │                 |
|         │  I know this: Explore ›  Workbench ›                         │                 |
|         └──────────────────────────────────────────────────────────────┘                 |
+------------------------------------------------------------------------------------------+
```

### 2.8 Map mode (no WebGL, or a phone)

```
+------------------------------------+      phone (≤ 900 px): the column goes below the stage
| 8086 ▸ Lesson 2      beat 9 of 19  |      +---------------------------+
+------------------------------------+      | (die map, 2D SVG, 1:1)    |
|  ┌── 8086 die (DieView SVG) ─────┐ |      |                           |
|  │ALU │REGS│ADDR ADDER ▒▒▒│BUS  │ |      +---------------------------+
|  │    │    │  B8000h       │CTRL │ |      | 8086 · ADDRESS ADDER      |
|  │FLG │    │               │QUEUE│ |      | The adder makes the ...   |
|  │DECODER        │MICROCODE ROM  │ |      | ‹ Back   [ Next › ]  Auto |
|  └───────────────────────────────┘ |      +---------------------------+
+------------------------------------+
| 8086 · ADDRESS ADDER                |
| The adder makes the address ...     |
| ‹ Back        [ Next › ]       Auto |
+------------------------------------+
```

The board-scale beats show the 2D board map (section 6, `boardmap.js`); the screen beats show
`CrtScreen` in the stage.

---

## 3 The lesson data model

### 3.1 Principles of the model

- A lesson is data (one JS object per lesson in `src/learn/lessons/*.js`), not code. It never
  names a camera position, a mesh or a pixel: it names **subjects** by the ids the board already
  understands — glow ids and decap keys (`INFO` keys, board3d.js:210-296; `dieEntry` keys, 6048),
  `'monitor'`, `'cga'`, `'drives'`, `'screenTL'` (`xpBox`, 6676-6694), and block labels spelled
  exactly as in `DIE_PLANS` (733-856; map §4.7).
- The generic beats of an instruction come from the story steps (`Story.build`, story.js:380-406)
  through a **compile policy**; a lesson only chooses the policy, the stops and the captions it
  overrides.
- Every text is a plain English sentence. Terms are marked `{term}` and resolved by the glossary
  (a learner glossary in `content.js` wrapping `BlockPanel.termTip`, blocks.js:1705).
- Numbers in captions are written as placeholders (`{addr}`, `{val}`, `{reg AX}`) and filled from
  the machine, never typed by the author (brief principle 5).

### 3.2 The schema

```js
Lesson = {
  id: '8086-02',                    // machine-number
  machine: '8086',                  // '8086'|'80286'|'80386'|'80486'|'80586'|'80686'
  video: 'cga',                     // optional; 'vga' lessons show only with the VGA card
  title: 'One byte to the screen',
  idea: 'A program is bytes; running it is moving bytes and calculating.',
  minutes: 9,                       // the author's estimate; the outline shows it
  program: { sample: 'hello' } | { src: '...', entry?: 0x100 },   // a SAMPLES id (bios.js:2680) or source
  boot: 'quiet',                    // 'quiet' (the POST runs unseen, app.js:1137-1144) | 'watch' (a BIOS lesson)
  terms: ['bus', 'address', 'byte'],// the terms this lesson introduces (first use gets its meaning)
  beats: [ Beat, ... ],
  end: { summary: '...', next: '8086-03', tryIt: 'Change the letter A to B and run it in Explore.' },
}

Beat = {
  k: 'shot' | 'instr' | 'cycle' | 'unit' | 'screen' | 'run' | 'check',
  // ---- what is on the stage --------------------------------------------------------------
  focus: ['cpu', 'lat0', 'lat1'],   // subjects: glow ids, 'die:cpu', block labels as 'cpu/ADDRESS ADDER'
  scale: 'board'|'region'|'chip'|'unit'|'screen',   // default: from focus (one die → chip; one block → unit)
  labels: true,                     // stage labels on the focused chips (≤ 3), default true at board/region
  // ---- what is said ----------------------------------------------------------------------
  say: { head: '≤ 110 chars, one sentence', more?: '≤ 2 sentences', terms?: ['bus'] },
  // ---- what moves (instr/cycle/unit only) --------------------------------------------------
  stops?: ['ADDRESS ADDER', 'BUS CONTROL'],     // units that get a stop; others pass with a glow
  skip?: ['fetch'],                 // story steps to leave out: 'fetch' | 'inta' | a step title
  expand?: 'cycle' | 'fold',        // 'cycle': the T-state steps as separate beats; 'fold' (default)
  over?: { 'inside:Decode': '...', 'bus:data:vram': '...' },   // caption overrides by step key
  numbers?: 'auto' | 'hide',        // 'hide': no values on the token or in the tag
  value?: { tag: 'ADDR', val: '{addr}', col: 'addr' },  // for a shot beat that shows one value
  // ---- time --------------------------------------------------------------------------------
  hold?: ms,                        // Auto hold override (default: the reading rule)
  // ---- check beats -------------------------------------------------------------------------
  q?: '...', options?: ['...', '...'], answer?: 0, why?: '...',
  // ---- run beats ---------------------------------------------------------------------------
  until?: { line: 12 } | { ip: 0x0134 } | { halt: true } | { screen: /regex/ },
}
```

Step keys for `over`, `skip` and `stops` follow the story's own fields: `inside:<title>` (titles
`Decode`, `Address calculation`, `Execute`, `Interrupt`, `Descriptor`, `Protection`, `Task
switch`, and the FPU name — story.js:143-215), `bus:<phase>:<dev>` with phase `addr|cmd|data|all`
and the `I.dev` device id (story.js:81-125), `irq`, `cache`, `page`, `btb`, `sound`, `fdc`,
`dma` (story.js:237-359). A key with `*` matches any value.

### 3.3 How an `instr` beat compiles (the policy `beats.js` applies)

1. Run one instruction: `Playback.beginInstr` (app.js:1329-1373 lifted, map §3.3) with
   `tracePre: 'parallel'`, `traceBurst: 'fold'` → `Story.build(events, {prefetch:'parallel',
   burst:'fold'})`, so the prefetches ride in `host.bg` and bursts are one step
   (story.js:325, 392-403).
2. Order the steps with the Explain rule set (`plan`, explain3d.js:335-389: cache steps before
   their fill, the decode before a fetch that starts at the same clock, the address calculation
   before the data cycle). This is the part of explain3d.js that ports as-is.
3. Group: each `inside` step → one `unit` beat; the three `bus` steps of one cycle (same `e`) →
   one `cycle` beat unless `expand: 'cycle'`; a `bus` step with `phase: 'all'` (a fold or a
   prefetch) → one `cycle` beat of the short form; `irq`, `cache`, `page`, `btb`, `sound`,
   `fdc`, `dma` → `unit` beats on their chip.
4. Filter with `skip`: fetches are dropped by default (`skip: ['fetch']` is the default of the
   policy); the background prefetches are shown as a soft glow of the queue block during the
   beat they ride with, never as a beat. The lesson about the queue sets `skip: []`.
5. Caption: the step's `text` through the rewrite rules of `stepMs` (explain3d.js:407-441: µop
   numbering removed, clock numbers turned into durations, the "decoder does not wait" why); the
   first sentence (`splitLead`, theme.js:349-354) becomes `head`, the rest `more`. A head over 110
   characters is not split into two beats as Explain did (explain3d.js:432-438): the second
   sentence goes to `more`. Then `over[key]` replaces `head`/`more`.
6. Stops: the trace model's visits with a card (`traceModel(part).inside`, board3d.js:1626-2082)
   are the candidate stops; the beat's `stops` list keeps those and turns the rest into passes.
7. Time: section 5. If the plan exceeds 6 s, the compiler splits the beat at a stop, never speeds
   it up beyond 1.5×.

The compiled beats are cached on the story object (the views also mutate steps: `_j`, `_ms`,
map §2.7.3 and §7 risk 12), and the specs used for UnitFx drawings are built once per step and
reused by identity (blocks.js:1503; board3d.js:7478, 7522).

### 3.4 A full example lesson: `8086-02 · One byte to the screen`

The program is the Explain program (`SRC`, explain3d.js:11-18), which the lesson carries as
source (bios.js stays untouched).

```js
LESSONS_8086.push({
  id: '8086-02', machine: '8086', title: 'One byte to the screen', minutes: 9,
  idea: 'A program is bytes in memory. Running it is moving bytes between chips and calculating.',
  program: { src: [
    'mov ax, 0B800h',
    'mov es, ax',
    "mov al, 'A'",
    'mov [es:0], al',
    'ret',
  ].join('\n') },
  terms: ['byte', 'hexadecimal', 'register', 'bus', 'address', 'segment', 'video memory'],
  beats: [
    // ---- the setting: two shots, no motion --------------------------------------------------
    { k: 'shot', focus: ['ramE', 'ramO'], scale: 'region',
      say: { head: 'The four instructions are eight {byte}s in the RAM, from address {addr 10100h}.',
             more: 'The assembler turned each line into bytes. The CPU sees only the bytes.',
             terms: ['byte', 'hexadecimal'] } },
    { k: 'shot', focus: ['cpu', 'clk'], scale: 'region',
      say: { head: 'The 8086 runs them, one at a time, 4.77 million clocks a second.',
             more: 'The 8284A divides the 14.318 MHz crystal by 3. One clock is 210 ns.' } },
    // ---- instruction 1: a load into a register (everything inside the CPU) -------------------
    { k: 'instr', focus: ['die:cpu'], stops: ['QUEUE', 'DECODER', 'REGISTERS'],
      over: { 'inside:Decode': 'The decoder reads the bytes B8 00 B8: "put B800h in AX".',
              'inside:Execute': '{reg AX} is now B800h. Nothing left the chip: this happens inside.' },
      say: { head: 'Instruction 1: mov ax, 0B800h — put the number B800h in register AX.',
             terms: ['register'] } },
    // ---- instruction 2: a copy between registers --------------------------------------------
    { k: 'instr', focus: ['die:cpu'], stops: ['REGISTERS', 'SEGMENT REGS'],
      over: { 'inside:Execute': 'The value goes from AX to ES, the segment register the next write uses.' },
      say: { head: 'Instruction 2: mov es, ax — copy AX to the segment register ES.',
             more: 'A segment register says where in the 1 MB a program looks. ES × 16 = B8000h.',
             terms: ['segment'] } },
    // ---- instruction 3 ---------------------------------------------------------------------
    { k: 'instr', focus: ['die:cpu'], stops: ['REGISTERS'],
      say: { head: "Instruction 3: mov al, 'A' — the code of the letter A, 41h, goes into AL." } },
    // ---- instruction 4: the write, the only bus cycle the learner sees ------------------------
    { k: 'instr', focus: ['die:cpu'], stops: ['ADDRESS ADDER'], skip: ['fetch', 'bus:*:*'],
      over: { 'inside:Address calculation': 'The adder makes the address: ES × 16 + 0 = {addr}.' },
      say: { head: 'Instruction 4: mov [es:0], al — write AL to the first cell of the video memory.' } },
    { k: 'cycle', focus: ['cpu', 'lat0', 'lat1', 'bus', 'xcv0', 'cga'], scale: 'region',
      stops: ['BUS CONTROL'],
      say: { head: 'The byte {val} travels over the {bus} to the CGA card, at address {addr}.',
             more: 'The 8282 latches hold the address, the 8288 sends the write command, the 8286 transceivers pass the byte. The card decodes the address itself.',
             terms: ['bus', 'address'] } },
    { k: 'screen', focus: ['screenTL'],
      say: { head: 'The CGA card reads its video memory 60 times a second. The letter appears.',
             more: 'The first cell holds 41h = the letter A, with the colour byte 07h: grey on black.',
             terms: ['video memory'] } },
    // ---- a check and the end --------------------------------------------------------------
    { k: 'check', focus: ['cpu', 'cga'], scale: 'region',
      q: 'Which chip decided that address B8000h belongs to the video memory?',
      options: ['The 8086 CPU', 'The CGA card in the slot', 'The 8288 bus controller'], answer: 1,
      why: 'The CPU only puts the address on the wires. Every chip watches the address; the card in the slot recognises B8000h–BBFFFh as its own.' },
    { k: 'instr', focus: ['die:cpu'], stops: ['DECODER'],
      say: { head: 'Instruction 5: ret — the program ends and the BIOS takes over.' } },
  ],
  end: {
    summary: 'Five instructions, {clocks} clocks: {us} µs at 4.77 MHz. The CPU had to fetch each code byte over the bus before it could use it, and one byte to the video memory made a letter. That is all a program does: move bytes and calculate.',
    tryIt: "Open this program in Explore and change 'A' to 'B'.",
    next: '8086-03',
  },
});
```

The `summary` is the Explain summary (explain3d.js:274) with its numbers as placeholders; "The
letter appears" is explain3d.js:310 verbatim. Nineteen beats are produced: 2 shots, instruction 1
gives 3 beats (Decode, Execute in REGISTERS, the intro), 2 gives 3, 3 gives 2, 4 gives 3 plus the
cycle and the screen, the check, `ret` gives 2, and the end card. At the pacing of section 5 the
lesson is 6.5 min in Auto and about 9 min at a reader's pace.

### 3.5 Checks and placeholders

- `{addr}`, `{val}`, `{reg AX}`, `{clocks}`, `{us}` are filled from the current step's `I`/`e`
  (story.js:47-59 `busInfo`) and `machine.cpu`; a placeholder that cannot be filled is a build
  error caught by `tools/lessons-lint.mjs` (section 7), not a blank on the screen.
- `{term}` marks a glossary term; the first occurrence in a lesson is rendered as a chip under
  the details; later ones are plain.
- A `check` beat holds the stage and puts the question in the caption card; the options are
  chips; a wrong answer shows `why` in the details and keeps the beat; Auto never answers.
- The expected screen texts of `tests/machine.test.mjs:70-110` are the default `until: {screen}`
  conditions for `run` beats of sample-based lessons.

---

## 4 The curriculum for v1

Nine lessons for the 8086 (the base), five to seven for each later machine, every later machine's
first lesson being "what changed" (brief principle 6). `Program` is a `SAMPLES` id (bios.js:2680
ff.; ids checked at 2682-7968) or `letter` (the Explain program carried as source). Beats are the
compiled count at the default policy; minutes are at a reader's pace.

### 8086 (1978)

| # | Title | Program | The idea it teaches | Beats | Min |
|---|---|---|---|---|---|
| 1 | The board | letter (shots only) | What each chip is for: CPU, clock, latches, transceivers, bus controller, decoder, RAM, ROM, CGA, 8259A, 8253, 8255, 8237, keyboard, speaker (the six-beat tour of explain3d.js:259-267 plus nine chips from `INFO_86`, board3d.js:210-230) | 15 | 6 |
| 2 | One byte to the screen | letter | A program is bytes; a register load, a segment, one bus write, the letter (section 3.4) | 19 | 9 |
| 3 | Registers and the ALU | fib | AX BX CX DX, ADD, XCHG, the flags as the result of the last operation; the die as the stage (UNIT beats: REGISTERS, ALU, FLAGS) | 17 | 8 |
| 4 | The bus cycle: T1, T2, T3 | vram | `expand: 'cycle'` on one STOSW: address → latches, status → 8288 command, data → transceivers; the card decodes its own address; even and odd banks | 21 | 10 |
| 5 | Jumps, flags and the queue | fib | CMP sets flags, JNZ reads them; a taken jump flushes the 6-byte queue (`skip: []`, the fetches shown once) | 16 | 8 |
| 6 | The stack | fact | PUSH, POP, CALL, RET, SP going down and up; a frame; recursion seen as three frames in RAM | 18 | 9 |
| 7 | A call into the ROM | hello | INT 10h: the vector table at 00000h, the BIOS in ROM at F0000h, the teletype writes B8000h for you | 18 | 9 |
| 8 | The timer ticks | clock | The 8253 raises IRQ0, the 8259A interrupts, two INTA cycles bring vector 08h, the handler, IRET | 20 | 10 |
| 9 | Keys and ports | keys | HLT and the halt status, IRQ1, IN from port 60h through the 8255: I/O is a bus cycle with a different command | 18 | 9 |

`pi` (the 8087 takes the bus) and `tune` (the timer as sound) are offered in Explore's "more
programs", not as lessons.

### 80286 (1982) — "the AT"

| # | Title | Program | The idea | Beats | Min |
|---|---|---|---|---|---|
| 1 | What changed: the AT board | letter | 8 MHz, A0–A23, 74LS573/74LS245, 82288, the 8042 and the RTC; Ts/Tc with one wait state (`Story.N` for the 286, story.js:22) | 14 | 6 |
| 2 | 24 address wires and the A20 gate | a20 | FFFF:0010 wraps to 00000h with A20 off and reaches 100000h with it on; the extended memory card | 16 | 8 |
| 3 | Protected mode: a descriptor | pm286 (part 1) | LGDT, LMSW; a selector is an index; the descriptor cache steps (`desc`, story.js:207) | 18 | 9 |
| 4 | A fault, and a reset through the keyboard chip | pm286 (part 2) | #GP caught; the CPU cannot leave protected mode: the 8042 resets it and the BIOS resumes | 17 | 9 |
| 5 | Four units at once | ins186 | Bus, instruction, execution and address units; the decoded queue (`DIE286_INFO`, die.js:1919-1942) | 15 | 7 |
| 6 | The coprocessor behind ports | pi | The 80287 reached through ports F8h–FFh (I/O cycles), IRQ13 for errors | 14 | 7 |

### 80386 (1985)

| # | Title | Program | The idea | Beats | Min |
|---|---|---|---|---|---|
| 1 | What changed: 32 bits on a 16-bit bus | fib32 | EAX, a dword needs two bus cycles; BHE/BLE | 15 | 7 |
| 2 | Paging: linear to physical | paging | CR3, a page directory and table, the TLB as a cache of translations, A and D bits (`page` steps, story.js:308) | 20 | 10 |
| 3 | The barrel shifter and the bit instructions | bits | BSF, BSR, BT, SHLD: one clock for any shift count | 14 | 7 |
| 4 | Six units in a line | fib32 | Prefetch, decode, execute, segment, paging, bus; the 16-byte queue | 15 | 7 |
| 5 | The 80387 | quad | FSQRT and FDIV on the 80387; why floating point has its own chip | 13 | 6 |

### 80486 (1989)

| # | Title | Program | The idea | Beats | Min |
|---|---|---|---|---|---|
| 1 | What changed: the cache and the FPU on the chip | letter | 33 MHz, 8 KB cache, 32-byte queue, the FPU inside; the same letter, now the code comes from the cache | 15 | 7 |
| 2 | Cache miss: a line fill | cache | A read misses; a burst of 8 × 2 bytes fills a 16-byte line (`e.burst`, story.js:115-117, folded to one beat) | 17 | 8 |
| 3 | Cache hit: no bus cycle | cache | The same read again: set, tag, way; "a hit, with no bus cycle" (story.js:196) | 14 | 7 |
| 4 | The five-stage pipeline | fib | PF D1 D2 EX WB; one instruction per clock; a stall (`pipe` events) | 16 | 8 |
| 5 | Which CPU is this? | cpuid | Flags bits as feature tests, then CPUID | 16 | 8 |
| 6 | Atomic instructions | atomic | BSWAP and endianness, XADD, CMPXCHG as a lock | 15 | 8 |

### Pentium (1993)

| # | Title | Program | The idea | Beats | Min |
|---|---|---|---|---|---|
| 1 | What changed: two pipes and a 64-bit bus | letter | U and V, 8 + 8 KB caches, 8 bytes per transfer (`bus.hi`, story.js:57) | 15 | 7 |
| 2 | Pairing | p5pairs | Two simple independent instructions in one clock; a dependency breaks the pair (`pipe.paired/reason`, story.js:199-201) | 17 | 8 |
| 3 | Branch prediction | btb | Why guess; the 2-bit counter; a wrong guess costs clocks (`btb` steps, story.js:269) | 18 | 9 |
| 4 | The data cache writes back | cache | MESI states; a write stays in the cache until the line leaves | 15 | 8 |
| 5 | Measuring time: RDTSC | rdtsc | Clocks counted against the 8254 give the MHz | 12 | 6 |
| 6 | The FDIV bug | fdiv | The famous wrong digit; the `fdivBug` switch (machine586.js, map §5.1) | 12 | 6 |
| 7 | A 4 MB page | 4mbpage | CR4.PSE: one directory entry for 4 MB | 14 | 7 |

### Pentium Pro (1995)

| # | Title | Program | The idea | Beats | Min |
|---|---|---|---|---|---|
| 1 | What changed: µops, out of order, L2 in the package | letter | Three decoders, RAT, ROB, five ports, the back-side bus (`DIE686_INFO`, die.js:6831-6854) | 16 | 7 |
| 2 | Decode into µops | ooo | Why an instruction becomes 1 to 4 µops; 4-1-1 (`decode.uops`, map §3.5) | 14 | 7 |
| 3 | Renaming | rename | The RAT gives EAX a new ROB entry each time; chained vs independent (`rat` steps, story.js:203) | 16 | 8 |
| 4 | Out of order, in order again | ooo | A 39-clock DIV and the ADDs that pass it; the ROB retires in order (`uop`, `rob`, story.js:204-208) | 18 | 9 |
| 5 | CMOV: no branch | cmov | The cost of a wrong guess vs predication | 13 | 7 |
| 6 | L1, L2, memory | l2 | Three latencies seen as three step lengths | 15 | 8 |
| 7 | Counting from inside | pmc | WRMSR selects, RDPMC reads: instructions, µops, wrong predictions | 12 | 6 |

The three VGA samples (`plasma`, `wheel`, `modex`) are not lessons in v1; they appear in Explore
when the VGA card is chosen.

---

## 5 The pacing model (numbers)

### 5.1 Time budget of a beat

| Beat kind | Animation | Auto hold (min) | Typical total |
|---|---|---|---|
| `shot` (a tour beat) | cut 0.36 s or move ≤ 1.1 s; no token | reading time | 3 to 6 s |
| `unit` (one inside step) | move-in ≤ 1.1 s (or a cut) + work 0.8 to 1.5 s | reading time | 2 to 3.5 s |
| `cycle` (one bus cycle, folded) | source 0.6 s + wire 1.2 to 1.6 s + target 0.8 s | reading time | 2.6 to 3.4 s |
| `cycle` with `expand: 'cycle'` | three beats: address 1.6 s, command 1.2 s, data 1.6 s | reading time each | 3 × 2 to 3 s |
| `screen` | cut + 0.5 s reveal (`vHide/vShow` of the byte, explain3d.js:299-301, 399-402) | reading time | 3 to 5 s |
| `run` (fast-forward) | glow by `fast(stats)` (board3d.js:3925), capped at 3 s | 0 | ≤ 3 s |
| `check` | none | until answered | — |
| hard cap | 6 s; the compiler splits at a stop above it | | |

**Reading time** = 1400 + 58 · characters(headline) ms (explain3d.js:439), so a 70-character
headline holds 5.5 s in Auto; details are never counted (Auto does not open them). Beat total in
Auto = max(animation, reading) + 500 ms.

### 5.2 Camera

| Move | Duration | Source of the number |
|---|---|---|
| cut (dark → new framing → light) | 180 + 0 + 180 ms | new; `flyTo(..., instant=true)` board3d.js:4220 |
| move within a subject (board → chip, chip → unit) | 900 to 1100 ms | `xpFocus` during a step sets `tr.camB.dur = 1100` (6716) |
| die framing | 650 ms lid window + the move | `openWindow` 650 ms (map §4.6, board3d.js:5346) |
| cross-stage distance rule | cut when the zoom-path length `S` > 1.6 view sizes | `xpCutMs` (6479-6485) already scales by `S`; the shell asks it and cuts instead of flying when the result exceeds 1.8 s |
| easing | `easeInOut` (theme.js:205) for moves; token speed `xpEase` ramps (6489-6498) | |

No camera motion after the animation ends. No chase camera in Lesson mode (`setChase(false)`,
board3d.js:4135). User drag pauses Auto and is undone by Next.

### 5.3 The token and the units

| Quantity | Lesson value | Present value |
|---|---|---|
| token speed on the screen | 360 px/s (`xpTime.travel = 1.3`) | 280 px/s (`XP_PX_S`, board3d.js:1196) |
| work in a unit with a stop | 1.2 s (`xpTime.work = 0.33`) | 3.6 s (`XP_WORK_S`) |
| pass through a glue chip | 0 s stop, 220 ms glow at the pass | 800 ms (`XP_PASS`) — needs the `pass` multiplier of §8.1 |
| stops per bus cycle | 2 (source, target) + at most 1 named in `stops` | about 7 (brief, measured) |
| unit drawing scale | 1 drawing px ≈ 1 screen px | `unitZoom` (7333-7339), unchanged |
| unit tag | name + ≤ 3 facts, 14 px, fades in over 250 ms at the stop | `unitTag` (7489), unchanged |
| block glow | `tgt = 1` at the stop, 0.35 at a pass | `blockGlow` (7275) |

### 5.4 Reduced motion and Auto

| Situation | Rule |
|---|---|
| `prefers-reduced-motion` or the setting | moves become cuts (`flyTo` is instant when `reduced`, board3d.js:4220); the token appears at source, mid-wire and target for 400 ms each; drawings at `u = 1` (`UnitFx.draw(..., reduced)`, unitfx.js:1926); Auto off by default |
| Auto on | beat total = max(animation, reading) + 500 ms; a `check` beat pauses Auto; opening details pauses Auto; the user's Next during a beat finishes the animation instantly |
| Auto off (default) | the animation runs once and holds; Next at any time |
| speed | one control, three values 0.75× / 1× / 1.5× on `AnimClock.setScale` (theme.js:340-345); it scales the animation, not the reading time |
| pause | `AnimClock.setScale(0)` (map §3.7); the board keeps rendering the held frame lazily |

### 5.5 Caption sizes

| Element | Size at 1280 × 720 | Limit |
|---|---|---|
| kicker (`8086 · ADDRESS ADDER`) | 13 px mono, uppercase, muted | 1 line |
| headline | 21 px / 1.35 sans, 500 weight; values in mono with the wire colour | 110 chars, 3 lines box (85 px) |
| details | 15 px / 1.45 sans, muted | 220 chars, 3 lines box (66 px) |
| term chips | 12.5 px mono, outlined pills (the `.xp3-chip` look, explain3d.js:94) | ≤ 3 |
| token label | 18 px mono bold tag + value (the `.xp3-on .bv-tok b` size, explain3d.js:54) | tag ≤ 6 chars, value ≤ 12 |
| stage label | 14 px sans `8288 · bus controller` (the `.bv-lab` size, explain3d.js:57) | ≤ 3 per shot |
| unit tag | 14 px; name in phosphor, facts in text (`.bv-utag`, board3d.js:1542-1546) | 3 facts |

A lesson lint fails a headline over 110 characters or with more than two numbers.

---

## 6 The reuse plan and the module list

### 6.1 Verdicts (the map's table, decided for this design)

| Module | Verdict here | What this design uses |
|---|---|---|
| `src/asm/*`, `src/core/*` | as-is (map §1.2, §1.3) | `Asm86.assemble`, the `Machine*` classes, `biosSource`, `SAMPLES`; `soundCard: false` and `wasm: false` in the lesson page (map §1.3) |
| `theme.js` | as-is + `applyTheme(model)` (map §1.4) | `THEME`, `BUS_COLOR` (191-195), `AnimClock` (340-345), `splitLead` (349-354), `easeInOut` (205), `storage`, `htmlEl/svgEl` |
| `story.js` | as-is (map §2.7.3) | `Story.build`, `busInfo`, `devName` |
| `blocks.js` | as-is | `BlockPanel` in Explore only (board3d.js:7508 creates it); `BlockPanel.termTip` (1705) behind the learner glossary |
| `unitfx.js` | as-is | drawn by the board (`paintUnit`, 7320) and by map mode on a canvas over the DieView block (`UnitFx.draw`, 1909-1946) |
| `board3d.js` `BoardView` | facade (map §2.7.1, §2.8) with three small in-file changes (§8.1) | `xpSet xpFocus xpBox dieEntry focusChip flyTo applyPreset traceDur traceStep traceClear blockGlow unitTag showCard xpTime xpCutMs setChase setReducedMotion show hide resize frame instr event fast reset` |
| `board3d.js` `RunnerView` | drop; `dieKit` (8182-8198, 17 lines) moved into BoardView (map §7 risk 3) | die dives in UNIT beats |
| `board3d.js` `BoardKit` | as-is (8799-8807) | `CHIPS`, `ROUTES`, `INFO`, `DIE_PLANS`, `dieLayout`, `drawInterior`, `traceModel`, `layRoute`, `project` for the board map and the machine chooser cards; the spec builders read `window.__app.machine` (1954-1955): the shell sets `window.__app = { machine }` — no extraction of `specs.js` in v1 |
| `die.js` | facade (map §1.4, §2.7.6) | `DieView` as the map-mode stage: `show resize event instr frame setReducedMotion` (238-249, 266, 295, 363), `select(id, g, zoom)` (1030), `zoomToBlock` (1047), `viewTo` (1214); `DIE*_3D` bridges (41-47, 2812, 4061, 5289, 6856) inverted into label → die id; `go3D` (1278-1287) disabled in the lesson by not defining `window.__app.selectTab` |
| `crt.js` | as-is | `CrtScreen` in the column of Explore, in the stage in map mode; `fullCanvas` read only while a SCREEN beat or the 3D monitor needs it (map §2.7.7) |
| `dock.js` | extract (map §1.4) | `DOCK_REGS*` + `read/fmt/renderFlags/hot` for the "changed" widget of Explore; whole dock in the Workbench behind an adapter |
| `editor.js`, `disks.js`, `memmap.js`, `timing.js`, `audio.js` | as-is / facade, Workbench only (map §1.4) | — |
| `explain3d.js` | mined, not loaded | `plan` (335-389) → `beats.js`; `stepMs` rewrite rules (407-441) → `beats.js`; `loop/next/jump/key` (477-521, 652-661) → `director.js`; the tour and letter texts (259-267, 300-316, 274) → lesson data; the CSS sizes (41-118) → `learn.css` |
| `topview.js`, `explain/*`, `app.js` shell, `tips.js`, `sfx.js` | drop for v1 (map §1.4, §1.5; `Sfx` installs document listeners at parse, map §2.3) | — |
| `app.js` engine | extract → `playback.js` (map §3) | — |
| `style.css` | tokens copied (1-188) into `src/learn/tokens.css`; a check tool keeps them equal | the `--*` variables the injected stylesheets assume (map §2.5) |
| `index.html` | rewrite → `src/learn/learn.html` with `/*STYLE*/`, `/*SCRIPT*/` (index.html:11, 428), `<title>`, viewport, `color-scheme` (5-8) | — |
| `build.mjs` | page table (map §6.1) | `node build.mjs --page learn --out dist/learn.html` |

### 6.2 The facade (exact members)

From map §2.2 and §2.8, verified against the reads in board3d.js and die.js:

```js
const api = {
  machine,                                   // the real Machine (read every frame, map §7 risk 7)
  get model() { return CPU_MODEL; },
  get reducedMotion() { return shell.reduced; },
  get mode() { return 'explain'; },          // never 'fast' in Lesson/Explore
  get running() { return play.running; },
  get clock() { return 0; },                 // no manual clocking in the lesson page
  get tracing() { return play.tracing; },    // true while a story plays: event() skips live signals (board3d.js:3868)
  get motion() { return AnimClock.scale; },
  get stepMs() { return play.stepMs; },      // the member the old api lacked (board3d.js:7038/7041/7075)
  get crtCanvas() { return stage.wantsScreen ? crt.fullCanvas : null; },
  get crtVersion() { return crt.version; },
  select(kind, id) { emit('select', { kind, id }); },
  view(name) { return name === 'board' ? board : null; },   // no 'runner' (dieKit lives in BoardView now)
  on(name, cb) { (handlers[name] ||= []).push(cb); },
};
window.__app = { machine };                  // for the spec builders (board3d.js:1954-1955) only
```

Drivers the shell owns (map §2.7.1): one rAF loop calling `board.frame(animNow(), dt *
AnimClock.scale)` and `die.frame(...)` for the visible stage only, `crt.frame(now)`; a
`ResizeObserver` per host calling `resize()`; the fan-out `event(e, clockMs)` to the board, the
die and the changed-registers widget in that order (map §3.3), hidden or not; `traceDur(s, ms)`
then `traceStep(story, i, {ms, back, auto})` in the same frame (map §7 risk 5).

### 6.3 The module list (`src/learn/`, all LF)

| File | Lines (est.) | Role | Reuses |
|---|---|---|---|
| `learn.html` | 120 | the entry: top bar, stage host, column, chooser and first-visit templates; the two markers | index.html:5-11, 428 |
| `tokens.css` | 190 | the token block and five palettes | style.css:1-188 copied |
| `learn.css` | 480 | the layout, the caption card, the outline, the chooser, the map-mode rules, reduced-motion rules, the one rule that hides the board chrome (`.bv-top,.bv-pop,.bv-focus,.bv-hint{display:none}`, map §2.7.1) | explain3d.js:41-118 sizes |
| `facade.js` | 90 | §6.2 | map §2.8 |
| `playback.js` | 560 | the engine extracted from app.js: `buildRom` (133-151), `assemble/load` (1081-1099), `boot` (1115-1146), `beginInstr/dispatchUntil/finishInstr` (1329-1402), `enterStep` (638-655), `traceNext/Prev/Go` (499-545, 623-637), `startFF/ffFrame/ffStop` (546-611), `readMs/stepMs/tracing` (393-398), `caption` (1556-1578); events per map §3.3 | app.js |
| `stage.js` | 240 | the stage host: WebGL probe, `BoardView` or map mode, the rAF loop, resize, `show/hide`, the cut overlay (180 ms), exposure | board3d.js:2112-2117, 7738-7830 |
| `shots.js` | 320 | the shot grammar: `focus(ids, scale)` → `xpSet/xpFocus/dieEntry/focusChip/flyTo/applyPreset`; cut-or-move decision via `xpCutMs`; stage labels from `INFO` projected with `BoardKit.project`; the same calls mapped onto `DieView.select/viewTo` and `boardmap` in map mode | board3d.js:432-441, 4212, 5692, 6048, 6479, 6663-6736; die.js:1030-1058, 1214 |
| `beats.js` | 360 | the lesson compiler of §3.3: story steps → beats, the `plan` ordering, the caption rewrite, placeholders, the split rule, spec caching | explain3d.js:335-389, 407-441; story.js:380-406 |
| `director.js` | 340 | the beat engine: `next/back/jump/auto/pause/key`, holds and reading time, reduced motion, progress storage `a86:learn:progress` | explain3d.js:477-521, 652-661 |
| `caption.js` | 220 | the caption card: kicker, headline, details, term chips, number formatting and colouring (`BUS_COLOR`), the check UI | theme.js:191-195, 349-354; blocks.js:1705 |
| `outline.js` | 160 | the outline column block and the lesson chooser page | — |
| `program.js` | 120 | the program block: lines from `lineMap` (assembler.js:1344-1404 via map §1.2), the current line lit from `lineOf(phys)` (app.js:1502-1505) | asm/assembler.js |
| `content.js` | 420 | one unit table keyed by `(part, label)`: `title`, `short` (the `tcard` sub), `long` (`DIE*_INFO`), `dieId` (the inverted `DIE*_3D`); the learner glossary (the 29 gap topics of map §5.6, one line each) wrapping `termTip` | die.js:21-38, 41-47, 1919-1942, 2781-2810, 4036-4060, 5266-5287, 6831-6854; board3d.js:210-296, 1626-2082 |
| `boardmap.js` | 300 | the 2D board for map mode: chip rectangles from `BoardKit.CHIPS`/`chipDims`, names from `INFO`, wires from `ROUTES[id].path` flattened with `layRoute`/`project`, a token along the path, glows | board3d.js:8799-8807 |
| `explore.js` | 260 | Explore: the step list, the full story text, Board/Die tabs, the card toggle, the changed-registers widget | dock.js extract (map §1.4); story.js |
| `changed.js` | 140 | the registers-that-changed widget (the dock extract) | dock.js `DOCK_REGS*`, `read/fmt/renderFlags/hot` |
| `workbench.js` | 420 | the Workbench page: editor, dock adapter, memmap/timing/screen tabs, disks | editor.js, dock.js, memmap.js, timing.js, disks.js, crt.js |
| `shell.js` | 320 | the top bar, routing (`#/learn/8086-02/7`, `#/explore`, `#/workbench`), the machine chooser page, the first visit card, `applyTheme`, storage, `window.__learn` for the tools | theme.js:142-188 |
| `lessons/lessons8086.js` … `lessons686.js` | 6 × 180-360 | the lesson data of §4 | bios.js `SAMPLES` ids |
| **total new** | **≈ 5.3 k** | | |

Files touched outside `src/learn/`: `board3d.js` (three small changes, §8.1: `dieKit` moved into
BoardView, `xpTime.pass`, `xpCovers` takes covers as data); `disks.js`/a new `src/core/font8x8.js`
(`makeFont8x8` moves core-side, map §7 risk 9); `theme.js` (`applyTheme`); `build.mjs` (the page
table); `.github/workflows/pages.yml` (one line). Nothing in `src/core`, `src/asm`, `story.js`,
`blocks.js`, `unitfx.js` changes.

### 6.4 The build entry

```js
// build.mjs — a page table; the present page is PAGES.index
const PREFIX = SCRIPTS.slice(0, SCRIPTS.indexOf('src/ui/theme.js') + 1);          // vendor, asm, core, theme
const LEARN_UI = ['src/ui/audio.js', 'src/ui/crt.js', 'src/ui/editor.js', 'src/ui/dock.js', 'src/ui/disks.js',
  'src/ui/story.js', 'src/ui/blocks.js', 'src/ui/unitfx.js', 'src/ui/die.js', 'src/ui/timing.js',
  'src/ui/memmap.js', 'src/ui/board3d.js'];                                        // no tips, sfx, explain3d, topview, app
const PAGES = {
  index: { entry: 'src/index.html', scripts: SCRIPTS, styles: ['src/ui/style.css'] },
  learn: { entry: 'src/learn/learn.html',
           scripts: [...PREFIX.filter(f => !/x86core|x86wasm|p6ooo/.test(f)), ...LEARN_UI, ...glob('src/learn/*.js'), ...glob('src/learn/lessons/*.js')],
           styles: ['src/learn/tokens.css', 'src/learn/learn.css'] },
};
```

`node build.mjs --page learn --out _site/learn.html`; theme.js stays the first UI file; app.js is
excluded (map §6.1). A `tools/names.mjs` lists the top-level names of the prefix so the new files
avoid the ~300 existing ones (map §7 risk 9); the new page prefixes its classes `Ln*`.

---

## 7 Work packages and milestones

### M0 — the interfaces (days 1-2, one person, everything else waits on this)

- `facade.js` written and frozen (§6.2).
- The beat schema (§3.2) and the step keys (§3.2) as `src/learn/schema.md` plus a JSON-schema
  used by the lint.
- The shot grammar ids: a generated list of every glow id, decap key and block label per model
  (`tools/ids.mjs` from `BoardKit.INFO`, `CHIPS`, `DIE_PLANS`) checked into `docs/rewrite/ids.md`.
- The content table's key `(part, label)` and its columns.
- The three board3d.js changes (§8.1) merged first, each under 25 lines, verified with the fast
  gate (map §6.4) and `tools/shot.mjs` on the old page.
- `build.mjs` page table and `tools/launch.mjs` (`--no-sandbox` as root, the `__vt` virtual
  clock, map §6.5).

### M1 — a board that traces (week 1)

| WP | Files | Owner | Done when |
|---|---|---|---|
| WP1 engine | `playback.js`, `font8x8.js` | A | Node test: boots the 8086 BIOS, runs `letter`, emits `instr/event/step` for every step of every SAMPLES program (the story test without the double reset) |
| WP2 stage | `stage.js`, `facade.js`, `learn.html`, `tokens.css` | B | headless: `BoardView.ok`, first frame, `traceDur/traceStep` of one step on the virtual clock, no console errors; `ok=false` path shows the map-mode host |
| WP3 shots | `shots.js` | C | headless: `focus(['cpu','lat0'], 'region')` frames the union box (asserted on `cam.target/r`); a cut takes 360 ms of virtual time, a move ≤ 1100 ms |

### M2 — a lesson plays (week 2)

| WP | Files | Owner | Done when |
|---|---|---|---|
| WP4 compiler | `beats.js`, `content.js` | A | Node: `letter` on all six models compiles to beats; every placeholder fills; no beat plan > 6 s at the §5 numbers (`xpPlan.Tm` mocked from the segment lengths) |
| WP5 director + caption | `director.js`, `caption.js`, `outline.js`, `program.js`, `learn.css` | B, D | the example lesson §3.4 plays end to end in Auto in 6.5 ± 0.5 min of virtual time; Next/Back/jump work; the layout does not move between beats (assert bounding boxes) |
| WP6 lessons 8086 | `lessons/lessons8086.js` | E (a writer) | nine lessons pass the lint; each plays headless without a caption over the limits |

### M3 — the other stages and doors (week 3)

| WP | Files | Owner | Done when |
|---|---|---|---|
| WP7 map mode | `boardmap.js`, map-mode branch of `shots.js` | C | the example lesson plays with WebGL disabled (`--disable-gpu` and `ok=false` forced) and at 800 × 1200 |
| WP8 Explore | `explore.js`, `changed.js` | B | every story step of `fib` reachable; card toggle; the changed widget shows ES 0000→B800 on `mov es, ax` |
| WP9 lessons 286-686 | `lessons/lessons286..686.js` | E + one writer per two machines | lint clean; each machine's lesson 1 plays headless |
| WP10 shell | `shell.js`, chooser and first visit, routing, `applyTheme` | D | six machines open from the chooser page; deep link `#/learn/80486-02/5` restores the beat |

### M4 — the Workbench and the deploy (week 4)

WP11 `workbench.js` (editor, dock adapter, memmap/timing hosts, disks); WP12 deploy: the learn
page as `_site/index.html`, the old page as `_site/workbench.html` (map §6.3); WP13 tools:
`tools/beatprobe.mjs` (beat durations and camera distances per lesson on the virtual clock),
`tools/lessons-lint.mjs`, `tools/tokens-check.mjs`.

The packages of one milestone touch disjoint files; the only shared files are the frozen ones of
M0. Two people can start WP1 and WP2 on day 3.

---

## 8 Risks and how each is retired early

### 8.1 The board's plan cannot make a 2-4 s bus cycle without touching board3d.js

`xpPlan` gives every pass 800 ms (`XP_PASS`, board3d.js:1196) and scales only `travel`, `work`
and `read` through `xpTime` (6336-6342); a memory write on the 8086 passes the latches, the
controller, the decoder and the transceivers: four passes are 3.2 s before any travel. `trCover`
also reserves 324 px at the left for a block card that Lesson mode never shows, from a storage key
the old page writes (`a86:boardCardMin`, 7224-7229), and `xpCovers` measures `.xp3-prog/.xp3-bar`
by class (7208-7220). **Retire in M0** with three changes of under 25 lines each in board3d.js,
allowed by the brief as "small and clearly needed": (a) `xpTime.pass` multiplier applied where
`XP_PASS` is used; (b) `this.covers = { left, right, top, bottom } | null` overriding
`xpCovers/trCover` when set; (c) `dieKit` moved from `RunnerView` (8182-8198) into `BoardView`
and `this.runner` checks replaced by `this.dieKit` (6046, 6138-6141, 6704). Measure with
`tools/beatprobe.mjs` on the old page first: the `memw` step of `letter` must plan under 3.4 s
with `xpTime = { travel: 1.3, work: 0.33, pass: 0.25 }`. If (a) is refused, the fallback is
`stops: []` plus a custom journey filter in `shots.js` that hides the pass segments — uglier, no
in-file change.

### 8.2 Cuts look like glitches under swiftshader or on a slow laptop

A cut is dark → instant `flyTo` → light in 360 ms; if the first frame after the flight takes 300 ms
to render (new die tiles: `xpPrefetch`, board3d.js:5581, queues them ≤ 8 ms per frame), the learner
sees black then a half-drawn die. **Retire in M1**: `shots.js` calls `xpPrefetch(step, ms, true)`
for the next beat during the current hold (as `next()` does, explain3d.js:503-505), and the cut
overlay waits for one rendered frame (`board.dirty === false` after `frame()`) before fading back,
capped at 500 ms. The headless run asserts the cap on the virtual clock.

### 8.3 The 1.35 stage aspect is wrong for the board

The overview preset (`PRESETS.overview`, board3d.js:433) was tuned for a wide strip; a 908 × 672
stage may show the board small with empty sky. **Retire in M1** by rendering the six boards at
the overview in the new host and adjusting `fitRadius`/`xpShotBox` padding through `shots.js`
options (`theta`, `phi`, `keepY` are already parameters, 6696, 6722); if the board still needs a
wide frame, the column narrows to 320 px for BOARD beats only — a one-time layout per lesson, not
per beat, so principle 4 holds.

### 8.4 Map mode is two different pictures for the same beat

DieView block ids and the board's block labels are bridged only by `DIE*_3D` (die.js:41-47 etc.),
one way, with `null` labels for the pads, and `Die586View`/`Die686View` have unit sets the board
plans do not (`D686_UNITS`, die.js:6796 vs `DIE_PLANS` P6, board3d.js). A UNIT beat may name a
label the die view cannot select. **Retire in M0-M2**: `tools/ids.mjs` emits, per model, the
labels with no die id; the lint rejects a lesson whose `stops` or `focus` name such a label; the
content table (`content.js`) fills the missing bridges as data (a label → die id column) without
touching die.js.

### 8.5 The reading rule holds too long or too short

1400 + 58 ms per character comes from Explain and was tuned for a different card. **Retire in
M2** with three readers and `tools/beatprobe.mjs` printing hold vs animation per beat; the
constants live in one place (`director.js`) and the speed control scales animation only, so the
fix is a number.

### 8.6 The one-scope build and the parse-time model

A new top-level name that collides with one of ~300 blanks the page (map §7 risk 9); one machine
per load (risk 1). **Retire in M0**: `tools/names.mjs` in the fast gate; every learn file uses the
`Ln` prefix or lives inside one `const Learn = (() => { ... })()`; the chooser is a page that
reloads (§2.6), and the "what changed" lessons compare with words and the previous machine's
numbers written in the lesson data, never with two machines on one screen.

### 8.7 Content volume

Forty lessons at 15-20 beats are 600-800 headlines and as many details lines, plus a learner
glossary of about 60 terms. The compiler writes the generic beats from the story, so a lesson
author writes 8-14 sentences per lesson and overrides the rest; still, the writing is the long
pole. **Retire in M1**: the lint and the beat probe exist before the first lesson is written, so a
writer gets timing and length feedback in seconds; the 8086 lessons are written by one person in
M2 as the model for the others.

---

## 9 What is deliberately left out

- **The block card on the lesson stage.** Explore has it; the lesson's details layer carries its
  sentence. Two texts on one screen is what the brief measured as the problem.
- **The old speed slider** (seven explain stops + three fast stops, map §3.6). Lesson mode has
  Next, Auto and a three-value speed; `speedAt` stays for the Workbench.
- **Manual clocking** in Lesson and Explore (`clock` is always 0 in the facade); the Workbench
  keeps it.
- **Two machines side by side.** The parse-time freeze makes it a large refactor (map §7 risk 1);
  the "what changed" lessons do the comparison in words and with one number from the earlier
  machine written in the lesson data.
- **Extracting `specs.js`/`dieplans.js` from board3d.js.** `BoardKit` already exposes them after
  load (8799-8807); the `window.__app = { machine }` shim covers the one back-door. The
  extraction stays a good idea for a later size cut, not a v1 dependency.
- **A phone layout beyond map mode below 900 px**, pop-out windows, the Runner view, sound design,
  the DOS boot UI beyond the disks tab of the Workbench (brief non-goals). `Sfx` and `Tips` are not
  loaded: both act on the whole document at parse (map §2.3).
- **VGA lessons and the sound card lesson** (`plasma`, `wheel`, `modex`, `sb`): available in Explore
  when the card is chosen; lessons later.
- **Live signals while not tracing** (`liveUnits`, `busSig`, the chase camera): the lesson never
  runs free; a `run` beat shows the steady glow of `fast(stats)` for at most 3 s and stops at a
  condition.
- **Pixel-based tests.** Every headless check asserts state (camera, caption text, bounding boxes,
  virtual-clock durations), as the map's budget demands (§6.5).
