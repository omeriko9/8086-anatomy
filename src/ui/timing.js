// Bus timing view: a live logic analyser on the maximum-mode 8086 local bus.
// Each 'fetch' / 'bus' micro-event starts a 4-clock bus cycle (T1..T4); other clocks
// are idle (Ti). A ring buffer keeps the last TV_CAP clocks. From it the view draws the
// 8086 pins, the 8288 bus controller outputs and the 8087 RQ/GT0 handshake.
//
// Timing rules (fractions are parts of one clock; a T-state starts at the CLK fall):
//  CLK        33 % duty: low 0..2/3, high 2/3..1.
//  S2..S0     active from 2/3 of the clock before T1, passive (111) from the start of T3.
//  ALE        high 0.05..0.6 of T1 (not for HALT status).
//  MRDC IORC INTA AMWC AIOWC   low from T2 to the start of T4.
//  MWTC IOWC  (normal write)   low from T3 to the start of T4.
//  DT/R       low for read cycles from 1/3 of T1 to the middle of T4.
//  DEN        (8288, active high) reads 2/3 of T2 .. start of T4; writes T2 .. middle of T4.
//  AD15..AD0  address in T1; reads float in T2 and carry data in T3..T4; writes carry
//             data from T2.  A19..A16 carry the address in T1 and S6..S3 after it.
//  BHE        valid in T1 (low for a word or an odd byte); S7 after T1.
//  QS1 QS0    00 none, 01 first byte (F), 10 empty / flush (E), 11 subsequent byte (S).
//  RQ/GT0     8087 request pulse, 8086 grant pulse, 8087 release pulse (one clock each).
//  LOCK       low for a LOCK-prefixed instruction and from T2 of INTA 1 to T2 of INTA 2.
//
// 80286 model (app.model === '80286'): the 80286 local bus and the 82288. A bus cycle is
// Ts (status) + Tc (command) + Tw (wait states; e.len = clocks of the cycle, usually 3).
// One T-state = one processor clock = two CLK periods (the 82284 CLK is 2x). Rules:
//  S1 S0      low (the status code) during Ts only.
//  A23..A0, M/IO, COD/INTA, BHE   pipelined: valid from the middle of the previous Tc
//             when the cycles are back to back (else from the start of Ts) to the middle
//             of Tc. The address bus is not multiplexed with data.
//  ALE        high in the second half of Ts.   MCE  high Ts/2 .. Tc/2 of INTA cycles.
//  MRDC MWTC IORC IOWC INTA  low from the start of Tc to the end of the cycle.
//  DEN        reads: middle of Tc .. end; writes: middle of Ts .. half a clock after the end.
//  DT/R       low for reads from Ts to half a clock after the end.
//  READY      low (ready) in the last state of the cycle.
//  D15..D0    reads: middle of Tc .. end; writes: middle of Ts .. half a clock after the end.
//
// 80386 model (app.model === '80386'): the 80386 local bus with a 16-bit data bus, as on the
// 386SX. A bus cycle is T1 + T2 (e.len = 2 + wait states; each wait state repeats T2). The view
// uses the 80286 code paths (this.m286 is true) with these rules (this.m386):
//  CLK2       twice the processor clock: two CLK2 periods make one T-state.
//  ADS        low in T1 (the address and the status are valid).
//  M/IO D/C W/R, A23..A1, BHE BLE   valid from the start of T1 to the end of the cycle; the
//             board does not use NA, so there is no address pipelining.
//  READY      low in the second half of the last T2.
//  D15..D0    reads: the second half of the last T2; writes: the middle of T1 .. the end.
//  MRDC MWTC IORC IOWC INTA   the commands of the board's 82288 (it gets the cycle type from
//             the 80386 status): low from the start of T2 to the end of the cycle.
//
// 80486 model (app.model === '80486'): the 80486 bus with BS16# (the board has a 16-bit data
// bus). The view uses the 80386 code paths (this.m386 is true) with these rules (this.m486):
//  CLK        one period for each T-state (no CLK2).
//  A line fill is a burst: 8 word transfers ('bus' / 'fetch' events with burst: true, beat 0-7).
//             The first transfer is T1 + T2, the others are T2 only (2-1-1-1 timing on a 32-bit
//             bus; here each dword is two word transfers). ADS# is low only in the T1 of the burst.
//  KEN#       low in the first transfer of a line fill (the board says: cacheable).
//  BRDY#      low in the second half of the last clock of each burst transfer; RDY# does the
//             same for a cycle that is not a burst.
//  BLAST#     low in the last transfer of a burst, and in the T2 of a cycle that is not a burst.
//  BS16#      low in each bus cycle: the board has a 16-bit data bus.
//  BE3#-BE0#  the byte enables of the dword (a word at an offset of 2 uses BE3# and BE2#).
//  cache      a decoded row (not a pin): the 'cache' events. A read hit makes no bus cycle,
//             so the row shows it as a note at its clock.
//
// Pentium Pro model (app.model === '80686' with the P6 core, cpu.rob): the P6 front-side bus
// (FSB). The view uses the Pentium paths (m586: the 64-bit data bus, 8 byte lanes, BE7#-BE0#,
// bursts of 4 x 8 bytes) with these rules (this.m686):
//  positions  one position is one core clock; bus.busRatio core clocks (bR, 3 at 200 / 66 MHz)
//             make one bus clock (BCLK). Each transaction starts at a BCLK edge.
//  phases     a simplified model of the pipelined P6 bus, one transaction at a time: request
//             phase a (ADS#, A31-A3, REQ4#-REQ0# = the type), request phase b (REQ = the length,
//             BE7#-BE0#), the snoop phase (HIT# and HITM# stay high: no other cache), then the
//             response phase (RS2#-RS0#) with the first data transfer (DRDY#). A line read or a
//             write-back has 3 more transfers (DBSY# low until the last one). A write has TRDY#
//             one BCLK before its data. The request and snoop phases are the 2 bus clocks of
//             the core model (fsbReq), put before the first transfer of each transaction.
//  decoded    cache (L1 hit, L2 hit on the back-side bus, L2 miss with the FSB fill), retire
//             (the µops that retire in each clock, from the 'uop' events) and BTB rows.

const TV_CAP = 2048, TV_MASK = TV_CAP - 1;
const TV_GAP = 9;
const TV_STATUS = { inta: 0, ior: 1, iow: 2, halt: 3, code: 4, memr: 5, memw: 6, shutdown: 8 };
const TV_STATE_NAME = ['INTA', 'IOR', 'IOW', 'HALT', 'CODE', 'MEMR', 'MEMW', 'PASV', 'SHUTDOWN'];
const TV_F_INTR = 1, TV_F_NMI = 2, TV_F_LOCK = 4, TV_F_FPU = 8, TV_F_BUSY = 16, TV_F_PEREQ = 32, TV_F_ERR = 64;
const TV_QS = ['–', 'F', 'E', 'S'];
const TV_TNAME = ['Ti', 'T1', 'T2', 'T3', 'T4'];
const TV_ZOOM_MIN = 1.2, TV_ZOOM_MAX = 90;

// Row groups. act: the level at which the pin is "active" (0 = active low). Labels:
// {..} puts an overbar on the enclosed characters.
const TV_GROUPS = [
  { name: 'Clock', short: 'CLK', rows: [
    { id: 'clk', label: 'CLK', kind: 'clk', col: 'text', tall: 1.9, tip: '8284 clock, 4.77 MHz, 33 % duty' },
    { id: 'ready', label: 'READY', kind: 'dig', col: 'muted', tip: '8284 READY: no wait states on this board' },
  ] },
  { name: '8086 status', short: 'Status', rows: [
    { id: 's2', label: '{S2}', kind: 'dig', col: 'text', act: 0 },
    { id: 's1', label: '{S1}', kind: 'dig', col: 'text', act: 0 },
    { id: 's0', label: '{S0}', kind: 'dig', col: 'text', act: 0 },
    { id: 'state', label: 'bus state', kind: 'bus' },
    { id: 'qs1', label: 'QS1', kind: 'dig', col: 'goldHi', act: 1 },
    { id: 'qs0', label: 'QS0', kind: 'dig', col: 'goldHi', act: 1 },
  ] },
  { name: 'Address · data', short: 'Bus', rows: [
    { id: 'ad', label: 'AD15–AD0', kind: 'bus' },
    { id: 'ah', label: 'A19–A16/S6–S3', kind: 'bus' },
    { id: 'bhe', label: '{BHE}/S7', kind: 'dig', col: 'cyan', act: 0 },
  ] },
  { name: '8288 bus controller', short: '8288', rows: [
    { id: 'ale', label: 'ALE', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'mrdc', label: '{MRDC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'mwtc', label: '{MWTC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'amwc', label: '{AMWC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iorc', label: '{IORC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iowc', label: '{IOWC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'aiowc', label: '{AIOWC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'inta', label: '{INTA}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'dtr', label: 'DT/{R}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'den', label: 'DEN', kind: 'dig', col: 'magenta', act: 1 },
  ] },
  { name: 'Arbitration · interrupts', short: 'RQ·INT', rows: [
    { id: 'rq', label: '{RQ}/{GT0}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'intr', label: 'INTR', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'nmi', label: 'NMI', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'lock', label: '{LOCK}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
];

// 80286 status: [COD/INTA, M/IO, S1, S0] for each status code (Intel 80286 data sheet).
// HALT and SHUTDOWN share 0 1 0 0; A1 = 1 means halt, A1 = 0 shutdown.
const TV_286_BITS = { 0: [0, 0, 0, 0], 1: [1, 0, 0, 1], 2: [1, 0, 1, 0], 3: [0, 1, 0, 0], 4: [1, 1, 0, 1], 5: [0, 1, 0, 1], 6: [0, 1, 1, 0], 8: [0, 1, 0, 0] };
const TV_GROUPS_286 = [
  { name: 'Clock', short: 'CLK', rows: [
    { id: 'clk', label: 'CLK', kind: 'clk', col: 'text', tall: 1.9 },
    { id: 'ready', label: '{READY}', kind: 'dig', col: 'phosphor', act: 0 },
  ] },
  { name: '80286 status', short: 'Status', rows: [
    { id: 's1', label: '{S1}', kind: 'dig', col: 'text', act: 0 },
    { id: 's0', label: '{S0}', kind: 'dig', col: 'text', act: 0 },
    { id: 'mio', label: 'M/{IO}', kind: 'dig', col: 'text' },
    { id: 'cod', label: 'COD/{INTA}', kind: 'dig', col: 'text' },
    { id: 'state', label: 'bus state', kind: 'bus' },
  ] },
  { name: 'Address · data', short: 'Bus', rows: [
    { id: 'a', label: 'A23–A0', kind: 'bus' },
    { id: 'd', label: 'D15–D0', kind: 'bus' },
    { id: 'bhe', label: '{BHE}', kind: 'dig', col: 'cyan', act: 0 },
  ] },
  { name: '82288 bus controller', short: '82288', rows: [
    { id: 'ale', label: 'ALE', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'mrdc', label: '{MRDC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'mwtc', label: '{MWTC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iorc', label: '{IORC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iowc', label: '{IOWC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'inta', label: '{INTA}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'den', label: 'DEN', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'dtr', label: 'DT/{R}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'mce', label: 'MCE', kind: 'dig', col: 'magenta', act: 1 },
  ] },
  { name: '80287', short: '287', rows: [
    { id: 'pereq', label: 'PEREQ', kind: 'dig', col: 'lavender', act: 1 },
    { id: 'peack', label: '{PEACK}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'busy', label: '{BUSY}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'error', label: '{ERROR}', kind: 'dig', col: 'lavender', act: 0 },
  ] },
  { name: 'System', short: 'Sys', rows: [
    { id: 'hold', label: 'HOLD', kind: 'dig', col: 'muted', act: 1 },
    { id: 'hlda', label: 'HLDA', kind: 'dig', col: 'muted', act: 1 },
    { id: 'intr', label: 'INTR', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'nmi', label: 'NMI', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'lock', label: '{LOCK}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
];
const TV_CLK286 = [0, 0, 0.25, 1, 0.5, 0, 0.75, 1];
const TV_PEACK = [0, 1, 0.05, 0, 0.95, 1];
// 80386 status: [M/IO, D/C, W/R] for each status code (Intel 386 data sheet).
// HALT and SHUTDOWN are special cycles 1 0 1; the address (2 or 0) tells them apart.
const TV_386_BITS = { 0: [0, 0, 0], 1: [0, 1, 0], 2: [0, 1, 1], 3: [1, 0, 1], 4: [1, 0, 0], 5: [1, 1, 0], 6: [1, 1, 1], 8: [1, 0, 1] };
const TV_GROUPS_386 = [
  { name: 'Clock', short: 'CLK', rows: [
    { id: 'clk', label: 'CLK2', kind: 'clk', col: 'text', tall: 1.9 },
    { id: 'ready', label: '{READY}', kind: 'dig', col: 'phosphor', act: 0 },
    { id: 'na', label: '{NA}', kind: 'dig', col: 'muted', act: 0 },
  ] },
  { name: '80386 status', short: 'Status', rows: [
    { id: 'ads', label: '{ADS}', kind: 'dig', col: 'text', act: 0 },
    { id: 'mio', label: 'M/{IO}', kind: 'dig', col: 'text' },
    { id: 'dc', label: 'D/{C}', kind: 'dig', col: 'text' },
    { id: 'wr', label: 'W/{R}', kind: 'dig', col: 'text' },
    { id: 'state', label: 'bus state', kind: 'bus' },
  ] },
  { name: 'Address · data', short: 'Bus', rows: [
    { id: 'a', label: 'A23–A1', kind: 'bus' },
    { id: 'd', label: 'D15–D0', kind: 'bus' },
    { id: 'bhe', label: '{BHE}', kind: 'dig', col: 'cyan', act: 0 },
    { id: 'ble', label: '{BLE}', kind: 'dig', col: 'cyan', act: 0 },
  ] },
  { name: '82288 bus controller', short: '82288', rows: [
    { id: 'mrdc', label: '{MRDC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'mwtc', label: '{MWTC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iorc', label: '{IORC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iowc', label: '{IOWC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'inta', label: '{INTA}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
  { name: '80387', short: '387', rows: [
    { id: 'pereq', label: 'PEREQ', kind: 'dig', col: 'lavender', act: 1 },
    { id: 'busy', label: '{BUSY}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'error', label: '{ERROR}', kind: 'dig', col: 'lavender', act: 0 },
  ] },
  { name: 'System', short: 'Sys', rows: [
    { id: 'hold', label: 'HOLD', kind: 'dig', col: 'muted', act: 1 },
    { id: 'hlda', label: 'HLDA', kind: 'dig', col: 'muted', act: 1 },
    { id: 'intr', label: 'INTR', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'nmi', label: 'NMI', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'lock', label: '{LOCK}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
];
// 80486: the 80486 bus with BS16#, the burst signals and a decoded cache row.
const TV_GROUPS_486 = [
  { name: 'Clock', short: 'CLK', rows: [
    { id: 'clk', label: 'CLK', kind: 'clk', col: 'text', tall: 1.9 },
    { id: 'brdy', label: '{BRDY}', kind: 'dig', col: 'phosphor', act: 0 },
    { id: 'rdy', label: '{RDY}', kind: 'dig', col: 'phosphor', act: 0 },
  ] },
  { name: '80486 status', short: 'Status', rows: [
    { id: 'ads', label: '{ADS}', kind: 'dig', col: 'text', act: 0 },
    { id: 'mio', label: 'M/{IO}', kind: 'dig', col: 'text' },
    { id: 'dc', label: 'D/{C}', kind: 'dig', col: 'text' },
    { id: 'wr', label: 'W/{R}', kind: 'dig', col: 'text' },
    { id: 'state', label: 'bus state', kind: 'bus' },
  ] },
  { name: 'Address · data', short: 'Bus', rows: [
    { id: 'a', label: 'A31–A2', kind: 'bus' },
    { id: 'be', label: '{BE3}–{BE0}', kind: 'bus' },
    { id: 'd', label: 'D15–D0', kind: 'bus' },
    { id: 'bs16', label: '{BS16}', kind: 'dig', col: 'cyan', act: 0 },
  ] },
  { name: 'Burst · cache', short: 'Burst', rows: [
    { id: 'blast', label: '{BLAST}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'ken', label: '{KEN}', kind: 'dig', col: 'cyan', act: 0 },
    { id: 'cache', label: 'cache', kind: 'bus' },
  ] },
  { name: '82288 bus controller', short: '82288', rows: [
    { id: 'mrdc', label: '{MRDC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'mwtc', label: '{MWTC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iorc', label: '{IORC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'iowc', label: '{IOWC}', kind: 'dig', col: 'magenta', act: 0 },
    { id: 'inta', label: '{INTA}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
  { name: 'System', short: 'Sys', rows: [
    { id: 'ferr', label: '{FERR}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'hold', label: 'HOLD', kind: 'dig', col: 'muted', act: 1 },
    { id: 'hlda', label: 'HLDA', kind: 'dig', col: 'muted', act: 1 },
    { id: 'intr', label: 'INTR', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'nmi', label: 'NMI', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'lock', label: '{LOCK}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
];
const TV_CLK486 = [0, 1, 0.5, 0];
// Pentium (P5): the 64-bit bus, the burst and cache pins, and three decoded rows (cache, pipes, BTB).
const TV_GROUPS_586 = [
  { name: 'Clock', short: 'CLK', rows: [
    { id: 'clk', label: 'CLK', kind: 'clk', col: 'text', tall: 1.9 },
    { id: 'brdy', label: '{BRDY}', kind: 'dig', col: 'phosphor', act: 0 },
    { id: 'na', label: '{NA}', kind: 'dig', col: 'muted', act: 0 },
  ] },
  { name: 'Pentium status', short: 'Status', rows: [
    { id: 'ads', label: '{ADS}', kind: 'dig', col: 'text', act: 0 },
    { id: 'mio', label: 'M/{IO}', kind: 'dig', col: 'text' },
    { id: 'dc', label: 'D/{C}', kind: 'dig', col: 'text' },
    { id: 'wr', label: 'W/{R}', kind: 'dig', col: 'text' },
    { id: 'state', label: 'bus state', kind: 'bus' },
  ] },
  { name: 'Address · data', short: 'Bus', rows: [
    { id: 'a', label: 'A31–A3', kind: 'bus' },
    { id: 'be', label: '{BE7}–{BE0}', kind: 'bus' },
    { id: 'd', label: 'D63–D0', kind: 'bus' },
  ] },
  { name: 'Burst · cache', short: 'Cache', rows: [
    { id: 'cachen', label: '{CACHE}', kind: 'dig', col: 'cyan', act: 0 },
    { id: 'ken', label: '{KEN}', kind: 'dig', col: 'cyan', act: 0 },
    { id: 'cache', label: 'cache', kind: 'bus' },
  ] },
  { name: 'Pipes · BTB', short: 'Pipe', rows: [
    { id: 'pipe', label: 'pipes U V', kind: 'bus' },
    { id: 'btb', label: 'BTB', kind: 'bus' },
  ] },
  { name: 'System', short: 'Sys', rows: [
    { id: 'ferr', label: '{FERR}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'hold', label: 'HOLD', kind: 'dig', col: 'muted', act: 1 },
    { id: 'hlda', label: 'HLDA', kind: 'dig', col: 'muted', act: 1 },
    { id: 'intr', label: 'INTR', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'nmi', label: 'NMI', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'lock', label: '{LOCK}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
];
// Pentium Pro (P6): the front-side bus phases (request, snoop, response, data) and the decoded
// rows of the out-of-order core (the caches, the retire of the µops, the branch prediction).
const TV_GROUPS_686 = [
  { name: 'Clocks', short: 'CLK', rows: [
    { id: 'clk', label: 'BCLK', kind: 'clk', col: 'text', tall: 1.9 },
    { id: 'core', label: 'core clock', kind: 'dig', col: 'muted' },
  ] },
  { name: 'Request phase', short: 'Req', rows: [
    { id: 'ads', label: '{ADS}', kind: 'dig', col: 'text', act: 0 },
    { id: 'req', label: '{REQ4}–{REQ0}', kind: 'bus' },
    { id: 'a', label: 'A31–A3', kind: 'bus' },
    { id: 'be', label: '{BE7}–{BE0}', kind: 'bus' },
    { id: 'bnr', label: '{BNR}', kind: 'dig', col: 'muted', act: 0 },
    { id: 'bpri', label: '{BPRI}', kind: 'dig', col: 'muted', act: 0 },
  ] },
  { name: 'Snoop phase', short: 'Snoop', rows: [
    { id: 'hit', label: '{HIT}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'hitm', label: '{HITM}', kind: 'dig', col: 'lavender', act: 0 },
  ] },
  { name: 'Response · data', short: 'Data', rows: [
    { id: 'rs', label: '{RS2}–{RS0}', kind: 'bus' },
    { id: 'trdy', label: '{TRDY}', kind: 'dig', col: 'phosphor', act: 0 },
    { id: 'drdy', label: '{DRDY}', kind: 'dig', col: 'phosphor', act: 0 },
    { id: 'dbsy', label: '{DBSY}', kind: 'dig', col: 'gold', act: 0 },
    { id: 'd', label: 'D63–D0', kind: 'bus' },
  ] },
  { name: 'Decoded', short: 'Dec', rows: [
    { id: 'state', label: 'transaction', kind: 'bus' },
    { id: 'phase', label: 'bus phase', kind: 'bus' },
    { id: 'cache', label: 'L1 · L2', kind: 'bus' },
    { id: 'retire', label: 'retire', kind: 'bus' },
    { id: 'btb', label: 'BTB', kind: 'bus' },
  ] },
  { name: 'System', short: 'Sys', rows: [
    { id: 'ferr', label: '{FERR}', kind: 'dig', col: 'lavender', act: 0 },
    { id: 'intr', label: 'LINT0/INTR', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'nmi', label: 'LINT1/NMI', kind: 'dig', col: 'magenta', act: 1 },
    { id: 'lock', label: '{LOCK}', kind: 'dig', col: 'magenta', act: 0 },
  ] },
];
// P6 request codes (simplified; 1 = the pin is low): [REQa, REQb, the words].
// REQa: bit 2 = memory read or write, bit 1 = data (0 = code), bit 0 = write. REQb bits 1-0 = LEN.
const TV_REQ686 = {
  codeLine: ['00100', '00010', 'code read of a line (32 bytes)'], dataLine: ['00110', '00010', 'data read of a line (32 bytes)'],
  code: ['00100', '00000', 'code read (8 bytes or less)'], data: ['00110', '00000', 'data read (8 bytes or less)'],
  write: ['00111', '00000', 'memory write (8 bytes or less)'], wb: ['00101', '00010', 'write-back of a modified line (32 bytes)'],
  ior: ['10000', '00000', 'I/O read'], iow: ['10001', '00000', 'I/O write'], inta: ['01000', '00000', 'interrupt acknowledge'],
  special: ['01000', '00001', 'special transaction (halt)'],
};
const TV_BTBST = ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken'];

// Constant level lists: [f0, level0, f1, level1, ...]; level 0.5 = floating.
const TV_H = [0, 1], TV_L = [0, 0];
const TV_ALE = [0, 0, 0.05, 1, 0.6, 0];
const TV_CLK = [0, 0, 0.66, 1];
const TV_PULSE = [0, 1, 0.2, 0, 0.85, 1];

// Sounds play only when one clock lasts this long in real time (ms) or longer.
const TV_SFX_MS = 120;
// Device names for the tooltips and the detail card (dev ids of the micro-events).
const TV_DEV = {
  ram: 'RAM', rom: 'ROM', vram: 'video RAM', vrom: 'video BIOS ROM', xram: 'extended RAM', pic: '8259A', pic2: 'slave 8259A',
  pit: 'timer', ppi: '8255', dma: '8237 DMA', dma2: '8237 DMA', crtc: 'CRTC', cga: 'CGA', vga: 'VGA', nmi: 'NMI mask',
  fdc: 'disk controller', hdc: 'IDE hard disk', kbc: '8042', rtc: 'RTC', a20: 'A20 gate', none: 'no device',
};
const TV_WORD = ['interrupt acknowledge', 'I/O read', 'I/O write', 'halt', 'code fetch', 'memory read', 'memory write', 'passive', 'shutdown'];
// The bus cycle types in which each command line goes low.
const TV_CMD = { mrdc: [4, 5], mwtc: [6], amwc: [6], iorc: [1], iowc: [2], aiowc: [2], inta: [0] };

// Signal facts for the tooltips and the detail card: n = full name, job (the first
// sentence is the short form), drv = driver chip, rcv = receivers, lvl = active level,
// chip = the Board glow id of the driver (app.select).
const TV_INFO = {
  clk: { n: 'Clock', job: 'The clock times all bus actions. One clock is one T-state, and a T-state starts at the falling edge. The clock is 4.77 MHz and is high for one third of the period.', drv: '8284A clock generator', rcv: '8086, 8087, 8288', lvl: 'no active level (edges)', chip: 'clk' },
  ready: { n: 'Ready', job: 'READY tells the 8086 that the memory or the I/O device is ready. If it is low in T3, the 8086 adds wait states (Tw). This board adds no wait states, so it stays high.', drv: '8284A (it synchronizes the ready input)', rcv: '8086, 8087', lvl: 'high = ready', chip: 'clk' },
  s2: { n: 'Status bit 2', job: 'S2, S1 and S0 tell the 8288 the type of the next bus cycle. The code comes out at the end of the clock before T1 and goes back to passive (1 1 1) in T3.', drv: '8086 (the 8087 when it has the bus)', rcv: '8288 bus controller, 8087', lvl: 'low (1 1 1 = passive)', chip: 'cpu' },
  state: { n: 'Bus state (decoded)', job: 'This row is not a pin. The analyser decodes S2 S1 S0 and shows the type of each bus cycle: CODE, MEMR, MEMW, IOR, IOW, INTA or HALT.', drv: 'decoded from S2–S0', rcv: '8288 (it decodes the same code)', lvl: 'no active level', chip: 'bus' },
  qs1: { n: 'Queue status bit 1', job: 'QS1 and QS0 tell the 8087 what the 8086 did with its instruction queue in the last clock. 0 0 = no operation, 0 1 = first byte of an instruction (F), 1 0 = queue empty after a jump (E), 1 1 = next byte (S).', drv: '8086', rcv: '8087 (it follows the instruction stream)', lvl: 'high (a code in QS1 QS0)', chip: 'cpu' },
  ad: { n: 'Address / data bus, bits 15–0', job: 'The same pins carry the address in T1 and the data after it. The data comes from T2 for a write and in T3 for a read. The 8282 latches keep the address, and the 8286 transceivers pass the data.', drv: '8086 or 8087 (address, write data); memory or I/O device (read data); 8259A (vector)', rcv: '8282 address latches, 8286 data transceivers', lvl: 'bus (Z = floating)', chip: 'cpu' },
  ah: { n: 'Address bits 19–16 / status S6–S3', job: 'In T1 these pins carry the top 4 address bits. After T1 they carry status: S4 S3 = the segment register in use, S5 = the interrupt flag, S6 = 0.', drv: '8086 (the 8087 when it has the bus)', rcv: '8282 address latch (A19–A16)', lvl: 'bus (no active level)', chip: 'cpu' },
  bhe: { n: 'Bus high enable / status S7', job: 'BHE is low in T1 when the cycle uses the high byte D15–D8: a word, or a byte at an odd address. The odd memory bank reads or writes only then.', drv: '8086', rcv: '8282 address latch, then the odd memory bank', lvl: 'low', chip: 'cpu' },
  ale: { n: 'Address latch enable', job: 'ALE is a pulse in T1: the 8282 latches take the address when it goes low. They hold the address for the rest of the cycle.', drv: '8288 bus controller', rcv: '8282 address latches (3 chips)', lvl: 'high', chip: 'bus' },
  mrdc: { n: 'Memory read command', job: 'MRDC tells the memory to put its data on the bus. It is low from T2 to T4 in code fetch and memory read cycles.', drv: '8288 bus controller', rcv: 'RAM, ROM, video RAM', lvl: 'low', chip: 'bus' },
  mwtc: { n: 'Memory write command', job: 'MWTC tells the memory to take the data from the bus. It is low from T3 to T4 in memory write cycles.', drv: '8288 bus controller', rcv: 'RAM, video RAM', lvl: 'low', chip: 'bus' },
  amwc: { n: 'Advanced memory write command', job: 'AMWC does the same job as MWTC, but it starts one clock earlier, in T2. Slow memory gets more time.', drv: '8288 bus controller', rcv: 'RAM, video RAM (boards that use it)', lvl: 'low', chip: 'bus' },
  iorc: { n: 'I/O read command', job: 'IORC tells the I/O device at the port address to put its data on the bus. It is low from T2 to T4.', drv: '8288 bus controller', rcv: 'I/O devices: 8259A, 8253, 8255, 8237, video card, disk controller', lvl: 'low', chip: 'bus' },
  iowc: { n: 'I/O write command', job: 'IOWC tells the I/O device at the port address to take the data from the bus. It is low from T3 to T4.', drv: '8288 bus controller', rcv: 'I/O devices: 8259A, 8253, 8255, 8237, video card, disk controller', lvl: 'low', chip: 'bus' },
  aiowc: { n: 'Advanced I/O write command', job: 'AIOWC does the same job as IOWC, but it starts one clock earlier, in T2.', drv: '8288 bus controller', rcv: 'I/O devices (boards that use it)', lvl: 'low', chip: 'bus' },
  inta: { n: 'Interrupt acknowledge', job: 'Two INTA cycles answer an interrupt request. In the first cycle the 8259A gets ready. In the second cycle it puts the interrupt vector on AD7–AD0.', drv: '8288 bus controller', rcv: '8259A interrupt controller', lvl: 'low', chip: 'bus' },
  dtr: { n: 'Data transmit / receive', job: 'DT/R sets the direction of the 8286 data transceivers. High = transmit (CPU to system bus), low = receive (system bus to CPU).', drv: '8288 bus controller', rcv: '8286 data transceivers', lvl: 'low = receive (a read)', chip: 'bus' },
  den: { n: 'Data enable', job: 'DEN turns on the 8286 data transceivers only while data moves. Thus the address in T1 does not go onto the data bus.', drv: '8288 bus controller', rcv: '8286 data transceivers (OE, through an inverter)', lvl: 'high', chip: 'bus' },
  rq: { n: 'Request / grant 0', job: 'One pin carries three pulses: the 8087 asks for the bus (RQ), the 8086 gives it (GT), and the 8087 gives it back (RL). Between GT and RL the 8087 does its own bus cycles.', drv: '8087 (RQ, RL) and 8086 (GT)', rcv: '8086 and 8087', lvl: 'low (pulses of one clock)', chip: 'fpu' },
  intr: { n: 'Interrupt request', job: 'The 8259A asks the 8086 for an interrupt. The 8086 checks INTR at the end of an instruction when IF = 1, and it answers with two INTA cycles.', drv: '8259A interrupt controller', rcv: '8086', lvl: 'high', chip: 'pic' },
  nmi: { n: 'Non-maskable interrupt', job: 'NMI starts INT 2, and the IF flag cannot stop it. On this board the 8087 error signal goes to NMI through the NMI mask (port A0h).', drv: 'NMI logic (8087 INT and the NMI mask)', rcv: '8086', lvl: 'high (rising edge)', chip: 'nmi' },
  lock: { n: 'Bus lock', job: 'LOCK is low for an instruction with the LOCK prefix and between the two INTA cycles. Then no other bus master can take the bus.', drv: '8086', rcv: 'other bus masters (bus arbiter)', lvl: 'low', chip: 'cpu' },
};
TV_INFO.s1 = Object.assign({}, TV_INFO.s2, { n: 'Status bit 1' });
TV_INFO.s0 = Object.assign({}, TV_INFO.s2, { n: 'Status bit 0' });
TV_INFO.qs0 = Object.assign({}, TV_INFO.qs1, { n: 'Queue status bit 0' });
const TV_INFO_286 = Object.assign({}, TV_INFO, {
  clk: { n: 'System clock', job: 'The 82284 makes a 16 MHz clock. Two CLK periods make one processor clock: one T-state of 125 ns.', drv: '82284 clock generator', rcv: '80286, 82288, 80287', lvl: 'no active level (edges)', chip: 'clk' },
  ready: { n: 'Ready', job: 'READY goes low in the last T-state of each bus cycle, and the cycle ends. This board adds one wait state, so a memory cycle is Ts, Tc, Tw.', drv: '82284 (it synchronizes the wait-state logic)', rcv: '80286, 82288', lvl: 'low', chip: 'clk' },
  s1: { n: 'Status bit 1', job: 'S1 and S0 go low in Ts to start a bus cycle. The 82288 then uses M/IO and COD/INTA to find the type of the cycle.', drv: '80286', rcv: '82288 bus controller, 82284', lvl: 'low (1 1 = no new cycle)', chip: 'cpu' },
  mio: { n: 'Memory / I/O select', job: 'M/IO is high for a memory cycle and low for an I/O cycle or an interrupt acknowledge. It comes with the address, often in the Tc of the cycle before (pipelined).', drv: '80286', rcv: '82288, address decoders', lvl: 'high = memory, low = I/O', chip: 'cpu' },
  cod: { n: 'Code / interrupt acknowledge', job: 'With M/IO, COD/INTA gives the type of the cycle: 1 1 = code fetch, 0 1 = memory data, 1 0 = I/O, 0 0 = interrupt acknowledge.', drv: '80286', rcv: '82288 bus controller', lvl: 'low = interrupt acknowledge (with M/IO low)', chip: 'cpu' },
  state: { n: 'Bus state (decoded)', job: 'This row is not a pin. The analyser decodes COD/INTA, M/IO, S1 and S0 and shows the type of each bus cycle.', drv: 'decoded from the status pins', rcv: '82288 (it decodes the same code)', lvl: 'no active level', chip: 'bus' },
  a: { n: 'Address bus A23–A0', job: 'The address bus is separate from the data bus. The 80286 often puts the next address on it in the Tc of the cycle before (pipelined), and the 74LS573 latches hold it.', drv: '80286', rcv: '74LS573 address latches, then the memory and I/O decoders', lvl: 'bus (no active level)', chip: 'cpu' },
  d: { n: 'Data bus D15–D0', job: 'The data bus carries the data of each cycle. For a read, the data is valid from the middle of Tc to the end. For a write, the 80286 drives it from the middle of Ts.', drv: '80286 (write data); memory or I/O device (read data); 8259A (vector)', rcv: '74LS245 data transceivers', lvl: 'bus (Z = floating)', chip: 'xcv0' },
  bhe: { n: 'Bus high enable', job: 'BHE is low when the cycle uses the high byte D15–D8: a word, or a byte at an odd address.', drv: '80286', rcv: '74LS573 address latch, then the odd memory bank', lvl: 'low', chip: 'cpu' },
  ale: { n: 'Address latch enable', job: 'ALE is high in the second half of Ts. The 74LS573 latches pass the address while ALE is high and hold it when ALE goes low.', drv: '82288 bus controller', rcv: '74LS573 address latches (3 chips)', lvl: 'high', chip: 'bus' },
  mrdc: { n: 'Memory read command', job: 'MRDC tells the memory to put its data on the bus. It is low from the start of Tc to the end of the cycle.', drv: '82288 bus controller', rcv: 'RAM, ROM, video RAM', lvl: 'low', chip: 'bus' },
  mwtc: { n: 'Memory write command', job: 'MWTC tells the memory to take the data from the bus. It is low from the start of Tc to the end of the cycle.', drv: '82288 bus controller', rcv: 'RAM, video RAM', lvl: 'low', chip: 'bus' },
  iorc: { n: 'I/O read command', job: 'IORC tells the I/O device at the port address to put its data on the bus. It is low from the start of Tc to the end of the cycle.', drv: '82288 bus controller', rcv: 'I/O devices: 8259A, 8254, 8042, RTC, video card, disk controller', lvl: 'low', chip: 'bus' },
  iowc: { n: 'I/O write command', job: 'IOWC tells the I/O device at the port address to take the data from the bus. It is low from the start of Tc to the end of the cycle.', drv: '82288 bus controller', rcv: 'I/O devices: 8259A, 8254, 8042, RTC, video card, disk controller', lvl: 'low', chip: 'bus' },
  inta: { n: 'Interrupt acknowledge', job: 'Two INTA cycles answer an interrupt request. In the second cycle the 8259A puts the interrupt vector on D7–D0.', drv: '82288 bus controller', rcv: 'master and slave 8259A', lvl: 'low', chip: 'bus' },
  dtr: { n: 'Data transmit / receive', job: 'DT/R sets the direction of the 74LS245 data transceivers. High = transmit (CPU to system bus), low = receive (system bus to CPU).', drv: '82288 bus controller', rcv: '74LS245 data transceivers (DIR)', lvl: 'low = receive (a read)', chip: 'bus' },
  den: { n: 'Data enable', job: 'DEN turns on the 74LS245 data transceivers only while data moves.', drv: '82288 bus controller', rcv: '74LS245 data transceivers (G)', lvl: 'high', chip: 'bus' },
  mce: { n: 'Master cascade enable', job: 'MCE is high in the first INTA cycle. The master 8259A then puts the cascade address on the bus, so a slave 8259A knows that it must answer.', drv: '82288 bus controller', rcv: 'master 8259A (through the address latches)', lvl: 'high', chip: 'bus' },
  pereq: { n: 'Processor extension request', job: 'The 80287 asks the 80286 to move an operand between the memory and the 80287. The 80286 does these bus cycles for it.', drv: '80287', rcv: '80286', lvl: 'high', chip: 'fpu' },
  peack: { n: 'Processor extension acknowledge', job: 'The 80286 tells the 80287 that it does the requested operand transfer now.', drv: '80286', rcv: '80287', lvl: 'low', chip: 'cpu' },
  busy: { n: 'Busy', job: 'BUSY is low while the 80287 executes an instruction. WAIT and the next 80287 instruction wait until it goes high.', drv: '80287', rcv: '80286', lvl: 'low', chip: 'fpu' },
  error: { n: 'Error', job: 'ERROR is low when the 80287 has an unmasked exception. The 80286 then starts INT 16 at the next 80287 or WAIT instruction.', drv: '80287', rcv: '80286', lvl: 'low', chip: 'fpu' },
  hold: { n: 'Hold request', job: 'Another bus master (the DMA logic) asks for the bus. This model does no DMA bus cycles, so HOLD stays low.', drv: 'DMA logic (8237)', rcv: '80286', lvl: 'high', chip: 'cpu' },
  hlda: { n: 'Hold acknowledge', job: 'The 80286 gives the bus to the other bus master. It stays low in this model.', drv: '80286', rcv: 'DMA logic (8237)', lvl: 'high', chip: 'cpu' },
  intr: { n: 'Interrupt request', job: 'The master 8259A asks the 80286 for an interrupt. The 80286 checks INTR at the end of an instruction when IF = 1, and it answers with two INTA cycles.', drv: 'master 8259A', rcv: '80286', lvl: 'high', chip: 'pic' },
  nmi: { n: 'Non-maskable interrupt', job: 'NMI starts INT 2, and the IF flag cannot stop it. On the AT, memory parity errors go to NMI through the NMI mask (port 70h, bit 7).', drv: 'NMI logic', rcv: '80286', lvl: 'high (rising edge)', chip: 'nmi' },
  lock: { n: 'Bus lock', job: 'LOCK is low from the first INTA cycle to the end of the second one, and for an instruction with the LOCK prefix.', drv: '80286', rcv: 'bus arbitration logic', lvl: 'low', chip: 'cpu' },
});
TV_INFO_286.s0 = Object.assign({}, TV_INFO_286.s1, { n: 'Status bit 0' });
const TV_INFO_386 = Object.assign({}, TV_INFO_286, {
  clk: { n: 'Double-frequency clock CLK2', job: 'CLK2 runs at twice the processor clock. Two CLK2 periods make one T-state (one processor clock). A bus cycle is T1 and T2, and each wait state adds one more T2.', drv: 'clock oscillator', rcv: '80386, 80387, 82288', lvl: 'no active level (edges)', chip: 'clk' },
  ready: { n: 'Ready', job: 'READY goes low at the end of the last T2: the memory or the I/O device is ready, and the cycle ends. This board adds one wait state to each cycle, so a cycle is T1, T2, T2.', drv: 'bus logic (wait-state generator)', rcv: '80386, 80387', lvl: 'low', chip: 'clk' },
  na: { n: 'Next address', job: 'NA asks the 80386 to put the address of the next cycle out during T2 of this cycle (address pipelining). This board does not use it, so NA stays high and each cycle puts its address out in its own T1.', drv: 'bus logic', rcv: '80386', lvl: 'low', chip: 'cpu' },
  ads: { n: 'Address status', job: 'ADS is low in T1: the address A23–A1, BHE, BLE and the status M/IO D/C W/R are valid, and a new bus cycle starts.', drv: '80386', rcv: '82288, address latches, 80387', lvl: 'low', chip: 'cpu' },
  mio: { n: 'Memory / I/O', job: 'M/IO is high for a memory cycle and low for an I/O cycle or an interrupt acknowledge. It is valid from T1 to the end of the cycle.', drv: '80386', rcv: '82288, address decoders', lvl: 'high = memory, low = I/O', chip: 'cpu' },
  dc: { n: 'Data / code', job: 'D/C is high for data (memory data or I/O) and low for a code fetch, an interrupt acknowledge or a halt cycle.', drv: '80386', rcv: '82288', lvl: 'high = data, low = code', chip: 'cpu' },
  wr: { n: 'Write / read', job: 'W/R is high for a write cycle and low for a read cycle. With M/IO and D/C it gives the type of the cycle: 1 0 0 = code fetch, 1 1 0 = memory read, 1 1 1 = memory write, 0 1 0 = I/O read, 0 1 1 = I/O write, 0 0 0 = interrupt acknowledge, 1 0 1 = halt or shutdown.', drv: '80386', rcv: '82288, 80387', lvl: 'high = write, low = read', chip: 'cpu' },
  state: { n: 'Bus state (decoded)', job: 'This row is not a pin. The analyser decodes M/IO, D/C and W/R and shows the type of each bus cycle.', drv: 'decoded from the status pins', rcv: '82288 (it decodes the same code)', lvl: 'no active level', chip: 'bus' },
  a: { n: 'Address bus A23–A1', job: 'The 80386 puts the address out in T1 and keeps it to the end of the cycle. The 16-bit bus has no A0: BHE and BLE select the bytes. The row shows the full byte address.', drv: '80386', rcv: 'address latches, then the memory and I/O decoders', lvl: 'bus (no active level)', chip: 'cpu' },
  d: { n: 'Data bus D15–D0', job: 'The data bus moves 16 bits in each cycle, as on the 386SX. A 32-bit operand needs two cycles. For a read, the data is valid at the end of the last T2. For a write, the 80386 drives it from the middle of T1.', drv: '80386 (write data); memory or I/O device (read data); 8259A (vector)', rcv: 'data transceivers', lvl: 'bus (Z = floating)', chip: 'xcv0' },
  bhe: { n: 'Byte high enable', job: 'BHE is low when the cycle uses the high byte D15–D8: a word, or a byte at an odd address.', drv: '80386', rcv: 'address latches, then the odd memory bank', lvl: 'low', chip: 'cpu' },
  ble: { n: 'Byte low enable', job: 'BLE is low when the cycle uses the low byte D7–D0: a word, or a byte at an even address. It does the job of A0.', drv: '80386', rcv: 'address latches, then the even memory bank', lvl: 'low', chip: 'cpu' },
  mrdc: { n: 'Memory read command', job: 'The 82288 on this board gets the cycle type from the 80386 status and makes the command. MRDC is low from T2 to the end of a code fetch or memory read cycle.', drv: '82288 bus controller', rcv: 'RAM, ROM, video RAM', lvl: 'low', chip: 'bus' },
  mwtc: { n: 'Memory write command', job: 'MWTC tells the memory to take the data from the bus. It is low from T2 to the end of a memory write cycle.', drv: '82288 bus controller', rcv: 'RAM, video RAM', lvl: 'low', chip: 'bus' },
  iorc: { n: 'I/O read command', job: 'IORC tells the I/O device at the port address to put its data on the bus. It is low from T2 to the end of the cycle.', drv: '82288 bus controller', rcv: 'I/O devices: 8259A, 8254, 8042, RTC, video card, disk controller', lvl: 'low', chip: 'bus' },
  iowc: { n: 'I/O write command', job: 'IOWC tells the I/O device at the port address to take the data from the bus. It is low from T2 to the end of the cycle.', drv: '82288 bus controller', rcv: 'I/O devices: 8259A, 8254, 8042, RTC, video card, disk controller', lvl: 'low', chip: 'bus' },
  inta: { n: 'Interrupt acknowledge', job: 'Two INTA cycles answer an interrupt request. In the second cycle the 8259A puts the interrupt vector on D7–D0.', drv: '82288 bus controller', rcv: 'master and slave 8259A', lvl: 'low', chip: 'bus' },
  pereq: { n: 'Coprocessor request', job: 'The 80387 asks the 80386 to move an operand between the memory and the 80387. The 80386 does these transfers as I/O cycles to the 80387 ports.', drv: '80387', rcv: '80386', lvl: 'high', chip: 'fpu' },
  busy: { n: 'Busy', job: 'BUSY is low while the 80387 executes an instruction. WAIT and the next 80387 instruction wait until it goes high.', drv: '80387', rcv: '80386', lvl: 'low', chip: 'fpu' },
  error: { n: 'Error', job: 'ERROR is low when the 80387 has an unmasked exception. The 80386 then starts INT 16 at the next 80387 or WAIT instruction.', drv: '80387', rcv: '80386', lvl: 'low', chip: 'fpu' },
  hold: { n: 'Hold request', job: 'Another bus master (the DMA logic) asks for the bus. This model does no DMA bus cycles, so HOLD stays low.', drv: 'DMA logic (8237)', rcv: '80386', lvl: 'high', chip: 'cpu' },
  hlda: { n: 'Hold acknowledge', job: 'The 80386 gives the bus to the other bus master. It stays low in this model.', drv: '80386', rcv: 'DMA logic (8237)', lvl: 'high', chip: 'cpu' },
  intr: { n: 'Interrupt request', job: 'The master 8259A asks the 80386 for an interrupt. The 80386 checks INTR at the end of an instruction when IF = 1, and it answers with two INTA cycles.', drv: 'master 8259A', rcv: '80386', lvl: 'high', chip: 'pic' },
  nmi: { n: 'Non-maskable interrupt', job: 'NMI starts INT 2, and the IF flag cannot stop it. On the AT, memory parity errors go to NMI through the NMI mask (port 70h, bit 7).', drv: 'NMI logic', rcv: '80386', lvl: 'high (rising edge)', chip: 'nmi' },
  lock: { n: 'Bus lock', job: 'LOCK is low from the first INTA cycle to the end of the second one, and for an instruction with the LOCK prefix.', drv: '80386', rcv: 'bus arbitration logic', lvl: 'low', chip: 'cpu' },
});
const TV_INFO_486 = Object.assign({}, TV_INFO_386, {
  clk: { n: 'Clock', job: 'The 80486 takes its clock at the processor frequency: one CLK period is one T-state (the 80386 needs CLK2 at twice the frequency). A bus cycle is T1 and T2; a burst transfer after the first one is one T2.', drv: 'clock oscillator', rcv: '80486, bus logic', lvl: 'no active level (edges)', chip: 'clk' },
  brdy: { n: 'Burst ready', job: 'BRDY# ends each transfer of a burst. In a line fill the memory gives one transfer in each clock after the first one (the 2-1-1-1 timing).', drv: 'bus logic (memory controller)', rcv: '80486', lvl: 'low', chip: 'clk' },
  rdy: { n: 'Non-burst ready', job: 'RDY# ends a bus cycle that is not a burst: I/O cycles, writes and the reads that the cache does not keep.', drv: 'bus logic (wait-state generator)', rcv: '80486', lvl: 'low', chip: 'clk' },
  ads: { n: 'Address status', job: 'ADS# is low in T1: the address, the byte enables and the status M/IO# D/C# W/R# are valid, and a new bus cycle starts. A burst has only one ADS#: the next transfers follow with no new address status.', drv: '80486', rcv: '82288, address latches', lvl: 'low', chip: 'cpu' },
  mio: Object.assign({}, TV_INFO_386.mio, { drv: '80486' }),
  dc: Object.assign({}, TV_INFO_386.dc, { drv: '80486' }),
  wr: Object.assign({}, TV_INFO_386.wr, { drv: '80486', rcv: '82288' }),
  a: { n: 'Address bus A31–A2', job: 'The 80486 puts the dword address on A31 to A2; BE3# to BE0# select the bytes. In a burst the 486 changes A3 and A2 for each dword in the 486 burst order. The row shows the full byte address.', drv: '80486', rcv: 'address latches, then the memory and I/O decoders', lvl: 'bus (no active level)', chip: 'cpu' },
  be: { n: 'Byte enables BE3#–BE0#', job: 'The byte enables show which bytes of the dword the cycle uses (0 = used). A word at an offset of 0 uses BE1# and BE0#, at an offset of 2 BE3# and BE2#. The board uses them to select the low or the high word.', drv: '80486', rcv: 'bus logic, memory banks', lvl: 'low', chip: 'cpu' },
  d: { n: 'Data bus D15–D0', job: 'This board gives BS16#, so the 80486 moves 16 bits in each transfer on D15 to D0. A dword needs two transfers, and a line fill of 16 bytes needs eight. For a read, the data is valid at the end of each transfer.', drv: '80486 (write data); memory or I/O device (read data); 8259A (vector)', rcv: 'data transceivers', lvl: 'bus (Z = floating)', chip: 'xcv0' },
  bs16: { n: 'Bus size 16', job: 'BS16# tells the 80486 that the device has a 16-bit data bus. The 80486 then splits each dword into two word transfers. On this board it is low for each cycle.', drv: 'bus logic', rcv: '80486', lvl: 'low', chip: 'bus' },
  blast: { n: 'Burst last', job: 'BLAST# is low in the last transfer of a cycle. In a line fill it stays high until the last of the eight transfers; a cycle that is not a burst has only one transfer, so BLAST# is low in its T2.', drv: '80486', rcv: 'bus logic', lvl: 'low', chip: 'cpu' },
  ken: { n: 'Cache enable', job: 'KEN# low in the first transfer of a read tells the 80486 that the address is cacheable: the read becomes a line fill of 16 bytes. The board keeps KEN# high for A0000h to FFFFFh (video memory and ROM).', drv: 'bus logic (address decoder)', rcv: '80486', lvl: 'low', chip: 'bus' },
  cache: { n: 'Cache (decoded)', job: 'This row is not a pin. It shows the cache events of the 80486: HIT (a read hit: no bus cycle), MISS with the line fill, WR HIT and WR MISS (writes go to the bus: write-through), and NO CACHE (a read that the cache does not keep).', drv: 'the 8 KB cache on the 80486', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  mrdc: { n: 'Memory read command', job: 'The 82288 on this board gets the cycle type from the 80486 status and makes the command. MRDC is low from T2 to the end of a code fetch or a memory read, and for all the transfers of a burst.', drv: '82288 bus controller', rcv: 'RAM, ROM, video RAM', lvl: 'low', chip: 'bus' },
  ferr: { n: 'Floating-point error', job: 'FERR# goes low when the FPU on the chip has an unmasked exception. With CR0.NE = 0 the board sends it to IRQ 13, as on the AT; with NE = 1 the 80486 gives #MF (vector 16) itself.', drv: '80486 (the FPU on the chip)', rcv: 'IRQ 13 logic (slave 8259A)', lvl: 'low', chip: 'cpu' },
  hold: { n: 'Hold request', job: 'Another bus master (the DMA logic) asks for the bus. This model does no DMA bus cycles, so HOLD stays low.', drv: 'DMA logic (8237)', rcv: '80486', lvl: 'high', chip: 'cpu' },
  hlda: { n: 'Hold acknowledge', job: 'The 80486 gives the bus to the other bus master. It stays low in this model.', drv: '80486', rcv: 'DMA logic (8237)', lvl: 'high', chip: 'cpu' },
  intr: { n: 'Interrupt request', job: 'The master 8259A asks the 80486 for an interrupt. The 80486 checks INTR at the end of an instruction when IF = 1, and it answers with two INTA cycles.', drv: 'master 8259A', rcv: '80486', lvl: 'high', chip: 'pic' },
  nmi: Object.assign({}, TV_INFO_386.nmi, { rcv: '80486' }),
  lock: { n: 'Bus lock', job: 'LOCK# is low from the first INTA cycle to the end of the second one, and for an instruction with the LOCK prefix (XCHG with memory, XADD, CMPXCHG).', drv: '80486', rcv: 'bus arbitration logic', lvl: 'low', chip: 'cpu' },
});
const TV_INFO_586 = Object.assign({}, TV_INFO_486, {
  clk: { n: 'Clock', job: 'The Pentium bus runs at the clock of the processor: one CLK period is one T-state. A bus cycle is T1 and T2; each transfer of a burst after the first one is one T2 (with the wait states of the board).', drv: 'clock oscillator', rcv: 'Pentium, bus logic', lvl: 'no active level (edges)', chip: 'clk' },
  brdy: { n: 'Burst ready', job: 'BRDY# ends each transfer. The Pentium has no other ready input: a single transfer ends with one BRDY#, and a line fill or a write-back ends with four (the 2-1-1-1 timing).', drv: 'bus logic (memory controller)', rcv: 'Pentium', lvl: 'low', chip: 'clk' },
  na: { n: 'Next address', job: 'NA# asks the Pentium to put the address of the next cycle out before this cycle ends (address pipelining). This board does not use NA#, so it stays high and each cycle puts its address out in its own T1.', drv: 'bus logic', rcv: 'Pentium', lvl: 'low', chip: 'cpu' },
  ads: { n: 'Address status', job: 'ADS# is low in T1: the address A31–A3, the byte enables and the status M/IO# D/C# W/R# are valid, and a new bus cycle starts. A burst has only one ADS#: the next three transfers follow with no new address status.', drv: 'Pentium', rcv: 'bus logic, address latches', lvl: 'low', chip: 'cpu' },
  mio: Object.assign({}, TV_INFO_386.mio, { drv: 'Pentium', rcv: 'bus logic, address decoders' }),
  dc: Object.assign({}, TV_INFO_386.dc, { drv: 'Pentium', rcv: 'bus logic' }),
  wr: Object.assign({}, TV_INFO_386.wr, { drv: 'Pentium', rcv: 'bus logic' }),
  state: { n: 'Bus state (decoded)', job: 'This row is not a pin. The analyser decodes M/IO# D/C# W/R# and shows the type of each bus cycle. FILL is the first transfer of a line fill, WB the first transfer of a write-back; 2, 3 and 4 are the next transfers of the burst.', drv: 'decoded from the status pins', rcv: 'bus logic (it decodes the same code)', lvl: 'no active level', chip: 'bus' },
  a: { n: 'Address bus A31–A3', job: 'The Pentium puts the address of an 8-byte group on A31 to A3; BE7# to BE0# select the bytes of the group. In a burst the Pentium gives only the first address; the board counts the other three in the Intel burst order. The row shows the address of the 8-byte group.', drv: 'Pentium', rcv: 'address latches, then the memory and I/O decoders', lvl: 'bus (no active level)', chip: 'cpu' },
  be: { n: 'Byte enables BE7#–BE0#', job: 'The byte enables show which bytes of the 8-byte group the transfer uses (0 = used). BE0# is the byte at the address of the group, BE7# the last byte. A burst uses all 8 bytes.', drv: 'Pentium', rcv: 'bus logic, memory banks', lvl: 'low', chip: 'cpu' },
  d: { n: 'Data bus D63–D0', job: 'The Pentium moves up to 8 bytes in each transfer on its 64-bit data bus. A line of 32 bytes needs four transfers. The row shows the 8 byte lanes, D63–D56 at the left; ·· is a lane that the transfer does not use. For a read, the data is valid at the end of the transfer.', drv: 'Pentium (write data); memory or I/O device (read data); 8259A (vector)', rcv: 'data transceivers', lvl: 'bus (Z = floating)', chip: 'xcv0' },
  cachen: { n: 'Cacheable cycle', job: 'CACHE# low with ADS# tells the board that the Pentium wants a burst: a line fill (a read that the Pentium can keep in a cache) or a write-back of a modified (M) line. With CACHE# high the cycle is a single transfer.', drv: 'Pentium', rcv: 'bus logic (memory controller)', lvl: 'low', chip: 'cpu' },
  ken: { n: 'Cache enable', job: 'KEN# low in the first transfer of a read tells the Pentium that the address is cacheable: with CACHE# low the read becomes a line fill of 32 bytes. The board keeps KEN# high for A0000h to FFFFFh (video memory and ROM).', drv: 'bus logic (address decoder)', rcv: 'Pentium', lvl: 'low', chip: 'bus' },
  cache: { n: 'Caches (decoded)', job: 'This row is not a pin. It shows the events of the two caches (8 KB code, 8 KB data): HIT (no bus cycle), MISS with the line fill, WR HIT and WR MISS, NO CACHE, and the MESI state of the data line after the access (M, E, S, I). WB shows that the fill replaced an M line, so a write-back burst follows.', drv: 'the code cache and the data cache of the Pentium', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  pipe: { n: 'Pipes U and V (decoded)', job: 'This row is not a pin. The Pentium has two integer pipes. The U pipe takes each instruction; the V pipe takes the next one at the same time when the two instructions pair. The row shows the pipe of each instruction and, for an instruction with no partner, the reason.', drv: 'the instruction decode of the Pentium', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  btb: { n: 'Branch target buffer (decoded)', job: 'This row is not a pin. The BTB keeps 256 branches with their targets and a 2-bit counter. The row shows each branch: the prediction (taken or not taken), the result, and the penalty of a wrong prediction (3 clocks in the U pipe, 4 in the V pipe).', drv: 'the branch prediction logic of the Pentium', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  ferr: { n: 'Floating-point error', job: 'FERR# goes low when the FPU on the chip has an unmasked exception. With CR0.NE = 0 the board sends it to IRQ 13, as on the AT; with NE = 1 the Pentium gives #MF (vector 16) itself.', drv: 'Pentium (the FPU on the chip)', rcv: 'IRQ 13 logic (slave 8259A)', lvl: 'low', chip: 'cpu' },
  hold: Object.assign({}, TV_INFO_486.hold, { rcv: 'Pentium' }),
  hlda: Object.assign({}, TV_INFO_486.hlda, { job: 'The Pentium gives the bus to the other bus master. It stays low in this model.', drv: 'Pentium' }),
  intr: { n: 'Interrupt request', job: 'The master 8259A asks the Pentium for an interrupt. The Pentium checks INTR at the end of an instruction when IF = 1 (not between the two instructions of a pair), and it answers with two INTA cycles.', drv: 'master 8259A', rcv: 'Pentium', lvl: 'high', chip: 'pic' },
  nmi: Object.assign({}, TV_INFO_386.nmi, { rcv: 'Pentium' }),
  lock: { n: 'Bus lock', job: 'LOCK# is low from the first INTA cycle to the end of the second one, and for an instruction with the LOCK prefix (XCHG with memory, XADD, CMPXCHG, CMPXCHG8B).', drv: 'Pentium', rcv: 'bus arbitration logic', lvl: 'low', chip: 'cpu' },
});
const TV_INFO_686 = {
  clk: { n: 'Bus clock BCLK', job: 'BCLK is the clock of the front-side bus (FSB), 66 MHz on this board. The Pentium Pro core runs at 3 times this clock (200 MHz): each BCLK has 3 core clocks. All bus signals change at the rising edge of BCLK. The labels under the clock show the phase of the transaction in each BCLK: Aa and Ab (request), S (snoop), w (wait), TR (TRDY#), D1 to D4 (data).', drv: 'clock generator', rcv: 'Pentium Pro, the chipset (memory controller)', lvl: 'no active level (edges)', chip: 'clk' },
  core: { n: 'Core clock', job: 'The clock of the core: 3 core clocks in each BCLK (the bus ratio). The out-of-order core, the L1 caches and the L2 cache run at this clock. The L2 is on the back-side bus in the same package, so an L2 hit makes no front-side bus transaction. One position of this plot is one core clock.', drv: 'the PLL in the Pentium Pro (BCLK × 3)', rcv: 'the core, the L1 and the L2', lvl: 'no active level (edges)', chip: 'cpu' },
  ads: { n: 'Address strobe', job: 'ADS# is low for one BCLK: request phase a of a new transaction starts. A31#–A3# give the address, and REQ4#–REQ0# give the type of the transaction. The P6 bus is pipelined: up to 8 transactions can be in the phases at the same time. This model does one transaction at a time.', drv: 'Pentium Pro (the bus agent that owns the request bus)', rcv: 'the chipset, the other bus agents', lvl: 'low', chip: 'cpu' },
  req: { n: 'Request command REQ4#–REQ0#', job: 'The type of the transaction, in two parts. In request phase a (with ADS#) the code gives the type: memory read (code or data), memory write, write-back of a modified line, I/O read, I/O write, interrupt acknowledge or a special transaction. In request phase b the code gives the length (LEN: 00 = 8 bytes or less, 10 = a line of 32 bytes). The codes here are simplified; 1 = the pin is low.', drv: 'Pentium Pro', rcv: 'the chipset', lvl: 'low (1 in the codes)', chip: 'cpu' },
  a: { n: 'Address A31#–A3#', job: 'The address of the transaction, in request phase a only. For a line read, it is the address of the 8 bytes that the core needs first; the other 3 transfers come in the P6 burst order with no new address. A35#–A32# are 0 on this board (the core does not use 36-bit addresses). A2–A0 are not pins: BE7#–BE0# select the bytes.', drv: 'Pentium Pro', rcv: 'the chipset (memory and I/O decoders)', lvl: 'low (the address pins are active low)', chip: 'cpu' },
  be: { n: 'Byte enables BE7#–BE0#', job: 'The bytes of the 8-byte group that a transaction of 8 bytes or less uses (0 = used). The P6 sends them in request phase b, on the pins A15#–A8#. A line transaction uses all 8 bytes of each transfer.', drv: 'Pentium Pro', rcv: 'the chipset', lvl: 'low', chip: 'cpu' },
  bnr: { n: 'Block next request', job: 'An agent that cannot take more transactions holds BNR# low, and no agent starts a new request. The chipset of this model can always take the next request, so BNR# stays high.', drv: 'any bus agent (the chipset)', rcv: 'Pentium Pro', lvl: 'low', chip: 'bus' },
  bpri: { n: 'Priority agent bus request', job: 'The priority agent (the chipset, for example for a DMA transfer to memory) takes the request bus with BPRI#. This model does no DMA on the front-side bus, so BPRI# stays high.', drv: 'the chipset', rcv: 'Pentium Pro', lvl: 'low', chip: 'bus' },
  hit: { n: 'Snoop hit', job: 'In the snoop phase, each other cache on the bus looks for the line of the transaction. HIT# low tells that a cache has a clean copy (S or E). This board has one CPU and no other cache, so HIT# stays high.', drv: 'the other bus agents (other CPUs)', rcv: 'Pentium Pro, the chipset', lvl: 'low', chip: 'cpu' },
  hitm: { n: 'Snoop hit to a modified line', job: 'HITM# low in the snoop phase tells that another cache has a modified (M) copy of the line. That cache then writes the line on the bus (an implicit write-back, response 110). With no other cache, HITM# stays high.', drv: 'the other bus agents (other CPUs)', rcv: 'Pentium Pro, the chipset', lvl: 'low', chip: 'cpu' },
  rs: { n: 'Response status RS2#–RS0#', job: 'In the response phase the chipset tells how the transaction ends: 111 normal data (the read data comes with DRDY#), 101 no data (a write; its data moved already), 110 implicit write-back, 010 deferred, 001 retry, 100 hard failure, 000 idle. This list is simplified; 1 = the pin is low.', drv: 'the chipset (the response agent)', rcv: 'Pentium Pro', lvl: 'low (1 in the codes)', chip: 'bus' },
  trdy: { n: 'Target ready', job: 'TRDY# low tells the Pentium Pro that the chipset can take the write data. The CPU puts the data on D63#–D0# in the next BCLK, with DRDY#.', drv: 'the chipset', rcv: 'Pentium Pro', lvl: 'low', chip: 'bus' },
  drdy: { n: 'Data ready', job: 'DRDY# is low in each BCLK in which D63#–D0# carry valid data: 8 bytes. A line of 32 bytes needs 4 BCLKs with DRDY#. The agent that sends the data drives it: the chipset for a read, the CPU for a write.', drv: 'the chipset (read) or the Pentium Pro (write)', rcv: 'the other side', lvl: 'low', chip: 'bus' },
  dbsy: { n: 'Data bus busy', job: 'DBSY# stays low while a transfer of more than one BCLK uses the data bus (a line of 4 transfers). No other agent may drive the data bus until DBSY# goes high.', drv: 'the agent that sends the data', rcv: 'all bus agents', lvl: 'low', chip: 'bus' },
  d: { n: 'Data bus D63#–D0#', job: 'The 64-bit data bus: 8 bytes in each transfer, in the BCLKs with DRDY#. The row shows the 8 byte lanes, D63–D56 at the left; ·· is a lane that the transfer does not use. A line fill of the L2 needs 4 transfers.', drv: 'the chipset (read data, the vector of an interrupt acknowledge) or the Pentium Pro (write data)', rcv: 'the other side', lvl: 'low (the data pins are active low)', chip: 'bus' },
  state: { n: 'Transaction (decoded)', job: 'This row is not a pin. It shows the type of each front-side bus transaction: LINE READ (an L2 miss: 32 bytes), CODE LINE, WRITE-BACK (a modified L2 line goes to memory), MEMR and MEMW (8 bytes or less, not cached), IOR, IOW, INTA and HALT. 2, 3 and 4 are the next transfers of a line.', drv: 'decoded from REQ4#–REQ0#', rcv: '—', lvl: 'no active level', chip: 'bus' },
  phase: { n: 'Bus phase (decoded)', job: 'This row is not a pin. A P6 transaction goes through phases: REQUEST (2 BCLKs: phase a and phase b), SNOOP (the other caches look for the line), RESPONSE (RS2#–RS0#) and DATA (DRDY#). The real bus overlaps the phases of different transactions; this model does one transaction at a time.', drv: 'decoded from ADS#, RS2#–RS0# and DRDY#', rcv: '—', lvl: 'no active level', chip: 'bus' },
  cache: { n: 'L1 and L2 caches (decoded)', job: 'This row is not a pin. It shows where each access of the core finds its data: L1 HIT (the 8 KB L1 code or data cache, 3 clocks for a load), L2 HIT (the 256 KB L2 in the same package, on the back-side bus at the core clock: no FSB transaction), or L2 MISS: the line comes on the front-side bus. The L1 data line states are M, E, S and I (MESI).', drv: 'the L1 caches and the L2 of the Pentium Pro', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  retire: { n: 'Retire (decoded)', job: 'This row is not a pin. It shows the µops that retire in each core clock. The reorder buffer (ROB) retires up to 3 µops each clock, in program order. At the retire, the results go into the retirement register file: then the program sees them.', drv: 'the ROB of the Pentium Pro', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  btb: { n: 'Branch prediction (decoded)', job: 'This row is not a pin. It shows each branch at the clock at which its µop executes: the prediction (from the BTB with the 2-level history, from the decoder, or from the return stack buffer), the result, and the clocks that a wrong prediction costs (the µops after the branch are flushed, and the fetch starts again).', drv: 'the branch prediction logic of the Pentium Pro', rcv: '—', lvl: 'no active level', chip: 'cpu' },
  ferr: { n: 'Floating-point error', job: 'FERR# goes low when the FPU on the chip has an unmasked exception. With CR0.NE = 0 the board sends it to IRQ 13, as on the AT; with NE = 1 the Pentium Pro gives #MF (vector 16) itself.', drv: 'Pentium Pro (the FPU on the chip)', rcv: 'IRQ 13 logic (slave 8259A)', lvl: 'low', chip: 'cpu' },
  intr: { n: 'Interrupt request (LINT0)', job: 'With the local APIC off, the pin LINT0 is INTR: the master 8259A asks the Pentium Pro for an interrupt. The CPU checks INTR between two instructions when IF = 1, and it answers with an interrupt acknowledge transaction.', drv: 'master 8259A', rcv: 'Pentium Pro', lvl: 'high', chip: 'pic' },
  nmi: { n: 'Non-maskable interrupt (LINT1)', job: 'With the local APIC off, the pin LINT1 is NMI. NMI starts INT 2, and the IF flag cannot stop it. On the AT, memory parity errors go to NMI through the NMI mask (port 70h, bit 7).', drv: 'NMI logic', rcv: 'Pentium Pro', lvl: 'high (rising edge)', chip: 'nmi' },
  lock: { n: 'Bus lock', job: 'LOCK# is low during the transactions of an instruction with the LOCK prefix (and XCHG with memory) and during the interrupt acknowledge. Then no other agent can use the bus between them.', drv: 'Pentium Pro', rcv: 'the chipset, the other bus agents', lvl: 'low', chip: 'cpu' },
};

class TimingView {
  constructor(host, app) {
    this.host = host;
    this.app = app;
    this.shown = false;
    this.reduced = !!app.reducedMotion;
    this.ts = new Uint8Array(TV_CAP);
    this.qs = new Uint8Array(TV_CAP);
    this.fl = new Uint8Array(TV_CAP);
    this.rq = new Uint8Array(TV_CAP);
    this.abs = new Float64Array(TV_CAP);
    this.cyc = new Array(TV_CAP).fill(null);
    this.marks = [];
    this.head = 0;
    this.lastAbsEnd = -1;
    this.reveal = 0;
    this.play = null;
    this.px = 26;
    this.right = 0;
    this.shownRight = 0;
    this.live = true;
    this.pin = null;
    this.hover = null;
    this.version = 0;
    this.rendered = null;
    this.valKey = '';
    this.lastFast = 0;
    this.fastMode = false;
    this.traffic = { t0: 0, n: 0, acc: null, rates: null, cps: 0 };
    this.occ = null;
    this.occT = 0;
    this.charW = 6.6;
    this.measured = false;
    this.pointers = new Map();
    this.flat = [];
    // the 80386 uses the 80286 code paths (a separate address bus, cycles of 2 or more clocks);
    // the 80486 uses the 80386 paths and adds the burst signals and the cache row
    // the Pentium (m586: the model '80586' with the Pentium core, cpu.dcache) uses the 80486 paths
    // with the 64-bit bus, the two caches, the pipes and the BTB. The model '80586' with an 80486
    // core (a Machine486 on this page) uses the 80486 view.
    // The Pentium Pro (m686: the model '80686' with the P6 core, cpu.rob) uses the Pentium paths
    // with the P6 front-side bus: the phases, the bus clock (bR core clocks) and the decoded rows.
    const cpu0 = app.machine && app.machine.cpu;
    this.m686 = app.model === '80686' && !!(cpu0 && cpu0.rob);
    this.m586 = (app.model === '80586' || app.model === '80686') && !!(cpu0 && cpu0.dcache);
    this.m486 = app.model === '80486' || app.model === '80586' || app.model === '80686';
    const bus0 = app.machine && app.machine.bus;
    this.bR = this.m686 ? Math.max(1, Math.round((bus0 && bus0.busRatio) || cpu0.busRatio || 3)) : 1;
    if (this.m686) this.px = 12;
    this.m386 = app.model === '80386' || this.m486;
    this.m286 = app.model === '80286' || this.m386;
    this.lastBeat = this.m586 ? 3 : 7;   // the last transfer of a burst
    this.lineMask = this.m586 ? 31 : 15; // the offset bits of a cache line
    this.groups = this.m686 ? TV_GROUPS_686 : this.m586 ? TV_GROUPS_586 : this.m486 ? TV_GROUPS_486 : this.m386 ? TV_GROUPS_386 : this.m286 ? TV_GROUPS_286 : TV_GROUPS;
    this.notes = [];       // 80486: the cache events { pos, end, text, col, e }
    this.xnotes = { pipe: [], btb: [], retire: [] };   // Pentium: the pipe and BTB events, as the cache notes (P6: retire)
    this.lastCycEnd = -1;
    this.busyUntil = -1;
    this.info = this.m686 ? TV_INFO_686 : this.m586 ? TV_INFO_586 : this.m486 ? TV_INFO_486 : this.m386 ? TV_INFO_386 : this.m286 ? TV_INFO_286 : TV_INFO;
    this.fpuName = this.m486 ? 'FPU' : this.m386 ? '80387' : this.m286 ? '80287' : '8087';
    this.sel = null;       // id of the signal in the detail card
    this.cardKey = '';
    this.cardT = 0;
    this.sndPos = -1;      // the newest clock that made a sound
    this.occB = 0;         // height of the trace panel over the bottom of the view
    this.ptip = null;      // tooltip element that follows the pointer on the waveforms
    this.ptipTimer = 0;
    this.ptipAt = null;
    for (const g of this.groups) for (const r of g.rows) { r.lab = TimingView.parseLabel(r.label); this.flat.push(r); }
    TimingView.injectStyle();
    this.build();
  }

  // ---------- DOM ----------
  static injectStyle() {
    if (document.getElementById('tv-style')) return;
    const s = document.createElement('style');
    s.id = 'tv-style';
    s.textContent = `
.tv-root { position: absolute; inset: 0; display: flex; flex-direction: column; --tv-plot: color-mix(in srgb, var(--panel) 45%, var(--void)); }
.tv-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 10px 14px 4px; min-height: 44px; }
.tv-titles { display: flex; flex-direction: column; min-width: 0; }
.tv-kicker { margin: 0; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; }
.tv-kicker b { color: var(--gold-hi); font-weight: 600; }
.tv-sub { font: 10.5px var(--mono); color: var(--faint); white-space: nowrap; }
.tv-tools { display: flex; gap: 4px; align-items: center; }
.tv-btn { height: 26px; min-width: 26px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel2);
  color: var(--muted); font: 600 11px var(--mono); letter-spacing: .06em; display: inline-flex; align-items: center; gap: 6px;
  transition: color .15s, border-color .15s, background .15s; }
.tv-btn:hover { color: var(--text); border-color: var(--ceramic-hi); }
.tv-btn svg { width: 12px; height: 12px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
.tv-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
.tv-live[aria-pressed="true"] { color: var(--phosphor); border-color: color-mix(in srgb, var(--phosphor) 45%, transparent); }
.tv-live[aria-pressed="true"] i { background: var(--phosphor); box-shadow: 0 0 8px var(--phosphor); }
.tv-traffic { display: flex; flex-wrap: wrap; gap: 4px 10px; font: 11px var(--mono); color: var(--muted); min-width: 0; }
.tv-traffic span { white-space: nowrap; font-variant-numeric: tabular-nums; }
.tv-traffic i { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
.tv-traffic b { color: var(--text); font-weight: 600; }
.tv-traffic .tv-mhz b { color: var(--phosphor); }
.tv-read { flex-basis: 100%; font: 11.5px var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 16px; font-variant-numeric: tabular-nums; }
.tv-read b { color: var(--text); font-weight: 600; }
.tv-read .tv-c { color: var(--cyan); } .tv-read .tv-d { color: var(--gold-hi); } .tv-read .tv-m { color: var(--magenta); }
.tv-read .tv-p { color: var(--phosphor); } .tv-read .tv-l { color: var(--lavender); }
.tv-scroll { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; position: relative; outline: none; touch-action: pan-y; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.tv-scroll:focus-visible { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold-hi) 50%, transparent); }
.tv-svg { display: block; user-select: none; -webkit-user-select: none; cursor: crosshair; }
.tv-win { position: absolute; top: 0; overflow: hidden; pointer-events: none; background: var(--tv-plot); border-radius: 6px; box-shadow: inset 0 0 0 1px var(--line-soft); }
.tv-mover, .tv-curtain, .tv-cursor, .tv-tag { position: absolute; top: 0; left: 0; will-change: transform; }
.tv-layer { position: absolute; left: 0; top: 0; overflow: visible; }
.tv-layer text { font-family: var(--mono); }
.tv-curtain { background: var(--tv-plot); border-left: 1.5px solid transparent; }
.tv-curtain.tv-play { border-left-color: var(--phosphor); box-shadow: -3px 0 10px -2px color-mix(in srgb, var(--phosphor) 55%, transparent); }
.tv-curtain.tv-play::before { content: ""; position: absolute; top: 0; bottom: 0; right: 100%; width: var(--tv-trail, 40px);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--phosphor) 12%, transparent)); }
.tv-cursor { display: none; border-left: 1px dashed color-mix(in srgb, var(--text) 50%, transparent); background: color-mix(in srgb, var(--text) 7%, transparent); }
.tv-cursor.tv-on { display: block; }
.tv-cursor.tv-clock { border-left: 1px solid color-mix(in srgb, var(--phosphor) 70%, transparent); background: color-mix(in srgb, var(--phosphor) 10%, transparent); }
.tv-tag { display: none; font: 10px/15px var(--mono); color: var(--text); padding: 0 6px; border-radius: 4px; background: var(--panel2); border: 1px solid var(--text); white-space: nowrap; }
.tv-tag.tv-on { display: block; }
.tv-tag.tv-clock { border-color: var(--phosphor); color: var(--phosphor); }
.tv-svg.tv-drag { cursor: grabbing; }
.tv-svg text { font-family: var(--mono); }
.tv-lab { fill: var(--text); font-size: 11px; }
.tv-lab.tv-dim { fill: var(--muted); }
.tv-grp { fill: var(--faint); font-family: var(--sans) !important; font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; font-weight: 600; }
.tv-val { font-size: 11px; text-anchor: end; font-variant-numeric: tabular-nums; }
.tv-side { position: absolute; display: none; overflow: auto; padding: 10px 12px; border-radius: var(--r);
  background: color-mix(in srgb, var(--panel) 82%, transparent); border: 1px solid var(--line-soft); font: 11.5px/1.55 var(--mono); color: var(--muted); }
.tv-side.tv-on { display: block; }
.tv-side h4 { margin: 0 0 6px; font: 600 10px var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--faint); }
.tv-side dl { display: grid; grid-template-columns: auto 1fr; gap: 0 12px; margin: 0 0 10px; }
.tv-side dt { color: var(--faint); } .tv-side dd { margin: 0; color: var(--text); }
.tv-hasside .tv-head .tv-traffic { display: none; }
.tv-side .tv-traffic { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-bottom: 10px; }
.tv-side ol { margin: 0; padding: 0 0 0 16px; color: var(--muted); }
.tv-side ol li::marker { color: var(--faint); }
.tv-side ol b { font-weight: 600; }
.tv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tv-names { position: absolute; left: 0; top: 0; pointer-events: none; }
.tv-nm { position: absolute; left: 16px; margin: 0; padding: 0; border: 0; border-radius: 3px; background: transparent; pointer-events: auto; cursor: pointer; }
.tv-nm:hover { background: color-mix(in srgb, var(--text) 7%, transparent); }
.tv-nm:focus-visible { outline: 1.5px solid var(--gold-hi); outline-offset: -1.5px; border-radius: 3px; }
.tv-nm.tv-sel { background: color-mix(in srgb, var(--gold-hi) 13%, transparent); box-shadow: inset 2px 0 0 var(--gold-hi); }
.tv-rowhl { position: absolute; left: 0; right: 0; display: none; pointer-events: none;
  background: color-mix(in srgb, var(--gold-hi) 7%, transparent); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--gold-hi) 40%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--gold-hi) 40%, transparent); }
.tv-rowhl.tv-on { display: block; }
.tv-ptip { white-space: pre-line; max-width: 290px; }
.tv-ptip b { font-weight: 600; }
.tv-card { position: absolute; z-index: 7; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  background: var(--tip-bg, var(--panel)); border: 1px solid var(--line); border-left: 3px solid var(--tv-ac, var(--cyan)); border-radius: 10px;
  box-shadow: 0 18px 40px -16px rgba(0, 0, 0, .9); font: 12px/1.45 var(--sans); color: var(--muted); }
.tv-card[hidden] { display: none; }
.tv-card-h { flex: none; display: flex; align-items: baseline; gap: 8px; padding: 8px 8px 4px 12px; }
.tv-card-sig { font: 700 13px var(--mono); color: var(--tv-ac, var(--text)); white-space: nowrap; }
.tv-ob { text-decoration: overline; }
.tv-card-name { flex: 1; min-width: 0; color: var(--text); font-weight: 600; }
.tv-x { flex: none; align-self: center; width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--muted); }
.tv-x:hover { color: var(--text); border-color: var(--faint); }
.tv-x svg { width: 12px; height: 12px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
.tv-card-body { overflow-y: auto; min-height: 0; padding: 0 12px 10px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.tv-card p { margin: 0 0 6px; color: var(--text); }
.tv-card dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; margin: 0 0 8px; }
.tv-card dt { color: var(--faint); font-size: 11px; letter-spacing: .04em; }
.tv-card dd { margin: 0; color: var(--text); min-width: 0; }
.tv-card h4 { margin: 6px 0 4px; font: 600 10px var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--faint); }
.tv-card h4 span { letter-spacing: 0; text-transform: none; font-weight: 400; }
.tv-card-now { font: 11.5px/1.45 var(--mono); color: var(--text); margin: 0 0 4px; }
.tv-card ol { list-style: none; margin: 0; padding: 0; }
.tv-card li button { display: grid; grid-template-columns: 6.2em 4.6em 1fr; gap: 8px; width: 100%; text-align: left; align-items: baseline;
  padding: 2px 6px; margin: 0; border: 0; border-radius: 5px; background: none; font: 11.5px/1.4 var(--mono); color: var(--muted); }
.tv-card li button:hover { background: color-mix(in srgb, var(--text) 6%, transparent); color: var(--text); }
.tv-card li button:focus-visible { outline-offset: -2px; }
.tv-card li.tv-at button { background: color-mix(in srgb, var(--gold-hi) 11%, transparent); color: var(--text); }
.tv-card li b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tv-card li span { min-width: 0; }
.tv-card .tv-ct { color: var(--faint); white-space: nowrap; }
.tv-card .tv-more { padding: 2px 6px; color: var(--faint); font: 11px var(--mono); }
`;
    document.head.appendChild(s);
  }

  static parseLabel(s) {
    let text = '', open = -1;
    const bars = [];
    for (const ch of s) {
      if (ch === '{') open = text.length;
      else if (ch === '}') { bars.push([open, text.length]); open = -1; }
      else text += ch;
    }
    return { text, bars };
  }

  build() {
    const root = this.root = htmlEl('div', { class: 'tv-root' }, this.host);
    const hdr = this.hdr = htmlEl('div', { class: 'tv-head' }, root);
    const titles = htmlEl('div', { class: 'tv-titles' }, hdr);
    const k = htmlEl('h3', { class: 'tv-kicker' }, titles);
    k.innerHTML = 'Bus timing <b>· logic analyser</b>';
    const hz = (this.app.machine && this.app.machine.clockHz) || (this.m286 ? 8000000 : 4772727);
    const ns = (1e9 / hz).toFixed(1).replace(/\.0$/, '');
    const ws = (this.app.machine && this.app.machine.bus && this.app.machine.bus.waitStates) || 0;
    htmlEl('span', { class: 'tv-sub' }, titles, this.m686
      ? `Pentium Pro · FSB ${(hz / this.bR / 1e6).toFixed(1)} MHz × ${this.bR} = ${(hz / 1e6).toFixed(0)} MHz core · 64-bit · line ${2 + ws}-${1 + ws}-${1 + ws}-${1 + ws} BCLK`
      : this.m586
      ? `Pentium · 64-bit bus · burst ${2 + ws}-${1 + ws}-${1 + ws}-${1 + ws} · 1 T-state = ${ns} ns · CLK ${(hz / 1e6).toFixed(0)} MHz`
      : this.m486
      ? `80486 · BS16 16-bit bus · burst 2-1-1-1 · 1 T-state = ${ns} ns · CLK ${(hz / 1e6).toFixed(0)} MHz`
      : this.m386 ? `80386 · 16-bit bus · 1 T-state = ${ns} ns · CLK2 ${(2 * hz / 1e6).toFixed(0)} MHz`
      : this.m286
        ? `80286 → 82288 · 1 T-state = ${ns} ns · CLK ${(2 * hz / 1e6).toFixed(0)} MHz`
        : `max mode · 8086 → 8288 · 1 clock = ${ns} ns`);
    const tools = htmlEl('div', { class: 'tv-tools', role: 'toolbar', 'aria-label': 'Analyser view controls' }, hdr);
    const zo = htmlEl('button', { type: 'button', class: 'tv-btn', 'aria-label': 'Zoom out (show more clocks)', title: 'Zoom out (−)' }, tools);
    zo.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8"/></svg>';
    const zi = htmlEl('button', { type: 'button', class: 'tv-btn', 'aria-label': 'Zoom in (show fewer clocks)', title: 'Zoom in (+)' }, tools);
    zi.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8M6 2v8"/></svg>';
    const live = this.liveBtn = htmlEl('button', { type: 'button', class: 'tv-btn tv-live', 'aria-pressed': 'true', 'aria-label': 'Live: follow the newest clock', title: 'Snap to the newest clock (L)' }, tools);
    live.innerHTML = '<i aria-hidden="true"></i>Live';
    zo.addEventListener('click', () => this.zoomBy(1 / 1.5));
    zi.addEventListener('click', () => this.zoomBy(1.5));
    live.addEventListener('click', () => this.goLive());
    this.trafficEl = htmlEl('div', { class: 'tv-traffic', 'aria-label': 'Bus traffic' }, hdr);
    this.readEl = htmlEl('div', { class: 'tv-read' }, hdr);
    const sc = this.scrollEl = htmlEl('div', {
      class: 'tv-scroll', tabindex: '0', role: 'group',
      'aria-label': `Logic analyser plot of the ${this.m686 ? 'Pentium Pro front-side' : this.m586 ? 'Pentium' : this.m486 ? '80486' : this.m386 ? '80386' : '8086'} bus. Arrow keys move the cursor one clock, Shift+arrow one bus cycle. Plus and minus zoom. L returns to live.`,
    }, root);
    this.sr = htmlEl('div', { class: 'tv-sr', 'aria-live': 'polite' }, root);
    this.side = htmlEl('div', { class: 'tv-side', 'aria-hidden': 'true' }, root);
    // Static labels (SVG) below; the plot window above it holds composited layers:
    // the mover (pre-built waveforms, moved by translateX), the curtain (hides clocks
    // that are not revealed yet, carries the beam) and the cursor.
    const svg = this.svg = svgEl('svg', { class: 'tv-svg', width: 10, height: 10 }, sc);
    this.bg = svgEl('g', null, svg);
    const win = this.win = htmlEl('div', { class: 'tv-win', 'aria-hidden': 'true' }, sc);
    this.mover = htmlEl('div', { class: 'tv-mover' }, win);
    this.underSvg = svgEl('svg', { class: 'tv-layer' }, this.mover);
    this.waveSvg = svgEl('svg', { class: 'tv-layer' }, this.mover);
    this.rowHl = htmlEl('div', { class: 'tv-rowhl' }, win);
    this.curtain = htmlEl('div', { class: 'tv-curtain' }, win);
    this.cursorEl = htmlEl('div', { class: 'tv-cursor' }, win);
    this.tagEl = htmlEl('div', { class: 'tv-tag' }, win);
    // One button over each signal name: tooltip, keyboard focus, click opens the card.
    this.namesEl = htmlEl('div', { class: 'tv-names', role: 'group', 'aria-label': 'Signals. Up and down arrows move between the signals. Enter shows the details.' }, sc);
    this.nameBtn = {};
    this.flat.forEach((r, k) => {
      const b = htmlEl('button', { type: 'button', class: 'tv-nm', tabindex: k ? '-1' : '0', 'aria-expanded': 'false', 'aria-controls': 'tv-card' }, this.namesEl);
      b.dataset.id = r.id;
      setTip(b, this.nameTip(r), this.nameTip(r) + ' Press Enter to show the details.');
      this.nameBtn[r.id] = b;
    });
    // The detail card of one signal (not a browser dialog).
    const card = this.card = htmlEl('div', { class: 'tv-card', id: 'tv-card', role: 'region', 'aria-label': 'Signal details' }, root);
    card.hidden = true;
    const ch = htmlEl('div', { class: 'tv-card-h' }, card);
    this.cardSig = htmlEl('b', { class: 'tv-card-sig' }, ch);
    this.cardName = htmlEl('span', { class: 'tv-card-name' }, ch);
    const x = htmlEl('button', { type: 'button', class: 'tv-x' }, ch);
    x.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
    setTip(x, 'Close the details (Esc)');
    x.addEventListener('click', () => this.closeCard(true));
    this.cardBody = htmlEl('div', { class: 'tv-card-body' }, card);
    this.styleCache = new Map();
    this.wire();
  }

  wire() {
    const sc = this.scrollEl, svg = this.svg;
    const local = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const posAt = x => { const L = this.lay; return L ? this.leftPos() + (x - L.plotX) / this.px : 0; };
    svg.addEventListener('pointerdown', e => {
      const p = local(e);
      this.hideTip();
      if (!this.lay || p.x < this.lay.plotX) return;
      this.pointers.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, right0: this.right, moved: false, t: animNow() });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.abs(a.x - b.x) || 1, px: this.px, mid: (a.x + b.x) / 2, pos: posAt((a.x + b.x) / 2) };
      }
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    svg.addEventListener('pointermove', e => {
      const p = local(e);
      const st = this.pointers.get(e.pointerId);
      if (!st) {
        if (e.pointerType === 'mouse' && this.lay && p.x >= this.lay.plotX) { this.hover = Math.floor(posAt(p.x)); this.dirtyCursor = true; }
        if (e.pointerType !== 'touch' && this.lay && p.x >= this.lay.plotX) this.moveTip(posAt(p.x), p.y, e.clientX, e.clientY);
        else this.hideTip();
        return;
      }
      this.hideTip();
      st.x = p.x; st.y = p.y;
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.abs(a.x - b.x) || 1;
        this.setZoom(this.pinch.px * d / this.pinch.d, this.pinch.mid, this.pinch.pos);
        return;
      }
      if (Math.abs(p.x - st.x0) > 4) st.moved = true;
      if (st.moved) {
        svg.classList.add('tv-drag');
        this.right = st.right0 - (p.x - st.x0) / this.px;
        this.live = false;
        this.clampView();
        this.syncLive();
      }
    });
    const up = e => {
      const st = this.pointers.get(e.pointerId);
      if (!st) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      svg.classList.remove('tv-drag');
      if (!st.moved && e.type === 'pointerup' && this.lay) {
        const pos = Math.floor(posAt(st.x));
        this.pin = this.pin === pos ? null : this.validPos(pos) ? pos : null;
        this.dirtyCursor = true;
        this.announce();
        // a click on a signal row also opens its detail card
        const r = this.rowAt(st.y);
        if (r) this.openCard(r.id, false);
      }
      if (this.right >= this.reveal - 0.5 && !this.live) { this.live = true; this.syncLive(); }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', e => { this.hideTip(); if (e.pointerType === 'mouse') { this.hover = null; this.dirtyCursor = true; } });
    // on the scroll box, so that the wheel also works over the signal name buttons
    sc.addEventListener('wheel', e => {
      if (!this.lay) return;
      this.hideTip();
      const p = local(e);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        this.right += (e.shiftKey ? e.deltaY : e.deltaX) / this.px;
        this.live = false;
        this.clampView();
        this.syncLive();
        return;
      }
      if (!e.ctrlKey && sc.scrollHeight > sc.clientHeight + 2 && !e.altKey && p.x < this.lay.plotX) return;
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      this.setZoom(this.px * k, p.x, posAt(p.x));
    }, { passive: false });
    sc.addEventListener('keydown', e => this.key(e));
    sc.addEventListener('scroll', () => { this.hideTip(); if (this.sel) this.placeCard(); }, { passive: true });
    // signal names: click opens (or closes) the card; up / down arrows move the focus
    this.namesEl.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.tv-nm');
      if (b) this.openCard(b.dataset.id, true);
    });
    this.namesEl.addEventListener('keydown', e => {
      const b = e.target.closest && e.target.closest('.tv-nm');
      if (!b || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End')) return;
      const ids = this.flat.map(r => r.id);
      let k = ids.indexOf(b.dataset.id);
      if (e.key === 'ArrowUp') k = Math.max(0, k - 1);
      else if (e.key === 'ArrowDown') k = Math.min(ids.length - 1, k + 1);
      else if (e.key === 'Home') k = 0;
      else k = ids.length - 1;
      e.preventDefault();
      e.stopPropagation();
      this.focusName(ids[k]);
    });
    this.card.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeCard(true); }
    });
    this.card.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button[data-pos]');
      if (!b) return;
      const pos = +b.dataset.pos;
      if (!this.validPos(pos)) return;
      this.pin = pos;
      this.dirtyCursor = true;
      this.cardKey = '';
      this.announce();
      if (typeof Sfx !== 'undefined') Sfx.select();
    });
  }

  focusName(id) {
    for (const k in this.nameBtn) this.nameBtn[k].tabIndex = k === id ? 0 : -1;
    const b = this.nameBtn[id];
    if (b) b.focus();
  }

  key(e) {
    const last = Math.max(0, Math.ceil(this.reveal) - 1);
    let c = this.pin !== null ? this.pin : (this.play && this.play.manual ? this.curManual() : last);
    let used = true;
    if (e.key === 'ArrowLeft') c -= e.shiftKey ? 4 : 1;
    else if (e.key === 'ArrowRight') c += e.shiftKey ? 4 : 1;
    else if (e.key === 'Home') c = Math.max(0, this.head - TV_CAP);
    else if (e.key === 'End') { c = last; this.goLive(); }
    else if (e.key === '+' || e.key === '=') { this.zoomBy(1.4); used = 'zoom'; }
    else if (e.key === '-' || e.key === '_') { this.zoomBy(1 / 1.4); used = 'zoom'; }
    else if (e.key === 'l' || e.key === 'L') { this.goLive(); used = 'zoom'; }
    else if (e.key === 'Escape' && this.sel) { this.closeCard(true); used = 'zoom'; }
    else if (e.key === 'Escape') { this.pin = null; this.dirtyCursor = true; used = 'zoom'; }
    else used = false;
    if (!used) return;
    e.preventDefault();
    e.stopPropagation();
    if (used === 'zoom') return;
    c = clamp(c, Math.max(0, this.head - TV_CAP), last);
    this.pin = c;
    const span = this.lay ? this.lay.plotW / this.px : 40;
    const left = this.right - span;
    if (c < left + 1) { this.right = c - 1 + span; this.live = false; }
    else if (c > this.right - 1) { this.right = c + 2; }
    this.clampView();
    if (this.right < this.reveal - 0.5) this.live = false;
    this.syncLive();
    this.dirtyCursor = true;
    this.announce();
  }

  announce() {
    if (this.pin === null) { this.sr.textContent = 'Cursor off.'; return; }
    this.sr.textContent = this.readoutText(this.pin);
  }

  // ---------- view contract ----------
  show() {
    this.shown = true;
    this.resize();
  }
  hide() { this.shown = false; this.hideTip(); }
  setReducedMotion(on) { this.reduced = !!on; this.rendered = null; }
  reset() {
    this.sndPos = -1;
    this.cardKey = '';
    this.head = 0;
    this.ts.fill(0); this.qs.fill(0); this.fl.fill(0); this.rq.fill(0); this.cyc.fill(null);
    this.marks.length = 0;
    this.notes.length = 0;
    for (const k in this.xnotes) this.xnotes[k].length = 0;
    this.lastAbsEnd = -1;
    this.lastCycEnd = -1;
    this.busyUntil = -1;
    this.reveal = 0;
    this.play = null;
    this.pin = null;
    this.hover = null;
    this.live = true;
    this.right = this.shownRight = 0;
    this.version++;
    this.rendered = null;
    this.traffic = { t0: 0, n: 0, acc: null, rates: null, cps: 0 };
    this.fastMode = false;
    this.syncLive();
    this.dirtyCursor = true;
  }

  instr(events, info) {
    if (this.play) this.reveal = Math.max(this.reveal, this.play.end);
    const m = this.app.machine;
    const absStart = m && m.cpu ? m.cpu.cycles - info.cycles : this.lastAbsEnd;
    const base = this.append(events, info.cycles, absStart, info.text, false);
    this.fastMode = false;
    this.play = {
      base, end: this.head, cycles: info.cycles, t0: animNow(),
      clockMs: info.clockMs || 10, manual: info.clockMs >= 400,
    };
    if (this.reduced || this.app.mode === 'fast') this.reveal = Math.max(this.reveal, base);
  }

  event(e) {
    if (e.k === 'end' && this.play) {
      this.reveal = Math.max(this.reveal, this.play.end);
      this.play.done = true;
    }
  }

  fast(stats) {
    const now = animNow();
    this.fastMode = true;
    const tr = this.traffic;
    if (!tr.acc || now - tr.t0 > 5000) { tr.acc = Machine.newStats(); tr.t0 = now; tr.n = 0; }
    const b = stats.bus || {};
    for (const k in tr.acc) if (k !== 'dev' && typeof b[k] === 'number') tr.acc[k] += b[k];
    tr.cps = stats.cps || 0;
    const cpu = this.app.machine && this.app.machine.cpu;
    const C = this.m586 ? cpu.dcache : this.m486 && cpu ? cpu.cache486 : null;
    if (C) {
      const h = this.m586 ? C.stats.hits + cpu.icache.stats.hits : C.stats.hits, prev = this.lastHits;
      if (prev !== undefined && h >= prev) tr.acc.hits = (tr.acc.hits || 0) + (h - prev);
      this.lastHits = h;
    }
    if (now - tr.t0 >= 500) {
      const s = (now - tr.t0) / 1000;
      tr.rates = {};
      for (const k in tr.acc) if (k !== 'dev') tr.rates[k] = (tr.acc[k] || 0) / s;
      tr.acc = Machine.newStats(); tr.t0 = now;
      this.trafficDirty = true;
    }
    if (now - this.lastFast < 250 || !stats.sample || !stats.sample.length) return;
    this.lastFast = now;
    const sample = stats.sample;
    const end = sample.find(e => e.k === 'end');
    const dec = sample.find(e => e.k === 'decode');
    const cycles = end ? end.t : 4;
    const m = this.app.machine;
    this.play = null;
    this.append(sample, cycles, m.cpu.cycles - cycles, dec ? dec.text : '', true);
    this.reveal = this.head;
  }

  // ---------- history ----------
  clearPos(p, abs) {
    const i = p & TV_MASK;
    this.ts[i] = 0; this.qs[i] = 0; this.fl[i] = 0; this.rq[i] = 0; this.cyc[i] = null; this.abs[i] = abs;
  }
  extend(to, absAt) {
    while (this.head < to) { this.clearPos(this.head, absAt(this.head)); this.head++; }
  }

  // Add one instruction's micro-events to the ring. Returns the position of its clock 0.
  append(events, cycles, absStart, text, forceGap) {
    const gap = this.head > 0 && (forceGap || absStart !== this.lastAbsEnd);
    if (gap) {
      const g0 = this.head;
      for (let k = 0; k < 3; k++) { this.clearPos(this.head, -1); this.ts[this.head & TV_MASK] = TV_GAP; this.head++; }
      this.marks.push({ pos: g0, gap: this.lastAbsEnd >= 0 ? absStart - this.lastAbsEnd : 0 });
      this.lastCycEnd = -1;
      this.reveal = Math.max(this.reveal, this.head);
    }
    const base = this.head;
    const absAt = p => absStart + (p - base);
    this.extend(base + Math.max(1, cycles), absAt);
    let busFree = base;
    const inta = [], fpu = [], fills = new Map(), fills0 = new Map(), cacheEv = [], xEv = [], uops = [];
    let robE = null;
    const place = (type, e, width, data) => {
      const s = TV_STATUS[type];
      if (s === undefined) return null;
      let start = Math.max(base + e.t, busFree);
      const burstN = this.m486 && e.burst && e.beat > 0;
      let len = Math.max(burstN ? 1 : 2, e.len || 4), req = 0;
      if (this.m686) {
        // P6: a transaction starts at a BCLK edge; its first transfer comes after the request
        // and snoop phases (2 BCLKs); each transfer is a whole number of BCLKs
        const R = this.bR;
        start += (R - (start % R)) % R;
        if (!burstN) { req = 2 * R; len += req; }
        len = Math.ceil(len / R) * R;
      }
      this.extend(start + len, absAt);
      const addr = e.addr >>> 0;
      const c = {
        s, pos: start, addr, data: data >>> 0, width, fpu: e.owner === 'fpu',
        seg: type === 'code' ? 'CS' : (e.seg || null), text,
        bhe: s === 3 || s === 0 || s === 8 ? false : (width === 2 || (addr & 1) === 1),
        len, pipe: !this.m386 && start === this.lastCycEnd, dev: e.dev || null,
      };
      if (this.m386) c.ble = s !== 3 && s !== 8 && (width === 2 || (addr & 1) === 0);
      if (this.m486 && e.burst) { c.burst = true; c.beat = e.beat | 0; c.line = e.line >>> 0; if (burstN) c.t0 = 2; }
      if (this.m586) { c.hi = (e.hi || 0) >>> 0; if (e.wb) c.wb = true; }
      if (this.m686) c.req = req;
      const t0 = c.t0 || 1;
      for (let k = 0; k < len; k++) { const i = (start + k) & TV_MASK; this.ts[i] = this.m686 ? (k ? 2 : 1) : k + t0; this.cyc[i] = c; }
      if (c.burst) { fills.set(c.line, c); if (!c.beat) fills0.set(c.line, c); }
      busFree = start + len;
      this.lastCycEnd = busFree;
      return c;
    };
    const lastT = base + cycles - 1;
    for (let j = 0; j < events.length; j++) {
      const e = events[j];
      if (e.k === 'fetch') place('code', e, e.width, e.data);
      else if (e.k === 'bus') {
        // The 8087 moves operands as words: pair byte accesses at addr, addr+1.
        const n = events[j + 1];
        if (e.owner === 'fpu' && e.width === 1 && !(e.addr & 1) && n && n.k === 'bus' && n.owner === 'fpu' &&
            n.type === e.type && n.addr === e.addr + 1) {
          const c = place(e.type, e, 2, (e.data & 0xFF) | ((n.data & 0xFF) << 8));
          if (c) fpu.push(c);
          j++;
          continue;
        }
        const c = place(e.type, e, e.width, e.data);
        if (!c) continue;
        if (c.s === 0) inta.push(c);
        if (c.fpu) fpu.push(c);
      } else if (e.k === 'queue') {
        const p = base + e.t;
        if (e.op === 'flush') { if (p < this.head) this.qs[p & TV_MASK] = 2; }
        else if (e.op === 'pop') {
          for (let k = 0; k < e.n; k++) {
            const q = Math.min(p + k, lastT);
            if (q < this.head && !(this.qs[q & TV_MASK] === 1 && k)) this.qs[q & TV_MASK] = k ? 3 : 1;
          }
        }
      } else if (e.k === 'int') {
        if (e.src === 'nmi') this.flagRange(base - 3, base + 2, TV_F_NMI);
        if (this.m286 && e.src === 'exc' && e.vec === 16) this.flagRange(base - 4, base + 2, TV_F_ERR);
      } else if (e.k === 'cache' && this.m486) {
        cacheEv.push(e);
      } else if ((e.k === 'pipe' || e.k === 'btb') && this.m586) {
        xEv.push(e);
      } else if (e.k === 'uop' && this.m686) {
        uops.push(e);
      } else if (e.k === 'rob' && this.m686) {
        robE = e;
      } else if (e.k === 'fpu' && this.m286) {
        this.busyUntil = Math.max(this.busyUntil, base + e.t + Math.min(e.cycles || 0, 1500));
      }
    }
    if (/^hlt$/i.test(text || '')) place('halt', { t: Math.max(0, cycles - 2), addr: this.m286 ? 2 : 0, owner: 'cpu', len: this.m686 ? 2 * this.bR : this.m286 ? 2 : 4 }, 1, 0);
    if (inta.length && this.m286) {
      // 80286: LOCK stays active from the first INTA cycle to the end of the second.
      const a = inta[0], b = inta[inta.length - 1];
      b.second = true;
      this.flagRange(Math.max(base - 2, this.firstLive()), b.pos + 1, TV_F_INTR);
      this.flagRange(a.pos, b.pos + b.len, TV_F_LOCK);
    } else if (inta.length) {
      const a = inta[0], b = inta[inta.length - 1];
      b.second = true;
      this.flagRange(Math.max(base - 2, this.firstLive()), b.pos + 2, TV_F_INTR);
      this.flagRange(a.pos + 1, b.pos + 2, TV_F_LOCK);
    }
    if (/^lock\b/i.test(text || '')) this.flagRange(base, this.head, TV_F_LOCK);
    if (fpu.length && this.m286) {
      // 80287 processor-extension data channel: PEREQ asks, PEACK answers each transfer.
      this.flagRange(Math.max(base, fpu[0].pos - 1), fpu[fpu.length - 1].pos + fpu[fpu.length - 1].len, TV_F_PEREQ);
      for (const c of fpu) this.rq[c.pos & TV_MASK] = 4;
    } else if (fpu.length) {
      let g0 = fpu[0], prev = fpu[0];
      const close = (a, z) => {
        const rqAt = Math.max(base, a.pos - 3), gtAt = Math.max(rqAt + 1, a.pos - 1), rel = z.pos + 4;
        this.extend(rel + 1, absAt);
        this.rq[rqAt & TV_MASK] = 1;
        this.rq[gtAt & TV_MASK] = 2;
        this.rq[rel & TV_MASK] = 3;
        this.flagRange(gtAt + 1, rel, TV_F_FPU);
      };
      for (let k = 1; k < fpu.length; k++) {
        if (fpu[k].pos - prev.pos > 8) { close(g0, prev); g0 = fpu[k]; }
        prev = fpu[k];
      }
      close(g0, prev);
    }
    if (this.m286 && this.busyUntil > base) this.flagRange(base, this.busyUntil, TV_F_BUSY);
    if (this.m686) this.addNotes686(cacheEv, base, fills);
    else for (const e of cacheEv) this.addNote(e, base, fills);
    // a line fill with no 'cache' event (the core reports the first data access and the first
    // code miss of an instruction): a note from its cycles
    const LM = this.lineMask, setOf = line => (this.m586 ? line >>> 5 : line >>> 4) & 127;
    for (const [line, c0] of fills0) {
      const c1 = fills.get(line), code = c0.s === 4;
      if (c0.wb) {
        // Pentium: a write-back burst with no 'cache' event (WBINVD): a note from its cycles
        if (cacheEv.some(e => e.wb && (e.wbLine >>> 0) === line)) continue;
        this.notes.push({ pos: c0.pos, end: c1.pos + c1.len, text: this.m686 ? 'L2 WRITE-BACK · FSB' : 'WRITE-BACK', short: 'WB', col: THEME.goldHi,
          e: { phys: line, set: setOf(line), way: -1, hit: false, fill: false, write: true, code: false, synth: true, wbOnly: true, state: 'M' } });
        continue;
      }
      if (cacheEv.some(e => e.fill && ((e.phys >>> 0) - ((e.phys >>> 0) & LM)) === line)) continue;
      this.notes.push({ pos: c0.pos, end: c1.pos + c1.len, text: this.m686 ? (code ? 'CODE LINE · FSB' : 'LINE · FSB') : code ? 'CODE FILL' : 'FILL', col: THEME.cyan, short: this.m686 ? 'FSB' : undefined,
        e: { phys: line, set: setOf(line), way: -1, hit: false, fill: true, write: false, code, synth: true } });
    }
    if (fills0.size || this.m686) this.notes.sort((a, b) => a.pos - b.pos);
    // Pentium Pro: the µops that retire in each clock of the step
    if (this.m686 && uops.length && robE) this.addRetire686(uops, robE, base, cycles, text);
    // Pentium: the pipe of each instruction and its branch in the BTB
    for (const e of xEv) {
      const end = Math.max(base + Math.max(1, cycles), this.head);
      if (e.k === 'pipe') {
        const v = e.pipe === 'V';
        const text = v ? 'V · pair' : e.paired ? 'U · pair' : 'U only';
        const col = v ? THEME.lavender : e.paired ? THEME.cyan : THEME.muted;
        this.xnotes.pipe.push({ pos: base, end, text, col, e, short: v ? 'V' : e.paired ? 'U+V' : 'U' });
      } else {
        const pos = Math.min(base + (e.t | 0), end - 1);
        const text = e.right ? `${e.predicted ? 'TAKEN' : 'NOT TAKEN'} ✓` : `WRONG +${e.penalty}`;
        this.xnotes.btb.push({ pos, end, text, col: e.right ? THEME.phosphor : THEME.magenta, e, short: e.right ? '✓' : '✗' + e.penalty });
      }
    }
    this.lastAbsEnd = absStart + cycles;
    this.marks.push({ pos: base, abs: absStart, text: text || '', end: this.head });
    const tail = this.head - TV_CAP;
    while (this.marks.length && this.marks[0].pos < tail) this.marks.shift();
    while (this.notes.length && this.notes[0].end < tail) this.notes.shift();
    for (const k in this.xnotes) { const X = this.xnotes[k]; while (X.length && X[0].end < tail) X.shift(); }
    this.version++;
    return base;
  }
  // 80486: a note on the cache row for a 'cache' event. A fill note covers the burst of its line.
  addNote(e, base, fills) {
    const pos = base + (e.t | 0);
    let end = pos + 1, text, col;
    const line = (e.phys >>> 0) - ((e.phys >>> 0) & this.lineMask);
    if (e.write) { text = e.hit ? 'WR HIT' : 'WR MISS'; col = THEME.goldHi; }
    else if (e.hit) { text = 'HIT'; col = THEME.phosphor; }
    else if (e.fill) {
      text = 'MISS · FILL'; col = THEME.magenta;
      const last = fills.get(line);
      if (last) end = Math.max(end, last.pos + last.len);
      // Pentium: the fill replaced an M line; the note covers the write-back burst too
      const wb = e.wb ? fills.get(e.wbLine >>> 0) : null;
      if (wb) end = Math.max(end, wb.pos + wb.len);
    } else { text = 'NO CACHE'; col = THEME.magenta; }
    if (this.m586 && e.state && !e.code && (e.hit || e.fill)) text += ' ' + e.state;
    if (this.m586 && e.wb) text += ' · WB';
    if (e.code) text = 'CODE ' + text;
    end = Math.min(end, this.head);
    if (end <= pos) end = pos + 1;
    const n = { pos, end, text, col, e };
    if (this.m586) n.short = e.write ? 'WR' : e.hit ? 'HIT' : e.fill ? 'FILL' : 'NC';
    this.notes.push(n);
  }
  // Pentium Pro: one note for each L1 access (the first data access and the first code miss of
  // the step), with its L2 part: L1 hit, L2 hit (the back-side bus: no FSB transaction) or L2 miss
  // (the note covers the FSB line read, and the write-back of a modified L2 line before it).
  addNotes686(cacheEv, base, fills) {
    const L2 = cacheEv.filter(e => e.level === 'L2');
    for (const e of cacheEv) {
      if (e.level === 'L2') continue;
      const code = e.cache === 'code' || !!e.code;
      const e2 = L2.find(x => (x.cache === 'code') === code) || null;
      const line = (e.phys >>> 0) - ((e.phys >>> 0) & 31);
      const pos = base + (e.t | 0);
      let end = pos + 1, text, short, col, lvl;
      if (e.hit) { lvl = 'L1'; text = e.write ? 'L1 WR HIT' : 'L1 HIT'; short = 'L1'; col = THEME.phosphor; }
      else if (e2 && e2.hit) { lvl = 'L2'; text = e.write ? 'L1 WR MISS · L2 HIT' : 'L1 MISS · L2 HIT'; short = 'L2'; col = THEME.cyan; }
      else if (e2) {
        lvl = 'FSB'; text = e.write ? 'L1 WR MISS · L2 MISS · FSB' : 'L1 MISS · L2 MISS · FSB'; short = 'FSB'; col = THEME.magenta;
        const last = fills.get(line);
        if (last) end = Math.max(end, last.pos + last.len);
        const wb = e2.wb ? fills.get(e2.wbLine >>> 0) : null;
        if (wb) end = Math.max(end, wb.pos + wb.len);
      } else { lvl = 'FSB'; text = e.nc ? 'NO CACHE · FSB' : e.write ? 'L1 WR MISS · FSB' : 'L1 MISS · FSB'; short = e.nc ? 'NC' : 'FSB'; col = THEME.magenta; }
      if (!code && e.state && (e.hit || e.fill)) text += ' ' + e.state;
      if (code) text = 'CODE ' + text;
      end = Math.min(end, this.head);
      if (end <= pos) end = pos + 1;
      const x = Object.assign({}, e, { hit: lvl !== 'FSB', l1hit: !!e.hit, l2: e2, lvl, code });
      this.notes.push({ pos, end, text, short, col, e: x });
    }
  }
  // Pentium Pro: the retire row. A µop that retires at the model clock r goes to the position of
  // r in the step (the 'rob' event gives the model clock of t = 0: base). The last µop retires in
  // the last clock of the step. Up to 3 µops retire in one clock; more in one position show the
  // floor rule (the step is shorter than the model).
  addRetire686(uops, robE, base, cycles, text) {
    const n = Math.max(1, cycles), per = new Map();
    for (const u of uops) {
      const k = clamp(Math.round(u.retire - robE.base) - 1, 0, n - 1);
      let a = per.get(k);
      if (!a) per.set(k, a = []);
      a.push(u.kind + (u.dst ? ' ' + u.dst : ''));
    }
    const ks = [...per.keys()].sort((a, b) => a - b), X = this.xnotes.retire;
    for (const k of ks) {
      const a = per.get(k), c = a.length;
      X.push({ pos: base + k, end: base + k + 1, text: `${c} µop${c === 1 ? '' : 's'}`, short: String(c), col: c > 3 ? THEME.goldHi : THEME.phosphor,
        e: { n: c, kinds: a.join(', '), text: text || uops[0].text || '', floor: robE.floor, debt: robE.debt, all: robE.uops } });
    }
  }
  noteRuns(a, b, list) {
    const out = [];
    for (const n of list || this.notes) if (n.end > a && n.pos < b) out.push([n.pos + 0.06, n.end - 0.06, n.text, n.col, 0, n, n.short]);
    return out;
  }
  noteAt(p, list) {
    const L = list || this.notes;
    for (let k = L.length - 1; k >= 0; k--) { const n = L[k]; if (p >= n.pos && p < n.end) return n; }
    return null;
  }
  // The note list of a decoded row: the cache events, or (Pentium) the pipes and the BTB.
  notesOf(id) { return id === 'cache' ? this.notes : this.xnotes[id] || null; }
  firstLive() { return Math.max(0, this.head - TV_CAP); }
  flagRange(a, b, bit) {
    a = Math.max(a, this.firstLive());
    b = Math.min(b, this.head);
    for (let p = a; p < b; p++) { const i = p & TV_MASK; if (this.ts[i] !== TV_GAP) this.fl[i] |= bit; }
  }
  validPos(p) { return p >= this.firstLive() && p < this.head && this.ts[p & TV_MASK] !== TV_GAP; }

  // ---------- signal model ----------
  // Level list for a digital row at position p, or null in a history gap.
  levels(id, p) {
    const i = p & TV_MASK, T = this.ts[i];
    if (T === TV_GAP) return null;
    if (this.m286) return this.levels286(id, p, i, T);
    const c = this.cyc[i];
    switch (id) {
      case 'clk': return TV_CLK;
      case 'ready': return TV_H;
      case 's2': case 's1': case 's0': {
        const bit = id === 's2' ? 2 : id === 's1' ? 1 : 0;
        const cur = (T === 1 || T === 2) ? (c.s >> bit) & 1 : 1;
        const nIdx = (p + 1) & TV_MASK;
        if (p + 1 < this.head && this.ts[nIdx] === 1) {
          const nx = (this.cyc[nIdx].s >> bit) & 1;
          if (nx !== cur) return [0, cur, 0.66, nx];
        }
        return cur ? TV_H : TV_L;
      }
      case 'qs1': return (this.qs[i] >> 1) & 1 ? TV_H : TV_L;
      case 'qs0': return this.qs[i] & 1 ? TV_H : TV_L;
      case 'bhe': return T === 1 && c.bhe ? [0, 1, 0.1, 0] : TV_H;
      case 'ale': return T === 1 && c.s !== 3 ? TV_ALE : TV_L;
      case 'mrdc': return c && (c.s === 4 || c.s === 5) && (T === 2 || T === 3) ? TV_L : TV_H;
      case 'amwc': return c && c.s === 6 && (T === 2 || T === 3) ? TV_L : TV_H;
      case 'mwtc': return c && c.s === 6 && T === 3 ? TV_L : TV_H;
      case 'iorc': return c && c.s === 1 && (T === 2 || T === 3) ? TV_L : TV_H;
      case 'aiowc': return c && c.s === 2 && (T === 2 || T === 3) ? TV_L : TV_H;
      case 'iowc': return c && c.s === 2 && T === 3 ? TV_L : TV_H;
      case 'inta': return c && c.s === 0 && (T === 2 || T === 3) ? TV_L : TV_H;
      case 'dtr': {
        if (!c || !TimingView.isRead(c.s)) return TV_H;
        if (T === 1) return [0, 1, 0.33, 0];
        if (T === 4) return [0, 0, 0.5, 1];
        return TV_L;
      }
      case 'den': {
        if (!c || c.s === 3) return TV_L;
        if (TimingView.isRead(c.s)) return T === 2 ? [0, 0, 0.66, 1] : T === 3 ? TV_H : TV_L;
        return T === 2 || T === 3 ? TV_H : T === 4 ? [0, 1, 0.5, 0] : TV_L;
      }
      case 'rq': return this.rq[i] ? TV_PULSE : TV_H;
      case 'intr': return this.fl[i] & TV_F_INTR ? TV_H : TV_L;
      case 'nmi': return this.fl[i] & TV_F_NMI ? TV_H : TV_L;
      case 'lock': return this.fl[i] & TV_F_LOCK ? TV_L : TV_H;
    }
    return TV_H;
  }
  static isRead(s) { return s === 0 || s === 1 || s === 4 || s === 5; }

  // ---------- 80286 signal model ----------
  // Cycles that can touch position p (the previous one, this one, the next one).
  near(p) {
    const out = [];
    for (let q = p - 1; q <= p + 1; q++) {
      if (q < this.firstLive() || q >= this.head) continue;
      const c = this.cyc[q & TV_MASK];
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }
  // Start of the address / status group of a cycle: pipelined into the previous Tc.
  static addrStart(c) { return c.pipe ? c.pos - 0.5 : c.pos + 0.05; }
  // The status bits of a cycle: [COD/INTA, M/IO, S1, S0] (80286) or [M/IO, D/C, W/R] (80386).
  bits(s) { return (this.m386 ? TV_386_BITS : TV_286_BITS)[s]; }
  // Intervals (positions) where a pin of one cycle is at its active level.
  ivals286(id, c, out) {
    const p = c.pos, L = c.len, s = c.s, rd = TimingView.isRead(s), cmd = s !== 3 && s !== 8;
    if (this.m686) {
      // P6: ADS# in request phase a; TRDY# one BCLK before the first write data; DRDY# in the last
      // BCLK of each transfer; DBSY# from the first data BCLK of a line to the start of its last one
      const R = this.bR, dEnd = p + L;
      switch (id) {
        case 'ads': if (c.req) out.push([p + 0.05, p + R]); break;
        case 'trdy': if (c.req && (s === 2 || s === 6)) out.push([dEnd - 2 * R, dEnd - R]); break;
        case 'drdy': if (cmd) out.push([dEnd - R, dEnd]); break;
        case 'dbsy':
          if (c.burst) { if (!c.beat) out.push([dEnd - R, dEnd]); else if (c.beat < 3) out.push([p, dEnd]); else if (L > R) out.push([p, dEnd - R]); }
          break;
      }
      return;
    }
    if (this.m586) {
      // Pentium: BRDY# ends each transfer; CACHE# with ADS# asks for a burst (a fill or a write-back)
      const first = (c.t0 || 1) === 1;
      switch (id) {
        case 'ads': if (first) out.push([p + 0.05, p + 1]); break;
        case 'brdy': out.push([p + L - 0.5, p + L]); break;
        case 'cachen': if (c.burst && c.beat === 0) out.push([p + 0.05, p + L]); break;
        case 'ken': if (c.burst && c.beat === 0 && !c.wb) out.push([p + 0.5, p + L]); break;
      }
      return;
    }
    if (this.m486) {
      const first = (c.t0 || 1) === 1, cmd0 = first ? p + 1 : p;
      switch (id) {
        case 'ads': if (first) out.push([p + 0.05, p + 1]); break;
        case 'bs16': if (s !== 3 && s !== 8) out.push([first ? p + 0.05 : p, p + L]); break;
        case 'blast': if (!c.burst || c.beat === 7) out.push([cmd0, p + L]); break;
        case 'brdy': if (c.burst) out.push([p + L - 0.5, p + L]); break;
        case 'rdy': if (!c.burst) out.push([p + L - 0.5, p + L]); break;
        case 'ken': if (c.burst && c.beat === 0) out.push([p + 0.5, p + L]); break;
        case 'mrdc': if (s === 4 || s === 5) out.push([cmd0, p + L]); break;
        case 'mwtc': if (s === 6) out.push([cmd0, p + L]); break;
        case 'iorc': if (s === 1) out.push([cmd0, p + L]); break;
        case 'iowc': if (s === 2) out.push([cmd0, p + L]); break;
        case 'inta': if (s === 0) out.push([cmd0, p + L]); break;
      }
      return;
    }
    if (this.m386) {
      switch (id) {
        case 'ads': out.push([p + 0.05, p + 1]); break;
        case 'bhe': if (c.bhe) out.push([p + 0.05, p + L]); break;
        case 'ble': if (c.ble) out.push([p + 0.05, p + L]); break;
        case 'mrdc': if (s === 4 || s === 5) out.push([p + 1, p + L]); break;
        case 'mwtc': if (s === 6) out.push([p + 1, p + L]); break;
        case 'iorc': if (s === 1) out.push([p + 1, p + L]); break;
        case 'iowc': if (s === 2) out.push([p + 1, p + L]); break;
        case 'inta': if (s === 0) out.push([p + 1, p + L]); break;
        case 'ready': out.push([p + L - 0.5, p + L]); break;
      }
      return;
    }
    const b = TV_286_BITS[s];
    switch (id) {
      case 's1': if (b[2] === 0) out.push([p + 0.05, p + 1]); break;
      case 's0': if (b[3] === 0) out.push([p + 0.05, p + 1]); break;
      case 'bhe': if (c.bhe) out.push([TimingView.addrStart(c), p + 1.5]); break;
      case 'ale': out.push([p + 0.5, p + 1.05]); break;
      case 'mrdc': if (s === 4 || s === 5) out.push([p + 1, p + L]); break;
      case 'mwtc': if (s === 6) out.push([p + 1, p + L]); break;
      case 'iorc': if (s === 1) out.push([p + 1, p + L]); break;
      case 'iowc': if (s === 2) out.push([p + 1, p + L]); break;
      case 'inta': if (s === 0) out.push([p + 1, p + L]); break;
      case 'den': if (cmd) out.push(rd ? [p + 1.5, p + L] : [p + 0.5, p + L + 0.5]); break;
      case 'dtr': if (cmd && rd) out.push([p + 0.05, p + L + 0.4]); break;
      case 'mce': if (s === 0) out.push([p + 0.5, p + 1.5]); break;
      case 'ready': out.push([p + L - 1, p + L]); break;
    }
  }
  // Level list for position p from the active intervals of the nearby cycles.
  ivLevels(id, p, act) {
    const iv = [];
    for (const c of this.near(p)) this.ivals286(id, c, iv);
    const ina = 1 - act;
    if (!iv.length) return ina ? TV_H : TV_L;
    const cuts = [0];
    for (const [a, b] of iv) {
      if (a > p && a < p + 1) cuts.push(a - p);
      if (b > p && b < p + 1) cuts.push(b - p);
    }
    cuts.sort((x, y) => x - y);
    const out = [];
    let prev = -1;
    for (const f of cuts) {
      const t = p + f + 1e-6;
      let on = false;
      for (const [a, b] of iv) if (t >= a && t < b) { on = true; break; }
      const l = on ? act : ina;
      if (l !== prev) { out.push(f, l); prev = l; }
    }
    return out;
  }
  // M/IO and COD/INTA hold the value of the latest address group that started.
  heldBit(t, bit) {
    for (let q = Math.floor(t) + 1; q >= Math.floor(t) - 48 && q >= this.firstLive(); q--) {
      if (q >= this.head) continue;
      const c = this.cyc[q & TV_MASK];
      if (c && c.pos === q && TimingView.addrStart(c) <= t) return this.bits(c.s)[bit];
    }
    return 1;
  }
  // P6: BCLK has a period of bR positions (core clocks) and is high in the first half.
  bclkLv(p) {
    const R = this.bR, k = ((p % R) + R) % R, hi = R / 2 - k;
    return hi >= 1 ? TV_H : hi > 0 ? [0, 1, hi, 0] : TV_L;
  }
  levels286(id, p, i, T) {
    if (this.m686) {
      switch (id) {
        case 'clk': return this.bclkLv(p);
        case 'core': return TV_CLK486;
        case 'ads': case 'trdy': case 'drdy': case 'dbsy': return this.ivLevels(id, p, 0);
        case 'bnr': case 'bpri': case 'hit': case 'hitm': return TV_H;
        default: break;
      }
    }
    switch (id) {
      case 'clk': return this.m486 ? TV_CLK486 : TV_CLK286;
      case 'ready': return this.ivLevels(id, p, 0);
      case 'mio': case 'cod': case 'dc': case 'wr': {
        const bit = this.m386 ? { mio: 0, dc: 1, wr: 2 }[id] : id === 'mio' ? 1 : 0;
        const v0 = this.heldBit(p, bit);
        for (const c of this.near(p)) {
          const a = TimingView.addrStart(c);
          if (a > p && a < p + 1) { const v1 = this.bits(c.s)[bit]; return v1 === v0 ? (v0 ? TV_H : TV_L) : [0, v0, a - p, v1]; }
        }
        return v0 ? TV_H : TV_L;
      }
      case 's1': case 's0': case 'bhe': case 'mrdc': case 'mwtc': case 'iorc': case 'iowc': case 'inta': case 'dtr':
      case 'ads': case 'ble': case 'bs16': case 'blast': case 'brdy': case 'rdy': case 'ken': case 'cachen':
        return this.ivLevels(id, p, 0);
      case 'ferr': return this.fl[i] & TV_F_ERR ? TV_L : TV_H;
      case 'na': return TV_H;
      case 'ale': case 'den': case 'mce': return this.ivLevels(id, p, 1);
      case 'pereq': return this.fl[i] & TV_F_PEREQ ? TV_H : TV_L;
      case 'peack': return this.rq[i] === 4 ? TV_PEACK : TV_H;
      case 'busy': return this.fl[i] & TV_F_BUSY ? TV_L : TV_H;
      case 'error': return this.fl[i] & TV_F_ERR ? TV_L : TV_H;
      case 'hold': case 'hlda': return TV_L;
      case 'intr': return this.fl[i] & TV_F_INTR ? TV_H : TV_L;
      case 'nmi': return this.fl[i] & TV_F_NMI ? TV_H : TV_L;
      case 'lock': return this.fl[i] & TV_F_LOCK ? TV_L : TV_H;
    }
    return TV_H;
  }
  cycleRuns286(id, c, out) {
    const p = c.pos, L = c.len, s = c.s;
    const col = c.fpu ? THEME.lavender : null;
    if (this.m686) { this.cycleRuns686(id, c, out); return; }
    if (this.m586) {
      if (id === 'state') {
        if (c.burst && c.beat) out.push([p + 0.04, p + L - 0.04, String(c.beat + 1), c.wb ? THEME.goldHi : THEME.cyan]);
        else if (c.burst) out.push([p + 0.04, p + L - 0.04, c.wb ? 'WB' : s === 4 ? 'FILL C' : 'FILL', c.wb ? THEME.goldHi : THEME.cyan, 0, null, c.wb ? 'W' : 'F']);
        else out.push([p + 0.04, p + L - 0.04, TV_STATE_NAME[s], TimingView.stateColor(s)]);
      } else if (id === 'a') {
        const io = s === 1 || s === 2;
        out.push([p + 0.05, p + L, s === 0 ? '00000000' : io ? hex4(c.addr) : hex((c.addr & ~7) >>> 0, 8), THEME.cyan, 0, null, io ? '' : hex((c.addr >>> 0) & 0xFFFF & ~7, 4)]);
      } else if (id === 'be') {
        if (s === 3 || s === 8) return;
        const v = bin(~TimingView.be586(c) & 255, 8);
        out.push([p + 0.05, p + L, v, THEME.magenta, 0, null, hex2(~TimingView.be586(c))]);
      } else if (id === 'd') {
        if (s === 3 || s === 8) return;
        const full = TimingView.lanes586(c), used = TimingView.hex586(c);
        const tiny = used.length > 4 ? '…' + used.slice(-4) : null;
        const run = (a, b, cl) => out.push([a, b, full, cl, 0, null, used, tiny]);
        if (s === 2 || s === 6) run(p + 0.5, p + L, THEME.goldHi);
        else if (s === 0) { if (c.second) out.push([p + L - 0.5, p + L, hex2(c.data), THEME.magenta]); }
        else run(p + L - 0.5, p + L, THEME.gold);
      }
      return;
    }
    if (this.m486) {
      if (id === 'state') {
        if (c.burst) out.push([p + 0.04, p + L - 0.04, c.beat ? String(c.beat + 1) : (s === 4 ? 'FILL C' : 'FILL'), THEME.cyan]);
        else out.push([p + 0.04, p + L - 0.04, TV_STATE_NAME[s], TimingView.stateColor(s)]);
      } else if (id === 'a') {
        const io = s === 1 || s === 2;
        out.push([p + 0.05, p + L, s === 0 ? '00000004' : io ? hex4(c.addr) : hex(c.addr, 8), THEME.cyan]);
      } else if (id === 'be') {
        if (s === 3 || s === 8) return;
        out.push([p + 0.05, p + L, bin(~TimingView.beMask(c) & 15, 4), THEME.magenta]);
      } else if (id === 'd') {
        if (s === 3 || s === 8) return;
        const dt = c.width === 2 ? hex4(c.data) : hex2(c.data);
        if (s === 2 || s === 6) out.push([p + 0.5, p + L, dt, THEME.goldHi]);
        else if (s === 0) { if (c.second) out.push([p + L - 0.5, p + L, hex2(c.data), THEME.magenta]); }
        else out.push([p + L - 0.5, p + L, dt, THEME.gold]);
      }
      return;
    }
    if (this.m386) {
      if (id === 'state') out.push([p + 0.04, p + L - 0.04, TV_STATE_NAME[s] + (c.fpu ? ' 387' : ''), c.fpu ? THEME.lavender : TimingView.stateColor(s)]);
      else if (id === 'a') {
        const io = s === 1 || s === 2;
        out.push([p + 0.05, p + L, s === 0 ? '000004' : io ? hex4(c.addr) : hex(c.addr & 0xFFFFFF, 6), col || THEME.cyan]);
      } else if (id === 'd') {
        if (s === 3 || s === 8) return;
        const dt = c.width === 2 ? hex4(c.data) : hex2(c.data);
        if (s === 2 || s === 6) out.push([p + 0.5, p + L, dt, col || THEME.goldHi]);
        else if (s === 0) { if (c.second) out.push([p + L - 0.5, p + L, hex2(c.data), THEME.magenta]); }
        else out.push([p + L - 0.5, p + L, dt, col || THEME.gold]);
      }
      return;
    }
    if (id === 'state') {
      out.push([p + 0.04, p + L - 0.04, TV_STATE_NAME[s] + (c.fpu ? ' 287' : ''), c.fpu ? THEME.lavender : TimingView.stateColor(s)]);
    } else if (id === 'a') {
      const io = s === 1 || s === 2;
      out.push([TimingView.addrStart(c), p + 1.5, s === 0 ? '000000' : io ? hex4(c.addr) : hex(c.addr & 0xFFFFFF, 6), col || THEME.cyan]);
    } else if (id === 'd') {
      if (s === 3 || s === 8) return;
      const dt = c.width === 2 ? hex4(c.data) : hex2(c.data);
      if (s === 2 || s === 6) out.push([p + 0.5, p + L + 0.46, dt, col || THEME.goldHi]);
      else if (s === 0) { if (c.second) out.push([p + 1.5, p + L, hex2(c.data), THEME.magenta]); }
      else out.push([p + 1.5, p + L, dt, col || THEME.gold]);
    }
  }
  // Pentium Pro: the runs of one transaction (or one transfer of a line) on a bus row.
  cycleRuns686(id, c, out) {
    const R = this.bR, p = c.pos, L = c.len, s = c.s, dEnd = p + L, first = c.req > 0;
    const io = s === 1 || s === 2, wr = s === 2 || s === 6, noData = s === 3 || s === 8;
    switch (id) {
      case 'state':
        if (c.burst && c.beat) out.push([p + 0.04, dEnd - 0.04, String(c.beat + 1), c.wb ? THEME.goldHi : THEME.cyan]);
        else if (c.burst) out.push([p + 0.04, dEnd - 0.04, c.wb ? 'WRITE-BACK' : s === 4 ? 'CODE LINE' : 'LINE READ', c.wb ? THEME.goldHi : THEME.cyan, 0, null, c.wb ? 'WB' : s === 4 ? 'LINE C' : 'LINE', c.wb ? 'W' : 'L']);
        else out.push([p + 0.04, dEnd - 0.04, TV_STATE_NAME[s], TimingView.stateColor(s)]);
        break;
      case 'phase':
        if (first) {
          out.push([p + 0.04, p + 2 * R - 0.04, 'REQUEST', THEME.cyan, 0, null, 'REQ', 'R']);
          out.push([p + 2 * R + 0.04, p + 3 * R - 0.04, 'SNOOP', THEME.lavender, 0, null, 'SNP', 'S']);
          if (L > 3 * R) out.push([p + 3 * R + 0.04, dEnd - 0.04, noData ? 'RESPONSE' : wr ? 'TRDY · RESPONSE · DATA' : 'RESPONSE · DATA 1', noData ? THEME.magenta : wr ? THEME.goldHi : THEME.gold, 0, null, noData ? 'RS' : 'D1', noData ? 'R' : 'D']);
        } else out.push([p + 0.04, dEnd - 0.04, `DATA ${c.beat + 1}`, c.wb ? THEME.goldHi : THEME.gold, 0, null, 'D' + (c.beat + 1), 'D']);
        break;
      case 'req': {
        if (!first) break;
        const q = this.req686(c);
        out.push([p + 0.05, p + R, q[0], THEME.magenta, 0, null, 'a']);
        out.push([p + R, p + 2 * R, q[1], THEME.magenta, 0, null, 'b']);
        break;
      }
      case 'a':
        if (first) out.push([p + 0.05, p + R, s === 0 ? '00000000' : io ? hex4(c.addr) : hex((c.addr & ~7) >>> 0, 8), THEME.cyan, 0, null, io ? '' : hex((c.addr >>> 0) & 0xFFFF & ~7, 4)]);
        break;
      case 'be':
        if (first && !noData) {
          const m = TimingView.be586(c);
          out.push([p + R, p + 2 * R, bin(~m & 255, 8), THEME.magenta, 0, null, hex2(~m & 255)]);
        }
        break;
      case 'rs':
        if (first) out.push([dEnd - R, dEnd, wr || noData ? '101' : '111', THEME.magenta, 0, null, wr || noData ? 'ND' : 'D']);
        break;
      case 'd': {
        if (noData) break;
        if (s === 0) { if (c.second) out.push([dEnd - R, dEnd, hex2(c.data), THEME.magenta]); break; }
        const full = TimingView.lanes586(c), used = TimingView.hex586(c);
        out.push([dEnd - R, dEnd, full, wr ? THEME.goldHi : THEME.gold, 0, null, used, used.length > 4 ? '…' + used.slice(-4) : null]);
        break;
      }
    }
  }
  // P6: the REQ4#-REQ0# codes of a transaction: [phase a, phase b, words].
  req686(c) {
    const s = c.s, Q = TV_REQ686;
    if (c.wb) return Q.wb;
    if (s === 4) return c.burst ? Q.codeLine : Q.code;
    if (s === 5) return c.burst ? Q.dataLine : Q.data;
    if (s === 6) return Q.write;
    if (s === 1) return Q.ior;
    if (s === 2) return Q.iow;
    if (s === 0) return Q.inta;
    return Q.special;
  }
  // The name of the T-state (or, on the P6, of the bus phase) at position p.
  tnameAt(p) { return this.m686 ? this.phase686(p, false) : this.tname(this.ts[p & TV_MASK]); }
  // P6: the phase of the transaction in the BCLK of position p (short: the label under BCLK).
  phase686(p, short) {
    const i = p & TV_MASK;
    if (this.ts[i] === TV_GAP) return '';
    const c = this.cyc[i];
    if (!c) return short ? '' : 'idle';
    const R = this.bR, k = Math.floor((p - c.pos) / R), nb = Math.round(c.len / R);
    if (c.req) {
      if (k === 0) return short ? 'Aa' : 'request a';
      if (k === 1) return short ? 'Ab' : 'request b';
      if (k === 2) return short ? 'S' : 'snoop';
    }
    const noData = c.s === 3 || c.s === 8;
    if (k === nb - 1) return c.req ? (noData ? (short ? 'RS' : 'response') : (short ? 'D1' : 'response · data 1')) : (short ? 'D' + (c.beat + 1) : 'data ' + (c.beat + 1));
    if (c.req && (c.s === 2 || c.s === 6) && k === nb - 2) return short ? 'TR' : 'TRDY';
    return short ? 'w' : 'wait';
  }
  tname(T, c) {
    if (T === TV_GAP) return '';
    if (!this.m286) return TV_TNAME[T] || '';
    if (this.m386) return !T ? 'Ti' : T === 1 ? 'T1' : 'T2';
    return !T ? 'Ti' : T === 1 ? 'Ts' : T === 2 ? 'Tc' : 'Tw';
  }

  // Value runs [a, b, text, colour] (positions) that one cycle puts on a bus row.
  cycleRuns(id, c, out) {
    if (this.m286) { this.cycleRuns286(id, c, out); return; }
    const p = c.pos, fpuCol = c.fpu ? THEME.lavender : null;
    if (id === 'state') {
      out.push([p - 0.34, p + 2, TV_STATE_NAME[c.s] + (c.fpu ? ' 8087' : ''), c.fpu ? THEME.lavender : TimingView.stateColor(c.s)]);
    } else if (id === 'ad') {
      if (c.s === 3) return;
      const io = c.s === 1 || c.s === 2;
      // INTA drives no address: AD floats in T1 and T2
      if (c.s !== 0) out.push([p + 0.08, p + 1, hex4(io ? c.addr : c.addr & 0xFFFF), fpuCol || THEME.cyan, TimingView.isRead(c.s) ? p + 2 : 0]);
      const dt = c.width === 2 ? hex4(c.data) : hex2(c.data);
      if (c.s === 2 || c.s === 6) out.push([p + 1.08, p + 3.95, dt, fpuCol || THEME.goldHi]);
      else if (c.s === 0) { if (c.second) out.push([p + 2.1, p + 3.95, hex2(c.data), THEME.magenta]); }
      else out.push([p + 2.1, p + 3.95, dt, fpuCol || THEME.gold]);
    } else if (id === 'ah') {
      if (c.s === 3) return;
      const io = c.s === 1 || c.s === 2;
      if (c.s !== 0) out.push([p + 0.08, p + 1, io ? '0' : hex(c.addr >> 16, 1), fpuCol || THEME.cyan]);
      out.push([p + 1.08, p + 3.95, c.seg ? c.seg : '––', THEME.muted]);
    }
  }
  // BE3#-BE0# as an active-high mask: the bytes of the dword that the cycle uses.
  static beMask(c) { return c.width === 2 ? ((c.addr & 2) ? 12 : 3) : 1 << (c.addr & 3); }
  // Pentium: the bytes of a transfer as one hex number (the last byte first): data = bytes 0-3, hi = bytes 4-7.
  static hex586(c) {
    const w = clamp(c.width | 0, 1, 8);
    if (w > 4) return hex(c.hi >>> 0, 2 * (w - 4)).slice(-2 * (w - 4)) + hex(c.data >>> 0, 8);
    return hex(w === 4 ? c.data >>> 0 : (c.data >>> 0) & ((1 << (8 * w)) - 1), 2 * w);
  }
  // Pentium: BE7#-BE0# as an active-high mask (the bytes of the 8-byte group that the transfer uses).
  static be586(c) {
    if (c.burst) return 255;
    return ((((1 << clamp(c.width | 0, 1, 8)) - 1) << (c.addr & 7)) & 255) || 255;
  }
  // Pentium: the 8 byte lanes of D63-D0, D63-D56 first; ·· = a lane that the transfer does not use.
  static lanes586(c) {
    const o = c.burst ? 0 : c.addr & 7, w = c.burst ? 8 : clamp(c.width | 0, 1, 8);
    let s = '';
    for (let L = 7; L >= 0; L--) {
      const k = L - o;
      s += k < 0 || k >= w ? '··' : hex2(k < 4 ? (c.data >>> 0) >>> (8 * k) : (c.hi >>> 0) >>> (8 * (k - 4)));
    }
    return s;
  }
  static stateColor(s) {
    return s === 4 ? THEME.gold : s === 5 ? THEME.gold : s === 6 ? THEME.goldHi : s === 3 ? THEME.muted : s === 8 ? THEME.copper : THEME.magenta;
  }

  // ---------- layout ----------
  resize() {
    if (!this.shown) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.measureOcc();
    if (!this.measured) this.measure();
    const occ = this.occ;
    const narrow = w < 560;
    const sideOk = occ && occ.x > w * 0.45 && occ.y < 60 && !narrow;
    this.root.classList.toggle('tv-hasside', !!(sideOk && h - (occ.y + occ.h) > 170));
    this.hdr.style.paddingRight = occ && occ.y < 50 ? (w - occ.x + 10) + 'px' : '';
    const headH = this.hdr.offsetHeight;
    const scH = Math.max(80, h - headH);
    const nRows = this.flat.length, nGroups = this.groups.length;
    const bottom = 54, lane = 18;
    // more scroll room when the trace panel covers the bottom rows
    const extra = this.occB > bottom ? Math.ceil((this.occB - bottom + 8) / 32) * 32 : 0;
    const gapH = 5;
    // (a row is at least 15 px high, so the names do not touch; the view scrolls when it must)
    const rowH = clamp((scH - bottom - lane - nGroups * gapH) / (nRows + 0.9), 15, 24);
    const fs = rowH < 17 ? 11 : 12;
    const cw = this.charW * fs / 11;
    const nameW = Math.ceil(13 * cw) + 30;
    const valW = narrow ? 0 : Math.ceil(5 * cw) + 10;
    let plotR = w - 10;
    let side = null;
    if (sideOk) {
      plotR = occ.x - 10;
      if (h - (occ.y + occ.h) > 170) side = { x: occ.x, y: occ.y + occ.h + 8, w: w - occ.x - 10, h: h - (occ.y + occ.h) - 8 - 56 };
    }
    const plotX = nameW + valW;
    const L = this.lay = { w, h: 0, rowH, fs, cw, nameW, valW, plotX, plotW: Math.max(40, plotR - plotX), lane, rows: {}, side };
    let y = lane;
    for (const g of this.groups) {
      g.y = y;
      y += gapH;
      for (const r of g.rows) {
        const rh = r.tall ? rowH * r.tall : rowH;
        L.rows[r.id] = { y, h: rh };
        y += rh;
      }
    }
    L.rowsBottom = y;
    L.h = Math.max(scH - 2, y + bottom + extra);
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', L.h);
    this.svg.setAttribute('viewBox', `0 0 ${w} ${L.h}`);
    Object.assign(this.win.style, { left: L.plotX + 'px', width: L.plotW + 'px', height: (y + 2) + 'px' });
    Object.assign(this.curtain.style, { top: (lane - 16) + 'px', height: (y - lane + 18) + 'px', width: (L.plotW + 60) + 'px' });
    Object.assign(this.cursorEl.style, { top: (lane - 2) + 'px', height: (y - lane + 2) + 'px' });
    this.styleCache.clear();
    if (side) {
      Object.assign(this.side.style, { left: side.x + 'px', top: side.y + 'px', width: side.w + 'px', height: side.h + 'px' });
      this.side.classList.add('tv-on');
    } else this.side.classList.remove('tv-on');
    this.buildStatic();
    this.rendered = null;
    this.valKey = '';
    this.dirtyCursor = true;
    if (!this.right) this.right = this.reveal + 1;
    this.clampView();
    this.syncSel();
  }

  measure() {
    const t = svgEl('text', { class: 'tv-lab', x: -999, y: -999 }, this.svg);
    t.textContent = 'M'.repeat(20);
    const w = t.getComputedTextLength ? t.getComputedTextLength() : 0;
    t.remove();
    if (w > 0) { this.charW = w / 20; this.measured = true; }
  }

  // Find a floating element (the CRT monitor) that covers the top-right of the view.
  measureOcc() {
    this.occT = animNow();
    const doc = this.host.ownerDocument, crt = doc.getElementById('crt');
    let occ = null;
    if (crt) {
      let el = crt, best = null;
      while (el && el !== doc.body) {
        if (el.contains(this.host)) break;
        const pos = getComputedStyle(el).position;
        if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') best = el;
        el = el.parentElement;
      }
      if (best) {
        const a = best.getBoundingClientRect(), b = this.host.getBoundingClientRect();
        const x0 = Math.max(a.left, b.left), x1 = Math.min(a.right, b.right), y0 = Math.max(a.top, b.top), y1 = Math.min(a.bottom, b.bottom);
        if (x1 - x0 > 40 && y1 - y0 > 30 && x1 >= b.right - 40) occ = { x: x0 - b.left, y: y0 - b.top, w: x1 - x0, h: y1 - y0 };
      }
    }
    this.occB = this.traceCover();
    const key = (occ ? [occ.x, occ.y, occ.w, occ.h].map(Math.round).join() : '') + '|' + Math.ceil(this.occB / 32);
    const changed = key !== this.occKey;
    this.occKey = key;
    this.occ = occ;
    return changed;
  }

  // Height (px) of the trace panel over the bottom of the view, or 0.
  traceCover() {
    const doc = this.host.ownerDocument, tr = doc.getElementById('trace');
    if (!tr || tr.hidden || !tr.offsetParent) return 0;
    const a = tr.getBoundingClientRect(), b = this.host.getBoundingClientRect();
    if (a.top >= b.bottom || a.bottom <= b.top || a.right <= b.left || a.left >= b.right) return 0;
    return Math.max(0, b.bottom - a.top);
  }

  buildStatic() {
    const L = this.lay;
    let s = '';
    let zebra = 0;
    for (const g of this.groups) {
      const gy0 = g.y + 5, gy1 = L.rows[g.rows[g.rows.length - 1].id].y + L.rows[g.rows[g.rows.length - 1].id].h;
      if (g.y > L.lane) s += `<line x1="4" x2="${L.plotX}" y1="${g.y + 2.5}" y2="${g.y + 2.5}" stroke="${THEME.line}" stroke-opacity=".8"/>`;
      s += `<path d="M13 ${gy0 + 1}H10V${gy1 - 1}H13" stroke="${THEME.line}" fill="none"/>`;
      const gm = (gy0 + gy1) / 2;
      const nm = (gy1 - gy0) > g.name.length * 6.4 + 6 ? g.name : g.short;
      s += `<text class="tv-grp" transform="translate(7.5 ${gm.toFixed(1)}) rotate(-90)" text-anchor="middle">${nm}</text>`;
      for (const r of g.rows) {
        const R = L.rows[r.id];
        if (zebra++ & 1) s += `<rect x="16" y="${R.y}" width="${L.plotX - 16}" height="${R.h}" fill="${THEME.text}" fill-opacity=".018"/>`;
        const by = R.y + (r.tall ? R.h * 0.3 : R.h * 0.5) + L.fs * 0.36;
        s += `<text class="tv-lab" x="18" y="${by.toFixed(1)}" font-size="${L.fs}">${r.lab.text}</text>`;
        for (const [a, b] of r.lab.bars) {
          const oy = (by - L.fs * 0.8).toFixed(1);
          s += `<path d="M${(18 + a * L.cw + 0.8).toFixed(1)} ${oy}H${(18 + b * L.cw - 0.8).toFixed(1)}" stroke="${THEME.text}" stroke-width=".9"/>`;
        }
        if (L.valW) s += `<text class="tv-val" id="tv-v-${r.id}" x="${L.plotX - 8}" y="${by.toFixed(1)}" font-size="${L.fs}"></text>`;
      }
    }
    if (L.valW) s += `<line x1="${L.plotX - L.valW + 1}" x2="${L.plotX - L.valW + 1}" y1="${L.lane}" y2="${L.rowsBottom}" stroke="${THEME.line}" stroke-opacity=".5"/>`;
    s += `<line x1="${L.plotX - 0.5}" x2="${L.plotX - 0.5}" y1="${L.lane - 4}" y2="${L.rowsBottom}" stroke="${THEME.line}"/>`;
    this.bg.innerHTML = s;
    this.valEls = {};
    if (L.valW) for (const r of this.flat) this.valEls[r.id] = this.bg.querySelector('#tv-v-' + r.id);
    Object.assign(this.namesEl.style, { width: L.plotX + 'px', height: L.h + 'px' });
    for (const r of this.flat) {
      const R = L.rows[r.id], b = this.nameBtn[r.id];
      Object.assign(b.style, { top: R.y + 'px', height: R.h + 'px', width: Math.max(10, L.plotX - 17) + 'px' });
    }
  }

  // ---------- viewport ----------
  leftPos() { return this.shownRight - (this.lay ? this.lay.plotW : 400) / this.px; }
  clampView() {
    if (!this.lay) return;
    const span = this.lay.plotW / this.px;
    const lo = Math.max(0, this.head - TV_CAP) + span * 0.25;
    const hi = Math.max(this.reveal, 0) + span * 0.5;
    this.right = clamp(this.right, Math.min(lo, hi), hi);
  }
  minZoom() { return this.lay ? Math.max(TV_ZOOM_MIN, this.lay.plotW / (TV_CAP - 16)) : TV_ZOOM_MIN; }
  setZoom(px, anchorX, anchorPos) {
    px = clamp(px, this.minZoom(), TV_ZOOM_MAX);
    if (!this.lay || px === this.px) return;
    if (this.live || anchorX === undefined) {
      this.px = px;
    } else {
      const left = anchorPos - (anchorX - this.lay.plotX) / px;
      this.px = px;
      this.right = this.shownRight = left + this.lay.plotW / px;
    }
    this.clampView();
    if (!this.live) this.shownRight = this.right;
    this.dirtyCursor = true;
  }
  zoomBy(k) {
    if (!this.lay) return;
    const c = this.pin !== null ? this.pin + 0.5 : null;
    if (c !== null && !this.live) this.setZoom(this.px * k, this.lay.plotX + (c - this.leftPos()) * this.px, c);
    else this.setZoom(this.px * k);
  }
  goLive() {
    this.live = true;
    this.pin = null;
    this.syncLive();
    this.dirtyCursor = true;
  }
  syncLive() {
    this.liveBtn.setAttribute('aria-pressed', this.live ? 'true' : 'false');
  }
  curManual() {
    const p = this.play;
    if (!p) return null;
    return Math.min(p.base + Math.floor(this.app.clock), p.end - 1);
  }

  // ---------- per frame ----------
  frame(now, dt) {
    if (!this.shown || !this.lay) return;
    if (now - this.occT > 500 && this.measureOcc()) this.resize();
    const p = this.play;
    if (p && !p.done) {
      if (this.app.clock > 0) p.manual = true;
      let rv;
      if (p.manual) rv = p.base + Math.floor(this.app.clock) + 1;
      else rv = p.base + (now - p.t0) / p.clockMs;
      if (this.reduced) rv = Math.floor(rv);
      this.reveal = Math.max(this.reveal, Math.min(rv, p.end));
    }
    if (!p && !this.fastMode) this.reveal = Math.max(this.reveal, this.head);
    const span = this.lay.plotW / this.px;
    if (this.live) {
      const lead = Math.min(3, span * 0.08);
      let target = this.reveal + lead;
      if (this.reduced) {
        // Page flip instead of a scroll.
        if (this.reveal > this.right - 0.5 || this.reveal < this.right - span) this.right = this.reveal + span * 0.7;
        target = this.right;
      }
      this.right = target;
      const d = target - this.shownRight;
      if (this.reduced || Math.abs(d) > span * 1.5 || Math.abs(d) < 0.02) this.shownRight = target;
      else if (this.fastMode || Math.abs(d) > 4) this.shownRight += d * (1 - Math.exp(-(dt || 16) / 90));
      else this.shownRight = target;
    } else this.shownRight = this.right;
    const left = this.shownRight - span;
    const R = this.rendered;
    if (!R || R.version !== this.version || R.px !== this.px || left < R.lo || this.shownRight > R.hi || R.lay !== this.lay) this.render(left);
    this.place(left);
    this.sounds();
    const rt = performance.now();
    if (this.sel && rt - this.cardT > 160) { this.cardT = rt; this.renderCard(); }
  }

  // Quiet sounds while a clock is revealed slowly: a tick for each T-state, a click when a
  // command starts and when data becomes valid. Fast playback stays silent.
  sounds() {
    const cur = Math.ceil(this.reveal) - 1, prev = this.sndPos;
    this.sndPos = cur;
    const p = this.play;
    if (typeof Sfx === 'undefined' || !this.shown || !p || this.fastMode || cur <= prev || cur - prev > 4 || cur < p.base) return;
    const scale = Math.max(1e-3, this.app.motion || 1);
    const ms = p.manual ? Infinity : p.clockMs / scale;
    if (ms < TV_SFX_MS) return;
    for (let q = Math.max(prev + 1, p.base); q <= cur; q++) {
      if (q < this.firstLive() || q >= this.head) continue;
      const i = q & TV_MASK, T = this.ts[i], c = this.cyc[i];
      if (T === TV_GAP) continue;
      Sfx.edge(T === 1);
      if (!c || c.s === 3 || c.s === 8) continue;
      const k = q - c.pos + 1;
      const cmd = T === 2 && (c.t0 || 1) === 1 && k === 2;
      const data = this.m286 ? k === c.len && (c.s !== 0 || c.second) : T === 3 && (c.s !== 0 || c.second);
      if (cmd) Sfx.arrive('ctrl');
      if (data && cmd) setTimeout(() => { if (this.shown) Sfx.arrive('data'); }, Math.min(ms * 0.5, 300));
      else if (data) Sfx.arrive('data');
    }
  }

  // Move the pre-built paths and the cursor / beam for this frame.
  css(el, prop, v) {
    let m = this.styleCache.get(el);
    if (!m) this.styleCache.set(el, m = {});
    if (m[prop] === v) return;
    m[prop] = v;
    if (prop === 'class') el.className = v;
    else if (prop.startsWith('--')) el.style.setProperty(prop, v);
    else el.style[prop] = v;
  }
  place(left) {
    const L = this.lay, R = this.rendered, px = this.px;
    this.css(this.mover, 'transform', `translate3d(${((R.r0 - left) * px).toFixed(1)}px,0,0)`);
    const bx = (this.reveal - left) * px;
    const playing = !!(this.play && !this.play.done && this.reveal < this.play.end);
    this.css(this.curtain, 'transform', `translate3d(${clamp(bx, -2, L.plotW + 4).toFixed(1)}px,0,0)`);
    this.css(this.curtain, 'class', 'tv-curtain' + (playing ? ' tv-play' : ''));
    if (playing) this.css(this.curtain, '--tv-trail', Math.min(px * 4, 60) + 'px');
    // cursor: pinned > hover > manual clock
    const man = this.play && this.play.manual && !this.play.done ? this.curManual() : null;
    let cur = this.hover !== null && this.validPos(this.hover) && this.hover < Math.ceil(this.reveal) ? this.hover : this.pin;
    let kind = 'cursor';
    if (cur === null || !this.validPos(cur)) { cur = man; kind = 'clock'; }
    if (cur !== null && this.validPos(cur)) {
      const x = (cur - left) * px;
      const on = x + px > 0 && x < L.plotW;
      this.css(this.cursorEl, 'transform', `translate3d(${x.toFixed(1)}px,0,0)`);
      this.css(this.cursorEl, 'width', Math.max(1, px).toFixed(1) + 'px');
      this.css(this.cursorEl, 'class', 'tv-cursor' + (on ? ' tv-on' : '') + (kind === 'clock' ? ' tv-clock' : ''));
      const i = cur & TV_MASK;
      const tag = `${this.tnameAt(cur)} · #${this.abs[i].toLocaleString('en-US')}`;
      if (tag !== this.tagEl.textContent) this.tagEl.textContent = tag;
      const tw = tag.length * 10 * this.charW / 11 + 14;
      const tx = clamp(x + px / 2 - tw / 2, 0, L.plotW - tw);
      this.css(this.tagEl, 'transform', `translate3d(${tx.toFixed(1)}px,1px,0)`);
      this.css(this.tagEl, 'class', 'tv-tag' + (on ? ' tv-on' : '') + (kind === 'clock' ? ' tv-clock' : ''));
    } else {
      this.css(this.cursorEl, 'class', 'tv-cursor');
      this.css(this.tagEl, 'class', 'tv-tag');
    }
    const valPos = cur !== null && this.validPos(cur) ? cur : this.lastRevealed();
    const key = valPos + ':' + this.version + ':' + kind;
    if (key !== this.valKey || this.dirtyCursor) {
      this.valKey = key;
      this.dirtyCursor = false;
      this.updateValues(valPos, cur !== null ? kind : 'live');
    }
    if (this.trafficDirty) { this.trafficDirty = false; this.updateTraffic(); }
  }
  lastRevealed() {
    let p = Math.ceil(this.reveal) - 1;
    const lo = this.firstLive();
    while (p >= lo && this.ts[p & TV_MASK] === TV_GAP) p--;
    return p >= lo ? p : null;
  }

  // ---------- drawing ----------
  render(left) {
    const L = this.lay, px = this.px;
    const span = L.plotW / px;
    const margin = Math.ceil(span * 0.4) + 4;
    const lo = Math.floor(left) - margin, hi = Math.ceil(left + span) + margin;
    const r0 = Math.max(this.firstLive(), lo), r1 = Math.min(this.head, hi);
    this.rendered = { version: this.version, px, lo: lo + margin * 0.5, hi: hi - margin * 0.5, r0, r1, lay: L };
    if (r1 <= r0) { this.underSvg.innerHTML = ''; this.waveSvg.innerHTML = ''; this.updateTraffic(left, span); return; }
    const X = p => ((p - r0) * px).toFixed(1);
    const top = L.lane, bottom = L.rowsBottom;
    let grid = '', gridT1 = '', gridC = '', marks = '', waves = '';
    // clock grid (P6: the BCLK edges, and fainter lines for the core clocks)
    if (this.m686) {
      const R = this.bR;
      for (let p = r0; p <= r1; p++) {
        const t = p < r1 ? this.ts[p & TV_MASK] : 0;
        if (t === TV_GAP) continue;
        if (t === 1) gridT1 += `M${X(p)} ${top}V${bottom}`;
        else if (p % R === 0) { if (px * R >= 5) grid += `M${X(p)} ${top}V${bottom}`; }
        else if (px >= 9) gridC += `M${X(p)} ${top}V${bottom}`;
      }
    } else if (px >= 5) {
      for (let p = r0; p <= r1; p++) {
        const t = p < r1 ? this.ts[p & TV_MASK] : 0;
        if (t === TV_GAP) continue;
        if (t === 1) gridT1 += `M${X(p)} ${top}V${bottom}`;
        else grid += `M${X(p)} ${top}V${bottom}`;
      }
    }
    // instruction marks and gaps
    let bands = '';
    const laneY = L.lane - 5;
    for (let k = 0; k < this.marks.length; k++) {
      const m = this.marks[k];
      const nextPos = k + 1 < this.marks.length ? this.marks[k + 1].pos : this.head;
      if (nextPos < r0 || m.pos > r1) continue;
      const x = X(m.pos);
      if (m.gap !== undefined) {
        const x0 = (m.pos - r0) * px, x1 = x0 + 3 * px;
        let z = '';
        for (let y = top; y < bottom; y += 8) z += `${z ? 'L' : 'M'}${(x0 + px * 1.2).toFixed(1)} ${y}L${(x0 + px * 1.8).toFixed(1)} ${y + 4}`;
        marks += `<rect x="${x0.toFixed(1)}" y="${top}" width="${(x1 - x0).toFixed(1)}" height="${bottom - top}" fill="${THEME.void}" fill-opacity=".85"/>`;
        marks += `<path d="${z}" stroke="${THEME.faint}" fill="none"/>`;
        const lbl = m.gap > 0 ? '+' + TimingView.fmtCount(m.gap) : '⋯';
        if (3 * px > lbl.length * this.charW * 0.85) marks += `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${laneY}" font-size="9.5" fill="${THEME.faint}" text-anchor="middle">${lbl}</text>`;
        continue;
      }
      const cur = this.play && !this.play.done && m.pos === this.play.base;
      const wpx = (Math.min(nextPos, m.end) - m.pos) * px;
      bands += `<rect x="${x}" y="${top}" width="${wpx.toFixed(1)}" height="${bottom - top}" fill="${THEME.phosphor}" fill-opacity="${cur ? 0.05 : (k & 1 ? 0.018 : 0)}"/>`;
      marks += `<path d="M${x} ${top - 14}V${bottom}" stroke="${THEME.phosphor}" stroke-opacity="${cur ? 0.7 : 0.32}" stroke-width="1"/>`;
      const room = Math.floor((wpx - 8) / (this.charW * 10 / 11));
      if (room >= 3 && m.text) {
        let t = m.text;
        if (t.length > room) t = t.slice(0, Math.max(1, room - 1)) + '…';
        marks += `<text x="${(+x + 4).toFixed(1)}" y="${laneY}" font-size="10" fill="${cur ? THEME.phosphor : THEME.muted}">${TimingView.esc(t)}</text>`;
      }
    }
    // rows
    const texts = [];
    for (const r of this.flat) {
      const R = L.rows[r.id];
      if (r.kind === 'bus') waves += this.busRow(r, R, r0, r1, px, texts);
      else waves += this.digRow(r, R, r0, r1, px);
    }
    // T-state names under CLK
    const C = L.rows.clk;
    if (this.m686) {
      // P6: the phase of each BCLK under the bus clock
      const R = this.bR;
      if (px * R >= 20) {
        const fs = px * R >= 30 ? 9.5 : 8.5;
        let t = '';
        for (let p = r0 - (((r0 % R) + R) % R); p < r1; p += R) {
          if (p < r0) continue;
          const nm = this.phase686(p, true);
          if (!nm) continue;
          t += `<text x="${((p - r0 + R / 2) * px).toFixed(1)}" y="${(C.y + C.h * 0.93).toFixed(1)}" fill="${nm === 'w' ? THEME.faint : THEME.muted}" font-size="${fs}" text-anchor="middle">${nm}</text>`;
        }
        waves += t;
      }
    } else if (px >= 15) {
      const fs = px >= 22 ? 9.5 : 8.5;
      let t = '';
      for (let p = r0; p < r1; p++) {
        const T = this.ts[p & TV_MASK];
        if (T === TV_GAP) continue;
        t += `<text x="${((p - r0 + 0.5) * px).toFixed(1)}" y="${(C.y + C.h * 0.93).toFixed(1)}" fill="${T ? THEME.muted : THEME.faint}" fill-opacity="${T ? 1 : 0.8}" font-size="${fs}" text-anchor="middle">${this.tname(T)}</text>`;
      }
      waves += t;
    }
    let txt = '';
    for (const t of texts) txt += t;
    const W = ((r1 - r0) * px + 2).toFixed(0), H = (L.rowsBottom + 4).toFixed(0);
    let zebra = '', k = 0;
    for (const g of this.groups) {
      if (g.y > L.lane) zebra += `<path d="M0 ${g.y + 2.5}H${W}" stroke="${THEME.line}" stroke-opacity=".8"/>`;
      for (const r of g.rows) {
        const RR = L.rows[r.id];
        if (k++ & 1) zebra += `<rect x="0" y="${RR.y}" width="${W}" height="${RR.h}" fill="${THEME.text}" fill-opacity=".018"/>`;
      }
    }
    for (const el of [this.underSvg, this.waveSvg]) {
      el.setAttribute('width', W); el.setAttribute('height', H); el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    }
    this.underSvg.innerHTML = zebra + bands +
      `<path d="${grid}" stroke="${THEME.line}" stroke-opacity="${px >= 12 ? 0.55 : 0.3}" stroke-width="1" fill="none"/>` +
      `<path d="${gridT1}" stroke="${THEME.ceramicHi}" stroke-opacity=".75" stroke-width="1" fill="none"/>` +
      (gridC ? `<path d="${gridC}" stroke="${THEME.line}" stroke-opacity=".22" stroke-width="1" stroke-dasharray="2 3" fill="none"/>` : '') +
      marks;
    this.waveSvg.innerHTML = waves + txt;
    this.updateTraffic(left, span);
  }

  digRow(r, R, r0, r1, px) {
    const tall = r.kind === 'clk';
    const yHi = R.y + R.h * (tall ? 0.1 : 0.2), yLo = R.y + R.h * (tall ? 0.46 : 0.8), yMid = (yHi + yLo) / 2;
    const sl = Math.min(1.8, px * 0.08);
    const act = r.act, col = THEME[r.col] || THEME.text;
    const yIn = act === 1 ? yLo : yHi;
    let d = '', fill = '', prevY = null, prevL = null, fx = null;
    const closeFill = x => { if (fx !== null) { fill += `M${fx.toFixed(1)} ${yIn}V${act === 1 ? yHi : yLo}H${x.toFixed(1)}V${yIn}Z`; fx = null; } };
    for (let p = r0; p < r1; p++) {
      const xb = (p - r0) * px;
      const lv = this.levels(r.id, p);
      if (!lv) {
        if (prevY !== null) { d += `H${xb.toFixed(1)}`; closeFill(xb); }
        prevY = null; prevL = null;
        continue;
      }
      for (let k = 0; k < lv.length; k += 2) {
        const l = lv[k + 1];
        if (l === prevL) continue;
        const x = xb + lv[k] * px;
        const y = l === 1 ? yHi : l === 0 ? yLo : yMid;
        if (prevY === null) d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
        else d += `H${x.toFixed(1)}L${(x + sl).toFixed(1)} ${y.toFixed(1)}`;
        if (act !== undefined && !tall) {
          if (l === act && fx === null) fx = x + sl * 0.5;
          else if (l !== act) closeFill(x + sl * 0.5);
        }
        prevY = y; prevL = l;
      }
    }
    const xe = (r1 - r0) * px;
    if (prevY !== null) { d += `H${xe.toFixed(1)}`; closeFill(xe); }
    let s = '';
    if (fill) s += `<path d="${fill}" fill="${col}" fill-opacity="${r.id === 'dtr' ? 0.08 : 0.16}"/>`;
    s += `<path d="${d}" stroke="${col}" stroke-width="${tall ? 1.4 : 1.35}" stroke-opacity="${r.id === 'ready' ? 0.6 : 0.95}" fill="none" stroke-linejoin="round"/>`;
    // RQ/GT pulse names
    if (r.id === 'rq' && px >= 14) {
      for (let p = r0; p < r1; p++) {
        const q = this.rq[p & TV_MASK];
        if (q) s += `<text x="${((p - r0 + 0.52) * px).toFixed(1)}" y="${(yLo + 0.5).toFixed(1)}" font-size="8" fill="${THEME.lavender}" text-anchor="middle" dy="-${(R.h * 0.62).toFixed(1)}">${['', 'RQ', 'GT', 'RL'][q]}</text>`;
      }
    }
    if ((r.id === 'qs0') && px >= 12) {
      for (let p = r0; p < r1; p++) {
        const q = this.qs[p & TV_MASK];
        if (q) s += `<text x="${((p - r0 + 0.5) * px).toFixed(1)}" y="${(R.y - 1).toFixed(1)}" font-size="9" font-weight="700" fill="${THEME.goldHi}" text-anchor="middle">${TV_QS[q]}</text>`;
      }
    }
    return s;
  }

  // P6: the retire row as bars: the height of a bar is the number of µops that retire in that
  // clock (1 to 3; a bar with a cap: more than 3, the floor rule).
  retireRow(R, r0, r1, px, texts) {
    const yb = R.y + R.h * 0.92, hh = R.h * 0.8, X = p => (p - r0) * px;
    let d = '', dx = '';
    for (const n of this.xnotes.retire) {
      if (n.end <= r0 || n.pos >= r1) continue;
      const k = n.e.n, h = hh * Math.min(3, k) / 3, x = X(n.pos) + Math.min(1.5, px * 0.15), w = Math.max(1.5, px - 2 * Math.min(1.5, px * 0.15));
      const seg = `M${x.toFixed(1)} ${yb.toFixed(1)}v${(-h).toFixed(1)}h${w.toFixed(1)}v${h.toFixed(1)}Z`;
      if (k > 3) dx += seg; else d += seg;
      const fs = Math.min(9, px * 0.8), inside = h >= fs + 1;
      if (px >= 9) texts.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(inside ? yb - 2 : yb - h - 1.5).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="${inside ? THEME.void : THEME.phosphor}" text-anchor="middle" font-weight="700">${k}</text>`);
    }
    return `<path d="M0 ${yb.toFixed(1)}H${((r1 - r0) * px).toFixed(1)}" stroke="${THEME.muted}" stroke-opacity=".5" stroke-width="1"/>` +
      (d ? `<path d="${d}" fill="${THEME.phosphor}" fill-opacity=".85"/>` : '') + (dx ? `<path d="${dx}" fill="${THEME.goldHi}" fill-opacity=".9"/>` : '');
  }
  busRow(r, R, r0, r1, px, texts) {
    if (this.m686 && r.id === 'retire') return this.retireRow(R, r0, r1, px, texts);
    const yt = R.y + R.h * 0.14, yb = R.y + R.h * 0.86, ym = (yt + yb) / 2;
    let runs = [];
    const seen = new Set();
    const nl = this.notesOf(r.id);
    if (nl) runs = this.noteRuns(r0 - 1, r1 + 1, nl);
    else for (let p = r0 - 1; p < r1 + 1; p++) {
      if (p < this.firstLive() || p >= this.head) continue;
      const i = p & TV_MASK, c = this.cyc[i];
      if (!c || seen.has(c)) continue;
      seen.add(c);
      this.cycleRuns(r.id, c, runs);
    }
    runs.sort((a, b) => a[0] - b[0]);
    const byCol = new Map();
    let z = '';
    const X = p => (p - r0) * px;
    const zline = (a, b) => {
      // floating / idle line, broken at history gaps
      let s = null;
      for (let p = Math.floor(a); p < Math.ceil(b); p++) {
        const g = p < this.firstLive() || p >= this.head || this.ts[p & TV_MASK] === TV_GAP;
        const pa = Math.max(a, p), pb = Math.min(b, p + 1);
        if (g) { if (s !== null) { z += `M${X(s).toFixed(1)} ${ym.toFixed(1)}H${X(pa).toFixed(1)}`; s = null; } }
        else if (s === null) s = pa;
        if (p + 1 >= Math.ceil(b) && s !== null) z += `M${X(s).toFixed(1)} ${ym.toFixed(1)}H${X(pb).toFixed(1)}`;
      }
    };
    let cur = r0;
    const fsz = Math.min(10.5, R.h * 0.62);
    const cw = this.charW * fsz / 11;
    for (const [a, b, text0, col, ext, , short, tiny] of runs) {
      if (b < r0 || a > r1) { cur = Math.max(cur, b); continue; }
      if (a > cur) zline(cur, a);
      cur = Math.max(cur, b);
      const xa = X(a), xb = X(b), w = xb - xa;
      if (w <= 0.5) continue;
      const s = Math.min(3, w * 0.25);
      let e = byCol.get(col);
      if (!e) byCol.set(col, e = { d: '' });
      e.d += `M${xa.toFixed(1)} ${ym.toFixed(1)}L${(xa + s).toFixed(1)} ${yt.toFixed(1)}H${(xb - s).toFixed(1)}L${xb.toFixed(1)} ${ym.toFixed(1)}L${(xb - s).toFixed(1)} ${yb.toFixed(1)}H${(xa + s).toFixed(1)}Z`;
      // a shorter form of the value when the full one does not fit
      let text = text0;
      const room = w - 2 * s - 2;
      if (text && text.length * cw > room && short && !(ext && X(ext) - xb - 3 >= text.length * cw)) text = tiny && short.length * cw > room ? tiny : short;
      const tw = text.length * cw;
      if (text && ext && w - 2 * s - 2 < tw && X(ext) - xb - 3 >= tw) {
        // no room in T1: print the address over the floating T2 part of a read
        texts.push(`<text x="${(xb + 2).toFixed(1)}" y="${(ym + fsz * 0.36).toFixed(1)}" font-size="${fsz.toFixed(1)}" fill="${col}" stroke="${THEME.void}" stroke-width="3" paint-order="stroke">${text}</text>`);
      } else if (text && w - 2 * s - 2 >= tw) {
        texts.push(`<text x="${((xa + xb) / 2).toFixed(1)}" y="${(ym + fsz * 0.36).toFixed(1)}" font-size="${fsz.toFixed(1)}" fill="${col}" text-anchor="middle">${text}</text>`);
      } else if (text && r.id === 'state' && w - 2 * s >= 2 * cw) {
        texts.push(`<text x="${((xa + xb) / 2).toFixed(1)}" y="${(ym + fsz * 0.36).toFixed(1)}" font-size="${fsz.toFixed(1)}" fill="${col}" text-anchor="middle">${text[0]}</text>`);
      }
    }
    if (cur < r1) zline(cur, r1);
    let s = '';
    const idleCol = r.id === 'state' ? THEME.faint : THEME.muted;
    s += `<path d="${z}" stroke="${idleCol}" stroke-opacity=".7" stroke-width="1.2" fill="none"${r.id === 'state' ? '' : ' stroke-dasharray="3 2"'}/>`;
    for (const [col, e] of byCol) s += `<path d="${e.d}" stroke="${col}" stroke-width="1.2" fill="${col}" fill-opacity=".11" stroke-linejoin="round"/>`;
    // 8087 ownership band behind the state row
    if (r.id === 'state') {
      let band = '', st = null;
      for (let p = r0; p <= r1; p++) {
        const on = p < r1 && (this.fl[p & TV_MASK] & TV_F_FPU);
        if (on && st === null) st = p;
        else if (!on && st !== null) { band += `M${X(st).toFixed(1)} ${R.y + 1}H${X(p).toFixed(1)}V${R.y + R.h - 1}H${X(st).toFixed(1)}Z`; st = null; }
      }
      if (band) s = `<path d="${band}" fill="${THEME.lavender}" fill-opacity=".08"/>` + s;
      // 80486: a read hit makes no bus cycle; a dashed box on the idle bus shows it
      if (this.m486) {
        for (const n of this.notes) {
          if (n.end <= r0 || n.pos >= r1 || !n.e.hit || (n.e.write && !(this.m586 && n.e.state === 'M'))) continue;
          const xa = X(n.pos) + 1, w = Math.max(3, (n.end - n.pos) * px - 2);
          s += `<rect x="${xa.toFixed(1)}" y="${(yt + 1).toFixed(1)}" width="${w.toFixed(1)}" height="${(yb - yt - 2).toFixed(1)}" rx="3" fill="${THEME.phosphor}" fill-opacity=".06" stroke="${THEME.phosphor}" stroke-opacity=".7" stroke-dasharray="2 2"/>`;
          if (w >= cw * 6) texts.push(`<text x="${(xa + w / 2).toFixed(1)}" y="${(ym + fsz * 0.36).toFixed(1)}" font-size="${(fsz * 0.9).toFixed(1)}" fill="${THEME.phosphor}" text-anchor="middle">${this.m686 ? 'no FSB' : 'no bus'}</text>`);
        }
      }
    }
    return s;
  }

  // ---------- readouts ----------
  sample(r, p) {
    if (r.kind === 'bus') {
      const c = this.cyc[p & TV_MASK];
      const runs = [];
      if (r.id === 'cache' && this.m686) { const n = this.noteAt(p); return n ? { t: n.short || 'FSB', col: n.col } : { t: '–', col: THEME.faint }; }
      if (r.id === 'cache') { const n = this.noteAt(p); return n ? { t: n.e.wbOnly ? 'WB' : n.e.write ? 'WR' : n.e.hit ? 'HIT' : n.e.fill ? (n.e.synth ? 'FILL' : 'MISS') : 'NC', col: n.col } : { t: '–', col: THEME.faint }; }
      if (r.id === 'pipe' || r.id === 'btb' || r.id === 'retire') { const n = this.noteAt(p, this.xnotes[r.id]); return n ? { t: n.short, col: n.col } : { t: '–', col: THEME.faint }; }
      if (this.m286) for (const n of this.near(p)) this.cycleRuns(r.id, n, runs);
      else {
        if (!c) return { t: r.id === 'state' ? 'PASV' : 'Z', col: THEME.faint };
        this.cycleRuns(r.id, c, runs);
        const nxt = this.cyc[(p + 1) & TV_MASK];
        if (r.id === 'state' && nxt && nxt !== c && p + 1 < this.head) this.cycleRuns(r.id, nxt, runs);
      }
      for (const [a, b, text, col, , , short, tiny] of runs) if (p + 0.5 >= a && p + 0.5 < b) return { t: (text && text.length > 8 && (tiny || short)) || text || 'Z', col: text ? col : THEME.faint };
      return { t: r.id === 'state' ? 'PASV' : 'Z', col: THEME.faint };
    }
    const lv = this.levels(r.id, p);
    if (!lv) return { t: '', col: THEME.faint };
    const f = r.id === 'ale' ? (this.m286 ? 0.75 : 0.3) : r.id === 'bhe' ? 0.3 : r.id === 'clk' ? 0.8 : 0.9;
    let l = lv[1];
    for (let k = 0; k < lv.length; k += 2) if (lv[k] <= f) l = lv[k + 1];
    const on = r.act !== undefined && l === r.act;
    return { t: String(l), col: on ? (THEME[r.col] || THEME.text) : THEME.muted, on };
  }

  updateValues(p, kind) {
    if (this.valEls) {
      for (const r of this.flat) {
        const el = this.valEls[r.id];
        if (!el) continue;
        if (p === null) { el.textContent = ''; continue; }
        const v = this.sample(r, p);
        el.textContent = v.t;
        el.setAttribute('fill', v.col);
        el.setAttribute('font-weight', v.on ? '700' : '400');
      }
    }
    this.readEl.innerHTML = p === null ? '<span>Run or step the program: bus cycles appear here.</span>' : this.readoutHtml(p, kind);
    if (this.lay && this.lay.side) this.side.innerHTML = this.sideHtml(p);
  }

  cycleAt(p) {
    const i = p & TV_MASK;
    return { c: this.cyc[i], T: this.ts[i], abs: this.abs[i] };
  }
  instrAt(p) {
    let lo = 0, hi = this.marks.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.marks[mid].pos <= p) { best = this.marks[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best && best.gap === undefined ? best : null;
  }
  cycleWords(c) {
    const io = c.s === 1 || c.s === 2;
    const a = io ? 'port ' + hex4(c.addr) : this.m486 ? hex(c.addr, 8) : this.m286 ? hex(c.addr & 0xFFFFFF, 6) : hex5(c.addr);
    const d = this.m586 ? TimingView.hex586(c) : c.width === 2 ? hex4(c.data) : hex2(c.data);
    const name = TV_STATE_NAME[c.s] + this.burstTag(c);
    if (c.s === 3 || c.s === 8) return { name, a: '', d: '' };
    if (c.s === 0) return { name, a: '', d: c.second ? 'vector ' + hex2(c.data) : 'floating' };
    return { name, a, d, w: c.s === 2 || c.s === 6 ? '←' : '→' };
  }
  readoutHtml(p, kind) {
    const { c, T, abs } = this.cycleAt(p);
    const m = this.instrAt(p);
    const lead = kind === 'clock' ? '<span class="tv-p">▸ clock</span>' : kind === 'cursor' ? '<span>cursor</span>' : '<span>latest</span>';
    let s = `${lead} <b>#${abs.toLocaleString('en-US')}</b> · <b>${this.tnameAt(p)}</b>`;
    if (c) {
      const w = this.cycleWords(c);
      const cls = c.fpu ? 'tv-l' : c.s === 1 || c.s === 2 || c.s === 0 ? 'tv-m' : 'tv-d';
      s += ` · <span class="${cls}">${w.name}${c.fpu ? (this.m386 ? ' (80387)' : ' (8087)') : ''}</span>`;
      if (w.a) s += ` <span class="tv-c">${w.a}</span>`;
      if (w.d) s += ` ${w.w || ''} <span class="tv-d">${w.d}</span>`;
    } else s += this.m686 ? '' : ' · <span>idle (Ti)</span>';
    const q = this.qs[p & TV_MASK];
    if (q && !this.m286) s += ` · QS <b>${TV_QS[q]}</b>`;
    const nt = this.m486 ? this.noteAt(p) : null;
    if (nt) s += ` · <span style="color:${nt.col}">cache ${TimingView.esc(nt.text)} ${hex(nt.e.phys, 8)}</span>`;
    if (this.m686) {
      const rn = this.noteAt(p, this.xnotes.retire), bn = this.noteAt(p, this.xnotes.btb);
      if (rn) s += ` · <span style="color:${rn.col}">retire ${TimingView.esc(rn.text)}</span>`;
      if (bn) s += ` · <span style="color:${bn.col}">BTB ${TimingView.esc(bn.text)}</span>`;
    } else if (this.m586) {
      const pn = this.noteAt(p, this.xnotes.pipe), bn = this.noteAt(p, this.xnotes.btb);
      if (pn) s += ` · <span style="color:${pn.col}">${TimingView.esc(pn.text)}</span>`;
      if (bn) s += ` · <span style="color:${bn.col}">BTB ${TimingView.esc(bn.text)}</span>`;
    }
    if (m) s += ` · <span class="tv-p">${TimingView.esc(m.text)}</span>`;
    return s;
  }
  readoutText(p) {
    const { c, T, abs } = this.cycleAt(p);
    let s = `Clock ${abs}, ${this.tnameAt(p)}. `;
    if (c) {
      const w = this.cycleWords(c);
      s += `${w.name} cycle${w.a ? ', address ' + w.a : ''}${w.d ? ', data ' + w.d : ''}. `;
      const act = [];
      for (const r of this.flat) {
        if (r.kind !== 'dig' || r.act === undefined) continue;
        const v = this.sample(r, p);
        if (v.on && r.id !== 'ready') act.push(r.lab.text);
      }
      if (act.length) s += 'Active: ' + act.join(', ') + '.';
    } else s += 'Idle.';
    return s;
  }
  sideHtml(p) {
    const traffic = `<h4>${this.fastMode && this.traffic.rates ? 'Bus traffic per second' : 'Traffic in view'}</h4><div class="tv-traffic">${this.trafficHtml || '—'}</div>`;
    let s = this.fastMode ? traffic : '';
    s += '<h4>At the cursor</h4>';
    if (p === null) s += '<p>No clocks yet.</p>';
    else {
      const { c, T, abs } = this.cycleAt(p);
      s += `<dl><dt>clock</dt><dd>#${abs.toLocaleString('en-US')} · ${this.tnameAt(p)}</dd>`;
      if (c) {
        const w = this.cycleWords(c);
        s += `<dt>cycle</dt><dd>${w.name}${c.fpu ? (this.m386 ? ' · an operand for the 80387' : ' · 8087 owns the bus') : ''}</dd>`;
        if (w.a) s += `<dt>address</dt><dd style="color:${THEME.cyan}">${w.a}</dd>`;
        if (w.d) s += `<dt>data</dt><dd style="color:${THEME.goldHi}">${w.d}</dd>`;
        if (this.m686) { const q = this.req686(c); s += `<dt>REQ a · b</dt><dd>${q[0]} · ${q[1]}</dd>`; }
        else if (this.m486) s += `<dt>M/IO D/C W/R</dt><dd>${TV_386_BITS[c.s].join(' ')}${c.burst ? ' ·' + this.burstTag(c) : c.len > 2 ? ' · ' + (c.len - 2) + ' wait' : ''}</dd>`;
        else if (this.m386) s += `<dt>M/IO D/C W/R</dt><dd>${TV_386_BITS[c.s].join(' ')}${c.len > 2 ? ' · ' + (c.len - 2) + ' wait' : ''}</dd>`;
        else if (this.m286) s += `<dt>COD M/IO S1 S0</dt><dd>${TV_286_BITS[c.s].join(' ')}${c.pipe ? ' · pipelined' : ''}</dd>`;
      else s += `<dt>S2 S1 S0</dt><dd>${bin(c.s, 3).split('').join(' ')}${T >= 3 ? ' → passive 1 1 1' : ''}</dd>`;
      }
      const act = [];
      for (const r of this.flat) {
        if (r.kind !== 'dig' || r.act === undefined) continue;
        if (this.sample(r, p).on) act.push(r.lab.text);
      }
      s += `<dt>active</dt><dd>${act.length ? act.join(' ') : '—'}</dd></dl>`;
    }
    if (!this.fastMode) s += traffic;
    if (this.m686) {
      s += '<h4>A line read on the P6 bus</h4><ol>' +
        `<li><b style="color:${THEME.cyan}">Aa</b> <b style="color:${THEME.text}">ADS</b> low; the address and the type (REQ) out</li>` +
        `<li><b style="color:${THEME.cyan}">Ab</b> REQ gives the length (32 bytes)</li>` +
        `<li><b style="color:${THEME.lavender}">S</b> snoop: HIT and HITM stay high (no other cache)</li>` +
        `<li><b style="color:${THEME.gold}">D1</b> RS = 111 and <b style="color:${THEME.phosphor}">DRDY</b>: the first 8 bytes</li>` +
        `<li><b style="color:${THEME.gold}">D2–D4</b> one transfer each ${1 + ((this.app.machine && this.app.machine.bus && this.app.machine.bus.waitStates) || 0)} BCLKs; <b style="color:${THEME.gold}">DBSY</b> holds the bus</li>` +
        `<li><b style="color:${THEME.phosphor}">L1 and L2 hits</b> make no FSB transaction: the L2 is on the back-side bus</li></ol>`;
      return s;
    }
    if (this.m586) {
      s += '<h4>A Pentium line fill (burst)</h4><ol>' +
        `<li><b style="color:${THEME.cyan}">T1</b> <b style="color:${THEME.text}">ADS</b> and <b style="color:${THEME.cyan}">CACHE</b> low, the address out; <b style="color:${THEME.cyan}">KEN</b> low: cacheable</li>` +
        `<li><b style="color:${THEME.gold}">T2</b> the first 8 bytes, <b style="color:${THEME.phosphor}">BRDY</b> ends each transfer</li>` +
        `<li><b style="color:${THEME.gold}">T2</b> one clock for each next 8 bytes (2-1-1-1): 32 bytes in 4 transfers</li>` +
        `<li><b style="color:${THEME.goldHi}">WB</b>: a fill that replaces an M line writes that line back in a second burst</li>` +
        `<li><b style="color:${THEME.phosphor}">a cache hit</b> makes no bus cycle; so does a write to an E or M line</li></ol>`;
      return s;
    }
    if (this.m486) {
      s += '<h4>A line fill (burst)</h4><ol>' +
        `<li><b style="color:${THEME.cyan}">T1</b> <b style="color:${THEME.text}">ADS</b> low, the address out; <b style="color:${THEME.cyan}">KEN</b> low: cacheable</li>` +
        `<li><b style="color:${THEME.gold}">T2</b> the first transfer, <b style="color:${THEME.phosphor}">BRDY</b> ends it</li>` +
        `<li><b style="color:${THEME.gold}">T2</b> one clock for each next transfer (2-1-1-1)</li>` +
        `<li><b style="color:${THEME.magenta}">BLAST</b> low in the last transfer; 16 bytes = 8 words on this bus</li>` +
        `<li><b style="color:${THEME.phosphor}">a read hit</b> makes no bus cycle</li></ol>`;
      return s;
    }
    if (this.m386) {
      s += '<h4>One 80386 bus cycle</h4><ol>' +
        `<li><b style="color:${THEME.cyan}">T1</b> <b style="color:${THEME.text}">ADS</b> low, address and M/IO D/C W/R out</li>` +
        `<li><b style="color:${THEME.gold}">T2</b> data moves, the command is low</li>` +
        `<li><b style="color:${THEME.gold}">T2</b> again for each wait state; <b style="color:${THEME.phosphor}">READY</b> ends the cycle</li>` +
        '<li>16-bit bus: a dword takes two cycles</li></ol>';
      return s;
    }
    if (this.m286) {
      s += '<h4>One 80286 bus cycle</h4><ol>' +
        `<li><b style="color:${THEME.cyan}">Ts</b> status out, <b style="color:${THEME.magenta}">ALE</b> latches A23–A0</li>` +
        `<li><b style="color:${THEME.magenta}">Tc</b> 82288 command low</li>` +
        `<li><b style="color:${THEME.gold}">Tw</b> wait state, then <b style="color:${THEME.phosphor}">READY</b> ends it</li>` +
        `<li><b style="color:${THEME.cyan}">pipelined</b>: the next address shows during this Tc</li></ol>`;
      return s;
    }
    s += '<h4>One bus cycle = 4 clocks</h4><ol>' +
      `<li><b style="color:${THEME.cyan}">T1</b> address out, <b style="color:${THEME.magenta}">ALE</b> latches it</li>` +
      `<li><b style="color:${THEME.magenta}">T2</b> read / advanced write command low</li>` +
      `<li><b style="color:${THEME.gold}">T3</b> data valid, status passive 111</li>` +
      '<li><b>T4</b> command ends, bus turns round</li></ol>';
    return s;
  }

  updateTraffic(left, span) {
    const tr = this.traffic;
    const chip = (col, label, v) => `<span><i style="background:${col}"></i>${label} <b>${v}</b></span>`;
    let s = '';
    if (this.fastMode && tr.rates) {
      const r = tr.rates;
      s += `<span class="tv-mhz">clock <b>${(tr.cps / 1e6).toFixed(2)} MHz</b></span>`;
      s += chip(THEME.gold, 'CODE', TimingView.fmtRate(r.fetch));
      s += chip(THEME.gold, 'MEMR', TimingView.fmtRate(r.memr));
      s += chip(THEME.goldHi, 'MEMW', TimingView.fmtRate(r.memw));
      s += chip(THEME.magenta, 'IOR', TimingView.fmtRate(r.ior));
      s += chip(THEME.magenta, 'IOW', TimingView.fmtRate(r.iow));
      s += chip(THEME.magenta, 'INTA', TimingView.fmtRate(r.inta));
      if (this.m486) s += chip(THEME.phosphor, 'cache HIT', TimingView.fmtRate(r.hits));
      else s += chip(THEME.lavender, this.m386 ? '80387' : '8087', TimingView.fmtRate(r.fpu));
      const m = this.app.machine, ws = (m && m.bus && m.bus.waitStates) || 0, clen = this.m686 ? this.bR * (1 + ws) + 1 : this.m386 ? 2 + ws : 4;
      const cyc = (r.fetch + r.memr + r.memw + r.ior + r.iow + r.inta) * clen;
      if (tr.cps > 0) s += `<span>bus busy <b>${Math.min(100, cyc / tr.cps * 100).toFixed(0)} %</b></span>`;
    } else if (left !== undefined) {
      const n = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      let f = 0, busy = 0, total = 0, fills = 0, wbs = 0;
      const a = Math.max(this.firstLive(), Math.floor(left)), b = Math.min(Math.ceil(this.reveal), Math.ceil(left + span));
      for (let p = a; p < b; p++) {
        const i = p & TV_MASK, t = this.ts[i];
        if (t === TV_GAP) continue;
        total++;
        if (t) busy++;
        const c = this.cyc[i];
        if (t && c && c.pos === p) { if (c.fpu) f++; else if (c.burst) { if (!c.beat) { if (c.wb) wbs++; else fills++; } } else n[c.s]++; }
      }
      let hits = 0;
      if (this.m486) for (const nt of this.notes) if (nt.pos >= a && nt.pos < b && nt.e.hit && !nt.e.write) hits++;
      if (!total) { this.trafficEl.innerHTML = ''; return; }
      s += `<span>in view <b>${total}</b> clk</span>`;
      if (n[4]) s += chip(THEME.gold, 'CODE', n[4]);
      if (n[5]) s += chip(THEME.gold, 'MEMR', n[5]);
      if (n[6]) s += chip(THEME.goldHi, 'MEMW', n[6]);
      if (n[1]) s += chip(THEME.magenta, 'IOR', n[1]);
      if (n[2]) s += chip(THEME.magenta, 'IOW', n[2]);
      if (n[0]) s += chip(THEME.magenta, 'INTA', n[0]);
      if (f) s += chip(THEME.lavender, this.m386 ? '80387' : '8087', f);
      if (fills) s += chip(THEME.cyan, 'FILL', fills);
      if (wbs) s += chip(THEME.goldHi, 'WB', wbs);
      if (hits) s += chip(THEME.phosphor, 'HIT', hits);
      s += `<span>bus busy <b>${Math.round(busy / total * 100)} %</b></span>`;
    } else return;
    if (s !== this.trafficHtml) { this.trafficHtml = s; this.trafficEl.innerHTML = s; if (this.lay && this.lay.side) this.dirtyCursor = true; }
  }

  // ---------- signal tooltips and the detail card ----------
  nameTip(r) {
    const f = this.info[r.id] || {};
    const first = (f.job || '').split(/(?<=\.)\s/)[0];
    return `${r.lab.text}: ${f.n}. ${first} Driver: ${f.drv}. Receivers: ${f.rcv}. Active: ${f.lvl}.`;
  }
  rowAt(y) {
    const L = this.lay;
    if (!L) return null;
    for (const r of this.flat) { const R = L.rows[r.id]; if (y >= R.y && y < R.y + R.h) return r; }
    return null;
  }
  static labHtml(lab) {
    let s = '', k = 0;
    const t = lab.text, esc = TimingView.esc;
    for (const [a, b] of lab.bars) { s += esc(t.slice(k, a)) + `<span class="tv-ob">${esc(t.slice(a, b))}</span>`; k = b; }
    return s + esc(t.slice(k));
  }
  rowColor(r) {
    if (r.kind === 'bus') return r.id === 'd' ? THEME.goldHi : r.id === 'state' ? THEME.gold : r.id === 'cache' || r.id === 'btb' || r.id === 'retire' ? THEME.phosphor : r.id === 'pipe' || r.id === 'phase' ? THEME.lavender : r.id === 'be' || r.id === 'req' || r.id === 'rs' ? THEME.magenta : THEME.cyan;
    return THEME[r.col] || THEME.text;
  }

  // The tooltip that follows the pointer over the waveforms (same look as the Tips).
  tipEl() {
    const doc = this.host.ownerDocument;
    if (!this.ptip || this.ptip.ownerDocument !== doc) {
      if (this.ptip) this.ptip.remove();
      const t = this.ptip = doc.createElement('div');
      t.className = 'tip tv-ptip';
      t.setAttribute('role', 'tooltip');
      t.hidden = true;
      doc.body.appendChild(t);
    }
    return this.ptip;
  }
  moveTip(pos, y, cx, cy) {
    const r = this.rowAt(y), p = Math.floor(pos);
    if (!r || !this.validPos(p) || p >= Math.ceil(this.reveal)) { this.hideTip(); return; }
    this.ptipAt = { r, p, f: pos - p, cx, cy };
    if (!this.tipEl().hidden) { this.showTip(); return; }
    clearTimeout(this.ptipTimer);
    this.ptipTimer = setTimeout(() => this.showTip(), 320);
  }
  showTip() {
    const a = this.ptipAt;
    if (!a || !this.shown || !this.validPos(a.p)) { this.hideTip(); return; }
    const t = this.tipEl();
    const txt = this.waveTip(a.r, a.p, a.f);
    if (this.ptipTxt !== txt || !t.firstChild) {
      this.ptipTxt = txt;
      const n = txt.indexOf('\n');
      t.innerHTML = `<b>${TimingView.esc(txt.slice(0, n))}</b>\n${TimingView.esc(txt.slice(n + 1))}`;
    }
    t.hidden = false;
    const win = t.ownerDocument.defaultView, b = t.getBoundingClientRect();
    let x = a.cx + 14, y = a.cy + 18;
    if (x + b.width > win.innerWidth - 8) x = Math.max(8, a.cx - b.width - 14);
    if (y + b.height > win.innerHeight - 8) y = Math.max(8, a.cy - b.height - 14);
    t.style.left = x.toFixed(0) + 'px';
    t.style.top = y.toFixed(0) + 'px';
  }
  hideTip() {
    clearTimeout(this.ptipTimer);
    this.ptipAt = null;
    if (this.ptip) this.ptip.hidden = true;
  }
  waveTip(r, p, f) {
    const i = p & TV_MASK;
    const w = this.meaning(r, p, f);
    return `${r.lab.text} = ${w.v || '–'} · ${this.tnameAt(p)} · clock #${this.abs[i].toLocaleString('en-US')}\n${w.t}`;
  }

  // ---------- words for the signals ----------
  cpuName(c) { return this.m686 ? 'Pentium Pro' : this.m586 ? 'Pentium' : this.m486 ? '80486' : this.m386 ? '80386' : this.m286 ? '80286' : c && c.fpu ? '8087' : '8086'; }
  addrText(c) {
    if (c.s === 1 || c.s === 2) return 'port ' + hex4(c.addr) + 'h';
    return (this.m486 ? hex(c.addr, 8) : this.m286 ? hex(c.addr & 0xFFFFFF, 6) : hex5(c.addr)) + 'h';
  }
  dataText(c) { return (this.m586 ? TimingView.hex586(c) : c.width === 2 ? hex4(c.data) : hex2(c.data)) + 'h'; }
  burstTag(c) { return c.burst ? ` burst ${c.beat + 1}/${this.lastBeat + 1}${c.wb ? ' write-back' : ''}` : ''; }
  devName(c) {
    if (c.s === 0) return '8259A';
    const io = c.s === 1 || c.s === 2, m = this.app.machine;
    let d = c.dev;
    if (!d && m) { try { d = io ? m.ioDevAt(c.addr) : m.devAt(c.addr); } catch (e) { d = null; } }
    if (d === 'pit') return this.m286 ? '8254 timer' : '8253 timer';
    return TV_DEV[d] || (io ? 'I/O device' : 'memory');
  }
  cycText(c) { return TV_STATE_NAME[c.s] + this.burstTag(c) + (c.fpu ? (this.m386 ? ' (80387)' : this.m286 ? ' (80287)' : ' (8087)') : ''); }
  cycLine(c) {
    if (c.s === 3 || c.s === 8) return this.cycText(c);
    if (c.s === 0) return this.cycText(c) + (c.second ? ` · vector ${hex2(c.data)}h` : ' · first');
    return `${this.cycText(c)} ${this.addrText(c)} · ${this.dataText(c)}`;
  }
  levelAt(id, p, f) {
    const lv = this.levels(id, p);
    if (!lv) return null;
    let l = lv[1];
    for (let k = 0; k < lv.length; k += 2) if (lv[k] <= f) l = lv[k + 1];
    return l;
  }
  // The point in a clock where the value column reads a row (see sample()).
  sampleF(r) {
    if (r.kind === 'bus') return 0.5;
    return r.id === 'ale' ? (this.m286 ? 0.75 : 0.3) : r.id === 'bhe' ? 0.3 : r.id === 'clk' ? 0.8 : 0.9;
  }

  // Value and meaning of row r at position p + f: { v, t }.
  meaning(r, p, f) {
    const i = p & TV_MASK, T = this.ts[i], c = this.cyc[i];
    if (T === TV_GAP) return { v: '', t: 'A gap in the history: the analyser did not record these clocks.' };
    if (r.kind === 'bus') {
      // the value is on the first line already: remove it from the sentence
      const w = this.busMeaning(r.id, p, f, c, T), pre = w.v + 'h: ';
      if (w.t.startsWith(pre)) w.t = w.t.charAt(pre.length).toUpperCase() + w.t.slice(pre.length + 1);
      return w;
    }
    const l = this.levelAt(r.id, p, f);
    return { v: String(l), t: this.digMeaning(r.id, l, c, T, p, f) };
  }

  busMeaning(id, p, f, c0, T) {
    const t = p + f;
    if (this.m686 && (id === 'btb' || id === 'retire')) return this.xMeaning686(id, p);
    if (this.m686 && id === 'cache') return this.cacheMeaning686(p);
    if (this.m586 && (id === 'pipe' || id === 'btb')) return this.xMeaning(id, p);
    if (this.m586 && id === 'cache') return this.cacheMeaning586(p);
    if (id === 'cache') {
      const n = this.noteAt(p);
      if (!n) return { v: '–', t: 'No cache event in this clock.' };
      const e = n.e, where = `${hex(e.phys, 8)}h, set ${hex2(e.set)}${e.way >= 0 ? ', way ' + e.way : ''}`;
      const w = e.write ? (e.hit ? 'A write hit: the line changes, and the write also goes to the bus (write-through).' : 'A write miss: the write goes to the bus only; the cache does not fill a line.')
        : e.hit ? 'A read hit: the cache gives the data, so there is no bus cycle.'
          : e.synth ? 'A line fill: the 80486 reads a line of 16 bytes into the cache in a burst.'
            : e.fill ? 'A read miss: the 80486 fills the line with a burst of 16 bytes.' : 'A read that the cache does not keep (CD = 1, PCD = 1 or KEN# high): a normal bus read.';
      return { v: n.text, t: `${w}\n${e.code ? 'Code' : 'Data'} at ${where}.` };
    }
    let hit = null;
    for (const c of this.near(p)) {
      const runs = [];
      this.cycleRuns(id, c, runs);
      for (const r of runs) if (t >= r[0] && t < r[1]) hit = { c, r };
    }
    if (!hit && this.m686) {
      if (id === 'state' || id === 'phase') return { v: 'idle', t: 'No transaction on the front-side bus. The core works from its L1 and L2 caches.' };
      if (id === 'req' || id === 'rs') return { v: '00000', t: 'No code: the pins are high (idle).' };
      return { v: '-', t: 'No agent drives these pins now.' };
    }
    if (!hit) {
      if (id === 'state') return { v: 'PASV', t: this.m386 ? 'Idle (Ti): no bus cycle. ADS stays high.' : this.m286 ? 'Idle: no bus cycle. S1 S0 = 1 1.' : 'Passive: S2 S1 S0 = 1 1 1. No bus cycle.' };
      if (id === 'ad' && c0 && T === 2 && TimingView.isRead(c0.s)) return { v: 'Z', t: `Z in T2: the ${this.cpuName(c0)} lets go of the bus. Then the ${this.devName(c0)} drives it.` };
      return { v: 'Z', t: 'Z: the bus floats. No chip drives it now.' };
    }
    const { c, r } = hit, v = r[2], A = this.addrText(c), cpu = this.cpuName(c), dev = this.devName(c);
    if (this.m686) return this.busMeaning686(id, c, r, v, A, dev);
    if (id === 'be' && this.m586) return { v, t: `BE7#–BE0# = ${v.split('').join(' ')}: the transfer at ${A} uses the byte${v.replace(/1/g, '').length === 1 ? '' : 's'} with 0 of the 8-byte group ${hex((c.addr & ~7) >>> 0, 8)}h.${c.burst ? ' A burst uses all 8 bytes.' : ''}` };
    if (id === 'be') return { v, t: `BE3#–BE0# = ${v.split('').join(' ')}: the ${c.width === 2 ? 'word' : 'byte'} at ${A} uses the byte${c.width === 2 ? 's' : ''} with 0. BS16# makes the board move it on D15–D0.` };
    if (id === 'state' && c.burst && this.m586) {
      const what = c.wb ? `the write-back of an M line (line ${hex(c.line, 8)}h): the data cache sends the 32 bytes of the modified line back to memory` : `a line fill (line ${hex(c.line, 8)}h)`;
      const how = c.beat ? ' The burst needs no new ADS#: this transfer takes one clock (and the wait states).' : c.wb ? ' CACHE# is low with ADS#, so the board takes a burst of 4 transfers.' : ' CACHE# and KEN# are low, so the read becomes a burst of 4 transfers.';
      return { v, t: `Transfer ${c.beat + 1} of 4 of ${what}.${how}
Address ${A}, data ${this.dataText(c)}.` };
    }
    if (id === 'state' && c.burst) return { v, t: `Transfer ${c.beat + 1} of 8 of a line fill (line ${hex(c.line, 8)}h).${c.beat ? ' The burst needs no new ADS#: this transfer takes one clock.' : ' KEN# is low, so the read becomes a burst.'}\nAddress ${A}, data ${this.dataText(c)}.` };
    if (id === 'state') {
      let s = `${this.cycText(c)}: ${TV_WORD[c.s]}. `;
      s += this.m586 ? `M/IO# D/C# W/R# = ${TV_386_BITS[c.s].join(' ')}: the bus logic decodes the type of this cycle.` : this.m386 ? `M/IO D/C W/R = ${TV_386_BITS[c.s].join(' ')}: the 82288 makes the command of this cycle.` : this.m286 ? `The 82288 decodes COD/INTA M/IO S1 S0 = ${TV_286_BITS[c.s].join(' ')}.` : `The 8288 decodes S2 S1 S0 = ${bin(c.s, 3).split('').join(' ')}.`;
      if (c.s !== 3 && c.s !== 8 && c.s !== 0) s += `\nAddress ${A}, data ${this.dataText(c)}.`;
      if (c.fpu) s += this.m386 ? '\nThe 80386 moves an operand for the 80387.' : this.m286 ? '\nThe 80286 moves an operand for the 80287.' : '\nThe 8087 has the bus.';
      return { v, t: s };
    }
    if (id === 'ah') {
      if (r[0] < c.pos + 1) return { v, t: `${v}h: address bits 19–16 of ${A}. The 8282 latch takes them when ALE goes low.` };
      return { v, t: c.seg ? `S6–S3 status. S4 S3 show the segment register in use: ${c.seg}.` : 'S6–S3 status. No segment register is in use (I/O or INTA).' };
    }
    const addr = id === 'a' || (id === 'ad' && r[0] < c.pos + 1);
    if (addr) {
      if (id === 'a') {
        let s = `${v}h: the address of the ${this.cycText(c)} cycle.`;
        if (c.pipe && t < c.pos) s += ' It comes early (pipelined), in the Tc of the cycle before.';
        if (this.m586 && c.s !== 1 && c.s !== 2) s += ' A2–A0 are not pins: BE7#–BE0# select the bytes of the 8-byte group.';
        else if (this.m386 && c.s !== 1 && c.s !== 2) s += ' A0 is not a pin: BHE and BLE select the bytes.';
        if (c.s === 0) s += ' An INTA cycle puts out no real address.';
        return { v, t: s };
      }
      const io = c.s === 1 || c.s === 2;
      return { v, t: `${v}h: ${io ? 'the port address' : `bits 15–0 of the address ${A}`}. The 8282 latches take it when ALE goes low.` };
    }
    if (c.s === 0) return { v, t: `${v}h: the 8259A sends the interrupt vector to the ${cpu}.` };
    if (c.s === 2 || c.s === 6) return { v, t: `${v}h: the ${cpu} sends the data to the ${dev} (${A}).` };
    return { v, t: `${v}h: the ${dev} sends the data of ${A} to the ${cpu}.` };
  }

  // Pentium Pro: the words for a bus row of one transaction.
  busMeaning686(id, c, r, v, A, dev) {
    const s = c.s, wr = s === 2 || s === 6, noData = s === 3 || s === 8, q = this.req686(c);
    const what = c.burst ? (c.wb ? `the write-back of the modified L2 line ${hex(c.line, 8)}h` : `the read of the line ${hex(c.line, 8)}h (an L2 miss)`) : `a ${TV_WORD[s]}`;
    switch (id) {
      case 'state':
        if (c.burst && c.beat) return { v, t: `Transfer ${c.beat + 1} of 4 of ${what}. No new request: the transfers of a line follow the first one.\nAddress ${A}, data ${this.dataText(c)}.` };
        if (c.burst) return { v, t: `${c.wb ? 'A write-back' : 'A line read'} of 32 bytes: one request, then 4 transfers of 8 bytes. ${c.wb ? 'The L2 must replace a modified (M) line, so that line goes back to memory first.' : 'The L2 and the L1 get the line; the core gets the 8 bytes that it needs first.'}\nAddress ${A}.` };
        return { v, t: `${TV_STATE_NAME[s]}: ${TV_WORD[s]}, one transaction with ${noData ? 'no data' : 'one transfer of 8 bytes or less'}.${noData || s === 0 ? '' : `\nAddress ${A}, data ${this.dataText(c)}.`}` };
      case 'phase':
        if (r[2] === 'REQUEST') return { v, t: `The request phase: 2 BCLKs. In phase a, ADS# is low, A31#–A3# give the address and REQ4#–REQ0# = ${q[0]} give the type (${q[2]}). In phase b, REQ4#–REQ0# = ${q[1]} give the length, and BE7#–BE0# select the bytes.` };
        if (r[2] === 'SNOOP') return { v, t: 'The snoop phase: each other cache on the bus looks for the line. HIT# and HITM# stay high: this board has no other cache, so no agent has a copy.' };
        if (!c.req) return { v, t: `Transfer ${c.beat + 1} of 4: DRDY# is low in the last BCLK, and 8 more bytes are on D63#–D0# (the P6 burst order). DBSY# holds the data bus for the next transfer.` };
        if (noData) return { v, t: 'The response phase: RS2#–RS0# = 101 (no data). The transaction ends.' };
        return { v, t: wr ? 'TRDY# tells the CPU that the chipset can take the data. Then the CPU drives the data with DRDY#, and the chipset gives the response RS2#–RS0# = 101 (no data).'
          : `The response phase: RS2#–RS0# = 111 (normal data) and DRDY#: the first 8 bytes are on D63#–D0#.${c.burst ? ' 3 more transfers follow.' : ''}` };
      case 'req':
        return { v, t: `REQ4#–REQ0# = ${v} in request phase ${r[6]}: ${r[6] === 'a' ? 'the type, ' + q[2] : 'the length, ' + (q[1].slice(-2) === '10' ? 'a line of 32 bytes' : '8 bytes or less')}. Phase a: bit 2 = a memory read or write, bit 1 = data (0 = code), bit 0 = write. Phase b: bits 1–0 = LEN. The codes are simplified; 1 = the pin is low.` };
      case 'rs':
        return { v, t: `RS2#–RS0# = ${v}: ${v === '111' ? 'the normal data response. The read data comes with DRDY# in the same BCLK.' : 'the no data response. The transaction ends' + (wr ? ' (the write data moved already).' : '.')} Other codes: 000 idle, 001 retry, 010 deferred, 100 hard failure, 110 implicit write-back (after HITM#). 1 = the pin is low (a simplified list).` };
      case 'a':
        return { v, t: `${v}h: the address, in request phase a only. A35#–A32# are 0 on this board. A2–A0 are not pins: BE7#–BE0# select the bytes.${c.burst && !c.wb ? ' For a line read this is the 8-byte group that the core needs first; the other 3 transfers come with no new address.' : ''}${s === 0 ? ' An interrupt acknowledge has no real address.' : ''}` };
      case 'be':
        return { v, t: `BE7#–BE0# = ${v.split('').join(' ')} in request phase b (on the pins A15#–A8#): the transaction uses the bytes with 0 of the 8-byte group ${hex((c.addr & ~7) >>> 0, 8)}h.${c.burst ? ' A line uses all 8 bytes of each transfer.' : ''}` };
      case 'd':
        if (s === 0) return { v, t: `${v}h: the 8259A sends the interrupt vector (through the chipset).` };
        if (c.wb) return { v, t: `DRDY# is low: the Pentium Pro sends 8 bytes of the modified line to memory (transfer ${c.beat + 1} of 4, ${A}).` };
        if (wr) return { v, t: `DRDY# is low: the Pentium Pro sends the data to the ${dev} (${A}).` };
        return { v, t: `DRDY# is low: the ${dev} sends 8 bytes of ${A} to the Pentium Pro${c.burst ? ` (transfer ${c.beat + 1} of 4 of the line; the L2 and the L1 keep it)` : ''}.` };
    }
    return { v, t: '' };
  }
  // Pentium Pro: the words for the retire row and the BTB row at position p.
  xMeaning686(id, p) {
    const n = this.noteAt(p, this.xnotes[id]);
    if (id === 'retire') {
      if (!n) return { v: '–', t: 'No µop retires in this clock of the plot.' };
      const e = n.e;
      let t = `${e.n} µop${e.n === 1 ? '' : 's'} of "${e.text}" retire${e.n === 1 ? 's' : ''} here: ${e.kinds}. The ROB retires up to 3 µops each clock, in program order. At the retire the results go into the retirement registers, and the program sees them.`;
      if (e.n > 3 || e.floor) t += `\nThe P6 retired more than one instruction in a clock here: the step is 1 clock (the floor rule), and the steps are ${e.debt} clock${e.debt === 1 ? '' : 's'} ahead of the model.`;
      return { v: n.short, t };
    }
    if (!n) return { v: '–', t: 'No branch in this instruction.' };
    const e = n.e;
    const kind = { jcc: 'conditional jump', jmp: 'jump', call: 'call', ret: 'return', jmpi: 'indirect jump', calli: 'indirect call', loop: 'LOOP instruction', far: 'far transfer' }[e.kind] || 'branch';
    const how = e.how === 'rsb' ? 'the return stack buffer' : e.how === 'static' ? 'the decoder (no BTB entry: a backward conditional jump is taken, a forward one is not taken, a direct JMP or CALL is taken)' : 'the BTB (two levels: the history of the branch selects a 2-bit counter)';
    let t = `A ${kind} at ${hex(e.lin >>> 0, 8)}h. The prediction comes from ${how}: ${e.predicted ? 'taken' : 'not taken'}. `;
    if (e.history >= 0) t += `The history before the branch: ${bin(e.history & 15, 4)} (the newest result at the right; 1 = taken). `;
    if (e.counter >= 0) t += `The counter that predicted: ${e.counter} (${TV_BTBST[e.counter & 3]}). `;
    t += `\nThe branch is ${e.taken ? 'taken (to ' + hex(e.target >>> 0, 8) + 'h)' : 'not taken'}: `;
    t += e.right ? (e.penalty ? `a right prediction; the fetch from the target costs ${e.penalty} clock${e.penalty === 1 ? '' : 's'}.` : 'a right prediction, with no lost clocks.')
      : `a WRONG prediction. The µops after the branch are flushed, and the fetch starts again: ${e.penalty} clocks from the decode of the branch.`;
    if (e.alloc) t += ' The branch gets a new BTB entry.';
    return { v: n.short, t };
  }
  // Pentium Pro: the words for the L1 · L2 row.
  cacheMeaning686(p) {
    const n = this.noteAt(p);
    if (!n) return { v: '–', t: 'No cache access here. The trace shows the first data access and the first code miss of each instruction.' };
    const e = n.e, code = !!e.code;
    let w;
    if (e.wbOnly) w = 'A write-back: a modified (M) line of the L2 goes to memory in a burst of 4 transfers on the front-side bus.';
    else if (e.synth) w = 'A line read on the front-side bus: 32 bytes in 4 transfers of 8 bytes.';
    else if (e.lvl === 'L1') w = e.write ? `A write hit in the L1 data cache: the line is now ${e.state}. The store stays in the cache (write-back): no bus transaction.` : `A hit in the L1 ${code ? 'code' : 'data'} cache (set ${hex2(e.set)}, way ${e.way}): ${code ? 'the decoders get the bytes' : 'a load gets the data in 3 clocks'}, with no bus transaction.`;
    else if (e.lvl === 'L2') w = 'An L1 miss that hits in the L2 (256 KB, the second die in the package). The L2 sends the line on the back-side bus at the core clock: 4 clocks more than an L1 hit, and no front-side bus transaction.';
    else if (e.nc) w = 'A read that the caches do not keep (CD = 1, PCD = 1 or no KEN#): one transfer on the front-side bus.';
    else if (e.l2) w = `An L1 miss and an L2 miss: the P6 reads the line of 32 bytes on the front-side bus (request, snoop, response, 4 data transfers). The L2 and the L1 get the line.${e.l2.wb ? ` The L2 line ${hex(e.l2.wbLine >>> 0, 8)}h is modified, so its write-back burst comes first.` : ''}`;
    else w = 'An L1 write miss to a page with PWT = 1 or PCD = 1: the store goes to the front-side bus with no fill.';
    if (e.write && !e.l1hit && e.fill) w += ' The L1 data cache is write-allocate: a write miss reads the line first (read for ownership), then the line is M.';
    return { v: n.text, t: `${w}\n${code ? 'Code' : 'Data'} at ${hex(e.phys >>> 0, 8)}h${e.state && !code ? ', L1 line state ' + e.state : ''}${e.l2 ? `, L2 set ${hex(e.l2.set, 3)} way ${e.l2.way}` : ''}.` };
  }
  // Pentium: the words for the pipe row and the BTB row at position p.
  xMeaning(id, p) {
    const n = this.noteAt(p, this.xnotes[id]);
    if (!n) return { v: '–', t: id === 'pipe' ? 'No instruction in this clock (a gap in the history).' : 'No branch of the BTB in this instruction.' };
    const e = n.e;
    if (id === 'pipe') {
      let t;
      if (e.pipe === 'V') t = `This instruction runs in the V pipe, at the same time as the one before it in the U pipe (${e.partner || '?'}).`;
      else if (e.paired) t = `This instruction runs in the U pipe. The next one (${e.partner || '?'}) pairs with it and runs in the V pipe at the same time.`;
      else t = `This instruction runs in the U pipe with no partner: ${e.reason || 'no pair'}.`;
      return { v: n.short, t: `${t}
Alone it needs ${e.clocks} clock${e.clocks === 1 ? '' : 's'}.` };
    }
    const cnt = ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken'][e.counter] || 'no entry';
    let t = `A branch at ${hex(e.lin >>> 0, 8)}h in the ${e.pipe} pipe. `;
    t += e.hit ? `The BTB has it (set ${e.set}, way ${e.way}) and predicts ${e.predicted ? 'taken' : 'not taken'}. ` : 'The BTB does not have it, so the prediction is not taken. ';
    t += `The branch is ${e.taken ? 'taken (to ' + hex(e.target >>> 0, 8) + 'h)' : 'not taken'}: `;
    t += e.right ? 'a right prediction, no extra clocks.' : `a wrong prediction: the pipes empty and ${e.penalty} clocks are lost.`;
    t += `
The 2-bit counter is now ${e.counter >= 0 ? e.counter + ' (' + cnt + ')' : 'not there'}${e.alloc ? '; the branch got a new entry' : ''}.`;
    return { v: n.short, t };
  }
  // Pentium: the words for the cache row (the code cache and the data cache with the MESI states).
  cacheMeaning586(p) {
    const n = this.noteAt(p);
    if (!n) return { v: '–', t: 'No cache event in this clock.' };
    const e = n.e, where = `${hex(e.phys, 8)}h, set ${hex2(e.set)}${e.way >= 0 ? ', way ' + e.way : ''}`;
    const st = { M: 'M (modified: only the cache has the new data)', E: 'E (exclusive: the same as memory)', S: 'S (shared: writes go to the bus too)', I: 'I (invalid)' }[e.state] || '';
    let w;
    if (e.wbOnly) w = 'A write-back: the data cache sends a modified (M) line back to memory in a burst of 4 transfers.';
    else if (e.write) w = e.hit ? (e.state === 'M' ? 'A write hit on an E or M line: the line becomes M, and no bus cycle occurs (write-back).' : 'A write hit on an S line: the write also goes to the bus (write-through).') : 'A write miss: the write goes to the bus only; the cache does not fill a line.';
    else if (e.hit) w = `A read hit in the ${e.code ? 'code' : 'data'} cache: no bus cycle.`;
    else if (e.fill) w = `A read miss: the Pentium fills the line with a burst of 32 bytes (4 transfers of 8 bytes).${e.wb ? ` The fill replaced the M line ${hex(e.wbLine >>> 0, 8)}h, so a write-back burst follows.` : ''}`;
    else w = 'A read that the cache does not keep (CD = 1, PCD = 1 or KEN# high): a single transfer on the bus.';
    return { v: n.text, t: `${w}
${e.code ? 'Code' : 'Data'} at ${where}.${st && !e.code ? ' The line is ' + st + '.' : ''}` };
  }

  digMeaning(id, l, c, T, p, f) {
    const m286 = this.m286, Tn = this.tnameAt(p), cpu = this.cpuName(c), i = p & TV_MASK;
    const latch = m286 ? '74LS573' : '8282';
    if (this.m686) {
      const hz = (this.app.machine && this.app.machine.clockHz) || 200000000, R = this.bR, now = c ? ` Now: ${Tn} of a ${this.cycText(c)} transaction.` : ' No transaction now.';
      switch (id) {
        case 'clk': return `BCLK, the bus clock: ${(hz / R / 1e6).toFixed(1)} MHz. The core runs ${R} clocks in each BCLK.${now}`;
        case 'core': return `The core clock: ${(hz / 1e6).toFixed(0)} MHz, ${R} in each BCLK. The core, the L1 and the L2 (on the back-side bus) run at this clock.`;
        case 'ads':
          if (l === 0 && c) return `Low in request phase a: a ${this.cycText(c)} transaction starts. A31#–A3# = ${this.addrText(c)}, and REQ4#–REQ0# give the type.`;
          return 'High: no new request in this BCLK. The P6 bus can have up to 8 transactions in its phases; this model does one at a time.';
        case 'bnr': return 'High: no agent asks to stop the next request (block next request).';
        case 'bpri': return 'High: no priority agent (for example the chipset for DMA) asks for the bus.';
        case 'hit': return c && Tn === 'snoop' ? 'High in the snoop phase: no other cache has a clean copy of the line.' : 'High: no other cache has the line. This board has one CPU.';
        case 'hitm': return c && Tn === 'snoop' ? 'High in the snoop phase: no other cache has a modified copy, so no implicit write-back.' : 'High: no other cache has a modified copy of the line.';
        case 'trdy': return l === 0 ? 'Low: the chipset can take the write data now (target ready). The CPU sends the data in the next BCLK.' : c && (c.s === 2 || c.s === 6) ? 'High: the chipset is not ready for the write data in this BCLK.' : 'High: TRDY# is only for a write.';
        case 'drdy':
          if (l === 0 && c) return `Low: D63#–D0# carry valid data in this BCLK (${c.burst ? `transfer ${c.beat + 1} of 4 of the line` : 'the one transfer of the transaction'}).`;
          return c ? `High: no valid data in this BCLK (${Tn}).` : 'High: no data transfer.';
        case 'dbsy': return l === 0 ? 'Low: a line transfer uses the data bus for more BCLKs. No other agent may drive the data bus.' : 'High: the data bus is free after this BCLK.';
        case 'ferr': return l === 0 ? 'Low: the FPU on the Pentium Pro has an unmasked exception.' : 'High: no FPU error.';
        default: break;
      }
    }
    if (this.m586) {
      switch (id) {
        case 'clk': return c ? `${Tn} of a ${this.cycText(c)} cycle. One CLK period is one T-state: the bus runs at the clock of the Pentium.` : 'Ti: an idle clock. No bus cycle.';
        case 'na': return 'High: the board does not use NA#, so the Pentium does not pipeline its bus cycles.';
        case 'brdy':
          if (l === 0 && c) return c.burst ? `Low in ${Tn}: the memory ends transfer ${c.beat + 1} of 4 of the burst.` : `Low in ${Tn}: the ${this.cycText(c)} cycle ends (one transfer).`;
          return c ? `High in ${Tn}: the transfer continues.` : 'High: no transfer ends here.';
        case 'cachen':
          if (l === 0 && c) return c.wb ? 'Low with ADS#: the Pentium writes back a modified (M) line in a burst of 32 bytes.' : 'Low with ADS#: the Pentium can keep this line, so it asks for a line fill (a burst of 32 bytes).';
          return c ? `High: this ${this.cycText(c)} is not the start of a burst.` : 'High: no bus cycle.';
        case 'ken': return l === 0 ? 'Low: the address is cacheable, so the Pentium fills the whole line (a burst of 32 bytes).' : 'High: no line fill starts here.';
        case 'ferr': return l === 0 ? 'Low: the FPU on the Pentium has an unmasked exception.' : 'High: no FPU error.';
        case 'ads':
          if (l === 0 && c) return `Low in ${Tn}: a ${this.cycText(c)} cycle starts. The address ${this.addrText(c)}, BE7#–BE0# and M/IO# D/C# W/R# are valid.`;
          return c ? `High in ${Tn}: the cycle continues. ADS# is low only in T1.` : 'High: no new bus cycle starts.';
        default: break;
      }
    }
    switch (id) {
      case 'clk':
        if (!c) return 'Ti: an idle clock. No bus cycle.';
        return `${Tn} of a ${this.cycText(c)} cycle. ` + (this.m386 ? 'Two CLK2 periods make one T-state.' : m286 ? 'Two CLK periods make one T-state.' : 'The next T-state starts at the next falling edge.');
      case 'ready':
        if (!m286) return 'High: the memory or the I/O device is ready, so the 8086 adds no wait states.';
        if (l === 0) return `Low in ${Tn}: the cycle ends at the end of this T-state.`;
        return c ? `High in ${Tn}: the cycle continues (a wait state or the command).` : 'High: no bus cycle.';
      case 's2': case 's1': case 's0': {
        if (m286) {
          const b = [this.levelAt('s1', p, f), this.levelAt('s0', p, f)];
          if (b[0] && b[1]) return 'S1 S0 = 1 1: no new bus cycle.';
          return `S1 S0 = ${b.join(' ')} in ${Tn}: the 82288 starts ${c ? 'a ' + TV_WORD[c.s] : 'a'} cycle.`;
        }
        const b = [this.levelAt('s2', p, f), this.levelAt('s1', p, f), this.levelAt('s0', p, f)];
        const v = b[0] * 4 + b[1] * 2 + b[2];
        if (v === 7) return 'S2 S1 S0 = 1 1 1: passive.' + (c && T >= 3 ? ' The 8288 ends the command in T4.' : ' No new bus cycle.');
        if (c && (T === 1 || T === 2) && c.s === v) return `S2 S1 S0 = ${b.join(' ')}: ${TV_WORD[v]}. The 8288 makes the ${TV_STATE_NAME[v]} cycle from this code.`;
        return `S2 S1 S0 = ${b.join(' ')}: ${TV_WORD[v]}. The code comes early: the ${TV_STATE_NAME[v]} cycle starts at the next T1.`;
      }
      case 'mio': return l ? 'M/IO = 1: a memory cycle.' : 'M/IO = 0: an I/O cycle or an interrupt acknowledge.';
      case 'dc': return l ? 'D/C = 1: data (a memory data or I/O cycle).' : 'D/C = 0: a code fetch, an interrupt acknowledge or a halt.';
      case 'wr': return l ? 'W/R = 1: a write cycle (or a halt).' : 'W/R = 0: a read cycle.';
      case 'ads':
        if (l === 0 && c) return `Low in ${Tn}: a ${this.cycText(c)} cycle starts. The address ${this.addrText(c)} and M/IO D/C W/R are valid.`;
        return c ? `High in ${Tn}: the cycle continues. ADS is low only in T1.` : 'High: no new bus cycle starts.';
      case 'na': return 'High: the board does not ask for the next address early, so the 80386 does not pipeline its bus cycles.';
      case 'brdy':
        if (l === 0 && c) return `Low in ${Tn}: the memory ends transfer ${c.beat + 1} of the burst.`;
        return c && c.burst ? `High in ${Tn}: the transfer continues.` : 'High: no burst transfer ends here.';
      case 'rdy':
        if (l === 0 && c) return `Low in ${Tn}: the ${this.cycText(c)} cycle ends.`;
        return c && !c.burst ? `High in ${Tn}: the cycle continues.` : 'High: RDY# ends only the cycles that are not a burst.';
      case 'bs16': return l === 0 ? 'Low: the board has a 16-bit data bus, so the 80486 moves one word in each transfer.' : 'High: no bus cycle.';
      case 'blast':
        if (l === 0 && c) return c.burst ? 'Low: this is the last transfer (8 of 8) of the line fill.' : `Low in ${Tn}: a cycle that is not a burst has only one transfer.`;
        return c && c.burst ? `High: more transfers of the burst come after this one (${c.beat + 1} of 8 now).` : 'High: no transfer ends.';
      case 'ken': return l === 0 ? 'Low: the address is cacheable, so the 80486 fills the whole line (a burst of 16 bytes).' : 'High: no line fill starts here.';
      case 'ferr': return l === 0 ? 'Low: the FPU on the 80486 has an unmasked exception.' : 'High: no FPU error.';
      case 'ble':
        if (l === 0) return 'Low: the cycle uses the low byte D7–D0 (a word or a byte at an even address).';
        return c ? 'High: only the high byte D15–D8 is used (a byte at an odd address).' : 'High: no bus cycle.';
      case 'cod': return l ? 'COD/INTA = 1: a code fetch (with M/IO high) or I/O (with M/IO low).' : 'COD/INTA = 0: memory data (with M/IO high) or an interrupt acknowledge (with M/IO low).';
      case 'qs1': case 'qs0': {
        const q = this.qs[i];
        const w = ['No queue operation in this clock.', 'F: the first byte of an instruction leaves the queue.', 'E: the queue is empty (a jump flushes it).', 'S: the next byte of an instruction leaves the queue.'][q];
        return `QS1 QS0 = ${(q >> 1) & 1} ${q & 1}. ${w}` + (q ? ' The 8087 follows the instructions with this code.' : '');
      }
      case 'bhe':
        if (l === 0) return `Low: the cycle uses the high byte D15–D8 (a word or a byte at an odd address).`;
        if (m286) return c ? 'High: only the low byte D7–D0 is used.' : 'High: no bus cycle.';
        if (c && T === 1) return 'High in T1: only the low byte D7–D0 is used (a byte at an even address).';
        return c ? 'High after T1: the pin carries S7, which has no use on the 8086.' : 'High: no bus cycle.';
      case 'ale':
        if (l === 1) {
          if (c && c.s === 0 && !m286) return `High in ${Tn}: the ${latch} latches open, but INTA puts out no address.`;
          return c ? `High in ${Tn}: the ${latch} latches take the address ${this.addrText(c)}.` : `High: the ${latch} latches take the address.`;
        }
        if (c && c.s === 3 && !m286) return 'Low: a halt cycle has no ALE pulse.';
        return c ? `Low in ${Tn}: the ${latch} latches hold the address for the rest of the cycle.` : `Low: no bus cycle. The ${latch} latches hold the last address.`;
      case 'mrdc': case 'mwtc': case 'amwc': case 'iorc': case 'iowc': case 'aiowc': case 'inta': {
        const nm = id.toUpperCase();
        if (l === 0 && c) {
          const A = this.addrText(c), D = this.dataText(c), dev = this.devName(c);
          if (id === 'mrdc') return `Low in ${Tn}: the ${dev} puts the data of ${A} (${D}) on the bus.`;
          if (id === 'iorc') return `Low in ${Tn}: the ${dev} at ${A} puts its data (${D}) on the bus.`;
          if (id === 'inta') return c.second ? `Low in ${Tn}: the 8259A puts the vector ${hex2(c.data)}h on the bus.` : `Low in ${Tn}: the first INTA cycle. The 8259A gets the vector ready.`;
          if (id === 'mwtc' || id === 'amwc') return `Low in ${Tn}: the ${dev} takes the data ${D} for ${A}.`;
          return `Low in ${Tn}: the ${dev} at ${A} takes the data ${D}.`;
        }
        if (!c) return `High: no bus cycle, so no ${nm} command.`;
        if (TV_CMD[id].includes(c.s)) {
          const range = this.m386 ? 'from T2 to the end of the cycle' : m286 ? 'from Tc to the end of the cycle' : id === 'mwtc' || id === 'iowc' ? 'from T3 to T4' : 'from T2 to T4';
          return `High in ${Tn}: ${nm} is low only ${range}.`;
        }
        return `High: this ${this.cycText(c)} cycle does not use ${nm}.`;
      }
      case 'dtr':
        return l === 0 ? `Low in ${Tn}: receive. The transceivers pass data from the system bus to the ${cpu}.` : `High: transmit, the default direction (from the ${cpu} to the system bus).`;
      case 'den':
        if (l === 1) return `High in ${Tn}: the transceivers connect the ${cpu} to the data bus` + (c && c.s !== 3 ? ` for ${this.cycText(c)} ${this.dataText(c)}.` : '.');
        return 'Low: the transceivers are off. The data bus is free.';
      case 'mce': return l ? `High in ${Tn}: the master 8259A puts the cascade address on the bus.` : 'Low: no cascade address.';
      case 'rq': {
        const q = this.rq[i], w = ['', 'RQ', 'GT', 'RL'][q] || '';
        if (l === 0) return ['Low.', 'RQ: the 8087 asks the 8086 for the bus.', 'GT: the 8086 gives the bus to the 8087.', 'RL: the 8087 gives the bus back to the 8086.'][q] || 'Low.';
        if (q) return `High: the ${w} pulse is over.`;
        return this.fl[i] & TV_F_FPU ? 'High: the 8087 has the bus now.' : 'High: no request. The 8086 has the bus.';
      }
      case 'intr': return l ? `High: the ${m286 ? 'master ' : ''}8259A asks for an interrupt.` : 'Low: no interrupt request.';
      case 'nmi': return l ? 'High: a non-maskable interrupt (INT 2) comes.' : 'Low: no NMI.';
      case 'lock': return l === 0 ? 'Low: no other bus master can take the bus now.' : 'High: the bus is not locked.';
      case 'pereq': return l ? `High: the ${this.fpuName} asks for an operand transfer.` : `Low: no request from the ${this.fpuName}.`;
      case 'peack': return l === 0 ? 'Low: the 80286 does the operand transfer for the 80287 now.' : 'High: no transfer for the 80287 now.';
      case 'busy': return l === 0 ? `Low: the ${this.fpuName} executes an instruction.` : `High: the ${this.fpuName} is not busy.`;
      case 'error': return l === 0 ? `Low: the ${this.fpuName} has an unmasked exception.` : `High: no ${this.fpuName} error.`;
      case 'hold': return l ? 'High: another bus master asks for the bus.' : 'Low: no other bus master asks for the bus.';
      case 'hlda': return l ? `High: the ${this.cpuName()} gives the bus to another bus master.` : `Low: the ${this.cpuName()} keeps the bus.`;
    }
    return `Level ${l}.`;
  }

  // ---------- detail card ----------
  openCard(id, toggle) {
    const r = this.flat.find(x => x.id === id);
    if (!r) return;
    if (toggle && this.sel === id) { this.closeCard(false); return; }
    this.sel = id;
    this.cardKey = '';
    this.card.hidden = false;
    for (const k in this.nameBtn) this.nameBtn[k].tabIndex = k === id ? 0 : -1;
    this.syncSel();
    this.renderCard();
    this.placeCard();
    if (typeof Sfx !== 'undefined') Sfx.select();
    const f = this.info[id];
    if (f && f.chip && this.app.select) this.app.select('chip', f.chip);
    this.sr.textContent = `${r.lab.text}, ${f ? f.n : ''}: the details are open. Press Escape to close them.`;
  }
  closeCard(focus) {
    const id = this.sel;
    const doc = this.host.ownerDocument;
    const inCard = this.card.contains(doc.activeElement);
    this.sel = null;
    this.card.hidden = true;
    this.syncSel();
    if (focus && inCard && id) this.focusName(id);
  }
  syncSel() {
    for (const k in this.nameBtn) {
      const on = k === this.sel;
      this.nameBtn[k].classList.toggle('tv-sel', on);
      this.nameBtn[k].setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    const L = this.lay, R = L && this.sel ? L.rows[this.sel] : null;
    this.rowHl.classList.toggle('tv-on', !!R);
    if (R) Object.assign(this.rowHl.style, { top: R.y + 'px', height: R.h + 'px' });
    if (this.sel) { this.cardKey = ''; this.placeCard(); }
  }
  // Put the card over the plot, below the selected row (or above it when there is more room).
  placeCard() {
    const L = this.lay, R = L && this.sel ? L.rows[this.sel] : null;
    if (!R || this.card.hidden) return;
    const w = L.w, h = this.host.clientHeight, sc = this.scrollEl;
    const top0 = sc.offsetTop + 2, bot0 = Math.max(top0 + 100, h - this.traceCover() - 6);
    const rowTop = sc.offsetTop + R.y - sc.scrollTop, rowBot = rowTop + R.h;
    let x0 = L.plotX + 10, x1 = L.plotX + L.plotW - 4;
    if (x1 - x0 < 270) { x0 = 8; x1 = w - 8; }
    const st = this.card.style;
    st.left = x0 + 'px';
    st.width = Math.min(400, x1 - x0) + 'px';
    const below = bot0 - rowBot - 6, above = rowTop - 6 - top0;
    if (below < 220 && above < 220 && L.plotW >= 400) {
      // little room above and below: use the full height at the right end of the plot,
      // so the left part of the selected row stays in view
      const cw = Math.min(400, Math.max(260, L.plotW - 140));
      st.left = (L.plotX + L.plotW - cw - 4) + 'px';
      st.width = cw + 'px';
      st.top = top0 + 'px'; st.bottom = '';
      st.maxHeight = (bot0 - top0) + 'px';
    } else if (below >= 220 || below >= above) {
      const y = clamp(rowBot + 6, top0, bot0 - 90);
      st.top = y + 'px'; st.bottom = '';
      st.maxHeight = (bot0 - y) + 'px';
    } else {
      const y = clamp(rowTop - 6, top0 + 90, bot0);
      st.top = ''; st.bottom = (h - y) + 'px';
      st.maxHeight = (y - top0) + 'px';
    }
  }
  renderCard() {
    const id = this.sel;
    if (!id || !this.lay) return;
    const r = this.flat.find(x => x.id === id);
    if (!r) { this.closeCard(false); return; }
    const L = this.lay, span = L.plotW / this.px, left = this.shownRight - span;
    const a = Math.max(this.firstLive(), Math.floor(left)), b = Math.min(this.head, Math.ceil(this.reveal), Math.ceil(left + span));
    const pinned = this.pin !== null && this.validPos(this.pin);
    const cur = pinned ? this.pin : this.lastRevealed();
    const key = [id, this.version, a, b, cur, pinned].join();
    if (key === this.cardKey) return;
    this.cardKey = key;
    const f = this.info[id] || {}, esc = TimingView.esc, col = this.rowColor(r);
    this.card.style.setProperty('--tv-ac', col);
    this.card.setAttribute('aria-label', `Details of the signal ${r.lab.text}`);
    const sig = TimingView.labHtml(r.lab);
    if (this.cardSig.innerHTML !== sig) this.cardSig.innerHTML = sig;
    this.cardName.textContent = f.n || '';
    let s = `<p>${esc(f.job || '')}</p><dl><dt>Driver</dt><dd>${esc(f.drv || '—')}</dd><dt>Receivers</dt><dd>${esc(f.rcv || '—')}</dd>` +
      `<dt>Active</dt><dd>${esc(f.lvl || '—')}</dd></dl>`;
    if (cur !== null) {
      const i = cur & TV_MASK, w = this.meaning(r, cur, this.sampleF(r));
      s += `<h4>${pinned ? 'At the cursor' : 'Latest clock'} <span>· ${this.tnameAt(cur)} · #${this.abs[i].toLocaleString('en-US')}</span></h4>` +
        `<p class="tv-card-now"><b style="color:${col}">${esc(w.v || '–')}</b> ${esc(w.t).replace(/\n/g, '<br>')}</p>`;
    }
    const all = b > a ? this.cardEntries(r, a, b) : [];
    const kind = r.id === 'clk' ? 'bus cycle' : r.kind === 'bus' ? 'value' : r.act !== undefined ? 'pulse' : 'change';
    s += `<h4>On screen <span>· ${all.length} ${kind}${all.length === 1 ? '' : 's'}</span></h4>`;
    const MAX = 40, list = all.slice(-MAX);
    if (!list.length) s += '<ol><li class="tv-more">No activity in the clocks on screen.</li></ol>';
    else {
      s += '<ol>';
      if (all.length > list.length) s += `<li class="tv-more">+ ${all.length - list.length} before these</li>`;
      for (const e of list) {
        const at = cur !== null && cur >= e.pos && cur <= e.p1;
        const lbl = `${e.t}, clock ${this.abs[e.pos & TV_MASK]}: ${e.v}, ${e.m}. Put the cursor here.`;
        s += `<li${at ? ' class="tv-at"' : ''}><button type="button" data-pos="${e.pos}" aria-label="${esc(lbl)}"><span class="tv-ct">${esc(e.t)}</span><b style="color:${col}">${esc(e.v)}</b><span>${esc(e.m)}</span></button></li>`;
      }
      s += '</ol>';
    }
    // keep the keyboard focus on the same list item after the update
    const doc = this.host.ownerDocument, fe = doc.activeElement;
    const fpos = fe && this.cardBody.contains(fe) && fe.dataset ? fe.dataset.pos : null;
    this.cardBody.innerHTML = s;
    if (fpos !== null && fpos !== undefined) {
      const nb = this.cardBody.querySelector(`button[data-pos="${fpos}"]`);
      if (nb) nb.focus();
    }
  }

  // The values, pulses or changes of row r in the clocks a..b: [{ pos, p1, t, v, m }].
  cardEntries(r, a, b) {
    const out = [], M = TV_MASK;
    const range = (t0, t1) => {
      const p0 = Math.floor(t0 + 1e-6), p1 = Math.max(p0, Math.ceil(t1 - 1e-6) - 1);
      const n0 = this.tnameAt(p0) || '–', n1 = this.tnameAt(p1) || '–';
      return { p0, p1, t: p0 === p1 ? n0 : `${n0}–${n1}` };
    };
    const valid = p => p >= this.firstLive() && p < this.head;
    if ((this.m586 && (r.id === 'pipe' || r.id === 'btb')) || (this.m686 && r.id === 'retire')) {
      for (const n of this.xnotes[r.id]) {
        if (n.end <= a || n.pos >= b) continue;
        const x = range(n.pos, n.end), e = n.e;
        const m = r.id === 'retire' ? `${e.kinds} · ${e.text}`
          : this.m686 && r.id === 'btb' ? `${hex(e.lin >>> 0, 8)} · ${e.how} · ${e.taken ? 'taken' : 'not taken'}${e.history >= 0 ? ' · history ' + bin(e.history & 15, 4) : ''}`
          : r.id === 'pipe' ? (e.pipe === 'V' || e.paired ? `with ${e.partner || '?'}` : e.reason || 'no pair')
          : `${hex(e.lin >>> 0, 8)} · ${e.taken ? 'taken' : 'not taken'} · counter ${e.counter >= 0 ? e.counter : '–'}`;
        out.push({ pos: clamp(x.p0, a, b - 1), p1: x.p1, t: x.t, v: n.text, m });
      }
      return out;
    }
    if (r.id === 'cache') {
      for (const n of this.notes) {
        if (n.end <= a || n.pos >= b) continue;
        const x = range(n.pos, n.end);
        out.push({ pos: clamp(x.p0, a, b - 1), p1: x.p1, t: x.t, v: n.text, m: `${n.e.code ? 'code' : 'data'} ${hex(n.e.phys, 8)} · set ${hex2(n.e.set)}${n.e.way >= 0 ? ' way ' + n.e.way : ''}` });
      }
      return out;
    }
    if (r.kind === 'bus' || r.id === 'clk') {
      const seen = new Set();
      for (let p = a; p < b; p++) {
        const c = this.cyc[p & M];
        if (!c || seen.has(c) || this.ts[p & M] === TV_GAP) continue;
        seen.add(c);
        if (r.id === 'clk') { const x = range(c.pos, c.pos + c.len); out.push({ pos: Math.max(c.pos, a), p1: x.p1, t: x.t, v: TV_STATE_NAME[c.s], m: this.cycLine(c) }); continue; }
        const runs = [];
        this.cycleRuns(r.id, c, runs);
        for (const run of runs) {
          const x = range(run[0], run[1]);
          out.push({ pos: clamp(x.p0, a, b - 1), p1: x.p1, t: x.t, v: run[2], m: this.runWord(r.id, c, run) });
        }
      }
      return out;
    }
    if (r.act !== undefined) {
      const EARLY = { s2: 1, s1: 1, s0: 1, bhe: 1 };
      const LONG = { intr: 1, nmi: 1, lock: 1, busy: 1, error: 1, pereq: 1, hold: 1, hlda: 1, ferr: 1 };
      const push = (t0, t1) => {
        const x = range(t0, t1);
        const q = Math.floor(t0 + 1e-6);
        let c = valid(q) ? this.cyc[q & M] : null;
        const n = valid(q + 1) ? this.cyc[(q + 1) & M] : null;
        if (EARLY[r.id] && t0 - q > 0.3 && n && n.pos === q + 1) c = n;
        let m = c && !LONG[r.id] ? this.cycLine(c) : `${Math.max(1, Math.round(t1 - t0))} clock${Math.round(t1 - t0) > 1 ? 's' : ''}`;
        if (r.id === 'rq') m = ['', 'RQ: the 8087 asks for the bus', 'GT: the 8086 gives the bus', 'RL: the 8087 gives it back'][this.rq[x.p0 & M]] || m;
        if (r.id === 'qs1' || r.id === 'qs0') m = ['', 'F: first byte', 'E: queue empty', 'S: next byte'][this.qs[x.p0 & M]] || m;
        if ((r.id === 'ready' || r.id === 'rdy' || r.id === 'brdy') && this.m286) m = c ? `end of ${this.cycText(c)}` : m;
        out.push({ pos: clamp(x.p0, a, b - 1), p1: x.p1, t: x.t, v: String(r.act), m });
      };
      let on = null;
      for (let p = a; p < b; p++) {
        const lv = this.levels(r.id, p);
        if (!lv) { if (on !== null) { push(on, p); on = null; } continue; }
        for (let k = 0; k < lv.length; k += 2) {
          const act = lv[k + 1] === r.act;
          if (act && on === null) on = p + lv[k];
          else if (!act && on !== null) { push(on, p + lv[k]); on = null; }
        }
      }
      if (on !== null) push(on, b);
      return out;
    }
    // level signals without an active level (M/IO, COD/INTA): list the changes
    let prev = null;
    for (let p = a; p < b; p++) {
      const lv = this.levels(r.id, p);
      if (!lv) { prev = null; continue; }
      for (let k = 0; k < lv.length; k += 2) {
        const l = lv[k + 1];
        if (prev !== null && l !== prev) {
          const m = r.id === 'mio' ? (l ? 'memory' : 'I/O or INTA') : r.id === 'dc' ? (l ? 'data' : 'code, INTA or halt') : r.id === 'wr' ? (l ? 'write' : 'read') : (l ? 'code or I/O' : 'data or INTA');
          out.push({ pos: p, p1: p, t: this.tnameAt(p), v: String(l), m });
        }
        prev = l;
      }
    }
    return out;
  }
  runWord(id, c, run) {
    if (id === 'state') return this.cycLine(c);
    const addr = id === 'a' || ((id === 'ad' || id === 'ah') && run[0] < c.pos + 1);
    if (id === 'ah') return addr ? `A19–A16 of ${this.addrText(c)}` : (c.seg ? `status: segment ${c.seg}` : 'status');
    if (addr) return `address, ${this.cycText(c)}` + (c.pipe && run[0] < c.pos ? ' (early)' : '');
    if (id === 'be') return `bytes of ${this.addrText(c)}`;
    if (c.s === 0) return 'vector from the 8259A';
    return c.s === 2 || c.s === 6 ? `data to the ${this.devName(c)}` : `data from the ${this.devName(c)}`;
  }

  static fmtRate(v) {
    v = v || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M/s';
    if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'k/s';
    return Math.round(v) + '/s';
  }
  static fmtCount(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e4) return Math.round(v / 1e3) + 'k';
    return String(v);
  }
  static esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
}
