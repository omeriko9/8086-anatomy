// Floppy and hard disk images, and FAT12 / FAT16 tools.
//
// The BIOS reads and writes the floppy disks through the NEC 765 controller and the 8237 DMA
// (src/core/fdc765.js), and the hard disk through the IDE controller (IDEController in
// devices.js). diskService below is the old one-step INT 13h (OUT E0h); only tests use it now.

const FLOPPY_TYPES = [
  // size, cylinders, heads, sectors per track, BIOS drive type, media byte, label
  [163840, 40, 1, 8, 1, 0xFE, '160 KB 5.25"'],
  [184320, 40, 1, 9, 1, 0xFC, '180 KB 5.25"'],
  [327680, 40, 2, 8, 1, 0xFF, '320 KB 5.25"'],
  [368640, 40, 2, 9, 1, 0xFD, '360 KB 5.25"'],
  [737280, 80, 2, 9, 3, 0xF9, '720 KB 3.5"'],
  [1228800, 80, 2, 15, 2, 0xF9, '1.2 MB 5.25"'],
  [1474560, 80, 2, 18, 4, 0xF0, '1.44 MB 3.5"'],
  [2949120, 80, 2, 36, 5, 0xF0, '2.88 MB 3.5"'],
];

class FloppyDisk {
  constructor(name, bytes) {
    const t = FLOPPY_TYPES.find(x => x[0] === bytes.length);
    if (!t) throw new Error(`${name}: ${bytes.length} bytes is not a floppy image size (160K, 180K, 320K, 360K, 720K, 1.2M, 1.44M or 2.88M)`);
    this.name = name;
    this.data = bytes;
    [this.size, this.cyls, this.heads, this.spt, this.type, this.media, this.label] = t;
    this.busy = 0;
    this.lastSector = -1;
    this.reads = 0; this.writes = 0;
    this.dirty = false;
  }
  lba(c, h, s) { return (c * this.heads + h) * this.spt + (s - 1); }
}

// A blank formatted FAT12 disk (DOS 3.3 layout), optional volume label.
// size: 1474560 (1.44 MB, the default) or 2949120 (2.88 MB: 2 sectors per cluster,
// 240 root entries, 9-sector FATs, 36 sectors per track).
function fat12Blank(label, size = 1474560) {
  const big = size === 2949120;
  if (!big && size !== 1474560) throw new Error('fat12Blank: 1.44 MB or 2.88 MB only');
  const d = new Uint8Array(size);
  const bs = [0xEB, 0x3C, 0x90, ...'ANATOMY '.split('').map(c => c.charCodeAt(0))];
  d.set(bs, 0);
  const w16 = (o, v) => { d[o] = v & 0xFF; d[o + 1] = v >> 8; };
  w16(11, 512); d[13] = big ? 2 : 1; w16(14, 1); d[16] = 2; w16(17, big ? 240 : 224); w16(19, size / 512); d[21] = 0xF0;
  w16(22, 9); w16(24, big ? 36 : 18); w16(26, 2);
  // boot code: print a message and wait for a key, then INT 19h
  const msg = 'This is not a system disk. Press a key to try again.\r\n';
  const code = [0xFA, 0x31, 0xC0, 0x8E, 0xD8, 0x8E, 0xD0, 0xBC, 0x00, 0x7C, 0xFB, 0xBE, 0x5E, 0x7C,
    0xAC, 0x08, 0xC0, 0x74, 0x09, 0xB4, 0x0E, 0xBB, 0x07, 0x00, 0xCD, 0x10, 0xEB, 0xF2,
    0x31, 0xC0, 0xCD, 0x16, 0xCD, 0x19];
  d.set(code, 0x3E);
  for (let i = 0; i < msg.length; i++) d[0x5E + i] = msg.charCodeAt(i);
  d[510] = 0x55; d[511] = 0xAA;
  for (const fat of [512, 512 + 9 * 512]) { d[fat] = 0xF0; d[fat + 1] = 0xFF; d[fat + 2] = 0xFF; }
  if (label) {
    const root = 19 * 512, n = label.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 11).padEnd(11, ' ');
    for (let i = 0; i < 11; i++) d[root + i] = n.charCodeAt(i);
    d[root + 11] = 0x08;
  }
  return d;
}

// A small FAT file system in an image (in place): list directories (root and subdirectories),
// read, write, rename and delete files, make directories. FAT12 (a floppy) or FAT16 (a hard disk
// partition: base = the byte offset of its boot sector; see hdVolume). The type comes from the
// number of clusters, as in DOS. Paths use '\' or '/'.
class Fat12 {
  constructor(img, base = 0) {
    this.img = img;
    this.base = base;
    const r16 = o => img[base + o] | (img[base + o + 1] << 8);
    this.bps = r16(11); this.spc = img[base + 13]; this.rsv = r16(14); this.nfats = img[base + 16];
    this.rootEnts = r16(17); this.fatSz = r16(22);
    this.total = r16(19) || ((img[base + 32] | (img[base + 33] << 8) | (img[base + 34] << 16) | (img[base + 35] << 24)) >>> 0);
    if (this.bps !== 512 || !this.spc || !this.nfats || !this.fatSz || this.rootEnts > 1024) {
      throw new Error('The image has no FAT boot sector (BPB).');
    }
    this.fat0 = base + this.rsv * 512;
    this.rootOff = base + (this.rsv + this.nfats * this.fatSz) * 512;
    this.rootSecs = Math.ceil(this.rootEnts * 32 / 512);
    this.dataOff = this.rootOff + this.rootSecs * 512;
    this.csize = this.spc * 512;
    this.clusters = Math.floor((this.total - this.rsv - this.nfats * this.fatSz - this.rootSecs) / this.spc) + 2;
    this.fat16 = this.clusters - 2 >= 4085;
    this.eoc = this.fat16 ? 0xFFFF : 0xFFF;        // the end of a chain
    this.next = 2;                                   // where alloc() looks first
  }
  r16(o) { return this.img[o] | (this.img[o + 1] << 8); }
  getFat(n) {
    if (this.fat16) { const o = this.fat0 + n * 2; return this.img[o] | (this.img[o + 1] << 8); }
    const o = this.fat0 + Math.floor(n * 3 / 2), v = this.img[o] | (this.img[o + 1] << 8);
    return n & 1 ? v >> 4 : v & 0xFFF;
  }
  setFat(n, val) {
    for (let f = 0; f < this.nfats; f++) {
      const img = this.img;
      if (this.fat16) { const o = this.fat0 + f * this.fatSz * 512 + n * 2; img[o] = val & 0xFF; img[o + 1] = (val >> 8) & 0xFF; continue; }
      const o = this.fat0 + f * this.fatSz * 512 + Math.floor(n * 3 / 2);
      if (n & 1) { img[o] = (img[o] & 0x0F) | ((val << 4) & 0xF0); img[o + 1] = (val >> 4) & 0xFF; }
      else { img[o] = val & 0xFF; img[o + 1] = (img[o + 1] & 0xF0) | ((val >> 8) & 0x0F); }
    }
  }
  chain(c) {
    const out = [], end = this.fat16 ? 0xFFF0 : 0xFF0;
    while (c >= 2 && c < end && out.length < this.clusters) { out.push(c); c = this.getFat(c); }
    return out;
  }
  clusterOff(c) { return this.dataOff + (c - 2) * this.csize; }
  // Byte offsets of every 32-byte directory slot of a directory (cluster 0 = root).
  slots(dirCluster) {
    const out = [];
    if (!dirCluster) { for (let i = 0; i < this.rootEnts; i++) out.push(this.rootOff + i * 32); return out; }
    for (const c of this.chain(dirCluster)) for (let i = 0; i < this.csize / 32; i++) out.push(this.clusterOff(c) + i * 32);
    return out;
  }
  entry(o) {
    const img = this.img;
    const b = String.fromCharCode(...img.subarray(o, o + 8)).trimEnd(), e = String.fromCharCode(...img.subarray(o + 8, o + 11)).trimEnd();
    return {
      off: o, raw: String.fromCharCode(...img.subarray(o, o + 11)), name: e ? `${b}.${e}` : b, attr: img[o + 11],
      cluster: this.r16(o + 26), size: img[o + 28] | (img[o + 29] << 8) | (img[o + 30] << 16) | (img[o + 31] << 24),
      dir: !!(img[o + 11] & 0x10),
    };
  }
  list(dirCluster = 0) {
    const out = [];
    for (const o of this.slots(dirCluster)) {
      const f = this.img[o];
      if (f === 0) break;
      if (f === 0xE5 || this.img[o + 11] === 0x0F || (this.img[o + 11] & 0x08)) continue;
      const en = this.entry(o);
      if (en.name === '.' || en.name === '..') continue;
      out.push(en);
    }
    return out;
  }
  // The directory cluster for a path ('' = root). Throws when a part is missing.
  dirCluster(path) {
    let c = 0;
    for (const part of String(path || '').split(/[\\/]+/).filter(Boolean)) {
      const en = this.list(c).find(x => x.dir && x.name === part.toUpperCase());
      if (!en) throw new Error(`No directory ${part}.`);
      c = en.cluster;
    }
    return c;
  }
  find(path, name) { return this.list(this.dirCluster(path)).find(x => !x.dir && x.name === name.toUpperCase()) || null; }
  read(en) {
    const out = new Uint8Array(en.size);
    let pos = 0;
    for (const c of this.chain(en.cluster)) {
      const n = Math.min(this.csize, en.size - pos);
      if (n <= 0) break;
      out.set(this.img.subarray(this.clusterOff(c), this.clusterOff(c) + n), pos);
      pos += n;
    }
    return out;
  }
  freeChain(c) { for (const k of this.chain(c)) { this.setFat(k, 0); if (k < this.next) this.next = k; } }
  alloc(n) {
    const got = [];
    for (let c = this.next; c < this.clusters && got.length < n; c++) if (this.getFat(c) === 0) got.push(c);
    if (got.length < n) {                            // (the hint missed free clusters before it)
      got.length = 0;
      for (let c = 2; c < this.clusters && got.length < n; c++) if (this.getFat(c) === 0) got.push(c);
    }
    if (got.length < n) throw new Error('No space left on the disk.');
    got.forEach((c, i) => this.setFat(c, i + 1 < got.length ? got[i + 1] : this.eoc));
    if (got.length) this.next = got[got.length - 1] + 1;
    return got;
  }
  // A free directory slot; a full subdirectory grows by one cluster.
  freeSlot(dirCluster) {
    for (const o of this.slots(dirCluster)) if (this.img[o] === 0 || this.img[o] === 0xE5) return o;
    if (!dirCluster) throw new Error('The root directory is full.');
    const last = this.chain(dirCluster).pop(), [c] = this.alloc(1);
    this.setFat(last, c);
    this.setFat(c, this.eoc);
    this.img.fill(0, this.clusterOff(c), this.clusterOff(c) + this.csize);
    return this.clusterOff(c);
  }
  stamp(o) {
    const now = new Date();
    const t = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const d = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    this.img[o + 22] = t & 0xFF; this.img[o + 23] = t >> 8; this.img[o + 24] = d & 0xFF; this.img[o + 25] = d >> 8;
  }
  // Write a whole file (replace or create). Returns the 8.3 name. opt: { n83 (the name in the
  // directory, 11 characters), attr, time, date (the raw directory values, for a copy) }.
  write(path, name, bytes, opt = {}) {
    const dc = this.dirCluster(path), n83 = opt.n83 || to83(name);
    let o = -1, attr = 0x20;
    for (const s of this.slots(dc)) {
      if (this.img[s] === 0) break;
      if (this.img[s] !== 0xE5 && String.fromCharCode(...this.img.subarray(s, s + 11)) === n83 && !(this.img[s + 11] & 0x18)) {
        o = s; attr = this.img[s + 11];
        this.freeChain(this.r16(s + 26));
      }
    }
    if (o < 0) o = this.freeSlot(dc);
    const chain = bytes.length ? this.alloc(Math.ceil(bytes.length / this.csize)) : [];
    chain.forEach((c, i) => {
      const off = this.clusterOff(c);
      this.img.fill(0, off, off + this.csize);
      this.img.set(bytes.subarray(i * this.csize, (i + 1) * this.csize), off);
    });
    this.img.fill(0, o, o + 32);
    for (let i = 0; i < 11; i++) this.img[o + i] = n83.charCodeAt(i);
    this.img[o + 11] = (opt.attr !== undefined ? opt.attr : attr) & ~0x18;
    this.stamp(o);
    if (opt.time !== undefined) { this.img[o + 22] = opt.time & 0xFF; this.img[o + 23] = opt.time >> 8; this.img[o + 24] = opt.date & 0xFF; this.img[o + 25] = opt.date >> 8; }
    const first = chain.length ? chain[0] : 0, L = bytes.length;
    this.img[o + 26] = first & 0xFF; this.img[o + 27] = first >> 8;
    this.img[o + 28] = L & 0xFF; this.img[o + 29] = (L >> 8) & 0xFF; this.img[o + 30] = (L >> 16) & 0xFF; this.img[o + 31] = L >>> 24;
    return this.entry(o).name;
  }
  remove(path, name) {
    const en = this.find(path, name);
    if (!en) throw new Error(`No file ${name}.`);
    this.freeChain(en.cluster);
    this.img[en.off] = 0xE5;
  }
  // Make a directory (with its '.' and '..' entries) in path. name: a name or opt.n83. An
  // existing directory of that name is kept. Returns its 8.3 name.
  mkdir(path, name, opt = {}) {
    const dc = this.dirCluster(path), n83 = opt.n83 || to83(name);
    for (const s of this.slots(dc)) {
      if (this.img[s] === 0) break;
      if (this.img[s] !== 0xE5 && String.fromCharCode(...this.img.subarray(s, s + 11)) === n83) {
        if (this.img[s + 11] & 0x10) return this.entry(s).name;
        throw new Error(`${this.entry(s).name} is a file, not a directory.`);
      }
    }
    const o = this.freeSlot(dc), [c] = this.alloc(1), off = this.clusterOff(c), img = this.img;
    img.fill(0, off, off + this.csize);
    const put = (at, nm, cl) => {
      img.fill(0, at, at + 32);
      for (let i = 0; i < 11; i++) img[at + i] = nm.charCodeAt(i);
      img[at + 11] = 0x10; this.stamp(at);
      img[at + 26] = cl & 0xFF; img[at + 27] = cl >> 8;
    };
    put(off, '.          ', c);
    put(off + 32, '..         ', dc);
    put(o, n83, c);
    return this.entry(o).name;
  }
  // The 8.3 name of a long name in a directory, as Windows makes it: the name itself when it is
  // a valid 8.3 name, else the first 6 characters, '~', a number (the first free one) and the
  // extension. taken: the 11-character names of the directory (a Set; the new name goes in it).
  short83(name, taken) {
    const up = name.toUpperCase(), n = to83(name), dot = up.lastIndexOf('.');
    const b = dot > 0 ? up.slice(0, dot) : up, e = dot > 0 ? up.slice(dot + 1) : '';
    const valid = /^[A-Z0-9!#$%&'()\-@^_`{}~]{1,8}$/.test(b) && /^[A-Z0-9!#$%&'()\-@^_`{}~]{0,3}$/.test(e) && up.indexOf('.') === up.lastIndexOf('.');
    if (valid && !taken.has(n)) { taken.add(n); return n; }
    const clean = s => s.replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g, '');
    const cb = clean(b) || 'FILE', ce = clean(e).slice(0, 3);
    for (let k = 1; k < 1000000; k++) {
      const tail = '~' + k, s = (cb.slice(0, 8 - tail.length) + tail).padEnd(8, ' ') + ce.padEnd(3, ' ');
      if (!taken.has(s)) { taken.add(s); return s; }
    }
    throw new Error('No free short name for ' + name);
  }
  // The 11-character names in a directory (a Set, for short83).
  names(path) {
    const out = new Set();
    for (const s of this.slots(this.dirCluster(path))) {
      if (this.img[s] === 0) break;
      if (this.img[s] !== 0xE5) out.add(String.fromCharCode(...this.img.subarray(s, s + 11)));
    }
    return out;
  }
  // Free bytes.
  free() { let n = 0; for (let c = 2; c < this.clusters; c++) if (this.getFat(c) === 0) n++; return n * this.csize; }
  rename(path, from, to) {
    const en = this.find(path, from);
    if (!en) throw new Error(`No file ${from}.`);
    if (to.toUpperCase() !== from.toUpperCase() && this.find(path, to)) throw new Error(`${to.toUpperCase()} already exists.`);
    const n83 = to83(to);
    for (let i = 0; i < 11; i++) this.img[en.off + i] = n83.charCodeAt(i);
    return this.entry(en.off).name;
  }
}

// Add files to the root of a FAT12 image in place. files: [{ name, bytes }]. Returns the 8.3 names.
function fat12AddFiles(img, files) {
  const fs = new Fat12(img);
  return files.map(f => fs.write('', f.name, f.bytes));
}
// Root directory listing: [{ name, size, attr, dir }]
function fat12List(img, path = '') {
  try { const fs = new Fat12(img); return fs.list(fs.dirCluster(path)); } catch (e) { return []; }
}
function to83(name) {
  const base = name.split(/[\\/]/).pop().toUpperCase();
  const dot = base.lastIndexOf('.');
  const clean = s => s.replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g, '');
  const b = clean(dot > 0 ? base.slice(0, dot) : base).slice(0, 8) || 'FILE';
  const e = clean(dot > 0 ? base.slice(dot + 1) : '').slice(0, 3);
  return b.padEnd(8, ' ') + e.padEnd(3, ' ');
}

// ---------------------------------------------------------------------------------------------
// Hard disks. A HardDisk is an image of whole sectors with a geometry (cylinders, heads, sectors
// per track: the CHS of INT 13h and of the IDE controller). The page makes new disks with
// hdBlank: an MBR (HD_MBR, from tools/hdmbr.asm) with one active FAT16 partition from cylinder
// 0, head 1 (the first track is for the MBR, as DOS FDISK does), formatted, empty. hdMakeBootable
// copies DOS from a system floppy (as SYS C: does), and fatAddTree copies a folder tree.
const HD_TYPE2 = { cyls: 615, heads: 4, spt: 17 };      // the classic 20 MB drive (AT type 2)
const HD_MBR = '+jHAjtC8AHyO2I7A+/y+AHy/AAa5AAHzpeoeBgAAvr4HuQQAgDyAdAqDxhDi9r52BuszvQUAsoCKdAGLTAK7AHy4AQLNE3MMMcDNE011576OBusSgT7+fVWqdQeygOoAfAAAvq0GrAjAdAm0DrsHAM0Q6/Lr/kludmFsaWQgcGFydGl0aW9uIHRhYmxlAEVycm9yIGxvYWRpbmcgb3BlcmF0aW5nIHN5c3RlbQBNaXNzaW5nIG9wZXJhdGluZyBzeXN0ZW0A';
function b64bytes(s) {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(s, 'base64'));
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
class HardDisk {
  // geo: { cyls, heads, spt } (else from the partition table, or type 2, or 16 heads and 63 sectors)
  constructor(name, bytes, geo) {
    if (bytes.length % 512 || bytes.length < 512 * 64) throw new Error(`${name}: ${bytes.length} bytes is not a hard disk image (whole 512-byte sectors, at least 32 KB).`);
    const g = geo || hdGeometry(bytes);
    this.name = name;
    this.data = bytes;
    this.size = bytes.length;
    this.sectors = bytes.length / 512;
    this.cyls = g.cyls; this.heads = g.heads; this.spt = g.spt;
    this.label = `${Math.round(bytes.length / 1048576)} MB (${g.cyls} cylinders, ${g.heads} heads, ${g.spt} sectors)`;
    this.busy = 0;
    this.lastSector = -1;
    this.reads = 0; this.writes = 0;
    this.dirty = false;
    this.readOnly = false;
  }
  lba(c, h, s) { return (c * this.heads + h) * this.spt + (s - 1); }
}
// The geometry of an image: from the end of a partition in the MBR (its last head and sector),
// else the type-2 drive when the size is the same, else 16 heads and 63 sectors per track.
function hdGeometry(bytes) {
  const n = bytes.length / 512;
  if (bytes[510] === 0x55 && bytes[511] === 0xAA) {
    for (let i = 0; i < 4; i++) {
      const e = 0x1BE + i * 16, type = bytes[e + 4], heads = bytes[e + 5] + 1, spt = bytes[e + 6] & 63;
      if (type && heads > 0 && heads <= 255 && spt > 0) return { cyls: Math.floor(n / (heads * spt)), heads, spt };
    }
  }
  const t = HD_TYPE2;
  if (n === t.cyls * t.heads * t.spt) return Object.assign({}, t);
  return { cyls: Math.floor(n / (16 * 63)), heads: 16, spt: 63 };
}
// The byte offset of the first FAT partition (types 01h, 04h, 06h, 0Bh, 0Ch, 0Eh), or 0 for an
// image without a partition table (a "superfloppy").
function hdVolume(img) {
  if (img[510] === 0x55 && img[511] === 0xAA) {
    for (let i = 0; i < 4; i++) {
      const e = 0x1BE + i * 16, type = img[e + 4];
      const lba = (img[e + 8] | (img[e + 9] << 8) | (img[e + 10] << 16) | (img[e + 11] << 24)) >>> 0;
      if ([0x01, 0x04, 0x06, 0x0B, 0x0C, 0x0E].includes(type) && lba) return lba * 512;
    }
  }
  return 0;
}
// The file system of a hard disk image (the first FAT partition).
function hdFs(img) { return new Fat12(img, hdVolume(img)); }
// A new hard disk: an MBR and one active FAT16 partition (FAT12 when it is smaller than 16 MB),
// formatted, empty, with a volume label. The partition starts at the first sector of head 1.
function hdBlank(label = 'ANATOMY', geo = HD_TYPE2) {
  const { cyls, heads, spt } = geo, total = cyls * heads * spt, d = new Uint8Array(total * 512);
  const w16 = (o, v) => { d[o] = v & 0xFF; d[o + 1] = (v >> 8) & 0xFF; };
  const w32 = (o, v) => { w16(o, v & 0xFFFF); w16(o + 2, v >>> 16); };
  // the MBR and the partition table
  d.set(b64bytes(HD_MBR), 0);
  const start = spt, n = total - start, lc = cyls - 1, e = 0x1BE;
  const fat16 = n >= 32680, big = n >= 65536;
  d[e] = 0x80; d[e + 1] = 1; d[e + 2] = 1; d[e + 3] = 0;
  d[e + 4] = !fat16 ? 0x01 : big ? 0x06 : 0x04;
  d[e + 5] = heads - 1; d[e + 6] = spt | ((lc >> 2) & 0xC0); d[e + 7] = lc & 0xFF;
  w32(e + 8, start); w32(e + 12, n);
  d[510] = 0x55; d[511] = 0xAA;
  // the boot sector of the partition (DOS 4 BPB) and the FATs
  let spc = fat16 ? 4 : 8;
  while (fat16 && n / spc > 65000) spc *= 2;
  const rootEnts = 512, rootSecs = rootEnts * 32 / 512;
  let fatSz = 1;
  for (let k = 0; k < 20; k++) {
    const cl = Math.floor((n - 1 - rootSecs - 2 * fatSz) / spc);
    const need = Math.ceil((fat16 ? (cl + 2) * 2 : Math.ceil((cl + 2) * 3 / 2)) / 512);
    if (need === fatSz) break;
    fatSz = need;
  }
  const b = start * 512;
  d.set([0xEB, 0x3C, 0x90, ...'ANATOMY '.split('').map(c => c.charCodeAt(0))], b);
  w16(b + 11, 512); d[b + 13] = spc; w16(b + 14, 1); d[b + 16] = 2; w16(b + 17, rootEnts);
  w16(b + 19, big ? 0 : n); d[b + 21] = 0xF8; w16(b + 22, fatSz); w16(b + 24, spt); w16(b + 26, heads);
  w32(b + 28, start); w32(b + 32, big ? n : 0);
  d[b + 36] = 0x80; d[b + 38] = 0x29; w32(b + 39, (total * 2654435761) >>> 0);
  const lab = (label || 'NO NAME').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 11).padEnd(11, ' ');
  for (let i = 0; i < 11; i++) d[b + 43 + i] = lab.charCodeAt(i);
  const fsn = fat16 ? 'FAT16   ' : 'FAT12   ';
  for (let i = 0; i < 8; i++) d[b + 54 + i] = fsn.charCodeAt(i);
  // boot code: print a message and wait for a key, then INT 19h (the same as fat12Blank)
  const msg = 'This is not a system disk. Press a key to try again.\r\n';
  d.set([0xFA, 0x31, 0xC0, 0x8E, 0xD8, 0x8E, 0xD0, 0xBC, 0x00, 0x7C, 0xFB, 0xBE, 0x5E, 0x7C,
    0xAC, 0x08, 0xC0, 0x74, 0x09, 0xB4, 0x0E, 0xBB, 0x07, 0x00, 0xCD, 0x10, 0xEB, 0xF2,
    0x31, 0xC0, 0xCD, 0x16, 0xCD, 0x19], b + 0x3E);
  for (let i = 0; i < msg.length; i++) d[b + 0x5E + i] = msg.charCodeAt(i);
  d[b + 510] = 0x55; d[b + 511] = 0xAA;
  for (let f = 0; f < 2; f++) {
    const o = b + 512 + f * fatSz * 512;
    d[o] = 0xF8; d[o + 1] = 0xFF; d[o + 2] = 0xFF; if (fat16) d[o + 3] = 0xFF;
  }
  if (label) {
    const root = b + (1 + 2 * fatSz) * 512;
    for (let i = 0; i < 11; i++) d[root + i] = lab.charCodeAt(i);
    d[root + 11] = 0x08;
  }
  return d;
}
// Make a new (empty) hard disk image bootable with the DOS of a system floppy image, as SYS C:
// does: the two system files first in the root directory and at the start of the data area
// (IO.SYS and MSDOS.SYS, or IBMBIO.COM and IBMDOS.COM), then COMMAND.COM, and the boot code of
// the floppy with the BPB of the hard disk. The boot drive number is 80h: at 24h for a DOS 4 or
// later boot sector (the extended BPB), at 1FDh for DOS 3. Returns the names of the copied files.
function hdMakeBootable(hd, floppy) {
  const fl = new Fat12(floppy), base = hdVolume(hd), fs = new Fat12(hd, base);
  // the first two files of the floppy root (the boot sector loads them)
  const first = [];
  for (const o of fl.slots(0)) {
    const f = floppy[o];
    if (f === 0) break;
    if (f === 0xE5 || floppy[o + 11] === 0x0F || (floppy[o + 11] & 0x08)) continue;
    first.push(fl.entry(o));
    if (first.length === 2) break;
  }
  const names = first.map(x => x.name).join(' ');
  if (!/^(IO\.SYS MSDOS\.SYS|IBMBIO\.COM IBMDOS\.COM)$/.test(names)) throw new Error('The disk in A: is not a DOS system disk (IO.SYS and MSDOS.SYS are not its first two files).');
  const com = fl.find('', 'COMMAND.COM');
  if (!com) throw new Error('The disk in A: has no COMMAND.COM.');
  // the root of the hard disk must be empty (a new disk), so the system files come first
  if (fs.list(0).length) throw new Error('Drive C: is not empty. Make a new drive C: first.');
  // keep the volume label for after the system files
  let label = null;
  for (const o of fs.slots(0)) { if (hd[o] === 0) break; if (hd[o + 11] & 0x08) { label = hd.slice(o, o + 32); hd.fill(0, o, o + 32); } }
  const copied = [];
  for (const en of [...first, com]) {
    const o = en.off, raw = String.fromCharCode(...floppy.subarray(o, o + 11));
    fs.write('', en.name, fl.read(en), { n83: raw, attr: floppy[o + 11], time: floppy[o + 22] | (floppy[o + 23] << 8), date: floppy[o + 24] | (floppy[o + 25] << 8) });
    copied.push(en.name);
  }
  if (fs.list(0)[0].cluster !== 2) throw new Error('The system files are not at the start of the data area.');
  if (label) hd.set(label, fs.freeSlot(0));
  // the boot sector: the code of the floppy, the BPB of the hard disk
  const bs = floppy.slice(0, 512), own = hd.slice(base, base + 512);
  bs.set(own.subarray(11, 36), 11);                  // the BPB up to the 32-bit sector count
  if (bs[0x26] === 0x29) { bs.set(own.subarray(36, 62), 36); bs[36] = 0x80; }   // DOS 4 and later
  else bs[0x1FD] = 0x80;                                                          // DOS 3
  hd.set(bs, base);
  return copied;
}
// Copy files into a FAT image: files = [{ path: 'DIR/SUB/NAME.EXT' (with '/'), bytes }], into
// the directory `into` ('' = root). Long names become 8.3 names (see short83). Returns
// { files, dirs, renamed: [{ from, to }] }.
function fatAddTree(fs, files, into = '') {
  const dirMap = new Map([['', into]]), taken = new Map(), renamed = [];
  const namesOf = p => { if (!taken.has(p)) taken.set(p, fs.names(p)); return taken.get(p); };
  const out = s => s.slice(0, 8).trimEnd() + (s.slice(8).trim() ? '.' + s.slice(8).trim() : '');
  let nf = 0, nd = 0;
  const dirOf = parts => {
    let key = '';
    for (const part of parts) {
      const next = key ? key + '/' + part : part;
      if (!dirMap.has(next)) {
        const parent = dirMap.get(key), used = namesOf(parent);
        // an existing directory of the same 8.3 name is used again
        const plain = to83(part);
        let n83;
        if (used.has(plain) && fs.list(fs.dirCluster(parent)).some(x => x.dir && x.name === out(plain))) n83 = plain;
        else n83 = fs.short83(part, used);
        fs.mkdir(parent, part, { n83 });
        nd++;
        if (out(n83) !== part.toUpperCase()) renamed.push({ from: next, to: (parent ? parent + '\\' : '') + out(n83) });
        dirMap.set(next, (parent ? parent + '\\' : '') + out(n83));
      }
      key = next;
    }
    return dirMap.get(key);
  };
  for (const f of files) {
    const parts = f.path.split(/[\\/]+/).filter(Boolean), name = parts.pop();
    const dir = dirOf(parts), used = namesOf(dir), plain = to83(name);
    // a file of the same 8.3 name is replaced (the same file again); else a new short name
    let n83 = plain;
    const valid = out(plain) === name.toUpperCase();
    if (!valid || (used.has(plain) && !fs.find(dir, out(plain)))) n83 = fs.short83(name, used);
    else used.add(plain);
    fs.write(dir, name, f.bytes, { n83 });
    nf++;
    if (out(n83) !== name.toUpperCase()) renamed.push({ from: f.path, to: (dir ? dir + '\\' : '') + out(n83) });
  }
  return { files: nf, dirs: nd, renamed };
}

// The old INT 13h service (OUT E0h; the BIOS does not use it). It reads and writes the
// CPU registers the way a BIOS routine would, and copies sectors through the bus.
function diskService(m) {
  const cpu = m.cpu, R = cpu.regs;
  const ah = R[0] >> 8, al = R[0] & 0xFF, ch = R[1] >> 8, cl = R[1] & 0xFF, dh = R[2] >> 8, dl = R[2] & 0xFF;
  const setCF = on => { cpu.f = on ? cpu.f | 1 : cpu.f & ~1; };
  const done = (status, alOut) => {
    m.diskStatus = status;
    R[0] = (status << 8) | ((alOut === undefined ? al : alOut) & 0xFF);
    setCF(status !== 0);
  };
  m.stats.dev.fdc++;
  if (dl >= 0x80) {                                   // no hard disk in this machine
    if (ah === 0x08) { R[2] = 0; done(0x01); return; }
    if (ah === 0x15) { R[0] = 0; setCF(false); return; }
    done(0x01); return;
  }
  const disk = m.disks[dl] || null;
  switch (ah) {
    case 0x00: done(0); return;
    case 0x01: done(0, m.diskStatus || 0); R[0] = (m.diskStatus || 0); setCF(false); return;
    case 0x02: case 0x03: case 0x04: {
      if (!disk) { done(0x80, 0); return; }
      const cyl = ch | ((cl & 0xC0) << 2), sec = cl & 0x3F, head = dh;
      if (sec < 1 || sec > disk.spt || head >= disk.heads || cyl >= disk.cyls) { done(0x04, 0); return; }
      if (ah === 0x03 && disk.readOnly) { done(0x03, 0); return; }
      let lba = disk.lba(cyl, head, sec), n = 0;
      const seg = cpu.sregs[0] << 4;
      let off = R[3];
      for (; n < al; n++, lba++) {
        if (lba >= disk.size / 512) { done(0x04, n); return; }
        const base = lba * 512;
        for (let i = 0; i < 512; i++) {
          const a = (seg + ((off + i) & 0xFFFF)) & 0xFFFFF;
          if (ah === 0x02) m.bus.write8(a, disk.data[base + i]);
          else if (ah === 0x03) disk.data[base + i] = m.bus.read8(a);
        }
        off = (off + 512) & 0xFFFF;
        m.stats.dev.dma++;
      }
      if (ah === 0x03) { disk.writes += n; disk.dirty = true; } else disk.reads += n;
      disk.busy = 1; disk.lastSector = lba - 1;
      m.diskClock += n * 512 * 8;                     // time the transfer would take
      done(0, n);
      return;
    }
    case 0x05: {                                        // format track: fill with F6h
      if (!disk) { done(0x80, 0); return; }
      const base = disk.lba(ch, dh, 1) * 512;
      disk.data.fill(0xF6, base, base + disk.spt * 512);
      disk.dirty = true; disk.busy = 1;
      done(0);
      return;
    }
    case 0x08: {
      const t = disk || { type: 4, cyls: 80, spt: 18, heads: 2 };
      R[3] = (R[3] & 0xFF00) | t.type;                  // BL = drive type
      R[1] = (((t.cyls - 1) & 0xFF) << 8) | (((t.cyls - 1) >> 2) & 0xC0) | t.spt;
      R[2] = ((t.heads - 1) << 8) | 2;                  // DH = max head, DL = drives
      cpu.sregs[0] = 0xF000; R[7] = (t.type === 5 && m.biosSym.diskette_table_288) || m.biosSym.diskette_table || 0;
      R[0] = 0; setCF(false);
      return;
    }
    case 0x15: R[0] = 0x0100; setCF(false); return;    // floppy without change line
    case 0x16: done(disk ? 0 : 0x80); return;
    case 0x17: case 0x18: done(0); return;
    default: done(0x01); return;
  }
}
