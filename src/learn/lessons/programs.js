// The programs of the 8086 lessons (design 3.1, interface 7). Every program here was assembled
// and run in Node by tools/learn-check.mjs before it entered a lesson; `expect` is what the text
// screen must show once the program has ended (the BIOS prints "[program ended]" after RET).
// Hex is written with the h suffix, never 0x. The letter program is the one of design 3.6.
const LEARN_PROGRAMS_8086 = {
  // 8086-01-letter, 8086-02-bus: one letter in the video memory (12 bytes, 4 instructions and RET)
  letter86: {
    cpu: '8086',
    src: `; A letter on the screen
        org 100h

        mov ax, 0B800h      ; the video memory starts at B800:0000
        mov es, ax
        mov al, 'A'         ; the code of the letter A is 41h
        mov [es:0], al      ; the first cell of the screen
        ret                 ; back to the system: INT 20h ends the program
`,
    expect: /^A[^\n]*\n[\s\S]*\[program ended\]/,
  },
  // 8086-03-alu: an add that overflows 8 bits and a subtract that gives zero
  alu: {
    cpu: '8086',
    src: `; Registers, the ALU and the flags
        org 100h

        mov al, 200         ; AL = C8h
        add al, 100         ; 300 does not fit in 8 bits: AL = 2Ch, the carry flag is 1
        mov bl, 7
        sub bl, 7           ; 0: the zero flag is 1
        mov cl, al          ; copy the result
        ret
`,
    expect: /\[program ended\]/,
  },
  // 8086-04-segs: a word written to DS:0200 and read back, then one byte of it from the odd bank
  segs: {
    cpu: '8086',
    src: `; Segments: a word in memory and its two bytes
        org 100h

        mov ax, 1234h
        mov [200h], ax      ; DS x 16 + 200h = 10200h: two bytes, one in each bank
        mov bx, [200h]      ; read the word back
        mov al, [201h]      ; the high byte alone, from the odd bank
        ret
`,
    expect: /\[program ended\]/,
  },
  // 8086-05-jumps: five stars from a loop; JNZ jumps back four times
  stars: {
    cpu: '8086',
    src: `; Five stars: a loop that counts down
        org 100h

        mov ax, 0B800h
        mov es, ax
        xor di, di          ; DI = 0: the first cell of the screen
        mov cx, 5           ; the count
        mov al, '*'
next:   mov [es:di], al     ; one star
        add di, 2           ; the next cell (a character and its colour)
        dec cx              ; one less to do; the zero flag says when CX reaches 0
        jnz next            ; not zero: jump back
        ret
`,
    expect: /^\*\*\*\*\*[^\n]*\n[\s\S]*\[program ended\]/,
  },
  // 8086-06-stack: "Hi" through two CALLs of one routine
  call2: {
    cpu: '8086',
    src: `; Hi: one routine, called twice
        org 100h

        mov ax, 0B800h
        mov es, ax
        xor di, di
        mov al, 'H'
        call put            ; push the return address, jump to put
        mov al, 'i'
        call put
        ret

put:    mov [es:di], al     ; one letter at the cell DI
        add di, 2
        ret                 ; pop the return address, jump back
`,
    expect: /^Hi[^\n]*\n[\s\S]*\[program ended\]/,
  },
  // 8086-07-timer: a handler on the timer's user vector (INT 1Ch) counts four ticks on the screen
  tick: {
    cpu: '8086',
    src: `; The timer ticks: count four of them on the screen
        org 100h

start:  xor ax, ax
        mov es, ax          ; ES = 0: the vector table
        cli                 ; no interrupt while the vector changes
        mov word [es:1Ch*4], tick
        mov [es:1Ch*4+2], cs
        sti
wait:   hlt                 ; sleep until the next interrupt
        cmp byte [n], 4
        jb wait
        ret

; INT 1Ch: the system's timer handler calls this 18.2 times a second
tick:   push ax
        push ds
        push es
        push cs             ; the handler runs with the system's DS:
        pop ds              ; make DS our own segment before touching n
        inc byte [n]
        mov ax, 0B800h
        mov es, ax
        mov al, [n]
        add al, '0'         ; the digit of the count
        mov [es:0], al
        pop es
        pop ds
        pop ax
        iret

n:      db 0
`,
    expect: /^4[^\n]*\n[\s\S]*\[program ended\]/,
  },
  // 8086-08-ports: wait for a key with the BIOS, then show it
  key: {
    cpu: '8086',
    src: `; A key from the keyboard, through the BIOS
        org 100h

        mov ax, 0B800h
        mov es, ax
        mov ah, 0           ; service 0: wait for a key
        int 16h             ; AL = the key's character
        mov [es:0], al
        ret
`,
    keys: ['k'],
    expect: /^k[^\n]*\n[\s\S]*\[program ended\]/,
  },
};
