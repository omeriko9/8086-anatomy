(() => {
const src = `org 0x100
  cli
  lgdt [gdtr]
  lidt [idtr]
  mov ax, 1
  lmsw ax
  jmp 0x08:pm
pm:
  mov ax, 0x10
  mov ds, ax
  mov es, ax
  mov ax, 0x18
  mov ss, ax
  mov sp, 0xFFF0
  mov ax, 0x28
  mov ds, ax
  hlt
gp:
  hlt
align 8
gdt: dw 0, 0, 0, 0
  dw 0xFFFF, 0x0000
  db 0x01, 0x9A
  dw 0
  dw 0xFFFF, 0x0000
  db 0x01, 0x92
  dw 0
  dw 0xFFFF, 0x0000
  db 0x01, 0x92
  dw 0
  dw 0x0FFF, 0x8000
  db 0x0B, 0x92
  dw 0
gdt_end:
idt: times 52 dw 0
  dw gp, 0x08
  db 0, 0x86
  dw 0
idt_end:
gdtr: dw gdt_end - gdt - 1
  dw gdt, 0x0001
idtr: dw idt_end - idt - 1
  dw idt, 0x0001
`;
__app.editor.value = src;
if (!__app.assembleAndLoad()) return 'ASM failed ' + document.getElementById('asm-status').textContent;
const r = __app.program;
const m = __app.machine;
__app.pause();
m.loadProgram(r.bytes, 0x100);
m.startProgram();
__app.play = null;
__app.eachView(v => v.reset());
return 'loaded ' + r.bytes.length;
})()
