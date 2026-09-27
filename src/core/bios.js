// Mini BIOS (original code for this machine) and the sample programs.
// Both are 8086 assembly in NASM syntax, assembled in the browser by Asm86.

const BIOS_SOURCE = String.raw`; ==========================================================
;  8086 ANATOMY  -  MINI BIOS  v2.0
;  An original ROM for this machine, F000:0000 - F000:FFFF.
;  The CPU starts at FFFF:0000. The services are enough to
;  boot a DOS floppy: video (CGA text and graphics), keyboard,
;  diskette (NEC 765 controller and 8237 DMA), timer, boot.
; ==========================================================
        cpu 8086
        org 0

BDA         equ 0x40          ; BIOS data area segment
EQUIP       equ 0x10
MEMSIZE     equ 0x13
KB_FLAGS    equ 0x17
KB_HEAD     equ 0x1A
KB_TAIL     equ 0x1C
KB_BUF      equ 0x1E
KB_END      equ 0x3E
VID_MODE    equ 0x49
VID_COLS    equ 0x4A
VID_PSIZE   equ 0x4C
VID_POFF    equ 0x4E
CUR_POS     equ 0x50          ; 8 words: low byte column, high byte row
CUR_TYPE    equ 0x60
VID_PAGE    equ 0x62
CRT_BASE    equ 0x63
CRT_MODE    equ 0x65
CRT_PAL     equ 0x66
TICKS       equ 0x6C
TICK_OVF    equ 0x70
RESET_FLAG  equ 0x72
SEEK_ST     equ 0x3E          ; diskette: bit 7 = IRQ 6 came, bits 0-3 = the drive is calibrated
MOTOR_ST    equ 0x3F          ; diskette: bits 0-3 = the motor of the drive turns
MOTOR_CNT   equ 0x40          ; diskette: timer ticks until the motors stop
DSK_STATUS  equ 0x41          ; diskette: the status of the last operation
NEC_ST      equ 0x42          ; diskette: the result bytes of the controller (7)
MEDIA_ST    equ 0x90          ; diskette (AT): the media state of drives 0 and 1
FDC_DOR     equ 0x3F2         ; floppy controller: digital output register
FDC_MSR     equ 0x3F4         ; main status register (3F5h: data register)
TEXT_ATTR   equ 0xE0          ; 0 = keep the attribute of the cell
FPU_OK      equ 0xE1
SC_TOP      equ 0xE4          ; scroll work area
SC_LEFT     equ 0xE5
SC_BOT      equ 0xE6
SC_RIGHT    equ 0xE7
SC_N        equ 0xE8
SC_ATTR     equ 0xE9
SC_W        equ 0xEA
SC_MOVE     equ 0xEC
ENTRY_IP    equ 0xF0          ; program entry, written by the loader
ENTRY_CS    equ 0xF2
ENTRY_OK    equ 0xF4
BOOT_DRV    equ 0xF6          ; 80h: boot from drive C: first (the page writes it; POST keeps it)
HD_STATUS   equ 0x74          ; hard disk: the status of the last operation
HD_COUNT    equ 0x75          ; the number of hard disks (0 or 1)
HD_FDPT     equ 0xC0          ; the parameter table of drive 80h (16 bytes; INT 41h points to it)
IDE_DATA    equ 0x1F0         ; the IDE controller: data (16 bits), 1F1h error, 1F2h count,
IDE_STAT    equ 0x1F7         ; 1F3h sector, 1F4h/1F5h cylinder, 1F6h drive/head, 1F7h status/command
VIDEO       equ 0xB800

; ----------------------------------------------------------
start:  cli
        cld
        xor ax, ax
        mov ss, ax
        mov sp, 0x7C00        ; BIOS stack below the boot sector
        ; --- fill the interrupt vector table with the default handler
        mov es, ax
        xor di, di
        mov cx, 256
.ivt:   mov ax, int_default
        stosw
        mov ax, cs
        stosw
        loop .ivt
        ; --- install the real handlers from the table
        push cs
        pop ds
        mov si, vec_table
.vec:   lodsw
        cmp ax, 0xFFFF
        je .vdone
        mov di, ax
        shl di, 1
        shl di, 1
        lodsw
        mov [es:di], ax
        mov [es:di+2], cs
        jmp .vec
.vdone:
        ; --- 8259A PIC: edge triggered, single, ICW4; base vector 08h
        mov al, 0x13
        out 0x20, al
        mov al, 0x08
        out 0x21, al
        mov al, 0x01
        out 0x21, al
        mov al, 0xBC          ; enable IRQ0 timer, IRQ1 keyboard, IRQ6 floppy
        out 0x21, al
        ; --- 8253 PIT channel 0: mode 3, divisor 65536 -> 18.2 Hz
        mov al, 0x36
        out 0x43, al
        xor al, al
        out 0x40, al
        out 0x40, al
        ; --- 8237 DMA: master clear, like a real PC POST
        out 0x0D, al
        ; --- BIOS data area (keep the loader bytes at 04F0h)
        mov ax, BDA
        mov ds, ax
        mov es, ax
        xor di, di
        mov cx, 0x78
        xor ax, ax
        rep stosw
        mov word [EQUIP], 0x006D      ; 2 floppies, 80x25 colour, RAM, boot floppy
        mov word [MEMSIZE], 640
        mov word [KB_HEAD], KB_BUF
        mov word [KB_TAIL], KB_BUF
        mov word [CRT_BASE], 0x3D4
        out 0xE2, al          ; clock port: ticks since midnight from the host
        ; --- option ROMs (a VGA card has its video BIOS at C000:0000)
        call rom_scan
        ; --- video: 80x25 text, clear screen (an option ROM that took INT 10h did it)
        call own_int10
        jne .novid
        mov ax, 0x0003
        int 0x10
.novid:
        ; --- 8087: reset it and read back the status word
        fninit
        mov word [0xE2], 0x5A5A
        fnstsw [0xE2]
        cmp word [0xE2], 0
        jne .nofpu
        mov byte [FPU_OK], 1
        or byte [EQUIP], 2    ; equipment bit 1: coprocessor present
.nofpu: mov al, 0x80          ; allow NMI (the 8087 INT line)
        out 0xA0, al
        ; --- banner
        mov si, msg_banner
        call puts_attr
        mov si, msg_cpu
        call puts
        mov si, msg_ram
        call puts
        mov si, msg_cga
        call own_int10
        je .card
        mov si, msg_vga
.card:  call puts
        mov si, msg_ram2
        call puts
        mov si, msg_fpu_no
        cmp byte [FPU_OK], 1
        jne .pf
        mov si, msg_fpu_yes
.pf:    call puts
        call hd_init          ; the IDE hard disk (drive C:), if there is one
        mov si, msg_line
        call puts
        sti
        ; --- diskette controller: reset it, read the drive states, SPECIFY
        xor ax, ax
        xor dx, dx
        int 0x13
        ; --- a program from the editor, or boot from a disk
        cmp byte [ENTRY_OK], 0x86
        je .prog
        int 0x19
.prog:  mov bx, [ENTRY_CS]
        mov dx, [ENTRY_IP]
        mov ss, bx
        xor sp, sp
        xor ax, ax
        push ax               ; RET at the top level jumps to PSP:0000 (INT 20h)
        push bx               ; far return address = program entry
        push dx
        mov ds, bx
        mov es, bx
        xor bx, bx
        xor cx, cx
        xor dx, dx
        xor si, si
        xor di, di
        xor bp, bp
        retf

; ----------------------------------------------------------
; option ROMs: C000:0000 - F400:0000 in 2 KB steps. A ROM starts with 55h AAh
; and a size byte (512-byte blocks); its bytes add up to 0. The POST far-calls
; its entry at offset 3.
rom_scan:
        push ds
        push es
        mov dx, 0xC000
.next:  mov ds, dx
        cmp word [0], 0xAA55
        jne .skip
        mov ch, [2]           ; CX = size in bytes (blocks * 512)
        shl ch, 1
        xor cl, cl
        jcxz .skip
        push cx
        xor si, si
        xor bl, bl
.sum:   lodsb
        add bl, al
        loop .sum
        pop cx
        or bl, bl
        jnz .skip
        push dx
        push cx
        push cs               ; far call DX:0003
        mov ax, .back
        push ax
        push dx
        mov ax, 3
        push ax
        retf
.back:  cli
        cld
        pop cx
        pop dx
        mov cl, 4             ; continue after the ROM
        shr cx, cl
        add dx, cx
        add dx, 0x7F
        and dx, 0xFF80
        jmp .chk
.skip:  add dx, 0x80          ; 2 KB
.chk:   cmp dx, 0xF400
        jbe .next
        pop es
        pop ds
        ret

; ZF = 1 when INT 10h is still this ROM's handler (no video option ROM)
own_int10:
        push ax
        push ds
        xor ax, ax
        mov ds, ax
        mov ax, cs
        cmp [0x10*4+2], ax
        pop ds
        pop ax
        ret

; ----------------------------------------------------------
; puts: print the zero-terminated string at CS:SI (teletype)
puts:   push ax
        push bx
        push si
.l:     mov al, [cs:si]
        inc si
        or al, al
        jz .e
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        jmp .l
.e:     pop si
        pop bx
        pop ax
        ret

; puts_attr: the first byte of the string is the colour attribute
puts_attr:
        push ax
        push ds
        mov ax, BDA
        mov ds, ax
        mov al, [cs:si]
        inc si
        mov [TEXT_ATTR], al
        call puts
        mov byte [TEXT_ATTR], 0
        pop ds
        pop ax
        ret

; ----------------------------------------------------------
; INT 10h  video services (CGA: text modes 0-3, graphics 4-6)
; Frame: [bp+14] BX, [bp+12] CX, [bp+10] DX (values to return)
int10:  sti
        cld
        push bx
        push cx
        push dx
        push si
        push di
        push ds
        push es
        push bp
        mov bp, sp
        mov si, BDA
        mov ds, si
        mov si, VIDEO
        mov es, si
        cmp ah, 0x10
        jae v_done
        push ax
        mov al, ah
        xor ah, ah
        shl ax, 1
        mov si, ax
        pop ax
        jmp word [cs:si+v_table]
v_done: pop bp
        pop es
        pop ds
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        iret

v_table: dw v_mode, v_ctype, v_setcur, v_getcur, v_lpen, v_page, v_scrup, v_scrdn
         dw v_rdca, v_wrca, v_wrc, v_pal, v_wrpix, v_rdpix, v_tty, v_getmode

; AH=00h set mode AL (bit 7 = keep the screen)
v_mode: push ax
        and al, 0x7F
        cmp al, 7
        jb .ok
        mov al, 3             ; mode 7 is monochrome: a CGA uses mode 3
.ok:    mov [VID_MODE], al
        xor bx, bx
        mov bl, al
        mov al, [cs:bx+mode_reg]
        mov [CRT_MODE], al
        mov dx, 0x3D8
        and al, 0xF7          ; video off while the mode changes
        out dx, al
        mov al, [cs:bx+mode_pal]
        mov [CRT_PAL], al
        inc dx
        out dx, al
        mov al, [cs:bx+mode_cols]
        xor ah, ah
        mov [VID_COLS], ax
        mov si, crtc_80
        cmp al, 80
        je .t1
        mov si, crtc_40
.t1:    cmp bl, 4
        jb .t2
        mov si, crtc_gfx
.t2:    shl bx, 1
        mov ax, [cs:bx+mode_psize]
        mov [VID_PSIZE], ax
        mov dx, 0x3D4
        xor ah, ah
.crtc:  mov al, ah
        out dx, al
        inc dx
        mov al, [cs:si]
        out dx, al
        dec dx
        inc si
        inc ah
        cmp ah, 16
        jb .crtc
        xor ax, ax
        mov [VID_POFF], ax
        mov [VID_PAGE], al
        mov bx, CUR_POS
        mov cx, 8
.cp:    mov [bx], ax
        add bx, 2
        loop .cp
        mov word [CUR_TYPE], 0x0607
        pop ax
        test al, 0x80
        jnz .keep
        xor di, di
        mov cx, 0x2000
        mov ax, 0x0720
        cmp byte [VID_MODE], 4
        jb .fill
        xor ax, ax
.fill:  rep stosw
.keep:  mov al, [CRT_MODE]
        mov dx, 0x3D8
        out dx, al
        call set_hw_cursor
        jmp v_done

; AH=01h cursor shape CH (start line), CL (end line)
v_ctype:
        mov [CUR_TYPE], cx
        mov al, 0x0A
        mov ah, ch
        call crtc_out
        mov al, 0x0B
        mov ah, cl
        call crtc_out
        jmp v_done

; AH=02h cursor position DH row, DL column of page BH
v_setcur:
        mov bl, bh
        xor bh, bh
        shl bx, 1
        mov [bx+CUR_POS], dx
        call set_hw_cursor
        jmp v_done

; AH=03h read the cursor: DX position, CX shape
v_getcur:
        mov bl, bh
        xor bh, bh
        shl bx, 1
        mov dx, [bx+CUR_POS]
        mov [bp+10], dx
        mov cx, [CUR_TYPE]
        mov [bp+12], cx
        jmp v_done

; AH=04h light pen: none
v_lpen: xor ah, ah
        jmp v_done

; AH=05h active display page AL (text modes)
v_page: cmp byte [VID_MODE], 4
        jae .x
        mov [VID_PAGE], al
        xor ah, ah
        mov cx, ax
        mov ax, [VID_PSIZE]
        mul cx
        mov [VID_POFF], ax
        shr ax, 1
        mov bx, ax
        mov al, 0x0C
        mov ah, bh
        call crtc_out
        mov al, 0x0D
        mov ah, bl
        call crtc_out
        call set_hw_cursor
.x:     jmp v_done

; AH=06h / 07h scroll the window CH,CL - DH,DL up / down by AL lines
; (AL = 0 clears the window), new lines get attribute BH
v_scrup:
        xor si, si
        jmp v_scroll
v_scrdn:
        mov si, 1
v_scroll:
        cmp byte [VID_MODE], 4
        jae .g
        call tscroll
        jmp v_done
.g:     call gscroll
        jmp v_done

; AH=08h read the character and attribute at the cursor of page BH
v_rdca: cmp byte [VID_MODE], 4
        jae .g
        call page_cell
        mov ax, [es:di]
        jmp v_done
.g:     xor ax, ax
        jmp v_done

; AH=09h write AL with attribute BL, CX times; AH=0Ah write AL only
v_wrca: cmp byte [VID_MODE], 4
        jae v_gchar
        call page_cell
        mov ah, bl
        rep stosw
        jmp v_done
v_wrc:  cmp byte [VID_MODE], 4
        jae v_gchar
        call page_cell
.l:     jcxz .e
        stosb
        inc di
        dec cx
        jmp .l
.e:     jmp v_done
v_gchar:
        mov dx, [CUR_POS]
.l:     jcxz .e
        call gglyph
        inc dl
        dec cx
        jmp .l
.e:     jmp v_done

; AH=0Bh palette: BH=0 background/border BL, BH=1 palette select BL
v_pal:  mov al, [CRT_PAL]
        or bh, bh
        jnz .sel
        and al, 0xE0
        and bl, 0x1F
        or al, bl
        jmp .out
.sel:   and al, 0xDF
        test bl, 1
        jz .out
        or al, 0x20
.out:   mov [CRT_PAL], al
        mov dx, 0x3D9
        out dx, al
        jmp v_done

; AH=0Ch write pixel AL at column CX, row DX (bit 7 of AL = XOR)
v_wrpix:
        cmp byte [VID_MODE], 4
        jb .x
        call pix_addr
        mov ah, al
        and al, bl
        shl al, cl
        shl bl, cl
        test ah, 0x80
        jnz .xor
        not bl
        and [es:di], bl
        or [es:di], al
        jmp .x
.xor:   xor [es:di], al
.x:     jmp v_done

; AH=0Dh read pixel at column CX, row DX into AL
v_rdpix:
        cmp byte [VID_MODE], 4
        jb .x
        call pix_addr
        mov al, [es:di]
        shr al, cl
        and al, bl
.x:     jmp v_done

; AH=0Eh teletype AL (colour BL in graphics modes)
v_tty:  push ax
        call tty
        pop ax
        jmp v_done

; AH=0Fh AL = mode, AH = columns, BH = active page
v_getmode:
        mov al, [VID_MODE]
        mov ah, [VID_COLS]
        mov bl, [VID_PAGE]
        mov [bp+15], bl
        jmp v_done

; tty: write AL as a teletype character at the cursor of the active page
tty:    cmp al, 13
        je .cr
        cmp al, 10
        je .lf
        cmp al, 8
        je .bs
        cmp al, 7
        je .bel
        cmp byte [VID_MODE], 4
        jae .gfx
        push ax
        mov bh, [VID_PAGE]
        call page_cell
        pop ax
        mov ah, [TEXT_ATTR]
        or ah, ah
        jz .keep
        stosw
        jmp .adv
.keep:  stosb
        jmp .adv
.gfx:   push dx
        mov dx, [CUR_POS]
        call gglyph
        pop dx
.adv:   call cur_ptr
        inc byte [bx]
        mov al, [VID_COLS]
        cmp [bx], al
        jb .ok
        mov byte [bx], 0
.lf:    call cur_ptr
        inc byte [bx+1]
        cmp byte [bx+1], 25
        jb .ok
        mov byte [bx+1], 24
        call scroll_line
        jmp .ok
.cr:    call cur_ptr
        mov byte [bx], 0
        jmp .ok
.bs:    call cur_ptr
        cmp byte [bx], 0
        je .ok
        dec byte [bx]
        jmp .ok
.bel:   call beep
.ok:    call set_hw_cursor
        ret

; BX = address of the cursor word of the active page
cur_ptr:
        mov bl, [VID_PAGE]
        xor bh, bh
        shl bx, 1
        add bx, CUR_POS
        ret

; DI = video offset of the cursor of page BH (text modes)
page_cell:
        push ax
        push bx
        push dx
        mov bl, bh
        xor bh, bh
        mov ax, [VID_PSIZE]
        mul bx
        mov di, ax
        shl bx, 1
        mov dx, [bx+CUR_POS]
        mov al, dh
        mov ah, [VID_COLS]
        mul ah
        xor dh, dh
        add ax, dx
        shl ax, 1
        add di, ax
        pop dx
        pop bx
        pop ax
        ret

; scroll the whole screen up one line
scroll_line:
        push ax
        push bx
        push cx
        push dx
        push si
        mov al, 1
        mov bh, 0x07
        xor cx, cx
        mov dh, 24
        mov dl, [VID_COLS]
        dec dl
        xor si, si
        cmp byte [VID_MODE], 4
        jae .g
        call tscroll
        jmp .e
.g:     xor bh, bh
        call gscroll
.e:     pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; text scroll. SI = 0 up, 1 down. AL lines, BH attribute, CX / DX window
tscroll:
        push ax
        mov al, [VID_COLS]
        dec al
        cmp dl, al
        jbe .c1
        mov dl, al
.c1:    cmp dh, 24
        jbe .c2
        mov dh, 24
.c2:    pop ax
        mov [SC_ATTR], bh
        mov [SC_TOP], ch
        mov [SC_LEFT], cl
        mov [SC_BOT], dh
        mov [SC_RIGHT], dl
        mov ah, dh
        sub ah, ch
        inc ah
        or al, al
        jz .all
        cmp al, ah
        jb .lset
.all:   mov al, ah
.lset:  mov [SC_N], al
        mov bl, dl
        sub bl, cl
        inc bl
        xor bh, bh
        mov [SC_W], bx
        sub ah, al
        mov [SC_MOVE], ah
        or si, si
        jnz .down
        mov dh, [SC_TOP]
.uloop: cmp byte [SC_MOVE], 0
        je .ufill
        mov al, dh
        add al, [SC_N]
        mov ah, [SC_LEFT]
        call row_addr
        mov si, di
        mov al, dh
        call row_addr
        call copy_cells
        inc dh
        dec byte [SC_MOVE]
        jmp .uloop
.ufill: mov al, dh
        cmp al, [SC_BOT]
        ja .done
        mov ah, [SC_LEFT]
        call row_addr
        call fill_cells
        inc dh
        jmp .ufill
.down:  mov dh, [SC_BOT]
.dloop: cmp byte [SC_MOVE], 0
        je .dfill
        mov al, dh
        sub al, [SC_N]
        mov ah, [SC_LEFT]
        call row_addr
        mov si, di
        mov al, dh
        call row_addr
        call copy_cells
        dec dh
        dec byte [SC_MOVE]
        jmp .dloop
.dfill: mov al, dh
        cmp al, [SC_TOP]
        jb .done
        cmp al, 0xFF
        je .done
        mov ah, [SC_LEFT]
        call row_addr
        call fill_cells
        dec dh
        jmp .dfill
.done:  ret

; DI = offset of row AL, column AH on the active page
row_addr:
        push ax
        push bx
        push dx
        mov bl, ah
        xor bh, bh
        mov ah, [VID_COLS]
        mul ah
        add ax, bx
        shl ax, 1
        add ax, [VID_POFF]
        mov di, ax
        pop dx
        pop bx
        pop ax
        ret

copy_cells:
        push ax
        push cx
        mov cx, [SC_W]
.c:     mov ax, [es:si]
        mov [es:di], ax
        add si, 2
        add di, 2
        loop .c
        pop cx
        pop ax
        ret

fill_cells:
        push ax
        push cx
        mov cx, [SC_W]
        mov ah, [SC_ATTR]
        mov al, 0x20
        rep stosw
        pop cx
        pop ax
        ret

; graphics scroll (full width). SI = 0 up, 1 down. AL lines, BH fill byte
gscroll:
        cmp dh, 24
        jbe .a
        mov dh, 24
.a:     mov ah, dh
        sub ah, ch
        inc ah
        or al, al
        jz .all
        cmp al, ah
        jb .b
.all:   mov al, ah
.b:     mov [SC_TOP], ch
        mov [SC_BOT], dh
        mov [SC_N], al
        mov [SC_ATTR], bh
        mov cl, [SC_TOP]
        mov ch, [SC_BOT]
        mov bl, [SC_N]
        mov bh, [SC_ATTR]
        push ds
        mov ax, VIDEO
        mov ds, ax
        or si, si
        jnz .down
        mov dl, cl
.u:     mov al, dl
        add al, bl
        cmp al, ch
        ja .ufill
        call gblk_copy
        inc dl
        jmp .u
.ufill: cmp dl, ch
        ja .gdone
        call gblk_fill
        inc dl
        jmp .ufill
.down:  mov dl, ch
.d:     mov al, dl
        sub al, bl
        jb .dfill
        cmp al, cl
        jb .dfill
        call gblk_copy
        dec dl
        jmp .d
.dfill: cmp dl, cl
        jb .gdone
        call gblk_fill
        or dl, dl
        jz .gdone
        dec dl
        jmp .dfill
.gdone: pop ds
        ret

; AX = AL * 320 (the bytes of one text row in one CGA bank)
row320: xor ah, ah
        push dx
        mov dx, 320
        mul dx
        pop dx
        ret

; copy text row AL to text row DL in both banks
gblk_copy:
        push ax
        push cx
        push si
        push di
        call row320
        mov si, ax
        mov al, dl
        call row320
        mov di, ax
        mov cx, 160
        push si
        push di
        rep movsw
        pop di
        pop si
        add si, 0x2000
        add di, 0x2000
        mov cx, 160
        rep movsw
        pop di
        pop si
        pop cx
        pop ax
        ret

; fill text row DL with byte BH in both banks
gblk_fill:
        push ax
        push cx
        push di
        mov al, dl
        call row320
        mov di, ax
        mov al, bh
        mov cx, 320
        push di
        rep stosb
        pop di
        add di, 0x2000
        mov cx, 320
        rep stosb
        pop di
        pop cx
        pop ax
        ret

; draw character AL with colour BL (bit 7 = XOR) at text column DL, row DH
; in graphics modes 4, 5 (2 bits a pixel) and 6 (1 bit a pixel)
gglyph: push ax
        push bx
        push cx
        push dx
        push si
        push di
        push ds
        mov ch, [VID_MODE]
        mov cl, al
        mov al, dh
        call row320
        mov di, ax
        mov al, dl
        xor ah, ah
        cmp ch, 6
        je .m6
        shl ax, 1
.m6:    add di, ax
        mov al, cl
        xor ah, ah
        mov si, ax
        shl si, 1
        shl si, 1
        shl si, 1
        cmp cl, 0x80
        jb .low
        sub si, 0x400         ; upper half: the table at the INT 1Fh vector
        xor ax, ax
        mov ds, ax
        add si, [0x7C]
        mov ds, [0x7E]
        jmp .draw
.low:   add si, font8x8
        push cs
        pop ds
.draw:  xor dl, dl            ; scan line 0..7
.row:   lodsb
        mov bh, al
        push di
        mov al, dl
        shr al, 1
        mov ah, 80
        mul ah
        add di, ax
        test dl, 1
        jz .even
        add di, 0x2000
.even:  cmp ch, 6
        jne .c4
        mov al, bh
        test bl, 1
        jnz .m6c
        xor al, al
.m6c:   test bl, 0x80
        jz .m6w
        xor [es:di], al
        jmp .next
.m6w:   mov [es:di], al
        jmp .next
.c4:    push cx
        push dx
        xor dx, dx
        mov cx, 8
.bit:   shl dx, 1
        shl dx, 1
        shl bh, 1
        jnc .zero
        mov al, bl
        and al, 3
        or dl, al
.zero:  loop .bit
        test bl, 0x80
        jz .w4
        xor [es:di], dh
        xor [es:di+1], dl
        jmp .n4
.w4:    mov [es:di], dh
        mov [es:di+1], dl
.n4:    pop dx
        pop cx
.next:  pop di
        inc dl
        cmp dl, 8
        jb .row
        pop ds
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; pixel address for column CX, row DX: DI byte, CL shift, BL mask
pix_addr:
        push ax
        push dx
        mov ax, dx
        shr ax, 1
        push dx
        mov di, 80
        mul di
        pop dx
        mov di, ax
        test dl, 1
        jz .e
        add di, 0x2000
.e:     mov ax, cx
        mov bx, ax
        cmp byte [VID_MODE], 6
        je .m6
        shr ax, 1
        shr ax, 1
        add di, ax
        and bl, 3
        mov cl, 3
        sub cl, bl
        shl cl, 1
        mov bl, 3
        jmp .d
.m6:    mov cl, 3
        shr ax, cl
        add di, ax
        and bl, 7
        mov cl, 7
        sub cl, bl
        mov bl, 1
.d:     pop dx
        pop ax
        ret

; program the 6845 cursor registers from the BDA (text modes)
set_hw_cursor:
        push ax
        push bx
        push dx
        cmp byte [VID_MODE], 4
        jae .x
        call cur_ptr
        mov dx, [bx]
        mov al, dh
        mov ah, [VID_COLS]
        mul ah
        xor dh, dh
        add ax, dx
        mov bx, [VID_POFF]
        shr bx, 1
        add ax, bx
        mov bx, ax
        mov al, 0x0E
        mov ah, bh
        call crtc_out
        mov al, 0x0F
        mov ah, bl
        call crtc_out
.x:     pop dx
        pop bx
        pop ax
        ret

; write AH to 6845 register AL
crtc_out:
        push dx
        mov dx, 0x3D4
        out dx, al
        inc dx
        xchg al, ah
        out dx, al
        xchg al, ah
        pop dx
        ret

; beep: about 880 Hz for a moment with the 8253 and 8255
beep:   push ax
        push cx
        mov al, 0xB6
        out 0x43, al
        mov ax, 1356
        out 0x42, al
        mov al, ah
        out 0x42, al
        in al, 0x61
        or al, 3
        out 0x61, al
        mov cx, 0x3000
.w:     loop .w
        in al, 0x61
        and al, 0xFC
        out 0x61, al
        pop cx
        pop ax
        ret

; ----------------------------------------------------------
; INT 08h  timer tick (IRQ0, 18.2 times a second)
int08:  push ax
        push ds
        mov ax, BDA
        mov ds, ax
        add word [TICKS], 1
        adc word [TICKS+2], 0
        cmp word [TICKS+2], 0x18
        jne .n
        cmp word [TICKS], 0xB0
        jne .n
        mov word [TICKS], 0   ; midnight: 1800B0h ticks in a day
        mov word [TICKS+2], 0
        mov byte [TICK_OVF], 1
.n:     cmp byte [MOTOR_CNT], 0   ; diskette motor time-out
        je .m
        dec byte [MOTOR_CNT]
        jnz .m
        and byte [MOTOR_ST], 0xF0
        push dx
        mov al, 0x0C          ; all motors off (the controller stays on)
        mov dx, FDC_DOR
        out dx, al
        pop dx
.m:     int 0x1C
        mov al, 0x20
        out 0x20, al
        pop ds
        pop ax
        iret

; ----------------------------------------------------------
; INT 09h  keyboard (IRQ1): scan code -> shift state / ASCII -> buffer
int09:  push ax
        push bx
        push cx
        push si
        push ds
        mov bx, BDA
        mov ds, bx
        in al, 0x60
        mov ah, al
        in al, 0x61           ; pulse bit 7 to acknowledge the byte
        or al, 0x80
        out 0x61, al
        and al, 0x7F
        out 0x61, al
        mov al, ah
        and al, 0x7F
        mov cl, al            ; CL = make code, AH bit 7 = release
        mov bl, 0x02
        cmp cl, 0x2A          ; left shift
        je .mod
        mov bl, 0x01
        cmp cl, 0x36          ; right shift
        je .mod
        mov bl, 0x04
        cmp cl, 0x1D          ; ctrl
        je .mod
        mov bl, 0x08
        cmp cl, 0x38          ; alt
        je .mod
        test ah, 0x80
        jnz .done             ; other key releases
        mov bl, 0x40
        cmp cl, 0x3A          ; caps lock
        je .tog
        mov bl, 0x20
        cmp cl, 0x45          ; num lock
        je .tog
        cmp cl, 0x46          ; scroll lock, or ctrl+break
        jne .key
        test byte [KB_FLAGS], 0x04
        jz .scr
        mov bx, [KB_TAIL]
        mov [KB_HEAD], bx
        int 0x1B
        xor ax, ax
        jmp .store
.scr:   mov bl, 0x10
.tog:   xor [KB_FLAGS], bl
        jmp .done
.mod:   test ah, 0x80
        jnz .rel
        or [KB_FLAGS], bl
        jmp .done
.rel:   not bl
        and [KB_FLAGS], bl
        jmp .done
.key:   mov ch, [KB_FLAGS]
        cmp cl, 0x53          ; ctrl+alt+del: warm boot
        jne .t
        mov al, ch
        and al, 0x0C
        cmp al, 0x0C
        jne .t
        mov word [RESET_FLAG], 0x1234
        jmp 0xF000:start
.t:     cmp cl, 0x59
        jae .done
        xor bh, bh
        mov bl, cl
        mov ah, cl            ; AH = scan code
        test ch, 0x08         ; alt: AL = 0
        jnz .ext
        test ch, 0x04         ; ctrl
        jz .nctl
        mov al, [cs:bx+kb_ctrl]
        jmp .chk
.nctl:  cmp cl, 0x4A          ; grey - and +
        je .sh
        cmp cl, 0x4E
        je .sh
        cmp cl, 0x47          ; keypad 47h-53h
        jb .main
        cmp cl, 0x53
        ja .main
        xor al, al
        test ch, 0x20
        jz .n1
        not al
.n1:    test ch, 0x03
        jz .n2
        not al
.n2:    or al, al
        jz .ext               ; cursor keys: extended code
.sh:    mov al, [cs:bx+kb_shift]
        jmp .chk
.main:  cmp cl, 0x3B          ; F1-F10
        jb .alpha
        cmp cl, 0x44
        ja .alpha
        test ch, 0x03
        jz .ext
        add ah, 0x19          ; shift+F1 = 54h
        jmp .ext
.alpha: mov si, kb_normal
        test ch, 0x03
        jz .al1
        mov si, kb_shift
.al1:   mov al, [cs:si+bx]
        test ch, 0x40         ; caps lock swaps the case of letters
        jz .chk
        mov bl, al
        or bl, 0x20
        cmp bl, 'a'
        jb .chk
        cmp bl, 'z'
        ja .chk
        xor al, 0x20
        jmp .chk
.ext:   xor al, al
        jmp .store
.chk:   or al, al
        jz .done
.store: mov bx, [KB_TAIL]
        mov si, bx
        add si, 2
        cmp si, KB_END
        jb .nw
        mov si, KB_BUF
.nw:    cmp si, [KB_HEAD]
        je .done              ; buffer full
        mov [bx], ax          ; AL = ASCII, AH = scan code
        mov [KB_TAIL], si
.done:  mov al, 0x20
        out 0x20, al
        pop ds
        pop si
        pop cx
        pop bx
        pop ax
        iret

; ----------------------------------------------------------
; INT 16h  keyboard services: 00h wait, 01h check, 02h shift flags
int16:  sti
        push bx
        push ds
        mov bx, BDA
        mov ds, bx
        and ah, 0xEF          ; 10h-12h act as 00h-02h
        cmp ah, 1
        je .peek
        cmp ah, 2
        je .flags
.wait:  cli
        mov bx, [KB_HEAD]
        cmp bx, [KB_TAIL]
        jne .get
        sti
        hlt                   ; sleep until the next interrupt
        jmp .wait
.get:   mov ax, [bx]
        add bx, 2
        cmp bx, KB_END
        jb .s
        mov bx, KB_BUF
.s:     mov [KB_HEAD], bx
        sti
        pop ds
        pop bx
        iret
.flags: mov al, [KB_FLAGS]
        pop ds
        pop bx
        iret
.peek:  cli
        mov bx, [KB_HEAD]
        cmp bx, [KB_TAIL]
        je .none
        mov ax, [bx]
        sti
        pop ds
        pop bx
        push bp
        mov bp, sp
        and word [bp+6], 0xFFBF   ; ZF = 0 in the saved flags
        pop bp
        iret
.none:  sti
        pop ds
        pop bx
        push bp
        mov bp, sp
        or word [bp+6], 0x0040    ; ZF = 1 in the saved flags
        pop bp
        iret

; ----------------------------------------------------------
; INT 13h  diskette services. The BIOS drives the NEC uPD765 floppy disk
; controller (ports 3F2h-3F5h) and channel 2 of the 8237 DMA, like the IBM PC:
; motor on, recalibrate, seek, DMA set-up, the command, wait for IRQ 6, the
; result bytes, the status code, and up to 3 retries with a reset.
;   AH = 00h reset   01h status   02h read   03h write   04h verify   05h format
;        08h drive parameters   15h drive type   16h change line   17h/18h media type
;   DL = drive, CH = cylinder, CL = sector, DH = head, AL = sectors, ES:BX = buffer
; Out: AH = status (0 = good), AL = sectors done, CF = 1 on an error.
; In the handler BP points to the saved registers of the caller:
;   [bp+0] ES  [bp+10] DL  [bp+11] DH  [bp+12] CL  [bp+13] CH  [bp+14] BX
; and the local bytes: [bp-1] tries  [bp-2] EOT  [bp-3] time-out flag
int13:  sti
        cmp dl, 0x80
        jb fd_entry
        jmp hd_entry

fd_entry:
        cmp ah, 0x08
        jne .n8
        jmp fd_parms
.n8:    cmp ah, 0x15
        jne .n15
        jmp fd_type
.n15:   push bx
        push cx
        push dx
        push si
        push di
        push bp
        push ds
        push es
        mov bp, sp
        sub sp, 4
        mov si, BDA
        mov ds, si
        mov si, ax            ; SI = AX of the call
        mov byte [bp-3], 0
        or ah, ah
        jnz .f1
        call fd_reset         ; AH=00h
        jmp fd_done
.f1:    cmp ah, 0x01
        jne .f2
        mov al, [DSK_STATUS]  ; AH=01h: AL = the status of the last operation
        xor ah, ah
        jmp fd_done
.f2:    cmp ah, 0x05
        ja .f3
        call fd_rw            ; AH=02h-05h
        jmp fd_done
.f3:    cmp ah, 0x16
        jne .f4
        call fd_change
        jmp fd_done
.f4:    cmp ah, 0x17
        jb .bad
        cmp ah, 0x18
        ja .bad
        call fd_setmedia
        jmp fd_done
.bad:   mov ah, 0x01          ; not a function of this BIOS
fd_done:
        mov [DSK_STATUS], ah
        mov sp, bp
        pop es
        pop ds
        pop bp
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        or ah, ah
        jz .ok
        stc
        retf 2
.ok:    clc
        retf 2

; AH=02h-05h: read, write, verify or format, with retries.
; Out: AH = status, AL = sectors done.
fd_rw:  mov byte [bp-1], 4    ; 1 try and 3 retries
        mov al, 4
        call fd_parm          ; AL = the last sector of a track (EOT) from the table
        mov dx, si
        mov ah, [bp+12]
        and ah, 0x3F
        add ah, dl
        dec ah                ; AH = the last sector of the request
        cmp al, ah
        jae .eot
        mov al, ah
.eot:   mov [bp-2], al
.try:   mov byte [bp-3], 0
        call fd_select
        call fd_chgline
        call fd_rate
        call fd_ready
        jc .end               ; not ready: no disk, no retry
        call fd_seek
        jc .err
        call fd_xfer
        jnc .ok
.err:   cmp ah, 0x09          ; DMA boundary, write protect: no retry
        je .end
        cmp ah, 0x03
        je .end
        dec byte [bp-1]
        jz .end
        push ax
        call fd_next_rate
        call fd_reset
        pop ax
        jmp .try
.ok:    call fd_media_ok
        mov ax, si
        cmp ah, 0x05
        je .fmt
        call fd_count         ; AL = sectors done, from the result bytes
.fmt:   xor ah, ah
        jmp .mc
.end:   xor al, al
.mc:    push ax
        mov al, 2
        call fd_parm          ; the motor stops after this number of timer ticks
        mov [MOTOR_CNT], al
        pop ax
        ret

; DMA set-up, the command, wait for IRQ 6, the result bytes.
; Out: AH = status, CF = 1 on an error.
fd_xfer:
        mov ax, si
        cmp ah, 0x05
        je .fmt
        mov ah, al            ; DMA count = sectors * 512 - 1
        xor al, al
        shl ax, 1
        dec ax
        mov di, ax
        mov ax, si
        mov al, 0x46          ; DMA mode: single transfer, write to memory, channel 2
        cmp ah, 0x03
        jb .dm
        mov al, 0x4A          ; read from memory
        je .dm
        mov al, 0x42          ; verify: no memory cycles
.dm:    call fd_dma
        jc .bound
        and byte [SEEK_ST], 0x7F
        mov ax, si
        mov al, 0xE6          ; READ DATA: multi-track, MFM, skip deleted data
        cmp ah, 0x03
        jne .c
        mov al, 0xC5          ; WRITE DATA: multi-track, MFM
.c:     call fd_out
        call fd_hdus
        call fd_out
        mov al, [bp+13]       ; C
        call fd_out
        mov al, [bp+11]       ; H
        call fd_out
        mov al, [bp+12]       ; R
        and al, 0x3F
        call fd_out
        mov al, 3             ; N (bytes per sector)
        call fd_parm
        call fd_out
        mov al, [bp-2]        ; EOT
        call fd_out
        mov al, 5             ; gap length
        call fd_parm
        call fd_out
        mov al, 6             ; data length
        call fd_parm
        call fd_out
        jmp .go
.fmt:   mov al, 4             ; DMA count = sectors * 4 - 1 (C, H, R, N of each sector)
        call fd_parm
        xor ah, ah
        shl ax, 1
        shl ax, 1
        dec ax
        mov di, ax
        mov al, 0x4A
        call fd_dma
        jc .bound
        and byte [SEEK_ST], 0x7F
        mov al, 0x4D          ; FORMAT TRACK: MFM
        call fd_out
        call fd_hdus
        call fd_out
        mov al, 3             ; N
        call fd_parm
        call fd_out
        mov al, 4             ; sectors a track
        call fd_parm
        call fd_out
        mov al, 7             ; gap length for format
        call fd_parm
        call fd_out
        mov al, 8             ; filler byte
        call fd_parm
        call fd_out
.go:    cmp byte [bp-3], 0
        jne .to
        call fd_wait
        jc .to
        call fd_results
        jc .bad
        jmp fd_status
.bound: mov ah, 0x09          ; the buffer crosses a 64 KB page of the DMA
        stc
        ret
.to:    mov ah, 0x80
        stc
        ret
.bad:   mov ah, 0x20
        stc
        ret

; program DMA channel 2: AL = mode, DI = bytes - 1, the address from ES:BX.
; CF = 1: the buffer crosses a 64 KB boundary (the channel stays masked).
fd_dma: cli
        out 0x0C, al          ; clear the byte flip-flop
        out 0x0B, al          ; the mode of channel 2
        mov ax, [bp+0]        ; ES
        mov cl, 4
        rol ax, cl
        mov dl, al
        and dl, 0x0F          ; DL = the page (address bits 16-19)
        and al, 0xF0          ; AX = ES * 16 (address bits 0-15)
        add ax, [bp+14]       ; + BX
        adc dl, 0
        out 0x04, al          ; the address of channel 2: low byte, high byte
        xchg al, ah
        out 0x04, al
        xchg al, ah
        push ax
        mov al, dl
        out 0x81, al          ; the page register of channel 2
        mov ax, di
        out 0x05, al          ; the count of channel 2
        mov al, ah
        out 0x05, al
        sti
        pop ax
        add ax, di            ; the last byte: a carry means a 64 KB boundary
        jc .x
        mov al, 0x02
        out 0x0A, al          ; unmask channel 2
        clc
.x:     ret

; the INT 13h status from the result bytes. Out: AH = status, CF = 1 on an error.
fd_status:
        mov al, [NEC_ST]
        test al, 0x08         ; ST0 NR: the drive is not ready
        jnz .nr
        and al, 0xC0          ; ST0 bits 7-6: 00 = a normal end
        jz .good
        cmp al, 0x40
        jne .bad              ; invalid command, or the drive changed
        mov al, [NEC_ST+1]
        mov ah, 0x04
        test al, 0x80         ; ST1 EN: end of the cylinder
        jnz .e
        mov ah, 0x10
        test al, 0x20         ; DE: CRC error
        jnz .e
        mov ah, 0x08
        test al, 0x10         ; OR: DMA overrun
        jnz .e
        mov ah, 0x04
        test al, 0x04         ; ND: sector not found
        jnz .e
        mov ah, 0x03
        test al, 0x02         ; NW: write protected
        jnz .e
        mov ah, 0x02
        test al, 0x01         ; MA: no address mark
        jnz .e
.bad:   mov ah, 0x20          ; the controller failed
.e:     stc
        ret
.nr:    mov ah, 0x80
        stc
        ret
.good:  xor ah, ah
        ret

; AL = sectors done: from the result C, H, R and the request (multi-track order)
fd_count:
        mov al, [NEC_ST+3]
        sub al, [bp+13]
        shl al, 1
        add al, [NEC_ST+4]
        sub al, [bp+11]       ; (C - C0) * 2 + H - H0 tracks
        mul byte [bp-2]       ; x EOT
        add al, [NEC_ST+5]
        mov ah, [bp+12]
        and ah, 0x3F
        sub al, ah            ; + R - R0
        ret

; motor on and select the drive (DOR). The motor does not stop during the operation.
fd_select:
        mov byte [MOTOR_CNT], 0xFF
        call fd_bit
        or [MOTOR_ST], al
        mov al, [MOTOR_ST]
        mov cl, 4
        shl al, cl            ; bits 4-7: the motors that turn
        mov cl, [bp+10]
        and cl, 0x03
        or al, cl             ; bits 0-1: the drive
        or al, 0x0C           ; bit 2: no reset, bit 3: IRQ and DMA on
        mov dx, FDC_DOR
        out dx, al
        ret

; wait until the drive is ready: SENSE DRIVE STATUS, ST3 bit 5 (a disk is in and
; the motor turns at full speed). At most 28 timer ticks. CF = 1, AH = 80h: not ready.
fd_ready:
        mov bx, [TICKS]
        xor di, di            ; a fall-back count, for a stopped timer
.l:     mov al, 0x04
        call fd_out
        call fd_hdus
        call fd_out
        call fd_in
        jc .no
        test al, 0x20
        jnz .ok
        mov ax, [TICKS]
        sub ax, bx
        cmp ax, 28
        jae .no
        dec di
        jnz .l
.no:    mov ah, 0x80
        stc
        ret
.ok:    clc
        ret

; recalibrate the drive when it needs it, then SEEK to cylinder CH.
; Out: CF = 1 and AH = status on an error.
fd_seek:
        call fd_bit
        test [SEEK_ST], al
        jnz .sk
        call fd_recal
        jnc .cal
        call fd_recal         ; again: the 765 stops after 77 steps
        jc .err
.cal:   call fd_bit
        or [SEEK_ST], al
.sk:    and byte [SEEK_ST], 0x7F
        mov al, 0x0F          ; SEEK
        call fd_out
        call fd_hdus
        call fd_out
        mov al, [bp+13]
        call fd_out
        cmp byte [bp-3], 0
        jne .to
        call fd_wait
        jc .to
        call fd_sense
        jc .to
        test byte [NEC_ST], 0xC0   ; ST0: a normal end
        jnz .err
        mov al, [NEC_ST+1]    ; PCN: the cylinder of the head
        cmp al, [bp+13]
        jne .err
        clc
        ret
.err:   mov ah, 0x40
        stc
        ret
.to:    mov ah, 0x80
        stc
        ret

; RECALIBRATE: the head goes to track 0. CF = 1 on an error.
fd_recal:
        and byte [SEEK_ST], 0x7F
        mov al, 0x07
        call fd_out
        call fd_hdus
        and al, 0x03
        call fd_out
        cmp byte [bp-3], 0
        jne .e
        call fd_wait
        jc .e
        call fd_sense
        jc .e
        test byte [NEC_ST], 0xD0   ; an abnormal end or an equipment check
        jnz .e
        clc
        ret
.e:     stc
        ret

; SENSE INTERRUPT STATUS: ST0 and PCN to NEC_ST. CF = 1: time-out
fd_sense:
        mov al, 0x08
        call fd_out
        jc .e
        call fd_results
.e:     ret

; read the result bytes to NEC_ST (7 at most). CF = 1: time-out
fd_results:
        mov di, NEC_ST
        mov cx, 7
.r:     call fd_in
        jc .e
        mov [di], al
        inc di
        mov dx, FDC_MSR
        in al, dx
        test al, 0x10         ; CB = 0: the controller has no more bytes
        jz .ok
        loop .r
.e:     stc
        ret
.ok:    clc
        ret

; send AL to the controller when it asks for a byte (MSR: RQM = 1, DIO = 0).
; CF = 1: time-out (it also sets the time-out flag [bp-3]).
fd_out: push cx
        push dx
        push ax
        mov dx, FDC_MSR
        xor cx, cx
.w:     in al, dx
        and al, 0xC0
        cmp al, 0x80
        je .ok
        loop .w
        mov byte [bp-3], 1
        pop ax
        pop dx
        pop cx
        stc
        ret
.ok:    pop ax
        inc dx
        out dx, al
        pop dx
        pop cx
        clc
        ret

; AL = the next result byte, when the controller has one (RQM = 1, DIO = 1).
; CF = 1: time-out
fd_in:  push cx
        push dx
        mov dx, FDC_MSR
        xor cx, cx
.w:     in al, dx
        and al, 0xC0
        cmp al, 0xC0
        je .ok
        loop .w
        mov byte [bp-3], 1
        pop dx
        pop cx
        stc
        ret
.ok:    inc dx
        in al, dx
        pop dx
        pop cx
        clc
        ret

; wait for IRQ 6 (INT 0Eh sets SEEK_ST bit 7). At most 2 s. CF = 1: time-out
fd_wait:
        push bx
        push cx
        push dx
        mov bx, [TICKS]
        mov dx, 40            ; a fall-back count, for a stopped timer
        xor cx, cx
.w:     test byte [SEEK_ST], 0x80
        jnz .ok
        mov ax, [TICKS]
        sub ax, bx
        cmp ax, 37
        jae .to
        loop .w
        dec dx
        jnz .w
.to:    pop dx
        pop cx
        pop bx
        stc
        ret
.ok:    and byte [SEEK_ST], 0x7F
        pop dx
        pop cx
        pop bx
        clc
        ret

; reset the controller (DOR bit 2), wait for its interrupt, read the state of the
; 4 drives (SENSE INTERRUPT STATUS 4 times), then SPECIFY. Out: AH = status.
fd_reset:
        mov al, [MOTOR_ST]
        mov cl, 4
        shl al, cl            ; the motors keep turning
        mov dx, FDC_DOR
        out dx, al            ; bit 2 = 0: the controller is in reset
        and byte [SEEK_ST], 0x70  ; all drives need a recalibrate
        mov cx, 4
.p:     loop .p               ; the reset pulse (a few microseconds)
        or al, 0x0C
        out dx, al            ; the controller starts, with IRQ and DMA on
        call fd_wait
        jc .bad
        mov bl, 0xC0
.s:     call fd_sense         ; drives 0-3: ST0 = C0h + drive (ready change)
        jc .bad
        cmp [NEC_ST], bl
        jne .bad
        inc bl
        cmp bl, 0xC4
        jb .s
        call fd_specify
        jc .bad
        xor ax, ax
        ret
.bad:   mov ah, 0x20
        stc
        ret

; SPECIFY: step rate, head unload and load times from the parameter table
fd_specify:
        mov al, 0x03
        call fd_out
        xor al, al
        call fd_parm          ; step rate time, head unload time
        call fd_out
        mov al, 1
        call fd_parm          ; head load time, DMA mode
        call fd_out
        ret

; AL = byte number AL of the diskette parameter table (INT 1Eh vector). AH = 0.
fd_parm:
        push si
        push ds
        xor si, si
        mov ds, si
        lds si, [0x1E*4]
        xor ah, ah
        add si, ax
        mov al, [si]
        pop ds
        pop si
        ret

; AL = 1 << drive
fd_bit: mov cl, [bp+10]
        and cl, 0x03
        mov al, 1
        shl al, cl
        ret

; AL = head * 4 + drive (the second byte of a command)
fd_hdus:
        mov al, [bp+11]
        and al, 1
        shl al, 1
        shl al, 1
        or al, [bp+10]
        and al, 0x07
        ret

; AH=08h (after the drive type is in BL): CH last cylinder, CL sectors a track,
; DH last head, DL drives, ES:DI the parameter table, AX = 0
fd_ptab:
        mov di, diskette_table
        mov cx, 0x4F12        ; 80 cylinders, 18 sectors (1.44 MB)
        cmp bl, 5
        jne .t3
        mov di, diskette_table_288
        mov cl, 36            ; 2.88 MB
.t3:    cmp bl, 3
        jne .t2
        mov cl, 9             ; 720 KB
.t2:    cmp bl, 2
        jne .t1
        mov cl, 15            ; 1.2 MB
.t1:    cmp bl, 1
        jne .t0
        mov cx, 0x2709        ; 360 KB: 40 cylinders, 9 sectors
.t0:    mov dx, 0x0102        ; DH = last head 1, DL = 2 drives
        push cs
        pop es
        xor ax, ax
        clc
        retf 2

; ---- the parts that the AT BIOS replaces: drive types, data rate, change line
fd_parms:
        mov bl, 4             ; the drive type: a 1.44 MB 3.5" drive
        jmp fd_ptab
fd_type:
        mov ax, 0x0100        ; a diskette drive without a change line
        clc
        retf 2
; the PC/XT drive has no change line, and the controller has one data rate
fd_change:
fd_setmedia:
        xor ah, ah
        ret
fd_rate:
fd_next_rate:
fd_media_ok:
fd_chgline:
        ret
; ---- the end of the AT block

; INT 0Eh  diskette interrupt (IRQ 6): the controller ended an operation.
int0e:  push ax
        push ds
        mov ax, BDA
        mov ds, ax
        or byte [SEEK_ST], 0x80
        mov al, 0x20
        out 0x20, al
        pop ds
        pop ax
        iret

; INT 19h  bootstrap: read sector 1 of drive A: to 0000:7C00. With no disk in A:, the
; master boot record of drive C: (when there is a hard disk). 40:F6h = 80h: drive C: first.
int19:  sti
        mov ax, BDA
        mov ds, ax
        cmp byte [BOOT_DRV], 0x80
        jne .flop
        call boot_hd          ; (it returns only when drive C: does not boot)
.flop:  mov si, msg_boot
        call puts
.again: mov cx, 4
.try:   push cx
        xor ax, ax
        mov es, ax
        xor dx, dx
        int 0x13
        mov ax, 0x0201
        mov bx, 0x7C00
        mov cx, 0x0001
        xor dx, dx
        int 0x13
        pop cx
        jnc .go
        cmp ah, 0x80          ; no disk: do not try again
        je .none
        loop .try
.none:  mov ax, BDA
        mov ds, ax
        call boot_hd          ; no disk in A: -> drive C:
        mov si, msg_nodisk
        call puts
        xor ax, ax
        int 0x16
        jmp .again
.go:    xor dx, dx            ; DL = boot drive
        jmp 0x0000:0x7C00

; Boot from drive C: (DS = BIOS data). The master boot record goes to 0000:7C00h and runs with
; DL = 80h. Returns when there is no hard disk or it has no boot record.
boot_hd:
        cmp byte [HD_COUNT], 0
        je .r
        mov si, msg_boot_c
        call puts
        xor ax, ax
        mov es, ax
        mov ax, 0x0201
        mov bx, 0x7C00
        mov cx, 0x0001
        mov dx, 0x0080
        int 0x13
        jc .bad
        cmp word [es:0x7DFE], 0xAA55
        jne .bad
        mov dx, 0x0080        ; DL = boot drive
        jmp 0x0000:0x7C00
.bad:   mov si, msg_hd_nob
        call puts
.r:     ret

; ----------------------------------------------------------
; The IDE hard disk (drive C:, DL = 80h). The controller is at 1F0h-1F7h (see devices.js). The
; BIOS polls its status (IRQ 14 stays masked). The CHS of INT 13h goes to the controller as it is.
; hd_init (POST): find the drive, IDENTIFY DEVICE, fill the table at 40:C0h, INT 41h, 40:75h,
; and print a line.
hd_init:
        push ds
        push ax
        push bx
        push cx
        push dx
        push si
        mov ax, BDA
        mov ds, ax
        mov byte [HD_COUNT], 0
        mov dx, 0x1F6
        mov al, 0xA0          ; drive 0 (the master), head 0
        out dx, al
        mov dx, IDE_STAT
        in al, dx
        cmp al, 0xFF          ; no controller: the bus floats
        je .none
        or al, al             ; no drive
        jz .none
        call hd_nbusy
        jc .none
        mov dx, IDE_STAT
        mov al, 0xEC          ; IDENTIFY DEVICE
        out dx, al
        call hd_drq
        jc .none
        mov dx, IDE_DATA
        xor bx, bx            ; BX = the number of the word
.id:    in ax, dx
        cmp bx, 1
        jne .i3
        mov [HD_FDPT], ax     ; word 1: cylinders
        mov [HD_FDPT+3], ax   ; (reduced write current: none)
        mov [HD_FDPT+12], ax  ; (landing zone)
.i3:    cmp bx, 3
        jne .i6
        mov [HD_FDPT+2], al   ; word 3: heads
.i6:    cmp bx, 6
        jne .in
        mov [HD_FDPT+14], al  ; word 6: sectors per track
.in:    inc bx
        cmp bx, 256
        jb .id
        mov word [HD_FDPT+5], 0xFFFF    ; no write precompensation
        mov byte [HD_FDPT+7], 0
        mov byte [HD_FDPT+8], 0
        cmp byte [HD_FDPT+2], 8
        jbe .h8
        mov byte [HD_FDPT+8], 0x08      ; more than 8 heads
.h8:    mov byte [HD_FDPT+15], 0
        mov byte [HD_COUNT], 1
        mov byte [HD_STATUS], 0
        push ds
        xor ax, ax
        mov ds, ax
        mov word [0x41*4], HD_FDPT + 0x400   ; INT 41h -> 0000:04C0h (the table)
        mov word [0x41*4+2], 0
        pop ds
        ; "DISK  C: IDE hard disk, 20 MB (615 cylinders, 4 heads, 17 sectors)"
        mov si, msg_hd1
        call puts
        mov ax, [HD_FDPT]
        mov bl, [HD_FDPT+2]
        xor bh, bh
        mul bx
        mov bl, [HD_FDPT+14]
        mul bx                ; DX:AX = sectors
        mov bx, 2048
        div bx                ; AX = MB
        call hd_dec
        mov si, msg_hd2
        call puts
        mov ax, [HD_FDPT]
        call hd_dec
        mov si, msg_hd3
        call puts
        mov al, [HD_FDPT+2]
        xor ah, ah
        call hd_dec
        mov si, msg_hd4
        call puts
        mov al, [HD_FDPT+14]
        xor ah, ah
        call hd_dec
        mov si, msg_hd5
        call puts
.none:  pop si
        pop dx
        pop cx
        pop bx
        pop ax
        pop ds
        ret

; print AX as a decimal number
hd_dec: push ax
        push bx
        push cx
        push dx
        mov bx, 10
        xor cx, cx
.d1:    xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d1
.d2:    pop ax
        add al, '0'
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        loop .d2
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; Wait until the drive is not busy (BSY = 0). CF = 1 and AH = 80h after a time-out.
hd_nbusy:
        push cx
        push dx
        mov dx, IDE_STAT
        xor cx, cx
.w:     in al, dx
        test al, 0x80
        jz .ok
        loop .w
        pop dx
        pop cx
        mov ah, 0x80          ; time-out
        stc
        ret
.ok:    pop dx
        pop cx
        clc
        ret
; The end of a command: not busy, and no error. CF = 1 and AH = the INT 13h error code.
hd_check:
        call hd_nbusy
        jc .r
        test al, 0x01         ; ERR
        jnz hd_error
        clc
.r:     ret
; A sector is ready (DRQ). CF = 1 and AH = the INT 13h error code.
hd_drq: call hd_check
        jc .r
        test al, 0x08         ; DRQ
        jnz .r                ; (CF = 0)
        mov ah, 0x20          ; controller failure
        stc
.r:     ret
; ERR: the error register -> the INT 13h code (04h sector not found, 10h bad ECC, 01h a bad
; command, 20h other errors)
hd_error:
        push dx
        mov dx, 0x1F1
        in al, dx
        pop dx
        mov ah, 0x04
        test al, 0x10         ; IDNF
        jnz .e
        mov ah, 0x10
        test al, 0x40         ; UNC
        jnz .e
        mov ah, 0x01
        test al, 0x04         ; ABRT
        jnz .e
        mov ah, 0x20
.e:     stc
        ret

; INT 13h for DL >= 80h. The registers of the caller are on the stack: [bp+0] AX, [bp+2] BX,
; [bp+4] CX, [bp+6] DX, [bp+8] SI, [bp+10] DI, [bp+12] ES, [bp+14] DS, [bp+16] BP. The result:
; the new AX (and CX, DX) in that frame; AH = status (0 = good), CF = 1 on an error.
hd_entry:
        push bp
        push ds
        push es
        push di
        push si
        push dx
        push cx
        push bx
        push ax
        mov bp, sp
        cld
        mov si, BDA
        mov ds, si
        cmp dl, 0x80
        jne .nodrv
        cmp byte [HD_COUNT], 0
        je .nodrv
        cmp ah, 0x02
        je .rw
        cmp ah, 0x03
        je .rw
        cmp ah, 0x04
        je .rw
        cmp ah, 0x08
        je .parms
        cmp ah, 0x15
        je .type
        cmp ah, 0x01
        je .stat
        cmp ah, 0x00          ; reset
        je .ok
        cmp ah, 0x05          ; format a track (nothing to do on an IDE drive)
        je .ok
        cmp ah, 0x09          ; initialize the drive
        je .ok
        cmp ah, 0x0C          ; seek
        je .ok
        cmp ah, 0x0D          ; alternate reset
        je .ok
        cmp ah, 0x10          ; test ready
        je .ok
        cmp ah, 0x11          ; recalibrate
        je .ok
        cmp ah, 0x14          ; controller diagnostic
        je .ok
        mov ah, 0x01          ; others (also 41h: no INT 13h extensions): bad command
        jmp .st
.nodrv: cmp ah, 0x15          ; no such drive: AH = 0 for 15h, else an error
        jne .nd2
        mov word [bp+0], 0
        jmp .out
.nd2:   cmp ah, 0x08
        jne .nd3
        mov word [bp+6], 0    ; DL = 0 drives
.nd3:   mov byte [bp+1], 0x01
        jmp .out
.ok:    xor ah, ah
        jmp .st
.stat:  mov al, [HD_STATUS]   ; AL = the last status, AH = 0
        mov [bp+0], al
        xor ah, ah
        jmp .st
.parms: mov ax, [HD_FDPT]     ; CH = max. cylinder (bits 0-7), CL = sectors | cylinder bits 8-9
        dec ax
        mov [bp+5], al
        mov cl, 6
        shl ah, cl
        or ah, [HD_FDPT+14]
        mov [bp+4], ah
        mov al, [HD_FDPT+2]   ; DH = max. head, DL = 1 drive
        dec al
        mov [bp+7], al
        mov byte [bp+6], 1
        mov byte [bp+0], 0
        xor ah, ah
        jmp .st
.type:  mov ax, [HD_FDPT]     ; AH = 3 (a hard disk), CX:DX = sectors
        mov bl, [HD_FDPT+2]
        xor bh, bh
        mul bx
        mov bl, [HD_FDPT+14]
        mul bx
        mov [bp+4], dx
        mov [bp+6], ax
        mov word [bp+0], 0x0300
        mov byte [HD_STATUS], 0
        pop ax
        pop bx
        pop cx
        pop dx
        pop si
        pop di
        pop es
        pop ds
        pop bp
        clc
        retf 2
.rw:    call hd_rw            ; AH = status, AL = sectors done
        mov [bp+0], ax
        jmp .st2
.st:    mov [bp+1], ah
.st2:   mov [HD_STATUS], ah
.out:   pop ax
        pop bx
        pop cx
        pop dx
        pop si
        pop di
        pop es
        pop ds
        pop bp
        or ah, ah
        jnz .err
        clc
        retf 2
.err:   stc
        retf 2

; Read (AH = 02h), write (03h) or verify (04h) AL sectors from CH/CL/DH, to or from ES:BX.
; Out: AH = status, AL = the sectors done.
hd_rw:  mov al, [bp+0]
        or al, al
        jnz .n0
        mov ax, 0x0100        ; no sectors: a bad command
        ret
.n0:    call hd_nbusy
        jnc .n1
        mov al, 0
        ret
.n1:    mov dx, 0x1F6
        mov al, [bp+7]        ; DH: the head
        and al, 0x0F
        or al, 0xA0           ; drive 0, CHS
        out dx, al
        mov dx, 0x1F2
        mov al, [bp+0]
        out dx, al            ; the number of sectors
        inc dx
        mov al, [bp+4]
        and al, 0x3F
        out dx, al            ; 1F3h: the sector
        inc dx
        mov al, [bp+5]
        out dx, al            ; 1F4h: cylinder bits 0-7
        inc dx
        mov al, [bp+4]
        mov cl, 6
        shr al, cl
        out dx, al            ; 1F5h: cylinder bits 8-9
        mov dx, IDE_STAT
        mov al, 0x20          ; READ SECTORS
        cmp byte [bp+1], 0x03
        jne .c1
        mov al, 0x30          ; WRITE SECTORS
.c1:    cmp byte [bp+1], 0x04
        jne .c2
        mov al, 0x40          ; READ VERIFY SECTORS
.c2:    out dx, al
        cmp byte [bp+1], 0x04
        jne .data
        call hd_check         ; verify: the drive reads the sectors itself
        mov al, [bp+0]
        jc .r
        xor ah, ah
.r:     ret
.data:  mov di, [bp+2]        ; ES:DI = the buffer (BX)
        mov bl, [bp+0]        ; BL = the sectors to do, BH = the sectors done
        xor bh, bh
.sec:   call hd_drq           ; a sector is ready (read), or the drive waits for one (write)
        jc .fail
        mov cx, 256
        mov dx, IDE_DATA
        cmp byte [bp+1], 0x03
        je .wr
.rd:    in ax, dx             ; one word from the sector buffer of the drive
        stosw
        loop .rd
        jmp .next
.wr:    push ds
        push es
        pop ds
        mov si, di
.wl:    lodsw
        out dx, ax            ; one word to the sector buffer of the drive
        loop .wl
        pop ds
        mov di, si
.next:  inc bh
        dec bl
        jnz .sec
        cmp byte [bp+1], 0x03
        jne .done
        call hd_check         ; a write: the drive writes the last sector
        jc .fail
.done:  mov al, bh
        xor ah, ah
        ret
.fail:  mov al, bh
        ret

; INT 11h equipment word, INT 12h memory size in KB
int11:  push ds
        mov ax, BDA
        mov ds, ax
        mov ax, [EQUIP]
        pop ds
        iret
int12:  push ds
        mov ax, BDA
        mov ds, ax
        mov ax, [MEMSIZE]
        pop ds
        iret

; INT 15h cassette / system services: not in this machine
int15:  mov ah, 0x86
        stc
        retf 2
; INT 14h serial and INT 17h printer: no ports, report a time-out
int14:  mov ah, 0x80
        iret
int17:  mov ah, 0x01
        iret
; INT 18h: no ROM BASIC
int18:  push cs
        pop ds
        mov si, msg_basic
        call puts
        xor ax, ax
        int 0x16
        int 0x19

; ----------------------------------------------------------
; INT 1Ah  time: AH=00h read ticks (AL = midnight flag), 01h set
int1a:  push ds
        push bx
        mov bx, BDA
        mov ds, bx
        cmp ah, 1
        je .set
        or ah, ah
        jne .rtc
        cli
        mov dx, [TICKS]
        mov cx, [TICKS+2]
        mov al, [TICK_OVF]
        mov byte [TICK_OVF], 0
        sti
        pop bx
        pop ds
        iret
.set:   cli
        mov [TICKS], dx
        mov [TICKS+2], cx
        mov byte [TICK_OVF], 0
        sti
        pop bx
        pop ds
        iret
.rtc:   pop bx                ; no real-time clock chip (AT only)
        pop ds
        stc
        retf 2

; ----------------------------------------------------------
; INT 21h  a small subset of DOS services, for programs from the editor
;   01h read key with echo   02h write DL   06h direct console I/O
;   09h write $-string DS:DX 4Ch / 00h exit
; A real DOS replaces this vector when it boots.
int21:  cmp ah, 0x02
        je d_putc
        cmp ah, 0x09
        je d_puts
        cmp ah, 0x01
        je d_getc
        cmp ah, 0x06
        je d_direct
        cmp ah, 0x4C
        je int20
        cmp ah, 0x00
        je int20
        iret
d_putc: push ax
        mov al, dl
        mov ah, 0x0E
        int 0x10
        pop ax
        iret
d_puts: push ax
        push si
        mov si, dx
.l:     lodsb
        cmp al, '$'
        je .e
        mov ah, 0x0E
        int 0x10
        jmp .l
.e:     pop si
        pop ax
        iret
d_getc: xor ah, ah
        int 0x16
        mov ah, 0x0E
        int 0x10
        mov ah, 0x01
        iret
d_direct:
        cmp dl, 0xFF
        je .in
        jmp d_putc
.in:    mov ah, 1
        int 0x16
        jz .no
        xor ah, ah
        int 0x16
        mov ah, 0x06
        push bp
        mov bp, sp
        and word [bp+6], 0xFFBF
        pop bp
        iret
.no:    xor al, al
        mov ah, 0x06
        push bp
        mov bp, sp
        or word [bp+6], 0x0040
        pop bp
        iret

; INT 20h  program end
int20:  push cs
        pop ds
        mov si, msg_end
        call puts
        cli
.h:     hlt
        jmp .h

; INT 00h  divide error
int00:  push cs
        pop ds
        mov si, msg_div
        call puts
        jmp int20

; INT 02h  NMI: the 8087 reports an unmasked exception
int02:  push ax
        push si
        push ds
        push cs
        pop ds
        mov si, msg_nmi
        call puts
        fnclex
        pop ds
        pop si
        pop ax
        iret

int_default:
        iret

; ----------------------------------------------------------
vec_table:
        dw 0x00, int00
        dw 0x02, int02
        dw 0x08, int08
        dw 0x09, int09
        dw 0x10, int10
        dw 0x11, int11
        dw 0x12, int12
        dw 0x0E, int0e
        dw 0x13, int13
        dw 0x14, int14
        dw 0x15, int15
        dw 0x16, int16
        dw 0x17, int17
        dw 0x18, int18
        dw 0x19, int19
        dw 0x1A, int1a
        dw 0x1D, video_params
        dw 0x1E, diskette_table
        dw 0x1F, font8x8 + 0x400
        dw 0x20, int20
        dw 0x21, int21
        dw 0xFFFF

; video mode tables for modes 0-7
mode_reg:   db 0x2C, 0x28, 0x2D, 0x29, 0x2A, 0x2E, 0x1E, 0x29
mode_pal:   db 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3F, 0x30
mode_cols:  db 40, 40, 80, 80, 40, 40, 80, 80
mode_psize: dw 0x0800, 0x0800, 0x1000, 0x1000, 0x4000, 0x4000, 0x4000, 0x1000
crtc_40:    db 0x38, 0x28, 0x2D, 0x0A, 0x1F, 0x06, 0x19, 0x1C, 0x02, 0x07, 0x06, 0x07, 0, 0, 0, 0
crtc_80:    db 0x71, 0x50, 0x5A, 0x0A, 0x1F, 0x06, 0x19, 0x1C, 0x02, 0x07, 0x06, 0x07, 0, 0, 0, 0
crtc_gfx:   db 0x38, 0x28, 0x2D, 0x0A, 0x7F, 0x06, 0x64, 0x70, 0x02, 0x01, 0x06, 0x07, 0, 0, 0, 0
video_params:
            db 0x71, 0x50, 0x5A, 0x0A, 0x1F, 0x06, 0x19, 0x1C, 0x02, 0x07, 0x06, 0x07, 0, 0, 0, 0

; diskette parameter table (INT 1Eh), 1.44 MB drive
diskette_table:
        db 0xDF, 0x02, 0x25, 0x02, 18, 0x1B, 0xFF, 0x54, 0xF6, 0x0F, 0x08
; the same for a 2.88 MB drive (INT 13h AH=08h, drive type 5)
diskette_table_288:
        db 0xAF, 0x02, 0x25, 0x02, 36, 0x1B, 0xFF, 0x6C, 0xF6, 0x0F, 0x08

msg_banner: db 0x1E, " 8086 ANATOMY BIOS v2.0 ", 0
msg_cpu:    db 13, 10, 13, 10, "CPU   Intel 8086 @ 4.77 MHz, maximum mode (8288)", 13, 10, 0
msg_ram:    db "RAM   640 KB   ROM 64 KB   ", 0
msg_ram2:   db "   2 floppy drives", 13, 10, 0
msg_cga:    db "CGA", 0
msg_vga:    db "VGA", 0
msg_fpu_yes: db "FPU   Intel 8087 present", 13, 10, 0
msg_fpu_no:  db "FPU   not found", 13, 10, 0
msg_line:   db "----------------------------------------", 13, 10, 0
msg_boot:   db 13, 10, "Booting from drive A: ...", 13, 10, 0
msg_boot_c: db 13, 10, "Booting from drive C: ...", 13, 10, 0
msg_hd_nob: db "Drive C: has no boot record.", 13, 10, 0
msg_hd1:    db "DISK  C: IDE hard disk, ", 0
msg_hd2:    db " MB (", 0
msg_hd3:    db " cylinders, ", 0
msg_hd4:    db " heads, ", 0
msg_hd5:    db " sectors)", 13, 10, 0
msg_nodisk: db "No boot disk in drive A:. Load a disk image in the Disks panel,", 13, 10
            db "then press a key.", 13, 10, 0
msg_basic:  db 13, 10, "No ROM BASIC in this machine. Press a key.", 13, 10, 0
msg_end:    db 13, 10, "[program ended]", 13, 10, 0
msg_div:    db 13, 10, "Divide error (INT 0)", 0
msg_nmi:    db 13, 10, "8087 exception (NMI)", 13, 10, 0

; scan code set 1 -> ASCII, codes 00h-58h
kb_normal:
        db 0, 27, "1234567890-=", 8, 9                ; 00-0F
        db "qwertyuiop[]", 13, 0                     ; 10-1D
        db "asdfghjkl;'", 0x60, 0, "\"               ; 1E-2B
        db "zxcvbnm,./", 0, "*", 0, " ", 0           ; 2C-3A
        times 0x59 - 0x3B db 0                       ; 3B-58
kb_shift:
        db 0, 27, "!@#$%^&*()_+", 8, 0               ; 00-0F
        db "QWERTYUIOP{}", 13, 0                     ; 10-1D
        db 'ASDFGHJKL:"', "~", 0, "|"                ; 1E-2B
        db "ZXCVBNM<>?", 0, "*", 0, " ", 0           ; 2C-3A
        times 0x47 - 0x3B db 0                       ; 3B-46
        db "789-456+1230."                           ; 47-53 keypad
        times 0x59 - 0x54 db 0                       ; 54-58
kb_ctrl:
        db 0, 27, 0, 0, 0, 0, 30, 0, 0, 0, 0, 0, 31, 0, 127, 0          ; 00-0F
        db 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 27, 29, 10, 0          ; 10-1D
        db 1, 19, 4, 6, 7, 8, 10, 11, 12, 0, 0, 0, 0, 28                ; 1E-2B
        db 26, 24, 3, 22, 2, 14, 13, 0, 0, 0, 0, 0, 0, 32, 0            ; 2C-3A
        times 0x59 - 0x3B db 0                                          ; 3B-58

; 8x8 character font, 256 characters. The page fills it at start-up.
font8x8:
        times 2048 db 0

; ----------------------------------------------------------
        times 0xFFF0-($-$$) db 0xFF
reset:  jmp 0xF000:start      ; FFFF:0000 = F000:FFF0
        db "09/23/26"         ; ROM date at F000:FFF5
        db 0xFF, 0xFE, 0xFF   ; model byte FEh (PC/XT class) at F000:FFFE
`;

// Sample programs. All are original. They load at 1000:0100 (.COM style).
const SAMPLES = [
  {
    id: 'hello', name: 'Hello, 8086', desc: 'BIOS teletype output, one character at a time.',
    src: String.raw`; Hello, 8086 - print a string with the BIOS
        org 0x100

start:  mov si, message
next:   lodsb               ; AL = [DS:SI], SI = SI + 1
        or al, al           ; end of string?
        jz done
        mov ah, 0x0E        ; BIOS teletype
        int 0x10
        jmp next
done:   ret                 ; back to the PSP -> INT 20h

message: db "Hello, 8086!", 13, 10
         db "Every byte you see went over the data bus.", 13, 10, 0
` },
  {
    id: 'fib', name: 'Fibonacci', desc: 'Loop, ADD, XCHG and a decimal print routine with DIV.',
    src: String.raw`; Fibonacci numbers below 65536
        org 0x100

start:  xor ax, ax          ; a = 0
        mov bx, 1           ; b = 1
again:  call print_dec
        push ax
        mov dl, ' '
        mov ah, 2
        int 0x21
        pop ax
        add ax, bx          ; a + b
        jc finish           ; carry: the next sum needs 17 bits
        xchg ax, bx         ; a = b, b = a + b
        jmp again
finish: mov ax, bx          ; print the last one that fits
        call print_dec
        ret

; print AX as unsigned decimal
print_dec:
        push ax
        push bx
        push cx
        push dx
        mov bx, 10
        xor cx, cx
.div:   xor dx, dx
        div bx              ; DX:AX / 10
        push dx             ; remainder = digit
        inc cx
        or ax, ax
        jnz .div
.out:   pop dx
        add dl, '0'
        mov ah, 2
        int 0x21
        loop .out
        pop dx
        pop cx
        pop bx
        pop ax
        ret
` },
  {
    id: 'sort', name: 'Bubble sort', desc: 'Nested loops, CMP, conditional jumps and memory swaps.',
    src: String.raw`; Bubble sort of 10 bytes, printed before and after
        org 0x100

start:  call show
        mov cx, count - 1   ; passes
outer:  push cx
        mov si, data
inner:  mov al, [si]
        cmp al, [si+1]
        jbe noswap
        xchg al, [si+1]     ; swap the pair
        mov [si], al
noswap: inc si
        loop inner
        pop cx
        loop outer
        call show
        ret

show:   mov si, data
        mov cx, count
.l:     mov al, [si]
        aam                 ; AH = tens, AL = ones
        add ax, 0x3030
        push ax
        mov al, ah
        mov ah, 0x0E
        int 0x10
        pop ax
        mov ah, 0x0E
        int 0x10
        mov al, ' '
        int 0x10
        inc si
        loop .l
        mov al, 13
        int 0x10
        mov al, 10
        int 0x10
        ret

data:   db 42, 7, 93, 18, 64, 3, 77, 51, 29, 86
count   equ $ - data
` },
  {
    id: 'vram', name: 'Colour bars in VRAM', desc: 'Direct writes to B800:0000 with STOSW and REP.',
    src: String.raw`; Write coloured blocks straight into CGA text memory
        org 0x100

start:  mov ax, 0xB800
        mov es, ax          ; ES -> video RAM
        mov di, 160*3       ; row 3
        cld
        mov bl, 0x10        ; attribute: blue background
        mov dx, 8           ; 8 colour bars
bar:    mov ah, bl
        mov al, 0xDB        ; full block character
        mov cx, 10
        rep stosw           ; 10 cells per bar
        add bl, 0x11        ; next colour
        dec dx
        jnz bar
        ; a caption, cell by cell
        mov di, 160*5 + 20
        mov si, caption
        mov ah, 0x0E        ; yellow on black
cap:    lodsb
        or al, al
        jz done
        stosw
        jmp cap
done:   ret

caption: db "B800:0000 - the screen is just memory", 0
` },
  {
    id: 'movsb', name: 'REP MOVSB copy', desc: 'String instructions: DS:SI to ES:DI, CX times.',
    src: String.raw`; Copy a string with REP MOVSB and show both copies
        org 0x100

start:  mov si, source
        mov di, target
        mov cx, length
        cld                 ; DF = 0: addresses go up
        rep movsb           ; one bus read + one bus write per byte
        mov dx, target
        mov ah, 9
        int 0x21
        ret

source: db "Copied by REP MOVSB, byte by byte.", 13, 10, "$"
length  equ $ - source
target: times length db 0
` },
  {
    id: 'fact', name: 'Recursive factorial', desc: 'CALL/RET, the stack frame and 32-bit MUL results.',
    src: String.raw`; n! for n = 1..8 with a recursive procedure
        org 0x100

start:  mov cx, 1
next:   mov ax, cx
        call fact           ; AX = CX!
        call print_dec
        mov al, ' '
        mov ah, 0x0E
        int 0x10
        inc cx
        cmp cx, 9
        jb next
        ret

; fact: AX = AX!  (recursive, uses the stack)
fact:   cmp ax, 1
        jbe .base
        push ax
        dec ax
        call fact           ; AX = (n-1)!
        pop bx
        mul bx              ; DX:AX = n * (n-1)!
.base:  ret

print_dec:
        push ax
        push bx
        push cx
        push dx
        mov bx, 10
        xor cx, cx
.d:     xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d
.o:     pop ax
        add al, '0'
        mov ah, 0x0E
        int 0x10
        loop .o
        pop dx
        pop cx
        pop bx
        pop ax
        ret
` },
  {
    id: 'bcd', name: 'BCD arithmetic', desc: 'Packed decimal addition with ADC and DAA.',
    src: String.raw`; Add two 8-digit packed BCD numbers: 12345678 + 87654329
        org 0x100

start:  mov si, num_a       ; least significant byte first
        mov di, num_b
        mov bx, result
        mov cx, 4
        clc
add_l:  mov al, [si]
        adc al, [di]        ; binary add with carry
        daa                 ; decimal adjust AL
        mov [bx], al
        inc si
        inc di
        inc bx
        loop add_l
        mov al, 0
        adc al, 0
        mov [bx], al        ; carry digit
        ; print the 5 result bytes, most significant first
        mov cx, 5
        mov bx, result + 4
pr:     mov al, [bx]
        push cx
        mov cl, 4
        mov ah, al
        shr al, cl          ; high digit
        and ah, 0x0F        ; low digit
        add ax, 0x3030
        push ax
        mov ah, 0x0E
        int 0x10
        pop ax
        mov al, ah
        mov ah, 0x0E
        int 0x10
        pop cx
        dec bx
        loop pr
        ret

num_a:  db 0x78, 0x56, 0x34, 0x12
num_b:  db 0x29, 0x43, 0x65, 0x87
result: times 5 db 0
` },
  {
    id: 'clock', name: 'Timer interrupt', desc: 'Hook INT 1Ch: the 8253 fires IRQ0 18.2 times a second.',
    src: String.raw`; Hook the user timer vector (INT 1Ch) and count ticks on screen
        org 0x100

start:  xor ax, ax
        mov es, ax
        cli
        mov word [es:0x1C*4], tick      ; new handler offset
        mov [es:0x1C*4+2], cs           ; and segment
        sti
wait:   cmp word [count], 91            ; about 5 seconds
        jb wait
        ret

tick:   push ax
        push bx
        push cx
        push si
        push es
        push ds
        push cs
        pop ds
        inc word [count]
        mov ax, 0xB800
        mov es, ax
        mov ax, [count]
        mov bx, 160*10 + 70
        ; draw a spinner and the low byte of the count as hex
        push ax
        and ax, 3
        mov si, ax
        mov al, [spin + si]
        mov ah, 0x0A
        mov [es:bx], ax
        pop ax
        mov ah, al
        mov cl, 4
        shr al, cl
        call hexdig
        mov [es:bx+4], al
        mov byte [es:bx+5], 0x0F
        mov al, ah
        and al, 0x0F
        call hexdig
        mov [es:bx+6], al
        mov byte [es:bx+7], 0x0F
        pop ds
        pop es
        pop si
        pop cx
        pop bx
        pop ax
        iret

hexdig: add al, '0'
        cmp al, '9'
        jbe .ok
        add al, 7
.ok:    ret

count:  dw 0
spin:   db "|/-\"
` },
  {
    id: 'keys', name: 'Keyboard echo', desc: 'INT 16h waits with HLT until IRQ1 brings a key.',
    src: String.raw`; Echo keys until Esc. Click the screen, then type.
        org 0x100

start:  mov si, prompt
p:      lodsb
        or al, al
        jz loop_k
        mov ah, 0x0E
        int 0x10
        jmp p
loop_k: xor ah, ah
        int 0x16            ; AL = ASCII, AH = scan code
        cmp al, 27          ; Esc ends the program
        je done
        mov ah, 0x0E
        int 0x10
        cmp al, 13
        jne loop_k
        mov al, 10
        int 0x10
        jmp loop_k
done:   ret

prompt: db "Type something (Esc ends): ", 0
` },
  {
    id: 'tune', name: 'Speaker tune', desc: 'The 8253 channel 2 square wave drives the speaker.',
    src: String.raw`; Play a short tune on the PC speaker
        org 0x100

start:  mov si, notes
next:   lodsw               ; AX = PIT divisor (0 = end)
        or ax, ax
        jz done
        push ax
        mov al, 0xB6        ; channel 2, lobyte/hibyte, mode 3
        out 0x43, al
        pop ax
        out 0x42, al
        mov al, ah
        out 0x42, al
        in al, 0x61
        or al, 3            ; gate 2 + speaker data on
        out 0x61, al
        lodsb               ; duration in timer ticks
        call delay
        in al, 0x61
        and al, 0xFC        ; speaker off
        out 0x61, al
        mov al, 1
        call delay
        jmp next
done:   ret

; wait AL timer ticks (INT 1Ah counter)
delay:  push ax
        push cx
        push dx
        xor ah, ah
        mov bx, ax
        xor ah, ah
        int 0x1A
        add bx, dx
.w:     xor ah, ah
        int 0x1A
        cmp dx, bx
        jb .w
        pop dx
        pop cx
        pop ax
        ret

; divisor = 1193182 / frequency
notes:  dw 4560
        db 4                ; C4
        dw 4063
        db 4                ; D4
        dw 3619
        db 4                ; E4
        dw 4560
        db 4                ; C4
        dw 3619
        db 4                ; E4
        dw 3416
        db 4                ; F4
        dw 3043
        db 8                ; G4
        dw 0
` },
  {
    id: 'sb', name: 'Sound Blaster: FM and DMA', desc: 'Find the YM3812 and the DSP, play a chord on the FM chip, then a sound from memory by DMA 1 and IRQ 7.',
    src: String.raw`; Sound Blaster 2.0 at 220h. Find the YM3812 (OPL2) FM chip and the
; DSP, play notes on the FM chip, then play a sound from memory by DMA.
        org 0x100

start:  sti
        mov si, msg_title
        call puts
; --- the AdLib test of the games: a timer of the OPL2 sets its status bits
        mov ax, 0x6004        ; register 4: stop both timers
        call opl
        mov ax, 0x8004        ; register 4: clear the IRQ flag
        call opl
        call oplst
        mov bl, al            ; the status is 00h now
        mov ax, 0xFF02        ; register 2: timer 1 = FFh (80 us)
        call opl
        mov ax, 0x2104        ; register 4: start timer 1
        call opl
        mov cx, 200           ; wait more than 80 us
t1:     call oplst
        loop t1
        mov bh, al            ; the status is C0h now (IRQ + timer 1)
        mov ax, 0x6004
        call opl
        mov ax, 0x8004
        call opl
        and bx, 0xE0E0
        mov si, msg_noopl
        cmp bx, 0xC000
        jne s1
        mov si, msg_opl
s1:     call puts
; --- the DSP: reset, then read its version
        mov dx, 0x226
        mov al, 1
        out dx, al
        mov cx, 10
r1:     in al, dx             ; wait about 3 us
        loop r1
        xor al, al
        out dx, al
        mov cx, 1000
r2:     mov dx, 0x22E
        in al, dx
        test al, 0x80         ; a byte is ready?
        jnz r3
        loop r2
        jmp nodsp
r3:     mov dx, 0x22A
        in al, dx
        cmp al, 0xAA          ; the DSP answers AAh after a reset
        jne nodsp
        mov al, 0xE1          ; command E1h: the version
        call dspw
        call dspr
        mov [ver], al
        call dspr
        mov [ver+1], al
        mov si, msg_dsp
        call puts
        mov al, [ver]
        add al, '0'
        call putc
        mov al, '.'
        call putc
        mov al, [ver+1]
        aam                   ; AH = tens, AL = ones
        add ax, 0x3030
        push ax
        mov al, ah
        call putc
        pop ax
        call putc
        mov si, msg_nl
        call puts
; --- FM: one instrument on channels 0, 1 and 2
        xor bl, bl
fm1:    mov si, voice
fm2:    lodsb                 ; register of channel 0 (0 = end)
        or al, al
        jz fm3
        add al, bl            ; the same register of channel BL
        mov ah, [si]
        inc si
        call opl
        jmp fm2
fm3:    inc bl
        cmp bl, 3
        jb fm1
; --- an arpeggio C4, E4, G4, then the chord
        mov si, msg_fm
        call puts
        mov ax, 0x59A0        ; channel 0: F-number low byte of C4
        call opl
        mov ax, 0x31B0        ; key on, block 4, F-number high bits
        call opl
        mov al, 5
        call delay
        mov ax, 0xB3A1        ; channel 1: E4
        call opl
        mov ax, 0x31B1
        call opl
        mov al, 5
        call delay
        mov ax, 0x05A2        ; channel 2: G4
        call opl
        mov ax, 0x32B2
        call opl
        mov al, 12
        call delay
        mov ax, 0x11B0        ; key off: the notes go to their release
        call opl
        mov ax, 0x11B1
        call opl
        mov ax, 0x12B2
        call opl
        mov al, 4
        call delay
; --- a buffer of 4000 samples: a 690 Hz square wave (16 samples each period)
        mov di, buf
        mov cx, 4000
        xor bx, bx
sq:     mov al, 0x50
        test bl, 8
        jz sq1
        mov al, 0xB0
sq1:    stosb
        inc bx
        loop sq
; --- IRQ 7 (INT 0Fh) goes to our handler
        cli
        xor ax, ax
        mov es, ax
        mov word [es:0x0F*4], irq7
        mov [es:0x0F*4+2], cs
        push cs
        pop es
        in al, 0x21
        and al, 0x7F          ; unmask IRQ 7 in the 8259A
        out 0x21, al
        sti
; --- the 8237 channel 1: mode 49h = single, memory to the device
        mov al, 5             ; mask channel 1
        out 0x0A, al
        out 0x0C, al          ; clear the byte flip-flop
        mov al, 0x49
        out 0x0B, al
        mov ax, cs            ; physical address = CS * 16 + buf
        mov dx, ax
        mov cl, 4
        shl ax, cl
        mov cl, 12
        shr dx, cl
        add ax, buf
        adc dl, 0
        out 0x02, al          ; address, low and high byte
        mov al, ah
        out 0x02, al
        mov al, dl
        out 0x83, al          ; page register of channel 1
        mov ax, 3999          ; count - 1
        out 0x03, al
        mov al, ah
        out 0x03, al
        mov al, 1             ; unmask channel 1
        out 0x0A, al
; --- the DSP: speaker on, sample rate, 8-bit single-cycle DMA of 4000 bytes
        mov al, 0xD1
        call dspw
        mov al, 0x40          ; time constant
        call dspw
        mov al, 165           ; 1000000 / (256 - 165) = 10989 Hz
        call dspw
        mov al, 0x14
        call dspw
        mov al, 0x9F          ; length - 1 = 3999: low byte
        call dspw
        mov al, 0x0F          ; high byte
        call dspw
wt:     cmp byte [done7], 0   ; the IRQ 7 handler sets it
        je wt
        mov si, msg_dma
        call puts
        in al, 0x21
        or al, 0x80           ; mask IRQ 7 again
        out 0x21, al
        ret
nodsp:  mov si, msg_nodsp
        call puts
        ret

; the end of the DMA block: acknowledge the DSP and the 8259A
irq7:   push ax
        push dx
        mov dx, 0x22E
        in al, dx
        mov al, 0x20
        out 0x20, al
        mov byte [cs:done7], 1
        pop dx
        pop ax
        iret

; write AH to the OPL2 register AL (with the waits of the chip)
opl:    push cx
        push dx
        mov dx, 0x388
        out dx, al
        mov cx, 6
o1:     in al, dx
        loop o1
        inc dx
        mov al, ah
        out dx, al
        dec dx
        mov cx, 35
o2:     in al, dx
        loop o2
        pop dx
        pop cx
        ret
oplst:  push dx
        mov dx, 0x388
        in al, dx
        pop dx
        ret
; write AL to the DSP when it is ready (bit 7 of 22Ch = busy)
dspw:   push dx
        push ax
        mov dx, 0x22C
wrwait:    in al, dx
        test al, 0x80
        jnz wrwait
        pop ax
        out dx, al
        pop dx
        ret
; read a byte from the DSP when one is ready (bit 7 of 22Eh)
dspr:   push dx
        mov dx, 0x22E
rdwait:    in al, dx
        test al, 0x80
        jz rdwait
        mov dx, 0x22A
        in al, dx
        pop dx
        ret
; wait AL timer ticks (INT 1Ah counter)
delay:  push ax
        push bx
        push cx
        push dx
        xor ah, ah
        mov bx, ax
        int 0x1A
        add bx, dx
tickw:    xor ah, ah
        int 0x1A
        cmp dx, bx
        jb tickw
        pop dx
        pop cx
        pop bx
        pop ax
        ret
putc:   mov ah, 0x0E
        int 0x10
        ret
puts:   lodsb
        or al, al
        jz pe
        call putc
        jmp puts
pe:     ret

; the instrument: modulator and carrier of channel 0 (register, value)
voice:  db 0x20, 0x01, 0x23, 0x01   ; multiplier 1
        db 0x40, 0x12, 0x43, 0x00   ; output level
        db 0x60, 0xF2, 0x63, 0xF3   ; attack, decay
        db 0x80, 0x55, 0x83, 0x56   ; sustain, release
        db 0xC0, 0x06               ; feedback 3, FM
        db 0
msg_title: db "Sound Blaster 2.0 at 220h, IRQ 7, DMA 1", 13, 10, 0
msg_opl:   db "YM3812 (OPL2) found: timer 1 set the status bits.", 13, 10, 0
msg_noopl: db "No FM chip at 388h.", 13, 10, 0
msg_dsp:   db "DSP version ", 0
msg_nodsp: db "No DSP at 220h.", 13, 10, 0
msg_fm:    db "FM: C4, E4, G4, then the chord.", 13, 10, 0
msg_dma:   db "DMA: 4000 samples at 10989 Hz. IRQ 7 came at the end.", 13, 10, 0
msg_nl:    db 13, 10, 0
ver:    db 0, 0
done7:  db 0
buf:
` },
  {
    id: 'pi', name: '8087: pi', desc: 'FLDPI, FMUL and FBSTP: the coprocessor makes 18 BCD digits.',
    src: String.raw`; Print pi to 17 decimals with the 8087
        org 0x100

start:  finit
        fldpi               ; ST0 = pi, 64-bit mantissa
        fild dword [e8]     ; ST0 = 1e8, ST1 = pi
        fmul st1, st0       ; ST1 = pi * 1e8
        fmulp st1, st0      ; ST0 = pi * 1e16
        fimul word [ten]    ; ST0 = pi * 1e17
        fbstp [bcd]         ; 18 packed BCD digits, rounded
        fwait
        mov bx, bcd + 8     ; most significant byte first
        mov cx, 9
        xor dx, dx          ; DL = digits printed
digits: mov al, [bx]
        push cx
        mov cl, 4
        shr al, cl          ; high nibble
        pop cx
        call put
        mov al, [bx]
        and al, 0x0F        ; low nibble
        call put
        dec bx
        loop digits
        ret

put:    add al, '0'
        mov ah, 0x0E
        int 0x10
        inc dl
        cmp dl, 1
        jne .r
        mov al, '.'
        int 0x10
.r:     ret

e8:     dd 100000000
ten:    dw 10
bcd:    times 10 db 0
` },
  {
    id: 'quad', name: '8087: quadratic', desc: 'FSQRT, FDIV and FIST solve x^2 - 3x - 10 = 0 on the 8087.',
    src: String.raw`; Roots of a*x^2 + b*x + c = 0 with a=1, b=-3, c=-10 (roots 5 and -2)
        org 0x100

start:  finit
        ; disc = b*b - 4*a*c
        fld dword [b]
        fmul st0, st0       ; b^2
        fld dword [a]
        fmul dword [c]
        fmul dword [four]   ; 4ac
        fsubp st1, st0      ; ST0 = disc
        fsqrt               ; ST0 = sqrt(disc)
        ; x1 = (-b + s) / 2a
        fld dword [b]
        fchs                ; -b
        fadd st0, st1       ; -b + s
        fld dword [a]
        fadd st0, st0       ; 2a
        fdivp st1, st0
        fistp word [x1]
        ; x2 = (-b - s) / 2a
        fld dword [b]
        fchs
        fsub st0, st1
        fld dword [a]
        fadd st0, st0
        fdivp st1, st0
        fistp word [x2]
        fstp st0            ; drop s
        fwait
        mov si, t1
        call puts
        mov ax, [x1]
        call print_int
        mov si, t2
        call puts
        mov ax, [x2]
        call print_int
        ret

puts:   lodsb
        or al, al
        jz .e
        mov ah, 0x0E
        int 0x10
        jmp puts
.e:     ret

print_int:
        or ax, ax
        jns .pos
        push ax
        mov al, '-'
        mov ah, 0x0E
        int 0x10
        pop ax
        neg ax
.pos:   add al, '0'         ; one digit is enough here
        mov ah, 0x0E
        int 0x10
        ret

a:      dd 1.0
b:      dd -3.0
c:      dd -10.0
four:   dd 4.0
x1:     dw 0
x2:     dw 0
t1:     db "x1 = ", 0
t2:     db 13, 10, "x2 = ", 0
` },
];

// The BIOS for the 80286 (AT-class) machine: the 8086 BIOS with the AT parts changed
// (two 8259A, NMI mask on port 70h, CMOS clock, shutdown byte, INT 15h extended memory,
// model byte FCh). Each change replaces an exact block, so the 8086 BIOS stays as it is.
// The BIOS for the 80386 machine is the AT BIOS with the 80386 parts (see bios386 below).
// The BIOS for the 80486 machine is the 80386 BIOS with the 80486 parts (see bios486).
// The BIOS for the Pentium machine is the 80486 BIOS with the Pentium parts (see bios586).
// The BIOS for the Pentium Pro machine is the Pentium BIOS with the P6 parts (see bios686).
function biosSource(model) {
  if (model !== '80286' && model !== '80386' && model !== '80486' && model !== '80586' && model !== '80686') return BIOS_SOURCE;
  let s = BIOS_SOURCE;
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error('BIOS 286: block not found: ' + a.slice(0, 60));
    s = s.replace(a, () => b);
  };
  rep(';  8086 ANATOMY  -  MINI BIOS  v2.0', ';  80286 ANATOMY  -  MINI BIOS  v2.0 (AT)');
  // a CPU reset without a power cycle: resume at 0040:0067 when the CMOS shutdown byte says so
  rep(String.raw`start:  cli
        cld
        xor ax, ax`, String.raw`start:  cli
        cld
        mov al, 0x8F          ; CMOS shutdown byte (NMI stays masked)
        out 0x70, al
        in al, 0x71
        mov ah, al
        mov al, 0x8F
        out 0x70, al
        xor al, al
        out 0x71, al          ; clear it
        cmp ah, 0x05
        je .resume_eoi
        cmp ah, 0x0A
        je .resume
        jmp .cold
.resume_eoi:
        mov al, 0x20          ; code 05h: end the interrupt, then resume
        out 0x20, al
.resume:
        mov ax, BDA           ; codes 05h and 0Ah: jump to the address at 0040:0067
        mov ds, ax
        jmp far [0x67]
.cold:  mov al, 0xD1          ; 8042 output port: A20 off (real-mode programs expect the 1 MB wrap)
        out 0x64, al
        mov al, 0xDD
        out 0x60, al
        xor ax, ax`);
  rep(String.raw`        ; --- 8259A PIC: edge triggered, single, ICW4; base vector 08h
        mov al, 0x13
        out 0x20, al
        mov al, 0x08
        out 0x21, al
        mov al, 0x01
        out 0x21, al
        mov al, 0xBC          ; enable IRQ0 timer, IRQ1 keyboard, IRQ6 floppy
        out 0x21, al`, String.raw`        ; --- two 8259A: master at 20h (INT 08h-0Fh), slave at A0h (INT 70h-77h) on IRQ2
        mov al, 0x11          ; ICW1: edge triggered, cascade, ICW4
        out 0x20, al
        mov al, 0x08
        out 0x21, al
        mov al, 0x04          ; ICW3: a slave on IRQ2
        out 0x21, al
        mov al, 0x01
        out 0x21, al
        mov al, 0x11
        out 0xA0, al
        mov al, 0x70
        out 0xA1, al
        mov al, 0x02          ; ICW3: slave identity 2
        out 0xA1, al
        mov al, 0x01
        out 0xA1, al
        mov al, 0xB8          ; master: IRQ0 timer, IRQ1 keyboard, IRQ2 cascade, IRQ6
        out 0x21, al
        mov al, 0xDF          ; slave: IRQ13 (80287 error)
        out 0xA1, al`);
  rep(String.raw`.nofpu: mov al, 0x80          ; allow NMI (the 8087 INT line)
        out 0xA0, al`, String.raw`.nofpu: mov al, 0x0D          ; allow NMI: port 70h bit 7 = 0
        out 0x70, al`);
  rep(`msg_banner: db 0x1E, " 8086 ANATOMY BIOS v2.0 ", 0`, `msg_banner: db 0x1E, " 80286 ANATOMY BIOS v2.0 (AT) ", 0`);
  rep(`"CPU   Intel 8086 @ 4.77 MHz, maximum mode (8288)"`, `"CPU   Intel 80286 @ 8 MHz, 1 wait state, protected mode"`);
  rep(`msg_ram:    db "RAM   640 KB   ROM 64 KB   ", 0
msg_ram2:   db "   2 floppy drives", 13, 10, 0`,
    `msg_ram:    db "RAM   640 KB + 1024 KB extended   CMOS clock   ", 0
msg_ram2:   db 13, 10, 0`);
  rep(`msg_fpu_yes: db "FPU   Intel 8087 present", 13, 10, 0`, `msg_fpu_yes: db "FPU   Intel 80287 present (IRQ13)", 13, 10, 0`);
  // INT 15h: extended memory size and block move
  rep(String.raw`int15:  mov ah, 0x86
        stc
        retf 2`, String.raw`int15:  sti
        cmp ah, 0x88
        je .ext
        cmp ah, 0x87
        je .move
        cmp ah, 0x90
        je .ok
        cmp ah, 0x91
        je .ok
        mov ah, 0x86          ; not supported
        stc
        retf 2
.ext:   mov ax, 1024          ; KB of extended memory above 1 MB
        clc
        retf 2
.move:  out 0xE4, al          ; block move of CX words (GDT at ES:SI), done by the helper
        retf 2
.ok:    xor ah, ah
        clc
        retf 2`);
  // INT 1Ah: the MC146818 clock (AH 02h-05h)
  rep(String.raw`.rtc:   pop bx                ; no real-time clock chip (AT only)
        pop ds
        stc
        retf 2`, String.raw`.rtc:   cmp ah, 2
        je .rt
        cmp ah, 3
        je .wt
        cmp ah, 4
        je .rd
        cmp ah, 5
        je .wd
        pop bx
        pop ds
        stc
        retf 2
.rt:    mov al, 4             ; read time: CH hours, CL minutes, DH seconds (BCD)
        call cmos_rd
        mov ch, al
        mov al, 2
        call cmos_rd
        mov cl, al
        xor al, al
        call cmos_rd
        mov dh, al
        xor dl, dl
        jmp .okx
.wt:    mov al, 4             ; set time
        mov ah, ch
        call cmos_wr
        mov al, 2
        mov ah, cl
        call cmos_wr
        xor al, al
        mov ah, dh
        call cmos_wr
        jmp .okx
.rd:    mov al, 0x32          ; read date: CH century, CL year, DH month, DL day
        call cmos_rd
        mov ch, al
        mov al, 9
        call cmos_rd
        mov cl, al
        mov al, 8
        call cmos_rd
        mov dh, al
        mov al, 7
        call cmos_rd
        mov dl, al
        jmp .okx
.wd:    mov al, 9             ; set date
        mov ah, cl
        call cmos_wr
        mov al, 8
        mov ah, dh
        call cmos_wr
        mov al, 7
        mov ah, dl
        call cmos_wr
.okx:   pop bx
        pop ds
        sti
        clc
        retf 2

; read CMOS register AL into AL / write AH to CMOS register AL
cmos_rd: out 0x70, al
        in al, 0x71
        ret
cmos_wr: out 0x70, al
        mov al, ah
        out 0x71, al
        ret

; INT 06h: invalid opcode (80286). The 80286 returns to the bad instruction, so a
; plain IRET would repeat the fault for ever. Show where it is and stop the machine.
int06:  push bp
        mov bp, sp
        push cs
        pop ds
        mov si, msg_ud
        call puts
        mov ax, [ss:bp+4]     ; CS of the bad instruction
        call hex4
        mov al, ':'
        call putc
        mov ax, [ss:bp+2]     ; IP
        call hex4
        mov si, msg_ud2
        call puts
        les bx, [ss:bp+2]     ; ES:BX = CS:IP
        mov cx, 4
.b:     mov al, [es:bx]
        call hex2
        mov al, ' '
        call putc
        inc bx
        loop .b
        mov si, msg_ud3
        call puts
        cli
.h:     hlt
        jmp .h
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret
hex4:   push ax
        mov al, ah
        call hex2
        pop ax
hex2:   push ax
        push cx
        mov cl, 4
        shr al, cl
        call hexd
        pop cx
        pop ax
        push ax
        and al, 0x0F
        call hexd
        pop ax
        ret
hexd:   add al, '0'
        cmp al, '9'
        jbe .o
        add al, 7
.o:     jmp putc
msg_ud:  db 13, 10, "Invalid opcode (INT 6) at ", 0
msg_ud2: db "  bytes: ", 0
msg_ud3: db 13, 10, "This code needs a newer CPU than the 80286 (a 386 or later).", 13, 10
         db "The machine stops here. Reset, or change the disk in the Disks tab.", 13, 10, 0

; interrupts of the slave 8259A: end the interrupt on both controllers
int_slave:
        push ax
        mov al, 0x20
        out 0xA0, al
        out 0x20, al
        pop ax
        iret

; IRQ13: the 80287 reports an error. Clear its BUSY latch, end the interrupt,
; then report it as an NMI, as the AT BIOS does.
int75:  push ax
        xor al, al
        out 0xF0, al
        mov al, 0x20
        out 0xA0, al
        out 0x20, al
        pop ax
        int 0x02
        iret`);
  rep(String.raw`        dw 0x21, int21
        dw 0xFFFF`, String.raw`        dw 0x21, int21
        dw 0x06, int06
        dw 0x70, int_slave
        dw 0x71, int_slave
        dw 0x72, int_slave
        dw 0x73, int_slave
        dw 0x74, int_slave
        dw 0x75, int75
        dw 0x76, int_slave
        dw 0x77, int_slave
        dw 0xFFFF`);
  // INT 13h: drive types from the CMOS, the data rate register, the change line
  rep(String.raw`; ---- the parts that the AT BIOS replaces: drive types, data rate, change line
fd_parms:
        mov bl, 4             ; the drive type: a 1.44 MB 3.5" drive
        jmp fd_ptab
fd_type:
        mov ax, 0x0100        ; a diskette drive without a change line
        clc
        retf 2
; the PC/XT drive has no change line, and the controller has one data rate
fd_change:
fd_setmedia:
        xor ah, ah
        ret
fd_rate:
fd_next_rate:
fd_media_ok:
fd_chgline:
        ret
; ---- the end of the AT block`, String.raw`; ---- the AT parts: drive types from the CMOS, the data rate (3F7h), the change line
; AH=08h: BL = the drive type from CMOS register 10h (A: bits 4-7, B: bits 0-3)
fd_parms:
        push ax
        mov al, 0x10
        out 0x70, al
        in al, 0x71
        test dl, 1
        jnz .b
        mov cl, 4
        shr al, cl
.b:     and al, 0x0F
        mov bl, al
        pop ax
        or bl, bl
        jnz .t
        mov bl, 4             ; no type: report a 1.44 MB drive
.t:     jmp fd_ptab
fd_type:
        mov ax, 0x0200        ; a diskette drive with a change line
        cmp dl, 1
        jbe .t
        xor ax, ax            ; no drive
.t:     clc
        retf 2
; AH=16h: the change line (DIR bit 7). AH = 00h no change, 06h changed, 80h no disk
fd_change:
        call fd_select
        mov dx, 0x3F7
        in al, dx
        test al, 0x80
        mov ah, 0x00
        jz .r
        call fd_forget
        call fd_clrchg
        mov dx, 0x3F7
        in al, dx
        test al, 0x80
        mov ah, 0x06          ; the disk changed
        jz .r
        mov ah, 0x80          ; the line stays on: no disk
.r:     push ax
        mov al, 2
        call fd_parm
        mov [MOTOR_CNT], al
        pop ax
        ret
; AH=17h (AL = disk type) and AH=18h (CL = sectors a track): set the data rate.
; MEDIA_ST bits 7-6 = the DCR value (00 500, 01 300, 10 250 kbit/s, 11 1 Mbit/s),
; bit 4 = the media is known.
fd_setmedia:
        mov ax, si
        call fd_mst
        cmp ah, 0x18
        je .m18
        mov ah, 0x90          ; 1: 360 KB, 4: 720 KB -> 250 kbit/s
        cmp al, 2
        jne .a3
        mov ah, 0x50          ; 2: 360 KB in a 1.2 MB drive -> 300 kbit/s
.a3:    cmp al, 3
        jne .set
        mov ah, 0x10          ; 3: 1.2 MB -> 500 kbit/s
        jmp .set
.m18:   mov al, [bp+12]
        and al, 0x3F
        mov ah, 0x90          ; 9 sectors -> 250 kbit/s
        mov di, diskette_table
        cmp al, 9
        jbe .s18
        mov ah, 0x10          ; 15 or 18 sectors -> 500 kbit/s
        cmp al, 18
        jbe .s18
        mov ah, 0xD0          ; 36 sectors -> 1 Mbit/s
        mov di, diskette_table_288
.s18:   mov [bp+6], di        ; ES:DI = the parameter table
        mov [bp+0], cs
.set:   mov [bx], ah
        xor ah, ah
        ret
; the data rate of the media in the drive to the DCR
fd_rate:
        call fd_mst
        mov al, [bx]
        mov cl, 6
        shr al, cl
        mov dx, 0x3F7
        out dx, al
        ret
; after an error, while the media is not known: the next data rate (500 -> 250 -> 1000)
fd_next_rate:
        call fd_mst
        mov al, [bx]
        test al, 0x10
        jnz .r
        and al, 0xC0
        cmp al, 0x80
        mov al, 0x80          ; 500 -> 250 kbit/s
        jb .s
        mov al, 0xC0          ; 250 -> 1 Mbit/s
        je .s
        xor al, al            ; 1 M -> 500 kbit/s
.s:     mov [bx], al
.r:     ret
; the operation worked: the media is known now
fd_media_ok:
        call fd_mst
        or byte [bx], 0x10
        ret
; a changed disk: forget its media type, clear the line with a step pulse
fd_chgline:
        mov dx, 0x3F7
        in al, dx
        test al, 0x80
        jz .r
        call fd_forget
        call fd_clrchg
.r:     ret
fd_forget:
        call fd_mst
        and byte [bx], 0xEF
        ret
; BX = the offset of the media state of the drive
fd_mst: mov bx, [bp+10]
        and bx, 0x0001
        add bx, MEDIA_ST
        ret
; a step pulse clears the change line: SEEK to cylinder 1, then RECALIBRATE
fd_clrchg:
        and byte [SEEK_ST], 0x7F
        mov al, 0x0F
        call fd_out
        call fd_hdus
        and al, 0x03
        call fd_out
        mov al, 1
        call fd_out
        call fd_wait
        call fd_sense
        call fd_bit
        not al
        and [SEEK_ST], al     ; the drive needs a recalibrate
        call fd_recal
        jc .r
        call fd_bit
        or [SEEK_ST], al
.r:     ret
; ---- the end of the AT block`);
  rep(`        db 0xFF, 0xFE, 0xFF   ; model byte FEh (PC/XT class) at F000:FFFE`,
    `        db 0xFF, 0xFC, 0xFF   ; model byte FCh (AT class) at F000:FFFE`);
  return model === '80686' ? bios686(bios586(bios486(bios386(s)))) : model === '80586' ? bios586(bios486(bios386(s))) : model === '80486' ? bios486(bios386(s)) : model === '80386' ? bios386(s) : s;
}

// The 80386 parts of the AT BIOS: a CPU test (FLAGS bits 12-14) that the start-up screen
// shows, the 80387 test (CR0.ET, then FNINIT / FNSTSW), CR0.MP, the extended memory size
// from the CMOS (INT 15h AH=88h and the start-up screen). The model byte stays FCh.
function bios386(src) {
  let s = src;
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error('BIOS 386: block not found: ' + a.slice(0, 60));
    s = s.replace(a, () => b);
  };
  rep(';  80286 ANATOMY  -  MINI BIOS  v2.0 (AT)', ';  80386 ANATOMY  -  MINI BIOS  v2.0 (AT, 80386 + 80387)');
  // the 80387: the 80386 sets CR0.ET at reset when the coprocessor answers
  rep(String.raw`.novid:
        ; --- 8087: reset it and read back the status word
        fninit`, String.raw`.novid:
        ; --- 80387: at reset the 80386 sets CR0.ET (bit 4) when a coprocessor answers
        cpu 386
        mov eax, cr0
        test al, 0x10
        jz .nofpu
        or al, 0x02           ; CR0.MP = 1: WAIT looks at CR0.TS (a coprocessor is present)
        mov cr0, eax
        cpu 8086
        ; --- then reset it and read back the status word
        fninit`);
  // the start-up screen: the CPU that the test found, the extended memory from the CMOS
  rep(String.raw`        mov si, msg_cpu
        call puts
        mov si, msg_ram
        call puts`, String.raw`        mov si, msg_cpu
        call puts
        call cpu_test         ; SI = the name of the CPU that the test found
        call puts
        mov si, msg_cpu2
        call puts
        mov si, msg_ram
        call puts
        call ext_kb           ; AX = KB of extended memory
        call putdec
        mov si, msg_ram3
        call puts`);
  rep(`msg_banner: db 0x1E, " 80286 ANATOMY BIOS v2.0 (AT) ", 0`, `msg_banner: db 0x1E, " 80386 ANATOMY BIOS v2.0 (AT) ", 0`);
  rep(`msg_cpu:    db 13, 10, 13, 10, "CPU   Intel 80286 @ 8 MHz, 1 wait state, protected mode", 13, 10, 0`,
    `msg_cpu:    db 13, 10, 13, 10, "CPU   Intel ", 0
msg_cpu2:   db " @ 25 MHz, 1 wait state, 32-bit, paging", 13, 10, 0
msg_8086:   db "8086", 0
msg_80286:  db "80286", 0
msg_80386:  db "80386", 0`);
  rep(`msg_ram:    db "RAM   640 KB + 1024 KB extended   CMOS clock   ", 0`,
    `msg_ram:    db "RAM   640 KB + ", 0
msg_ram3:   db " KB extended   CMOS clock   ", 0`);
  rep(`msg_fpu_yes: db "FPU   Intel 80287 present (IRQ13)", 13, 10, 0`, `msg_fpu_yes: db "FPU   Intel 80387 present (IRQ13)", 13, 10, 0`);
  // INT 15h AH=88h: the extended memory from the CMOS (the machine writes its RAM size there)
  rep(String.raw`.ext:   mov ax, 1024          ; KB of extended memory above 1 MB
        clc
        retf 2`, String.raw`.ext:   call ext_kb           ; AX = KB of extended memory above 1 MB
        clc
        retf 2`);
  rep(`msg_ud3: db 13, 10, "This code needs a newer CPU than the 80286 (a 386 or later).", 13, 10`,
    `msg_ud3: db 13, 10, "This code needs a newer CPU than the 80386 (a 486 or later).", 13, 10`);
  rep(`; interrupts of the slave 8259A: end the interrupt on both controllers`, String.raw`; The CPU test: the FLAGS bits 12-15. The 8086 and the 80186 always set the bits
; 12-15. In real mode the 80286 always clears the bits 12-14. The 80386 can set them
; (they are IOPL and NT). Out: SI = the name of the CPU. AX changes.
cpu_test:
        pushf                 ; keep the flags
        xor ax, ax            ; try to clear the bits 12-15
        push ax
        popf
        pushf
        pop ax
        and ax, 0xF000
        cmp ax, 0xF000
        mov si, msg_8086
        je .done              ; the bits stay 1: an 8086 or an 80186
        mov ax, 0x7000        ; try to set the bits 12-14
        push ax
        popf
        pushf
        pop ax
        test ax, 0x7000
        mov si, msg_80286
        jz .done              ; the bits stay 0: an 80286
        mov si, msg_80386     ; the bits changed: an 80386
.done:  popf                  ; the flags again
        ret

; AX = the KB of extended memory: CMOS 30h (low byte) and 31h (high byte)
ext_kb: mov al, 0x31
        call cmos_rd
        mov ah, al
        mov al, 0x30
        call cmos_rd
        ret

; print AX in decimal
putdec: push ax
        push bx
        push cx
        push dx
        mov bx, 10
        xor cx, cx
.d:     xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        loop .o
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; interrupts of the slave 8259A: end the interrupt on both controllers`);
  return s;
}

// The 80486 parts of the 80386 BIOS: the CPU test also looks at the AC flag, the ID flag and
// CPUID (family 4); the start-up screen shows the CPUID values. The cache: after a reset
// CR0.CD = 1 and NW = 1 (the cache is off); the POST, and the resume after a CPU reset, clear
// both bits unless the CMOS setup byte 2Dh has bit 0 = 1 ("cache off"). The FPU is on the
// chip: CR0.MP = 1, CR0.NE = 0 (FPU errors go to IRQ 13, as on the AT: DOS programs expect it).
function bios486(src) {
  let s = src;
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error('BIOS 486: block not found: ' + a.slice(0, 60));
    s = s.replace(a, () => b);
  };
  rep(';  80386 ANATOMY  -  MINI BIOS  v2.0 (AT, 80386 + 80387)', ';  80486 ANATOMY  -  MINI BIOS  v2.0 (AT, 80486DX: FPU and 8 KB cache on the chip)');
  rep(`ENTRY_OK    equ 0xF4`, `ENTRY_OK    equ 0xF4
CPU_KIND    equ 0xEE          ; the CPU test: 3 = 80386, 4 = 80486 (no CPUID), 5 = CPUID
CMOS_SETUP  equ 0x2D          ; CMOS setup byte: bit 0 = 1: the internal cache is off`);
  // a CPU reset (the 8042, port 92h, a triple fault) turns the cache off: turn it on again
  // before the jump to 0040:0067 (no CALL here: the stack is not known)
  rep(String.raw`.resume:
        mov ax, BDA           ; codes 05h and 0Ah: jump to the address at 0040:0067`, String.raw`.resume:
        mov al, 0x80 | CMOS_SETUP
        out 0x70, al
        in al, 0x71
        test al, 0x01
        jnz .rgo              ; the setup says "cache off"
        cpu 486
        mov eax, cr0
        and eax, 0x9FFFFFFF   ; CR0.CD = 0, CR0.NW = 0: the cache is on again
        mov cr0, eax
        cpu 8086
.rgo:   mov ax, BDA           ; codes 05h and 0Ah: jump to the address at 0040:0067`);
  // the POST: the cache, then the FPU on the chip
  rep(String.raw`        ; --- 80387: at reset the 80386 sets CR0.ET (bit 4) when a coprocessor answers
        cpu 386
        mov eax, cr0
        test al, 0x10
        jz .nofpu
        or al, 0x02           ; CR0.MP = 1: WAIT looks at CR0.TS (a coprocessor is present)
        mov cr0, eax`, String.raw`        ; --- the 80486 cache: on, unless the CMOS setup byte says "off"
        call cache_init
        ; --- the FPU on the 80486 chip (CR0.ET is always 1)
        cpu 486
        mov eax, cr0
        test al, 0x10
        jz .nofpu
        or al, 0x02           ; CR0.MP = 1: WAIT looks at CR0.TS (an FPU is present)
        and al, 0xDF          ; CR0.NE = 0: FPU errors go to IRQ 13, as on the AT
        mov cr0, eax`);
  // the start-up screen: the rest of the CPU line from CPUID, and the cache line
  rep(String.raw`        mov si, msg_cpu2
        call puts
        mov si, msg_ram`, String.raw`        mov si, msg_cpu2
        call puts
        call cpu_more         ; the cache, the FPU and a line with the CPUID values
        mov si, msg_ram`);
  rep(String.raw`.pf:    call puts
        call hd_init`, String.raw`.pf:    call puts
        call cache_line
        call hd_init`);
  rep(`msg_banner: db 0x1E, " 80386 ANATOMY BIOS v2.0 (AT) ", 0`, `msg_banner: db 0x1E, " 80486 ANATOMY BIOS v2.0 (AT) ", 0`);
  rep(`msg_cpu2:   db " @ 25 MHz, 1 wait state, 32-bit, paging", 13, 10, 0`, `msg_cpu2:   db " @ 33 MHz", 0
msg_c8k:    db ", 8 KB cache", 0
msg_cfpu:   db ", FPU on chip", 0
msg_crlf:   db 13, 10, 0
msg_cpuid:  db "      CPUID ", 0
msg_fam:    db ", family ", 0
msg_mod:    db ", model ", 0
msg_step:   db ", stepping ", 0
msg_cache:  db "Cache: 8 KB on chip, ", 0
msg_on:     db "on", 13, 10, 0
msg_off:    db "off", 13, 10, 0`);
  rep(`msg_80386:  db "80386", 0`, `msg_80386:  db "80386", 0
msg_80486:  db "80486", 0
msg_80486dx: db "80486DX", 0
msg_80486sx: db "80486SX", 0
msg_newcpu: db "CPU with CPUID", 0`);
  rep(`msg_fpu_yes: db "FPU   Intel 80387 present (IRQ13)", 13, 10, 0`, `msg_fpu_yes: db "FPU   on the 80486 chip", 13, 10, 0`);
  rep(`msg_ud3: db 13, 10, "This code needs a newer CPU than the 80386 (a 486 or later).", 13, 10`,
    `msg_ud3: db 13, 10, "This code needs a newer CPU than the 80486 (a Pentium or later).", 13, 10`);
  // the CPU test: after the FLAGS bits 12-14, the AC flag, the ID flag and CPUID
  rep(String.raw`        mov si, msg_80386     ; the bits changed: an 80386
.done:  popf                  ; the flags again
        ret`, String.raw`        mov si, msg_80386     ; the bits changed: an 80386 or a newer CPU
        call cpu_test486
.done:  popf                  ; the flags again
        ret

; The 80486 test. The 80486 can change EFLAGS.AC (bit 18), the 80386 cannot. A CPU with
; CPUID can change EFLAGS.ID (bit 21). CPUID leaf 1: EAX bits 8-11 = the family (4),
; EDX bit 0 = the FPU is on the chip (80486DX; the 80486SX has no FPU).
; In: SI = msg_80386. Out: SI = the name, [CPU_KIND] = 3, 4 or 5. EAX-EDX change.
cpu_test486:
        cpu 486
        push ds
        mov ax, BDA
        mov ds, ax
        mov byte [CPU_KIND], 3
        pushfd
        pop eax
        mov ecx, eax          ; ECX = EFLAGS now
        xor eax, 0x40000      ; change the AC bit
        push eax
        popfd
        pushfd
        pop eax
        push ecx
        popfd                 ; EFLAGS as before
        xor eax, ecx
        test eax, 0x40000
        jz .end               ; AC did not change: an 80386
        mov byte [CPU_KIND], 4
        mov si, msg_80486
        mov eax, ecx
        xor eax, 0x200000     ; change the ID bit
        push eax
        popfd
        pushfd
        pop eax
        push ecx
        popfd
        xor eax, ecx
        test eax, 0x200000
        jz .end               ; ID did not change: an 80486 with no CPUID
        mov byte [CPU_KIND], 5
        mov eax, 1
        cpuid                 ; EAX = family, model, stepping; EDX = the features
        mov si, msg_newcpu
        and ah, 0x0F
        cmp ah, 4
        jne .end              ; not family 4
        mov si, msg_80486sx
        test dl, 0x01
        jz .end               ; no FPU on the chip
        mov si, msg_80486dx
.end:   pop ds
        cpu 8086
        ret

; The rest of the CPU line: ", 8 KB cache" (an 80486), ", FPU on chip" (CPUID EDX bit 0),
; then a line with the CPUID values: the vendor string, the family, the model, the stepping.
cpu_more:
        cpu 486
        push ds
        mov ax, BDA
        mov ds, ax
        mov al, [CPU_KIND]
        pop ds
        cmp al, 4
        jb .nl                ; an 80386: no cache on the chip
        mov si, msg_c8k
        call puts
        cmp al, 5
        jb .nl                ; no CPUID
        mov eax, 1
        cpuid
        test dl, 0x01
        jz .nofpu
        mov si, msg_cfpu
        call puts
.nofpu: mov si, msg_crlf
        call puts
        mov si, msg_cpuid
        call puts
        xor eax, eax
        cpuid                 ; EBX, EDX, ECX = the vendor string (12 characters)
        mov eax, ebx
        call put4c
        mov eax, edx
        call put4c
        mov eax, ecx
        call put4c
        mov eax, 1
        cpuid
        mov bx, ax            ; BX = the signature (0415h: family 4, model 1, stepping 5)
        mov si, msg_fam
        call puts
        mov al, bh
        and ax, 0x000F
        call putdec
        mov si, msg_mod
        call puts
        mov al, bl
        shr al, 4
        xor ah, ah
        call putdec
        mov si, msg_step
        call puts
        mov al, bl
        and ax, 0x000F
        call putdec
.nl:    mov si, msg_crlf
        call puts
        cpu 8086
        ret

; print the 4 characters in EAX (the low byte first)
put4c:  cpu 486
        push cx
        mov cx, 4
.c:     call putc
        shr eax, 8
        loop .c
        pop cx
        cpu 8086
        ret

; The cache after a reset: CR0.CD = 1 and NW = 1 (off). On an 80486 the BIOS empties the
; cache (INVD) and clears CD and NW (the cache is on, write-through), unless the CMOS setup
; byte 2Dh has bit 0 = 1.
cache_init:
        push ax
        push si
        call cpu_test         ; [CPU_KIND] = 4 or 5 on an 80486
        pop si
        push ds
        mov ax, BDA
        mov ds, ax
        mov al, [CPU_KIND]
        pop ds
        cmp al, 4
        jb .end               ; not an 80486
        mov al, 0x80 | CMOS_SETUP   ; bit 7: NMI stays off
        call cmos_rd
        test al, 0x01
        jnz .end              ; the setup says "cache off": CD stays 1
        cpu 486
        invd                  ; the cache is empty
        mov eax, cr0
        and eax, 0x9FFFFFFF   ; CR0.CD = 0, CR0.NW = 0
        mov cr0, eax
        cpu 8086
.end:   pop ax
        ret

; The cache line of the start-up screen (an 80486 only): CR0.CD = 0 "on", CD = 1 "off".
cache_line:
        push ax
        push ds
        mov ax, BDA
        mov ds, ax
        mov al, [CPU_KIND]
        pop ds
        cmp al, 4
        jb .end
        mov si, msg_cache
        call puts
        cpu 486
        mov eax, cr0
        mov si, msg_on
        test eax, 0x40000000
        jz .p
        mov si, msg_off
.p:     cpu 8086
        call puts
.end:   pop ax
        ret`);
  return s;
}

// The Pentium parts of the 80486 BIOS. The CPU test (the AC flag, the ID flag, CPUID) finds
// family 5: "Pentium"; [CPU_KIND] = 5 (CPUID) as on the 80486 BIOS. The start-up screen shows
// the two caches and the CPUID values with the feature bits (EDX of leaf 1). The caches: the
// cache_init of the 80486 BIOS works for the Pentium too (INVD, then CR0.CD = 0 and NW = 0,
// unless CMOS 2Dh bit 0 = 1; again after a CPU reset). The INT 6 message names the Pentium.
function bios586(src) {
  let s = src;
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error('BIOS 586: block not found: ' + a.slice(0, 60));
    s = s.replace(a, () => b);
  };
  rep(';  80486 ANATOMY  -  MINI BIOS  v2.0 (AT, 80486DX: FPU and 8 KB cache on the chip)',
    ';  PENTIUM ANATOMY  -  MINI BIOS  v2.0 (AT, Pentium: FPU, 8 KB code cache and 8 KB data cache on the chip)');
  rep(`msg_banner: db 0x1E, " 80486 ANATOMY BIOS v2.0 (AT) ", 0`, `msg_banner: db 0x1E, " PENTIUM ANATOMY BIOS v2.0 (AT) ", 0`);
  // the CPU test: CPUID family 5 is a Pentium
  rep(String.raw`        mov si, msg_newcpu
        and ah, 0x0F
        cmp ah, 4
        jne .end              ; not family 4`, String.raw`        mov si, msg_pentium
        and ah, 0x0F
        cmp ah, 5
        je .end               ; family 5: a Pentium
        mov si, msg_newcpu
        cmp ah, 4
        jne .end              ; not family 4`);
  // the CPU line: the feature bits (CPUID leaf 1, EDX) after the stepping, from family 5 up
  rep(String.raw`        mov si, msg_step
        call puts
        mov al, bl
        and ax, 0x000F
        call putdec
.nl:    mov si, msg_crlf`, String.raw`        mov si, msg_step
        call puts
        mov al, bl
        and ax, 0x000F
        call putdec
        and bh, 0x0F
        cmp bh, 5
        jb .nl                ; an 80486: no feature bits on the screen
        mov si, msg_feat
        call puts
        mov eax, 1
        cpuid                 ; EDX = the feature bits
        mov eax, edx
        shr eax, 16
        call hex4             ; bits 16-31
        mov ax, dx
        call hex4             ; bits 0-15
        mov al, 'h'
        call putc
.nl:    mov si, msg_crlf`);
  rep(`msg_cpu2:   db " @ 33 MHz", 0
msg_c8k:    db ", 8 KB cache", 0`, `msg_cpu2:   db " @ 66 MHz", 0
msg_c8k:    db ", 8 KB code + 8 KB data cache", 0
msg_feat:   db ", features ", 0`);
  rep(`msg_cache:  db "Cache: 8 KB on chip, ", 0`, `msg_cache:  db "Cache: 8 KB code + 8 KB data on chip, ", 0`);
  rep(`msg_newcpu: db "CPU with CPUID", 0`, `msg_newcpu: db "CPU with CPUID", 0
msg_pentium: db "Pentium", 0`);
  rep(`msg_fpu_yes: db "FPU   on the 80486 chip", 13, 10, 0`, `msg_fpu_yes: db "FPU   on the Pentium chip", 13, 10, 0`);
  rep(`msg_ud3: db 13, 10, "This code needs a newer CPU than the 80486 (a Pentium or later).", 13, 10`,
    `msg_ud3: db 13, 10, "This code needs a newer CPU than the Pentium (a Pentium Pro or later).", 13, 10`);
  // fd_wait: the fall-back count (for a stopped timer) must be more than the 2 s of the timer
  // ticks. The Pentium at 66 MHz does 40 x 65536 passes of the loop in about 0.5 s: too short
  // for the motor start and a seek with the real disk timing.
  rep(`        mov dx, 40            ; a fall-back count, for a stopped timer`,
    `        mov dx, 200           ; a fall-back count, for a stopped timer (about 2.4 s on the Pentium)`);
  // fd_ready: the same for its fall-back count (65536 passes take only about 0.2 s here, but the
  // motor needs 0.5 s to get to full speed): 8 x 65536 passes, more than the 28 timer ticks.
  rep(String.raw`fd_ready:
        mov bx, [TICKS]
        xor di, di            ; a fall-back count, for a stopped timer
.l:     mov al, 0x04`, String.raw`fd_ready:
        mov bx, [TICKS]
        push cx
        mov cx, 8             ; a fall-back count, for a stopped timer: 8 x 65536 passes
        xor di, di
.l:     mov al, 0x04`);
  rep(String.raw`        cmp ax, 28
        jae .no
        dec di
        jnz .l
.no:    mov ah, 0x80
        stc
        ret
.ok:    clc
        ret`, String.raw`        cmp ax, 28
        jae .no
        dec di
        jnz .l
        loop .l
.no:    pop cx
        mov ah, 0x80
        stc
        ret
.ok:    pop cx
        clc
        ret`);
  return s;
}

// The Pentium Pro parts of the Pentium BIOS. The CPU test finds CPUID family 6: "Pentium Pro";
// [CPU_KIND] = 5 (CPUID) as on the 80486 and Pentium BIOS. The start-up screen shows the three
// caches (L1 code, L1 data, L2) and the CPUID values with the feature bits (EDX of leaf 1). The
// caches: the cache_init of the 80486 BIOS works for the P6 too (INVD, then CR0.CD = 0 and NW = 0,
// unless CMOS 2Dh bit 0 = 1; again after a CPU reset). The INT 6 message names the Pentium Pro.
// The fall-back counts of the floppy waits get more passes: the P6 at 200 MHz runs the loops
// about 4 times faster than the Pentium at 66 MHz.
function bios686(src) {
  let s = src;
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error('BIOS 686: block not found: ' + a.slice(0, 60));
    s = s.replace(a, () => b);
  };
  rep(';  PENTIUM ANATOMY  -  MINI BIOS  v2.0 (AT, Pentium: FPU, 8 KB code cache and 8 KB data cache on the chip)',
    ';  PENTIUM PRO ANATOMY  -  MINI BIOS  v2.0 (AT, Pentium Pro: FPU, 8 KB code + 8 KB data L1 cache, 256 KB L2 cache)');
  rep(`msg_banner: db 0x1E, " PENTIUM ANATOMY BIOS v2.0 (AT) ", 0`, `msg_banner: db 0x1E, " PENTIUM PRO ANATOMY BIOS v2.0 (AT) ", 0`);
  // the CPU test: CPUID family 6 is a Pentium Pro
  rep(String.raw`        mov si, msg_pentium
        and ah, 0x0F
        cmp ah, 5
        je .end               ; family 5: a Pentium`, String.raw`        mov si, msg_ppro
        and ah, 0x0F
        cmp ah, 6
        je .end               ; family 6: a Pentium Pro
        mov si, msg_pentium
        cmp ah, 5
        je .end               ; family 5: a Pentium`);
  // the CPU line must fit in 80 columns
  rep(`msg_cpu2:   db " @ 66 MHz", 0
msg_c8k:    db ", 8 KB code + 8 KB data cache", 0`, `msg_cpu2:   db " @ 200 MHz", 0
msg_c8k:    db ", 8+8 KB L1 + 256 KB L2 cache", 0`);
  rep(`msg_cache:  db "Cache: 8 KB code + 8 KB data on chip, ", 0`, `msg_cache:  db "Cache: 8 KB code + 8 KB data (L1), 256 KB L2 in the CPU package, ", 0`);
  rep(`msg_pentium: db "Pentium", 0`, `msg_pentium: db "Pentium", 0
msg_ppro:   db "Pentium Pro", 0`);
  rep(`msg_fpu_yes: db "FPU   on the Pentium chip", 13, 10, 0`, `msg_fpu_yes: db "FPU   on the Pentium Pro chip", 13, 10, 0`);
  rep(`msg_ud3: db 13, 10, "This code needs a newer CPU than the Pentium (a Pentium Pro or later).", 13, 10`,
    `msg_ud3: db 13, 10, "This code needs a newer CPU than the Pentium Pro (a Pentium II or later).", 13, 10`);
  // fd_wait: the fall-back count (for a stopped timer). The P6 does a pass of the loop in about
  // 8 clocks: 1000 x 65536 passes take about 2.6 s, more than the 2 s of the timer ticks.
  rep(`        mov dx, 200           ; a fall-back count, for a stopped timer (about 2.4 s on the Pentium)`,
    `        mov dx, 1000          ; a fall-back count, for a stopped timer (about 2.6 s on the Pentium Pro)`);
  // fd_ready: the same for its fall-back count: 40 x 65536 passes, more than the 28 timer ticks.
  rep(String.raw`        mov cx, 8             ; a fall-back count, for a stopped timer: 8 x 65536 passes`,
    String.raw`        mov cx, 40            ; a fall-back count, for a stopped timer: 40 x 65536 passes`);
  return s;
}

// Samples for the 80286 machine only (they use 186/286 instructions, the A20 gate,
// the 8042 and the CMOS shutdown byte).
SAMPLES.unshift(
  {
    id: 'pm286', model: '80286', name: '80286: protected mode tour',
    desc: 'LGDT, LIDT, LMSW: enter protected mode, catch a #GP, and return through a CPU reset.',
    src: String.raw`; A tour of 80286 protected mode
        cpu 286
        org 0x100

start:  mov si, msg_intro
        call bios_print
        mov [saved_sp], sp
        mov [saved_ss], ss
        ; where the BIOS resumes after the CPU reset (0040:0067)
        push ds
        push word 0x40
        pop ds
        mov word [0x67], back
        mov [0x69], cs
        pop ds
        cli
        lgdt [gdt_ptr]        ; the GDT and IDT bases are linear addresses
        lidt [idt_ptr]
        smsw ax
        or ax, 1              ; MSW.PE = 1: protected mode on
        lmsw ax
        jmp CODE_SEL:pm_entry ; a far jump loads CS from the GDT

pm_entry:
        mov ax, DATA_SEL
        mov ds, ax
        mov ss, ax            ; the same base as before, so SP stays
        mov ax, VIDEO_SEL
        mov es, ax
        mov si, msg_pm
        mov di, 160*12
        call vid_print
        ; the video segment is 4 KB long: offset 1000h is past its limit
        mov word [es:0x1000], 0x1E41
after_gp:
        mov si, msg_leave
        mov di, 160*14
        call vid_print
        ; leave protected mode as on the AT: shutdown code 0Ah, CPU reset
        mov al, 0x8F
        out 0x70, al
        mov al, 0x0A
        out 0x71, al
        mov al, 0xFE          ; 8042: pulse the CPU reset line
        out 0x64, al
.wait:  hlt
        jmp .wait

; #GP handler (interrupt gate 13): show the fault, then skip the bad write
gp_handler:
        pop ax                ; the error code (0: no selector involved)
        mov si, msg_gp
        mov di, 160*13
        call vid_print
        pop ax                ; the saved IP of the faulting instruction
        push after_gp
        iret

; print DS:SI to the screen through ES (a selector in protected mode)
vid_print:
        mov ah, 0x1E
.l:     lodsb
        or al, al
        jz .e
        stosw
        jmp .l
.e:     ret

; real mode again: the BIOS jumped here after the reset
back:   mov ax, cs
        mov ds, ax
        mov es, ax
        mov ss, [saved_ss]
        mov sp, [saved_sp]
        sti
        mov si, msg_real
        call bios_print
        ret

bios_print:
        lodsb
        or al, al
        jz .e
        mov ah, 0x0E
        int 0x10
        jmp bios_print
.e:     ret

; --- the global descriptor table: limit, base 0-15, base 16-23, access, reserved
gdt:    dw 0, 0, 0, 0                   ; 00h: the null descriptor
code_d: dw 0xFFFF, 0x0000               ; 08h: code, base 010000h, 64 KB
        db 0x01, 0x9A                   ;      present, ring 0, execute/read
        dw 0
data_d: dw 0xFFFF, 0x0000               ; 10h: data, base 010000h, 64 KB
        db 0x01, 0x92                   ;      present, ring 0, read/write
        dw 0
vid_d:  dw 0x0FFF, 0x8000               ; 18h: data, base 0B8000h, 4 KB
        db 0x0B, 0x92
        dw 0
gdt_end:
CODE_SEL  equ code_d - gdt
DATA_SEL  equ data_d - gdt
VIDEO_SEL equ vid_d - gdt

; --- the interrupt descriptor table: only vector 13 (#GP) is present
idt:    times 13 dw 0, 0, 0, 0
        dw gp_handler, CODE_SEL         ; offset, selector
        db 0, 0x86                      ; present, ring 0, 80286 interrupt gate
        dw 0
idt_end:

gdt_ptr: dw gdt_end - gdt - 1
         dw gdt
         db 0x01, 0                     ; base = 010000h + gdt
idt_ptr: dw idt_end - idt - 1
         dw idt
         db 0x01, 0

saved_sp: dw 0
saved_ss: dw 0
msg_intro: db "Real mode. Loading the GDT and IDT, then LMSW to set PE...", 13, 10, 0
msg_pm:    db " Protected mode: CS, DS, SS and ES now hold GDT selectors ", 0
msg_gp:    db " #GP caught: the write past the 4 KB video limit was stopped ", 0
msg_leave: db " Leaving: CMOS shutdown code 0Ah, CPU reset through the 8042 ", 0
msg_real:  db 13, 10, 13, 10, 13, 10, 13, 10, 13, 10, 13, 10, 13, 10, 13, 10, 13, 10
           db "Back in real mode: the BIOS resumed at 0040:0067.", 13, 10, 0
` },
  {
    id: 'ins186', model: '80286', name: '80286: 186/286 instructions',
    desc: 'PUSH immediate, IMUL with an immediate, shifts by a count, ENTER/LEAVE, PUSHA/POPA.',
    src: String.raw`; Instructions that the 8086 does not have
        cpu 286
        org 0x100

start:  push 1234             ; PUSH immediate (new on the 80186)
        pop ax
        call print_dec        ; 1234
        mov ax, 7
        imul bx, ax, 6        ; IMUL with an immediate: BX = AX * 6
        mov ax, bx
        call print_dec        ; 42
        mov ax, 1
        shl ax, 10            ; a shift by an immediate count
        call print_dec        ; 1024
        push 5
        call fact             ; ENTER / LEAVE build the stack frames
        add sp, 2
        call print_dec        ; 120
        ret

; fact(n) = n!  with a real stack frame
fact:   enter 0, 0            ; push bp / mov bp, sp
        mov ax, [bp+4]
        cmp ax, 1
        jbe .done
        dec ax
        push ax
        call fact
        add sp, 2
        mul word [bp+4]
.done:  leave                 ; mov sp, bp / pop bp
        ret

; print AX in decimal; PUSHA / POPA keep every register
print_dec:
        pusha
        mov bx, 10
        xor cx, cx
.d:     xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d
.o:     pop ax
        add al, '0'
        mov ah, 0x0E
        int 0x10
        loop .o
        mov al, ' '
        int 0x10
        popa
        ret
` },
  {
    id: 'a20', model: '80286', name: '80286: A20 and extended memory',
    desc: 'The 1 MB wrap with A20 off, then the first byte above 1 MB with A20 on (port 92h).',
    src: String.raw`; FFFF:0010 is linear 100000h. With A20 off the address wraps to 00000h.
        cpu 286
        org 0x100

start:  call test_wrap
        in al, 0x92
        or al, 2              ; port 92h bit 1: A20 on
        out 0x92, al
        call test_wrap
        in al, 0x92
        and al, 0xFD          ; A20 off again
        out 0x92, al
        mov ah, 0x88          ; INT 15h AH=88h: extended memory in KB
        int 0x15
        call print_dec
        mov si, msg_kb
        call puts
        ret

; write a mark at FFFF:0010 and look at 0000:0000
test_wrap:
        push ds
        push es
        push word 0xFFFF
        pop es
        push word 0
        pop ds
        mov bl, [0]           ; keep the old byte of 0000:0000
        mov byte [es:0x10], 0xA5
        mov al, [0]
        mov [0], bl           ; put it back
        pop es
        pop ds
        mov si, msg_same
        cmp al, 0xA5
        je .p
        mov si, msg_diff
.p:     call puts
        ret

puts:   lodsb
        or al, al
        jz .e
        mov ah, 0x0E
        int 0x10
        jmp puts
.e:     ret

print_dec:
        pusha
        mov bx, 10
        xor cx, cx
.d:     xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d
.o:     pop ax
        add al, '0'
        mov ah, 0x0E
        int 0x10
        loop .o
        popa
        ret

msg_same: db "A20 off: FFFF:0010 is the byte at 0000:0000 (wrap at 1 MB)", 13, 10, 0
msg_diff: db "A20 on:  FFFF:0010 reaches 100000h, above 1 MB", 13, 10, 0
msg_kb:   db " KB of extended memory (INT 15h AH=88h)", 13, 10, 0
` });

// Samples for the 80386 machine only (32-bit registers, paging, the new instructions).
// The page shows them first on the 80386, then the 80286 samples.
SAMPLES.unshift(
  {
    id: 'fib32', model: '80386', name: '80386: 32-bit Fibonacci',
    desc: 'EAX, EBX and EDX hold 32 bits: 32-bit ADD, ROL for the hex digits, a 32-bit DIV for decimal.',
    src: String.raw`; Fibonacci numbers in the 32-bit registers of the 80386
        cpu 386
        org 0x100

start:  mov si, msg_head
        call puts
        xor eax, eax          ; a = 0 (EAX: all 32 bits)
        mov ebx, 1            ; b = 1
        mov cx, 48            ; F(0) to F(47). F(48) needs 33 bits.
.next:  call print_hex32      ; a as 8 hex digits
        call sep              ; a space, or a new line after 8 numbers
        mov edx, eax
        add edx, ebx          ; a 32-bit ADD: the next number is a + b
        mov eax, ebx          ; a = b
        mov ebx, edx          ; b = a + b
        loop .next
        mov si, msg_last      ; the last number again, in decimal
        call puts
        mov eax, [last]       ; F(47): print_hex32 keeps the last number here
        call print_dec32
        mov si, msg_end
        call puts
        ret

; a space between the numbers, a new line after each 8 numbers
sep:    push ax
        inc byte [count]
        test byte [count], 7
        jz .nl
        mov al, ' '
        call putc
        pop ax
        ret
.nl:    call crlf
        pop ax
        ret

; print EAX as 8 hex digits: ROL moves the top 4 bits to the bottom
print_hex32:
        push eax
        push cx
        push edx
        mov edx, eax
        mov [last], eax
        mov cx, 8
.d:     rol edx, 4            ; the next digit to bits 0-3
        mov al, dl
        and al, 0x0F
        add al, '0'
        cmp al, '9'
        jbe .p
        add al, 'A' - '9' - 1
.p:     call putc
        loop .d
        pop edx
        pop cx
        pop eax
        ret

; print EAX in decimal: DIV ECX divides the 64 bits of EDX:EAX by 10
print_dec32:
        mov ecx, 10
        xor bp, bp            ; BP counts the digits
.d:     xor edx, edx
        div ecx               ; EAX = the quotient, EDX = the remainder (a digit)
        push dx
        inc bp
        or eax, eax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        dec bp
        jnz .o
        ret

crlf:   push ax
        mov al, 13
        call putc
        mov al, 10
        call putc
        pop ax
        ret

; one character to the screen (INT 10h AH=0Eh, page 0)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

last:     dd 0
count:    db 0
msg_head: db "F(0) to F(47) in 32-bit registers (hex):", 13, 10, 0
msg_last: db "F(47) = ", 0
msg_end:  db ", the last one below 2^32", 13, 10, 0
` },
  {
    id: 'paging', model: '80386', name: '80386: paging',
    desc: 'A page directory and a page table send linear 00200000h to the screen at B8000h. CR3, CR0.PG, and the A and D bits.',
    src: String.raw`; Paging on the 80386. A page table sends the linear page 00200000h to the
; physical page B8000h: the screen memory. The program writes a line of text
; to linear 00200000h, and the line comes out on the screen.
        cpu 386
        org 0x100

PDIR    equ 0x20000           ; the page directory (a physical address, 4 KB aligned)
PTAB    equ 0x21000           ; one page table: it maps linear 0 - 3FFFFFh
WINDOW  equ 0x200000          ; the linear page that goes to the screen
PTE_W   equ PTAB + (WINDOW >> 12) * 4   ; the table entry of that page

start:  mov si, msg_intro
        call puts
        ; --- the page table: page n goes to physical page n (the same address)
        mov ax, PTAB >> 4
        mov es, ax
        xor di, di
        mov eax, 3            ; physical 0; bit 0 = present, bit 1 = writable
        mov cx, 1024
        cld
.pt:    stosd
        add eax, 0x1000       ; the next 4 KB page
        loop .pt
        ; --- but the page at linear 00200000h goes to the screen
        mov ebx, PTE_W - PTAB
        mov dword [es:bx], 0xB8000 | 3
        mov eax, [es:bx]
        mov [pte_before], eax
        ; --- the page directory: entry 0 points to the table, the others are empty
        mov ax, PDIR >> 4
        mov es, ax
        xor di, di
        xor eax, eax
        mov cx, 1024
        rep stosd
        mov dword [es:0], PTAB | 3
        ; --- the code and data segments start where this program is (CS * 16)
        xor ebx, ebx
        mov bx, cs
        shl ebx, 4            ; EBX = the linear address of this program
        mov [code_d + 2], bx  ; base bits 0-15
        mov [data_d + 2], bx
        mov eax, ebx
        shr eax, 16
        mov [code_d + 4], al  ; base bits 16-23
        mov [data_d + 4], al
        add ebx, gdt
        mov [gdt_ptr + 2], ebx   ; the linear address of the GDT
        mov [rm_ptr + 2], cs     ; the far pointer back to real mode
        ; --- an empty line for the text. EDI = its address in the linear window.
        mov si, msg_line
        call puts
        mov ah, 3             ; INT 10h AH=03h: DH = the row of the cursor
        xor bh, bh
        int 0x10
        dec dh                ; the empty row above the cursor
        mov al, 160           ; 80 characters of 2 bytes in a row
        mul dh
        movzx edi, ax
        add edi, WINDOW
        ; --- paging on
        cli
        lgdt [gdt_ptr]
        mov eax, PDIR
        mov cr3, eax          ; CR3 = the physical address of the page directory
        mov eax, cr0
        or eax, 0x80000001    ; CR0.PG = 1 (paging) and CR0.PE = 1 (protected mode)
        mov cr0, eax
        jmp CODE_SEL:pm       ; a far jump loads CS from the GDT

pm:     mov ax, DATA_SEL      ; DS = this program
        mov ds, ax
        mov ax, FLAT_SEL      ; ES = all of the 4 GB, base 0
        mov es, ax
        mov si, msg_pm
        mov ah, 0x2F          ; white on green
.w:     lodsb
        or al, al
        jz .done
        mov [es:edi], ax      ; a linear address: the page table sends it to B8000h
        add edi, 2
        jmp .w
.done:  mov ebx, PTE_W        ; the table entry after the writes
        mov eax, [es:ebx]
        mov [pte_after], eax
        ; --- paging off, back to real mode
        mov ax, DATA_SEL      ; first a 64 KB segment in ES again
        mov es, ax
        mov eax, cr0
        and eax, 0x7FFFFFFE   ; CR0.PG = 0, CR0.PE = 0
        mov cr0, eax
        jmp far [rm_ptr]      ; real mode: CS = the segment of this program

real:   mov ax, cs
        mov ds, ax
        mov es, ax
        sti
        mov si, msg_before
        call puts
        mov eax, [pte_before]
        call print_hex32
        mov si, msg_after
        call puts
        mov eax, [pte_after]
        call print_hex32
        mov si, msg_bits
        call puts
        ret

; print EAX as 8 hex digits
print_hex32:
        mov cx, 8
.d:     rol eax, 4            ; the next digit to bits 0-3
        push ax
        and al, 0x0F
        add al, '0'
        cmp al, '9'
        jbe .p
        add al, 'A' - '9' - 1
.p:     mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop ax
        loop .d
        ret

puts:   lodsb
        or al, al
        jz .e
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        jmp puts
.e:     ret

; --- the global descriptor table (8 bytes each: limit, base, access, flags)
gdt:    dq 0                            ; 00h: the null descriptor
code_d: dw 0xFFFF, 0                    ; 08h: code, 64 KB, base = CS * 16
        db 0, 0x9A, 0x00, 0             ;      present, ring 0, execute/read, 16-bit
data_d: dw 0xFFFF, 0                    ; 10h: data, 64 KB, base = CS * 16
        db 0, 0x92, 0x00, 0             ;      present, ring 0, read/write
flat_d: dw 0xFFFF, 0                    ; 18h: data, base 0, limit 4 GB
        db 0, 0x92, 0x8F, 0             ;      G = 1: the limit counts 4 KB pages
gdt_end:
CODE_SEL equ code_d - gdt
DATA_SEL equ data_d - gdt
FLAT_SEL equ flat_d - gdt

gdt_ptr:    dw gdt_end - gdt - 1
            dd 0
rm_ptr:     dw real, 0
pte_before: dd 0
pte_after:  dd 0
msg_intro:  db "Each 4 KB page maps to the same address, but the page table sends", 13, 10
            db "linear 00200000h to B8000h (the screen). CR3 and CR0.PG turn paging on.", 13, 10, 0
msg_line:   db 13, 10, 0
msg_pm:     db " This line went to linear 00200000h. The page table sent it to B8000h. ", 0
msg_before: db "PTE before: ", 0
msg_after:  db " (present, writable)", 13, 10, "PTE after:  ", 0
msg_bits:   db " (the CPU set bit 5 A = accessed, bit 6 D = dirty)", 13, 10, 0
` },
  {
    id: 'bits', model: '80386', name: '80386: bit instructions',
    desc: 'BSF, BSR, BT with SETC, MOVZX, MOVSX and SHLD on 32-bit values.',
    src: String.raw`; New instructions of the 80386: bit scan, bit test, SETcc, MOVZX, MOVSX, SHLD
        cpu 386
        org 0x100

start:  mov ebx, 0x00F0A5C4   ; the test number
        mov si, msg_num
        call puts
        mov eax, ebx
        call print_hex32
        ; BSF and BSR: the number of the lowest and of the highest bit that is 1
        mov si, msg_bsf
        call puts
        bsf ecx, ebx
        mov ax, cx
        call print_dec
        mov si, msg_bsr
        call puts
        bsr ecx, ebx
        mov ax, cx
        call print_dec
        ; BT copies bit ECX to CF. SETC writes CF to a byte (0 or 1).
        xor ecx, ecx          ; ECX = the bit number
        xor dx, dx            ; DX = the count of 1 bits
.bit:   bt ebx, ecx
        setc al
        movzx ax, al          ; MOVZX: AL to AX, the high byte is 0
        add dx, ax
        inc ecx
        cmp ecx, 32
        jb .bit
        mov si, msg_bt
        call puts
        mov ax, dx
        call print_dec
        mov si, msg_bt2
        call puts
        ; MOVZX and MOVSX: a byte to a 32-bit register, with zeros or with the sign
        mov si, msg_zx
        call puts
        movzx eax, byte [sbyte]
        call print_hex32
        mov si, msg_sx
        call puts
        movsx eax, byte [sbyte]
        call print_hex32
        ; SHLD: shift the 64 bits of EDX:EAX left by 8. EDX gets the top byte of EAX.
        mov si, msg_shld
        call puts
        mov edx, 0x12345678
        mov eax, 0x9ABCDEF0
        call print_pair
        shld edx, eax, 8
        shl eax, 8
        mov si, msg_to
        call puts
        call print_pair
        mov si, msg_nl
        call puts
        ret

; print EDX and EAX as hex, with a space between them
print_pair:
        push eax
        mov eax, edx
        call print_hex32
        mov al, ' '
        call putc
        pop eax
        call print_hex32
        ret

; print EAX as 8 hex digits
print_hex32:
        push eax
        push cx
        mov cx, 8
.d:     rol eax, 4            ; the next digit to bits 0-3
        push ax
        and al, 0x0F
        add al, '0'
        cmp al, '9'
        jbe .p
        add al, 'A' - '9' - 1
.p:     call putc
        pop ax
        loop .d
        pop cx
        pop eax
        ret

; print AX in decimal
print_dec:
        push bx
        push cx
        push dx
        mov bx, 10
        xor cx, cx
.d:     xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        loop .o
        pop dx
        pop cx
        pop bx
        ret

putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

sbyte:    db 0x9C
msg_num:  db "Number:          ", 0
msg_bsf:  db 13, 10, "BSF lowest 1:    bit ", 0
msg_bsr:  db "   BSR highest 1: bit ", 0
msg_bt:   db 13, 10, "BT and SETC:     ", 0
msg_bt2:  db " bits are 1", 0
msg_zx:   db 13, 10, "MOVZX byte 9Ch:  ", 0
msg_sx:   db "   MOVSX byte 9Ch: ", 0
msg_shld: db 13, 10, "SHLD EDX:EAX, 8: ", 0
msg_to:   db 13, 10, "              -> ", 0
msg_nl:   db 13, 10, 0
` });

// Samples for the 80486 machine only (CPUID, the on-chip cache, the new instructions).
// The page shows them first on the 80486, then the 80386 and 80286 samples.
SAMPLES.unshift(
  {
    id: 'cpuid', model: '80486', name: '80486: which CPU is this?',
    desc: 'The classic CPU test of the DOS years: FLAGS bits 12-15, EFLAGS.AC, EFLAGS.ID, then CPUID: the vendor, the family, the model, the stepping and the FPU bit.',
    src: String.raw`; Which CPU is this? The classic test of the DOS years, one step at a time:
;  1. FLAGS bits 12-15: an 8086 or an 80186 always sets them.
;  2. In real mode an 80286 always clears the bits 12-14.
;  3. EFLAGS.AC (bit 18): an 80486 can change it, an 80386 cannot.
;  4. EFLAGS.ID (bit 21): a CPU that can change it has the CPUID instruction.
; Then CPUID tells the vendor, the family, the model, the stepping and the features.
        cpu 486
        org 0x100

start:  mov si, msg_head
        call puts
        ; --- 1. an 8086 or an 80186? Try to clear the bits 12-15.
        pushf                 ; keep the flags
        pushf
        pop ax
        and ax, 0x0FFF
        push ax
        popf
        pushf
        pop ax
        popf                  ; the flags as before
        and ax, 0xF000
        cmp ax, 0xF000
        jne .not86
        mov si, msg_is86      ; the bits stay 1
        jmp last
.not86: mov si, msg_not86
        call puts
        ; --- 2. an 80286? Try to set the bits 12-14 (IOPL and NT on a newer CPU).
        pushf
        pushf
        pop ax
        or ax, 0x7000
        push ax
        popf
        pushf
        pop ax
        popf
        test ax, 0x7000
        jnz .not286
        mov si, msg_is286     ; the bits stay 0
        jmp last
.not286:
        mov si, msg_not286
        call puts
        ; --- 3. an 80386? Try to change EFLAGS.AC (bit 18).
        mov ebx, 0x40000
        call flip
        jnz .not386
        mov si, msg_is386     ; AC does not change
        jmp last
.not386:
        mov si, msg_not386
        call puts
        ; --- 4. CPUID? Try to change EFLAGS.ID (bit 21).
        mov ebx, 0x200000
        call flip
        jnz .cpuid
        mov si, msg_noid      ; an early 80486 with no CPUID
        jmp last
.cpuid: mov si, msg_id
        call puts
        ; --- CPUID leaf 0: EAX = the highest leaf, EBX EDX ECX = the vendor string
        xor eax, eax
        cpuid
        mov [vendor], ebx
        mov [vendor + 4], edx
        mov [vendor + 8], ecx
        push eax
        mov si, msg_leaf0
        call puts
        pop eax
        call print_dec
        mov si, msg_vendor
        call puts
        mov si, vendor        ; 12 characters, then the 0 after them
        call puts
        ; --- CPUID leaf 1: EAX = the signature, EDX = the feature bits
        mov eax, 1
        cpuid
        mov [sig], eax
        mov [feat], edx
        mov si, msg_leaf1
        call puts
        mov eax, [sig]
        call print_hex32
        mov si, msg_fam
        call puts
        mov eax, [sig]
        shr eax, 8            ; the family: bits 8-11
        and eax, 0x0F
        mov [family], al
        call print_dec
        mov si, msg_mod
        call puts
        mov eax, [sig]
        shr eax, 4            ; the model: bits 4-7
        and eax, 0x0F
        call print_dec
        mov si, msg_step
        call puts
        mov eax, [sig]
        and eax, 0x0F         ; the stepping: bits 0-3
        call print_dec
        mov si, msg_edx
        call puts
        mov eax, [feat]
        call print_hex32
        mov si, msg_fpu0
        test byte [feat], 1   ; EDX bit 0: the FPU is on the chip
        jz .f
        mov si, msg_fpu1
.f:     call puts
        ; --- the answer
        mov si, msg_486dx
        cmp byte [family], 4
        jne .new
        test byte [feat], 1
        jnz last
        mov si, msg_486sx
        jmp last
.new:   mov si, msg_newer
last:   call puts
        ret

; Try to change the EFLAGS bit in EBX. Out: ZF = 0 when the bit changed.
; EFLAGS is as before at the end.
flip:   pushfd
        pop eax
        mov ecx, eax          ; ECX = EFLAGS now
        xor eax, ebx          ; change the bit
        push eax
        popfd
        pushfd
        pop eax               ; EAX = EFLAGS after the change
        push ecx
        popfd                 ; EFLAGS as before (POPFD does not change ZF here)
        xor eax, ecx          ; the bits that changed
        test eax, ebx
        ret

; print EAX as 8 hex digits and "h"
print_hex32:
        mov cx, 8
.d:     rol eax, 4            ; the next digit to bits 0-3
        push eax
        and al, 0x0F
        add al, '0'
        cmp al, '9'
        jbe .p
        add al, 'A' - '9' - 1
.p:     call putc
        pop eax
        loop .d
        mov al, 'h'
        jmp putc

; print EAX in decimal
print_dec:
        mov ecx, 10
        xor bx, bx            ; BX counts the digits
.d:     xor edx, edx
        div ecx               ; EDX = the last digit
        push dx
        inc bx
        or eax, eax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        dec bx
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

vendor:     times 12 db 0
            db 13, 10, 0
sig:        dd 0
feat:       dd 0
family:     db 0
msg_head:   db "The CPU test, step by step:", 13, 10, 0
msg_is86:   db "FLAGS bits 12-15 stay 1: an 8086 or an 80186.", 13, 10, 0
msg_not86:  db "FLAGS bits 12-15 can change: not an 8086 or an 80186.", 13, 10, 0
msg_is286:  db "FLAGS bits 12-14 stay 0: an 80286.", 13, 10, 0
msg_not286: db "FLAGS bits 12-14 can be 1: not an 80286.", 13, 10, 0
msg_is386:  db "EFLAGS.AC (bit 18) stays the same: an 80386.", 13, 10, 0
msg_not386: db "EFLAGS.AC (bit 18) can change: not an 80386.", 13, 10, 0
msg_noid:   db "EFLAGS.ID (bit 21) stays the same: an 80486 with no CPUID.", 13, 10, 0
msg_id:     db "EFLAGS.ID (bit 21) can change: the CPU has CPUID.", 13, 10, 13, 10, 0
msg_leaf0:  db "CPUID 0: highest leaf ", 0
msg_vendor: db ", vendor ", 0
msg_leaf1:  db "CPUID 1: EAX = ", 0
msg_fam:    db ": family ", 0
msg_mod:    db ", model ", 0
msg_step:   db ", stepping ", 0
msg_edx:    db 13, 10, "         EDX = ", 0
msg_fpu1:   db ": bit 0 = 1, the FPU is on the chip", 13, 10, 13, 10, 0
msg_fpu0:   db ": bit 0 = 0, no FPU on the chip", 13, 10, 13, 10, 0
msg_486dx:  db "This CPU is an 80486DX.", 13, 10, 0
msg_486sx:  db "This CPU is an 80486SX.", 13, 10, 0
msg_newer:  db "This CPU is newer than the 80486.", 13, 10, 0
` },
  {
    id: 'cache', model: '80486', name: '80486: the 8 KB cache',
    desc: 'Read 128 KB from a small array (it fits in the cache) and from a big array (it does not), timed with the 8254. Then the same with the cache off (CR0.CD = 1 and WBINVD).',
    src: String.raw`; The 8 KB cache of the 80486. The program reads 128 KB in two ways and measures
; the time of each with channel 2 of the 8254 timer (1,193,182 counts each second):
;   small: a 4 KB array, 32 times. After one pass all its lines are in the cache.
;   big:   a 64 KB array, 2 times. It does not fit, so each line comes from RAM again.
; Then it does the same with the cache off: CR0.CD = 1 (no new lines) and WBINVD
; (the cache becomes empty).
        cpu 486
        org 0x100

ARRAY   equ 0x3000              ; the arrays: 3000:0000. The small array is the first 4 KB.

start:  mov si, msg_head
        call puts
        ; the 8254 channel 2: mode 2, it counts down from 65535. Port 61h bit 0 = 1 lets
        ; it count; bit 1 = 0 keeps the speaker silent.
        in al, 0x61
        mov [old61], al
        and al, 0xFC
        or al, 0x01
        out 0x61, al
        mov al, 0xB4          ; channel 2, low byte then high byte, mode 2, binary
        out 0x43, al
        mov al, 0xFF
        out 0x42, al
        out 0x42, al
        mov ax, ARRAY
        mov es, ax
        ; --- the cache on: CR0.CD = 0, CR0.NW = 0 (the BIOS did this at start-up)
        mov eax, cr0
        mov [old_cr0], eax
        and eax, 0x9FFFFFFF
        mov cr0, eax
        mov si, msg_on
        call puts
        call measure
        mov [on_small], ax
        mov [on_big], dx
        ; --- the cache off: CR0.CD = 1, then WBINVD empties the cache
        mov eax, cr0
        or eax, 0x40000000
        mov cr0, eax
        wbinvd
        mov si, msg_off
        call puts
        call measure
        mov [off_small], ax
        ; --- the old CR0 and port 61h again
        mov eax, [old_cr0]
        mov cr0, eax
        mov al, [old61]
        out 0x61, al
        ; --- the result: how many times faster is the small array with the cache?
        mov si, msg_res
        call puts
        mov ax, [off_small]
        mov bx, [on_small]
        call ratio
        mov si, msg_res2
        call puts
        ret

; Time the small array, then the big array, and print the two times.
; Out: AX = the time of the small array, DX = the big array (in 8254 counts).
measure:
        mov cx, 4096 / 16     ; one pass first: it loads the lines of the small array
        call sum
        call timer
        mov [t0], ax
        mov bp, 32            ; the small array: 4 KB, 32 times
.s:     mov cx, 4096 / 16
        call sum
        dec bp
        jnz .s
        call timer
        neg ax
        add ax, [t0]          ; the counter goes down: the time = start - end
        mov [t_small], ax
        call timer
        mov [t0], ax
        mov bp, 2             ; the big array: 64 KB, 2 times
.b:     mov cx, 65536 / 16
        call sum
        dec bp
        jnz .b
        call timer
        neg ax
        add ax, [t0]
        mov [t_big], ax
        mov si, msg_small
        call puts
        mov ax, [t_small]
        call print_us
        mov si, msg_big
        call puts
        mov ax, [t_big]
        call print_us
        mov si, msg_ratio
        call puts
        mov ax, [t_big]
        mov bx, [t_small]
        call ratio
        mov si, msg_nl
        call puts
        mov ax, [t_small]
        mov dx, [t_big]
        ret

; Add the dwords of CX lines (16 bytes each) at ES:0000 into EAX: four reads for each line.
sum:    xor si, si
.l:     add eax, [es:si]
        add eax, [es:si + 4]
        add eax, [es:si + 8]
        add eax, [es:si + 12]
        add si, 16
        dec cx
        jnz .l
        ret

; AX = the count of the 8254 channel 2 now (a latch command holds it for the two reads)
timer:  mov al, 0x80          ; channel 2, latch
        out 0x43, al
        in al, 0x42
        mov ah, al
        in al, 0x42
        xchg al, ah
        ret

; print the time AX (8254 counts) in microseconds: one count = 0.838 us
print_us:
        movzx eax, ax
        imul eax, eax, 838
        xor edx, edx
        mov ecx, 1000
        div ecx
        mov cx, 6             ; right-aligned in 6 columns
        call print_dec
        mov si, msg_us
        jmp puts

; print AX / BX with one decimal, for example "4.6"
ratio:  movzx eax, ax
        movzx ebx, bx
        imul eax, eax, 10
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest tenth
        xor edx, edx
        div ebx               ; EAX = 10 times the ratio
        xor edx, edx
        mov ecx, 10
        div ecx
        push dx               ; the tenths
        xor cx, cx
        call print_dec
        mov al, '.'
        call putc
        pop ax
        add al, '0'
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        push bp
        xor bp, bp            ; BP counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc bp
        or eax, eax
        jnz .d
.sp:    cmp cx, bp
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec bp
        jnz .o
        pop bp
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

old_cr0:   dd 0
old61:     db 0
t0:        dw 0
t_small:   dw 0
t_big:     dw 0
on_small:  dw 0
on_big:    dw 0
off_small: dw 0
msg_head:  db "Read 128 KB two ways. The 8254 measures the time.", 13, 10
           db "  small: a 4 KB array 32 times (it fits in the 8 KB cache)", 13, 10
           db "  big:   a 64 KB array 2 times (it does not fit)", 13, 10, 13, 10, 0
msg_on:    db "Cache on:  ", 0
msg_off:   db "Cache off: ", 0
msg_small: db " small", 0
msg_big:   db "   big", 0
msg_us:    db " us", 0
msg_ratio: db "   big / small = ", 0
msg_nl:    db 13, 10, 0
msg_res:   db 13, 10, "With the cache, the small array is ", 0
msg_res2:  db " times faster.", 13, 10, 0
` },
  {
    id: 'atomic', model: '80486', name: '80486: BSWAP, XADD, CMPXCHG',
    desc: 'Three new instructions: BSWAP turns the byte order round, XADD adds and gives back the old value, CMPXCHG writes only when the old value is correct (a lock).',
    src: String.raw`; Three new instructions of the 80486.
;  BSWAP turns the byte order of a 32-bit register round (little-endian <-> big-endian).
;  XADD adds a register to memory and gives back the old value (a shared counter).
;  CMPXCHG compares memory with AL/AX/EAX and writes the new value only when they are
;  equal (a lock that only one program can get).
        cpu 486
        org 0x100

start:  ; --- BSWAP
        mov si, msg_bswap
        call puts
        mov ebx, 0x12345678
        mov eax, ebx
        call print_hex32
        mov si, msg_to
        call puts             ; (puts changes AL)
        mov eax, ebx
        bswap eax             ; 12 34 56 78 -> 78 56 34 12
        call print_hex32
        mov si, msg_net
        call puts
        mov eax, [net]        ; the bytes 00 00 01 BB: 443 in big-endian order
        bswap eax
        call print_dec
        mov si, msg_nl
        call puts
        ; --- XADD: counter = 100, add 5 two times
        mov si, msg_xadd
        call puts
        mov eax, 5
        lock xadd [counter], eax   ; EAX = 100 (the old value), counter = 105
        call print_dec
        mov si, msg_xadd2
        call puts
        mov eax, 5
        lock xadd [counter], eax   ; EAX = 105, counter = 110
        call print_dec
        mov si, msg_xadd3
        call puts
        mov eax, [counter]
        call print_dec
        mov si, msg_nl
        call puts
        ; --- CMPXCHG: a lock byte, 0 = free
        mov si, msg_cx1
        call puts
        mov al, 0             ; the value that we expect: free
        mov dl, 1             ; the new value: program 1 has the lock
        lock cmpxchg [lock_b], dl
        call show_zf          ; ZF = 1: equal, the lock byte is 1 now
        mov si, msg_cx2
        call puts
        mov al, 0
        mov dl, 2             ; program 2 tries the same
        lock cmpxchg [lock_b], dl
        mov [owner], al       ; ZF = 0: not equal, AL = the value in memory (1)
        call show_zf
        mov si, msg_cx3
        call puts
        movzx eax, byte [owner]
        call print_dec
        mov si, msg_cx4
        call puts
        movzx eax, byte [lock_b]
        call print_dec
        mov si, msg_nl
        call puts
        ret

; print "ZF = 1" or "ZF = 0"
show_zf:
        push ax
        pushf
        mov si, msg_zf
        call puts
        popf
        mov al, '0'
        jnz .p
        mov al, '1'
.p:     call putc
        pop ax
        ret

; print EAX as 8 hex digits
print_hex32:
        push eax
        mov cx, 8
.d:     rol eax, 4
        push eax
        and al, 0x0F
        add al, '0'
        cmp al, '9'
        jbe .p
        add al, 'A' - '9' - 1
.p:     call putc
        pop eax
        loop .d
        pop eax
        ret

; print EAX in decimal
print_dec:
        push eax
        mov ecx, 10
        xor bx, bx
.d:     xor edx, edx
        div ecx
        push dx
        inc bx
        or eax, eax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        dec bx
        jnz .o
        pop eax
        ret

putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

net:       db 0x00, 0x00, 0x01, 0xBB
counter:   dd 100
lock_b:    db 0
owner:     db 0
msg_bswap: db "BSWAP:   ", 0
msg_to:    db " -> ", 0
msg_net:   db 13, 10, "         the big-endian bytes 00 00 01 BB = ", 0
msg_xadd:  db 13, 10, "XADD:    counter 100, add 5: EAX = ", 0
msg_xadd2: db " (the old value)", 13, 10, "         add 5 again:       EAX = ", 0
msg_xadd3: db ", counter = ", 0
msg_cx1:   db 13, 10, "CMPXCHG: the lock is free (0), program 1 takes it: ", 0
msg_cx2:   db 13, 10, "         program 2 tries too: ", 0
msg_cx3:   db ", AL = ", 0
msg_cx4:   db " (program 1 has it), lock = ", 0
msg_zf:    db "ZF = ", 0
msg_nl:    db 13, 10, 0
` });

// Samples for the Pentium machine only (RDTSC, the two pipes, the BTB, the FDIV test, 4 MB
// pages). The page shows them first on the Pentium, then the 80486, 80386 and 80286 samples.
SAMPLES.unshift(
  {
    id: 'p5pairs', model: '80586', name: 'Pentium: two pipes (U and V)',
    desc: 'The same 8 ADD instructions two times, timed with RDTSC: first they pair in the U and V pipes, then each ADD needs the result of the ADD before it and no pair can form.',
    src: String.raw`; The two pipes of the Pentium. The P5 can start two simple instructions in the same
; clock: the first goes into the U pipe, the next goes into the V pipe. The two pair only
; when the second does not read or write a register that the first writes.
;  Loop 1: 8 ADD reg, [mem]. Two ADD next to each other use different registers: they pair.
;  Loop 2: the same 8 ADD, but all of them add to AX. Each ADD needs the result of the ADD
;          before it, so no two ADD can pair.
; RDTSC (the time-stamp counter) counts the clocks of the CPU.
        cpu 586
        org 0x100

PASSES  equ 1000

start:  mov si, msg_head
        call puts
        mov bp, loop1
        call time             ; EAX = the clocks of loop 1
        mov [t1], eax
        mov si, msg_l1
        call show
        mov bp, loop2
        call time
        mov [t2], eax
        mov si, msg_l2
        call show
        mov si, msg_ratio
        call puts
        mov eax, [t2]
        mov ebx, [t1]
        call ratio            ; loop 2 / loop 1
        mov si, msg_end
        jmp puts

; Run the loop at BP two times. The first run puts the code and the data into the caches.
; RDTSC times the second run. Out: EAX = its clocks.
time:   call bp
        cli                   ; no interrupts while the time runs
        rdtsc                 ; EDX:EAX = the time-stamp counter
        mov [t0], eax
        call bp
        rdtsc
        sti
        sub eax, [t0]         ; the low 32 bits are enough here
        ret

; Loop 1: two ADD next to each other do not share a register, so they pair.
; DEC CX (U pipe) and JNZ (V pipe) pair too: the flags are not a register here.
loop1:  mov cx, PASSES
.l:     add ax, [v1]          ; U pipe
        add bx, [v2]          ; V pipe: the pair takes the clocks of one ADD
        add dx, [v3]          ; U
        add si, [v4]          ; V
        add ax, [v5]          ; U
        add bx, [v6]          ; V
        add dx, [v7]          ; U
        add si, [v8]          ; V
        dec cx                ; U
        jnz .l                ; V
        ret

; Loop 2: each ADD reads AX, which the ADD before it writes. No pair forms, so each ADD
; takes its own clocks. Only the last ADD pairs (with DEC CX), and JNZ runs alone (a jump
; goes only into the V pipe).
loop2:  mov cx, PASSES
.l:     add ax, [v1]
        add ax, [v2]          ; it reads AX: no pair with the ADD before it
        add ax, [v3]
        add ax, [v4]
        add ax, [v5]
        add ax, [v6]
        add ax, [v7]
        add ax, [v8]          ; U pipe
        dec cx                ; V pipe
        jnz .l                ; alone
        ret

; print the text at SI, then the clocks in EAX and the clocks for each pass
show:   push eax
        call puts
        pop eax
        push eax
        mov cx, 7
        call print_dec
        mov si, msg_clk
        call puts
        pop eax
        mov ebx, PASSES
        call ratio
        mov si, msg_each
        jmp puts

; print EAX / EBX with one decimal, for example "1.7"
ratio:  mov ecx, 10
        mul ecx               ; EDX:EAX = 10 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest tenth
        adc edx, 0
        div ebx               ; EAX = 10 times the ratio
        xor edx, edx
        mov ecx, 10
        div ecx
        push dx               ; the tenths
        xor cx, cx
        call print_dec
        mov al, '.'
        call putc
        pop ax
        add al, '0'
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.sp:    cmp cx, di
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

v1:     dw 1
v2:     dw 2
v3:     dw 3
v4:     dw 4
v5:     dw 5
v6:     dw 6
v7:     dw 7
v8:     dw 8
t0:     dd 0
t1:     dd 0
t2:     dd 0
msg_head:  db "Loop 1: 8 ADD reg, [mem] with different registers: they pair in U and V.", 13, 10
           db "Loop 2: the same 8 ADD, all to AX: each one needs the result before it.", 13, 10
           db "1000 passes of each loop, timed with RDTSC:", 13, 10, 13, 10, 0
msg_l1:    db "Loop 1 (pairs):   ", 0
msg_l2:    db "Loop 2 (no pairs):", 0
msg_clk:   db " clocks, ", 0
msg_each:  db " clocks for each pass", 13, 10, 0
msg_ratio: db 13, 10, "Loop 2 takes ", 0
msg_end:   db " times the clocks of loop 1.", 13, 10, 0
` },
  {
    id: 'rdtsc', model: '80586', name: 'Pentium: RDTSC finds the clock',
    desc: 'RDTSC counts the clocks of the CPU. The program counts them for 50 ms of the 8254 timer and calculates the clock rate in MHz.',
    src: String.raw`; How fast is this CPU? RDTSC reads the time-stamp counter: the Pentium adds 1 to it at
; each clock. Channel 2 of the 8254 timer counts 1,193,182 times each second. The program
; reads both, waits 59,659 counts of the 8254 (50 ms) and reads both again. Then:
;   MHz = clocks / microseconds = clocks * 1193182 / (8254 counts * 1000000)
        cpu 586
        org 0x100

PERIOD  equ 59659             ; 8254 counts: 50 ms

start:  mov si, msg_head
        call puts
        ; the 8254 channel 2: mode 2, it counts down from 65536. Port 61h bit 0 = 1 lets it
        ; count; bit 1 = 0 keeps the speaker silent.
        in al, 0x61
        mov [old61], al
        and al, 0xFC
        or al, 0x01
        out 0x61, al
        mov al, 0xB4          ; channel 2, low byte then high byte, mode 2, binary
        out 0x43, al
        xor al, al
        out 0x42, al          ; the count 0 means 65536
        out 0x42, al
        call timer            ; the first read after the load (not used)
        ; --- the start: the 8254 count and the time-stamp counter
        call timer
        mov [c0], ax
        rdtsc                 ; EDX:EAX = the time-stamp counter
        mov [tsc0], eax
        mov [tsc0 + 4], edx
        ; --- wait 50 ms of the 8254
.w:     call timer
        mov bx, [c0]
        sub bx, ax            ; the counts since the start (the counter goes down)
        cmp bx, PERIOD
        jb .w
        rdtsc
        sub eax, [tsc0]
        sbb edx, [tsc0 + 4]   ; EDX:EAX = the clocks (EDX = 0 here)
        mov [clocks], eax
        mov [counts], bx
        mov al, [old61]
        out 0x61, al
        ; --- the 8254 time in microseconds: counts * 1000000 / 1193182
        mov si, msg_counts
        call puts
        movzx eax, word [counts]
        call print_dec
        mov si, msg_eq
        call puts
        movzx eax, word [counts]
        mov ecx, 1000000
        mul ecx
        mov ecx, 1193182
        div ecx
        call print_dec
        mov si, msg_us
        call puts
        ; --- the clocks
        mov eax, [clocks]
        call print_dec
        ; --- 100 times the MHz: clocks * 1193182 / (counts * 10000)
        mov si, msg_mhz
        call puts
        mov eax, [clocks]
        mov ecx, 1193182
        mul ecx               ; EDX:EAX = clocks * 1193182 (64 bits)
        movzx ecx, word [counts]
        imul ecx, ecx, 10000
        div ecx               ; EAX = 100 times the MHz
        xor edx, edx
        mov ecx, 100
        div ecx
        push dx               ; the hundredths
        call print_dec
        mov al, '.'
        call putc
        pop ax
        aam                   ; AH = the tenths, AL = the hundredths
        add ax, 0x3030
        xchg al, ah
        call putc
        mov al, ah
        call putc
        mov si, msg_end
        jmp puts

; AX = the count of the 8254 channel 2 now (a latch command holds it for the two reads)
timer:  mov al, 0x80          ; channel 2, latch
        out 0x43, al
        in al, 0x42
        mov ah, al
        in al, 0x42
        xchg al, ah
        ret

; print EAX in decimal
print_dec:
        mov ecx, 10
        xor bx, bx            ; BX counts the digits
.d:     xor edx, edx
        div ecx
        push dx
        inc bx
        or eax, eax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        dec bx
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

old61:      db 0
c0:         dw 0
counts:     dw 0
tsc0:       dd 0, 0
clocks:     dd 0
msg_head:   db "RDTSC counts the clocks of the CPU.", 13, 10
            db "The 8254 timer counts 1193182 times each second.", 13, 10, 13, 10, 0
msg_counts: db "8254 counts:  ", 0
msg_eq:     db " = ", 0
msg_us:     db " us", 13, 10, "RDTSC clocks: ", 0
msg_mhz:    db 13, 10, "CPU clock:    ", 0
msg_end:    db " MHz", 13, 10, 0
` },
  {
    id: 'btb', model: '80586', name: 'Pentium: branch prediction (BTB)',
    desc: 'A loop with one JZ in three patterns (always taken, never taken, taken in turn), timed with RDTSC. A performance counter counts the wrong predictions.',
    src: String.raw`; The branch target buffer (BTB) of the Pentium. The BTB keeps the jumps that were taken,
; each with a 2-bit counter of its history. The CPU uses it to guess the way of a jump
; before the jump runs. A right guess costs no clocks. A wrong guess costs 3 or 4 clocks:
; the pipes must start again at the right address.
; The loop below has one JZ that jumps to the next instruction: taken or not, the same code
; runs next. Only the guess changes the time. Three patterns of the JZ:
;   always taken, never taken, and taken / not taken in turn.
; RDTSC counts the clocks. A performance counter of the Pentium (CTR0, event 15h) counts
; the wrong guesses. On the Pentium Pro (CPUID family 6) the program uses PerfCtr0 with event
; C5h. The P6 keeps the last 4 ways of each jump, so it also learns the pattern "in turn".
        cpu 586
        org 0x100

PASSES  equ 1000

start:  mov si, msg_head
        call puts
        call ctr_on           ; a performance counter counts the wrong predictions
        mov si, msg_always
        mov word [first], 0   ; DX = 0: JZ jumps
        mov word [step], 0    ; DX stays the same
        call measure
        mov [t1], eax
        mov [w1], ebx
        mov si, msg_never
        mov word [first], 1   ; DX = 1: JZ does not jump
        call measure
        mov si, msg_turn
        mov word [first], 0
        mov word [step], 1    ; DX changes at each pass: 0, 1, 0, 1 ...
        call measure
        ; the cost of one wrong guess: the extra clocks / the extra wrong guesses
        sub eax, [t1]
        sub ebx, [w1]
        cmp ebx, 0
        jg .cost
        mov si, msg_learn     ; no more wrong guesses than "always": the CPU learned the pattern
        jmp puts
.cost:  push ebx
        push eax
        mov si, msg_cost
        call puts
        pop eax
        pop ebx
        call ratio
        mov si, msg_end
        jmp puts

; The loop under test. DX = [first]; DI = [step] changes DX after each pass (XOR).
jzloop: mov dx, [first]
        mov di, [step]
        mov cx, PASSES
.l:     test dx, dx           ; U pipe
        jz .n                 ; V pipe: the jump under test. It goes to the next instruction.
.n:     xor dx, di            ; the next value of DX
        dec cx
        jnz .l
        ret

; Run the loop two times: the first run puts the code into the cache and teaches the BTB
; the pattern. Then time the second run and print the result after the text at SI.
; Out: EAX = the clocks, EBX = the wrong guesses of the second run.
measure:
        call puts
        call jzloop
        mov ecx, [ctr]        ; CTR0 (MSR 12h), or PerfCtr0 (MSR C1h) on the Pentium Pro
        rdmsr                 ; EAX = the wrong guesses up to now
        mov [w0], eax
        rdtsc
        mov [t0], eax
        call jzloop
        rdtsc
        sub eax, [t0]
        mov [t], eax
        mov ecx, [ctr]
        rdmsr
        sub eax, [w0]
        mov [w], eax
        mov eax, [t]
        mov cx, 6
        call print_dec
        mov si, msg_clk
        call puts
        mov eax, [t]
        mov ebx, PASSES
        call ratio
        mov si, msg_wrong
        call puts
        mov eax, [w]
        xor cx, cx
        call print_dec
        mov si, msg_nl
        call puts
        mov eax, [t]
        mov ebx, [w]
        ret

; print EAX / EBX with one decimal, for example "4.0"
ratio:  mov ecx, 10
        mul ecx               ; EDX:EAX = 10 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest tenth
        adc edx, 0
        div ebx               ; EAX = 10 times the ratio
        xor edx, edx
        mov ecx, 10
        div ecx
        push dx               ; the tenths
        xor cx, cx
        call print_dec
        mov al, '.'
        call putc
        pop ax
        add al, '0'
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.sp:    cmp cx, di
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

first:  dw 0
step:   dw 0
t0:     dd 0
w0:     dd 0
t:      dd 0
w:      dd 0
t1:     dd 0
w1:     dd 0
msg_head:   db "One JZ in a loop of 1000 passes. The JZ goes to the next instruction,", 13, 10
            db "so only the guess of the BTB changes the time.", 13, 10, 13, 10, 0
msg_always: db "JZ always jumps:  ", 0
msg_never:  db "JZ never jumps:   ", 0
msg_turn:   db "JZ jumps in turn: ", 0
msg_clk:    db " clocks (", 0
msg_wrong:  db " for each pass), wrong guesses: ", 0
msg_nl:     db 13, 10, 0
msg_cost:   db 13, 10, "One wrong guess costs about ", 0
msg_end:    db " clocks.", 13, 10, 0
msg_learn:  db 13, 10, "The CPU learned the pattern: no more wrong guesses than for", 13, 10
            db "the jump that always goes the same way.", 13, 10, 0
ctr:        dd 0x12           ; the MSR of the counter: CTR0, or PerfCtr0 (C1h) on the P6

; The counter of the wrong predictions. The Pentium: CESR (MSR 11h) = event 15h in CTR0, bits
; 6-7 = 11b: count at all levels. The Pentium Pro (CPUID family 6): PerfEvtSel0 (MSR 186h) =
; event C5h (BR_MISS_PRED_RETIRED), USR (bit 16), OS (bit 17), EN (bit 22).
ctr_on: mov eax, 1
        cpuid                 ; AH bits 0-3 = the family
        and ah, 0x0F
        cmp ah, 6
        jae .p6
        mov ecx, 0x11
        mov eax, 0x15 | 0xC0
        xor edx, edx
        wrmsr
        ret
.p6:    mov dword [ctr], 0xC1
        mov ecx, 0x186
        mov eax, 0xC5 | 0x430000
        xor edx, edx
        wrmsr
        ret
` },
  {
    id: 'fdiv', model: '80586', name: 'Pentium: the FDIV test',
    desc: 'The famous test of 1994: 4195835 / 3145727 with FDIV. A Pentium with the FDIV bug gives a wrong result after the 4th significant digit.',
    src: String.raw`; The FDIV bug of the first Pentium steps (found in 1994). Five cells of the table in
; the divider of the FPU held 0 in place of 2. Some divisions then gave a wrong result
; after the 4th significant digit. The famous test:
;   x = 4195835, y = 3145727, r = x - (x / y) * y
; A correct FPU gives r = 0. A Pentium with the bug gives r = 256.
        cpu 586
        org 0x100

start:  finit
        fld qword [x]         ; ST0 = x
        fdiv qword [y]        ; ST0 = x / y: the FDIV instruction
        fld st0               ; ST0 = ST1 = x / y
        fmul qword [y]        ; ST0 = (x / y) * y
        fsubr qword [x]       ; ST0 = x - (x / y) * y
        fistp word [r]        ; r (a whole number); ST0 = x / y again
        ; --- x / y as 18 digits: FBSTP of (x / y) * 1e17
        fild dword [e8]       ; ST0 = 1e8, ST1 = x / y
        fmul st1, st0
        fmulp st1, st0        ; ST0 = (x / y) * 1e16
        fimul word [ten]      ; ST0 = (x / y) * 1e17
        fbstp [bcd]           ; 18 packed BCD digits, rounded
        fwait
        mov si, msg_head
        call puts
        mov bx, bcd + 8       ; the most significant byte first
        mov cx, 9
        xor dx, dx            ; DL = the digits on the screen
.dig:   mov al, [bx]
        shr al, 4             ; the high digit
        call digit
        mov al, [bx]
        and al, 0x0F          ; the low digit
        call digit
        dec bx
        loop .dig
        mov si, msg_r
        call puts
        mov ax, [r]
        call print_int
        ; --- the result
        mov si, msg_ok
        cmp word [r], 0
        je .p
        mov si, msg_bug
.p:     jmp puts

; one digit AL (0-9) to the screen, with the decimal point after the first digit
digit:  add al, '0'
        call putc
        inc dl
        cmp dl, 1
        jne .r
        mov al, '.'
        call putc
.r:     ret

; print AX as a signed number
print_int:
        or ax, ax
        jns .pos
        push ax
        mov al, '-'
        call putc
        pop ax
        neg ax
.pos:   mov bx, 10
        xor cx, cx
.d:     xor dx, dx
        div bx
        push dx
        inc cx
        or ax, ax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        loop .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

x:        dq 4195835.0
y:        dq 3145727.0
e8:       dd 100000000
ten:      dw 10
r:        dw 0
bcd:      times 10 db 0
msg_head: db "The FDIV test of 1994: x = 4195835, y = 3145727", 13, 10
          db "x / y           = ", 0
msg_r:    db 13, 10, "x - (x / y) * y = ", 0
msg_ok:   db 13, 10, "Result: FDIV is correct.", 13, 10, 0
msg_bug:  db 13, 10, "Result: this Pentium has the FDIV bug.", 13, 10, 0
` },
  {
    id: '4mbpage', model: '80586', name: 'Pentium: a 4 MB page',
    desc: 'CR4.PSE = 1: one page directory entry with PS = 1 maps 4 MB, with no page table. Linear 004B8000h goes to the screen at B8000h.',
    src: String.raw`; 4 MB pages on the Pentium. With CR4.PSE = 1, a page directory entry with bit 7 (PS) = 1
; maps a whole 4 MB page: no page table is necessary. Two entries do all the work here:
;   entry 0: linear 00000000h-003FFFFFh -> physical 00000000h (this program, the BIOS)
;   entry 1: linear 00400000h-007FFFFFh -> physical 00000000h again
; So linear 004B8000h is the screen at B8000h. The program writes a line of text there.
        cpu 586
        org 0x100

PDIR    equ 0x20000           ; the page directory (a physical address, 4 KB aligned)
BIG     equ 0x83              ; bit 0 present, bit 1 writable, bit 7 PS: a 4 MB page
WINDOW  equ 0x400000 + 0xB8000   ; the screen through entry 1

start:  mov si, msg_intro
        call puts
        ; --- CPUID leaf 1, EDX bit 3 (PSE): the CPU has 4 MB pages
        mov eax, 1
        cpuid
        test dl, 0x08
        jnz .pse
        mov si, msg_nopse
        jmp puts
        ; --- the page directory: entries 0 and 1 are 4 MB pages, the others are empty
.pse:   mov ax, PDIR >> 4
        mov es, ax
        xor di, di
        xor eax, eax
        mov cx, 1024
        cld
        rep stosd
        mov dword [es:0], 0x00000000 | BIG
        mov dword [es:4], 0x00000000 | BIG
        mov eax, [es:4]
        mov [pde_before], eax
        ; --- the code and data segments start where this program is (CS * 16)
        xor ebx, ebx
        mov bx, cs
        shl ebx, 4            ; EBX = the linear address of this program
        mov [code_d + 2], bx  ; base bits 0-15
        mov [data_d + 2], bx
        mov eax, ebx
        shr eax, 16
        mov [code_d + 4], al  ; base bits 16-23
        mov [data_d + 4], al
        add ebx, gdt
        mov [gdt_ptr + 2], ebx   ; the linear address of the GDT
        mov [rm_ptr + 2], cs     ; the far pointer back to real mode
        ; --- an empty line for the text. EDI = its address in the linear window.
        mov si, msg_line
        call puts
        mov ah, 3             ; INT 10h AH=03h: DH = the row of the cursor
        xor bh, bh
        int 0x10
        dec dh                ; the empty row above the cursor
        mov al, 160           ; 80 characters of 2 bytes in a row
        mul dh
        movzx edi, ax
        add edi, WINDOW
        ; --- 4 MB pages and paging on
        cli
        lgdt [gdt_ptr]
        mov eax, cr4
        or eax, 0x10          ; CR4.PSE = 1: the PS bit of a PDE works
        mov cr4, eax
        mov eax, PDIR
        mov cr3, eax          ; CR3 = the physical address of the page directory
        mov eax, cr0
        or eax, 0x80000001    ; CR0.PG = 1 (paging) and CR0.PE = 1 (protected mode)
        mov cr0, eax
        jmp CODE_SEL:pm       ; a far jump loads CS from the GDT

pm:     mov ax, DATA_SEL      ; DS = this program
        mov ds, ax
        mov ax, FLAT_SEL      ; ES = all of the 4 GB, base 0
        mov es, ax
        mov si, msg_pm
        mov ah, 0x1F          ; white on blue
.w:     lodsb
        or al, al
        jz .done
        mov [es:edi], ax      ; a linear address in the second 4 MB page
        add edi, 2
        jmp .w
.done:  mov ebx, PDIR + 4     ; entry 1 after the writes
        mov eax, [es:ebx]
        mov [pde_after], eax
        ; --- paging off, back to real mode
        mov ax, DATA_SEL      ; first a 64 KB segment in ES again
        mov es, ax
        mov eax, cr0
        and eax, 0x7FFFFFFE   ; CR0.PG = 0, CR0.PE = 0
        mov cr0, eax
        jmp far [rm_ptr]      ; real mode: CS = the segment of this program

real:   mov ax, cs
        mov ds, ax
        mov es, ax
        mov eax, cr4
        and eax, 0xFFFFFFEF   ; CR4.PSE = 0 again
        mov cr4, eax
        sti
        mov si, msg_before
        call puts
        mov eax, [pde_before]
        call print_hex32
        mov si, msg_after
        call puts
        mov eax, [pde_after]
        call print_hex32
        mov si, msg_bits
        jmp puts

; print EAX as 8 hex digits
print_hex32:
        mov cx, 8
.d:     rol eax, 4            ; the next digit to bits 0-3
        push ax
        and al, 0x0F
        add al, '0'
        cmp al, '9'
        jbe .p
        add al, 'A' - '9' - 1
.p:     mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop ax
        loop .d
        ret

puts:   lodsb
        or al, al
        jz .e
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        jmp puts
.e:     ret

; --- the global descriptor table (8 bytes each: limit, base, access, flags)
gdt:    dq 0                            ; 00h: the null descriptor
code_d: dw 0xFFFF, 0                    ; 08h: code, 64 KB, base = CS * 16
        db 0, 0x9A, 0x00, 0             ;      present, ring 0, execute/read, 16-bit
data_d: dw 0xFFFF, 0                    ; 10h: data, 64 KB, base = CS * 16
        db 0, 0x92, 0x00, 0             ;      present, ring 0, read/write
flat_d: dw 0xFFFF, 0                    ; 18h: data, base 0, limit 4 GB
        db 0, 0x92, 0x8F, 0             ;      G = 1: the limit counts 4 KB pages
gdt_end:
CODE_SEL equ code_d - gdt
DATA_SEL equ data_d - gdt
FLAT_SEL equ flat_d - gdt

gdt_ptr:    dw gdt_end - gdt - 1
            dd 0
rm_ptr:     dw real, 0
pde_before: dd 0
pde_after:  dd 0
msg_intro:  db "CR4.PSE = 1: a page directory entry with PS = 1 maps 4 MB, with no page", 13, 10
            db "table. Entry 1 sends linear 00400000h-007FFFFFh to physical 0-3FFFFFh.", 13, 10, 0
msg_nopse:  db "This CPU has no 4 MB pages (CPUID EDX bit 3 = 0).", 13, 10, 0
msg_line:   db 13, 10, 0
msg_pm:     db " This line went to linear 004B8000h. One 4 MB page sent it to B8000h. ", 0
msg_before: db "PDE 1 before: ", 0
msg_after:  db " (present, writable, PS = 1: a 4 MB page)", 13, 10, "PDE 1 after:  ", 0
msg_bits:   db " (the CPU set bit 5 A = accessed, bit 6 D = dirty)", 13, 10, 0
` });

// Samples for the Pentium Pro machine only (out-of-order execution, CMOVcc, register renaming,
// the L2 cache, the P6 performance counters). The page shows them first on the Pentium Pro, then
// the Pentium, 80486, 80386 and 80286 samples.
SAMPLES.unshift(
  {
    id: 'ooo', model: '80686', name: 'Pentium Pro: out-of-order execution',
    desc: 'A slow DIV and 20 ADD instructions in each pass, timed with RDTSC. When the ADD instructions do not need the DIV result, they run while the divider works.',
    src: String.raw`; Out-of-order execution on the Pentium Pro. The P6 decodes the instructions into micro-ops
; (µops) and keeps up to 40 of them in the reorder buffer (ROB). A µop runs when its operands
; are ready, not in the program order. The results retire in the program order.
;  Loop 1: a 32-bit DIV (39 clocks) and 20 ADD that do not need the DIV result. The ADD µops
;          pass the DIV µop: they run while the divider works.
;  Loop 2: the same DIV and 20 ADD, but each ADD needs the result of the one before it, and
;          the first ADD needs the DIV result. The ADD µops must wait.
; In each pass the DIV needs the EAX of the pass before it (a chain of divides).
; RDTSC counts the clocks. CPUID before RDTSC makes sure that all older µops are done.
        cpu 686
        org 0x100

PASSES  equ 1000

start:  mov bp, loop1         ; the loops run first: the trace shows them at once
        call time             ; EAX = the clocks of loop 1
        mov [t1], eax
        mov bp, loop2
        call time
        mov [t2], eax
        mov si, msg_head
        call puts
        mov eax, [t1]
        mov si, msg_l1
        call show
        mov eax, [t2]
        mov si, msg_l2
        call show
        mov si, msg_ratio
        call puts
        mov eax, [t2]
        mov ebx, [t1]
        call ratio            ; loop 2 / loop 1
        mov si, msg_end
        jmp puts

; Run the loop at BP two times. The first run puts the code into the caches and teaches the
; branch predictor. RDTSC times the second run. Out: EAX = its clocks.
time:   call bp
        cli                   ; no interrupts while the time runs
        xor eax, eax
        cpuid                 ; all older µops are done (CPUID is serializing)
        rdtsc                 ; EDX:EAX = the time-stamp counter
        mov [t0], eax
        call bp
        xor eax, eax
        cpuid
        rdtsc
        sti
        sub eax, [t0]         ; the low 32 bits are enough here
        ret

; Loop 1: the ADD instructions use EBX and ESI. They do not need EAX or EDX (the DIV result),
; so their µops run while the DIV µop is in the divider.
loop1:  mov eax, 1000000
        mov ecx, 3
        mov di, PASSES
.l:     mov edx, 0            ; (XOR EDX, EDX reads EDX: the P6 has no zeroing idiom)
        div ecx               ; EAX = EAX / 3: the slow instruction
        add ebx, 1
        add esi, 1
        add ebx, 2
        add esi, 2
        add ebx, 3
        add esi, 3
        add ebx, 4
        add esi, 4
        add ebx, 5
        add esi, 5
        add ebx, 6
        add esi, 6
        add ebx, 7
        add esi, 7
        add ebx, 8
        add esi, 8
        add ebx, 9
        add esi, 9
        add ebx, 10
        add esi, 10
        dec di
        jnz .l
        ret

; Loop 2: each ADD needs EAX, the result of the instruction before it. The first ADD waits
; for the DIV, and the next DIV waits for the last ADD.
loop2:  mov eax, 1000000
        mov ecx, 3
        mov di, PASSES
.l:     mov edx, 0
        div ecx               ; the slow instruction
        add eax, 1            ; it needs the DIV result
        add eax, 1            ; it needs the ADD before it
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        add eax, 1
        dec di
        jnz .l
        ret

; print the text at SI, then the clocks in EAX and the clocks for each pass
show:   push eax
        call puts
        pop eax
        push eax
        mov cx, 7
        call print_dec
        mov si, msg_clk
        call puts
        pop eax
        mov ebx, PASSES
        call ratio
        mov si, msg_each
        jmp puts

; print EAX / EBX with one decimal, for example "1.5"
ratio:  mov ecx, 10
        mul ecx               ; EDX:EAX = 10 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest tenth
        adc edx, 0
        div ebx               ; EAX = 10 times the ratio
        xor edx, edx
        mov ecx, 10
        div ecx
        push dx               ; the tenths
        xor cx, cx
        call print_dec
        mov al, '.'
        call putc
        pop ax
        add al, '0'
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.sp:    cmp cx, di
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

t0:     dd 0
t1:     dd 0
t2:     dd 0
msg_head:  db "Each pass: a 32-bit DIV (39 clocks), then 20 ADD.", 13, 10
           db "Loop 1: the ADD do not need the DIV result: they run while the divider works.", 13, 10
           db "Loop 2: each ADD needs the result before it: they wait for the DIV.", 13, 10
           db "1000 passes of each loop, timed with RDTSC:", 13, 10, 13, 10, 0
msg_l1:    db "Loop 1 (independent ADD):", 0
msg_l2:    db "Loop 2 (dependent ADD):  ", 0
msg_clk:   db " clocks, ", 0
msg_each:  db " clocks for each pass", 13, 10, 0
msg_ratio: db 13, 10, "Loop 2 takes ", 0
msg_end:   db " times the clocks of loop 1.", 13, 10
           db "Without out-of-order execution, both loops need about 39 + 20 clocks a pass.", 13, 10, 0
` },
  {
    id: 'cmov', model: '80686', name: 'Pentium Pro: CMOV (no branch)',
    desc: 'The larger of two numbers, 512 times: with CMP and a jump, then with CMOVL. On random numbers the jump goes the wrong way about half of the time; CMOVL has no jump.',
    src: String.raw`; CMOVcc (conditional move) is new on the Pentium Pro. CMOVL EAX, EDX copies EDX to EAX
; only when the flags say "less". There is no jump, so there is nothing to predict.
; The program finds the larger number of each pair (512 pairs) and adds them, two ways:
;   branch: CMP EAX, EDX / JGE / MOV EAX, EDX: the jump depends on the data.
;   CMOV:   CMP EAX, EDX / CMOVL EAX, EDX: no jump.
; Two sets of data: random numbers (the jump goes one way or the other at random, so the
; predictor guesses wrong about half of the time), and ordered numbers (the first number of
; each pair is always larger, so the predictor is always right).
; A wrong guess costs 10 or more clocks: the P6 must throw away the µops that it started on
; the wrong way. RDTSC counts the clocks.
        cpu 686
        org 0x100

PAIRS   equ 512

start:  ; --- random data: a linear congruential generator, x = x * 1103515245 + 12345
        mov eax, 20260925
        mov di, buf
        mov cx, PAIRS * 2
.r:     imul eax, eax, 1103515245
        add eax, 12345
        mov [di], eax
        add di, 4
        loop .r
        mov bp, branch
        call time
        mov [t_br], eax
        mov [s_br], ebx
        mov bp, cmov
        call time
        mov [t_cm], eax
        mov [s_cm], ebx
        ; --- ordered data: the first number of each pair is larger
        mov di, buf
        xor eax, eax
        mov cx, PAIRS
.o:     lea edx, [eax + 1000]
        mov [di], edx         ; the first number: n + 1000
        mov [di + 4], eax     ; the second number: n
        add di, 8
        inc eax
        loop .o
        mov bp, branch
        call time
        mov [t_br2], eax
        mov bp, cmov
        call time
        mov [t_cm2], eax
        ; --- the results
        mov si, msg_head
        call puts
        mov si, msg_br
        call puts
        mov eax, [t_br]
        mov cx, 9
        call each
        mov eax, [t_br2]
        mov cx, 12
        call each
        mov si, msg_cm
        call puts
        mov eax, [t_cm]
        mov cx, 9
        call each
        mov eax, [t_cm2]
        mov cx, 12
        call each
        mov si, msg_same
        mov eax, [s_br]
        cmp eax, [s_cm]
        je .p
        mov si, msg_diff
.p:     call puts
        mov si, msg_win
        call puts
        mov eax, [t_br]
        mov ebx, [t_cm]
        call ratio
        mov si, msg_end
        jmp puts

; Run the routine at BP two times, time the second run with RDTSC.
; Out: EAX = the clocks, EBX = the sum of the larger numbers.
time:   call bp
        cli
        xor eax, eax
        cpuid                 ; all older µops are done
        rdtsc
        mov [t0], eax
        call bp
        push ebx
        xor eax, eax
        cpuid
        rdtsc
        pop ebx
        sti
        sub eax, [t0]
        ret

; the larger number of each pair, with a jump
branch: xor ebx, ebx
        mov si, buf
        mov cx, PAIRS
.l:     mov eax, [si]
        mov edx, [si + 4]
        cmp eax, edx
        jge .k                ; the jump that the predictor must guess
        mov eax, edx
.k:     add ebx, eax
        add si, 8
        dec cx
        jnz .l
        ret

; the larger number of each pair, with CMOVL (no jump)
cmov:   xor ebx, ebx
        mov si, buf
        mov cx, PAIRS
.l:     mov eax, [si]
        mov edx, [si + 4]
        cmp eax, edx
        cmovl eax, edx        ; EAX = EDX when EAX < EDX (signed)
        add ebx, eax
        add si, 8
        dec cx
        jnz .l
        ret

; print EAX / PAIRS (the clocks for each pair), the integer part right-aligned in CX columns
each:   mov ebx, PAIRS
        jmp ratio

; print EAX / EBX with one decimal, right-aligned in CX columns (the integer part)
ratio:  push cx
        mov ecx, 10
        mul ecx               ; EDX:EAX = 10 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest tenth
        adc edx, 0
        div ebx               ; EAX = 10 times the ratio
        xor edx, edx
        mov ecx, 10
        div ecx
        pop cx
        push dx               ; the tenths
        call print_dec
        mov al, '.'
        call putc
        pop ax
        add al, '0'
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.sp:    cmp cx, di
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

t0:     dd 0
t_br:   dd 0
t_cm:   dd 0
t_br2:  dd 0
t_cm2:  dd 0
s_br:   dd 0
s_cm:   dd 0
msg_head: db "The larger number of each pair, 512 pairs, timed with RDTSC.", 13, 10, 13, 10
          db "Clocks for each pair:  random data  ordered data", 13, 10, 0
msg_br:   db "CMP, JGE, MOV (branch):", 0
msg_cm:   db 13, 10, "CMP, CMOVL (no branch):", 0
msg_same: db 13, 10, 13, 10, "Both ways give the same sum.", 13, 10, 0
msg_diff: db 13, 10, 13, 10, "The two sums are not the same!", 13, 10, 0
msg_win:  db "On random data CMOVL is ", 0
msg_end:  db " times faster.", 13, 10
          db "On ordered data the predictor is always right, and the jump costs no more.", 13, 10, 0
buf:
` },
  {
    id: 'rename', model: '80686', name: 'Pentium Pro: register renaming',
    desc: 'Four small jobs that all use EAX. Renaming gives each new value of EAX its own register, so the four jobs run at the same time. Then four jobs where each one needs the result of the one before it.',
    src: String.raw`; Register renaming on the Pentium Pro. The x86 has only 8 general registers, so programs
; use the same register again and again. An in-order CPU must wait until the old value of
; EAX is used before it can write a new value to EAX. The P6 renames: each new value of EAX
; gets its own physical register (an entry of the 40-entry reorder buffer), and the RAT
; (register alias table) keeps the newest name of EAX.
;  Loop 1: 4 jobs. Each job loads a new value into EAX, squares it two times (IMUL: 4 clocks)
;          and stores it. The jobs share only the name EAX: renaming lets them overlap.
;  Loop 2: the same 4 jobs, but each job adds its number to the EAX of the job before it:
;          a real dependency. No renaming can help: the jobs run one after the other.
; RDTSC counts the clocks.
        cpu 686
        org 0x100

PASSES  equ 1000

start:  mov bp, loop1
        call time
        mov [t1], eax
        mov bp, loop2
        call time
        mov [t2], eax
        mov si, msg_head
        call puts
        mov eax, [t1]
        mov si, msg_l1
        call show
        mov eax, [t2]
        mov si, msg_l2
        call show
        mov si, msg_ratio
        call puts
        mov eax, [t2]
        mov ebx, [t1]
        call ratio
        mov si, msg_end
        jmp puts

; Run the loop at BP two times, time the second run with RDTSC. Out: EAX = its clocks.
time:   call bp
        cli
        xor eax, eax
        cpuid                 ; all older µops are done
        rdtsc
        mov [t0], eax
        call bp
        xor eax, eax
        cpuid
        rdtsc
        sti
        sub eax, [t0]
        ret

; Loop 1: 4 jobs that all use EAX. Each MOV EAX, [mem] starts a new value of EAX: the RAT
; gives it a new physical register, so the job does not wait for the job before it.
loop1:  mov cx, PASSES
.l:     mov eax, [v1]         ; job 1: a new value of EAX
        imul eax, eax
        imul eax, eax
        mov [r1], eax
        mov eax, [v2]         ; job 2: a new EAX again (renamed: no wait for job 1)
        imul eax, eax
        imul eax, eax
        mov [r2], eax
        mov eax, [v3]         ; job 3
        imul eax, eax
        imul eax, eax
        mov [r3], eax
        mov eax, [v4]         ; job 4
        imul eax, eax
        imul eax, eax
        mov [r4], eax
        dec cx
        jnz .l
        ret

; Loop 2: each job adds its number to EAX of the job before it: a real dependency.
loop2:  mov cx, PASSES
        mov eax, 1
.l:     add eax, [v1]         ; job 1 needs the EAX of job 4 of the pass before
        imul eax, eax
        imul eax, eax
        mov [r1], eax
        add eax, [v2]         ; job 2 needs the EAX of job 1
        imul eax, eax
        imul eax, eax
        mov [r2], eax
        add eax, [v3]         ; job 3 needs the EAX of job 2
        imul eax, eax
        imul eax, eax
        mov [r3], eax
        add eax, [v4]         ; job 4 needs the EAX of job 3
        imul eax, eax
        imul eax, eax
        mov [r4], eax
        dec cx
        jnz .l
        ret

; print the text at SI, then the clocks in EAX and the clocks for each pass
show:   push eax
        call puts
        pop eax
        push eax
        mov cx, 7
        call print_dec
        mov si, msg_clk
        call puts
        pop eax
        mov ebx, PASSES
        call ratio
        mov si, msg_each
        jmp puts

; print EAX / EBX with one decimal, for example "2.0"
ratio:  mov ecx, 10
        mul ecx               ; EDX:EAX = 10 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest tenth
        adc edx, 0
        div ebx               ; EAX = 10 times the ratio
        xor edx, edx
        mov ecx, 10
        div ecx
        push dx               ; the tenths
        xor cx, cx
        call print_dec
        mov al, '.'
        call putc
        pop ax
        add al, '0'
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.sp:    cmp cx, di
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

v1:     dd 3
v2:     dd 5
v3:     dd 7
v4:     dd 9
r1:     dd 0
r2:     dd 0
r3:     dd 0
r4:     dd 0
t0:     dd 0
t1:     dd 0
t2:     dd 0
msg_head:  db "4 jobs in each pass: load EAX, IMUL EAX, EAX two times, store EAX.", 13, 10
           db "Loop 1: each job loads a new EAX. Renaming lets the 4 jobs overlap.", 13, 10
           db "Loop 2: each job adds to the EAX of the job before it (a real dependency).", 13, 10
           db "1000 passes of each loop, timed with RDTSC:", 13, 10, 13, 10, 0
msg_l1:    db "Loop 1 (renamed EAX):   ", 0
msg_l2:    db "Loop 2 (dependent EAX): ", 0
msg_clk:   db " clocks, ", 0
msg_each:  db " clocks for each pass", 13, 10, 0
msg_ratio: db 13, 10, "Loop 2 takes ", 0
msg_end:   db " times the clocks of loop 1.", 13, 10, 0
` },
  {
    id: 'l2', model: '80686', name: 'Pentium Pro: L1, L2 and memory',
    desc: 'Reads through a 4 KB, a 64 KB and a 1 MB array, timed with RDTSC: L1 hits, L2 hits and L2 misses (the front-side bus and memory).',
    src: String.raw`; The three levels of the memory of the Pentium Pro:
;   L1 data cache: 8 KB on the CPU die. A load that hits takes 3 clocks.
;   L2 cache: 256 KB in the same package, on the back-side bus at the CPU clock. About 4 more.
;   Memory: on the front-side bus (FSB) at 66 MHz. An L2 miss takes about 20 or more clocks.
; The program makes a chain of pointers in an array: the first dword of each 32-byte line
; (one cache line) holds the address of the next line. MOV ESI, [FS:ESI] follows the chain,
; so each read must wait for the read before it: the time of a read is its latency.
; Three arrays at 2 MB: 4 KB (fits in the L1), 64 KB (fits in the L2), 1 MB (fits in none).
; Each array gets 32768 reads. RDTSC counts the clocks.
; Memory above 1 MB in real mode: the program sets the A20 gate, then loads FS in protected
; mode with a limit of 4 GB and goes back to real mode. FS keeps the limit ("unreal mode"),
; so [FS:ESI] can use a 32-bit offset.
        cpu 686
        org 0x100

BASE    equ 0x200000          ; the arrays start at 2 MB
READS   equ 32768

start:  ; --- the A20 gate on (port 92h bit 1): addresses with bit 20 = 1 reach the memory
        in al, 0x92
        mov [old92], al
        or al, 0x02
        and al, 0xFE          ; bit 0 = 0: no CPU reset
        out 0x92, al
        ; --- unreal mode: FS gets a base of 0 and a limit of 4 GB
        xor ebx, ebx
        mov bx, cs
        shl ebx, 4
        add ebx, gdt
        mov [gdt_ptr + 2], ebx   ; the linear address of the GDT
        cli
        lgdt [gdt_ptr]
        mov eax, cr0
        or al, 1
        mov cr0, eax          ; protected mode
        jmp .pm               ; (a jump after the change of CR0)
.pm:    mov bx, FLAT_SEL
        mov fs, bx            ; the descriptor cache of FS: base 0, limit 4 GB
        and al, 0xFE
        mov cr0, eax          ; real mode again; FS keeps its limit
        jmp .rm
.rm:    xor ax, ax
        mov fs, ax            ; FS = 0: base 0, the limit stays 4 GB
        sti
        ; --- the three arrays
        mov ecx, 4096
        call measure
        mov [t1], eax
        mov ecx, 65536
        call measure
        mov [t2], eax
        mov ecx, 1048576
        call measure
        mov [t3], eax
        mov al, [old92]
        out 0x92, al          ; the A20 gate as before
        ; --- the results
        mov si, msg_head
        call puts
        mov si, msg_4k
        mov eax, [t1]
        call show
        mov si, msg_64k
        mov eax, [t2]
        call show
        mov si, msg_1m
        mov eax, [t3]
        call show
        mov si, msg_end
        jmp puts

; Make the chain in the array of ECX bytes at BASE, follow it one time (the first run fills
; the caches), then time READS reads. Out: EAX = the clocks.
measure:
        mov [size], ecx
        mov esi, BASE
        lea edi, [esi + ecx]  ; EDI = the end of the array
.mk:    lea eax, [esi + 32]
        cmp eax, edi
        jb .st
        mov eax, BASE         ; the last line points to the first line
.st:    mov [fs:esi], eax
        mov esi, eax
        cmp esi, BASE
        jne .mk
        mov ecx, [size]
        shr ecx, 5            ; the lines of the array
        call chase            ; the first run
        cli
        xor eax, eax
        cpuid                 ; all older µops are done
        rdtsc
        mov [t0], eax
        mov ecx, READS
        call chase
        xor eax, eax
        cpuid
        rdtsc
        sti
        sub eax, [t0]
        ret

; follow the chain ECX times from BASE
chase:  mov esi, BASE
.l:     mov esi, [fs:esi]     ; the next address comes from this read
        dec ecx
        jnz .l
        ret

; print the text at SI, then the clocks for each read (EAX / READS) and for each byte of it
show:   push eax
        call puts
        pop eax
        push eax
        mov ebx, READS
        mov cx, 3
        call hundredths       ; clocks for each read
        mov si, msg_read
        call puts
        pop eax
        mov ebx, READS * 32
        xor cx, cx
        call hundredths       ; clocks for each byte of the 32-byte line
        mov si, msg_byte
        jmp puts

; print EAX / EBX with two decimals, the integer part right-aligned in CX columns
hundredths:
        push cx
        mov ecx, 100
        mul ecx               ; EDX:EAX = 100 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest hundredth
        adc edx, 0
        div ebx               ; EAX = 100 times the ratio
        xor edx, edx
        mov ecx, 100
        div ecx
        pop cx
        push dx               ; the hundredths
        call print_dec
        mov al, '.'
        call putc
        pop ax
        aam                   ; AH = the tenths, AL = the hundredths
        add ax, 0x3030
        xchg al, ah
        call putc
        mov al, ah
        jmp putc

; print EAX in decimal, right-aligned in CX columns (CX = 0: no spaces)
print_dec:
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.sp:    cmp cx, di
        jbe .o
        mov al, ' '
        call putc
        dec cx
        jmp .sp
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

; --- the global descriptor table: the null descriptor and one flat data descriptor
gdt:    dq 0
flat_d: dw 0xFFFF, 0                    ; 08h: data, base 0, limit 4 GB
        db 0, 0x92, 0x8F, 0             ;      G = 1: the limit counts 4 KB pages
gdt_end:
FLAT_SEL equ flat_d - gdt

gdt_ptr:  dw gdt_end - gdt - 1
          dd 0
old92:    db 0
size:     dd 0
t0:       dd 0
t1:       dd 0
t2:       dd 0
t3:       dd 0
msg_head: db "A chain of pointers, one in each 32-byte line. Each read waits for the read", 13, 10
          db "before it. 32768 reads in each array, timed with RDTSC:", 13, 10, 13, 10, 0
msg_4k:   db "4 KB array  (L1 hits):  ", 0
msg_64k:  db "64 KB array (L2 hits):  ", 0
msg_1m:   db "1 MB array  (L2 misses):", 0
msg_read: db " clocks for each read, ", 0
msg_byte: db " for each byte", 13, 10, 0
msg_end:  db 13, 10, "The L1 is 8 KB, the L2 is 256 KB. A miss in both goes to memory on the FSB.", 13, 10, 0
` },
  {
    id: 'pmc', model: '80686', name: 'Pentium Pro: performance counters',
    desc: 'WRMSR selects the P6 events, RDPMC reads the two counters: the instructions and µops of a small loop, then its branches and the wrong predictions.',
    src: String.raw`; The performance counters of the Pentium Pro. Two 40-bit counters (MSR C1h and C2h) count
; the events that the event select registers (MSR 186h and 187h) name. Bit 22 (EN) of MSR 186h
; starts both counters. RDPMC reads a counter: ECX = 0 or 1, the result in EDX:EAX.
; The events here:
;   C0h: instructions retired         C2h: µops retired
;   C4h: branches retired             C5h: branches that the CPU predicted wrong
; The counts also have the instructions that start and stop the counters. The program
; counts an empty routine first and subtracts its counts.
; (Real mode is CPL 0, so RDPMC works here also with CR4.PCE = 0.)
        cpu 686
        org 0x100

PASSES  equ 100
EV_INST equ 0xC0              ; INST_RETIRED
EV_UOPS equ 0xC2              ; UOPS_RETIRED
EV_BR   equ 0xC4              ; BR_INST_RETIRED
EV_MISS equ 0xC5              ; BR_MISS_PRED_RETIRED
USR_OS  equ 0x30000           ; bit 16 USR, bit 17 OS: count at all privilege levels
EN      equ 0x400000          ; bit 22: the counters count

start:  mov si, msg_head
        call puts
        ; --- 1. instructions and µops of the loop
        mov dword [ev0], EV_INST
        mov dword [ev1], EV_UOPS
        mov bp, adds
        call net
        mov si, msg_inst
        call puts
        mov eax, [n0]
        call print_dec
        mov si, msg_uops
        call puts
        mov eax, [n1]
        call print_dec
        mov si, msg_per
        call puts
        mov eax, [n1]
        mov ebx, [n0]
        call ratio
        mov si, msg_per2
        call puts
        ; --- 2. branches and wrong predictions
        mov dword [ev0], EV_BR
        mov dword [ev1], EV_MISS
        mov si, msg_turn
        mov bp, turn
        call branches
        mov si, msg_rnd
        mov bp, random
        call branches
        mov si, msg_end
        jmp puts

; the counts of the routine at BP for the text at SI: branches and wrong predictions
branches:
        call puts
        call net
        mov si, msg_br
        call puts
        mov eax, [n0]
        call print_dec
        mov si, msg_miss
        call puts
        mov eax, [n1]
        call print_dec
        mov si, msg_nl
        jmp puts

; The routine at BP runs two times (the first run teaches the branch predictor). The counts of
; the second run, less the counts of an empty routine: [n0] = counter 0, [n1] = counter 1.
net:    call bp
        push bp
        mov bp, empty
        call count
        pop bp
        mov [n0], eax
        mov [n1], ebx
        call count
        sub eax, [n0]
        sub ebx, [n1]
        mov [n0], eax
        mov [n1], ebx
        ret

; Count the routine at BP: counter 0 = event [ev0], counter 1 = event [ev1].
; Out: EAX = counter 0, EBX = counter 1 (the low 32 bits).
count:  xor eax, eax
        xor edx, edx
        mov ecx, 0xC1
        wrmsr                 ; PerfCtr0 = 0
        mov ecx, 0xC2
        wrmsr                 ; PerfCtr1 = 0
        mov eax, [ev1]
        or eax, USR_OS
        mov ecx, 0x187
        wrmsr                 ; PerfEvtSel1: the event of counter 1
        mov eax, [ev0]
        or eax, USR_OS | EN
        mov ecx, 0x186
        wrmsr                 ; PerfEvtSel0: the event of counter 0, and EN starts both
        call bp
        xor eax, eax
        xor edx, edx
        mov ecx, 0x186
        wrmsr                 ; EN = 0: both counters stop
        mov ecx, 1
        rdpmc
        mov ebx, eax          ; counter 1
        xor ecx, ecx
        rdpmc                 ; counter 0
        ret

empty:  ret

; MOV CX, 100 (1 µop), then 100 passes of 4 instructions: ADD r, r (1 µop), ADD m, r (4 µops:
; load, add, store address, store data), DEC (1 µop), JNZ (1 µop). 401 instructions, 701 µops.
adds:   mov cx, PASSES
.l:     add eax, ebx
        add [v], eax
        dec cx
        jnz .l
        ret

; 100 passes with a JZ that jumps in turn: taken, not taken, taken ... The P6 keeps the
; last 4 ways of each branch, so it learns this pattern.
turn:   mov cx, PASSES
        xor dx, dx
.l:     test dx, 1
        jz .n                 ; the jump under test (to the next instruction)
.n:     inc dx
        dec cx
        jnz .l
        ret

; 100 passes with a JZ that jumps at random (bit 16 of a linear congruential generator)
random: mov cx, PASSES
        mov eax, 12345
.l:     imul eax, eax, 1103515245
        add eax, 12345
        test eax, 0x10000
        jz .n                 ; the jump under test
.n:     dec cx
        jnz .l
        ret

; print EAX / EBX with two decimals
ratio:  mov ecx, 100
        mul ecx               ; EDX:EAX = 100 times EAX
        mov ecx, ebx
        shr ecx, 1
        add eax, ecx          ; round to the nearest hundredth
        adc edx, 0
        div ebx
        xor edx, edx
        mov ecx, 100
        div ecx
        push dx               ; the hundredths
        call print_dec
        mov al, '.'
        call putc
        pop ax
        aam                   ; AH = the tenths, AL = the hundredths
        add ax, 0x3030
        xchg al, ah
        call putc
        mov al, ah
        jmp putc

; print EAX in decimal
print_dec:
        push ebx
        mov ebx, 10
        xor di, di            ; DI counts the digits
.d:     xor edx, edx
        div ebx
        push dx
        inc di
        or eax, eax
        jnz .d
.o:     pop ax
        add al, '0'
        call putc
        dec di
        jnz .o
        pop ebx
        ret

; one character to the screen (INT 10h AH=0Eh)
putc:   push ax
        push bx
        mov ah, 0x0E
        mov bx, 0x0007
        int 0x10
        pop bx
        pop ax
        ret

puts:   lodsb
        or al, al
        jz .e
        call putc
        jmp puts
.e:     ret

v:      dd 0
ev0:    dd 0
ev1:    dd 0
n0:     dd 0
n1:     dd 0
msg_head: db "The routine: MOV CX, 100, then 100 passes of", 13, 10
          db "ADD EAX, EBX / ADD [v], EAX / DEC CX / JNZ (401 instructions).", 13, 10, 13, 10, 0
msg_inst: db "Instructions retired (event C0h): ", 0
msg_uops: db 13, 10, "Micro-ops retired (event C2h):    ", 0
msg_per:  db 13, 10, "Micro-ops for each instruction:   ", 0
msg_per2: db 13, 10, 13, 10, "100 passes with a JZ (events C4h and C5h):", 13, 10, 0
msg_turn: db "JZ in turn (taken, not taken): ", 0
msg_rnd:  db "JZ at random:                  ", 0
msg_br:   db "branches ", 0
msg_miss: db ", wrong predictions ", 0
msg_nl:   db 13, 10, 0
msg_end:  db 13, 10, "The P6 learns a pattern of taken and not taken. It cannot learn random jumps.", 13, 10, 0
` });

// Samples for the VGA card only (the list shows them when the VGA is selected).
// They use 8086 instructions, so they run on both machines.
SAMPLES.push(
  {
    id: 'plasma', video: 'vga', name: 'VGA: plasma palette (mode 13h)',
    desc: 'A 320x200 picture in 256 colours that moves only by rotating the DAC palette at each vertical retrace. A key ends it.',
    src: String.raw`; Plasma in mode 13h. The picture is drawn once; the motion comes only
; from the DAC: 256 new colours at each vertical retrace. Press a key to end.
        org 0x100

start:  mov ax, 0x0013          ; BIOS: 320x200, 256 colours (chain 4)
        int 0x10
        call make_sine
        call draw
frame:  call vsync              ; change the colours while the beam is off
        call set_palette
        inc byte [phase]
        mov ah, 1               ; INT 16h AH=1: ZF = 0 when a key waits
        int 0x16
        jz frame
        xor ah, ah              ; take the key
        int 0x16
        mov ax, 0x0003          ; back to 80x25 text
        int 0x10
        ret

; sine[i] = 64 * sin(2 pi i / 256), from the parabola x * (128 - x)
make_sine:
        xor bx, bx
.l:     mov al, bl
        and al, 127
        mov cl, 128
        sub cl, al
        mul cl                  ; AX = x * (128 - x), at most 4096
        mov cl, 6
        shr ax, cl              ; 0..64
        test bl, 128            ; the second half is negative
        jz .p
        neg al
.p:     mov [sine + bx], al
        inc bl
        jnz .l
        ret

; colour(x, y) = 128 + (s[2x] + s[3y] + s[x+y] + s[2(x-y)]) / 2
draw:   mov ax, 0xA000
        mov es, ax
        xor di, di
        cld
        xor dx, dx              ; DX = y
.row:   xor cx, cx              ; CX = x
.px:    xor bh, bh
        mov bl, cl
        shl bl, 1
        mov al, [sine + bx]
        cbw
        mov si, ax
        mov bl, dl
        mov al, dl
        shl bl, 1
        add bl, al
        mov al, [sine + bx]
        cbw
        add si, ax
        mov bl, cl
        add bl, dl
        mov al, [sine + bx]
        cbw
        add si, ax
        mov bl, cl
        sub bl, dl
        shl bl, 1
        mov al, [sine + bx]
        cbw
        add ax, si
        sar ax, 1
        add ax, 128
        stosb                   ; chain 4: byte A000:y*320+x is one pixel
        inc cx
        cmp cx, 320
        jb .px
        inc dx
        cmp dx, 200
        jb .row
        ret

; DAC: port 3C8h = first colour, then red, green, blue (0..63) to port 3C9h
set_palette:
        mov dx, 0x3C8
        xor al, al
        out dx, al
        inc dx
        xor cx, cx              ; CL = colour number
        xor bh, bh
.c:     mov bl, cl
        add bl, [phase]
        mov al, [sine + bx]     ; red
        call level
        out dx, al
        add bl, 85              ; green: one third of a turn later
        mov al, [sine + bx]
        call level
        out dx, al
        add bl, cl              ; blue: twice as fast
        mov al, [sine + bx]
        call level
        out dx, al
        inc cl
        jnz .c
        ret

; AL = -64..64 -> 0..63
level:  sar al, 1
        add al, 32
        cmp al, 63
        jbe .ok
        mov al, 63
.ok:    ret

; wait for the start of the next vertical retrace (port 3DAh bit 3)
vsync:  mov dx, 0x3DA
.a:     in al, dx
        test al, 8
        jnz .a
.b:     in al, dx
        test al, 8
        jz .b
        ret

phase:  db 0
sine:   times 256 db 0
` },
  {
    id: 'wheel', video: 'vga', name: 'VGA: colour wheel (mode 12h)',
    desc: '1120 lines in 640x480, 16 colours. Write mode 2: the data byte is the colour, the bit mask picks the pixel. Then the palette turns. A key ends it.',
    src: String.raw`; A colour wheel in mode 12h (640x480, 16 colours, 4 planes).
; Each pixel: the bit mask register (GC index 8) selects it, a read loads the
; latches (so the other 7 pixels of the byte keep their colour), and a write in
; write mode 2 puts the colour (bits 0-3 of the data) into all 4 planes at once.
        org 0x100

start:  mov ax, 0x0012          ; BIOS: 640x480, 16 colours
        int 0x10
        mov ax, 0xA000
        mov es, ax
        mov dx, 0x3CE
        mov ax, 0x0205          ; GC 5 = 2: write mode 2
        out dx, ax
        mov al, 8               ; GC index 8 = the bit mask; DX = 3CFh from now on
        out dx, al
        inc dx
        ; rays from the centre to every 2nd pixel of the edge, clockwise from the top left
        xor cx, cx
.top:   mov ax, cx              ; top: (x, 0)
        xor bx, bx
        call ray
        add cx, 2
        cmp cx, 640
        jb .top
        xor cx, cx
.right: mov ax, 639             ; right: (639, y)
        mov bx, cx
        call ray
        add cx, 2
        cmp cx, 480
        jb .right
        mov cx, 639
.bot:   mov ax, cx              ; bottom: (x, 479)
        mov bx, 479
        call ray
        sub cx, 2
        jns .bot
        mov cx, 479
.left:  xor ax, ax              ; left: (0, y)
        mov bx, cx
        call ray
        sub cx, 2
        jns .left
        mov ax, 0xFF08          ; bit mask FFh and write mode 0 again, for the BIOS
        dec dx
        out dx, ax
        mov ax, 0x0005
        out dx, ax
        ; turn the wheel: move the 15 palette registers by one step (INT 10h AX=1002h)
spin:   mov cx, 5
.w:     call vsync
        loop .w
        mov si, pal + 1
        mov al, [si]
        mov di, si
        push ds
        pop es
        inc si
        mov cx, 14
        cld
        rep movsb
        mov [di], al
        mov dx, pal             ; ES:DX = 16 palette registers + overscan
        mov ax, 0x1002
        int 0x10
        mov ah, 1
        int 0x16
        jz spin
        xor ah, ah
        int 0x16
        mov ax, 0x0003
        int 0x10
        ret

; a ray from (320, 240) to (AX, BX); the colour goes once round the wheel
ray:    push ax
        push bx
        push cx
        push dx
        mov [x1], ax
        mov [y1], bx
        mov word [x0], 320
        mov word [y0], 240
        mov ax, [count]         ; colour = 1 + count * 15 / 1120
        mov bx, 15
        mul bx
        mov bx, 1120
        div bx
        inc al
        mov [colour], al
        inc word [count]
        pop dx
        call line
        pop cx
        pop bx
        pop ax
        ret

; Bresenham line (x0, y0) - (x1, y1) in colour [colour]. DX = 3CFh.
line:   mov ax, [x0]
        cmp ax, [x1]
        jle .lr
        xchg ax, [x1]           ; always from left to right
        mov [x0], ax
        mov ax, [y0]
        xchg ax, [y1]
        mov [y0], ax
.lr:    push dx
        mov ax, [y0]            ; DI = y0 * 80 + x0 / 8
        mov bx, 80
        mul bx
        mov di, ax
        mov ax, [x0]
        mov cl, 3
        shr ax, cl
        add di, ax
        mov cx, [x0]
        and cl, 7
        mov ah, 0x80            ; AH = the bit of pixel x0
        shr ah, cl
        pop dx
        mov bl, [colour]
        mov bp, 80              ; BP = +80 or -80 bytes a line
        mov cx, [x1]
        sub cx, [x0]
        mov [ddx], cx
        mov cx, [y1]
        sub cx, [y0]
        jns .dy
        neg cx
        neg bp
.dy:    mov [ddy], cx
        cmp cx, [ddx]
        ja .ymaj
        mov cx, [ddx]           ; x major: one pixel for each x
        mov si, cx
        shr si, 1
        inc cx
.xl:    mov al, ah
        out dx, al              ; bit mask = this pixel
        mov al, [es:di]         ; load the latches
        mov [es:di], bl         ; write mode 2: the colour
        ror ah, 1               ; next x: the bit moves right...
        adc di, 0               ; ...and into the next byte after bit 0
        sub si, [ddy]
        jns .xn
        add si, [ddx]
        add di, bp
.xn:    loop .xl
        ret
.ymaj:  mov si, cx              ; y major: one pixel for each y
        shr si, 1
        inc cx
.yl:    mov al, ah
        out dx, al
        mov al, [es:di]
        mov [es:di], bl
        add di, bp
        sub si, [ddx]
        jns .yn
        add si, [ddy]
        ror ah, 1
        adc di, 0
.yn:    loop .yl
        ret

vsync:  push dx
        mov dx, 0x3DA
.a:     in al, dx
        test al, 8
        jnz .a
.b:     in al, dx
        test al, 8
        jz .b
        pop dx
        ret

x0:     dw 0
y0:     dw 0
x1:     dw 0
y1:     dw 0
ddx:    dw 0
ddy:    dw 0
count:  dw 0
colour: db 0
; the 16 palette registers of mode 12h (EGA colour numbers) and the overscan
pal:    db 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x14, 0x07
        db 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x00
` },
  {
    id: 'modex', video: 'vga', name: 'VGA: Mode X page flipping',
    desc: 'Unchained 256 colours: draw in the hidden page, show it with the CRTC start address at the vertical retrace. A key ends it.',
    src: String.raw`; Mode X: 320x200 in 256 colours with chain 4 off. The 4 planes give 4 pages
; of 16000 bytes (4 pixels a byte, one in each plane). The ball is drawn in the
; hidden page, then the CRTC start address shows that page. The CRTC loads the
; new start at the vertical retrace, so the program waits for it (port 3DAh).
        org 0x100
PAGE0   equ 0
PAGE1   equ 16000
BACK    equ 32000               ; the background picture (page 2)

start:  mov ax, 0x0013          ; BIOS mode 13h first, then change 3 registers
        int 0x10
        mov dx, 0x3C4
        mov ax, 0x0604          ; sequencer memory mode: chain 4 off
        out dx, ax
        mov dx, 0x3D4
        mov ax, 0x0014          ; CRTC 14h: doubleword mode off
        out dx, ax
        mov ax, 0xE317          ; CRTC 17h: byte mode
        out dx, ax
        mov ax, 0xA000
        mov es, ax
        cld
        call map_all
        xor di, di              ; clear all 4 planes
        xor ax, ax
        mov cx, 0x8000
        rep stosw
        call colours
        call backdrop
        mov di, PAGE0           ; both pages get the background
        call copy_back
        mov di, PAGE1
        call copy_back
        call make_ball
frame:  mov bl, [back]          ; BX = 0 or 2: the hidden page
        xor bh, bh
        shl bl, 1
        mov ax, [oldx + bx]     ; erase the ball this page had 2 frames ago
        mov cx, [oldy + bx]
        mov di, [page + bx]
        call restore
        call move
        mov ax, [bx_]
        mov cx, [by_]
        mov [oldx + bx], ax
        mov [oldy + bx], cx
        call draw_ball
        mov bx, [page + bx]     ; show the page: CRTC 0Ch/0Dh = start address
        mov dx, 0x3D4
        mov al, 0x0C
        mov ah, bh
        out dx, ax
        mov al, 0x0D
        mov ah, bl
        out dx, ax
        call vsync              ; the new start takes effect at the retrace
        xor byte [back], 1
        mov ah, 1
        int 0x16
        jz frame
        xor ah, ah
        int 0x16
        mov ax, 0x0003
        int 0x10
        ret

map_all:
        mov dx, 0x3C4
        mov ax, 0x0F02          ; map mask: all 4 planes
        out dx, ax
        ret

; DAC: 16-111 sky (blue to orange), 128-191 ball (white to deep red), 200-201 ground
colours:
        mov dx, 0x3C8
        mov al, 16
        out dx, al
        inc dx
        xor cx, cx
.sky:   mov al, cl              ; red rises
        shr al, 1
        out dx, al
        mov al, cl              ; green a little
        shr al, 1
        shr al, 1
        add al, 8
        out dx, al
        mov al, 48              ; blue falls
        mov ah, cl
        shr ah, 1
        sub al, ah
        out dx, al
        inc cx
        cmp cx, 96
        jb .sky
        mov dx, 0x3C8
        mov al, 128
        out dx, al
        inc dx
        xor cx, cx
.ball:  mov al, 63              ; red stays high, green and blue fall
        out dx, al
        mov al, 63
        sub al, cl
        jns .g
        xor al, al
.g:     out dx, al
        out dx, al
        inc cx
        cmp cx, 64
        jb .ball
        mov dx, 0x3C8
        mov al, 200
        out dx, al
        inc dx
        mov al, 10              ; two greens for the ground
        out dx, al
        mov al, 30
        out dx, al
        mov al, 12
        out dx, al
        mov al, 6
        out dx, al
        mov al, 22
        out dx, al
        mov al, 8
        out dx, al
        ret

; the background at BACK: 150 lines of sky, then a checkered ground.
; With the map mask at 0Fh one byte writes 4 pixels of one colour.
backdrop:
        call map_all
        mov di, BACK
        xor dx, dx              ; DX = line
.l:     cmp dx, 150
        jae .g
        mov ax, dx              ; sky colour 16 + line * 96 / 150
        mov bx, 96
        push dx
        mul bx
        mov bx, 150
        div bx
        pop dx
        add al, 16
        mov cx, 80
        rep stosb
        jmp .n
.g:     xor cx, cx              ; ground: squares of 8 bytes (32 pixels) and 8 lines
.gb:    mov al, cl
        shr al, 1
        shr al, 1
        shr al, 1
        mov ah, dl
        shr ah, 1
        shr ah, 1
        shr ah, 1
        xor al, ah
        and al, 1
        add al, 200
        stosb
        inc cx
        cmp cx, 80
        jb .gb
.n:     inc dx
        cmp dx, 200
        jb .l
        ret

; copy the background to the page at DI with write mode 1: each byte read loads
; the 4 latches, each write stores them, so one MOVSB moves 4 pixels
copy_back:
        call map_all
        mov dx, 0x3CE
        mov ax, 0x4105          ; GC 5: 256-colour shift, write mode 1
        out dx, ax
        push ds
        mov ax, es
        mov ds, ax
        mov si, BACK
        mov cx, 16000
        rep movsb
        pop ds
        mov ax, 0x4005          ; write mode 0 again
        out dx, ax
        ret

; erase: copy 5 bytes x 16 lines of the background at (AX, CX) into the page at DI
restore:
        push bx
        push di
        mov bx, ax
        mov ax, 80
        mul cx
        shr bx, 1
        shr bx, 1
        add ax, bx              ; AX = y * 80 + x / 4
        add di, ax              ; destination in the page
        mov si, ax
        add si, BACK            ; the same place in the background
        call map_all
        mov dx, 0x3CE
        mov ax, 0x4105          ; write mode 1: copy through the latches
        out dx, ax
        push ds
        push es
        pop ds
        mov bx, 16
.l:     mov cx, 5
        rep movsb
        add si, 80 - 5
        add di, 80 - 5
        dec bx
        jnz .l
        pop ds
        mov ax, 0x4005
        out dx, ax
        pop di
        pop bx
        ret

; move the ball and bounce at the edges
move:   mov ax, [bx_]
        add ax, [vx]
        cmp ax, 0
        jl .fx
        cmp ax, 320 - 16
        jle .okx
.fx:    neg word [vx]
        mov ax, [bx_]
.okx:   mov [bx_], ax
        mov ax, [by_]
        add ax, [vy]
        cmp ax, 0
        jl .fy
        cmp ax, 200 - 16
        jle .oky
.fy:    neg word [vy]
        mov ax, [by_]
.oky:   mov [by_], ax
        ret

; draw the 16x16 ball at (bx_, by_) in the page at DI. Pixel x is in plane x AND 3,
; byte x / 4: so the program draws one plane at a time (map mask = that plane).
draw_ball:
        push bx
        mov [cur_page], di
        mov ax, [by_]
        mov bx, 80
        mul bx
        add di, ax              ; DI = page + y * 80
        xor cx, cx              ; CX = column 0..3 of the first pass
.pl:    mov ax, [bx_]
        add ax, cx              ; screen x of this column
        push cx
        mov cl, al
        and cl, 3
        mov ah, 1
        shl ah, cl              ; map mask: the plane of this x
        mov dx, 0x3C4
        mov al, 2
        out dx, ax
        pop cx
        mov si, ball
        add si, cx
        mov ax, [bx_]
        add ax, cx
        shr ax, 1
        shr ax, 1
        mov bx, di
        add bx, ax              ; BX = first byte of this column
        push cx
        mov dx, 4               ; columns c, c+4, c+8, c+12
.col:   push si
        push bx
        mov cx, 16
.row:   mov al, [si]
        or al, al               ; 0 = transparent
        jz .skip
        mov [es:bx], al
.skip:  add si, 16
        add bx, 80
        loop .row
        pop bx
        pop si
        add si, 4
        inc bx
        dec dx
        jnz .col
        pop cx
        inc cx
        cmp cx, 4
        jb .pl
        mov di, [cur_page]
        pop bx
        ret

; the ball: inside the circle, colour 128 + distance^2 from a light at (5, 5)
make_ball:
        mov di, ball
        xor dx, dx              ; DL = row, DH = column
.r:     xor dh, dh
.c:     mov al, dl              ; dy = 2 * row - 15
        shl al, 1
        sub al, 15
        imul al
        mov bx, ax
        mov al, dh              ; dx = 2 * column - 15
        shl al, 1
        sub al, 15
        imul al
        add bx, ax              ; BX = distance^2 from the centre (x 4)
        xor al, al
        cmp bx, 240
        jae .out
        mov al, dl
        shl al, 1
        sub al, 9
        imul al
        mov bx, ax
        mov al, dh
        shl al, 1
        sub al, 9
        imul al
        add ax, bx
        mov cl, 3
        shr ax, cl
        cmp ax, 63
        jbe .s
        mov ax, 63
.s:     add al, 128
.out:   mov [di], al
        inc di
        inc dh
        cmp dh, 16
        jb .c
        inc dl
        cmp dl, 16
        jb .r
        ret

vsync:  mov dx, 0x3DA
.a:     in al, dx
        test al, 8
        jnz .a
.b:     in al, dx
        test al, 8
        jz .b
        ret

back:   db 1                    ; the hidden page: 0 or 1
page:   dw PAGE0, PAGE1
oldx:   dw 40, 40
oldy:   dw 30, 30
bx_:    dw 40                   ; ball position and speed
by_:    dw 30
vx:     dw 3
vy:     dw 2
cur_page: dw 0
ball:   times 256 db 0
` });
