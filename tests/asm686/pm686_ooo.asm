; Pentium Pro out-of-order execution: loops timed with RDTSC. In each pass a 32-bit DIV (39 clocks)
; needs the result of the DIV of the pass before it (a chain of divides).
;   indep: 20 ADDs that do not need the DIV result run while the divider works: a pass takes about
;          the time of the DIV (an in-order CPU needs the DIV and then the ADDs).
;   dep:   20 ADDs that need the DIV result, and the next DIV needs them: a pass takes the DIV and
;          the 20 ADDs one after the other.
;   big:   60 independent ADDs: more µops than the ROB (40 entries) can keep while the DIV works, so
;          the RAT stops until the DIV retires.
; A warm-up run first puts the code in the caches and the loop branch in the BTB.
cpu 686
bits 16
org 0
%include "pm686.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h

PASSES     equ 50

start:
  ENTER_PM32 pm32

bits 32
pm32:
  mov ax, SEL_DATA
  mov ds, ax
  mov es, ax
  mov ax, SEL_STACK
  mov ss, ax
  mov esp, 0x8000
  CACHE_ON
  ; the warm-up runs
  mov ebp, 3
  call indep
  mov ebp, 3
  call dep
  mov ebp, 3
  call big
  ; 1. independent ADDs
  mov ebp, PASSES
  cpuid
  rdtsc
  mov [t0], eax
  call indep
  rdtsc
  sub eax, [t0]
  mov [r_indep], eax
  ; 2. dependent ADDs
  mov ebp, PASSES
  cpuid
  rdtsc
  mov [t0], eax
  call dep
  rdtsc
  sub eax, [t0]
  mov [r_dep], eax
  ; 3. 60 independent ADDs
  mov ebp, PASSES
  cpuid
  rdtsc
  mov [t0], eax
  call big
  rdtsc
  sub eax, [t0]
  mov [r_big], eax
  mov dword [r_done], 0xD0D0
  hlt

align 32
indep:
  mov eax, 1000000
  mov ecx, 3
.l:
  mov edx, 0                      ; no source (XOR EDX, EDX would read EDX: the P6 has no zeroing idiom)
  div ecx                         ; EAX = EAX / 3: the next DIV needs it
%rep 5
  add ebx, 1
  add esi, 1
  add edi, 1
  add ebx, 2
%endrep
  dec ebp
  jnz .l
  ret

align 32
dep:
  mov eax, 1000000
  mov ecx, 3
.l:
  mov edx, 0
  div ecx
%rep 20
  add eax, 1                      ; each ADD needs the one before it, the next DIV needs the last one
%endrep
  dec ebp
  jnz .l
  ret

align 32
big:
  mov eax, 1000000
  mov ecx, 3
.l:
  mov edx, 0
  div ecx
%rep 15
  add ebx, 1
  add esi, 1
  add edi, 1
  add ebx, 2
%endrep
  dec ebp
  jnz .l
  ret

  EXC_STUBS486

align 8
gdt:
  dq 0
  DESC32 BASE, 0xFFFFF, ACC_CODE0, FL_32              ; 08
  DESC32 BASE, 0xFFFFF, ACC_DATA0, FL_32              ; 10
  DESC32 0x30000, 0xFFFF, ACC_DATA0, FL_D             ; 18
gdt_end:
idt:
  IDT_EXC486
idt_end:
gdtr: dw gdt_end - gdt - 1
      dd BASE + gdt
idtr: dw idt_end - idt - 1
      dd BASE + idt

align 4
t0:         dd 0
r_indep:    dd 0
r_dep:      dd 0
r_big:      dd 0
r_done:     dd 0
  LOG_AREA
