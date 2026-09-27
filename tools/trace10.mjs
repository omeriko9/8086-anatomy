import fs from 'node:fs'; import vm from 'node:vm';
for (const f of ['src/asm/disasm.js','src/asm/assembler.js','src/core/fpu8087.js','src/core/cpu8086.js','src/core/devices.js','src/core/disk.js', 'src/core/fdc765.js', 'src/core/soundblaster.js','src/core/machine.js','src/core/bios.js']) vm.runInThisContext(fs.readFileSync(f,'utf8'));
const [A,M,B]=['Asm86','Machine','BIOS_SOURCE'].map(n=>vm.runInThisContext(n));
const bios=A.assemble(B,{origin:0}); const m=new M(); const rom=new Uint8Array(65536).fill(255); rom.set(bios.bytes); m.setRom(rom,bios.symbols); m.reset();
m.insertDisk(0,'b',new Uint8Array(fs.readFileSync('C:/Users/Omer/Dropbox/ESP2026/M5PaperDOS/dos_files/msdos.img')));
const i10=0xF0000+bios.symbols.int10; m.breakpoints.add(i10);
let log=''; let typed=false; let n=0;
while(n<40e6){ const r=m.run(20000); n+=20000;
  if(r==='break'){ const ax=m.cpu.regs[0]; const ah=ax>>8, al=ax&255; if(ah===0x0e) log+= al===13?'<CR>':al===10?'<LF>\n':String.fromCharCode(al); else log+=`{${ah.toString(16)}:${(ax&255).toString(16)} dx=${m.cpu.regs[2].toString(16)}}`; m.cpu.step(); }
  if(!typed && /new date/.test(log)){ typed=true; m.keyDown(0x1C); m.keyUp(0x1C);}
  if(/new time/.test(log)) break;
}
console.log(log.slice(-700));
const v=m.vram(); for(let r=8;r<18;r++){let s='';for(let c=0;c<80;c++)s+=String.fromCharCode(v[(r*80+c)*2]||32);console.log('|'+s.trimEnd());}
