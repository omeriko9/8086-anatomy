; Speed benchmark: a mixed real-mode workload (8086 instructions only).
cpu 8086
bits 16
org 0x100
start:
  mov ax, cs
  mov ds, ax
  mov es, ax
  mov ss, ax
  mov sp, 0xFFFE
outer:
  ; sieve of Eratosthenes over 4096 bytes at buf
  cld
  mov di, buf
  mov cx, 2048
  mov ax, 0x0101
  rep stosw
  mov si, 2
.sieve:
  cmp byte [buf+si], 0
  je .next
  mov bx, si
  add bx, si
.mark:
  cmp bx, 4096
  jae .next
  mov byte [buf+bx], 0
  add bx, si
  jmp .mark
.next:
  inc si
  cmp si, 64
  jb .sieve
  ; checksum with calls, shifts and multiplies
  xor dx, dx
  mov si, buf
  mov cx, 1024
.sum:
  lodsw
  call mix
  loop .sum
  ; copy block
  mov si, buf
  mov di, buf + 4096
  mov cx, 1024
  rep movsw
  jmp outer
mix:
  push cx
  mov cl, 3
  rol dx, cl
  add dx, ax
  mov bx, dx
  and bx, 0x0F
  imul bx
  xor dx, ax
  pop cx
  ret
buf:
