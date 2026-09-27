; 80286 real mode: FLAGS bits 12-15, PUSH SP, SMSW, faults with the IP of the faulting
; instruction (INT 6, INT 13, INT 0), LIDT moves the vector table, the IDT limit,
; LOADALL (DS base above 1 MB), an address above FFFFFh, and triple-fault shutdown.
cpu 286
bits 16
org 0

start:
  mov ax, cs
  mov ds, ax
  xor ax, ax
  mov es, ax
  ; vectors 0, 6, 13 and 20h in the table at 0000:0000
  mov word [es:0*4], rexc_0
  mov word [es:0*4+2], cs
  mov word [es:6*4], rexc_6
  mov word [es:6*4+2], cs
  mov word [es:13*4], rexc_13
  mov word [es:13*4+2], cs
  mov word [es:0x20*4], handler_old
  mov word [es:0x20*4+2], cs
  ; the same fault vectors and a different vector 20h in a table at 0000:5000
  mov word [es:0x5000+0*4], rexc_0
  mov word [es:0x5000+0*4+2], cs
  mov word [es:0x5000+13*4], rexc_13
  mov word [es:0x5000+13*4+2], cs
  mov word [es:0x5000+0x20*4], handler_reloc
  mov word [es:0x5000+0x20*4+2], cs

  ; FLAGS bits 12-15 read 0 in real mode and cannot be set
  pushf
  pop word [r_fl0]
  push 0xF000
  popf
  pushf
  pop word [r_fl1]
  ; PUSH SP pushes the value before the push
  mov [r_sp], sp
  push sp
  pop word [r_pushsp]
  smsw [r_msw]

  ; faults
  mov word [resume], a_ud
f_ud: db 0x0F, 0xFF
a_ud:
  mov word [resume], a_ffff
f_ffff: mov ax, [0xFFFF]
a_ffff:
  mov word [resume], a_ssffff
f_ssffff: mov ax, [ss:0xFFFF]
a_ssffff:
  mov word [resume], a_long
f_long: db 0x26, 0x26, 0x26, 0x26, 0x26, 0x26, 0x26, 0x26, 0x26, 0x8B, 0x07   ; 11 bytes
a_long:
  mov word [resume], a_arpl
f_arpl: arpl ax, bx
a_arpl:
  mov word [resume], a_sldt
f_sldt: sldt ax
a_sldt:
  xor cx, cx
  mov word [resume], a_div
f_div: div cl
a_div:
  lock nop

  ; LIDT moves the real-mode vector table
  lidt [idt_reloc]
  int 0x20
  lidt [idt_small]                ; limit 7Fh: vectors 0..31
  mov word [resume], a_int40
f_int40: int 0x40                 ; 40h*4+3 > limit -> INT 13
a_int40:
  lidt [idt_normal]
  int 0x20                        ; the table at 0 again

  ; LOADALL: copy the table to 000800h and run 0F 05
  cld
  mov si, la_table
  mov di, 0x0800
  mov cx, 102
  rep movsb
  db 0x0F, 0x05
  hlt                             ; not reached: IP comes from the table
after_loadall:
  mov [0x0010], ax                ; DS base 200000h
  mov [es:r_la_ax], ax
  mov [es:r_la_bx], bx
  mov [es:r_la_cx], cx
  mov [es:r_la_dx], dx
  mov [es:r_la_si], si
  mov [es:r_la_di], di
  mov [es:r_la_bp], bp
  mov [es:r_la_sp], sp
  mov [es:r_la_ds], ds
  pushf
  pop word [es:r_la_fl]
  mov ax, cs
  mov ds, ax                      ; a real-mode load: base = 1000h * 16
  mov word [0x0012], 0x4321       ; goes to 010012h

  ; physical address above FFFFFh (the CPU does not wrap; the bus has no A20 gate)
  mov ax, 0xFFFF
  mov es, ax
  mov byte [es:0x0010], 0x77
  mov word [r_before_tf], 0x7777
  ; triple fault: IDT limit 0 -> INT 13 -> INT 8 -> shutdown
  lidt [idt_zero]
  int 3
  mov word [r_after_tf], 0xDEAD
  hlt

handler_old:
  mov word [r_old], 0x0BAD
  inc word [n_old]
  iret
handler_reloc:
  mov word [r_reloc], 0xAAAA
  iret

; real-mode fault handlers: log (vector, 0, IP, CS) and continue at [resume]
rexc_0:
  push word 0
  jmp rexc_common
rexc_6:
  push word 6
  jmp rexc_common
rexc_13:
  push word 13
rexc_common:
  push bp
  mov bp, sp
  push ax
  push bx
  push ds
  mov ax, cs
  mov ds, ax
  mov bx, [log_n]
  shl bx, 4
  mov ax, [bp+2]
  mov [log+bx], ax
  mov ax, [bp+4]
  mov [log+bx+4], ax
  mov ax, [bp+6]
  mov [log+bx+6], ax
  inc word [log_n]
  mov ax, [resume]
  mov [bp+4], ax
  pop ds
  pop bx
  pop ax
  pop bp
  add sp, 2
  iret

idt_reloc:  dw 0x03FF
            dd 0x5000
idt_small:  dw 0x007F
            dd 0x5000
idt_normal: dw 0x03FF
            dd 0
idt_zero:   dw 0
            dd 0

; LOADALL table (102 bytes, copied to 000800h)
la_table:
  times 6 db 0
  dw 0xFFF0                       ; 06 MSW (PE = 0)
  times 14 db 0
  dw 0                            ; 16 TR
  dw 0x0003                       ; 18 FLAGS (CF = 1)
  dw after_loadall                ; 1A IP
  dw 0                            ; 1C LDTR
  dw 0x2000                       ; 1E DS
  dw 0x1000                       ; 20 SS
  dw 0x1000                       ; 22 CS
  dw 0x1000                       ; 24 ES
  dw 0x1111, 0x2222, 0x3333, 0xFF00   ; 26 DI SI BP SP
  dw 0x4444, 0x5555, 0x6666, 0x7777   ; 2E BX DX CX AX
  db 0x00, 0x00, 0x01, 0x93
  dw 0xFFFF                       ; 36 ES cache: base 010000h
  db 0x00, 0x00, 0x01, 0x93
  dw 0xFFFF                       ; 3C CS cache
  db 0x00, 0x00, 0x01, 0x93
  dw 0xFFFF                       ; 42 SS cache
  db 0x00, 0x00, 0x20, 0x93
  dw 0xFFFF                       ; 48 DS cache: base 200000h
  db 0, 0, 0, 0
  dw 0xFFFF                       ; 4E GDTR
  db 0, 0, 0, 0x82
  dw 0                            ; 54 LDT cache
  db 0, 0, 0, 0
  dw 0x03FF                       ; 5A IDTR: base 0, limit 3FFh
  db 0, 0, 0, 0x83
  dw 0                            ; 60 TSS cache
la_end:

align 2
resume:      dw 0
r_fl0:       dw 0
r_fl1:       dw 0
r_sp:        dw 0
r_pushsp:    dw 0
r_msw:       dw 0
r_old:       dw 0
n_old:       dw 0
r_reloc:     dw 0
r_la_ax:     dw 0
r_la_bx:     dw 0
r_la_cx:     dw 0
r_la_dx:     dw 0
r_la_si:     dw 0
r_la_di:     dw 0
r_la_bp:     dw 0
r_la_sp:     dw 0
r_la_ds:     dw 0
r_la_fl:     dw 0
r_before_tf: dw 0
r_after_tf:  dw 0
log_n:       dw 0
log:         times 8*32 dw 0
