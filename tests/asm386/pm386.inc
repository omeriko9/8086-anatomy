; Shared macros for the 80386 protected-mode test programs (NASM, cpu 386).
; The harness loads each program at physical BASE (010000h) and starts it in real mode at
; 1000:0000 with DS = ES = SS = FS = GS = 1000h, SP = FFF0h.

BASE    equ 0x10000

; The offset of a label as a plain number (so that NASM can shift it).
%define OFS(x) ((x) - $$)

; 386 segment descriptor: base (32 bits), limit (20 bits), access byte, flags (G D/B 0 AVL)
%macro DESC32 4
  dw (%2) & 0xFFFF
  dw (%1) & 0xFFFF
  db ((%1) >> 16) & 0xFF
  db %3
  db (((%2) >> 16) & 0x0F) | ((%4) << 4)
  db ((%1) >> 24) & 0xFF
%endmacro

; Gate: offset (a number, 32 bits), selector, parameter count, access byte
%macro GATE32 4
  dw (%1) & 0xFFFF
  dw %2
  db %3
  db %4
  dw ((%1) >> 16) & 0xFFFF
%endmacro

; Flags nibble of DESC32
FL_G      equ 8           ; limit in 4 KB units
FL_D      equ 4           ; 32-bit code / 32-bit stack (B)
FL_32     equ 0xC         ; G + D

; Access bytes
ACC_CODE0   equ 0x9A      ; present, DPL 0, code, readable
ACC_CODE3   equ 0xFA      ; present, DPL 3, code, readable
ACC_DATA0   equ 0x92      ; present, DPL 0, data, writable
ACC_DATA3   equ 0xF2      ; present, DPL 3, data, writable
ACC_TSS286  equ 0x81      ; present, DPL 0, available 286 TSS
ACC_TSS386  equ 0x89      ; present, DPL 0, available 386 TSS
ACC_TASKG0  equ 0x85      ; present, DPL 0, task gate
ACC_CALLG3  equ 0xEC      ; present, DPL 3, 386 call gate
ACC_INTG0   equ 0x8E      ; present, DPL 0, 386 interrupt gate
ACC_INTG3   equ 0xEE      ; present, DPL 3, 386 interrupt gate
ACC_TRAPG0  equ 0x8F      ; present, DPL 0, 386 trap gate
ACC_TASKG3  equ 0xE5      ; present, DPL 3, task gate

; Real mode -> protected mode, then a far jump to 32-bit code at %1 (selector SEL_CODE).
%macro ENTER_PM32 1
  cli
  o32 lgdt [gdtr]
  o32 lidt [idtr]
  mov eax, cr0
  or al, 1
  mov cr0, eax
  jmp dword SEL_CODE:%1
%endmacro

; TRY instr: if instr faults, the fault handler continues at the next instruction.
%macro TRY 1+
  mov dword [resume], %%next
  %1
%%next:
%endmacro

; Fault stubs (32-bit): they push a vector number (and a zero error code when the CPU
; pushes none).
%macro EXC_NOERR 1
exc_%1:
  push dword 0
  push dword %1
  jmp exc_common
%endmacro
%macro EXC_ERR 1
exc_%1:
  push dword %1
  jmp exc_common
%endmacro

; exc_common: log 8 dwords (vector, error code, EIP, CS, EFLAGS, ESP, SS, CR2) at
; log[log_n] and continue at [resume]. ESP and SS are only meaningful after a privilege
; change. It needs SEL_DATA (a DPL 0 data segment with base BASE).
%macro EXC_COMMON 0
exc_common:
  push ebp
  mov ebp, esp
  push eax
  push ebx
  push ds
  mov ax, SEL_DATA
  mov ds, ax
  mov ebx, [log_n]
  shl ebx, 5
  mov eax, [ebp+4]
  mov [log+ebx], eax
  mov eax, [ebp+8]
  mov [log+ebx+4], eax
  mov eax, [ebp+12]
  mov [log+ebx+8], eax
  mov eax, [ebp+16]
  mov [log+ebx+12], eax
  mov eax, [ebp+20]
  mov [log+ebx+16], eax
  mov eax, [ebp+24]
  mov [log+ebx+20], eax
  mov eax, [ebp+28]
  mov [log+ebx+24], eax
  mov eax, cr2
  mov [log+ebx+28], eax
  inc dword [log_n]
  mov eax, [resume]
  mov [ebp+12], eax
  pop ds
  pop ebx
  pop eax
  pop ebp
  add esp, 8
  iretd
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
  EXC_ERR 14
  EXC_NOERR 15
  EXC_NOERR 16
  EXC_COMMON
%endmacro

; IDT entries 0..16 as 386 interrupt gates to the stubs
%macro IDT_EXC 0
  %assign i 0
  %rep 17
    GATE32 OFS(exc_ %+ i), SEL_CODE, 0, ACC_INTG0
    %assign i i+1
  %endrep
%endmacro

; The log area: 8 dwords per entry
%macro LOG_AREA 0
align 4
resume:       dd 0
log_n:        dd 0
log:          times 8*32 dd 0
%endmacro
