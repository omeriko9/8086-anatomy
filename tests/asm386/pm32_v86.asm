; 80386 virtual-8086 mode: IRETD with VM = 1 enters V86 mode; real-mode code runs there.
; With IOPL 0, CLI, PUSHF and INT n give #GP(0); IN / OUT use the I/O permission bitmap of
; the 386 TSS (port 60h allowed, 61h and 80h not). A #GP monitor at CPL 0 logs each fault
; and skips the instruction. Then with IOPL 3: CLI / STI / PUSHF work and INT 30h goes
; through a 386 interrupt gate to CPL 0 (the frame holds ES DS FS GS) and IRETD returns
; to V86 mode.
cpu 386
bits 16
org 0
%include "pm386.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h (level 0 stack of the TSS)
SEL_FLAT   equ 0x20       ; flat data
SEL_TSS    equ 0x28       ; 386 TSS with an I/O permission bitmap
V86SEG     equ BASE >> 4  ; the V86 code, data and stack segment (1000h)

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax
  xor ax, ax
  mov fs, ax
  mov gs, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x8000
  mov word [idt + 13*8], v86mon   ; #GP -> the V86 monitor
  mov ax, SEL_TSS
  ltr ax
  ; part 1: V86 mode with IOPL 0
  push dword 0                    ; GS
  push dword 0                    ; FS
  push dword V86SEG               ; DS
  push dword V86SEG               ; ES
  push dword V86SEG               ; SS
  push dword 0xFF00               ; ESP
  push dword 0x00020002           ; EFLAGS: VM = 1, IOPL = 0
  push dword V86SEG               ; CS
  push dword v86code              ; EIP
  iretd

part2:                            ; V86 mode with IOPL 3
  mov esp, 0x8000
  push dword 0
  push dword 0
  push dword V86SEG
  push dword V86SEG
  push dword V86SEG
  push dword 0xFF00
  push dword 0x00023202           ; VM = 1, IOPL = 3, IF = 1
  push dword V86SEG
  push dword v86code2
  iretd

finish:
  mov dword [r_done], 0xD0D0
  hlt

; #GP monitor. Frame: [ebp+4] error code, +8 EIP, +12 CS, +16 EFLAGS, +20 ESP, +24 SS,
; +28 ES, +32 DS, +36 FS, +40 GS (the last 6 only from V86 mode).
v86mon:
  push ebp
  mov ebp, esp
  push eax
  push ebx
  push ds
  mov bx, ds
  mov ax, SEL_DATA
  mov ds, ax
  movzx ebx, bx
  mov [r_mon_ds], ebx
  mov ebx, [log_n]
  shl ebx, 5
  mov dword [log+ebx], 13
  mov eax, [ebp+4]
  mov [log+ebx+4], eax
  mov eax, [ebp+8]
  mov [log+ebx+8], eax
  mov eax, [ebp+12]
  mov [log+ebx+12], eax
  mov eax, [ebp+16]
  mov [log+ebx+16], eax
  mov eax, [ebp+20]
  mov [log+ebx+20], eax
  mov eax, [ebp+24]
  mov [log+ebx+24], eax
  mov eax, [ebp+32]
  mov [log+ebx+28], eax           ; the V86 DS (in the CR2 slot)
  test dword [ebp+16], 0x20000
  jz .stop                        ; not from V86 mode: stop
  ; the opcode at CS:IP (linear = CS * 16 + IP)
  mov ax, SEL_FLAT
  mov es, ax
  mov eax, [ebp+12]
  shl eax, 4
  add eax, [ebp+8]
  movzx eax, byte [es:eax]
  mov ebx, [log_n]
  mov [ops+ebx*4], eax
  inc dword [log_n]
  cmp al, 0xF4
  je .hlt
  mov ebx, 1                      ; skip 1 byte, or 2 for INT n and IN / OUT imm8
  cmp al, 0xCD
  je .two
  cmp al, 0xE4
  jb .one
  cmp al, 0xE7
  ja .one
.two:
  mov ebx, 2
.one:
  add [ebp+8], ebx
  pop ds
  pop ebx
  pop eax
  pop ebp
  add esp, 4
  iretd
.hlt:                             ; HLT ends a V86 part
  inc dword [phase]
  cmp dword [phase], 1
  je part2
  jmp finish
.stop:
  inc dword [log_n]
  jmp finish

int30:                            ; 386 interrupt gate, DPL 3 (from V86 mode with IOPL 3)
  mov bx, ds
  mov ax, SEL_DATA
  mov ds, ax
  movzx ebx, bx
  mov [r_i30_ds], ebx
  mov eax, [esp]
  mov [r_i30_eip], eax
  mov eax, [esp+4]
  mov [r_i30_cs], eax
  mov eax, [esp+8]
  mov [r_i30_efl], eax
  mov eax, [esp+16]
  mov [r_i30_ss], eax
  mov eax, [esp+24]
  mov [r_i30_vds], eax
  mov eax, 0x3030
  iretd                           ; VM = 1 in the image: back to V86 mode

bits 16
v86code:                          ; V86 mode, IOPL 0
  mov ax, 0x1234
  add ax, 0x1111
  mov [r_v86_add], ax
  mov eax, 0x87654321
  mov [r_v86_eax], eax
  mov bx, cs
  mov [r_v86_cs], bx
  in al, 0x60                     ; the bitmap allows port 60h
  mov [r_v86_in], al
  cli                             ; #GP(0)
  out 0x61, al                    ; bitmap bit of 61h = 1: #GP(0)
  in ax, 0x60                     ; a word needs 60h and 61h: #GP(0)
  in al, 0x80                     ; outside the bitmap: #GP(0)
  int 0x21                        ; #GP(0)
  pushf                           ; #GP(0)
  mov word [r_v86_done], 0x600D
  hlt                             ; #GP(0) at CPL 3: the end of part 1

v86code2:                         ; V86 mode, IOPL 3
  cli
  pushf
  pop ax
  mov [r_v2_fl], ax
  sti
  int 0x30
after_int30:
  mov [r_v2_after], ax
  hlt
bits 32

  EXC_STUBS

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0x1FFFF, ACC_DATA0, FL_D            ; 18
  DESC32 0, 0xFFFFF, ACC_DATA0, FL_32                 ; 20
  DESC32 BASE + OFS(tss), tss_end - tss - 1, ACC_TSS386, 0   ; 28
gdt_end:
idt:
  IDT_EXC
  times 0x30 - 17 dq 0
  GATE32 OFS(int30), SEL_CODE, 0, ACC_INTG3           ; 30
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
  dw 0, iomap - tss               ; T bit, I/O map base
iomap:                            ; ports 00h-7Fh: 1 = #GP; only port 60h is allowed
  times 12 db 0xFF
  db 0xFE                         ; ports 60h-67h
  times 3 db 0xFF
  db 0xFF                         ; the end byte
tss_end:

phase:      dd 0
ops:        times 16 dd 0
r_mon_ds:   dd 0
r_v86_add:  dd 0
r_v86_eax:  dd 0
r_v86_cs:   dd 0
r_v86_in:   dd 0
r_v86_done: dd 0
r_v2_fl:    dd 0
r_v2_after: dd 0
r_i30_ds:   dd 0
r_i30_eip:  dd 0
r_i30_cs:   dd 0
r_i30_efl:  dd 0
r_i30_ss:   dd 0
r_i30_vds:  dd 0
r_done:     dd 0
  LOG_AREA
