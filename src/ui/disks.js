// The Disks panel: floppy images for drives A: and B: and the hard disk C:, kept in this
// browser only (IndexedDB). Nothing is uploaded anywhere.

const DiskStore = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('anatomy86', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('disks');
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  },
  async get(key) {
    const db = await this.open();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const r = db.transaction('disks').objectStore('disks').get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  },
  async set(key, val) {
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction('disks', 'readwrite');
      if (val) tx.objectStore('disks').put(val, key); else tx.objectStore('disks').delete(key);
    } catch (e) { /* storage blocked or full */ }
  },
};

class DiskPanel {
  constructor(app) {
    this.app = app;
    this.m = app.machine;
    this.fileIn = document.getElementById('disk-file');
    this.addIn = document.getElementById('disk-add');
    this.folderIn = document.getElementById('disk-folder');
    this.target = 0;
    this.fileIn.addEventListener('change', e => { this.loadImages(this.target, e.target.files); e.target.value = ''; });
    this.addIn.addEventListener('change', e => { this.addFiles(this.target, e.target.files); e.target.value = ''; });
    if (this.folderIn) this.folderIn.addEventListener('change', e => { this.addTree(2, [...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }))); e.target.value = ''; });
    for (const i of DiskPanel.DRIVES) {
      const card = document.getElementById('drive-' + i);
      if (!card) continue;
      card.addEventListener('click', e => {
        const b = e.target.closest('button[data-act]');
        if (b) this.action(i, b.dataset.act);
      });
      card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drop'); });
      card.addEventListener('dragleave', () => card.classList.remove('drop'));
      card.addEventListener('drop', e => { e.preventDefault(); card.classList.remove('drop'); this.dropped(i, e.dataTransfer); });
    }
    document.getElementById('btn-boot-disk').addEventListener('click', () => app.bootDisk('A'));
    const bh = document.getElementById('btn-boot-hd');
    if (bh) bh.addEventListener('click', () => app.bootDisk('C'));
    this.paths = ['', '', ''];
    this.editorUi();
    this.restore();
    this.saveTimer = setInterval(() => this.persistDirty(), 3000);
  }
  // Drives: 0 = A:, 1 = B: (floppies), 2 = C: (the hard disk).
  static get DRIVES() { return [0, 1, 2]; }
  disk(i) { return i === 2 ? this.m.hdisk : this.m.disks[i]; }
  letter(i) { return 'ABC'[i]; }
  fsOf(i) { const d = this.disk(i); return i === 2 ? hdFs(d.data) : new Fat12(d.data); }
  key(i) { return i === 2 ? 'hd0' : 'drive' + i; }
  async restore() {
    for (const i of DiskPanel.DRIVES) {
      const v = await DiskStore.get(this.key(i));
      if (v && v.bytes) {
        try {
          if (i === 2) this.m.insertHardDisk(v.name, new Uint8Array(v.bytes)); else this.m.insertDisk(i, v.name, new Uint8Array(v.bytes));
        } catch (e) { /* stale entry */ }
      }
    }
    this.render();
  }
  persist(i) {
    const d = this.disk(i);
    DiskStore.set(this.key(i), d ? { name: d.name, bytes: d.data.buffer.slice(0) } : null);
  }
  persistDirty() {
    for (const i of DiskPanel.DRIVES) {
      const d = this.disk(i);
      if (d && d.dirty) { d.dirty = false; this.persist(i); this.render(); }
    }
  }
  action(i, act) {
    this.target = i;
    if (act !== 'new') { const row = document.querySelector(`#drive-${i} .drive-new`); if (row) row.hidden = true; }
    if (act === 'load') this.fileIn.click();
    else if (act === 'add') this.addIn.click();
    else if (act === 'folder') { if (this.folderIn) this.folderIn.click(); }
    else if (act === 'newfile') { if (this.disk(i)) this.openFile(i, null); }
    else if (act === 'new') this.askSize(i);
    else if (act === 'new144' || act === 'new288') {
      const big = act === 'new288';
      this.askSize(i, false);
      this.m.insertDisk(i, i ? 'new-disk-b.img' : 'new-disk-a.img', fat12Blank('ANATOMY86', big ? 2949120 : 1474560));
      this.changed(i, `A new empty ${big ? '2.88' : '1.44'} MB disk is in drive ${i ? 'B' : 'A'}:.`);
    } else if (act === 'hdnew' || act === 'hdboot') this.newHardDisk(act === 'hdboot');
    else if (act === 'eject') {
      if (i === 2) { this.m.ejectHardDisk(); this.paths[2] = ''; this.changed(2, 'There is no hard disk now. Boot again, so the BIOS sees it.'); }
      else { this.m.ejectDisk(i); this.changed(i, `Drive ${i ? 'B' : 'A'}: is empty.`); }
    } else if (act === 'save') {
      const d = this.disk(i);
      if (!d) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([d.data], { type: 'application/octet-stream' }));
      a.download = /\.(img|ima|dsk|vfd|hdd|bin)$/i.test(d.name) ? d.name : d.name + '.img';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  }
  // A new 20 MB hard disk: empty, or bootable with the DOS of the floppy in drive A: (as SYS C:).
  newHardDisk(bootable) {
    try {
      const img = hdBlank('DRIVE C');
      let what = 'A new empty 20 MB hard disk is in drive C:.';
      if (bootable) {
        const a = this.m.disks[0];
        if (!a) throw new Error('Put a DOS system disk in drive A: first (for example your MS-DOS floppy image). Its system files go to drive C:.');
        const files = hdMakeBootable(img, a.data);
        what = `A new bootable 20 MB drive C: with ${files.join(', ')} from ${a.name}. Press "Boot from C:", or remove the disk from A: and reset.`;
      }
      this.m.insertHardDisk(bootable ? 'dos-c.img' : 'drive-c.img', img);
      this.paths[2] = '';
      this.changed(2, what);
    } catch (e) { this.message(e.message, true); }
  }
  // "New disk": two buttons in the drive card for the size (1.44 MB or 2.88 MB).
  askSize(i, show = true) {
    const card = document.getElementById('drive-' + i);
    let row = card.querySelector('.drive-new');
    if (!row) {
      row = htmlEl('div', { class: 'drive-actions drive-new', style: 'align-items: center', role: 'group', 'aria-label': 'Size of the new disk' });
      htmlEl('span', { class: 'drive-meta' }, row, 'New disk size:');
      htmlEl('button', { type: 'button', class: 'tool-btn', 'data-act': 'new144', 'aria-label': `Put a new empty 1.44 MB disk in drive ${i ? 'B' : 'A'}:` }, row, '1.44 MB');
      htmlEl('button', { type: 'button', class: 'tool-btn', 'data-act': 'new288', 'aria-label': `Put a new empty 2.88 MB disk in drive ${i ? 'B' : 'A'}:` }, row, '2.88 MB');
      row.hidden = true;
      card.querySelector('.drive-actions').after(row);
    }
    row.hidden = !show || !row.hidden;
    if (!row.hidden) row.querySelector('button').focus();
  }
  async loadImages(i, files) {
    const f = files && files[0];
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (i === 2) {
        this.m.insertHardDisk(f.name, bytes);
        this.paths[2] = '';
        this.changed(2, `${f.name} is in drive C: (${this.m.hdisk.label}). Boot again, so the BIOS sees it.`);
      } else {
        this.m.insertDisk(i, f.name, bytes);
        this.changed(i, `${f.name} is in drive ${i ? 'B' : 'A'}:.`);
      }
    } catch (e) { this.message(e.message, true); }
  }
  async addFiles(i, fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    if (i === 2) { this.addTree(2, files.map(f => ({ path: f.name, file: f }))); return; }
    try {
      if (!this.m.disks[i]) this.m.insertDisk(i, i ? 'files-b.img' : 'files-a.img', fat12Blank('ANATOMY86'));
      const list = await Promise.all(files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const names = fat12AddFiles(this.m.disks[i].data, list);
      this.m.disks[i].dirty = false;
      this.changed(i, `Copied ${names.join(', ')} to drive ${i ? 'B' : 'A'}:.`);
    } catch (e) { this.message(e.message, true); }
  }
  // Copy files with their relative paths (a folder and its subfolders) to the folder of drive C:
  // that the list shows. entries: [{ path: 'FOLDER/SUB/NAME.EXT', file: File }].
  async addTree(i, entries) {
    if (!entries.length) return;
    try {
      if (!this.m.hdisk) this.m.insertHardDisk('drive-c.img', hdBlank('DRIVE C'));
      const list = await Promise.all(entries.map(async e => ({ path: e.path, bytes: new Uint8Array(await e.file.arrayBuffer()) })));
      const r = fatAddTree(this.fsOf(2), list, this.paths[2]);
      this.m.hdisk.dirty = false;
      const where = `C:\\${this.paths[2]}`;
      let msg = `Copied ${r.files} file${r.files === 1 ? '' : 's'}${r.dirs ? ` in ${r.dirs} folder${r.dirs === 1 ? '' : 's'}` : ''} to ${where}.`;
      if (r.renamed.length) {
        const show = r.renamed.slice(0, 4).map(x => `${x.from.split('/').pop()} → ${x.to.split('\\').pop()}`).join(', ');
        msg += ` ${r.renamed.length} long name${r.renamed.length === 1 ? '' : 's'} became DOS 8.3 name${r.renamed.length === 1 ? '' : 's'}: ${show}${r.renamed.length > 4 ? ', …' : ''}.`;
      }
      if (this.app.running && this.app.bootMode === 'disk') msg += ' Boot again, so DOS reads the new files.';
      this.changed(2, msg);
    } catch (e) { this.message(e.message, true); this.render(); }
  }
  // Something was dropped on a drive: a disk image, files, or (on drive C:) folders.
  async dropped(i, dt) {
    const files = [...dt.files];
    if (i !== 2) {
      const imgs = files.filter(f => FLOPPY_TYPES.some(t => t[0] === f.size));
      if (imgs.length === 1 && files.length === 1) this.loadImages(i, imgs);
      else this.addFiles(i, files);
      return;
    }
    // drive C: the folders keep their tree (webkitGetAsEntry); one big file of whole sectors
    // with a name of a disk image is a hard disk image
    const items = [...(dt.items || [])].map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    if (items.length === 1 && items[0].isFile && files.length === 1 && /\.(img|hdd|bin|vhd)$/i.test(files[0].name) && files[0].size >= 1048576 && files[0].size % 512 === 0) {
      this.loadImages(2, files);
      return;
    }
    if (!items.length) { this.addTree(2, files.map(f => ({ path: f.name, file: f }))); return; }
    const out = [];
    const walk = async (en, base) => {
      if (en.isFile) { const f = await new Promise((ok, no) => en.file(ok, no)); out.push({ path: base + en.name, file: f }); return; }
      const rd = en.createReader();
      for (;;) {
        const batch = await new Promise((ok, no) => rd.readEntries(ok, no));
        if (!batch.length) break;
        for (const x of batch) await walk(x, base + en.name + '/');
      }
    };
    try { for (const en of items) await walk(en, ''); } catch (e) { this.message('The browser did not give the dropped files: ' + e.message, true); return; }
    this.addTree(2, out);
  }
  changed(i, msg) {
    this.persist(i);
    this.render();
    this.message(msg, false);
  }
  message(text, bad) {
    const s = document.getElementById('disk-status');
    s.textContent = text;
    s.className = 'disk-status' + (bad ? ' bad' : ' ok');
    this.app.announce(text);
  }
  render() {
    for (const i of DiskPanel.DRIVES) {
      const card = document.getElementById('drive-' + i);
      if (!card) continue;
      const d = this.disk(i), L = this.letter(i);
      card.classList.toggle('empty', !d);
      document.getElementById(`drive-${i}-name`).textContent = d ? d.name : 'empty';
      let fs = null;
      if (d) { try { fs = this.fsOf(i); } catch (e) { fs = null; } }
      document.getElementById(`drive-${i}-meta`).textContent = !d ? (i === 2 ? 'no hard disk' : 'no disk')
        : i === 2 ? `${d.label}${fs ? ` · ${(fs.free() / 1048576).toFixed(1)} MB free` : ' · no FAT partition'}`
          : `${d.label} · ${d.cyls} cyl × ${d.heads} heads × ${d.spt} sectors`;
      const ul = document.getElementById(`drive-${i}-files`), pathEl = document.getElementById(`drive-${i}-path`);
      ul.innerHTML = '';
      pathEl.innerHTML = '';
      if (!d) this.paths[i] = '';
      if (d) {
        let files = [];
        if (fs) {
          try { files = fs.list(fs.dirCluster(this.paths[i])); } catch (e) { this.paths[i] = ''; try { files = fs.list(0); } catch (e2) { files = []; } }
        }
        pathEl.hidden = !this.paths[i];
        if (this.paths[i]) {
          const up = htmlEl('button', { type: 'button', class: 'tool-btn', 'aria-label': 'Go to the parent folder' }, pathEl, 'Up');
          up.addEventListener('click', () => { this.paths[i] = this.paths[i].split('\\').slice(0, -1).join('\\'); this.render(); });
          htmlEl('span', null, pathEl, `${L}:\\${this.paths[i]}`);
        }
        files.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
        for (const f of files.slice(0, 200)) {
          const li = htmlEl('li', { class: f.dir ? 'dir' : '' }, ul);
          const b = htmlEl('button', { type: 'button', title: f.dir ? `Open the folder ${f.name}` : `Open ${f.name} in the editor` }, li);
          htmlEl('span', null, b, f.name);
          htmlEl('span', null, b, f.dir ? '<DIR>' : f.size.toLocaleString('en-US'));
          b.addEventListener('click', () => {
            if (f.dir) { this.paths[i] = this.paths[i] ? `${this.paths[i]}\\${f.name}` : f.name; this.render(); }
            else this.openFile(i, f.name);
          });
        }
        if (files.length > 200) htmlEl('li', { class: 'none' }, ul, `… ${files.length - 200} more`);
        if (!files.length) htmlEl('li', { class: 'none' }, ul, fs ? 'no files' : 'no FAT file system');
      }
      card.querySelectorAll('[data-act=save],[data-act=eject],[data-act=newfile]').forEach(b => { b.disabled = !d; });
    }
    document.getElementById('btn-boot-disk').disabled = !this.m.disks[0];
    const bh = document.getElementById('btn-boot-hd');
    if (bh) bh.disabled = !this.m.hdisk;
  }
  // ---------- the file editor ----------
  editorUi() {
    const $ = id => document.getElementById(id);
    this.fe = { dlg: $('fedit'), name: $('fedit-name'), text: $('fedit-text'), hex: $('fedit-hex'), note: $('fedit-note'),
      where: $('fedit-where'), title: $('fedit-title'), del: $('fedit-delete') };
    $('fedit-cancel').addEventListener('click', () => this.fe.dlg.close());
    $('fedit-save').addEventListener('click', () => this.saveFile(false));
    $('fedit-reboot').addEventListener('click', () => this.saveFile(true));
    this.fe.del.addEventListener('click', () => this.deleteFile());
    this.fe.text.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); this.fe.text.setRangeText('\t', this.fe.text.selectionStart, this.fe.text.selectionEnd, 'end'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.saveFile(false); }
    });
  }
  // Open a file (name) of drive i in the current folder, or a new empty file (name = null).
  openFile(i, name) {
    const d = this.disk(i), fe = this.fe;
    if (!d) return;
    const path = this.paths[i];
    let bytes = new Uint8Array(0);
    try {
      if (name) {
        const fs = this.fsOf(i), en = fs.find(path, name);
        if (!en) throw new Error(`No file ${name}.`);
        bytes = fs.read(en);
      }
    } catch (e) { this.message(e.message, true); return; }
    let ctl = 0;
    for (const b of bytes) if ((b < 9 || (b > 13 && b < 32 && b !== 26)) || b === 0) ctl++;
    const binary = bytes.length > 0 && ctl > bytes.length * 0.02;
    this.cur = { i, path, name, binary, bytes };
    fe.title.textContent = name ? (binary ? 'View file' : 'Edit file') : 'New file';
    fe.where.textContent = `${this.letter(i)}:\\${path ? path + '\\' : ''}${name || ''}`;
    fe.name.value = name || '';
    fe.del.hidden = !name;
    fe.text.hidden = binary; fe.hex.hidden = !binary;
    if (binary) {
      let out = '';
      const n = Math.min(bytes.length, 4096);
      for (let o = 0; o < n; o += 16) {
        const row = bytes.subarray(o, o + 16);
        out += hex(o, 5) + '  ' + [...row].map(hex2).join(' ').padEnd(48) + '  ' + [...row].map(c => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('') + '\n';
      }
      if (bytes.length > n) out += `… ${bytes.length - n} more bytes`;
      fe.hex.textContent = out;
      this.note(`A binary file of ${bytes.length.toLocaleString('en-US')} bytes: you can rename or delete it here, not edit it.`);
    } else {
      // code page 437 text; CR LF becomes one line break; a trailing Ctrl-Z is kept
      let t = '';
      for (const b of bytes) t += b === 26 ? '' : b < 128 ? String.fromCharCode(b) : CP437[b];
      this.cur.ctrlZ = bytes.length && bytes[bytes.length - 1] === 26;
      fe.text.value = t.replace(/\r\n/g, '\n');
      this.note(this.app.running && this.app.bootMode === 'disk'
        ? 'DOS keeps its own copy of the folder in memory: reboot after you save, so DOS reads the new file.' : '');
    }
    if (fe.dlg.showModal) fe.dlg.showModal(); else fe.dlg.setAttribute('open', '');
    (name && !binary ? fe.text : fe.name).focus();
  }
  note(t, bad) { this.fe.note.textContent = t; this.fe.note.className = 'fedit-note' + (bad ? ' bad' : ''); }
  saveFile(reboot) {
    const c = this.cur, fe = this.fe, d = c && this.disk(c.i);
    if (!d) return;
    const name = fe.name.value.trim().toUpperCase();
    if (!/^[A-Z0-9!#$%&'()\-@^_`{}~]{1,8}(\.[A-Z0-9!#$%&'()\-@^_`{}~]{1,3})?$/.test(name)) {
      this.note('Use a DOS 8.3 name, for example CONFIG.SYS or NOTES.TXT.', true); fe.name.focus(); return;
    }
    try {
      const fs = this.fsOf(c.i);
      let finalName = name;
      if (c.name && name !== c.name) finalName = fs.rename(c.path, c.name, name);
      if (!c.binary) {
        const txt = fe.text.value.replace(/\r?\n/g, '\r\n');
        const inv = CP437_INVERSE();
        const bytes = new Uint8Array(txt.length + (c.ctrlZ ? 1 : 0));
        for (let k = 0; k < txt.length; k++) { const ch = txt[k], code = ch.charCodeAt(0); bytes[k] = code < 128 ? code : (inv.get(ch) ?? 0x3F); }
        if (c.ctrlZ) bytes[txt.length] = 26;
        if (!c.name && fs.find(c.path, name)) throw new Error(`${name} already exists. Open it from the list to change it.`);
        finalName = fs.write(c.path, finalName, bytes);
      }
      d.dirty = false;
      this.changed(c.i, `Saved ${this.letter(c.i)}:\\${c.path ? c.path + '\\' : ''}${finalName}.`);
      fe.dlg.close();
      if (reboot) this.app.bootDisk(c.i === 2 || !this.m.disks[0] ? 'C' : 'A');
    } catch (e) { this.note(e.message, true); }
  }
  deleteFile() {
    const c = this.cur, d = c && this.disk(c.i);
    if (!d || !c.name) return;
    if (this.fe.del.dataset.armed !== '1') {
      this.fe.del.dataset.armed = '1';
      this.fe.del.textContent = `Delete ${c.name}? Press again`;
      setTimeout(() => { this.fe.del.dataset.armed = ''; this.fe.del.textContent = 'Delete file'; }, 3000);
      return;
    }
    this.fe.del.dataset.armed = ''; this.fe.del.textContent = 'Delete file';
    try {
      this.fsOf(c.i).remove(c.path, c.name);
      this.changed(c.i, `Deleted ${c.name}.`);
      this.fe.dlg.close();
    } catch (e) { this.note(e.message, true); }
  }

  // Drive LEDs follow the disk activity.
  frame() {
    for (const i of DiskPanel.DRIVES) {
      const d = this.disk(i);
      const led = document.getElementById(`drive-${i}-led`);
      if (led) led.style.opacity = d ? (0.15 + 0.85 * Math.min(1, d.busy * 3)).toFixed(2) : '0.1';
    }
  }
}

// An 8x8 font for the BIOS graphics text (INT 10h in modes 4-6), drawn from the
// page's monospace font at start-up: 256 characters of code page 437.
function makeFont8x8() {
  const out = new Uint8Array(2048);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  const mono = (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace').trim();
  g.font = `bold 14px ${mono}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  for (let ch = 1; ch < 256; ch++) {
    const s = CP437[ch];
    if (!s || s === ' ' || s === ' ') continue;
    g.clearRect(0, 0, 16, 16);
    g.fillStyle = '#fff';
    g.fillText(s, 8, 12);
    const px = g.getImageData(0, 0, 16, 16).data;
    for (let y = 0; y < 8; y++) {
      let row = 0;
      for (let x = 0; x < 8; x++) {
        let a = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) a += px[((y * 2 + dy) * 16 + x * 2 + dx) * 4 + 3];
        if (a / 4 > 90) row |= 0x80 >> x;
      }
      out[ch * 8 + y] = row;
    }
  }
  return out;
}

// Unicode -> code page 437 byte (for saving text files).
let cp437Inverse = null;
function CP437_INVERSE() {
  if (!cp437Inverse) { cp437Inverse = new Map(); CP437.forEach((c, i) => { if (i >= 128 && !cp437Inverse.has(c)) cp437Inverse.set(c, i); }); }
  return cp437Inverse;
}
