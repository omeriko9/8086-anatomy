// Builds dist/8086-anatomy.html: one standalone file with inline CSS and JavaScript.
// Usage: node build.mjs [--out file.html] [--skip board3d.js,die.js]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// Order matters: later files use names from earlier files.
const SCRIPTS = [
  'src/asm/disasm.js',
  'src/asm/assembler.js',
  'src/core/fpu8087.js',
  'src/core/cpu8086.js',
  'src/core/cpu80286.js',
  'src/core/cpu80386.js',
  'src/core/cpu80486.js',
  'src/core/cpu80586.js',
  'src/core/p6ooo.wasm.js',
  'src/core/cpu80686.js',
  'src/core/devices.js',
  'src/core/disk.js',
  'src/core/fdc765.js',
  'src/core/soundblaster.js',
  'src/core/vga.js',
  'src/core/x86core.wasm.js',
  'src/core/x86wasm.js',
  'src/core/machine.js',
  'src/core/devices286.js',
  'src/core/machine286.js',
  'src/core/machine386.js',
  'src/core/machine486.js',
  'src/core/machine586.js',
  'src/core/machine686.js',
  'src/core/bios.js',
  'src/core/vgabios.js',
  'src/ui/theme.js',
  'src/ui/audio.js',
  'src/ui/crt.js',
  'src/ui/editor.js',
  'src/ui/dock.js',
  'src/ui/disks.js',
  'src/ui/tips.js',
  'src/ui/sfx.js',
  'src/ui/story.js',
  'src/ui/blocks.js',
  'src/ui/unitfx.js',
  'src/ui/die.js',
  'src/ui/timing.js',
  'src/ui/memmap.js',
  'src/ui/board3d.js',
  'src/ui/explain3d.js',
  'src/ui/topview.js',
  'src/ui/app.js',
];
const STYLES = ['src/ui/style.css'];

// three.js r160 module build -> a function scope that returns the THREE namespace.
function threeNamespace() {
  let src = read('src/vendor/three.module.min.js');
  const m = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) throw new Error('three.js export statement not found');
  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, , exported] = s.split(/\s+/);
    return `${exported || local}:${local}`;
  });
  src = src.slice(0, m.index);
  const license = read('src/vendor/LICENSE-three.txt').replace(/\*\//g, '* /');
  return `/* three.js r160 - MIT License\n${license}\n*/\nconst THREE = (function () {\n${src}\nreturn {${pairs.join(',')}};\n})();\n`;
}

const argv = process.argv.slice(2);
const argOf = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const skip = (argOf('--skip') || '').split(',').filter(Boolean);
const exists = p => fs.existsSync(path.join(root, p)) && !skip.some(s => p.endsWith(s));
const missing = SCRIPTS.filter(p => !exists(p));
if (missing.length) console.warn('build: missing (skipped):', missing.join(', '));

let app = SCRIPTS.filter(exists).map(p => `// ---- ${p} ----\n${read(p)}`).join('\n');
let js = `${threeNamespace()}\n(function () {\n'use strict';\n${app}\n})();\n`;
js = js.replace(/<\/script/gi, '<\\/script');
const css = STYLES.filter(exists).map(read).join('\n');

let html = read('src/index.html');
html = html.replace('/*STYLE*/', () => css).replace('/*SCRIPT*/', () => js);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = argOf('--out') ? path.resolve(argOf('--out')) : path.join(root, 'dist', '8086-anatomy.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
// --artifact: page content only (the artifact host adds the document skeleton).
if (argv.includes('--artifact')) {
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
  const art = `${title}
${style}
${body.trim()}
`;
  const aout = out.replace(/\.html$/, '.artifact.html');
  fs.writeFileSync(aout, art);
  console.log(`build: ${aout} ${(Buffer.byteLength(art) / 1024).toFixed(0)} KB`);
}
console.log(`build: ${out} ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
