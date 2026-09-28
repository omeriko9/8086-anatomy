// The purpose-built programs of the 8086 lessons (interface 7 of the design):
//   LEARN_PROGRAMS_8086[key] = { src, cpu, expect: RegExp | null, keys?: [] }
// A program enters this table only after a Node run (tools/learn-check.mjs runs each one).
// Hex is written with the h suffix, as the captions write it (0B800h, never 0xB800).
const LEARN_PROGRAMS_8086 = {
  // The letter program: 12 bytes, four instructions traced, then RET ends it (measured on the
  // 8086: 8 + 2 + 8 + 16 = 34 clocks for the four instructions).
  letter86: { cpu: '8086', expect: /\[program ended\]/, src: [
    '        org 100h',
    '        mov ax, 0B800h      ; the video memory segment',
    '        mov es, ax',
    "        mov al, 'A'         ; 41h, the code of the letter A",
    '        mov [es:0], al      ; the first cell of the screen',
    '        ret                 ; back to the PSP: INT 20h ends the program',
  ].join('\n') + '\n' },
};
