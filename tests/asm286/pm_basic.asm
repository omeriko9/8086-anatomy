; 80286 protected mode, CPL 0: entering PM, segment loads, 24-bit addresses, limit and
; access checks with their error codes, LDT, VERR/VERW/LAR/LSL/ARPL, SMSW/LMSW/CLTS.
cpu 286
bits 16
org 0
%include "pm.inc"

SEL_CODE   equ 0x08
SEL_DATA   equ 0x10
SEL_STACK  equ 0x18
SEL_HIGH   equ 0x20
SEL_SMALL  equ 0x28
SEL_RO     equ 0x30
SEL_EDOWN  equ 0x38
SEL_NP     equ 0x40
SEL_XO     equ 0x48
SEL_RX     equ 0x50
SEL_D3     equ 0x58
SEL_LDT    equ 0x60
SEL_SSMALL equ 0x68
SEL_CGATE  equ 0x70

start:
  smsw [r_msw_real]              ; real mode, after reset
  ENTER_PM pm
pm:
  mov ax, SEL_DATA
  mov ds, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov sp, 0xFFF0
  smsw [r_msw_pm]
  mov [r_cs], cs
  ; 24-bit address: segment base 123400h
  mov ax, SEL_HIGH
  mov es, ax
  mov word [es:0x0010], 0xBEEF
  mov al, [gdt + SEL_HIGH + 5]   ; accessed bit is now set
  mov [r_acc_high], al
  sgdt [r_sgdt]
  sidt [r_sidt]

  ; ---- limit and access faults (log entries 0..) ----
  mov ax, SEL_SMALL              ; limit 00FFh
  mov es, ax
  TRY mov ax, [es:0x0100]        ; #GP(0): offset > limit
  TRY mov ax, [es:0x00FF]        ; #GP(0): second byte is past the limit
  mov al, [es:0x00FF]            ; no fault: byte at the limit
  mov [r_small_ok], al
  mov ax, SEL_RO
  mov es, ax
  TRY mov [es:0x0000], al        ; #GP(0): write to a read-only data segment
  mov ax, SEL_NP
  TRY mov es, ax                 ; #NP(40h): not present
  mov ax, 0x0100
  TRY mov es, ax                 ; #GP(100h): outside the GDT limit
  mov ax, SEL_XO
  TRY mov es, ax                 ; #GP(48h): execute-only code in a data register
  mov ax, SEL_RX
  mov es, ax                     ; readable code: no fault
  mov ax, [es:0x0000]            ; first code word
  mov [r_rx_word], ax
  mov ax, SEL_DATA | 3
  TRY mov es, ax                 ; #GP(10h): RPL 3 > DPL 0
  mov ax, SEL_D3
  mov es, ax                     ; DPL 3 data at CPL 0: no fault
  mov [r_es_d3], es
  TRY mov ss, ax                 ; #GP(58h): SS DPL must equal CPL
  mov ax, SEL_RO
  TRY mov ss, ax                 ; #GP(30h): SS must be writable
  xor ax, ax
  TRY mov ss, ax                 ; #GP(0): null SS
  mov ax, SEL_NP
  TRY mov ss, ax                 ; #SS(40h): SS not present
  xor ax, ax
  mov es, ax                     ; null ES: no fault
  TRY mov ax, [es:0x0000]        ; #GP(0): access through a null selector
  mov ax, SEL_EDOWN              ; expand-down, limit 0FFFh: offsets 1000h..FFFFh
  mov es, ax
  TRY mov ax, [es:0x0800]        ; #GP(0): below limit + 1
  mov word [es:0x2000], 0x1234   ; no fault
  mov word [es:0x1000], 0x5678   ; no fault: lowest valid offset
  mov ax, SEL_SSMALL             ; stack segment with limit 00FFh
  mov ss, ax
  mov sp, 0x00F0
  TRY mov ax, [ss:0x0200]        ; #SS(0): stack segment limit
  mov ax, SEL_STACK
  mov ss, ax
  mov sp, 0xFFF0
  ; LDT
  mov ax, SEL_LDT
  lldt ax
  sldt [r_sldt]
  mov ax, 0x0004                 ; LDT entry 0
  mov es, ax
  mov word [es:0x0000], 0x5555   ; base 60000h
  mov ax, 0x0014                 ; LDT entry 2: outside the LDT limit
  TRY mov es, ax                 ; #GP(14h)
  TRY int 0x30                   ; #GP(30h*8+2): vector outside the IDT limit
  mov word [resume], a_ud
f_ud: db 0x0F, 0xFF              ; #UD
a_ud:
  mov word [r_div], 0x55AA
  xor cx, cx
  mov ax, 1
  mov word [resume], a_div
f_div: div cx                    ; #DE: IP of the DIV
a_div:
  mov word [bndv], 10
  mov word [bndv+2], 20
  mov ax, 21
  mov word [resume], a_bound
f_bound: bound ax, [bndv]         ; #BR: IP of the BOUND
a_bound:
  mov ax, 15
  bound ax, [bndv]                ; no fault
  mov word [r_after], 0xC0DE

  ; ---- VERR / VERW / LAR / LSL / ARPL ----
  mov ax, SEL_DATA
  verr ax
  SAVEFA r_f1, r_a1              ; ZF=1
  verw ax
  SAVEFA r_f2, r_a2              ; ZF=1
  mov ax, SEL_XO
  verr ax
  SAVEFA r_f3, r_a3              ; ZF=0 (execute-only)
  mov ax, SEL_RX
  verr ax
  SAVEFA r_f4, r_a4              ; ZF=1
  verw ax
  SAVEFA r_f5, r_a5              ; ZF=0 (code is never writable)
  mov ax, SEL_RO
  verw ax
  SAVEFA r_f6, r_a6              ; ZF=0
  xor ax, ax
  verr ax
  SAVEFA r_f7, r_a7              ; ZF=0 (null)
  mov ax, 0x0100
  verr ax
  SAVEFA r_f8, r_a8              ; ZF=0 (outside the GDT)
  mov bx, SEL_DATA
  lar ax, bx
  SAVEFA r_f9, r_a9              ; ZF=1, AX = 9300h (accessed data)
  mov bx, SEL_LDT
  lar ax, bx
  SAVEFA r_f10, r_a10            ; ZF=1, AX = 8200h
  mov bx, SEL_SMALL
  lsl ax, bx
  SAVEFA r_f11, r_a11            ; ZF=1, AX = 00FFh
  mov ax, 0x7777
  mov bx, SEL_CGATE
  lsl ax, bx
  SAVEFA r_f12, r_a12            ; ZF=0, AX unchanged (a gate has no limit)
  lar ax, bx
  SAVEFA r_f13, r_a13            ; ZF=1, AX = E400h
  mov ax, SEL_DATA
  mov bx, 3
  arpl ax, bx
  SAVEFA r_f14, r_a14            ; ZF=1, AX = 0013h
  arpl ax, bx
  SAVEFA r_f15, r_a15            ; ZF=0, AX = 0013h

  ; ---- MSW ----
  xor ax, ax
  lmsw ax                        ; LMSW cannot clear PE
  smsw [r_msw_nope]
  mov ax, 0x0009                 ; PE + TS
  lmsw ax
  smsw [r_msw_ts]
  clts
  smsw [r_msw_clts]
  hlt

  EXC_STUBS

align 8
gdt:
  dw 0, 0, 0, 0
  DESC BASE, 0xFFFF, ACC_CODE0         ; 08
  DESC BASE, 0xFFFF, ACC_DATA0         ; 10
  DESC 0x20000, 0xFFFF, ACC_DATA0      ; 18
  DESC 0x123400, 0x0FFF, ACC_DATA0     ; 20
  DESC 0x30000, 0x00FF, ACC_DATA0      ; 28
  DESC 0x30000, 0xFFFF, ACC_RO0        ; 30
  DESC 0x40000, 0x0FFF, ACC_EDOWN0     ; 38
  DESC 0x30000, 0xFFFF, ACC_NPDATA     ; 40
  DESC BASE, 0xFFFF, ACC_XO0           ; 48
  DESC BASE, 0xFFFF, ACC_CODE0         ; 50
  DESC 0x30000, 0xFFFF, ACC_DATA3      ; 58
  DESC BASE + (ldt - $$), 15, ACC_LDT         ; 60
  DESC 0x50000, 0x00FF, ACC_DATA0      ; 68
  GATE 0x1234, SEL_CODE, 0, ACC_CALLG3 ; 70
gdt_end:
ldt:
  DESC 0x60000, 0xFFFF, ACC_DATA0      ; 04
  DESC 0x61000, 0xFFFF, ACC_DATA0      ; 0C
idt:
  IDT_EXC
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 2
resume:     dw 0
bndv:       dw 0, 0
r_msw_real: dw 0
r_msw_pm:   dw 0
r_cs:       dw 0
r_acc_high: dw 0
r_sgdt:     dw 0, 0, 0
r_sidt:     dw 0, 0, 0
r_small_ok: dw 0
r_rx_word:  dw 0
r_es_d3:    dw 0
r_sldt:     dw 0
r_div:      dw 0
r_after:    dw 0
r_f1: dw 0
r_a1: dw 0
r_f2: dw 0
r_a2: dw 0
r_f3: dw 0
r_a3: dw 0
r_f4: dw 0
r_a4: dw 0
r_f5: dw 0
r_a5: dw 0
r_f6: dw 0
r_a6: dw 0
r_f7: dw 0
r_a7: dw 0
r_f8: dw 0
r_a8: dw 0
r_f9: dw 0
r_a9: dw 0
r_f10: dw 0
r_a10: dw 0
r_f11: dw 0
r_a11: dw 0
r_f12: dw 0
r_a12: dw 0
r_f13: dw 0
r_a13: dw 0
r_f14: dw 0
r_a14: dw 0
r_f15: dw 0
r_a15: dw 0
r_msw_nope: dw 0
r_msw_ts:   dw 0
r_msw_clts: dw 0
log_n:      dw 0
log:        times 8*32 dw 0
