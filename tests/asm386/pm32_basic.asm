; 80386 protected mode: 32-bit code and data (G and D bits), SIB addressing, the new
; 386 instructions, a 16-bit code segment called from 32-bit code, CPL 3, a 386 call gate
; that copies one dword parameter, a 386 interrupt gate, and privileged instructions at CPL 3.
cpu 386
bits 16
org 0
%include "pm386.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE, limit 4 GB
SEL_DATA   equ 0x10       ; 32-bit data, base BASE, limit 4 GB
SEL_STACK  equ 0x18       ; 32-bit stack (B = 1), base 30000h, limit 1FFFFh
SEL_FLAT   equ 0x20       ; flat data, base 0, limit 4 GB
SEL_SMALL  equ 0x28       ; data, base 50000h, limit 0 with G = 1 (4 KB)
SEL_CODE3  equ 0x33       ; DPL 3 code (RPL 3)
SEL_DATA3  equ 0x3B       ; DPL 3 data
SEL_STACK3 equ 0x43       ; DPL 3 stack, base 40000h
SEL_TSS    equ 0x48       ; 386 TSS (the level 0 stack)
SEL_GATE   equ 0x53       ; 386 call gate, DPL 3, 1 dword parameter
SEL_FCODE  equ 0x58       ; flat 32-bit code, base 0
SEL_CODE16 equ 0x60       ; 16-bit code (D = 0), base BASE

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x10000
  mov [r_cs], cs
  ; 1. 32-bit arithmetic and addressing
  mov eax, 0x12345678
  add eax, 0x9ABCDEF0
  mov [r_add], eax
  pushfd
  pop dword [r_add_fl]
  mov ebx, table
  mov esi, 3
  mov eax, [ebx+esi*4+4]
  mov [r_sib], eax
  lea ecx, [ebx+esi*8+0x100]
  mov [r_lea], ecx
  movzx eax, byte [table+3]
  mov [r_movzx], eax
  movsx eax, word [table+10]
  mov [r_movsx], eax
  mov eax, 0x00F00000
  bsf ecx, eax
  bsr edx, eax
  mov [r_bsf], ecx
  mov [r_bsr], edx
  bts dword [bits_v], 3
  mov eax, 40
  bts [bits_v], eax
  mov eax, 0x80000001
  mov edx, 0x12345678
  shld eax, edx, 4
  mov [r_shld], eax
  mov eax, 7
  imul eax, eax, -3
  mov [r_imul], eax
  mov eax, 0xFFFFFFFF
  mov edx, eax
  mul edx
  mov [r_mul_lo], eax
  mov [r_mul_hi], edx
  mov edx, 1
  xor eax, eax
  mov ecx, 3
  div ecx
  mov [r_div_q], eax
  mov [r_div_r], edx
  cmp eax, 0x55555555
  sete byte [r_sete]
  mov esi, table
  mov edi, copy
  mov ecx, 4
  cld
  rep movsd
  push dword 0xCAFEBABE
  pop dword [r_pop]
  mov [r_esp], esp
  ; 2. G bit: limit 0 with G = 1 is 4 KB; the flat segment reaches any address
  mov ax, SEL_SMALL
  mov fs, ax
  mov eax, [fs:0xFFC]
  mov [r_small], eax
  TRY mov eax, [fs:0xFFE]
  mov ax, SEL_FLAT
  mov gs, ax
  mov dword [gs:0x123456], 0x600DF00D
  ; 3. far call to a 16-bit code segment (it returns with a 32-bit RETF)
  call SEL_CODE16:code16
  mov [r_c16], eax
  ; 4. CPL 3 through IRETD
  mov ax, SEL_TSS
  ltr ax
  push dword SEL_STACK3
  push dword 0xFFF0
  push dword 0x202
  push dword SEL_CODE3
  push dword user
  iretd

user:                             ; CPL 3
  mov ax, SEL_DATA3
  mov ds, ax
  mov es, ax
  mov [r_user_cs], cs
  push dword 0xA5A5A5A5
  call SEL_GATE:0                 ; 386 call gate: CPL 3 -> 0, one dword copied
after_gate:
  mov [r_gate_ret], eax
  mov [r_gate_esp], esp
  mov eax, 0x13579BDF
  int 0x40                        ; 386 interrupt gate (DPL 3): CPL 3 -> 0
after_int:
  mov [r_int_ret], eax
  mov [r_int_esp], esp
  TRY cli                         ; CPL 3 > IOPL 0: #GP(0)
  TRY hlt                         ; #GP(0)
  TRY mov eax, cr0                ; #GP(0)
  mov bx, SEL_DATA
  TRY mov ds, bx                  ; DPL 0 data at CPL 3: #GP(10h)
  int 0x41                        ; the end (CPL 0)

gate_target:                      ; flat code (base 0), CPL 0
  push ds
  push eax
  mov ax, SEL_DATA
  mov ds, ax
  mov eax, [esp+8]
  mov [r_g_eip], eax
  mov eax, [esp+12]
  mov [r_g_cs], eax
  mov eax, [esp+16]
  mov [r_g_param], eax
  mov eax, [esp+20]
  mov [r_g_esp], eax
  mov eax, [esp+24]
  mov [r_g_ss], eax
  mov [r_g_mycs], cs
  mov [r_g_myss], ss
  mov [r_g_myesp], esp
  pop eax
  pop ds
  mov eax, 0x11111111
  retf 4

int40:                            ; 386 interrupt gate
  push ds
  push ebx
  mov bx, SEL_DATA
  mov ds, bx
  pushfd
  pop dword [r_i_fl]
  mov ebx, [esp+8]
  mov [r_i_eip], ebx
  mov ebx, [esp+12]
  mov [r_i_cs], ebx
  mov ebx, [esp+16]
  mov [r_i_efl], ebx
  mov ebx, [esp+20]
  mov [r_i_esp], ebx
  mov ebx, [esp+24]
  mov [r_i_ss], ebx
  mov [r_i_eax], eax
  pop ebx
  pop ds
  mov eax, 0x22222222
  iretd

int41:
  mov ax, SEL_DATA
  mov ds, ax
  mov [r_end_cs], cs
  mov dword [r_done], 0xD0D0
  hlt

bits 16
code16:                           ; 16-bit code segment
  mov ax, 0x1234
  mov [r_c16w], ax
  mov eax, 0x16161616
  o32 retf
bits 32

  EXC_STUBS

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0x1FFFF, ACC_DATA0, FL_D            ; 18 (the log routine reads above the top)
  DESC32 0, 0xFFFFF, ACC_DATA0, FL_32                 ; 20
  DESC32 0x50000, 0, ACC_DATA0, FL_G                  ; 28
  DESC32 BASE, 0xFFFFF, ACC_CODE3, FL_32              ; 30
  DESC32 BASE, 0xFFFFF, ACC_DATA3, FL_32              ; 38
  DESC32 0x40000, 0xFFFF, ACC_DATA3, FL_D             ; 40
  DESC32 BASE + OFS(tss), 103, ACC_TSS386, 0          ; 48
  GATE32 BASE + OFS(gate_target), SEL_FCODE, 1, ACC_CALLG3   ; 50
  DESC32 0, 0xFFFFF, ACC_CODE0, FL_32                 ; 58
  DESC32 BASE, 0xFFFF, ACC_CODE0, 0                   ; 60
gdt_end:
idt:
  IDT_EXC
  times 0x40 - 17 dq 0
  GATE32 OFS(int40), SEL_CODE, 0, ACC_INTG3           ; 40
  GATE32 OFS(int41), SEL_CODE, 0, ACC_INTG3           ; 41
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 4
tss:
  dd 0                            ; back link
  dd 0x8000                       ; ESP0
  dd SEL_STACK                    ; SS0
  times 22 dd 0
  dw 0, 104                       ; T bit, I/O map base (outside the TSS: no ports)

table:     dd 0x11223344, 0x55667788, 0x99AABBCC, 0xDDEEFF00, 0x0BADF00D
copy:      dd 0, 0, 0, 0
bits_v:    dd 0, 0
r_cs:      dd 0
r_add:     dd 0
r_add_fl:  dd 0
r_sib:     dd 0
r_lea:     dd 0
r_movzx:   dd 0
r_movsx:   dd 0
r_bsf:     dd 0
r_bsr:     dd 0
r_shld:    dd 0
r_imul:    dd 0
r_mul_lo:  dd 0
r_mul_hi:  dd 0
r_div_q:   dd 0
r_div_r:   dd 0
r_sete:    dd 0
r_pop:     dd 0
r_esp:     dd 0
r_small:   dd 0
r_c16:     dd 0
r_c16w:    dd 0
r_user_cs: dd 0
r_gate_ret: dd 0
r_gate_esp: dd 0
r_int_ret: dd 0
r_int_esp: dd 0
r_g_eip:   dd 0
r_g_cs:    dd 0
r_g_param: dd 0
r_g_esp:   dd 0
r_g_ss:    dd 0
r_g_mycs:  dd 0
r_g_myss:  dd 0
r_g_myesp: dd 0
r_i_fl:    dd 0
r_i_eip:   dd 0
r_i_cs:    dd 0
r_i_efl:   dd 0
r_i_esp:   dd 0
r_i_ss:    dd 0
r_i_eax:   dd 0
r_end_cs:  dd 0
r_done:    dd 0
  LOG_AREA
