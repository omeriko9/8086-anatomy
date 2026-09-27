; 80286 privilege levels: RETF to ring 3, call gate with parameters and a stack switch,
; RETF n back to ring 3, faults at ring 3 (stack switch to the TSS stack), INT through
; DPL 3 trap / interrupt gates and a DPL 0 gate, conforming code, POPF at CPL 3.
cpu 286
bits 16
org 0
%include "pm.inc"

SEL_CODE   equ 0x08
SEL_DATA   equ 0x10
SEL_STACK0 equ 0x18
SEL_CODE3  equ 0x20
SEL_DATA3  equ 0x28
SEL_STACK3 equ 0x30
SEL_TSS    equ 0x38
SEL_GATE   equ 0x40        ; call gate DPL 3 -> gate_entry, 2 parameter words
SEL_CONF   equ 0x48        ; conforming code, DPL 0
SEL_GATE0  equ 0x50        ; call gate DPL 0
SEL_FINISH equ 0x58        ; call gate DPL 3 -> finish
SEL_DATA0B equ 0x60        ; DPL 0 data

start:
  ENTER_PM pm
pm:
  mov ax, SEL_DATA
  mov ds, ax
  mov ax, SEL_STACK0
  mov ss, ax
  mov sp, 0xFFF0
  mov ax, SEL_TSS
  ltr ax
  str [r_str]
  sti                             ; IF = 1, IOPL = 0
  ; RETF to ring 3: DS holds a DPL 0 segment (it becomes null), ES a DPL 3 segment
  mov ax, SEL_DATA0B
  mov ds, ax
  mov ax, SEL_DATA3 | 3
  mov es, ax
  push SEL_STACK3 | 3
  push 0x7000
  push SEL_CODE3 | 3
  push ring3
  retf

ring3:
  mov [es:r3_cs], cs
  mov [es:r3_ss], ss
  mov [es:r3_sp], sp
  mov [es:r3_ds], ds
  mov [es:r3_es], es
  mov ax, SEL_DATA3 | 3
  mov ds, ax
  ; call gate to ring 0 with 2 parameter words
  push 0x1111
  push 0x2222
  call SEL_GATE | 3 : 0
  mov [r3_sp_after], sp
  mov [r3_ax_after], ax
  mov [r3_cs_after], cs
  ; privileged and IOPL-sensitive instructions at CPL 3 (IOPL 0)
  TRY cli                         ; #GP(0)
  TRY hlt                         ; #GP(0)
  TRY lgdt [gdtr]                 ; #GP(0)
  TRY in al, 0x60                 ; #GP(0)
  mov ax, SEL_DATA
  TRY mov es, ax                  ; #GP(10h): DPL 0 < CPL 3
  TRY mov ax, [ss:0xFFFF]         ; #SS(0) at CPL 3: handler on the ring-0 stack
  TRY int 0x41                    ; #GP(41h*8+2): gate DPL 0 < CPL 3
  TRY call SEL_GATE0 | 3 : 0      ; #GP(50h): call gate DPL 0 < CPL 3
  TRY jmp SEL_CODE : ring3        ; #GP(08h): non-conforming code with DPL != CPL
  TRY lock nop                    ; #GP(0): LOCK at CPL 3 > IOPL 0
  ; INT 40h: trap gate DPL 3; INT 42h: interrupt gate DPL 3
  int 0x40
  int 0x42
  ; conforming code segment: CPL stays 3
  call SEL_CONF : conf_entry
  ; POPF at CPL 3, IOPL 0: IF and IOPL do not change
  pushf
  pop ax
  mov [r3_fl_before], ax
  push 0x3000                     ; IOPL = 3, IF = 0
  popf
  pushf
  pop word [r3_fl_after]
  mov word [r3_done], 0xD0E0
  call SEL_FINISH | 3 : 0

gate_entry:                       ; ring 0, called through the call gate
  push bp
  mov bp, sp
  push ds
  mov ax, SEL_DATA
  mov ds, ax
  mov [g_cs], cs
  mov [g_ss], ss
  lea ax, [bp+2]
  mov [g_sp], ax                  ; SP after the call (before PUSH BP)
  mov ax, [bp+2]
  mov [g_ip], ax
  mov ax, [bp+4]
  mov [g_rcs], ax
  mov ax, [bp+6]
  mov [g_p0], ax                  ; last pushed parameter (2222h)
  mov ax, [bp+8]
  mov [g_p1], ax                  ; first pushed parameter (1111h)
  mov ax, [bp+10]
  mov [g_osp], ax
  mov ax, [bp+12]
  mov [g_oss], ax
  pop ds
  pop bp
  mov ax, 0xAAAA
  retf 4

conf_entry:
  mov [c_cs], cs
  retf

int40:                            ; trap gate: IF stays as it was
  push bp
  mov bp, sp
  push ax
  pushf
  pop ax
  mov [i40_fl], ax
  mov ax, [bp+6]
  mov [i40_ofl], ax               ; FLAGS in the frame
  mov ax, [bp+4]
  mov [i40_cs], ax
  mov ax, [bp+10]
  mov [i40_ss], ax
  mov [i40_myss], ss
  mov [i40_mycs], cs
  pop ax
  pop bp
  iret

int42:                            ; interrupt gate: IF = 0 in the handler
  push ax
  pushf
  pop ax
  mov [i42_fl], ax
  pop ax
  iret

finish:
  mov ax, SEL_DATA
  mov ds, ax
  mov [f_cs], cs
  hlt

  EXC_STUBS

align 8
gdt:
  dw 0, 0, 0, 0
  DESC BASE, 0xFFFF, ACC_CODE0            ; 08
  DESC BASE, 0xFFFF, ACC_DATA0            ; 10
  DESC 0x20000, 0xFFFF, ACC_DATA0         ; 18
  DESC BASE, 0xFFFF, ACC_CODE3            ; 20
  DESC BASE, 0xFFFF, ACC_DATA3            ; 28
  DESC 0x30000, 0xFFFF, ACC_DATA3         ; 30
  DESC BASE + (tss - $$), 43, ACC_TSS     ; 38
  GATE gate_entry, SEL_CODE, 2, ACC_CALLG3  ; 40
  DESC BASE, 0xFFFF, ACC_CONF0            ; 48
  GATE gate_entry, SEL_CODE, 0, 0x84      ; 50: call gate DPL 0
  GATE finish, SEL_CODE, 0, ACC_CALLG3    ; 58
  DESC 0x70000, 0xFFFF, ACC_DATA0         ; 60
gdt_end:
idt:
  IDT_EXC
  times 0x40 - 17 dw 0, 0, 0, 0
  GATE int40, SEL_CODE, 0, ACC_TRAPG3     ; 40
  GATE int40, SEL_CODE, 0, ACC_INTG0      ; 41: DPL 0
  GATE int42, SEL_CODE, 0, ACC_INTG3      ; 42
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 2
tss:
  dw 0                            ; back link
  dw 0x8000, SEL_STACK0           ; SP0, SS0
  dw 0, 0, 0, 0                   ; SP1 SS1 SP2 SS2
  times 22 - 7 dw 0

resume:       dw 0
r_str:        dw 0
r3_cs:        dw 0
r3_ss:        dw 0
r3_sp:        dw 0
r3_ds:        dw 0xFFFF
r3_es:        dw 0
r3_sp_after:  dw 0
r3_ax_after:  dw 0
r3_cs_after:  dw 0
r3_fl_before: dw 0
r3_fl_after:  dw 0
r3_done:      dw 0
g_cs:  dw 0
g_ss:  dw 0
g_sp:  dw 0
g_ip:  dw 0
g_rcs: dw 0
g_p0:  dw 0
g_p1:  dw 0
g_osp: dw 0
g_oss: dw 0
c_cs:  dw 0
i40_fl:   dw 0
i40_ofl:  dw 0
i40_cs:   dw 0
i40_ss:   dw 0
i40_myss: dw 0
i40_mycs: dw 0
i42_fl:   dw 0
f_cs:     dw 0
log_n:    dw 0
log:      times 8*32 dw 0
