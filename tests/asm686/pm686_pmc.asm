; Pentium Pro instructions at CPL 3: RDPMC gives #GP(0) while CR4.PCE = 0 and works when PCE = 1 (the
; counters count at CPL 3); RDPMC with ECX = 2 and RDMSR give #GP(0); CMOVcc and FCOMIP work; UD2
; gives #UD.
cpu 686
bits 16
org 0
%include "pm686.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h
SEL_TSS    equ 0x20       ; 386 TSS (level 0 stack)
SEL_CODE3  equ 0x2B
SEL_DATA3  equ 0x33
SEL_STACK3 equ 0x3B       ; base 40000h

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x8000
  mov ax, SEL_TSS
  ltr ax
  CACHE_ON
  ; counter 0: INST_RETIRED, counter 1: UOPS_RETIRED (USR and OS); EN starts both
  xor eax, eax
  xor edx, edx
  mov ecx, MSR_PERFCTR0
  wrmsr
  mov ecx, MSR_PERFCTR1
  wrmsr
  mov ecx, MSR_EVTSEL1
  mov eax, EV_UOPS_RETIRED | EVT_USR | EVT_OS
  wrmsr
  mov ecx, MSR_EVTSEL0
  mov eax, EV_INST_RETIRED | EVT_USR | EVT_OS | EVT_EN
  wrmsr
  push dword SEL_STACK3
  push dword 0xFFF0
  push dword 0x002
  push dword SEL_CODE3
  push dword user
  iretd

user:
  mov ax, SEL_DATA3
  mov ds, ax
  mov es, ax
  xor ecx, ecx
  TRY rdpmc                       ; #GP(0): CR4.PCE = 0
  int 0x42                        ; CPL 0 sets CR4.PCE
  xor ecx, ecx
  rdpmc                           ; CPL 3 with PCE = 1: it works
  mov [r_pmc0], eax
  mov [r_pmc0h], edx
  mov ecx, 1
  rdpmc
  mov [r_pmc1], eax
  mov ecx, 2
  TRY rdpmc                       ; #GP(0): ECX = 2
  mov ecx, MSR_PERFCTR0
  TRY rdmsr                       ; #GP(0): CPL 3
  mov eax, 1
  mov ebx, 2
  cmp eax, eax
  cmove eax, ebx                  ; ZF = 1: EAX = 2
  mov [r_cmov], eax
  fninit
  fld1
  fldz
  fcomip st0, st1                 ; 0 < 1: CF = 1
  setb al
  mov [r_fcomi], al
  TRY ud2                         ; #UD
  mov dword [r_after], 0x12345678
  int 0x41

int42:
  CR4_SET CR4_PCE
  mov eax, cr4
  mov [r_cr4], eax
  iretd

int41:
  mov ax, SEL_DATA
  mov ds, ax
  mov dword [r_done], 0xD0D0
  hlt

  EXC_STUBS486

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0xFFFF, ACC_DATA0, FL_D             ; 18
  DESC32 BASE + OFS(tss), 103, ACC_TSS386, 0          ; 20
  DESC32 BASE, 0xFFFFF, ACC_CODE3, FL_32              ; 28
  DESC32 BASE, 0xFFFFF, ACC_DATA3, FL_32              ; 30
  DESC32 0x40000, 0xFFFF, ACC_DATA3, FL_D             ; 38
gdt_end:
idt:
  IDT_EXC486
  times 0x41 - 18 dq 0
  GATE32 OFS(int41), SEL_CODE, 0, ACC_INTG3           ; 41
  GATE32 OFS(int42), SEL_CODE, 0, ACC_INTG3           ; 42
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 4
tss:
  dd 0
  dd 0x8000                       ; ESP0
  dd SEL_STACK                    ; SS0
  times 22 dd 0
  dw 0, 104

r_pmc0:     dd 0
r_pmc0h:    dd 0xFFFFFFFF
r_pmc1:     dd 0
r_cmov:     dd 0
r_fcomi:    dd 0
r_cr4:      dd 0
r_after:    dd 0
r_done:     dd 0
  LOG_AREA
