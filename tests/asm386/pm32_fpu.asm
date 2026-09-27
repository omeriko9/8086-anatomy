; 80386 + 80387 interface: FPU operands with 32-bit addresses, with and without paging,
; FSTSW AX, and #NM from CR0.TS / CR0.EM (ESC) and TS + MP (WAIT).
cpu 386
bits 16
org 0
%include "pm386.inc"

SEL_CODE   equ 0x08
SEL_DATA   equ 0x10
SEL_STACK  equ 0x18
SEL_FLAT   equ 0x20

PD         equ 0x80000
PT0        equ 0x81000

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  xor ax, ax
  mov fs, ax
  mov gs, ax
  mov ax, SEL_FLAT
  mov es, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x10000
  mov eax, cr0
  mov [r_cr0], eax
  ; 1. without paging
  fninit
  fld dword [f_a]
  fadd dword [f_b]
  fstp qword [r_sum]
  ; 2. with paging: linear 200000h -> physical 90000h
  mov edi, PD
  xor eax, eax
  mov ecx, 1024
  cld
  rep stosd
  mov dword [es:PD], PT0 | 3
  mov edi, PT0
  mov eax, 3
  mov ecx, 1024
fill:
  stosd
  add eax, 0x1000
  loop fill
  mov dword [es:PT0 + 0x200*4], 0x90000 | 3
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  fld dword [f_a]
  fmul dword [f_b]
  fstp qword [es:0x200FFC]        ; 8 bytes across two pages: 90FFCh and 201000h -> 201000h
  fld1
  fchs
  fstsw ax
  mov [r_sw], ax
  fstp st0
  ; 3. #NM
  mov eax, cr0
  or eax, 8                       ; TS = 1
  mov cr0, eax
  TRY fld1                        ; ESC with TS = 1: #NM
  TRY wait                        ; WAIT with TS = 1, MP = 0: no fault
  mov eax, cr0
  or eax, 2                       ; MP = 1
  mov cr0, eax
  TRY wait                        ; WAIT with TS = 1, MP = 1: #NM
  clts
  mov eax, cr0
  or eax, 4                       ; EM = 1
  mov cr0, eax
  TRY fld1                        ; ESC with EM = 1: #NM
  and eax, ~6
  mov cr0, eax
  fld1
  fistp dword [r_one]
  mov dword [r_done], 0xD0D0
  hlt

  EXC_STUBS

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0x1FFFF, ACC_DATA0, FL_D            ; 18
  DESC32 0, 0xFFFFF, ACC_DATA0, FL_32                 ; 20
gdt_end:
idt:
  IDT_EXC
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 8
f_a:     dd 1.5
f_b:     dd 2.25
r_sum:   dq 0
r_cr0:   dd 0
r_sw:    dd 0
r_one:   dd 0
r_done:  dd 0
  LOG_AREA
