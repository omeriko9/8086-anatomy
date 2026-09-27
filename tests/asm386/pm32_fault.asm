; 80386 double and triple faults. Part 1: #GP while the #GP gate is not present gives #NP,
; two contributory exceptions give #DF(0). Part 2 (paging on): #PF while the stack page is
; not present gives a second #PF during the delivery, so #DF, here through a task gate to
; a 386 task with a good stack. Part 3: that task loads an IDT with limit 0; INT 3 gives
; #GP, then #DF, then a fault during #DF: the processor shuts down (triple fault).
cpu 386
bits 16
org 0
%include "pm386.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h
SEL_FLAT   equ 0x20       ; flat data
SEL_TSSM   equ 0x28       ; 386 TSS of the main task
SEL_TSSDF  equ 0x30       ; 386 TSS of the double-fault task

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
  mov ax, SEL_TSSM
  ltr ax
  ; part 1: #GP -> #NP (the gate is not present) -> #DF(0)
  mov byte [idt + 13*8 + 5], 0x0E
  mov bx, 0x0100
  TRY mov fs, bx
  mov byte [idt + 13*8 + 5], ACC_INTG0
  mov dword [r_part1], 1
  ; part 2: paging; the stack page 3E000h is not present
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
  mov dword [es:PT0 + 0x3E*4], 0              ; linear 3E000h: not present
  mov dword [es:PT0 + 0x201*4], 0             ; linear 201000h: not present
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  mov dword [idt + 8*8], SEL_TSSDF << 16       ; IDT 8: a task gate -> the double-fault task
  mov dword [idt + 8*8 + 4], 0x8500
  mov esp, 0xF000                 ; SS:ESP -> linear 3F000h; a push goes to page 3E000h
fault_here:
  mov eax, [es:0x201000]          ; #PF, then #PF on the push of the frame: #DF
  mov dword [r_after], 0xDEAD     ; not reached
  hlt

df_task:                          ; the double-fault task (386 TSS, its own stack)
  mov eax, cr2
  mov [r_df_cr2], eax
  mov eax, [esp]
  mov [r_df_err], eax
  mov [r_df_esp0], esp
  mov eax, [tss_m + 0x38]
  mov [r_df_esp], eax
  mov eax, [tss_m + 0x20]
  mov [r_df_eip], eax
  mov eax, [tss_df]
  mov [r_df_link], eax
  pushfd
  pop dword [r_df_fl]
  mov dword [r_df], 0xDF
  ; part 3: triple fault
  lidt [idtr_zero]
  int 3
  mov dword [r_after], 0xDEAD     ; not reached
  hlt

  EXC_STUBS

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0x1FFFF, ACC_DATA0, FL_D            ; 18
  DESC32 0, 0xFFFFF, ACC_DATA0, FL_32                 ; 20
  DESC32 BASE + OFS(tss_m), 103, ACC_TSS386, 0        ; 28
  DESC32 BASE + OFS(tss_df), 103, ACC_TSS386, 0       ; 30
gdt_end:
idt:
  IDT_EXC
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt
idtr_zero: dw 0
      dd BASE + idt

align 4
tss_m:                            ; main task: the CPU saves its state here
  times 25 dd 0
  dw 0, 104
tss_df:                           ; the double-fault task
  dd 0                            ; 00 back link
  times 6 dd 0
  dd PD                           ; 1C CR3 (paging stays on)
  dd df_task                      ; 20 EIP
  dd 0x00000002                   ; 24 EFLAGS
  dd 0, 0, 0, 0                   ; 28 EAX ECX EDX EBX
  dd 0x8000, 0, 0, 0              ; 38 ESP EBP ESI EDI
  dd SEL_FLAT, SEL_CODE, SEL_STACK, SEL_DATA, 0, 0   ; 48 ES CS SS DS FS GS
  dd 0                            ; 60 LDT
  dw 0, 104

r_part1:   dd 0
r_df_cr2:  dd 0
r_df_err:  dd 0
r_df_esp0: dd 0
r_df_esp:  dd 0
r_df_eip:  dd 0
r_df_link: dd 0
r_df_fl:   dd 0
r_df:      dd 0
r_after:   dd 0
  LOG_AREA
