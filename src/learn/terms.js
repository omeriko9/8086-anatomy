// The learner's terms: the words a lesson defines the first time it needs them (rule 3.5.3 of
// the design). short is one line (at most 90 characters) for the term line of the caption card;
// long is for the glossary panel; acronym names the letters that rule 3.5.6 guards.
// Writers append the entries their lessons need; keys are unique across the file.
const LEARN_TERMS = {
  program: { short: 'A list of instructions for the CPU, kept in memory as bytes.',
    long: 'A program is bytes in memory. The CPU reads them one instruction at a time, does what each one says, and moves on to the next.', acronym: null },
  register: { short: 'A small cell of memory inside the CPU; the 8086 has eight general ones.',
    long: 'Registers hold the values an instruction works on. They are read and written in one clock, much faster than memory. AX, BX, CX and DX can be used as halves: AH and AL, and so on.', acronym: null },
  'segment register': { short: 'A register whose value times 16 is the start of a 64 KB window into the 1 MB memory.',
    long: 'CS is for code, DS for data, SS for the stack, ES for extra. An address is always segment times 16 plus an offset.', acronym: null },
  address: { short: 'The number of a memory cell; the 8086 has 20 address wires, so 1 MB of them.',
    long: 'Every byte of memory has a number, its address. The CPU puts an address on the bus to say which cell it wants; the memory chips or the video card answer.', acronym: null },
  bus: { short: 'Wires shared by every chip; one chip talks at a time, the others listen or stay quiet.',
    long: 'Address wires say where, data wires carry the value, control wires say read or write and when. On this board the 8288 makes the control signals.', acronym: null },
  'video memory': { short: 'The memory on the video card; what is in it is what the screen shows.',
    long: 'The text screen is 2000 cells of two bytes: the character code and its colour. The card reads them 60 times a second and draws the picture. Writing a byte there changes the screen.', acronym: null },
  queue: { short: 'Up to 6 bytes the CPU fetched ahead, so it rarely waits for the bus.',
    long: 'The bus interface unit fills it whenever the bus is free; a jump throws its contents away.', acronym: null },
  clock: { short: 'The tick every step of the machine follows; 4.77 million a second on this board.',
    long: 'The 8284A divides a 14.318 MHz crystal by 3. Each bus cycle takes four clocks; each instruction a few or many.', acronym: null },
  latch: { short: 'A chip that holds a value on its outputs after a strobe, so the wires can be reused.',
    long: 'The 8282 latches hold the address for the whole bus cycle, because the same CPU wires carry the data next.', acronym: null },
  flag: { short: 'One bit that says what the last result was like: zero, negative, too big.',
    long: 'The flags register has nine of them. A conditional jump reads one flag and decides.', acronym: null },
  BIU: { short: 'The bus interface unit: the part of the CPU that fetches code and talks to the board.',
    long: 'It owns the address adder, the segment registers, the queue and the bus control logic.', acronym: 'BIU' },
  EU: { short: 'The execution unit: the part of the CPU that decodes and executes instructions.',
    long: 'It owns the registers, the ALU, the flags and the microcode. It takes its bytes from the queue that the BIU fills.', acronym: 'EU' },
};
