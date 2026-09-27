// Private test page for the board view: the last good dist build plus src/ui/board3d.js.
// Usage: node tools/board/mk.mjs  (writes tools/board/test.html)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = path.join(root, 'tools', 'board', 'base.html');
if (!fs.existsSync(base)) fs.copyFileSync(path.join(root, 'dist', '8086-anatomy.html'), base);
let html = fs.readFileSync(base, 'utf8');
const mark = '// ---- src/ui/app.js ----';
const i = html.indexOf(mark);
if (i < 0) throw new Error('app.js marker not found');
let board = fs.readFileSync(path.join(root, 'src', 'ui', 'board3d.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
html = html.slice(0, i) + `// ---- src/ui/board3d.js ----\n${board}\n` + html.slice(i);
fs.writeFileSync(path.join(root, 'tools', 'board', 'test.html'), html);
console.log('test.html written');
