; 80486 FPU on the chip in protected mode: CR0.NE = 1 gives #MF (vector 16) through the IDT;
; CR0.NE = 0 gives no #MF (the machine sends the error to IRQ 13). An FSTP qword across two
; pages with paging and the cache on.
cpu 486
bits 16
org 0
%include "pm486.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h
SEL_FLAT   equ 0x20       ; flat data, base 0, 4 GB

PD         equ 0x80000
PT0        equ 0x81000

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x8000
  mov ax, SEL_FLAT
  mov es, ax
  CACHE_ON
  mov eax, cr0
  mov [r_cr0], eax
  ; 1. NE = 1: #MF at the next FPU instruction
  or eax, CR0_NE
  mov cr0, eax
  fninit
  fldcw [cw]                      ; zero divide not masked
  fld1
  fldz
  fdivp st1, st0                  ; the error is pending (ES = 1)
  mov dword [r_div], 1
  TRY fld1                        ; #MF
  fnstsw ax
  mov [r_sw], ax
  fnclex
  fld1
  fstp dword [r_one]              ; the FPU works after FNCLEX
  ; 2. NE = 0: no #MF; the error stays pending (the IRQ 13 path)
  mov eax, cr0
  and eax, ~CR0_NE
  mov cr0, eax
  fninit
  fldcw [cw]
  fld1
  fldz
  fdivp st1, st0
  fld1                            ; no fault
  fstp st0
  fnstsw ax
  mov [r_sw0], ax                 ; ES = 1: the error is still pending
  mov dword [r_ne0], 1
  ; 3. paging, an FSTP qword across two pages (201000h - 8 + 4)
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
  mov dword [es:PT0 + 0x201*4], 0x91000 | 3
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  fninit
  fld qword [val]
  fstp qword [es:0x200FFC]
  fld qword [es:0x200FFC]
  fstp qword [r_back]
  mov dword [r_done], 0xD0D0
  hlt

  EXC_STUBS486

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0xFFFF, ACC_DATA0, FL_D             ; 18
  DESC32 0, 0xFFFFF, ACC_DATA0, FL_32                 ; 20
gdt_end:
idt:
  IDT_EXC486
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 8
val:     dq 3.375
r_back:  dq 0
cw:      dw 0x037B
r_sw:    dd 0
r_cr0:   dd 0
r_div:   dd 0
r_one:   dd 0
r_ne0:   dd 0
r_sw0:   dd 0
r_done:  dd 0
  LOG_AREA
