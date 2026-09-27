; 80286 protected mode: hardware interrupts (INTR through an interrupt gate and a trap
; gate, the one-instruction delay after STI, EXT bit in error codes), double fault, and
; triple-fault shutdown. OUT E0h, AL makes the test bus raise INTR with vector AL.
cpu 286
bits 16
org 0
%include "pm.inc"

SEL_CODE  equ 0x08
SEL_DATA  equ 0x10
SEL_STACK equ 0x18

start:
  ENTER_PM pm
pm:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov sp, 0xFFF0
  ; 1. INTR through an interrupt gate
  sti
  mov al, 0x20
  out 0xE0, al                    ; INTR is taken before the next instruction
after_out:
  nop
  ; 2. INTR while IF = 0 waits; after STI it waits one more instruction
  cli
  mov al, 0x21
  out 0xE0, al
  mov ax, [irq_count]
  mov [r_count_cli], ax           ; still 1
  sti
  nop
after_sti_nop:
  nop
  ; 3. INTR with vector 22h: the gate is not present -> #NP(22h*8 + 2 + EXT)
  mov word [resume], after_np
  mov al, 0x22
  out 0xE0, al
  nop
after_np:
  cli
  ; 4. #GP while the #GP gate is not present: #NP during #GP -> #DF(0)
  mov byte [idt + 13*8 + 5], 0x06
  mov ax, 0x0100
  TRY mov es, ax
  mov byte [idt + 13*8 + 5], ACC_INTG0
  ; 5. #UD while the #UD gate is not present: #NP (benign first event, no #DF)
  mov byte [idt + 6*8 + 5], 0x06
  TRY db 0x0F, 0xFF
  mov byte [idt + 6*8 + 5], ACC_INTG0
  mov word [r_before_tf], 0x7777
  ; 6. triple fault: IDT limit 0 -> #GP -> #DF -> shutdown
  lidt [idtr_zero]
  int 3
  mov word [r_after_tf], 0xDEAD   ; not reached
  hlt

irq20:                            ; interrupt gate
  push bp
  mov bp, sp
  push ax
  pushf
  pop ax
  mov [r20_fl], ax
  mov ax, [bp+2]
  mov [r20_ip], ax
  mov ax, [bp+6]
  mov [r20_ofl], ax
  inc word [irq_count]
  pop ax
  pop bp
  iret

irq21:                            ; trap gate
  push bp
  mov bp, sp
  push ax
  pushf
  pop ax
  mov [r21_fl], ax
  mov ax, [bp+2]
  mov [r21_ip], ax
  inc word [irq_count]
  pop ax
  pop bp
  iret

  EXC_STUBS

align 8
gdt:
  dw 0, 0, 0, 0
  DESC BASE, 0xFFFF, ACC_CODE0         ; 08
  DESC BASE, 0xFFFF, ACC_DATA0         ; 10
  DESC 0x20000, 0xFFFF, ACC_DATA0      ; 18
gdt_end:
idt:
  IDT_EXC
  times 0x20 - 17 dw 0, 0, 0, 0
  GATE irq20, SEL_CODE, 0, ACC_INTG0   ; 20
  GATE irq21, SEL_CODE, 0, ACC_TRAPG0  ; 21
  GATE irq20, SEL_CODE, 0, 0x06        ; 22: not present
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt
idtr_zero: dw 0
      dd BASE + idt

align 2
resume:       dw 0
irq_count:    dw 0
r_count_cli:  dw 0
r20_fl:       dw 0
r20_ip:       dw 0
r20_ofl:      dw 0
r21_fl:       dw 0
r21_ip:       dw 0
r_before_tf:  dw 0
r_after_tf:   dw 0
log_n:        dw 0
log:          times 8*32 dw 0
