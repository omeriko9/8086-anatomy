# 02 — The design of the learner page

This is the specification the implementers build from. It starts from the winning proposal
(curriculum first), grafts the ideas the three judges marked MUST KEEP from the other three
(interaction, engineering, visual), avoids every MUST AVOID, and records each contradiction it had
to resolve in section 11. The brief is `docs/rewrite/00-brief.md`; the map is
`docs/rewrite/01-reuse-map.md`, cited as "map §n"; code is cited as `file:line` in the working
tree at commit `036454c`. Every number that a caption will show is a placeholder filled from the
emulator; every number in this document that describes the machine was measured in Node on
2026-09-28 with the recipe of tests/machine.test.mjs:43-53 (the BIOS assembled with `Asm86`, `reset`,
`loadProgram`, the five bytes at 0040:00F0, then `cpu.step()` until CS = 1000h) and is marked "measured".

Contents: 1 Concept · 2 Screens · 3 The lesson data model · 4 The curriculum for v1 · 5 The pacing
model · 6 The visual language of a beat · 7 Architecture · 8 Interfaces between work packages ·
9 Work packages · 10 Verification · 11 Decisions · 12 Left out of v1.

Facts measured for this document (the letter program of explain3d.js:11-18, with `ret` added):

| Machine | Bytes | Instr. traced | Clocks of the traced instructions | Time | Boot to the program |
|---|---|---|---|---|---|
| 8086 | 12 | 4 | 8 + 2 + 8 + 16 = 34 | 7.1 µs at 4.77 MHz | 39,666 instructions, 48-75 ms in Node |
| 80286 | 12 | 4 | 8 + 5 + 5 + 10 = 28 | 3.5 µs at 8 MHz | 43,341 instructions, 62 ms |
| 80386 | 12 | 4 | 8 + 5 + 5 + 11 = 29 | 1.16 µs at 25 MHz | 43,990 instructions, 95 ms |
| 80486 | 12 | 4 | 18 + 3 + 1 + 3 = 25 | 0.76 µs at 33 MHz | 54,525 instructions, 109 ms |
| Pentium (six lines) | 19 | 6 | 10 + 2 + 1 + 1 + 3 + 3 = 20 | 0.30 µs at 66 MHz | 64,885 instructions, 129 ms |
| Pentium Pro (six lines) | 19 | 6 | 31 + 2 + 1 + 1 + 1 + 1 = 37 | 0.19 µs at 200 MHz | 71,328 instructions, 194 ms |

Other measured facts used below: `mov es, ax` produces one story step (`Decode`, whose text ends
"ES gets B800h."), never an `Execute`; `dec cx` produces one step (`Decode`); a taken `jnz` produces
`Decode` + `Execute` ("The jump empties the queue…"), a fall-through `jnz` one step; under
`prefetch: 'parallel'` no `fetch` step is in `steps[]` (they ride in `host.bg`, story.js:392-403);
`hello`'s first `int 10h` runs 138 BIOS instructions and 1,537 clocks before `jmp next`; the BIOS
hand-off (bios.js:171-190) does not clear the screen, so the start-up banner is on the screen when
every lesson begins; the five-stars loop (section 4.1) jumps back four times and its `ret` + `int 20h`
are 27 instructions and 284 clocks in all.

---

## 1 Concept

**A course of six parts, one per machine, on one spine of seven questions.** The page teaches how
an x86 PC runs a program by playing real programs one instruction at a time on the real emulator,
on the 3D board and inside the dies that already exist. Every part follows the same order, so a
person who has done the 8086 part recognises the shape of the Pentium part and sees only the
answers change (curriculum §1): 1 What is a program, and what does the CPU do with its bytes?
2 Where do the bytes come from (the bus, the clock, the memory)? 3 Where do values live (registers,
the ALU, addresses)? 4 How does it decide (flags, jumps, loops)? 5 How does it remember where it
was (the stack, CALL and RET)? 6 How does the world get in (interrupts, ports, the keyboard, the
BIOS)? 7 What is new in this chip, and why? The 8086 course answers 1-6 in nine lessons; each later
course opens with the same letter program (question 1 again, on the new board), spends four to
five lessons on question 7, and closes with "What changed, in numbers".

**A lesson is a real program plus a script of beats, written as data.** A beat is one caption, one
focus on the board or a die, and at most one animation; the learner advances with Next. The
generic beats of an instruction are the story steps (`Story.build`, story.js:380-406); a lesson
chooses which steps become beats, which units get a stop, and overrides captions. Edge states are
beats, not errors (interaction §1): a BIOS call is one folded beat that says what the ROM did, a
loop shows its body once and folds the rest, a HLT waits for the learner's key, an unplanned timer
interrupt is a one-beat aside. Checks pause Auto and offer a "why"; Next and the doors always work.

**One picture, one sentence, one value.** The stage is at the left, the page at the right (visual
§1): the board or the die in a 1.3-aspect stage, and a 372-px column with the lesson's place, the
program with its current line lit, the caption card and the controls. Nothing floats over the
stage: no block card, no monitor box, no legend. A unit at work is its UnitFx drawing on the die
plus its tag; the card's sentence becomes the details layer of the caption. A bus cycle is two or
three stops, not seven: glue chips glow as the token passes and never stop it. Names live on the
board as stage labels ("8288 · bus controller"); the sentence says "the bus controller".

**Captions follow a writing model, not a length cap** (curriculum §3.4): a headline of one sentence
and at most 80 characters with at most two bold values, details of at most 220 characters on
request, a one-line meaning for each new term on the beat that first needs it (at most three new
terms per lesson), no acronym before its term, no hex without its plain number the first time, no
part number in a sentence unless that part is lit on the stage. `tools/learn-check.mjs` enforces
what can be enforced.

**Three rings around one stage** (brief principle 7): Lesson (default), Explore (the same stage
with every story step of every instruction of the lesson's program, Next and Back, the registers
that changed), and the Workbench, which is the present page built as `workbench.html` and entered
with the lesson's program through a one-shot hand-off record (interaction §2.5). One machine per
page load, as today (map §7 risk 1); the cross-machine story is told by each machine's closing
lesson and by one line of Node-measured numbers on every end screen.

**What the learner gets that the present page does not**: forty ideas in order instead of one
program on six boards; a beat of 2-4 s instead of 10-25; one place to look and one to read; every
value computed by the machine on the screen; and a straight path from any beat to Explore and to
the Workbench without losing the machine or the program.

---

## 2 Screens

### 2.1 Layout constants

One layout for Lesson and Explore; the Workbench is the present page. Sizes in px.

| Element | 1280 × 720 | 1440 × 900 | Rule |
|---|---|---|---|
| Top bar | 1280 × 44 | 1440 × 44 | title, machine, Outline, Explore, Workbench, ? |
| Stage host | 860 × 644 | 1020 × 824 | `left 16, top 60`; width = W − 420; height = H − 76; a positioned box (board3d.js:1509, 7755) |
| Column | 372 wide | 372 wide | `right 16`; blocks stacked with 12-px gaps |
| Column: place strip | 372 × 64 | 372 × 64 | lesson n of N · title · beat i of n · one dot per beat |
| Column: program | 372 × 200 | 372 × 380 | ≤ 8 lines at 720 (the slack of a taller window goes here, once per viewport, never per beat) |
| Column: caption card | 372 × 260 | 372 × 260 | kicker 18 · headline 3 × 28 · details 3 × 21 · term line 2 × 19 · padding; fixed |
| Column: controls | 372 × 56 | 372 × 56 | Back · Next (widest, default focus) · Auto · Again |

The stage aspect is 1.34 at 720 and 1.24 at 900; the 8086 die plan is 1.06 (board3d.js:734), the P6
1.15 (824). The board overview preset was tuned for a wide strip (visual risk 8.3): WP2 renders the
six boards at `overview` in this host in week one and, if the board sits small in empty sky, passes
`theta/phi/keepY` through `xpShotBox` (board3d.js:6722) for BOARD-scale looks; the column never
changes width per beat.

### 2.2 The first visit

```
+------------------------------------------------------------------------------+
| 8086 Anatomy · Learn                                        Workbench   ?    |
+------------------------------------------------------------------------------+
|                                                                              |
|          How does a PC run a program?                                        |
|          Watch one, byte by byte, on six real machines. Every value you       |
|          will see is computed by the machine itself.                         |
|                                                                              |
|          [ Start with the 8086 (1978) · a 4-minute lesson ]                   |
|                                                                              |
|          Or pick a machine:                                                  |
|          ( 8086 ) ( 80286 ) ( 80386 ) ( 80486 ) ( Pentium ) ( Pentium Pro )   |
|            1978     1982      1985      1989      1993         1995            |
|                                                                              |
|          Already know the basics?  Skip to "What is new in this chip"        |
+------------------------------------------------------------------------------+
```

Shown once (`learn:seen`), over a black stage while the board builds; nothing on it needs the board
(the first 3D frame is 1-2 s on a laptop GPU, ~10 s under swiftshader, map §6.5). Start opens
8086 lesson 1; a machine button reloads with `?cpu=` (map §0). Between Start and the board's first
frame the stage shows one line, "Building the board…", and beat 1 begins only when
`bd.renderer.info.render.frame > 0` (section 7.4). Returning visitors land on the lesson they left
(`learn:at = { cpu, lesson, beat }`), with the place strip reading "Continue: lesson 3, beat 12". All
learn keys go through theme.js `storage` (theme.js:332-335), so they are `a86:learn:seen`,
`a86:learn:at`, … in `localStorage`. If `learn:at.cpu` differs from `CPU_MODEL` (the person changed
machines on the other page, map §2.6), the shell does not continue silently: the place strip offers
"Continue on the 80286 ›", a reload link with `?cpu=`.

### 2.3 The lesson screen (1280 × 720)

```
+---------------------------------------------------------------------------------------+
| 8086 Anatomy · Learn   Intel 8086 · 4.77 MHz          Outline  Explore  Workbench  ?  | 44
+--------------------------------------------------------------+------------------------+
|                                                              | Lesson 1 of 9          | 64
|                                                              | A letter on the screen |
|                 THE STAGE (BoardView host, 860 x 644)        | beat 12 of 20  ●●●●●●●●●●●●○○○○○○○○ |
|          board dimmed; spotlight on the CPU and the latches  |------------------------|
|                                                              | PROGRAM                |
|        [8086 · CPU]                                          |   mov ax, 0B800h   B8 00 B8 |
|          ┌──────┐  ──(ADDR B8000h)──►  ┌──┐┌──┐┌──┐          |   mov es, ax       8E C0 | 200
|          │▒▒▒▒▒▒│                     │  ││  ││  │          |   mov al, 'A'      B0 41 |
|          └──────┘         [8282 · address latch]             | ▶ mov [es:0], al   26 A2 00 00 |
|                                                              |   ret              C3  |
|                                                              |------------------------|
|                                                              | 8086 · Bus control     | 18
|                                                              | The address B8000h goes | 84
|                                                              | out on the bus, to      |
|                                                              | every chip on the board.|
|                                                              | The latches next to the | 63
|                                                              | CPU hold it for the     |
|                                                              | whole cycle …           |
|                                                              | bus: shared wires every | 38
|                                                              | chip is connected to …  |
|                                                              |------------------------|
|                                                              | ‹ Back  [  Next ›  ]  ▷ Auto  ↻ | 56
+--------------------------------------------------------------+------------------------+
```

(The kicker names the beat's stop, `8086/BUS CONTROL`, in the case `xpUnitText` prints it,
board3d.js:6500-6512: "8086 · Bus control".)

Rules the wireframe encodes:

- The stage is `BoardView` in a positioned host with its chrome hidden by one CSS rule
  (`.bv-top, .bv-pop, .bv-focus, .bv-hint { display: none }`, map §2.7.1) and the block card hidden
  in the Lesson ring (`.ln-lesson .bv-card { display: none }`) with covers passed as data so the
  hidden card reserves no space (section 7.8). The spotlight (`xpSet({ shots: true, spot: true })`,
  board3d.js:6663) and one focus per beat (`xpFocus`, 6696). Stage labels: at most three, from
  `INFO[id]` name and kind (board3d.js:210-296), placed by projecting the part's box. `INFO` is keyed
  by part kind (`lat`, `xcv`, `dec`, …), not per instance, and has no `cga` key, so the Stage resolves
  a look id as `INFO[id] || INFO[id.replace(/\d+$/, '')]` (`lat0` → `lat`) and maps `'cga'` to the
  video card's own `INFO` entry (`vga` on the VGA boards; the CGA card's entry on the others); an id
  that resolves to nothing gets no label (never a raw id on the stage).
- The place strip is the only progress indicator; the dots are buttons (jump to a beat, as the
  milestones of explain3d.js:719-733). Their number is known before the first beat: `load()` compiles
  the whole lesson in a dry pass (section 7.5), so n and the dots never change while playing.
- The program block shows the lesson's source with each line's bytes (from `lineMap`,
  assembler.js:1344-1404) and the current line lit (`lineOf(phys)`, app.js:1502-1505). It never
  resizes per beat; lines beyond eight scroll under the current one. It is a map, not a control.
- The caption card: kicker (`chip · UNIT` from `xpUnitText`, board3d.js:6500, or the beat's own),
  headline (21 px, values bold and coloured like their wire, `BUS_COLOR` theme.js:191-195), details
  (15 px, muted; opened by click or Enter on the card — Auto never opens them by itself, so the
  details layer stays "on request" and an Auto beat stays 2-4 s; the outline setting "Auto reads the
  details too", `learn:autoDetails`, is the one exception and adds `readD` to every beat that has
  details), the term line (the one-line meaning of the beat's new terms, once per visit). Fixed
  height: a two-word headline and a three-line headline occupy the same pixels.
- Controls: Back, Next, Auto (a toggle with a running ring), Again (replay the beat's animation;
  disabled on beats without one). Nothing else.
- No monitor box: a `screen` beat cuts the camera to `screenTL` (`xpBox`, board3d.js:6681-6688) and
  the 3D monitor mesh shows the CRT (`crtCanvas` on the facade, read only while a screen beat or the
  end card is on, map §2.7.7).

The same screen at 1440 × 900: the stage grows to 1020 × 824, the program block to 380 px (up to
16 lines); the place strip, the caption card and the controls keep their heights, so a beat looks
the same in both windows.

```
+-----------------------------------------------------------------------------------------------------+
| 8086 Anatomy · Learn   Intel 8086 · 4.77 MHz                       Outline  Explore  Workbench  ?  | 44
+----------------------------------------------------------------------------+------------------------+
|                                                                            | Lesson 1 of 9          | 64
|                                                                            | A letter on the screen |
|                                                                            | beat 12 of 20  ●●●●●●●●●●●●○○○○○○○○ |
|                   THE STAGE (BoardView host, 1020 x 824)                   |------------------------|
|                                                                            | PROGRAM                |
|                                                                            |   mov ax, 0B800h   B8 00 B8 |
|                                                                            |   mov es, ax       8E C0 | 380
|            [8086 · CPU]                                                    |   mov al, 'A'      B0 41 |
|              ┌──────┐  ──(ADDR B8000h)──►  ┌──┐┌──┐┌──┐                    | ▶ mov [es:0], al   26 A2 00 00 |
|              │▒▒▒▒▒▒│                     │  ││  ││  │                    |   ret              C3  |
|              └──────┘         [8282 · address latch]                       |   (blank lines: the slack) |
|                                                                            |------------------------|
|                                                                            | 8086 · Bus control     | 18
|                                                                            | The address B8000h goes | 84
|                                                                            | out on the bus, to      |
|                                                                            | every chip on the board.|
|                                                                            | The latches next to the | 63
|                                                                            | CPU hold it …           |
|                                                                            | bus: shared wires …     | 38
|                                                                            |------------------------|
|                                                                            | ‹ Back  [  Next ›  ]  ▷ Auto  ↻ | 56
+----------------------------------------------------------------------------+------------------------+
```

### 2.4 The outline (a drawer over the stage; Esc or Outline closes)

```
+------------------------------------------------------------------------------+
| ☰ Intel 8086 + 8087 · 4.77 MHz · 1 MB · real mode · 1978     Change machine › |
|                                                                              |
|  The 8086 course · 9 lessons · about 40 minutes                               |
|  1 ✓ A letter on the screen                    4 min   program, register, bus |
|  2 ✓ Where the bytes come from                 5 min   clock, latch           |
|  3 ● Registers and the ALU          ← you are here, beat 6 of 21              |
|  4   Memory and addresses: segments            5 min   segment, offset        |
|  5   Deciding: flags and jumps                 4 min   flag, queue            |
|  6   Remembering: the stack                    5 min   stack, return address  |
|  7   Interrupts: the timer ticks               6 min   interrupt, vector      |
|  8   Talking to devices: a key through a port  5 min   port, scan code        |
|  9   The BIOS, and what changed since 1978     5 min                          |
|                                                                              |
|  Go further with this machine (Explore): Hello, 8086 · Fibonacci · Bubble sort · 8087: pi |
|  Settings: Auto speed normal / slower · Auto reads the details too · Motion: as the system says |
|  Explore this program ›     Open the Workbench ›     About and accuracy ›      |
+------------------------------------------------------------------------------+
```

Each row: number, ✓ from `learn:done:<model>`, title, minutes, the lesson's `terms` ("you will
meet: …", curriculum §3.4 rule 3). "Go further" lists the model's `SAMPLES` (filter rule
app.js:252-253) and opens them in Explore. Opening the drawer pauses Auto.

### 2.5 The machine chooser (an overlay; from the first visit or "Change machine")

```
+------------------------------------------------------------------------------+
|                          Six machines, one program                           |
| +---------+ +---------+ +---------+ +---------+ +---------+ +---------+      |
| | 8086    | | 80286   | | 80386   | | 80486   | | Pentium | | P. Pro  |      |
| | 1978    | | 1982    | | 1985    | | 1989    | | 1993    | | 1995    |      |
| | 4.77MHz | | 8 MHz   | | 25 MHz  | | 33 MHz  | | 66 MHz  | | 200 MHz |      |
| | [png]   | | [png]   | | [png]   | | [png]   | | [png]   | | [png]   |      |
| | 9 lessons 6 lessons  6 lessons  6 lessons  6 lessons  7 lessons  |         |
| +---------+ +---------+ +---------+ +---------+ +---------+ +---------+      |
|   The letter program on each: 34 clocks · 28 · 29 · 25 · 20 (6 instr.) · 37   |
+------------------------------------------------------------------------------+
```

A card is `<a href="learn.html?cpu=80286">` (the reload of map §0; `URL_PARAMS` writes `a86:cpu`,
theme.js:154-155). The board pictures are not six WebGL contexts and not six files (the page is one
HTML file that must work from `file:`, brief constraints): `tools/boardshots.mjs` (WP0) renders each
board once at `overview` and writes `src/learn/lessons/boards.js`, one `const LEARN_BOARDS = { '8086':
'data:image/webp;base64,…', … }` with six WebP data URIs at 320 × 200, each ≤ 30 KB (≤ 180 KB in all,
counted in the size budget of 7.1). The bottom line comes from `lessons/compare.js`, generated in
Node by the checker (section 7.7); the values above are the measured ones of the facts table.

### 2.6 The end of a lesson (the caption card and the stage; the layout does not change)

```
| stage: the screen's top-left corner, the letter A on the start-up text       |
|------------------------------------------------------------------------------|
| Four instructions, 34 clocks: 7.1 µs at 4.77 MHz. The CPU had to fetch each   |
| code byte over the bus before it could use it, and one byte to the video     |
| memory made a letter. That is all a program does: move bytes and calculate.  |
|                                                                              |
| Quick check: what did the CPU send to the video card?                        |
|   (•) The byte 41h   ( ) The letter A as a picture   ( ) The word "mov"      |
|   Right. The CPU only moves bytes; the card turns 41h into the picture.       |
|------------------------------------------------------------------------------|
| [ Next lesson: Where the bytes come from › ]   Explore this program   Change it (Workbench) |
|   Same lesson on the 80286 (28 clocks) · the Pentium (20 clocks, 6 instructions) |
```

The end card needs more than the 260-px caption card, and the layout must not change per beat
(principle 4), so it replaces two blocks at once and keeps their outer rectangle: the program block,
its 12-px gap and the caption card become one box of 200 + 12 + 260 = 472 px at 720 (380 + 12 + 260
= 652 px at 900); the place strip above and the controls row below do not move (the controls read
"‹ Back · Next lesson › · Again"). Its rows, top to bottom: summary (three lines, 21 px, 84 px),
check question (one line, 28 px), three answers (three 21-px rows, 63 px), the why (two lines,
38 px), the three doors (one row, 40 px), the compare line (one line, 21 px); the rest is padding and
the slack of a taller window. The summary is the kept narrative (explain3d.js:274) with the lesson's
real numbers. One check, three answers, one line of "why"; a wrong answer shows the why and may
retry; the check never blocks the doors (interaction §2.7). The last line is `lessons/compare.js` for
this lesson id on the other machines that have it. A `check` beat in the middle of a lesson does not
use this card: it fits the caption card's fixed boxes (section 6.4).

### 2.7 Explore (the same stage; the column changes)

```
+--------------------------------------------------------------+------------------------+
| Explore · A letter on the screen · 8086               ‹ Lesson |                        |
+--------------------------------------------------------------+ instr 4  mov [es:0], al |
|                                                              | step 4 of 5 · T2 · Command |
|          the board: the step's flow, token, unit drawing,    | ○ Decode  ○ Address calc. |
|          the block card back (Explore keeps it), no spotlight| ○ T1 · Address ● T2 ○ T3 |
|                                                              |------------------------|
|                                                              | The 8288 reads S2–S0 = |
|                                                              | 110 (memory write) and |
|                                                              | sends MWTC to the CGA  |
|                                                              | video RAM. The card in |
|                                                              | the slot decodes …     |
|                                                              |------------------------|
|                                                              | ES 1000→B800  IP 0107→010B |
|                                                              |------------------------|
|                                                              | ‹ Step  [ Step › ] Instr ›› Run to line |
+--------------------------------------------------------------+------------------------+
```

Explore is the same `Playback` and the same `LearnStage` in their other state (`stage.ring('explore')`,
section 7.4): every story step in `Story.build`'s own words (`splitLead`, theme.js:349-354) through
`traceNext/tracePrev/traceGo/traceSkip` (map §3.3), the board's normal trace camera (`trTrack`,
board3d.js:6958) instead of shots and spotlight, the block card back (the covers measure the visible
card again, so the trace camera and the token never sit under it, `trCover` 7224), every unit stop
(no `limitStops`), and the registers that changed in the last instruction (`RegsWidget`, the dock's
`DOCK_REGS*` + `read/fmt/renderFlags/hot` lift, map §1.4). Its pace is the one Explain used:
`play.setSpeedPos(20)` = stop 2, `stepMs` 1700 (app.js `TRACE_MS`, map §3.6); the engine's own loop
folding (`traceRep: 'once'`) is on in this ring and off in Lesson (section 7.3). Play (key A) is the
story's own auto-advance (`play.auto`, map §3.4), never `start()`: `running` stays false and there is
no chase camera. "Run to line" is `startFF('skip', until)` (app.js:546-556) to a clicked program line.
No speed slider, no dock, no memory or timing view: those are the Workbench.

Where Explore starts and how "‹ Lesson" returns: Explore opens at the lesson's current instruction
with the machine as it is (the beat's instruction has been traced or folded; Explore continues from
`physIP`). "‹ Lesson" calls `player.rerunTo(k)` for the current beat's instruction (section 7.5 rule 3:
`boot()` + `runTo({ instr: k })`, deterministic) and replays the beat, so Explore may advance the
machine freely. "Go further" loads a `SAMPLES` program on the same `Playback` (`assemble/load/boot`);
"‹ Lesson" then reloads the lesson's program (`player.load(lesson)`, then `go(beat)`), which is the
same re-run with one more assemble. The WP8 exit criterion "returns to the lesson at the same beat"
is checked on both paths.

### 2.8 The Workbench

The present page, built as `workbench.html` from the same page table (section 7.1). The learner
reaches it from the top bar, the outline, the end screen's third door, or Explore. The hand-off is
one record `a86:handoff = { src, name, cpu, from: 'learn', lesson, beat }` written by the learn page
and read and deleted by `loadInitialProgram` (app.js:1072-1080; +6 lines): the old page loads the
handed program into the editor and shows "Program from lesson 2 — your own program is in the
Samples menu as 'Your program'"; `a86:src` is never overwritten (map §2.6 rule). The old top bar
gains one chip "‹ Lesson" when `from === 'learn'` (+4 lines, index.html +3), pointing at
`learn.html?cpu=…&lesson=…&beat=…`; browser Back works too because both are one tab.

### 2.9 The phone and the no-GPU laptop

Below 900 px wide, or when `BoardView.ok === false` (board3d.js:2112-2117), the stage hosts a
`DieView` of the CPU (`new DieView(host, api)` picks the subclass, die.js:168-190) at the full width
with height 0.75 × width; the column goes below it (place strip one line, program one line, the
caption card and controls unchanged).

```
+---------------------------+
| (die floor plan, SVG)     |
|  ALU │REGS│ADDR ADDER ▒▒▒ |
|  FLG │    │ B8000h  │BUS  |
|  DECODER   │MICROCODE ROM |
+---------------------------+
| 8086 · ADDRESS ADDER       |
| The CPU adds ES x 16 and 0:|
| the address is B8000h.     |
| ‹ Back   [ Next › ]   Auto |
+---------------------------+
```

What a beat does in die mode (the Stage's `mode === 'die'`, section 7.4), beat kind by beat kind:
`look` of board parts shows the chip's `INFO` paragraph (board3d.js:210-296, exported as
`BoardKit.INFO`) as the details, with the die dimmed and nothing selected; `look: 'die:cpu'` is the
die overview (`DieView.select(null)`, zoom 1); a `step` beat has `anim = min(ms, 1700)` (`durOf`
returns that, not `ms` unchanged): at the beat's start the Stage calls `dieUnit(stop)` for the first
named stop (`DieView.select(id, g, true)`, die.js:1030, with `g = els.blocks[id]`, 631, through the
`die` column of `content.js`) and the step's events reach `die.event(e)` (die.js:295), which lights
the other units for their own fade time; `Die686View.traceStep` (die.js:7759) is used when present;
`screen` shows the `CrtScreen` host in the stage for the beat; `run`, `wait`, `check` and `say` are
the same as on the board. No 2D board renderer in v1 (visual `boardmap.js` is out; brief principle 8
accepts "the die and the caption").

The no-GPU laptop is not the phone: it must work, not merely degrade. A laptop whose WebGL is
software-rendered gets `BoardView.ok === true` and a slow board, so `ok` alone is not the switch. The
Stage keeps a frame-time watchdog: when the median of `frame()` durations over the last 3 s exceeds
80 ms (the measured swiftshader budget is 14-26 ms per frame, map §6.5, which is the floor this
number must stay above), the caption card offers one line, "Slow display? Use the simple view", which
switches to die mode for the visit (`learn:view = 'die'`); the same switch is offered on
`webglcontextlost` (section 7.4). `tools/learn-shots.mjs --nowebgl` and a throttled run
(`--throttle 4`, Chrome's CPU throttling through the DevTools protocol) check both paths.

### 2.10 Keyboard, focus, announcements (interaction §2.9)

| Key | Lesson | Explore |
|---|---|---|
| Enter, Space, → | Next beat (completes a running animation instantly, then the next beat) | Next step |
| ← | Back | Previous step |
| A | Auto on/off | Play on/off |
| O, Esc | Outline open / close (Esc also leaves Explore) | same |
| R | Again (replay the beat's animation) | Replay the step |
| N | — | Next instruction |
| ? | Glossary panel for the current caption's terms (opens in the column in the program block's place, same width and height, never over the stage; Esc or ? closes it) | same |
| Tab | Back → Next → Auto → Again → terms in the caption → program → stage → Outline | + registers strip |

The stage canvas takes focus only by Tab; then the board's camera keys apply (board3d.js:4340).
Typing reaches the CRT only in `wait: 'key'` beats (`CrtScreen.key(e, down)`, crt.js:185-216). The
caption card is `role="region" aria-live="polite"`: the headline is announced on every beat, the
details on request. `prefers-reduced-motion` and the Motion setting call `setReducedMotion(true)`
on every view (map §1.4 contract): camera moves become instant, the token appears at its stops,
Auto is off by default. A second Next within 250 ms is ignored (double-click guard).

---

## 3 The lesson data model

### 3.1 Files and names

One file per machine under `src/learn/lessons/`: `l8086.js`, `l80286.js`, `l80386.js`, `l80486.js`,
`l80586.js`, `l80686.js`, each declaring one top-level `const LESSONS_8086 = [ … ]` etc. (unique
names: the one-scope build forbids duplicates, map §6.1). `programs-8086.js` declares
`LEARN_PROGRAMS_8086` and `programs-later.js` `LEARN_PROGRAMS_LATER` (the letter program in its 8086
and P5/P6 forms, the purpose-built programs of section 4; two files so the 8086 writer and the later
machines' writers never share one); `terms.js` declares `LEARN_TERMS`; `index.js` (written in WP0,
never edited by a writer) declares `LEARN_LESSONS = { '8086': LESSONS_8086, … }`, merges the two
program tables into `LEARN_PROGRAMS` and defines `learnLessonOf(model, id)`; `compare.js` and
`boards.js` are generated (sections 7.7, 2.5). All files LF. A lesson is one object literal; no
lesson contains code other than template strings.

### 3.2 The schema

```js
// A lesson. Every field a writer needs is here; the player needs no code per lesson.
const LESSON_SCHEMA = {
  id: '8086-05-jumps',                 // /^\d{4,5}-\d\d-[a-z0-9]+$/, unique; in the URL and in learn:done
  machine: '8086',                     // '8086' | '80286' | '80386' | '80486' | '80586' | '80686'
  n: 5,                                // position in the course (1-based)
  title: 'Deciding: flags and jumps',  // ≤ 40 characters
  idea: 'One sentence a learner can say afterwards.',   // ≤ 160 characters
  minutes: 4,                          // the outline's estimate; the checker compares it with the pace model (±40 %)
  gaps: [8, 9],                        // map §5.6 items this lesson closes (documentation only)
  terms: ['flag', 'queue'],            // the words this lesson defines; ≤ 3 (≤ 6 for 8086 lesson 1); each exists in LEARN_TERMS
  program: { program: 'stars' } | { sample: 'hello' },   // a key of LEARN_PROGRAMS (interface 7), or a SAMPLES id (bios.js:2680+);
                                       // LearnPlan.validate fails a key that exists in neither
  options: { fdivBug: false, wasm: false, soundCard: false },        // Machine constructor options; these defaults unless set
  story: { prefetch: 'parallel', burst: 'fold' },   // Story.build options (map §2.7.3); the bus lesson says prefetch: 'full'
  from: { instr: 0 },                  // where the beats start after the BIOS hand-off: { instr: n } (n-th instruction of the
                                       // program, 0 = the first) | { label: 'measure' } | { text: 'fdiv' } (the next instruction
                                       // whose disassembly starts so) | { bios: 'int09' } (a BIOS symbol) | { ip: 0x0113 }
                                       // The machine runs fast to it (Playback.runTo, sliced per frame), the views see its fast glow;
                                       // the checker prints its instructions and clocks and fails above 4 M clocks or 2 s in Node.
  units: ['8086/FLAGS', '8086/QUEUE'], // every 'PART/LABEL' the beats may stop at, in DIE_PLANS spelling after the BLK_* remap
                                       // (validated against content.js, and against the visit labels the lesson's steps really produce, 7.7)
  beats: [ /* Beat, see below */ ],
  end: {
    check: { ask: '…', options: ['…', '…', '…'], answer: 0, why: '…' } | { ask, from: 'reg:AL', format: 'hex8+dec', wrong: ['…', '…'], why },
    further: ['fib', 'sort'],          // SAMPLES ids for "Go further" (Explore)
    tryIt: "Change the letter A to B and run it in the Workbench.",   // one sentence, ≤ 90 characters
    next: '8086-06-stack',             // default: the next n of this machine
  },
};

// Beats. Exactly one of look / say / step / run / wait / screen / check decides the kind (the checker
// rejects two). Every beat may carry cap, terms, focus, labels, hold, quick.
const BEAT_KINDS = [
  // look: fly to parts and spotlight them; no machine action.
  { look: ['cpu', 'clk'] | 'die:cpu' | [],           // xpBox ids (board3d.js:6676-6694): glow ids, 'monitor', 'cga', 'drives',
                                                    // 'screenTL', 'die:<decapKey>'; [] = the overview preset with nothing lit
    cam: { theta: 0.22, phi: 0.85, keepY: false },  // optional; xpFocus defaults (board3d.js:6696, 6722)
    labels: ['cpu', 'clk'],                          // stage labels (≤ 3); default: the look ids up to 3
    cap: { h: '≤ 80 chars, one sentence, ≤ 2 <b>values</b>', d: '≤ 220 chars, ≤ 2 sentences' },
    terms: ['program'], hold: false },
  // say: a sentence with the camera where it is (focus optional, fly: false by default).
  { say: true, focus: ['cpu'], cap: { h: '…', d: '…' }, terms: [] },
  // step: run ONE instruction (or count of them) and play the story steps that match `show`, in STORY-STEP order
  // (whatever the order of the `show` entries; the checker warns when the two orders differ).
  { step: 1 | { count: 2 },
    show: [                                          // which story steps become beats, and their captions
      { at: 'inside:Decode', nth: 1,                 // selector (3.3); nth = which instruction of a count > 1 (default: all)
        stop: '8086/DECODER' | ['8086/DECODER'],     // units that get a stop (≤ 2 named + the step's source and target)
        cap: { h: '…', d: '…' } | 'story' | 'unit',  // 'story': Story's text split by splitLead; 'unit': xpUnitText's sentence
        quick: false,                                // true: the board's quick plan (one shot, quarter work, no passes)
        terms: ['flag'] },
      { at: 'bus:memw:vram', cap: { h: 'The byte <b>{data}</b> travels to the card…' } },   // no phase: the three phases
                                                     // of the cycle chained under one caption (one beat)
    ],
    hide: ['bus:fetch:*'],                           // steps dispatched silently (events still reach the views); an unmatched
                                                     // `hide` is a checker WARNING (hiding nothing is harmless), an unmatched `at` a failure
    rest: 'fold' | 'hide' | 'show',                  // unmatched steps: one folded beat with cap 'story' (default) | silent | one beat each
    cap: { h: '…' },                                 // the caption of the folded rest (default: Story's sum of the last step)
    plain: [60, 1978],                               // plain numbers the captions of this beat may use freely (rule 3.5.5)
    repeat: { times: 4, then: 'skip' | 'show' } },   // after this instruction, run the next `times` executions of the same text silently;
                                                     // then: 'skip' = further executions of the same text stay folded until the loop
                                                     // exits (the fall-through is traced); 'show' = the next execution is traced again
  // run: fast-forward with one caption (loops, BIOS calls, handlers, the end of the program).
  { run: { until: 'ret' | 'iret' | 'program' | 'halt' | 'wake' | 'irq' | { label: 'done' } | { bios: 'int16.wait' } | { instrs: 12 } | { ip: 0x0120 } },
    cap: { h: '…', d: '…' }, into: true },           // into: offer "step into it" (Explore at the fold's first instruction)
  // wait: the CPU is halted in the ROM's keyboard wait; the beat ends when a key arrives (or Auto types `keys` after 8 s).
  { wait: 'key', keys: ['k'], cap: { h: 'Press any key: the keyboard raises IRQ1.' } },
  // screen: cut to the monitor and reveal the bytes the hide-and-reveal held back.
  { screen: true, cap: { h: '…', d: '…' } },
  // check: a question in the caption card (question in the headline box, the three answers as the three
  // 21-px rows of the details box, the why in the term line, 6.4); pauses Auto; never blocks Next.
  { check: { ask: '…', options: ['…', '…', '…'], answer: 0, why: '…', measured: true } },   // measured: the answer is a machine
                                                     // fact (a count, a digit, clocks) the writer measured in Node; the checker recomputes it
  { check: { ask: 'What is in AL now?', from: 'reg:AL' | 'mem:B800:0' | 'flag:ZF', format: 'hex8+dec' | 'hex16' | 'dec' | 'bit',
             wrong: ['2Ch (300)', '00h (0)'], why: '…' } },
];
```

Semantics the player guarantees: a `step` beat calls `Playback.beginInstr(now, { enter: false })`
for one instruction (section 7.3: the engine never folds a seen instruction on its own in the Lesson
ring, and does not enter step 0 by itself), builds its story with the lesson's `story` options,
resolves `show`/`hide`/`rest` against `story.steps`, and produces one compiled beat per `show` entry
(chained phases count as one), plus the folded rest, all played in story-step order; `repeat` runs
further executions of the same instruction text through `startFF('loop', …)` with no beats (the
views still receive events, map §3.3 fan-out). A `run` beat is `startFF(why, until)` with the fast
glow (`fast(stats)`, board3d.js:3925) in slices of ≤ 12 ms or `sliceInstrs` raw steps per frame
(section 7.3); if the target is not reached within `foldWallMs` the caption says how far it got and
offers "keep running". `until: 'ret'` = the return address of the CALL/INT this lesson last traced
(the player records `play.nextPhys` from the `instrEnd` event, because `startFF` calls `finishInstr`
first and `play` is null by the time the fold starts, app.js:548, 1391; `nextPhys` as `traceSkip`
computes it, 527-545); `'iret'` = the next IRET instruction executed (decode text `iret`, whichever
handler it belongs to); `'program'` = back in the program segment (`cpu.sregs[1] === PROG_SEG`);
`'halt'` = the CPU halted (the predicate receives the machine); `'wake'` = `skipHalt()`
(app.js:1316-1326); `'irq'` = the next hardware interrupt step; `{ bios }` = `0xF0000 +
machine.biosSym[name]` (filled only when `setRom(rom, symbols)` received the symbols, machine.js:369-371;
`buildRom` passes them, 7.3). A `wait: 'key'` beat is a fast run, not a traced one: INT 16h's `.wait`
loop is `cli / cmp head,tail / sti / hlt / jmp .wait` (bios.js:1289-1295) and every IRQ0 wakes it
(measured: `cpu.halted` cleared 18 times in one emulated second, 2.4 M `machine.step()` calls), so the
player runs the raw `cpu.step() + tickDevices` loop of `skipHalt` (app.js:1316-1326), ≤ 12 ms per
frame, until `physIP === 0xF0000 + biosSym.int09` (IRQ1 entered: the key is in) or the BDA keyboard
head differs from its tail (`KB_HEAD/KB_TAIL`, bios.js:18-19); timer wakes are silent. Unplanned
events (interaction §3.2 rule 8): a hardware interrupt step (`INTR xxh`, its own `cpu.step()`, map
§3.5) inside a `step` beat that names no `irq` selector becomes an aside beat "The timer interrupted
(18.2 times a second). Its handler runs and returns; we skip it." with a fold to the interrupted
address (`startFF('skip', ip => ip === interrupted)`, section 7.5 rule 4), and the beat's own steps
continue; a REP iteration beyond the first (`cpu.repState`) folds into "CX more times" unless the
beat lists it.

### 3.3 Selectors

`at`, `hide` and the checker name story steps by their real fields (story.js:78-135 bus steps,
136-220 inside steps, 237-359 device steps): `kind[:sub[:tail[:tail]]]`, `*` anywhere, a missing
tail matches all. The step kinds are exactly the nine `kind:` literals of story.js (81, 219, 237,
243, 252, 263, 269, 278, 288, 298, 308, 325, 359): `bus inside fdc dma sound btb cache page irq`. There
is **no** `uop`, `rat`, `rob` or `pipe` step: those events are `case`s inside `insideStep`
(story.js:187-206) that append sentences to the one `inside` step that hosts them, and on the 80486
the `pipe` event adds no text at all (188-189). They are reached through the inside step's event tail.

| kind (`s.kind`) | sub | tails | Examples |
|---|---|---|---|
| `inside` | `s.title`: `Decode`, `Address calculation`, `Execute`, `Inside the CPU` (the default when no event names the step, story.js:138: the P6's µop lines land here), `Interrupt`, `Descriptor`, `Protection`, `Task switch`, or the FPU's name (`Story.N.fpu`, 180) | one: an event kind `evk` present in `s.evs` (`e.k`): `decode ea alu reg flags int fpu desc sys task pipe btb rat uop rob queue` | `inside:Decode`, `inside:Address calculation`, `inside:*:rat`, `inside:Inside the CPU:uop`, `inside:Execute:rob`, `inside:Decode:pipe`, `inside:Decode:btb` (a right prediction: its line is in the Decode step, 193) |
| `bus` | `s.I.kind`: `fetch memr memw ior iow inta halt` | `s.I.dev`: `ram rom vram pic pit ppi dma crtc cga kbc rtc xram fpu fdc hdc sb opl none`; then `s.phase`: `addr cmd data all` — matched on `s.phase`, never on the title (the titles carry the model's prefix: `T1 · Address` on the 8086, `Ts · Address` on the 286+, story.js:103) | `bus:memw:vram:data`, `bus:ior:ppi`, `bus:fetch:*` |
| `cache` | `sub = e.level === 'L2' ? 'l2' : (e.cache \|\| 'unified')` — the 486 event has no `cache` field (cpu80486.js:171: `{ k, phys, set, way, hit, fill, write }`), so `select` maps it to `unified`; a P6 L2 step has both `level: 'L2'` and `cache: 'code'\|'data'` (cpu80686.js:654) and is `l2`, never `code`/`data` | one, from the title: `fill` (`Cache miss: line fill`, `Code/Data cache miss: line fill`), `write` (`Cache: write through`, `Data cache: write miss`), `miss` (`Cache miss`, `L1 code/data miss`, `L2 miss: front-side bus`), `hit` (`L2 hit (back-side bus)`) | `cache:unified:fill`, `cache:data:write`, `cache:l2:hit`, `cache:data:miss`, `cache` |
| `page` | `walk fault` (the title) | — | `page:walk` |
| `btb` | — (a `btb` step exists **only for a wrong prediction**: story.js:375 `e.k === 'btb' && !e.right`, title `Branch: wrong prediction`; a right prediction is `inside:Decode:btb`) | — | `btb` |
| `irq` `fdc` `dma` `sound` | the title's first word, lower case | — | `irq`, `sound:fm` |

`LearnPlan.select(step)` returns every selector a step matches (it derives `sub` and the tails as
above), and the checker's `--json` dump lists them per step together with the kinds in `s.evs`, so a
writer copies exact strings. In every list `i` is the array position in `story.steps`; `s.i` is
informational and may differ under `prefetch: 'parallel'` (measured: `s.i` = 0, 3, 4, 5, 6 while the
array runs 0-4), and `traceStep(story, i)`/`enterStep(i)` use the array position (board3d.js:7037,
app.js:642). An `at` selector that matches nothing is a **failure** of `tools/learn-check.mjs` (not
a warning): the story owns the titles, and a rename in story.js must break the check, not empty a
beat (curriculum risk B, engineer judge); an unmatched `hide` is a warning. The checker also asserts
the set of titles it saw against a frozen list in `tools/learn-check.mjs`, seeded once from a `--json`
run over all six models and the 40 lessons: `Decode`, `Address calculation`, `Execute`, `Inside the
CPU`, `Interrupt`, `Descriptor`, `Protection`, `Task switch`, the FPU names, `Halt`, `Prefetch`,
`T1 · Address`, `Ts · Address`, `T2 · Command`, `Tc · Command`, `T3 · Data`, `Tc · Data`, `N more
transfers` (N a number), `Cache miss`, `Cache miss: line fill`, `Cache: write through`, `Code cache
miss: line fill`, `Data cache miss: line fill`, `Data cache: write miss`, `L1 code miss`, `L1 data
miss`, `L2 hit (back-side bus)`, `L2 miss: front-side bus`, `Branch: wrong prediction`, `Page walk`,
`Page fault`, `Interrupt request`, `DMA transfer`, the FDC and sound titles.

### 3.4 Captions and templates

`cap` is `{ h, d?, k? }` (headline, details, kicker) or `'story'` (headline = `Story`'s `sum` when
present, else the first sentence by `splitLead`; details = the rest) or `'unit'` (headline = the unit
card's `sub`, `xpUnitText`, board3d.js:6500). Templates in `{…}` resolve on the machine **at the time
of the step** (`dispatchUntil(s.t)`, map §3.3), never at lesson load:

`{reg:AX}` `{reg:EAX}` `{reg:AL}` (hex with `h`, the register's width) · `{flag:ZF}` (0/1) ·
`{mem:B800:0}` `{mem:B800:0:w}` (a byte or word) · `{ip}` · `{addr}` `{data}` `{token}` (the step's
`I.addr`, `I.data`, `token.val`) · `{cycles}` (this instruction's clocks) · `{clocks}` (the sum over
the lesson's traced instructions so far) · `{us}` (that sum as ns/µs at `clockHz`) · `{mhz}` · `{n}`
(instructions traced) · `{bytes}` (the program's bytes) · `{origin}` (its first address, 5 digits) ·
`{screen:0}` (the character code now in cell 0) · `{dev}` (`Story.devName`) · `{part:lat}` (the
model's name for latches, transceivers, bus controller, decoder: `Story.N`, story.js:14-24) ·
`{cmp:8086:clocks}` (a number of `lessons/compare.js`). Hex is written `xxh`, never `0x`; the card
bolds nothing by itself: the writer marks values with `<b>`. A `'story'` caption passes through the
rewrite filters of `LearnPlan.caption` (section 7.5): among them, an 8-bit register write prints
that register (`AL gets 41h`), because the 8086 core emits `reg{AX}` for an AL write and the story
says "AX gets 00C8h" (measured on the `alu` program), which would mislead a learner about AL.

### 3.5 The writing model and what the checker enforces

1. **Headline first.** One or two sentences, ≤ 80 characters of plain text after the templates are
   filled (the checker fills them on the measured machine), at most two `<b>` values; never starts
   with "Now" or "Then"; never ends with a colon. (Checked.)
2. **Details on request.** ≤ 2 sentences, ≤ 220 characters; the mechanism, the numbers with units,
   the "why" (the gap texts of map §5.6). (Checked.)
3. **A term gets its meaning the first time.** `terms` on the beat that first needs the word; the
   card prints `LEARN_TERMS[t].short` (≤ 90 characters) in the term line once per visit
   (`learn:terms`); later uses are dotted-underlined. No separate term beat. A lesson introduces ≤ 3
   terms (8086 lesson 1: ≤ 6) and the outline shows them. (Checked: count, existence, and that a
   term's first use in the lesson is on or after its `terms` beat.)
4. **Names live on the board, not in the sentence.** A chip type number (8282, 74LS573, 8288) may
   appear in a caption only when that part is **labelled on the stage at that beat** (one of the ≤ 3
   stage labels of 6.2: in `labels`, or a `look` id, or the step's source or target); otherwise the
   sentence says "the latches", "the bus controller". Exempt: the machine names (8086, 80286, 80386,
   80486, Pentium, Pentium Pro), which are the course's subjects, and `{cmp:…}` templates. (Checked
   against the beat's labels and the step's `fromName/toName` devices; a part number outside that set
   fails.)
5. **Numbers.** No hex without its plain number the first time it matters in a lesson ("41h, the code
   of the letter A"). In a headline, a hex value (`…h`) or a plain number of three or more digits must
   be a template, appear in the program source, or be one of the program's bytes (`lineMap`,
   assembler.js:1344-1404; so `8E C0` and `41h` pass for the letter program); a beat may list free
   plain numbers in `plain: [60, 1978]`; instruction ordinals ("Instruction 4"), numbers under 100
   and the machine names of rule 4 are free. The checker fails any other headline digit run. `0x`
   never appears.
6. **No acronym before its term**: BIU, EU, ALE, IVT, MESI, RAT, ROB, TLB, BTB appear only on or
   after a beat with that term. (Checked against `LEARN_TERMS` acronym list.)
7. No "as we saw" or lesson numbers; no clock counts in the 8086 course before lesson 2 except the
   summary beat's `{clocks}`/`{us}` and the `{mhz}` of the clock crystal; no "T1/T2/T3" outside
   lesson 2 and Explore; no cycle counts on the P6 (map §5.1 caveats), only "earlier/later"; no
   sentence about a part not lit; instructions to the learner are buttons. (Read by a reviewer; the
   checker lists the words "T1", "as we saw", "should".)

The two example lessons below were run through these seven rules by hand for this document (every
headline measured after fill on the measured machine: the longest is 79 characters, 3.7's screen
beat; four headlines of the earlier draft were 81-89 and are shortened here). Both pass: the only
plain numbers of three or more digits are `1978` (listed in `plain`), `0B800h`/`B800h`/`1Fh` (in the
program source), `8E C0`/`41h` (program bytes) and the machine names; the clock counts of the 8086
lesson are the summary's templates and `{mhz}`; no part number appears without its label.

### 3.6 Example lesson 1: the 8086 letter

```js
const LESSONS_8086 = [
{
  id: '8086-01-letter', machine: '8086', n: 1,
  title: 'A letter on the screen',
  idea: 'A program is bytes in memory; the CPU fetches, decodes and executes them; one byte written to the video memory makes a letter.',
  minutes: 4, gaps: [1, 15, 25],
  terms: ['program', 'register', 'segment register', 'address', 'bus', 'video memory'],
  program: { program: 'letter86' },   // mov ax, 0B800h / mov es, ax / mov al, 'A' / mov [es:0], al / ret  (12 bytes, measured; hex written xxh)
  options: {}, story: { prefetch: 'parallel', burst: 'fold' }, from: { instr: 0 },
  units: ['8086/DECODER', '8086/REGISTERS', '8086/ADDRESS ADDER', '8086/BUS CONTROL'],   // the 8086 has no BLK_* remap: keys = trace labels
  beats: [
    { look: [], plain: [1978], cap: { h: 'This is a PC of 1978. One chip runs the program; the others help it.',
                       d: 'The board is real: every chip here has a job in the next four minutes.' }, terms: ['program'] },
    { look: ['cpu', 'clk'], cap: { h: 'The 8086 runs the program: it reads the bytes and does what they say.',
                       d: 'One part of it fetches bytes over the board; another decodes and executes them. The crystal next to it gives it {mhz} million ticks a second.' } },
    { look: ['ramE', 'ramO'], cap: { h: 'The program is <b>{bytes}</b> bytes in the RAM, from address <b>{origin}</b>.',
                       d: 'An assembler turned the five lines in the column into these bytes. The CPU sees only the bytes.' } },
    { look: ['cga', 'monitor'], cap: { h: 'The video card has its own memory. What is in it is what the screen shows.',
                       d: 'The card reads it 60 times a second and draws one character for each pair of bytes. The screen still shows the text the ROM printed while the PC started.' } },
    { say: true, focus: ['cpu'], cap: { h: 'Instruction 1: mov ax, 0B800h. Put the number B800h in the register AX.',
                       d: 'Its bytes are B8 00 B8. A register is a small cell of the CPU\'s own memory; AX is one of eight general ones.' }, terms: ['register'] },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Decode', stop: '8086/DECODER', cap: { h: 'The decoder reads <b>B8</b>: "put the next two bytes in AX".',
                       d: 'The bytes were fetched ahead of time, so the CPU does not wait for them.' } },
        { at: 'inside:Execute', stop: '8086/REGISTERS', cap: { h: 'AX gets <b>{reg:AX}</b>. Nothing left the chip: this happened inside.' } } ] },
    { say: true, cap: { h: 'Instruction 2: mov es, ax. Copy AX into ES, which names a place in memory.',
                       d: 'ES x 16 = B8000h: the CPU uses ES as the start of the video memory in the next instructions.' }, terms: ['segment register'] },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Decode', stop: '8086/REGISTERS', cap: { h: 'ES gets <b>{reg:ES}</b>. Two bytes, 8E C0, did all of it.',
                       d: 'This instruction is one step: a value moves between two registers inside the chip.' } } ] },   // mov es, ax has no Execute step (measured)
    { say: true, cap: { h: "Instruction 3: mov al, 'A'. Put 41h, the code of the letter A, in AL.",
                       d: 'AL is the low half of AX. Letters are numbers to the machine: A is 41h = 65.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Execute', stop: '8086/REGISTERS', cap: { h: 'AL gets <b>{reg:AL}</b>. The CPU has the letter; the screen does not.' } } ] },
    { say: true, cap: { h: 'Instruction 4: mov [es:0], al. Write AL to the first cell of the video memory.',
                       d: 'This one leaves the chip: the byte must travel over the board to the card.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Address calculation', stop: '8086/ADDRESS ADDER', cap: { h: 'The CPU adds ES x 16 and 0: the address is <b>{addr}</b>.',
                       d: 'Twenty address wires can name 1 MB of places; B8000h is where the video card listens.' }, terms: ['address'] },
        { at: 'bus:memw:vram:addr', stop: '8086/BUS CONTROL', cap: { h: 'The address <b>{addr}</b> goes out on the bus, to every chip on the board.',
                       d: 'The latches next to the CPU hold it for the whole cycle, because the same wires carry data next.' }, terms: ['bus'] },
        { at: 'bus:memw:vram:cmd', quick: true, cap: { h: 'The command says "write". Only the video card answers to this address.',
                       d: 'The bus controller turns three status wires of the CPU into one command line. The card in the slot decodes the address itself.' } },
        { at: 'bus:memw:vram:data', cap: { h: 'The byte <b>{data}</b> travels to the card and lands in its first cell.',
                       d: 'The transceivers pass it from the CPU\'s wires to the board\'s wires. The memory chip on the card keeps it.' }, terms: ['video memory'] } ] },
    { screen: true, cap: { h: 'The card draws its memory 60 times a second: cell 0 now holds <b>{screen:0}</b>.',
                       d: 'The letter appears. The second byte of the cell, 07h, is the colour: grey on black.' } },
    { check: { ask: 'What did the CPU send to the video card?', options: ['The byte 41h', 'The letter A as a picture', 'The word "mov"'], answer: 0,
               why: 'The CPU only moves bytes. The card turns 41h into the picture of an A.' } },
    { run: { until: 'halt' }, cap: { h: 'RET ends the program; the system prints a note and stops the CPU.',
                       d: 'RET jumps to address 1000:0000, where two bytes CD 20 mean INT 20h: "end the program". The ROM prints [program ended] and halts.' } },
    { say: true, focus: ['screenTL'], cam: { theta: 0.08, phi: 1.42, keepY: true },
      cap: { h: 'That is all a program does: move bytes and calculate. <b>{clocks}</b> clocks, <b>{us}</b>.',
             d: 'Four instructions. The CPU had to fetch each code byte over the bus before it could use it, and one byte to the video memory made a letter.' } },
  ],
  end: { check: null, further: ['hello', 'vram'], tryIt: "Open this program in the Workbench and change 'A' to 'B'.", next: '8086-02-bus' },
},
// … lessons 2-9
];
```

Compiled: 4 looks + 4 says + 8 step beats (the fourth instruction gives four: address calculation,
address, command, data — in story-step order on the 8086, where the `ea` event precedes the bus
cycle) + 1 screen + 1 check + 1 run + 1 summary = 20 beats; about 90 s of animation, 4 minutes at a
reader's pace (section 5). `{clocks}` is 34 and `{us}` "7.1 µs" on the measured machine; the text
never types them. The bus cycle is three captioned beats here and only here (section 11, decision 6).
Every `step` beat above starts with a hidden `Decode` (`rest: 'hide'`): the engine does not enter
step 0 on its own (`beginInstr(now, { enter: false })`, section 7.3), so the board shows the first
shown step and nothing before it.

### 3.7 Example lesson 1: the Pentium letter

```js
const LESSONS_80586 = [
{
  id: '80586-01-letter', machine: '80586', n: 1,
  title: 'The same letter, two at a time',
  idea: 'The same bytes run on a chip that keeps recent code in a cache and runs two simple instructions in one clock.',
  minutes: 5, gaps: [19, 21, 26],
  terms: ['cache', 'pipe'],
  program: { program: 'letterP5' },   // + mov bl, 1Fh / mov [es:1], bl: 19 bytes, six instructions (explain3d.js:11-18)
  options: {}, story: { prefetch: 'parallel', burst: 'fold' }, from: { instr: 0 },
  // keys in the P5 plan's spelling; every one is a label the P5 trace models visit (CACHE_CARD_P5, P5_CARDS, CPU_TRACE.inside
  // after the BLK_586 remap: REGISTERS → REGISTERS, ADDRESS ADDER → SEGMENT UNIT)
  units: ['80586/CODE CACHE 8 KB', '80586/REGISTERS', '80586/U PIPE', '80586/V PIPE', '80586/DATA CACHE 8 KB', '80586/BUS INTERFACE'],
  beats: [
    { look: ['cpu', 'clk'], cap: { h: 'The same program, fifteen years later: a Pentium at <b>{mhz}</b> MHz.',
                       d: 'It runs the same bytes as the 8086. Two things are new on this chip: it runs two instructions at once, and it keeps recent bytes in two caches.' } },
    { look: 'die:cpu', labels: ['cpu'], cap: { h: 'Inside: two pipes, U and V, and two caches of 8 KB, code and data.',
                       d: 'A cache is a small fast memory on the chip that keeps the bytes the CPU used last. A pipe is a line of stages an instruction moves through.' }, terms: ['cache', 'pipe'] },
    { say: true, focus: ['cpu'], cap: { h: 'Instruction 1: mov ax, 0B800h, the same first instruction.', d: 'Its bytes are the same: B8 00 B8. Registers are 32 bits wide now; AX is the low half of EAX.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'cache:code:fill', stop: '80586/CODE CACHE 8 KB', cap: { h: 'The code is not in the cache yet: the chip reads a whole 32-byte line.',
                       d: 'The 64-bit bus brings 8 bytes per transfer, four transfers. Every later instruction of this program is already inside.' } },
        { at: 'inside:Execute', stop: '80586/REGISTERS', cap: { h: 'EAX gets <b>{reg:EAX}</b>: 32 bits now, the top half zero.' } } ] },
    { step: 1, rest: 'fold', cap: { h: 'ES gets <b>{reg:ES}</b>, as on the 8086. Nothing new here.' } },
    { say: true, cap: { h: "Instructions 3 and 4: mov al, 'A' and mov bl, 1Fh, side by side.",
                       d: 'Two simple instructions that do not need each other go through the U pipe and the V pipe in the same clock.' } },
    { step: { count: 2 }, rest: 'hide', show: [
        { at: 'inside:Decode:pipe', nth: 1, stop: '80586/U PIPE', cap: { h: "The U pipe takes mov al, 'A': <b>{cycles}</b> clock.", d: 'The decoder sees that the next instruction is simple and independent, so it pairs them.' } },
        { at: 'inside:Decode:pipe', nth: 2, stop: '80586/V PIPE', cap: { h: 'The V pipe takes mov bl, 1Fh in the same clock: <b>{reg:BL}</b> is the colour.', d: 'White letters on blue: 1Fh is a colour code the card understands.' } } ] },
    // Instruction 5. Measured step order on the Pentium (and the 486 and P6): Decode → Ts/Tc/Tc bus steps → the cache step
    // ('Data cache: write miss') → Address calculation. Beats play in that order (3.2), so the explanation of the cache comes
    // in the `say` before the step, the bus cycle is the first beat, the cache step the second, and the late Address
    // calculation is hidden.
    { say: true, cap: { h: 'Instruction 5: mov [es:0], al. The write, now with a data cache in the way.',
                       d: 'The data cache has no line for this address, and a write that misses is not kept: the byte goes out to the bus.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'bus:memw:vram', stop: '80586/BUS INTERFACE', cap: { h: 'The byte <b>{data}</b> goes over the 64-bit bus to the card, at <b>{addr}</b>.',
                       d: 'Address, command and data in one cycle: the latches, the bus controller and the transceivers of this board do the same jobs as on the 8086.' } },
        { at: 'cache:data:write', stop: '80586/DATA CACHE 8 KB', cap: { h: 'The data cache has no line for <b>{addr}</b>: a write miss, and nothing is kept.',
                       d: 'The video memory is not something to cache: the card must see every byte at once.' } } ] },
    { step: 1, rest: 'fold', cap: { h: 'The colour byte <b>{data}</b> goes the same way, to the second byte of the cell.' } },
    { screen: true, cap: { h: 'The first cell holds <b>{screen:0}</b> and the colour 1Fh: the letter appears, white on blue.',
                       d: 'Each cell of the text screen has two bytes: the character, then its colour.' } },
    { check: { ask: 'Which two instructions ran in the same clock?', options: ['1 and 2', '3 and 4', '5 and 6'], answer: 1, measured: true,   // the checker recomputes the pairing from the pipe events
               why: "mov al and mov bl are simple and independent: U and V took one each. The two writes both need the bus, so they went one after the other." } },
    { run: { until: 'halt' }, cap: { h: 'RET ends the program, as on the 8086; the ROM prints a note and halts.' } },
    { say: true, focus: ['screenTL'], cam: { theta: 0.08, phi: 1.42, keepY: true },
      cap: { h: 'Six instructions, <b>{clocks}</b> clocks: <b>{us}</b>. The 8086 needed {cmp:8086:clocks} clocks for four.',
             d: 'Half of them went to the first instruction: the cache had nothing yet. After that the chip ran one or two instructions per clock.' } },
  ],
  end: { check: null, further: ['p5pairs', 'btb'], tryIt: 'Change 1Fh to 4Eh (yellow on red) in the Workbench and run it.', next: '80586-02-pairs' },
},
];
```

Measured on the Pentium: `{clocks}` = 20, `{us}` = "0.30 µs", `{cmp:8086:clocks}` = 34; instruction 1
takes 10 clocks (the code-cache line fill), the pair takes 1 + 1, each write 3.

---

## 4 The curriculum for v1

Forty lessons: 9 + 6 + 6 + 6 + 6 + 7. "Program" is a key of `LEARN_PROGRAMS` (new, 4-13 lines,
each run in Node by the checker before it enters the list) or a `SAMPLES` id with `from`. Every
lesson 1 of a later machine is the letter program; every last lesson is "What changed, in numbers".
The "check" column is the end question's subject; mid-lesson checks are in the beat lists. The last
column names the map §5.6 gaps closed.

Every `units`/`stop` key and every selector in this section was checked for this revision against
`DIE_PLANS` (board3d.js:733-856), the `BLK_*` remaps (857-882) and the visit labels the trace models
emit (`CPU_TRACE.inside` 1725-1760, `P5_CARDS`, `P6_CARDS` 1985-2015, `CACHE_CARD*` 1956+, `PAGE_CARD`):
a key must exist in the die plan **and** be a label some step of the lesson visits after the remap,
or the stop silently produces nothing (section 7.7 fails it). At WP0 `tools/ids.mjs` writes
`docs/rewrite/ids.md` with both spellings per part (the trace model's label and the plan's label) and
the visit labels per model; ids.md is the authority and this section is revised from it. Facts of
the code this section relies on: the 80386 plan has no `PAGING UNIT`, `BARREL SHIFTER` or `FLAGS`
(`BLK_386` maps FLAGS to ALU; paging is `TLB`, `PAGE WALKER`, `PAGE ADDER`); the 80486 plan has no
`PIPELINE` or `FPU` (the 486 pipe card lands on `INSTRUCTION DECODER`, 1913-1915; the FPU branch of
`CPU_TRACE.inside` visits `CONTROL` → `CONTROL ROM` and `REGISTER STACK`, 1728-1731, so `EXPONENT` and
`MANTISSA` exist but are never visited); on the Pentium the FPU visits are `CONTROL ROM` and `FPU
REGISTERS` (`FPU ADDER` is never visited); the P6 cards visit `RAT`, `RESERVATION STATION`, `ROB` (the
ports are never visited); `btb` steps are wrong predictions only (3.3).

### 4.1 The 8086 (9 lessons)

| id | Title | Idea | Program | Beats outline | Check | Gaps |
|---|---|---|---|---|---|---|
| 8086-01-letter | A letter on the screen | A program is bytes; the CPU fetches, decodes, executes; one byte to the video memory makes a letter | `letter86` (3.6) | 4 looks · decode + execute per instruction · the write as address / command / data · screen · run to halt · summary | what the CPU sent (41h) | 1, 15, 25 |
| 8086-02-bus | Where the bytes come from: the bus and the clock | A fetch is a bus cycle of T states, address out, command, data back, at 210 ns per clock; the CPU fetches ahead | `letter86`, `story: { prefetch: 'full' }` | look `die:clk` with the clock text (explain3d.js:464) · instruction 1 with `bus:fetch:ram:addr/cmd/data` shown, stops `8086/BUS CONTROL`, `8086/QUEUE`: these are the queue's refills, the bytes of instructions 2-4 arriving while instruction 1 runs (measured: 2 background fetches; instruction 1's own bytes were fetched by the ROM's RETF and the untraced boot loop, so `LearnPlan.order`'s "own fetches before Decode" finds none here) — the caption says so: "the bytes of the next instructions arrive while this one runs" · the queue filling · later fetches folded ("the bytes arrive ahead") · a check mid-way | how many address wires (20) | 5, 6, 8 |
| 8086-03-alu | Registers and the ALU | Registers are the CPU's own cells; the ALU adds and subtracts; the flags say what the result was like | `alu` (`mov al,200 / add al,100 / mov bl,7 / sub bl,7 / mov cl,al / ret`; measured: AL = 2Ch, CF = 1; then ZF = 1) | Execute stops `8086/REGISTERS`, `8086/ALU`, `8086/FLAGS` after ADD (CF) and SUB (ZF) | AL after ADD (`from: 'reg:AL'`, 2Ch = 44) | 3, 25 |
| 8086-04-segs | Memory and addresses: segments | A 20-bit address is segment x 16 + offset; a word is two bytes in the even and odd banks | `segs` (`mov ax,1234h / mov [200h],ax / mov bx,[200h] / mov al,[201h] / ret`) | `8086/ADDRESS ADDER` stop (DS x 16 + 200h) · the word write with both banks lit (`bus:memw:ram`) · the byte read from the odd bank | the physical address of DS:0200 (10200h) | 4, 7, 25 |
| 8086-05-jumps | Deciding: flags and jumps | A conditional jump reads one flag; a taken jump empties the prefetch queue | `stars` (five stars, measured: JNZ jumps back four times) | first pass in full: `dec cx` at `inside:Decode` with stop `8086/FLAGS` · `jnz` at `inside:Execute` with stop `8086/QUEUE` (the flush) · `repeat: { times: 4, then: 'skip' }` · the fall-through JNZ (one step; traced because the Lesson ring never folds on its own, 7.3) · a `check` with `measured: true` | how many times JNZ jumped back (4, `measured: true`) | 8, 9 |
| 8086-06-stack | Remembering: the stack | SP points at memory the CPU uses to remember; CALL pushes the return address, RET pops it | `call2` (`Hi` through two CALLs, measured: 15 instructions, 202 clocks) | CALL: `bus:memw:ram` (the push to SS:SP) with stop `8086/REGISTERS` · the jump · RET: `bus:memr:ram` (the pop) · the second CALL folded | what RET pops (the return address, `from: 'mem:1000:FFFC:w'`) | 10 |
| 8086-07-timer | Interrupts: the timer ticks | A device asks; the CPU finishes its instruction, gets a vector from the interrupt controller, runs a handler, returns with IRET | `tick` (INT 1Ch hook with `push cs / pop ds`, 26 lines, 55 bytes; measured: prints 4 and ends) | the vector write to 0000:0070 · `hlt` (no `wait` beat: the timer wakes it) · the `irq` step, two `bus:inta:pic` cycles (vector 08h), the pushes, the ROM's INT 08h folded `run: { until: { bios: 'int08.m' } }`, `int 1Ch` into the handler, its write to the screen, IRET · `repeat` the other three ticks | who told the CPU to stop (the 8253 through the 8259A) | 11 |
| 8086-08-ports | Talking to devices: a key through a port | IN reads a device's register by port number, not by address; the keyboard's byte waits in port 60h | `key` (`mov ah,0 / int 16h / mov [es:0],al / ret`, 14 bytes; measured with a key: prints it and ends) | `int 16h` folded to `run: { until: 'halt' }` ("the ROM waits with HLT") · `wait: 'key'` (the fast wait of 3.2: the raw loop runs through the timer wakes silently and stops when the CPU enters INT 09h — IRQ1 delivered, the INTA pair already done — or the BDA head moves; Auto types `k` after 8 s) · a `say`: "The keyboard raised IRQ1 and the CPU took vector 09h, as it took the timer's tick" · `step: { count: 8 }` from the handler's first instruction with `bus:ior:ppi` shown ("IN AL, 60h reads the scan code from the 8255", `in al, 0x60` is the handler's eighth instruction, bios.js:1136-1143), rest folded · `run: { until: 'iret' }` (INT 09h's IRET returns into INT 16h's wait loop, bios.js:1289-1295) · `run: { until: 'program' }` (INT 16h returns to the program with the key in AL) · the write of the key to the screen | where IN AL,60h reads from (an 8255 port, not memory) | 12 |
| 8086-09-bios | The BIOS, and what changed since 1978 | The ROM holds a program that runs first and offers services through the vector table; the numbers of this machine are the baseline | `hello`, `from: { instr: 0 }` | `int 10h`: `inside:Interrupt`, the vector read `bus:memr:ram` at 0000:0040, the far jump into the ROM (`bus:fetch:rom` with `prefetch: 'short'`), `run: { until: 'program', into: true }` ("138 instructions in the ROM"; `'program'`, not `'iret'`, so a nested IRET inside the teletype service cannot end the fold early) · `repeat` the rest of the string · the facts card from `compare.js` | where INT 10h finds its handler (the vector table) | 14, 24, 26 |

### 4.2 The 80286 (6 lessons)

| id | Title | Idea | Program | Beats outline | Check | Gaps |
|---|---|---|---|---|---|---|
| 80286-01-letter | The same letter, a new board | The same 12 bytes run unchanged; a bus cycle is two clocks (Ts, Tc) plus a wait state at 8 MHz; other chips latch and command | `letter86` | two looks of ≤ 3 labels each (rule 3.5.4; `INFO` is keyed by kind, so `lat0 lat1 lat2` share the one label `lat`): `look: ['lat0', 'lat1', 'lat2'], labels: ['lat']` (74LS573) · `look: ['xcv0', 'xcv1', 'bus', 'dec'], labels: ['xcv', 'bus', 'dec']` (74LS245, 82288, PAL16L8) · the write's Ts/Tc (`bus:memw:vram:addr`, `bus:memw:vram:data`; matched by phase, the titles read Ts/Tc here) · summary with `{cmp:8086:clocks}` | how many clocks a bus cycle takes (2 + 1 wait) | 26, 27 |
| 80286-02-units | Four units at once | The bus unit fetches, the instruction unit decodes ahead, the address unit adds the base, the execution unit executes | `stars` | `inside:Address calculation` with stop `80286/PHYSICAL ADDER` · `inside:Decode` with stop `80286/PREFETCH QUEUE` · the loop's first pass, `repeat: 4` | which unit adds the base (the address unit) | 20 |
| 80286-03-a20 | Above 1 MB: the A20 line | With 24 address wires a segment can reach past 1 MB; the A20 gate keeps the old wrap | `a20`, `from: { label: 'test_wrap' }` | the write at FFFF:0010 landing at 00000h (`bus:memw:ram`) · `bus:iow:kbc` (port 92h, the 8042 lit) · the same write at 100000h (`bus:memw:xram`, the card lit) · `run` to the end so the screen text is real | where FFFF:0010 lands with A20 off (00000h) | 4, 7 |
| 80286-04-pm | Protected mode: a descriptor instead of x 16 | A segment register becomes a selector into a table; the descriptor cache holds base and limit | `pm286`, `from: { label: 'pm_entry' }` | `inside:Protection` (LMSW, MSW.PE) · `inside:Descriptor` with stop `80286/SEGMENT CACHES` · the first far jump · the write to the screen through a descriptor | what ES holds now (a selector, `from: 'reg:ES'`, `format: 'hex16'`) | 17 |
| 80286-05-fault | Protection: a fault caught | An access past a limit does not happen; the CPU raises #GP and a handler decides; the way back is a reset through the keyboard chip | `pm286`, `from: { label: 'after_gp' }` (the faulting access is next) | the `inside:Protection` step ("limit check fails") · `inside:Interrupt` (INT 0Dh through the IDT) · `run: { until: { label: 'gp_handler' } }` · the message · `bus:iow:kbc` (the 8042 reset) · `run` to the end | what stopped the write (the limit check) | 17 |
| 80286-06-numbers | What changed, in numbers | The AT's new chips and the numbers of the letter program on both machines so far | `rtc` (read the RTC seconds through ports 70h/71h and show them, 8 lines) | `bus:iow:rtc` / `bus:ior:rtc` with the 8042 and the RTC lit · the second 8259A · the facts card (8086 vs 80286: clocks, µs, bus cycles) from `compare.js` | which machine took fewer clocks | 26, 27 |

### 4.3 The 80386 (6 lessons)

| id | Title | Idea | Program | Beats outline | Check | Gaps |
|---|---|---|---|---|---|---|
| 80386-01-letter | The same letter, 32 bits wide | Registers and addresses are 32 bits; this board's data bus is 16 bits | `letter86` | the 32-bit `80386/REGISTERS` card · the 16-byte queue · the write · summary with `{cmp:80286:clocks}` | how many bits EAX has (32) | 26 |
| 80386-02-bits32 | 32-bit numbers and shifts | A 32-bit add is one pass through a wider ALU; a shift by any count is one step | `shl32` (`mov eax,12345678h / add eax,eax / shl eax,4 / mov [n],eax / ret`, 5 lines) | Execute stops `80386/ALU` (the ADD, and the flags: `BLK_386` maps FLAGS to ALU, so the flags card is on the ALU block) and `80386/MULTIPLY DIVIDE` (the wide-arithmetic block, lit as the ALU's neighbour) · the SHL as `inside:Execute` with stop `80386/ALU` and a caption saying the shifter is part of the ALU on this plan (the 80386 plan has no `BARREL SHIFTER`; the 486 and P5 plans have one, but no trace model visits it, so the shifter is never a stop anywhere) · the dword store as two `bus:memw:ram` cycles | EAX after SHL (`from: 'reg:EAX'`) | 3 |
| 80386-03-paging | Paging: an address translated | A linear address is looked up in two tables to find the page; the program never sees the real address | `paging`, `from: { label: 'pm' }` | CR3 and CR0.PG (`inside:Protection`) · `page:walk` with stop `80386/PAGE WALKER` (two reads: PDE, PTE); `80386/TLB` and `80386/PAGE ADDER` are the step's source and target and stop by the default rule (6.3); `units` lists the three · the write landing at B8000h | which entry pointed at B8000h (the PTE) | 18 |
| 80386-04-tlb | The TLB: a cache of translations | The second access to the same page skips the walk; the CPU marks the page accessed and dirty | `paging`, `from: { label: 'pm.w' }` | the translation without a walk (no `page` step; `inside:Address calculation` with stop `80386/TLB`, lit through `look: 'die:cpu'` if the step's visits do not reach it — checked with `--json`) · the A and D bits (`{mem:…}` shows 63h) · `run` to the end (the screen text is real) | how many bus reads the walk took this time (0) | 18, 19 |
| 80386-05-bits | Growing the instruction set: bits | New instructions (BSF, BT, MOVZX, SHLD) do in one step what took loops | `bits`, `from: { label: 'start.bit' }` | `inside:Decode` of a two-byte opcode (0F prefix) · BSF's Execute with stop `80386/ALU` (no barrel shifter on this plan) · `run` the printing | what 0Fh at the start of an opcode means (a second opcode byte) | 2 |
| 80386-06-numbers | What changed, in numbers | Six units, paging, 32 bits, 25 MHz: the letter program on three machines | `letter86` | one look per unit of the die (`die:cpu`, six labels) · the facts card | which change made the program faster (the clock) | 26 |

### 4.4 The 80486 (6 lessons)

| id | Title | Idea | Program | Beats outline | Check | Gaps |
|---|---|---|---|---|---|---|
| 80486-01-letter | The same letter, with a cache | The first fetch misses and fills a 16-byte line in a burst; the rest of the program comes from the cache | `letter86` | `cache:unified:fill` line fill with stop `80486/CACHE 8 KB` (first transfer full, the other seven as one quick beat, `plan()` explain3d.js:380-386) · later Decodes "from the cache" · the write-through, in step order: `bus:memw:vram` (stop `80486/BUS INTERFACE`) then `cache:unified:write` (title `Cache: write through`, story.js:278), the explanation in the `say` before them (as 3.7) | where instruction 3's bytes came from (the cache) | 19 |
| 80486-02-locality | Why a cache: locality | Programs touch the same bytes again soon; the second pass costs no bus cycles | `sum2` (sum 8 words of an array twice, 10 lines) | pass 1: `cache:unified:fill` misses and fills · pass 2 `repeat` with `{cycles}` in the caption (the pass is traced by the lesson's `repeat`, never folded by the engine, 7.3) · a check mid-way (`measured: true`) | bus cycles in the second pass (0, `measured: true`) | 19 |
| 80486-03-pipe | The pipeline: five stages | Five instructions are in the chip at once, one per stage, so a simple instruction finishes every clock | `pipe5` (six independent `mov`/`add`, 6 lines) | no `pipe` step exists (3.3): `inside:Decode:pipe` at each Decode with stops `80486/INSTRUCTION DECODER` (where the 486 pipeline card lands, board3d.js:1913-1915) and `80486/PREFETCHER` (the queue's block after the `BLK_486` remap) · `{cycles}` per instruction | clocks for a simple instruction in a full pipeline (1, `measured: true`) | 20 |
| 80486-04-cd | Write-through, and turning the cache off | A write updates cache and memory; with CR0.CD set every access is a bus cycle again | `cd` (a write, `mov eax,cr0 / or eax,60000000h / mov cr0,eax / wbinvd`, then a read; 9 lines) | the write-through (`bus:memw:ram` then `cache:unified:write`, step order) · the CR0 `inside:Protection` step · the read that misses with no fill (`cache:unified:miss`) | what WBINVD did (emptied the cache) | 19 |
| 80486-05-fpu | The FPU moves on chip | Floating point no longer crosses the bus to a coprocessor | `fadd` (`fld1 / fld1 / faddp / fistp word [n] / mov ax,[n] / ret`) | the FADD inside step (`inside:*:fpu`; its title is the FPU's name) with stops `80486/REGISTER STACK` and `80486/CONTROL ROM` (the two visits of the FPU branch of `CPU_TRACE.inside`, 1728-1731, after `BLK_486`; the 486 plan has no `FPU` block, and `EXPONENT`/`MANTISSA` exist but are never visited, so they are labels of a `look: 'die:cpu'`, not stops) · the clocks in the details · the store | what the 8087 needed that the 486 does not (the bus) | 16 |
| 80486-06-numbers | What changed, in numbers | Cache, pipeline, on-chip FPU, 33 MHz: four machines compared | `letter86` | the facts card · the die tour | why the second run of a program is faster (the cache) | 26 |

### 4.5 The Pentium (6 lessons)

| id | Title | Idea | Program | Beats outline | Check | Gaps |
|---|---|---|---|---|---|---|
| 80586-01-letter | The same letter, two at a time | Two simple instructions go through U and V in one clock; a cache keeps recent code | `letterP5` (3.7) | as 3.7 | which instructions paired (3 and 4) | 19, 21, 26 |
| 80586-02-pairs | Pairing needs independence | A pair forms only when the second instruction does not need the first's result | `pairs` (4 independent ADDs, then 4 chained ADDs on EAX, 10 lines) | `inside:Decode:pipe` with stops `80586/U PIPE`, `80586/V PIPE`: paired, then "U pipe alone: V reads a register that U writes" (the loop bodies are traced by the lesson, never folded by the engine, 7.3) | why the chained ADDs do not pair (a dependency) | 21 |
| 80586-03-btb | Branch prediction: the BTB learns | The chip guesses where a jump goes before it knows; a wrong guess costs clocks; a 2-bit counter learns | `stars` | a `btb` step exists only for a wrong prediction (3.3; measured on the five-stars loop: JNZ 1 wrong — no entry —, JNZ 2-4 right, the fall-through wrong — predicted taken): `btb` at the first JNZ with stop `80586/BRANCH TARGET BUFFER` · `inside:Decode:btb` at the second JNZ (right: "the counter learned", the line is in the Decode step) · `repeat: { times: 2 }` · `btb` at the fall-through (wrong again) | how many guesses were wrong (2, `measured: true`) | 22 |
| 80586-04-caches | Two caches and a 64-bit bus | Code and data have their own 8 KB caches; a miss fills 32 bytes in four transfers; MESI states say who owns a line | `sum8` (sum 8 dwords of an array, 8 lines) | `cache:data:fill` with stop `80586/DATA CACHE 8 KB` · the four-transfer burst (first full, three folded; `80586/BUS INTERFACE` is the step's target) · the MESI state in the details | how many bytes one burst brings (32) | 19 |
| 80586-05-fdiv | The FDIV bug | A table in the divider had five missing entries; one division in a few billion came out wrong after the fourth digit | `fdiv`, `from: { text: 'fdiv' }`, `options: { fdivBug: true }` (off by default, machine586.js:20) | the FDIV inside step (`inside:*:fpu`, 39 clocks) with stop `80586/FPU REGISTERS` (the FPU branch's `REGISTER STACK` after `BLK_586`; `FPU ADDER` exists in the plan but no step visits it) · `run` to the printed result | which digit is first wrong (the 5th, `measured: true`) | 16, 24 |
| 80586-06-numbers | What changed, in numbers | Superscalar, predicted, 66 MHz: five machines compared | `letterP5` | the facts card · the die tour (U/V, BTB, the two caches) | which idea saved the most clocks here (pairing) | 26 |

### 4.6 The Pentium Pro (7 lessons)

| id | Title | Idea | Program | Beats outline | Check | Gaps |
|---|---|---|---|---|---|---|
| 80686-01-letter | The same letter, in µops | Each instruction becomes µops, renamed, executed when ready, retired in order; the L2 is in the package | `letterP5` | measured on the P6: instruction 1 is five steps — `inside:Decode`, `cache:l2:miss` (`L2 miss: front-side bus`), `cache:code:miss` (`L1 code miss`), `inside:Inside the CPU` (the µop line), `inside:Execute` (the ROB retire line) — so: `inside:Decode` (three decoders) with stop `80686/DECODERS` · `inside:*:rat` with stop `80686/RAT` (the RAT line rides in the Decode or the Execute step; the writer copies the step from `--json`) · `inside:Inside the CPU:uop` with stop `80686/RESERVATION STATION` (the P6 cards visit RAT, RESERVATION STATION and ROB, board3d.js:1991-2013; no port is ever visited) · `inside:Execute:rob` with stop `80686/ROB` · the write, in step order: `bus:memw:vram` then `cache:data:miss` (and its `cache:l2:miss`), explained in the `say` before them; summary with `{cmp:80586:clocks}` | what puts the results back in order (the reorder buffer) | 23 |
| 80686-02-ooo | Why out of order: a slow divide | Adds that do not need the divide's result run while the divider works | `ooo`, `from: { label: 'loop1.l' }` | the DIV's `inside:*:uop` step ("goes to port 0") · the ADDs' `inside:*:uop` steps ("pass 1 older µop") with stop `80686/RESERVATION STATION` (the loop body is traced by the lesson, never folded by the engine, 7.3) · `run` to the printed ratio (the `from` fold and this run are bounded by 7.7 check 3: `loop1` is 1,000,000 iterations of a 39-clock DIV, bios.js:6635, so the run ends at `{ label }`, not at the loop's end) | why the ADDs did not wait (they needed nothing from DIV) | 23 |
| 80686-03-rename | Renaming: EAX is many registers | Writes to the same register get different ROB entries, so they do not wait for each other | `rename`, `from: { label: 'loop1.l' }` | `inside:*:rat` steps ("renames EAX to ROB n") with stop `80686/RAT` · `run` to the end | how many ROB entries EAX used (from the RAT line, `measured: true`) | 23 |
| 80686-04-rob | Results in order: the reorder buffer | Results wait in the ROB and retire oldest first, so the program sees a normal machine | `rename`, `from: { label: 'loop2.l' }` (PASSES iterations of loop1 precede it: the `from` figure is printed by 7.7 check 3 and Back across instructions falls back to "Back to the start of this lesson" if it exceeds `backBudgetMs`, 5.3) | `inside:Execute:rob` steps with stop `80686/ROB` · the RRF (`80686/RETIREMENT REGISTERS`, the block a register write visits after `BLK_686`) | why retirement is in order (so a fault lands on the right instruction) | 23 |
| 80686-05-l2 | Three levels of memory | L1 hits cost 3 clocks, L2 hits 7, memory 22 more | `l2`, `from: { label: 'chase' }` | an L1 miss (`cache:data:miss`) → `cache:l2:hit` (the back-side bus, `80686/BUS INTERFACE`, the only visit of the L2 card) · `cache:l2:miss` → the front-side burst · `run` to the printed clocks | how many clocks an L2 hit costs here (7, `measured: true`) | 19 |
| 80686-06-cmov | No branch, no guess: CMOV | A conditional move replaces a jump, so nothing has to be predicted | `cmov`, `from: { label: 'start' }` | `inside:Decode` of CMOV (µops, no `btb` step) · the JL version: the first JL is mispredicted (no BTB entry) and gives a `btb` step with stop `80686/BTB`; a later, right JL is `inside:Decode:btb` — the writer names which execution from `--json`, and the check is `measured: true` · `run` to the printed clocks | what CMOV avoids (a wrong prediction) | 22 |
| 80686-07-numbers | What changed, in numbers: 1978 to 1995 | Six machines, one program: clocks, time, and the idea each chip added | `letterP5` | the full facts card (six columns) · one look per idea's unit on the P6 die | which idea each machine added (match) | 26 |

### 4.7 Order of writing (the must/should split, curriculum §4.7)

Must (publishable): the 8086 course (9), lesson 1 and the last lesson of every other machine (10),
plus 80486-02 and 80686-02 (their lesson 1s are already in the ten): 21 distinct lessons. Should:
the other 19. New programs: `letter86`, `letterP5`, `alu`, `segs`, `stars`, `call2`, `tick`, `key`,
`rtc`, `shl32`, `sum2`, `pipe5`, `cd`, `fadd`, `pairs`, `sum8` (16, all ≤ 26 lines); 26 lessons run
them (`letter86` seven times, `letterP5` four, `stars` three) and the other 14 slice `SAMPLES` with
`from`, their fast-run tails checked against tests/machine.test.mjs:70-110. Each new program enters
`programs-8086.js` or `programs-later.js` (7.2) only with a Node run in the checker (`program` and
`screen` checks, section 7.7); six of them were run for this document.

---

## 5 The pacing model

All times are on the animation clock (`AnimClock`/`animNow()`, theme.js:340-345); pause is
`AnimClock.setScale(0)`; the tools' virtual clock works unchanged (map §6.5). The player never uses
`setTimeout` for anything a check measures. Every constant lives in one object, `LN_PACE`
(plan.js), so the reading test of M2 changes numbers, not code.

### 5.1 The constants

```js
const LN_PACE = {
  readBase: 600, readPerChar: 45,      // headline read time: 600 + 45·chars → 60-80 chars = 3.3-4.2 s (replaces 900 + 50·lead + 22·rest, app.js:393-396)
  detailPerChar: 25,                   // details, only while they are open
  settle: 400,                         // after the animation ends, before Auto may advance
  minBeat: 1500, maxBeat: 6000,        // Auto: a beat is never shorter or longer (brief principle 2)
  animTarget: 4000, animCap: 6000,     // a step's plan over animCap fails the checker; over animTarget it is reported
  moveMs: 1100, flyMs: 1300, cutMs: 360,   // xpFocus during a step (board3d.js:6716), flyTo between beats (4212, its 1300 ms at 4222), a cut (dark, instant flyTo, light)
  quickMs: 650, stepMs: 1700,          // the two `ms` values passed to traceDur: quick (< 1000, board3d.js:6341) and normal
  dieAnimMs: 1700,                     // die mode: a step beat's anim = min(ms, dieAnimMs) (2.9)
  xpTime: { travel: 1.3, work: 0.33, read: 0.2, pass: 0.25, cut: 0.5 },   // section 5.2
  doubleNext: 250, autoKeyMs: 8000, foldWallMs: 1500, backBudgetMs: 300,
  sliceMs: 12, sliceInstrs: 200000,    // a fold or runTo slice ends at either bound (7.3); the checker counts instructions, not ms
  speeds: { normal: 1, slower: 1.4 },  // Auto reading multiplier only
};
```

### 5.2 What the board does with the numbers (verified against `xpPlan`, board3d.js:6336-6400)

| Quantity | Formula in the code | With `xpTime` above | Before |
|---|---|---|---|
| Token speed on the screen | `PX = XP_PX_S · travel` (6342; `XP_PX_S = 280`, 1196) | 364 px/s | 280 px/s |
| `slow` | `clamp(1 / travel, 0.6, 3)` (6344) | 0.77 | 1 |
| Work in a unit with a card (a stop) | `w = max(WORK, xpReadMs(g, read))`, `WORK = 3600 · work` (6342, 6396); `xpReadMs = (900 + (unit + text length) · 48) · read` (6517-6519); a `text` card 0.8·WORK | WORK 1188 ms; xpReadMs for a 110-character sub 1236 ms → a stop is 1.2 s | 3.6 s, or the read time of the sub (up to 6.2 s) |
| Pass through a unit without a card | `PASS = XP_PASS · sqrt(slow)` (6382; `XP_PASS = 800`) → **patched** `· pass` (7.8) | 175 ms, the block glows | 800 ms each; four on a memory write |
| Camera move between two scenes of a step | `xpCutMs(A, B, XP_CUT · slow)` = base · clamp(0.75 + 0.6 S, 1, 3.6) (the cut item 6386, 6479-6485) → **patched** base `· cut` | 540-1940 ms | 1080-3890 ms |
| Camera lead before the token moves | `s._xpLead = xpCutMs(now, first shot, 1200 · slow)` (6317-6318) → **patched** `· cut` | 460-1660 ms (900 for quick) | 920-3320 ms |
| Quick plan (`ms < 1000`) | one scene, `WORK · 0.25`, `PASS = 0`, `RUN_MIN 300` (6341-6342, 6381-6382) | a whole bus phase in ≈ 1.5-2.5 s | same |
| Reading time inside the board | `xpTime.read` also scales the caption hold Explain asked the board for | not used by the player (the card reads) | — |

The `read: 0.2` entry is the resolution of a bug all four proposals carried: without it a stop is
`max(WORK, xpReadMs)` and a unit whose card sentence is 100 characters holds 6 s whatever `work`
says (section 11, decision 5). `tools/beatprobe.mjs` (WP2, week 1) plans every step of the letter
program on the **old** page with these multipliers and prints per step: lead, stops, passes, cuts,
`Tm`; the constants are frozen at M0 from its output, with the rule: the `memw` data step of the
letter program plans under 4 s and every step under 6 s.

### 5.3 Beats

| Beat kind | Animation | Auto hold | Typical total |
|---|---|---|---|
| `look` | one `flyTo` (1300 ms) or a cut when `xpCutMs` says the move would exceed 1800 ms (visual §5.2); stage labels fade in over 250 ms | `readH` | 3-5 s |
| `say` | none (or `fly: false` focus change) | `readH` | 2-4 s |
| `step`, one story step | lead + stops + travel + cuts as planned; at most 2 named stops + source and target (section 6.3) | `max(anim, readH)` | 2.5-4 s |
| `step`, chained phases (`bus:memw:vram`) | the three steps entered in sequence, each after the previous `animMs`, under one caption; each phase quick | `max(anim, readH)` | 3.5-5 s |
| `step`, folded rest | the unmatched steps quick, chained; split into several beats at step boundaries when the sum exceeds `animCap` (the split is decided in `load()`'s dry pass, 7.5, so the beat count is fixed before beat 1) | `max(anim, readH)` | ≤ 6 s |
| `run` | the fast glow (`fast(stats)`) in slices of ≤ `sliceMs` (12 ms) or `sliceInstrs` (200,000 raw steps) per frame, whichever ends first (`ffFrame`, app.js:557-596, + the instruction bound), for up to `foldWallMs` of wall time before the caption says how far it got | `readH` | 2-4 s |
| `wait` | the halted CPU's status lit; the raw wait loop of 3.2 runs ≤ `sliceMs` per frame through the timer wakes; ends on a key (Auto types `keys[0]` after 8 s and says so) | until the key | — |
| `screen` | cut to `screenTL` + a 500 ms reveal (`vset`, explain3d.js:140-154) | `readH` | 3-4 s |
| `check` | none | until answered (Auto pauses) | — |
| end card | cut to `screenTL` | until a door is chosen | — |

Beat (Auto) = `clamp(max(anim, readH) + settle, minBeat, maxBeat)`. Auto never opens the details
(2.3), so `readD` enters this sum only when the learner opened them by hand before Auto advanced, or
under the outline setting "Auto reads the details too" (`learn:autoDetails`), which adds `readD` to
every beat that has details, still clipped to `maxBeat`. With the default, a headline of 60-80
characters gives `readH` 3.3-4.2 s, so a step beat is 3.7-4.6 s and a `say` 3.7-4.6 s: 20 beats are
about 1.5 minutes, 32 beats about 2.5 minutes, which is the "2-3 minutes in Auto" below; with the
setting on, a beat with details is 6 s (the cap) and a lesson 2-3.5 minutes. Beat (by hand) = until
Next; the animation completes in `anim`; nothing waits on reading. Next during an animation completes
the step instantly (the token at its end, the drawing at `u = 1`): the player passes `finish: true`
in the next step's `info`, and patch C (7.8) makes `traceStep` treat it as a replay, which puts the
earlier steps in their end state (board3d.js:7046-7055) before the new flow starts — without the
patch the previous rider's orb and flows would keep running on their own clock beside the new ones
(7059-7071). A `say`/`look` beat's `hold: true` stops Auto until Next. Auto never starts by itself; it
pauses on Outline or glossary open, `visibilitychange`, a `hold` or `wait` beat, a check, and a user
drag of the camera; it resumes only by the learner. Reduced motion: `anim = 0` (instant camera, the
token appears at its stops, `UnitFx.draw(…, reduced)` at `u = 1`), beat = `readH + settle`.

Lesson length: 18-32 beats; 2-3 minutes in Auto; 4-6 minutes at a reader's pace with one check. The
outline's `minutes` = round((Σ readH + Σ anim + 25 s per check) / 60); the checker fails a lesson off
its `minutes` by more than 40 %. The first visit (lesson 1 + lesson 2 + lesson 3 of the 8086) fits
in the brief's twenty minutes. A lesson's animation sum is printed by `learn-check --pace` (Node
model: lead + Σ stops + Σ legs / PX + cuts) and measured by `learn-shots` (the real `traceDur`,
under blurprobe's clock variant so that `performance.now()` advances inside a frame callback and the
slice bounds behave, map §6.5).

Back: within an instruction, `traceStep(story, i, { back: true })` replays without re-dispatch
(app.js:645; the board replays earlier steps, board3d.js:7046-7055). Across an instruction boundary
the machine is re-run from boot to that instruction (`rerunTo(k)`, 7.5 rule 3) with `cpu.trace =
null` (48-194 ms for the POST in Node, section 0), budget `backBudgetMs`; a one-frame "rewinding"
state on the card. The re-run is deterministic for the architectural state by construction; for the
state the captions also show (cache tags and states, BTB entries, clocks) it is asserted, not
assumed: WP1's Node test runs the letter program on all six models traced and re-runs it untraced to
each instruction k and compares registers, cache tags/states and BTB entries (the P6 with `cpu.trace
= null` takes the wasm-free JS path in this build; the µop timing model is bypassed only when the
wasm core is loaded, cpu80686.js:1464, which the learn page never does). When the Node figure for
`rerunTo(k)` of a beat exceeds `backBudgetMs` (a `from` deep in a loop: 80686-04's `loop2.l` follows
PASSES iterations of `loop1`), Back across instructions in that lesson becomes "Back to the start of
this lesson" (`go(0)`, one re-run to `from`), and the button's title says why; the checker prints the
figure per lesson (7.7 check 3). In the one lesson with keyboard input (8086-08-ports) Back across
the key beat is disabled with the title "Back stops at the key you pressed" (section 11, decision 9).

---

## 6 The visual language of a beat

### 6.1 Shots

A beat names subjects, never camera numbers. Five scales, decided from the focus: BOARD (`look: []`
→ `applyPreset('overview')`, board3d.js:4197; or the union box of several chips), REGION (two to
eight glow ids → `xpFocus(ids)`, 6696), CHIP (`'die:<key>'` → `dieEntry` + the die framing through
the runner shim, 6048, 6703-6706), UNIT (a step's stop → the board's own unit scene in `xpPlan`),
SCREEN (`'screenTL'` with `theta 0.08, phi 1.42, keepY`). One camera change per beat: a `look` flies
(1300 ms) or cuts (360 ms: 180 ms to dark, `flyTo(…, true)` 4212, 180 ms back) when the zoom path
would take longer than 1800 ms; during a step the board's plan owns the camera (`tr.camB` 1100 ms,
the scene cuts of 5.2). No camera motion after the animation ends; no chase camera
(`setChase(false)`, 4135; `running` is false in Lesson). A user drag pauses Auto and is undone by
Next.

### 6.2 Spotlight and labels

While a beat is on, the board is dimmed (exposure 0.55, map §4.1) and the subjects are cut out of
the dark overlay (`drawSpot`, 6773, fed by `xpFocus`/the step's path). Chips in the spotlight get a
stage label "8288 · bus controller" from `INFO[id][0]` and `[1]` (board3d.js:210-296), at most three
per beat, placed by projecting `xpBox(id)` to the screen, 14 px (`.bv-lab` size, explain3d.js:57),
fading in over 250 ms. Label ids resolve as in 2.3 (`INFO[id] || INFO[id.replace(/\d+$/, '')]`,
`'cga'` → the video card's entry; no entry, no label). The caption never names a chip type number
that is not labelled on the stage at that beat (rule 3.5.4 says the same thing in the same words:
"labelled", not "lit" — a chip in the spotlight without one of the three labels does not license its
number). Numbers on the stage are coloured like their wire (`BUS_COLOR`:
address cyan, command magenta, data gold, theme.js:191-195) and so are the bold values in the
headline.

### 6.3 Unit stops

A stop is a unit visit that keeps its card in the journey: the token enters, the UnitFx drawing
plays on the die at one drawing px per screen px (`unitOverlay`/`paintUnit`/`unitZoom`,
board3d.js:7299-7339), the block glows to 1 (`blockGlow`, 7275), the tag shows the name and up to
three facts (`unitTag`, 7489), and the caption's kicker reads `chip · Unit` (`xpUnitText`, 6500).
The block card (`showCard`, 7508) exists in the DOM but is hidden in Lesson (`.ln-lesson .bv-card
{ display: none }`), and the covers are data (7.8) so it reserves no space; its `sub` sentence is
available to the writer as `cap: 'unit'` and in the details. A pass is a visit whose card the Stage
set to `null`: the block glows to 0.35 for the pass time (175 ms) and the token does not stop.

Which visits stop: the Stage's `limitStops(s, keep)` runs after `board.trJourney(s)` and before
`board.traceDur(s, ms)` in the same frame (`xpPlan` caches on `s._j._xp` by `ms`, `xpTime` and
viewport, 6337-6339, so the filter must precede the first plan). It walks `s._j.segs` and, for every
segment with `g.unit && g.card`, keeps the card if the segment's **remapped key** is in `keep`, else
sets `g.card = null`. The remap matters on every board but the 8086: `g.block` is the trace model's
own label (`v[0]` in `chipVisit`, board3d.js:6078: `REGISTERS`, `ADDRESS ADDER`, `DECODER`, `BUS
CONTROL`, `QUEUE`, `CACHE 8 KB`, …), and only `blkLabel(e, label)` (6088-6090) turns it into the die
block through `BLK_286/386/486/586/686` (857-882): `ADDRESS ADDER` → `LINEAR ADDER` on the 386, →
`SEGMENT UNIT` on the Pentium, → `LOAD UNIT` on the Pentium Pro; `DECODER` → `DECODERS`; `REGISTERS`
→ `RETIREMENT REGISTERS` on the P6. Both are public on `BoardView`, so no patch is needed: the
segment's key is

```js
const keyOf = g => `${g.dive.e.part}/${board.blkLabel(g.dive.e, g.block)}`;   // e.g. '80386/LINEAR ADDER'
```

and `keep` holds keys in the same post-remap `DIE_PLANS` spelling (the lesson's `stop` and `units`
keys, interface 6). A lesson written with the 8086 example in mind would pass on the 8086 (no remap)
and drop every card on the 80286+ — that is why the WP2 smoke test asserts, on the 80386 letter
program, that the Address calculation step with `keep = {'80386/LINEAR ADDER'}` keeps exactly one
card, and on the 80686 that a named stop keeps exactly one card. `xpUnitText` (6500) prints
`g.block`, the pre-remap name, so the kicker is built by the Stage from `LEARN_UNITS[keyOf(g)].title`
instead (`unitNow()`, 7.4). `keep` = the beat's `stop` keys ∪ the keys of the first and last unit
visits of the step (the source and the target), at most four in all. Filtering on `kind === 'dwell'`
is wrong: `trJourney` has already rewritten dwells to `kind: 'move', unit: true` (6280-6283). A beat
with `quick: true` passes `ms = 650` instead: one scene, quarter work, no passes. The checker's
`--json` dump prints every step's visit labels as the same remapped keys, so a writer copies them.

### 6.4 The caption card

Kicker 13 px mono (`8086 · ADDRESS ADDER`), headline 21 px / 1.35 in a three-line box (84 px),
details 15 px / 1.45 muted in a three-line box (63 px), the term line 12.5 px (two lines, 38 px).
Values in the headline are `<b>` in mono, coloured by wire. The card is `role="region"
aria-live="polite"`; the headline is announced on every beat. The card never resizes: a caption that
would overflow its box is a checker failure, not a scroll. A mid-lesson `check` beat uses the same
boxes: the kicker reads "Quick check", the question is the headline (≤ 80 characters, the same
rule), the three answers are the three 21-px rows of the details box (each ≤ 40 characters, as
buttons), and the why appears in the term line once an answer is chosen (two lines, ≤ 90 characters).
The end card is the one other state of the column (2.6); the Chrome assertion on stable rectangles
covers the caption card in both of its states and the end card's outer box.

### 6.5 Terms

The term line prints `LEARN_TERMS[t].short` (≤ 90 characters) on the beat that carries `terms: [t]`
the first time in this visit (`learn:terms`); later uses of the word in a headline or details are
dotted-underlined and open the glossary panel on click or `?`. The panel lists the current
caption's terms with `short` and `long`, and falls back to `BlockPanel.termTip(text, spec)`
(blocks.js:1705) for the words drawn on a unit. There are no term beats.

### 6.6 The screen

A `screen` beat cuts to `screenTL`; the 3D monitor mesh shows the CRT (`crtCanvas` = `crt.fullCanvas`
only while `stage.monitorLive`, crt.js:216) and the bytes the hide-and-reveal held back are put back
(`vget` before the instruction, `vset` at the beat, explain3d.js:140-154, 296-298). On the die
fallback the `CrtScreen` host itself is shown in the stage for the beat.

---

## 7 Architecture

### 7.1 The new entry and the build

`build.mjs` (CRLF, patched in place, +45 lines) gets a page table; `node build.mjs` alone still builds
the present page **byte for byte**, and the claim is checkable because nothing in the anatomy page's
inputs changes: its script list is the old `SCRIPTS` unchanged (`makeFont8x8` stays in disks.js for
that page; the learn page loads its own copy, `src/core/font8x8.js`, and never loads disks.js — the
duplicate-name rule of `tools/names.mjs` is per page), and the styles are joined with `''` (build.mjs:83
joins with `'\n'` today, which with one file adds nothing; with two files it would add one newline at
the seam), so `tokens.css` + the rest of `style.css` concatenate to the old bytes. `tokens.css` keeps
the bytes of the block it was cut from (style.css:1-188, CRLF): it is a moved block, not a new file,
and is the one exception to "new files LF" (brief constraints), noted here so no editor normalises
it. WP0 verifies with a diff of `dist/8086-anatomy.html` before and after; if the diff is ever not
empty, the gate becomes "identical after removing the `// ---- ` file markers", never "looks the same".

```js
// build.mjs — Usage: node build.mjs [--page anatomy|learn] [--out f] [--skip a.js,b.js] [--artifact]
const CORE = SCRIPTS.slice(0, SCRIPTS.indexOf('src/core/bios.js') + 2);        // asm, core, bios, vgabios (build.mjs:12-37)
const LEARN_UI = ['src/ui/theme.js', 'src/ui/audio.js', 'src/ui/crt.js', 'src/core/font8x8.js',   // font8x8 after crt.js: it reads CP437 (7.9)
  'src/ui/story.js', 'src/ui/blocks.js', 'src/ui/unitfx.js', 'src/ui/die.js', 'src/ui/board3d.js'];   // theme.js first (map §6.1); no editor, dock,
                                                                                 // disks, tips, sfx, timing, memmap, explain3d, topview, app
const LEARN = ['src/learn/content.js', 'src/learn/terms.js', 'src/learn/plan.js',
  'src/learn/lessons/programs-8086.js', 'src/learn/lessons/programs-later.js', 'src/learn/lessons/boards.js',
  'src/learn/lessons/l8086.js', 'src/learn/lessons/l80286.js', 'src/learn/lessons/l80386.js', 'src/learn/lessons/l80486.js',
  'src/learn/lessons/l80586.js', 'src/learn/lessons/l80686.js', 'src/learn/lessons/compare.js', 'src/learn/lessons/index.js',
  'src/learn/playback.js', 'src/learn/facade.js', 'src/learn/stage.js', 'src/learn/caption.js', 'src/learn/player.js',
  'src/learn/regs.js', 'src/learn/explore.js', 'src/learn/outline.js', 'src/learn/shell.js'];
const PAGES = {
  anatomy: { entry: 'src/index.html', styles: ['src/ui/tokens.css', 'src/ui/style.css'], scripts: SCRIPTS, out: 'dist/8086-anatomy.html' },
  learn:   { entry: 'src/learn/learn.html', styles: ['src/ui/tokens.css', 'src/learn/learn.css'],
             scripts: [...CORE.filter(f => !/x86core|x86wasm|p6ooo/.test(f)), ...LEARN_UI, ...LEARN], out: 'dist/learn.html' },
};
const page = PAGES[argOf('--page') || 'anatomy'];
const css = page.styles.filter(exists).map(read).join('');                     // '' — see above
```

`SCRIPTS`/`STYLES`/`read('src/index.html')`/the default `out` (build.mjs:11-57, 75-88) become
`page.scripts/styles/entry/out`; `--skip` and `--artifact` stay. `tools/names.mjs` runs first and
fails the build on a duplicate top-level name in the page being built (map §7 risk 9). `pages.yml:28`
becomes two lines: `node build.mjs --page learn --out _site/index.html` and `node build.mjs --out
_site/workbench.html` at M4 (until then `_site/learn.html` next to the present `index.html`). The
wasm cores are not in the learn page (no lesson calls `run()` without trace; 21 MB
`WebAssembly.Memory` per 386+ machine, map §1.3): the machine is built with `{ video, soundCard: false,
wasm: false }` plus the lesson's `options`. `Tips` and `Sfx` are not loaded (both act on the document
at parse, map §2.3). The learn page is ≈ 3.3 MB before gzip: ≈ 3.1 MB of the present build minus app,
explain3d, topview, timing, memmap, dock, disks, editor, tips, sfx and the wasm cores (map §6.1
sizes), plus the new code and data (≈ 7,000 lines, ≈ 250 KB) and the six board pictures of
`boards.js` (≤ 180 KB, 2.5); the acceptance bound is 3.5 MB (10.4).

`learn.html` (≈ 130 lines, LF) carries the head of index.html:1-11 (charset, viewport, `<title>8086
Anatomy · Learn</title>`, description, `color-scheme`, theme-color, the favicon) with
`<style>/*STYLE*/</style>` and `<script>/*SCRIPT*/</script>` (index.html:11, 428), and these ids:
`ln-top ln-stage ln-col ln-place ln-dots ln-prog ln-cap ln-kicker ln-head ln-more ln-terms ln-back
ln-next ln-auto ln-again ln-outline ln-drawer ln-machines ln-first ln-explore ln-regs ln-crt ln-live`.
`window.__learn = { shell, play, stage, player, lesson }` is the tools' surface (the analogue of
`window.__app`, app.js:1583).

### 7.2 The module list

| File | Lines (est.) | Role | Reuses (map / code) | WP |
|---|---|---|---|---|
| `src/learn/learn.html` | 130 | the entry (7.1) | index.html head | WP0 |
| `src/learn/learn.css` | 380 | the layout of section 2, the drawer, the chooser, the end card's box, the phone rule, `.bv-top,.bv-pop,.bv-focus,.bv-hint{display:none}`, `.ln-lesson .bv-card{display:none}`, reduced-motion rules; the caption card's and the registers strip's own rules are **not** here (each module injects its own `<style id="ln-cap-style">` / `<style id="ln-regs-style">`, as blocks.js and die.js do, so WP3 and WP8 never edit this file) | `tokens.css`; `.btn .card* .tip .crt .sr-only kbd` copied from style.css (map §1.4) | WP7 |
| `src/ui/tokens.css` | 188 | style.css:1-188 cut out verbatim, bytes kept (CRLF; 7.1) | map §2.5 | WP0 |
| `src/core/font8x8.js` | 32 | a copy of `makeFont8x8` (disks.js:400-431: the comment and the function, **not** 432-436, `cp437Inverse`/`CP437_INVERSE`, which `DiskPanel` still uses to save text); disks.js is not edited (7.9); browser-only (reads `CP437` from crt.js and `document`), stubbed in Node | disks.js | WP0 |
| `src/learn/playback.js` | 580 | the engine of map §3.3 extracted from app.js (7.3): + `runTo` (sliced), `waitKey`, the `enter` option, the instruction bound per slice | app.js:4-30, 112-131, 133-151, 389-398, 499-655, 1081-1155, 1197-1307, 1316-1499, 1542-1578 | WP1 |
| `src/learn/facade.js` | 110 | `makeFacade(stage)` → `{ api, emit }` (7.4); the `runnerShim`; `window.__app` shim | map §2.2, §2.8 | WP2 |
| `src/learn/stage.js` | 380 | `LearnStage`: host, BoardView or DieView, the one rAF loop, resize, `ring`, `focus/labels/cut`, `limitStops` (remapped keys), `durOf/showStep`, `screen(on)`, covers as data, the frame-time watchdog, `webglcontextlost` | board3d.js ⟨xp⟩ surface (map §4.4), die.js:168-190, 238-249, 1030-1058 | WP2 |
| `src/learn/plan.js` | 360 | `LearnPlan`: selectors (3.3, with the derived `sub`/tails), `order` (the port of `plan`, explain3d.js:335-389), `compile` (a lesson → CompiledBeat[]), `fill` (templates), `caption` rules (407-441 as filters for `'story'` captions, + the 8-bit register filter), `validate`, `readMs`, `LN_PACE`; pure, Node-loadable | explain3d.js, theme.js:349-354 | WP3 |
| `src/learn/player.js` | 480 | `LessonPlayer`: the beat engine (`next back go auto again hold wait`), `load()`'s dry pass, the fold runner, the aside beat, rewind-by-rerun, hide-and-reveal, progress | explain3d.js:140-154, 477-524, 634-677, 719-777 (ideas; rewritten against Playback + Stage) | WP3 |
| `src/learn/caption.js` | 220 | `CaptionCard`: kicker, headline, details, term line, colours, the check UI (in the fixed boxes, 6.4), the end card (2.6), `aria-live`; injects its own style | theme.js:191-195; blocks.js:1705 via content | WP3 |
| `src/learn/content.js` | 700 (data) | `LEARN_UNITS` keyed `'PART/LABEL'` → `{ die, title, short, long, why, aliases }` merged from `DIE*_INFO` (die.js:21-38, 1919-1942, 2781-2810, 4036-4060, 5266-5287, 6831-6854), the 85 `tcard` subs (board3d.js:1626-2082, extracted by `tools/content-merge.mjs`) and the `DIE*_3D` bridges inverted (die.js:41-47, 2812, 4061, 5289, 6856); `aliases` = the trace-model spellings that land on this block through `BLK_*` (7.6); `LearnContent.unit/term/chip/firstUse/gloss`; chips from `BoardKit.INFO` at run time | map §5.2, §5.3 | WP4 |
| `src/learn/terms.js` | 250 (data) | `LEARN_TERMS` (≈ 80 learner terms, `{ short, long, acronym }`), loaded after content.js; the writers' file: WP5 and WP6 add the terms their lessons need (rule 3.5.3) without touching content.js | map §5.3 | WP4 (seed), WP5, WP6 |
| `src/learn/lessons/programs-8086.js` | 90 | `LEARN_PROGRAMS_8086`: the 8 new 8086 programs of 4.7 | explain3d.js:11-18 | WP5 |
| `src/learn/lessons/programs-later.js` | 90 | `LEARN_PROGRAMS_LATER`: `letterP5 rtc shl32 sum2 pipe5 cd fadd pairs sum8` | explain3d.js:11-18 | WP6 |
| `src/learn/lessons/boards.js` | 6 lines (generated, ≤ 180 KB) | `LEARN_BOARDS`: six board pictures as WebP data URIs (2.5) | written by `tools/boardshots.mjs` | WP0 |
| `src/learn/lessons/l8086.js` | 650 (data) | 9 lessons | SAMPLES, the narratives of map §5.5 | WP5 |
| `src/learn/lessons/l80286.js … l80686.js` | 5 × 320-400 (data) | 31 lessons | SAMPLES headers, `CPUS` explain3d.js:23-37 | WP6 |
| `src/learn/lessons/compare.js` | 40 (generated) | `LEARN_COMPARE[lessonId][model] = { clocks, us, mhz, n }` | written by `tools/learn-check.mjs --compare` | WP10 |
| `src/learn/lessons/index.js` | 30 | `LEARN_LESSONS = { '8086': LESSONS_8086, … }` over the six fixed const names, `LEARN_PROGRAMS = Object.assign({}, LEARN_PROGRAMS_8086, LEARN_PROGRAMS_LATER)`, `learnLessonOf`; written in WP0 and never edited by a writer | — | WP0 |
| `src/learn/regs.js` | 160 | `RegsWidget`: registers that changed; injects its own style (the ~70 CSS lines of style.css:863-932) | dock.js `DOCK_REGS*` (3-6), `read/fmt/show/setReg/renderFlags/hot` (≈ 120 lines, map §1.4) | WP8 |
| `src/learn/explore.js` | 300 | `ExploreScreen` (2.7) | Playback trace API; `Disasm86` for line bytes | WP8 |
| `src/learn/outline.js` | 220 | the drawer, the machine chooser, the first visit, progress | index.html:25-60 menu lines | WP7 |
| `src/learn/shell.js` | 320 | `LearnShell`, `startLearn()`: boot order (map §3.1), routing (`?cpu= &lesson= &beat= &view=`), storage, keyboard (2.10), the hand-off record, `window.__learn` | theme.js `URL_PARAMS` | WP7 |
| `tools/launch.mjs` | 40 | the shared puppeteer launcher (`--no-sandbox` when `process.getuid() === 0`, swiftshader flags, `protocolTimeout` 900000) | map §6.5 | WP0 |
| `tools/names.mjs` | 60 | top-level names of a page's script list; exit 1 on a duplicate | map §7 risk 9 | WP0 |
| `tools/ids.mjs` | 120 | every glow id, decap key and `DIE_PLANS` label per model → `docs/rewrite/ids.md`, with both spellings per block (the trace models' labels and the plan's, through `BLK_*`) and the visit labels each trace model can emit per model (from `CPU_TRACE`, `P5/P6_CARDS`, `CACHE_CARD*`, `PAGE_CARD`, `PIC_IRQ_TRACE`, `FDC/SOUND_CARD`); the labels with no die id | board3d.js:210-296, 733-882, 1626-2082; die.js `DIE*_3D` | WP0 |
| `tools/boardshots.mjs` | 80 | renders the six boards at `overview` on the old page and writes `boards.js` | shot.mjs launch | WP0 |
| `tools/beatprobe.mjs` | 120 | plans the letter program's steps on the old page with a given `xpTime`; prints lead, stops, passes, cuts, `Tm` per step | xpfilm.mjs:31-43 virtual clock | WP2 |
| `tools/learn-smoke.mjs` | 120 | the Chrome smoke of 7.7 (rendered frame, a `dive`, one card kept on the 80386 and the 80686, resize, hover); its own file so WP2 owns it | uxshots skeleton | WP2 |
| `tools/playback-parity.mjs` | 130 | the old page's `__app.traceNext()` records vs Node | shot.mjs launch | WP1 |
| `tools/content-merge.mjs` | 140 | run once: writes the first `content.js` (with `aliases` from the `BLK_*` tables) and the seed of `terms.js` from the three stores | — | WP4 |
| `tools/learn-check.mjs` | 380 | the Node checker (7.7) | tests/story.test.mjs loader (13-17), machine.test expected screens (70-110) | WP10 |
| `tools/learn-shots.mjs` | 240 | the full Chrome checker (7.7) | uxshots/xpmotion skeleton, blurprobe's clock | WP10 |
| `tests/playback.test.mjs` `tests/plan.test.mjs` `tests/lessons.test.mjs` | 200 / 100 / 60 | 7.7 and 10 | story.test loader | WP1, WP3, WP10 |
| `tests/fixtures/letter.8086.json` | hand-written first (WP3, week 1, from the Node measurement recipe of section 0), regenerated by `learn-check --dump` at M1 and after | the compiled beats and story steps of 8086-01-letter | — | WP3, then WP10 |

New code ≈ 4,300 lines, data ≈ 3,300, tools and tests ≈ 1,700. Old files edited: `build.mjs` (+45),
`board3d.js` (three patches, 7.8), `style.css` (−188, tokens out), `app.js` (+10, the hand-off and the
chip), `index.html` (+3), `pages.yml` (+1). Not edited: `src/core` (except the new file), `src/asm`,
`story.js`, `blocks.js`, `unitfx.js`, `die.js`, `disks.js`, `theme.js`, the tests.

### 7.3 The Playback engine (`src/learn/playback.js`)

Extraction rule: each method keeps its body from app.js and loses its DOM sinks, which become
events (map §3). Exact surface:

```js
class Playback {
  constructor(machine, { model, cpuAsm, video, tracePre = 'parallel', traceBurst = 'fold', traceRep = 'once',
                         reducedMotion = false, durOf = (s, ms) => ms })          // app.js:34-76; durOf replaces activeView.traceDur (645);
                                           // two arguments, as in interface 1: the Stage's own durOf(s, ms) reads stage.keep/stage.quick itself (7.4)
  traceRep: 'once' | 'all'                 // a plain field the shell switches per ring (2.7): Lesson sets 'all' — only the lesson's `repeat`
                                           // and `run` fold, the engine never folds a seen instruction on its own; Explore sets 'once' (the old
                                           // page's behaviour, isSeen 524, 1344-1348)
  on(name, cb) → () => void;  emit(name, ...args)                               // 112-131; listeners run in subscription order
  // program
  buildRom({ makeFont8x8, makeVgaFont }) → { rom, symbols, vgaRom }             // 133-151; machine.setRom(rom, r.symbols) — with the symbols, so
                                           // machine.biosSym is filled (machine.js:369-371; the machine.test recipe 43-45 passes none) — and setVgaRom
  assemble(src) → { ok, errors, bytes, origin, symbols, lineMap }               // 1081-1099
  load(program) → void                                                           // 1096-1098; addrLine Map (phys → line)
  boot({ disk = null, drive = 'A' } = {}) → void                                 // 1115-1146; the raw POST loop; emit('reset')
  runTo(where) → Promise<{ instrs, clocks }>   // NEW: raw cpu.step()+tickDevices until where = { instr: n } | { label } | { text } | { bios } | { ip }
                                           //      (text: Disasm86.decode at physIP; bios: 0xF0000 + machine.biosSym[name]); SLICED like ffFrame: ≤ sliceMs
                                           //      (12 ms) or sliceInstrs raw steps per frame, emit('ff', state) per slice, emit('fast', stats) every 120 ms
                                           //      of wall time, resolves when reached; rejects above 4 M clocks. Never synchronous: a 4 M-clock run on the
                                           //      P6 JS core would block the page for seconds. runToSync(where) exists for Node (the checker) only.
  waitKey() → boolean                      // NEW (3.2 wait beats): the raw loop of skipHalt bounded by sliceMs; true when physIP === 0xF0000 +
                                           //      biosSym.int09 or the BDA head (0040:001A) differs from its tail (0040:001C); timer wakes continue silently
  setBreakpoints(lines: Set<number>) → void;  lineOf(phys) → number              // 1103-1112, 1502-1505
  // one instruction
  beginInstr(now, { clockMs = null, manual = false, single = false, enter = true } = {}) → boolean
                                           // 1329-1373; emit('instr', events, info); false when halted with IF = 0, or when traceRep === 'once' and
                                           // startFF('loop') took over (never in the Lesson ring). `enter: false` skips the engine's own enterStep(0)
                                           // (app.js:1369): the player enters the first SHOWN step in the same frame, so a hidden Decode never appears
  dispatchUntil(t) → void                                                       // 1375-1386; emit('event', e, clockMs) per event; emit('caption', caption(e))
  finishInstr() → void                                                          // 1387-1402; emit('instrEnd', { play, text, regs, reason, nextPhys }) — nextPhys
                                           // is the return address a CALL/INT will come back to (1363); the player keeps it for `until: 'ret'`, because
                                           // startFF calls finishInstr first (548) and `play` is null (1391) when the fold begins
  stepInstr() stepClock()  skipHalt() → boolean  stuck() → boolean  pokeKeyboard()   // 1278-1307, 1316-1326, 1405-1417, 1542-1552
  // story
  buildStory(events, opt?) → Story                                              // 389: Story.build(events, opt || { prefetch: tracePre, burst: traceBurst })
  enterStep(i, { back = false, quick = false } = {}) → void                     // 638-655; ms = quick ? 650 : stepMs; p.animMs = durOf(s, ms) (same frame); emit('step', story, i, { ms: animMs, back, auto, quick })
  traceNext() tracePrev() traceGo(i) traceSkip()                                // 499-545, 623-637
  readMs(step) → ms;  get stepMs();  get tracing()                              // 393-398 (readMs kept for Explore)
  // fast paths
  startFF(why, until: (physIP, machine) => boolean) → void                      // 546-556; the predicate gets the machine too (for 'halt'); emit('ff', state)
  ffFrame() → void;  ffStop(reason) → void                                      // 557-611; a slice ends at sliceMs of wall time (559-560) OR after sliceInstrs raw
                                           // steps (NEW: under the tools' constant virtual clock the ms bound never fires, map §6.5, so the checker counts
                                           // instructions); emit('ff', state) per slice, emit('fast', machine.takeStats()) every 120 ms of wall time (NEW:
                                           // the views' steady glow, board3d.js:3925), emit('ffEnd', { reason, n, loops })
  fastFrame(dt) → void                                                          // 1460-1499; emit('audio', spk, snd); emit('fast', stats)
  // frame
  tick(vnow, vdt, realDt) → void                                                // 1420-1436 minus crt/disks/views
  explainFrame(vnow) → void                                                     // 1437-1459
  // speed (Explore and Workbench)
  speedAt(pos) setSpeedPos(pos) setMotion(i) start() pause() toggleRun()        // 1197-1277; emit('speed'), emit('mode')
  // helpers and state (names unchanged)
  codeMask() codeOpts() linPhys(lin) codePhys(ip, base) codeByte(ip, i) isSeen(phys)   // 519-524
  play ff running mode spd speedPos speedIdx seen traceCount lastTraced addrLine program bootMode bootDrive
}
function caption(e) → string | null                                            // app.js:1556-1578, pure (the name is free once app.js is out)
```

Events (complete; the fan-out order is fixed): `reset` · `instr(events, info)` · `event(e, clockMs)`
(the Stage subscribes `regs.event` before the views, app.js:1381-1382) · `caption(text)` ·
`step(story, i, info)` · `instrEnd(x)` · `ff(state)` · `ffEnd(x)` · `fast(stats)` · `audio(spk, snd)` ·
`speed` · `mode` · `traceClear` · `status(text, cls)` · `announce(text)`. Globals Playback needs
(map §2.4): `Asm86 Disasm86 biosSource Machine* Story PROG_SEG AnimClock animNow splitLead clamp
hex2 hex4 hex5 CPU_HZ`; `SPEEDS TRACE_MS MOTION` move with it. The `quick` flag replaces Explain's
mutation of `spd.stepMs` (explain3d.js:395-398). WP1's Node test (`tests/playback.test.mjs`) asserts
the three new behaviours by name: `beginInstr(now, { enter: false })` emits `instr` and no `step`; a
seen instruction under `traceRep: 'all'` is traced again (the fall-through JNZ of `stars` after four
passes gets a story), and under `'once'` returns false; and for the letter program on all six models
the traced run and the untraced re-run (`runToSync({ instr: k })`) to every instruction k give equal
registers, cache tags and states, and BTB entries (5.3).

### 7.4 The BoardView facade and the Stage (`facade.js`, `stage.js`)

Every member, verified against the readers in map §2.2:

```js
function makeFacade(stage) {
  const { machine, play, crt } = stage, handlers = {};
  const emit = (name, arg) => { for (const cb of handlers[name] || []) cb(arg); };
  const api = {
    machine,                                                      // the real Machine, read every frame (map §7 risk 7)
    get model() { return CPU_MODEL; },                            // die.js:170-190 picks the subclass
    get video() { return VIDEO_CARD; },                           // unread by views (map §2.2); kept for symmetry
    get reducedMotion() { return stage.reduced; },                // read once in constructors
    get mode() { return 'explain'; },                             // never 'fast' on this page
    get running() { return false; },                              // never true: no chase camera (board3d.js:4135-4196); folds use ff, not running
    get clock() { return 0; },                                    // no manual clocking
    get tracing() { return play.tracing; },                       // board3d.js:3868 skips live signals while a story plays
    get motion() { return AnimClock.scale; },
    get stepMs() { return play.stepMs; },                         // the member the old api lacked (board3d.js:7038, 7041, 7075; map §7 risk 5)
    get crtCanvas() { return stage.monitorLive && crt ? crt.fullCanvas : null; },   // only during screen beats (crt.js:216)
    get crtVersion() { return crt ? crt.version : 0; },
    select: (kind, id) => emit('select', { kind, id }),           // board3d.js:2126 listens for 'chip'; die.js:1037 emits 'block'
    view: name => (name === 'runner' ? stage.runnerShim : name === 'board' ? stage.board : name === 'die' ? stage.die : null),
    on: (name, cb) => { (handlers[name] = handlers[name] || []).push(cb); },   // 'follow' | 'select' | 'mode' | 'reset'
  };
  return { api, emit };
}
// dieKit reads only this.board and the closure's T/lerp (board3d.js:8182-8198): a shim with a fake `this` is enough
stage.runnerShim = { dieKit: e => RunnerView.prototype.dieKit.call({ board: stage.board }, e) };
// the two guarded back-doors: board3d.js:1954-1955 (cache card bytes), 2180 (pop button); die.js:1279-1287 (focusChip)
window.__app = { machine, views: { board: stage.board }, selectTab: id => shell.go(id === 'die' ? 'explore' : 'lesson') };
```

```js
class LearnStage {
  constructor(host, { machine, play, crt, reducedMotion, webgl = true })
  // host: a positioned non-zero box. Builds BoardView (or DieView when !webgl, width < 900, board.ok === false after
  // construction, or learn:view === 'die'); hides the chrome by CSS; setChase(false); subscribes play events in the
  // fixed order; installs Playback.durOf = (s, ms) => this.durOf(s, ms, this.keep) (interface 1 stays two-argument);
  // then ring('lesson'). Listens for 'webglcontextlost' on the canvas (BoardView has none, map §7 risk 6): on it the
  // Stage switches to die mode with a one-line note on the card ("The display lost its 3D context; the simple view is on").
  mode: 'board' | 'die';  ring: 'lesson' | 'explore';  board, die, api, emit, reduced, monitorLive = false, runnerShim
  keep: Set<string> | null;  quick: boolean   // set by the player before each beat's beginInstr/enterStep (7.5 rule 1); read by durOf
  ring(name)                           // the two states of the same stage (2.7). 'lesson': board.xpSet({ shots: true, spot: true }) (6663),
                                       // host.classList.add('ln-lesson') (hides .bv-card), board.covers = { left: 0, right: 0, top: 0, bottom: 0 } (7.8),
                                       // durOf = limitStops then traceDur, play.traceRep = 'all'. 'explore': board.xpSet(null), the class removed,
                                       // board.covers = null (the board measures the visible card again, trCover 7224-7229, so the trace camera and
                                       // the token never sit under it), durOf = board.traceDur(s, ms) unfiltered (every unit stops), play.traceRep =
                                       // 'once', play.setSpeedPos(20). Either way: board.traceStep(null) on the switch (nothing half-shown)
  ready() → Promise<void>              // resolves at the first rendered frame (bd.renderer.info.render.frame > 0); beat 1 waits for it (2.2)
  start() / stop()                     // the ONE rAF loop: dt = min(100, now - last); vnow = animNow(); vdt = dt * AnimClock.scale;
                                       // play.tick(vnow, vdt, dt); crt && crt.frame(now); active.frame(vnow, vdt)   (app.js:1420-1436);
                                       // the watchdog: median of the active.frame() durations over 3 s > 80 ms → emit('slow') once (2.9)
  resize()                             // ResizeObserver on host → active.resize()
  show() / hide()
  focus(ids, o) → Promise<void>        // look beats: xpFocus / applyPreset / dieEntry, cut-or-move by xpCutMs (6479); die mode: DieView.select
  labels(ids)                          // ≤ 3 stage labels, projected from xpBox(id); id → INFO[id] || INFO[id.replace(/\d+$/, '')] (INFO is keyed
                                       // lat/xcv/dec, not lat0/xcv1), 'cga' → the video card's INFO entry; unresolved: no label (2.3)
  durOf(s, ms, keep) → ms              // board: limitStops(s, keep) then board.traceDur(s, quick ? 650 : ms); die mode: min(ms, LN_PACE.dieAnimMs)
  limitStops(s, keep)                  // 6.3: j = board.trJourney(s); for g of j.segs: if (g.unit && g.card && !keep.has(keyOf(g))) g.card = null,
                                       // keyOf = g => `${g.dive.e.part}/${board.blkLabel(g.dive.e, g.block)}` (the post-remap DIE_PLANS key, 6088-6090)
  showStep(story, i, info)             // the only caller of traceStep: board.traceStep(story, i, info) (info.finish from the player, patch C);
                                       // die mode: die.traceStep if it exists (Die686View, die.js:7759), else dieUnit(first stop) + the step's events
                                       // through die.event(e) (die.js:295) for anim = min(ms, dieAnimMs) (2.9)
  clear()                              // board.traceStep(null) (≡ traceClear, 7088)
  screen(on)                           // monitorLive = on (crtCanvas read); die mode: shows the CrtScreen host in the stage
  unitNow() → { chip, unit, text, key } | null   // board.xpNowUnit() (6522) → key = keyOf(g); unit = LEARN_UNITS[key].title (xpUnitText, 6500, prints the
                                       // pre-remap g.block, so it is used only for `text`, the card's sub)
  dieUnit(key) → boolean               // 'PART/LABEL' → LEARN_UNITS[key].die → DieView.select(id, els.blocks[id], true)
  setReducedMotion(on)
}
```

The Stage asserts once at start that nothing inside `bd.root` matches `.xp3-prog, .xp3-bar` and that
no element is named `trace` or `monitor` in the document (so `xpCovers`/`trCover` measure nothing
but the card, 7208-7238); in the Lesson ring it sets `board.covers = { left: 0, right: 0, top: 0,
bottom: 0 }` (7.8) so the hidden card cannot reserve its 324 px (`cardEl.offsetWidth || 300` + 24,
7229), and in Explore it sets `covers = null` so the visible card is measured. The facade's `running`
is false in both rings: Explore's Play (key A) is the story's auto-advance (`play.auto`), never
`start()`, so the chase camera (board3d.js:4135-4196) never runs on this page.

### 7.5 The lesson player (`plan.js`, `player.js`, `caption.js`)

`LearnPlan` (pure; reads `CPU_MODEL` for the line size as explain3d.js:337 did):

```js
const LearnPlan = {
  select(step) → string[]                       // every selector the step matches (3.3), most specific last
  match(selector, step) → boolean               // '*' and missing tails
  order(steps, { lineBytes, a0, a1 }) → [{ i, quick, cap? }]   // the port of plan(k, steps), explain3d.js:335-389: this instruction's fetches before Decode; a line fill = one full cycle + one quick beat
  compile(lesson, k, story, ctx) → CompiledBeat[]              // one step beat → beats: show entries (chained phases as one) in story-step order, the folded rest (split at animCap), the screen beat if the instruction writes vram
  validate(lesson) → Finding[]                  // interface 3: the schema, the program key, the selectors' shape, the units' keys
  fill(text, ctx) → string                      // the templates of 3.4; throws on an unfilled {…} (the checker catches it)
  caption(step, mode) → { h, d }                // 'story' | 'unit' captions with the rewrite filters of explain3d.js:407-441 (µop ids, absolute clocks, the Decode "why")
                                                // plus two of this design's: an 8-bit register write prints that register ("AL gets 41h", not the core's
                                                // reg{AX} line, 3.4), and the P6's µop/RAT/ROB sentences of the inside step are kept as the details
                                                // while the headline is the step's `sum`
  readMs(cap, opened) → ms                      // LN_PACE
  pace(beat, plan) → { anim, hold }             // the Node model of a beat's time (lead + stops + legs / PX + cuts)
};
// CompiledBeat = { kind: 'look'|'say'|'step'|'run'|'wait'|'screen'|'check'|'end', src, k (instruction index), steps: [i…],
//                  quick, keep: Set<label>, cap: { h, d, kicker, terms }, focus, labels, cam, hold, ms }
```

`LessonPlayer` (owns no DOM; the shell provides `ui`):

```js
class LessonPlayer {
  constructor({ play, stage, content, ui })
  // ui = { caption(view), progress(i, n), state({ paused, auto, waiting, canBack, done }), check(q, onAnswer), end(summary, doors), announce(text) }
  load(lesson) → Promise<void>          // program (LEARN_PROGRAMS or SAMPLES) → play.assemble → play.load → play.boot() → await play.runTo(lesson.from)
                                        // (the card shows "Running to the lesson's start…" meanwhile) → the DRY PASS → play.boot() + runTo(from) again
  rerunTo(k) → Promise<void>            // play.boot() + play.runTo({ instr: k }) with the views' reset(); Back across instructions and Explore's "‹ Lesson"
  next(now) back() go(i) auto(on) again() togglePause() setSpeed(v) key(e) stop()
  frame(now)                            // called by the Stage every frame: ends beats (Auto), reveals the screen, drives the fold and wait slices
  get state() → { lesson, beat, i, n, waiting, paused, auto, done }
}
```

The dry pass: beats cannot be compiled lazily per instruction, because the folded rest splits at
`animCap`, asides appear, and the place strip must show a fixed n from beat 1 (principle 4). So
`load()` runs the whole lesson once without views after `runTo(from)`: trace on, `Story.build` per
instruction with the lesson's options, `keys[0]` typed at `wait` beats, `run` folds executed with
`runToSync`, every story recorded and every beat compiled (folds split, asides included, the screen
beat placed), then the machine is re-run to `from` (`boot()` + `runTo(from)`, the same deterministic
re-run as Back). A lesson traces ≤ 300 instructions, so the pass is tens of milliseconds
(tests/story.test.mjs builds 87,979 stories in under 10 s, emulation included, map §6.4); the stories
are kept and reused as the
fixture's `stories` (interface 12), and n = the compiled beats never changes while playing. The
Chrome checker asserts that the fixture's `beats.length` equals the n shown in the place strip.

The beat engine's rules: (1) a `step` beat sets `stage.keep = beat.keep` and `stage.quick =
beat.quick`, then calls `play.beginInstr(now, { enter: false })` — no `enterStep(0)` is made by the
engine (app.js:1369) — and enters the first shown step itself in the same frame with `enterStep(i, {
quick })`, then the other shown steps in story-step order; a chained selector enters its steps one
after another, each when the previous `animMs` has elapsed (or at once on Next); hidden steps are
dispatched by `dispatchUntil(s.t)` without a beat; the instruction ends with `finishInstr()`. A
`beginInstr` that returns false in the Lesson ring is a player error (the ring sets `traceRep: 'all'`,
7.3), and the checker fails a `step` beat whose dry-pass `beginInstr` returned false. (2) Next
mid-animation: the player advances to the next beat at once and passes `finish: true` in the next
step's `info`; with patch C (7.8) `traceStep` treats it as a replay and puts the previous step in its
end state (the token at its destination, the drawing at `u = 1`, board3d.js:7046-7055) before the new
flow starts; on the last step of an instruction the player calls `finishInstr()` first, and the
board's `instr()` of the next instruction clears the trace. The double-Next guard (250 ms) is the only
wait. (3) Back inside an instruction: `enterStep(i − 1, { back: true })`; across an instruction:
`rerunTo(k)`, then the beat plays again, or "Back to the start of this lesson" when the lesson's
re-run figure exceeds `backBudgetMs` (5.3). (4) The unplanned interrupt: when `beginInstr` yields a
decode text `INTR xxh` and the compiled beat has no `irq` selector, the player inserts the aside beat
and a `startFF('skip', ip => ip === interrupted)`, where `interrupted` is the `physIP` before the INTR
step (the handler may run nested INTs, so "the next IRET" and "the program segment" are both wrong
targets). (5) `run` beats: the player records `nextPhys` from every `instrEnd` for `until: 'ret'`;
`startFF(why, until)`, then `ffFrame()` per frame (its slice bounded by `sliceMs` and `sliceInstrs`)
for ≤ `foldWallMs`; on `ffEnd` the caption fills its templates. (6) `wait: 'key'`: `skipHalt()` is not
called and the halted CPU is never stepped through `machine.step()` with a trace (2.4 M calls per
emulated second, 3.2); the frame loop calls `play.waitKey()` each frame until it returns true, or Auto
types `keys[0]` via `CrtScreen.typeText` after 8 s and says so. (7) The screen beat: `vget(16)` before
the writing instruction, `vset(before)` after it, `vset(now)` at the beat (explain3d.js:140-154). (8)
Progress: `learn:at = { cpu, lesson, beat }`, `learn:done:<model>`, `learn:terms` after every beat,
through `storage`.

`CaptionCard` renders `{ kicker, h, d, terms }`, fills templates through `LearnPlan.fill` at render
time (the machine is at the step), bolds nothing by itself, colours `<b>` values by the step's token
colour, prints the term line, shows the check (three buttons, the why, no lock on Next) and the end
card (summary, check, three doors, the compare line).

### 7.6 The content module (`content.js`)

```js
const LEARN_UNITS = {                    // key 'PART/LABEL' in exact DIE_PLANS spelling (board3d.js:733-856; P5 814, P6 824)
  '8086/QUEUE': { die: 'queue', title: 'Instruction queue',
    short: 'Holds up to 6 bytes fetched ahead.',                             // ≤ 60 chars: the tag's and the kicker's text
    long: 'The BIU prefetches up to 6 bytes while the EU executes. It fetches a word from an even address. A jump flushes the queue and the prefetched bytes are lost.',   // DIE_INFO.queue (die.js:21-38), verbatim
    why: 'Fetching ahead keeps the execution unit busy: the bus is slow, the execution unit is not.' },   // new: the learner's why (map §5.6 gap 8)
  '8086/ADDRESS ADDER': { die: 'sigma', title: 'Address adder',
    short: 'CS × 16 plus the offset gives the 20-bit address.',                // the tcard sub (board3d.js:1626-2082)
    long: 'Adds a segment register shifted left by four to a 16-bit offset. The 20-bit sum goes to the address pins.',   // written from DIE_INFO.sigma
    why: 'Sixteen-bit registers can name 64 KB; the shift lets them reach 1 MB.' },
  '80586/BRANCH TARGET BUFFER': { die: 'btb', title: 'Branch target buffer',
    short: 'Remembers where 256 jumps went last time.',
    long: 'A 64-set, 4-way table of jump addresses with a 2-bit counter each. A hit steers the prefetch before the jump executes.',   // written from DIE586_INFO.btb
    why: 'Guessing lets the pipes keep filling; a wrong guess costs the pipeline three or four clocks.' },
  '4164/CELL ARRAY': { die: null, title: 'Cell array',
    short: '65,536 capacitors in 256 rows and 256 columns.',
    long: 'One bit per capacitor. A row is opened by RAS, a column chosen by CAS; reading a row refreshes it.',
    why: 'A capacitor is the smallest thing that can hold a bit, so this is the cheapest memory.' },
};
const LEARN_TERMS = {                    // ≈ 80 entries; short ≤ 90 chars; acronym: the letters rule 3.5.6 guards
  bus: { short: 'Wires shared by every chip; one chip talks at a time, the others listen or stay quiet.',
         long: 'Address wires say where, data wires carry the value, control wires say read or write and when. On this board the 8288 makes the control signals.', acronym: null },
  'segment register': { short: 'A register whose value × 16 is the start of a 64 KB window into the 1 MB memory.',
         long: 'CS is for code, DS for data, SS for the stack, ES for extra. An address is always segment × 16 + offset.', acronym: null },
  queue: { short: 'Up to 6 bytes the CPU fetched ahead, so it rarely waits for the bus.',
         long: 'The bus interface unit fills it whenever the bus is free; a jump throws its contents away.', acronym: null },
  BIU: { short: 'The bus interface unit: the part of the CPU that fetches code and talks to the board.',
         long: 'It owns the address adder, the segment registers, the queue and the bus control logic.', acronym: 'BIU' },
};
const LearnContent = {
  unit(key) → LEARN_UNITS[key] | null,  term(word) → LEARN_TERMS[word] | null,
  chip(id) → BoardKit.INFO[id] | null,   // the 68 tooltips at run time, never copied
  firstUse(text, seen: Set) → string[],  // the terms of LEARN_TERMS that appear in text and are not in seen
  gloss(text, spec) → BlockPanel.termTip(text, spec),   // blocks.js:1705 for the drawn words
};
```

Every entry also carries `aliases`: the trace-model spellings that land on this block through the
`BLK_*` tables (board3d.js:857-882), written by `tools/content-merge.mjs` from those tables — e.g.
`'80386/LINEAR ADDER': { …, aliases: ['ADDRESS ADDER', 'PHYSICAL ADDER', 'OFFSET ADDER'] }`, `'80686/
RETIREMENT REGISTERS': { …, aliases: ['REGISTERS', 'SEGMENT REGS', 'SEGMENT CACHES'] }` — so the
`--json` dump and `ids.md` can print both spellings and a writer who knows a unit by its 8086 name
finds the key. The key itself is always the plan's spelling: `limitStops` compares post-remap keys
(6.3).

`tools/content-merge.mjs` writes the first version once (regex over board3d.js:1626-2082 for the
`tcard(kind, title, chip, sub, …)` calls, the `DIE*_INFO` tables, the `DIE*_3D` bridges, the `BLK_*`
tables for `aliases`); the output is committed and edited by hand afterwards. The Chrome checker
validates every key against `BoardKit.DIE_PLANS[part].b` labels (the key side is already in plan
spelling; the segment side is remapped by `blkLabel`, 6.3); `tools/ids.mjs` lists the labels with no
die id and, per model, the visit labels the trace models can emit (from `CPU_TRACE`, `P5_CARDS`,
`P6_CARDS`, `CACHE_CARD*`, `PAGE_CARD`, `PIC_IRQ_TRACE`, the device cards); the Node checker fails a
lesson whose `units` or `stop` name a label with no die id (the phone fallback could not select it)
or a key that no step of the lesson visits (the stop would silently produce nothing, 7.7).

### 7.7 The checker scripts

**Node** — `node tools/learn-check.mjs [--model M] [--lesson id] [--pace] [--json out] [--dump id] [--compare]`:
for each model a fresh `vm.createContext` (because `CPU_MODEL` is frozen per context) loads the
story.test.mjs file list (13-17) **without** its `var CPU_MODEL` line, with
`globalThis.localStorage = { getItem: k => k === 'a86:cpu' ? JSON.stringify(MODEL) : k === 'a86:video' ? '"cga"' : null, setItem() {} }`
and `globalThis.document = { documentElement: { classList: { add() {} } } }` before `theme.js`
(theme.js:162 declares `const CPU_MODEL`; 168-182 call `classList.add` unguarded), then `story.js`,
`content.js`, `terms.js`, `plan.js`, `lessons/*`, `playback.js`, `font8x8.js` stubbed. For every
lesson of the model it checks, in order: (1) `names` — no duplicate top-level names in the page's
list; (2) `program` — the `program` key exists in `LEARN_PROGRAMS` and assembles with the model's
`cpuAsm`, or the `SAMPLES` id exists and is allowed on the model (app.js:252-253); (3) `boot` — the
hand-off state of map §3.2 (`CS = DS = ES = SS = 1000h, IP = 0100h`), `runToSync(from)` reaches its
target, and its instructions and clocks are **printed** per lesson and fail above 4 M clocks or 2 s
of Node time (the `ooo` and `rename` slices are the ones to watch); the same figure decides the
lesson's Back mode (5.3); (4) `beats` — the dry pass of 7.5 for each `step` beat: the story,
`LearnPlan.order` non-empty, **every `at` selector matches at least one step (else fail; an unmatched
`hide` warns)**, `beginInstr` returned true, the `show` order equals the story-step order (else warn),
every `stop` and `units` key exists in `LEARN_UNITS` **and** equals the remapped key
(`part/blkLabel(e, label)`, 6.3) of a visit some step of the lesson makes (else fail: the stop would
stop nothing), every caption after `fill` has a headline ≤ 80 with ≤ 2 `<b>` and details ≤ 220, no
`{…}` left, no `0x`, the number rule with `plain`, the part-number rule against the beat's labels,
the acronym-before-term rule, the term count, `check.answer` in range, `check.from` resolvable, and
for a `check` with `measured: true` the answer recomputed from the machine (a count of `btb` steps, a
digit of the screen, a clock sum, the pairing from the `pipe` events) equals `options[answer]`'s
number; a fixed-answer check about machine behaviour without `measured` or `from` is a failure; (5)
`screen` — after the lesson's beats and a fast run to the end, the text screen matches
tests/machine.test.mjs:70-110 for a `SAMPLES` lesson, or the program's own expected text for a new
program (`LEARN_PROGRAMS[x].expect`); (6) `pace` (`--pace`) — the 5.3 model; beats over 6 s and
`minutes` off by > 40 % are failures; (7) `--json` writes `dist/learn-beats.json`: per lesson the
compiled beats with captions, and per story step its array position `i`, kind, title, the selectors
it matches, **the kinds in `s.evs`** (so a writer copies `inside:Decode:pipe` or `inside:*:rat`), and
**its visit labels as remapped keys** (so a writer copies `'80686/RAT'`), as the writers' review
artifact and the Chrome checker's input; `--dump 8086-01-letter` writes
`tests/fixtures/letter.8086.json`; `--compare` writes `lessons/compare.js` from the clocks of every
lesson 1 on every model; `--titles` prints the set of titles seen over all six models, from which the
frozen title list of 3.3 was seeded and against which it is asserted. `tests/lessons.test.mjs` runs
it for all six models and fails on any finding; budget < 30 s (Story.build on ≤ 300 instructions per
model; a boot is 48-194 ms).

**Chrome** — `node tools/learn-shots.mjs [--model M] [--lesson id] [--beats 3] [--reduced] [--nowebgl] [--phone] [--throttle 4]`
(the smoke lives in `tools/learn-smoke.mjs`, WP2): `tools/launch.mjs`, blurprobe's clock variant
(`performance.now()` advances with real time inside a frame callback, so the `sliceMs` bound and the
pace numbers of `run` beats can be measured; xpfilm's constant clock would run a whole fold in one
virtual frame, map §6.5), seeds `a86:cpu`, loads `dist/learn.html?cpu=M&lesson=id&nofirst=1`, waits
for `__learn.stage.ready()`; then validates every `LEARN_UNITS` key of the model against
`BoardKit.DIE_PLANS` and every `focus` id against `bd.xpBox(id) !== null`; asserts that the place
strip's n equals the fixture's `beats.length`; steps every beat with `__learn.player.next()` +
`__vt.step(dur)` and asserts per beat: the headline in `#ln-head` equals `learn-beats.json`; for a
step beat `bd.tr` is non-null and `bd.tr.i` equals the expected **array position** in `story.steps`
(not `s.i`, 3.3); the token's screen position is inside the stage host; the camera moved at most once
(`bd.cam.flight` transitions and `tr.camB` counted); the animation ended within `animCap` of virtual
time; the caption card's and controls' bounding boxes did not change since the first beat (the check
beat and the end card in their own states, 6.4); no `pageerror`; `performance.memory.usedJSHeapSize` <
600 MB at the end. `--nowebgl` and `--throttle 4` run the same lesson in die mode and under CPU
throttling (the watchdog of 2.9 must offer the simple view under `--throttle 4` with swiftshader).
`tools/learn-smoke.mjs`: a rendered frame (`bd.renderer.info.render.frame > 0`), a traced step whose
`bd.tr.segs` has a `dive` (the runner shim works), `s._ms !== undefined` on every step, on the 80386
letter program the Address calculation step with `keep = {'80386/LINEAR ADDER'}` keeps exactly one
card and on the 80686 a named stop keeps exactly one card (the remap of 6.3), a hover over the CPU
(`stateOf`, board3d.js:4624). Three screenshots per lesson (a look, a stop, the screen beat) at
1280 × 720, about 8 s each (map §6.5): one lesson ≈ 40 s, the 8086 course ≈ 6 min, run before a merge.

### 7.8 The three patches to board3d.js (CRLF kept; each under 15 lines)

**Patch A — `xpTime.pass` and `xpTime.cut`** (visual §8.1 a, extended). In `xpPlan`:
line 6338 the cache key gains `|${U.pass}|${U.cut}`; line 6382 becomes
`PASS = quick ? 0 : XP_PASS * Math.sqrt(slow) * (U.pass === undefined ? 1 : U.pass)`; line 6385
`xpCutMs(scenes[k - 1].shot, S.shot, XP_CUT * slow * (U.cut === undefined ? 1 : U.cut))`; in `traceDur`
line 6318 the lead base `1200 * clamp(1 / (U.travel || 1), 0.6, 3)` gains `* (U.cut === undefined ? 1 : U.cut)`.
Old behaviour when the multipliers are undefined: identical (the old page never sets them).

**Patch B — covers as data** (interaction §6.2 change 2, visual §8.1 b). `xpCovers()` (7208) starts
with `if (this.covers) { this.xpTopPx = this.covers.top; return Object.assign({}, this.covers); }`;
`trCover(trace)` (7224) starts with `if (this.covers) return { left: this.covers.left, right: this.covers.right };`.
Unset `covers` keeps the old measurement.

**Patch C — finish the previous step on an early Next.** In `traceStep` (7032) the replay condition
at 7046, `const replay = this.tr && this.tr.story === story && (info.back || i !== this.tr.i + 1);`,
gains `|| info.finish`. With `finish: true` the ordinary next step (i === tr.i + 1) takes the replay
branch (7047-7055): `flowsClear()` and every earlier step put in its end state, which is what "Next
completes the animation" needs; without it only flows of a different bus cycle fade (7059-7061) and
the previous rider keeps animating beside the new one (7069-7071). The old page never passes `finish`.

Verification: the fast gate (map §6.4) and `tools/shot.mjs` on the old page before and after; the
old page never sets `xpTime.pass/cut`, `covers` or `info.finish`, so its output is unchanged.

### 7.9 Other edits to old files

`disks.js` is **not edited**: `src/core/font8x8.js` (LF) is a copy of `makeFont8x8` with its comment
(disks.js:400-431), not of 432-436 (`cp437Inverse` and `CP437_INVERSE()`, which `DiskPanel` uses to
save text files and which must stay). The function reads `CP437` (crt.js) and `document`, so the file
is browser-only despite its `core` path and is stubbed in Node; it is loaded only by the learn page,
after `crt.js` in `LEARN_UI` (7.1) — it is called at `buildRom` time only, so its position in the
list is otherwise free — and never together with disks.js, so the duplicate-name rule (per page) is
kept. `style.css`: lines 1-188 move to `src/ui/tokens.css` with their bytes (7.1). `app.js`
`loadInitialProgram` (1072-1080): read `a86:handoff`, delete it, load
its `src` into the editor with `sel.value = 'custom'` and the status "Program from lesson … — your own
program is in the Samples menu as 'Your program'", never writing `a86:src` until the person edits;
`ui()` adds the "‹ Lesson" chip when the record had `from: 'learn'`. `index.html`: the chip's
element in the top bar (3 lines). `pages.yml`: the second build line.

---

## 8 Interfaces between work packages (fixed first)

Written in WP0 as files that build and load, reviewed once, then frozen for v1. Nobody edits
another package's file without a line in `docs/rewrite/03-interfaces.md`.

| # | Interface | Shared by | Fixed shape |
|---|---|---|---|
| 1 | Playback methods and events | WP1 ↔ WP3, WP8 | section 7.3 verbatim; `durOf(s, ms) → ms` injected, two arguments (the Stage reads `stage.keep`/`stage.quick` itself); `beginInstr(now, { clockMs, manual, single, enter })`; `traceRep` a switchable field; `until(physIP, machine) → boolean`; `runTo(where) → Promise<{ instrs, clocks }>` sliced, `runToSync` for Node; `waitKey() → boolean`; `instrEnd` carries `nextPhys` |
| 2 | The facade members and the driver contract | WP2 ↔ WP1, WP3, WP8 | section 7.4: who calls `frame/resize/traceDur/traceStep`; `LearnStage` methods `ring ready focus labels durOf limitStops showStep clear screen unitNow dieUnit setReducedMotion start stop show hide resize`; fields `mode ring keep quick`; `ring('lesson' \| 'explore')` with the exact effects of 7.4; `emit('slow')` |
| 3 | The lesson schema, the selectors, the templates | WP3 ↔ WP5, WP6, WP10 | sections 3.2-3.4 as `docs/rewrite/lesson-schema.md` plus `LearnPlan.validate(lesson) → Finding[]` (the checker's validator, in plan.js) |
| 4 | `CompiledBeat` | WP3 ↔ WP7, WP10 | `{ kind, src, k, steps, quick, keep: Set, cap: { h, d, kicker, terms }, focus, labels, cam, hold, ms }` (7.5) |
| 5 | The `ui` callbacks of the player | WP3 ↔ WP7 | `{ caption(view), progress(i, n), state(st), check(q, onAnswer), end(summary, doors), announce(text) }`; `view = { kicker, h, d, terms: [{ term, short }], token: { col } }` |
| 6 | Content keys | WP4 ↔ WP5, WP6, WP2 | `'PART/LABEL'` in post-remap `DIE_PLANS` spelling (the key `limitStops` compares, 6.3); `LEARN_UNITS[key] = { die, title, short, long, why, aliases }`; `LEARN_TERMS[word] = { short, long, acronym }` in `terms.js`; `docs/rewrite/ids.md` from `tools/ids.mjs` with both spellings and the visit labels per model |
| 7 | The programs | WP5, WP6 ↔ WP10 | `LEARN_PROGRAMS_8086[key]` (programs-8086.js) and `LEARN_PROGRAMS_LATER[key]` (programs-later.js), merged by index.js into `LEARN_PROGRAMS[key] = { src, cpu, expect: RegExp \| null, keys?: [] }`; a lesson names a key as `program: { program: key }` (3.2) |
| 8 | `lessons/compare.js` | WP10 → WP7 | `LEARN_COMPARE[lessonId][model] = { clocks, us, mhz, n }` |
| 9 | The hand-off record | WP9 ↔ WP7 | `a86:handoff = { src, name, cpu, from: 'learn', lesson, beat }`, JSON, one-shot |
| 10 | URL and storage | WP7 ↔ WP8, WP10 | `learn.html?cpu=&lesson=&beat=&view=lesson\|outline\|explore\|machines&nofirst=1`; every learn key through theme.js `storage` (so `a86:learn:*` in `localStorage`): `learn:seen`, `learn:at = { cpu, lesson, beat }` (a different `cpu` offers a reload, 2.2), `learn:done:<model>`, `learn:terms`, `learn:auto`, `learn:speed`, `learn:autoDetails`, `learn:view` |
| 11 | The tools' surface | WP7 ↔ WP10 | `window.__learn = { shell, play, stage, player, lesson }`; `__vt` virtual clock (blurprobe's variant) |
| 12 | The fixture | WP3 ↔ WP7 | `tests/fixtures/letter.8086.json = { lesson, beats: CompiledBeat[], stories: [{ text, steps: [{ i, kind, title, phase, I: { kind, dev }, evs: [kinds], visits: [keys], token, text, sum }] }] }`; `i` is the array position in `story.steps` (`s.i` may differ under `'parallel'`, 3.3); `beats.length` is the n the place strip shows |

The fixture (12) is what lets WP3 (player, caption) and WP7 (shell) build and test without the
board or the machine (interaction M0 item 6): a stub `play` replays the stories, a stub `stage` logs.

---

## 9 Work packages

Five people: two engine/stage developers, one shell developer, one tools developer, one to two
writers; eight weeks. Files are disjoint; the frozen files of WP0 are the only shared ones.

| WP | Files owned | Depends on | Size | Exit criterion |
|---|---|---|---|---|
| WP0 Build and skeleton | `build.mjs` (page table), `src/ui/tokens.css` (+ the `style.css` cut), `src/core/font8x8.js`, `src/learn/learn.html`, `src/learn/lessons/index.js` (the six fixed const names, never edited afterwards), `src/learn/lessons/boards.js` (generated), `tools/launch.mjs`, `tools/names.mjs`, `tools/ids.mjs`, `tools/boardshots.mjs`, the three board3d.js patches (7.8), `pages.yml` | — | 3 days | `node build.mjs` output byte-identical to before (diff; the anatomy script list is unchanged and the styles join with `''`, 7.1); `node build.mjs --page learn` builds a page that loads with the board visible and no console error; `names.mjs` passes for both pages; `docs/rewrite/ids.md` written with both spellings and the visit labels; fast gate green after the patches |
| WP1 Playback | `src/learn/playback.js`, `tests/playback.test.mjs`, `tools/playback-parity.mjs` | WP0 | 5 days | the Node test green (boots the 8086 in the right order, hand-off state, `traceNext` to the end of `hello`, event counts, `s._ms` set on every step with a spy `durOf`, `startFF` returns to the trace, `enter: false` emits no `step`, `traceRep: 'all'` re-traces a seen instruction, the traced/untraced re-run equality on six models, `waitKey` ends on IRQ1 and not on IRQ0); parity diff empty on `hello`, `fib`, `clock` (8086) and `fib32` (386) |
| WP2 Stage and facade | `src/learn/facade.js`, `src/learn/stage.js`, `tools/beatprobe.mjs`, `tools/learn-smoke.mjs` | WP0 | 5 days | smoke green: rendered frame, a traced step whose `segs` has a `dive`, one camera move, resize, hover, exactly one card kept on the 80386 letter's Address calculation and on an 80686 stop, `ring('explore')` shows the card and `ring('lesson')` hides it; `beatprobe` on the old page freezes `xpTime` (the letter's `memw` data step < 4 s, every step < 6 s); the six boards framed at `overview` in the new host |
| WP3 Plan, player, caption | `src/learn/plan.js`, `src/learn/player.js`, `src/learn/caption.js` (with its own injected style), `tests/plan.test.mjs`, `tests/fixtures/letter.8086.json` (hand-written in week 1 from the Node recipe of section 0; `--dump` regenerates it from M1) | WP0 schema; WP1 events and WP2 Stage API as stubs first | 7 days | the fixture plays end to end with a stub play and a logging stage: Next, Back, Auto, Again, checks, chained phases, fold, the aside beat, the dry pass's fixed n; beat times match 5.3 within 5 % under the virtual clock |
| WP4 Content | `src/learn/content.js`, `src/learn/terms.js` (the seed), `tools/content-merge.mjs` | WP0 ids | 5 days (a developer for the merge, a writer for `why` and terms) | every `(part, label)` of the six `DIE_PLANS` has `title short long aliases`; 80 terms; the Chrome validation of keys green |
| WP5 8086 lessons | `src/learn/lessons/programs-8086.js`, `l8086.js`; adds to `terms.js` | schema (WP0), checker (WP10 skeleton) | 7 days (writer) | 9 lessons, checker green (selectors, visits, lengths, terms, part numbers, measured checks, pace, screens), every new program run in Node |
| WP6 Later machines' lessons | `src/learn/lessons/programs-later.js`, `l80286.js … l80686.js`; adds to `terms.js` | WP5 as the model | 2 writers × 5 days | 31 lessons, checker green; `compare.js` generated |
| WP7 Shell and screens | `src/learn/shell.js`, `src/learn/outline.js`, `src/learn/learn.css` (layout only: the caption card and the registers strip inject their own styles) | WP0; interfaces 4, 5, 10 | 6 days | the screens of section 2 at 1280 × 720 and 1440 × 900 with the fixture; keyboard and `aria-live`; the glossary panel in the program block's place; the end card in the program + caption box; the phone fallback with `DieView` at 390 px; the card and controls rectangles identical across every beat (measured) |
| WP8 Explore | `src/learn/explore.js`, `src/learn/regs.js` (with its own injected style) | WP1, WP2 | 4 days | steps `hello` on the 8086 with Back at stop 2's pace; the registers strip shows exactly the registers a `reg` event changed; `‹ Lesson` returns to the same beat after stepping ahead and after a "Go further" sample (both paths of 2.7) |
| WP9 Workbench hand-off | `app.js` (+10), `index.html` (+3) | WP0 | 1 day | the old page opens with the handed program, shows the chip, returns to `learn.html?cpu=&lesson=&beat=`; `a86:src` untouched (asserted in a Chrome run) |
| WP10 Checkers | `tools/learn-check.mjs`, `tests/lessons.test.mjs`, `tools/learn-shots.mjs`, `tests/fixtures/*.json` from M1 | WP1, WP3 | 5 days | all six models green in Node in < 30 s; the Chrome run of 8086-01 with three screenshots; `--json`, `--dump`, `--compare`, `--titles` work |

Every file above has exactly one owner; the two files two packages add to (`terms.js`: WP4 seeds it,
WP5 and WP6 append entries; the fixture: WP3 writes it by hand, WP10 regenerates it from M1) are
append-only for the second party and named here so the "disjoint files" rule holds.

Parallelism: after WP0 (days 1-3), WP1, WP2, WP3 (against stubs), WP4 and WP7 (against the fixture)
run at once; WP5 starts on paper in week 1 and against the checker skeleton in week 2; WP8, WP9,
WP10 start in week 3; WP6 in week 5.

### 9.1 Risks

Every risk of the map (§7, numbered 1-15) and of this design (lettered A-F, defined here in one line
each), the milestone that retires it, and the concrete check that proves it. "Accepted" means v1
lives with it knowingly.

| Id | Risk | Retired at | The check that proves it |
|---|---|---|---|
| 1 | One model per page load (parse-time freeze) | M0 | decided: reload per machine (2.5 links, `a86:cpu`); `tests/lessons.test.mjs` uses one `vm` context per model |
| 2 | board3d.js is one 553 KB IIFE with the spec builders inside | accepted (v1.1 lift, decision 10) | `names.mjs` proves the learn page loads it whole without a collision; the lift is measured by `tools/unitsheet.mjs` before/after in v1.1 |
| 3 | Die dives need `RunnerView.dieKit` | M0 | `learn-smoke.mjs`: a traced step whose `bd.tr.segs` has a `dive` through the runner shim |
| 4 | The Explain director is not instantiable; the board measures its DOM by class | M0 (covers), M1 (player) | the Stage's start-up assert on `.xp3-prog/.xp3-bar/#trace/#monitor` + patch B; 8086-01 plays end to end on Playback + Stage |
| 5 | `api.stepMs` missing; `traceDur` must precede `traceStep` | M0 | `tests/playback.test.mjs`: `s._ms !== undefined` on every step with a spy `durOf`; the facade's `stepMs` getter |
| 6 | Render-loop and clock ownership; no `webglcontextlost` handling | M0, M3 | `learn-smoke.mjs`: a rendered frame under `__vt` from one rAF loop; `learn-shots --nowebgl` and a forced `webglcontextlost` (`WEBGL_lose_context`) switch to die mode with no `pageerror` |
| 7 | Every frame dereferences `app.machine`; a stub throws on hover | M0 | the facade passes the real `Machine` (7.4); `learn-smoke.mjs` hovers the CPU (`stateOf`, board3d.js:4624) |
| 8 | Headless verification blocked by `--no-sandbox`, slow under swiftshader | M2 | `tools/launch.mjs` shared by every tool; the 8086 course's Chrome run completes in ≈ 6 min with state assertions, not pixels |
| 9 | Name collisions in the one-scope build | M0 | `tools/names.mjs` runs inside `build.mjs` for both pages and fails on a duplicate |
| 10 | Content scattered in three namespaces bridged by strings | M1 | `content.js` keyed `'PART/LABEL'` with `aliases`; the checker fails a `stop` that no step visits (7.7 check 4) |
| 11 | Global side effects of reused modules | M0 (accepted where noted) | `Tips` and `Sfx` not in the learn list (`names.mjs` output shows neither); `URL_PARAMS`' parse-time write of `a86:cpu` is relied on (2.5) and asserted by the Chrome run (`localStorage['a86:cpu']` after load); one `BoardView` per page, so one document `keydown` listener (asserted: `getEventListeners` count in the smoke) |
| 12 | Spec identity and step mutation cause flicker | M1 | one story per instruction kept from the dry pass; `limitStops` runs before the first plan (`s._j._xp` absent when it runs, asserted in the smoke) |
| 13 | Storage shared across the two pages | M2 | the Chrome run asserts `a86:src` unchanged after a lesson and after a hand-off; `learn:at.cpu` mismatch offers a reload (2.2) |
| 14 | Performance and memory (dies, wasm memory, logs) | M3 | no wasm in the learn list; `decapAll` never called; `usedJSHeapSize` < 600 MB at the end of every Chrome run; the P6 fold budget measured (`sliceInstrs`) |
| 15 | Pop-out/PiP and the phone layout | M3 | no PiP on the page; `learn-shots --phone` at 390 px plays every 8086 lesson on the die stage |
| A | The pacing constants are assumed, not measured | M0 | `tools/beatprobe.mjs` output freezes `xpTime`; the letter's `memw` data step < 4 s, every step < 6 s |
| B | A story rename silently empties a beat | M1 | an unmatched `at` selector fails `learn-check`; the frozen title list is asserted (`--titles`) |
| C | The reading model (600 + 45/char) is a guess | M2 | two readers' Next presses against Auto's beat times recorded and `LN_PACE` adjusted; the M2 record in 10.4 |
| D | Folding hides what a later lesson needs | M3 | each course's lesson 1 or 2 shows the fetches once; Explore shows every step; the checker's `--json` lists every folded step per lesson for the reviewer |
| E | The lesson tables name units or steps the machine never produces (this revision's own finding) | M0 (ids.md), M1 (checker) | `tools/ids.mjs` prints the visit labels per model; 7.7 check 4 fails an unvisited `stop` and an unmatched selector; the tables of section 4 are revised from ids.md at WP0 |
| F | The comparison numbers could be empty or differ per visitor | M3 | `compare.js` is generated in Node by `--compare` and checked against a fresh run at M4 (10.4) |

Milestones and the risk each retires (map §7 numbering; the letters are this design's, defined in 9.1):

- **M0, end of week 1 — the interfaces hold.** WP0 done; WP1's Node test green on `hello`; WP2's
  smoke green; `beatprobe` output freezes `xpTime`; `ids.md` written. Retires 1, 3, 5, 6 (the loop
  half), 7, 9, 11, A, E (the ids half), and the covers coupling of 4 (the Stage's assert plus patch B).
- **M1, end of week 3 — one lesson end to end.** WP3 with the real Playback and Stage; WP4's 8086
  part; 8086-01-letter plays on the board; WP7's lesson screen and first visit; WP10's Node checker
  validates it. Retires 4 (the player half), 10, 12, B, E (the checker half), and the owner reviews
  the pacing on the real board.
- **M2, end of week 5 — the 8086 course and Explore.** WP5's nine lessons; WP8; Outline and Chooser;
  the Chrome checker over the 8086 lessons; deploy to `_site/learn.html` (not the front door). Two
  readers who do not know assembly do lessons 1-3 while someone watches; their Next presses against
  Auto's beat times adjust `LN_PACE`. Retires 8, 13 and C.
- **M3, end of week 7 — six machines.** WP6 (31 lessons, checker green, `compare.js`), WP9, reduced
  motion, the die fallback, context loss and throttling checked in Chrome (`--reduced`, `--nowebgl`,
  `--phone`, `--throttle 4`); the P6 fold budget measured (the JS ROB model, map §1.3). Retires 6
  (the context-loss half), 14, 15, D and F.
- **M4, week 8 — the flip.** `learn.html` becomes `_site/index.html`, the old page
  `_site/workbench.html`; links relative; `a86:cpu` carries. Gate: section 10's checklist. Risk 2
  stays accepted into v1.1.

---

## 10 Verification

### 10.1 The Node lesson checker

`tools/learn-check.mjs` (7.7), wrapped by `tests/lessons.test.mjs`. Required green for any merge to
`src/learn/**`. It is the writers' editor: run per lesson (`--lesson 8086-05-jumps --pace --json`),
it prints every step's selectors, the compiled beats with their filled captions, the pace model's
time per beat, and every finding with the rule number of section 3.5.

### 10.2 The Chrome screenshot script

`tools/learn-shots.mjs` (7.7). `tools/learn-smoke.mjs` runs in week 1 and after every touch of
`facade.js`, `stage.js` or the board patches; the full run over a machine's lessons runs before a merge that
touches lessons, the player or the CSS, and before a deploy. State assertions first (captions,
`bd.tr.i`, camera moves, token inside the stage, stable rectangles, no `pageerror`, heap); three
screenshots per lesson only as a picture for the reviewer.

### 10.3 Tests to keep green (map §6.4)

Unchanged, run after any touch of shared files: `tests/story.test.mjs --model 80486` (9 s),
`tests/machine.test.mjs --model 8086` (1.3 s), `tests/fpu.test.mjs`, `tests/cpu486/586/686.test.mjs`,
`tests/pm286..pm686.test.mjs`. New and required for `src/learn/**`: `tests/playback.test.mjs`,
`tests/plan.test.mjs`, `tests/lessons.test.mjs`, `node tools/names.mjs --page learn`. Before a
deploy: `tools/learn-shots.mjs --model 8086` (all lessons) and `tools/learn-smoke.mjs` for the other
five models.
The `story.test.mjs:41` double-`reset()` stays as the map left it (a task was queued); the checker
boots in the right order and covers what that test meant to.

### 10.4 Acceptance criteria of v1 (the M4 gate)

- [ ] `node build.mjs` produces the present page byte for byte (its script list is unchanged and the styles join with `''`, 7.1: a `diff` of `dist/8086-anatomy.html` against the pre-rewrite build is empty); `node build.mjs --page learn` produces `dist/learn.html` ≤ 3.5 MB (the six board pictures included); `tools/names.mjs` passes for both pages.
- [ ] The three board3d.js patches are the only edits to `src/ui/board3d.js`; `src/core` (except the new `font8x8.js`), `src/asm`, `story.js`, `blocks.js`, `unitfx.js`, `die.js`, `disks.js`, `theme.js` are unchanged (`git diff --stat`).
- [ ] `tests/lessons.test.mjs` green for all six models in < 30 s; 40 lessons, no finding.
- [ ] `tools/learn-shots.mjs` green for every 8086 lesson and `tools/learn-smoke.mjs` on the other five models: every step beat's animation ≤ 6 s of virtual time, the letter's `memw` data step ≤ 4 s, one camera move per beat, the place strip's n equal to the fixture's beat count, the caption card and controls rectangles identical across all beats of a lesson at 1280 × 720 and 1440 × 900 (the check beat and the end card in their own fixed states), exactly one card kept at a named stop on the 80386 and the 80686.
- [ ] No block card, monitor box, legend or toolbar is visible on the lesson screen (`getComputedStyle(.bv-card).display === 'none'`, no `.bv-top` visible); `bd.covers` is all zero.
- [ ] Every caption's numbers come from templates, the program source or bytes, or a `plain` list (the checker's rule 5); every `measured: true` check recomputes; the six `compare.js` numbers match a fresh `--compare` run.
- [ ] The first visit, the outline, the chooser, Explore, the end card and the hand-off to `workbench.html` work by mouse and by keyboard (2.10); the headline is announced (`aria-live`).
- [ ] `prefers-reduced-motion` gives instant camera and stops, Auto off; `--nowebgl` and 390 px give the die stage with every lesson of the 8086 playable; under `--throttle 4` the watchdog offers the simple view; a forced `webglcontextlost` switches to it without a `pageerror`.
- [ ] Two readers who do not know assembly finish 8086 lessons 1-3 in under twenty minutes without asking a question about the controls (M2 record).
- [ ] `a86:src` is never written by the learn page (Chrome assertion); `a86:handoff` is deleted by the old page on read.
- [ ] The deployed `_site/index.html` is the learn page and `_site/workbench.html` the present page, with the "‹ Lesson" chip and relative links between them.

---

## 11 Decisions

Each resolves a contradiction between the proposals or a finding of a judge; the reason is the one
the implementers should defend.

1. **Layout: stage left, column right, with the program always visible; the outline behind a
   button.** The learner judge kept the visual proposal's stage/column layout (die aspect, the
   program in view without a click); the engineer judge rejected an always-visible outline + program
   column as against principle 1. Resolution: the column holds a three-line place strip, the
   program, the caption card and the controls; the full outline is a drawer (interaction §2.3). The
   program is what a learner needs to locate a beat; the list of nine lessons is not.
2. **The block card is hidden in Lesson and its cover is data.** All three judges rejected leaving
   `.bv-card` on the stage (`xpSet` un-minimises it, board3d.js:6671; `trCover` reserves
   `offsetWidth || 300` + 24 px, 7229, so a `display: none` card still costs 324 px). Resolution: CSS
   hides it in the Lesson ring, patch B makes `covers` data and the Stage sets them to zero; the
   card's `sub` is available to the writer as `cap: 'unit'`; Explore shows the card.
3. **Stops are filtered outside board3d.js on `unit && card`, before the first plan.** The
   engineering proposal's `limitStops` filtered `kind === 'dwell'` after `trJourney`, a no-op
   (dwells become `kind: 'move', unit: true`, 6283-6286); the visual proposal filtered at `visits`
   inside the file. Resolution: the Stage's `limitStops` sets `card = null` on unlisted unit visits
   between `trJourney(s)` and `traceDur(s, ms)`; zero patch, and `xpPlan`'s cache (6337-6339) is
   built after the filter. Default stops: the step's source and target plus the beat's named ones.
   The comparison is on the **remapped** key `part/blkLabel(e, g.block)` (6.3): `g.block` is the
   trace model's 8086-era label and only `blkLabel` (6088-6090) gives the die block on the 286+, so a
   comparison on `g.block` would work on the 8086 example alone and drop every card from WP6 on; the
   smoke test's "exactly one card" assertions on the 80386 and 80686 hold this.
4. **`xpTime = { travel: 1.3, work: 0.33, read: 0.2, pass: 0.25, cut: 0.5 }`, frozen by
   `beatprobe`.** The curriculum, engineering and interaction pacing tables did not follow from
   `xpPlan` (all three judges); the visual constants did, but missed two things this design found in
   the code: a stop is `max(WORK, xpReadMs(g, read))` (6395, 6517-6519), so `read` must be lowered
   or a long `sub` holds 6 s; and the camera lead and scene cuts (`XP_CUT · slow · up to 3.6`,
   6318, 6385) have no multiplier, so patch A adds `cut`. The `ms` passed to `traceDur` is never used
   as a cap (6341: `quick = ms < 1000` only); `quick: true` is the per-beat escape.
5. **Reading is the card's job, not the board's.** `xpTime.read` is set low so the board's plan
   holds a stop for the drawing, not for the card's sentence; the caption card computes the hold
   (`LN_PACE.readBase + readPerChar · chars`), capped at 6 s for Auto (the interaction proposal's
   clamp to 9000 ms and the 1400 + 58/char rule on 110-character headlines were rejected by the
   editor judge). Headline 80 / details 220 (curriculum) over 90/160 (interaction): the details
   layer carries the mechanism and a 160-character cap would push it back into headlines.
6. **The bus cycle is three captioned beats in 8086 lesson 1, one beat by default afterwards, and
   the mechanism is the selector's specificity.** The visual proposal folded the cycle by default
   and had no mechanism for one beat over three story steps (the engineer and learner judges); the
   curriculum showed address, command and data as three beats. Resolution: `bus:memw:vram:addr`
   gives one beat per phase; `bus:memw:vram` chains the three steps under one caption, each entered
   when the previous `animMs` ends, each `quick`. No new flow is synthesised; the board plays its
   own steps.
7. **No term beats; no walls.** The engineering proposal's `{ term }` beats and "Next disabled until
   an answer is chosen" are out (all three judges): a definition with no picture costs a Next; a check
   pauses Auto and offers a why, and Next and the doors always work.
8. **The Workbench is the present page.** `workbench.html` from the same page table, the one-shot
   `a86:handoff`, the "‹ Lesson" chip (interaction §2.5). This deletes a 400-450-line re-hosting of
   dock, disks, timing and memmap from v1, keeps the learn page at ≈ 3.1 MB, and keeps `a86:src` safe.
9. **Back re-runs across instructions; no key replay in v1.** The editor judge kept "Back by
   deterministic re-run" with key replay; the engineer judge rejected mandating key replay in v1.
   Resolution: within an instruction the board's replay (`back: true`); across instructions
   `boot()` + `runTo({ instr: k })` (48-194 ms measured for the POST; the lesson's own `from` adds to
   it, and where the Node figure exceeds `backBudgetMs` — 80686-04's `loop2.l` — Back across
   instructions becomes "Back to the start of this lesson", 5.3); the re-run's equality with the
   traced run is asserted for registers, caches and BTB in WP1's Node test, not assumed; in the one
   lesson with a key (8086-08-ports) Back across the key beat is disabled with a title. Key-clock
   replay is v1.1.
10. **`dieKit` through the runner shim; the specs/dieplans lift is v1.1.** Both judges allowed either
    the shim or moving 17 lines; the curriculum's v1 lift of `specs.js`/`dieplans.js` was rejected by
    all three. Resolution: the shim (verified: `dieKit` reads only `this.board`, 8182-8198), guarded
    by the smoke test's `dive` assertion; the lift, the `dieKit` move and `applyTheme(model)` are one
    v1.1 package with `tools/unitsheet.mjs` as its before/after check.
11. **Programs are written for the idea, run in Node before they enter the list; two of the winner's
    were wrong and are fixed here.** Lesson 7's handler ran with DS = BDA (INT 08h sets it before
    `int 1Ch`, bios.js:1104-1127), so `inc byte [n]` missed the program's byte: the handler now does
    `push cs / pop ds` (measured: prints 4 and ends). Lesson 8's `sti / hlt / in al, 60h` was woken by
    the timer: the lesson now calls INT 16h (whose `.wait` loop halts, bios.js:1289-1295), waits for
    the key, and steps into the ROM's INT 09h handler (`in al, 0x60` is its eighth instruction,
    1136-1143) with `step: { count: 8 }`. The wait itself is a fast raw loop that ends at the INT 09h
    entry (3.2): INT 16h's loop is woken by every IRQ0 (measured: 18 wakes and 2.4 M `machine.step()`
    calls per emulated second), so "until `cpu.halted` clears" would end the beat on the first timer
    tick and a traced step loop would be far too slow; the `irq` step of the key is therefore
    consumed by the wait and named in a `say`, and the two returns are `until: 'iret'` (INT 09h
    returns into INT 16h's loop) then `until: 'program'` (INT 16h returns to the program): with
    `'iret'` defined as "back in the program segment" the first return could never be seen.
12. **Slices of existing samples use `from: { label | text | bios | instr | ip }`, never a copied
    sample.** The curriculum copied a sample to add a label; the engineering proposal's `from/count`
    was kept by the learner judge. The labels used here exist in the samples (`test_wrap`, `pm_entry`,
    `after_gp`, `gp_handler`, `pm`, `pm.w`, `start.bit`, `loop1.l`, `loop2.l`, `chase`; measured), and
    `{ text: 'fdiv' }` uses `Disasm86` at `physIP`. The machine.test screens (70-110) stay valid checks.
13. **The letter program's first-visit caption no longer says the screen is empty.** The BIOS
    hand-off (bios.js:171-190) leaves the start-up banner on the screen (measured: the letter lands
    over its first character). The beat says the screen still shows the ROM's text, and the templated
    `{screen:0}` names the byte actually there.
14. **Selectors are per real story fields; `mov es, ax` and `dec cx` are one `Decode` step; there
    are no `uop`/`rat`/`rob`/`pipe` steps.** Three proposals used `inside:Execute` for `mov es, ax`;
    it matches nothing (measured). The first draft of this design listed `uop rat rob pipe` as step
    kinds and `btb` for right predictions; story.js builds nine kinds only (3.3), the P6 events are
    lines inside an `inside` step and a right prediction is a line in `Decode`, so the P6 outlines,
    80486-03 and 80586-03 as first written could not pass their own checker. Resolution: the `inside`
    selector takes an event-kind tail (`inside:*:rat`), the `cache` selector derives `unified` for the
    486 and `l2` for the P6's L2 step and takes a `fill|write|miss|hit` tail, `btb` means a wrong
    prediction, and the `--json` dump prints every step's selectors, `evs` kinds and remapped visit
    keys so writers copy them. An unmatched `at` fails the checker.
15. **`prefetch` is a lesson choice; fetch selectors need `'full'` or `'short'`.** Under
    `'parallel'` fetches live in `host.bg` (story.js:392-403) and no `bus:fetch` selector can match
    (three proposals wrote such captions). The bus lesson says `story: { prefetch: 'full' }`.
16. **Terms: ≤ 3 per lesson, ≤ 6 in 8086 lesson 1.** Lesson 1 names the vocabulary every other
    lesson uses (program, register, segment register, address, bus, video memory); three would force
    a definition-only lesson before it. The checker holds the exception as a rule of `n === 1 &&
    machine === '8086'`.
17. **Lesson 1 is four `look` beats and a program, not a six-minute chip tour.** The visual
    proposal's shots-only lesson ran no program (brief principle 5); the tour is four looks inside
    lesson 1 (curriculum §3.5), and the remaining chips get their labels when a step lights them.
18. **No wasm cores, no `Tips`, no `Sfx` on the learn page.** No lesson runs `run()` without trace;
    `Tips.init` rewrites every `title` (map §7 risk 11); `Sfx` installs document listeners at parse;
    sound design is a non-goal. The Workbench (the old page) keeps them.
19. **The comparison numbers are computed in Node, never recorded from the learner's visits.** The
    curriculum's `learn:facts:<model>` could be empty (risk F); `lessons/compare.js` from the checker
    is never empty and is the same on every machine.
20. **Schedule: eight weeks, five people, must/should split 23/17.** The curriculum's four weeks and
    the visual proposal's four were rejected by the engineer judge; twelve (interaction) is longer
    than the smaller scope here needs: no Workbench re-hosting, no `boardmap.js`, no specs lift.
21. **The phone and no-GPU stage is `DieView` plus captions.** `boardmap.js` (visual) is out; the
    chip's `INFO` paragraph stands in for board looks; brief principle 8 asks only that the phone does
    not break.
22. **The tokens move to `src/ui/tokens.css` rather than being copied.** Copying drifts (engineering);
    loading the whole style.css into the learn page brings 70 KB of rules for markup that does not
    exist (interaction split). The cut is verified byte-identical for the old page in WP0, which is
    only possible because the styles join with `''` and tokens.css keeps the cut bytes (7.1); the
    first draft's claim of a byte-identical page while inserting `font8x8.js` into the anatomy script
    list and joining with `'\n'` was untrue (a `// ---- ` marker and a seam newline would differ), so
    `makeFont8x8` is copied for the learn page instead of moved, and disks.js is not edited (7.9).
23. **The Lesson ring never folds on its own (`traceRep: 'all'`); Explore keeps `'once'`.** With the
    engine default, `beginInstr` folds any instruction traced in the last 2000 (app.js:1344-1348),
    which is every loop body a lesson revisits (the fall-through JNZ of 8086-05 after `repeat`, pass 2
    of 80486-02, the P5/P6 loop lessons) — a `step` beat would silently become a fast run with no
    story. Only the lesson's `repeat` and `run` fold; the checker fails a `step` beat whose
    `beginInstr` returned false. Explore is the workbench-like ring and keeps the old behaviour.
24. **The engine does not enter step 0 by itself (`enter: false`).** `beginInstr` calls `enterStep(0)`
    whenever a story has steps (app.js:1369), which would show every hidden Decode of lesson 1 on the
    board before the shown Execute; the player enters the first shown step in the same frame.
25. **Beats are compiled in a dry pass at `load()`, not lazily.** The place strip's n and its dots are
    part of the stable layout (principle 4); folds split at `animCap` and asides appear only when the
    stories are known, so the whole lesson runs once without views (tens of milliseconds) and is
    re-run to `from`.
26. **Auto never opens the details.** Opening them after the headline would make every beat with
    details 6 s (`readH + readD` clipped) instead of 2-4 s and take the details layer off "on request"
    (principles 2 and 3); the outline setting "Auto reads the details too" is the opt-in.
27. **Next mid-animation gets patch C rather than a reworded promise.** `traceStep` finishes the
    earlier steps only on the replay branch (board3d.js:7046-7055); without `|| info.finish` two
    animations would overlap and "the token at its destination" would be untrue. One line, old page
    unaffected.
28. **The end card replaces the program block and the caption card together, in their outer box.**
    A summary, a check with three answers and a why, three doors and the compare line do not fit
    260 px; changing the column per beat is out (principle 4), so the two blocks and their gap become
    one box (472 px at 720, 652 px at 900 — the review's figure of 592 at 900 does not add up: the
    program block is 380 px there) and the controls row stays.
29. **The 8086-02 fetches are the next instructions' bytes, and the lesson says so.** Under
    `prefetch: 'full'` the fetch steps inside instruction 1's story are the queue's refills of bytes
    3-8 (measured: two background fetches); instruction 1's own bytes came in during the untraced boot
    and the ROM's RETF, so `LearnPlan.order`'s "own fetches before Decode" finds none. Rewording the
    caption keeps the letter program in lesson 2; moving the lesson to a taken jump (the stars
    program) would spend the bus lesson on a loop before loops are taught.
30. **Review citations this revision did not adopt.** The letter program `SRC` is explain3d.js:11-18
    as this document cites it (`const SRC = [` at 11, `];` at 18, checked in the tree), not 13-20;
    board3d.js:7755 is cited in 2.1 for the `host.clientWidth/Height` read, which is that line
    (`resize()` itself starts at 7753). The other citations flagged by the review were off and are
    corrected in place: `flyTo` 4212 (its 1300 ms flight at 4222), the cut item 6386, the stop formula
    6396, `trTrack` 6958 (7032 is `traceStep`), the dwell rewrite 6280-6283. Where two review findings
    disagreed — `80386/PAGE ADDER` and `80486/EXPONENT`/`MANTISSA` as stops (one finding) versus "a
    stop no step visits fails" (another) — the visit rule wins: `PAGE ADDER` is visited by the page
    card and stays; `EXPONENT`/`MANTISSA` are never visited and become labels of a die look.

---

## 12 Left out of v1

- Two machines on one screen, a machine switch without reload, and parameterising story.js or
  board3d.js for the model (map §7 risk 1): the closing lessons and `compare.js` tell the story.
- Lifting `specs.js`/`dieplans.js` out of board3d.js, moving `dieKit` into `BoardView`, `applyTheme(model)`
  in theme.js: one v1.1 package with `tools/unitsheet.mjs` as its check.
- Key-clock replay for Back across a key beat (v1.1); a `Machine.snapshot()`.
- The dark-overlay cut (180 ms to dark, instant flight, 180 ms back) and `xpPrefetch` before a cut:
  v1 shortens the board's own moves through `xpTime.cut`; the overlay is v1.1 if swiftshader shows
  half-drawn dies after a cut (visual risk 8.2).
- A 2D board renderer for the no-GPU path (`boardmap.js`, `TopView`); the phone layout beyond "the die
  and the caption"; pop-out windows; the Runner view; sound design; the DOS boot UI beyond the disks
  panel in the Workbench (brief non-goals).
- Re-hosting the dock, disks, timing and memory views in the learn page: the Workbench is the old page.
- Lessons on the VGA samples (`plasma`, `wheel`, `modex`), the Sound Blaster (`sb`), `tune`, `movsb`,
  `bcd`, `quad`, DMA (gap 13) and disks (gap 28): they stay as programs in Explore's "Go further".
- The 8087 as an 8086 lesson (`pi` is "Go further"; gap 16 is taught on the 486); virtual 8086 mode,
  task switching, the 4 MB page, RDTSC/PMC measurement lessons; protected mode on the 386+ beyond paging.
- Scores, accounts, sync, certificates, timers; more than one end check per lesson.
- A visual lesson editor; translation; rewriting the 131 die texts, the 85 unit sentences or the 120
  glossary rules (content.js merges them and adds `why` lines).
- Fixing `tests/story.test.mjs:41` (queued separately by the map); extending the editor's highlighter
  to 32-bit words (Workbench polish).
