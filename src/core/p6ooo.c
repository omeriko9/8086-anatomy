// The Pentium Pro out-of-order timing model (CPU80686: ooo, sch, sbCheck, branch6) in C, for
// WebAssembly. It is a copy of the JavaScript model in cpu80686.js, line by line, without the
// trace parts: the fast mode uses it, the trace uses the JavaScript model (which makes the trace
// events). Both work on the same state: the typed arrays of the CPU (rob, rs, rat, ports, sb, oS,
// btb, the loads and stores of the step) are views into the memory of this module. So the two
// models must stay the same; tests/p6wasm.test.mjs runs programs with both and compares all the
// clocks. A change of the model in cpu80686.js needs the same change here, then
// `node tools/buildwasm.mjs` (clang --target=wasm32) makes src/core/p6ooo.wasm.js again.
//
// The clocks are doubles, as in JavaScript (the same values and the same compares).

typedef unsigned int u32;
typedef signed char i8;
typedef unsigned char u8;

#define CAL 512
#define MAXM 16
#define MAXREC 4096

enum { O_DCLK, O_DSLOT, O_DBYTES, O_FETCH, O_ICLK, O_ICNT, O_RCLK, O_RCNT, O_DIV, O_FMUL, O_FSB, O_STA, O_SBLAST,
       O_PREV, O_AVAIL, O_MINISS, O_UOP, O_SEQ, O_TOG, O_URET, O_UDISP, O_CYC, O_N };
enum { PC_0, PC_1, PC_01, PC_LD, PC_STA, PC_STD, PC_NONE };
enum { UK_ALU, UK_SHIFT, UK_LEA, UK_MUL, UK_DIV, UK_BR, UK_LOAD, UK_STA, UK_STD, UK_ESP, UK_FADD, UK_FMUL, UK_FDIV,
       UK_FMOV, UK_FXCH, UK_FCMP, UK_CMOV, UK_MS, UK_NOP };
enum { BK_JCC = 1, BK_JMP, BK_CALL, BK_RET, BK_JMPI, BK_CALLI, BK_LOOP, BK_FAR };
enum { AM_EA, AM_STACK, AM_STR, AM_FIX };
enum { UN_DIV = 1, UN_FMUL = 2 };
enum { SZ_W, SZ_B, SZ_O };
#define P6M_ECX 2
#define P6M_ESP 16
#define P6M_ESI 64
#define P6M_EDI 128
#define DEC_ISS 2
#define DQ 3
#define FE_RESTART 8
#define BACLEAR 5
#define L2LAT 4
#define REPSTART 6
static const int PORT[7] = { 0, 1, -1, 2, 3, 4, -1 };

// A recipe (the same fields as P686R in cpu80686.js).
typedef struct { int uR, uM, pc, lat, kind, unit, rG, wG, rE, wE, rO, wO, rM, wM, fR, fW, sz, am, amS, aM, esp, br, ser, ms, dyn, lea, lk, fp, fs, fd, fsw; } Recipe;

// The inputs of a step (written by the CPU before each call; see IN_* in cpu80686.js).
enum { IN_OP, IN_OP2, IN_MOD, IN_REG, IN_RM, IN_OSZ, IN_A32, IN_REP, IN_LOCK, IN_ILEN, IN_CLK, IN_NLD, IN_NST, IN_FPTOP,
       IN_CODELAT, IN_CODEBUS, IN_CYCLES, IN_FPUPC, IN_EA, IN_LA, IN_TAKEN, IN_TARGET, IN_SBYTE, IN_CALLRET, IN_N };
// The counters (oooStats and btb.stats; see ST_* in cpu80686.js).
enum { ST_STEPS, ST_INSTRUCTIONS, ST_UOPS, ST_FLOOR, ST_ROBFULL, ST_RSFULL, ST_SBFULL, ST_PARTIAL, ST_FORWARDS, ST_LDBLOCKS,
       ST_SPLITLOADS, ST_SERIAL, ST_MISPREDICTS, ST_BACLEARS, ST_MUL, ST_DIV, ST_FLOPS, ST_HALTCLK,
       B_BRANCHES, B_LOOKUPS, B_HITS, B_MISSES, B_RIGHT, B_WRONG, B_ALLOCS, B_TAKEN, B_STATICRIGHT, B_STATICWRONG, B_RSBRIGHT, B_RSBWRONG, ST_N };
// The small integers (see SC_* in cpu80686.js).
enum { SC_ROBPOS, SC_RSPOS, SC_SBPOS, SC_RSBTOP, SC_N };

// ---- the state (the CPU makes views of these arrays; offsets() gives their places) ----
static double oS[O_N], IN[IN_N], ST[ST_N], decoders[4];
static double robUop[40], robInstr[40], robIssue[40], robDispatch[40], robDone[40], robRetire[40];
static i8 robPort[40], robSrc1[40], robSrc2[40], robDst[40];
static u8 robKind[40];
static double rsUop[20], rsIssue[20], rsDispatch[20];
static i8 rsRob[20];
static i8 ratRob[18];
static double ratReady[18], ratRetire[18];
static u8 ratWidth[18];
static double busy[5 * CAL], portUops[5];
static u32 sbAddr[12];
static u8 sbBytes[12];
static double sbStd[12], sbCommit[12];
static i8 sbRob[12];
static u32 ldAddr[MAXM], stAddr[MAXM];
static u8 ldSize[MAXM], stSize[MAXM];
static double ldLat[MAXM], ldBus[MAXM], stLat[MAXM], stBus[MAXM];
static int btbTag[512];
static u32 btbTarget[512], rsb[16];
static u8 btbHist[512], pht[8192], btbCounter[512], btbNext[128];
static int SC[SC_N];
static Recipe REC[MAXREC];
// the scratch values of a step (fields of the CPU in JavaScript)
static int uRob, uWait, sbRobS, ldFwd;

static int offs[64];
int *offsets(void) {
  int k = 0;
#define P(x) offs[k++] = (int)(__INTPTR_TYPE__)(x)
  P(oS); P(IN); P(ST); P(decoders);
  P(robUop); P(robInstr); P(robIssue); P(robDispatch); P(robDone); P(robRetire);
  P(robPort); P(robSrc1); P(robSrc2); P(robDst); P(robKind);
  P(rsUop); P(rsIssue); P(rsDispatch); P(rsRob);
  P(ratRob); P(ratReady); P(ratRetire); P(ratWidth);
  P(busy); P(portUops);
  P(sbAddr); P(sbBytes); P(sbStd); P(sbCommit); P(sbRob);
  P(ldAddr); P(ldSize); P(ldLat); P(ldBus); P(stAddr); P(stSize); P(stLat); P(stBus);
  P(btbTag); P(btbTarget); P(btbHist); P(pht); P(btbCounter); P(btbNext); P(rsb);
  P(SC); P(REC);
#undef P
  offs[k++] = (int)sizeof(Recipe);
  return offs;
}

static inline int ctz(u32 m) { return __builtin_ctz(m); }
static inline int lowbit(int m) { return 31 - __builtin_clz((u32)(m & -m)); }   // (m != 0)

// The ready clock of the registers of a mask (uWait = the register that is ready last).
static double rdyOf(int m) {
  double t = 0; int w = -1;
  for (; m; m &= m - 1) { int r = ctz((u32)m); if (ratReady[r] > t) { t = ratReady[r]; w = r; } }
  uWait = w;
  return t;
}
static int srcOf(int r, double t) { return r >= 0 && ratRetire[r] > t ? ratRob[r] : -1; }

static double sch(int pc, double lat, double ready, int unit, int kind, int dst, int s1, int s2, double busT) {
  double *O = oS;
  double iss = O[O_ICLK], cnt = O[O_ICNT], av = O[O_AVAIL];
  if (O[O_MINISS] > av) av = O[O_MINISS];
  if (av > iss) { iss = av; cnt = 0; } else if (cnt >= 3) { iss++; cnt = 0; }
  int e = SC[SC_ROBPOS];
  if (robRetire[e] >= iss) { iss = robRetire[e] + 1; cnt = 0; ST[ST_ROBFULL]++; }
  double *SD = rsDispatch;
  int s = SC[SC_RSPOS];
  if (SD[s] >= iss) {
    double bt = SD[s];
    for (int j = 0; j < 20; j++) {
      double x = SD[j];
      if (x < iss) { s = j; bt = -1; break; }
      if (x < bt) { bt = x; s = j; }
    }
    if (bt >= iss) { iss = bt + 1; cnt = 0; ST[ST_RSFULL]++; }
  }
  O[O_ICLK] = iss; O[O_ICNT] = cnt + 1;
  double d = iss + 1;
  if (ready > d) d = ready;
  if (unit) { double f = unit == UN_DIV ? O[O_DIV] : O[O_FMUL]; if (f > d) d = f; }
  double *C = busy;
  int p;
  if (pc == PC_01) {
    for (;;) {
      int i = (int)((long long)d & 511);
      int f0 = C[i] != d, f1 = C[CAL + i] != d;
      if (f0 && f1) { p = (int)(O[O_TOG] = 1 - O[O_TOG]); break; }
      if (f0) { p = 0; break; }
      if (f1) { p = 1; break; }
      d++;
    }
  } else if (pc == PC_NONE) p = -1;
  else { p = PORT[pc]; int b = p * CAL; while (C[b + (int)((long long)d & 511)] == d) d++; }
  if (p >= 0) C[p * CAL + (int)((long long)d & 511)] = d;
  if (unit) { if (unit == UN_DIV) O[O_DIV] = d + lat; else O[O_FMUL] = d + 2; }
  if (busT > 0) {
    double bs = d + 3 + L2LAT;
    if (O[O_FSB] > bs) { lat += O[O_FSB] - bs; bs = O[O_FSB]; }
    O[O_FSB] = bs + busT;
  }
  double done = d + lat;
  double r = done + 1, rc = O[O_RCLK];
  if (r < rc) r = rc;
  if (r == rc) { if (O[O_RCNT] >= 3) { r++; O[O_RCNT] = 1; } else O[O_RCNT]++; } else O[O_RCNT] = 1;
  O[O_RCLK] = r;
  double id = O[O_UOP]++;
  robUop[e] = id; robInstr[e] = O[O_SEQ]; robKind[e] = (u8)kind; robPort[e] = (i8)p; robSrc1[e] = (i8)s1; robSrc2[e] = (i8)s2; robDst[e] = (i8)dst;
  robIssue[e] = iss; robDispatch[e] = d; robDone[e] = done; robRetire[e] = r;
  rsUop[s] = id; rsRob[s] = (i8)e; rsIssue[s] = iss; SD[s] = d;
  SC[SC_RSPOS] = s == 19 ? 0 : s + 1;
  SC[SC_ROBPOS] = e == 39 ? 0 : e + 1;
  if (p >= 0) portUops[p]++;
  uRob = e; O[O_URET] = r; O[O_UDISP] = d;
  return done;
}

static double sbCheck(u32 la, int n, double t) {
  int p = SC[SC_SBPOS];
  for (int j = 0; j < 12; j++) {
    p = p == 0 ? 11 : p - 1;
    double c = sbCommit[p];
    if (c <= t) break;
    u32 a = sbAddr[p], z = sbBytes[p];
    if ((double)la < (double)a + z && (double)a < (double)la + n) {
      sbRobS = sbRob[p];
      if (a <= la && (double)la + n <= (double)a + z) { ST[ST_FORWARDS]++; ldFwd = 1; return sbStd[p] > t ? sbStd[p] : t; }
      ST[ST_LDBLOCKS]++; ldFwd = 2;
      return c + 1 > t ? c + 1 : t;
    }
  }
  return t;
}

static void branch6(int kind, double bDone, double dec) {
  double *O = oS;
  u32 la = (u32)IN[IN_LA];
  int taken = IN[IN_TAKEN] != 0;
  u32 target = taken ? (u32)IN[IN_TARGET] : 0;
  int cond = kind == BK_JCC || kind == BK_LOOP;
  ST[B_BRANCHES]++;
  if (taken) ST[B_TAKEN]++;
  int how = 0, predT = 0, e = -1, hist = -1;
  u32 predTgt = 0;
  int set = la & 127, b = set << 2;
  if (kind == BK_RET) {
    how = 2;
    SC[SC_RSBTOP] = (SC[SC_RSBTOP] + 15) & 15;
    predT = 1; predTgt = rsb[SC[SC_RSBTOP]];
  } else {
    ST[B_LOOKUPS]++;
    int tag = (int)la;
    if (btbTag[b] == tag) e = b; else if (btbTag[b + 1] == tag) e = b + 1; else if (btbTag[b + 2] == tag) e = b + 2; else if (btbTag[b + 3] == tag) e = b + 3;
    if (e >= 0) {
      ST[B_HITS]++;
      if (cond) { hist = btbHist[e]; int ctr = pht[(e << 4) | hist]; predT = ctr >= 2; } else predT = 1;
      predTgt = btbTarget[e];
    } else {
      ST[B_MISSES]++; how = 1;
      if (cond) predT = IN[IN_SBYTE] != 0;
      else predT = kind == BK_JMP || kind == BK_CALL;
      predTgt = predT ? target : 0;
    }
  }
  int right = predT == taken && (!taken || predTgt == target);
  if (e >= 0 && cond) {
    int k = (e << 4) | hist, c = pht[k];
    pht[k] = (u8)(taken ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0));
    btbHist[e] = (u8)(((hist << 1) | (taken ? 1 : 0)) & 15);
  }
  if (kind != BK_RET) {
    if (e >= 0) { if (taken) btbTarget[e] = target; }
    else if (taken) {
      int x = btbNext[set];
      btbNext[set] = (u8)((x + 1) & 3);
      e = b + x; ST[B_ALLOCS]++;
      btbTag[e] = (int)la; btbTarget[e] = target; btbHist[e] = 1;
      for (int j = e << 4; j < (e << 4) + 16; j++) pht[j] = 2;
    }
    if (e >= 0) btbCounter[e] = pht[(e << 4) | btbHist[e]];
  }
  if (kind == BK_CALL || kind == BK_CALLI) { rsb[SC[SC_RSBTOP]] = (u32)IN[IN_CALLRET]; SC[SC_RSBTOP] = (SC[SC_RSBTOP] + 1) & 15; }
  if (right) {
    ST[B_RIGHT]++;
    if (how == 1) ST[B_STATICRIGHT]++; else if (how == 2) ST[B_RSBRIGHT]++;
    if (taken) {
      if (how == 1) { ST[ST_BACLEARS]++; if (dec + BACLEAR > O[O_FETCH]) O[O_FETCH] = dec + BACLEAR; }
      else if (O[O_DCLK] <= dec) { O[O_DCLK] = dec + 1; O[O_DSLOT] = 0; O[O_DBYTES] = 0; }
    }
  } else {
    ST[B_WRONG]++;
    if (how == 1) ST[B_STATICWRONG]++; else if (how == 2) ST[B_RSBWRONG]++;
    ST[ST_MISPREDICTS]++;
    double t = bDone + FE_RESTART;
    if (t > O[O_FETCH]) O[O_FETCH] = t;
  }
}

// One step of the model (CPU80686.ooo without the trace). ri: the recipe index (REC).
double ooo(int mode, int ri) {
  double *O = oS;
  const Recipe *R = &REC[ri];
  int op = (int)IN[IN_OP], mod = (int)IN[IN_MOD], memForm = mod >= 0 && mod != 3;
  int nLdA = (int)IN[IN_NLD], nStA = (int)IN[IN_NST];
  int nLd = nLdA < MAXM ? nLdA : MAXM, nSt = nStA < MAXM ? nStA : MAXM;
  int u = memForm ? R->uM : R->uR;
  if (R->dyn) { u += (int)IN[IN_CLK] >> 2; if (u > 64) u = 64; }
  u += (nLdA - nLd) + 2 * (nStA - nSt);
  int rep = mode <= 1 && R->am == AM_STR && IN[IN_REP] != 0;
  if (rep && mode == 0) u += REPSTART;
  if (u > 64) u = 64;
  int esp = R->esp;
  int n = nLd + esp + u + 2 * nSt;
  if (n == 0) { u = 1; n = 1; }
  int ms = R->ms != 0 || n > 4 || rep || mode >= 2;
  ++O[O_SEQ];
  ST[ST_STEPS]++; ST[ST_UOPS] += n;
  int osz = (int)IN[IN_OSZ], reg = (int)IN[IN_REG], rm = (int)IN[IN_RM];
  int w = R->sz == SZ_B ? 1 : R->sz == SZ_O ? osz : (((op == 0x0F ? (int)IN[IN_OP2] : op) & 1) ? osz : 1);
  int rdM = R->rM, wrM = R->wM;
  if (rep) { rdM |= P6M_ECX; wrM |= P6M_ECX; }
  if (R->rG || R->wG) { int g = w == 1 ? reg & 3 : reg; if (R->rG) rdM |= 1 << g; if (R->wG) wrM |= 1 << g; }
  if (mod == 3 && (R->rE || R->wE)) { int x = w == 1 ? rm & 3 : rm; if (R->rE) rdM |= 1 << x; if (R->wE) wrM |= 1 << x; }
  if (R->rO || R->wO) { int x = R->sz == SZ_B ? op & 3 : (op == 0x0F ? (int)IN[IN_OP2] : op) & 7; if (R->rO) rdM |= 1 << x; if (R->wO) wrM |= 1 << x; }
  if (R->fR) rdM |= 0x100;
  if (R->fW) wrM |= 0x100;
  int fx0 = -1, fx1 = -1;
  if (R->fp) {
    int t0 = (int)IN[IN_FPTOP], i = rm & 7;
    if (R->fs & 1) rdM |= 1 << (10 + t0);
    if (R->fs & 2) rdM |= 1 << (10 + ((t0 + i) & 7));
    if (R->fs & 4) rdM |= 0x200;
    if (R->fd == 1) wrM |= 1 << (10 + t0);
    else if (R->fd == 2) wrM |= 1 << (10 + ((t0 + i) & 7));
    else if (R->fd == 3) wrM |= 1 << (10 + ((t0 + 7) & 7));
    if (R->fsw) wrM |= 0x200;
    if (R->kind == UK_FXCH) { fx0 = 10 + t0; fx1 = 10 + ((t0 + i) & 7); }
  }
  int aL = 0, aS = 0;
  if (nLd + nSt > 0 || R->lea) {
    int ea = memForm ? (int)IN[IN_EA] : 0;
    aL = R->am == AM_EA ? ea : R->am == AM_STACK ? P6M_ESP : R->am == AM_STR ? (P6M_ESI | P6M_EDI) : R->aM;
    aS = R->amS == AM_EA ? ea : R->amS == AM_STACK ? P6M_ESP : R->amS == AM_STR ? P6M_EDI : R->aM;
    if (mode >= 2) { aL = 0; aS = P6M_ESP; }
    if (R->lea) rdM |= ea;
  }
  // ---- the front end: the decode clock ----
  int len = mode == 0 ? (int)IN[IN_ILEN] : 0;
  double dc = O[O_DCLK], slot = O[O_DSLOT], bytes = O[O_DBYTES], fe = O[O_FETCH];
  double iq = O[O_ICLK] - DQ;
  if (iq > fe) fe = iq;
  double codeLat = IN[IN_CODELAT], codeBus = IN[IN_CODEBUS];
  if (codeLat > 0) {
    double cs = dc > fe ? dc : fe;
    if (codeBus > 0) { if (O[O_FSB] > cs) cs = O[O_FSB]; O[O_FSB] = cs + codeBus; }
    if (cs + codeLat > fe) fe = cs + codeLat;
  }
  if (fe > dc) { dc = fe; slot = 0; bytes = 0; }
  if (ms || n > 1) { if (slot > 0) { dc++; slot = 0; bytes = 0; } }
  else if (slot >= 3 || (slot > 0 && bytes + len > 16)) { dc++; slot = 0; bytes = 0; }
  double dec = dc;
  int decoder = ms ? 3 : (int)slot;
  if (ms) { dc += (n + 3) >> 2; slot = 0; bytes = 0; } else { slot++; bytes += len; }
  decoders[decoder]++;
  double av = dec + DEC_ISS;
  int ser = R->ser != 0 || mode >= 2 || (mode == 0 && (IN[IN_LOCK] != 0 || (R->lk != 0 && memForm)));
  if (ser) {
    double t = O[O_RCLK] + 1;
    if (IN[IN_CYCLES] > t) t = IN[IN_CYCLES];
    if (t > av) av = t;
    ST[ST_SERIAL]++;
  }
  O[O_AVAIL] = av; O[O_MINISS] = 0;
  int aw = IN[IN_A32] != 0 ? 4 : 2;
  for (int m = (rdM | aL | aS) & 0xFF; m; m &= m - 1) {
    int r = ctz((u32)m), rw = ((aL | aS) & (1 << r)) ? aw : w;
    if (ratWidth[r] < rw && ratRetire[r] > av) { if (ratRetire[r] + 1 > O[O_MINISS]) O[O_MINISS] = ratRetire[r] + 1; ST[ST_PARTIAL]++; }
  }
  // ---- loads ----
  double aLr = rdyOf(aL); int aLw = uWait;
  double ldDone = 0; int ldRob = -1;
  int ldDst = u == 0 ? (wrM ? lowbit(wrM) : -1) : -1;
  for (int k = 0; k < nLd; k++) {
    double ready = aLr;
    if (O[O_STA] > ready) ready = O[O_STA];
    ldFwd = 0; sbRobS = -1;
    if (O[O_SBLAST] > ready) ready = sbCheck(ldAddr[k], ldSize[k], ready > av + 1 ? ready : av + 1);
    double done = sch(PC_LD, 3 + ldLat[k], ready, 0, UK_LOAD, k == nLd - 1 ? ldDst : -1, srcOf(aLw, av), sbRobS, ldBus[k]);
    if (done > ldDone) { ldDone = done; ldRob = uRob; }
  }
  // ---- the ESP µop of a stack instruction ----
  double espDone = 0, espRet = 0; int espRob = -1;
  if (esp) {
    espDone = sch(PC_01, 1, ratReady[4], 0, UK_ESP, 4, srcOf(4, av), -1, 0);
    espRob = uRob; espRet = O[O_URET];
  }
  // ---- the compute µops (a chain) ----
  double cDone = 0; int cRob = -1;
  double regR = rdyOf(rdM); int regW = uWait;
  if (u > 0) {
    double ready = regR; int s1 = srcOf(regW, av);
    if (ldDone > ready) { ready = ldDone; s1 = ldRob; }
    double lat = R->lat; int unit = R->unit;
    if (R->kind == UK_DIV) lat = (w == 1 ? 19 : w == 2 ? 23 : 39) - (u - 1);
    else if (R->kind == UK_FDIV) {
      static const double A[4] = { 17, 37, 32, 37 }, B[4] = { 29, 69, 58, 69 };
      int pc = (int)IN[IN_FPUPC] & 3;
      lat = R->lat == 37 ? A[pc] : B[pc];
    }
    if (R->kind == UK_MUL || R->kind == UK_FMUL) ST[ST_MUL]++;
    if (R->kind == UK_DIV || R->kind == UK_FDIV) ST[ST_DIV]++;
    if (R->fp && (R->kind == UK_FADD || R->kind == UK_FMUL || R->kind == UK_FDIV)) ST[ST_FLOPS]++;
    int dst = wrM ? lowbit(wrM) : -1;
    for (int j = 0; j < u; j++) {
      int last = j == u - 1;
      cDone = sch(last ? R->pc : PC_01, last ? lat : 1, ready, last ? unit : 0, last ? R->kind : ms ? UK_MS : UK_ALU,
        last ? dst : -1, j == 0 ? s1 : cRob, j == 0 && ldRob >= 0 && s1 != ldRob ? ldRob : -1, 0);
      cRob = uRob;
      ready = cDone;
    }
  }
  // ---- stores: STA and STD, then the store buffer ----
  if (nSt > 0) {
    double aSr = rdyOf(aS); int aSw = uWait;
    double dR = u > 0 ? cDone : regR; int dRob = u > 0 ? cRob : srcOf(regW, av);
    if (u == 0 && ldDone > dR) { dR = ldDone; dRob = ldRob; }
    for (int k = 0; k < nSt; k++) {
      int p = SC[SC_SBPOS];
      if (sbCommit[p] >= O[O_ICLK] && sbCommit[p] + 1 > O[O_MINISS]) { O[O_MINISS] = sbCommit[p] + 1; ST[ST_SBFULL]++; }
      double staDone = sch(PC_STA, 1, aSr, 0, UK_STA, -1, srcOf(aSw, av), -1, 0);
      if (staDone > O[O_STA]) O[O_STA] = staDone;
      double stdDone = sch(PC_STD, 1, dR, 0, UK_STD, -1, dRob, -1, 0);
      sbRob[p] = (i8)uRob;
      double c = O[O_URET] + 1;
      if (O[O_SBLAST] + 1 > c) c = O[O_SBLAST] + 1;
      double b = stBus[k];
      if (b > 0) { if (O[O_FSB] > c) c = O[O_FSB]; O[O_FSB] = c + b; }
      c += stLat[k];
      sbAddr[p] = stAddr[k]; sbBytes[p] = stSize[k]; sbStd[p] = stdDone; sbCommit[p] = c;
      O[O_SBLAST] = c;
      SC[SC_SBPOS] = p == 11 ? 0 : p + 1;
    }
  }
  double M = O[O_RCLK];
  // ---- the RAT ----
  double pDone = cDone; int pRob = cRob;
  if (u == 0) { pDone = nLd ? ldDone : espDone; pRob = nLd ? ldRob : espRob; }
  if (fx0 >= 0) {
    double x = ratReady[fx0]; ratReady[fx0] = ratReady[fx1]; ratReady[fx1] = x;
    x = ratRetire[fx0]; ratRetire[fx0] = ratRetire[fx1]; ratRetire[fx1] = x;
    i8 y = ratRob[fx0]; ratRob[fx0] = ratRob[fx1]; ratRob[fx1] = y;
  } else {
    for (int m = wrM; m; m &= m - 1) {
      int r = ctz((u32)m);
      ratReady[r] = pDone; ratRob[r] = (i8)pRob; ratRetire[r] = M; ratWidth[r] = (u8)(r < 8 ? w : 4);
    }
  }
  if (esp) { ratReady[4] = espDone; ratRob[4] = (i8)espRob; ratRetire[4] = espRet; ratWidth[4] = 4; }
  // the decode state of this step goes back first: branch6 can start a new decode group after it
  O[O_DCLK] = dc; O[O_DSLOT] = slot; O[O_DBYTES] = bytes;
  // ---- branches, far transfers and serializing instructions ----
  if (R->br && mode == 0) {
    if (R->br == BK_FAR) { double t = cDone + FE_RESTART; if (t > O[O_FETCH]) O[O_FETCH] = t; }
    else branch6(R->br, cDone, dec);
  }
  if (ser) { double t = mode >= 2 ? M : M + 1; if (t > O[O_FETCH]) O[O_FETCH] = t; }
  O[O_PREV] = M;
  if (mode == 0) ST[ST_INSTRUCTIONS]++;
  return M;
}
