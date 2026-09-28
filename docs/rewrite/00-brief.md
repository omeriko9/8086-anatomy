# The rewrite: brief

## Why

8086 Anatomy emulates six x86 PCs exactly and can animate every signal on the board and inside
the dies. The page around it grew into an expert workbench. A person who opens it to learn how a
PC runs a program meets, on one screen: a code editor, a 3D board with two toolbars and a legend,
a trace bar, four cards of hex, a CGA screen, a speed slider with three meanings, and a top bar
with Reset / Run / Clock. The one part built for that person, the Explain story, covers four
instructions and then drops them into the workbench.

Measured on the Pentium page (v51, 1440 x 900):

| Fact | Value |
|---|---|
| Caption of a trace step | median 167 characters, max 485 |
| Time of a step at the default speed | 10 to 25 s (a bus step visits about 7 units, 3 s each) |
| Steps of one `lodsb` | 15 (12 of them near-identical transfers of one burst) |
| Controls visible on the first screen | about 45 |
| Explain program | the same four 8086 instructions on all six machines |

The v52 pass (reading pace, folded bursts, layered captions, a simple view, six instructions on
the Pentium) improved the numbers but not the shape. The owner's decision: rewrite the page from
scratch as a page for the learner, and reuse everything worth reusing (the cores, the assembler,
the board and its meshes, the die floor plans, the unit drawings, the story steps, the CRT, the
disks).

## Who it is for

A curious person who wants to know how an x86 PC works from the inside: what the chips on the
board do, what happens clock by clock when a program runs, what a Pentium does differently from an
8086. They can read, they may know a little programming, they do not know assembly. They have
twenty minutes, then maybe two hours over several visits. A second audience, the expert who wants
the workbench, must still be served, but not first.

## Principles

1. One thing at a time. A screen shows one idea: one caption, one focus on the board or the die,
   one action to take. Everything else is a click away, not on the screen.
2. The learner sets the pace. Next is the main control. Auto-play is an option that respects the
   reading time. An animation never blocks the reading, and never lasts longer than the caption
   needs (target: 2 to 4 s per beat, at most 6).
3. Layers, not walls. Headline first, details on request. Names of chips and units appear where
   they are on the board, not in the sentence. A term gets a one-line meaning the first time.
4. Stable layout. The stage, the caption card and the controls never move or resize from beat to
   beat. No floating panels that cover what the caption talks about.
5. The machine is real. Every value shown comes from the emulator; every lesson runs a real
   program. The learner can open any lesson's program, change it and run it.
6. Each machine has its own story. What is new in this chip is a lesson, not a sentence.
7. Progressive disclosure to the workbench: Lesson (default) -> Explore (the same stage with the
   trace, Next and Back, the registers that change) -> Workbench (the editor, the dock, the memory,
   the bus timing, the disks: the old page's powers).
8. Works at 1280 x 720 and on a laptop without a GPU; degrades on a phone (the die and the caption,
   without the 3D board) rather than breaking.

## What the design must deliver

- The information architecture and the screens (a few ASCII wireframes are enough): the lesson
  screen, the outline / chooser, Explore, Workbench, the machine chooser, the first visit.
- The lesson data model: how a lesson is written (program, beats, focus, captions, checks) so that
  writing a new lesson is writing data, not code. The generic instruction beats come from the story
  steps; a lesson overrides captions and chooses which units get a stop.
- The curriculum: the lessons of each machine for v1 (titles, the program of each, the idea each
  teaches, 5 to 9 per machine), and which existing SAMPLES they come from.
- The pacing model with numbers: beat time, animation time, camera moves, unit stops, Auto.
- The reuse plan: which modules are used as-is, with a facade (its exact members), extracted, or
  rewritten; the module list of the new page with file names and estimated sizes; the build entry.
- The milestones, in an order that lets several people implement in parallel on disjoint files,
  with the interfaces between them fixed first.
- Risks and how each is retired early.

## Non-goals for v1

The pop-out windows, the phone layout beyond "does not break", the DOS boot UI beyond keeping the
disks panel reachable from the Workbench, the Runner view, sound design.

## Constraints

- One HTML file, no server, no build step beyond `node build.mjs` (a second entry is fine).
- No frameworks. Plain JS in one function scope, as the build joins the files.
- Keep the emulator cores, the assembler, story.js, blocks.js, unitfx.js and the tests untouched
  unless a change is small and clearly needed.
- Line endings: files keep what they have (`* -text` in .gitattributes); new files use LF.
- All texts in plain English sentences, as the existing texts are.
