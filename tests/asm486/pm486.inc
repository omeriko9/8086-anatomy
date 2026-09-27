; Shared macros for the 80486 protected-mode test programs (NASM, cpu 486). They use the
; 80386 macros (tests/asm386/pm386.inc) and add the stub and the IDT entry of #AC (17).
; The harness loads each program at physical BASE (010000h) and starts it in real mode at
; 1000:0000 with DS = ES = SS = FS = GS = 1000h, SP = FFF0h.

%include "../asm386/pm386.inc"

CR0_NE    equ 0x00000020
CR0_WP    equ 0x00010000
CR0_AM    equ 0x00040000
CR0_NW    equ 0x20000000
CR0_CD    equ 0x40000000
EFL_AC    equ 0x00040000
EFL_ID    equ 0x00200000

; The 80386 stubs 0-16, and 17 (#AC pushes an error code 0).
%macro EXC_STUBS486 0
  EXC_STUBS
  EXC_ERR 17
%endmacro

; IDT entries 0-17 as 386 interrupt gates to the stubs.
%macro IDT_EXC486 0
  IDT_EXC
  GATE32 OFS(exc_17), SEL_CODE, 0, ACC_INTG0
%endmacro

; The cache on: CR0.CD = 0, CR0.NW = 0.
%macro CACHE_ON 0
  mov eax, cr0
  and eax, ~(CR0_CD | CR0_NW)
  mov cr0, eax
%endmacro
