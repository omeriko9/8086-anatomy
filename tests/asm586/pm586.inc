; Shared macros for the Pentium (P5) protected-mode test programs (NASM, cpu 586). They use the
; 80486 macros (tests/asm486/pm486.inc, which uses tests/asm386/pm386.inc).
; The harness loads each program at physical BASE (010000h) and starts it in real mode at
; 1000:0000 with DS = ES = SS = FS = GS = 1000h, SP = FFF0h.

%include "../asm486/pm486.inc"

CR4_TSD   equ 0x04
CR4_DE    equ 0x08
CR4_PSE   equ 0x10
CR4_MCE   equ 0x40
PDE_PS    equ 0x80            ; a 4 MB page (with CR4.PSE = 1)
PG_P      equ 0x01
PG_RW     equ 0x02
PG_US     equ 0x04
PG_PWT    equ 0x08
PG_PCD    equ 0x10

MSR_TR12  equ 0x0E
MSR_TSC   equ 0x10
TR12_SE   equ 0x02            ; single pipe execution: no pairs

; Set bits in CR4.
%macro CR4_SET 1
  mov eax, cr4
  or eax, %1
  mov cr4, eax
%endmacro
; Clear bits in CR4.
%macro CR4_CLEAR 1
  mov eax, cr4
  and eax, ~(%1)
  mov cr4, eax
%endmacro
