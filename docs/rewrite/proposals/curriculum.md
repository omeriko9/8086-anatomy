# Design proposal 1: curriculum first

Designer 1 of 4. The angle: start from what a person must understand, in what order, to know how
an x86 PC runs a program; write the lessons as data; then build only the screens and modules that
play that data. The brief (docs/rewrite/00-brief.md) is not repeated here; the map
(docs/rewrite/01-reuse-map.md) is cited by section as "map §n", the code as `file:line`.

Contents: 1 Concept · 2 Screens · 3 The lesson data model · 4 The curriculum for v1 · 5 The pacing
model · 6 The reuse plan and the module list · 7 Work packages and milestones · 8 Risks ·
9 What is deliberately left out.

---

## 1 Concept

**One question per lesson, one lesson per idea, one machine per course.** The page is a course in
six parts, one per machine. Every part follows the same spine of seven questions, so a person who
has done the 8086 part recognises the shape of the Pentium part and sees only the answers change:

1. What is a program, and what does the CPU do with its bytes?
2. Where do the bytes come from? (the bus, the clock, the memory)
3. Where do values live? (registers, the ALU, memory and addresses)
4. How does it decide? (flags, jumps, loops)
5. How does it remember where it was? (the stack, CALL and RET)
6. How does the world get in? (interrupts, I/O ports, the keyboard, the BIOS)
7. What is new in this chip, and why? (the machine's own lessons)

The 8086 course answers questions 1 to 6 in full (nine lessons). The five later courses answer
question 1 again in their first lesson with **the same four-instruction letter program** (the
Explain `SRC`, explain3d.js:11-18) so the learner sees what carried over and what changed, then
spend four to six lessons on question 7, and end with a **"What changed, in numbers"** lesson that
compares this machine with the earlier ones from facts the page recorded while the learner ran the
same program on each (the cross-model story the map lists as gap 26, §5.6). That is how principle 6
("each machine has its own story") and the one-model-per-load constraint (map §7 risk 1) coexist
without two machines on one screen: the comparison is a table of recorded numbers, and the current
machine is live.

**A lesson is a real program plus a script of beats.** Every lesson runs a 4-12 line program
written for it (section 4; most are new, some are cut from `SAMPLES`, bios.js:2680-8330, §5.4).
A beat is one caption with one focus and one action, and there are five kinds: *say* (a sentence,
no machine action), *look* (fly the camera to parts of the board or a die, spotlight them), *step*
(run one instruction and play chosen story steps of it), *screen* (show what the CRT now shows and
why), *check* (a question with three answers, the right one read from the emulator). The generic
step captions are `Story.build`'s sentences (story.js:78-135, 140-220); a lesson **overrides** the
captions of the steps it cares about and **chooses which units get a stop** (brief, "What the design
must deliver"). Writing a lesson is writing one object literal; no lesson has code.

**Captions are layered by a writing model, not by a length cap.** Each caption is a headline (one
sentence, at most 80 characters, plain words, the value it talks about in bold), then details (at
most two sentences, shown on request or under Auto after the headline was read), then the one-line
meaning of each new term the first time it appears (a `terms` list per beat, a glossary module, a
"seen" set per visit). Section 3.4 gives the rules and the list of what a caption must not say.

**Three rings around the same stage** (brief principle 7): Lesson (caption card, Next, Auto,
the board or die), Explore (the same stage with the whole story of every instruction of the
lesson's program, Next and Back, the registers that changed), Workbench (the old page's powers:
editor, dock, memory, timing, disks). The stage, the caption card and the control row never move
(principle 4). The learner never leaves a ring by accident: Explore and Workbench are one button
each, and the lesson resumes where it was.

**What makes it better for the learner than the present page.** The present Explain story teaches
one program on six machines and then opens the workbench (brief, "Why"). This design teaches
forty ideas in order, each with its own program, each with a question the learner answers by
looking at the machine, and it tells the learner *why* a part exists before it shows the part at
work: the map's 29 gaps (§5.6) are the table of contents of the 8086 course and of each machine's
"what is new" lessons. Every value in every caption comes from the emulator (principle 5); every
program is one click from the editor (Workbench).

---

## 2 Screens

Six screens, one layout. At 1280 x 720 the stage is 1280 x 560 and the card row 160 px; the card
row never changes height. All wireframes are the Lesson ring unless labelled.

### 2.1 The first visit

```
+----------------------------------------------------------------------------------+
|  8086 Anatomy                                                 [Workbench]  [?]   |
|                                                                                  |
|        How does a PC run a program?                                             |
|        Watch one, byte by byte, on six real machines.                           |
|                                                                                  |
|        [ Start with the 8086 (1978) ]        a 4-minute lesson                   |
|                                                                                  |
|        Or pick a machine:                                                        |
|        ( 8086 ) ( 80286 ) ( 80386 ) ( 80486 ) ( Pentium ) ( Pentium Pro )        |
|          1978     1982      1985      1989      1993         1995                 |
|                                                                                  |
|        Already know the basics?  [ Skip to "What is new in this chip" ]         |
+----------------------------------------------------------------------------------+
```

Shown once (`learn:seen` in localStorage, §2.6 rule: own keys, prefix `learn:`), then never
again unless the learner opens it from the outline. The Start button opens 8086 lesson 1; the
machine buttons open that machine's outline (a page reload with `?cpu=`, map §0, §6.3). No board is
built on this screen (fast first paint; the WebGL renderer starts on the lesson screen).

### 2.2 The lesson screen

```
+----------------------------------------------------------------------------------+
| 8086 · Lesson 5 of 9 · Deciding: flags and jumps           Outline  Explore  ...  |  36 px
+----------------------------------------------------------------------------------+
|                                                                                  |
|                                                                                  |
|                              THE STAGE (3D board or die)                         |
|                       one focus lit; everything else dimmed                      |  524 px
|                                                                                  |
|                                     [monitor: the CRT, top right, 25 % width]    |
|                                                                                  |
+----------------------------------------------------------------------------------+
|  o o o o o O o o o o o o o o o o o o o o o o o o o o o o o o o o   beat 6 / 31   |  20 px
| +------------------------------------------------------------------------------+ |
| |  JNZ reads the zero flag. ZF is 0, so the CPU jumps back to "again".         | |
| |  The jump empties the 6-byte queue: the bytes fetched ahead are lost.  [more]| |
| |  zero flag: one bit the last calculation set when its result was 0.          | |
| +------------------------------------------------------------------------------+ |  140 px
|  [ < Back ]     [ Next > ]  (Space)        [ Auto ▷ ]   program ▾   1x ▾        |
+----------------------------------------------------------------------------------+
```

Rules the wireframe encodes: one caption card (headline, details, term line; fixed 140 px, text
scrolls inside if ever needed); the beat strip above it is the only progress indicator; Next is the
largest control and has the keyboard (Space, Right); the board's own chrome (`.bv-top`, presets,
legend, focus pill) is hidden with one rule (map §2.7.1); the CRT is a fixed monitor box over the
stage's top right, only when the lesson says `monitor: true`, else the board's 3D monitor mesh
carries the screen (`crtCanvas` on the facade, map §2.2); "program ▾" drops the program listing
with the current instruction marked (read only here; "Edit in Workbench" at its foot).

### 2.3 The outline (chooser)

```
+----------------------------------------------------------------------------------+
| 8086 · Intel 8086 + 8087 · 4.77 MHz · 1 MB · 1978            [machine ▾] [Workbench] |
+----------------------------------------------------------------------------------+
|  The 8086 course · 9 lessons · about 40 minutes                                   |
|                                                                                  |
|  1 ✓ A letter on the screen                      4 min   a program is bytes...   |
|  2 ✓ Where the bytes come from: the bus          5 min                            |
|  3 ● Registers and the ALU                       4 min   ← you are here          |
|  4   Memory and addresses: segments              5 min                            |
|  5   Deciding: flags and jumps                   4 min                            |
|  6   Remembering: the stack                      5 min                            |
|  7   Interrupts: the timer ticks                 6 min                            |
|  8   Talking to devices: ports and the keyboard  5 min                            |
|  9   The BIOS, and what changed since 1978       5 min                            |
|                                                                                  |
|  Go further with this machine: Fibonacci · Bubble sort · 8087: pi · Speaker tune |
|  (open in Explore)                                                                |
+----------------------------------------------------------------------------------+
```

Progress (✓, ●) is `learn:done:<model>` and `learn:at`. "Go further" lists the `SAMPLES` of the
model (filter rule app.js:252-253, map §5.4) and opens them in Explore, not in a lesson.

### 2.4 Explore

```
+----------------------------------------------------------------------------------+
| 8086 · Explore · Deciding: flags and jumps                 Lesson  Workbench      |
+----------------------------------------------------------------------------------+
|                                                                                  |
|                              THE STAGE (same board)                              |
|                                                                                  |
+----------------------------------------------------------------------------------+
| instr 7  jnz again        step 3/4  EU · Execute   [ < ] [ > ] [ Next instr ]     |
| +------------------------------------------------------------------------------+ |
| | The EU takes 2 bytes from the queue and decodes "jnz again". ZF=0: jump.      | |
| +------------------------------------------------------------------------------+ |
|  CX 0004→0003   IP 010A→0105   FLAGS ZF=0 PF=0 ...        program ▾   speed ▾    |
+----------------------------------------------------------------------------------+
```

Explore is the lesson's program with every story step of every instruction, in `Story.build`'s
own words, with Back, and a one-line "registers that changed" strip (the `DOCK_REGS` lift, map
§1.4 dock.js). Same stage, same card height, same controls row; the beat strip becomes the step
strip. No camera scenes: the board's normal trace camera (map §4.3 `trTrack`).

### 2.5 Workbench

```
+----------------------------------------------------------------------------------+
| 8086 · Workbench                                              Lesson  Explore    |
+-----------------------------+----------------------------------------------------+
| editor (CodeEditor)         | tabs: Board | Die | Timing | Memory | Disks         |
| 1  mov ax, 0B800h           |                                                    |
| 2  mov es, ax               |                 the selected view                   |
| ...                         |                                                    |
| [Assemble & run] [Step]     |                                                    |
+-----------------------------+----------------------------------------------------+
| registers · flags · stack (StateDock, re-hosted)     | CRT (CrtScreen)            |
+----------------------------------------------------------------------------------+
```

The old page's powers behind adapters (map §1.4: `StateDock` extract, `DiskPanel` behind an
adapter, `TimingView`/`MemoryView` facade). Only a `Workbench` module knows these; the lesson ring
never loads their DOM. The disks panel is a tab here (brief non-goal: no boot UI beyond that).

### 2.6 The machine chooser

The header's `[machine ▾]` menu lists the six machines with their menu lines (index.html:28-48,
map §5.1) and the learner's progress on each. Choosing one writes `a86:cpu` and reloads with
`?cpu=` (app.js:964-1007 pattern; decided in section 8, risk 1). The lesson id survives in the URL
(`?cpu=80486&lesson=3`), so a learner who switches machine from lesson 3 lands on the same spine
question on the new machine when that lesson exists, else on the outline.

### 2.7 The phone fallback

Below 900 px or when `BoardView.ok === false` (map §2.7.1): the stage shows the `DieView` (SVG,
no WebGL) of the CPU and the caption card; *look* beats that target board parts show the chip's
`INFO` paragraph (board3d `INFO`, map §5.2) as the details; bus beats run on the die with the
`Story` text only. Nothing else changes.

---

## 3 The lesson data model

### 3.1 Shape

One file per machine, `src/learn/lessons/l8086.js` … `l80686.js`, each declaring one top-level
`const LESSONS_8086 = [ … ]` (a unique name per file: the one-scope build forbids duplicates, map
§6.1). A lesson:

```js
{
  id: '8086-05-jumps',            // stable; in the URL and in learn:done
  machine: '8086',                // '8086' | '80286' | '80386' | '80486' | '80586' | '80686'
  n: 5,                           // position in the course
  title: 'Deciding: flags and jumps',
  idea: 'A conditional jump reads one flag that the last calculation set; a taken jump throws away the bytes fetched ahead.',
  minutes: 4,                     // shown in the outline; checked by tools/learn-check.mjs against the beat count
  needs: ['8086-03-alu'],         // outline hint only, never a lock
  program: {
    src: `...`,                   // NASM text; assembled at run time with Asm86 (assembler.js:1344-1404), origin 0x100
    cpu: '8086',                  // the cpuAsm of the machine (map §5.1 row "CPU class / cpuAsm")
    entry: 'start',               // label the BIOS hands off to (default: origin)
    until: null,                  // label: run at full speed to here before the first beat (boot + startFF, map §3.3)
    monitor: true,                // the CRT box over the stage (else the 3D monitor mesh shows the screen)
    sound: false,                 // Machine option { soundCard: false } (map §1.3 soundblaster.js)
  },
  story: { prefetch: 'parallel', burst: 'fold' },   // Story.build options (map §2.7.3); a lesson about the bus says 'full'
  stops: ['ALU', 'FLAGS', 'QUEUE'],                 // die units that get a dwell in this lesson (board labels, map §4.7)
  beats: [ ... ],                                   // section 3.2
  further: ['fib', 'sort'],                         // SAMPLES ids for the end card (map §5.4)
}
```

### 3.2 Beats

Five kinds. Every beat may carry `cap` (section 3.3), `terms`, `focus`, `hold`.

```js
// say: a sentence with the camera where it is.
{ say: true, cap: { h: '...', d: '...' }, terms: ['program'], focus: ['cpu'] }

// look: fly to parts and spotlight them (BoardView.xpFocus, board3d.js:6696; ids = glow ids,
// 'monitor', 'cga', 'drives', 'screenTL', 'die:<key>', map §4.4 xpBox).
{ look: ['ramE', 'ramO'], cap: { h: '...', d: '...' }, card: 'clock' }   // card: a named tour card (clockCard, explain3d.js:443-465)

// step: run ONE instruction, play the story steps that match the selectors, in order.
{ step: 1,                           // how many instructions (default 1); 'toLabel' runs until a label with no beats
  show: [                            // which story steps become beats, and their captions
    { at: 'inside:Decode',            cap: { h: 'The decoder reads two bytes: 75 F9 mean "jump back 7 if not zero".' } },
    { at: 'inside:Execute',           cap: { h: 'JNZ reads the zero flag. ZF is 0, so the CPU jumps back to "again".',
                                             d: 'The jump empties the 6-byte queue: the bytes fetched ahead are lost.' },
                                      terms: ['zero flag'], stop: 'FLAGS' },
    { at: 'bus:fetch:*:data',         cap: 'story', fold: true },   // 'story' = keep Story's sentence, folded fetches = one beat
  ],
  hide: ['bus:fetch:*:addr', 'bus:fetch:*:cmd'],   // steps to run silently (dispatched, not shown)
  rest: 'fold',                      // unmatched steps: 'fold' (one beat, Story's sum) | 'hide' | 'show'
  repeat: { times: 4, then: 'skip' } // loop bodies: play the beats once, then run the next 4 iterations silently
}

// screen: what the CRT shows now, and why (the hide-and-reveal of explain3d.js:140-154, 296-298).
{ screen: true, cap: { h: 'The card reads its memory 60 times a second. The first cell now holds 41h: an A.' } }

// check: a question; the answer comes from the machine or is fixed.
{ check: { ask: 'How many times does JNZ jump back?', options: ['4', '5', '6'], answer: 0,
           why: 'CX started at 5. DEC makes it 4, 3, 2, 1, 0: four times the flag is 0, then it is 1.' } }
{ check: { ask: 'What is in AL now?', from: 'reg:AL', format: 'hex8+dec', wrong: ['2Ch (300)', '00h (0)'],
           why: 'AL has 8 bits: 200 + 100 = 300 does not fit; 300 - 256 = 44 stays and CF = 1 says so.' } }
```

**Selectors** (`at`, `hide`) name story steps by their real fields (story.js:78-135 bus steps,
140-220 inside steps, 237-359 device steps): `kind[:sub[:dev[:phase]]]`, with `*` anywhere.
`kind` is `s.kind` (`bus inside cache page irq btb fdc dma sound`); for `bus`, `sub` is `s.I.kind`
(`fetch memr memw ior iow inta halt`), `dev` is `s.I.dev` (`ram rom vram pic pit ppi dma crtc …`,
map §5.1 row "Extra chips"), `phase` is `s.phase` (`addr cmd data all`); for `inside`, `sub` is
`s.title` (`Decode`, `Address calculation`, `Execute`, `Interrupt`, `Descriptor`, `Protection`,
`Task switch`, or the FPU name), so `inside:Execute` and `bus:memw:vram:data` are the two most
used. The director resolves selectors against `story.steps` after `Story.build` (map §2.7.3), in
step order; a selector that matches nothing is a warning in `tools/learn-check.mjs`, never a
runtime error. Because titles are strings the story owns, `learn-check` also asserts the set of
titles it saw against a frozen list (risk 3, section 8).

**Focus** per beat: `focus: ['cpu']` (board ids), `focus: 'die:cpu'` (the opened CPU die; the
director calls `dieEntry('cpu')` first, board3d.js:6048), `focus: 'keep'` (default for a step beat
in the same chip as the previous one; `trChipKey`, board3d.js:7238). `stop: 'ALU'` asks for one
unit dwell with its card (the `tcard` spec of that label, board3d.js:1626-2082); no `stop` means
the token passes through with the unit lit (`blockGlow`, 7275) and no card.

### 3.3 Captions

`cap` is `{ h, d?, t? }` or one of two strings: `'story'` (use `Story`'s `sum` as the headline and
the rest of `text` as details, split by `splitLead`, theme.js:349-354) or `'unit'` (use the unit
card's `sub` as headline: `xpUnitText`, board3d.js:6500). A template may use live values in
`{…}`: `{ip}`, `{reg:AX}`, `{token}` (the step's `token.val`), `{addr}`, `{data}`, `{cycles}`,
`{clocks:µs}` (cycles at this clockHz as time), `{dev}` (the `Story.devName`), `{part}` (the chip
name of the model, `Story.N`, story.js:14-24). Values resolve on the machine **at the time of the
step** (`dispatchUntil(s.t)`, map §3.3), never at lesson load.

### 3.4 The writing model

Every caption is written to four rules and checked by `tools/learn-check.mjs` (lengths, term
order) and by a reader (the rest).

1. **Headline first.** One sentence, at most 80 characters (the present median is 167, brief
   table). It names the actor and the action in plain words: "The CPU sends the address 10102h to
   the memory." Values the learner should look at are in bold (`<b>`), at most two per headline.
   It never starts with "Now" or "Then" and never ends with a colon.
2. **Details on request.** At most two sentences, at most 220 characters together (the split rule
   explain3d.js:429-437 cut at 230 for a reason). Details carry the mechanism ("ALE tells the 8282
   latches to hold the address, because the same wires carry data next"), the numbers with units,
   and the "why" (the gap texts of map §5.6). Under Auto they appear after the headline's read
   time (section 5).
3. **A term gets its meaning the first time.** `terms: ['bus']` on the beat that first needs the
   word; `terms.js` holds `{ term, short (≤ 90 chars), long, first: lessonId }`; the caption card
   prints `short` in the term line the first time in this visit (`learn:terms` set) and makes the
   word a dotted underline afterwards (the `BlockPanel.termTip` glossary, blocks.js:1567-1704, is
   wrapped for the drawn words; the learner terms are new content, map §5.3 verdict). A lesson may
   introduce at most **three** new terms, and the outline shows them ("you will meet: bus, clock,
   latch").
4. **Names live on the board, not in the sentence.** The chip's part number (8282, 74LS573) is a
   label on the mesh (the board's `unitTag` and DOM labels, board3d.js:7489, 7705); the caption
   says "the latches". A machine-specific name enters a caption only in the lesson about that part.

What a caption must **not** say (the checklist for authors):

- No hex without the plain number the first time it matters ("41h, the code of the letter A";
  "B8000h, the start of the video memory"); never `0x`; always the `h` suffix (as the texts do).
- No acronym before its lesson: not "BIU", "EU", "ALE", "IVT", "MESI", "RAT", "ROB", "TLB" until
  the beat with `terms` for it; before that, "the part that fetches", "the calculator".
- No clock counts in the 8086 course before lesson 2 (the clock); no "T1/T2/T3" outside lesson 2
  and Explore; no cycle counts on the P6 (the model shows at least one clock per instruction, map
  §5.1 caveats), only "earlier/later".
- No "as we saw" or references to another lesson by number; a lesson stands alone.
- No sentence about a part that is not lit on the stage at that beat.
- No prose about what the learner "should" do; instructions are buttons ("Press a key on the
  screen").
- Nothing the emulator did not compute: no "in a real PC it would be faster" unless the machine
  facts table (map §5.1 caveats) is the source and the sentence says "in this model".

### 3.5 A full example lesson: 8086 lesson 1

```js
const LESSONS_8086 = [
{
  id: '8086-01-letter', machine: '8086', n: 1,
  title: 'A letter on the screen',
  idea: 'A program is bytes in memory; the CPU fetches them, decodes each into an action, and one byte written to the video memory makes a letter.',
  minutes: 4,
  program: {
    src: [
      '        org 0x100',
      'start:  mov ax, 0xB800     ; the segment of the video memory',
      '        mov es, ax',
      "        mov al, 'A'        ; 41h, the code of the letter A",
      '        mov [es:0], al     ; the first cell of the screen',
      '        ret',
    ].join('\n'),
    cpu: '8086', entry: 'start', until: null, monitor: false, sound: false,
  },
  story: { prefetch: 'parallel', burst: 'fold' },
  stops: ['DECODER', 'REGISTERS', 'ADDRESS ADDER'],
  beats: [
    { look: [], cap: { h: 'This is a PC of 1978. One chip runs the program; the others help it.',
                       d: 'The board is real: every chip here has a job in the next four minutes.' },
      terms: ['program'] },
    { look: ['cpu', 'clk'], cap: { h: 'The 8086 is the CPU. It reads bytes and does what they say.',
                       d: 'Inside it, one part fetches the bytes and talks to the board; another part decodes and executes them.' },
      terms: ['CPU'] },
    { look: ['ramE', 'ramO'], cap: { h: 'The program is 12 bytes in the RAM, from address 10100h.',
                       d: 'An assembler turned the five lines at the top into these bytes. The CPU sees only the bytes.' },
      terms: ['assembler', 'RAM'] },
    { look: ['cga', 'monitor'], cap: { h: 'The video card has its own memory. What is in it is what the screen shows.',
                       d: 'The card reads its memory 60 times a second and draws one character for each pair of bytes. The screen is empty now.' } },
    { say: true, focus: ['cpu'], cap: { h: 'Instruction 1: mov ax, 0B800h. Put the number B800h in the register AX.',
                       d: 'Its bytes are B8 00 B8. A register is a small cell of the CPU\'s own memory; AX is one of 14.' },
      terms: ['register'] },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Decode', stop: 'DECODER', cap: { h: 'The decoder reads B8: "put the next two bytes in AX".',
                       d: 'The bytes were fetched ahead of time, so the CPU does not wait for them.' } },
        { at: 'inside:Execute', stop: 'REGISTERS', cap: { h: 'AX gets <b>{reg:AX}</b>. Nothing left the chip: this happened inside.' } },
    ] },
    { say: true, cap: { h: 'Instruction 2: mov es, ax. Copy AX into ES, a register that names a place in memory.',
                       d: 'ES x 16 = B8000h. The CPU uses it as the start of the video memory in the next instructions.' },
      terms: ['segment register'] },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Execute', cap: { h: 'ES gets <b>{reg:ES}</b>. Two bytes, 8E C0, did all of it.' } } ] },
    { say: true, cap: { h: "Instruction 3: mov al, 'A'. Put 41h, the code of the letter A, in AL.",
                       d: 'AL is the low half of AX. Letters are numbers to the machine: A is 41h = 65.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Execute', cap: { h: 'AL gets <b>41h</b>. The CPU has the letter; the screen does not.' } } ] },
    { say: true, cap: { h: 'Instruction 4: mov [es:0], al. Write AL to the first cell of the video memory.',
                       d: 'This one leaves the chip: a byte must travel over the board to the card.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Address calculation', stop: 'ADDRESS ADDER', cap: { h: 'The CPU adds ES x 16 and 0: the address is <b>B8000h</b>.',
                       d: 'Twenty address wires can name 1 MB; B8000h is where the video card listens.' }, terms: ['address'] },
        { at: 'bus:memw:vram:addr', cap: { h: 'The address <b>B8000h</b> goes out on the bus, to every chip on the board.' }, terms: ['bus'] },
        { at: 'bus:memw:vram:cmd',  cap: { h: 'The command says "write". Only the video card answers to B8000h.',
                       d: 'The card in the slot decodes the address itself; the memory chips stay quiet.' } },
        { at: 'bus:memw:vram:data', cap: { h: 'The byte <b>41h</b> travels to the card and lands in its first cell.' } },
    ] },
    { screen: true, cap: { h: 'The card reads its memory 60 times a second. The first cell holds 41h: the letter appears.',
                       d: 'The second byte of the cell, 07h, is the colour: grey on black.' } },
    { check: { ask: 'What did the CPU send to the video card?', options: ['The byte 41h', 'The letter A as a picture', 'The word "mov"'],
               answer: 0, why: 'The CPU only moves bytes. The card turns 41h into the picture of an A.' } },
    { step: 1, rest: 'hide', show: [
        { at: 'inside:Execute', cap: { h: 'RET: the program ends and gives control back to the system.',
                       d: 'The system prints "[program ended]" and stops the CPU.' } } ] },
    { say: true, focus: ['screenTL'], cap: { h: 'Four instructions, <b>{clocks}</b> clocks: <b>{clocks:µs}</b>. That is all a program does: move bytes and calculate.',
                       d: 'Next: where the bytes came from, and what a clock is.' } },
  ],
  further: ['hello', 'vram'],
},
// ... lessons 2-9
];
```

Sixteen beats plus the folded steps: about 20 beats on the strip, 2 minutes at Auto, 4 minutes
with reading pauses. The lines "That is all a program does…", "The letter appears" are the kept
narratives (map §5.5).

### 3.6 What the director does with a lesson (the contract)

1. `Playback.assemble(program.src, { cpu })` → bytes; on error the lesson screen shows the
   assembler message and a link to the Workbench (map §3.3 `assemble`).
2. `Playback.load(program)`, `Playback.boot({ watchBios: false })` (the BIOS hand-off, map §3.2;
   428,861 clocks in ~90 ms), then if `until`, `startFF('skip', ip => ip === addrOf(until))`.
3. Beats play in order. A *step* beat calls `Playback.beginInstr(now)`, `buildStory(events,
   lesson.story)`, resolves `show`/`hide`/`rest` against `story.steps`, then for each shown step
   `enterStep(i)` with the budget of section 5, then `finishInstr()`. `repeat` runs the next N
   instructions with `beginInstr` + `dispatchUntil(Infinity)` + `finishInstr` and no beats (the
   views still get every event, map §3.3 fan-out).
4. A *screen* beat uses the hide-and-reveal: `vget` the video RAM before the step, `vset` it back,
   and reveal at the beat (explain3d.js:140-154, 296-298, 399-402 lifted into `director.js`).
5. A *check* beat pauses Auto, renders the question in the caption card, resolves `from` on the
   machine, shuffles, reveals `why` on answer, stores `learn:score:<lessonId>` (right/first-try).
6. The end: `learn:done:<model>` gains the lesson id, the facts table (`learn:facts:<model>`)
   records `{ lessonId, clocks, instructions, busCycles }` from `Playback.play` / `takeStats`
   for the "What changed, in numbers" lessons.

---

## 4 The curriculum for v1

Forty lessons. "Prog" is the program: **new** = 4-12 lines written for the lesson (the six most
important are written out below the tables, the rest are described precisely enough to write);
**SAMPLES id** = an existing sample, with `until: label` when the lesson starts inside it.
"Check" is the question's subject. The last column is the map gap(s) the lesson closes (§5.6).
The `until:` labels named for cut samples (`a20_on`, `try_gp`, `go_paged`, `second_write`,
`divide`, `time_l2`) do not exist in bios.js yet: a lesson that starts inside a sample carries its
own copy of the sample's `src` with that one label added, so `SAMPLES` stays untouched.

### 4.1 The 8086 course (9 lessons, the base course)

| # | Title | The idea in one sentence | Prog | Beats it plays | Check | Gaps |
|---|---|---|---|---|---|---|
| 1 | A letter on the screen | A program is bytes; the CPU fetches, decodes and executes them; one byte written to video memory makes a letter. | new: the letter program (3.5) | tour-lite (4 looks), decode + execute per instruction, the write's addr/cmd/data, the screen | what the CPU sent (41h) | 1, 15 |
| 2 | Where the bytes come from: the bus and the clock | A fetch is a bus cycle in T states: address out, command, data back; the 8284A's clock ticks every 210 ns. | the same program, `story.prefetch: 'full'` | the clock card (look 'die:clk'), first fetch T1/T2/T3 with stops at the 8282 latch, 8288, 74LS138, 8286; the queue filling; the folded later fetches | how many address wires (20) | 5, 6, 8 |
| 3 | Registers and the ALU | Registers are the CPU's own 14 cells; the ALU adds and subtracts; the flags remember what the result was like. | new: `mov al,200 / add al,100 / mov bl,7 / sub bl,7 / mov cl,al / ret` | Execute stops at REGISTERS, ALU (adder card), FLAGS after ADD (CF=1) and SUB (ZF=1) | AL after ADD (44 = 2Ch, from `reg:AL`) | 3, 25 |
| 4 | Memory and addresses: segments | A 20-bit address is segment x 16 + offset; a word is two bytes in the even and odd banks. | new: `mov ax,1234h / mov [200h],ax / mov bx,[200h] / mov al,[201h] / ret` | ADDRESS ADDER stop (DS x 16 + 0200 = 10200h), the word write (both banks lit, BHE), the byte read from the odd bank | physical address of DS:0200 (10200h) | 4, 7, 25 |
| 5 | Deciding: flags and jumps | A conditional jump reads one flag; a taken jump empties the prefetch queue. | new: five stars loop (below) | first iteration in full (DEC → FLAGS stop, JNZ → QUEUE flush stop), `repeat: 4` silent, the fall-through JNZ | how many times JNZ jumps back (4) | 8, 9 |
| 6 | Remembering: the stack | SP points at memory the CPU uses to remember; CALL pushes the return address, RET pops it. | new: two CALLs to a `put` routine (below) | CALL: the push (bus write to SS:SP, stack card), the jump; RET: the pop; the second CALL faster (repeat) | what is on the stack after CALL | 10 |
| 7 | Interrupts: the timer ticks | A device asks; the CPU finishes its instruction, gets a vector from the 8259A, runs a handler, returns with IRET. | new: hook INT 1Ch, count ticks, `hlt` loop (below) | the vector write to 0000:0070, HLT (halt status), the IRQ step, two INTA cycles (vector 08h on the data bus), the push of FLAGS/CS/IP, the handler's write to the screen, IRET | who told the CPU to stop (the 8253 through the 8259A) | 11 |
| 8 | Talking to devices: ports and the keyboard | IN and OUT reach a device register by port number, not an address; the keyboard's byte waits in port 60h. | new: `hlt` then `in al,60h`, show the scan code (below) | HLT, IRQ1, the INTA pair, `in al,60h` as an I/O read (IORC, the 8255 lit), the OUT to the speaker port 61h that clicks | where IN AL,60h reads from (an 8255 port) | 12, 29 |
| 9 | The BIOS, and what changed since 1978 | The ROM holds a program that runs first and offers services through the vector table; the numbers of this machine set the baseline for the next five. | SAMPLES `hello` | INT 10h: the vector read at 0000:0040 (ROM address), the far jump to F000h (ROM chips lit), the ROM's write to B8000h; `repeat` the rest; the facts card | where INT 10h finds its handler (the vector table) | 14, 24, 26 |

Programs written out:

```nasm
; lesson 5: five stars
        org 0x100
start:  mov ax, 0xB800
        mov es, ax
        mov cx, 5           ; how many stars
        xor di, di
        mov al, '*'
again:  mov [es:di], al     ; one star
        add di, 2           ; the next cell (two bytes each)
        dec cx              ; sets ZF when CX reaches 0
        jnz again           ; jump back while ZF = 0
        ret
```

```nasm
; lesson 6: a routine, called twice
        org 0x100
start:  mov ax, 0xB800
        mov es, ax
        xor di, di
        mov al, 'H'
        call put            ; push the return address, jump to put
        mov al, 'i'
        call put
        ret
put:    mov [es:di], al
        add di, 2
        ret                 ; pop the return address into IP
```

```nasm
; lesson 7: the timer ticks
        org 0x100
start:  xor ax, ax
        mov es, ax
        cli
        mov word [es:0x1C*4], tick   ; the vector of INT 1Ch: offset
        mov [es:0x1C*4+2], cs        ;                        and segment
        sti
wait:   hlt                          ; wait for the next interrupt
        cmp byte [n], 4
        jb wait
        ret
tick:   inc byte [n]
        push ax
        push es
        mov ax, 0xB800
        mov es, ax
        mov al, [n]
        add al, '0'
        mov [es:0], al               ; the count on the screen
        pop es
        pop ax
        iret
n:      db 0
```

(12 lines of code plus the handler; the beat list shows the first tick in full and repeats the
rest silently.)

```nasm
; lesson 8: a key
        org 0x100
start:  mov ax, 0xB800
        mov es, ax
        sti
        hlt                 ; wait: the keyboard raises IRQ1
        in al, 0x60         ; the scan code, from the 8255 port A
        mov ah, 0x0F
        mov [es:0], ax      ; show it as a character
        in al, 0x61
        or al, 3
        out 0x61, al        ; the speaker clicks on
        ret
```

The lesson's *say* beat before HLT is the one place in the course that asks the learner to act
("Press any key on the screen"); with no key after 8 seconds under Auto, the director calls
`Playback.pokeKeyboard()` (map §3.3) after typing the key itself via `CrtScreen.typeText`
(crt.js:185-216) and says so.

### 4.2 The 80286 course (6 lessons)

| # | Title | The idea in one sentence | Prog | Beats it plays | Check | Gaps |
|---|---|---|---|---|---|---|
| 1 | The same letter, a new board | The same 12 bytes run unchanged; the bus is 2 clocks wide (Ts/Tc) at 8 MHz, and different chips do the latching and the commands. | the letter program | tour-lite (the 82284, 82288, 74LS573, 74LS245, PAL16L8 lit and named), the write's Ts/Tc, the facts card vs the 8086 | how many clocks a bus cycle takes (2 + 1 wait) | 26, 27 |
| 2 | Four units at once | The bus unit fetches, the instruction unit decodes three ahead, the address unit adds the base, the EU executes: four things per clock. | new: the five stars loop | Address calculation by the address unit (die stop), the decoded-queue card (6 + 3), the loop's first iteration | which unit adds the base (the address unit) | 20 |
| 3 | Above 1 MB: the A20 line | With 24 address wires a segment can reach past 1 MB; the A20 gate keeps the old wrap for old programs. | SAMPLES `a20`, `until: a20_on` | the write at FFFF:0010 landing at 00000h (A20 off), port 92h (the gate, the 8042 lit), the same write landing at 100000h (the XRAM card lit) | where FFFF:0010 lands with A20 off (00000h) | 4, 7 |
| 4 | Protected mode: a descriptor instead of x 16 | A segment register becomes a selector into a table of descriptors; the descriptor cache holds base and limit. | new: build one GDT entry for B8000h, LGDT, LMSW, load ES with the selector, write a letter, `hlt` (12 lines) | LGDT (the bus read of the table), LMSW (the Protection step, MSW.PE), the Descriptor step (base B8000h, limit FFFFh), the write | what ES holds now (a selector, from `reg:ES`) | 17 |
| 5 | Protection: a fault caught | An access past a limit does not happen; the CPU raises #GP and a handler decides. | SAMPLES `pm286`, `until: try_gp` | the write past the limit, the Protection step ("limit check fails"), INT 0Dh through the IDT, the handler's message, the 8042 reset back to real mode | what stopped the write (the limit check) | 17 |
| 6 | What changed, in numbers | The AT's new chips (8042, MC146818, two 8259As, 8254) and the numbers of the letter program on both machines so far. | new: read the RTC seconds via ports 70h/71h and show them (8 lines) | the OUT/IN pair to the RTC (the 8042 and the RTC lit), the second 8259A on IRQ 8, the facts table (8086 vs 80286: clocks, µs, bus cycles) | which machine took fewer clocks | 26, 27 |

### 4.3 The 80386 course (6 lessons)

| # | Title | The idea in one sentence | Prog | Beats it plays | Check | Gaps |
|---|---|---|---|---|---|---|
| 1 | The same letter, 32 bits wide | Registers are 32 bits and addresses too, but this board's data bus is 16 bits: a dword needs two cycles. | the letter program with `mov eax` in place of `mov ax` (5 lines) | the 32-bit REGISTERS card, the 16-byte queue, the write; the facts card | how many bus cycles a dword takes here (2) | 26 |
| 2 | 32-bit numbers and the barrel shifter | Adding and shifting 32-bit values takes one pass through a wider ALU and a shifter that moves any count in one step. | new: `mov eax,12345678h / add eax,eax / shl eax,4 / mov ebx,eax / ret` | Execute stops at the 32-bit ALU, the shift card, FLAGS | EAX after SHL (`reg:EAX`) | 3 |
| 3 | Paging: an address translated | A linear address is looked up in two tables to find the page frame; the program never sees the real address. | SAMPLES `paging`, `until: go_paged` | CR3 load, CR0.PG (Protection step), the page walk (two reads: PDE, PTE, the PAGING unit lit), the write landing at B8000h | which table entry pointed at B8000h (the PTE) | 18 |
| 4 | The TLB: a cache of translations | The second access to the same page skips the walk; the CPU also marks the page accessed and dirty. | same, `until: second_write` | the TLB hit step (no bus read), the A and D bits in the PTE (a memory read shows 63h) | how many bus reads the walk took this time (0) | 18, 19 |
| 5 | Growing the instruction set: bits | New instructions (BSF, BT, MOVZX, SHLD) do in one step what took loops before. | SAMPLES `bits`, `until: start` (whole) | Decode of a two-byte opcode (0F prefix), BSF's Execute (the shifter card), `repeat` the printing | what 0Fh at the start of an opcode means (a second opcode byte) | 2 |
| 6 | What changed, in numbers | Six units, paging, 32 bits, 25 MHz: the letter program on three machines. | the letter program | the facts table, one look per unit of the die (die:cpu with the six units named) | which change made the program faster (the clock) | 26 |

### 4.4 The 80486 course (6 lessons)

| # | Title | The idea in one sentence | Prog | Beats it plays | Check | Gaps |
|---|---|---|---|---|---|---|
| 1 | The same letter, with a cache | The first fetch misses and fills a 16-byte line in a burst; the rest of the program comes from the cache without the bus. | the letter program | the cache miss step (set/tag card), the burst's first transfer in full and the other 7 as one beat (plan 'quick', explain3d.js:380-386), the later Decodes "from the cache", the write-through | where instruction 3's bytes came from (the cache) | 19 |
| 2 | Why a cache: locality | Programs touch the same bytes again soon; a cache keeps recent lines so the second pass costs no bus cycles. | new: sum 8 words of an array twice, `repeat` the second pass | pass 1: misses and fills; pass 2: hits (no bus); the `{cycles}` of each pass in the caption | bus cycles in the second pass (0) | 19 |
| 3 | The pipeline: five stages | Five instructions are in the chip at once, one per stage, so a simple instruction finishes every clock. | new: six independent `mov`/`add` (6 lines) | the PIPELINE card (PF D1 D2 EX WB) at each Decode, the clocks per instruction | how many clocks a simple instruction takes in a full pipeline (1) | 20 |
| 4 | Write-through, and turning the cache off | A write updates the cache and the memory; with CR0.CD set, every access is a bus cycle again. | new: a write, then `mov eax,cr0 / or eax,60000000h / mov cr0,eax / wbinvd`, then a read (9 lines) | the write-through step, the CR0 Protection step, the read that misses with no fill | what WBINVD did (emptied the cache) | 19 |
| 5 | The FPU moves on chip | Floating point no longer crosses the bus to a coprocessor; FLD and FADD are inside steps. | new: `fld1 / fld1 / faddp / fistp word [n] / mov ax,[n] / ret` | the FPU stack card, the FADD inside step with clocks, the store | what the 8087 needed that the 486 does not (the bus) | 16 |
| 6 | What changed, in numbers | Cache, pipeline, on-chip FPU, 33 MHz: four machines compared. | the letter program | the facts table; the die tour (die:cpu) | why the second run of a program is faster (the cache) | 26 |

### 4.5 The Pentium course (6 lessons)

| # | Title | The idea in one sentence | Prog | Beats it plays | Check | Gaps |
|---|---|---|---|---|---|---|
| 1 | The same letter, two at a time | Two simple instructions go through the U and V pipes in the same clock; the letter gets a colour byte so the pair is visible. | the six-line P5 letter program (explain3d.js:11-18) | the pairing step ("U pipe: it pairs with…"), the two writes, the 64-bit bus card | which instructions paired (3 and 4) | 21 |
| 2 | Pairing needs independence | A pair forms only when the second instruction does not need the first's result. | new: 4 independent ADDs, then 4 chained ADDs on AX (10 lines) | the pipe steps: paired, then "U pipe alone: V reads a register that U writes" | why the chained ADDs do not pair (a dependency) | 21 |
| 3 | Branch prediction: the BTB learns | The chip guesses where a jump goes before it knows; a wrong guess costs clocks, and a 2-bit counter learns the pattern. | new: the five stars loop | JNZ's first BTB step (no entry: wrong), the second (right), the fall-through at the end (wrong again) | how many guesses were wrong (2) | 22 |
| 4 | Two caches and a 64-bit bus | Code and data have their own 8 KB caches; a miss fills 32 bytes in four transfers; MESI states say who owns a line. | new: sum 8 dwords of an array (8 lines) | the data cache miss, the 4-transfer burst (first full, 3 folded), the MESI state on the card | how many bytes one burst brings (32) | 19 |
| 5 | The FDIV bug | A table in the divider had five missing entries; one division in a few billion came out wrong after the fourth digit. | SAMPLES `fdiv`, `until: divide` | the FDIV inside step (39 clocks), the printed result with the bug switch on (`fdivBug: true`, map §5.1) | which digit is first wrong (the 5th) | 16, 24 |
| 6 | What changed, in numbers | Superscalar, predicted, 66 MHz: five machines compared. | the letter program | the facts table; the die tour (U/V, BTB, the two caches) | which lesson's idea saved the most clocks here (pairing) | 26 |

### 4.6 The Pentium Pro course (7 lessons)

| # | Title | The idea in one sentence | Prog | Beats it plays | Check | Gaps |
|---|---|---|---|---|---|---|
| 1 | The same letter, in µops | Each instruction is decoded into µops, renamed, executed when ready on five ports, and retired in program order; the L2 is in the package. | the six-line P5 letter program | Decode (three decoders, 4-1-1), the RAT step, the uop steps on ports, the ROB retire step, the write through L1 to the FSB | what retires the results in order (the reorder buffer) | 23 |
| 2 | Why out of order: a slow divide | Twenty ADDs that do not need the DIV's result run while the divider works. | new: `mov ecx,7 / div ecx` then 4 independent ADDs, 8 lines | the DIV µop on port 0 (39 clocks), the ADD µops "pass 1 older µop" | why the ADDs did not wait (they needed nothing from DIV) | 23 |
| 3 | Renaming: EAX is many registers | Writes to the same register get different ROB entries, so they do not wait for each other. | new: four independent `mov eax,[a+i]; add eax,1; mov [b+i],eax` groups (12 lines) | the RAT steps ("renames EAX to ROB n") | how many ROB entries EAX used (from the RAT step) | 23 |
| 4 | Results in order: the reorder buffer | Out-of-order results wait in the ROB and retire oldest first, so the program sees a normal machine. | same program | the rob steps (retire n µops at once), the RRF card | why retirement is in order (so faults land on the right instruction) | 23 |
| 5 | Three levels of memory | L1 hits cost 3 clocks, L2 hits 7, memory 22 more; the same read costs one of the three. | SAMPLES `l2`, `until: time_l2` | an L1 miss → L2 hit (the back-side bus, the L2 lit), an L2 miss → FSB burst | how many clocks an L2 hit costs here (7) | 19 |
| 6 | No branch, no guess: CMOV | A conditional move replaces a jump, so nothing has to be predicted. | new: `cmp eax,ebx / cmovl eax,ebx` in a 6-line max | Decode of CMOV (two µops), no BTB step; contrast beat with `jl` version (repeat) | what CMOV avoids (a wrong prediction) | 22 |
| 7 | What changed, in numbers: 1978 to 1995 | Six machines, one program: clocks, time, bus cycles, and the idea each chip added. | the letter program | the full facts table (six columns) with a look at each idea's unit on the P6 die | which idea each machine added (match) | 26 |

### 4.7 Order of writing for v1

Must (the page is publishable): the 8086 course (9), lesson 1 and the last lesson of every other
machine (10), the 80486 cache pair (2) and the Pentium Pro µop pair (2): 23 lessons. Should:
the remaining 17. The data model, the director and the tools do not change between the two sets.

---

## 5 The pacing model

All times are on the animation clock (`AnimClock`/`animNow()`, theme.js:340-345); pause is
`AnimClock.setScale(0)`; the tools' virtual clock works unchanged (map §6.5).

| Quantity | Value | Where it comes from |
|---|---|---|
| Headline read time `readH` | 700 ms + 40 ms per character; 60-80 chars → 3.1-3.9 s | the present `readMs` is 900 + 50/char lead + 22/char rest (app.js:393-396); the headline replaces the lead |
| Details read time `readD` | 30 ms per character, added only when details are open (Auto opens them after `readH`) | |
| Beat time (Auto) | `max(anim, readH) + 600 ms hold`, then `+ readD` if details; target 2-4 s, hard cap 6 s (details clipped to the cap, never the animation) | brief principle 2 |
| Beat time (manual) | until Next; the animation completes in `anim`; nothing waits on reading | |
| `anim` of a *step* beat | the board's `traceDur(s, budget)` with `budget = min(readH, 3000)`; `xpTime = { travel: 0.8, work: 0.7, read: 1 }` | board3d.js:6313 `traceDur`, 6317/6337 `xpTime` |
| Token travel per bus leg | ≤ 1.6 s (so addr + cmd + data across three beats ≈ 4 s of motion) | the budget above; `xpEase` 6489 |
| Unit stop (dwell with card) | 900 ms each, at most 2 per beat; a lit unit without a stop adds 0 | `stop` in the beat; `chipVisit` 6064 |
| Camera move | at most one per beat, 1100 ms during a step (`tr.camB`), 1300 ms `flyTo` for a *look*; none when the beat stays in the same chip (`focus: 'keep'`) | board3d.js:6696-6720 (1100 ms), 4212 (1300 ms) |
| Folded fetches | one beat of `readH` for the whole group ("3 bytes came in ahead: B8 00 B8") | `plan()` groups, explain3d.js:340-389 |
| Line fill (486+) | first transfer a full beat; the remaining 7 (486) or 3 (P5/P6) one beat of 1.5 s | explain3d.js:380-386 |
| `repeat` iterations | 0 beats; the board still receives events (`event(e)`) so the signals flicker; ≤ 12 ms of CPU per frame | `ffFrame` chunks, map §3.3 |
| Auto start | the first beat waits for a click on Next or Auto; Auto never starts by itself | |
| Reduced motion | `anim = 0`, camera instant, beat = `readH + 600` | `setReducedMotion`, board3d.js:3970 |
| Lesson length | 20-45 beats; 2-4 min at Auto, 4-7 min reading and answering; the outline's `minutes` = round(beats x 3.5 s + checks x 25 s / 60) | |
| Check | pauses Auto; no time limit; Next after the answer | |
| First 3D frame | shown behind a "The board is loading" caption; the first beat's `look` starts when `BoardView.frame` has rendered once (≈ 1-2 s on a GPU laptop, ≈ 10 s under swiftshader, map §6.5) | |

Worked example, 8086 lesson 1 at Auto: 4 looks (3.6 + 1.3 s camera each ≈ 4.9 s → 19.6 s), 5
says (3.4 s → 17 s), 9 step beats (≈ 3.6 s → 32 s), 1 screen (3.9 s), 1 check (learner), end
card (5 s): 78 s of Auto plus the check, well under the 4-minute label with reading pauses.

Speed control: `1x ▾` offers 0.75x, 1x, 1.5x, 2x — a multiplier on `readH`/`readD` only (the
explain3d `set.read` idea, explain3d.js:132, 663); the animation budget keeps its cap so it never
outlasts the text. The seven-stop slider and `speedAt` stay in the Workbench (map §3.6).

---

## 6 The reuse plan and the module list

### 6.1 Verdict per existing module (from map §1, with this design's use)

| Module | Verdict (map) | Used by | Notes |
|---|---|---|---|
| `src/vendor/three.module.min.js` | as-is | stage | wrapper kept (build.mjs:59-71) |
| `src/asm/*` | as-is | playback (`Asm86.assemble`, assembler.js:1344-1404) | lesson programs and the BIOS at run time |
| `src/core/*` | as-is | playback | load order as build.mjs:13-36; `p6ooo.wasm.js`, `x86core.wasm.js`, `x86wasm.js` **skipped** in the learn page (map §1.3: only `run()` without trace on 386+ uses them; 21 MB per machine otherwise) — the Workbench's "run" uses JS `run()` |
| `src/core/bios.js` | as-is | playback, outline (`SAMPLES`) | |
| `src/ui/theme.js` | extract → small change | all | add `applyTheme(model)` (map §1.4); stays the first UI file |
| `audio.js` | as-is | stage (speaker) | |
| `crt.js` | as-is | stage, workbench | `new CrtScreen(host, machine, onKey)` (crt.js:185-216) |
| `editor.js` | as-is | workbench only | |
| `dock.js` | extract | explore (regs strip), workbench (full dock behind adapter) | lift `DOCK_REGS*`, `read/fmt/show/setReg/renderFlags/hot` (~120 lines) into `regstrip.js` |
| `disks.js` | extract | workbench | `makeFont8x8` moves to `src/core/font8x8.js` (map §1.4, needed by `buildRom` app.js:141) |
| `tips.js`, `sfx.js` | as-is, optional | shell | `Tips.init` **not** called in the lesson ring (global title hijack); `Sfx` on, respects `a86:sfx` |
| `story.js` | as-is | playback | one model per load (decision, section 8) |
| `blocks.js`, `unitfx.js` | as-is | board (through BoardView), terms (`termTip`) | |
| `die.js` | facade | stage (phone fallback, `focus: 'die:…'` via the board), workbench Die tab | `api.{model, machine, reducedMotion, select, clock, motion}` (map §2.7.6) |
| `timing.js`, `memmap.js` | facade | workbench only | not loaded until the Workbench opens? No: one-scope build loads all; they are constructed lazily |
| `board3d.js` | facade for `BoardView`; extract `specs.js`, `dieplans.js`; **drop** `RunnerView` after lifting `dieKit` | stage | the one change to a "keep" file: 17 lines of `dieKit` (board3d.js:8182) into `BoardView`, and `window.__app.machine` at 1954-1955 → a `machine` parameter (map §7 risks 2, 3) |
| `explain3d.js` | extract ideas; not loaded | director | engine loop/next/pause (477-524, 634-677), `plan` (335-389), `stepMs` rules (407-441), `vget/vset` (140-154) are re-implemented against `Playback` + `BoardView`; the texts of §5.5 move to `l*.js` |
| `topview.js` | drop | — | |
| `app.js` | extract engine → `playback.js`; shell rewritten; **not loaded** | | map §3 |
| `style.css` | extract tokens 1-188, base 189-220, components (`.btn .card* .tip .crt kbd .sr-only`), board labels 720-766 | `learn.css` imports them by copy | map §1.4 |
| `index.html` | rewrite → `learn.html` | | keep `/*STYLE*/`, `/*SCRIPT*/`, `<title>`, viewport, `color-scheme`, favicon |
| `src/explain/*` | drop | — | its captions are in the lessons (map §5.5) |

### 6.2 The new page's modules (`src/learn/`, all LF)

| File | Est. lines | Role | Reuses | Depends on |
|---|---|---|---|---|
| `learn.html` | 130 | the skeleton: header, stage host, monitor host, card, controls, outline dialog, workbench panes (hidden), `/*STYLE*/` `/*SCRIPT*/` | index.html head (1-24), help texts (389-424) mined into the `?` dialog | — |
| `learn.css` | 450 | tokens + palettes copied from style.css:1-188; the lesson layout (fixed 36/524/160 px rows); `.bv-top, .bv-pop, .bv-focus, .bv-hint { display: none }`; the phone rule | style.css | — |
| `facade.js` | 90 | `makeFacade(machine, play, crt, views, opts)` → `{ api, emit }`; the rAF loop (`tick`), the `ResizeObserver` drivers, the fan-out order | map §2.8 sketch; `AnimClock` | playback |
| `playback.js` | 520 | the engine lifted from app.js (map §3.3): `buildRom assemble load boot setBreakpoints lineOf beginInstr dispatchUntil finishInstr stepInstr skipHalt stuck pokeKeyboard buildStory enterStep traceNext/Prev/Go readMs stepMs tracing startFF ffFrame ffStop fastFrame tick explainFrame speedAt setSpeedPos start pause on/emit`; events `reset instr event caption step instrEnd ff fast audio speed mode traceClear status announce` | app.js:133-151, 1081-1146, 1329-1402, 638-655, 499-545, 546-611, 1460-1499, 4-30, 1197-1216, 393-398, 519-524, 1556-1578 | core, story |
| `specs.js` | 470 | the step→spec builders lifted from board3d.js:1626-2082 (`tcard`, `CPU_TRACE`, `GLUE`, `DRAM/ROM/IO/BUSCTL_TRACE`, `FDC/SOUND/CACHE/PAGE_CARD`, `P5/P6_CARDS`) with `machine` as a parameter | board3d | theme, story |
| `dieplans.js` | 160 | `DIE_PLANS`, `DIE_OF`, `dieLayout`, `drawInterior` lifted from board3d.js:733-856, 912, 1291 | board3d | theme |
| `stage.js` | 220 | owns the stage host: builds `BoardView` (or `DieView` fallback), the monitor box with `CrtScreen`, the `dieEntry`/`xpSet`/`xpFocus`/`xpCard` calls; `covers()` data for `xpCovers` (card row, monitor) | board3d.js `BoardView` ⟨xp⟩ surface (map §4.4), die.js, crt.js | facade |
| `director.js` | 480 | plays a lesson: resolves selectors, drives `Playback` and `stage`, the beat queue with Auto/Next/Back, `repeat`, hide-and-reveal, the facts recorder; emits `beat(i, beat, cap)` for the card | explain3d.js engine ideas (477-524, 634-677), `plan` (335-389) | playback, stage, lessons, caption |
| `caption.js` | 170 | renders `{ h, d, t }`, resolves `{…}` templates on the machine, bolds `xxxxh`, the first-use term line, the details toggle; `readH/readD` | `splitLead` (theme.js:349), the `cap.length > 230` split rule (explain3d.js:429-437) reversed into a lint | terms |
| `checks.js` | 110 | the question card, `from:` resolution (`reg:`, `mem:`, `flag:`), shuffle, `why`, score storage | — | playback |
| `terms.js` | 260 (content) | ~80 learner terms `{ term, short, long, first }`; wraps `BlockPanel.termTip` for drawn words | blocks.js:1567-1704 | — |
| `units.js` | 320 (content) | one table keyed by `(part, label)` → `{ title, short, long, dieId }` merged from `DIE*_INFO` (die.js:21-38, 1919-1942, 2781-2810, 4036-4060, 5266-5287, 6831-6854), the 85 `tcard` subs and `DIE*_3D` bridges (map §5.2) | die.js, specs.js | — |
| `lessons/l8086.js` … `l80686.js` | 6 files, 300-450 each (content) | the lessons of section 4 | `SAMPLES` texts (bios.js), the §5.5 narratives | — |
| `outline.js` | 160 | the chooser dialog, progress, "go further", the machine menu | index.html:25-60 menu lines | lessons, storage |
| `explore.js` | 220 | the Explore ring: every story step of every instruction, Back/Next/Next instr, the register strip | `regstrip.js` | playback, stage |
| `regstrip.js` | 140 | the "registers that changed" strip lifted from dock.js (`DOCK_REGS*`, `read/fmt/hot`) | dock.js:3-40, 55-100 | theme |
| `workbench.js` | 340 | the Workbench ring: `CodeEditor`, the full `StateDock` behind an adapter object `{ machine, is286..is686 }`, tabs hosting `DieView`/`TimingView`/`MemoryView` with the facade, the disks panel markup (index.html:142-219 verbatim) behind `{ machine, bootDisk, announce, running, bootMode }` | dock.js, disks.js, timing.js, memmap.js, editor.js | facade, playback |
| `shell.js` | 330 | the router (`?cpu= &lesson= &ring=`), the first visit, the header, keyboard (Space/→/←/A/Esc), `applyTheme(model)`, storage `learn:*`, `window.__learn = { play, stage, director, lesson }` for the tools | app.js `syncUrl` idea (212-223), `URL_PARAMS` (theme.js:142-188) | everything |
| `src/core/font8x8.js` | 60 | `makeFont8x8` moved from disks.js:402 (core-side, the ROM build needs it) | disks.js | — |
| `build.mjs` (edit) | +30 | a `PAGES` table `{ entry, scripts, styles, out }` and `--page learn` | build.mjs:11-56, 85 | — |
| `tools/launch.mjs` | 40 | shared puppeteer launcher (`--no-sandbox` when uid 0, `CHROME`) | map §6.5 | — |
| `tools/learn-check.mjs` | 260 | Node: assembles every lesson program, boots, runs the beats headless **without DOM** (a stub stage that logs), asserts every selector matches, caption lengths, term order, `minutes`; then, with `--browser`, the smoke test of section 7 | `loadCore()` (tools/vgapng.mjs:12-19), story.test.mjs skeleton | — |
| `tools/names.mjs` | 50 | lists top-level names of the shared prefix to catch collisions (map §7 risk 9) | — | — |

Total new code ≈ 3,900 lines plus ≈ 2,800 lines of content; the learn page ≈ 3.5 MB before
gzip without the wasm cores, topview and explain3d (map §6.1).

### 6.3 The facade (exact members, from map §2.2 and §2.8)

```js
const api = {
  machine,                                   // the real Machine (every frame dereferences it, map §7 risk 7)
  get model() { return CPU_MODEL; },          // die/timing/memmap pick their subclass by it
  get video() { return VIDEO_CARD; },         // unread by views, kept for symmetry
  get reducedMotion() { return opts.reducedMotion; },
  get mode() { return play.mode; },           // 'explain' | 'fast' (Workbench run)
  get running() { return play.running; },
  get clock() { return play.play ? play.play.clock : 0; },
  get tracing() { return play.tracing; },     // true while a lesson step or Explore plays
  get motion() { return AnimClock.scale; },
  get stepMs() { return play.stepMs; },       // the member the old api lacked (board3d.js:7038, 7041, 7075)
  get crtCanvas() { return opts.monitor3d ? crt.fullCanvas : null; },   // only when the 3D monitor shows the screen (crt.js:216)
  get crtVersion() { return crt ? crt.version : 0; },
  select(kind, id) { emit('select', { kind, id }); },
  view(name) { return views[name]; },         // 'board' | 'die' | 'timing' | 'memory'; never 'runner'
  on(name, cb) { … },                         // 'follow' | 'select' | 'mode' | 'reset'
};
```

Drivers (map §2.7.1): one rAF loop → `play.tick(now, dt)`, `crt.frame(now)`, `activeView.frame
(animNow(), dt * AnimClock.scale)`; a `ResizeObserver` per host → `view.resize()`; `play.on
('event')` → `regstrip.event(e)` then every constructed view's `event(e, clockMs)`; `traceDur(s,
ms)` always before `traceStep(story, i, info)` in the same frame (map §7 risk 5). `window.__app`
is replaced by `window.__learn`; the two guarded back-doors (board3d.js:1954-1955, 2180;
die.js:1279-1287) are satisfied by `window.__app = { machine, selectTab: name => shell.ring
('workbench', name) }` — three lines, until `specs.js` removes the first.

### 6.4 The build entry

`node build.mjs --page learn --out dist/learn.html`: `PAGES.learn = { entry: 'src/learn/learn.html',
styles: ['src/learn/learn.css'], scripts: [vendor, asm, core minus the three wasm files,
'src/core/font8x8.js', bios, vgabios, theme, audio, crt, editor, dock, disks, sfx, story, blocks,
unitfx, die, timing, memmap, dieplans, specs, board3d, playback, facade, stage, caption, terms,
units, checks, lessons/*, regstrip, director, explore, workbench, outline, shell] }`. The present
page is `PAGES.index` unchanged. `pages.yml` gets one line (map §6.3); the learn page becomes
`_site/index.html` and the present page `_site/workbench.html` only when the owner says so.

---

## 7 Work packages and milestones

### 7.1 M0: the interfaces (1 person, 2 days, everything else waits for this)

Written as files that compile, with stubs:

- `playback.js` **signature only** (the class of map §3.3 with every method throwing
  `'M0 stub'`), and the event names.
- `facade.js` complete (it is 90 lines).
- The lesson schema of section 3 as `src/learn/schema.md` plus `lessons/l8086.js` with lesson 1
  written out (section 3.5) — the fixture every package tests against.
- `stage.js` interface: `build(host, api)`, `look(ids, o)`, `die(key)`, `card(spec, dur)`, `step
  (story, i, info)`, `clear()`, `covers()`, `screen(on)`.
- `director.js` interface: `load(lesson)`, `next()`, `back()`, `auto(on)`, `goto(i)`, `on('beat'|
  'end'|'check', cb)`; `caption.js`: `render(cap, ctx)`, `readMs(cap)`.
- The selector grammar and the frozen list of story titles (`tools/learn-check.mjs` skeleton).
- `build.mjs` `PAGES` table and `tools/names.mjs`, so every package builds its own page from day 1.

### 7.2 Parallel packages (disjoint files)

| WP | Files | Person-days | Done when |
|---|---|---|---|
| WP1 Engine | `playback.js`, `src/core/font8x8.js` | 4 | `tools/learn-check.mjs` (Node, no DOM) boots the 8086, runs lesson 1's program instruction by instruction, builds stories, and the `hello` screen text matches `tests/machine.test.mjs:71` |
| WP2 Stage | `stage.js`, `specs.js`, `dieplans.js`, the `dieKit` move, `learn.css` board rules | 6 | a page with only the stage plays lesson 1's fixture from a **scripted** director (a 40-line script of `look`/`step` calls) in the browser; `tools/unitsheet.mjs`-style output proves `specs.js` draws the same cards as before |
| WP3 Director | `director.js`, `caption.js`, `checks.js` | 5 | with a **logging stage stub** (no WebGL), lesson 1 plays every beat in Node under the virtual clock; beat times match section 5 within 5 % |
| WP4 Content | `terms.js`, `units.js`, `lessons/l8086.js` (9), first and last lessons of the other five | 8 | `learn-check` passes (selectors, lengths, terms, minutes); a reader has read every caption aloud once |
| WP5 Shell | `learn.html`, `learn.css`, `shell.js`, `outline.js`, first visit, machine menu | 4 | the six screens of section 2 at 1280 x 720 with the M0 stubs; keyboard; storage; `?cpu=&lesson=` |
| WP6 Rings | `explore.js`, `regstrip.js`, `workbench.js` | 5 | Explore plays `hello` step by step with Back; the Workbench runs the old dock, editor, disks, timing and memory against the facade |
| WP7 Tools | `tools/launch.mjs`, `tools/learn-check.mjs --browser`, `pages.yml` line | 3 | headless: load `dist/learn.html`, wait for the first 3D frame, play lesson 1 at Auto under `__vt`, assert the last caption and `learn:done`, 30 s budget (map §6.5) |

### 7.3 Milestones

- **M1 (end of week 1): the stage plays a lesson.** WP1 + WP2 + WP3 joined: lesson 1 on the 8086
  in the browser, Next/Auto, no outline, no checks. Retires risks 1-7 of the map (section 8).
- **M2 (week 2): the 8086 course.** WP4's nine lessons, checks, the outline, the first visit.
  A person who does not know assembly does the course while someone watches (the reading test of
  section 8, risk A).
- **M3 (week 3): six machines.** The other five `l*.js` (first and last lessons), the machine
  menu, the facts table, `applyTheme`. Explore and Workbench rings (WP6).
- **M4 (week 4): the remaining 17 lessons**, the phone fallback, `pages.yml`, publish as
  `learn.html` next to the present page.
- **M5: make it the front door** (`_site/index.html`) when the owner accepts M4.

---

## 8 Risks and how each is retired early

Map risks first (numbers are §7's), then this proposal's own (letters).

1. **One model per page load.** Decision: **reload per machine**, machine in the URL and
   `a86:cpu`. The cross-model story is the recorded facts table, not two machines on a page. No
   change to story.js or board3d.js parsing. Retired in M0 by writing `shell.js`'s router that way.
2. **The 553 KB IIFE.** `specs.js` and `dieplans.js` are lifted in WP2 with the `machine`
   parameter; verified by a contact sheet of every `tcard` before and after (`tools/unitsheet.mjs`
   pattern). Until then WP2 runs against the unmodified file with `window.__app = { machine }`.
3. **Die dives need `RunnerView.dieKit`.** The 17 lines (board3d.js:8182) move into `BoardView`
   in WP2's first day; the M1 acceptance includes a step beat that dives into the CPU die.
4. **The Explain director is not instantiable.** It is not instantiated: `director.js` is written
   against `Playback` and the ⟨xp⟩ surface (map §4.4) and takes covers as data (`stage.covers()`
   → `xpCovers` patched to accept an argument: one small change).
5. **`api.stepMs`.** On the facade from day 1 (section 6.3); `traceDur` before `traceStep`
   asserted in `stage.step()`.
6. **Loop and clock ownership.** One rAF in `facade.js`; the M1 smoke test asserts a rendered
   frame count > 0 after 2 s and a moving camera during a *look*.
7. **Every frame dereferences `machine`.** The facade passes the real `Machine`; never a stub.
8. **Headless verification.** `tools/launch.mjs` in WP7's first day; the director's Node test
   needs no browser at all (WP3), so most of the checking never touches swiftshader.
9. **Name collisions.** `tools/names.mjs` runs in `build.mjs --page learn` and fails the build on
   a duplicate; all new files use a `L_`/`Learn` prefix for top-level names.
10. **Scattered content.** `units.js` and `terms.js` are written in WP4 before lesson 2; the
    lessons reference units only by board label and the tools check every label against
    `DIE_PLANS`.
11. **Global side effects.** `Tips.init` not called; `Sfx` loaded (it is the click sound); the
    `URL_PARAMS` write of `a86:cpu` is wanted; injected styles are fine; `fullCanvas` read only
    when `monitor: false`.
12. **Spec identity.** `director.js` builds specs once per step (`s._j` cache, map §2.7.3) and
    never shares a story between Explore and Lesson (each ring has its own `Playback.play`).
13. **Storage across pages.** All new keys under `learn:`; the Workbench's editor loads a lesson
    program into `a86:src` only on "Edit in Workbench" with the previous text kept as
    `learn:srcBackup`.
14. **Memory.** No wasm cores in the learn page; one `Machine` per page; `decapAll` never called
    (lessons open one die at a time via `dieEntry`).
15. **Phone / no GPU.** `BoardView.ok === false` or width < 900 → `DieView` stage (section 2.7);
    the smoke test runs once with WebGL disabled.

Own risks:

- **A. The reading model is a guess** (700 + 40/char). Retire in M2 with five readers of the
  8086 course: measure their Next presses against Auto's beat times; adjust the two constants,
  which live in one place (`caption.js`).
- **B. Selectors are strings the story owns** (`inside:Execute`, `bus:memw:vram:data`). A rename
  in story.js silently empties a beat. Retired by `learn-check`'s frozen title list (M0) and by
  the rule that an unmatched `at` fails the check, and by the story test staying green.
- **C. Forty lessons is a lot of content.** Retired by the must/should split (23 first, section
  4.7), by the schema making a lesson 60-120 lines of data, and by `'story'` captions (a lesson
  can ship with `Story`'s sentences and be polished later).
- **D. Folding hides mechanisms a later lesson needs.** Each course's lesson 2 (8086) or 1
  (others) shows the fetches in full once; Explore always shows everything. Checked by reading
  the 8086 course in order (M2).
- **E. The P6 story text is noisy for a learner** (µop ids, absolute clocks). The `stepMs` rewrite
  rules (explain3d.js:409-413) become `caption.js` filters for `'story'` captions on the P6; the
  P6 lessons override most captions anyway.
- **F. The recorded facts table depends on the learner having run the program on earlier
  machines.** The table shows "not run yet — open the 8086" for missing columns and ships with the
  measured defaults from `tools/learn-check.mjs` (Node) as grey values, so it is never empty.

---

## 9 What is deliberately left out

- The Runner view, pop-out windows, PiP, the phone layout beyond the fallback of 2.7, sound
  design (brief non-goals). `topview.js` is not loaded.
- The DOS boot as a lesson (gap 14 beyond INT 10h and the vector table); the disks stay a
  Workbench tab.
- The 8087 as a lesson in the 8086 course (gap 16 is taught on the 486, lesson 5, where it is an
  inside step; `pi`/`quad` are "go further" in Explore).
- VGA lessons (`plasma`, `wheel`, `modex`) and Sound Blaster lessons (`sb`): the learn page is
  CGA and `soundCard: false` unless a lesson asks; both remain samples in Explore/Workbench.
- Two machines side by side; a lesson that switches machine without a reload.
- Virtual 8086 mode, task switching, the 4 MB page, RDTSC/PMC measurement lessons (samples in
  Explore); protected mode on the 386+ beyond paging.
- Scores, accounts, certificates, timers; a check is one question with a "why", nothing more.
- Translation; captions are English sentences like the existing texts.
- A visual editor for lessons; a lesson is an object literal and `learn-check` is its editor.
- Rewriting the 131 die texts, the 85 unit sentences or the 120 glossary rules: `units.js` and
  `terms.js` merge and wrap them; the "why" is written in the lessons, where the learner meets it.
