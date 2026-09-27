; 80386 paging: a page directory at 80000h and a page table at 81000h (identity map of the
; first 4 MB with three changed pages), the A and D bits, page faults (CR2 and the error
; code), a stale TLB entry until CR3 is written, TR6/TR7 TLB tests, and U/S, R/W checks at
; CPL 3.
cpu 386
bits 16
org 0
%include "pm386.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h
SEL_FLAT   equ 0x20       ; flat data, base 0, 4 GB
SEL_TSS    equ 0x28       ; 386 TSS (level 0 stack)
SEL_CODE3  equ 0x33
SEL_DATA3  equ 0x3B
SEL_STACK3 equ 0x43       ; base 40000h
SEL_FLAT3  equ 0x4B       ; flat data, DPL 3

PD         equ 0x80000    ; page directory
PT0        equ 0x81000    ; page table for 0-4 MB

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  xor ax, ax
  mov fs, ax
  mov gs, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x10000
  mov ax, SEL_FLAT
  mov es, ax
  ; the page directory: only PDE 0 is present
  mov edi, PD
  xor eax, eax
  mov ecx, 1024
  cld
  rep stosd
  mov dword [es:PD], PT0 | 7
  ; page table 0: identity map, present, R/W, user
  mov edi, PT0
  mov eax, 7
  mov ecx, 1024
fill:
  stosd
  add eax, 0x1000
  loop fill
  mov dword [es:PT0 + 0x200*4], 0x90000 | 3      ; 200000h -> 90000h, supervisor, R/W
  mov dword [es:PT0 + 0x201*4], 0                ; 201000h: not present
  mov dword [es:PT0 + 0x202*4], 0x91000 | 5      ; 202000h -> 91000h, user, read-only
  ; paging on
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  mov eax, cr0
  mov [r_cr0], eax
  ; 1. a changed page, the A and D bits, a supervisor write to a read-only page
  mov dword [es:0x200010], 0x5A5A1234
  mov eax, [es:PT0 + 0x200*4]
  mov [r_pte200], eax
  mov eax, [es:PD]
  mov [r_pde0], eax
  mov eax, [es:0x202000]
  mov [r_ro_read], eax
  mov dword [es:0x202004], 0x11112222
  mov eax, [es:PT0 + 0x202*4]
  mov [r_pte202], eax
  ; 2. page faults
  TRY mov eax, [es:0x201000]      ; not present, read: error 0
  TRY mov dword [es:0x201234], 1  ; not present, write: error 2
  TRY mov eax, [es:0x400000]      ; PDE 1 not present: error 0
  TRY mov eax, [es:0x200FFE]      ; a dword across into 201000h: CR2 = 201000h
  ; 3. the TLB keeps the old translation until CR3 is written
  mov eax, [es:0x200010]
  mov dword [es:PT0 + 0x200*4], 0x92000 | 3
  mov eax, [es:0x200010]
  mov [r_tlb_old], eax
  mov eax, cr3
  mov cr3, eax
  mov eax, [es:0x200010]
  mov [r_tlb_new], eax
  ; 4. TR6 / TR7: TLB lookup and TLB write
  mov eax, 0x00200001             ; linear 200000h, C = 1 (lookup)
  mov tr6, eax
  mov eax, tr7
  mov [r_tr7_hit], eax
  mov eax, 0x00300001
  mov tr6, eax
  mov eax, tr7
  mov [r_tr7_miss], eax
  mov eax, 0x00093000 | (1 << 2)  ; physical 93000h, way 1
  mov tr7, eax
  mov eax, 0x00300000 | 0x800 | 0x400 | 0x40   ; linear 300000h, V, D, W; C = 0 (write)
  mov tr6, eax
  mov eax, [es:0x300000]
  mov [r_tr_read], eax
  ; 5. CPL 3
  mov ax, SEL_TSS
  ltr ax
  push dword SEL_STACK3
  push dword 0xFFF0
  push dword 0x002
  push dword SEL_CODE3
  push dword user
  iretd

user:
  mov ax, SEL_DATA3
  mov ds, ax
  mov ax, SEL_FLAT3
  mov es, ax
  mov eax, [es:0x202000]
  mov [r_user_read], eax
  TRY mov dword [es:0x202000], 5  ; user write to a read-only page: error 7
  TRY mov eax, [es:0x200000]      ; user read of a supervisor page: error 5
  int 0x41

int41:
  mov ax, SEL_DATA
  mov ds, ax
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
  DESC32 BASE + OFS(tss), 103, ACC_TSS386, 0          ; 28
  DESC32 BASE, 0xFFFFF, ACC_CODE3, FL_32              ; 30
  DESC32 BASE, 0xFFFFF, ACC_DATA3, FL_32              ; 38
  DESC32 0x40000, 0xFFFF, ACC_DATA3, FL_D             ; 40
  DESC32 0, 0xFFFFF, ACC_DATA3, FL_32                 ; 48
gdt_end:
idt:
  IDT_EXC
  times 0x41 - 17 dq 0
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

r_cr0:      dd 0
r_pte200:   dd 0
r_pde0:     dd 0
r_ro_read:  dd 0
r_pte202:   dd 0
r_tlb_old:  dd 0
r_tlb_new:  dd 0
r_tr7_hit:  dd 0
r_tr7_miss: dd 0
r_tr_read:  dd 0
r_user_read: dd 0
r_done:     dd 0
  LOG_AREA
