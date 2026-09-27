// Build the Explain player into one page: dist/8086-explain.html (the shell src/explain/explain.html
// with src/explain/data.js and src/explain/explain.js inline). Make the data first with
// `node tools/explain-data.mjs`.
// Usage: node tools/explain-build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
let html = rd('src/explain/explain.html');
const put = (mark, code) => { if (!html.includes(mark)) throw new Error('no ' + mark); html = html.replace(mark, () => code.replace(/<\/script/gi, '<\\/script')); };
put('/*DATA*/', rd('src/explain/data.js'));
put('/*SCRIPT*/', rd('src/explain/explain.js'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/8086-explain.html'), html);
console.log(`dist/8086-explain.html ${Math.round(html.length / 1024)} KB`);
