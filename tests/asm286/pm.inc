; Shared macros for the 80286 protected-mode test programs (NASM, cpu 286).
; The test harness loads each program at physical BASE (010000h) and starts it in real
; mode at 1000:0000 with DS = ES = SS = 1000h, SP = FFF0h.

BASE    equ 0x10000

; Segment descriptor: base (24 bits), limit, access byte
%macro DESC 3
  dw %2
  dw (%1) & 0xFFFF
  db ((%1) >> 16) & 0xFF
  db %3
  dw 0
%endmacro

; Gate: offset, selector, word count, access byte
%macro GATE 4
  dw %1
  dw %2
  db %3
  db %4
  dw 0
%endmacro

; Access bytes
ACC_CODE0   equ 0x9A    ; present, DPL 0, code, readable
ACC_XO0     equ 0x98    ; present, DPL 0, code, execute-only
ACC_CONF0   equ 0x9E    ; present, DPL 0, conforming code, readable
ACC_CODE3   equ 0xFA    ; present, DPL 3, code, readable
ACC_DATA0   equ 0x92    ; present, DPL 0, data, writable
ACC_RO0     equ 0x90    ; present, DPL 0, data, read-only
ACC_EDOWN0  equ 0x96    ; present, DPL 0, data, expand-down, writable
ACC_DATA3   equ 0xF2    ; present, DPL 3, data, writable
ACC_NPDATA  equ 0x12    ; NOT present, DPL 0, data, writable
ACC_TSS     equ 0x81    ; present, DPL 0, available 286 TSS
ACC_LDT     equ 0x82    ; present, DPL 0, LDT
ACC_CALLG3  equ 0xE4    ; present, DPL 3, call gate
ACC_TASKG0  equ 0x85    ; present, DPL 0, task gate
ACC_TASKG3  equ 0xE5    ; present, DPL 3, task gate
ACC_INTG0   equ 0x86    ; present, DPL 0, interrupt gate
ACC_TRAPG0  equ 0x87    ; present, DPL 0, trap gate
ACC_INTG3   equ 0xE6    ; present, DPL 3, interrupt gate
ACC_TRAPG3  equ 0xE7    ; present, DPL 3, trap gate

; TRY instr: if instr faults, the fault handler continues at the next instruction.
%macro TRY 1+
  mov word [resume], %%next
  %1
%%next:
%endmacro

; Save FLAGS and AX in two result words
%macro SAVEFA 2
  pushf
  pop word [%1]
  mov [%2], ax
%endmacro

; Fault stubs: they push a vector number (and a zero error code when the CPU pushes none).
%macro EXC_NOERR 1
exc_%1:
  push word 0
  push word %1
  jmp exc_common
%endmacro
%macro EXC_ERR 1
exc_%1:
  push word %1
  jmp exc_common
%endmacro

; exc_common: log 8 words (vector, error code, IP, CS, FLAGS, SP, SS, 0) at log[log_n] and
; continue at [resume]. SP and SS are only meaningful after a stack switch.
; It needs SEL_DATA (a DPL 0 data segment with base BASE).
%macro EXC_COMMON 0
exc_common:
  push bp
  mov bp, sp
  push ax
  push bx
  push ds
  mov ax, SEL_DATA
  mov ds, ax
  mov bx, [log_n]
  shl bx, 4
  mov ax, [bp+2]
  mov [log+bx], ax
  mov ax, [bp+4]
  mov [log+bx+2], ax
  mov ax, [bp+6]
  mov [log+bx+4], ax
  mov ax, [bp+8]
  mov [log+bx+6], ax
  mov ax, [bp+10]
  mov [log+bx+8], ax
  mov ax, [bp+12]
  mov [log+bx+10], ax
  mov ax, [bp+14]
  mov [log+bx+12], ax
  inc word [log_n]
  mov ax, [resume]
  mov [bp+6], ax
  pop ds
  pop bx
  pop ax
  pop bp
  add sp, 4
  iret
%endmacro

%macro EXC_STUBS 0
  EXC_NOERR 0
  EXC_NOERR 1
  EXC_NOERR 2
  EXC_NOERR 3
  EXC_NOERR 4
  EXC_NOERR 5
  EXC_NOERR 6
  EXC_NOERR 7
  EXC_ERR 8
  EXC_NOERR 9
  EXC_ERR 10
  EXC_ERR 11
  EXC_ERR 12
  EXC_ERR 13
  EXC_NOERR 14
  EXC_NOERR 15
  EXC_NOERR 16
  EXC_COMMON
%endmacro

; IDT entries 0..16 as interrupt gates to the stubs
%macro IDT_EXC 0
  GATE exc_0, SEL_CODE, 0, ACC_INTG0
  GATE exc_1, SEL_CODE, 0, ACC_INTG0
  GATE exc_2, SEL_CODE, 0, ACC_INTG0
  GATE exc_3, SEL_CODE, 0, ACC_INTG0
  GATE exc_4, SEL_CODE, 0, ACC_INTG0
  GATE exc_5, SEL_CODE, 0, ACC_INTG0
  GATE exc_6, SEL_CODE, 0, ACC_INTG0
  GATE exc_7, SEL_CODE, 0, ACC_INTG0
  GATE exc_8, SEL_CODE, 0, ACC_INTG0
  GATE exc_9, SEL_CODE, 0, ACC_INTG0
  GATE exc_10, SEL_CODE, 0, ACC_INTG0
  GATE exc_11, SEL_CODE, 0, ACC_INTG0
  GATE exc_12, SEL_CODE, 0, ACC_INTG0
  GATE exc_13, SEL_CODE, 0, ACC_INTG0
  GATE exc_14, SEL_CODE, 0, ACC_INTG0
  GATE exc_15, SEL_CODE, 0, ACC_INTG0
  GATE exc_16, SEL_CODE, 0, ACC_INTG0
%endmacro

; Enter protected mode: LGDT, LIDT, LMSW, far jump to %1 in SEL_CODE.
%macro ENTER_PM 1
  cli
  lgdt [gdtr]
  lidt [idtr]
  mov ax, 1
  lmsw ax
  jmp SEL_CODE:%1
%endmacro
