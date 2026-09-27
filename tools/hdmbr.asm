; The MBR of the hard disks that the page makes (src/core/disk.js: HD_MBR). Assemble it with
; Asm86 (origin 600h); tests/hd.test.mjs checks that HD_MBR is the same as this source.
; The master boot record of a new hard disk (the partition table is at 1BEh). The BIOS loads
; it at 0000:7C00h with DL = 80h. It moves itself to 0000:0600h, finds the active partition,
; loads the first sector of that partition at 0000:7C00h and jumps to it (DL = 80h, DS:SI =
; the partition entry), as the MBR of DOS FDISK does.
        cpu 8086
        org 0x600
        cli
        xor ax, ax
        mov ss, ax
        mov sp, 0x7C00
        mov ds, ax
        mov es, ax
        sti
        cld
        mov si, 0x7C00
        mov di, 0x0600
        mov cx, 256
        rep movsw
        jmp 0x0000:go
go:     mov si, 0x07BE
        mov cx, 4
find:   cmp byte [si], 0x80
        je found
        add si, 16
        loop find
        mov si, msg_part
        jmp show
found:  mov bp, 5
again:  mov dl, 0x80
        mov dh, [si+1]
        mov cx, [si+2]
        mov bx, 0x7C00
        mov ax, 0x0201
        int 0x13
        jnc loaded
        xor ax, ax
        int 0x13
        dec bp
        jnz again
        mov si, msg_load
        jmp show
loaded: cmp word [0x7DFE], 0xAA55
        jne nosys
        mov dl, 0x80
        jmp 0x0000:0x7C00
nosys:  mov si, msg_os
show:   lodsb
        or al, al
        jz stop
        mov ah, 0x0E
        mov bx, 7
        int 0x10
        jmp show
stop:   jmp stop
msg_part: db "Invalid partition table", 0
msg_load: db "Error loading operating system", 0
msg_os:   db "Missing operating system", 0
