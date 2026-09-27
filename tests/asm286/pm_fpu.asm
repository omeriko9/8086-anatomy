; 80286 + 80287 in protected mode: operands through a descriptor base above 1 MB,
; FSTSW AX, FSETPM environment format, operand limit checks (#GP, #9), #NM for EM / TS /
; MP+TS, and #MF when the test bus sets cpu.fpuError (OUT E8h on, OUT E9h off).
cpu 286
bits 16
org 0
%include "pm.inc"

SEL_CODE  equ 0x08
SEL_DATA  equ 0x10
SEL_STACK equ 0x18
SEL_FPD   equ 0x20            ; base 150000h, limit 0FFFh

start:
  ENTER_PM pm
pm:
  mov ax, SEL_DATA
  mov ds, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov sp, 0xFFF0
  mov ax, SEL_FPD
  mov es, ax
  mov word [es:0x20], 0
  mov word [es:0x22], 0
  mov word [es:0x24], 0
  mov word [es:0x26], 0x3FF8      ; 1.5
  fninit
f_fld:
  fld qword [es:0x20]
  fnstsw ax                       ; DF E0
  mov [r_sw1], ax
  fadd st0, st0
  fstp qword [es:0x40]            ; 3.0
  fnstsw ax
  mov [r_sw2], ax
  fsetpm
f_fld2:
  fld qword [es:0x20]
  fnstenv [es:0x60]
  fstp st0
  TRY fld qword [es:0x0FFC]       ; #9: the operand runs past the limit
  TRY fld qword [es:0x1000]       ; #GP(0): the operand starts past the limit
  mov ax, 0x0005                  ; PE + EM
  lmsw ax
  TRY fld qword [es:0x20]         ; #NM: EM = 1
  fwait                           ; no fault: WAIT ignores EM
  mov ax, 0x000B                  ; PE + MP + TS
  lmsw ax
  TRY fwait                       ; #NM: MP = 1 and TS = 1
  mov ax, 0x0009                  ; PE + TS
  lmsw ax
  fwait                           ; no fault: MP = 0
  TRY fnop                        ; #NM: TS = 1
  clts
  fnop
  out 0xE8, al                    ; the test bus sets cpu.fpuError
  TRY fwait                       ; #MF
  out 0xE9, al
  mov word [r_done], 0xF00D
  hlt

  EXC_STUBS

align 8
gdt:
  dw 0, 0, 0, 0
  DESC BASE, 0xFFFF, ACC_CODE0         ; 08
  DESC BASE, 0xFFFF, ACC_DATA0         ; 10
  DESC 0x20000, 0xFFFF, ACC_DATA0      ; 18
  DESC 0x150000, 0x0FFF, ACC_DATA0     ; 20
gdt_end:
idt:
  IDT_EXC
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 2
resume: dw 0
r_sw1:  dw 0
r_sw2:  dw 0
r_done: dw 0
log_n:  dw 0
log:    times 8*32 dw 0
