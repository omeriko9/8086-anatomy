# Design proposal 2: interaction first

Designer 2 of 4. Angle: the screen and the hand. What the learner sees and does at each moment
decides the data model and the modules, not the other way round. Citations: "map §n" is
`docs/rewrite/01-reuse-map.md`; `file:line` is the working tree at `036454c`.

## 1 Concept (one page)

The page is a **player for lessons**, and a lesson is a **real program run one instruction at a
time, told in beats**. A beat is one caption, one focus on the board or in a die, and at most one
animation. The learner's hand does one thing: **Next**. Everything else (Back, Auto, the outline,
the "?" on a term) exists so that Next is never a trap.

Three layers, one stage. The same 3D board (or, without a GPU, the same die drawing) stays in the
same rectangle across all three; only the card under it changes:

- **Lesson** (default): the caption card and four controls. The program is a small strip in the
  corner of the stage; the machine's values appear only inside the caption and on the die.
- **Explore**: the same stage, the caption card becomes the trace card (step i of n, Back and Next
  per story step, "skip this instruction"), the program listing takes the left edge with the current
  line, and a strip of the registers that changed appears under it. Nothing is hidden by a menu: the
  learner sees the whole story of any instruction of any program on this machine.
- **Workbench**: the present page, built as `workbench.html`, opened with the lesson's program
  loaded. One link there, one link back. (Map §6.3: one more build line; map §2.6: the machine
  choice already carries across pages through `a86:cpu`.)

One machine per page load (`?cpu=`), as today (map §0, §7 risk 1). "What a Pentium does
differently" is taught by a lesson on the Pentium, and by the **same lesson id on two machines**
with the clock counts side by side on the end screen, never by two boards on one screen.

The pacing has three numbers a learner can feel: an animation is **2 to 4 s** (6 at most), a
camera move is **1.1 s** and happens at most once per beat, and Auto waits for the **reading time**
of the caption (1.2 s + 48 ms per character of the lead sentence + 24 ms per character of the
details, 2.5 to 9 s). Next during an animation cuts it to its end state and starts the next beat.
Back re-shows a beat; across an instruction it **re-runs the machine from boot** (the emulator is
deterministic and the boot takes 90 ms in Node, map §3.2), so Back is always honest.

Edge states are beats, not errors: a BIOS call is one beat ("the ROM does 138 instructions to draw
the letter; we skip them"), a loop is one beat after its first pass, a HLT is a beat that waits for
the learner's key, a timer interrupt that the lesson did not plan is a one-beat aside.

What makes it better for the learner than v52: about 6 things on the first screen instead of 45;
captions of at most 90 + 160 characters, always in the same place; the values it names are the
values the machine has; a wrong click is one Back away; and the end of every lesson has three
doors (next lesson, explore this program, change it), so the workbench is reached by wanting it.

## 2 Screens (ASCII wireframes)

All wireframes are 1280 x 720 unless noted. Fixed heights: controls row 56 px, caption card
168 px (lead up to 3 lines of 20 px, details up to 2 lines of 15 px, 16 px padding), stage the rest
(496 px at 720, 676 px at 900). Side gutter 16 px. Nothing moves between beats; every element
below has one fixed slot.

### 2.1 First visit (`learn.html` with no `a86:learn` record)

```
+------------------------------------------------------------------------------+
|                                                                              |
|                   [ 3D board, overview preset, slow idle turn ]              |
|                                                                              |
|        How a PC runs a program, from the inside.                             |
|        Six real machines, from the 8086 of 1978 to the Pentium Pro of 1995.  |
|        Every value you will see is computed by the machine itself.           |
|                                                                              |
|                 [  Start: the 8086, a letter on the screen  (7 min) ]        |
|                                                                              |
|                    Choose a machine     I know this, open the Workbench      |
+------------------------------------------------------------------------------+
```

One big button, two text links. No menu, no toolbars. The board is `BoardView` with its chrome
hidden (map §2.7.1: `.bv-top, .bv-pop, .bv-focus, .bv-hint { display:none }`), camera preset
`overview` (board3d.js:432-441 `PRESETS`, `applyPreset` 4197). If WebGL fails (`board.ok ===
false`, board3d.js:2112-2117) the die drawing of the CPU stands in (`DieView`, die.js:168) and the
same three choices show. Returning visitors land on the **outline** (2.3) at the lesson they left,
with the button reading "Continue: lesson 3, beat 12".

### 2.2 The lesson screen

```
+------------------------------------------------------------------------------+
| A letter on the screen  · 8086            beat 9 of 31   ○○○○○○○○●○○○○○○○○○  |  <- 32 px title bar
|+------------------+                                              +---------+ |
|| mov ax, 0xB800   |                                              | screen  | |  <- code chip (300 px),
|| mov es, ax       |        [ 3D board / die: the stage ]         | peek    | |     screen peek (optional,
||>mov al, 'A'   B0 41                                             | 384x288 | |     only when beat.screen)
|| mov [es:0], al   |                                              +---------+ |
|+------------------+                                                          |
|                            (spotlight on the CPU and the queue,              |
|                             token "B0 41" moving from RAM to the queue)      |
|                                                                              |
|                                                          [unit tag: QUEUE ]  |
+------------------------------------------------------------------------------+
| The code bytes B0 41 come back and go into the queue.                        |  <- lead (≤ 90 chars)
| The BIU fetched them before the EU needed them, so the decoder does not wait.|  <- details (≤ 160), dimmer
| Nothing moves on the bus for this: it happens inside the CPU.                |
+------------------------------------------------------------------------------+
|  ‹ Back        [        Next  ›        ]        ▷ Auto        ☰ Outline      |  <- controls, 56 px
+------------------------------------------------------------------------------+
```

- **Title bar**: lesson title, machine, "beat i of n", one dot per beat (a dot per instruction on
  lessons over 40 beats; the dots are buttons that jump, as the milestones of explain3d.js:719-733).
- **Code chip**: the program, at most 8 lines, monospace, current line bright with its bytes; more
  lines scroll under the current one. It never resizes; on lessons without a program phase it is
  hidden and its slot stays empty. Clicking a line does nothing in Lesson (it is a map, not a
  control); in Explore it is "run to here".
- **Stage**: `BoardView` in a positioned host (board3d.js:1509 `.bv-root`), with the spotlight
  (`xpSet({shots:true, spot:true})`, board3d.js:6663) and one focus per beat (`xpFocus(ids, {fly,
  theta, phi, keepY})`, 6696). The unit tag and the card of a unit at work stay where the board puts
  them today (`unitTag` 7489, `showCard` 7508 at `(12, xpTopPx)`); the code chip is declared to the
  board as a cover so the card sits below it (see 6.2, "covers as data").
- **Caption card**: lead sentence in 20 px, details in 15 px at 70 % opacity (the split is
  `splitLead`, theme.js:349-354). Terms with a one-line meaning are dotted-underlined; the first
  time a term appears in this visit its meaning is shown **inline under the details for that beat**
  (no popover the learner has to open), later times it needs a click or a Tab + Enter. Hex values
  are bold, as explain3d.js:441 does. A beat that ends an instruction adds one line of numbers:
  "IP 0103h · 4 clocks · 0.8 µs".
- **Controls**: four. Next is the widest and the default focus. Auto is a toggle with a running
  ring (the progress of the current beat, explain3d.js:729-733). Nothing else is on the screen.
  "Again" (replay the beat's animation) appears inside the caption card's corner only on beats
  that have an animation; it is the fifth and last control.

### 2.3 The outline (drawer over the stage, Esc or ☰ closes)

```
+------------------------------------------------------------------------------+
| ☰ Intel 8086 · 4.77 MHz · 1 MB · 1978                     Change machine ›   |
|                                                                              |
|  1 ✓ A letter on the screen          7 min   bytes, fetch, the bus, video   |
|  2 ● Hello, byte by byte             8 min   LODSB, flags, JZ, a BIOS call  |
|      ○ The program   ○ Instruction 1: mov si, message   ● Instruction 2 …   |
|  3   Counting: registers and flags   7 min   ADD, JC, the ALU, DIV          |
|  4   Deciding and repeating          6 min   CMP, JBE, LOOP, the queue flush |
|  5   The stack                       7 min   PUSH, CALL, RET, recursion     |
|  6   The screen is memory            6 min   STOSW, B8000h, the colour byte  |
|  7   The clock interrupts            8 min   8253, 8259A, INTA, IRET         |
|  8   Waiting for a key               6 min   HLT, IRQ1, port 60h            |
|  9   The coprocessor                 7 min   8087, the queue watch, NMI     |
|                                                                              |
|  Settings   Auto speed: normal / slower     Motion: as the system says       |
|  Explore this program ›     Open the Workbench ›     About and accuracy ›    |
+------------------------------------------------------------------------------+
```

The current lesson is expanded to its instructions (a second level, from the compiled beats);
finished lessons carry ✓ from `a86:learn.done`. The Settings line is the only place a speed exists
(two values). The three links at the bottom are the whole "progressive disclosure" of the brief's
principle 7, spelled out.

### 2.4 Explore (the same stage; the card changes, the left edge gets the program)

```
+------------------------------------------------------------------------------+
| Explore · Hello, byte by byte · 8086                        ‹ Back to lesson |
|+----------------------+                                                      |
|| 1  mov si, message   |                                                      |
|| 2 >lodsb        AC   |          [ 3D board: the step's flow, token,         |
|| 3  or al, al         |            card of the unit, no spotlight ]          |
|| 4  jz done           |                                                      |
|| 5  mov ah, 0x0E      |                                                      |
|| 6  int 0x10          |                                                      |
|| 7  jmp next          |                                                      |
||  ...                 |                                                      |
|+----------------------+                                                      |
|| AX 0048 ← 0000   SI 0110 ← 010F   IP 0104          FLAGS ---- ---- (no chg)|  <- registers that changed
|+----------------------+-----------------------------------------------------+
| lodsb · step 4 of 9 · T3 · Data                                              |
| The RAM (even bank) puts 48h on the data bus. The 8286 transceivers pass it   |
| to the 8086. The EU gets the value.                                          |
+------------------------------------------------------------------------------+
|  ‹ Step      [  Step ›  ]   Next instruction ››   Run to line   ▷ Play   ☰   |
+------------------------------------------------------------------------------+
```

Explore is the old trace mode with the story steps as they come from `Story.build` (map §2.7.3),
no spotlight, the board's own camera (`trTrack`, board3d.js:7032) and the full step text. The
registers strip is the ~120-line lift of `dock.js` (`DOCK_REGS*`, `read/fmt/show/setReg/
renderFlags/hot`, map §1.4) rendering only registers whose value changed in the last instruction.
"Run to line" fast-forwards to a clicked line (`startFF('skip', until)`, app.js:546-556). "Play"
is the old auto trace at the fixed 1700 ms stop. No speed slider, no dock, no memory or timing
view: those are the Workbench.

### 2.5 The Workbench

The present page as `workbench.html` (map §6.1: the page table; §6.3: `_site/workbench.html`).
The learner reaches it from the outline, from the end screen's third door, or from Explore's
"Change this program". The hand-off is a one-shot record `a86:handoff = { src, name, cpu, from:
'learn', lesson }` written by the learn page; the old shell reads and deletes it in
`loadInitialProgram` (a 6-line addition, the one touch on app.js), so `a86:src` (the user's own
program, map §2.6 rule) is never overwritten silently: the old page loads the handed program into
the editor and shows "Program from lesson 2 — your own program is in the Samples menu as 'My
program'". The old top bar gains one chip "‹ Lesson" when `from === 'learn'` (4 lines), pointing
at `learn.html?cpu=…&lesson=…&beat=…`; browser Back works too because both are one tab.

### 2.6 The machine chooser (a full overlay, from "Choose a machine" or "Change machine")

```
+------------------------------------------------------------------------------+
|                          Six machines, one program                           |
| +---------+ +---------+ +---------+ +---------+ +---------+ +---------+      |
| | 8086    | | 80286   | | 80386   | | 80486   | | Pentium | | P. Pro  |      |
| | 1978    | | 1982    | | 1985    | | 1989    | | 1993    | | 1995    |      |
| | 4.77MHz | | 8 MHz   | | 25 MHz  | | 33 MHz  | | 66 MHz  | | 200 MHz |      |
| | [board] | | [board] | | [board] | | [board] | | [board] | | [board] |      |
| | 6-byte  | | 16 MB,  | | 32 bits,| | a cache | | two     | | µops out|      |
| | queue,  | | protec- | | paging  | | on the  | | pipes,  | | of order|      |
| | one bus | | ted mode|         | | chip    | | guesses | |         |      |
| | 9 lessons| 6 lessons| 6 lessons| 6 lessons| 7 lessons| 7 lessons|        |
| +---------+ +---------+ +---------+ +---------+ +---------+ +---------+      |
|   The letter program takes 4 instructions on all of them:                    |
|   47 clocks · 9.8 µs      41 · 5.1 µs     …                                   |
+------------------------------------------------------------------------------+
```

Choosing a card is `storage.set('cpu')` + `location.href = 'learn.html?cpu=…'` (the reload of
map §0; the address wins and sticks through `URL_PARAMS`, theme.js:154-155). The board thumbnails
are static PNGs made once by `tools/shot.mjs` (map §6.5), not six WebGL contexts. The bottom line
is the cross-machine hook: the clocks of the letter lesson on each machine, computed once in Node
and stored in the lesson data (`lessons/compare.js`), so the learner sees the reason to visit
another machine before visiting it. (The numbers in the wireframes of this document are
illustrative; `lessoncheck` produces the real ones.)

### 2.7 The end of a lesson

```
+------------------------------------------------------------------------------+
|                 [ stage: the screen's top-left corner, the letter A ]        |
+------------------------------------------------------------------------------+
| Four instructions, 47 clocks: 9.8 µs at 4.77 MHz. The CPU had to fetch each  |
| code byte over the bus before it could use it, and one byte to the video     |
| memory made a letter. That is all a program does: move bytes and calculate.  |
|                                                                              |
| Quick check: why did the letter appear only after the last instruction?      |
|   ( ) The CPU draws the screen when a program ends                           |
|   (•) The CGA card reads B8000h 60 times a second; the byte arrived then     |
|   ( ) The BIOS printed it                                                    |
|   Right. The card draws from its memory; the CPU only wrote a byte.           |
+------------------------------------------------------------------------------+
| [ Next lesson: Hello, byte by byte › ]  Explore this program  Change it (Workbench) |
|   Same lesson on the 80286 (41 clocks) · the Pentium (12 clocks)              |
+------------------------------------------------------------------------------+
```

The summary is the kept narrative (explain3d.js:274) with the lesson's real numbers. One check
question, three answers, one line of feedback; wrong answers get the "why" and may retry; the
check never blocks the doors. The last line is principle 6 in one line of numbers.

### 2.8 The phone and the no-GPU laptop

Below 900 px wide, or when `board.ok === false`, the stage is a `DieView` of the CPU (map §2.7.6,
die.js:168-190 picks the subclass) in the stage rectangle, the code chip is one line (the current
instruction), the screen peek is off, and the caption and controls are unchanged. Beats whose
`focus` names board parts (RAM, latches, the card) show the chip's paragraph from `INFO`
(board3d.js:210-296, exported on `BoardKit.INFO`) as a card in the stage, with the die dimmed.
Story steps light the die's units from `event()` (die.js consumes fetch/bus/queue/alu/decode…,
map §3.5). The phone gets a working lesson that reads well and does not break; it does not get
the board (brief principle 8).

### 2.9 Keyboard, focus, announcements

| Key | Lesson | Explore |
|---|---|---|
| Enter, Space, → | Next beat | Next step |
| ← | Back | Previous step |
| A | Auto on/off | Play on/off |
| O, Esc | Outline open / close (Esc also leaves Explore) | same |
| R | Again (replay the beat's animation) | Replay the step |
| N | — | Next instruction |
| ? | Opens the glossary panel for the current caption's terms | same |
| Tab | Back → Next → Auto → Outline → terms in the caption → code chip → stage | + registers strip |

The stage canvas takes focus only when Tabbed to; then the board's own camera keys apply
(board3d.js:4340 document `keydown`, Esc leaves focus). Typing keys reach the CRT only in the
beats that ask for a key (`beat.wait === 'key'`) and in Explore when the screen peek has focus;
`CrtScreen.key(e, down)` (crt.js:185-216) receives them. The caption card is `role="region"
aria-live="polite"`: the lead sentence is announced on every beat, the details on request (Enter
on the card). `prefers-reduced-motion` calls `setReducedMotion(true)` on every view (map §1.4
contract): camera cuts, instant flows, Auto unchanged.

## 3 The lesson data model

A lesson is a plain object in `src/learn/lessons/<model>.js`, no code except template strings for
numbers the machine supplies. The generic beats of an instruction come from the story steps
(`Story.build`, map §2.7.3); a lesson **chooses which steps become beats, which units get a stop,
and overrides captions**. Everything the player needs at run time is compiled once per lesson
into a flat beat list by `lesson.js` (6.2).

### 3.1 Schema

```js
Lesson = {
  id: 'letter',                       // stable, used in URLs and a86:learn
  machine: '8086',                    // one of the six; a lesson may exist on several machines
  title: 'A letter on the screen', minutes: 7,
  idea: 'one sentence: what the learner can say afterwards',
  program: { sample: 'hello' } | { src: '...', name: 'letter' },   // SAMPLES id (bios.js:2680+) or text
  boot: { bios: 'skip' | 'watch', keys: ['h', 'i', 'Esc'] },        // keys fed when the CPU waits
  intro: [Beat],                      // before the program runs (the tour)
  run:   [Plan],                      // one Plan per instruction execution, in order
  outro: [Beat],                      // after the last Plan; ${clocks} ${us} ${mhz} ${n} substituted
  check: { q, a: ['...', '...', '...'], right: 1, why: '...' },
  next:  { lesson: 'hello', also: ['80286', '80586'] },   // the doors of the end screen
  terms: { bus: 'The shared wires every chip is connected to; one talker at a time.' },
}

Beat = {
  cap: 'Lead sentence. Details sentences.',   // lead ≤ 90 chars, details ≤ 160 (checked by the tool)
  focus: ['cpu', 'clk'] | ['die:cpu'] | { die: 'cpu', block: 'QUEUE' } | 'keep',   // board ids of
                                              // map §4.4 (xpBox) or a die block label (map §4.7)
  cam: { theta: 0.22, phi: 0.85, keepY: false } | 'keep',        // one move at most; default by focus
  card: 'clk.wave' | null,                    // a content.js card id shown on the animation clock
  ms: 6000,                                   // Auto minimum for a tour beat (default: reading time)
  hold: true,                                 // Auto stops here and waits for Next
  screen: true,                               // the screen peek shows for this beat
  wait: 'key',                                // the beat ends when the learner types (HLT lessons)
  run: { until: 'ret' | 'label' | 'irq' | 'iret' | 'wake' | 138, show: 'glow' | 'none' },
                                              // a fast run folded into one beat (loops, BIOS calls)
}

Plan = {
  at: 'lodsb' | 3 | { label: 'next', nth: 2 },   // which instruction: its text, its line, or a label
  what: 'Read the byte at DS:SI into AL and move SI on.',   // the second sentence of the instruction beat
  cap: null,                                  // override of the instruction beat ("Instruction 2: …")
  steps: 'full' | 'brief' | 'skip' | Policy,  // which story steps become beats
  captions: { Decode: '...', 'bus.data@vram': '...', 'Address calculation': '...' },   // by step key
  stops: { 'T1 · Address': ['ADDRESS ADDER', 'BUS CONTROL'], Execute: ['ALU', 'FLAGS'] },   // ≤ 3 each
  after: [Beat],                              // beats after Done (e.g. "The letter appears")
  fold: { until: 'ret', cap: 'The BIOS does the rest: …' },   // this instruction and what follows,
                                              // folded into one beat (calls, loops, handlers)
  assert: { AL: 0x41, ZF: 0 },                // checked in Node by tools/lessoncheck.mjs
}

Policy = { fetch: 'first' | 'all' | 'none', inside: true, bus: true, cache: 'first', split: true }
```

Step keys (for `captions` and `stops`) are the story's `title` values with an optional
`@device`: `Decode`, `Address calculation`, `Execute`, `Interrupt`, `Descriptor`, `Protection`,
`Task switch`, `Prefetch`, `Halt`, `Interrupt request`, `DMA transfer`, `Cache miss…`, `Page walk`
(story.js:84, 96, 103, 153, 161, 175, 209-212, 243, 269-308, 325, 359), and for bus steps `bus.addr`,
`bus.cmd`, `bus.data` with `@ram @rom @vram @pic @pit @ppi …` from `s.dev` (story.js:69-70,
`Story.devName`). Board ids and block labels must be the exact spellings of map §4.7; the check
tool verifies every id against `BoardKit.INFO`, `DIE_PLANS` and `BLK_*` (board3d.js:210-296,
733-856, 857-882).

### 3.2 Compilation rules (lesson.js; the ported rules cite their source)

1. `intro` beats pass through. A `focus` of board ids becomes `xpFocus(ids, cam)`; `die:x`
   calls `dieEntry(x)` first (board3d.js:6048) as explain3d.js:261 does.
2. For each `Plan`, the player runs the machine to that instruction (`beginInstr`, app.js:1329),
   builds the story (`Story.build(events, { prefetch: 'parallel', burst: 'fold' })`), and orders
   the steps with the ported `plan()` (explain3d.js:335-389: the fetches that bring this
   instruction's bytes go before Decode; a cache line fill plays its first cycle in full and the
   rest as one quick beat).
3. Policy `'full'` = every ordered step is a beat; `'brief'` = `{ fetch: 'first', inside: true,
   bus: true, cache: 'first', split: true }`; `'skip'` = only the instruction beat and Done.
   Default when `steps` is absent: `'brief'` for the first execution of an instruction text in
   the lesson, `'skip'` for later executions (a loop shows its body once).
4. Captions: `captions[key]` wins; else the step's `text` rewritten by the ported rules
   (explain3d.js:407-441): later code fetches get the short forms ("A code fetch: the BIU sends
   the address …"), µop numbers and absolute clocks are stripped on the P6, "why" is appended to
   Decode when no fetch preceded it, and a caption over 230 characters is split at the sentence
   nearest its middle into two beats. Then the new limit: lead ≤ 90 and details ≤ 160, else the
   check tool fails the lesson (the author shortens or splits).
5. Stops: the board's journey visits every unit on the path (`trJourney`, board3d.js:6132);
   the compiled beat carries `stops` and the player passes them in `traceStep(…, { stops })`;
   without a list, the default is **the two ends of the transfer** (from-unit and to-unit).
6. Done: one beat per instruction, "Done: IP moves to 0103h, the next instruction. This one took 4
   clocks." (explain3d.js:316), plus the `after` beats.
7. `fold`: the instruction beat is shown, then `startFF(why, until)` (app.js:546-556) runs the
   machine with the fast glow (`fast(stats)`, board3d.js:3925) for at most 1500 ms of wall time
   (the P6 in JS can be slow; the run is chunked by `ffFrame`, app.js:557-596), then one caption.
   `until: 'ret'` = the return address of this CALL/INT (the next physical IP, as `traceSkip`
   computes it, app.js:527-545); `'label'` = a program label; `'irq'` = the next `int{src:'irq'}`
   event; `'iret'` = back in the program segment; `'wake'` = `skipHalt()` (app.js:1316-1326).
8. Unplanned events: a hardware interrupt step (`INTR xxh`, its own `cpu.step()`, map §3.5) in a
   Plan that does not mention `'Interrupt request'` becomes an aside beat "The timer interrupted
   (18.2 times a second). Its handler runs and returns; we skip it." with `fold: { until: 'iret' }`,
   and the Plan's own beats continue. A REP iteration beyond the first (cpu.repState) is folded
   into "CX more times" unless the Plan lists it.

### 3.3 A full example lesson: `letter` on the 8086

```js
LESSONS_8086.push({
  id: 'letter', machine: '8086', title: 'A letter on the screen', minutes: 7,
  idea: 'A program is bytes in memory; the CPU fetches them over the bus, decodes them, and one write to the video memory puts a letter on the screen.',
  program: { name: 'letter', src: `
        org 0x100
        mov ax, 0xB800      ; the video memory segment
        mov es, ax
        mov al, 'A'
        mov [es:0], al      ; the first cell of the screen
        ret` },
  boot: { bios: 'skip' },
  intro: [
    { cap: 'This program has four instructions, at the top left. The assembler changed each line into bytes: the CPU sees only these bytes.',
      focus: [], cam: 'keep', ms: 6000 },
    { cap: 'The 8086 runs them, at 4.77 MHz. Inside it, the execution unit decodes and executes, and the bus interface unit fetches the code into a 6-byte queue and talks to the bus.',
      focus: ['cpu', 'clk'], ms: 7500 },
    { cap: 'One clock is 210 ns. The crystal gives 14.318 MHz, and the 8284A divides it by 3.',
      focus: ['die:clk'], card: 'clk.wave', ms: 8000 },
    { cap: 'The CPU talks to everything through the bus. The 8282 latches hold the address, the 8286 transceivers pass the data, the 8288 bus controller makes the commands, and the decoder selects the chip that answers.',
      focus: ['cpu', 'lat0', 'lat1', 'lat2', 'xcv0', 'xcv1', 'bus', 'dec'], ms: 7500 },
    { cap: 'The program bytes are in the RAM, from address 10100h. Two banks: even addresses in one, odd in the other, so a 16-bit word arrives in one go.',
      focus: ['ramE', 'ramO'], ms: 5000 },
    { cap: 'The CGA card has its own video memory at B8000h. It draws the screen from it 60 times a second. Now the screen is empty.',
      focus: ['cga', 'monitor'], ms: 6000, hold: true },
  ],
  run: [
    { at: 'mov ax, 0xB800', what: 'Put the number B800h in register AX.', steps: 'full',
      captions: {
        'bus.data@ram': 'The RAM puts the code bytes on the data bus. The 8286 transceivers pass them to the 8086, which puts them in the queue. Every instruction starts this way: as bytes from memory.',
        Decode: 'The EU takes 3 bytes from the queue and decodes "mov ax, B800h". B8 means "put a word in AX"; 00 B8 is the word, low byte first.',
        Execute: 'The EU writes B800h into AX. A register is the CPU\'s own memory: sixteen bits, no bus cycle, no wait.' },
      stops: { Decode: ['QUEUE', 'DECODER'], Execute: ['REGISTERS'] },
      assert: { AX: 0xB800 } },
    { at: 'mov es, ax', what: 'Copy AX to the segment register ES.', steps: 'brief',
      captions: {
        Execute: 'The value B800h goes from AX (in the EU) to ES (in the BIU). Nothing goes on the bus: this happens inside the CPU. ES now names the 64 KB block that starts at B8000h.' },
      stops: { Execute: ['REGISTERS', 'SEGMENT REGS'] } },
    { at: "mov al, 'A'", what: 'Put the code of the letter A (41h) in AL.', steps: 'brief',
      captions: { Decode: 'Two bytes this time: B0 means "put a byte in AL", 41 is the byte. 41h is how the machine spells the letter A.' },
      stops: { Execute: ['REGISTERS'] } },
    { at: 'mov [es:0], al', what: 'Write AL to the first cell of the video memory.', steps: 'full',
      captions: {
        'Address calculation': 'The BIU adder calculates ES × 16 + 0000h = B8000h. That is how a 16-bit CPU reaches a 20-bit address: a segment times sixteen, plus an offset.',
        'bus.addr@vram': 'The 8086 puts B8000h on the address lines. ALE makes the 8282 latches hold it, because the same lines carry data next.',
        'bus.cmd@vram': 'The 8288 reads the status "memory write" and sends MWTC. The card in the slot decodes the address itself: B8000h is its memory.',
        'bus.data@vram': 'The 8086 puts 41h on the data bus. The 8286 transceivers send it to the video memory, which keeps it.' },
      stops: { 'Address calculation': ['ADDRESS ADDER'], 'bus.data@vram': ['BUS CONTROL'] },
      after: [
        { cap: 'The CGA card reads its video memory 60 times a second to draw the screen. At its next frame, the first cell holds 41h = the letter A, with the colour byte 07h: grey on black. The letter appears.',
          focus: ['screenTL'], cam: { theta: 0.08, phi: 1.42, keepY: true }, screen: true, ms: 6500, hold: true } ] },
    { at: 'ret', what: 'Back to the PSP, where INT 20h ends the program.', steps: 'skip',
      fold: { until: 'wake', cap: 'RET jumps to address 1000:0000, where two bytes CD 20 mean INT 20h: "end the program". The BIOS prints a note and stops the CPU with HLT.' } },
  ],
  outro: [
    { cap: '${n} instructions, ${clocks} clocks: ${us} at ${mhz} MHz. The CPU had to fetch each code byte over the bus before it could use it, and one byte to the video memory made a letter. That is all a program does: move bytes and calculate.',
      focus: ['screenTL'], cam: { theta: 0.08, phi: 1.42, keepY: true }, ms: 9000, hold: true },
  ],
  check: { q: 'Why did the letter appear only after the last instruction?',
    a: ['The CPU draws the screen when a program ends', 'The CGA card reads B8000h 60 times a second; the byte arrived then', 'The BIOS printed it'],
    right: 1, why: 'The card draws from its memory; the CPU only wrote a byte there.' },
  next: { lesson: 'hello', also: ['80286', '80586', '80686'] },
  terms: { queue: 'Six bytes the BIU fetched ahead, so the EU rarely waits for the bus.',
           latch: 'A chip that holds a value after the wires that gave it move on.',
           'segment': 'A 64 KB window into the 1 MB memory; its start is the segment register × 16.' },
});
```

Compiled, this lesson is 6 intro beats + 4 instruction beats + about 19 step beats + 4 Done + 1
after + 1 fold + 1 outro = **36 beats**, 7 minutes at a learner's Next pace, 4½ in Auto. The
texts are the kept narratives of map §5.5 (explain3d.js:259-267, 310, 316, 274; explain.js:227,
206) with the gaps of map §5.6 items 1, 3, 4, 5 answered in the details sentences.

### 3.4 The check questions and the assertions

`check` is one question per lesson. `assert` on a Plan is for the author, not the learner:
`tools/lessoncheck.mjs` boots the real machine in Node (as tests/machine.test.mjs does), runs
every lesson's program to each Plan and compares registers (`cpu.regs`, `cpu.f`), then compares
the final screen with the expected texts already in tests/machine.test.mjs:70-110 for lessons on
a SAMPLE. A lesson with a wrong `at` (an instruction text that never executes) fails there, not in
front of a learner.

## 4 The curriculum for v1

"Wave" is the authoring order (7.2): wave 1 ships first. Programs are `SAMPLES` ids (bios.js,
map §5.4) unless named `src:`. Each first lesson of a machine is the same letter program (the
Explain `SRC`, explain3d.js:11-18; the P5/P6 six-instruction variant), so the learner meets a
new machine with a program they know.

### 4.1 Intel 8086 (9 lessons)

| # | Title | Program | The idea it teaches | Wave |
|---|---|---|---|---|
| 1 | A letter on the screen | src: letter | Bytes, fetch over the bus, decode, a register, a write to B8000h, the card draws (§3.3) | 1 |
| 2 | Hello, byte by byte | hello | LODSB and DS:SI, OR sets the flags, JZ decides from ZF, `int 10h` as a folded BIOS call (138 instructions), JMP flushes the queue, the loop shown once then folded (gaps 8, 9, 14) | 1 |
| 3 | Counting: registers, the ALU and the flags | fib | ADD and CF, XCHG, DIV in the ALU, why so few registers, a routine (CALL) folded then opened once (gaps 3, 25) | 1 |
| 4 | Deciding and repeating | sort | CMP keeps only the flags, JBE, LOOP and CX, memory reads and writes of the array, what a jump costs the queue | 2 |
| 5 | The stack | fact | PUSH and POP on SS:SP, CALL pushes IP, RET pops it, a frame per call, recursion as frames piling up (gap 10) | 2 |
| 6 | The screen is memory | vram | STOSW, REP as one iteration per beat then folded, the attribute byte, the card decodes its own address (gaps 7, 15) | 2 |
| 7 | The clock interrupts | clock | The 8253 counts, IRQ0 to the 8259A, INTR, two INTA cycles carry vector 08h, the vector table, the handler, IRET (gap 11) | 1 |
| 8 | Waiting for a key | keys | HLT as a status, IRQ1, port 60h read (IORC vs MRDC), I/O ports vs memory, the beat waits for the learner's key (gap 12) | 2 |
| 9 | The coprocessor | pi | The 8087 watches the queue, ESC opcodes, it takes the bus, 80-bit numbers, why a second chip (gap 16) | 3 |

### 4.2 Intel 80286 (6 lessons)

| # | Title | Program | The idea it teaches | Wave |
|---|---|---|---|---|
| 1 | What changed: the AT board | src: letter | Same four instructions: 24 address lines, 74LS573/74LS245/82288, Ts/Tc with a wait state, 8 MHz, 41 clocks vs 47 (gap 26) | 1 |
| 2 | Four units at once | fib | Bus, instruction, execution and address units; the decoded queue; the address unit adds base + offset (story 'Address calculation', story.js:153) | 2 |
| 3 | The 1 MB wrap and A20 | a20 | FFFF:0010 lands at 00000h with A20 off, at 100000h with it on; the 8042 and port 92h (gap 4) | 2 |
| 4 | Protected mode: a descriptor is a permit | pm286 (first half) | LGDT, a selector indexes a table, the descriptor cache steps ('Descriptor', story.js:209), LMSW (gap 17) | 2 |
| 5 | A fault, and the way back | pm286 (second half) | #GP as an exception step ('Protection'), the handler, no way out of protected mode but a reset through the 8042 | 3 |
| 6 | New instructions, new frames | ins186 | PUSH imm, ENTER/LEAVE building a frame, PUSHA/POPA, IMUL imm | 3 |

### 4.3 Intel 80386 (6 lessons)

| # | Title | Program | The idea it teaches | Wave |
|---|---|---|---|---|
| 1 | What changed: 32 bits on a 16-bit bus | src: letter | Same program, 25 MHz; the six units; `mov eax` would take two bus cycles per dword | 1 |
| 2 | Registers grow: EAX | fib32 | ADD on 32 bits, two bus cycles per dword, ROL for hex, a 32-bit DIV | 2 |
| 3 | Bit instructions | bits | BSF/BSR/BT, SETC, MOVZX/MOVSX, SHLD through the barrel shifter | 3 |
| 4 | Paging: linear to physical | paging (first half) | CR3, a page directory and a page table, the page walk steps ('Page walk', story.js:308), why (gap 18) | 2 |
| 5 | The TLB remembers | paging (second half) | The second access hits the TLB; A and D bits set by the CPU; CR0.PG | 3 |
| 6 | Same program, faster | hello | The hello lesson of the 8086 on the 386: fewer clocks, the same bus cycles; what the clock rate buys and what it does not | 3 |

### 4.4 Intel 80486 (6 lessons)

| # | Title | Program | The idea it teaches | Wave |
|---|---|---|---|---|
| 1 | What changed: a cache on the chip | src: letter | The first fetch misses: a line fill burst of 8 words ('Cache miss: line fill', story.js:278; the fold rule of explain3d.js:376-386), then hits from the cache | 1 |
| 2 | The pipeline: five stages | fib | PF D1 D2 EX WB, one instruction per clock when nothing stalls, the `pipe` events (gap 20) | 2 |
| 3 | Why caches: small array, big array | cache (first half) | Locality; the 8254 times two loops; hits and misses counted (gap 19) | 2 |
| 4 | Cache off | cache (second half) | CR0.CD and WBINVD, the same loops without the cache, the ratio on the screen | 3 |
| 5 | Which CPU am I? | cpuid | FLAGS bits as feature tests, EFLAGS.AC and ID, CPUID as a lesson in "asking the chip" | 3 |
| 6 | Atomic instructions | atomic | BSWAP and little endian, XADD, CMPXCHG as a lock (gap 2 for endianness) | 3 |

### 4.5 Pentium (7 lessons)

| # | Title | Program | The idea it teaches | Wave |
|---|---|---|---|---|
| 1 | What changed: two pipes and a 64-bit bus | src: letter (six instructions) | Instructions 3 and 4 pair in U and V in the same clock (explain3d.js:33 `pair`); the 64-bit fill of 4 × 8 bytes; the colour byte makes the letter white on blue | 1 |
| 2 | Pairing and dependencies | p5pairs | 'U pipe: it pairs with …' vs 'alone: V reads a register that U writes'; the `pipe` steps; RDTSC times the two loops (gap 21) | 2 |
| 3 | Guessing the jump | btb | The BTB entry, the 2-bit counter, a wrong guess costs clocks ('Branch: wrong prediction', story.js:269) (gap 22) | 2 |
| 4 | Two caches, write-back | fib | Code cache and data cache; a write stays in the cache (MESI 'Modified'), the write-back later | 3 |
| 5 | Measuring time with RDTSC | rdtsc | The time-stamp counter vs the 8254; clocks to MHz (gap 24) | 3 |
| 6 | The FDIV bug | fdiv | A famous wrong answer, digit by digit; the `fdivBug` option of `Machine586` (machine586.js:19-20; off by default, the lesson turns it on) | 3 |
| 7 | A 4 MB page | 4mbpage | CR4.PSE, one PDE with PS = 1; why a large page (fewer TLB misses) | 3 |

### 4.6 Pentium Pro (7 lessons)

| # | Title | Program | The idea it teaches | Wave |
|---|---|---|---|---|
| 1 | What changed: µops out of order | src: letter (six instructions) | Decode into µops (`decode.uops`), the RAT renames, the ROB retires in order; the L2 in the package; 200 MHz core, 66 MHz bus (gap 23) | 1 |
| 2 | Out of order: a slow DIV and twenty ADDs | ooo | µops that do not depend on the DIV pass it ('passes 1 older µop … runs out of order on port 0'); the dependent loop waits | 2 |
| 3 | Renaming | rename | Four jobs on EAX; 'renames EAX to ROB 12'; why the RAT breaks false dependencies | 2 |
| 4 | A jump or no jump: CMOV | cmov | Predication vs a mispredicted branch; the cost on random data | 3 |
| 5 | L1, L2 and memory | l2 | Three array sizes, three latencies; the L1 miss → L2 hit → L2 miss steps (story.js:288) | 2 |
| 6 | Counting from inside | pmc | WRMSR selects an event, RDPMC reads it; µops per instruction | 3 |
| 7 | The BTB with history | btb (on the P6) | 4-bit history learns the alternating pattern the Pentium could not | 3 |

41 lessons in all; wave 1 is 8 lessons (three on the 8086, the first of each other machine),
wave 2 is 15, wave 3 is 18. The VGA samples (plasma, wheel, modex) and sb, tune, movsb, bcd,
quad stay reachable in Explore's "More programs" list, without lessons.

## 5 The pacing model (numbers)

| Quantity | Value | Where it comes from |
|---|---|---|
| Animation of a story step | `traceDur(s, 1700)` (board3d.js:6313; 1700 = `TRACE_MS[2]`, app.js:28, the old Explain stop) capped at **4000 ms**; if the board returns more, the player rescales `ms` by 4000/animMs and calls `traceDur` again (cache key `(s, ms)`, 6612) | brief principle 2: 2-4 s, 6 at most |
| Quick beat (a later fetch, "N more transfers") | `traceDur(s, 650)` (explain3d.js:395-398) ≈ 0.9-1.4 s | ported |
| Unit stop (dwell) | 700 ms per stop, at most 3 per beat, default the two ends of the transfer; passed as `traceStep(…, { stops })` | replaces ~7 stops × 3 s of the brief's measurement |
| Camera move | 1100 ms during a step (board3d.js:6717 `dur: 1100`), 1300 ms `flyTo` between steps (4212); **at most one per beat, starting at t = 0 with the caption**; consecutive beats in the same chip keep the camera (`fly: false`) | map §4.4, §4.5 |
| Caption appears | at t = 0 of the beat, never after the move | principle 2: never blocks the reading |
| Reading time | `read = 1200 + 48·lead + 24·rest` ms, clamped **2500-9000** (from `readMs` app.js:393-396 with the details at half weight; the old 900 + 50·lead + 22·rest at 1100 ms) | Auto |
| Beat duration in Auto | `max(anim + 400, read)`; a tour beat uses its `ms` if larger | |
| Beat duration by hand | until Next; a beat is never shorter than **250 ms** (a second Next inside 250 ms is ignored: double-click guard) | |
| Next mid-animation | the current step is completed instantly (the token at its destination, the card at u = 1) and the next beat starts in the same frame; the crossfade is the board's own (`traceStep` replaces the flow, 7032) | |
| Back | the previous beat replays with `back: true` (no re-dispatch, app.js:645; the board replays earlier steps on a jump back, 7048-7057); across an instruction boundary the machine **re-runs from boot** to that instruction with `cpu.trace = null` (map §3.2: 90 ms for the POST in Node; hello is 11k instructions more) — budget 300 ms, with a one-frame "rewinding" state on the card | honest Back |
| Auto pauses | on Outline or glossary open, on `visibilitychange`, on a `hold` beat, on a `wait: 'key'` beat, at a check question; it resumes only by the learner | |
| Auto speed setting | normal (×1) or slower (×1.4 on `read`, animation unchanged); reduced motion: animation instant, `read` unchanged | the only speed in the page |
| Fold (fast run) | ≤ **1500 ms** wall time of `ffFrame` slices (≤ 12 ms each, app.js:557-596) with the glow of `fast(stats)`; if the target is not reached, the beat says how far it got and offers "keep running" | loops, BIOS calls, handlers |
| Halt wait | `wait: 'key'` beats show "Press a key" in the caption; a key from the lesson's `boot.keys` is typed on Next if the learner does not type (`CrtScreen.typeText`, crt.js) | keys lesson |
| Lesson length | 20-40 beats; 5-8 minutes by hand, 3-5 in Auto; the first visit (intro + lesson 1 + lesson 2) fits in 20 minutes | brief audience |
| Beats per instruction | 'full' 6-9, 'brief' 3-5, 'skip' 2 (the instruction beat and Done) | |

Two clocks stay as they are (map §0, §3.7): flows, cards and beat timing on `animNow()`; camera
flights and hover on real time. Pause is `AnimClock.setScale(0)` (explain3d.js:751-755). The
player never uses `setTimeout` for anything a check measures (map §6.5).

## 6 The reuse plan and the module list

### 6.1 Verdict per existing module (following map §1; only the deltas are argued)

| Module | Verdict | Facade / change |
|---|---|---|
| `src/vendor/three.module.min.js` | as-is | build wrapper unchanged (build.mjs:59-71) |
| `src/asm/*.js` | as-is | `Asm86.assemble(src, { origin: 0x100, cpu })` (assembler.js:1344-1404) |
| `src/core/*.js` | as-is, in order | `Machine*` with `{ soundCard: false, wasm: false }` on the learn page (map §1.3: the wasm core is only for `run()` without trace; 21 MB per 386+ instance) — except the two lessons that run long loops (cache, l2), which get `wasm: true` to keep the fold under 1500 ms |
| `bios.js` `SAMPLES` | as-is | the programs of 30 lessons |
| `theme.js` | as-is (v1) | parse-time model stays (map §1.4); `applyTheme(model)` is not needed while one machine = one load. Must stay the first UI file |
| `story.js` | as-is | `Story.build(events, { prefetch: 'parallel', burst: 'fold' })` |
| `blocks.js`, `unitfx.js` | as-is | through the board; `BlockPanel.termTip` (blocks.js:1705, 1750) through `glossary.js` |
| `crt.js` | as-is | `new CrtScreen(host, machine, onKey)` in the screen peek host; `fullCanvas` read only while a beat has the monitor in focus (map §2.7.7: the getter doubles drawing work) |
| `die.js` | as-is (whole file) | `new DieView(host, api)` for the phone/no-GPU stage; `window.__app = { machine, selectTab }` is provided by the facade so `go3D` stays harmless (die.js:1279-1287) |
| `board3d.js` | **facade + four small changes** | see 6.2 |
| `dock.js` | extract ~120 lines → `regsnap.js` | map §1.4 lift-list |
| `disks.js` | `makeFont8x8` moved to `src/core/font8x8.js` (map §1.4, §7 risk 9); the panel stays in the Workbench | |
| `audio.js`, `sfx.js` | as-is, optional | `Sfx` only for the arrive/step sounds; off by default on the learn page (`a86:sfx`) |
| `tips.js`, `topview.js`, `timing.js`, `memmap.js`, `explain3d.js`, `app.js`, `editor.js` | not loaded on the learn page | Workbench only; explain3d.js is mined (6.3) |
| `style.css` | split: lines 1-188 → `src/ui/tokens.css`, the rest stays; both pages list both files | map §2.5: every injected stylesheet needs the tokens |
| `index.html` | the Workbench page; +6 lines in app.js `loadInitialProgram` for `a86:handoff`, +4 for the "‹ Lesson" chip | 2.5 |
| `build.mjs` | page table (map §6.1) | 6.4 |

### 6.2 The four changes to board3d.js (all small, all in the ⟨xp⟩ surface of map §4.4)

1. **`dieKit` into BoardView** (17 lines, board3d.js:8182 → a method next to `dieEntry` 6048;
   `get runner()` 6046 returns `this` when it has `dieKit`). Without it every story step is a flat
   board path and `xpFocus(['die:clk'])` cannot frame a die (map §7 risk 3).
2. **Covers as data**: `xpCovers()` (7208-7220) measures `.xp3-prog`/`.xp3-bar` by class; it
   becomes `this.covers = { top, bottom, left, right }` set by the stage (the code chip's and
   the caption card's rectangles), with the old measurement as the fallback (10 lines). The
   spotlight and the shots then centre in the free area under the new layout.
3. **Stops**: `traceStep(story, i, { ms, back, auto, stops })` filters the `dwell` segments of
   `trJourney(s)` (6132) to the listed block labels, keeping the first and last (8 lines). The
   flow path is unchanged; only where the token pauses changes.
4. **`window.__app` reads** at 1954-1955 (`lineBytes`/`cpuNow`) and 2180 stay; the facade sets
   `window.__app = { machine, selectTab: () => {} }` so they read the real machine (0 lines in
   board3d.js). The spec builders are **not** lifted in v1 (see §9 and risk 8.2); the no-GPU
   stage uses `INFO` paragraphs and die highlights instead of cards.

### 6.3 The facade (`facade.js`, ~90 lines) — the exact members

From map §2.2 and §2.8, verified against the readers in map §2.2's table:

```js
api = {
  machine,                                   // the real Machine (read every frame, map §7 risk 7)
  get model()         { return CPU_MODEL; },
  get video()         { return VIDEO_CARD; },
  get reducedMotion() { return stage.reduced; },
  get mode()          { return 'explain'; },   // never 'fast' on this page
  get running()       { return playback.ff !== null; },   // true only inside a fold
  get clock()         { return 0; },           // no manual clocking on this page
  get crtCanvas()     { return stage.monitorLive ? crt.fullCanvas : null; },
  get crtVersion()    { return crt.version; },
  get motion()        { return AnimClock.scale; },
  get tracing()       { return playback.tracing; },   // true while a story plays (skips live signals)
  get stepMs()        { return playback.stepMs; },    // the member the old api lacked (map §7 risk 5)
  select(kind, id)    { emit('select', { kind, id }); },
  view(name)          { return views[name]; },        // 'board' | 'die'; no 'runner'
  on(name, cb)        { … },                          // 'follow' | 'select' | 'mode' | 'reset'
};
```

Drivers (map §2.7.1): one rAF loop calling `playback.tick(now, dt)`, then `crt.frame(now)`, then
`activeView.frame(animNow(), dt * AnimClock.scale)`; a `ResizeObserver` per host calling
`resize()`; `playback.on('instr' | 'event' | 'fast' | 'reset')` fanned to every view (hidden ones
too) and to `regsnap`; `traceDur(s, ms)` always before `traceStep` in the same frame.

### 6.4 The module list of the new page

All new files LF, under `src/learn/`, plain scripts in the one function scope; top-level names
prefixed `Learn*`/`LN_*` to avoid the ~300 existing names (map §7 risk 9; `tools/names.mjs`
checks). Sizes are estimates in lines.

| File | Lines | What it is | Reuses |
|---|---|---|---|
| `learn.html` | 130 | the shell markup: 14 ids (`ln-stage ln-code ln-peek ln-cap ln-lead ln-more ln-term ln-back ln-next ln-auto ln-outline ln-drawer ln-title ln-dots`), `/*STYLE*/`, `/*SCRIPT*/`, the first-visit and chooser overlays | index.html head (title, viewport, color-scheme, favicon) |
| `learn.css` | 380 | the fixed layout of §2, the drawer, the chooser, the end card; phone rules | `tokens.css`; `.btn .card .tip .crt .sr-only kbd` from style.css (map §1.4) |
| `playback.js` | 550 | the engine of map §3.3, extracted from app.js with the DOM sinks turned into events (`reset instr event caption step instrEnd ff fast speed status`) | app.js:133-151, 1081-1146, 1329-1402, 638-655, 499-545, 546-611, 1316-1326, 1405-1417, 519-524, 393-398 |
| `facade.js` | 90 | §6.3 + the rAF loop + ResizeObserver + fan-out | map §2.8 |
| `stage.js` | 300 | owns the stage host: BoardView or DieView (phone/no-GPU/`ok===false`), `focus(beat)`, `covers`, the screen peek (`CrtScreen`), the unit tag slot, WebGL-lost handling (reload into die mode) | board3d.js `xpSet xpFocus dieEntry xpCard showCard applyPreset setReducedMotion traceDur traceStep traceClear` (map §4.1-4.4), die.js `show resize select` |
| `lesson.js` | 350 | the compiler of §3.2: Lesson → Beat[]; the ported `plan()` and caption rules; step keys; `${}` substitution | explain3d.js:335-389, 407-441 |
| `player.js` | 420 | the beat engine: `next back go(i) auto(on) again hold wait`, the fold runner, the unplanned-interrupt aside, rewind-by-rerun, keys of §2.9, `a86:learn` progress | explain3d.js:477-524, 634-677, 719-777 (loop/next/jump/goBack/key/togglePause), app.js `startFF/ffFrame` through playback |
| `caption.js` | 180 | the caption card: lead/details, term marks, first-use inline meanings, numbers line, "Again", aria-live | theme.js `splitLead`; explain3d.js `layer()` 715-717 |
| `glossary.js` | 120 | `LearnGloss.tip(term, ctx)`: learner terms from `content.js` first, then `BlockPanel.termTip` (blocks.js:1705); the "?" panel listing the current caption's terms | blocks.js `GLOSS KIND_TIP` (map §5.3) |
| `content.js` | 600 (data) | the unit table keyed `(part, label)` → `{ title, short, long, dieId }` merging `DIE*_INFO` (die.js:21-38, 1919-1942, 2781-2810, 4036-4060, 5266-5287, 6831-6854), the 68 `INFO` paragraphs (board3d.js:210-296, via `BoardKit.INFO` at run time, not copied), the `clk.wave` card (explain3d.js:443-465 `clockCard`); ~60 learner terms for map §5.6 items 1-13, 25 | map §5.2 |
| `outline.js` | 220 | the drawer of §2.3: lessons, the current lesson's instructions, progress, settings, the three links | `storage` (theme.js:332-335) |
| `chooser.js` | 150 | the first visit of §2.1 and the machine shelf of §2.6; `?cpu=` reload; the compare line | theme.js `URL_PARAMS`; index.html:25-60 menu texts |
| `explore.js` | 350 | §2.4: the trace card, the listing with the current line and "run to line", step/instruction controls, Play, "More programs", the hand-off to the Workbench | playback `traceNext/tracePrev/traceGo/traceSkip/startFF`; `Disasm86` for the listing bytes |
| `regsnap.js` | 150 | the registers-that-changed strip | dock.js `DOCK_REGS* read fmt show setReg renderFlags hot` (map §1.4), ~70 CSS lines of style.css:863-932 |
| `shell.js` | 280 | boot order (§6.5), layers, URL (`cpu lesson beat layer`), storage keys (`a86:learn`, `a86:handoff`), `window.__learn` for the tools | map §3.1 order, §6.1 |
| `lessons/8086.js` … `lessons/686.js` | 450 / 300 / 300 / 300 / 350 / 350 (data) | the 41 lessons of §4 | `SAMPLES` by id; the narratives of map §5.5 |
| `lessons/compare.js` | 40 (data) | clocks and µs of the letter program per machine, produced by `tools/lessoncheck.mjs` | |
| `src/core/font8x8.js` | 25 | `makeFont8x8` moved from disks.js:402 (disks.js keeps a one-line alias) | map §7 risk 9 |
| `src/ui/tokens.css` | 188 | style.css:1-188 moved | map §2.5 |
| `tools/launch.mjs` | 40 | the shared puppeteer launcher (`--no-sandbox` as root, swiftshader flags) | map §6.5 |
| `tools/lessoncheck.mjs` | 220 | Node: compiles every lesson against the real machine; asserts; caption limits; id spellings against `BoardKit`/`DIE_PLANS`/`BLK_*`; screen text vs machine.test.mjs:70-110; writes `compare.js` | tests/machine.test.mjs, tools/vgapng.mjs `loadCore` |
| `tools/learnsmoke.mjs` | 160 | headless: loads `dist/learn.html` per machine, plays lesson 1 by `__learn.next()` under the `__vt` clock, asserts captions, camera, no `pageerror`, no horizontal overflow, ≤ 6 s animation per beat | tools/shot.mjs, xpmotion.mjs skeleton (map §6.5) |
| `tools/names.mjs` | 60 | lists top-level declarations of the shared prefix and fails on a collision with `src/learn/*` | map §7 risk 9 |

New code ≈ 4,300 lines + ≈ 2,050 lines of data + ≈ 480 lines of tools. The learn page is the
present build minus app.js, explain3d.js, topview.js, timing.js, memmap.js, dock.js, disks.js,
editor.js, tips.js and the wasm cores: about **3.1 MB** before gzip (map §6.1 sizes), 4.2 MB
with `x86core.wasm.js` for the two long-loop lessons — decided by measurement in M1 (risk 8.6).

### 6.5 The build entry and the boot order

`build.mjs` gets a page table (map §6.1):

```js
const PAGES = {
  workbench: { entry: 'src/index.html', styles: ['src/ui/tokens.css', 'src/ui/style.css'], scripts: SCRIPTS_WB, out: 'dist/workbench.html' },
  learn:     { entry: 'src/learn/learn.html', styles: ['src/ui/tokens.css', 'src/ui/learn.css'],
               scripts: [...PREFIX /* vendor, asm, core, theme, audio, crt, sfx, story, blocks, unitfx, die, board3d */, ...LEARN], out: 'dist/index.html' },
};
// node build.mjs --page learn [--out …]; the default (no --page) builds workbench, as today
```

`pages.yml` gets one line: `node build.mjs --page learn --out _site/index.html` next to the
present line retargeted to `_site/workbench.html` (map §6.3). The learn page's boot
(`shell.js`), in the order map §3.1 shows is load-bearing: `buildRom` → `new Machine*` →
`makeFacade` → `stage.create()` (BoardView in the laid-out host, or DieView) → `crt` →
`playback.load(lesson.program)` → `playback.boot({ bios: 'skip' })` (the first `reset()` of every
view) → `stage.show()` → first-visit overlay or the lesson at `?beat=` → `raf(loop)`. The
overlay shows before the first 3D frame (9.6 s under swiftshader, 1-2 s on a laptop), over a
stage that is black until then: the first-visit text needs nothing from the board.

## 7 Work packages and milestones

### 7.1 M0 — the interfaces, fixed first (week 1, one person, then everyone reads it)

Written as `docs/rewrite/02-interfaces.md` plus stub files that build and load:

1. `Playback` events and methods (map §3.3 verbatim, plus `rerunTo(instrIndex)` for Back).
2. The facade members of §6.3 and the driver contract (who calls `frame/resize/traceDur/traceStep`).
3. The **Beat** and **Lesson** schemas of §3.1 as a JSON schema-like comment block; step keys.
4. The stage API: `stage.focus(beat) stage.step(story, i, info) stage.clear() stage.covers
   stage.peek(on) stage.mode ('board'|'die')`.
5. The player API for the shell and the tools: `__learn = { next back go auto again layer(name)
   lesson(id) beat playback stage }`.
6. A recorded fixture: `tools/lessoncheck.mjs --dump letter` writes the compiled beat list and the
   story steps of the letter lesson to `tests/fixtures/letter.8086.json`, so the caption card,
   the outline and the player can be built and tested without the board or the machine.

Exit: `node build.mjs --page learn` produces a page that loads, shows the first-visit overlay
over a black stage, and `tools/names.mjs` passes.

### 7.2 M1 — parallel packages (weeks 2-4), disjoint files

| WP | Files | Person | Depends on | Exit check |
|---|---|---|---|---|
| A Engine | `playback.js`, `facade.js`, `src/core/font8x8.js`, `build.mjs` page table, `pages.yml` | 1 | M0 | Node: `playback` boots every machine, runs `hello`, emits the event stream equal to app.js's (a lockstep tool against `dist/workbench.html` counts events per instruction); tests of map §6.4 still green |
| B Board | the four changes of §6.2 in board3d.js, `stage.js`, `tokens.css` split | 1 | M0 | `tools/learnsmoke.mjs` plays the letter fixture on the board: die dive present, stops ≤ 3, camera moves ≤ 1 per beat, first frame < 2 s on a laptop GPU |
| C Player | `player.js`, `caption.js`, `glossary.js`, `outline.js`, `chooser.js`, `learn.html`, `learn.css` | 1-2 | M0 fixture | plays the fixture with a stub stage (logs) and a stub playback; keyboard table of §2.9; layout stable at 1280×720 and 1440×900 (a screenshot diff of the card/controls rectangles across 36 beats is zero) |
| D Content | `lesson.js`, `content.js`, `lessons/8086.js` wave 1 (letter, hello, clock), `tools/lessoncheck.mjs` | 1 | M0 schema | `lessoncheck` passes: ids spelled right, captions within limits, asserts hold, screen text matches |
| E Explore | `explore.js`, `regsnap.js`, the 10 lines in app.js/index.html for the hand-off | 1 | A (events) | Explore steps `hello` on the 8086; the registers strip shows exactly the registers a `reg` event changed; Workbench opens with the program and returns |
| F Tools | `tools/launch.mjs`, `tools/learnsmoke.mjs`, `tools/names.mjs`; the `story.test.mjs:41` double-`reset()` fix | 1 (shared with A) | — | every tool launches as root; learnsmoke asserts state, not pixels (map §6.5) |

### 7.3 M2 — integration on the 8086 (week 5)

A + B + C + D on one page: the letter and hello lessons end to end on the real board; the
pacing table of §5 measured by `learnsmoke` (per-beat animation ≤ 4 s, read within 2.5-9 s,
one camera move); the no-GPU path by launching with `--disable-webgl`; the phone path at 390 px.
Exit: two people who have not seen the page play lesson 1 without asking a question about the
controls (the brief's twenty minutes).

### 7.4 M3 — the six machines, wave 1 (weeks 6-7)

The first lesson of each machine (the letter program), `compare.js`, the chooser with real
numbers; `lessoncheck` on all six; the P6 fold budget measured (JS ROB model, map §1.3).

### 7.5 M4 — wave 2 lessons and Explore polish (weeks 8-10)

15 lessons; "More programs"; the end screen's "same lesson on …"; the `a86:learn` progress and
resume; deploy as `_site/index.html` with the old page at `_site/workbench.html`.

### 7.6 M5 — wave 3 and the accuracy pass (weeks 11-12)

18 lessons; every caption's numbers checked against the emulator by `lessoncheck --strict`
(no hex value in a caption that the machine did not produce at that beat); the About page with
the accuracy caveats of README.md:127-134.

## 8 Risks and how each is retired early

1. **The board's ⟨xp⟩ surface does not fit the new layout** (covers, stops, die dives; map §7
   risks 3, 4). Retired in WP-B week 2: the four changes of §6.2 plus `learnsmoke` on the letter
   fixture; if `stops` proves hard inside `trJourney`, the fallback is `xpTime.work = 0.35`
   (board3d.js:6317) which shortens every dwell and keeps the 4 s cap.
2. **The no-GPU and phone stage has no cards** because the spec builders stay inside board3d.js
   (map §7 risk 2). Accepted for v1 (§9); retired as a risk by deciding it in M0 and by making
   `content.js` carry the `long` texts, so the die stage shows the unit's paragraph instead of a
   card. The lift to `specs.js` is a v1.1 package with `tools/unitsheet.mjs` as its check.
3. **Rewind-by-rerun is too slow on the P6 or in long lessons.** Measured in M1 by `lessoncheck
   --time` (unmeasured today): with `cpu.trace = null` the P6 core uses the C timing model when
   `P6OOO_WASM` is loaded (cpu80686.js:1464) and the JS path otherwise, so the letter lesson
   should rewind in tens of ms; the `cache`/`l2` lessons re-run their loops with `wasm: true`. If a lesson exceeds
   300 ms, its Plans get `snapshot: true` and Back uses the machine's state copy at that Plan (a
   `Machine.snapshot()` is ~60 lines, but not needed until measured).
4. **Auto that reads too fast or too slow.** The formula is a guess. Retired in M2 by the two
   naive readers: the page logs (locally) the time between a beat's start and the learner's Next
   for beats played by hand; if the median is > 1.4 × `read` for a lesson, the constant 48 goes up.
5. **The BIOS fold hides the thing the learner wanted to see** (`int 10h` in hello). Retired by
   the lesson 2 design: the fold beat says what the ROM did (138 instructions, the character to
   B8000h) and offers "step into it" (Explore at that instruction with `steps: 'full'`) as a link
   in the caption; `lessoncheck` verifies the fold reaches its `until`.
6. **Page size and first frame** (3.1-4.2 MB, 9.6 s to a first 3D frame under swiftshader, map
   §6.5). Retired in M1 by the first-visit overlay that needs nothing from the board, by `wasm:
   false` on all but two lessons, and by measuring on one real laptop without a GPU in M2; if the
   board's first frame is > 4 s there, `stage.js` starts in die mode and swaps to the board when
   its first frame is rendered.
7. **Name collisions and load order** blank the page (map §7 risk 9). Retired in M0 by
   `tools/names.mjs` in the build (fails the build on a duplicate) and the `Learn*` prefix.
8. **Content authoring is the long pole** (41 lessons, ~2,000 lines of captions). Retired by
   the waves: 8 lessons prove the model in M3; the schema makes a lesson data, so a second writer
   joins in M4 with `lessoncheck` as the reviewer of ids, lengths and numbers.
9. **Deterministic re-run breaks on keyboard lessons** (the `keys` lesson: the IRQ arrives when
   the learner typed). Retired by `boot.keys`: the player records the clock at which each key
   was delivered and replays keys at the same clocks on re-run (the machine clock is
   deterministic; `Machine.keyDown/keyUp` are the only inputs); `lessoncheck` re-runs `keys`
   twice and compares the event streams.

## 9 What is deliberately left out

- Two machines on one screen, a machine switch without reload, and parameterising story.js or
  board3d.js for the model (map §7 risk 1). The compare line and "same lesson on …" do the job.
- Lifting the spec builders and die plans out of board3d.js (`specs.js`, `dieplans.js`). The
  board stage does not need it; the die stage shows paragraphs instead of cards in v1.
- A speed slider, slow motion, manual clocking, the fast mode and the Runner on the learn page.
  Two Auto speeds and reduced motion are the whole speed model; the Workbench keeps the rest.
- Editing the program inside the lesson or Explore. "Change it" opens the Workbench with the
  program handed over; the lesson never overwrites `a86:src`.
- The timing view, the memory map, the dock cards, the disks panel and DOS boot on the learn
  page (Workbench only, as the brief's non-goals say).
- Lessons on the VGA samples, the Sound Blaster, `tune`, `movsb`, `bcd`, `quad`, DMA (gap 13)
  and disks (gap 28): they stay as programs in Explore's "More programs".
- A per-term glossary page or search; terms exist only where they appear.
- Accounts, sync, or progress beyond `localStorage`; sound design; the pop-out windows; a phone
  layout beyond "the die and the caption"; a tutorial about the controls (the controls are four).
- Multiple check questions, scores, or anything that blocks a door.
- Changing `theme.js` to `applyTheme(model)`: not needed while one machine is one page load.
