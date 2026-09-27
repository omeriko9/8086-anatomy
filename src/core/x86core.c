// The 80386/80486 instruction core in C (WebAssembly), for the fast run (no trace). It does the
// same work as CPU80386 + CPU80486 (src/core/cpu80386.js, cpu80486.js) and Machine.run
// (src/core/machine.js): the same results, the same clocks, the same prefetch queue, the same
// 486 cache and TLB, the same bus counters and heat maps. The JavaScript glue is
// src/core/x86wasm.js; tools/buildwasm.mjs builds this file.
//
// - The guest RAM, the heat maps and the shared state are in the WebAssembly memory, which the
//   machine makes before its CPU (so m.mem and cpu.r are views of the same bytes).
// - An instruction that this core does not do (the protected-mode far transfers, INT, IRET,
//   the FPU, the system instructions) runs in the JavaScript core (import jstep). The core
//   decides that before the instruction changes anything (it reads the bytes with no side
//   effects). A fault in the middle of an instruction goes to jfault: JavaScript delivers it
//   (raise) with the same partial state as its own core.
// - The interrupts: before each instruction, a pending IRQ (with IF = 1) or NMI goes to jstep.
//   The JavaScript glue keeps V[IRQ] / V[NMI] up to date after each call to the devices.
//
// Rules for a change: each function here copies a JavaScript function of the same name. A
// change to the JavaScript core must be copied here, then tests/x86wasm.test.mjs (the lockstep
// test: the two cores run the same machine one instruction at a time) must pass.

typedef unsigned char u8;
typedef signed char i8;
typedef short i16;
typedef unsigned short u16;
typedef unsigned int u32;
typedef int i32;
typedef unsigned long long u64;
typedef long long i64;

#define IMPORT(n) __attribute__((import_module("env"), import_name(#n)))
#define EXPORT(n) __attribute__((export_name(#n)))

IMPORT(jtick) void jtick(void);            // the machine: tickPending() (the clocks of V/D)
IMPORT(jtickn) void jtickn(double n);      // the machine: tickDevices(n) (the halt wait)
IMPORT(jin8) u32 jin8(u32 p);              // bus.in8
IMPORT(jin16) u32 jin16(u32 p);            // bus.in16
IMPORT(jout8) void jout8(u32 p, u32 v);    // bus.out8
IMPORT(jout16) void jout16(u32 p, u32 v);  // bus.out16
IMPORT(jvrd) u32 jvrd(u32 a);              // vga.read8
IMPORT(jvwr) void jvwr(u32 a, u32 v);      // vga.write8
IMPORT(jstep) double jstep(void);          // one step of the JavaScript core; its clocks
IMPORT(jfault) double jfault(i32 vec, i32 err);   // raise(fault) + finish in JavaScript; the clocks
IMPORT(jdebug) double jdebug(u32 db);      // the debug trap (#DB) + finish in JavaScript
IMPORT(jirq) u32 jirq(void);               // bus.irqPending()
IMPORT(jvpeek) u32 jvpeek(u32 a);          // vga.peek8 (the bytes of an instruction in the VGA window)

// ---------- memory layout (the machine makes the memory: x86wasm.js) ----------
#define GUEST 0x400000u                    // the guest RAM (m.mem), 16 MB
#define MEMTOP 0x1000000u
#define HEATR (GUEST + MEMTOP)             // heat.read: Float32 for each 256 bytes
#define HEATW (HEATR + (MEMTOP >> 8) * 4)  // heat.write
#define M ((u8 *)GUEST)
#define HR ((float *)HEATR)
#define HW ((float *)HEATW)

#define RAM_TOP 0xA0000u
#define VRAM_BASE 0xB8000u
#define VRAM_END 0xBC000u
#define ROM_BASE 0xF0000u
#define VGA_HI 0xC0000u
#define VROM_HI 0xC8000u
#define XRAM_BASE 0x100000u
#define ROM_TOP 0xFFFF0000u

// ---------- the shared state (x86wasm.js reads and writes it with views) ----------
u32 V[1024];
double D[64];
u16 SR[8];                                 // cpu.sregs
u8 QB[128];                                // cpu.qb (the 486 prefetch queue)
i32 CTAG[512];                             // cpu.ctag (the 486 cache tags; -1 = not valid)
u8 CDATA[8192];                            // cpu.cache486.data
u8 CLRU[128];                              // cpu.cache486.lru
double IDLES[20], IDLEP[20];               // m.idleS, m.idleP
u32 LAYOUT[52];
// the TLBs: the data TLB (486: 8 sets, P5: 16 sets of 4 ways), the P5 4 MB TLB (2 sets) and code TLB (8 sets)
u32 TLBLIN[64], TLBPHYS[64], TLBFL[64], TLBVALID[64];
u8 TLBNEXT[16];                            // cpu.tlbNext
u32 T4LIN[8], T4PHYS[8], T4FL[8], T4VALID[8];
u8 T4NEXT[2];                              // cpu.tlb4mNext
u32 ITLIN[32], ITPHYS[32], ITFL[32], ITVALID[32];
u8 ITNEXT[8];                              // cpu.itlbNext
// the P5 (CPU80586): the data cache (MESI), the code cache, the BTB, the bytes of the instruction
i32 DTAG[256]; u8 DSTATE[256], DLRU[128], DDATA[8192];
i32 ITAG[256]; u8 ILRU[128], IDATA[8192];
i32 BTAG[256]; u32 BTGT[256]; u8 BCNT[256], BNEXT[64];
u8 IB[16];                                 // cpu.ib
u32 PWHYA[18];                             // cpu.pipeStats.why

// V: 0-7 the registers (cpu.r), 8-12 CR0-CR4 (cpu.cr), 16-23 DR0-DR7 (cpu.dr)
#define R V
#define CR (V + 8)
#define DR (V + 16)
#define EIP V[24]
#define EFL V[25]
#define CPL V[26]
#define HALTED V[27]
#define SHUTDOWN V[28]
#define INHIBIT V[29]
#define KEEPRF V[30]
#define PENDDB V[31]
#define PAGING V[32]
#define QIP V[33]
#define QH V[34]
#define QT V[35]
#define LASTIP V[36]
#define LASTCS V[37]
#define LASTBASE V[38]
#define SPSTART V[39]
#define WS V[40]
#define BUSLEN V[41]
#define REPACT V[42]
#define REPOP V[43]
#define REPSEG V[44]                       // (i32: -1 = none)
#define REPREP V[45]
#define REP_START V[46]
#define REPOSZ V[47]
#define REPA32 V[48]
#define XPCD V[49]
#define A20 V[50]
#define CACHESETUP V[51]
#define VGAON V[52]
#define XFL V[53]                          // the EFLAGS bits above 17 that POPFD can change
#define FMASK V[54]
#define IDLEON V[55]                       // m.idleSkip (and no breakpoints)
#define IRQ V[56]                          // bus.irqPending() after the last device call
#define NMI V[57]                          // m.nmiLatch
#define CLOCKHZ V[58]
#define DBGON V[59]
#define GDTB V[60]
#define GDTL V[61]
#define IDTB V[62]
#define IDTL V[63]
#define LDTSEL V[64]
#define LDTB V[65]
#define LDTL V[66]
#define LDTACC V[67]
#define LDTVALID V[68]
#define TRSEL V[69]
#define TRB V[70]
#define TRL V[71]
#define TRACC V[72]
#define SBASE (V + 80)
#define SLIMIT (V + 86)
#define SACC (V + 92)
#define SFLAGS (V + 98)
#define SBIG (V + 104)
#define SLO (V + 110)
#define SHI (V + 116)
#define SRD (V + 122)
#define SWR (V + 128)
// the parts of one instruction (JavaScript reads them for jfault)
#define CLK V[140]
#define NEU V[141]
#define STALLT V[142]
#define BUST V[143]
#define RDT V[144]
#define DIDFLUSH V[145]
#define ILEN V[146]
#define NOAC V[147]
#define CMPXOK V[148]
#define OPV V[149]
#define OP2V V[150]
#define MODV V[151]                        // (i32: -1 = no ModR/M)
#define REGV V[152]
#define RMV V[153]
#define EXT V[154]
#define FAULTRF V[155]
#define SEGV V[156]                        // (i32: -1 = no segment prefix)
#define REPV V[157]
#define LOCKV V[158]
#define OSZ V[159]
#define A32 V[160]
#define EASEG V[161]
#define EAOFF V[162]
#define EAESP V[163]
#define OPPFX V[164]
#define ADPFX V[165]
#define DONE_REASON V[166]
#define ABORT V[167]                       // a CPU reset in a device call: the run ends at once
// statistics: counts since the glue last read them (it adds them to the JavaScript objects)
#define ST_FETCH V[170]
#define ST_MEMR V[171]
#define ST_MEMW V[172]
#define ST_IOR V[173]
#define ST_IOW V[174]
#define ST_HALT V[175]
#define ST_INTA V[176]
#define DEV_RAM V[180]
#define DEV_ROM V[181]
#define DEV_XRAM V[182]
#define DEV_VRAM V[183]
#define DEV_VROM V[184]
#define C_HITS V[190]
#define C_MISSES V[191]
#define C_FILLS V[192]
#define C_UNCACHED V[193]
#define C_WHITS V[194]
#define C_WMISSES V[195]
#define C_FLUSHES V[196]
#define C_INVAL V[197]
#define T_HITS V[200]
#define T_MISSES V[201]
#define T_FLUSHES V[202]
#define N_JS V[203]                        // the steps that went to JavaScript (for the tests)
#define N_C V[204]                         // the steps of this core (for the tests)
#define IDLEIP V[210]                      // (i32: -1 = none)
#define IDLEN V[211]
#define IDLESKIPS V[212]
#define HALTWAITS V[213]
// the P5 counters (added to the JavaScript objects as the others)
#define C_WHITSME V[220]
#define C_WB V[221]
#define IC_HITS V[222]
#define IC_MISSES V[223]
#define IC_FILLS V[224]
#define IC_UNCACHED V[225]
#define IC_FLUSHES V[226]
#define IC_INVAL V[227]
#define T_CHITS V[228]
#define T_CMISSES V[229]
#define T_BIG V[230]
#define BT_LOOKUPS V[231]
#define BT_HITS V[232]
#define BT_RIGHT V[233]
#define BT_WRONG V[234]
#define BT_ALLOCS V[235]
#define BT_TAKEN V[236]
#define P_U V[237]
#define P_V V[238]
#define P_FLOOR V[239]
// the P5 state
#define P5 V[260]                          // the model: 1 = the Pentium (CPU80586)
#define P6 V[279]                          // the model: 1 = the Pentium Pro (CPU80686)
#define I386 V[289]                        // the model: 1 = the 80386 (CPU80386: no cache, the 386 queue and clocks)
#define NSTALL V[288]                      // (the 80386) the fetches that the EU waited for in this step
#define FPUBUSY D[15]                      // (the 80386) fpu.busyCycles
#define PAIRNEXT V[261]
#define PAIRIP V[262]
#define ISV V[263]
#define UCLK V[264]
#define URET V[265]
#define EXECOK V[266]
#define PWHY V[267]
#define PREG V[268]
#define LASTWHY V[269]
#define WBLINE V[270]
#define WBLINEV V[271]                     // (wbLine = -1 when 0)
#define VINFO V[272]
#define VWHY V[273]
#define VIP V[274]
#define VIPV V[275]                        // (vIP = -1 when 0)
#define VBASE V[276]
#define TR12 V[277]
#define QSNOOP V[278]
#define TSETS (P5 ? 16u : 8u)              // the sets of the data TLB
// D: f64 counters of the machine and the CPU
#define CYCLES D[0]
#define INSTR D[1]
#define TICKDUE D[2]
#define WRCHG D[3]
#define IORDN D[4]
#define IOWRN D[5]
#define IDLET D[6]
#define IDLESAVED D[7]
#define HALTSAVED D[8]
#define DONE D[9]                          // the clocks of this run() call

#define ES 0
#define CS 1
#define SS 2
#define DS 3
#define FS 4
#define GS 5

#define F_CF 0x001u
#define F_PF 0x004u
#define F_AF 0x010u
#define F_ZF 0x040u
#define F_SF 0x080u
#define F_TF 0x100u
#define F_IF 0x200u
#define F_DF 0x400u
#define F_OF 0x800u
#define F_RF 0x10000u
#define F_VM 0x20000u
#define F_AC 0x40000u

#define C0_NE 0x20u
#define C0_WP 0x10000u
#define C0_AM 0x40000u
#define C0_NW 0x20000000u
#define C0_CD 0x40000000u

static const u32 MASK[5] = { 0, 0xFFu, 0xFFFFu, 0, 0xFFFFFFFFu };
static const u32 SIGN[5] = { 0, 0x80u, 0x8000u, 0, 0x80000000u };
static u8 PARITY[256];

// ---------- faults ----------
static i32 FLT = -1, FERR = -1;
#define CK if (FLT >= 0) return
#define CKV(x) if (FLT >= 0) return (x)
static void fault(i32 vec, i32 err) { if (FLT < 0) { FLT = vec; FERR = err; } }
static void fsel(i32 vec, u32 sel) { fault(vec, (i32)((sel & 0xFFFC) | EXT)); }

void *memset(void *d, int c, unsigned long n) { volatile u8 *p = (volatile u8 *)d; while (n--) *p++ = (u8)c; return d; }
void *memcpy(void *d, const void *s, unsigned long n) { volatile u8 *p = (volatile u8 *)d; const u8 *q = (const u8 *)s; while (n--) *p++ = *q++; return d; }

// ---------- the bus of Machine386 / Machine486 ----------
static void countCycle(int type) {         // 0 memr, 1 memw, 2 ior, 3 iow, 4 halt, 5 inta
  switch (type) { case 0: ST_MEMR++; break; case 1: ST_MEMW++; break; case 2: ST_IOR++; break; case 3: ST_IOW++; break; case 4: ST_HALT++; break; default: ST_INTA++; }
}
#define T_MEMR 0
#define T_MEMW 1
#define T_IOR 2
#define T_IOW 3
#define T_HALT 4

static u32 rd8(u32 a) {
  if (a < RAM_TOP) { HR[a >> 8] += 1; DEV_RAM++; return M[a]; }
  if (a >= MEMTOP) {
    if (a < ROM_TOP) return 0xFF;
    a = ROM_BASE + (a & 0xFFFF);
    HR[a >> 8] += 1; DEV_ROM++; return M[a];
  }
  if (!A20) a &= ~0x100000u;
  HR[a >> 8] += 1;
  if (a >= XRAM_BASE) { DEV_XRAM++; return M[a]; }
  if (a < RAM_TOP) { DEV_RAM++; return M[a]; }
  if (a >= ROM_BASE) { DEV_ROM++; return M[a]; }
  if (VGAON) {
    if (a < VGA_HI) { DEV_VRAM++; return jvrd(a) & 0xFF; }
    if (a < VROM_HI) { DEV_VROM++; return M[a]; }
  } else if (a >= VRAM_BASE && a < VRAM_END) { DEV_VRAM++; return M[a]; }
  return 0xFF;
}
static void cacheInvalidate(u32 phys, u32 len);
static void memChanged(u32 a, u32 len) { WRCHG += 1; if (len > 0) cacheInvalidate(a, len); }
static void wr8(u32 a, u32 v) {
  const u32 a0 = a;
  v &= 0xFF;
  if (a < RAM_TOP) { HW[a >> 8] += 1; DEV_RAM++; if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } return; }
  if (a >= MEMTOP) return;
  if (!A20) a &= ~0x100000u;
  HW[a >> 8] += 1;
  if (a >= XRAM_BASE) { DEV_XRAM++; if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } }
  else if (a < RAM_TOP) { DEV_RAM++; if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } }
  else if (VGAON) { if (a < VGA_HI) { DEV_VRAM++; WRCHG += 1; jvwr(a, v); } }
  else if (a >= VRAM_BASE && a < VRAM_END) { DEV_VRAM++; if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } }
  // (Machine486) with A20 off, the cache line of the byte with bit 20 = 0 must go
  if (!A20 && (a0 & 0x100000u) && a0 < MEMTOP && !I386) memChanged(a0 & ~0x100000u, 1);
}
// Machine386.peek8 (no counters): the bytes of an instruction for the fallback test
static u32 peek8(u32 a) {
  if (a >= MEMTOP) return a >= ROM_TOP ? M[ROM_BASE + (a & 0xFFFF)] : 0xFF;
  if (!A20) a &= ~0x100000u;
  if (VGAON && a >= RAM_TOP && a < VGA_HI) return jvpeek(a) & 0xFF;
  return M[a];
}

// ---------- the 486 cache ----------
static int cacheable(u32 pa) {
  return CACHESETUP && (pa < RAM_TOP || (pa >= XRAM_BASE && pa < MEMTOP && (A20 || !(pa & 0x100000u))));
}
static int cacheFind(u32 pa) {
  const int i = (int)((pa >> 4) & 127) * 4;
  const i32 tag = (i32)(pa >> 11);
  if (CTAG[i] == tag) return i;
  if (CTAG[i + 1] == tag) return i + 1;
  if (CTAG[i + 2] == tag) return i + 2;
  if (CTAG[i + 3] == tag) return i + 3;
  return -1;
}
static void lruTouch(int i) {
  const int set = i >> 2;
  u32 b = CLRU[set];
  switch (i & 3) {
    case 0: b |= 3; break;
    case 1: b = (b | 1) & ~2u; break;
    case 2: b = (b & ~1u) | 4; break;
    default: b &= ~5u;
  }
  CLRU[set] = (u8)b;
}
static int lruVictim(int set) {
  for (int w = 0; w < 4; w++) if (CTAG[set * 4 + w] < 0) return w;
  const u32 b = CLRU[set];
  if (!(b & 1)) return b & 2 ? 1 : 0;
  return b & 4 ? 3 : 2;
}
__attribute__((unused)) static void cacheFlush(void) {
  for (int i = 0; i < 512; i++) CTAG[i] = -1;
  for (int i = 0; i < 128; i++) CLRU[i] = 0;
  C_FLUSHES++;
}
static void cacheInvalidate5(u32 phys, u32 len);
static void cacheInvalidate(u32 phys, u32 len) {
  if (P5) { cacheInvalidate5(phys, len); return; }
  if (CR[0] & C0_NW) return;
  const u32 end = phys + len;
  u32 n = 0;
  if (len >= 0x4000) {
    for (int i = 0; i < 512; i++) {
      if (CTAG[i] < 0) continue;
      const u32 addr = ((u32)CTAG[i] << 11) | ((u32)(i >> 2) << 4);
      if ((u64)addr + 16 > phys && addr < end) { CTAG[i] = -1; n++; }
    }
  } else {
    for (u32 a = phys - (phys & 15); a < end; a += 16) {
      const int i = cacheFind(a);
      if (i >= 0) { CTAG[i] = -1; n++; }
    }
  }
  C_INVAL += n;
}

// ---------- bus cycles (the 486 core) ----------
static void busEv(int type, u32 len) {
  if (I386) { NEU++; countCycle(type); return; }
  NEU++; BUST += len;
  if (type != T_MEMW) RDT += len;
  countCycle(type);
}
static void codeEv(u32 len, int stall) { ST_FETCH++; if (stall) STALLT += len; }
static void memCycles(int type, u32 pa, u32 n) {
  for (u32 k = 0; k < n;) {
    const u32 a = pa + k;
    if (!(a & 1) && n - k >= 2) { busEv(type, BUSLEN); k += 2; }
    else { busEv(type, BUSLEN); k++; }
  }
}
static u32 fillTime(void) { return BUSLEN + 7 * (BUSLEN - 1); }
static int cacheFill(u32 pa, int code, int stall) {
  const u32 line = pa - (pa & 15);
  const int set = (int)((pa >> 4) & 127);
  const int i = set * 4 + lruVictim(set), base = i * 16;
  for (int k = 0; k < 16; k++) CDATA[base + k] = (u8)rd8(line + (u32)k);
  CTAG[i] = (i32)(pa >> 11);
  lruTouch(i);
  C_FILLS++;
  for (int beat = 0; beat < 8; beat++) {
    const u32 len = beat ? BUSLEN - 1 : BUSLEN;
    if (code) codeEv(len, stall); else busEv(T_MEMR, len);
  }
  return i;
}
static u32 physRd(u32 pa, u32 n, u32 pcd) {
  const u32 off = pa & 15;
  if (off + n > 16) {
    const u32 k = 16 - off;
    const u32 lo = physRd(pa, k, pcd);
    return lo | (physRd(pa + k, n - k, pcd) << (8 * k));
  }
  int i = cacheFind(pa);
  if (i >= 0) { C_HITS++; lruTouch(i); }
  else {
    C_MISSES++;
    if (!(CR[0] & C0_CD) && !pcd && cacheable(pa)) i = cacheFill(pa, 0, 0);
  }
  u32 v;
  if (i >= 0) {
    const int b = i * 16 + (int)off;
    v = CDATA[b];
    if (n > 1) v |= (u32)CDATA[b + 1] << 8;
    if (n > 2) v |= (u32)CDATA[b + 2] << 16;
    if (n > 3) v |= (u32)CDATA[b + 3] << 24;
  } else {
    C_UNCACHED++;
    v = rd8(pa);
    for (u32 k = 1; k < n; k++) v |= rd8(pa + k) << (8 * k);
    memCycles(T_MEMR, pa, n);
  }
  return v;
}
static void physWr(u32 pa, u32 n, u32 v) {
  const u32 off = pa & 15;
  if (off + n > 16) {
    const u32 k = 16 - off;
    physWr(pa, k, v & (0xFFFFFFFFu >> (32 - 8 * k)));
    physWr(pa + k, n - k, v >> (8 * k));
    return;
  }
  const int i = cacheFind(pa);
  if (i >= 0) {
    const int b = i * 16 + (int)off;
    for (u32 k = 0; k < n; k++) CDATA[b + (int)k] = (u8)(v >> (8 * k));
    C_WHITS++; lruTouch(i);
  } else C_WMISSES++;
  if (i < 0 || !(CR[0] & C0_NW)) {
    for (u32 k = 0; k < n; k++) wr8(pa + k, (v >> (8 * k)) & 0xFF);
    memCycles(T_MEMW, pa, n);
  }
}
static u32 rdPhysD(u32 pa, u32 pcd) { return physRd(pa, 4, pcd); }
static void wrPhysD(u32 pa, u32 v) { physWr(pa, 4, v); }

// ---------- paging (the 386 TLB with the 486 WP, PCD and PWT bits) ----------
__attribute__((unused)) static void flushTLB(void) {
  for (int i = 0; i < 64; i++) TLBVALID[i] = 0;
  if (P5) { for (int i = 0; i < 8; i++) T4VALID[i] = 0; for (int i = 0; i < 32; i++) ITVALID[i] = 0; }
  T_FLUSHES++;
}
static int tlbFind(u32 la) {
  const u32 set = (la >> 12) & (TSETS - 1), page = la & 0xFFFFF000u;
  for (u32 i = set * 4; i < set * 4 + 4; i++) if (TLBVALID[i] && TLBLIN[i] == page) return (int)i;
  return -1;
}
static void tlbPut(u32 page, u32 frame, u32 flags) {
  const u32 set = (page >> 12) & (TSETS - 1);
  int way = -1;
  for (int w = 0; w < 4; w++) { const u32 e = set * 4 + (u32)w; if (TLBVALID[e] && TLBLIN[e] == page) { way = w; break; } }
  if (way < 0) { way = TLBNEXT[set]; TLBNEXT[set] = (u8)((way + 1) & 3); }
  const u32 e = set * 4 + (u32)way;
  TLBLIN[e] = page; TLBPHYS[e] = frame; TLBFL[e] = flags; TLBVALID[e] = 1;
}
static void pageFault(u32 la, u32 err) { CR[2] = la; fault(14, (i32)err); }
static u32 walk5(u32 la, int write, int user, int code);
static u32 walk(u32 la, int write, int user) {
  if (P5) return walk5(la, write, user, 0);
  T_MISSES++;
  const u32 dir = la >> 22, tbl = (la >> 12) & 0x3FF, cr3 = CR[3];
  const u32 pdeA = (cr3 & 0xFFFFF000u) + dir * 4;
  const u32 pde = rdPhysD(pdeA, cr3 & 0x10);
  const u32 err = (write ? 2u : 0u) | (user ? 4u : 0u);
  if (!(pde & 1)) { pageFault(la, err); return 0; }
  const u32 pteA = (pde & 0xFFFFF000u) + tbl * 4;
  const u32 pte = rdPhysD(pteA, pde & 0x10);
  if (!(pte & 1)) { pageFault(la, err); return 0; }
  const u32 us = pde & pte & 4, rw = pde & pte & 2;
  if (user && (!us || (write && !rw))) { pageFault(la, err | 1); return 0; }
  if (!user && write && !rw && (CR[0] & C0_WP)) { pageFault(la, err | 1); return 0; }
  if (!(pde & 0x20)) wrPhysD(pdeA, pde | 0x20);
  const u32 npte = pte | 0x20 | (write ? 0x40u : 0u);
  if (npte != pte) wrPhysD(pteA, npte);
  const u32 frame = pte & 0xFFFFF000u;
  tlbPut(la & 0xFFFFF000u, frame, us | rw | 0x21 | (npte & 0x40) | (pte & 0x18));
  XPCD = pte & 0x10;
  return frame | (la & 0xFFF);
}
static u32 xlate5(u32 la, int write, int user);
static u32 xlate(u32 la, int write, int user) {
  if (P5) return xlate5(la, write, user);
  const int e = tlbFind(la);
  if (e >= 0) {
    const u32 fl = TLBFL[e];
    const int re = user ? (!(fl & 4) || (write && !(fl & 2))) : (write && !(fl & 2) && (CR[0] & C0_WP));
    if (re) return walk(la, write, user);
    if (!write || (fl & 0x40)) {
      T_HITS++;
      XPCD = fl & 0x10;
      return TLBPHYS[e] | (la & 0xFFF);
    }
  }
  return walk(la, write, user);
}
// peekPhys (no bus cycles, no A/D bits, no faults, no counters): -1 = not present
static i64 peekPhys5(u32 la);
static i64 peekPhys(u32 la) {
  if (!PAGING) return la;
  if (P5) return peekPhys5(la);
  const int e = tlbFind(la);
  if (e >= 0) return TLBPHYS[e] | (la & 0xFFF);
  const u32 pdeA = (CR[3] & 0xFFFFF000u) + (la >> 22) * 4;
  const u32 pde = peek8(pdeA) | (peek8(pdeA + 1) << 8) | (peek8(pdeA + 2) << 16) | (peek8(pdeA + 3) << 24);
  if (!(pde & 1)) return -1;
  const u32 pteA = (pde & 0xFFFFF000u) + ((la >> 12) & 0x3FF) * 4;
  const u32 pte = peek8(pteA) | (peek8(pteA + 1) << 8) | (peek8(pteA + 2) << 16) | (peek8(pteA + 3) << 24);
  if (!(pte & 1)) return -1;
  return (pte & 0xFFFFF000u) | (la & 0xFFF);
}

// ==================== the Pentium Pro out-of-order model (src/core/p6ooo.c) ====================
// The same C file as the separate module p6ooo.wasm.js: here the JavaScript core of the Pentium Pro
// attaches its model views to this memory (x86wasm.js), so both cores use one model state.
#pragma push_macro("M")
#pragma push_macro("R")
#undef M
#undef R
#include "p6ooo.c"
#pragma pop_macro("R")
#pragma pop_macro("M")

// ==================== the Pentium (CPU80586) parts ====================
#define P5_I 0
#define P5_S 1
#define P5_E 2
#define P5_M 3
#define C4_PSE 0x10u
#define TR12_NBP 0x1u
#define TR12_SE 0x2u
#define TR12_CI 0x200u

// Machine586 bus.poke8: a store that stays in the data cache (no bus cycle, no heat, no counters)
static void poke8(u32 a, u32 v) {
  v &= 0xFF;
  if (a < RAM_TOP) { if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } return; }
  if (a >= MEMTOP) return;
  if (!A20 && (a & 0x100000u)) { a &= ~0x100000u; memChanged(a, 1); }
  if (a >= XRAM_BASE || a < RAM_TOP) { if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } }
  else if (VGAON) { if (a < VGA_HI) { WRCHG += 1; jvwr(a, v); } }
  else if (a >= VRAM_BASE && a < VRAM_END) { if (M[a] != v) { WRCHG += 1; M[a] = (u8)v; } }
}
static void cacheInvalidate6(u32 phys, u32 len);
static void cacheInvalidate5(u32 phys, u32 len) {
  if (P6) { cacheInvalidate6(phys, len); return; }
  if (CR[0] & C0_NW) return;
  const u32 end = phys + len;
  u32 nd = 0, ni = 0;
  if (len >= 0x2000) {
    for (int i = 0; i < 256; i++) {
      const u32 so = (u32)(i >> 1) << 5;
      if (DTAG[i] >= 0) { const u32 a = ((u32)DTAG[i] << 12) | so; if ((u64)a + 32 > phys && a < end) { DTAG[i] = -1; DSTATE[i] = P5_I; nd++; } }
      if (ITAG[i] >= 0) { const u32 a = ((u32)ITAG[i] << 12) | so; if ((u64)a + 32 > phys && a < end) { ITAG[i] = -1; ni++; } }
    }
  } else {
    for (u32 a = phys - (phys & 31); a < end; a += 32) {
      const int i = (int)((a >> 5) & 127) << 1;
      const i32 tag = (i32)(a >> 12);
      if (DTAG[i] == tag) { DTAG[i] = -1; DSTATE[i] = P5_I; nd++; } else if (DTAG[i + 1] == tag) { DTAG[i + 1] = -1; DSTATE[i + 1] = P5_I; nd++; }
      if (ITAG[i] == tag) { ITAG[i] = -1; ni++; } else if (ITAG[i + 1] == tag) { ITAG[i + 1] = -1; ni++; }
    }
  }
  C_INVAL += nd; IC_INVAL += ni;
}
static u32 lineAddr(i32 tag, int i) { return ((u32)tag << 12) | ((u32)(i >> 1) << 5); }
static u32 fillTime5(void) { return BUSLEN + 3 * (BUSLEN - 1); }
static void wbBurst(void) {
  C_WB++;
  for (int j = 0; j < 4; j++) busEv(T_MEMW, j ? BUSLEN - 1 : BUSLEN);
}
static int dFill(u32 pa, u32 attr) {
  const u32 set = (pa >> 5) & 127, line = pa - (pa & 31);
  const int w = DTAG[set << 1] < 0 ? 0 : DTAG[(set << 1) + 1] < 0 ? 1 : DLRU[set];
  const int i = (int)(set << 1) + w, base = i << 5;
  const int old = DTAG[i] >= 0 && DSTATE[i] == P5_M;
  const u32 oldA = old ? lineAddr(DTAG[i], i) : 0;
  for (int k = 0; k < 32; k++) DDATA[base + k] = (u8)rd8(line + (u32)k);
  DTAG[i] = (i32)(pa >> 12); DSTATE[i] = attr & 8 ? P5_S : P5_E; DLRU[set] = (u8)(w ^ 1);
  C_FILLS++;
  for (int j = 0; j < 4; j++) busEv(T_MEMR, j ? BUSLEN - 1 : BUSLEN);
  WBLINEV = old; WBLINE = oldA;
  if (old) wbBurst();
  return i;
}
static int iFill(u32 pa, int stall) {
  const u32 set = (pa >> 5) & 127, line = pa - (pa & 31);
  const int w = ITAG[set << 1] < 0 ? 0 : ITAG[(set << 1) + 1] < 0 ? 1 : ILRU[set];
  const int i = (int)(set << 1) + w, base = i << 5;
  for (int k = 0; k < 32; k++) IDATA[base + k] = (u8)rd8(line + (u32)k);
  ITAG[i] = (i32)(pa >> 12); ILRU[set] = (u8)(w ^ 1);
  IC_FILLS++;
  for (int j = 0; j < 4; j++) codeEv(j ? BUSLEN - 1 : BUSLEN, stall);
  return i;
}
static u32 busLenDef(void);
static void memCycles5(int type, u32 pa, u32 n) {
  const u32 k = 8 - (pa & 7), len = busLenDef();
  if (n <= k) { busEv(type, len); return; }
  busEv(type, len); busEv(type, len);
}
static u32 physRd5(u32 pa, u32 n, u32 attr) {
  const u32 off = pa & 31;
  if (off + n > 32) {
    const u32 k = 32 - off;
    const u32 lo = physRd5(pa, k, attr);
    return lo | (physRd5(pa + k, n - k, attr) << (8 * k));
  }
  const int i0 = (int)((pa >> 5) & 127) << 1;
  const i32 tag = (i32)(pa >> 12);
  int i = DTAG[i0] == tag ? i0 : DTAG[i0 + 1] == tag ? i0 + 1 : -1;
  if (i >= 0) { C_HITS++; DLRU[i0 >> 1] = (u8)((i & 1) ^ 1); }
  else {
    C_MISSES++;
    WBLINEV = 0;
    if (!(CR[0] & C0_CD) && !(attr & 0x10) && !(TR12 & TR12_CI) && cacheable(pa)) i = dFill(pa, attr);
  }
  u32 v;
  if (i >= 0) {
    const int b = (i << 5) + (int)off;
    v = DDATA[b];
    if (n > 1) v |= (u32)DDATA[b + 1] << 8;
    if (n > 2) v |= (u32)DDATA[b + 2] << 16;
    if (n > 3) v |= (u32)DDATA[b + 3] << 24;
  } else {
    C_UNCACHED++;
    v = rd8(pa);
    for (u32 k = 1; k < n; k++) v |= rd8(pa + k) << (8 * k);
    memCycles5(T_MEMR, pa, n);
  }
  return v;
}
static void physWr5(u32 pa, u32 n, u32 v, u32 attr) {
  const u32 off = pa & 31;
  if (off + n > 32) {
    const u32 k = 32 - off;
    physWr5(pa, k, v & (0xFFFFFFFFu >> (32 - 8 * k)), attr);
    physWr5(pa + k, n - k, v >> (8 * k), attr);
    return;
  }
  const int i0 = (int)((pa >> 5) & 127) << 1;
  const i32 tag = (i32)(pa >> 12);
  const u32 c0 = CR[0];
  const int i = DTAG[i0] == tag ? i0 : DTAG[i0 + 1] == tag ? i0 + 1 : -1;
  int cyc = 1;
  if (i >= 0) {
    const int b = (i << 5) + (int)off;
    for (u32 k = 0; k < n; k++) DDATA[b + (int)k] = (u8)(v >> (8 * k));
    C_WHITS++; DLRU[i0 >> 1] = (u8)((i & 1) ^ 1);
    if (c0 & C0_NW) cyc = 0;
    else if (!(c0 & C0_CD)) {
      const u32 sti = DSTATE[i];
      if (sti >= P5_E) { cyc = 0; C_WHITSME++; DSTATE[i] = P5_M; }
      else if (!(attr & 8)) DSTATE[i] = P5_E;
    }
  } else C_WMISSES++;
  if (cyc) {
    for (u32 k = 0; k < n; k++) wr8(pa + k, (v >> (8 * k)) & 0xFF);
    memCycles5(T_MEMW, pa, n);
  } else for (u32 k = 0; k < n; k++) poke8(pa + k, (v >> (8 * k)) & 0xFF);
  if (ITAG[i0] == tag) { ITAG[i0] = -1; IC_INVAL++; } else if (ITAG[i0 + 1] == tag) { ITAG[i0 + 1] = -1; IC_INVAL++; }
}

// ---------- the P5 TLBs and the page walk (4 KB and 4 MB pages) ----------
static int tlb4mFind(u32 la) {
  const u32 set = (la >> 22) & 1, page = la & 0xFFC00000u;
  for (u32 i = set * 4; i < set * 4 + 4; i++) if (T4VALID[i] && T4LIN[i] == page) return (int)i;
  return -1;
}
static int itlbFind(u32 la) {
  const u32 set = (la >> 12) & 7, page = la & 0xFFFFF000u;
  for (u32 i = set * 4; i < set * 4 + 4; i++) if (ITVALID[i] && ITLIN[i] == page) return (int)i;
  return -1;
}
static void tPut(u32 *L, u32 *P, u32 *F, u32 *Vd, u8 *next, u32 set, u32 page, u32 frame, u32 flags) {
  int way = -1;
  for (int w = 0; w < 4; w++) { const u32 e = set * 4 + (u32)w; if (Vd[e] && L[e] == page) { way = w; break; } }
  if (way < 0) { way = next[set]; next[set] = (u8)((way + 1) & 3); }
  const u32 e = set * 4 + (u32)way;
  L[e] = page; P[e] = frame; F[e] = flags; Vd[e] = 1;
}
static u32 physRd6(u32 pa, u32 n, u32 attr);
static void physWr6(u32 pa, u32 n, u32 v, u32 attr);
#define PRD(pa, n, a) (P6 ? physRd6(pa, n, a) : physRd5(pa, n, a))
#define PWR(pa, n, v, a) (P6 ? physWr6(pa, n, v, a) : physWr5(pa, n, v, a))
static u32 walk5(u32 la, int write, int user, int code) {
  if (code) T_CMISSES++; else T_MISSES++;
  const u32 dir = la >> 22, tbl = (la >> 12) & 0x3FF, cr3 = CR[3];
  const u32 pdeA = (cr3 & 0xFFFFF000u) + dir * 4;
  const u32 pde = PRD(pdeA, 4, cr3 & 0x18);
  const u32 err = (write ? 2u : 0u) | (user ? 4u : 0u);
  if (!(pde & 1)) { pageFault(la, err); return 0; }
  if ((pde & 0x80) && (CR[4] & C4_PSE)) {
    if (pde & 0x3FF000) { pageFault(la, err | 9); return 0; }
    const u32 us = pde & 4, rw = pde & 2;
    if (user && (!us || (write && !rw))) { pageFault(la, err | 1); return 0; }
    if (!user && write && !rw && (CR[0] & C0_WP)) { pageFault(la, err | 1); return 0; }
    const u32 npde = pde | 0x20 | (write ? 0x40u : 0u);
    if (npde != pde) PWR(pdeA, 4, npde, cr3 & 0x18);
    const u32 frame = pde & 0xFFC00000u, fl = us | rw | 0x21 | (npde & 0x40) | (pde & (P6 ? 0x118u : 0x18u)) | 0x80;
    if (code) tPut(ITLIN, ITPHYS, ITFL, ITVALID, ITNEXT, (la >> 12) & 7, la & 0xFFFFF000u, frame | (la & 0x3FF000), fl);
    else tPut(T4LIN, T4PHYS, T4FL, T4VALID, T4NEXT, (la >> 22) & 1, la & 0xFFC00000u, frame, fl);
    XPCD = pde & 0x18;
    return frame | (la & 0x3FFFFF);
  }
  const u32 pteA = (pde & 0xFFFFF000u) + tbl * 4;
  const u32 pte = PRD(pteA, 4, pde & 0x18);
  if (!(pte & 1)) { pageFault(la, err); return 0; }
  const u32 us = pde & pte & 4, rw = pde & pte & 2;
  if (user && (!us || (write && !rw))) { pageFault(la, err | 1); return 0; }
  if (!user && write && !rw && (CR[0] & C0_WP)) { pageFault(la, err | 1); return 0; }
  if (!(pde & 0x20)) PWR(pdeA, 4, pde | 0x20, cr3 & 0x18);
  const u32 npte = pte | 0x20 | (write ? 0x40u : 0u);
  if (npte != pte) PWR(pteA, 4, npte, pde & 0x18);
  const u32 frame = pte & 0xFFFFF000u, fl = us | rw | 0x21 | (npte & 0x40) | (pte & (P6 ? 0x118u : 0x18u));
  if (code) tPut(ITLIN, ITPHYS, ITFL, ITVALID, ITNEXT, (la >> 12) & 7, la & 0xFFFFF000u, frame, fl);
  else tPut(TLBLIN, TLBPHYS, TLBFL, TLBVALID, TLBNEXT, (la >> 12) & 15, la & 0xFFFFF000u, frame, fl);
  XPCD = pte & 0x18;
  return frame | (la & 0xFFF);
}
static int tlbFind(u32 la);
static u32 xlate5(u32 la, int write, int user) {
  int e = tlbFind(la), big = 0;
  u32 fl = 0, ph = 0;
  if (e >= 0) { fl = TLBFL[e]; ph = TLBPHYS[e]; }
  else if (CR[4] & C4_PSE) { e = tlb4mFind(la); if (e >= 0) { big = 1; fl = T4FL[e]; ph = T4PHYS[e]; } }
  if (e >= 0) {
    const int re = user ? (!(fl & 4) || (write && !(fl & 2))) : (write && !(fl & 2) && (CR[0] & C0_WP));
    if (re) return walk5(la, write, user, 0);
    if (!write || (fl & 0x40)) {
      T_HITS++;
      if (big) T_BIG++;
      XPCD = fl & 0x18;
      return big ? ph | (la & 0x3FFFFF) : ph | (la & 0xFFF);
    }
  }
  return walk5(la, write, user, 0);
}
static u32 xlateCode(u32 la, int user) {
  const int e = itlbFind(la);
  if (e >= 0 && (!user || (ITFL[e] & 4))) { T_CHITS++; XPCD = ITFL[e] & 0x18; return ITPHYS[e] | (la & 0xFFF); }
  return walk5(la, 0, user, 1);
}
static i64 peekPhys5(u32 la) {
  int e = tlbFind(la);
  if (e >= 0) return TLBPHYS[e] | (la & 0xFFF);
  e = itlbFind(la);
  if (e >= 0) return ITPHYS[e] | (la & 0xFFF);
  if (CR[4] & C4_PSE) { e = tlb4mFind(la); if (e >= 0) return T4PHYS[e] | (la & 0x3FFFFF); }
  const u32 pdeA = (CR[3] & 0xFFFFF000u) + (la >> 22) * 4;
  const u32 pde = peek8(pdeA) | (peek8(pdeA + 1) << 8) | (peek8(pdeA + 2) << 16) | (peek8(pdeA + 3) << 24);
  if (!(pde & 1)) return -1;
  if ((pde & 0x80) && (CR[4] & C4_PSE)) return (pde & 0xFFC00000u) | (la & 0x3FFFFF);
  const u32 pteA = (pde & 0xFFFFF000u) + ((la >> 12) & 0x3FF) * 4;
  const u32 pte = peek8(pteA) | (peek8(pteA + 1) << 8) | (peek8(pteA + 2) << 16) | (peek8(pteA + 3) << 24);
  if (!(pte & 1)) return -1;
  return (pte & 0xFFFFF000u) | (la & 0xFFF);
}

// ---------- the P5 pairing rules ----------
#define PI_UV 1u
#define PI_PU 2u
#define PI_PV 3u
#define PI_PUSH 0x40000u
#define PI_POP 0x80000u
#define PI_FP 0x100000u
#define PI_FXCH 0x200000u
static u8 PK[256];                         // P586_PK: 2 = a prefix, 4 = never pairs, 0 = look
static const u32 EA16[8] = { 72, 136, 96, 160, 64, 128, 32, 8 };
static i32 eaInfo(const u8 *B, u32 q, i32 n, int big) {
  if (n < 1) return -1;
  const u32 m = B[q], md = m >> 6, r = m & 7;
  if (md == 3) return 0;
  if (!big) {
    const int direct = md == 0 && r == 6;
    const u32 dl = md == 1 ? 1 : (md == 2 || direct) ? 2 : 0;
    return (i32)((direct ? 0 : EA16[r]) | (dl << 8) | (dl ? 0x800u : 0));
  }
  u32 regs = 0, ex = 0, dl = md == 1 ? 1 : md == 2 ? 4 : 0;
  if (r == 4) {
    if (n < 2) return -1;
    const u32 sib = B[q + 1], base = sib & 7, idx = (sib >> 3) & 7;
    ex = 1;
    if (base == 5 && md == 0) dl = 4; else regs |= 1u << base;
    if (idx != 4) regs |= 1u << idx;
  } else if (r == 5 && md == 0) dl = 4;
  else regs = 1u << r;
  return (i32)(regs | ((ex + dl) << 8) | (dl ? 0x800u : 0));
}
static u32 fpPairInfo(const u8 *B, u32 p, i32 n, int big) {
  if (n < 2) { PWHY = 1; return 0; }
  const u32 b0 = B[p], mm = B[p + 1], md = mm >> 6, r = (mm >> 3) & 7;
  if (md == 3) {
    u32 fx = 0;
    if (b0 == 0xD8 || b0 == 0xDC) fx = PI_FP;
    else if (b0 == 0xDE) fx = (r != 2 && r != 3) || mm == 0xD9 ? PI_FP : 0;
    else if (b0 == 0xD9) fx = r == 0 || mm == 0xE0 || mm == 0xE1 || mm == 0xE4 ? PI_FP : r == 1 ? PI_FXCH : 0;
    else if (b0 == 0xDD) fx = r == 4 || r == 5 ? PI_FP : 0;
    else if (b0 == 0xDA) fx = mm == 0xE9 ? PI_FP : 0;
    if (!fx) { PWHY = 4; return 0; }
    return fx | (2u << 24);
  }
  if (!(b0 == 0xD8 || b0 == 0xDC || ((b0 == 0xD9 || b0 == 0xDD) && r == 0))) { PWHY = 4; return 0; }
  const i32 ea = eaInfo(B, p + 1, n - 1, big);
  if (ea < 0) { PWHY = 1; return 0; }
  const u32 len = 2 + (((u32)ea >> 8) & 7);
  if ((i32)len > n) { PWHY = 1; return 0; }
  return PI_FP | (len << 24);
}
static u32 pairScan(const u8 *B, u32 p, i32 n) {
  if (n < 1) { PWHY = 1; return 0; }
  const u32 b0 = B[p], pk = PK[b0];
  if (pk) { PWHY = pk; return 0; }
  const int big = SBIG[CS] != 0;
  const u32 S = big ? 4 : 2;
  u32 len = 1, rdm = 0, wrm = 0, pipe = PI_UV, x = 0, imm = 0;
  i32 ea = 0;
  if (b0 < 0x40 && (b0 & 7) < 6) {
    const u32 f = b0 & 7, o = b0 >> 3, byte = !(f & 1);
    if (o == 2 || o == 3) pipe = PI_PU;
    if (f >= 4) { rdm = 1; wrm = o == 7 ? 0 : 1; imm = byte ? 1 : S; }
    else {
      if (n < 2) { PWHY = 1; return 0; }
      const u32 mm = B[p + 1], r = (mm >> 3) & 7;
      ea = eaInfo(B, p + 1, n - 1, big);
      if (ea < 0) { PWHY = 1; return 0; }
      const u32 g = 1u << (byte ? r & 3 : r), e = (mm >> 6) == 3 ? 1u << (byte ? mm & 3 : mm & 7) : 0;
      rdm = g | e | ((u32)ea & 0xFF);
      if (o != 7) wrm = f < 2 ? e : g;
      len = 2 + (((u32)ea >> 8) & 7);
    }
  } else if (b0 >= 0x40 && b0 < 0x50) { rdm = 1u << (b0 & 7); wrm = rdm; }
  else if (b0 >= 0x50 && b0 < 0x58) { rdm = (1u << (b0 & 7)) | 16; wrm = 16; x = PI_PUSH; }
  else if (b0 >= 0x58 && b0 < 0x60) { rdm = 16; wrm = (1u << (b0 & 7)) | 16; x = PI_POP; }
  else if (b0 == 0x68 || b0 == 0x6A) { rdm = 16; wrm = 16; x = PI_PUSH; imm = b0 == 0x68 ? S : 1; }
  else if (b0 >= 0x70 && b0 < 0x80) { pipe = PI_PV; imm = 1; }
  else if (b0 >= 0xB0 && b0 < 0xC0) { wrm = 1u << (b0 < 0xB8 ? b0 & 3 : b0 & 7); imm = b0 < 0xB8 ? 1 : S; }
  else {
    switch (b0) {
      case 0x80: case 0x81: case 0x82: case 0x83: case 0x84: case 0x85: case 0x88: case 0x89: case 0x8A: case 0x8B:
      case 0x8D: case 0xC0: case 0xC1: case 0xC6: case 0xC7: case 0xD0: case 0xD1: case 0xFE: case 0xFF: {
        if (n < 2) { PWHY = 1; return 0; }
        const u32 mm = B[p + 1], r = (mm >> 3) & 7, md = mm >> 6, byte = !(b0 & 1);
        ea = eaInfo(B, p + 1, n - 1, big);
        if (ea < 0) { PWHY = 1; return 0; }
        const u32 g = 1u << (byte ? r & 3 : r), e = md == 3 ? 1u << (byte ? mm & 3 : mm & 7) : 0, a = (u32)ea & 0xFF;
        len = 2 + (((u32)ea >> 8) & 7);
        switch (b0) {
          case 0x80: case 0x81: case 0x82: case 0x83:
            if (r == 2 || r == 3) pipe = PI_PU;
            rdm = e | a; wrm = r == 7 ? 0 : e; imm = b0 == 0x81 ? S : 1; break;
          case 0x84: case 0x85: rdm = g | e | a; break;
          case 0x88: case 0x89: rdm = g | a; wrm = e; break;
          case 0x8A: case 0x8B: rdm = e | a; wrm = g; break;
          case 0x8D: if (md == 3) { PWHY = 4; return 0; } rdm = a; wrm = g; break;
          case 0xC0: case 0xC1: if (r < 4) { PWHY = 4; return 0; } pipe = PI_PU; rdm = e | a; wrm = e; imm = 1; break;
          case 0xD0: case 0xD1: pipe = PI_PU; rdm = e | a; wrm = e; break;
          case 0xC6: case 0xC7: if (r) { PWHY = 4; return 0; } rdm = a; wrm = e; imm = byte ? 1 : S; break;
          default: if (r > 1) { PWHY = 4; return 0; } rdm = e | a; wrm = e;
        }
        break;
      }
      case 0x90: break;
      case 0xA0: case 0xA1: wrm = 1; len = 1 + S; break;
      case 0xA2: case 0xA3: rdm = 1; len = 1 + S; break;
      case 0xA8: rdm = 1; imm = 1; break;
      case 0xA9: rdm = 1; imm = S; break;
      case 0xE8: pipe = PI_PV; rdm = 16; wrm = 16; x = PI_PUSH; imm = S; break;
      case 0xE9: pipe = PI_PV; imm = S; break;
      case 0xEB: pipe = PI_PV; imm = 1; break;
      case 0x0F:
        if (n < 2) { PWHY = 1; return 0; }
        if ((B[p + 1] & 0xF0) != 0x80) { PWHY = 4; return 0; }
        pipe = PI_PV; len = 2; imm = S; break;
      default:
        if (b0 >= 0xD8 && b0 <= 0xDF) return fpPairInfo(B, p, n, big);
        PWHY = 4; return 0;
    }
  }
  if (imm && (ea & 0x800)) { PWHY = 6; return 0; }
  len += imm;
  if ((i32)len > n) { PWHY = 1; return 0; }
  return rdm | (wrm << 8) | (pipe << 16) | x | (len << 24);
}
// (the JavaScript memo of pairInfo only keeps results: the same values without it)
static u32 pairInfo(const u8 *B, u32 p, i32 n) {
  if (n < 3) return pairScan(B, p, n);
  const u32 pk = PK[B[p]];
  if (pk) { PWHY = pk; return 0; }
  const u32 v = pairScan(B, p, 15);
  if (v && (i32)(v >> 24) > n) { PWHY = 1; return 0; }
  return v;
}
static u32 pairCheck(int halted) {
  if (halted) return 17;
  if (!EXECOK) return 16;
  if (!ILEN) return 4;
  if (TR12 & TR12_SE) return 13;
  if (EFL & F_TF) return 14;
  u32 u;
  if (VIPV && VIP == LASTIP && VBASE == LASTBASE) { u = VINFO; PWHY = VWHY; }
  else u = pairInfo(IB, 0, (i32)ILEN);
  if (!u) return PWHY == 1 ? 4 : PWHY;
  if (((u >> 16) & 3) == PI_PV) return 8;
  if (DIDFLUSH) return 15;
  const u32 v = pairInfo(QB, QH, (i32)(QT - QH));
  VIPV = v || PWHY != 1; VIP = EIP; VINFO = v; VWHY = PWHY; VBASE = SBASE[CS];
  if (!v) return PWHY == 1 ? 1 : PWHY + 1;
  if ((u | v) & (PI_FP | PI_FXCH)) return (u & PI_FP) && (v & PI_FXCH) ? 0 : 12;
  if (((v >> 16) & 3) == PI_PU) return 9;
  u32 ur = u & 0xFF, uw = (u >> 8) & 0xFF, vr = v & 0xFF, vw = (v >> 8) & 0xFF;
  (void)ur;                                      // (as the JavaScript: U's reads do not matter)
  if (((u & PI_PUSH) && (v & PI_PUSH)) || ((u & PI_POP) && (v & PI_POP))) { ur &= ~16u; uw &= ~16u; vr &= ~16u; vw &= ~16u; }
  u32 dep = uw & vr;
  if (dep) { PREG = (u32)__builtin_ctz(dep); return 10; }
  dep = uw & vw;
  if (dep) { PREG = (u32)__builtin_ctz(dep); return 11; }
  return 0;
}
// ---------- the P5 branch target buffer ----------
static void branch(void) {
  const u32 la = LASTBASE + LASTIP, set = (la >> 2) & 63;
  const i32 tag = (i32)la;
  const int taken = DIDFLUSH != 0, nbp = (TR12 & TR12_NBP) != 0;
  const u32 tgt = taken ? SBASE[CS] + EIP : 0;
  int i = -1;
  if (!nbp) for (u32 k = set * 4; k < set * 4 + 4; k++) if (BTAG[k] == tag) { i = (int)k; break; }
  const int hit = i >= 0, predT = hit && BCNT[i] >= 2;
  const int right = predT == taken && (!taken || BTGT[i] == tgt);
  BT_LOOKUPS++;
  if (hit) BT_HITS++;
  if (hit || taken) BT_TAKEN++;
  if (right) BT_RIGHT++; else BT_WRONG++;
  if (!nbp) {
    if (hit) {
      const u32 c = BCNT[i];
      BCNT[i] = (u8)(taken ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0));
      if (taken) BTGT[i] = tgt;
    } else if (taken) {
      const u32 w = BNEXT[set];
      BNEXT[set] = (u8)((w + 1) & 3);
      i = (int)(set * 4 + w);
      BTAG[i] = tag; BTGT[i] = tgt; BCNT[i] = 3;
      BT_ALLOCS++;
    }
  }
  CLK += right ? 0 : ISV ? 4 : 3;
}

// ==================== the Pentium Pro (CPU80686) front end ====================
// P6 = 1: the Pentium Pro (P5 = 1 too: the TLBs, the data cache layout, the fetch into IB and the
// queue snoop are the ones of the P5). The instruction runs as in the 80386 core (no 486 / P5
// clocks); its loads and stores (with their latency) and the recipe of the instruction go to the
// out-of-order model (ooo of p6ooo.c), which gives the clock of the step.
#define FPTOP V[280]
#define FPUPC V[281]
#define STRCONT V[283]
#define OPPOS V[284]
#define NLD V[285]
#define NST V[286]
#define C_RFO V[241]
#define L2_REQ V[242]
#define L2_HITS V[243]
#define L2_MISSES V[244]
#define L2_CREQ V[245]
#define L2_CMISS V[246]
#define L2_FILLS V[247]
#define L2_WB V[248]
#define L2_FLUSHES V[249]
#define L2_INVAL V[250]
#define ACCLAT D[10]
#define ACCBUS D[11]
#define CODELAT D[12]
#define CODEBUS D[13]
#define BUSRATIO D[14]
i32 L2TAG[8192]; u8 L2STATE[8192], L2LRU[2048];
// the recipe numbers (p686Recipes order; the JavaScript glue fills them): -1 = none
i32 RID1[256], RIDG1[256 * 8], RID0F[256], RIDG0F[256 * 8], RIDFP[2048], RIDMISC[4];   // RIDMISC: EXC, INT, UD

static double dceil(double x) { const double t = (double)(i64)x; return t < x ? t + 1 : t; }
static double fsbFirst(void) { return dceil(BUSRATIO * (2 + WS)); }
static double fsbNext(void) { return dceil(BUSRATIO * (1 + WS)); }
static double fsbReq(void) { return dceil(BUSRATIO * 2); }
static u32 busLenDef(void) { return P6 ? (u32)fsbFirst() : BUSLEN; }

static void p686Touch(u8 *L, int set, int w) {
  u32 b = L[set];
  switch (w) { case 0: b |= 3; break; case 1: b = (b | 1) & ~2u; break; case 2: b = (b & ~1u) | 4; break; default: b &= ~5u; }
  L[set] = (u8)b;
}
static int p686Victim(const i32 *T, const u8 *L, int set) {
  const int k = set << 2;
  if (T[k] < 0) return 0;
  if (T[k + 1] < 0) return 1;
  if (T[k + 2] < 0) return 2;
  if (T[k + 3] < 0) return 3;
  const u32 b = L[set];
  return !(b & 1) ? (b & 2 ? 1 : 0) : (b & 4 ? 3 : 2);
}
static int iFind6(u32 pa) {
  const int b = (int)((pa >> 5) & 63) << 2;
  const i32 t = (i32)(pa >> 11);
  return ITAG[b] == t ? b : ITAG[b + 1] == t ? b + 1 : ITAG[b + 2] == t ? b + 2 : ITAG[b + 3] == t ? b + 3 : -1;
}
static int l2Find(u32 pa) {
  const int b = (int)((pa >> 5) & 2047) << 2;
  const i32 t = (i32)(pa >> 16);
  return L2TAG[b] == t ? b : L2TAG[b + 1] == t ? b + 1 : L2TAG[b + 2] == t ? b + 2 : L2TAG[b + 3] == t ? b + 3 : -1;
}
static u32 iLineAddr(i32 tag, int i) { return ((u32)tag << 11) | ((u32)(i >> 2) << 5); }
static u32 l2LineAddr(i32 tag, int i) { return ((u32)tag << 16) | ((u32)(i >> 2) << 5); }
static void cacheInvalidate6(u32 phys, u32 len) {
  if (CR[0] & C0_NW) return;
  const u32 end = phys + len;
  u32 nd = 0, ni = 0, nl = 0;
  if (len >= 0x2000) {
    for (int i = 0; i < 256; i++) {
      if (DTAG[i] >= 0) { const u32 a = lineAddr(DTAG[i], i); if ((u64)a + 32 > phys && a < end) { DTAG[i] = -1; DSTATE[i] = P5_I; nd++; } }
      if (ITAG[i] >= 0) { const u32 a = iLineAddr(ITAG[i], i); if ((u64)a + 32 > phys && a < end) { ITAG[i] = -1; ni++; } }
    }
    for (int i = 0; i < 8192; i++) {
      if (L2TAG[i] >= 0) { const u32 a = l2LineAddr(L2TAG[i], i); if ((u64)a + 32 > phys && a < end) { L2TAG[i] = -1; L2STATE[i] = P5_I; nl++; } }
    }
  } else {
    for (u32 a = phys - (phys & 31); a < end; a += 32) {
      const int i0 = (int)((a >> 5) & 127) << 1;
      const i32 tag = (i32)(a >> 12);
      const int i = DTAG[i0] == tag ? i0 : DTAG[i0 + 1] == tag ? i0 + 1 : -1;
      if (i >= 0) { DTAG[i] = -1; DSTATE[i] = P5_I; nd++; }
      const int c = iFind6(a);
      if (c >= 0) { ITAG[c] = -1; ni++; }
      const int l = l2Find(a);
      if (l >= 0) { L2TAG[l] = -1; L2STATE[l] = P5_I; nl++; }
    }
  }
  C_INVAL += nd; IC_INVAL += ni; L2_INVAL += nl;
}
static double wbBurst6(void) {
  L2_WB++;
  const double f1 = fsbFirst(), fn = fsbNext();
  for (int k = 0; k < 4; k++) busEv(T_MEMW, (u32)(k ? fn : f1));
  return f1 + 3 * fn + fsbReq();
}
static int l2Fill(u32 pa, int j, u32 attr, int code, int stall) {
  L2_REQ++;
  if (code) L2_CREQ++;
  double lat, busT = 0;
  if (j >= 0) {
    L2_HITS++;
    p686Touch(L2LRU, j >> 2, j & 3);
    lat = L2LAT;
  } else {
    L2_MISSES++;
    if (code) L2_CMISS++;
    const int set = (int)((pa >> 5) & 2047), w = p686Victim(L2TAG, L2LRU, set);
    j = (set << 2) + w;
    if (L2TAG[j] >= 0 && L2STATE[j] == P5_M) busT += wbBurst6();
    L2TAG[j] = (i32)(pa >> 16); L2STATE[j] = attr & 8 ? P5_S : P5_E; L2_FILLS++;
    p686Touch(L2LRU, set, w);
    const double f1 = fsbFirst(), fn = fsbNext();
    for (int k = 0; k < 4; k++) {
      const u32 len = (u32)(k ? fn : f1);
      if (code) codeEv(len, stall); else busEv(T_MEMR, len);
    }
    busT += f1 + 3 * fn + fsbReq();
    lat = L2LAT + fsbReq() + f1;
  }
  if (code) { CODELAT += lat; CODEBUS += busT; } else { ACCLAT += lat; ACCBUS += busT; }
  return j;
}
static void l2Put(u32 line) {
  int j = l2Find(line);
  if (j < 0) {
    const int set = (int)((line >> 5) & 2047), w = p686Victim(L2TAG, L2LRU, set);
    j = (set << 2) + w;
    if (L2TAG[j] >= 0 && L2STATE[j] == P5_M) ACCBUS += wbBurst6();
    L2TAG[j] = (i32)(line >> 16); L2_FILLS++;
  }
  L2STATE[j] = P5_M;
  p686Touch(L2LRU, j >> 2, j & 3);
}
static int dFill6(u32 pa, u32 attr) {
  const u32 set = (pa >> 5) & 127, line = pa - (pa & 31);
  const int w = DTAG[set << 1] < 0 ? 0 : DTAG[(set << 1) + 1] < 0 ? 1 : DLRU[set];
  const int i = (int)(set << 1) + w, base = i << 5;
  WBLINEV = 0;
  if (DTAG[i] >= 0 && DSTATE[i] == P5_M) { WBLINEV = 1; WBLINE = lineAddr(DTAG[i], i); C_WB++; l2Put(WBLINE); }
  const int j = l2Find(pa);
  if (j >= 0) for (int k = 0; k < 32; k++) DDATA[base + k] = (u8)peek8(line + (u32)k);
  else for (int k = 0; k < 32; k++) DDATA[base + k] = (u8)rd8(line + (u32)k);
  DTAG[i] = (i32)(pa >> 12); DSTATE[i] = attr & 8 ? P5_S : P5_E; DLRU[set] = (u8)(w ^ 1);
  C_FILLS++;
  l2Fill(pa, j, attr, 0, 0);
  return i;
}
static int iFill6(u32 pa, int stall, u32 attr) {
  const int set = (int)((pa >> 5) & 63), w = p686Victim(ITAG, ILRU, set), i = (set << 2) + w, base = i << 5;
  const u32 line = pa - (pa & 31);
  const int j = l2Find(pa);
  if (j >= 0) for (int k = 0; k < 32; k++) IDATA[base + k] = (u8)peek8(line + (u32)k);
  else for (int k = 0; k < 32; k++) IDATA[base + k] = (u8)rd8(line + (u32)k);
  ITAG[i] = (i32)(pa >> 11); p686Touch(ILRU, set, w);
  IC_FILLS++;
  l2Fill(pa, j, attr, 1, stall);
  return i;
}
static u32 physRd6(u32 pa, u32 n, u32 attr) {
  const u32 off = pa & 31;
  if (off + n > 32) {
    const u32 k = 32 - off;
    ST[ST_SPLITLOADS]++; ACCLAT += 6;
    const u32 lo = physRd6(pa, k, attr);
    return lo | (physRd6(pa + k, n - k, attr) << (8 * k));
  }
  const int i0 = (int)((pa >> 5) & 127) << 1;
  const i32 tag = (i32)(pa >> 12);
  int i = DTAG[i0] == tag ? i0 : DTAG[i0 + 1] == tag ? i0 + 1 : -1;
  if (i >= 0) { C_HITS++; DLRU[i0 >> 1] = (u8)((i & 1) ^ 1); }
  else {
    C_MISSES++;
    WBLINEV = 0;
    if (!(CR[0] & C0_CD) && !(attr & 0x10) && cacheable(pa)) i = dFill6(pa, attr);
  }
  u32 v;
  if (i >= 0) {
    const int b = (i << 5) + (int)off;
    v = DDATA[b];
    if (n > 1) v |= (u32)DDATA[b + 1] << 8;
    if (n > 2) v |= (u32)DDATA[b + 2] << 16;
    if (n > 3) v |= (u32)DDATA[b + 3] << 24;
  } else {
    C_UNCACHED++;
    v = rd8(pa);
    for (u32 k = 1; k < n; k++) v |= rd8(pa + k) << (8 * k);
    memCycles5(T_MEMR, pa, n);
    const double f = fsbFirst() + fsbReq();
    ACCLAT += f; ACCBUS += f;
  }
  return v;
}
static void physWr6(u32 pa, u32 n, u32 v, u32 attr) {
  const u32 off = pa & 31;
  if (off + n > 32) {
    const u32 k = 32 - off;
    physWr6(pa, k, v & (0xFFFFFFFFu >> (32 - 8 * k)), attr);
    physWr6(pa + k, n - k, v >> (8 * k), attr);
    return;
  }
  const int i0 = (int)((pa >> 5) & 127) << 1;
  const i32 tag = (i32)(pa >> 12);
  const u32 c0 = CR[0];
  int i = DTAG[i0] == tag ? i0 : DTAG[i0 + 1] == tag ? i0 + 1 : -1;
  const int hit = i >= 0;
  if (!hit) {
    C_WMISSES++;
    WBLINEV = 0;
    if (!(c0 & C0_CD) && !(attr & 0x18) && cacheable(pa)) { C_RFO++; i = dFill6(pa, attr); }
  }
  int cyc = 1;
  if (i >= 0) {
    const int b = (i << 5) + (int)off;
    for (u32 k = 0; k < n; k++) DDATA[b + (int)k] = (u8)(v >> (8 * k));
    if (hit) C_WHITS++;
    DLRU[i0 >> 1] = (u8)((i & 1) ^ 1);
    if (c0 & C0_NW) cyc = 0;
    else if (!(c0 & C0_CD)) {
      const u32 sti = DSTATE[i];
      if (sti >= P5_E) { cyc = 0; if (hit) C_WHITSME++; DSTATE[i] = P5_M; }
      else if (!(attr & 8)) DSTATE[i] = P5_E;
    }
  }
  if (cyc) {
    for (u32 k = 0; k < n; k++) wr8(pa + k, (v >> (8 * k)) & 0xFF);
    memCycles5(T_MEMW, pa, n);
    ACCBUS += fsbFirst() + fsbReq();
  } else for (u32 k = 0; k < n; k++) poke8(pa + k, (v >> (8 * k)) & 0xFF);
  const int j = iFind6(pa);
  if (j >= 0) { ITAG[j] = -1; IC_INVAL++; }
}
static void qCompact(void);
static i32 prefetch6(int stall, i32 room) {
  const u32 qip = QIP, hi = SHI[CS];
  if (!stall && qip > hi) return -1;
  if (QT > 96) qCompact();
  const u32 la = SBASE[CS] + qip;
  u32 pa = la, attr = 0;
  if (PAGING) {
    if (stall) { pa = xlateCode(la, CPL == 3); CKV(-1); attr = XPCD; }
    else {
      const int e = itlbFind(la);
      if (e < 0 || (CPL == 3 && !(ITFL[e] & 4))) return -1;
      pa = ITPHYS[e] | (la & 0xFFF); attr = ITFL[e] & 0x18;
    }
  }
  u32 k = 32 - (la & 31);
  if (k > 16) k = 16;
  if ((i64)hi - (i64)qip + 1 < (i64)k) k = hi - qip + 1;
  int i = iFind6(pa);
  if (i >= 0) { IC_HITS++; p686Touch(ILRU, i >> 2, i & 3); }
  else if (!(CR[0] & C0_CD) && !(attr & 0x10) && cacheable(pa)) {
    if (!stall && (double)room < fsbFirst()) return -2;
    IC_MISSES++;
    i = iFill6(pa, stall, attr);
  }
  if (i >= 0) {
    const int b = (i << 5) + (int)(pa & 31);
    u32 t = QT;
    for (u32 j = 0; j < k; j++) QB[t++] = IDATA[b + (int)j];
    QT = t;
    QIP = qip + k;
  } else {
    IC_MISSES++; IC_UNCACHED++;
    u32 w = 8 - (la & 7);
    if ((i64)hi - (i64)qip + 1 < (i64)w) w = hi - qip + 1;
    for (u32 j = 0; j < w; j++) QB[QT++] = (u8)rd8(pa + j);
    QIP = qip + w;
    const double f = fsbFirst();
    codeEv((u32)f, stall);
    CODELAT += f + fsbReq(); CODEBUS += f + fsbReq();
  }
  return 0;
}
// the model follows the clock (a halted CPU, the clocks that the machine adds)
static void oooSync(double t) {
  if (oS[O_DCLK] < t) { oS[O_DCLK] = t; oS[O_DSLOT] = 0; oS[O_DBYTES] = 0; }
  if (oS[O_FETCH] < t) oS[O_FETCH] = t;
  if (oS[O_ICLK] < t) { oS[O_ICLK] = t; oS[O_ICNT] = 0; }
  if (oS[O_RCLK] < t) { oS[O_RCLK] = t; oS[O_RCNT] = 0; }
  if (oS[O_PREV] < t) oS[O_PREV] = t;
}
// the address registers of the ModR/M memory operand (CPU80686.eaRegs)
static u32 eaRegs(u32 o, u32 a32v) {
  const u32 p = OPPOS + (o == 0x0F ? 1 : 0), m = IB[p & 15], md = m >> 6, r = m & 7;
  if (!a32v) return md == 0 && r == 6 ? 0 : EA16[r];
  if (r == 4) {
    const u32 sib = IB[(p + 1) & 15], base = sib & 7, idx = (sib >> 3) & 7;
    return (base == 5 && md == 0 ? 0 : 1u << base) | (idx == 4 ? 0 : 1u << idx);
  }
  return r == 5 && md == 0 ? 0 : 1u << r;
}

// ---------- descriptor caches (the lower limit can be 2^32: SLOX) ----------
#define SLOX (V + 134)
static void calcCache(int i) {
  const u32 a = SACC[i];
  if ((a & 0x1C) == 0x14) {
    SLOX[i] = SLIMIT[i] == 0xFFFFFFFFu;
    SLO[i] = SLIMIT[i] + 1; SHI[i] = SBIG[i] ? 0xFFFFFFFFu : 0xFFFF;
  } else { SLOX[i] = 0; SLO[i] = 0; SHI[i] = SLIMIT[i]; }
  if (!(CR[0] & 1) || (EFL & F_VM)) { SRD[i] = 1; SWR[i] = 1; }
  else if (a & 8) { SRD[i] = (a & 2) != 0; SWR[i] = 0; } else { SRD[i] = 1; SWR[i] = (a & 2) != 0; }
}
static void setCache(int i, u32 sel, u32 base, u32 limit, u32 access, u32 flags) {
  SBASE[i] = base; SLIMIT[i] = limit; SACC[i] = access; SFLAGS[i] = flags;
  SBIG[i] = (flags & 4) != 0;
  calcCache(i);
  SR[i] = (u16)sel;
}
static void setNull(int i, u32 sel) {
  SBASE[i] = 0; SLIMIT[i] = 0; SACC[i] = 0; SFLAGS[i] = 0; SBIG[i] = 0; SLOX[i] = 0; SLO[i] = 1; SHI[i] = 0; SRD[i] = 0; SWR[i] = 0;
  SR[i] = (u16)sel;
}
static void loadSegReal(int i, u32 sel) { SBASE[i] = sel << 4; SR[i] = (u16)sel; }
static void loadSegV86(int i, u32 sel) {
  SBASE[i] = sel << 4; SLIMIT[i] = 0xFFFF; SACC[i] = i == CS ? 0xFB : 0xF3; SFLAGS[i] = 0; SBIG[i] = 0;
  SLOX[i] = 0; SLO[i] = 0; SHI[i] = 0xFFFF; SRD[i] = 1; SWR[i] = 1;
  SR[i] = (u16)sel;
}

// ---------- the decode state of one instruction ----------
static i32 mod, seg;
static u32 reg, rm, eaSeg, eaOff, eaESP, rep, lock, osz, a32, op, noAC, cmpxOk;
static i32 op2;
static u32 trapBefore;
static void saveDec(void) {
  V[290] = op; V[291] = (u32)op2; V[292] = (u32)mod; V[293] = reg; V[294] = rm; V[295] = osz; V[296] = a32; V[297] = rep; V[298] = lock; V[299] = (u32)seg;
}
static void loadDec(void) {
  op = V[290]; op2 = (i32)V[291]; mod = (i32)V[292]; reg = V[293]; rm = V[294]; osz = V[295]; a32 = V[296]; rep = V[297]; lock = V[298]; seg = (i32)V[299];
}

static void segFault(int s) { fault(s == SS ? 12 : 13, 0); }
static int acOn(void) { return CPL == 3 && (CR[0] & C0_AM) && (EFL & F_AC) && !noAC; }
static int segBad(int s, u32 o, u32 n, int write) {
  return SLOX[s] || o < SLO[s] || (u64)o + n - 1 > SHI[s] || !(write ? SWR[s] : SRD[s]);
}

// ---------- the 80386 (CPU80386): the bus with no cache, the 32-entry TLB, the queue ----------
// The bus cycles of an n-byte access (CPU80386.memEv): an aligned word is one cycle, the other
// bytes are one cycle each (the 16-bit bus of the 386SX); a word that is not aligned costs 2 clocks.
static void memEv386(int type, u32 pa, u32 n) {
  if (n == 1) { busEv(type, 0); return; }
  if (!(pa & 1)) { busEv(type, 0); if (n == 4) busEv(type, 0); return; }
  CLK += 2;
  busEv(type, 0);
  busEv(type, 0);
  if (n == 4) busEv(type, 0);
}
static u32 rdPhysD386(u32 pa) {
  const u32 v = rd8(pa) | (rd8(pa + 1) << 8) | (rd8(pa + 2) << 16) | (rd8(pa + 3) << 24);
  memEv386(T_MEMR, pa, 4);
  return v;
}
static void wrPhysD386(u32 pa, u32 v) {
  wr8(pa, v & 0xFF); wr8(pa + 1, (v >> 8) & 0xFF); wr8(pa + 2, (v >> 16) & 0xFF); wr8(pa + 3, v >> 24);
  memEv386(T_MEMW, pa, 4);
}
// the page walk of the 386 (no WP, PCD, PWT)
static u32 walk386(u32 la, int write, int user) {
  T_MISSES++;
  const u32 dir = la >> 22, tbl = (la >> 12) & 0x3FF;
  const u32 pdeA = (CR[3] & 0xFFFFF000u) + dir * 4;
  const u32 pde = rdPhysD386(pdeA);
  const u32 err = (write ? 2u : 0u) | (user ? 4u : 0u);
  if (!(pde & 1)) { pageFault(la, err); return 0; }
  const u32 pteA = (pde & 0xFFFFF000u) + tbl * 4;
  const u32 pte = rdPhysD386(pteA);
  if (!(pte & 1)) { pageFault(la, err); return 0; }
  const u32 us = pde & pte & 4, rw = pde & pte & 2;
  if (user && (!us || (write && !rw))) { pageFault(la, err | 1); return 0; }
  if (!(pde & 0x20)) wrPhysD386(pdeA, pde | 0x20);
  const u32 npte = pte | 0x20 | (write ? 0x40u : 0u);
  if (npte != pte) wrPhysD386(pteA, npte);
  const u32 frame = pte & 0xFFFFF000u;
  tlbPut(la & 0xFFFFF000u, frame, us | rw | 0x21 | (npte & 0x40));
  return frame | (la & 0xFFF);
}
static u32 xlate386(u32 la, int write, int user) {
  const int e = tlbFind(la);
  if (e >= 0) {
    const u32 fl = TLBFL[e];
    if (user && (!(fl & 4) || (write && !(fl & 2)))) return walk386(la, write, user);
    if (!write || (fl & 0x40)) { T_HITS++; return TLBPHYS[e] | (la & 0xFFF); }
  }
  return walk386(la, write, user);
}
static u32 rdLin386(u32 la, u32 n, int user) {
  u32 pa = la;
  if (PAGING) {
    if ((la & 0xFFF) + n > 0x1000) {
      // both pages first, then one cycle for each byte
      const u32 k = 0x1000 - (la & 0xFFF);
      const u32 p0 = xlate386(la, 0, user); CKV(0);
      const u32 p1 = xlate386(la + k, 0, user); CKV(0);
      u32 v = 0;
      for (u32 i = 0; i < n; i++) { const u32 a = i < k ? p0 + i : p1 + i - k; v |= rd8(a) << (8 * i); busEv(T_MEMR, 0); }
      return v;
    }
    pa = xlate386(la, 0, user); CKV(0);
  }
  u32 v = rd8(pa);
  if (n > 1) { v |= rd8(pa + 1) << 8; if (n == 4) { v |= rd8(pa + 2) << 16; v |= rd8(pa + 3) << 24; } }
  memEv386(T_MEMR, pa, n);
  return v;
}
static void wrLin386(u32 la, u32 n, u32 v, int user) {
  u32 pa = la;
  if (PAGING) {
    if ((la & 0xFFF) + n > 0x1000) {
      const u32 k = 0x1000 - (la & 0xFFF);
      const u32 p0 = xlate386(la, 1, user); CK;
      const u32 p1 = xlate386(la + k, 1, user); CK;
      for (u32 i = 0; i < n; i++) { const u32 a = i < k ? p0 + i : p1 + i - k; wr8(a, (v >> (8 * i)) & 0xFF); busEv(T_MEMW, 0); }
      return;
    }
    pa = xlate386(la, 1, user); CK;
  }
  wr8(pa, v & 0xFF);
  if (n > 1) { wr8(pa + 1, (v >> 8) & 0xFF); if (n == 4) { wr8(pa + 2, (v >> 16) & 0xFF); wr8(pa + 3, v >> 24); } }
  memEv386(T_MEMW, pa, n);
}

// ---------- linear access (paging, then the cache) ----------
static u32 rdSplit(u32 la, u32 n, int user) {
  const u32 k = 0x1000 - (la & 0xFFF), la2 = la + k;
  const u32 p0 = xlate(la, 0, user); CKV(0);
  const u32 c0 = XPCD;
  const u32 p1 = xlate(la2, 0, user); CKV(0);
  const u32 c1 = XPCD;
  if (P5) { const u32 lo5 = PRD(p0, k, c0); return lo5 | (PRD(p1, n - k, c1) << (8 * k)); }
  const u32 lo = physRd(p0, k, c0);
  return lo | (physRd(p1, n - k, c1) << (8 * k));
}
// (P5) a write to the bytes in the prefetch queue empties the queue
static void smcCheck(u32 la, u32 n) {
  const u32 q = QT - QH, s0 = SBASE[CS] + QIP - q;
  if (la - s0 < q || s0 - la < n) { QH = 0; QT = 0; QIP = EIP; }
}
static void wrSplit(u32 la, u32 n, u32 v, int user) {
  const u32 k = 0x1000 - (la & 0xFFF), la2 = la + k;
  const u32 p0 = xlate(la, 1, user); CK;
  const u32 a0 = XPCD;
  const u32 p1 = xlate(la2, 1, user); CK;
  if (P5) {
    const u32 a1 = XPCD;
    PWR(p0, k, v & (0xFFFFFFFFu >> (32 - 8 * k)), a0);
    PWR(p1, n - k, v >> (8 * k), a1);
    if (QT > QH && QSNOOP) smcCheck(la, n);
    return;
  }
  physWr(p0, k, v & (0xFFFFFFFFu >> (32 - 8 * k)));
  physWr(p1, n - k, v >> (8 * k));
}
static u32 rdLin(u32 la, u32 n, int user) {
  if (I386) return rdLin386(la, n, user);
  u32 pa = la, pcd = 0;
  if (PAGING) {
    if ((la & 0xFFF) + n > 0x1000) return rdSplit(la, n, user);
    pa = xlate(la, 0, user); CKV(0);
    pcd = XPCD;
  }
  return P5 ? PRD(pa, n, pcd) : physRd(pa, n, pcd);
}
static void wrLin(u32 la, u32 n, u32 v, int user) {
  if (I386) { wrLin386(la, n, n == 4 ? v : v & MASK[n], user); return; }
  u32 pa = la, attr = 0;
  if (PAGING) {
    if ((la & 0xFFF) + n > 0x1000) { wrSplit(la, n, v, user); return; }
    pa = xlate(la, 1, user); CK;
    attr = XPCD;
  }
  if (P5) {
    PWR(pa, n, n == 4 ? v : v & MASK[n], attr);
    if (QT > QH && QSNOOP) smcCheck(la, n);
    return;
  }
  physWr(pa, n, n == 4 ? v : v & MASK[n]);
}
static void probe(u32 la, u32 n, int write, int user) {
  if (I386) { xlate386(la, write, user); CK; if ((la & 0xFFF) + n > 0x1000) xlate386((la | 0xFFF) + 1, write, user); return; }
  xlate(la, write, user); CK;
  if ((la & 0xFFF) + n > 0x1000) xlate((la | 0xFFF) + 1, write, user);
}
// segment access (s = the segment, o = the offset, n = 1, 2 or 4 bytes)
static u32 rd(int s, u32 o, u32 n) {
  if (segBad(s, o, n, 0)) { segFault(s); return 0; }
  const u32 la = SBASE[s] + o;
  if ((la & (n - 1)) && acOn()) { fault(17, 0); return 0; }
  if (P6) {
    const double a0 = ACCLAT, b0 = ACCBUS;
    const u32 v = rdLin(la, n, CPL == 3); CKV(0);
    const u32 k = NLD;
    if (k < MAXM) { ldAddr[k] = la; ldSize[k] = (u8)n; ldLat[k] = ACCLAT - a0; ldBus[k] = ACCBUS - b0; }
    NLD = k + 1;
    return v;
  }
  return rdLin(la, n, CPL == 3);
}
static void wr(int s, u32 o, u32 n, u32 v) {
  if (segBad(s, o, n, 1)) { segFault(s); return; }
  const u32 la = SBASE[s] + o;
  if ((la & (n - 1)) && acOn()) { fault(17, 0); return; }
  if (P6) {
    const double a0 = ACCLAT, b0 = ACCBUS;
    wrLin(la, n, v, CPL == 3); CK;
    const u32 k = NST;
    if (k < MAXM) { stAddr[k] = la; stSize[k] = (u8)n; stLat[k] = ACCLAT - a0; stBus[k] = ACCBUS - b0; }
    NST = k + 1;
    return;
  }
  wrLin(la, n, v, CPL == 3);
}
static void wrCheck(int s, u32 o, u32 n) {
  if (segBad(s, o, n, 1)) { segFault(s); return; }
  if (PAGING) probe(SBASE[s] + o, n, 1, CPL == 3);
}
static u32 rdSysD(u32 a) { return rdLin(a, 4, 0); }
static void wrSysB(u32 a, u32 v) { wrLin(a, 1, v, 0); }

// ---------- stack ----------
static u32 getSP(void) { return SBIG[SS] ? R[4] : R[4] & 0xFFFF; }
static void setSP(u32 v) { if (SBIG[SS]) R[4] = v; else R[4] = (R[4] & 0xFFFF0000u) | (v & 0xFFFF); }
static u32 stackOff(u32 k) { return SBIG[SS] ? R[4] + k : (R[4] + k) & 0xFFFF; }
static void push(u32 v, u32 s) {
  if (SBIG[SS]) { const u32 sp = R[4] - s; wr(SS, sp, s, v); CK; R[4] = sp; }
  else { const u32 sp = (R[4] - s) & 0xFFFF; wr(SS, sp, s, v); CK; R[4] = (R[4] & 0xFFFF0000u) | sp; }
}
static u32 pop(u32 s) {
  if (SBIG[SS]) { const u32 v = rd(SS, R[4], s); CKV(0); R[4] = R[4] + s; return v; }
  const u32 sp = R[4] & 0xFFFF, v = rd(SS, sp, s); CKV(0);
  R[4] = (R[4] & 0xFFFF0000u) | ((sp + s) & 0xFFFF);
  return v;
}
static u32 peekStack(u32 k, u32 s) { return rd(SS, stackOff(k), s); }

// ---------- the prefetch queue of the 486 (32 bytes; 16-byte lines from the cache) ----------
static void flush(void) { QH = 0; QT = 0; QIP = EIP; DIDFLUSH = 1; }
static void qCompact(void) {
  const u32 h = QH;
  if (!h) return;
  const u32 n = QT - h;
  for (u32 i = 0; i < n; i++) QB[i] = QB[h + i];
  QH = 0; QT = n;
}
// CPU80386.prefetch: one bus cycle (an aligned word or one byte); 0 = it cannot fetch
static int prefetch386(int stall) {
  const u32 qip = QIP, hi = SHI[CS];
  if (!stall && qip > hi) return 0;
  const u32 la = SBASE[CS] + qip;
  u32 pa = la;
  if (PAGING) {
    if (stall) { pa = xlate386(la, 0, CPL == 3); CKV(0); }
    else {
      const int e = tlbFind(la);
      if (e < 0 || (CPL == 3 && !(TLBFL[e] & 4))) return 0;
      pa = TLBPHYS[e] | (la & 0xFFF);
    }
  }
  if (QT > 112) qCompact();
  if (!(la & 1) && qip < hi) {
    const u32 b0 = rd8(pa), b1 = rd8(pa + 1);
    QB[QT++] = (u8)b0; QB[QT++] = (u8)b1;
    QIP = qip + 2;
  } else { QB[QT++] = (u8)rd8(pa); QIP = qip + 1; }
  ST_FETCH++;
  return 1;
}
// returns the bus clocks it used, -1 (cannot fetch), -2 (does not fit in room)
static i32 prefetch(int stall, i32 room) {
  const u32 qip = QIP, hi = SHI[CS];
  if (!stall && qip > hi) return -1;
  if (QT > 112) qCompact();
  const u32 la = SBASE[CS] + qip;
  u32 pa = la, pcd = 0;
  if (PAGING) {
    if (stall) { pa = xlate(la, 0, CPL == 3); CKV(-1); pcd = XPCD; }
    else {
      const int e = tlbFind(la);
      if (e < 0 || (CPL == 3 && !(TLBFL[e] & 4))) return -1;
      pa = TLBPHYS[e] | (la & 0xFFF); pcd = TLBFL[e] & 0x10;
    }
  }
  u32 k = 16 - (la & 15);
  if ((i64)hi - (i64)qip + 1 < (i64)k) k = hi - qip + 1;
  int i = cacheFind(pa);
  i32 used = 0;
  const int hit = i >= 0;
  if (!hit && !(CR[0] & C0_CD) && !pcd && cacheable(pa)) {
    used = (i32)fillTime();
    if (!stall && used > room) return -2;
    C_MISSES++;
    i = cacheFill(pa, 1, stall);
  } else if (hit) { C_HITS++; lruTouch(i); }
  if (i >= 0) {
    const int b = i * 16 + (int)(pa & 15);
    u32 t = QT;
    for (u32 j = 0; j < k; j++) QB[t++] = CDATA[b + (int)j];
    QT = t;
    QIP = qip + k;
  } else {
    if (!stall && (i32)BUSLEN > room) return -2;
    C_MISSES++; C_UNCACHED++;
    u32 width;
    if (!(la & 1) && qip < hi) {
      const u32 b0 = rd8(pa), b1 = rd8(pa + 1);
      QB[QT++] = (u8)b0; QB[QT++] = (u8)b1; width = 2;
    } else { QB[QT++] = (u8)rd8(pa); width = 1; }
    QIP = qip + width;
    codeEv(BUSLEN, stall);
    used = (i32)BUSLEN;
  }
  return used;
}
static i32 prefetch5(int stall, i32 room) {
  const u32 qip = QIP, hi = SHI[CS];
  if (!stall && qip > hi) return -1;
  if (QT > 96) qCompact();
  const u32 la = SBASE[CS] + qip;
  u32 pa = la, attr = 0;
  if (PAGING) {
    if (stall) { pa = xlateCode(la, CPL == 3); CKV(-1); attr = XPCD; }
    else {
      const int e = itlbFind(la);
      if (e < 0 || (CPL == 3 && !(ITFL[e] & 4))) return -1;
      pa = ITPHYS[e] | (la & 0xFFF); attr = ITFL[e] & 0x18;
    }
  }
  u32 k = 32 - (la & 31);
  if (k > 16) k = 16;
  if ((i64)hi - (i64)qip + 1 < (i64)k) k = hi - qip + 1;
  const int i0 = (int)((pa >> 5) & 127) << 1;
  const i32 tag = (i32)(pa >> 12);
  int i = ITAG[i0] == tag ? i0 : ITAG[i0 + 1] == tag ? i0 + 1 : -1;
  i32 used = 0;
  if (i >= 0) { IC_HITS++; ILRU[i0 >> 1] = (u8)((i & 1) ^ 1); }
  else if (!(CR[0] & C0_CD) && !(attr & 0x10) && !(TR12 & TR12_CI) && cacheable(pa)) {
    used = (i32)fillTime5();
    if (!stall && used > room) return -2;
    IC_MISSES++;
    i = iFill(pa, stall);
  }
  if (i >= 0) {
    const int b = (i << 5) + (int)(pa & 31);
    u32 t = QT;
    for (u32 j = 0; j < k; j++) QB[t++] = IDATA[b + (int)j];
    QT = t;
    QIP = qip + k;
  } else {
    if (!stall && (i32)BUSLEN > room) return -2;
    IC_MISSES++; IC_UNCACHED++;
    u32 w = 8 - (la & 7);
    if ((i64)hi - (i64)qip + 1 < (i64)w) w = hi - qip + 1;
    for (u32 j = 0; j < w; j++) QB[QT++] = (u8)rd8(pa + j);
    QIP = qip + w;
    codeEv(BUSLEN, stall);
    used = (i32)BUSLEN;
  }
  return used;
}
static u32 fetch(void) {
  const u32 ip = EIP;
  if (ip > SHI[CS] || ++ILEN > 15) { fault(13, 0); return 0; }
  if (QH >= QT) {
    QH = 0; QT = 0;
    if (I386) { NSTALL++; prefetch386(1); }
    else if (P6) prefetch6(1, 0); else if (P5) prefetch5(1, 0); else prefetch(1, 0);
    CKV(0);
  }
  const u32 b = QB[QH++];
  EIP = ip + 1;
  if (P5) IB[ILEN - 1] = (u8)b;
  return b;
}
static u32 fetchW(void) { const u32 lo = fetch(); CKV(0); return lo | (fetch() << 8); }
static u32 fetchD(void) { const u32 lo = fetchW(); CKV(0); return lo | (fetchW() << 16); }
static i32 fetchS8(void) { return (i32)(i8)fetch(); }
static u32 fetchImm(u32 s) { return s == 1 ? fetch() : s == 2 ? fetchW() : fetchD(); }

// ---------- ModR/M and SIB ----------
static void calcEA(void) {
  u32 off, sg = DS;
  const u32 bx = R[3] & 0xFFFF, bp = R[5] & 0xFFFF, si = R[6] & 0xFFFF, di = R[7] & 0xFFFF;
  switch (rm) {
    case 0: off = bx + si; break;
    case 1: off = bx + di; break;
    case 2: off = bp + si; sg = SS; break;
    case 3: off = bp + di; sg = SS; break;
    case 4: off = si; break;
    case 5: off = di; break;
    case 6: if (mod == 0) { off = fetchW(); CK; } else { off = bp; sg = SS; } break;
    default: off = bx;
  }
  if (mod == 1) { const i32 d = fetchS8(); CK; off += (u32)d; }
  else if (mod == 2) { const u32 d = fetchW(); CK; off += d; }
  if (seg >= 0) sg = (u32)seg;
  eaOff = off & 0xFFFF; eaSeg = sg;
}
static void calcEA32(void) {
  u32 off, sg = DS;
  if (rm == 4) {
    const u32 sib = fetch(); CK;
    const u32 sc = sib >> 6, idx = (sib >> 3) & 7, base = sib & 7;
    if (base == 5 && mod == 0) { off = fetchD(); CK; }
    else { off = R[base]; if (base == 4 || base == 5) sg = SS; eaESP = base == 4; }
    if (idx != 4) off += R[idx] * (1u << sc);
    else if (sc && !(base == 5 && mod == 0)) off *= 1u << sc;
    CLK++;
  } else if (rm == 5 && mod == 0) { off = fetchD(); CK; }
  else { off = R[rm]; if (rm == 5) sg = SS; }
  if (mod == 1) { const i32 d = fetchS8(); CK; off += (u32)d; }
  else if (mod == 2) { const u32 d = fetchD(); CK; off += d; }
  if (seg >= 0) sg = (u32)seg;
  eaOff = off; eaSeg = sg;
}
static void modrm(void) {
  const u32 m = fetch(); CK;
  mod = (i32)(m >> 6); reg = (m >> 3) & 7; rm = m & 7; eaESP = 0;
  if (mod != 3) { if (a32) calcEA32(); else calcEA(); }
}
static u32 addA(u32 o, u32 k) { return a32 ? o + k : (o + k) & 0xFFFF; }
static u32 rget(u32 i, u32 s) {
  if (s == 4) return R[i];
  if (s == 2) return R[i] & 0xFFFF;
  return i & 4 ? (R[i & 3] >> 8) & 0xFF : R[i] & 0xFF;
}
static void rset(u32 i, u32 s, u32 v) {
  if (s == 4) R[i] = v;
  else if (s == 2) R[i] = (R[i] & 0xFFFF0000u) | (v & 0xFFFF);
  else if (i & 4) { const u32 k = i & 3; R[k] = (R[k] & 0xFFFF00FFu) | ((v & 0xFF) << 8); }
  else R[i] = (R[i] & 0xFFFFFF00u) | (v & 0xFF);
}
static u32 getE(u32 s) { return mod == 3 ? rget(rm, s) : rd((int)eaSeg, eaOff, s); }
static void setE(u32 s, u32 v) { if (mod == 3) rset(rm, s, v); else wr((int)eaSeg, eaOff, s, v); }
static u32 getG(u32 s) { return rget(reg, s); }
static void setG(u32 s, u32 v) { rset(reg, s, v); }
static void rc(u32 r, u32 m) { CLK += mod == 3 ? r : m; }
static int memOnly(void) { if (mod == 3) { fault(6, -1); return 1; } return 0; }
static int lockCheck(int ok) { if (lock && (mod == 3 || !ok)) { fault(6, -1); return 1; } return 0; }
static u32 sx(u32 v, u32 s) { return s == 4 ? v : s == 2 ? (u32)(i32)(i16)v : (u32)(i32)(i8)v; }

// ---------- flags / ALU ----------
static void szpS(u32 r, u32 s) {
  u32 f = EFL & ~(F_SF | F_ZF | F_PF);
  if (!(r & MASK[s])) f |= F_ZF;
  if (r & SIGN[s]) f |= F_SF;
  if (PARITY[r & 0xFF]) f |= F_PF;
  EFL = f;
}
static u32 addS(u32 a, u32 b, u32 c, u32 s) {
  const u64 r64 = (u64)a + b + c;
  const u32 r = (u32)r64;
  u32 f = EFL & ~(F_CF | F_AF | F_OF);
  if (r64 > MASK[s]) f |= F_CF;
  if ((a ^ b ^ r) & 0x10) f |= F_AF;
  if ((a ^ r) & (b ^ r) & SIGN[s]) f |= F_OF;
  EFL = f; szpS(r, s);
  return s == 4 ? r : r & MASK[s];
}
static u32 subS(u32 a, u32 b, u32 c, u32 s) {
  const i64 r64 = (i64)a - (i64)b - (i64)c;
  const u32 r = (u32)r64;
  u32 f = EFL & ~(F_CF | F_AF | F_OF);
  if (r64 < 0) f |= F_CF;
  if ((a ^ b ^ r) & 0x10) f |= F_AF;
  if ((a ^ b) & (a ^ r) & SIGN[s]) f |= F_OF;
  EFL = f; szpS(r, s);
  return s == 4 ? r : r & MASK[s];
}
static u32 logicS(u32 r, u32 s) { EFL &= ~(F_CF | F_AF | F_OF); r = s == 4 ? r : r & MASK[s]; szpS(r, s); return r; }
static u32 aluS(u32 o, u32 a, u32 b, u32 s) {
  switch (o) {
    case 0: return addS(a, b, 0, s);
    case 1: return logicS(a | b, s);
    case 2: return addS(a, b, EFL & F_CF, s);
    case 3: return subS(a, b, EFL & F_CF, s);
    case 4: return logicS(a & b, s);
    case 5: case 7: return subS(a, b, 0, s);
    default: return logicS(a ^ b, s);
  }
}
static u32 shiftS(u32 o, u32 v, u32 n, u32 s) {
  if (!n) return v;
  const u32 bits = s * 8, m = MASK[s], sb = SIGN[s], a0 = v;
  u32 cf = EFL & F_CF;
  for (u32 i = 0; i < n; i++) {
    switch (o) {
      case 0: cf = (v & sb) ? 1 : 0; v = ((v << 1) | cf) & m; break;
      case 1: cf = v & 1; v = (v >> 1) | (cf ? sb : 0); break;
      case 2: { const u32 c = (v & sb) ? 1 : 0; v = ((v << 1) | cf) & m; cf = c; break; }
      case 3: { const u32 c = v & 1; v = (v >> 1) | (cf ? sb : 0); cf = c; break; }
      case 4: case 6: cf = (v & sb) ? 1 : 0; v = (v << 1) & m; break;
      case 5: cf = v & 1; v >>= 1; break;
      default: cf = v & 1; v = (v >> 1) | (v & sb); break;
    }
  }
  if (n > bits && (o == 4 || o == 5 || o == 6)) cf = n % bits ? 0 : o == 5 ? (a0 >> (bits - 1)) & 1 : a0 & 1;
  u32 f = (EFL & ~(F_CF | F_OF)) | cf;
  if (o < 4) {
    if (o == 0 || o == 2) { if (((v & sb) ? 1 : 0) ^ cf) f |= F_OF; }
    else if ((v ^ (v << 1)) & sb) f |= F_OF;
    EFL = f;
  } else {
    if (o == 4 || o == 6) { if (((v & sb) ? 1 : 0) ^ cf) f |= F_OF; }
    else if (o == 5) { if (n == 1 ? a0 & sb : 0) f |= F_OF; }
    EFL = f;
    szpS(v, s);
    EFL &= ~F_AF;
  }
  return v;
}
static int cond(u32 c) {
  const u32 f = EFL;
  int r;
  switch (c >> 1) {
    case 0: r = !!(f & F_OF); break;
    case 1: r = !!(f & F_CF); break;
    case 2: r = !!(f & F_ZF); break;
    case 3: r = !!(f & (F_CF | F_ZF)); break;
    case 4: r = !!(f & F_SF); break;
    case 5: r = !!(f & F_PF); break;
    case 6: r = !!(f & F_SF) != !!(f & F_OF); break;
    default: r = (!!(f & F_SF) != !!(f & F_OF)) || !!(f & F_ZF); break;
  }
  return r != (int)(c & 1);
}
static void jump(u32 t, u32 s) {
  t = s == 2 ? t & 0xFFFF : t;
  if (t > SHI[CS]) { fault(13, 0); return; }
  EIP = t; flush();
}

// ---------- I/O (the machine brings the devices up to date in its bus functions) ----------
static u32 inb(u32 p) { const u32 v = jin8(p) & 0xFF; busEv(T_IOR, busLenDef()); return v; }
static void outb(u32 p, u32 v) { jout8(p, v & 0xFF); busEv(T_IOW, busLenDef()); }
static u32 inw(u32 p) {
  if (!(p & 1)) { const u32 v = jin16(p) & 0xFFFF; busEv(T_IOR, busLenDef()); return v; }
  CLK += 2;
  const u32 lo = inb(p);
  return lo | (inb((p + 1) & 0xFFFF) << 8);
}
static void outw(u32 p, u32 v) {
  if (!(p & 1)) { jout16(p, v & 0xFFFF); busEv(T_IOW, busLenDef()); return; }
  CLK += 2;
  outb(p, v); outb((p + 1) & 0xFFFF, (v >> 8) & 0xFF);
}
static u32 ioIn(u32 p, u32 s) {
  if (s == 1) return inb(p);
  if (s == 2) return inw(p);
  const u32 lo = inw(p);
  return lo | (inw((p + 2) & 0xFFFF) << 16);
}
static void ioOut(u32 p, u32 s, u32 v) {
  if (s == 1) outb(p, v);
  else if (s == 2) outw(p, v);
  else { outw(p, v & 0xFFFF); outw((p + 2) & 0xFFFF, v >> 16); }
}
static u32 iopl(void) { return (EFL >> 12) & 3; }
// (the protected-mode cases that read the TSS bitmap go to JavaScript: see needJS)
static int ioCheck(void) {
  if (!(CR[0] & 1)) return 0;
  if (EFL & F_VM ? iopl() < 3 : CPL > iopl()) { fault(13, 0); return 1; }
  return 0;
}
static int v86Check(void) { if ((EFL & F_VM) && iopl() < 3) { fault(13, 0); return 1; } return 0; }

// ---------- protected-mode segment loads (data segments and SS) ----------
typedef struct { u32 addr, limit, base, access, flags; } Desc;
static int readDesc(u32 sel, Desc *d) {
  u32 tb, tl;
  if (sel & 4) { if (!LDTVALID) return 0; tb = LDTB; tl = LDTL; }
  else { tb = GDTB; tl = GDTL; }
  if ((sel | 7) > tl) return 0;
  const u32 a = tb + (sel & 0xFFF8);
  const u32 lo = rdSysD(a); CKV(0);
  const u32 hi = rdSysD(a + 4); CKV(0);
  const u32 access = (hi >> 8) & 0xFF, flags = (hi >> 20) & 0xF;
  u32 limit = (lo & 0xFFFF) | (hi & 0xF0000);
  if (flags & 8) limit = (limit << 12) | 0xFFF;
  d->addr = a; d->limit = limit; d->base = (lo >> 16) | ((hi & 0xFF) << 16) | (hi & 0xFF000000u);
  d->access = access; d->flags = flags;
  return 1;
}
static int desc(u32 sel, i32 vec, Desc *d) {
  const int ok = readDesc(sel, d); CKV(0);
  if (!ok) { fsel(vec, sel); return 0; }
  return 1;
}
static void setAccessed(Desc *d) {
  if ((d->access & 0x10) && !(d->access & 1)) { d->access |= 1; wrSysB(d->addr + 5, d->access); }
}
static void loadDataSeg(int i, u32 sel) {
  if (!(sel & 0xFFFC)) { setNull(i, sel); return; }
  Desc d;
  if (!desc(sel, 13, &d)) return;
  const u32 a = d.access, rpl = sel & 3, dpl = (a >> 5) & 3;
  if (!(a & 0x10) || (a & 0x0A) == 0x08) { fsel(13, sel); return; }
  if ((a & 0x0C) != 0x0C && (CPL > rpl ? CPL : rpl) > dpl) { fsel(13, sel); return; }
  if (!(a & 0x80)) { fsel(11, sel); return; }
  setAccessed(&d); CK;
  setCache(i, sel, d.base, d.limit, d.access, d.flags);
}
static void loadSS(u32 sel) {
  if (!(sel & 0xFFFC)) { fault(13, (i32)EXT); return; }
  Desc d;
  if (!desc(sel, 13, &d)) return;
  const u32 a = d.access;
  if ((sel & 3) != CPL || ((a >> 5) & 3) != CPL || (a & 0x1A) != 0x12) { fsel(13, sel); return; }
  if (!(a & 0x80)) { fsel(12, sel); return; }
  setAccessed(&d); CK;
  setCache(SS, sel, d.base, d.limit, d.access, d.flags);
}
// (CS is never loaded here: the far transfers go to JavaScript)
static void loadSeg(int i, u32 sel) {
  sel &= 0xFFFF;
  if (!(CR[0] & 1)) { loadSegReal(i, sel); return; }
  if (EFL & F_VM) { loadSegV86(i, sel); return; }
  if (i == SS) loadSS(sel);
  else loadDataSeg(i, sel);
}

// ---------- instruction helpers ----------
static void popSeg(int i) {
  const u32 S = osz, big = SBIG[SS], v = peekStack(0, 2); CK;
  const u32 nsp = big ? R[4] + S : (R[4] & 0xFFFF0000u) | ((R[4] + S) & 0xFFFF);
  loadSeg(i, v); CK;
  R[4] = nsp;
  CLK += (CR[0] & 1) && !(EFL & F_VM) ? 21 : 7;
  if (i == SS) INHIBIT = 1;
}
static u32 imulS(i32 a, i32 b, u32 s) {
  const i64 p = (i64)a * (i64)b;
  u32 lo; int of;
  if (s == 4) { lo = (u32)p; of = p != (i64)(i32)lo; }
  else { lo = (u32)p & MASK[s]; of = p != (i64)(i32)sx(lo, s); }
  EFL = of ? EFL | F_CF | F_OF : EFL & ~(F_CF | F_OF);
  szpS(lo, s); EFL &= ~F_AF;
  return lo;
}
static void shiftGroup(u32 o) {
  const u32 s = o & 1 ? osz : 1;
  modrm(); CK;
  const int one = o == 0xD0 || o == 0xD1;
  u32 n;
  if (one) n = 1; else if (o >= 0xD2) n = R[1] & 0xFF; else { n = fetch(); CK; }
  n &= 0x1F;
  const u32 v = getE(s); CK;
  if (n) { const u32 r = shiftS(reg, v, n, s); setE(s, r); CK; }
  rc(3, 7);
}
static void group3(u32 s) {
  modrm(); CK;
  const u32 m = MASK[s];
  if (lockCheck(reg == 2 || reg == 3)) return;
  const u32 v = getE(s); CK;
  switch (reg) {
    case 0: case 1: { const u32 b = fetchImm(s); CK; logicS(v & b, s); rc(2, 5); return; }
    case 2: { const u32 r = s == 4 ? ~v : ~v & m; setE(s, r); CK; rc(2, 6); return; }
    case 3: { const u32 r = subS(0, v, 0, s); setE(s, r); CK; rc(2, 6); return; }
    case 4: case 5: {
      const u32 a0 = rget(0, s);
      u32 lo, hi; int of;
      if (reg == 4) {
        if (s == 4) { const u64 p = (u64)R[0] * v; lo = (u32)p; hi = (u32)(p >> 32); R[0] = lo; R[2] = hi; }
        else if (s == 2) { const u32 r = (R[0] & 0xFFFF) * v; lo = r & 0xFFFF; hi = r >> 16; rset(0, 2, lo); rset(2, 2, hi); }
        else { const u32 r = (R[0] & 0xFF) * v; lo = r & 0xFF; hi = r >> 8; rset(0, 2, r); }
        of = hi != 0;
      } else if (s == 4) {
        const i64 p = (i64)(i32)R[0] * (i64)(i32)v;
        lo = (u32)p; hi = (u32)((u64)p >> 32);
        R[0] = lo; R[2] = hi;
        of = p != (i64)(i32)lo;
      } else {
        const i32 p = (i32)sx(a0, s) * (i32)sx(v, s);
        lo = (u32)p & m; hi = (u32)(s == 2 ? p >> 16 : p >> 8) & m;
        if (s == 2) { rset(0, 2, lo); rset(2, 2, hi); } else rset(0, 2, (u32)p & 0xFFFF);
        of = p != (i32)sx(lo, s);
      }
      EFL = of ? EFL | F_CF | F_OF : EFL & ~(F_CF | F_OF);
      szpS(lo, s); EFL &= ~F_AF;
      rc(s == 4 ? 38 : s == 2 ? 22 : 14, s == 4 ? 41 : s == 2 ? 25 : 17);
      return;
    }
    default: {
      const int sgn = reg == 7;
      rc(s == 4 ? 38 : s == 2 ? 22 : 14, s == 4 ? 41 : s == 2 ? 25 : 17);
      if (sgn) CLK += 5;
      if (v == 0) { fault(0, -1); return; }
      if (s == 4) {
        const u64 num = ((u64)R[2] << 32) | R[0];
        if (!sgn) {
          const u64 bq = num / v;
          if (bq > 0xFFFFFFFFull) { fault(0, -1); return; }
          R[0] = (u32)bq; R[2] = (u32)(num % v);
        } else {
          const i64 sn = (i64)num, d = (i64)(i32)v;
          if (sn == (i64)0x8000000000000000ull && d == -1) { fault(0, -1); return; }
          const i64 bq = sn / d;
          if (bq > 0x7FFFFFFFll || bq < -0x80000000ll) { fault(0, -1); return; }
          R[0] = (u32)bq; R[2] = (u32)(sn % d);
        }
      } else if (!sgn) {
        const u32 num = s == 2 ? (R[2] & 0xFFFF) * 65536u + (R[0] & 0xFFFF) : R[0] & 0xFFFF;
        const u32 q = num / v, rem = num % v;
        if (q > m) { fault(0, -1); return; }
        if (s == 2) { rset(0, 2, q); rset(2, 2, rem); } else rset(0, 2, q | (rem << 8));
      } else {
        const i64 num = s == 2 ? (i64)(i32)(((R[2] & 0xFFFF) << 16) | (R[0] & 0xFFFF)) : (i64)(i32)sx(R[0], 2);
        const i64 d = (i64)(i32)sx(v, s);
        i64 q = num / d, rem = num - q * d;
        const i64 lim = s == 2 ? 0x8000 : 0x80;
        if (q > lim - 1 || q < -lim) {
          const i64 a = num < 0 ? -num : num, b = d < 0 ? -d : d, r = a - lim * (b + lim);
          if ((num < 0) == (d < 0) || r < 0 || r >= b) { fault(0, -1); return; }
          q = -lim; rem = num < 0 ? -r : r;
        }
        if (s == 2) { rset(0, 2, (u32)q); rset(2, 2, (u32)rem); } else rset(0, 2, ((u32)q & 0xFF) | (((u32)rem & 0xFF) << 8));
      }
    }
  }
}
static void group45(u32 o) {
  const u32 S = osz, s = o & 1 ? S : 1;
  modrm(); CK;
  if ((!(o & 1) && reg > 1) || reg == 7) { fault(6, -1); return; }
  if (lockCheck(reg < 2)) return;
  switch (reg) {
    case 0: case 1: {
      const u32 v = getE(s); CK;
      const u32 cf = EFL & F_CF;
      const u32 r = reg == 0 ? addS(v, 1, 0, s) : subS(v, 1, 0, s);
      EFL = (EFL & ~F_CF) | cf;
      setE(s, r); CK;
      rc(2, 6); return;
    }
    case 2: { const u32 t = getE(S); CK; push(EIP, S); CK; jump(t, S); CK; rc(7, 10); return; }
    case 4: { const u32 t = getE(S); CK; jump(t, S); CK; rc(7, 10); return; }
    case 6: { const u32 v = getE(S); CK; push(v, S); CK; rc(2, 5); return; }
    default: fault(6, -1); return;   // (reg 3 and 5 go to JavaScript)
  }
}
static void enter(void) {
  const u32 S = osz, size = fetchW(); CK;
  const u32 level = fetch() & 0x1F; CK;
  const u32 big = SBIG[SS];
  push(R[5], S); CK;
  const u32 frame = getSP();
  if (level > 0) {
    u32 bp = big ? R[5] : R[5] & 0xFFFF;
    for (u32 i = 1; i < level; i++) {
      bp = big ? bp - S : (bp - S) & 0xFFFF;
      const u32 v = rd(SS, bp, S); CK;
      push(v, S); CK;
    }
    push(frame, S); CK;
  }
  rset(5, S, frame);
  setSP(getSP() - size);
  CLK += level == 0 ? 10 : level == 1 ? 12 : 15 + 4 * (level - 1);
}
// P486_STR: [clocks without REP, REP start, clocks for each iteration]
static int strClk(u32 k, int *t) {
  switch (k) {
    case 0xA4: t[0] = 7; t[1] = 12; t[2] = 3; return 1;
    case 0xA6: t[0] = 8; t[1] = 7; t[2] = 7; return 1;
    case 0xAA: t[0] = 5; t[1] = 7; t[2] = 4; return 1;
    case 0xAC: t[0] = 5; t[1] = 7; t[2] = 4; return 1;
    case 0xAE: t[0] = 6; t[1] = 7; t[2] = 5; return 1;
    case 0x6C: t[0] = 17; t[1] = 16; t[2] = 8; return 1;
    case 0x6E: t[0] = 17; t[1] = 17; t[2] = 5; return 1;
    default: return 0;
  }
}
static void adv(u32 i, u32 v, i32 d) { if (a32) R[i] = v + (u32)d; else R[i] = (R[i] & 0xFFFF0000u) | ((v + (u32)d) & 0xFFFF); }
// the 80386 string instruction, then the 80486 clocks (CPU80486.stringOp)
static void stringOp386(u32 o, int first) {
  const u32 s = o & 1 ? osz : 1;
  const i32 d = (EFL & F_DF) ? -(i32)s : (i32)s;
  const int src = seg >= 0 ? seg : DS;
  const u32 kind = o & 0xFE;
  if (rep && first) {
    CLK += 5;
    if ((a32 ? R[1] : R[1] & 0xFFFF) == 0) { REPACT = 0; return; }
  }
  const u32 si = a32 ? R[6] : R[6] & 0xFFFF, di = a32 ? R[7] : R[7] & 0xFFFF;
  switch (kind) {
    case 0x6C: { const u32 v = ioIn(R[2] & 0xFFFF, s); CK; wr(ES, di, s, v); CK; adv(7, di, d); CLK += 15; break; }
    case 0x6E: { const u32 v = rd(src, si, s); CK; ioOut(R[2] & 0xFFFF, s, v); CK; adv(6, si, d); CLK += 14; break; }
    case 0xA4: { const u32 v = rd(src, si, s); CK; wr(ES, di, s, v); CK; adv(6, si, d); adv(7, di, d); CLK += rep ? 4 : 7; break; }
    case 0xA6: {
      const u32 a = rd(src, si, s); CK;
      const u32 b = rd(ES, di, s); CK;
      subS(a, b, 0, s);
      adv(6, si, d); adv(7, di, d); CLK += rep ? 9 : 10; break;
    }
    case 0xAA: wr(ES, di, s, rget(0, s)); CK; adv(7, di, d); CLK += rep ? 5 : 4; break;
    case 0xAC: { const u32 v = rd(src, si, s); CK; rset(0, s, v); adv(6, si, d); CLK += 5; break; }
    case 0xAE: {
      const u32 a = rget(0, s), b = rd(ES, di, s); CK;
      subS(a, b, 0, s);
      adv(7, di, d); CLK += rep ? 8 : 7; break;
    }
  }
  if (!rep) { REPACT = 0; return; }
  const u32 c = a32 ? R[1] - 1 : (R[1] - 1) & 0xFFFF;
  if (a32) R[1] = c; else rset(1, 2, c);
  int more = c != 0;
  if (more && (kind == 0xA6 || kind == 0xAE)) {
    const int zf = (EFL & F_ZF) != 0;
    more = rep == 2 ? zf : !zf;
  }
  if (more) {
    const u32 start = REPACT ? REP_START : LASTIP;
    REPACT = 1; REPOP = o; REPSEG = (u32)seg; REPREP = rep; REP_START = start; REPOSZ = osz; REPA32 = a32;
  } else REPACT = 0;
}
static void stringOp(u32 o, int first) {
  if (I386) { stringOp386(o, first); return; }
  if (P6) { STRCONT = !first; stringOp386(o, first); CK; EXECOK = 1; return; }
  const u32 c0 = CLK;
  const int zero = rep && first && (a32 ? R[1] : R[1] & 0xFFFF) == 0;
  stringOp386(o, first); CK;
  int t[3];
  if (strClk(o & 0xFE, t)) CLK = c0 + (u32)(!rep ? t[0] : zero ? 5 : (first ? t[1] : 0) + t[2]);
  if (P5) {
    // P586_STR: [clocks without REP, REP start, clocks for each iteration]
    int q[3] = { 0, 0, 0 }, has = 1;
    switch (o & 0xFE) {
      case 0xA4: q[0] = 4; q[1] = 13; q[2] = 1; break;
      case 0xA6: q[0] = 5; q[1] = 9; q[2] = 4; break;
      case 0xAA: q[0] = 3; q[1] = 9; q[2] = 1; break;
      case 0xAC: q[0] = 2; q[1] = 7; q[2] = 3; break;
      case 0xAE: q[0] = 4; q[1] = 9; q[2] = 4; break;
      case 0x6C: q[0] = 9; q[1] = 11; q[2] = 3; break;
      case 0x6E: q[0] = 13; q[1] = 13; q[2] = 4; break;
      default: has = 0;
    }
    if (has) CLK = c0 + (u32)(!rep ? q[0] : zero ? 6 : (first ? q[1] : 0) + q[2]);
    EXECOK = 1;
  }
}
static void daa386(int sub) {
  const u32 old = R[0] & 0xFF, ocf = EFL & F_CF;
  i32 al = (i32)old;
  u32 f = EFL & ~(F_CF | F_AF);
  if ((old & 0x0F) > 9 || (EFL & F_AF)) {
    al = sub ? al - 6 : al + 6;
    if (al < 0 || al > 0xFF) f |= F_CF;
    f |= F_AF;
  }
  if (old > 0x99 || ocf) { al = sub ? al - 0x60 : al + 0x60; f |= F_CF; }
  al &= 0xFF;
  EFL = f;
  rset(0, 1, (u32)al); szpS((u32)al, 1);
  if (sub ? (old & 0x80) && !(al & 0x80) : !(old & 0x80) && (al & 0x80)) EFL |= F_OF; else EFL &= ~F_OF;
  CLK += 4;
}
static void aaa386(int sub) {
  const u32 old = R[0] & 0xFF;
  if ((old & 0x0F) > 9 || (EFL & F_AF)) {
    const u32 ax = R[0] & 0xFFFF;
    rset(0, 2, sub ? ((ax - 6) & 0xFFFF) - 0x100 : ax + 0x106);
    EFL |= F_AF | F_CF;
  } else EFL &= ~(F_AF | F_CF);
  rset(0, 1, R[0] & 0x0F);
  szpS(old, 1);
  CLK += 4;
}
static void bitOp(int kind, int imm) {
  const u32 S = osz, bits = S * 8;
  modrm(); CK;
  if (imm) { if (reg < 4) { fault(6, -1); return; } kind = (int)reg - 4; }
  if (lockCheck(kind > 0)) return;
  u32 off;
  if (imm) { off = fetch(); CK; } else off = getG(S);
  u32 v, bit, o = eaOff;
  if (mod == 3 || imm) bit = off & (bits - 1);
  else {
    const i64 so = (i64)(i32)sx(off, S);
    i64 k = so / (i64)bits;
    if (so % (i64)bits != 0 && so < 0) k--;          // (floor)
    bit = (u32)(so - k * (i64)bits);
    o = a32 ? o + (u32)(k * (i64)S) : (o + (u32)(k * (i64)S)) & 0xFFFF;
  }
  if (mod == 3) v = rget(rm, S); else { v = rd((int)eaSeg, o, S); CK; }
  const u32 cf = (v >> bit) & 1, mask = 1u << bit;
  EFL = (EFL & ~F_CF) | cf;
  if (kind) {
    const u32 r = kind == 1 ? v | mask : kind == 2 ? v & ~mask : v ^ mask;
    if (mod == 3) rset(rm, S, r); else { wr((int)eaSeg, o, S, r); CK; }
  }
  rc(kind ? 6 : 3, kind ? 13 : 12);
}
static void shxd(int right, int useCL) {
  const u32 S = osz;
  modrm(); CK;
  u32 n;
  if (useCL) n = R[1]; else { n = fetch(); CK; }
  n &= 31;
  const u32 dst = getE(S); CK;
  const u32 src = getG(S);
  if (!n) { rc(3, 7); return; }
  u32 r, cf;
  if (S == 4) {
    if (right) { r = (dst >> n) | (src << (32 - n)); cf = (dst >> (n - 1)) & 1; }
    else { r = (dst << n) | (src >> (32 - n)); cf = (dst >> (32 - n)) & 1; }
  } else {
    const u64 x = right ? ((u64)src << 32) | ((u64)src << 16) | dst : ((u64)dst << 32) | ((u64)src << 16) | src;
    if (right) { r = (u32)((x >> n) & 0xFFFF); cf = (u32)((x >> (n - 1)) & 1); }
    else { r = (u32)((x >> (32 - n)) & 0xFFFF); cf = (u32)((x >> (48 - n)) & 1); }
  }
  const u32 sb = SIGN[S];
  u32 f = (EFL & ~(F_CF | F_OF)) | cf;
  if ((dst ^ r) & sb) f |= F_OF;
  EFL = f;
  szpS(r, S);
  setE(S, r); CK;
  rc(3, 7);
}
static void xadd(u32 s) {
  modrm(); CK;
  if (lockCheck(1)) return;
  if (mod != 3) { wrCheck((int)eaSeg, eaOff, s); CK; }
  const u32 d = getE(s); CK;
  const u32 g = getG(s), r = aluS(0, d, g, s);
  if (mod == 3) { setG(s, d); setE(s, r); } else { setE(s, r); CK; setG(s, d); }
}
static void cmpxchg(u32 s) {
  modrm(); CK;
  if (lockCheck(1)) return;
  if (mod != 3) { wrCheck((int)eaSeg, eaOff, s); CK; }
  const u32 d = getE(s); CK;
  const u32 a = rget(0, s);
  subS(a, d, 0, s);
  cmpxOk = a == d;
  if (cmpxOk) { setE(s, getG(s)); CK; }
  else { if (mod != 3) { setE(s, d); CK; } rset(0, s, d); }
}

// ---------- 0F: the two-byte opcodes that this core does (see needJS for the others) ----------
static void exec0F(void) {
  const u32 S = osz;
  op2 = (i32)fetch(); CK;
  const u32 o = (u32)op2;
  if (o == 0xB0 || o == 0xB1) { cmpxchg(o & 1 ? S : 1); return; }
  if (o == 0xC0 || o == 0xC1) { xadd(o & 1 ? S : 1); return; }
  if (lock && o != 0xA3 && o != 0xAB && o != 0xB3 && o != 0xBB && o != 0xBA) { fault(6, -1); return; }
  if (o >= 0xC8 && o <= 0xCF) {
    const u32 i = o & 7, v = R[i];
    if (S == 4) R[i] = (v >> 24) | ((v >> 8) & 0xFF00) | ((v & 0xFF00) << 8) | (v << 24);
    else rset(i, 2, 0);
    return;
  }
  if (o >= 0x80 && o <= 0x8F) {
    i32 d;
    if (S == 4) { d = (i32)fetchD(); CK; } else { d = (i32)(i16)fetchW(); CK; }
    if (cond(o & 15)) { jump(EIP + (u32)d, osz); CK; CLK += 7; } else CLK += 3;
    return;
  }
  if (o >= 0x90 && o <= 0x9F) {
    modrm(); CK;
    setE(1, cond(o & 15) ? 1 : 0); CK;
    rc(4, 5); return;
  }
  switch (o) {
    case 0xA0: case 0xA8: push(SR[o == 0xA0 ? FS : GS], osz); CK; CLK += 2; return;
    case 0xA1: case 0xA9: popSeg(o == 0xA1 ? FS : GS); return;
    case 0xA3: bitOp(0, 0); return;
    case 0xAB: bitOp(1, 0); return;
    case 0xB3: bitOp(2, 0); return;
    case 0xBB: bitOp(3, 0); return;
    case 0xBA: bitOp(-1, 1); return;
    case 0xA4: case 0xA5: shxd(0, o == 0xA5); return;
    case 0xAC: case 0xAD: shxd(1, o == 0xAD); return;
    case 0xAF: {
      modrm(); CK;
      const u32 a = sx(getG(S), S), b0 = getE(S); CK;
      const u32 r = imulS((i32)a, (i32)sx(b0, S), S);
      setG(S, r);
      rc(12, 15); return;
    }
    case 0xB2: case 0xB4: case 0xB5: {
      modrm(); CK;
      if (memOnly()) return;
      const u32 off = rd((int)eaSeg, eaOff, S); CK;
      const u32 sel = rd((int)eaSeg, addA(eaOff, S), 2); CK;
      loadSeg(o == 0xB2 ? SS : o == 0xB4 ? FS : GS, sel); CK;
      rset(reg, S, off);
      CLK += (CR[0] & 1) && !(EFL & F_VM) ? 25 : 7; return;
    }
    case 0xB6: case 0xB7: case 0xBE: case 0xBF: {
      const u32 ss = o & 1 ? 2 : 1;
      modrm(); CK;
      const u32 v = getE(ss); CK;
      setG(S, o >= 0xBE ? sx(v, ss) : v);
      rc(3, 6); return;
    }
    case 0xBC: case 0xBD: {
      modrm(); CK;
      const u32 v = getE(S); CK;
      if (!v) EFL |= F_ZF;
      else {
        EFL &= ~F_ZF;
        u32 i;
        if (o == 0xBC) { i = 0; while (!((v >> i) & 1)) i++; } else i = 31 - (u32)__builtin_clz(v);
        setG(S, i);
        CLK += 3 * i;
      }
      rc(10, 10); return;
    }
    default: fault(6, -1); return;
  }
}

// ---------- the one-byte opcodes (P386_OPS) ----------
static void exec386(u32 o) {
  const u32 S = osz;
  if (o < 0x40 && (o & 7) < 6) {                   // 00h-3Dh: the ALU
    const u32 alu = o >> 3, form = o & 7, s = o & 1 ? S : 1;
    if (form < 4) {
      modrm(); CK;
      if (form < 2) {
        if (lockCheck(1)) return;
        const u32 a = getE(s); CK;
        const u32 r = aluS(alu, a, getG(s), s);
        if (alu != 7) { setE(s, r); CK; }
        rc(2, alu == 7 ? 5 : 7);
      } else {
        const u32 g = getG(s), e = getE(s); CK;
        const u32 r = aluS(alu, g, e, s);
        if (alu != 7) setG(s, r);
        rc(2, 6);
      }
    } else {
      const u32 b = fetchImm(s); CK;
      const u32 r = aluS(alu, rget(0, s), b, s);
      if (alu != 7) rset(0, s, r);
      CLK += 2;
    }
    return;
  }
  if (o >= 0x40 && o < 0x50) {
    const u32 i = o & 7, v = rget(i, S), cf = EFL & F_CF;
    const u32 r = o < 0x48 ? addS(v, 1, 0, S) : subS(v, 1, 0, S);
    EFL = (EFL & ~F_CF) | cf;
    rset(i, S, r);
    CLK += 2;
    return;
  }
  if (o >= 0x50 && o < 0x58) { push(rget(o & 7, S), S); CK; CLK += 2; return; }
  if (o >= 0x58 && o < 0x60) { const u32 v = pop(S); CK; rset(o & 7, S, v); CLK += 4; return; }
  if (o >= 0x70 && o < 0x80) {
    const i32 d = fetchS8(); CK;
    if (cond(o & 15)) { jump(EIP + (u32)d, osz); CK; CLK += 7; } else CLK += 3;
    return;
  }
  if (o >= 0x91 && o <= 0x97) {
    const u32 i = o & 7, t = rget(0, S);
    rset(0, S, rget(i, S)); rset(i, S, t); CLK += 3; return;
  }
  if (o >= 0xB0 && o < 0xC0) {
    if (o & 8) { const u32 v = fetchImm(S); CK; rset(o & 7, S, v); } else { const u32 v = fetch(); CK; rset(o & 7, 1, v); }
    CLK += 2; return;
  }
  switch (o) {
    case 0x06: case 0x0E: case 0x16: case 0x1E: push(SR[o >> 3], osz); CK; CLK += 2; return;
    case 0x07: case 0x17: case 0x1F: popSeg((int)(o >> 3)); return;
    case 0x0F: exec0F(); return;
    case 0x27: daa386(0); return;
    case 0x2F: daa386(1); return;
    case 0x37: aaa386(0); return;
    case 0x3F: aaa386(1); return;
    case 0x60: {
      const u32 low = stackOff((u32)(-8 * (i32)S)), big = SBIG[SS];
      for (u32 k = 0; k < 8; k++) { wr(SS, big ? low + k * S : (low + k * S) & 0xFFFF, S, R[7 - k]); CK; }
      setSP(low);
      CLK += 18; return;
    }
    case 0x61: {
      u32 v[8];
      for (u32 i = 0; i < 8; i++) { v[i] = peekStack(i * S, S); CK; if (7 - i != 4) rset(7 - i, S, v[i]); }
      setSP(getSP() + 8 * S);
      if (S == 4 && !SBIG[SS]) R[4] = (v[3] & 0xFFFF0000u) | (R[4] & 0xFFFF);
      CLK += 24; return;
    }
    case 0x62: {
      modrm(); CK;
      if (memOnly()) return;
      const i32 lo = (i32)sx(rd((int)eaSeg, eaOff, S), S); CK;
      const i32 hi = (i32)sx(rd((int)eaSeg, addA(eaOff, S), S), S); CK;
      const i32 v = (i32)sx(rget(reg, S), S);
      CLK += 10;
      if (v < lo || v > hi) fault(5, -1);
      return;
    }
    case 0x68: { const u32 v = fetchImm(S); CK; push(v, S); CK; CLK += 2; return; }
    case 0x6A: { const i32 v = fetchS8(); CK; push((u32)v, S); CK; CLK += 2; return; }
    case 0x69: case 0x6B: {
      modrm(); CK;
      const u32 e = getE(S); CK;
      const i32 a = (i32)sx(e, S);
      i32 b;
      if (o == 0x69) { const u32 x = fetchImm(S); CK; b = (i32)sx(x, S); } else { b = fetchS8(); CK; }
      const u32 r = imulS(a, b, S);
      setG(S, r);
      rc(12, 15); return;
    }
    case 0x6C: case 0x6D: case 0x6E: case 0x6F: stringOp(o, 1); return;
    case 0x80: case 0x81: case 0x82: case 0x83: {
      const u32 s = o & 1 ? S : 1;
      modrm(); CK;
      if (lockCheck(reg != 7)) return;
      const u32 a = getE(s); CK;
      u32 b;
      if (o == 0x81) { b = fetchImm(S); CK; } else if (o == 0x83) { const i32 x = fetchS8(); CK; b = (u32)x & MASK[s]; } else { b = fetch(); CK; }
      const u32 r = aluS(reg, a, b, s);
      if (reg != 7) { setE(s, r); CK; }
      rc(2, reg == 7 ? 5 : 7);
      return;
    }
    case 0x84: case 0x85: {
      const u32 s = o & 1 ? S : 1;
      modrm(); CK;
      const u32 g = getG(s), e = getE(s); CK;
      logicS(e & g, s);
      rc(2, 5); return;
    }
    case 0x86: case 0x87: {
      const u32 s = o & 1 ? S : 1;
      modrm(); CK;
      if (lockCheck(1)) return;
      const u32 a = getE(s); CK;
      const u32 b = getG(s);
      setE(s, b); CK; setG(s, a);
      rc(3, 5); return;
    }
    case 0x88: case 0x89: { const u32 s = o & 1 ? S : 1; modrm(); CK; setE(s, getG(s)); CK; rc(2, 2); return; }
    case 0x8A: case 0x8B: { const u32 s = o & 1 ? S : 1; modrm(); CK; const u32 v = getE(s); CK; setG(s, v); rc(2, 4); return; }
    case 0x8C: {
      modrm(); CK;
      if (reg > 5) { fault(6, -1); return; }
      const u32 v = SR[reg];
      if (mod == 3) rset(rm, S, v); else { wr((int)eaSeg, eaOff, 2, v); CK; }
      rc(2, 2); return;
    }
    case 0x8D: modrm(); CK; if (memOnly()) return; rset(reg, S, eaOff); CLK += 2; return;
    case 0x8E: {
      modrm(); CK;
      const u32 i = reg;
      if (i == CS || i > 5) { fault(6, -1); return; }
      const u32 v = getE(2); CK;
      loadSeg((int)i, v); CK;
      if ((CR[0] & 1) && !(EFL & F_VM)) rc(18, 19); else rc(2, 5);
      if (i == SS) INHIBIT = 1;
      return;
    }
    case 0x8F: {
      modrm(); CK;
      if (reg != 0) { fault(6, -1); return; }
      const u32 v = pop(S); CK;
      if (mod != 3 && eaESP) eaOff = eaOff + S;
      setE(S, v); CK; rc(4, 5); return;
    }
    case 0x90: CLK += 3; return;
    case 0x98: if (S == 4) R[0] = (u32)(i32)(i16)R[0]; else rset(0, 2, (u32)(i32)(i8)R[0]); CLK += 3; return;
    case 0x99: if (S == 4) R[2] = R[0] & 0x80000000u ? 0xFFFFFFFFu : 0; else rset(2, 2, R[0] & 0x8000 ? 0xFFFF : 0); CLK += 2; return;
    case 0x9C: {
      if (v86Check()) return;
      push(S == 4 ? (EFL & (0x7FD5 | XFL)) | 2 : (EFL & 0x7FD5) | 2, S); CK;
      CLK += 4; return;
    }
    case 0x9D: {                                   // (real mode only: see needJS)
      if (v86Check()) return;
      const u32 v = pop(S); CK;
      EFL = S == 4 ? (EFL & F_VM) | (v & (0x7FD5 | XFL)) | 2 : (EFL & 0xFFFF0000u) | (v & 0x7FD5) | 2;
      CLK += 5; return;
    }
    case 0x9E: EFL = (EFL & ~0xD5u) | ((R[0] >> 8) & 0xD5); CLK += 3; return;
    case 0x9F: rset(4, 1, ((EFL & 0x7FD5) | 2) & 0xFF); CLK += 2; return;
    case 0xA0: case 0xA1: case 0xA2: case 0xA3: {
      u32 off;
      if (a32) { off = fetchD(); CK; } else { off = fetchW(); CK; }
      const int sg = seg >= 0 ? seg : DS;
      const u32 s = o & 1 ? S : 1;
      if (o < 0xA2) { const u32 v = rd(sg, off, s); CK; rset(0, s, v); } else { wr(sg, off, s, rget(0, s)); CK; }
      CLK += 4; return;
    }
    case 0xA4: case 0xA5: case 0xA6: case 0xA7: case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF: stringOp(o, 1); return;
    case 0xA8: case 0xA9: {
      const u32 s = o & 1 ? S : 1, b = fetchImm(s); CK;
      logicS(rget(0, s) & b, s); CLK += 2; return;
    }
    case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3: shiftGroup(o); return;
    case 0xC2: {
      const u32 n = fetchW(); CK;
      const u32 ip = pop(S); CK;
      jump(ip, S); CK;
      setSP(getSP() + n); CLK += 10; return;
    }
    case 0xC3: { const u32 ip = pop(S); CK; jump(ip, S); CK; CLK += 10; return; }
    case 0xC4: case 0xC5: {
      modrm(); CK;
      if (memOnly()) return;
      const u32 off = rd((int)eaSeg, eaOff, S); CK;
      const u32 sel = rd((int)eaSeg, addA(eaOff, S), 2); CK;
      loadSeg(o == 0xC4 ? ES : DS, sel); CK;
      rset(reg, S, off);
      CLK += (CR[0] & 1) && !(EFL & F_VM) ? 22 : 7; return;
    }
    case 0xC6: case 0xC7: {
      const u32 s = o & 1 ? S : 1;
      modrm(); CK;
      if (reg != 0) { fault(6, -1); return; }
      const u32 v = fetchImm(s); CK;
      setE(s, v); CK;
      rc(2, 2); return;
    }
    case 0xC8: enter(); return;
    case 0xC9: {
      if (SBIG[SS]) R[4] = R[5]; else rset(4, 2, R[5]);
      const u32 v = pop(S); CK;
      rset(5, S, v);
      CLK += 4; return;
    }
    case 0xD4: {
      const u32 b = fetch(); CK;
      const u32 al = R[0] & 0xFF;
      CLK += 17;
      if (b == 0) { szpS(al >> 1, 1); fault(0, -1); return; }
      rset(4, 1, al / b); rset(0, 1, al % b);
      logicS(R[0] & 0xFF, 1);
      return;
    }
    case 0xD5: {
      const u32 b = fetch(); CK;
      const u32 al = R[0] & 0xFF, ah = (R[0] >> 8) & 0xFF;
      const u32 r = addS(al, (ah * b) & 0xFF, 0, 1);
      rset(0, 2, r);
      CLK += 19; return;
    }
    case 0xD6: rset(0, 1, EFL & F_CF ? 0xFF : 0); CLK += 2; return;
    case 0xD7: {
      const int sg = seg >= 0 ? seg : DS;
      const u32 off = a32 ? R[3] + (R[0] & 0xFF) : ((R[3] & 0xFFFF) + (R[0] & 0xFF)) & 0xFFFF;
      const u32 v = rd(sg, off, 1); CK;
      rset(0, 1, v); CLK += 5; return;
    }
    case 0xE0: case 0xE1: case 0xE2: {
      const i32 d = fetchS8(); CK;
      const u32 c = a32 ? R[1] - 1 : (R[1] - 1) & 0xFFFF;
      const int zf = (EFL & F_ZF) != 0;
      const int take = c != 0 && (o == 0xE2 || (o == 0xE1 ? zf : !zf));
      if (take) { jump(EIP + (u32)d, osz); CK; }
      if (a32) R[1] = c; else rset(1, 2, c);
      CLK += take ? 11 : 4;
      return;
    }
    case 0xE3: {
      const i32 d = fetchS8(); CK;
      const u32 c = a32 ? R[1] : R[1] & 0xFFFF;
      if (c == 0) { jump(EIP + (u32)d, osz); CK; CLK += 9; } else CLK += 5;
      return;
    }
    case 0xE4: case 0xE5: {
      const u32 p = fetch(); CK;
      const u32 s = o & 1 ? S : 1, v = ioIn(p, s);
      rset(0, s, v); CLK += 12; return;
    }
    case 0xE6: case 0xE7: {
      const u32 p = fetch(); CK;
      const u32 s = o & 1 ? S : 1;
      ioOut(p, s, rget(0, s)); CLK += 10; return;
    }
    case 0xE8: {
      const u32 d = fetchImm(S); CK;
      const u32 t = EIP + d;
      push(EIP, S); CK;
      jump(t, S); CK;
      CLK += 7; return;
    }
    case 0xE9: { const u32 d = fetchImm(S); CK; jump(EIP + d, S); CK; CLK += 7; return; }
    case 0xEB: { const i32 d = fetchS8(); CK; jump(EIP + (u32)d, osz); CK; CLK += 7; return; }
    case 0xEC: case 0xED: {
      const u32 p = R[2] & 0xFFFF, s = o & 1 ? S : 1, v = ioIn(p, s);
      rset(0, s, v); CLK += 13; return;
    }
    case 0xEE: case 0xEF: {
      const u32 p = R[2] & 0xFFFF, s = o & 1 ? S : 1;
      ioOut(p, s, rget(0, s)); CLK += 11; return;
    }
    case 0xF4:
      if ((CR[0] & 1) && CPL) { fault(13, 0); return; }
      HALTED = 1; CLK += 5;
      busEv(T_HALT, busLenDef());
      return;
    case 0xF5: EFL ^= F_CF; CLK += 2; return;
    case 0xF6: case 0xF7: group3(o & 1 ? S : 1); return;
    case 0xF8: EFL &= ~F_CF; CLK += 2; return;
    case 0xF9: EFL |= F_CF; CLK += 2; return;
    case 0xFA: if (ioCheck()) return; EFL &= ~F_IF; CLK += 3; return;
    case 0xFB: if (ioCheck()) return; EFL |= F_IF; CLK += 3; INHIBIT = 1; return;
    case 0xFC: EFL &= ~F_DF; CLK += 2; return;
    case 0xFD: EFL |= F_DF; CLK += 2; return;
    case 0xFE: case 0xFF: group45(o); return;
    default: fault(6, -1); return;               // (needJS sends the others to JavaScript)
  }
}

// ---------- the i486 clocks (CPU80486.clocks486 / clocks0F; -1 = keep the 80386 value) ----------
static i32 ioClk(i32 real, i32 ok, i32 bad, i32 v86) {
  if (!(CR[0] & 1)) return real;
  if (EFL & F_VM) return v86;
  return CPL <= iopl() ? ok : bad;
}
static i32 clocks0F(void) {
  const int m = mod >= 0 && mod != 3, pm = (CR[0] & 1) && !(EFL & F_VM);
  if (op2 >= 0x80 && op2 <= 0x8F) return DIDFLUSH ? 3 : 1;
  if (op2 >= 0x90 && op2 <= 0x9F) return m ? 3 : 4;
  if (op2 >= 0xC8 && op2 <= 0xCF) return 1;
  switch (op2) {
    case 0x06: return 7;
    case 0x08: return 4;
    case 0x09: return 5;
    case 0x20: case 0x21: case 0x24: case 0x26: return 4;
    case 0x22: return 16;
    case 0x23: return 11;
    case 0xA0: case 0xA8: return 3;
    case 0xA1: case 0xA9: return pm ? 9 : 3;
    case 0xA2: return 14;
    case 0xA3: return m ? 8 : 3;
    case 0xAB: case 0xB3: case 0xBB: return m ? 13 : 6;
    case 0xBA: return reg == 4 ? 3 : m ? 8 : 6;
    case 0xA4: case 0xAC: return m ? 3 : 2;
    case 0xA5: case 0xAD: return m ? 4 : 3;
    case 0xAF: return osz == 4 ? 28 : 18;
    case 0xB0: case 0xB1: return !m ? 6 : cmpxOk ? 7 : 10;
    case 0xB2: case 0xB4: case 0xB5: return pm ? 12 : 6;
    case 0xB6: case 0xB7: case 0xBE: case 0xBF: return 3;
    case 0xBC: case 0xBD: return 10;
    case 0xC0: case 0xC1: return m ? 4 : 3;
    default: return -1;
  }
}
static i32 clocks486(u32 o) {
  const int m = mod >= 0 && mod != 3, taken = DIDFLUSH != 0;
  const u32 S = osz;
  const int pm = (CR[0] & 1) && !(EFL & F_VM);
  if (o < 0x40) {
    if ((o & 7) < 6) { const u32 f = o & 7; return f >= 4 || !m ? 1 : f < 2 ? ((o >> 3) == 7 ? 2 : 3) : 2; }
    if (o == 0x0F) return clocks0F();
    if ((o & 7) == 6) return 3;
    if (o == 0x27 || o == 0x2F) return 2;
    if (o == 0x37 || o == 0x3F) return 3;
    return pm ? 9 : 3;
  }
  if (o < 0x60) return 1;
  if (o >= 0x70 && o < 0x80) return taken ? 3 : 1;
  if (o >= 0xB0 && o < 0xC0) return 1;
  if (o >= 0x91 && o <= 0x97) return 3;
  if (o >= 0xD8 && o <= 0xDF) return -1;
  switch (o) {
    case 0x60: return 11;
    case 0x61: return 9;
    case 0x62: return 7;
    case 0x63: return 9;
    case 0x68: case 0x6A: return 1;
    case 0x69: case 0x6B: return S == 4 ? 26 : 18;
    case 0x80: case 0x81: case 0x82: case 0x83: return !m ? 1 : reg == 7 ? 2 : 3;
    case 0x84: case 0x85: return m ? 2 : 1;
    case 0x86: case 0x87: return m ? 5 : 3;
    case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8D: return 1;
    case 0x8C: return 3;
    case 0x8E: return pm ? 9 : 3;
    case 0x8F: return 6;
    case 0x90: return 1;
    case 0x98: case 0x99: return 3;
    case 0x9A: return pm ? -1 : 18;
    case 0x9B: return 1;
    case 0x9C: return pm ? 3 : 4;
    case 0x9D: return pm ? 6 : 9;
    case 0x9E: return 2;
    case 0x9F: return 3;
    case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xA8: case 0xA9: return 1;
    case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3:
      if (reg == 2 || reg == 3) return m ? 10 : o == 0xD0 || o == 0xD1 ? 3 : 8;
      return m ? 4 : o <= 0xC1 ? 2 : 3;
    case 0xC2: case 0xC3: return 5;
    case 0xC4: case 0xC5: return pm ? 12 : 6;
    case 0xC6: case 0xC7: return 1;
    case 0xC9: return 5;
    case 0xCA: case 0xCB: return pm ? -1 : 13;
    case 0xCC: return pm ? -1 : 26;
    case 0xCD: return pm ? -1 : 30;
    case 0xCE: return !taken ? 3 : pm ? -1 : 28;
    case 0xCF: return pm ? -1 : 15;
    case 0xD4: return 15;
    case 0xD5: return 14;
    case 0xD6: return 2;
    case 0xD7: return 4;
    case 0xE0: case 0xE1: return taken ? 9 : 6;
    case 0xE2: return taken ? 7 : 6;
    case 0xE3: return taken ? 8 : 5;
    case 0xE4: case 0xE5: return ioClk(14, 9, 29, 27);
    case 0xEC: case 0xED: return ioClk(14, 8, 28, 27);
    case 0xE6: case 0xE7: return ioClk(16, 11, 31, 29);
    case 0xEE: case 0xEF: return ioClk(16, 10, 30, 29);
    case 0xE8: case 0xE9: case 0xEB: return 3;
    case 0xEA: return pm ? -1 : 17;
    case 0xF4: return 4;
    case 0xF5: case 0xF8: case 0xF9: case 0xFC: case 0xFD: return 2;
    case 0xFA: case 0xFB: return 5;
    case 0xF6: case 0xF7: {
      const u32 s = o & 1 ? S : 1;
      switch (reg) {
        case 0: case 1: return m ? 2 : 1;
        case 2: case 3: return m ? 3 : 1;
        case 4: case 5: return s == 1 ? 13 : s == 2 ? 18 : 28;
        case 6: return s == 1 ? 16 : s == 2 ? 24 : 40;
        default: return s == 1 ? 19 : s == 2 ? 27 : 43;
      }
    }
    case 0xFE: case 0xFF:
      switch (reg) {
        case 0: case 1: return m ? 3 : 1;
        case 2: case 4: return 5;
        case 3: return pm ? -1 : 17;
        case 5: return pm ? -1 : 13;
        default: return 4;
      }
    default: return -1;
  }
}
// ---------- the P5 clocks (CPU80586.clocks586 / clocks0F586; -1 = keep the value before) ----------
static i32 clocks0F586(void) {
  const int m = mod >= 0 && mod != 3, pm = (CR[0] & 1) && !(EFL & F_VM);
  if (op2 >= 0x80 && op2 <= 0x8F) return 1;
  if (op2 >= 0x90 && op2 <= 0x9F) return m ? 2 : 1;
  if (op2 >= 0xC8 && op2 <= 0xCF) return 1;
  switch (op2) {
    case 0xA0: case 0xA8: return 1;
    case 0xA1: case 0xA9: return pm ? 8 : 3;
    case 0xA3: return m ? 9 : 4;
    case 0xAB: case 0xB3: case 0xBB: return m ? 13 : 7;
    case 0xBA: return reg == 4 ? 4 : m ? 8 : 7;
    case 0xA4: case 0xAC: return 4;
    case 0xA5: case 0xAD: return m ? 5 : 4;
    case 0xAF: return 10;
    case 0xB0: case 0xB1: return m ? 6 : 5;
    case 0xB2: case 0xB4: case 0xB5: return pm ? 13 : 4;
    case 0xB6: case 0xB7: case 0xBE: case 0xBF: return 3;
    case 0xBC: case 0xBD: {
      if (EFL & F_ZF) return 6;
      const u32 i = R[reg] & 31;
      return op2 == 0xBC ? 6 + (i32)i : 7 + (31 - (i32)i);
    }
    case 0xC0: case 0xC1: return m ? 4 : 3;
    default: return -1;                          // (the others go to JavaScript)
  }
}
static i32 clocks586(u32 o) {
  const int m = mod >= 0 && mod != 3, taken = DIDFLUSH != 0;
  const u32 S = osz;
  const int pm = (CR[0] & 1) && !(EFL & F_VM);
  if (o < 0x40) {
    if ((o & 7) < 6) { const u32 f = o & 7; return f >= 4 || !m ? 1 : f < 2 ? ((o >> 3) == 7 ? 2 : 3) : 2; }
    if (o == 0x0F) return clocks0F586();
    if ((o & 7) == 6) return 1;
    if (o == 0x27 || o == 0x2F || o == 0x37 || o == 0x3F) return 3;
    return pm ? 8 : 3;
  }
  if (o < 0x60) return 1;
  if (o >= 0x70 && o < 0x80) return 1;
  if (o >= 0xB0 && o < 0xC0) return 1;
  if (o >= 0x91 && o <= 0x97) return 2;
  if (o >= 0xD8 && o <= 0xDF) return -1;
  switch (o) {
    case 0x60: case 0x61: return 5;
    case 0x62: return 8;
    case 0x63: return 7;
    case 0x68: case 0x6A: return 1;
    case 0x69: case 0x6B: return 10;
    case 0x80: case 0x81: case 0x82: case 0x83: return !m ? 1 : reg == 7 ? 2 : 3;
    case 0x84: case 0x85: return m ? 2 : 1;
    case 0x86: case 0x87: return 3;
    case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: case 0x8D: return 1;
    case 0x8E: return pm ? 8 : 2;
    case 0x8F: return 3;
    case 0x90: return 1;
    case 0x98: return 3;
    case 0x99: return 2;
    case 0x9A: return pm ? -1 : 4;
    case 0x9B: return 1;
    case 0x9C: return pm ? 3 : 4;
    case 0x9D: return pm ? 4 : 6;
    case 0x9E: case 0x9F: return 2;
    case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xA8: case 0xA9: return 1;
    case 0xC0: case 0xC1: case 0xD0: case 0xD1: case 0xD2: case 0xD3: {
      const int one = o == 0xD0 || o == 0xD1, cl = o >= 0xD2;
      if (reg == 2 || reg == 3) return one ? (m ? 3 : 1) : cl ? (m ? 9 : 7) : (m ? 10 : 8);
      return cl ? 4 : m ? 3 : 1;
    }
    case 0xC2: return 3;
    case 0xC3: return 2;
    case 0xC4: case 0xC5: return pm ? 13 : 4;
    case 0xC6: case 0xC7: return 1;
    case 0xC9: return 3;
    case 0xCA: case 0xCB: return pm ? -1 : 4;
    case 0xCC: return pm ? -1 : 13;
    case 0xCD: return pm ? -1 : 16;
    case 0xCE: return !taken ? 4 : pm ? -1 : 13;
    case 0xCF: return pm ? -1 : 8;
    case 0xD4: return 18;
    case 0xD5: return 10;
    case 0xD6: return 2;
    case 0xD7: return 4;
    case 0xE0: case 0xE1: return taken ? 7 : 8;
    case 0xE2: case 0xE3: return taken ? 5 : 6;
    case 0xE4: case 0xE5: case 0xEC: case 0xED: return ioClk(7, 4, 21, 19);
    case 0xE6: case 0xE7: case 0xEE: case 0xEF: return ioClk(12, 9, 26, 24);
    case 0xE8: case 0xE9: case 0xEB: return 1;
    case 0xEA: return pm ? -1 : 3;
    case 0xF4: return 4;
    case 0xF5: case 0xF8: case 0xF9: case 0xFC: case 0xFD: return 2;
    case 0xFA: case 0xFB: return 7;
    case 0xF6: case 0xF7: {
      const u32 s = o & 1 ? S : 1;
      switch (reg) {
        case 0: case 1: return m ? 2 : 1;
        case 2: case 3: return m ? 3 : 1;
        case 4: case 5: return s == 4 ? 10 : 11;
        case 6: return s == 1 ? 17 : s == 2 ? 25 : 41;
        default: return s == 1 ? 22 : s == 2 ? 30 : 46;
      }
    }
    case 0xFE: case 0xFF:
      switch (reg) {
        case 0: case 1: return m ? 3 : 1;
        case 2: case 4: return 2;
        case 3: return pm ? -1 : 5;
        case 5: return pm ? -1 : 4;
        default: return 2;
      }
    default: return -1;
  }
}
// CPU80486.exec: the 80386 work, then the 486 clocks
static i32 clocks586(u32 o);
static void exec(u32 o) {
  if (I386) { exec386(o); return; }             // (the 386 clocks of exec386; CPU80386.exec keeps mod)
  if (P6) { mod = -1; op2 = -1; OPPOS = ILEN; exec386(o); CK; EXECOK = 1; return; }
  const u32 c0 = CLK, npfx = ILEN - 1;
  mod = -1; op2 = -1;
  exec386(o); CK;
  const i32 t = clocks486(o);
  if (t >= 0) CLK = c0 + (u32)t;
  if (P5) {
    const i32 t5 = clocks586(o);
    if (t5 >= 0) CLK = c0 + (u32)t5;
    CLK += npfx;                                 // (the P5 decodes each prefix in 1 clock)
    if ((o >= 0x70 && o < 0x80) || o == 0xE8 || o == 0xE9 || o == 0xEB || (o == 0x0F && op2 >= 0x80 && op2 < 0x90)) branch();
    EXECOK = 1;
  }
}

// ---------- which instructions go to JavaScript (decided before the instruction starts) ----------
static u8 LOCKOK[256], OK0F[256];
// byte i of the next instruction, with no side effects (0x100: unknown, JavaScript decides)
static u32 peekByte(u32 i) {
  const u32 n = QT - QH;
  if (i < n) return QB[QH + i];
  const u32 off = EIP + i;
  if (off > SHI[CS] || off < EIP) return 0x100;
  const i64 pa = peekPhys(SBASE[CS] + off);
  if (pa < 0) return 0x100;
  return peek8((u32)pa);
}
// FIRST[b]: 0 = this core always does an instruction that starts with byte b, 1 = look closer
static u8 FIRST[256];
static int needJS(void) {
  if (EFL & F_TF) return 1;                      // (single step: the #DB of JavaScript)
  if (REPACT) return 0;
  if (QH < QT && !FIRST[QB[QH]]) return 0;       // (the most instructions)
  u32 i = 0, b;
  for (;;) {
    b = peekByte(i);
    if (b > 0xFF) return 1;
    if ((b & 0xE7) == 0x26 || b == 0x64 || b == 0x65 || b == 0x66 || b == 0x67 || b == 0xF0 || b == 0xF2 || b == 0xF3) { if (++i > 14) return 1; continue; }
    break;
  }
  const u32 pe = CR[0] & 1;
  switch (b) {
    case 0x0F: {
      const u32 b2 = peekByte(i + 1);
      if (b2 > 0xFF || !OK0F[b2]) return 1;
      // the 486 instructions (XADD, CMPXCHG, BSWAP): #UD on the 80386, in JavaScript
      return I386 && (b2 == 0xB0 || b2 == 0xB1 || b2 == 0xC0 || b2 == 0xC1 || (b2 >= 0xC8 && b2 <= 0xCF));
    }
    case 0x9A: case 0xEA: case 0xCA: case 0xCB: case 0xCC: case 0xCD: case 0xCE: case 0xCF: case 0xF1: case 0x63: case 0x9B:
    case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: case 0xDF:
      return 1;
    case 0x9D: return pe;
    case 0xE4: case 0xE5: case 0xE6: case 0xE7: case 0xEC: case 0xED: case 0xEE: case 0xEF:
    case 0x6C: case 0x6D: case 0x6E: case 0x6F:
      return pe && ((EFL & F_VM) || CPL > iopl());
    case 0xFF: { const u32 m = peekByte(i + 1); if (m > 0xFF) return 1; const u32 r = (m >> 3) & 7; return r == 3 || r == 5; }
    default: return 0;
  }
}

// ---------- the P6 recipe of the step and the out-of-order model ----------
static i32 recipeId(u32 o) {
  if (o == 0x0F) {
    const i32 r = RID0F[op2 & 255];
    if (r >= 0) return r;
    const i32 g = RIDG0F[(op2 & 255) * 8 + reg];
    return g >= 0 ? g : RIDMISC[2];
  }
  if (o >= 0xD8 && o <= 0xDF) return mod < 0 ? RIDMISC[2] : RIDFP[((o & 7) << 8) | ((u32)mod << 6) | (reg << 3) | rm];
  const i32 r = RID1[o];
  if (r >= 0) return r;
  const i32 g = RIDG1[o * 8 + reg];
  return g >= 0 ? g : RIDMISC[2];
}
// CPU80686.finish for a step of this core (mode 0: an instruction, 1: a REP iteration); w6Ooo gives
// the inputs of the model. haltedStart: the step began halted (the text of JavaScript is not null).
static double finish6(int haltedStart) {
  double T, Mc;
  if (haltedStart) {
    T = 2; ST[ST_HALTCLK] += 2; Mc = CYCLES + 2;
    oooSync(Mc);
  } else {
    const int mode = !EXECOK ? 2 : STRCONT ? 1 : 0;
    const i32 ri = recipeId(op);
    const Recipe *Rr = &REC[ri];
    IN[IN_OP] = op; IN[IN_OP2] = op2; IN[IN_MOD] = mod; IN[IN_REG] = reg; IN[IN_RM] = rm;
    IN[IN_OSZ] = osz; IN[IN_A32] = a32 ? 1 : 0; IN[IN_REP] = rep != 0 ? 1 : 0; IN[IN_LOCK] = lock ? 1 : 0;
    IN[IN_ILEN] = ILEN; IN[IN_CLK] = CLK; IN[IN_NLD] = NLD; IN[IN_NST] = NST; IN[IN_FPTOP] = FPTOP;
    IN[IN_CODELAT] = CODELAT; IN[IN_CODEBUS] = CODEBUS; IN[IN_CYCLES] = CYCLES;
    IN[IN_FPUPC] = FPUPC;
    IN[IN_EA] = mod >= 0 && mod != 3 ? eaRegs(op, a32) : 0;
    if (Rr->br && mode == 0 && Rr->br != BK_FAR) {
      const int taken = DIDFLUSH != 0;
      IN[IN_LA] = LASTBASE + LASTIP; IN[IN_TAKEN] = taken ? 1 : 0;
      IN[IN_TARGET] = taken ? SBASE[CS] + EIP : 0;
      IN[IN_SBYTE] = IB[(ILEN - 1) & 15] & 0x80;
      const u32 ip = SBIG[CS] ? LASTIP + ILEN : (LASTIP + ILEN) & 0xFFFF;
      IN[IN_CALLRET] = LASTBASE + ip;
    }
    Mc = ooo(mode, ri);
    T = Mc - CYCLES;
    if (T < 1) { ST[ST_FLOOR]++; T = 1; }
  }
  CYCLES += T;
  oS[O_CYC] = CYCLES;
  return T;
}

// ---------- step and finish (CPU80486.step / CPU80386.step / CPU80486.finish) ----------
// CPU80386.finish: the stall fetches, the EU bus cycles, prefetches in the free bus slots
static double finish386(int halted) {
  const u32 BL = BUSLEN, n = NEU, S = NSTALL * BL;
  const u32 minT = S + n * BL;
  u32 T = CLK + WS * n + S;
  if (T < minT) T = minT;
  if (T < 2) T = 2;
  if (FPUBUSY > 0) { FPUBUSY -= T; if (FPUBUSY < 0) FPUBUSY = 0; }
  if (!halted && !DIDFLUSH) {
    u32 room = T - minT;
    while (room >= BL && QT - QH <= 14 && prefetch386(0)) room -= BL;
  }
  CYCLES += T;
  return T;
}
static double finish(int halted) {
  if (I386) return finish386(halted);
  if (P6) return finish6(0);
  const u32 S = STALLT, BT = BUST;
  i64 T = (i64)S + CLK + RDT;
  if (T < (i64)S + BT) T = (i64)S + BT;
  if (T < 1) T = 1;
  if (!halted && !DIDFLUSH) {
    i32 room = (i32)(T - S - BT);
    if (P5) { while (QT - QH < 16) { const i32 u = prefetch5(0, room); if (u < 0) break; room -= u; } }
    else while (QT - QH <= 16) { const i32 u = prefetch(0, room); if (u < 0) break; room -= u; }
  }
  if (P5) {
    // the clock rule of a pair (CPU80586.finish)
    u32 why = 0;
    if (ISV) {
      T = (UCLK > T ? (i64)UCLK : T) - (i64)URET;
      if (T < 1) { P_FLOOR += (u32)(1 - T); T = 1; }
      P_V++;
    } else {
      why = pairCheck(halted);
      if (why != 17) P_U++;
      if (!why) {
        PAIRNEXT = 1; PAIRIP = EIP; INHIBIT = 1;
        UCLK = (u32)T; T = T > 1 ? T - 1 : 1; URET = (u32)T;
      } else PWHYA[why]++;
    }
    LASTWHY = why;
  }
  CYCLES += (double)T;
  return (double)T;
}
static double step(void) {
  N_C++;
  if (P6) {
    // CPU80686.step: the clocks that the machine added move the model; the scratch of the step
    const double ext = CYCLES - oS[O_CYC];
    if (ext > 0) oooSync(oS[O_PREV] + ext);
    NLD = 0; NST = 0; ACCLAT = 0; ACCBUS = 0; CODELAT = 0; CODEBUS = 0;
    EXECOK = 0; STRCONT = 0; ISV = 0; PAIRNEXT = 0;
  } else if (P5) { ISV = PAIRNEXT && EIP == PAIRIP; PAIRNEXT = 0; EXECOK = 0; }
  STALLT = 0; BUST = 0; RDT = 0; noAC = 0; NSTALL = 0;
  CLK = 0; NEU = 0; DIDFLUSH = 0; ILEN = 0; EXT = 0; FAULTRF = 0; KEEPRF = 0;
  LASTBASE = SBASE[CS];
  trapBefore = (EFL & F_TF) && !INHIBIT;
  INHIBIT = 0;
  if (HALTED) { CLK = 2; return P6 ? finish6(1) : finish(1); }
  FLT = -1;
  if (REPACT) {
    LASTIP = REP_START; LASTCS = SR[CS]; SPSTART = R[4];
    seg = (i32)REPSEG; rep = REPREP; osz = REPOSZ; a32 = REPA32; lock = 0; mod = -1;
    stringOp(REPOP, 0);
  } else {
    LASTIP = EIP; LASTCS = SR[CS]; SPSTART = R[4];
    seg = -1; rep = 0; lock = 0;
    u32 o = 0, opP = 0, adP = 0;
    for (;;) {
      o = fetch(); if (FLT >= 0) break;
      if ((o & 0xE7) == 0x26) seg = (i32)((o >> 3) & 3);
      else if (o == 0x64 || o == 0x65) seg = (i32)(o - 0x60);
      else if (o == 0x66) opP = 1;
      else if (o == 0x67) adP = 1;
      else if (o == 0xF2 || o == 0xF3) rep = o - 0xF1;
      else if (o == 0xF0) lock = 1;
      else break;
    }
    if (FLT < 0) {
      const u32 big = SBIG[CS];
      osz = big != opP ? 4 : 2; a32 = big != adP;
      if (lock && !LOCKOK[o]) fault(6, -1);
      else { op = o; exec(o); if (FLT < 0) INSTR += 1; }
    }
  }
  if (FLT >= 0) {
    const i32 v = FLT, e = FERR;
    FLT = -1; PENDDB = 0;
    N_JS++;
    saveDec();
    const double t = jfault(v, e);                // JavaScript: raise, then finish
    loadDec();
    return t;
  }
  if (!KEEPRF) EFL &= ~F_RF;
  u32 db = PENDDB;
  PENDDB = 0;
  if (trapBefore && !REPACT) db |= 0x4000;
  if (db) { N_JS++; saveDec(); const double t = jdebug(db); loadDec(); return t; }
  return finish(HALTED);
}
static double jsStep(void) { N_JS++; saveDec(); const double t = jstep(); loadDec(); return t; }

// ---------- the machine loop (Machine.run, idleWatch, idleArrive, haltWait) ----------
static double dfloor(double x) { const double t = (double)(i64)x; return t > x ? t - 1 : t; }
static void idleKeep(double *S) {
  for (int i = 0; i < 8; i++) S[i] = R[i];
  S[8] = EFL; S[9] = WRCHG; S[10] = IOWRN;
  for (int i = 0; i < 6; i++) S[11 + i] = SR[i];
  S[17] = CYCLES; S[18] = INSTR; S[19] = IORDN;
}
static int idleSame(const double *S) {
  if (S[8] != EFL || S[9] != WRCHG || S[10] != IOWRN) return 0;
  for (int i = 0; i < 8; i++) if (S[i] != R[i]) return 0;
  for (int i = 0; i < 6; i++) if (S[11 + i] != SR[i]) return 0;
  return 1;
}
static void idleWatch(void) { IDLEIP = EIP; IDLEN = 0; IDLET = CYCLES; }
static double idleArrive(void) {
  IDLET = CYCLES;
  if (IDLEN > 0 && !HALTED && !REPACT) {
    double *S = idleSame(IDLEP) ? IDLEP : idleSame(IDLES) ? IDLES : 0;
    if (S && CYCLES > S[17]) {
      const double Dc = CYCLES - S[17], I = INSTR - S[18];
      const double cap = IORDN != S[19] ? CLOCKHZ / 100000.0 : CLOCKHZ / 4000.0;
      double k = dfloor(cap / Dc);
      if (k < 1) k = 1;
      const double w0 = WRCHG;
      double skip = 0;
      for (double j = 0; j < k; j++) {
        CYCLES += Dc; INSTR += I; skip += Dc;
        TICKDUE += Dc; jtick();
        if (WRCHG != w0 || NMI || ((EFL & 0x200) && IRQ)) break;
      }
      idleKeep(IDLES); idleKeep(IDLEP);
      IDLET = CYCLES; IDLESKIPS++; IDLESAVED += skip;
      return skip;
    }
  }
  if (IDLEN == 0) idleKeep(IDLES);
  idleKeep(IDLEP);
  if (++IDLEN > 64) IDLEIP = 0xFFFFFFFFu;
  return 0;
}
static double haltWait(double room) {
  const double cap = CLOCKHZ / 4000.0, lim = room < cap ? room : cap;
  double group = dfloor(CLOCKHZ * 1.28e-6 + 0.5);
  if (group < 64) group = 64;
  if (TICKDUE) jtick();
  double skip = 0;
  while (skip < lim && !NMI && !IRQ) {
    const double n = group < lim - skip ? group : lim - skip;
    CYCLES += n; skip += n;
    jtickn(n);
  }
  if (skip) { if (P6) ST[ST_HALTCLK] += skip; HALTWAITS++; HALTSAVED += skip; }
  return skip;
}
// Machine.run with the budget maxCycles. Returns 0 (the budget), 1 (HLT with IF = 0), 2 (a CPU
// reset in a device call: JavaScript keeps its new state). DONE =
// the clocks. JavaScript does the start and the end (syncIn, the last tickPending, syncOut).
EXPORT(run) i32 run(double maxCycles) {
  double done = 0;
  const int idle = IDLEON != 0;
  loadDec();
  while (done < maxCycles) {
    double c;
    // the interrupt test of step (before the instruction): JavaScript takes the interrupt
    if (!INHIBIT && (NMI || ((EFL & F_IF) && !SHUTDOWN && IRQ))) c = jsStep();
    else if (!HALTED && needJS()) c = jsStep();
    else c = step();
    done += c;
    if (ABORT) { DONE = done; saveDec(); return 2; }
    TICKDUE += c;
    if (TICKDUE >= 64) { jtick(); if (ABORT) { DONE = done; saveDec(); return 2; } if (idle && CYCLES - IDLET > 4096) idleWatch(); }
    if (idle && EIP == IDLEIP) done += idleArrive();
    if (HALTED) {
      if (!(EFL & F_IF)) { jtick(); if (!NMI) { DONE = done; saveDec(); return 1; } }
      else if (idle && done < maxCycles) done += haltWait(maxCycles - done);
    }
  }
  DONE = done;
  saveDec();
  return 0;
}

// ---------- start ----------
EXPORT(init) u32 init(void) {
  for (int i = 0; i < 256; i++) { int b = i, p = 1; while (b) { p ^= b & 1; b >>= 1; } PARITY[i] = (u8)p; }
  static const u8 lk[] = { 0x00, 0x01, 0x08, 0x09, 0x10, 0x11, 0x18, 0x19, 0x20, 0x21, 0x28, 0x29, 0x30, 0x31, 0x80, 0x81, 0x82, 0x83, 0x86, 0x87, 0xF6, 0xF7, 0xFE, 0xFF, 0x0F };
  for (unsigned i = 0; i < sizeof lk; i++) LOCKOK[lk[i]] = 1;
  for (int i = 0x80; i <= 0x9F; i++) OK0F[i] = 1;
  static const u8 ok[] = { 0xA0, 0xA1, 0xA3, 0xA4, 0xA5, 0xA8, 0xA9, 0xAB, 0xAC, 0xAD, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0, 0xC1 };
  for (unsigned i = 0; i < sizeof ok; i++) OK0F[ok[i]] = 1;
  for (int i = 0xC8; i <= 0xCF; i++) OK0F[i] = 1;
  static const u8 look[] = { 0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3, 0x0F, 0x9A, 0xEA, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
    0xF1, 0x63, 0x9B, 0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0x9D, 0xE4, 0xE5, 0xE6, 0xE7, 0xEC, 0xED, 0xEE, 0xEF, 0x6C, 0x6D, 0x6E, 0x6F, 0xFF };
  for (unsigned i = 0; i < sizeof look; i++) FIRST[look[i]] = 1;
  LAYOUT[0] = (u32)(unsigned long)V; LAYOUT[1] = (u32)(unsigned long)D; LAYOUT[2] = (u32)(unsigned long)SR; LAYOUT[3] = (u32)(unsigned long)QB;
  LAYOUT[4] = (u32)(unsigned long)CTAG; LAYOUT[5] = (u32)(unsigned long)CDATA; LAYOUT[6] = (u32)(unsigned long)CLRU; LAYOUT[7] = (u32)(unsigned long)TLBNEXT;
  LAYOUT[8] = (u32)(unsigned long)IDLES; LAYOUT[9] = (u32)(unsigned long)IDLEP;
  LAYOUT[10] = GUEST; LAYOUT[11] = HEATR; LAYOUT[12] = HEATW;
#define AT(k, x) LAYOUT[k] = (u32)(unsigned long)(x)
  AT(13, TLBLIN); AT(14, TLBPHYS); AT(15, TLBFL); AT(16, TLBVALID);
  AT(17, T4LIN); AT(18, T4PHYS); AT(19, T4FL); AT(20, T4VALID); AT(21, T4NEXT);
  AT(22, ITLIN); AT(23, ITPHYS); AT(24, ITFL); AT(25, ITVALID); AT(26, ITNEXT);
  AT(27, DTAG); AT(28, DSTATE); AT(29, DLRU); AT(30, DDATA); AT(31, ITAG); AT(32, ILRU); AT(33, IDATA);
  AT(34, BTAG); AT(35, BTGT); AT(36, BCNT); AT(37, BNEXT); AT(38, IB); AT(39, PWHYA);
  AT(40, L2TAG); AT(41, L2STATE); AT(42, L2LRU); AT(43, RID1); AT(44, RIDG1); AT(45, RID0F); AT(46, RIDG0F); AT(47, RIDFP); AT(48, RIDMISC);
  for (int i = 0; i < 256; i++) { RID1[i] = -1; RID0F[i] = -1; }
  for (int i = 0; i < 2048; i++) { RIDG1[i] = -1; RIDG0F[i] = -1; RIDFP[i] = -1; }
  // P586_PK: 2 = a prefix, 4 = an opcode that never pairs, 0 = look at it
  for (int b = 0; b < 256; b++) PK[b] = 4;
  for (int b = 0; b < 0x40; b++) if ((b & 7) < 6) PK[b] = 0;
  for (int b = 0x40; b < 0x60; b++) PK[b] = 0;
  for (int b = 0x70; b < 0x80; b++) PK[b] = 0;
  for (int b = 0xB0; b < 0xC0; b++) PK[b] = 0;
  for (int b = 0xD8; b < 0xE0; b++) PK[b] = 0;
  static const u8 pk0[] = { 0x0F, 0x68, 0x6A, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x88, 0x89, 0x8A, 0x8B, 0x8D, 0x90, 0xA0, 0xA1, 0xA2, 0xA3,
    0xA8, 0xA9, 0xC0, 0xC1, 0xC6, 0xC7, 0xD0, 0xD1, 0xE8, 0xE9, 0xEB, 0xFE, 0xFF };
  for (unsigned i = 0; i < sizeof pk0; i++) PK[pk0[i]] = 0;
  static const u8 pk2[] = { 0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3 };
  for (unsigned i = 0; i < sizeof pk2; i++) PK[pk2[i]] = 2;
  return (u32)(unsigned long)LAYOUT;
}
// For the tests: one step of this core (no machine loop), or -1 when it goes to JavaScript.
EXPORT(step1) double step1(void) {
  if (!INHIBIT && (NMI || ((EFL & F_IF) && !SHUTDOWN && IRQ))) return -1;
  loadDec();
  if (!HALTED && needJS()) return -1;
  const double t = step();
  saveDec();
  return t;
}
