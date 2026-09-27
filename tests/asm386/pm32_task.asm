; 80386 task switches: CALL to a 386 TSS (NT, back link, busy bits, the saved state of the
; old task), IRETD back, INT 50h through a task gate, and JMP to a 286 TSS (mixed formats).
cpu 386
bits 16
org 0
%include "pm386.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack of task A, base 30000h
SEL_TSSA   equ 0x20       ; 386 TSS of task A (the main program)
SEL_TSSB   equ 0x28       ; 386 TSS of task B
SEL_TSSC   equ 0x30       ; 286 TSS of task C
SEL_STACK16 equ 0x38      ; 16-bit stack of task C, base 38000h
SEL_STACKB equ 0x40       ; 32-bit stack of task B, base 38000h
SEL_CODE16 equ 0x48       ; 16-bit code (task C)

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax
  xor ax, ax
  mov fs, ax                      ; null selectors (the task switch back loads them)
  mov gs, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x10000
  mov ax, SEL_TSSA
  ltr ax
  ; 1. CALL to a 386 TSS
  mov eax, 0xAAAA0001
  mov ebx, 0xAAAA0002
  mov esi, 0xAAAA0006
  call SEL_TSSB:0
after_call:
  mov [r_a_eax], eax
  mov [r_a_ebx], ebx
  mov [r_a_esi], esi
  pushfd
  pop dword [r_a_fl]
  smsw ax
  mov [r_msw], ax
  clts
  smsw ax
  mov [r_msw2], ax
  mov al, [gdt + SEL_TSSB + 5]
  mov [r_b_busy_after], al
  ; 2. INT 50h through a task gate (task B again)
  mov ecx, 0x0000C0C0
  int 0x50
after_int:
  mov [r_a_ecx], ecx
  ; 3. JMP to a 286 TSS; task C jumps back
  jmp SEL_TSSC:0
after_jmp:
  mov al, [gdt + SEL_TSSC + 5]
  mov [r_c_busy_after], al
  mov al, [gdt + SEL_TSSA + 5]
  mov [r_a_busy_after], al
  mov ax, [tss_c + 14]
  mov [r_c_saved_ip], ax
  pushfd
  pop dword [r_a_fl2]
  mov dword [r_done], 0xD0D0
  hlt

task_b:                           ; 386 task B (CS = SEL_CODE, SS = SEL_STACKB)
  mov [r_b_eax], eax
  mov [r_b_esp], esp
  mov [r_b_ss], ss
  mov [r_b_fs], fs
  pushfd
  pop dword [r_b_fl]
  str ax
  mov [r_b_tr], ax
  mov eax, [tss_b]
  mov [r_b_link], eax
  mov eax, [tss_a + 0x28]
  mov [r_a_saved_eax], eax
  mov eax, [tss_a + 0x20]
  mov [r_a_saved_eip], eax
  mov eax, [tss_a + 0x24]
  mov [r_a_saved_fl], eax
  mov al, [gdt + SEL_TSSB + 5]
  mov [r_b_busy], al
  mov al, [gdt + SEL_TSSA + 5]
  mov [r_a_busy], al
  mov eax, 0x12121212
  iretd                           ; NT = 1: back to task A
  ; the second entry (INT 50h)
  mov [r_b2_ecx], ecx
  pushfd
  pop dword [r_b2_fl]
  mov eax, [tss_b]
  mov [r_b2_link], eax
  mov ecx, 0x77777777
  iretd

bits 16
task_c:                           ; 286 task C (16-bit code)
  mov [r_c_ax], ax
  pushf
  pop word [r_c_fl]
  mov al, [gdt + SEL_TSSA + 5]
  mov [r_c_abusy], al
  mov eax, [tss_a + 0x20]
  mov [r_c_a_eip], eax
  jmp SEL_TSSA:0
after_c_jmp:
bits 32

  EXC_STUBS

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0x1FFFF, ACC_DATA0, FL_D            ; 18
  DESC32 BASE + OFS(tss_a), 103, ACC_TSS386, 0        ; 20
  DESC32 BASE + OFS(tss_b), 103, ACC_TSS386, 0        ; 28
  DESC32 BASE + OFS(tss_c), 43, ACC_TSS286, 0         ; 30
  DESC32 0x38000, 0xFFFF, ACC_DATA0, 0                ; 38 (16-bit stack, B = 0)
  DESC32 0x38000, 0xFFFF, ACC_DATA0, FL_D             ; 40
  DESC32 BASE, 0xFFFF, ACC_CODE0, 0                   ; 48
gdt_end:
idt:
  IDT_EXC
  times 0x50 - 17 dq 0
  GATE32 0, SEL_TSSB, 0, ACC_TASKG0                   ; 50: task gate -> TSS B
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 4
tss_a:                            ; 386 TSS of task A: the CPU saves A's state here
  times 25 dd 0
  dw 0, 104
tss_b:                            ; 386 TSS of task B
  dd 0                            ; 00 back link
  times 6 dd 0                    ; 04-18 ESP0..SS2
  dd 0                            ; 1C CR3
  dd task_b                       ; 20 EIP
  dd 0x00000002                   ; 24 EFLAGS
  dd 0xBBBB0001, 0xBBBB0002, 0xBBBB0003, 0xBBBB0004   ; 28 EAX ECX EDX EBX
  dd 0x8000, 0, 0, 0              ; 38 ESP EBP ESI EDI
  dd SEL_DATA, SEL_CODE, SEL_STACKB, SEL_DATA, SEL_DATA, 0   ; 48 ES CS SS DS FS GS
  dd 0                            ; 60 LDT
  dw 0, 104                       ; 64 T bit, I/O map base
tss_c:                            ; 286 TSS of task C
  dw 0                            ; 00 back link
  times 6 dw 0                    ; 02-0C SP0..SS2
  dw task_c                       ; 0E IP
  dw 0x0002                       ; 10 FLAGS
  dw 0xC001, 0xC002, 0xC003, 0xC004   ; 12 AX CX DX BX
  dw 0x7000, 0, 0, 0              ; 1A SP BP SI DI
  dw SEL_DATA, SEL_CODE16, SEL_STACK16, SEL_DATA  ; 22 ES CS SS DS
  dw 0                            ; 2A LDT

r_a_eax:   dd 0
r_a_ebx:   dd 0
r_a_esi:   dd 0
r_a_ecx:   dd 0
r_a_fl:    dd 0
r_a_fl2:   dd 0
r_msw:     dd 0
r_msw2:    dd 0
r_b_busy_after: dd 0
r_c_busy_after: dd 0
r_a_busy_after: dd 0
r_c_saved_ip: dd 0
r_b_eax:   dd 0
r_b_esp:   dd 0
r_b_ss:    dd 0
r_b_fs:    dd 0
r_b_fl:    dd 0
r_b_tr:    dd 0
r_b_link:  dd 0
r_a_saved_eax: dd 0
r_a_saved_eip: dd 0
r_a_saved_fl: dd 0
r_b_busy:  dd 0
r_a_busy:  dd 0
r_b2_ecx:  dd 0
r_b2_fl:   dd 0
r_b2_link: dd 0
r_c_ax:    dd 0
r_c_fl:    dd 0
r_c_abusy: dd 0
r_c_a_eip: dd 0
r_done:    dd 0
  LOG_AREA
