; Pentium instructions at CPL 3: RDTSC works while CR4.TSD = 0 and gives #GP(0) when TSD = 1
; (at CPL 0 it works with TSD = 1); RDMSR, WRMSR and MOV CR4 give #GP(0); CPUID works.
cpu 586
bits 16
org 0
%include "pm586.inc"

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
  rdtsc                           ; CR4.TSD = 0: RDTSC works at CPL 3
  mov [r_tsc3], eax
  mov [r_tsc3h], edx
  xor eax, eax
  cpuid
  mov [r_cpuid], ebx              ; "Genu"
  int 0x42                        ; CPL 0 sets CR4.TSD
  TRY rdtsc                       ; #GP(0)
  mov ecx, MSR_TSC
  TRY rdmsr                       ; #GP(0): CPL 3
  TRY wrmsr                       ; #GP(0): CPL 3
  TRY mov eax, cr4                ; #GP(0): CPL 3
  mov dword [r_after], 0x12345678
  int 0x41

int42:
  CR4_SET CR4_TSD
  rdtsc                           ; CPL 0: RDTSC works with TSD = 1
  mov [r_tsc0], eax
  mov ecx, MSR_TSC
  rdmsr
  mov [r_msr0], eax
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

r_tsc3:     dd 0
r_tsc3h:    dd 0xFFFFFFFF
r_cpuid:    dd 0
r_tsc0:     dd 0
r_msr0:     dd 0
r_cr4:      dd 0
r_after:    dd 0
r_done:     dd 0
  LOG_AREA
