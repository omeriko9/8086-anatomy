; 80386 real mode: FLAGS bits 12-14 (IOPL, NT) can change (bit 15 stays 0), 32-bit
; registers and 32-bit addressing with the 66h / 67h prefixes, SMSW / MOV EAX, CR0, and
; "unreal" mode: a segment register loaded in protected mode keeps its 4 GB limit after the
; return to real mode, also after a real-mode load of the same register.
cpu 386
bits 16
org 0

BASE equ 0x10000

start:
  pushf
  pop ax
  or ax, 0xF000
  push ax
  popf
  pushf
  pop ax
  mov [r_fl], ax
  push word 0
  popf
  mov eax, 0x12345678
  mov ebx, 2
  mov [r_eax + ebx*2 - 4], eax    ; 32-bit addressing (67h) in real mode
  smsw ax
  mov [r_msw], ax
  mov eax, cr0
  mov [r_cr0], eax
  ; unreal mode
  cli
  o32 lgdt [gdtr]
  mov eax, cr0
  or al, 1
  mov cr0, eax
  jmp 0x08:pm16
pm16:
  mov ax, 0x10
  mov fs, ax
  mov eax, cr0
  and al, 0xFE
  mov cr0, eax
  jmp 0x1000:rm2
rm2:
  xor ax, ax
  mov fs, ax                      ; a real-mode load: base 0, the 4 GB limit stays
  mov ebx, 0x200000
  mov dword [fs:ebx], 0x0DDBA11
  mov eax, [fs:ebx]
  mov [r_unreal], eax
  mov dword [r_done], 0xD0D0
  hlt

align 8
gdt:
  dq 0
  dw 0xFFFF, BASE & 0xFFFF         ; 08: 16-bit code, base BASE
  db BASE >> 16, 0x9A, 0x00, 0
  dw 0xFFFF, 0                     ; 10: data, base 0, limit 4 GB (G = 1)
  db 0, 0x92, 0x8F, 0
gdt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt

align 4
r_fl:     dd 0
r_eax:    dd 0
r_msw:    dd 0
r_cr0:    dd 0
r_unreal: dd 0
r_done:   dd 0
