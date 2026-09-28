// The purpose-built programs of the later machines' lessons (interface 7 of the design):
//   LEARN_PROGRAMS_LATER[key] = { src, cpu, expect: RegExp | null, keys?: [] }
// WP6 fills this table (letterP5, rtc, shl32, sum2, pipe5, cd, fadd, pairs, sum8); each program
// enters it only after a Node run. The Pentium letter program is here so that the P5 and P6
// lesson 1 can be written against it.
const LEARN_PROGRAMS_LATER = {
  letterP5: { cpu: '586', expect: /\[program ended\]/, src: [
    '        org 100h',
    '        mov ax, 0B800h      ; the video memory segment',
    '        mov es, ax',
    "        mov al, 'A'         ; 41h, the code of the letter A",
    '        mov bl, 1Fh         ; the colour: white on blue',
    '        mov [es:0], al      ; the first cell of the screen',
    '        mov [es:1], bl      ; its colour byte',
    '        ret                 ; back to the PSP: INT 20h ends the program',
  ].join('\n') + '\n' },
};
