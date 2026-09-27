; Pentium Pro global pages (CR4.PGE): the TLB entry of a page with G = 1 stays after MOV CR3;
; INVLPG removes it; a change of CR4.PGE and a change of CR0.PG remove all entries; with PGE = 0 the
; G bit has no effect. Linear 400000h (global) and 401000h (not global) go to the frames at 100000h-
; 103000h; the harness puts 11111111h, 22222222h, 33333333h and 44444444h there.
cpu 686
bits 16
org 0
%include "pm686.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h
SEL_FLAT   equ 0x20       ; flat data, base 0, 4 GB

PD         equ 0x80000    ; page directory
PT0        equ 0x81000    ; page table for 0-4 MB (identity)
PT1        equ 0x82000    ; page table for 4-8 MB (the test pages)
LG         equ 0x400000   ; a global page
LN         equ 0x401000   ; a page that is not global

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x10000
  mov ax, SEL_FLAT
  mov es, ax
  CACHE_ON
  mov edi, PD
  xor eax, eax
  mov ecx, 3 * 1024
  cld
  rep stosd
  mov dword [es:PD], PT0 | PG_RW | PG_P
  mov dword [es:PD + 4], PT1 | PG_RW | PG_P
  mov edi, PT0
  mov eax, PG_RW | PG_P
  mov ecx, 1024
fill:
  stosd
  add eax, 0x1000
  loop fill
  mov dword [es:PT1], 0x100000 | PG_G | PG_RW | PG_P
  mov dword [es:PT1 + 4], 0x101000 | PG_RW | PG_P
  CR4_SET CR4_PGE
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  mov eax, [es:LG]
  mov [r_g0], eax                 ; 11111111h
  mov eax, [es:LN]
  mov [r_n0], eax                 ; 22222222h
  ; the page table changes: LG -> 102000h, LN -> 103000h
  mov dword [es:PT1], 0x102000 | PG_G | PG_RW | PG_P
  mov dword [es:PT1 + 4], 0x103000 | PG_RW | PG_P
  mov eax, cr3
  mov cr3, eax                    ; the entry of LN goes; the global entry of LG stays
  mov eax, [es:LG]
  mov [r_g1], eax                 ; 11111111h (the old frame: the global TLB entry)
  mov eax, [es:LN]
  mov [r_n1], eax                 ; 44444444h (the new frame)
  invlpg [es:LG]                  ; INVLPG removes a global entry too
  mov eax, [es:LG]
  mov [r_g2], eax                 ; 33333333h
  ; a change of CR4.PGE removes all entries
  mov dword [es:PT1], 0x100000 | PG_G | PG_RW | PG_P
  CR4_CLEAR CR4_PGE
  mov eax, [es:LG]
  mov [r_g3], eax                 ; 11111111h
  ; PGE = 0: the G bit has no effect (MOV CR3 removes the entry)
  mov dword [es:PT1], 0x102000 | PG_G | PG_RW | PG_P
  mov eax, cr3
  mov cr3, eax
  mov eax, [es:LG]
  mov [r_g4], eax                 ; 33333333h
  ; PGE = 1: a change of CR0.PG removes the global entries too
  CR4_SET CR4_PGE
  mov eax, [es:LG]                ; a global entry of 102000h
  mov dword [es:PT1], 0x100000 | PG_G | PG_RW | PG_P
  mov eax, cr0
  and eax, 0x7FFFFFFF
  mov cr0, eax
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged2
paged2:
  mov eax, [es:LG]
  mov [r_g5], eax                 ; 11111111h
  mov eax, cr4
  mov [r_cr4], eax
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
gdt_end:
idt:
  IDT_EXC486
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 4
r_g0:       dd 0
r_n0:       dd 0
r_g1:       dd 0
r_n1:       dd 0
r_g2:       dd 0
r_g3:       dd 0
r_g4:       dd 0
r_g5:       dd 0
r_cr4:      dd 0
r_done:     dd 0
  LOG_AREA
