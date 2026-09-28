// 8086 lesson 1, the letter on the screen (section 3.6 of the design). It lives in its own file
// while the other 8086 lessons are written into l8086.js; index.js merges the two lists.
// Changes from the design's listing, measured in Node (tools/learn-check.mjs):
//   - the stop of instruction 2 (mov es, ax) is '8086/SEGMENT REGS': CPU_TRACE.inside files a
//     segment-register write under SEGMENT REGS, so '8086/REGISTERS' would stop nothing there;
//     the key is added to `units`.
const LESSONS_8086_LETTER = [
{
  id: '8086-01-letter', machine: '8086', n: 1,
  title: 'A letter on the screen',
  idea: 'A program is bytes in memory; the CPU fetches, decodes and executes them; one byte written to the video memory makes a letter.',
  minutes: 4, gaps: [1, 15, 25],
  terms: ['program', 'register', 'segment register', 'address', 'bus', 'video memory'],
  program: { program: 'letter86' },
  options: {}, story: { prefetch: 'parallel', burst: 'fold' }, from: { instr: 0 },
  units: ['8086/DECODER', '8086/REGISTERS', '8086/SEGMENT REGS', '8086/ADDRESS ADDER', '8086/BUS CONTROL'],
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
        { at: 'inside:Decode', stop: '8086/SEGMENT REGS', cap: { h: 'ES gets <b>{reg:ES}</b>. Two bytes, 8E C0, did all of it.',
                       d: 'This instruction is one step: a value moves between two registers inside the chip.' } } ] },
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
];
