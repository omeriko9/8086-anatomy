; 80286 task switches: JMP to a TSS and back, CALL through a task gate (NT, back link) and
; IRET back, INT through a task gate, #NP through a task gate (error code on the new
; stack), a TSS with a limit < 43 (#TS) and a JMP to a busy TSS (#GP).
cpu 286
bits 16
org 0
%include "pm.inc"

SEL_CODE    equ 0x08
SEL_DATA    equ 0x10
SEL_STACK0  equ 0x18
SEL_TSS_A   equ 0x20
SEL_TSS_B   equ 0x28
SEL_TSS_C   equ 0x30
SEL_TGATE_B equ 0x38
SEL_LDT_B   equ 0x40
SEL_STACK_B equ 0x48
SEL_SMALL   equ 0x50
SEL_TSS_D   equ 0x58
SEL_NP      equ 0x60

start:
  ENTER_PM pm
pm:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax                      ; ES is saved in TSS A and loaded again at each switch
  mov ax, SEL_STACK0
  mov ss, ax
  mov sp, 0xFFF0
  mov ax, SEL_TSS_A
  ltr ax
  ; 1. JMP to TSS B
  mov ax, 0xA0A0
  mov bx, 0xA1A1
  jmp SEL_TSS_B : 0
back_a1:
  mov [a1_ax], ax
  mov [a1_bx], bx
  mov al, [gdt + SEL_TSS_A + 5]
  mov [a1_acc_a], al
  mov al, [gdt + SEL_TSS_B + 5]
  mov [a1_acc_b], al
  mov ax, [tss_b + 14]
  mov [a1_b_ip], ax
  mov ax, [tss_b + 18]
  mov [a1_b_ax], ax
  ; 2. CALL through the task gate to B; B returns with IRET
  mov ax, 0xA2A2
  call SEL_TGATE_B : 0
back_a2:
  mov [a2_ax], ax
  pushf
  pop word [a2_fl]
  mov al, [gdt + SEL_TSS_A + 5]
  mov [a2_acc_a], al
  mov al, [gdt + SEL_TSS_B + 5]
  mov [a2_acc_b], al
  ; 3. INT 50h: task gate to TSS C
  int 0x50
  mov word [a3_done], 0x3333
  ; 4. #NP through a task gate (IDT entry 11) to TSS D
  mov ax, SEL_NP
f_np:
  mov es, ax
after_np:
  mov word [a4_done], 0x4444
  ; 5. TSS with limit < 43
  TRY jmp SEL_SMALL : 0           ; #TS(50h)
  ; 6. JMP to the busy TSS of the current task
  TRY jmp SEL_TSS_A : 0           ; #GP(20h)
  smsw [a_msw]
  hlt

task_b:                           ; first run: state from TSS B
  mov [b1_ax], ax
  mov [b1_cx], cx
  str [b1_tr]
  smsw [b1_msw]
  pushf
  pop word [b1_fl]
  mov [b1_ss], ss
  mov [b1_sp], sp
  sldt [b1_ldt]
  mov word [es:0], 0xB00B          ; ES = LDT entry 0 (base 90000h)
  mov al, [gdt + SEL_TSS_A + 5]
  mov [b1_acc_a], al
  mov al, [gdt + SEL_TSS_B + 5]
  mov [b1_acc_b], al
  mov ax, [tss_a + 14]
  mov [b1_a_ip], ax
  mov ax, 0xBEBE
  jmp SEL_TSS_A : 0
task_b2:                          ; second run: CALL through the task gate
  mov [b2_ax], ax
  pushf
  pop word [b2_fl]
  mov ax, [tss_b + 0]
  mov [b2_link], ax
  mov al, [gdt + SEL_TSS_A + 5]
  mov [b2_acc_a], al
  mov al, [gdt + SEL_TSS_B + 5]
  mov [b2_acc_b], al
  iret
  hlt

task_c:
  pushf
  pop word [c_fl]
  mov ax, [tss_c + 0]
  mov [c_link], ax
  str [c_tr]
  iret
  jmp task_c

task_d:                           ; #NP handler task: the error code is on its stack
  pop ax
  mov [d_err], ax
  mov ax, [tss_a + 14]
  mov [d_a_ip], ax                ; IP of the faulting instruction in task A
  mov word [tss_a + 14], after_np
  iret
  jmp task_d

  EXC_STUBS

align 8
gdt:
  dw 0, 0, 0, 0
  DESC BASE, 0xFFFF, ACC_CODE0                ; 08
  DESC BASE, 0xFFFF, ACC_DATA0                ; 10
  DESC 0x20000, 0xFFFF, ACC_DATA0             ; 18
  DESC BASE + (tss_a - $$), 43, ACC_TSS       ; 20
  DESC BASE + (tss_b - $$), 43, ACC_TSS       ; 28
  DESC BASE + (tss_c - $$), 43, ACC_TSS       ; 30
  GATE 0, SEL_TSS_B, 0, ACC_TASKG0            ; 38
  DESC BASE + (ldt_b - $$), 7, ACC_LDT        ; 40
  DESC 0x21000, 0x0FFF, ACC_DATA0             ; 48
  DESC BASE + (tss_a - $$), 42, ACC_TSS       ; 50: limit 42 < 43
  DESC BASE + (tss_d - $$), 43, ACC_TSS       ; 58
  DESC 0x30000, 0xFFFF, ACC_NPDATA            ; 60
gdt_end:
ldt_b:
  DESC 0x90000, 0xFFFF, ACC_DATA0             ; 04
idt:
  GATE exc_0, SEL_CODE, 0, ACC_INTG0
  GATE exc_1, SEL_CODE, 0, ACC_INTG0
  GATE exc_2, SEL_CODE, 0, ACC_INTG0
  GATE exc_3, SEL_CODE, 0, ACC_INTG0
  GATE exc_4, SEL_CODE, 0, ACC_INTG0
  GATE exc_5, SEL_CODE, 0, ACC_INTG0
  GATE exc_6, SEL_CODE, 0, ACC_INTG0
  GATE exc_7, SEL_CODE, 0, ACC_INTG0
  GATE exc_8, SEL_CODE, 0, ACC_INTG0
  GATE exc_9, SEL_CODE, 0, ACC_INTG0
  GATE exc_10, SEL_CODE, 0, ACC_INTG0
  GATE 0, SEL_TSS_D, 0, ACC_TASKG0            ; 11: #NP -> task D
  GATE exc_12, SEL_CODE, 0, ACC_INTG0
  GATE exc_13, SEL_CODE, 0, ACC_INTG0
  GATE exc_14, SEL_CODE, 0, ACC_INTG0
  GATE exc_15, SEL_CODE, 0, ACC_INTG0
  GATE exc_16, SEL_CODE, 0, ACC_INTG0
  times 0x50 - 17 dw 0, 0, 0, 0
  GATE 0, SEL_TSS_C, 0, ACC_TASKG0            ; 50
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

; 286 TSS: link, SP0 SS0 SP1 SS1 SP2 SS2, IP FLAGS AX CX DX BX SP BP SI DI, ES CS SS DS, LDT
align 2
tss_a: times 22 dw 0
tss_b:
  dw 0
  dw 0, 0, 0, 0, 0, 0
  dw task_b, 0x0002
  dw 0xB0B0, 0xB1B1, 0xB2B2, 0xB3B3, 0x1000, 0, 0, 0
  dw 0x0004, SEL_CODE, SEL_STACK_B, SEL_DATA
  dw SEL_LDT_B
tss_c:
  dw 0
  dw 0, 0, 0, 0, 0, 0
  dw task_c, 0x0002
  dw 0, 0, 0, 0, 0x3000, 0, 0, 0
  dw SEL_DATA, SEL_CODE, SEL_STACK0, SEL_DATA
  dw 0
tss_d:
  dw 0
  dw 0, 0, 0, 0, 0, 0
  dw task_d, 0x0002
  dw 0, 0, 0, 0, 0x2000, 0, 0, 0
  dw SEL_DATA, SEL_CODE, SEL_STACK0, SEL_DATA
  dw 0

resume:   dw 0
a1_ax:    dw 0
a1_bx:    dw 0
a1_acc_a: dw 0
a1_acc_b: dw 0
a1_b_ip:  dw 0
a1_b_ax:  dw 0
a2_ax:    dw 0
a2_fl:    dw 0
a2_acc_a: dw 0
a2_acc_b: dw 0
a3_done:  dw 0
a4_done:  dw 0
a_msw:    dw 0
b1_ax:    dw 0
b1_cx:    dw 0
b1_tr:    dw 0
b1_msw:   dw 0
b1_fl:    dw 0
b1_ss:    dw 0
b1_sp:    dw 0
b1_ldt:   dw 0
b1_acc_a: dw 0
b1_acc_b: dw 0
b1_a_ip:  dw 0
b2_ax:    dw 0
b2_fl:    dw 0
b2_link:  dw 0
b2_acc_a: dw 0
b2_acc_b: dw 0
c_fl:     dw 0
c_link:   dw 0
c_tr:     dw 0
d_err:    dw 0
d_a_ip:   dw 0
log_n:    dw 0
log:      times 8*32 dw 0
