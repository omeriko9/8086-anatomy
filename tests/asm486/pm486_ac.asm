; 80486 alignment check: #AC (vector 17, error code 0) at CPL 3 when CR0.AM = 1 and
; EFLAGS.AC = 1, for data, stack and FPU operands that are not aligned. No check at CPL 0,
; with AC = 0 or with AM = 0.
cpu 486
bits 16
org 0
%include "pm486.inc"

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
  mov eax, cr0
  or eax, CR0_AM
  mov cr0, eax
  mov [r_cr0], eax
  ; CPL 0 with AC = 1: no alignment check
  pushfd
  or dword [esp], EFL_AC
  popfd
  mov eax, [odd + 1]
  mov [r_cpl0], eax
  ; to CPL 3 with AC = 1 in the EFLAGS image
  push dword SEL_STACK3
  push dword 0xFFF0
  push dword EFL_AC | 2
  push dword SEL_CODE3
  push dword user
  iretd

user:
  mov ax, SEL_DATA3
  mov ds, ax
  mov es, ax
  pushfd
  pop dword [r_user_fl]
  mov eax, [odd]                  ; aligned: no fault
  mov [r_aligned], eax
  TRY mov eax, [odd + 1]          ; a dword at 4n+1: #AC
  TRY mov word [odd + 1], 5       ; a word at an odd address: #AC
  TRY mov dword [odd + 2], 5      ; a dword at 4n+2: #AC
  mov ax, [odd + 2]               ; a word at an even address: no fault
  mov [r_word2], ax
  mov al, [odd + 3]               ; a byte: never
  mov [r_byte3], al
  mov ebx, esp
  sub esp, 2
  TRY push eax                    ; a dword push with ESP = 4n+2: #AC
  mov esp, ebx
  fninit
  fld dword [odd]                 ; aligned FPU operand: no fault
  fstp dword [r_fpu_ok]
  TRY fld dword [odd + 2]         ; a dword FPU operand at 4n+2: #AC
  TRY fld qword [qw + 4]          ; a qword at 8n+4: #AC (8-byte alignment)
  ; AC = 0 at CPL 3: no check
  pushfd
  and dword [esp], ~EFL_AC
  popfd
  mov eax, [odd + 1]
  mov [r_ac0], eax
  ; AC = 1 again; INT 40h clears CR0.AM at CPL 0
  pushfd
  or dword [esp], EFL_AC
  popfd
  int 0x40
  mov eax, [odd + 1]              ; AM = 0: no fault
  mov [r_am0], eax
  int 0x41

int40:
  mov eax, cr0
  and eax, ~CR0_AM
  mov cr0, eax
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
  times 0x40 - 18 dq 0
  GATE32 OFS(int40), SEL_CODE, 0, ACC_INTG3           ; 40
  GATE32 OFS(int41), SEL_CODE, 0, ACC_INTG3           ; 41
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

align 8
odd:        dd 0x44332211, 0x88776655
qw:         dq 1.0, 2.0
r_cr0:      dd 0
r_cpl0:     dd 0
r_user_fl:  dd 0
r_aligned:  dd 0
r_word2:    dd 0
r_byte3:    dd 0
r_fpu_ok:   dd 0
r_ac0:      dd 0
r_am0:      dd 0
r_done:     dd 0
  LOG_AREA
