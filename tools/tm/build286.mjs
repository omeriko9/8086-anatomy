// Private test build: the official build plus src/core/cpu80286.js if build.mjs does not list it yet.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const root = 'C:/Users/Omer/Dropbox/Documents/8086/';
execSync('node build.mjs --out tools/tm/tm.html --skip board3d.js,die.js', { cwd: root, stdio: 'inherit' });
const f = root + 'tools/tm/tm.html';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('// ---- src/core/cpu80286.js ----')) {
  const cpu = fs.readFileSync(root + 'src/core/cpu80286.js', 'utf8').replace(/<\/script/gi, '<\/script');
  const mark = '// ---- src/core/devices.js ----';
  const i = s.indexOf(mark);
  s = s.slice(0, i) + '// ---- src/core/cpu80286.js ----\n' + cpu + '\n' + s.slice(i);
  fs.writeFileSync(f, s);
  console.log('private build: cpu80286.js inserted');
}
