; A loop with pairs in 32-bit code, timed with RDTSC: first with the two pipes, then with
; TR12.SE = 1 (single pipe execution: no pairs). A warm-up run first puts the code and the data
; in the caches and the loop branch in the BTB.
;
; The loop (all cache hits):       alone   as a pair
;   add [edi], eax     (U)          3       3   (the pair takes the clocks of the longer one)
;   mov ebx, [esi]     (V)          1
;   add eax, [esi+4]   (U)          2       2
;   inc edx            (V)          1
;   mov [edi+4], ebx   (U)          1       2   (two 1-clock steps: a step has 1 clock or more)
;   add ebx, 1         (V)          1
;   dec ecx            (U)          1       2
;   jnz body           (V)          1
;                                  11       9   clocks for each pass
cpu 586
bits 16
org 0
%include "pm586.inc"

SEL_CODE   equ 0x08       ; 32-bit code, base BASE
SEL_DATA   equ 0x10       ; 32-bit data, base BASE
SEL_STACK  equ 0x18       ; 32-bit stack, base 30000h

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
  mov esi, src
  mov edi, dst
  xor eax, eax
  xor edx, edx
  ; the warm-up run
  mov ecx, 3
  call body
  ; 1. the two pipes
  mov ecx, 50
  rdtsc
  mov ebp, eax
  call body
  rdtsc
  sub eax, ebp
  mov [r_pair], eax
  ; 2. TR12.SE = 1: one pipe
  mov ecx, MSR_TR12
  mov eax, TR12_SE
  xor edx, edx
  wrmsr
  mov ecx, 50
  rdtsc
  mov ebp, eax
  call body
  rdtsc
  sub eax, ebp
  mov [r_single], eax
  mov dword [r_done], 0xD0D0
  hlt

align 32
body:
  add [edi], eax
  mov ebx, [esi]
  add eax, [esi + 4]
  inc edx
  mov [edi + 4], ebx
  add ebx, 1
  dec ecx
  jnz body
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

align 32
src:        dd 3, 5
align 32
dst:        dd 0, 0
r_pair:     dd 0
r_single:   dd 0
r_done:     dd 0
  LOG_AREA
