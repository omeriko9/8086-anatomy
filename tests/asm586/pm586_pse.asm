; Pentium 4 MB pages (CR4.PSE): with PSE = 0 the PS bit of a PDE has no effect; with PSE = 1
; a PDE with PS = 1 maps 4 MB (A and D in the PDE, U/S and R/W of the PDE, a reserved bit gives
; #PF with RSVD), the PCD / PWT bits of a 4 MB page and the data cache (MESI S and E), INVLPG
; of a 4 MB entry, code in a 4 MB page (the code TLB).
cpu 586
bits 16
org 0
%include "pm586.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h
SEL_FLAT   equ 0x20       ; flat data, base 0, 4 GB
SEL_TSS    equ 0x28       ; 386 TSS (level 0 stack)
SEL_CODE3  equ 0x33
SEL_DATA3  equ 0x3B
SEL_STACK3 equ 0x43       ; base 40000h
SEL_FLAT3  equ 0x4B       ; flat data, DPL 3
SEL_CODEHI equ 0x50       ; 32-bit code, base 1800000h + BASE (this program through PDE 6)

PD         equ 0x80000    ; page directory
PT0        equ 0x81000    ; page table for 0-4 MB (4 KB pages)

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
  ; the page directory: PDE 0 -> page table 0 (0-4 MB, identity, user, R/W)
  mov edi, PD
  xor eax, eax
  mov ecx, 1024
  cld
  rep stosd
  mov dword [es:PD], PT0 | 7
  mov edi, PT0
  mov eax, 7
  mov ecx, 1024
fill:
  stosd
  add eax, 0x1000
  loop fill
  ; PDEs with PS = 1
  mov dword [es:PD + 1*4], 0x400000 | PDE_PS | PG_RW | PG_P            ; 400000h: supervisor, R/W
  mov dword [es:PD + 2*4], 0x400000 | PDE_PS | PG_US | PG_P            ; 800000h -> 400000h: user, read-only
  mov dword [es:PD + 3*4], 0x401000 | PDE_PS | PG_RW | PG_P            ; C00000h: bit 12 = 1 (reserved)
  mov dword [es:PD + 4*4], 0xC00000 | PDE_PS | PG_PCD | PG_RW | PG_P   ; 1000000h -> C00000h: PCD
  mov dword [es:PD + 5*4], 0xC00000 | PDE_PS | PG_PWT | PG_RW | PG_P   ; 1400000h -> C00000h: PWT
  mov dword [es:PD + 6*4], 0x000000 | PDE_PS | PG_RW | PG_P            ; 1800000h -> 0: the code alias
  mov dword [es:PD + 7*4], 0xC00000 | PDE_PS | PG_RW | PG_P            ; 1C00000h -> C00000h
  mov eax, PD
  mov cr3, eax
  mov eax, cr0
  or eax, 0x80000000
  mov cr0, eax
  jmp short paged
paged:
  ; 1. CR4.PSE = 0: PDE 1 points to a page table at 400000h (its entries are 0)
  TRY mov eax, [es:0x400010]      ; #PF(0): the page table entry is not present
  ; 2. CR4.PSE = 1: PDE 1 maps a 4 MB page
  CR4_SET CR4_PSE
  mov eax, cr4
  mov [r_cr4], eax
  mov eax, [es:0x400010]
  mov [r_big], eax                ; 5A5A5A5Ah (physical 400010h)
  mov dword [es:0x400020], 0x12345678    ; the PDE gets D
  mov eax, [es:0x800010]          ; the same frame through PDE 2
  mov [r_alias], eax
  ; 3. a reserved bit (12) in a 4 MB PDE: #PF with RSVD (error code 9)
  TRY mov eax, [es:0xC00000]
  ; 4. CR0.WP = 1: a supervisor write to a read-only 4 MB page gives #PF(3)
  mov eax, cr0
  or eax, CR0_WP
  mov cr0, eax
  TRY mov dword [es:0x800030], 1
  mov eax, cr0
  and eax, ~CR0_WP
  mov cr0, eax
  ; 5. PCD and PWT of a 4 MB page
  mov eax, [es:0x1000000]
  mov [r_pcd], eax                ; C3C3C3C3h, no cache line
  mov eax, [es:0x1400040]         ; PWT = 1: the line fills as S
  mov dword [es:0x1400040], 0x44444444   ; a write hit on S with PWT = 1: write-through, S stays
  mov eax, [es:0x1400080]         ; the next line: S
  mov dword [es:0x1C00080], 0x55555555   ; the same line through a page with PWT = 0: S -> E
  ; 6. INVLPG removes the 4 MB entry
  mov dword [es:PD + 2*4], 0x800000 | PDE_PS | PG_US | PG_P
  mov eax, [es:0x800010]
  mov [r_inv_old], eax            ; the old frame (the TLB entry)
  invlpg [es:0x8FF123]            ; an address in the same 4 MB page
  mov eax, [es:0x800010]
  mov [r_inv_new], eax            ; 88888888h (physical 800010h)
  mov dword [es:PD + 2*4], 0x400000 | PDE_PS | PG_US | PG_P
  mov eax, cr3
  mov cr3, eax                    ; MOV CR3 flushes the 4 MB entries too
  ; 7. code in a 4 MB page: a far call through PDE 6
  call SEL_CODEHI:hi_func
  mov [r_hi], eax
  ; 8. CPL 3: the U/S and R/W bits of a 4 MB PDE
  mov ax, SEL_TSS
  ltr ax
  push dword SEL_STACK3
  push dword 0xFFF0
  push dword 0x002
  push dword SEL_CODE3
  push dword user
  iretd

hi_func:
  mov eax, [es:0x400010]
  retf

user:
  mov ax, SEL_DATA3
  mov ds, ax
  mov ax, SEL_FLAT3
  mov es, ax
  mov eax, [es:0x800010]          ; a user, read-only 4 MB page: a read works
  mov [r_user], eax
  TRY mov dword [es:0x800010], 1  ; #PF(7): a write to a read-only page at CPL 3
  TRY mov eax, [es:0x400010]      ; #PF(5): a supervisor page at CPL 3
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
  DESC32 0x1800000 + BASE, 0xFFFFF, ACC_CODE0, FL_32  ; 50
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

r_cr4:       dd 0
r_big:       dd 0
r_alias:     dd 0
r_pcd:       dd 0
r_inv_old:   dd 0
r_inv_new:   dd 0
r_hi:        dd 0
r_user:      dd 0
r_done:      dd 0
  LOG_AREA
