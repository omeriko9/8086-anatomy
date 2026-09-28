// The content module of the learner page: what each unit of a die is, keyed 'PART/LABEL' in the
// exact DIE_PLANS spelling of board3d.js (after the BLK_* remap; the 8086 has no remap). Each entry:
//   die: the die.js unit id (the phone fallback selects it), title: the kicker's name,
//   short: one line (the tag and the kicker), long: the DIE_INFO text, why: the learner's why,
//   aliases: the trace-model spellings that land on this block through BLK_*.
// This first version holds the 8086 units the letter lesson stops at and the other 8086 units;
// tools/content-merge.mjs (7.7 of the design) is meant to write the full six-machine table from
// die.js DIE*_INFO, the tcard subs of board3d.js and the DIE*_3D bridges, and to fill `aliases`
// from the BLK_* tables. Its output is edited by hand afterwards.
const LEARN_UNITS = {
  '8086/DECODER': { die: 'dec', title: 'Decoder',
    short: 'Reads the opcode bytes and decides what the instruction does.',
    long: 'The decoder takes the next bytes from the queue and turns them into the steps the execution unit must do: which registers, which operation, which memory address.',
    why: 'A program is only bytes; something must read them and know what each one means.', aliases: [] },
  '8086/REGISTERS': { die: 'regs', title: 'Registers',
    short: 'Eight 16-bit cells: AX, BX, CX, DX, SP, BP, SI, DI.',
    long: 'The general registers are the small memory inside the CPU. AX, BX, CX and DX can also be used as two 8-bit halves (AH and AL, and so on).',
    why: 'A register is read in one clock; a memory cell needs a whole bus cycle. Values that are used often live here.', aliases: [] },
  '8086/SEGMENT REGS': { die: 'segs', title: 'Segment registers',
    short: 'CS, DS, SS, ES: each names a 64 KB window of the 1 MB memory.',
    long: 'A segment register times 16 is the start of a segment. Code comes from CS, data from DS, the stack is in SS, and ES is the extra segment, often used for the video memory.',
    why: 'Sixteen-bit registers can name only 64 KB; the segment registers let the CPU reach 1 MB.', aliases: [] },
  '8086/ADDRESS ADDER': { die: 'sigma', title: 'Address adder',
    short: 'Segment times 16 plus the offset gives the 20-bit address.',
    long: 'Adds a segment register shifted left by four to a 16-bit offset. The 20-bit sum goes to the address pins.',
    why: 'Sixteen-bit registers can name 64 KB; the shift lets them reach 1 MB.', aliases: [] },
  '8086/BUS CONTROL': { die: 'busctl', title: 'Bus control',
    short: 'Drives the address and data pins and tells the board what kind of cycle this is.',
    long: 'The bus control logic puts the address on the pins, shows the status of the cycle on S2-S0 for the bus controller, and passes data in and out.',
    why: 'The CPU cannot talk to a chip directly: it puts an address and a value on shared wires, and the board does the rest.', aliases: [] },
  '8086/QUEUE': { die: 'queue', title: 'Instruction queue',
    short: 'Holds up to 6 bytes fetched ahead.',
    long: 'The BIU prefetches up to 6 bytes while the EU executes. It fetches a word from an even address. A jump flushes the queue and the prefetched bytes are lost.',
    why: 'Fetching ahead keeps the execution unit busy: the bus is slow, the execution unit is not.', aliases: [] },
  '8086/ALU': { die: 'alu', title: 'ALU',
    short: 'Adds, subtracts, compares and shifts 8- or 16-bit values.',
    long: 'The arithmetic and logic unit does the calculation of an instruction: ADD, SUB, AND, OR, shifts and compares, and it sets the flags from the result.',
    why: 'Every calculation of a program, however large, is made of these small operations.', aliases: [] },
  '8086/FLAGS': { die: 'flags', title: 'Flags',
    short: 'Nine bits that say what the last result was like.',
    long: 'Zero, carry, sign, overflow, parity and auxiliary carry describe the last ALU result; the direction, interrupt and trap flags control the CPU.',
    why: 'A conditional jump reads one flag: this is how a program decides.', aliases: [] },
  '8086/INTERRUPTS TIMING': { die: 'intr', title: 'Interrupt logic',
    short: 'Takes the interrupt request and starts the handler.',
    long: 'When a device raises INTR and interrupts are on, the CPU finishes its instruction, reads the vector from the interrupt controller and jumps to the handler through the vector table.',
    why: 'The world does not wait for the program: a key or a timer tick must be able to interrupt it.', aliases: [] },
  '8086/MICROCODE ROM': { die: 'rom', title: 'Microcode ROM',
    short: 'The small program inside the CPU that runs each instruction.',
    long: 'Each instruction is a short sequence of micro-steps stored in a 512-word ROM inside the chip. The decoder picks the sequence, the ROM drives the units.',
    why: 'A complex instruction can be built from simple steps without more hardware.', aliases: [] },
};

const LearnContent = {
  unit(key) { return LEARN_UNITS[key] || null; },
  term(word) { return (typeof LEARN_TERMS !== 'undefined' && LEARN_TERMS[word]) || null; },
  // the 68 chip tooltips of the board, read at run time (never copied)
  chip(id) {
    const INFO = typeof BoardKit !== 'undefined' && BoardKit.INFO;
    if (!INFO || !id) return null;
    return INFO[id] || INFO[String(id).replace(/\d+$/, '')] || null;
  },
  // the terms of LEARN_TERMS that appear in text and are not in seen
  firstUse(text, seen) {
    const out = [], t = String(text || '').toLowerCase();
    if (typeof LEARN_TERMS === 'undefined') return out;
    for (const k in LEARN_TERMS) if (!seen.has(k) && t.includes(k.toLowerCase())) out.push(k);
    return out;
  },
  gloss(text, spec) { return typeof BlockPanel !== 'undefined' && BlockPanel.termTip ? BlockPanel.termTip(text, spec) : null; },
};
