; 80486 paging: CR0.WP (supervisor writes to read-only pages), INVLPG (one TLB entry),
; the PCD and PWT bits with the on-chip cache, and at CPL 3: INVLPG / INVD / WBINVD give
; #GP(0), CPUID works, CMPXCHG writes its destination also when the values are not equal.
cpu 486
bits 16
org 0
%include "pm486.inc"

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
  CACHE_ON
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
  mov dword [es:PT0 + 0x200*4], 0x90000 | 5      ; 200000h -> 90000h, user, read-only
  mov dword [es:PT0 + 0x201*4], 0x91000 | 1      ; 201000h -> 91000h, supervisor, read-only
  mov dword [es:PT0 + 0x202*4], 0x92000 | 3      ; 202000h -> 92000h, supervisor, R/W
  mov dword [es:PT0 + 0x203*4], 0x93000 | 0x13   ; 203000h -> 93000h, PCD = 1
  mov dword [es:PT0 + 0x204*4], 0x94000 | 0x0B   ; 204000h -> 94000h, PWT = 1
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  ; 1. WP = 0 (the 80386 rule): supervisor writes to read-only pages work
  mov dword [es:0x200000], 0x11111111
  mov dword [es:0x201000], 0x22222222
  ; 2. WP = 1: a supervisor write to a read-only page gives #PF (error 3: P, W/R)
  mov eax, cr0
  or eax, CR0_WP
  mov cr0, eax
  mov [r_cr0], eax
  mov eax, [es:0x200004]          ; a read works (and puts a TLB entry with R/W = 0)
  mov [r_wp_read], eax
  TRY mov dword [es:0x200008], 1  ; user read-only page
  TRY mov dword [es:0x201008], 1  ; supervisor read-only page
  mov dword [es:0x202000], 0x33333333   ; a R/W page works
  mov eax, cr0
  and eax, ~CR0_WP
  mov cr0, eax
  mov dword [es:0x200008], 0x44444444   ; WP = 0 again: the write works
  ; 3. INVLPG removes one TLB entry
  mov eax, [es:0x202000]
  mov eax, [es:0x201000]
  mov dword [es:PT0 + 0x202*4], 0x95000 | 3
  mov dword [es:PT0 + 0x201*4], 0x96000 | 3
  mov eax, [es:0x202000]
  mov [r_inv_old], eax            ; the old frame (a stale TLB entry)
  invlpg [es:0x202000]
  mov eax, [es:0x202000]
  mov [r_inv_new], eax            ; the new frame
  mov eax, [es:0x201000]
  mov [r_inv_other], eax          ; 201000h keeps its old entry
  mov eax, cr3
  mov cr3, eax
  mov eax, [es:0x201000]
  mov [r_inv_all], eax            ; after MOV CR3: the new frame
  ; 4. PCD and PWT
  mov eax, [es:0x203000]
  mov [r_pcd], eax
  mov eax, [es:0x204010]
  mov [r_pwt], eax
  mov dword [es:0x204010], 0x5A5A5A5A
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
  TRY invlpg [es:0x200000]        ; #GP(0)
  TRY invd                        ; #GP(0)
  TRY wbinvd                      ; #GP(0)
  cpu 586                         ; NASM 2.16 has CPUID and CMPXCHG (0F B0 / B1) only at its Pentium level
  xor eax, eax
  cpuid
  mov [r_cpuid], ebx              ; "Genu"
  mov eax, 1
  mov ecx, 2
  TRY lock cmpxchg [es:0x200000], ecx   ; not equal, but a write to a read-only page: #PF (7)
  mov [r_cmpx_eax], eax           ; the fault comes first: EAX does not change
  mov eax, 0x11111111
  TRY cmpxchg [es:0x200000], ecx        ; equal: #PF too
  cpu 486
  int 0x41

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
  DESC32 0x30000, 0x1FFFF, ACC_DATA0, FL_D            ; 18
  DESC32 0, 0xFFFFF, ACC_DATA0, FL_32                 ; 20
  DESC32 BASE + OFS(tss), 103, ACC_TSS386, 0          ; 28
  DESC32 BASE, 0xFFFFF, ACC_CODE3, FL_32              ; 30
  DESC32 BASE, 0xFFFFF, ACC_DATA3, FL_32              ; 38
  DESC32 0x40000, 0xFFFF, ACC_DATA3, FL_D             ; 40
  DESC32 0, 0xFFFFF, ACC_DATA3, FL_32                 ; 48
gdt_end:
idt:
  IDT_EXC486
  times 0x41 - 18 dq 0
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

r_cr0:       dd 0
r_wp_read:   dd 0
r_inv_old:   dd 0
r_inv_new:   dd 0
r_inv_other: dd 0
r_inv_all:   dd 0
r_pcd:       dd 0
r_pwt:       dd 0
r_cpuid:     dd 0
r_cmpx_eax:  dd 0
r_done:      dd 0
  LOG_AREA
