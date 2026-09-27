; Shared macros for the Pentium Pro (P6) protected-mode test programs (NASM, cpu 686). They use the
; Pentium macros (tests/asm586/pm586.inc, which uses tests/asm486/pm486.inc and tests/asm386/pm386.inc).
; The harness loads each program at physical BASE (010000h) and starts it in real mode at
; 1000:0000 with DS = ES = SS = FS = GS = 1000h, SP = FFF0h.

%include "../asm586/pm586.inc"

CR4_PGE   equ 0x80            ; global pages
CR4_PCE   equ 0x100           ; RDPMC at CPL 3
PG_G      equ 0x100           ; the G bit of a PTE (or of a 4 MB PDE)

MSR_PERFCTR0  equ 0xC1
MSR_PERFCTR1  equ 0xC2
MSR_EVTSEL0   equ 0x186
MSR_EVTSEL1   equ 0x187
EVT_USR       equ 0x10000
EVT_OS        equ 0x20000
EVT_EN        equ 0x400000    ; PerfEvtSel0 only: it starts both counters
EV_INST_RETIRED equ 0xC0
EV_UOPS_RETIRED equ 0xC2
