// VGA video BIOS: an original option ROM for the VGA card (C000:0000 - C000:7FFF).
// 8086 assembly in NASM syntax, assembled by Asm86 at start-up like the system BIOS.
// The system BIOS POST finds the 55AAh signature and far-calls C000:0003. The ROM
// then programs the card for mode 3, loads the font into plane 2 and hooks INT 10h.
// The tables (mode parameters in the IBM layout, the DAC palettes) are generated below;
// the fonts are drawn by the page at start-up (makeVgaRom patches them in).

const VGA_BIOS_SOURCE = (() => {
  // ---------- mode parameter table (IBM layout, 64 bytes per entry) ----------
  // cols, rows-1, char height, page size, sequencer 1-4, misc, CRTC 0-24, attribute 0-19, GC 0-8
  const A_TEXT = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x14, 0x07, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F];
  const A_CGA = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17];
  const A_MONO = [0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x10, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18];
  const G_TEXT = [0, 0, 0, 0, 0, 0x10, 0x0E, 0x00, 0xFF], G_MONO = [0, 0, 0, 0, 0, 0x10, 0x0A, 0x00, 0xFF];
  const G_PLANAR = [0, 0, 0, 0, 0, 0x00, 0x05, 0x0F, 0xFF];
  const crt = (h, vt, ovf, msl, cs, ce, vrs, vre, vde, off, ul, vbs, vbe, mc) =>
    [h[0], h[1], h[2], h[3], h[4], h[5], vt, ovf, 0x00, msl, cs, ce, 0, 0, 0, 0, vrs, vre, vde, off, ul, vbs, vbe, mc, 0xFF];
  const H40 = [0x2D, 0x27, 0x28, 0x90, 0x2B, 0xA0], H80 = [0x5F, 0x4F, 0x50, 0x82, 0x55, 0x81];
  const H40G = [0x2D, 0x27, 0x28, 0x90, 0x2B, 0x80], H80G = [0x5F, 0x4F, 0x50, 0x82, 0x54, 0x80];
  const e = (cols, rows, ch, psize, seq, misc, crtc, attr, gc) => {
    const b = [cols, rows, ch, psize & 0xFF, psize >> 8, ...seq, misc, ...crtc, ...attr, ...gc];
    if (b.length !== 64) throw new Error('VGA parameter entry size ' + b.length);
    return b;
  };
  const T200 = (c40) => e(c40 ? 40 : 80, 24, 8, c40 ? 0x800 : 0x1000, [c40 ? 0x09 : 0x01, 0x03, 0x00, 0x02], 0x63,
    crt(c40 ? H40 : H80, 0xBF, 0x1F, 0xC7, 0x06, 0x07, 0x9C, 0x8E, 0x8F, c40 ? 0x14 : 0x28, 0x1F, 0x96, 0xB9, 0xA3), [...A_CGA, 0x08, 0x00, 0x0F, 0x00], G_TEXT);
  const T350 = (c40) => e(c40 ? 40 : 80, 24, 14, c40 ? 0x800 : 0x1000, [c40 ? 0x09 : 0x01, 0x03, 0x00, 0x02], 0xA3,
    crt(c40 ? H40 : H80, 0xBF, 0x1F, 0x4D, 0x0B, 0x0C, 0x83, 0x85, 0x5D, c40 ? 0x14 : 0x28, 0x1F, 0x63, 0xBA, 0xA3), [...A_TEXT, 0x08, 0x00, 0x0F, 0x00], G_TEXT);
  const T400 = (c40) => e(c40 ? 40 : 80, 24, 16, c40 ? 0x800 : 0x1000, [c40 ? 0x08 : 0x00, 0x03, 0x00, 0x02], 0x67,
    crt(c40 ? H40 : H80, 0xBF, 0x1F, 0x4F, 0x0D, 0x0E, 0x9C, 0x8E, 0x8F, c40 ? 0x14 : 0x28, 0x1F, 0x96, 0xB9, 0xA3), [...A_TEXT, 0x0C, 0x00, 0x0F, 0x08], G_TEXT);
  const M350 = e(80, 24, 14, 0x1000, [0x00, 0x03, 0x00, 0x02], 0xA6,
    crt(H80, 0xBF, 0x1F, 0x4D, 0x0B, 0x0C, 0x83, 0x85, 0x5D, 0x28, 0x0D, 0x63, 0xBA, 0xA3), [...A_MONO, 0x0E, 0x00, 0x0F, 0x08], G_MONO);
  const M400 = e(80, 24, 16, 0x1000, [0x00, 0x03, 0x00, 0x02], 0x66,
    crt(H80, 0xBF, 0x1F, 0x4F, 0x0D, 0x0E, 0x9C, 0x8E, 0x8F, 0x28, 0x0F, 0x96, 0xB9, 0xA3), [...A_MONO, 0x0E, 0x00, 0x0F, 0x08], G_MONO);
  const M4 = e(40, 24, 8, 0x4000, [0x09, 0x03, 0x00, 0x02], 0x63,
    crt(H40G, 0xBF, 0x1F, 0xC1, 0, 0, 0x9C, 0x8E, 0x8F, 0x14, 0x00, 0x96, 0xB9, 0xA2),
    [0x00, 0x13, 0x15, 0x17, 0x02, 0x04, 0x06, 0x07, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x01, 0x00, 0x03, 0x00], [0, 0, 0, 0, 0, 0x30, 0x0F, 0x00, 0xFF]);
  const M6 = e(80, 24, 8, 0x4000, [0x01, 0x01, 0x00, 0x06], 0x63,
    crt(H80G, 0xBF, 0x1F, 0xC1, 0, 0, 0x9C, 0x8E, 0x8F, 0x28, 0x00, 0x96, 0xB9, 0xC2),
    [0x00, ...new Array(15).fill(0x17), 0x01, 0x00, 0x01, 0x00], [0, 0, 0, 0, 0, 0x00, 0x0D, 0x00, 0xFF]);
  const MD = e(40, 24, 8, 0x2000, [0x09, 0x0F, 0x00, 0x06], 0x63,
    crt(H40G, 0xBF, 0x1F, 0xC0, 0, 0, 0x9C, 0x8E, 0x8F, 0x14, 0x00, 0x96, 0xB9, 0xE3), [...A_CGA, 0x01, 0x00, 0x0F, 0x00], G_PLANAR);
  const ME = e(80, 24, 8, 0x4000, [0x01, 0x0F, 0x00, 0x06], 0x63,
    crt(H80G, 0xBF, 0x1F, 0xC0, 0, 0, 0x9C, 0x8E, 0x8F, 0x28, 0x00, 0x96, 0xB9, 0xE3), [...A_CGA, 0x01, 0x00, 0x0F, 0x00], G_PLANAR);
  const M10 = e(80, 24, 14, 0x8000, [0x01, 0x0F, 0x00, 0x06], 0xA3,
    crt(H80G, 0xBF, 0x1F, 0x40, 0, 0, 0x83, 0x85, 0x5D, 0x28, 0x0F, 0x63, 0xBA, 0xE3), [...A_TEXT, 0x01, 0x00, 0x0F, 0x00], G_PLANAR);
  const M11 = e(80, 29, 16, 0xA000, [0x01, 0x0F, 0x00, 0x06], 0xE3,
    crt(H80G, 0x0B, 0x3E, 0x40, 0, 0, 0xEA, 0x8C, 0xDF, 0x28, 0x00, 0xE7, 0x04, 0xC3),
    [0x00, 0x3F, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0x3F, 0x01, 0x00, 0x0F, 0x00], G_PLANAR);
  const M12 = e(80, 29, 16, 0xA000, [0x01, 0x0F, 0x00, 0x06], 0xE3,
    crt(H80G, 0x0B, 0x3E, 0x40, 0, 0, 0xEA, 0x8C, 0xDF, 0x28, 0x00, 0xE7, 0x04, 0xE3), [...A_TEXT, 0x01, 0x00, 0x0F, 0x00], G_PLANAR);
  const M13 = e(40, 24, 8, 0xFA00, [0x01, 0x0F, 0x00, 0x0E], 0x63,
    crt(H80G, 0xBF, 0x1F, 0x41, 0, 0, 0x9C, 0x8E, 0x8F, 0x28, 0x40, 0x96, 0xB9, 0xA3),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0x41, 0x00, 0x0F, 0x00], [0, 0, 0, 0, 0, 0x40, 0x05, 0x0F, 0xFF]);
  const NONE = new Array(64).fill(0);
  // IBM order: 0-3 (200-line text), 4, 5, 6, 7 (350 mono), 8-C, D, E, F, 10, F>64K, 10>64K,
  // 0*/1*, 2*/3* (350 lines), 0+/1+, 2+/3+, 7+ (400 lines), 11, 12, 13
  const params = [T200(1), T200(1), T200(0), T200(0), M4, M4, M6, M350, NONE, NONE, NONE, NONE, NONE, MD, ME, NONE, M10,
    NONE, M10, T350(1), T350(0), T400(1), T400(0), M400, M11, M12, M13];

  // ---------- DAC palettes (6-bit values) ----------
  const ega = [], cga = [], mono = [], d256 = [];
  for (let i = 0; i < 64; i++) {
    ega.push(((i >> 2) & 1) * 0x2A + ((i >> 5) & 1) * 0x15, ((i >> 1) & 1) * 0x2A + ((i >> 4) & 1) * 0x15, (i & 1) * 0x2A + ((i >> 3) & 1) * 0x15);
    const c = i & 7, hi = (i >> 4) & 1;
    cga.push(((c >> 2) & 1) * 0x2A + hi * 0x15, c === 6 && !hi ? 0x15 : ((c >> 1) & 1) * 0x2A + hi * 0x15, (c & 1) * 0x2A + hi * 0x15);
    const v = ((i >> 3) & 1) * 0x2A + ((i >> 4) & 1) * 0x15;
    mono.push(v, v, v);
  }
  for (let i = 0; i < 16; i++) d256.push(...cga.slice((i < 8 ? i : i + 8) * 3, (i < 8 ? i : i + 8) * 3 + 3));
  for (const g of [0x00, 0x05, 0x08, 0x0B, 0x0E, 0x11, 0x14, 0x18, 0x1C, 0x20, 0x24, 0x28, 0x2D, 0x32, 0x38, 0x3F]) d256.push(g, g, g);
  for (const L of [[0x00, 0x10, 0x1F, 0x2F, 0x3F], [0x1F, 0x27, 0x2F, 0x37, 0x3F], [0x2D, 0x31, 0x36, 0x3A, 0x3F],
    [0x00, 0x07, 0x0E, 0x15, 0x1C], [0x0E, 0x11, 0x15, 0x18, 0x1C], [0x14, 0x16, 0x18, 0x1A, 0x1C],
    [0x00, 0x04, 0x08, 0x0C, 0x10], [0x08, 0x0A, 0x0C, 0x0E, 0x10], [0x0B, 0x0C, 0x0D, 0x0F, 0x10]]) {
    const [a, b, c, d, f] = L;
    for (const [r, g, bl] of [[a, a, f], [b, a, f], [c, a, f], [d, a, f], [f, a, f], [f, a, d], [f, a, c], [f, a, b],
      [f, a, a], [f, b, a], [f, c, a], [f, d, a], [f, f, a], [d, f, a], [c, f, a], [b, f, a],
      [a, f, a], [a, f, b], [a, f, c], [a, f, d], [a, f, f], [a, d, f], [a, c, f], [a, b, f]]) d256.push(r, g, bl);
  }
  while (d256.length < 768) d256.push(0);

  const db = (label, bytes, per = 16) => {
    let s = label ? `${label}:\n` : '';
    for (let i = 0; i < bytes.length; i += per) {
      s += '        db ' + bytes.slice(i, i + per).map(x => '0x' + x.toString(16).padStart(2, '0')).join(', ') + '\n';
    }
    return s;
  };
  const tables = db('params', params.flat()) + db('dac_ega', ega) + db('dac_cga', cga) + db('dac_mono', mono) + db('dac_256', d256);

  return String.raw`; ==========================================================
;  8086 ANATOMY  -  VGA VIDEO BIOS  v1.0
;  An original option ROM for the VGA card, C000:0000 - C000:7FFF.
;  The system BIOS POST far-calls C000:0003. The ROM sets mode 3,
;  loads the font into plane 2 and takes over INT 10h (the old
;  vector moves to INT 42h, as on the EGA and VGA).
; ==========================================================
        cpu 8086
        org 0

BDA         equ 0x40          ; BIOS data area segment
EQUIP       equ 0x10
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
VID_ROWS    equ 0x84          ; rows - 1
CHAR_H      equ 0x85          ; character height (word)
EGA_INFO    equ 0x87          ; bit 7 no clear, bit 0 no cursor emulation
EGA_SW      equ 0x88
VGA_FLAGS   equ 0x89          ; bit 7 200 lines, bit 4 400 lines, bit 3 no palette load, bit 1 grey
DCC_INDEX   equ 0x8A
SAVE_PTR    equ 0xA8
TEXT_ATTR   equ 0xE0          ; system BIOS banner colour (0 = keep the cell's attribute)

; locals below the INT 10h frame (BP = frame)
L_ENTRY     equ -2            ; word: mode table entry (mode set)
L_MODE      equ -4            ; word: AL mode, AH keep flag (mode set)
L_PARAM     equ -6            ; word: parameter block (mode set)
L_CLASS     equ -7
L_TMP       equ -8
L_TOP       equ -9            ; scroll window
L_LEFT      equ -10
L_BOT       equ -11
L_RIGHT     equ -12
L_N         equ -13
L_ATTR      equ -14
L_W         equ -16           ; word
L_MOVE      equ -17
L_SQ2       equ -18           ; font access: saved registers
L_SQ4       equ -19
L_GC4       equ -20
L_GC5       equ -21
L_GC6       equ -22
L_W2        equ -24           ; word
L_AX        equ -26           ; word: AX at entry
L_W3        equ -28           ; word
L_S1        equ -30           ; word: write string
L_S2        equ -32           ; word
L_S3        equ -33
LOCALS      equ 34

; ----------------------------------------------------------
rom_start:
        db 0x55, 0xAA
        db 64                 ; 64 blocks of 512 bytes = 32 KB
        jmp near vga_init     ; C000:0003
        times 0x1E-($-$$) db 0
        db "IBM VGA COMPATIBLE - 8086 ANATOMY", 0

; ----------------------------------------------------------
; POST entry (far call): take the vectors, set up the BDA, set mode 3
vga_init:
        push ax
        push bx
        push cx
        push dx
        push si
        push di
        push bp
        push ds
        push es
        cld
        xor ax, ax
        mov es, ax
        mov ax, [es:0x10*4]           ; the motherboard INT 10h moves to INT 42h
        mov [es:0x42*4], ax
        mov ax, [es:0x10*4+2]
        mov [es:0x42*4+2], ax
        mov word [es:0x10*4], int10
        mov [es:0x10*4+2], cs
        mov word [es:0x1F*4], font8x8 + 0x400
        mov [es:0x1F*4+2], cs
        mov word [es:0x43*4], font8x8
        mov [es:0x43*4+2], cs
        mov ax, BDA
        mov ds, ax
        mov byte [EGA_INFO], 0x60     ; 256 KB, colour, cursor emulation on
        mov byte [EGA_SW], 0x09       ; primary: VGA colour
        mov byte [VGA_FLAGS], 0x11    ; 400-line text, VGA active
        mov byte [DCC_INDEX], 0x08
        mov word [SAVE_PTR], save_ptr
        mov [SAVE_PTR+2], cs
        mov dx, 0x3C3                 ; enable the card
        mov al, 1
        out dx, al
        mov dx, 0x3C2                 ; colour I/O addresses
        mov al, 0x67
        out dx, al
        mov ax, 0x0003
        int 0x10
        pop es
        pop ds
        pop bp
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        retf

; ----------------------------------------------------------
; INT 10h video services. Frame: [bp+14] BX, [bp+12] CX, [bp+10] DX,
; [bp+8] SI, [bp+6] DI, [bp+4] DS, [bp+2] ES, [bp+0] BP (values to return)
int10:  sti
        cld
        cmp ah, 0x1D
        jb .go
        iret                          ; not a VGA function: nothing changes
.go:    push bx
        push cx
        push dx
        push si
        push di
        push ds
        push es
        push bp
        mov bp, sp
        sub sp, LOCALS
        mov [bp+L_AX], ax
        mov si, BDA
        mov ds, si
        push ax
        mov al, ah
        xor ah, ah
        shl ax, 1
        mov si, ax
        pop ax
        jmp word [cs:si+v_table]
v_done_ax:
        mov ax, [bp+L_AX]
v_done: mov sp, bp
        pop bp
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
         dw v_palette, v_font, v_alt, v_wstr, v_done, v_done, v_done, v_done
         dw v_done, v_done, v_dcc, v_state, v_done

; per BIOS mode 00h-13h: parameter index (FFh = no such mode), class, DAC table, CGA mode byte
; class: 0 colour text, 1 mono text, 2 CGA 4 colours, 3 CGA 2 colours, 4 planar, 5 256 colours
; DAC: 0 EGA 64 colours, 1 CGA 16 colours, 2 mono, 3 256 colours
mode_tab:
        db 0x15, 0, 0, 0x2C       ; 00h 40x25 text
        db 0x15, 0, 0, 0x28       ; 01h
        db 0x16, 0, 0, 0x2D       ; 02h 80x25 text
        db 0x16, 0, 0, 0x29       ; 03h
        db 0x04, 2, 1, 0x2A       ; 04h 320x200 4 colours
        db 0x05, 2, 1, 0x2E       ; 05h
        db 0x06, 3, 1, 0x1E       ; 06h 640x200 2 colours
        db 0x17, 1, 2, 0x29       ; 07h 80x25 mono text
        db 0xFF, 0, 0, 0          ; 08h-0Ch: none
        db 0xFF, 0, 0, 0
        db 0xFF, 0, 0, 0
        db 0xFF, 0, 0, 0
        db 0xFF, 0, 0, 0
        db 0x0D, 4, 1, 0          ; 0Dh 320x200 16 colours
        db 0x0E, 4, 1, 0          ; 0Eh 640x200 16 colours
        db 0xFF, 0, 0, 0          ; 0Fh: none
        db 0x12, 4, 0, 0          ; 10h 640x350 16 colours
        db 0x18, 4, 0, 0          ; 11h 640x480 2 colours
        db 0x19, 4, 0, 0          ; 12h 640x480 16 colours
        db 0x1A, 5, 3, 0          ; 13h 320x200 256 colours

; ----------------------------------------------------------
; small helpers (DS = BDA)

; AL = class of the current mode
get_class:
        push bx
        xor bh, bh
        mov bl, [VID_MODE]
        cmp bl, 0x13
        jbe .ok
        xor bl, bl
.ok:    shl bx, 1
        shl bx, 1
        mov al, [cs:bx+mode_tab+1]
        pop bx
        ret

; ES = video segment of the current mode
set_vseg:
        push ax
        call get_class
        mov ah, al
        mov al, 0xB8
        cmp ah, 1
        jne .a
        mov al, 0xB0
.a:     cmp ah, 4
        jb .s
        mov al, 0xA0
.s:     mov ah, al
        xor al, al
        mov es, ax
        pop ax
        ret

; reset the attribute flip-flop (both status ports; the other one does not answer)
attr_reset:
        push ax
        push dx
        mov dx, 0x3DA
        in al, dx
        mov dx, 0x3BA
        in al, dx
        pop dx
        pop ax
        ret

; attribute register AL = AH, then the display on again (PAS = 1)
attr_write:
        push ax
        push dx
        call attr_reset
        mov dx, 0x3C0
        out dx, al
        mov al, ah
        out dx, al
        mov al, 0x20
        out dx, al
        pop dx
        pop ax
        ret

; AH = attribute register AL
attr_read:
        push dx
        push ax
        call attr_reset
        mov dx, 0x3C0
        out dx, al
        inc dx
        in al, dx
        pop dx                ; DX = the old AX
        mov ah, al
        mov al, dl
        call attr_reset
        push ax
        mov dx, 0x3C0
        mov al, 0x20
        out dx, al
        pop ax
        pop dx
        ret

; display on: PAS = 1
attr_on:
        push ax
        push dx
        call attr_reset
        mov dx, 0x3C0
        mov al, 0x20
        out dx, al
        pop dx
        pop ax
        ret

; write AH to CRTC register AL
crtc_out:
        push dx
        mov dx, [CRT_BASE]
        out dx, ax
        pop dx
        ret

; ----------------------------------------------------------
; AH=00h set mode AL (bit 7 = keep the video memory)
v_mode: mov ah, al
        and ah, 0x80
        and al, 0x7F
        cmp al, 0x13
        ja .bad
        xor bh, bh
        mov bl, al
        shl bx, 1
        shl bx, 1
        add bx, mode_tab
        cmp byte [cs:bx], 0xFF
        jne .ok
.bad:   jmp v_done_ax
.ok:    mov [bp+L_ENTRY], bx
        mov [bp+L_MODE], ax
        and byte [EGA_INFO], 0x7F
        or [EGA_INFO], ah
        mov [VID_MODE], al
        call mode_params
        mov [bp+L_PARAM], si
        call load_regs
        test byte [VGA_FLAGS], 0x08
        jnz .nodac
        mov bx, [bp+L_ENTRY]
        mov al, [cs:bx+2]
        cmp byte [cs:bx+1], 0
        jne .dac
        cmp byte [cs:si+2], 8         ; 200-line text uses the CGA colours
        jne .dac
        mov al, 1
.dac:   call load_dac
.nodac: mov si, [bp+L_PARAM]
        mov al, [cs:si]
        xor ah, ah
        mov [VID_COLS], ax
        mov al, [cs:si+1]
        mov [VID_ROWS], al
        mov al, [cs:si+2]
        mov [CHAR_H], ax
        mov ax, [cs:si+3]
        mov [VID_PSIZE], ax
        xor ax, ax
        mov [VID_POFF], ax
        mov [VID_PAGE], al
        mov bx, CUR_POS
        mov cx, 8
.cp:    mov [bx], ax
        add bx, 2
        loop .cp
        mov word [CUR_TYPE], 0x0607
        mov bx, [bp+L_ENTRY]
        mov al, [cs:bx+3]
        mov [CRT_MODE], al
        mov byte [CRT_PAL], 0x30
        cmp byte [VID_MODE], 6
        jne .pal
        mov byte [CRT_PAL], 0x3F
.pal:   mov ax, 0x3D4
        and byte [EQUIP], 0xCF
        cmp byte [cs:bx+1], 1
        jne .col
        mov ax, 0x3B4
        or byte [EQUIP], 0x30         ; equipment: 80x25 mono
        jmp .port
.col:   or byte [EQUIP], 0x20         ; equipment: 80x25 colour
.port:  mov [CRT_BASE], ax
        test byte [bp+L_MODE+1], 0x80
        jnz .keep
        call clear_mem
.keep:  mov bx, [bp+L_ENTRY]
        cmp byte [cs:bx+1], 2
        jae .gfx
        call text_font
        jmp .on
.gfx:   call gfx_font_vec
.on:    mov cx, 0x0607
        call set_ctype
        call set_hw_cursor
        call attr_on
        jmp v_done_ax

; SI = parameter block for mode AL. Text modes follow the scan-line setting
; of INT 10h AH=12h BL=30h (400 lines at power-on).
mode_params:
        push ax
        push bx
        push cx
        xor bh, bh
        mov bl, al
        shl bx, 1
        shl bx, 1
        mov bl, [cs:bx+mode_tab]
        xor bh, bh
        cmp al, 7
        ja .n
        je .mono
        cmp al, 3
        ja .n
        test byte [VGA_FLAGS], 0x10
        jnz .n
        mov bl, 0x13              ; 350 lines
        cmp al, 2
        jb .t2
        mov bl, 0x14
.t2:    test byte [VGA_FLAGS], 0x80
        jz .n
        mov bl, al                ; 200 lines: IBM entries 0-3
        jmp .n
.mono:  test byte [VGA_FLAGS], 0x10
        jnz .n
        mov bl, 0x07
.n:     mov cl, 6
        shl bx, cl
        lea si, [bx+params]
        pop cx
        pop bx
        pop ax
        ret

; program the card from the parameter block at CS:SI (the display stays off)
load_regs:
        push ax
        push bx
        push dx
        call attr_reset
        mov dx, 0x3C0
        xor al, al                ; PAS = 0: the screen is blank while the registers change
        out dx, al
        mov dx, 0x3C4
        mov ax, 0x0100            ; synchronous reset
        out dx, ax
        mov al, 1
        mov ah, [cs:si+5]
        out dx, ax
        mov al, 2
        mov ah, [cs:si+6]
        out dx, ax
        mov al, 3
        mov ah, [cs:si+7]
        out dx, ax
        mov al, 4
        mov ah, [cs:si+8]
        out dx, ax
        mov dx, 0x3C2
        mov al, [cs:si+9]
        out dx, al
        mov dx, 0x3C4
        mov ax, 0x0300            ; end of the reset
        out dx, ax
        mov dx, 0x3D4
        test byte [cs:si+9], 1
        jnz .c
        mov dx, 0x3B4
.c:     mov ax, 0x0011            ; unlock CRTC registers 0-7
        out dx, ax
        xor bx, bx
.crtc:  mov al, bl
        mov ah, [cs:si+bx+10]
        out dx, ax
        inc bx
        cmp bx, 25
        jb .crtc
        add dx, 6
        in al, dx                 ; reset the attribute flip-flop
        mov dx, 0x3C0
        xor bx, bx
.att:   mov al, bl
        out dx, al
        mov al, [cs:si+bx+35]
        out dx, al
        inc bx
        cmp bx, 20
        jb .att
        mov dx, 0x3CE
        xor bx, bx
.gc:    mov al, bl
        mov ah, [cs:si+bx+55]
        out dx, ax
        inc bx
        cmp bx, 9
        jb .gc
        pop dx
        pop bx
        pop ax
        ret

; load DAC table AL (0 EGA, 1 CGA, 2 mono: 64 entries; 3: 256 entries)
load_dac:
        push ax
        push bx
        push cx
        push dx
        push si
        mov si, dac_ega
        mov cx, 64*3
        cmp al, 1
        jne .a
        mov si, dac_cga
.a:     cmp al, 2
        jne .b
        mov si, dac_mono
.b:     cmp al, 3
        jne .c
        mov si, dac_256
        mov cx, 256*3
.c:     mov dx, 0x3C8
        xor al, al
        out dx, al
        inc dx
.l:     mov al, [cs:si]
        inc si
        out dx, al
        loop .l
        test byte [VGA_FLAGS], 2
        jz .x
        xor bx, bx
        mov cx, 256
        call grey_sum
.x:     pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; DAC registers BX .. BX+CX-1 to grey: 30% red, 59% green, 11% blue
grey_sum:
        push ax
        push bx
        push cx
        push dx
        push si
        push di
        jcxz .x
.l:     mov dx, 0x3C7
        mov al, bl
        out dx, al
        mov dx, 0x3C9
        in al, dx
        mov ah, 77
        mul ah
        mov si, ax
        in al, dx
        mov ah, 151
        mul ah
        add si, ax
        in al, dx
        mov ah, 28
        mul ah
        add si, ax
        add si, 128
        mov ax, si
        mov al, ah                ; / 256
        mov dx, 0x3C8
        push ax
        mov al, bl
        out dx, al
        pop ax
        inc dx
        out dx, al
        out dx, al
        out dx, al
        inc bx
        loop .l
.x:     pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; clear the video memory of the new mode
clear_mem:
        push ax
        push cx
        push di
        push es
        call get_class
        cmp al, 2
        jae .g
        call set_vseg
        xor di, di
        mov cx, 0x4000
        mov ax, 0x0720
        rep stosw
        jmp .x
.g:     cmp al, 4
        jae .a
        mov ax, 0xB800
        mov es, ax
        xor di, di
        mov cx, 0x4000
        xor ax, ax
        rep stosw
        jmp .x
.a:     mov ax, 0xA000            ; the map mask is 0Fh: all 4 planes (all of it in chain 4)
        mov es, ax
        xor di, di
        mov cx, 0x8000
        xor ax, ax
        rep stosw
.x:     pop es
        pop di
        pop cx
        pop ax
        ret

; text modes: the ROM font for the character height into block 0
text_font:
        push ax
        push bx
        push cx
        push dx
        push si
        push es
        mov ax, cs
        mov es, ax
        mov si, font8x16
        mov bh, 16
        mov al, [CHAR_H]
        cmp al, 14
        jne .a
        mov si, font8x14
        mov bh, 14
.a:     cmp al, 8
        jne .b
        mov si, font8x8
        mov bh, 8
.b:     mov cx, 256
        xor dx, dx
        xor bl, bl
        call load_font
        pop es
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; graphics modes: INT 43h = the ROM font for the character height
gfx_font_vec:
        push ax
        push bx
        push es
        xor ax, ax
        mov es, ax
        mov bx, font8x8
        mov al, [CHAR_H]
        cmp al, 14
        jne .a
        mov bx, font8x14
.a:     cmp al, 16
        jne .b
        mov bx, font8x16
.b:     cli
        mov [es:0x43*4], bx
        mov [es:0x43*4+2], cs
        sti
        pop es
        pop bx
        pop ax
        ret

; plane 2 open at A000 for fonts. The old register values go to the frame locals.
font_access:
        push ax
        push dx
        mov dx, 0x3C4
        mov al, 2
        out dx, al
        inc dx
        in al, dx
        mov [bp+L_SQ2], al
        dec dx
        mov al, 4
        out dx, al
        inc dx
        in al, dx
        mov [bp+L_SQ4], al
        mov dx, 0x3CE
        mov al, 4
        out dx, al
        inc dx
        in al, dx
        mov [bp+L_GC4], al
        dec dx
        mov al, 5
        out dx, al
        inc dx
        in al, dx
        mov [bp+L_GC5], al
        dec dx
        mov al, 6
        out dx, al
        inc dx
        in al, dx
        mov [bp+L_GC6], al
        mov dx, 0x3C4
        mov ax, 0x0402            ; write plane 2 only
        out dx, ax
        mov ax, 0x0704            ; sequential addresses, no chain 4
        out dx, ax
        mov dx, 0x3CE
        mov ax, 0x0204            ; read plane 2
        out dx, ax
        mov ax, 0x0005            ; write mode 0, no odd/even
        out dx, ax
        mov ax, 0x0406            ; A0000, 64 KB, no chain odd/even
        out dx, ax
        pop dx
        pop ax
        ret
normal_access:
        push ax
        push dx
        mov dx, 0x3C4
        mov al, 2
        mov ah, [bp+L_SQ2]
        out dx, ax
        mov al, 4
        mov ah, [bp+L_SQ4]
        out dx, ax
        mov dx, 0x3CE
        mov al, 4
        mov ah, [bp+L_GC4]
        out dx, ax
        mov al, 5
        mov ah, [bp+L_GC5]
        out dx, ax
        mov al, 6
        mov ah, [bp+L_GC6]
        out dx, ax
        pop dx
        pop ax
        ret

; load CX characters of BH bytes from ES:SI into font block BL, first character DX
load_font:
        push ax
        push bx
        push cx
        push dx
        push si
        push di
        push ds
        push es
        call font_access
        mov al, bl
        and al, 3
        push cx
        mov cl, 6
        shl al, cl                ; blocks 0-3 at 0, 16 K, 32 K, 48 K
        test bl, 4
        jz .b
        or al, 0x20               ; blocks 4-7 are 8 K higher
.b:     mov ah, al
        xor al, al
        mov di, ax
        mov ax, dx
        mov cl, 5
        shl ax, cl
        add di, ax                ; + first * 32
        pop cx
        push es
        pop ds
        mov ax, 0xA000
        mov es, ax
        mov dl, bh
        xor dh, dh
        jcxz .x
.ch:    push cx
        push di
        mov cx, dx
        rep movsb
        pop di
        add di, 32
        pop cx
        loop .ch
.x:     call normal_access
        pop es
        pop ds
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; ----------------------------------------------------------
; AH=01h cursor shape CH (start line), CL (end line)
v_ctype:
        mov [CUR_TYPE], cx
        call set_ctype
        jmp v_done_ax

; CRTC cursor registers from CX. The emulation scales CGA (8-line) values to the
; character height, as the EGA/VGA BIOS does.
set_ctype:
        push ax
        push bx
        push cx
        push dx
        mov bx, cx
        call get_class
        cmp al, 2
        jae .x
        mov ah, bh
        and ah, 0x60
        cmp ah, 0x20
        jne .on
        mov bx, 0x2000            ; cursor off
        jmp .out
.on:    test byte [EGA_INFO], 1
        jnz .out
        mov cl, [CHAR_H]
        cmp cl, 8
        jbe .out
        cmp bl, 8
        jae .out
        cmp bh, 8
        jae .out
        mov al, bl
        inc al
        mul cl
        shr ax, 1
        shr ax, 1
        shr ax, 1
        sub al, 2
        mov dl, al                ; new end line
        mov al, bh
        inc al
        cmp al, bl
        je .adj
        mov al, bh
        mul cl
        shr ax, 1
        shr ax, 1
        shr ax, 1
        mov bh, al
        jmp .set
.adj:   mov bh, dl
        dec bh
.set:   mov bl, dl
.out:   mov al, 0x0A
        mov ah, bh
        call crtc_out
        mov al, 0x0B
        mov ah, bl
        call crtc_out
.x:     pop dx
        pop cx
        pop bx
        pop ax
        ret

; AH=02h cursor position DH row, DL column of page BH
v_setcur:
        mov bl, bh
        and bx, 7
        shl bx, 1
        mov [bx+CUR_POS], dx
        call set_hw_cursor
        jmp v_done_ax

; AH=03h read the cursor: DX position, CX shape
v_getcur:
        mov bl, bh
        and bx, 7
        shl bx, 1
        mov dx, [bx+CUR_POS]
        mov [bp+10], dx
        mov cx, [CUR_TYPE]
        mov [bp+12], cx
        jmp v_done_ax

; AH=04h light pen: none
v_lpen: xor ah, ah
        jmp v_done

; the CRTC cursor location from the BDA (active page, text modes)
set_hw_cursor:
        push ax
        push bx
        push dx
        call get_class
        cmp al, 2
        jae .x
        call cur_ptr
        mov dx, [bx]
        mov al, dh
        mul byte [VID_COLS]
        xor dh, dh
        add ax, dx
        mov bx, [VID_POFF]
        shr bx, 1
        add bx, ax
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

; BX = address of the cursor word of the active page
cur_ptr:
        mov bl, [VID_PAGE]
        and bx, 7
        shl bx, 1
        add bx, CUR_POS
        ret

; AH=05h active display page AL
v_page: push ax
        call get_class
        mov ah, al
        cmp ah, 2
        jb .ok
        cmp ah, 4
        jne .no
        cmp byte [VID_MODE], 0x10     ; pages in modes 0Dh, 0Eh and 10h
        jbe .ok
.no:    pop ax
        jmp v_done_ax
.ok:    mov [bp+L_CLASS], ah
        pop ax
        and al, 7
        mov [VID_PAGE], al
        xor ah, ah
        mul word [VID_PSIZE]
        mov [VID_POFF], ax
        mov bx, ax
        cmp byte [bp+L_CLASS], 2
        jae .set
        shr bx, 1                     ; text: the CRTC counts words
.set:   mov al, 0x0C
        mov ah, bh
        call crtc_out
        mov al, 0x0D
        mov ah, bl
        call crtc_out
        call set_hw_cursor
        jmp v_done_ax

; ----------------------------------------------------------
; AH=06h / 07h scroll the window CH,CL - DH,DL up / down by AL lines
; (AL = 0 clears the window). New lines get attribute (or colour) BH.
v_scrup:
        xor si, si
        jmp v_scroll
v_scrdn:
        mov si, 1
v_scroll:
        mov [bp+L_TMP], al
        call get_class
        mov [bp+L_CLASS], al
        mov al, [bp+L_TMP]
        cmp byte [bp+L_CLASS], 2
        jae .g
        call set_vseg
        call tscroll
        jmp v_done_ax
.g:     cmp byte [bp+L_CLASS], 4
        jae .p
        call cscroll
        jmp v_done_ax
.p:     call pscroll
        jmp v_done_ax

; clip the window to the screen and set the scroll locals. Returns CF = 1 when empty.
; AL lines, BH fill, CX top-left, DX bottom-right
scroll_setup:
        push ax
        mov al, [VID_COLS]
        dec al
        cmp dl, al
        jbe .c1
        mov dl, al
.c1:    mov al, [VID_ROWS]
        cmp dh, al
        jbe .c2
        mov dh, al
.c2:    pop ax
        cmp ch, dh
        ja .empty
        cmp cl, dl
        ja .empty
        mov [bp+L_ATTR], bh
        mov [bp+L_TOP], ch
        mov [bp+L_LEFT], cl
        mov [bp+L_BOT], dh
        mov [bp+L_RIGHT], dl
        mov ah, dh
        sub ah, ch
        inc ah
        or al, al
        jz .all
        cmp al, ah
        jb .lset
.all:   mov al, ah
.lset:  mov [bp+L_N], al
        mov bl, dl
        sub bl, cl
        inc bl
        xor bh, bh
        mov [bp+L_W], bx
        sub ah, al
        mov [bp+L_MOVE], ah
        clc
        ret
.empty: stc
        ret

; text scroll. SI = 0 up, 1 down. ES = video segment
tscroll:
        call scroll_setup
        jc .done
        or si, si
        jnz .down
        mov dh, [bp+L_TOP]
.uloop: cmp byte [bp+L_MOVE], 0
        je .ufill
        mov al, dh
        add al, [bp+L_N]
        mov ah, [bp+L_LEFT]
        call row_addr
        mov si, di
        mov al, dh
        call row_addr
        call copy_cells
        inc dh
        dec byte [bp+L_MOVE]
        jmp .uloop
.ufill: mov al, dh
        cmp al, [bp+L_BOT]
        ja .done
        mov ah, [bp+L_LEFT]
        call row_addr
        call fill_cells
        inc dh
        jmp .ufill
.down:  mov dh, [bp+L_BOT]
.dloop: cmp byte [bp+L_MOVE], 0
        je .dfill
        mov al, dh
        sub al, [bp+L_N]
        mov ah, [bp+L_LEFT]
        call row_addr
        mov si, di
        mov al, dh
        call row_addr
        call copy_cells
        dec dh
        dec byte [bp+L_MOVE]
        jmp .dloop
.dfill: mov al, dh
        cmp al, [bp+L_TOP]
        jb .done
        cmp al, 0xFF
        je .done
        mov ah, [bp+L_LEFT]
        call row_addr
        call fill_cells
        dec dh
        jmp .dfill
.done:  ret

; DI = offset of text row AL, column AH on the active page
row_addr:
        push ax
        push bx
        push dx
        mov bl, ah
        xor bh, bh
        mul byte [VID_COLS]
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
        mov cx, [bp+L_W]
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
        mov cx, [bp+L_W]
        mov ah, [bp+L_ATTR]
        mov al, 0x20
        rep stosw
        pop cx
        pop ax
        ret

; CGA graphics scroll (modes 4-6, full width). SI = 0 up, 1 down.
cscroll:
        call scroll_setup
        jc .x
        mov ax, 0xB800
        mov es, ax
        mov cl, [bp+L_TOP]
        mov ch, [bp+L_BOT]
        mov bl, [bp+L_N]
        mov bh, [bp+L_ATTR]
        push ds
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
.x:     ret

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

; planar and 256-colour scroll: copies go through the latches (write mode 1)
pscroll:
        call scroll_setup
        jnc .go
        ret
.go:    mov ax, [VID_COLS]            ; bytes per scan line: columns (planar) or 320
        mov bx, 1                     ; bytes per character cell
        cmp byte [bp+L_CLASS], 5
        jne .p
        mov ax, 320
        mov bx, 8
.p:     mov [bp+L_W3], ax             ; L_W3 = bytes per scan line
        mov [bp+L_ENTRY], bx          ; L_ENTRY = bytes per cell
        mov ax, [bp+L_W]
        mul bx
        mov [bp+L_W], ax              ; L_W = bytes per window line
        mov al, [CHAR_H]
        xor ah, ah
        mul word [bp+L_W3]
        mov [bp+L_W2], ax             ; L_W2 = bytes per text row
        mov dx, 0x3CE
        mov ax, 0x0105                ; write mode 1 (planar modes only)
        cmp byte [bp+L_CLASS], 5
        je .wm
        out dx, ax
.wm:    push ds
        mov ax, 0xA000
        mov es, ax
        or si, si
        jnz .down
        mov dh, [bp+L_TOP]
.uloop: cmp byte [bp+L_MOVE], 0
        je .ufill
        mov al, dh
        add al, [bp+L_N]
        call prow_copy
        inc dh
        dec byte [bp+L_MOVE]
        jmp .uloop
.ufill: cmp dh, [bp+L_BOT]
        ja .done
        call prow_fill
        inc dh
        jmp .ufill
.down:  mov dh, [bp+L_BOT]
.dloop: cmp byte [bp+L_MOVE], 0
        je .dfill
        mov al, dh
        sub al, [bp+L_N]
        call prow_copy
        dec dh
        dec byte [bp+L_MOVE]
        jmp .dloop
.dfill: cmp dh, [bp+L_TOP]
        jb .done
        cmp dh, 0xFF
        je .done
        call prow_fill
        dec dh
        jmp .dfill
.done:  pop ds
        mov dx, 0x3CE
        mov ax, 0x0005
        cmp byte [bp+L_CLASS], 5
        je .r
        out dx, ax                    ; write mode 0
        mov ax, 0x0001
        out dx, ax                    ; no set/reset
        mov ax, 0x0000
        out dx, ax
.r:     ret

; DI = offset of text row AL, left column of the window (planar / 256)
prow_addr:
        push ax
        push dx
        xor ah, ah
        mul word [bp+L_W2]
        mov di, ax
        mov al, [bp+L_LEFT]
        xor ah, ah
        mul word [bp+L_ENTRY]
        add di, ax
        pop dx
        pop ax
        add di, [VID_POFF]
        ret

; copy text row AL to text row DH (window width)
prow_copy:
        push ax
        push cx
        push si
        push di
        call prow_addr
        mov si, di
        mov al, dh
        call prow_addr
        mov cl, [CHAR_H]
        xor ch, ch
        push ds
        push es
        pop ds
.l:     push cx
        push si
        push di
        mov cx, [bp+L_W]
        rep movsb
        pop di
        pop si
        pop cx
        add si, [bp+L_W3]
        add di, [bp+L_W3]
        loop .l
        pop ds
        pop di
        pop si
        pop cx
        pop ax
        ret

; fill text row DH with colour L_ATTR (window width)
prow_fill:
        push ax
        push cx
        push dx
        push di
        mov al, dh
        call prow_addr
        cmp byte [bp+L_CLASS], 5
        je .f
        mov dx, 0x3CE
        mov ax, 0x0005                ; write mode 0 with set/reset = the colour
        out dx, ax
        mov ax, 0x0F01
        out dx, ax
        mov al, 0
        mov ah, [bp+L_ATTR]
        out dx, ax
        mov ax, 0xFF08
        out dx, ax
.f:     mov cl, [CHAR_H]
        xor ch, ch
        mov al, [bp+L_ATTR]
.l:     push cx
        push di
        mov cx, [bp+L_W]
        rep stosb
        pop di
        pop cx
        add di, [bp+L_W3]
        loop .l
        cmp byte [bp+L_CLASS], 5
        je .x
        mov dx, 0x3CE
        mov ax, 0x0105                ; back to write mode 1 for the copies
        out dx, ax
.x:     pop di
        pop dx
        pop cx
        pop ax
        ret

; ----------------------------------------------------------
; AH=08h read the character and attribute at the cursor of page BH
v_rdca: call get_class
        cmp al, 2
        jae .g
        call set_vseg
        call page_cell
        mov ax, [es:di]
        jmp v_done
.g:     xor ax, ax                    ; graphics: not recognised
        jmp v_done

; DI = video offset of the cursor of page BH (text modes)
page_cell:
        push ax
        push bx
        push dx
        mov bl, bh
        and bx, 7
        mov ax, [VID_PSIZE]
        mul bx
        mov di, ax
        shl bx, 1
        mov dx, [bx+CUR_POS]
        mov al, dh
        mul byte [VID_COLS]
        xor dh, dh
        add ax, dx
        shl ax, 1
        add di, ax
        pop dx
        pop bx
        pop ax
        ret

; AH=09h write AL with attribute BL, CX times; AH=0Ah write AL only
v_wrca: push ax
        call get_class
        mov ah, al
        cmp ah, 2
        pop ax
        jae v_gchar
        call set_vseg
        call page_cell
        mov ah, bl
        rep stosw
        jmp v_done_ax
v_wrc:  push ax
        call get_class
        mov ah, al
        cmp ah, 2
        pop ax
        jae v_gchar
        call set_vseg
        call page_cell
.l:     jcxz .e
        stosb
        inc di
        dec cx
        jmp .l
.e:     jmp v_done_ax
v_gchar:
        mov bl, bh
        and bx, 7
        shl bx, 1
        mov dx, [bx+CUR_POS]
        mov bl, [bp+14]               ; colour
.l:     jcxz .e
        call gglyph
        inc dl
        dec cx
        jmp .l
.e:     jmp v_done_ax

; ----------------------------------------------------------
; draw character AL with colour BL (bit 7 = XOR) at text column DL, row DH
gglyph: push ax
        push bx
        push cx
        push dx
        push si
        push di
        push ds
        push es
        mov ah, al
        call get_class
        xchg al, ah                   ; AL = character, AH = class
        cmp ah, 4
        jb .cga
        je .pl
        call vglyph
        jmp .x
.pl:    call pglyph
        jmp .x
.cga:   call cglyph
.x:     pop es
        pop ds
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; DS:SI = font bytes of character AL (INT 43h table; CGA modes: INT 1Fh for 80h-FFh)
; CL = character height. Needs DS = BDA on entry.
font_ptr:
        push ax
        push bx
        mov cl, [CHAR_H]
        xor bx, bx
        mov ds, bx
        mov bx, 0x43*4
        cmp ah, 4
        jae .v
        mov cl, 8
        cmp al, 0x80
        jb .v
        sub al, 0x80
        mov bx, 0x1F*4
.v:     mul cl                        ; AX = character * height
        mov si, [bx]
        mov ds, [bx+2]
        add si, ax
        pop bx
        pop ax
        ret

; 256 colours (mode 13h): 8 bytes a character cell
vglyph: mov cx, [VID_POFF]
        push cx
        call font_ptr                 ; DS:SI, CL = height
        mov al, dh
        xor ah, ah
        push dx
        push cx
        xor ch, ch
        mul cx
        mov cx, 320
        mul cx
        pop cx
        pop dx
        mov di, ax
        mov al, dl
        xor ah, ah
        shl ax, 1
        shl ax, 1
        shl ax, 1
        add di, ax
        pop ax
        add di, ax
        mov ax, 0xA000
        mov es, ax
        xor ch, ch
.row:   lodsb
        mov ah, al
        push cx
        mov cx, 8
.px:    shl ah, 1
        jnc .bg
        mov [es:di], bl
        jmp .n
.bg:    mov byte [es:di], 0
.n:     inc di
        loop .px
        pop cx
        add di, 320-8
        loop .row
        ret

; planar 16 colours: write mode 2, the bit mask is the glyph row
pglyph: mov cx, [VID_POFF]
        push cx
        mov cx, [VID_COLS]
        mov [bp+L_W3], cx
        call font_ptr                 ; DS:SI, CL = height
        mov al, dh
        xor ah, ah
        push dx
        push cx
        xor ch, ch
        mul cx
        mul word [bp+L_W3]
        pop cx
        pop dx
        mov di, ax
        mov al, dl
        xor ah, ah
        add di, ax
        pop ax
        add di, ax
        mov ax, 0xA000
        mov es, ax
        mov dx, 0x3CE
        mov ax, 0x0205                ; write mode 2
        out dx, ax
        test bl, 0x80
        jz .nx
        mov ax, 0x1803                ; XOR
        out dx, ax
.nx:    xor ch, ch
.row:   lodsb
        mov ah, al
        mov al, 8
        out dx, ax                    ; bit mask = the glyph row
        mov al, [es:di]               ; load the latches
        mov [es:di], bl
        test bl, 0x80
        jnz .n
        not ah
        mov al, 8
        out dx, ax
        mov byte [es:di], 0           ; background
.n:     add di, [bp+L_W3]
        loop .row
        mov ax, 0x0005
        out dx, ax
        mov ax, 0x0003
        out dx, ax
        mov ax, 0xFF08
        out dx, ax
        ret

; CGA modes 4, 5 (2 bits a pixel) and 6 (1 bit a pixel)
cglyph: push ax
        mov ch, [VID_MODE]
        push cx
        call font_ptr                 ; DS:SI
        pop cx
        pop ax
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
        mov ax, 0xB800
        mov es, ax
        xor dl, dl                    ; scan line 0..7
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
        ret

; ----------------------------------------------------------
; AH=0Bh CGA palette: BH=0 background/border BL, BH=1 palette select BL
v_pal:  mov al, [CRT_PAL]
        or bh, bh
        jnz .sel
        and al, 0xE0
        mov ah, bl
        and ah, 0x1F
        or al, ah
        jmp .out
.sel:   and al, 0xDF
        test bl, 1
        jz .out
        or al, 0x20
.out:   mov [CRT_PAL], al
        ; background / border: IRGB -> the 6-bit value (I = bit 4)
        mov ah, al
        and ah, 0x07
        test al, 0x08
        jz .b1
        or ah, 0x10
.b1:    push ax
        mov al, 0x11                  ; overscan
        call attr_write
        call get_class
        cmp al, 2
        pop ax
        jb .x
        push ax
        mov al, 0                     ; graphics: palette 0 = background
        call attr_write
        pop ax
        cmp byte [VID_MODE], 6
        jae .x
        ; modes 4/5: colours 1-3 from the palette select and the intensity bit
        mov bl, 2
        test al, 0x20
        jz .p0
        mov bl, 3
.p0:    mov bh, 0
        test al, 0x10
        jz .p1
        mov bh, 0x10
.p1:    mov cx, 3
        mov al, 1
.p2:    mov ah, bl
        or ah, bh
        call attr_write
        add bl, 2
        inc al
        loop .p2
.x:     jmp v_done_ax

; ----------------------------------------------------------
; AH=0Ch write pixel AL at column CX, row DX (bit 7 = XOR); AH=0Dh read it into AL
v_wrpix:
        push ax
        call get_class
        mov ah, al
        cmp ah, 2
        pop ax
        jb .x
        push ax
        call get_class
        mov [bp+L_CLASS], al
        pop ax
        cmp byte [bp+L_CLASS], 4
        je .pl
        ja .v
        mov bx, 0xB800
        mov es, bx
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
.x:     jmp v_done_ax
.v:     call vpix_addr
        mov [es:di], al
        jmp v_done_ax
.pl:    call ppix_addr                ; DI, AH = bit mask
        mov bl, al
        mov dx, 0x3CE
        mov al, 8
        out dx, ax
        mov ax, 0x0205
        out dx, ax
        test bl, 0x80
        jz .nx
        mov ax, 0x1803
        out dx, ax
.nx:    mov al, [es:di]
        mov [es:di], bl
        mov ax, 0x0005
        out dx, ax
        mov ax, 0x0003
        out dx, ax
        mov ax, 0xFF08
        out dx, ax
        jmp v_done_ax

v_rdpix:
        call get_class
        cmp al, 2
        jb .x
        cmp al, 4
        je .pl
        ja .v
        mov bx, 0xB800
        mov es, bx
        call pix_addr
        mov al, [es:di]
        shr al, cl
        and al, bl
        mov ah, 0x0D
        jmp v_done
.x:     jmp v_done_ax
.v:     call vpix_addr
        mov al, [es:di]
        mov ah, 0x0D
        jmp v_done
.pl:    call ppix_addr
        mov bl, ah                    ; bit mask
        xor bh, bh                    ; colour
        mov dx, 0x3CE
        mov cx, 4
        mov ah, 3
.pln:   mov al, 4
        out dx, ax                    ; read map select
        mov al, [es:di]
        shl bh, 1
        test al, bl
        jz .z
        or bh, 1
.z:     dec ah
        loop .pln
        mov ax, 0x0004
        out dx, ax
        mov al, bh
        mov ah, 0x0D
        jmp v_done

; CGA pixel address for column CX, row DX: DI byte, CL shift, BL mask
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

; mode 13h: ES:DI = pixel CX, DX
vpix_addr:
        push ax
        push dx
        mov ax, 320
        mul dx
        add ax, cx
        mov di, ax
        mov ax, 0xA000
        mov es, ax
        pop dx
        pop ax
        ret

; planar: ES:DI = byte of pixel CX, DX (plus the page), AH = bit mask
ppix_addr:
        push bx
        push cx
        push dx
        mov bx, ax
        mov ax, [VID_COLS]
        mul dx
        mov di, ax
        mov ax, cx
        shr ax, 1
        shr ax, 1
        shr ax, 1
        add di, ax
        add di, [VID_POFF]
        and cl, 7
        mov ah, 0x80
        shr ah, cl
        mov al, bl
        mov bx, 0xA000
        mov es, bx
        pop dx
        pop cx
        pop bx
        ret

; ----------------------------------------------------------
; AH=0Eh teletype AL (colour BL in graphics modes)
v_tty:  call tty
        jmp v_done_ax

; AH=0Fh AL = mode, AH = columns, BH = active page
v_getmode:
        mov al, [EGA_INFO]
        and al, 0x80
        or al, [VID_MODE]
        mov ah, [VID_COLS]
        mov bl, [VID_PAGE]
        mov [bp+15], bl
        jmp v_done

; tty: write AL at the cursor of the active page, then move the cursor
tty:    push ax
        push bx
        push cx
        push dx
        push di
        push es
        cmp al, 13
        je .cr
        cmp al, 10
        je .lf
        cmp al, 8
        je .bs
        cmp al, 7
        je .bel
        push ax
        call get_class
        mov ah, al
        cmp ah, 2
        pop ax
        jae .gfx
        call set_vseg
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
        call cur_ptr
        mov dx, [bx]
        mov bl, [bp+14]               ; colour: the caller's BL
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
        mov al, [VID_ROWS]
        cmp [bx+1], al
        jbe .ok
        mov [bx+1], al
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
        pop es
        pop di
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; scroll the whole screen up one line. Text: the new line gets the attribute of
; the cell at the cursor; graphics: colour 0.
scroll_line:
        push ax
        push bx
        push cx
        push dx
        push si
        push es
        call get_class
        mov [bp+L_CLASS], al
        mov bh, 0x07
        cmp al, 2
        jae .g
        call set_vseg
        push di
        mov bh, [VID_PAGE]
        call page_cell
        mov bh, [es:di+1]
        pop di
.g:     cmp byte [bp+L_CLASS], 2
        jb .t
        xor bh, bh
.t:     mov al, 1
        xor cx, cx
        mov dh, [VID_ROWS]
        mov dl, [VID_COLS]
        dec dl
        xor si, si
        cmp byte [bp+L_CLASS], 2
        jae .gs
        call tscroll
        jmp .e
.gs:    cmp byte [bp+L_CLASS], 4
        jae .ps
        call cscroll
        jmp .e
.ps:    call pscroll
.e:     pop es
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; beep: about 880 Hz for a moment with the timer and the speaker port
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
; AH=10h palette and DAC registers
v_palette:
        cmp al, 0x00
        je .set1
        cmp al, 0x01
        je .ovs
        cmp al, 0x02
        je .all
        cmp al, 0x03
        je .blink
        cmp al, 0x07
        je .get1
        cmp al, 0x08
        je .getovs
        cmp al, 0x09
        je .getall
        jmp v_pal2
.set1:  mov al, bl
        and al, 0x1F
        mov ah, bh
        call attr_write
        jmp v_done_ax
.ovs:   mov al, 0x11
        mov ah, bh
        call attr_write
        jmp v_done_ax
.all:   mov si, dx
        xor al, al
        mov cx, 16
.a1:    mov ah, [es:si]
        call attr_write
        inc si
        inc al
        loop .a1
        mov al, 0x11
        mov ah, [es:si]
        call attr_write
        jmp v_done_ax
.blink: mov al, 0x10
        call attr_read
        and ah, 0xF7
        test bl, 1
        jz .b1
        or ah, 0x08
.b1:    call attr_write
        jmp v_done_ax
.get1:  mov al, bl
        and al, 0x1F
        call attr_read
        mov [bp+15], ah
        jmp v_done_ax
.getovs:
        mov al, 0x11
        call attr_read
        mov [bp+15], ah
        jmp v_done_ax
.getall:
        mov di, dx
        xor al, al
        mov cx, 16
.g1:    call attr_read
        mov [es:di], ah
        inc di
        inc al
        loop .g1
        mov al, 0x11
        call attr_read
        mov [es:di], ah
        jmp v_done_ax

v_pal2: cmp al, 0x10
        je .dac1
        cmp al, 0x12
        je .dacblk
        cmp al, 0x13
        je .page
        cmp al, 0x15
        je .rdac1
        cmp al, 0x17
        je .rdacblk
        cmp al, 0x18
        je .setmask
        cmp al, 0x19
        je .getmask
        cmp al, 0x1A
        je .getpage
        cmp al, 0x1B
        je .grey
        jmp v_done_ax
.dac1:  push dx
        mov dx, 0x3C8
        mov al, bl
        out dx, al
        inc dx
        pop ax
        mov al, ah                    ; DH = red
        out dx, al
        mov al, ch                    ; CH = green
        out dx, al
        mov al, cl                    ; CL = blue
        out dx, al
        jmp v_done_ax
.dacblk:
        mov si, dx
        mov dx, 0x3C8
        mov al, bl
        out dx, al
        inc dx
        mov ax, cx
        add cx, ax
        add cx, ax
        jcxz .x
.d1:    mov al, [es:si]
        out dx, al
        inc si
        loop .d1
.x:     jmp v_done_ax
.page:  mov al, 0x10
        call attr_read
        or bl, bl
        jnz .pg
        and ah, 0x7F                  ; BL = 0: paging mode BH (0: 4 x 64, 1: 16 x 16)
        test bh, 1
        jz .pm
        or ah, 0x80
.pm:    call attr_write
        jmp v_done_ax
.pg:    mov cl, bh                    ; BL = 1: colour page BH
        test ah, 0x80
        jnz .p16
        and cl, 3
        shl cl, 1
        shl cl, 1
.p16:   and cl, 0x0F
        mov al, 0x14
        mov ah, cl
        call attr_write
        jmp v_done_ax
.rdac1: mov dx, 0x3C7
        mov al, bl
        out dx, al
        mov dx, 0x3C9
        in al, dx
        mov [bp+11], al               ; DH = red
        in al, dx
        mov [bp+13], al               ; CH = green
        in al, dx
        mov [bp+12], al               ; CL = blue
        jmp v_done_ax
.rdacblk:
        mov di, dx
        mov dx, 0x3C7
        mov al, bl
        out dx, al
        mov dx, 0x3C9
        mov ax, cx
        add cx, ax
        add cx, ax
        jcxz .x2
.r1:    in al, dx
        mov [es:di], al
        inc di
        loop .r1
.x2:    jmp v_done_ax
.setmask:
        mov dx, 0x3C6
        mov al, bl
        out dx, al
        jmp v_done_ax
.getmask:
        mov dx, 0x3C6
        in al, dx
        mov [bp+14], al
        jmp v_done_ax
.getpage:
        mov al, 0x10
        call attr_read
        xor bl, bl
        test ah, 0x80
        jz .gp1
        mov bl, 1
.gp1:   mov [bp+14], bl
        mov al, 0x14
        mov cl, ah
        call attr_read
        mov al, ah
        and al, 0x0F
        test cl, 0x80
        jnz .gp2
        shr al, 1
        shr al, 1
        and al, 3
.gp2:   mov [bp+15], al
        jmp v_done_ax
.grey:  call grey_sum
        jmp v_done_ax

; ----------------------------------------------------------
; AH=11h character generator
v_font: cmp al, 0x30
        jne .n30
        jmp f_info
.n30:   cmp al, 0x20
        jb .load
        jmp f_gfx
.load:  cmp al, 0x03
        jne .n3
        mov dx, 0x3C4                 ; AL=03h: character map select BL
        mov al, 3
        mov ah, bl
        out dx, ax
        jmp v_done_ax
.n3:    mov ah, al
        and ah, 0x0F
        cmp ah, 0x00
        je .user
        mov cx, 256
        xor dx, dx
        push cs
        pop es
        mov si, font8x14
        mov bh, 14
        cmp ah, 0x01
        je .ld
        mov si, font8x8
        mov bh, 8
        cmp ah, 0x02
        je .ld
        mov si, font8x16
        mov bh, 16
        cmp ah, 0x04
        je .ld
        jmp v_done_ax
.user:  mov si, [bp+0]                ; ES:BP = the caller's table
.ld:    call load_font
        test al, 0x10
        jz .x
        mov al, bh
        call recalc
.x:     jmp v_done_ax

; the text screen after a font change: character height AL, rows from the scan lines
recalc: push ax
        push bx
        push cx
        push dx
        mov cl, al                    ; CL = height
        xor ch, ch
        call get_class
        cmp al, 2
        jb .t
        jmp .x
.t:     mov [CHAR_H], cx
        mov dx, [CRT_BASE]
        mov al, 0x09                  ; max scan line = height - 1
        out dx, al
        inc dx
        in al, dx
        and al, 0xE0
        mov ah, cl
        dec ah
        or al, ah
        out dx, al
        dec dx
        mov bl, al                    ; BL bit 7 = double scan
        mov al, 0x12                  ; displayed lines = vertical display end + 1
        out dx, al
        inc dx
        in al, dx
        dec dx
        mov bh, al
        mov al, 0x07
        out dx, al
        inc dx
        in al, dx
        dec dx
        mov ah, 0
        test al, 0x02
        jz .v8
        inc ah
.v8:    test al, 0x40
        jz .v9
        add ah, 2
.v9:    mov al, bh
        inc ax
        test bl, 0x80
        jz .nd
        shr ax, 1
.nd:    div cl                        ; AL = rows
        mov bh, al
        dec al
        mov [VID_ROWS], al
        mov al, bh
        mul cl                        ; AX = rows * height
        test bl, 0x80
        jz .nd2
        shl ax, 1
.nd2:   dec ax
        mov ah, al
        mov al, 0x12
        out dx, ax
        mov al, bh                    ; page size = rows * columns * 2
        mul byte [VID_COLS]
        shl ax, 1
        mov [VID_PSIZE], ax
        mov ah, cl                    ; the cursor near the bottom of the cell
        sub ah, 3
        cmp cl, 8
        ja .cu
        mov ah, cl
        sub ah, 2
.cu:    mov al, ah
        inc al
        mov [CUR_TYPE], al
        mov [CUR_TYPE+1], ah
        push ax
        mov al, 0x0A
        call crtc_out
        pop ax
        mov ah, al
        mov al, 0x0B
        call crtc_out
.x:     pop dx
        pop cx
        pop bx
        pop ax
        ret

; AL=20h-24h: graphics font vectors
f_gfx:  cmp al, 0x20
        jne .n20
        xor ax, ax                    ; INT 1Fh = ES:BP
        push ds
        mov ds, ax
        mov ax, [bp+0]
        mov [0x1F*4], ax
        mov [0x1F*4+2], es
        pop ds
        jmp v_done_ax
.n20:   mov si, [bp+0]
        cmp al, 0x21
        je .set
        push cs
        pop es
        mov si, font8x14
        mov cx, 14
        cmp al, 0x22
        je .set
        mov si, font8x8
        mov cx, 8
        cmp al, 0x23
        je .set
        mov si, font8x16
        mov cx, 16
        cmp al, 0x24
        je .set
        jmp v_done_ax
.set:   push ds
        xor ax, ax
        mov ds, ax
        cli
        mov [0x43*4], si
        mov [0x43*4+2], es
        sti
        pop ds
        mov [CHAR_H], cx
        mov al, dl                    ; rows: BL = 0 -> DL, 1 -> 14, 2 -> 25, 3 -> 43
        cmp bl, 1
        jne .r2
        mov al, 14
.r2:    cmp bl, 2
        jne .r3
        mov al, 25
.r3:    cmp bl, 3
        jne .r4
        mov al, 43
.r4:    dec al
        mov [VID_ROWS], al
        jmp v_done_ax

; AL=30h font information: ES:BP = table BH, CX = height, DL = rows - 1
f_info: mov al, bh
        xor bx, bx
        mov es, bx
        cmp al, 0
        jne .n0
        les bx, [es:0x1F*4]
        jmp .ret
.n0:    cmp al, 1
        jne .n1
        les bx, [es:0x43*4]
        jmp .ret
.n1:    push cs
        pop es
        mov bx, font8x14
        cmp al, 2
        je .ret
        mov bx, font8x8
        cmp al, 3
        je .ret
        mov bx, font8x8 + 0x400
        cmp al, 4
        je .ret
        mov bx, font8x16
        cmp al, 6
        je .ret
        mov bx, font_alt              ; 5, 7: no 9-dot alternates
.ret:   mov [bp+0], bx                ; BP
        mov [bp+2], es                ; ES
        mov cx, [CHAR_H]
        mov [bp+12], cx
        mov dl, [VID_ROWS]
        mov [bp+10], dl
        jmp v_done_ax

; ----------------------------------------------------------
; AH=12h alternate select
v_alt:  cmp bl, 0x10
        jne .n10
        xor bh, bh                    ; BH = 0: colour
        cmp word [CRT_BASE], 0x3B4
        jne .c
        inc bh
.c:     mov bl, 3                     ; 256 KB
        mov [bp+14], bx
        mov cl, [EGA_SW]
        and cl, 0x0F
        xor ch, ch                    ; feature bits
        mov [bp+12], cx
        jmp v_done_ax
.n10:   cmp bl, 0x30
        jne .n30
        mov ah, [VGA_FLAGS]
        and ah, 0x6F
        cmp al, 0
        jne .s1
        or ah, 0x80                   ; 200 lines
.s1:    cmp al, 2
        jne .s2
        or ah, 0x10                   ; 400 lines
.s2:    cmp al, 2
        ja .no
        mov [VGA_FLAGS], ah
        jmp .ok
.n30:   cmp bl, 0x31
        jne .n31
        and byte [VGA_FLAGS], 0xF7    ; default palette loading on
        or al, al
        jz .ok
        or byte [VGA_FLAGS], 0x08
        jmp .ok
.n31:   cmp bl, 0x32
        jne .n32
        mov dx, 0x3C3
        push ax
        xor al, 1
        and al, 1
        out dx, al
        pop ax
        jmp .ok
.n32:   cmp bl, 0x33
        jne .n33
        or byte [VGA_FLAGS], 0x02     ; grey summing on
        or al, al
        jz .ok
        and byte [VGA_FLAGS], 0xFD
        jmp .ok
.n33:   cmp bl, 0x34
        jne .n34
        and byte [EGA_INFO], 0xFE     ; cursor emulation on
        or al, al
        jz .ok
        or byte [EGA_INFO], 0x01
        jmp .ok
.n34:   cmp bl, 0x36
        jne .no
        mov dx, 0x3C4
        mov al, 1
        out dx, al
        inc dx
        in al, dx
        and al, 0xDF
        cmp byte [bp+L_AX], 0
        je .on
        or al, 0x20                   ; screen off
.on:    out dx, al
.ok:    mov al, 0x12
        mov ah, [bp+L_AX+1]
        jmp v_done
.no:    jmp v_done_ax

; ----------------------------------------------------------
; AH=13h write string ES:BP, CX characters, at DH,DL on page BH.
; AL bit 0 = move the cursor, bit 1 = the string has attribute bytes.
v_wstr: mov si, [bp+0]
        mov [bp+L_S3], al
        push bx
        mov bl, bh
        and bx, 7
        shl bx, 1
        mov ax, [bx+CUR_POS]
        mov [bp+L_S1], ax             ; the old cursor of page BH
        mov [bx+CUR_POS], dx
        mov [bp+L_S2], bx
        pop bx
.l:     jcxz .end
        mov al, [es:si]
        inc si
        test byte [bp+L_S3], 2
        jz .na
        mov bl, [es:si]
        inc si
.na:    call wchar
        dec cx
        jmp .l
.end:   test byte [bp+L_S3], 1
        jnz .keep
        mov bx, [bp+L_S2]
        mov ax, [bp+L_S1]
        mov [bx+CUR_POS], ax
.keep:  call set_hw_cursor
        jmp v_done_ax

; one character of a string: AL, attribute BL, page BH (the cursor moves)
wchar:  push ax
        push bx
        push cx
        push dx
        push si
        push di
        push es
        cmp al, 7
        je .ctl
        cmp al, 8
        je .ctl
        cmp al, 10
        je .ctl
        cmp al, 13
        je .ctl
        push ax
        call get_class
        mov ah, al
        cmp ah, 2
        pop ax
        jae .g
        call set_vseg
        call page_cell
        mov ah, bl
        stosw
        jmp .adv
.g:     push bx
        mov bl, bh
        and bx, 7
        shl bx, 1
        mov dx, [bx+CUR_POS]
        pop bx
        call gglyph
.adv:   mov si, bx
        mov bl, bh
        and bx, 7
        shl bx, 1
        add bx, CUR_POS
        inc byte [bx]
        mov al, [VID_COLS]
        cmp [bx], al
        jb .x
        mov byte [bx], 0
        inc byte [bx+1]
        mov al, [VID_ROWS]
        cmp [bx+1], al
        jbe .x
        mov [bx+1], al
        call scroll_line
        jmp .x
.ctl:   mov ah, [VID_PAGE]            ; control characters: teletype on the active page
        cmp ah, bh
        jne .x
        call tty
.x:     pop es
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; ----------------------------------------------------------
; AH=1Ah display combination: AL=0 read (BL = 08h VGA colour), AL=1 write
v_dcc:  cmp al, 0
        jne .w
        mov byte [bp+14], 0x08
        mov byte [bp+15], 0x00
        mov al, 0x1A
        jmp v_done
.w:     cmp al, 1
        jne .x
        mov al, 0x1A
        jmp v_done
.x:     jmp v_done_ax

; AH=1Bh functionality and state information into ES:DI (64 bytes)
v_state:
        or bx, bx
        jz .go
        jmp v_done_ax
.go:    mov word [es:di], static_tab
        mov [es:di+2], cs
        push di
        add di, 4
        mov si, VID_MODE
        mov cx, 30
        rep movsb                     ; BDA 49h-66h
        mov al, [VID_ROWS]
        inc al
        stosb                         ; +22h rows
        mov ax, [CHAR_H]
        stosw                         ; +23h character height
        mov al, 0x08
        stosb                         ; +25h active display: VGA colour
        xor al, al
        stosb                         ; +26h no second display
        push di
        call get_class
        mov bl, al
        pop di
        mov ax, 16
        cmp bl, 5
        jne .c1
        mov ax, 256
.c1:    cmp bl, 2
        jne .c2
        mov ax, 4
.c2:    cmp bl, 3
        jne .c3
        mov ax, 2
.c3:    cmp bl, 1
        jne .c4
        xor ax, ax
.c4:    stosw                         ; +27h colours
        mov al, 8
        cmp bl, 2
        jb .c5
        mov al, 1
.c5:    stosb                         ; +29h pages
        mov al, 2                     ; +2Ah scan lines: 0 200, 1 350, 2 400, 3 480
        cmp byte [VID_MODE], 0x11
        jb .c6
        cmp byte [VID_MODE], 0x13
        je .c6
        mov al, 3
.c6:    stosb
        xor ax, ax
        stosw                         ; +2Bh character blocks
        mov al, [VGA_FLAGS]
        and al, 0x0F
        stosb                         ; +2Dh state flags
        xor ax, ax
        stosw
        stosb                         ; +2Eh-30h reserved
        mov al, 3
        stosb                         ; +31h 256 KB
        xor al, al
        stosb                         ; +32h save pointer state
        mov cx, 13
        rep stosb
        pop di
        mov al, 0x1B
        jmp v_done

; ----------------------------------------------------------
; static functionality table (INT 10h AH=1Bh)
static_tab:
        db 0xFF, 0x60, 0x0F           ; modes 00h-07h, 0Dh-0Eh, 10h-13h
        db 0, 0, 0, 0
        db 0x07                       ; 200, 350 and 400 scan lines in text modes
        db 8, 2                       ; character blocks: 8, 2 at a time
        db 0xFF, 0x0E                 ; functions supported
        db 0, 0
        db 0x3F, 0

; save pointer table (0040:00A8)
save_ptr:
        dw params, 0xC000             ; video parameter table
        dw 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
font_alt:
        db 0

; ----------------------------------------------------------
${tables}
; fonts: the page draws them at start-up
font8x8:
        times 2048 db 0
font8x14:
        times 3584 db 0
font8x16:
        times 4096 db 0
rom_end:
`;
})();

// Assemble the VGA BIOS into a 32 KB ROM image. fonts = { f8, f14, f16 } (Uint8Array
// 256 * height), or null for blank fonts (tests). The last byte makes the checksum 0.
function makeVgaRom(fonts) {
  const r = Asm86.assemble(VGA_BIOS_SOURCE, { origin: 0 });
  if (!r.ok) throw new Error('VGA BIOS assembly failed: ' + r.errors.slice(0, 5).map(x => `line ${x.line}: ${x.msg}`).join('; '));
  if (r.bytes.length > 0x7FFF) throw new Error('VGA BIOS is larger than 32 KB');
  const rom = new Uint8Array(0x8000);
  rom.set(r.bytes);
  const S = r.symbols;
  if (fonts) {
    if (fonts.f8) rom.set(fonts.f8.subarray(0, 2048), S.font8x8);
    if (fonts.f14) rom.set(fonts.f14.subarray(0, 3584), S.font8x14);
    if (fonts.f16) rom.set(fonts.f16.subarray(0, 4096), S.font8x16);
  }
  let sum = 0;
  for (let i = 0; i < 0x7FFF; i++) sum += rom[i];
  rom[0x7FFF] = (0x100 - (sum & 0xFF)) & 0xFF;
  return { bytes: rom, symbols: S, lineMap: r.lineMap };
}
