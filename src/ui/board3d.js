// Board view: a 3D model of the computer board, drawn with three.js.
// Light on the copper traces shows what each bus cycle of the program does.
// Only the names BoardView and RunnerView go into the shared script scope.

const { BoardView, RunnerView, BoardKit } = (() => {
  const T = THREE;
  const PPU = 80;                  // PCB texture pixels per board unit (1 unit = 1 cm)
  const BW = 34, BD = 22;          // board size in units
  const PITCH = 0.254;             // DIP pin pitch (0.1 inch)
  const FLOOR_Y = -0.9;
  const TAU = Math.PI * 2;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // ---------------------------------------------------------------------------
  // The machine model of this page. The page reloads to switch, so the whole layout is
  // chosen once here: the 8086 PC board, or the AT-class 80286 board.
  // M286: the AT-class board (the 80286 or the 80386 model); M386: the 80386 model.
  // M486: the 80486 model; it uses the 386 parts of the code (M386) with its own chips
  const M486 = typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80486';
  // M586: the Pentium; it also uses the 386 parts (M386). FPU_ON: the FPU is on the CPU chip.
  const M586 = typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80586';
  // M686: the Pentium Pro (out of order); it also uses the 386 parts (M386)
  const M686 = typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80686';
  const FPU_ON = M486 || M586 || M686;
  const QSIZE = FPU_ON ? 32 : (typeof CPU_MODEL !== 'undefined' && CPU_MODEL === '80386') ? 16 : 6;   // the prefetch queue bytes
  const M386 = typeof CPU_MODEL !== 'undefined' && (CPU_MODEL === '80386' || M486 || M586 || M686);
  const M286 = typeof CPU_MODEL !== 'undefined' && (CPU_MODEL === '80286' || M386);
  const mixc = (a, b, t) => '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString();
  const ADDR_MASK = M286 ? 0xFFFFFF : 0xFFFFF, ADDR_BITS = M286 ? 24 : 20;
  const hexA = v => hex(v & ADDR_MASK, M286 ? 6 : 5);
  const NM = M686
    ? { cpu: 'Pentium Pro', fpu: 'FPU of the Pentium Pro', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A3–A35, BE0–BE7', status: 'REQ0–REQ4', board: 'ANATOMY-P6' }
    : M586
    ? { cpu: 'Pentium', fpu: 'FPU of the Pentium', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A3–A31, BE0–BE7', status: 'W/R D/C M/IO', board: 'ANATOMY-P5' }
    : M486
    ? { cpu: '80486', fpu: 'FPU of the 80486', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A2–A31, BE0–BE3', status: 'W/R D/C M/IO', board: 'ANATOMY-486' }
    : M386
    ? { cpu: '80386', fpu: '80387', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A1–A23, BHE, BLE', status: 'W/R D/C M/IO', board: 'ANATOMY-386' }
    : M286
    ? { cpu: '80286', fpu: '80287', lat: '74LS573', xcv: '74LS245', bus: '82288', abus: 'A0–A23', status: 'S1 S0 M/IO', board: 'ANATOMY-286' }
    : { cpu: '8086', fpu: '8087', lat: '8282', xcv: '8286', bus: '8288', abus: 'AD0–AD19', status: 'S2–S0', board: 'ANATOMY-86' };
  // Colours of the scene. The 8086 board keeps its own values; the 80286 board takes all of
  // them from THEME (green solder mask, tin pads, slate-teal room).
  const PAL = M286 ? {
    fog: mixc(THEME.void, '#000000', 0.3), room: mixc(THEME.void, '#000000', 0.45),
    bg0: mixc(THEME.ceramic, THEME.void, 0.5), bg1: mixc(THEME.void, THEME.panel, 0.5), bg2: mixc(THEME.void, '#000000', 0.6),
    hemi: mixc(THEME.ceramicHi, '#ffffff', 0.15), key: '#f1fbff', fill: THEME.cyan, rim: THEME.lavender,
    plastic: mixc('#121314', THEME.void, 0.35), eprom: mixc('#34393c', THEME.ceramic, 0.3),
    tin: '#cfd5d5', steel: mixc('#aab1b4', THEME.lavender, 0.1), black: mixc('#0c0e0f', THEME.void, 0.3),
    case: mixc(THEME.panel2, '#9fb6bb', 0.14), caseDark: mixc(THEME.void, '#000000', 0.1),
    mask0: mixc(THEME.mask, '#3fae8c', 0.1), mask1: mixc(THEME.mask, '#000000', 0.28), hatch: THEME.phosphor,
    hole: mixc(THEME.void, '#000000', 0.5), copper: mixc(THEME.mask, '#3f9f78', 0.24), copperHi: mixc(THEME.mask, '#7fd8aa', 0.22),
    via: mixc(THEME.mask, '#000000', 0.4), pad: '#c6cbc5', padHole: mixc(THEME.mask, '#000000', 0.5), finger: '#d6a647',
    inkCer: '#e9eee8', inkPl: '#d0dadb', dimple: mixc(THEME.ceramic, '#000000', 0.5), dimplePl: '#040506',
    capSleeve: mixc(THEME.lavender, THEME.void, 0.62), capStripe: mixc(THEME.lavender, '#ffffff', 0.25),
    slot: '#18191a', slit: '#030303', basket: mixc(THEME.panel2, '#000000', 0.2), cone: mixc(THEME.void, '#111111', 0.3),
    coneSheen: THEME.ceramicHi, spkCap: THEME.panel2, grille: '#a3abad', edge: mixc(THEME.mask, '#b8aa78', 0.35),
    cardTop: mixc(THEME.mask, '#ffffff', 0.05), cable: '#121516', cage: mixc(THEME.panel2, '#667777', 0.3),
    drive0: mixc(THEME.panel2, '#99aaaa', 0.12), drive1: THEME.panel, driveInk: '#d6e2e4', driveOff: THEME.faint, driveInk2: THEME.muted,
    badge: '#d4dcdc', floor: THEME.panel, pinTin: '#d2d7d7', header: '#d2d0c4',
    miniBg: mixc(THEME.mask, '#000000', 0.2), miniLine: 'rgba(98,227,255,0.3)', miniChip: THEME.line, miniRam: THEME.line,
  } : {
    fog: '#0d0813', room: '#0c0812', bg0: '#2b1c3f', bg1: '#170f22', bg2: '#07040b',
    hemi: '#6e5a92', key: '#f7efff', fill: '#8fdcff', rim: THEME.lavender,
    plastic: '#141019', eprom: '#332d3f', tin: '#cdc8d6', steel: '#aaa4b8', black: '#0f0b14',
    case: '#2a2135', caseDark: '#16111d', mask0: '#221338', mask1: '#150b22', hatch: THEME.lavender,
    hole: '#07050a', copper: '#6a3a31', copperHi: '#96573b', via: '#1a0f0c', pad: THEME.gold, padHole: '#2a1a12', finger: THEME.gold,
    inkCer: '#eadcc4', inkPl: '#d8cfe2', dimple: '#1a0f24', dimplePl: '#050307',
    capSleeve: '#2d2140', capStripe: '#8f7fb0', slot: '#141019', slit: '#030205', basket: '#241c2d', cone: '#1b1522',
    coneSheen: '#5a4870', spkCap: '#2a2233', grille: '#a9a2b8', edge: '#2e2140', cardTop: '#241836', cable: '#15101b',
    cage: '#2f2939', drive0: '#2c2438', drive1: '#1a1522', driveInk: '#d8cfe2', driveOff: '#6d6280', driveInk2: '#8f83a3',
    badge: '#cfc4dc', floor: '#1a1224', pinTin: '#cfc9d8', header: '#d9d0c1',
    miniBg: '#1d1229', miniLine: 'rgba(180,140,255,0.35)', miniChip: '#4a3a5e', miniRam: '#3d3150',
  };


  // ---------------------------------------------------------------------------
  // Layout. x runs left to right, z runs from the back edge (-) to the front edge (+).
  // rot: the long axis of the package is along z. wide: 600 mil rows, else 300 mil.
  const CHIPS_86 = [
    { id: 'cpu', ref: 'U3', part: '8086', x: -9.5, z: -2.0, pins: 40, wide: 1, kind: 'ceramic', mark: ['8086', 'A86-2', '8341'], silk: 'below' },
    { id: 'fpu', ref: 'U4', part: '8087', x: -9.5, z: 1.8, pins: 40, wide: 1, kind: 'ceramic', mark: ['8087', 'A87-2', '8340'], ink: 'lav', silk: 'below' },
    { id: 'clk', ref: 'U1', part: '8284A', x: -14.3, z: -1.8, rot: 1, pins: 18, mark: ['8284A', 'A86 8336'] },
    { id: 'nmi', ref: 'U2', part: '74LS74', x: -7.0, z: -4.1, pins: 14, mark: ['74LS74', 'NMI'], silk: 'right' },
    { id: 'bus', ref: 'U5', part: '8288', x: -9.5, z: -5.6, pins: 20, mark: ['8288', 'A86 8338'], silk: 'none' },
    { id: 'lat0', ref: 'U7', part: '8282', x: -3.6, z: -2.0, rot: 1, pins: 20, mark: ['8282', 'A0-A7'] },
    { id: 'lat1', ref: 'U8', part: '8282', x: -2.4, z: -2.0, rot: 1, pins: 20, mark: ['8282', 'A8-A15'] },
    { id: 'lat2', ref: 'U9', part: '8282', x: -1.2, z: -2.0, rot: 1, pins: 20, mark: ['8282', 'A16-A19'] },
    { id: 'xcv0', ref: 'U10', part: '8286', x: -3.0, z: 1.7, rot: 1, pins: 20, mark: ['8286', 'D0-D7'], silk: 'none' },
    { id: 'xcv1', ref: 'U11', part: '8286', x: -1.8, z: 1.7, rot: 1, pins: 20, mark: ['8286', 'D8-D15'], silk: 'none' },
    { id: 'dec', ref: 'U6', part: '74LS138', x: 4.0, z: -3.4, pins: 16, mark: ['74LS138', 'DECODE'], silk: 'right' },
    { id: 'pic', ref: 'U12', part: '8259A', x: 4.0, z: -7.8, pins: 28, wide: 1, mark: ['8259A', 'A86 8342'] },
    { id: 'pit', ref: 'U13', part: '8253', x: 9.0, z: -7.8, pins: 24, wide: 1, mark: ['8253-5', 'A86 8339'] },
    { id: 'ppi', ref: 'U14', part: '8255', x: 13.8, z: -7.8, pins: 40, wide: 1, mark: ['8255A-5', 'A86 8335'] },
    { id: 'dma', ref: 'U15', part: '8237', x: 13.5, z: -3.4, pins: 40, wide: 1, mark: ['8237A-5', 'A86 8337'], silk: 'below' },
    { id: 'romE', ref: 'U16', part: '2764 EVEN', x: 5.5, z: 5.6, pins: 28, wide: 1, kind: 'eprom', mark: ['2764', 'EVEN'] },
    { id: 'romO', ref: 'U17', part: '2764 ODD', x: 5.5, z: 9.0, pins: 28, wide: 1, kind: 'eprom', mark: ['2764', 'ODD'] },
  ];
  const RAM_X = i => -13 + i * 1.45;
  const BANKS_86 = [{ id: 'ramE', z: 5.6, silk: 'RAM BANK EVEN' }, { id: 'ramO', z: 9.0, silk: 'RAM BANK ODD' }];
  // Chips on the video card. Card local x runs along the card, z runs down to the gold fingers.
  const CARD_CHIPS = [
    { id: 'crtc', ref: 'U1', part: '6845', x: 1.7, z: -0.5, pins: 40, wide: 1, mark: ['6845', 'CRTC'] },
    { id: 'vram0', ref: 'U2', part: '4416', x: -2.6, z: -1.05, pins: 18, mark: ['4416', 'VRAM'] },
    { id: 'vram1', ref: 'U3', part: '4416', x: -2.6, z: 0.35, pins: 18, mark: ['4416', 'VRAM'] },
    { id: 'cgal', ref: 'U4', part: '74LS245', x: 4.2, z: 0.75, pins: 20, mark: ['74LS245', ''], glowAs: 'crtc' },
    { id: 'cgrom', ref: 'U5', part: '2364', x: -3.5, z: 1.1, pins: 24, mark: ['68A316', 'CHAR ROM'] },
  ];
  const CARD = { x: -8.75, z: -9.2, len: 11, h: 4.4 };
  // The graphics card of this page: the CGA card, or a VGA card in the same slot.
  const VGA = (typeof VIDEO_CARD !== 'undefined' ? VIDEO_CARD : storage.get('video', 'cga')) === 'vga';
  const VCARD = { x: -7.4, z: -9.2, len: 14, h: 4.4, fo: -1.35, ext: M286 ? 5.15 : undefined };
  const VGA_CHIPS = [
    { id: 'vgac', ref: 'U1', part: 'VGAC', x: 1.2, z: -0.25, pins: 160, kind: 'qfp', mark: ['VGA CTRL', 'A86V 9014'], glowAs: 'vga' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: 'vdram' + i, ref: 'U' + (i + 3), part: '4464', x: -6.2 + i * 0.78, z: 0.15, rot: 1, pins: 18,
      mark: ['4464-10', 'PLANE ' + (i >> 1)], glowAs: 'vmem', silk: 'none' })),
    { id: 'dac', ref: 'U2', part: 'RAMDAC', x: 3.6, z: -0.3, rot: 1, pins: 28, wide: 1, mark: ['RAMDAC', '256X18'] },
    { id: 'vbios', ref: 'U11', part: '27256', x: 5.4, z: -0.3, rot: 1, pins: 28, wide: 1, kind: 'eprom', mark: ['27256', 'VGA BIOS'] },
  ];
  const VID = VGA ? VCARD : CARD;
  // The floppy disk controller card (NEC uPD765A) stands in the slot behind the video card.
  const DCARD = { x: -8.75, z: -10.3, len: 11, h: 4.4 };
  const DISK_CHIPS = [
    { id: 'fdc', ref: 'U1', part: 'FDC', x: 0.4, z: -0.25, pins: 40, wide: 1, mark: ['uPD765AC', 'NEC 8412'] },
    { id: 'fdcs', ref: 'U2', part: '74LS245', x: -3.4, z: -0.6, pins: 20, mark: ['74LS245', ''], glowAs: 'fdc' },
    { id: 'fdcd', ref: 'U3', part: 'DATA SEP', x: -3.4, z: 0.7, pins: 16, mark: ['9216', 'DATA SEP'], glowAs: 'fdc' },
  ];
  // The Sound Blaster 2.0 card (CT1350B): the CT1336 bus interface, the CT1351 DSP (an
  // 8051 microcontroller with its program in ROM), the Yamaha YM3812 (OPL2) FM chip and its
  // YM3014B DAC, an amplifier, and the joystick / MIDI port on the bracket.
  const SBCARD = { x: -8.75, z: M286 ? -7.0 : -8.1, len: 11, h: 4.4 };
  const SB_CHIPS = [
    { id: 'sbdsp', ref: 'U2', part: 'CT1351', x: 0.9, z: -0.3, pins: 40, wide: 1, mark: ['CT1351V', 'DSP 2.01'] },
    { id: 'opl', ref: 'U5', part: 'YM3812', x: -3.4, z: -0.6, pins: 24, wide: 1, mark: ['YM3812', 'OPL2'] },
    { id: 'sbdac', ref: 'U6', part: 'YM3014B', x: -3.9, z: 1.0, pins: 8, mark: ['YM3014B', 'DAC'], glowAs: 'opl' },
    { id: 'sbbus', ref: 'U1', part: 'CT1336', x: 4.3, z: 0.5, pins: 44, kind: 'plcc', mark: ['CT1336A', 'SB BUS'], glowAs: 'sbdsp' },
    { id: 'sbamp', ref: 'U9', part: 'TDA1013', x: -1.2, z: 1.1, pins: 16, mark: ['TDA1013B', 'AMP'], glowAs: 'sbdsp' },
  ];
  // The IDE hard disk card (a 16-bit paddle card: the controller is on the drive) in the next
  // slot: an address decoder (GAL) for 1F0h-1F7h and 3F6h, two 74LS245 for the 16 data lines,
  // a 74LS244 for the control lines, and the 40-pin header of the drive cable.
  const HDCARD = { x: -8.75, z: SBCARD.z + 1.1, len: 11, h: 4.4 };
  const HD_CHIPS = [
    { id: 'hdc', ref: 'U1', part: 'GAL16V8', x: 1.2, z: -0.3, pins: 20, mark: ['GAL16V8', 'IDE 1F0H'] },
    { id: 'hdcb0', ref: 'U2', part: '74LS245', x: -1.8, z: -0.6, pins: 20, mark: ['74LS245', 'D0-D7'], glowAs: 'hdc' },
    { id: 'hdcb1', ref: 'U3', part: '74LS245', x: -1.8, z: 0.8, pins: 20, mark: ['74LS245', 'D8-D15'], glowAs: 'hdc' },
    { id: 'hdcs', ref: 'U4', part: '74LS244', x: 1.2, z: 1.0, pins: 20, mark: ['74LS244', 'CONTROL'], glowAs: 'hdc' },
  ];
  const BAY = { x: -21.8, z: -15.6, w: 7.6, dh: 1.45, d: 9.0, rot: 0.42 };
  const BAY_ROT = BAY.rot;
  const MONITOR = { x: -1.5, z: -18.6, w: 13, h: 10.2 };
  const SPEAKER = { x: 13.4, z: 6.8, r: 2.35 };
  // The AT-class 80286 board. Its own layout; the same chip ids where the role is the same.
  const CHIPS_286 = [
    { id: 'cpu', ref: 'U3', part: '80286', x: -9.5, z: -2.8, pins: 68, kind: 'plcc', mark: ['80286-8', 'A286 8621'] },
    { id: 'fpu', ref: 'U4', part: '80287', x: -9.5, z: 1.8, pins: 40, wide: 1, kind: 'ceramic', mark: ['80287-8', 'A287-8', '8617'], ink: 'lav', silk: 'below' },
    { id: 'clk', ref: 'U1', part: '82284', x: -14.3, z: -2.8, rot: 1, pins: 18, mark: ['82284-8', 'A286 8544'] },
    { id: 'bus', ref: 'U5', part: '82288', x: -9.5, z: -5.9, pins: 20, mark: ['82288-8', 'A286 8547'], silk: 'none' },
    { id: 'lat0', ref: 'U7', part: '74LS573', x: -5.2, z: -2.8, rot: 1, pins: 20, mark: ['74LS573', 'A0-A7'] },
    { id: 'lat1', ref: 'U8', part: '74LS573', x: -4.0, z: -2.8, rot: 1, pins: 20, mark: ['74LS573', 'A8-A15'] },
    { id: 'lat2', ref: 'U9', part: '74LS573', x: -2.8, z: -2.8, rot: 1, pins: 20, mark: ['74LS573', 'A16-A23'] },
    { id: 'xcv0', ref: 'U10', part: '74LS245', x: -4.8, z: 1.3, rot: 1, pins: 20, mark: ['74LS245', 'D0-D7'], silk: 'none' },
    { id: 'xcv1', ref: 'U11', part: '74LS245', x: -3.6, z: 1.3, rot: 1, pins: 20, mark: ['74LS245', 'D8-D15'], silk: 'none' },
    { id: 'dec', ref: 'U6', part: '74LS138', x: 2.6, z: -3.9, pins: 16, mark: ['74LS138', 'DECODE'], silk: 'none' },
    { id: 'pal', ref: 'U17', part: 'PAL16L8', x: -2.1, z: -5.6, pins: 20, mark: ['PAL16L8', 'MEM DEC'], glowAs: 'dec', silk: 'none' },
    { id: 'pic', ref: 'U12', part: '8259A', x: 3.6, z: -7.8, pins: 28, wide: 1, mark: ['8259A', 'MASTER'] },
    { id: 'pic2', ref: 'U13', part: '8259A', x: 7.8, z: -7.8, pins: 28, wide: 1, mark: ['8259A', 'SLAVE'] },
    { id: 'pit', ref: 'U14', part: '8254', x: 11.9, z: -7.8, pins: 24, wide: 1, mark: ['8254-2', 'A286 8540'] },
    { id: 'ppi', ref: 'U22', part: '74LS175', x: 14.9, z: -7.8, rot: 1, pins: 16, mark: ['74LS175', 'PORT 61H'], silk: 'none' },
    { id: 'kbc', ref: 'U15', part: '8042', x: 8.6, z: -3.9, pins: 40, wide: 1, mark: ['8042', 'KBC  A20'] },
    { id: 'rtc', ref: 'U16', part: 'MC146818', x: 13.6, z: -3.9, pins: 24, wide: 1, mark: ['MC146818', 'RTC CMOS'] },
    { id: 'dma', ref: 'U19', part: '8237', x: 5.3, z: -0.9, pins: 40, wide: 1, mark: ['8237A-5', 'DMA 1'], silk: 'below' },
    { id: 'dma2', ref: 'U20', part: '8237', x: 11.2, z: -0.9, pins: 40, wide: 1, mark: ['8237A-5', 'DMA 2'], silk: 'below' },
    { id: 'xdb', ref: 'U21', part: '74LS245', x: 14.3, z: -0.9, rot: 1, pins: 20, mark: ['74LS245', 'XD BUS'], silk: 'none' },
    { id: 'romE', ref: 'U27', part: '27128 EVEN', x: 5.5, z: 5.6, pins: 28, wide: 1, kind: 'eprom', mark: ['27128', 'EVEN'] },
    { id: 'romO', ref: 'U28', part: '27128 ODD', x: 5.5, z: 9.0, pins: 28, wide: 1, kind: 'eprom', mark: ['27128', 'ODD'] },
  ];
  const BANKS_286 = [{ id: 'ramE', z: 5.6, silk: 'RAM EVEN 41256' }, { id: 'ramO', z: 9.0, silk: 'RAM ODD 41256' }];
  // The 16-bit memory card in the AT slot: 8-bit fingers under the standard connector,
  // and a second finger group in the 16-bit extension connector.
  const XCARD = { x: -7.4, z: -8.1, len: 14, h: 4.4, fo: -1.35, ext: 5.15 };
  const XCARD_CHIPS = Array.from({ length: 10 }, (_, i) => ({
    id: 'xram' + i, ref: 'U' + (i + 1), part: '41256', x: -5.9 + (i % 5) * 2.4, z: i < 5 ? -0.75 : 0.85, pins: 16,
    mark: ['41256-12', i < 5 ? 'EVEN' : 'ODD'], glowAs: 'xram',
  }));
  XCARD_CHIPS.unshift({ id: 'xctl', ref: 'U11', part: '74LS245', x: 3.9, z: -1.7, pins: 20, mark: ['74LS245', ''], glowAs: 'xram' });
  XCARD_CHIPS.push(XCARD_CHIPS.shift());   // chips[0] (the trace target) is a DRAM chip
  // The 80386 AT board: the 286 layout with a 386 in a pin grid array, the 80387 and the
  // 82384 clock generator.
  const CHIPS_386 = CHIPS_286.map(c => (c.id === 'cpu' ? Object.assign({}, c, { part: '80386', pins: 132, kind: 'pga', mark: ['80386-25', 'A386 8745'] })
    : c.id === 'fpu' ? Object.assign({}, c, { part: '80387', pins: 68, kind: 'plcc', wide: 0, mark: ['80387-25', 'A387 8802'] })
      : c.id === 'clk' ? Object.assign({}, c, { part: '82384', mark: ['82384-25', 'A386 8712'] }) : c));
  // The 80486 board: the 80486DX in a 168-pin grid array; the FPU is on the chip, so there
  // is no coprocessor chip and no coprocessor traces.
  const CHIPS_486 = CHIPS_386.filter(c => c.id !== 'fpu').map(c => (c.id === 'cpu' ? Object.assign({}, c, { part: '80486', pins: 168, mark: ['i486DX-33', 'A486 8952'] })
    : c.id === 'clk' ? Object.assign({}, c, { part: '82384', mark: ['OSC 33.3', 'A486 8940'] }) : c));
  // The Pentium board: the P5 in a 273-pin grid array under its gold lid; no coprocessor chip.
  const CHIPS_586 = CHIPS_486.map(c => (c.id === 'cpu' ? Object.assign({}, c, { part: '80586', pins: 273, mark: ['PENTIUM 66', 'A80501-66'] })
    : c.id === 'clk' ? Object.assign({}, c, { mark: ['OSC 66.6', 'A586 9312'] }) : c));
  // The Pentium Pro board: the P6 in its 387-pin package (the CPU die and the L2 die side by side).
  const CHIPS_686 = CHIPS_586.map(c => (c.id === 'cpu' ? Object.assign({}, c, { part: '80686', pins: 387, mark: ['PENTIUM PRO 200', '256K L2 · A80686'] })
    : c.id === 'clk' ? Object.assign({}, c, { mark: ['OSC 66.6', 'A686 9545'] }) : c));
  const CHIPS = M686 ? CHIPS_686 : M586 ? CHIPS_586 : M486 ? CHIPS_486 : M386 ? CHIPS_386 : M286 ? CHIPS_286 : CHIPS_86;
  const BANKS = M286 ? BANKS_286 : BANKS_86;
  const BANK_SPEC = M286 ? { pins: 16, part: '41256', mark: ['41256-12', 'A286 8604'] } : { pins: 16, part: '4164', mark: ['4164-15', 'A86 8337'] };
  const DEV_XZ = {};
  for (const c of CHIPS) DEV_XZ[c.id] = [c.x, c.z];


  // What each part is (tooltip text).
  const INFO_86 = {
    cpu: ['8086', 'CPU', 'The 16-bit CPU. Its bus unit fetches code into a 6-byte queue and drives the multiplexed AD0–AD15 / A16–A19 local bus. In maximum mode it signals each bus cycle on S0–S2.'],
    fpu: ['8087', 'coprocessor', 'The numeric coprocessor. It watches the CPU queue through QS0/QS1, runs the ESC instructions on a stack of eight 80-bit registers and takes the bus through RQ/GT0.'],
    clk: ['8284A', 'clock generator', 'Divides the 14.31818 MHz crystal by 3 to make the 4.77 MHz CPU clock (33% duty cycle). It also synchronizes READY and RESET.'],
    nmi: ['74LS74', 'NMI mask', 'A flip-flop at port A0h. When bit 7 is set, the 8087 INT signal can reach the NMI input of the CPU.'],
    bus: ['8288', 'bus controller', 'Decodes the S0–S2 status into the MRDC, MWTC, IORC, IOWC and INTA commands and drives ALE, DEN and DT/R.'],
    lat: ['8282', 'address latch', 'An octal latch. On the ALE strobe it keeps the address from the multiplexed AD lines, so the address stays on the system bus for the full cycle.'],
    xcv: ['8286', 'data transceiver', 'An octal bus transceiver between the local data lines and the system data bus. DT/R sets the direction and DEN enables it.'],
    dec: ['74LS138', 'decoder', 'A 3-to-8 decoder. It turns address bits into the chip-select signals of the memory and I/O chips.'],
    pic: ['8259A', 'interrupt controller', 'Collects IRQ0–IRQ7, raises INTR and puts the vector number on the data bus in the second INTA cycle.'],
    pit: ['8253', 'interval timer', 'Three 16-bit counters at 1.193182 MHz. Channel 0 makes the IRQ0 system tick and channel 2 makes the speaker tone.'],
    ppi: ['8255', 'peripheral interface', 'Port A reads keyboard scan codes. Port B controls the speaker gate and data bits. Port C reads the configuration switches.'],
    dma: ['8237', 'DMA controller', 'Can move data between I/O and memory without the CPU. Here only its registers are simulated.'],
    romE: ['2764 EVEN', 'EPROM', 'Holds the even bytes of the BIOS (F0000–FFFFF) on D0–D7. The quartz window lets UV light erase the chip.'],
    romO: ['2764 ODD', 'EPROM', 'Holds the odd bytes of the BIOS on D8–D15, so the 8086 can read a full word in one bus cycle.'],
    ramE: ['4164 × 8', 'RAM bank even', 'Eight 64K × 1 DRAM chips hold every even address on D0–D7. A0 low selects this bank.'],
    ramO: ['4164 × 8', 'RAM bank odd', 'Eight 64K × 1 DRAM chips hold every odd address on D8–D15. BHE low selects this bank.'],
    crtc: ['CGA card', 'video adapter', 'A 6845 CRT controller scans the 16 KB video RAM at B8000h and makes the 80 × 25 text picture.'],
    monitor: ['Color display', 'monitor', 'Shows the CGA text screen live. Click the screen in the side panel and type to send keys.'],
    spk: ['Speaker', 'sound', '8253 channel 2 drives it through bits 0 and 1 of 8255 port B.'],
    xtal: ['14.31818 MHz', 'crystal', 'Four times the NTSC color burst frequency. The 8284A divides it by 3 for the CPU clock.'],
    fdc: ['uPD765A', 'floppy controller', 'The NEC uPD765A floppy disk controller at ports 3F2h (drive and motor register), 3F4h (status) and 3F5h (data). It takes a command, moves the heads of the drives, finds the sector, and moves each byte with DMA channel 2 of the 8237. It raises IRQ 6 at the end.'],
    fdd: ['3.5-inch drive', 'floppy', 'A slim 1.44 MB floppy drive. The light is on while the controller reads or writes a sector.'],
    kbd: ['Keyboard', 'DIN socket', 'The keyboard sends scan codes in series. The board shifts them into 8255 port A and raises IRQ1.'],
  };

  const INFO_286 = {
    cpu: ['80286', 'CPU', 'The 16-bit AT processor at 8 MHz. Separate A0–A23 and D0–D15 pins reach 16 MB. Four units work in parallel: bus, instruction, execution and address unit (segment caches and protection checks).'],
    fpu: ['80287', 'coprocessor', 'The numeric coprocessor. The 80286 moves its operands with I/O cycles at ports F8h–FFh; PEREQ/PEACK ask for them, BUSY holds WAIT, and ERROR goes to IRQ13 on the slave 8259A.'],
    clk: ['82284', 'clock generator', 'Buffers the 16 MHz crystal as CLK (twice the 8 MHz processor clock) and synchronizes READY and RESET for the 80286.'],
    bus: ['82288', 'bus controller', 'Decodes S1, S0 and M/IO of the 80286 into MRDC, MWTC, IORC, IOWC and INTA, and drives ALE, DEN and DT/R.'],
    lat: ['74LS573', 'address latch', 'An octal transparent latch. ALE lets the address through and holds it on the system bus, so the CPU can start the next address early (pipelining).'],
    xcv: ['74LS245', 'data transceiver', 'An octal bus transceiver between the CPU data lines and the system data bus. DT/R sets the direction and DEN enables it.'],
    xdb: ['74LS245', 'XD bus buffer', 'Buffers the 8-bit X data bus of the board peripherals: timer, keyboard controller, RTC, interrupt and DMA controllers.'],
    dec: ['74LS138 / PAL', 'decoders', 'A 3-to-8 decoder and a PAL16L8 turn address bits into the chip selects of memory and I/O chips.'],
    pic: ['8259A master', 'interrupt controller', 'IRQ0–IRQ7 at port 20h. IRQ2 carries the cascade from the slave controller.'],
    pic2: ['8259A slave', 'interrupt controller', 'IRQ8–IRQ15 at port A0h: RTC (IRQ8), 80287 ERROR (IRQ13) and disk. Its INT output goes to IRQ2 of the master.'],
    pit: ['8254', 'interval timer', 'Three 16-bit counters at 1.193182 MHz (14.31818 MHz / 12). Channel 0 makes IRQ0, channel 2 the speaker tone.'],
    ppi: ['74LS175', 'port 61h', 'The AT keeps the old port B at 61h in simple logic: the speaker gate and data bits, and status bits.'],
    kbc: ['8042', 'keyboard controller', 'An 8-bit microcontroller with 2 KB ROM and 128 bytes RAM. It reads the keyboard (port 60h, status and commands at 64h) and drives the A20 gate and the CPU reset line.'],
    rtc: ['MC146818', 'real-time clock', 'Clock, calendar and 50 bytes of battery-backed CMOS RAM at ports 70h/71h. Bit 7 of port 70h masks NMI. IRQ8 on the slave 8259A.'],
    dma: ['8237 #1', 'DMA controller', '8-bit channels 0–3 at ports 00h–0Fh. Here only its registers are simulated.'],
    dma2: ['8237 #2', 'DMA controller', '16-bit channels 4–7 at ports C0h–DFh (channel 4 cascades the first 8237).'],
    romE: ['27128 EVEN', 'EPROM', 'Holds the even bytes of the BIOS (F0000–FFFFF, also seen at FF0000) on D0–D7.'],
    romO: ['27128 ODD', 'EPROM', 'Holds the odd bytes of the BIOS on D8–D15, so the 80286 reads a full word in one bus cycle.'],
    ramE: ['41256 × 8', 'RAM bank even', 'Eight 256K × 1 DRAM chips hold the even bytes of base memory on D0–D7. Nine address pins carry the row, then the column.'],
    ramO: ['41256 × 8', 'RAM bank odd', 'Eight 256K × 1 DRAM chips hold the odd bytes of base memory on D8–D15.'],
    xram: ['1 MB EXTENDED', 'memory card', 'A 16-bit AT memory card at 100000h–1FFFFFh. The 80286 reaches it only with A20 on, in protected mode or through the high memory area.'],
    bat: ['3 V lithium cell', 'battery', 'Keeps the MC146818 clock and CMOS setup running while the power is off.'],
    xtal: ['16 MHz', 'crystal', 'The 82284 CLK input. The 80286 divides CLK by 2: 8 MHz processor clock.'],
    xtal2: ['14.31818 MHz', 'crystal', 'The timer and CGA base: divided by 12 it gives the 1.193182 MHz 8254 clock.'],
    spk: ['Speaker', 'sound', '8254 channel 2 drives it through bits 0 and 1 of port 61h.'],
    kbd: ['Keyboard', 'DIN socket', 'The keyboard sends scan codes in series to the 8042, which raises IRQ1.'],
  };
  const INFO_SB = {
    sbdsp: ['Sound Blaster DSP', 'CT1351', 'The digital sound processor at 220h: an 8051 microcontroller with its program in ROM. It takes commands at 22Ch, pulls 8-bit samples from DMA channel 1 at the sample rate, sends them to its DAC, and raises IRQ 7 at the end of each block.'],
    opl: ['YM3812 (OPL2)', 'FM synthesizer', 'The Yamaha FM chip at 388h (and 228h): 9 channels of 2 operators. Each operator is a sine table with an envelope; one operator changes the phase of the other (frequency modulation). The YM3014B DAC turns its serial output into the music signal.'],
  };
  const INFO_CARDS = {
    hdc: ['IDE hard disk card', 'GAL16V8', 'A 16-bit paddle card for the hard disk at ports 1F0h-1F7h and 3F6h. The controller is on the drive (IDE: integrated drive electronics); the card only decodes the ports and buffers the 16 data lines. The CPU moves each sector of 512 bytes through the data port 1F0h, one word at a time (programmed I/O). IRQ 14 on the AT models.'],
    hdd: ['Hard disk drive', 'drive C:', 'A 3.5-inch IDE hard drive with its own controller: a sector buffer, the task file registers (sector count, sector, cylinder, head, command, status) and the head and spindle servo. The BIOS reads and writes it with INT 13h, drive 80h.'],
    cgrom: ['Character ROM', 'CGA', 'An 8 KB mask ROM with the 8 × 8 and 8 × 14 dot patterns of the 256 characters. The 6845 row address and the character code select one line of dots.'],
    vga: ['VGA controller', 'ASIC', 'Sequencer, graphics controller (latches, ALU and rotate, bit mask), attribute controller and CRTC on one chip. It maps 256 KB of video memory in four planes at A0000–BFFFF.'],
    dac: ['RAMDAC', 'palette DAC', 'A 256 × 18-bit palette RAM and three 6-bit DACs. Ports 3C8h/3C9h write the palette, 3C6h is the pixel mask.'],
    vmem: ['4464 × 8', 'video DRAM', 'Eight 64K × 4 DRAM chips: 256 KB in four planes of 64 KB (two chips per plane).'],
    vbios: ['27256', 'video BIOS', 'The VGA BIOS option ROM at C0000–C7FFF (55AA signature). The system BIOS calls it at start-up; it installs INT 10h.'],
  };
  const INFO_386 = {
    cpu: ['80386', 'CPU', 'The 32-bit processor at 25 MHz, in a 132-pin grid array. Six units work in a pipeline: bus interface, code prefetch (16-byte queue), instruction decode (3 decoded instructions), execution, segmentation and paging (a 32-entry TLB). This board has a 16-bit data bus, like the 386SX.'],
    fpu: ['80387', 'coprocessor', 'The numeric coprocessor of the 386. The 386 moves its operands with I/O cycles at 800000F8h (here the AT ports F8h–FFh). BUSY holds the 386; ERROR goes to IRQ13.'],
    clk: ['82384', 'clock generator', 'Makes CLK2 (twice the processor clock) for the 80386 and the peripheral clock, and synchronizes RESET.'],
    xtal: ['50 MHz', 'crystal', 'The 82384 input. The 80386 divides CLK2 by 2: 25 MHz processor clock.'],
  };
  const INFO_486 = {
    cpu: ['80486DX', 'CPU', 'The 80486 at 33 MHz, in a 168-pin grid array. It has the 386 units, an 8 KB cache (4-way, 16-byte lines), the floating-point unit on the chip, and a 5-stage pipeline (prefetch, decode 1, decode 2, execute, write back): most simple instructions take 1 clock. A cache miss fills a line with a burst of 4 bus transfers (2-1-1-1). This board has a 16-bit data bus.'],
    clk: ['33.3 MHz', 'oscillator', 'The 80486 takes CLK at the processor frequency (no CLK2 as on the 386).'],
  };
  const INFO_586 = {
    cpu: ['Pentium', 'CPU', 'The Pentium (P5) at 66 MHz, in a 273-pin grid array. Two integer pipes (U and V) can each finish an instruction in the same clock, when the two instructions pair. A branch target buffer (256 entries) predicts the branches. It has an 8 KB code cache and an 8 KB data cache (2-way, 32-byte lines; the data cache writes back), the FPU on the chip and a 64-bit data bus: a line fill is a burst of 4 × 8 bytes.'],
    clk: ['66.6 MHz', 'oscillator', 'The Pentium takes CLK at the processor frequency. The bus runs at the same clock.'],
  };
  const INFO_686 = {
    cpu: ['Pentium Pro', 'CPU', 'The Pentium Pro (P6) at 200 MHz, in a 387-pin package with two dies: the CPU and a 256 KB L2 cache on its own back-side bus at the core clock. Three decoders change each x86 instruction into µops; the RAT renames the registers; the µops wait in the reservation station until their operands are ready and go to 5 ports out of order; the reorder buffer (40 entries) retires them in program order, up to 3 in each clock. The front-side bus runs at 66 MHz.'],
    clk: ['66.6 MHz', 'oscillator', 'The bus clock. The Pentium Pro multiplies it by 3 for its core clock (200 MHz).'],
  };
  const INFO = Object.assign({}, INFO_SB, INFO_86, M286 ? INFO_286 : {}, M386 ? INFO_386 : {}, FPU_ON ? INFO_486 : {}, M586 ? INFO_586 : {}, M686 ? INFO_686 : {}, INFO_CARDS);
  // Where a device sits on the buses.
  const IO_DEV = M286 ? { pic: 1, pic2: 1, pit: 1, ppi: 1, kbc: 1, rtc: 1, dma: 1, dma2: 1, fpu: 1 } : { pic: 1, pit: 1, ppi: 1, dma: 1, nmi: 1 };
  const DEV_ALIAS = M286 ? { a20: 'kbc', nmi: 'rtc' } : {};
  const DEV_SEL = { ram: 'RAM', rom: 'ROM', pic: '8259A', pic2: '8259A slave', pit: M286 ? '8254' : '8253', ppi: M286 ? 'port 61h' : '8255', dma: '8237', dma2: '8237 #2', nmi: 'NMI mask', kbc: '8042', rtc: 'MC146818', fpu: '80287' };

  // ---------------------------------------------------------------------------
  // Trace bundles. n lines, sp spacing, pts is the center line. bit: first bus bit of line 0.
  const R = (id, n, sp, pts, bit = 0) => ({ id, n, sp, pts, bit });
  const ROUTES_86 = [
    R('LB_cpu', 20, 0.056, [[-6.85, -2.0], [-4.05, -2.0]]),
    R('LB_fpu', 20, 0.056, [[-6.85, 1.8], [-6.0, 1.8], [-6.0, -1.45]]),
    R('LB_x', 16, 0.056, [[-4.7, -1.45], [-4.7, 1.7], [-3.45, 1.7]]),
    R('SA_t', 20, 0.05, [[-0.8, -2.0], [1.3, -2.0]]),
    R('SA_up1', 20, 0.05, [[1.3, -2.0], [1.3, -5.9]]),
    R('SA_slot', 20, 0.05, [[1.3, -5.9], [1.3, -8.0], [-3.8, -8.0]]),
    R('SA_io', 8, 0.06, [[1.3, -5.9], [15.6, -5.9]]),
    R('SA_dn', 20, 0.05, [[1.3, -2.0], [1.3, 7.75]]),
    R('SA_ramL', 20, 0.05, [[1.3, 7.3], [-13.6, 7.3]]),
    R('SA_romR', 20, 0.05, [[1.3, 7.3], [7.7, 7.3]]),
    R('SD_t', 16, 0.056, [[-1.4, 1.7], [-0.1, 1.7]]),
    R('SD_up', 16, 0.056, [[-0.1, 1.7], [-0.1, -5.2]]),
    R('SD_io', 8, 0.06, [[-0.1, -5.2], [15.6, -5.2]]),
    R('SD_slot', 8, 0.06, [[-0.1, -5.2], [-0.1, -10.3], [-3.8, -10.3]]),
    R('SD_dn', 16, 0.056, [[-0.1, 1.7], [-0.1, 4.0]]),
    R('SD_evL', 8, 0.06, [[-0.1, 4.0], [-13.6, 4.0]]),
    R('SD_evR', 8, 0.06, [[-0.1, 4.0], [7.7, 4.0]]),
    R('SD_dn2', 8, 0.06, [[-0.1, 4.0], [-0.1, 10.45]], 8),
    R('SD_odL', 8, 0.06, [[-0.1, 10.45], [-13.6, 10.45]], 8),
    R('SD_odR', 8, 0.06, [[-0.1, 10.45], [7.7, 10.45]], 8),
    R('S02', 3, 0.09, [[-9.5, -2.85], [-9.5, -5.15]]),
    R('ALE', 1, 0.1, [[-8.05, -5.45], [-2.4, -5.45], [-2.4, -3.45]]),
    R('DEN', 2, 0.09, [[-8.05, -5.75], [-5.3, -5.75], [-5.3, 3.4], [-2.4, 3.4]]),
    R('CMD_IO', 3, 0.09, [[-9.2, -6.0], [-9.2, -6.6], [15.7, -6.6]], 2),
    R('CMD_MEM', 2, 0.09, [[-10.2, -6.0], [-10.2, -6.95], [-16.4, -6.95], [-16.4, 7.3], [-13.8, 7.3]]),
    R('CMD_SLOT', 4, 0.09, [[-8.6, -6.0], [-8.6, -8.75]]),
    R('INTR', 1, 0.1, [[2.1, -7.3], [-11.6, -7.3], [-11.6, -2.85]]),
    R('NMI_a', 1, 0.1, [[-12.2, 1.5], [-12.9, 1.5], [-12.9, -4.1], [-8.0, -4.1]]),
    R('NMI_b', 1, 0.1, [[-7.0, -3.7], [-7.0, -2.85]]),
    R('RQ', 1, 0.1, [[-11.1, -1.2], [-11.1, 1.0]]),
    R('QS', 2, 0.09, [[-11.7, -1.2], [-11.7, 1.0]]),
    R('CLK_cpu', 3, 0.09, [[-13.9, -2.0], [-12.2, -2.0]]),
    R('CLK_fpu', 1, 0.1, [[-13.9, -1.0], [-13.4, -1.0], [-13.4, 1.9], [-12.2, 1.9]]),
    R('CLK_bus', 1, 0.1, [[-13.9, -2.9], [-13.2, -3.6], [-13.2, -5.6], [-10.9, -5.6]]),
    R('CS_pic', 1, 0.1, [[3.3, -3.8], [3.3, -7.0]]),
    R('CS_pit', 1, 0.1, [[3.8, -3.8], [3.8, -4.45], [8.5, -4.45], [8.5, -7.0]]),
    R('CS_ppi', 1, 0.1, [[4.3, -3.8], [4.3, -4.65], [13.1, -4.65], [13.1, -7.0]]),
    R('CS_dma', 1, 0.1, [[5.15, -3.4], [10.8, -3.4]]),
    R('CS_nmi', 1, 0.1, [[2.85, -3.25], [2.45, -3.25], [2.45, -4.85], [-5.95, -4.85], [-5.95, -4.1]]),
    R('CS_rom', 1, 0.1, [[4.6, -3.0], [4.6, 4.8]]),
    R('CS_ram', 1, 0.1, [[3.4, -3.0], [3.4, 3.1], [-1.0, 3.1], [-2.2, 4.3]]),
    R('SPKR', 1, 0.1, [[9.9, -7.0], [9.9, 4.7], [11.2, 6.0]]),
    R('KBD', 2, 0.1, [[15.3, -9.6], [15.3, -9.0], [14.9, -8.6]]),
  ];
  // A chain is a path of bundles that a pulse follows from start to end.
  const CHAINS_86 = {
    L_addr_cpu: ['LB_cpu'], L_addr_fpu: ['LB_fpu', 'LB_cpu'],
    L_data_cpu: ['LB_cpu', 'LB_x'], L_data_fpu: ['LB_fpu', 'LB_cpu', 'LB_x'],
    A_ram: ['SA_t', 'SA_dn', 'SA_ramL'], A_rom: ['SA_t', 'SA_dn', 'SA_romR'],
    A_io: ['SA_t', 'SA_up1', 'SA_io'], A_slot: ['SA_t', 'SA_up1', 'SA_slot'],
    D_ramE: ['SD_t', 'SD_dn', 'SD_evL'], D_ramO: ['SD_t', 'SD_dn', 'SD_dn2', 'SD_odL'],
    D_romE: ['SD_t', 'SD_dn', 'SD_evR'], D_romO: ['SD_t', 'SD_dn', 'SD_dn2', 'SD_odR'],
    D_io: ['SD_t', 'SD_up', 'SD_io'], D_slot: ['SD_t', 'SD_up', 'SD_slot'],
    NMI: ['NMI_a', 'NMI_b'],
  };
  // 80286 buses: separate address (A0-A23) and data (D0-D15) lines leave the CPU.
  const ROUTES_286 = [
    R('LB_cpu', 24, 0.05, [[-7.95, -3.3], [-2.45, -3.3]]),
    R('LB_x', 16, 0.056, [[-7.95, -2.1], [-6.5, -2.1], [-6.5, 1.3], [-5.25, 1.3]]),
    R('LB_fpu', 16, 0.056, [[-6.5, -0.45], [-8.3, -0.45], [-8.3, 1.02]]),
    R('SA_t', 24, 0.05, [[-2.2, -3.3], [1.0, -3.3]]),
    R('SA_up1', 24, 0.05, [[1.0, -3.3], [1.0, -6.3]]),
    R('SA_slot', 24, 0.05, [[1.0, -6.3], [1.0, -9.75]]),
    R('SA_io', 8, 0.06, [[1.0, -6.3], [15.8, -6.3]]),
    R('SA_dn', 24, 0.05, [[1.0, -3.3], [1.0, 7.75]]),
    R('SA_ramL', 20, 0.05, [[1.0, 7.3], [-13.6, 7.3]]),
    R('SA_romR', 20, 0.05, [[1.0, 7.3], [7.7, 7.3]]),
    R('SD_t', 16, 0.056, [[-3.15, 1.3], [-0.1, 1.3]]),
    R('SD_up', 16, 0.056, [[-0.1, 1.3], [-0.1, -5.5]]),
    R('SD_io', 8, 0.06, [[-0.1, -5.5], [15.8, -5.5]]),
    R('SD_slot', 8, 0.06, [[-0.1, -5.5], [-0.1, -9.75]]),
    R('SD_dn', 16, 0.056, [[-0.1, 1.3], [-0.1, 4.0]]),
    R('SD_evL', 8, 0.06, [[-0.1, 4.0], [-13.6, 4.0]]),
    R('SD_evR', 8, 0.06, [[-0.1, 4.0], [7.7, 4.0]]),
    R('SD_dn2', 8, 0.06, [[-0.1, 4.0], [-0.1, 10.45]], 8),
    R('SD_odL', 8, 0.06, [[-0.1, 10.45], [-13.6, 10.45]], 8),
    R('SD_odR', 8, 0.06, [[-0.1, 10.45], [7.7, 10.45]], 8),
    R('S02', 4, 0.09, [[-9.5, -4.35], [-9.5, -5.52]]),
    R('ALE', 1, 0.1, [[-8.16, -5.75], [-5.2, -5.75], [-5.2, -4.14]]),
    R('DEN', 2, 0.09, [[-8.16, -6.05], [-5.85, -6.05], [-5.85, 2.9], [-3.6, 2.9]]),
    R('CMD_IO', 3, 0.09, [[-9.2, -6.28], [-9.2, -6.9], [15.9, -6.9]], 2),
    R('CMD_MEM', 2, 0.09, [[-10.2, -6.28], [-10.2, -7.1], [-16.4, -7.1], [-16.4, 7.3], [-13.8, 7.3]]),
    R('CMD_SLOT', 4, 0.09, [[-8.6, -6.28], [-8.6, -7.72]]),
    R('INTR', 1, 0.1, [[1.75, -7.3], [-11.6, -7.3], [-11.6, -4.8], [-10.6, -4.8]]),
    R('ERR', 1, 0.1, [[-12.15, 2.3], [-12.9, 2.3], [-12.9, -6.62], [5.95, -6.62], [5.95, -7.04]]),
    R('RQ', 2, 0.09, [[-11.1, -1.25], [-11.1, 1.04]]),
    R('QS', 2, 0.09, [[-10.4, -1.25], [-10.4, 1.04]]),
    R('CLK_cpu', 3, 0.09, [[-13.9, -2.8], [-11.05, -2.8]]),
    R('CLK_fpu', 1, 0.1, [[-13.9, -2.0], [-13.3, -2.0], [-13.3, 1.8], [-12.15, 1.8]]),
    R('CLK_bus', 1, 0.1, [[-13.9, -3.6], [-13.3, -4.1], [-13.3, -5.9], [-10.84, -5.9]]),
    R('CS_pic', 1, 0.1, [[1.9, -4.28], [1.9, -7.04]]),
    R('CS_pic2', 1, 0.1, [[2.3, -4.28], [2.3, -5.05], [6.7, -5.05], [6.7, -7.04]]),
    R('CS_pit', 1, 0.1, [[2.9, -4.28], [2.9, -4.85], [11.9, -4.85], [11.9, -7.04]]),
    R('CS_kbc', 1, 0.1, [[3.69, -3.9], [5.99, -3.9]]),
    R('CS_rtc', 1, 0.1, [[3.69, -3.62], [4.6, -3.62], [4.6, -2.8], [13.6, -2.8], [13.6, -3.14]]),
    R('CS_dma', 1, 0.1, [[3.2, -3.52], [3.2, -1.66]]),
    R('CS_dma2', 1, 0.1, [[3.55, -3.52], [3.55, -2.5], [11.2, -2.5], [11.2, -1.66]]),
    R('CS_rom', 1, 0.1, [[2.05, -3.52], [2.05, 4.8], [3.65, 4.8]]),
    R('CS_ram', 1, 0.1, [[2.4, -3.52], [2.4, 3.1], [-1.0, 3.1], [-2.2, 4.3]]),
    R('SPKR', 1, 0.1, [[12.8, -7.04], [12.8, -5.2], [16.3, -5.2], [16.3, 4.6], [14.5, 5.6]]),
    R('KBD', 2, 0.1, [[15.3, -9.6], [15.3, -9.0], [16.0, -8.3], [16.0, -5.9], [10.4, -5.9], [10.4, -4.66]]),
  ];
  const CHAINS_286 = {
    L_addr_cpu: ['LB_cpu'], L_addr_fpu: ['LB_cpu'], L_data_cpu: ['LB_x'], L_data_fpu: ['LB_x'], L_fpu: ['LB_x', 'LB_fpu'],
    A_ram: ['SA_t', 'SA_dn', 'SA_ramL'], A_rom: ['SA_t', 'SA_dn', 'SA_romR'],
    A_io: ['SA_t', 'SA_up1', 'SA_io'], A_slot: ['SA_t', 'SA_up1', 'SA_slot'],
    D_ramE: ['SD_t', 'SD_dn', 'SD_evL'], D_ramO: ['SD_t', 'SD_dn', 'SD_dn2', 'SD_odL'],
    D_romE: ['SD_t', 'SD_dn', 'SD_evR'], D_romO: ['SD_t', 'SD_dn', 'SD_dn2', 'SD_odR'],
    D_io: ['SD_t', 'SD_up', 'SD_io'], D_slot: ['SD_t', 'SD_up', 'SD_slot'],
    NMI: ['ERR'],
  };
  // no coprocessor traces on the 80486 board
  const FPU_ROUTES = { LB_fpu: 1, RQ: 1, QS: 1, CLK_fpu: 1, ERR: 1 };
  const ROUTES = FPU_ON ? ROUTES_286.filter(r => !FPU_ROUTES[r.id]) : M286 ? ROUTES_286 : ROUTES_86;
  const CHAINS = FPU_ON ? Object.assign({}, CHAINS_286, { L_fpu: ['LB_x'], NMI: [] }) : M286 ? CHAINS_286 : CHAINS_86;
  const SLOT_DEV = { vram: 1, crtc: 1, cga: 1, fdc: 1, hdc: 1, xram: 1, vga: 1, vrom: 1, sb: 1, opl: 1 };
  for (const r of ROUTES) if (!CHAINS[r.id]) CHAINS[r.id] = [r.id];

  const STATUS = { inta: 0, ior: 1, iow: 2, halt: 3, fetch: 4, memr: 5, memw: 6 };
  const STATUS_NAME = ['INTA', 'I/O read', 'I/O write', 'halt', 'code fetch', 'memory read', 'memory write', 'passive'];
  const CMD_BIT = { fetch: 0, memr: 0, memw: 1, ior: 2, iow: 3, inta: 4 };
  const CMD_NAME = ['MRDC', 'MWTC', 'IORC', 'IOWC', 'INTA'];

  // Follow: the camera distance and angles (theta, phi) for a double-click on a drive (the
  // drives are seen from the front of the cage).
  const CHASE_R = { hdd: 15, fddA: 15, fddB: 15 };
  const CHASE_A = { hdd: [BAY_ROT, 0.8], fddA: [BAY_ROT, 0.8], fddB: [BAY_ROT, 0.8] };
  const PRESETS = {
    overview: { label: 'Overview', target: [2.8, 0.4, -2.6], theta: 0.22, phi: 0.92, r: 0 },
    cpu: { label: 'CPU', target: M286 ? [-8.4, 0.3, -2.0] : [-8.2, 0.3, -1.6], theta: -0.35, phi: 0.78, r: 14 },
    memory: { label: 'Memory', target: [-4.2, 0, 6.6], theta: 0.1, phi: 0.74, r: 24 },
    io: { label: 'I/O', target: [8.8, 0, -5.4], theta: 0.28, phi: 0.82, r: 16 },
    screen: { label: 'Screen', target: [MONITOR.x + 3.2, 4.8, MONITOR.z], theta: 0.16, phi: 1.34, r: 21 },
  };

  // ---------------------------------------------------------------------------
  // Geometry helpers.
  function chamfer(pts, c) {
    if (pts.length < 3) return pts.map(p => p.slice());
    const out = [pts[0].slice()];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], d = pts[i + 1];
      const l0 = Math.hypot(b[0] - a[0], b[1] - a[1]), l1 = Math.hypot(d[0] - b[0], d[1] - b[1]);
      const cc = Math.min(c, l0 * 0.45, l1 * 0.45);
      out.push([b[0] + (a[0] - b[0]) / l0 * cc, b[1] + (a[1] - b[1]) / l0 * cc]);
      out.push([b[0] + (d[0] - b[0]) / l1 * cc, b[1] + (d[1] - b[1]) / l1 * cc]);
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  // Offset a polyline to its left side by off (miter joins).
  function offsetPoly(pts, off) {
    const n = pts.length, out = [];
    const nrm = i => {
      const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    };
    for (let i = 0; i < n; i++) {
      let m;
      if (i === 0) m = nrm(0);
      else if (i === n - 1) m = nrm(n - 2);
      else {
        const n0 = nrm(i - 1), n1 = nrm(i);
        let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
        const l = Math.hypot(mx, mz) || 1;
        mx /= l; mz /= l;
        const k = 1 / Math.max(0.3, mx * n0[0] + mz * n0[1]);
        m = [mx * k, mz * k];
      }
      out.push([pts[i][0] + m[0] * off, pts[i][1] + m[1] * off]);
    }
    return out;
  }
  function cumLen(pts) {
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return s;
  }
  // Arc length of the closest point of a path to p, and the distance to it.
  function project(path, S, p) {
    let best = 1e9, bs = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2, 0, 1);
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
      if (d < best) { best = d; bs = S[i] + t * Math.sqrt(l2); }
    }
    return { s: bs, d: best };
  }
  function mergeGeos(list) {
    const pos = [], nor = [], uv = [], idx = [];
    let off = 0;
    for (const g of list) {
      const p = g.attributes.position;
      pos.push(...p.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
      for (const i of g.index.array) idx.push(i + off);
      off += p.count;
      g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    return out;
  }
  function roundRect(s, w, h, r, x = 0, y = 0) {
    const hw = w / 2, hh = h / 2;
    s.moveTo(x - hw + r, y - hh);
    s.lineTo(x + hw - r, y - hh); s.quadraticCurveTo(x + hw, y - hh, x + hw, y - hh + r);
    s.lineTo(x + hw, y + hh - r); s.quadraticCurveTo(x + hw, y + hh, x + hw - r, y + hh);
    s.lineTo(x - hw + r, y + hh); s.quadraticCurveTo(x - hw, y + hh, x - hw, y + hh - r);
    s.lineTo(x - hw, y - hh + r); s.quadraticCurveTo(x - hw, y - hh, x - hw + r, y - hh);
    return s;
  }
  // DIP outline with the pin-1 notch at the -x end.
  function dipShape(L, W, notch) {
    const s = new T.Shape(), hl = L / 2, hw = W / 2, r = 0.03;
    s.moveTo(-hl + r, -hw);
    s.lineTo(hl - r, -hw); s.quadraticCurveTo(hl, -hw, hl, -hw + r);
    s.lineTo(hl, hw - r); s.quadraticCurveTo(hl, hw, hl - r, hw);
    s.lineTo(-hl + r, hw); s.quadraticCurveTo(-hl, hw, -hl, hw - r);
    if (notch) { s.lineTo(-hl, notch); s.absarc(-hl, 0, notch, Math.PI / 2, -Math.PI / 2, true); }
    s.lineTo(-hl, -hw + r); s.quadraticCurveTo(-hl, -hw, -hl + r, -hw);
    return s;
  }
  const geoCache = new Map();
  function bodyGeo(L, W, H, notch) {
    const key = [L, W, H, notch].join();
    if (geoCache.has(key)) return geoCache.get(key);
    const bev = Math.min(0.03, H * 0.12);
    const g = new T.ExtrudeGeometry(dipShape(L - 2 * bev, W - 2 * bev, notch), {
      depth: H - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 10,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, bev, 0);
    geoCache.set(key, g);
    return g;
  }
  // A flat board (PCB) of w x d with its top face at y = 0; UV maps the whole top face.
  function boardGeo(w, d, th, r) {
    const bev = 0.02;
    const s = roundRect(new T.Shape(), w - 2 * bev, d - 2 * bev, r);
    const g = new T.ExtrudeGeometry(s, { depth: th - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -th + bev, 0);
    return g;
  }
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
    return c;
  }
  function colorTex(c, aniso) {
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = aniso || 1;
    return t;
  }
  const rgb = (h, r, m) => `rgb(${Math.round(h * 255)},${Math.round(r * 255)},${Math.round(m * 255)})`;

  // Paints a PCB on two canvases: the colour map and a data map
  // (R = height for the bump map, G = roughness, B = metalness).
  class Painter {
    constructor(w, d, ppu) {
      this.w = w; this.d = d; this.ppu = ppu;
      this.c = canvas(w * ppu, d * ppu); this.k = canvas(w * ppu, d * ppu);
      this.cc = this.c.getContext('2d'); this.kc = this.k.getContext('2d');
      for (const g of [this.cc, this.kc]) { g.lineCap = 'round'; g.lineJoin = 'round'; }
    }
    X(x) { return (x + this.w / 2) * this.ppu; }
    Z(z) { return (z + this.d / 2) * this.ppu; }
    poly(pts, width, color, data) {
      for (const [g, st] of [[this.cc, color], [this.kc, data]]) {
        if (!st) continue;
        g.strokeStyle = st; g.lineWidth = width * this.ppu;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(this.X(p[0]), this.Z(p[1])) : g.moveTo(this.X(p[0]), this.Z(p[1]))));
        g.stroke();
      }
    }
    dot(x, z, r, color, data) {
      for (const [g, st] of [[this.cc, color], [this.kc, data]]) {
        if (!st) continue;
        g.fillStyle = st; g.beginPath(); g.arc(this.X(x), this.Z(z), r * this.ppu, 0, TAU); g.fill();
      }
    }
    rect(x, z, w, d, color, data, stroke) {
      for (const [g, st] of [[this.cc, color], [this.kc, data]]) {
        if (!st) continue;
        if (stroke) { g.strokeStyle = st; g.lineWidth = stroke * this.ppu; g.strokeRect(this.X(x), this.Z(z), w * this.ppu, d * this.ppu); }
        else { g.fillStyle = st; g.fillRect(this.X(x), this.Z(z), w * this.ppu, d * this.ppu); }
      }
    }
    pad(x, z, w, d) {
      const g = this.cc, k = this.kc, X = this.X(x), Z = this.Z(z), hw = w * this.ppu / 2, hd = d * this.ppu / 2;
      const r = Math.min(hw, hd);
      for (const [c, st] of [[g, PAL.pad], [k, rgb(0.75, 0.28, 1)]]) {
        c.fillStyle = st; c.beginPath();
        c.moveTo(X - hw + r, Z - hd); c.arcTo(X + hw, Z - hd, X + hw, Z + hd, r); c.arcTo(X + hw, Z + hd, X - hw, Z + hd, r);
        c.arcTo(X - hw, Z + hd, X - hw, Z - hd, r); c.arcTo(X - hw, Z - hd, X + hw, Z - hd, r); c.fill();
      }
      g.fillStyle = PAL.padHole; g.beginPath(); g.arc(X, Z, r * 0.42, 0, TAU); g.fill();
    }
    text(str, x, z, size, opt = {}) {
      const color = opt.color || THEME.silk;
      for (const [g, st] of [[this.cc, color], [this.kc, rgb(0.5, 0.8, 0)]]) {
        g.save();
        g.translate(this.X(x), this.Z(z));
        if (opt.rot) g.rotate(opt.rot);
        g.strokeStyle = st; g.globalAlpha = opt.alpha || 0.92;
        g.lineWidth = Math.max(1.2, size * this.ppu * 0.13);
        strokeTextCanvas(g, str, 0, 0, size * this.ppu, 1.5, opt.align || 'left');
        g.restore();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shaders. Glow materials add light (additive blending) and skip tone mapping.
  const BUS_VS = `
    attribute float aS; attribute float aLine; attribute float aV;
    varying float vS; varying float vLine; varying float vV;
    void main() { vS = aS; vLine = aLine; vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const BUS_FS = `
    uniform vec3 uColor; uniform float uHead; uniform float uDir; uniform float uAmp; uniform float uHold;
    uniform float uBitMix; uniform float uFlow; uniform float uTime; uniform float uTail; uniform float uBase;
    uniform highp int uBits;
    varying float vS; varying float vLine; varying float vV;
    void main() {
      int li = int(vLine + 0.5);
      float bit = float((uBits >> li) & 1);
      float lv = mix(1.0, mix(0.16, 1.0, bit), uBitMix);
      float x = (uHead - vS) * uDir;
      float comet = x >= 0.0 ? exp(-x / uTail) : exp(x * 14.0);
      float passed = smoothstep(-0.06, 0.06, x);
      float fl = uFlow * (0.18 + 0.82 * pow(0.5 + 0.5 * sin(vS * 2.6 - uTime * 0.009 + vLine * 2.39), 8.0));
      float I = uAmp * comet * (0.45 + 0.75 * lv) + uHold * passed * lv + fl + uBase * lv;
      float soft = exp(-vV * vV * 3.0);
      float core = exp(-vV * vV * 20.0);
      vec3 c = uColor * I * (soft * 0.32 + core * 0.9) + vec3(1.0) * core * uAmp * comet * 0.3 * lv;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`;
  // Trace flows: a line lit from its start up to uHead, with a bright front.
  const FLOW_VS = `
    attribute float aS; attribute float aV; varying float vS; varying float vV;
    void main() { vS = aS; vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const FLOW_FS = `
    uniform vec3 uColor; uniform float uHead; uniform float uAlpha; uniform float uTail;
    varying float vS; varying float vV;
    void main() {
      float x = uHead - vS;
      float lit = smoothstep(-0.1 * uTail, 0.03 * uTail, x);
      float comet = exp(-max(x, 0.0) / uTail);
      float soft = exp(-vV * vV * 2.5), core = exp(-vV * vV * 16.0);
      float I = uAlpha * lit * (0.45 + 1.25 * comet);
      vec3 c = uColor * I * (soft * 0.35 + core * 0.95) + vec3(1.0) * core * comet * lit * uAlpha * 0.3;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`;
  // Trace: a soft glow over one block of a die (edge, light fill, outer halo).
  const BLOCK_FS = `
    uniform vec3 uColor; uniform float uI; uniform vec2 uIn; uniform float uFill;
    varying vec2 vUv;
    void main() {
      vec2 q = abs(vUv - 0.5) * 2.0 / uIn;
      float e = max(q.x, q.y);
      float edge = exp(-pow((e - 1.0) * 9.0, 2.0));
      float fill = e < 1.0 ? uFill : 0.0;
      float halo = e > 1.0 ? exp(-(e - 1.0) * 6.0) * 0.35 : 0.0;
      gl_FragColor = vec4(uColor * uI * (edge + fill + halo), 1.0);
      #include <colorspace_fragment>
    }`;
  const UV_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const HALO_FS = `
    uniform vec3 uColor; uniform float uI; uniform vec2 uSize; uniform vec2 uHalf;
    varying vec2 vUv;
    void main() {
      vec2 p = (vUv - 0.5) * uSize;
      vec2 q = abs(p) - uHalf + 0.05;
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.05;
      float g = d > 0.0 ? exp(-d * 8.0) * 0.6 + exp(-d * 2.4) * 0.14 : 0.22;
      gl_FragColor = vec4(uColor * uI * g, 1.0);
      #include <colorspace_fragment>
    }`;
  const GLINT_FS = `
    uniform float uT; uniform vec3 uColor; uniform float uAmp;
    varying vec2 vUv;
    void main() {
      float p = vUv.x * 0.78 + vUv.y * 0.42;
      float d = p - uT;
      float g = exp(-d * d * 260.0) * 0.9 + exp(-d * d * 24.0) * 0.16;
      float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
      gl_FragColor = vec4(uColor * g * edge * uAmp, 1.0);
      #include <colorspace_fragment>
    }`;
  const RING_FS = `
    uniform vec3 uColor; uniform float uI;
    varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      float g = exp(-pow((r - 0.78) * 7.0, 2.0)) + exp(-r * r * 2.0) * 0.15;
      gl_FragColor = vec4(uColor * uI * g * smoothstep(1.0, 0.9, r), 1.0);
      #include <colorspace_fragment>
    }`;
  function glowMat(fs, uniforms) {
    return new T.ShaderMaterial({
      uniforms, vertexShader: UV_VS, fragmentShader: fs, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, toneMapped: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Dies inside the packages (decap tool). Floor plans: [x, y, w, h, label, kind] in parts
  // of the die core. kind: m memory array, r ROM, d datapath, l random logic, i I/O, a analog.
  const DIE_OF = p => (p.startsWith('27256') ? '27256' : p.startsWith('27128') ? '27128' : p.startsWith('2764') ? '2764' : p === 'DATA SEP' ? '9216' : p);
  function slicePlan(n, lbl, ctl) {
    const b = [];
    for (let i = 0; i < n; i++) b.push([i / n, 0, 1 / n - 0.012, 0.74, lbl + i, 'd']);
    b.push([0, 0.77, 1, 0.23, ctl, 'l']);
    return { a: 1.4, b };
  }
  const DRAM_PLAN = { a: 1.7, b: [
    [0, 0, 0.42, 0.43, 'CELL ARRAY', 'm'], [0.58, 0, 0.42, 0.43, 'CELL ARRAY', 'm'],
    [0, 0.57, 0.42, 0.43, 'CELL ARRAY', 'm'], [0.58, 0.57, 0.42, 0.43, 'CELL ARRAY', 'm'],
    [0.43, 0, 0.14, 0.43, 'ROW DEC', 'l'], [0.43, 0.57, 0.14, 0.43, 'ROW DEC', 'l'],
    [0, 0.44, 0.42, 0.12, 'SENSE AMPS', 'd'], [0.58, 0.44, 0.24, 0.12, 'SENSE AMPS', 'd'], [0.83, 0.44, 0.17, 0.12, 'DATA IO', 'i'], [0.43, 0.44, 0.14, 0.12, 'COL DEC', 'l']] };
  const DIE_PLANS = {
    '8086': { a: 1.06, tag: '8086', b: [
      [0, 0, 0.27, 0.29, 'ALU', 'd'], [0, 0.31, 0.27, 0.22, 'FLAGS', 'l'], [0.29, 0, 0.25, 0.53, 'REGISTERS', 'd'],
      [0.56, 0, 0.2, 0.26, 'ADDRESS ADDER', 'd'], [0.56, 0.28, 0.2, 0.25, 'SEGMENT REGS', 'd'], [0.78, 0, 0.22, 0.26, 'BUS CONTROL', 'l'],
      [0.78, 0.28, 0.22, 0.25, 'QUEUE', 'm'], [0, 0.56, 0.52, 0.21, 'DECODER', 'l'], [0, 0.79, 0.52, 0.21, 'INTERRUPTS TIMING', 'l'],
      [0.54, 0.56, 0.46, 0.44, 'MICROCODE ROM', 'r']] },
    '8087': { a: 1.12, tag: '8087', b: [
      [0, 0, 0.3, 0.2, 'QUEUE TRACKER', 'l'], [0, 0.22, 0.14, 0.2, 'STATUS', 'l'], [0.16, 0.22, 0.14, 0.2, 'CONTROL', 'l'],
      [0, 0.44, 0.3, 0.2, 'BUS INTERFACE', 'i'], [0.32, 0, 0.34, 0.64, 'REGISTER STACK', 'm'], [0.68, 0, 0.32, 0.3, 'EXPONENT', 'd'],
      [0.68, 0.32, 0.32, 0.32, 'MANTISSA', 'd'], [0, 0.66, 1, 0.34, 'MICROCODE ROM', 'r']] },
    '4164': DRAM_PLAN, '4416': DRAM_PLAN,
    '2764': { a: 1.3, b: [[0, 0, 0.62, 0.68, 'CELL ARRAY', 'm'], [0.64, 0, 0.36, 0.68, 'X DECODER', 'l'], [0, 0.7, 0.62, 0.14, 'Y DECODER', 'l'],
      [0, 0.86, 0.62, 0.14, 'Y GATING', 'd'], [0.64, 0.7, 0.36, 0.3, 'OUTPUT BUFFERS', 'i']] },
    '8259A': { a: 1.25, b: [[0, 0, 0.3, 0.3, 'DATA BUS BUFFER', 'i'], [0, 0.32, 0.3, 0.3, 'READ WRITE LOGIC', 'l'], [0, 0.64, 0.3, 0.36, 'CASCADE BUFFER', 'i'],
      [0.32, 0, 0.2, 0.62, 'ISR', 'm'], [0.54, 0, 0.2, 0.62, 'PRIORITY RESOLVER', 'l'], [0.76, 0, 0.24, 0.62, 'IRR', 'm'],
      [0.32, 0.64, 0.42, 0.36, 'CONTROL LOGIC', 'l'], [0.76, 0.64, 0.24, 0.36, 'IMR', 'm']] },
    '8253': { a: 1.3, b: [[0, 0, 0.32, 0.48, 'DATA BUS BUFFER', 'i'], [0, 0.5, 0.32, 0.24, 'READ WRITE LOGIC', 'l'], [0, 0.76, 0.32, 0.24, 'CONTROL WORD REG', 'm'],
      [0.34, 0, 0.66, 0.32, 'COUNTER 0', 'd'], [0.34, 0.34, 0.66, 0.32, 'COUNTER 1', 'd'], [0.34, 0.68, 0.66, 0.32, 'COUNTER 2', 'd']] },
    '8255': { a: 1.3, b: [[0, 0, 0.3, 0.34, 'DATA BUS BUFFER', 'i'], [0, 0.36, 0.3, 0.3, 'READ WRITE CONTROL', 'l'], [0, 0.68, 0.3, 0.32, 'CONTROL REG', 'm'],
      [0.32, 0, 0.3, 0.49, 'GROUP A CONTROL', 'l'], [0.32, 0.51, 0.3, 0.49, 'GROUP B CONTROL', 'l'], [0.64, 0, 0.36, 0.3, 'PORT A', 'i'],
      [0.64, 0.32, 0.36, 0.17, 'PORT C UPPER', 'i'], [0.64, 0.51, 0.36, 0.17, 'PORT C LOWER', 'i'], [0.64, 0.7, 0.36, 0.3, 'PORT B', 'i']] },
    '8237': { a: 1.35, b: [[0, 0, 0.2, 0.46, 'CH0 ADDR COUNT', 'd'], [0.21, 0, 0.2, 0.46, 'CH1 ADDR COUNT', 'd'], [0.42, 0, 0.2, 0.46, 'CH2 ADDR COUNT', 'd'],
      [0.63, 0, 0.2, 0.46, 'CH3 ADDR COUNT', 'd'], [0.85, 0, 0.15, 0.46, 'ADDR BUFFERS', 'i'], [0, 0.5, 0.4, 0.5, 'TIMING AND CONTROL', 'l'],
      [0.42, 0.5, 0.28, 0.5, 'PRIORITY ENCODER', 'l'], [0.72, 0.5, 0.28, 0.5, 'COMMAND MODE REGS', 'm']] },
    '8288': { a: 1.3, b: [[0, 0, 0.45, 0.48, 'STATUS DECODER', 'l'], [0.47, 0, 0.53, 0.48, 'COMMAND LOGIC', 'l'],
      [0, 0.52, 0.45, 0.48, 'CONTROL SIGNAL GEN', 'l'], [0.47, 0.52, 0.53, 0.48, 'OUTPUT DRIVERS', 'i']] },
    '8284A': { a: 1.3, b: [[0, 0, 0.4, 0.55, 'CRYSTAL OSC', 'a'], [0.42, 0, 0.28, 0.55, 'DIVIDE BY 3', 'l'], [0.72, 0, 0.28, 0.55, 'CLK DRIVERS', 'i'],
      [0, 0.58, 0.48, 0.42, 'READY SYNC', 'l'], [0.5, 0.58, 0.5, 0.42, 'RESET SYNC', 'l']] },
    '8282': slicePlan(8, 'L', 'STB OE CONTROL'),
    '8286': slicePlan(8, 'T', 'T OE CONTROL'),
    '74LS245': slicePlan(8, 'T', 'DIR G CONTROL'),
    '74LS138': { a: 1.25, b: [[0, 0, 0.26, 1, 'INPUT BUFFERS', 'i'], [0.28, 0, 0.18, 1, 'ENABLE', 'l'],
      [0.48, 0, 0.52, 0.48, '3-TO-8 DECODER', 'l'], [0.48, 0.52, 0.52, 0.48, 'Y0-Y7 DRIVERS', 'i']] },
    '74LS74': { a: 1.3, b: [[0, 0, 0.48, 1, 'D FLIP-FLOP 1', 'l'], [0.52, 0, 0.48, 1, 'D FLIP-FLOP 2', 'l']] },
    '6845': { a: 1.25, b: [[0, 0, 0.3, 0.4, 'BUS INTERFACE', 'i'], [0, 0.42, 0.3, 0.58, 'REGISTERS', 'm'], [0.32, 0, 0.34, 0.48, 'HORIZ TIMING', 'l'],
      [0.32, 0.5, 0.34, 0.5, 'VERT TIMING', 'l'], [0.68, 0, 0.32, 0.48, 'REFRESH ADDR', 'd'], [0.68, 0.5, 0.32, 0.5, 'CURSOR CTRL', 'l']] },
    // a floppy controller in the style of the NEC 765
    'FDC': { a: 1.3, b: [[0, 0, 0.28, 0.5, 'HOST INTERFACE', 'i'], [0, 0.52, 0.28, 0.48, 'COMMAND STATUS REGS', 'm'], [0.3, 0, 0.4, 1, 'SEQUENCER', 'r'],
      [0.72, 0, 0.28, 0.5, 'DATA SEPARATOR IF', 'a'], [0.72, 0.52, 0.28, 0.48, 'DRIVE INTERFACE', 'i']] },
    '2364': { a: 1.3, b: [[0, 0, 0.62, 0.68, 'CELL ARRAY', 'r'], [0.64, 0, 0.36, 0.68, 'X DECODER', 'l'], [0, 0.7, 0.62, 0.3, 'Y DECODER', 'l'],
      [0.64, 0.7, 0.36, 0.3, 'OUTPUT BUFFERS', 'i']] },
    'VGAC': { a: 1.0, b: [[0, 0, 0.3, 0.32, 'CPU INTERFACE', 'i'], [0.32, 0, 0.36, 0.32, 'SEQUENCER', 'l'], [0.7, 0, 0.3, 0.32, 'CRTC', 'l'],
      [0, 0.35, 0.3, 0.3, 'GRAPHICS LATCHES', 'm'], [0.32, 0.35, 0.2, 0.3, 'ALU ROTATE', 'd'], [0.54, 0.35, 0.16, 0.3, 'BIT MASK', 'd'],
      [0.72, 0.35, 0.28, 0.3, 'ATTRIBUTE CTRL', 'l'], [0, 0.68, 0.5, 0.32, 'MEMORY CONTROLLER', 'l'], [0.52, 0.68, 0.24, 0.32, 'DAC INTERFACE', 'i'],
      [0.78, 0.68, 0.22, 0.32, 'CLOCK SELECT', 'a']] },
    'RAMDAC': { a: 1.3, b: [[0, 0, 0.5, 0.6, 'PALETTE RAM 256X18', 'm'], [0.52, 0, 0.15, 0.6, 'DAC RED', 'a'], [0.68, 0, 0.15, 0.6, 'DAC GREEN', 'a'],
      [0.84, 0, 0.16, 0.6, 'DAC BLUE', 'a'], [0, 0.63, 0.3, 0.37, 'BUS INTERFACE', 'i'], [0.32, 0.63, 0.3, 0.37, 'PIXEL MASK', 'l'], [0.64, 0.63, 0.36, 0.37, 'PIXEL PORT', 'i']] },
    '9216': { a: 1.3, b: [[0, 0, 0.5, 1, 'PLL', 'a'], [0.52, 0, 0.48, 1, 'DATA SEPARATOR', 'l']] },
    // 80286: four units. Address unit on top, bus unit in the middle, instruction and
    // execution units below (a stylized floor plan with the real functional blocks).
    '80286': { a: 1.04, tag: '80286', b: [
      [0, 0, 0.34, 0.3, 'SEGMENT CACHES', 'm'], [0.36, 0, 0.16, 0.3, 'OFFSET ADDER', 'd'], [0.54, 0, 0.16, 0.3, 'PHYSICAL ADDER', 'd'],
      [0.72, 0, 0.28, 0.3, 'PROTECTION CHECK', 'l'],
      [0, 0.32, 0.2, 0.3, 'ADDRESS DRIVERS', 'i'], [0.22, 0.32, 0.18, 0.3, 'PREFETCHER', 'l'], [0.42, 0.32, 0.2, 0.3, 'PREFETCH QUEUE', 'm'],
      [0.64, 0.32, 0.16, 0.3, 'PROC EXT INTERFACE', 'l'], [0.82, 0.32, 0.18, 0.3, 'BUS CONTROL', 'l'],
      [0, 0.64, 0.24, 0.36, 'INSTRUCTION DECODER', 'l'], [0.26, 0.64, 0.14, 0.36, 'DECODED QUEUE', 'm'],
      [0.42, 0.64, 0.16, 0.36, 'REGISTERS', 'd'], [0.6, 0.64, 0.14, 0.36, 'ALU', 'd'], [0.76, 0.64, 0.24, 0.36, 'CONTROL ROM', 'r']] },
    '82288': { a: 1.3, b: [[0, 0, 0.45, 0.48, 'STATUS DECODER', 'l'], [0.47, 0, 0.53, 0.48, 'COMMAND LOGIC', 'l'],
      [0, 0.52, 0.45, 0.48, 'CONTROL SIGNAL GEN', 'l'], [0.47, 0.52, 0.53, 0.48, 'OUTPUT DRIVERS', 'i']] },
    '82284': { a: 1.3, b: [[0, 0, 0.4, 0.55, 'CRYSTAL OSC', 'a'], [0.42, 0, 0.28, 0.55, 'PCLK DIVIDE BY 2', 'l'], [0.72, 0, 0.28, 0.55, 'CLK DRIVERS', 'i'],
      [0, 0.58, 0.48, 0.42, 'READY SYNC', 'l'], [0.5, 0.58, 0.5, 0.42, 'RESET SYNC', 'l']] },
    '8042': { a: 1.3, b: [[0, 0, 0.34, 0.5, '8-BIT CPU', 'l'], [0.36, 0, 0.38, 0.5, 'ROM 2 KB', 'r'], [0.76, 0, 0.24, 0.5, 'RAM 128 B', 'm'],
      [0, 0.53, 0.24, 0.47, 'HOST INTERFACE', 'i'], [0.26, 0.53, 0.2, 0.47, 'TIMER', 'd'], [0.48, 0.53, 0.25, 0.47, 'PORT 1', 'i'],
      [0.75, 0.53, 0.25, 0.47, 'PORT 2 A20 RESET', 'i']] },
    'MC146818': { a: 1.3, b: [[0, 0, 0.26, 0.5, 'OSCILLATOR', 'a'], [0.28, 0, 0.22, 0.5, 'DIVIDER CHAIN', 'l'], [0.52, 0, 0.48, 0.5, 'CLOCK CALENDAR', 'd'],
      [0, 0.53, 0.3, 0.47, 'BUS INTERFACE', 'i'], [0.32, 0.53, 0.42, 0.47, 'CMOS RAM 50 B', 'm'], [0.76, 0.53, 0.24, 0.47, 'ALARM PERIODIC IRQ', 'l']] },
    'PAL16L8': { a: 1.3, b: [[0, 0, 0.62, 1, 'AND ARRAY', 'r'], [0.64, 0, 0.16, 1, 'OR GATES', 'l'], [0.82, 0, 0.18, 1, 'OUTPUTS', 'i']] },
    '74LS175': { a: 1.3, b: [[0, 0, 0.23, 1, 'FF 1', 'l'], [0.25, 0, 0.23, 1, 'FF 2', 'l'], [0.5, 0, 0.23, 1, 'FF 3', 'l'], [0.75, 0, 0.25, 1, 'FF 4', 'l']] },
  };
  DIE_PLANS['80287'] = Object.assign({}, DIE_PLANS['8087'], { tag: '80287' });
  DIE_PLANS['80387'] = Object.assign({}, DIE_PLANS['8087'], { tag: '80387' });
  // 80486: the cache and the floating-point unit take large parts of the die
  DIE_PLANS['80486'] = { a: 1.08, tag: 'i486', b: [
    [0, 0, 0.3, 0.46, 'CACHE 8 KB', 'm'], [0.32, 0, 0.14, 0.22, 'BUS INTERFACE', 'i'], [0.32, 0.24, 0.14, 0.22, 'PREFETCHER', 'm'],
    [0.48, 0, 0.16, 0.14, 'TLB', 'm'], [0.48, 0.16, 0.16, 0.14, 'PAGE WALKER', 'l'], [0.48, 0.32, 0.16, 0.14, 'PAGE ADDER', 'd'],
    [0.66, 0, 0.18, 0.22, 'SEGMENT CACHES', 'm'], [0.66, 0.24, 0.09, 0.22, 'LINEAR ADDER', 'd'], [0.76, 0.24, 0.08, 0.22, 'LIMIT CHECK', 'l'],
    [0.86, 0, 0.14, 0.46, 'INSTRUCTION DECODER', 'l'],
    [0, 0.5, 0.3, 0.5, 'CONTROL ROM', 'r'], [0.32, 0.5, 0.14, 0.5, 'REGISTERS', 'd'], [0.48, 0.5, 0.1, 0.5, 'ALU', 'd'], [0.6, 0.5, 0.08, 0.5, 'BARREL SHIFTER', 'd'],
    [0.7, 0.5, 0.12, 0.24, 'REGISTER STACK', 'm'], [0.84, 0.5, 0.16, 0.24, 'EXPONENT', 'd'], [0.7, 0.76, 0.3, 0.24, 'MANTISSA', 'd']] };
  // Pentium (P5): the code cache and the data cache at the left, the two pipes in the middle,
  // the control ROM at the right, the FPU along the bottom (after the real floor plan).
  DIE_PLANS['80586'] = { a: 1.1, tag: 'P5', b: [
    [0, 0, 0.24, 0.34, 'CODE CACHE 8 KB', 'm'], [0.26, 0, 0.12, 0.16, 'CODE TLB', 'm'], [0.26, 0.18, 0.12, 0.16, 'BRANCH TARGET BUFFER', 'm'],
    [0.4, 0, 0.32, 0.16, 'BUS INTERFACE', 'i'], [0.4, 0.18, 0.16, 0.16, 'PREFETCH BUFFERS', 'm'], [0.58, 0.18, 0.14, 0.16, 'INSTRUCTION DECODE', 'l'],
    [0.74, 0, 0.26, 0.34, 'CONTROL ROM', 'r'],
    [0, 0.36, 0.24, 0.34, 'DATA CACHE 8 KB', 'm'], [0.26, 0.36, 0.12, 0.16, 'DATA TLB', 'm'], [0.26, 0.54, 0.12, 0.16, 'PAGE UNIT', 'l'],
    [0.4, 0.36, 0.16, 0.34, 'U PIPE', 'd'], [0.58, 0.36, 0.14, 0.34, 'V PIPE', 'd'], [0.74, 0.36, 0.26, 0.16, 'REGISTERS', 'd'], [0.74, 0.54, 0.26, 0.16, 'SEGMENT UNIT', 'l'],
    [0, 0.72, 0.2, 0.28, 'ALU', 'd'], [0.22, 0.72, 0.16, 0.28, 'BARREL SHIFTER', 'd'], [0.4, 0.72, 0.2, 0.28, 'FPU REGISTERS', 'm'],
    [0.62, 0.72, 0.2, 0.28, 'FPU ADDER', 'd'], [0.84, 0.72, 0.16, 0.28, 'FPU MULTIPLIER', 'd']] };
  // Pentium Pro (P6): the in-order front end at the top, the out-of-order core in the middle,
  // the memory units and the bus at the bottom (after the real floor plan).
  DIE_PLANS['80686'] = { a: 1.15, tag: 'P6', b: [
    [0, 0, 0.22, 0.3, 'L1 CODE CACHE', 'm'], [0.24, 0, 0.12, 0.14, 'CODE TLB', 'm'], [0.24, 0.16, 0.12, 0.14, 'BTB', 'm'],
    [0.38, 0, 0.2, 0.3, 'DECODERS', 'l'], [0.6, 0, 0.14, 0.3, 'MSROM', 'r'], [0.76, 0, 0.24, 0.14, 'RAT', 'm'], [0.76, 0.16, 0.24, 0.14, 'RETIREMENT REGISTERS', 'd'],
    [0, 0.32, 0.36, 0.3, 'ROB', 'm'], [0.38, 0.32, 0.26, 0.3, 'RESERVATION STATION', 'l'],
    [0.66, 0.32, 0.17, 0.14, 'PORT 0 IEU FEU', 'd'], [0.66, 0.48, 0.17, 0.14, 'PORT 1 IEU JEU', 'd'], [0.85, 0.32, 0.15, 0.3, 'FPU', 'd'],
    [0, 0.64, 0.18, 0.36, 'LOAD UNIT', 'd'], [0.2, 0.64, 0.18, 0.36, 'STORE UNIT', 'd'], [0.4, 0.64, 0.2, 0.36, 'MEMORY ORDER BUFFER', 'l'],
    [0.62, 0.64, 0.22, 0.36, 'L1 DATA CACHE', 'm'], [0.86, 0.64, 0.14, 0.17, 'DATA TLB', 'm'], [0.86, 0.83, 0.14, 0.17, 'BUS INTERFACE', 'i']] };
  // Sound Blaster chips
  DIE_PLANS['CT1351'] = { a: 1.3, b: [[0, 0, 0.3, 0.46, 'HOST INTERFACE', 'i'], [0, 0.5, 0.3, 0.5, 'DMA REQUEST', 'l'], [0.32, 0, 0.36, 0.62, 'CPU CORE 8051', 'l'],
    [0.7, 0, 0.3, 0.46, 'ROM 4 KB', 'r'], [0.7, 0.5, 0.3, 0.2, 'RAM 128 B', 'm'], [0.32, 0.66, 0.36, 0.34, 'TIMER', 'd'], [0.7, 0.72, 0.3, 0.28, 'DAC PORT', 'i']] };
  DIE_PLANS['YM3812'] = { a: 1.3, b: [[0, 0, 0.28, 0.46, 'REGISTER FILE', 'm'], [0, 0.5, 0.28, 0.5, 'TIMERS', 'l'], [0.3, 0, 0.22, 0.48, 'PHASE GENERATOR', 'd'],
    [0.54, 0, 0.22, 0.48, 'ENVELOPE GENERATOR', 'd'], [0.78, 0, 0.22, 0.48, 'LOG-SIN ROM', 'r'], [0.3, 0.52, 0.22, 0.48, 'OPERATOR UNIT', 'd'],
    [0.54, 0.52, 0.22, 0.48, 'RHYTHM NOISE', 'l'], [0.78, 0.52, 0.22, 0.48, 'SERIAL OUT', 'i']] };
  DIE_PLANS['YM3014B'] = { a: 1.4, b: [[0, 0, 0.3, 1, 'SHIFT REGISTER', 'l'], [0.32, 0, 0.4, 1, 'DAC 10-BIT', 'a'], [0.74, 0, 0.26, 1, 'BUFFER AMP', 'a']] };
  DIE_PLANS['CT1336'] = { a: 1.0, b: [[0, 0, 0.48, 0.48, 'ISA DECODE', 'l'], [0.52, 0, 0.48, 0.48, 'ADDRESS LATCH', 'l'], [0, 0.52, 0.48, 0.48, 'IRQ DMA SELECT', 'l'], [0.52, 0.52, 0.48, 0.48, 'DATA BUFFER', 'i']] };
  DIE_PLANS['TDA1013'] = { a: 1.4, b: [[0, 0, 0.5, 1, 'VOLUME CONTROL', 'a'], [0.52, 0, 0.48, 1, 'POWER AMP', 'a']] };
  // 80386: segmentation and paging on top, bus, prefetch and decode in the middle, the
  // execution unit below (a stylized floor plan with the real functional blocks).
  DIE_PLANS['80386'] = { a: 1.05, tag: '80386', b: [
    [0, 0, 0.26, 0.3, 'SEGMENT CACHES', 'm'], [0.28, 0, 0.14, 0.3, 'LINEAR ADDER', 'd'], [0.44, 0, 0.14, 0.3, 'LIMIT CHECK', 'l'],
    [0.6, 0, 0.22, 0.3, 'TLB', 'm'], [0.84, 0, 0.16, 0.14, 'PAGE WALKER', 'l'], [0.84, 0.16, 0.16, 0.14, 'PAGE ADDER', 'd'],
    [0, 0.32, 0.22, 0.28, 'BUS INTERFACE', 'i'], [0.24, 0.32, 0.18, 0.28, 'PREFETCH QUEUE', 'm'], [0.44, 0.32, 0.3, 0.28, 'INSTRUCTION DECODER', 'l'],
    [0.76, 0.32, 0.24, 0.28, 'DECODED QUEUE', 'm'],
    [0, 0.62, 0.2, 0.38, 'REGISTERS', 'd'], [0.22, 0.62, 0.14, 0.38, 'ALU', 'd'], [0.38, 0.62, 0.14, 0.38, 'MULTIPLY DIVIDE', 'd'],
    [0.54, 0.62, 0.12, 0.38, 'PROTECTION TEST', 'l'], [0.68, 0.62, 0.32, 0.38, 'CONTROL ROM', 'r']] };
  DIE_PLANS['8254'] = DIE_PLANS['8253'];
  DIE_PLANS['41256'] = DIE_PLANS['4164'];
  DIE_PLANS['27128'] = DIE_PLANS['2764'];
  DIE_PLANS['27256'] = DIE_PLANS['2764'];
  DIE_PLANS['4464'] = DIE_PLANS['4164'];
  DIE_PLANS['74LS573'] = slicePlan(8, 'L', 'LE OE CONTROL');
  // The 8086 block names that the live activity uses, in the 80286 floor plan.
  // The 8086 unit names that the trace models use, in the 80386 floor plan.
  const BLK_386 = { 'ADDRESS ADDER': 'LINEAR ADDER', 'PHYSICAL ADDER': 'LINEAR ADDER', 'OFFSET ADDER': 'LINEAR ADDER', 'SEGMENT REGS': 'SEGMENT CACHES',
    QUEUE: 'PREFETCH QUEUE', DECODER: 'INSTRUCTION DECODER', 'MICROCODE ROM': 'CONTROL ROM', FLAGS: 'ALU', 'INTERRUPTS TIMING': 'CONTROL ROM',
    'BUS CONTROL': 'BUS INTERFACE', 'PROTECTION CHECK': 'PROTECTION TEST' };
  // on the 80486 the FPU units are on the CPU die; the 8087 names map to them
  const BLK_486 = Object.assign({}, BLK_386, { QUEUE: 'PREFETCHER', 'DECODED QUEUE': 'INSTRUCTION DECODER', 'MULTIPLY DIVIDE': 'ALU', 'PROTECTION TEST': 'LIMIT CHECK',
    'QUEUE TRACKER': 'INSTRUCTION DECODER', CONTROL: 'CONTROL ROM', STATUS: 'CONTROL ROM' });
  // the unit names of the older models (and the 8087) in the Pentium floor plan
  const BLK_586 = { 'ADDRESS ADDER': 'SEGMENT UNIT', 'PHYSICAL ADDER': 'SEGMENT UNIT', 'OFFSET ADDER': 'SEGMENT UNIT', 'LINEAR ADDER': 'SEGMENT UNIT',
    'LIMIT CHECK': 'SEGMENT UNIT', 'PROTECTION CHECK': 'SEGMENT UNIT', 'PROTECTION TEST': 'SEGMENT UNIT', 'SEGMENT REGS': 'SEGMENT UNIT', 'SEGMENT CACHES': 'SEGMENT UNIT',
    QUEUE: 'PREFETCH BUFFERS', 'PREFETCH QUEUE': 'PREFETCH BUFFERS', PREFETCHER: 'PREFETCH BUFFERS',
    DECODER: 'INSTRUCTION DECODE', 'INSTRUCTION DECODER': 'INSTRUCTION DECODE', 'DECODED QUEUE': 'INSTRUCTION DECODE', 'QUEUE TRACKER': 'INSTRUCTION DECODE',
    'MICROCODE ROM': 'CONTROL ROM', 'INTERRUPTS TIMING': 'CONTROL ROM', CONTROL: 'CONTROL ROM', STATUS: 'CONTROL ROM', FLAGS: 'ALU', 'MULTIPLY DIVIDE': 'ALU',
    'BUS CONTROL': 'BUS INTERFACE', TLB: 'DATA TLB', 'PAGE WALKER': 'PAGE UNIT', 'PAGE ADDER': 'PAGE UNIT', 'CACHE 8 KB': 'DATA CACHE 8 KB',
    'REGISTER STACK': 'FPU REGISTERS', EXPONENT: 'FPU ADDER', MANTISSA: 'FPU MULTIPLIER' };
  // the unit names of the older models in the Pentium Pro floor plan
  const BLK_686 = Object.assign({}, BLK_586, { 'SEGMENT UNIT': 'LOAD UNIT', 'PREFETCH BUFFERS': 'DECODERS', 'INSTRUCTION DECODE': 'DECODERS', 'CONTROL ROM': 'MSROM',
    'ADDRESS ADDER': 'LOAD UNIT', 'PHYSICAL ADDER': 'LOAD UNIT', 'OFFSET ADDER': 'LOAD UNIT', 'LINEAR ADDER': 'LOAD UNIT', 'LIMIT CHECK': 'LOAD UNIT',
    'PROTECTION CHECK': 'MSROM', 'PROTECTION TEST': 'MSROM', 'SEGMENT REGS': 'RETIREMENT REGISTERS', 'SEGMENT CACHES': 'RETIREMENT REGISTERS',
    QUEUE: 'DECODERS', 'PREFETCH QUEUE': 'DECODERS', PREFETCHER: 'DECODERS', DECODER: 'DECODERS', 'INSTRUCTION DECODER': 'DECODERS', 'DECODED QUEUE': 'DECODERS', 'QUEUE TRACKER': 'DECODERS',
    'MICROCODE ROM': 'MSROM', 'INTERRUPTS TIMING': 'MSROM', CONTROL: 'MSROM', STATUS: 'MSROM', FLAGS: 'PORT 0 IEU FEU', ALU: 'PORT 0 IEU FEU', 'MULTIPLY DIVIDE': 'PORT 0 IEU FEU',
    'BARREL SHIFTER': 'PORT 0 IEU FEU', 'U PIPE': 'PORT 0 IEU FEU', 'V PIPE': 'PORT 1 IEU JEU', 'BRANCH TARGET BUFFER': 'BTB', REGISTERS: 'RETIREMENT REGISTERS',
    'BUS CONTROL': 'BUS INTERFACE', TLB: 'DATA TLB', 'DATA TLB': 'DATA TLB', 'PAGE WALKER': 'LOAD UNIT', 'PAGE ADDER': 'LOAD UNIT', 'PAGE UNIT': 'LOAD UNIT',
    'CACHE 8 KB': 'L1 DATA CACHE', 'CODE CACHE 8 KB': 'L1 CODE CACHE', 'DATA CACHE 8 KB': 'L1 DATA CACHE',
    'REGISTER STACK': 'FPU', EXPONENT: 'FPU', MANTISSA: 'FPU', 'FPU REGISTERS': 'FPU', 'FPU ADDER': 'FPU', 'FPU MULTIPLIER': 'FPU' });
  const BLK_286 = { 'ADDRESS ADDER': 'PHYSICAL ADDER', 'SEGMENT REGS': 'SEGMENT CACHES', QUEUE: 'PREFETCH QUEUE', DECODER: 'INSTRUCTION DECODER',
    'MICROCODE ROM': 'CONTROL ROM', FLAGS: 'ALU', 'INTERRUPTS TIMING': 'BUS CONTROL' };
  const DIE_TINT = { m: '#35487f', r: '#563b74', d: '#2b6664', l: '#695632', i: '#6c4149', a: '#386a47' };

  // The lines of a unit name in a w x h box (always horizontal): all the ways to put the words
  // on 1 to 5 lines; the result is the one with the largest letter size s (fewer lines when the
  // sizes are almost the same). A long word can break after a '-' or a '/'.
  function labelLines(label, w, h) {
    const words = String(label).split(/\s+|(?<=[-/])/).filter(Boolean);
    const n = Math.min(words.length, 6);
    let best = { lines: [label], s: 0 };
    for (let mask = 0; mask < 1 << Math.max(0, n - 1); mask++) {
      const lines = [];
      let cur = words[0];
      for (let k = 1; k < words.length; k++) {
        const cut = k < n && (mask >> (k - 1)) & 1, glue = /[-/]$/.test(words[k - 1]) ? '' : ' ';
        if (cut) { lines.push(cur); cur = words[k]; } else cur += glue + words[k];
      }
      lines.push(cur);
      if (lines.length > 5) continue;
      const k = lines.length, tw = Math.max(...lines.map(l => strokeTextWidth(l, 1)));
      const s = Math.min(w * 0.86 / tw, h * 0.86 / (1.55 * k - 0.55), h * 0.3);
      if (s > best.s * (k > best.lines.length ? 1.08 : 1)) best = { lines, s };
    }
    return best;
  }
  // Paint the inside of a package on a canvas: cavity, lead frame, die with its floor
  // plan, bond pads and gold bond wires. x runs along the package, y across it.
  // S = canvas px per base px (1 for the normal texture); vis = the part in view, in base px.
  // turn: the view turns the die picture -90 degrees (a chip with rot in the Top view). Then the
  // labels turn +90 degrees in the picture, so that they read horizontally in the view.
  function drawInterior(g, cw, ch, d, part, S = 1, vis = null, turn = false) {
    const plan = DIE_PLANS[part] || DIE_PLANS['74LS74'];
    let seed = 7;
    for (const c of part) seed = (seed * 31 + c.charCodeAt(0)) % 2147483646 + 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const cav = g.createLinearGradient(0, 0, 0, ch);
    cav.addColorStop(0, '#1d1524'); cav.addColorStop(0.5, '#0c0911'); cav.addColorStop(1, '#1d1524');
    g.fillStyle = cav; g.fillRect(0, 0, cw, ch);
    const Lo = dieLayout(cw, ch, d, part);
    const { dh, dw, dx, dy, pm } = Lo;
    const pad = g.createLinearGradient(dx, dy, dx + dw, dy + dh);
    pad.addColorStop(0, '#7a5c26'); pad.addColorStop(1, '#4b3818');
    g.fillStyle = pad; g.fillRect(dx - pm, dy - pm, dw + 2 * pm, dh + 2 * pm);
    // lead frame fingers from each pin to the bond shelf around the die
    const ppx = Lo.ppx;
    const wires = [];
    {
      for (const pn of Lo.pins) {
        const [px, ey] = pn.o, { e, p } = pn;
        const w0 = pn.pw * ppx * 0.56, w1 = Math.max(1.4, w0 * 0.4);
        const ang = Math.atan2(e[1] - ey, e[0] - px), nx = -Math.sin(ang), ny = Math.cos(ang);
        const gr = g.createLinearGradient(px, ey, e[0], e[1]);
        gr.addColorStop(0, '#4b4556'); gr.addColorStop(0.6, '#857d92'); gr.addColorStop(1, '#b3aac0');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(px + nx * w0 / 2, ey + ny * w0 / 2); g.lineTo(e[0] + nx * w1 / 2, e[1] + ny * w1 / 2);
        g.lineTo(e[0] - nx * w1 / 2, e[1] - ny * w1 / 2); g.lineTo(px - nx * w0 / 2, ey - ny * w0 / 2);
        g.closePath(); g.fill();
        g.fillStyle = '#c9a85c'; g.fillRect(e[0] - w1 * 0.4, e[1] - w1 * 0.4, w1 * 0.8, w1 * 0.8);
        wires.push([e, p]);
      }
    }
    // silicon
    const sg = g.createLinearGradient(dx, dy, dx + dw, dy + dh);
    sg.addColorStop(0, '#2f2a48'); sg.addColorStop(1, '#1b2434');
    g.fillStyle = sg; g.fillRect(dx, dy, dw, dh);
    const { ix, iy, iw, ih } = Lo;
    const blocks = [];
    const noiseA = S > 2.5 ? clamp(1.6 - S / 5, 0, 1) : 1;   // coarse speckle fades as the fine structure appears
    let bi = 0;
    for (const { x, y, w, h, label, kind } of Lo.blocks) {
      bi++;
      if (w < 2 || h < 2) continue;
      g.fillStyle = DIE_TINT[kind] || DIE_TINT.l;
      g.fillRect(x, y, w, h);
      g.save();
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      if (kind === 'm') {
        const st = Math.max(1.4, h / 36);
        g.strokeStyle = 'rgba(190,210,255,0.3)'; g.lineWidth = 0.5;
        g.beginPath();
        for (let yy = y; yy < y + h; yy += st) { g.moveTo(x, yy); g.lineTo(x + w, yy); }
        for (let xx = x; xx < x + w; xx += st * 1.6) { g.moveTo(xx, y); g.lineTo(xx, y + h); }
        g.stroke();
      } else if (kind === 'r') {
        g.fillStyle = 'rgba(240,215,255,0.45)';
        const st = Math.max(1.6, h / 30);
        for (let yy = y + 1; yy < y + h; yy += st) for (let xx = x + 1; xx < x + w; xx += st) if (rnd() < 0.5) g.fillRect(xx, yy, st * 0.5, st * 0.5);
      } else if (kind === 'd') {
        const n = 16, st = h / n;
        for (let k = 0; k < n; k++) { g.fillStyle = k % 2 ? 'rgba(160,255,230,0.12)' : 'rgba(0,0,0,0.12)'; g.fillRect(x, y + k * st, w, st); }
        g.fillStyle = `rgba(220,255,245,${(0.18 * noiseA).toFixed(3)})`;
        for (let k = 0; k < w * h / 30 && k < 300; k++) g.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 3, 0.7);
      } else if (kind === 'i') {
        g.fillStyle = 'rgba(255,215,220,0.22)';
        for (let xx = x + 1; xx < x + w; xx += 3) g.fillRect(xx, y + h * 0.12, 1.2, h * 0.76);
      } else if (kind === 'a') {
        g.strokeStyle = 'rgba(200,255,210,0.3)'; g.lineWidth = 0.8;
        for (let r = 2; r < Math.max(w, h); r += 3) { g.beginPath(); g.arc(x + w / 2, y + h / 2, r, 0, TAU); g.stroke(); }
      } else {
        for (let k = 0; k < w * h / 14 && k < 500; k++) {
          g.fillStyle = rnd() < 0.5 ? `rgba(255,232,180,${(0.28 * noiseA).toFixed(3)})` : `rgba(40,20,10,${(0.25 * noiseA).toFixed(3)})`;
          g.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 3.5, 1 + rnd() * 2);
        }
      }
      if (S > 1.6) microDetail(g, x, y, w, h, kind, S, vis || [0, 0, cw, ch], bi);
      g.restore();
      g.strokeStyle = 'rgba(236,228,245,0.38)'; g.lineWidth = 0.8;
      g.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
      blocks.push([x, y, w, h, label]);
    }
    // metal routing over the blocks
    g.strokeStyle = 'rgba(225,225,240,0.16)'; g.lineWidth = Math.max(0.6, dh * 0.006);
    g.beginPath();
    for (let k = 0; k < 12; k++) {
      const yy = iy + rnd() * ih, xx = ix + rnd() * iw;
      g.moveTo(ix, yy); g.lineTo(ix + iw, yy); g.moveTo(xx, iy); g.lineTo(xx, iy + ih);
    }
    g.stroke();
    // labels: they fade when the fine structure takes over
    g.save();
    g.globalAlpha = S > 3 ? clamp(1.6 - S / 9, 0.18, 1) : 1;
    // (S: the scale of a detail tile; a tile has about 1 canvas px for each screen px, so 26 / S keeps
    // a name at about 26 px on the screen when the camera is close)
    const sMax = Math.min(Math.min(dw, dh) * 0.042, 26 / Math.max(1, S));
    for (const [x, y, w, h, label] of blocks) {
      // the name is always horizontal: in a narrow unit it goes on more lines (the words one
      // under the other), at the largest size that fits, and not larger than sMax
      const fit = turn ? labelLines(label, h, w) : labelLines(label, w, h), lines = fit.lines, s = Math.min(fit.s, sMax);
      if (s < 1.6) continue;
      g.save(); g.translate(x + w / 2, y + h / 2);
      if (turn) g.rotate(Math.PI / 2);
      lines.forEach((ln, k) => {
        const yy = (k - (lines.length - 1) / 2) * s * 1.55 - s / 2;
        g.strokeStyle = 'rgba(8,4,14,0.78)'; g.lineWidth = s * 0.4;
        strokeTextCanvas(g, ln, 0, yy, s, 1.5, 'center');
        g.strokeStyle = '#f7f0ff'; g.lineWidth = Math.max(0.7, s * 0.14);
        strokeTextCanvas(g, ln, 0, yy, s, 1.5, 'center');
      });
      g.restore();
    }
    g.restore();
    // seal ring, bond pads
    g.strokeStyle = '#b8a060'; g.lineWidth = Math.max(0.8, dh * 0.012);
    g.strokeRect(dx + 1, dy + 1, dw - 2, dh - 2);
    const ps = Math.max(2, dh * 0.05);
    g.fillStyle = '#ddd6ca';
    for (const [, p] of wires) g.fillRect(p[0] - ps / 2, p[1] - ps / 2, ps, ps);
    if (plan.tag) {
      g.strokeStyle = 'rgba(246,210,122,0.8)'; g.lineWidth = Math.max(0.8, pm * 0.09);
      strokeTextCanvas(g, 'A86 ' + plan.tag, dx, dy + dh + pm * 0.3, pm * 0.5, 1.5);
    }
    // iridescent sheen on the glass
    const sh = g.createLinearGradient(dx, dy, dx + dw, dy + dh);
    sh.addColorStop(0, 'rgba(180,140,255,0.22)'); sh.addColorStop(0.35, 'rgba(95,212,255,0.1)');
    sh.addColorStop(0.65, 'rgba(125,255,154,0.08)'); sh.addColorStop(1, 'rgba(246,210,122,0.2)');
    g.globalCompositeOperation = 'screen';
    g.fillStyle = sh; g.fillRect(dx, dy, dw, dh);
    g.globalCompositeOperation = 'source-over';
    // bond wires: a shadow, the gold wire and a highlight
    const bw = Math.max(0.8, dh * 0.013);
    for (const [e, p] of wires) {
      const mx = (e[0] + p[0]) / 2 + (e[0] - p[0]) * 0.08, my = (e[1] + p[1]) / 2 + (e[1] - p[1]) * 0.08 - dh * 0.03;
      for (const [st, lw, ox] of [['rgba(0,0,0,0.5)', bw * 1.3, 1.2], ['#e3b24f', bw, 0], ['rgba(255,244,210,0.8)', bw * 0.35, -0.3]]) {
        g.strokeStyle = st; g.lineWidth = lw;
        g.beginPath(); g.moveTo(p[0] + ox, p[1] + ox); g.quadraticCurveTo(mx + ox, my + ox, e[0] + ox, e[1] + ox); g.stroke();
      }
    }
  }
  // Finer structures of a die for a close view. They appear in steps as the zoom grows
  // (S = canvas px per base px), and only the part in view (vis, base px) is drawn.
  // Stylized, but true to the kind of circuit: memory cells, ROM bits, standard-cell rows.
  const MICRO_CELLS = ['INV', 'NAND2', 'NOR2', 'AOI21', 'DFF', 'MUX2', 'XOR2', 'NAND3', 'LATCH', 'BUF', 'OAI22', 'TBUF'];
  function microDetail(g, x, y, w, h, kind, S, vis, bi) {
    const vx0 = Math.max(x, vis[0]), vy0 = Math.max(y, vis[1]), vx1 = Math.min(x + w, vis[2]), vy1 = Math.min(y + h, vis[3]);
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const hsh = (i, j, k = 0) => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + bi * 19.37) * 43758.5453; return v - Math.floor(v); };
    const px = 1 / S;
    const span = (a0, a1, org, p) => [Math.max(0, Math.floor((a0 - org) / p)), Math.ceil((a1 - org) / p)];
    const label = (text, cx, cy, size, col) => {
      g.strokeStyle = 'rgba(6,3,12,0.8)'; g.lineWidth = size * 0.42;
      strokeTextCanvas(g, text, cx, cy - size / 2, size, 1.4, 'center');
      g.strokeStyle = col; g.lineWidth = Math.max(px, size * 0.13);
      strokeTextCanvas(g, text, cx, cy - size / 2, size, 1.4, 'center');
    };
    if (kind === 'm') {                       // DRAM / register cells
      const pr = Math.max(1.4, h / 36) / 2, pc = pr * 1.6;
      if (pr * S < 4) return;
      const [r0, r1] = span(vy0, vy1, y, pr), [c0, c1] = span(vx0, vx1, x, pc);
      g.fillStyle = 'rgba(255,125,110,0.34)';   // word lines (polysilicon)
      for (let r = r0; r < r1; r++) g.fillRect(vx0, y + r * pr + pr * 0.3, vx1 - vx0, pr * 0.13);
      g.fillStyle = 'rgba(210,222,255,0.45)';   // bit lines (metal)
      for (let c = c0; c < c1; c++) g.fillRect(x + c * pc + pc * 0.44, vy0, pc * 0.12, vy1 - vy0);
      if (pr * S < 9) return;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
        const cx = x + c * pc, cy = y + r * pr, on = hsh(r, c) < 0.5;
        g.fillStyle = on ? 'rgba(135,195,255,0.6)' : 'rgba(90,120,200,0.38)';   // storage capacitor
        g.fillRect(cx + pc * 0.07, cy + pr * 0.52, pc * 0.32, pr * 0.36);
        g.fillStyle = 'rgba(245,245,255,0.85)';                                 // bit-line contact
        g.fillRect(cx + pc * 0.44, cy + pr * 0.08, pc * 0.12, pr * 0.14);
        if (pr * S > 34) {                                                       // access transistor
          g.fillStyle = 'rgba(120,230,170,0.35)';
          g.fillRect(cx + pc * 0.12, cy + pr * 0.2, pc * 0.38, pr * 0.26);
        }
        if (pr * S > 70) label(on ? '1' : '0', cx + pc * 0.23, cy + pr * 0.7, pr * 0.2, on ? '#d8ecff' : 'rgba(216,236,255,0.55)');
      }
    } else if (kind === 'r') {                // ROM: a transistor where a bit is programmed
      const st = Math.max(1.6, h / 30) / 3;
      if (st * S < 4) return;
      const [r0, r1] = span(vy0, vy1, y, st), [c0, c1] = span(vx0, vx1, x, st);
      g.fillStyle = 'rgba(255,140,120,0.3)';
      for (let r = r0; r < r1; r++) g.fillRect(vx0, y + r * st + st * 0.42, vx1 - vx0, st * 0.16);
      g.fillStyle = 'rgba(225,215,255,0.4)';
      for (let c = c0; c < c1; c++) g.fillRect(x + c * st + st * 0.08, vy0, st * 0.14, vy1 - vy0);
      if (st * S < 7) return;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (hsh(r, c, 3) < 0.5) {
        g.fillStyle = 'rgba(250,232,255,0.72)';
        g.fillRect(x + c * st + st * 0.3, y + r * st + st * 0.3, st * 0.42, st * 0.42);
        if (st * S > 36) { g.fillStyle = 'rgba(30,10,40,0.85)'; g.fillRect(x + c * st + st * 0.45, y + r * st + st * 0.45, st * 0.12, st * 0.12); }
      }
    } else if (kind === 'a') {                // analog: resistor meanders and capacitor plates
      if (S < 3) return;
      g.lineWidth = Math.max(px, h * 0.012);
      const n = 7;
      for (let k = 0; k < n; k++) {
        const yy = y + h * (0.12 + 0.76 * k / (n - 1));
        g.strokeStyle = k % 2 ? 'rgba(255,170,140,0.5)' : 'rgba(200,255,210,0.45)';
        g.beginPath(); g.moveTo(x + w * 0.08, yy);
        for (let j = 0; j < 14; j++) g.lineTo(x + w * (0.08 + 0.42 * (j + 1) / 14), yy + (j % 2 ? -1 : 1) * h * 0.035);
        g.stroke();
      }
      for (let k = 0; k < 4; k++) {
        const s0 = Math.min(w, h) * (0.3 - k * 0.06);
        g.strokeStyle = 'rgba(190,255,205,0.5)';
        g.strokeRect(x + w * 0.74 - s0 / 2, y + h / 2 - s0 / 2, s0, s0);
      }
    } else {                                  // logic, datapath and I/O: rows of cells
      const rh = kind === 'd' ? h / 16 : kind === 'i' ? h / 3 : Math.max(2.2, h / 14);
      if (rh * S < 10) return;
      const u = rh * 0.2;                     // one gate pitch
      const [r0, r1] = span(vy0, vy1, y, rh);
      for (let r = r0; r < r1; r++) {
        const ry = y + r * rh;
        if (ry > y + h) break;
        g.fillStyle = 'rgba(232,234,248,0.5)';          // VDD and GND rails
        g.fillRect(vx0, ry, vx1 - vx0, rh * 0.07);
        g.fillRect(vx0, ry + rh * 0.93, vx1 - vx0, rh * 0.07);
        if (u * S < 4.5) continue;
        let cx = x, k = 0;
        const col = kind === 'd' ? 0 : r;               // datapath: cells line up in bit slices
        while (cx < vx1 && k < 5000) {
          const nu = kind === 'i' ? 6 + Math.floor(hsh(col, k, 5) * 10) : 2 + Math.floor(hsh(col, k, 5) * 5);
          const cwid = nu * u;
          if (cx + cwid >= vx0) {
            g.fillStyle = 'rgba(120,225,165,0.3)';                              // p and n diffusion
            g.fillRect(cx + u * 0.3, ry + rh * 0.16, cwid - u * 0.6, rh * 0.24);
            g.fillRect(cx + u * 0.3, ry + rh * 0.6, cwid - u * 0.6, rh * 0.24);
            g.fillStyle = 'rgba(255,118,108,0.55)';                             // polysilicon gates
            for (let j = 1; j < nu; j++) g.fillRect(cx + j * u - u * 0.08, ry + rh * 0.12, u * 0.16, rh * 0.76);
            if (u * S > 12) {
              g.fillStyle = 'rgba(250,250,255,0.85)';                           // contacts
              for (let j = 0; j < nu; j++) {
                g.fillRect(cx + j * u + u * 0.4, ry + rh * 0.24, u * 0.14, u * 0.14);
                g.fillRect(cx + j * u + u * 0.4, ry + rh * 0.68, u * 0.14, u * 0.14);
              }
              g.fillStyle = 'rgba(190,205,255,0.4)';                            // metal 1 inside the cell
              g.fillRect(cx + u * 0.4, ry + rh * 0.47, cwid - u * 0.8, rh * 0.06);
            }
            g.strokeStyle = 'rgba(236,228,245,0.3)'; g.lineWidth = px;
            g.strokeRect(cx, ry + rh * 0.07, cwid, rh * 0.86);
            if (rh * S > 110 && cwid * S > 60) label(MICRO_CELLS[Math.floor(hsh(col, k, 9) * MICRO_CELLS.length)], cx + cwid / 2, ry + rh * 0.5, rh * 0.11, '#f2e6c4');
          }
          cx += cwid; k++;
        }
      }
      // metal 2 routing over the rows, with vias
      if (rh * S > 16) {
        const pitch = rh * 0.5;
        const [c0, c1] = span(vx0, vx1, x, pitch);
        for (let c = c0; c < c1; c++) {
          if (hsh(c, 0, 11) > 0.28) continue;
          const xx = x + c * pitch + pitch * 0.4;
          const a0 = y + hsh(c, 1, 12) * h * 0.6, a1 = Math.min(y + h, a0 + h * (0.15 + hsh(c, 2, 13) * 0.5));
          g.fillStyle = 'rgba(175,200,255,0.3)';
          g.fillRect(xx, Math.max(a0, vy0), pitch * 0.18, Math.max(0, Math.min(a1, vy1) - Math.max(a0, vy0)));
          g.fillStyle = 'rgba(255,255,255,0.7)';
          g.fillRect(xx - pitch * 0.02, a0, pitch * 0.22, pitch * 0.22);
          g.fillRect(xx - pitch * 0.02, a1 - pitch * 0.22, pitch * 0.22, pitch * 0.22);
        }
      }
    }
  }
  // Geometry of a die on its package canvas (base px). drawInterior and the live overlays
  // both use it, so the overlays line up with the texture and with the detail tile.
  const DIE_LAYOUT = new Map();
  // A route between two ends on a die layout (base px of the die picture), for the flows of
  // the trace in all views: Dijkstra over a grid of the die (the channels between the units
  // cost 1, a cell of another unit costs 6, each turn 3), over (cell, direction). An end is
  // { blocks: [indices of the layout blocks] } or { pt: [x, y] } (a pad). Returns points:
  // the first on the edge of the start unit (its output port) or at the pad, the last on the
  // edge of the goal unit (its input port) or at the pad. The grid and the routes stay on L.
  // The flow of the trace (the same rules in the Top view and here): the token moves at a
  // constant speed on the screen (FLOW_PX_S at the normal speed), crosses a unit with a card in
  // FLOW_UNIT_S (in, the work, out: FLOW_IN of the time for each way), and passes other units in
  // FLOW_PASS_S. The camera zooms to a unit with a card (FLOW_UNIT_M times the unit), and its
  // track changes at most CAM_DLZ (log zoom) and CAM_DPX (screen px) in each frame.
  const FLOW_PX_S = 420, FLOW_UNIT_S = 3.0, FLOW_PASS_S = 1.0, FLOW_IN = 0.28, FLOW_UNIT_M = 1.6;
  const CAM_DLZ = 0.03, CAM_DPX = 18;
  // Explain (xpPlan): the token speed on the screen, the time of the work in a unit with a card,
  // and the camera move between two shots (the token waits). The user multiplies the first two.
  // The moves between two stops are one run with a smooth speed profile (xpPlan, xpEase); a unit
  // that only passes the value stops it XP_PASS ms. The camera move takes longer for a large zoom
  // or a long way (xpCutMs).
  const XP_PX_S = 280, XP_WORK_S = 3.6, XP_CUT = 1400, XP_PASS = 800;
  const XP_UNIT_Z = 0.8;   // the close shot of a unit: 0.8 of the normal unit view (closer)
  // The smooth zoom and pan of van Wijk and Nuij: from the view a = [x, z, width] to b. The
  // result: S (the length of the path) and at(u) (u 0..1) -> [x, z, width].
  function zoomPath(a, b) {
    const rho = 1.4, r2 = rho * rho, r4 = r2 * r2, ux = b[0] - a[0], uz = b[1] - a[1], d2 = ux * ux + uz * uz, w0 = a[2], w1 = b[2];
    if (d2 < 1e-12) {
      const S = Math.log(w1 / w0) / rho;
      return { S: Math.abs(S), at: u => [a[0] + ux * u, a[1] + uz * u, w0 * Math.exp(rho * S * u)] };
    }
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1), b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
    const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1), S = (q1 - q0) / rho;
    return { S, at: u => {
      const s = u * S, c0 = Math.cosh(q0), v = w0 / (r2 * d1) * (c0 * Math.tanh(rho * s + q0) - Math.sinh(q0));
      return [a[0] + v * ux, a[1] + v * uz, w0 * c0 / Math.cosh(rho * s + q0)];
    } };
  }
  function layRoute(L, from, to) {
    if (!L._grid) {
      const cs = Math.min(L.dw, L.dh) / 44, nx = Math.ceil(L.dw / cs), ny = Math.ceil(L.dh / cs);
      const cost = new Uint8Array(nx * ny).fill(1), owner = new Int16Array(nx * ny).fill(-1);
      L.blocks.forEach((b, k) => {
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
          const px = L.dx + (x + 0.5) * cs, py = L.dy + (y + 0.5) * cs;
          if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h) { cost[y * nx + x] = 6; owner[y * nx + x] = k; }
        }
      });
      L._grid = { x0: L.dx, y0: L.dy, cs, nx, ny, cost, owner, routes: new Map() };
    }
    const G = L._grid, key = JSON.stringify([from.blocks || from.pt, to.blocks || to.pt]);
    if (G.routes.has(key)) return G.routes.get(key).map(q => q.slice());
    const end = e => {
      if (e.blocks) {
        const ks = new Set(e.blocks), cells = [];
        for (let y = 0; y < G.ny; y++) for (let x = 0; x < G.nx; x++) {
          const i = y * G.nx + x;
          if (!ks.has(G.owner[i])) continue;
          if (x === 0 || y === 0 || x === G.nx - 1 || y === G.ny - 1 || !ks.has(G.owner[i - 1]) || !ks.has(G.owner[i + 1]) || !ks.has(G.owner[i - G.nx]) || !ks.has(G.owner[i + G.nx])) cells.push(i);
        }
        return { cells, ks };
      }
      const x = clamp(Math.floor((e.pt[0] - G.x0) / G.cs), 0, G.nx - 1), y = clamp(Math.floor((e.pt[1] - G.y0) / G.cs), 0, G.ny - 1);
      return { cells: [y * G.nx + x], ks: new Set(), pt: e.pt };
    };
    const A = end(from), Bn = end(to), N = G.nx * G.ny;
    const goal = new Uint8Array(N); for (const c of Bn.cells) goal[c] = 1;
    const dist = new Float64Array(N * 5).fill(Infinity), prev = new Int32Array(N * 5).fill(-1), heap = [];
    const push = (d, st) => { heap.push([d, st]); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const c of A.cells) { dist[c * 5 + 4] = 0; push(0, c * 5 + 4); }
    const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
    let fin = -1;
    while (heap.length) {
      const [d, st] = pop();
      if (d > dist[st]) continue;
      const c = (st / 5) | 0, dir = st % 5;
      if (goal[c]) { fin = st; break; }
      const cx = c % G.nx, cy = (c / G.nx) | 0;
      for (let k = 0; k < 4; k++) {
        const x = cx + DX[k], y = cy + DY[k];
        if (x < 0 || y < 0 || x >= G.nx || y >= G.ny) continue;
        const n = y * G.nx + x, own = G.owner[n];
        const w = own >= 0 && (A.ks.has(own) || Bn.ks.has(own)) ? 1 : G.cost[n];
        const nd = d + w + (dir !== 4 && dir !== k ? 3 : 0), ns = n * 5 + k;
        if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = st; push(nd, ns); }
      }
    }
    let pts = [];
    if (fin >= 0) {
      const cells = [];
      for (let st = fin; st >= 0; st = prev[st]) cells.push((st / 5) | 0);
      cells.reverse();
      pts = cells.map(c => [G.x0 + ((c % G.nx) + 0.5) * G.cs, G.y0 + (((c / G.nx) | 0) + 0.5) * G.cs]);
    }
    if (!pts.length) pts = [A.pt || [G.x0, G.y0], Bn.pt || [G.x0, G.y0]];
    if (A.pt) pts.unshift(A.pt.slice(), [pts[0][0], A.pt[1]]);
    if (Bn.pt) pts.push([pts[pts.length - 1][0], Bn.pt[1]], Bn.pt.slice());
    // the ports: on the edge of the unit, in the direction of the wire
    const snap = (a, b, e) => {
      if (!e.blocks) return;
      const bl = e.blocks.map(k => L.blocks[k]).find(q => q && a[0] >= q.x - 1e-6 && a[0] <= q.x + q.w + 1e-6 && a[1] >= q.y - 1e-6 && a[1] <= q.y + q.h + 1e-6);
      if (!bl) return;
      if (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])) a[0] = b[0] > a[0] ? bl.x + bl.w : bl.x; else a[1] = b[1] > a[1] ? bl.y + bl.h : bl.y;
    };
    if (pts.length > 1) { snap(pts[0], pts[1], from); snap(pts[pts.length - 1], pts[pts.length - 2], to); }
    const out = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const a = out[out.length - 1], b = pts[k], c = pts[k + 1];
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-6) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    G.routes.set(key, out);
    return out.map(q => q.slice());
  }
  function dieLayout(cw, ch, d, part) {
    const key = `${part}|${d.pins}|${d.L}|${cw}|${ch}|${d.quad ? 1 : 0}`;
    if (DIE_LAYOUT.has(key)) return DIE_LAYOUT.get(key);
    const plan = DIE_PLANS[part] || DIE_PLANS['74LS74'];
    let dh = Math.min(ch * 0.64, cw * 0.34), dw = dh * plan.a;
    if (dw > cw * 0.5) { dw = cw * 0.5; dh = dw / plan.a; }
    if (d.quad) { dh = Math.min(cw, ch) * 0.46 / Math.max(1, plan.a); dw = dh * plan.a; }
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2, pm = dh * 0.14;
    const half = d.pins / 2, ppx = cw / (d.L * 0.97);
    const sm = Math.min(dh * 0.22, (ch - dh) * 0.3), cy = ch / 2;
    const shelf = [dx - sm, dy - sm, dx + dw + sm, dy + dh + sm];
    const ring = [dx + dh * 0.05, dy + dh * 0.05, dx + dw - dh * 0.05, dy + dh * 0.95];
    const along = (r, t, bottom) => {
      const [x0, y0, x1, y1] = r, yy = bottom ? y1 : y0, a = Math.abs(yy - cy), bl = x1 - x0, tot = 2 * a + bl;
      let s = t * tot;
      if (s < a) return [x0, cy + (yy - cy) * (s / a)];
      s -= a;
      if (s < bl) return [x0 + s, yy];
      s -= bl;
      return [x1, yy + (cy - yy) * (s / a)];
    };
    const pins = [];
    if (d.quad) {
      // four sides of leads; o = the lead at the package edge, e = its finger end, p = the bond pad
      const n = d.pins / 4, ppy = ch / (d.W * 0.94), lp = d.lp;
      for (let sd = 0; sd < 4; sd++) {
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * lp, t = (i + 0.5) / n;
          const pin = { i: sd * n + i, pw: lp };
          if (sd === 0 || sd === 2) {
            const b = sd === 2;
            Object.assign(pin, { bottom: b, lx: off, lz: (b ? 1 : -1) * d.W / 2, o: [(off + d.L * 0.485) * ppx, b ? ch : 0],
              e: [lerp(shelf[0], shelf[2], t), b ? shelf[3] : shelf[1]], p: [lerp(ring[0], ring[2], t), b ? ring[3] : ring[1]] });
          } else {
            const r = sd === 1;
            Object.assign(pin, { bottom: null, lx: (r ? 1 : -1) * d.L / 2, lz: off, o: [r ? cw : 0, (off + d.W * 0.47) * ppy],
              e: [r ? shelf[2] : shelf[0], lerp(shelf[1], shelf[3], t)], p: [r ? ring[2] : ring[0], lerp(ring[1], ring[3], t)] });
          }
          pins.push(pin);
        }
      }
    } else {
      for (const bottom of [false, true]) {
        for (let i = 0; i < half; i++) {
          const lx = (i - (half - 1) / 2) * PITCH, t = (i + 0.5) / half;
          const px = (lx + d.L * 0.485) * ppx, ey = bottom ? ch : 0;
          pins.push({ i, bottom, lx, lz: d.row ? (bottom ? 1 : -1) * d.row / 2 : undefined, px, ey, o: [px, ey], pw: PITCH, e: along(shelf, t, bottom), p: along(ring, t, bottom) });
        }
      }
    }
    const pr = Math.max(3, dh * 0.11);
    const ix = dx + pr, iy = dy + pr, iw = dw - 2 * pr, ih = dh - 2 * pr;
    const blocks = plan.b.map(([bx, by, bw, bh, label, kind]) => ({ x: ix + bx * iw + 0.8, y: iy + by * ih + 0.8, w: bw * iw - 1.6, h: bh * ih - 1.6, label, kind }));
    const L = { plan, dh, dw, dx, dy, pm, half, ppx, pins, ix, iy, iw, ih, blocks };
    DIE_LAYOUT.set(key, L);
    return L;
  }
  // The decoded facts of one bus cycle (shared by the board, the dies and the runner).
  function busInfo(e) {
    const kind = e.k === 'fetch' ? 'fetch' : e.type;
    const fpu = e.owner === 'fpu';
    const read = kind === 'fetch' || kind === 'memr' || kind === 'ior' || kind === 'inta';
    let dev = kind === 'inta' ? 'pic' : (e.dev || 'none');
    dev = DEV_ALIAS[dev] || dev;
    const addr = (e.addr >>> 0) & ADDR_MASK, width = e.width || 1, odd = addr & 1;
    const memDev = dev === 'ram' || dev === 'rom' || dev === 'vram' || dev === 'xram' || dev === 'vrom';
    let d16 = e.data & 0xFFFF;
    if (memDev && width === 1) d16 = odd ? (e.data & 0xFF) << 8 : e.data & 0xFF;
    if (!memDev) d16 = e.data & (width === 2 ? 0xFFFF : 0xFF);
    const lo = !memDev || width >= 2 || !odd, hi = memDev && (width >= 2 || odd);   // (4 and 8 bytes: both banks)
    return { kind, fpu, read, dev, addr, width, odd, memDev, d16, lo, hi };
  }
  const DAC_PORT = p => p >= 0x3C6 && p <= 0x3C9;
  const RB = M286 ? 9 : 8, CB = M286 ? 6 : 5;              // DRAM row/column bits, EPROM column bits
  const hexR = v => (M286 ? hex(v, 3) : hex2(v));
  const DEC_Y = M286 ? { ram: 0, rom: 1, pic: 2, pic2: 3, pit: 4, kbc: 5, rtc: 6, dma: 7, dma2: 7 } : { ram: 0, rom: 1, pic: 2, pit: 3, ppi: 4, dma: 5, nmi: 6 };
  // The block of an I/O chip that a port selects.
  function ioBlock(dev, port, read, idx = 0) {
    switch (dev) {
      case 'pic': case 'pic2': return (port & 1) ? 'IMR' : read ? 'IRR' : 'CONTROL LOGIC';
      case 'kbc': return port === 0x92 ? 'PORT 2 A20 RESET' : !read && (port & 4) ? '8-BIT CPU' : 'HOST INTERFACE';
      case 'rtc': return (port & 1) ? 'CMOS RAM 50 B' : 'BUS INTERFACE';
      case 'dma2': { const q = (port - 0xC0) >> 1; return q < 8 ? `CH${q >> 1} ADDR COUNT` : 'COMMAND MODE REGS'; }
      case 'fpu': return 'REGISTER STACK';
      case 'pit': return (port & 3) === 3 ? 'CONTROL WORD REG' : 'COUNTER ' + (port & 3);
      case 'ppi': return M286 ? 'FF ' + (1 + (port & 3)) : ['PORT A', 'PORT B', 'PORT C LOWER', 'CONTROL REG'][port & 3];
      case 'dma': return port < 8 ? `CH${port >> 1} ADDR COUNT` : 'COMMAND MODE REGS';
      case 'nmi': return 'D FLIP-FLOP 1';
      case 'fdc': return 'COMMAND STATUS REGS';
      case 'sbdsp': { const r = port & 0xF; return r === 6 ? 'CPU CORE 8051' : r === 0xA || r === 0xC || r === 0xE ? 'HOST INTERFACE' : r === 8 || r === 9 ? 'HOST INTERFACE' : 'HOST INTERFACE'; }
      case 'opl': return (port & 1) ? 'REGISTER FILE' : read ? 'TIMERS' : 'REGISTER FILE';
      case 'crtc':
        if (port === 0x3D4) return 'REGISTERS';
        if (port === 0x3D5) return idx <= 3 ? 'HORIZ TIMING' : idx <= 9 ? 'VERT TIMING' : idx <= 11 ? 'CURSOR CTRL' : idx <= 13 ? 'REFRESH ADDR' : 'CURSOR CTRL';
        return port === 0x3DA ? 'VERT TIMING' : 'BUS INTERFACE';
      case 'vgac':
        if (port === 0x3C0 || port === 0x3C1) return 'ATTRIBUTE CTRL';
        if (port === 0x3C4 || port === 0x3C5) return 'SEQUENCER';
        if (port === 0x3CE || port === 0x3CF) return 'ALU ROTATE';
        if (port === 0x3C2 || port === 0x3CC || port === 0x3CA) return 'CLOCK SELECT';
        if ((port & 0x3F4) === 0x3B4 || (port & 0x3F4) === 0x3D4 || port === 0x3BA || port === 0x3DA) return 'CRTC';
        return 'CPU INTERFACE';
      case 'dac': return port === 0x3C6 ? 'PIXEL MASK' : port === 0x3C9 ? 'PALETTE RAM 256X18' : 'BUS INTERFACE';
      default: return null;
    }
  }
  const IO_IN = { sbdsp: ['HOST INTERFACE'], opl: ['REGISTER FILE'], pic: ['DATA BUS BUFFER', 'READ WRITE LOGIC'], pit: ['DATA BUS BUFFER', 'READ WRITE LOGIC'], ppi: ['DATA BUS BUFFER', 'READ WRITE CONTROL'],
    dma: ['ADDR BUFFERS', 'TIMING AND CONTROL'], nmi: [], fdc: ['HOST INTERFACE'],
    crtc: ['BUS INTERFACE'], vgac: ['CPU INTERFACE'], dac: ['BUS INTERFACE'],
    pic2: ['DATA BUS BUFFER', 'READ WRITE LOGIC'], dma2: ['ADDR BUFFERS', 'TIMING AND CONTROL'], kbc: ['HOST INTERFACE'], rtc: ['BUS INTERFACE'], fpu: ['BUS INTERFACE'] };
  if (M286) IO_IN.ppi = [];

  // Live activity on an open die: block glows, one travelling signal path, marks (word
  // line, bit line) and one memory cell with its bit drawn as a digit. All in plane uv.
  const DFX_FS = `
    uniform vec4 uBlk[16]; uniform float uAct[16]; uniform vec3 uCol[16]; uniform int uNB;
    uniform vec4 uSeg[16]; uniform float uSegS[16]; uniform int uNS;
    uniform float uHead; uniform float uTail; uniform float uPAmp; uniform float uPHold; uniform vec3 uPCol; uniform float uPW;
    uniform vec4 uMark[3]; uniform float uMarkA[3]; uniform vec3 uMarkC[3];
    uniform vec4 uCell; uniform float uCellA; uniform float uBit; uniform vec3 uCellC;
    uniform float uAsp; uniform float uTime; uniform float uMin;
    varying vec2 vUv;
    float boxD(vec2 q, vec4 r) {
      vec2 c = (r.xy + r.zw) * 0.5, h = (r.zw - r.xy) * 0.5;
      vec2 d = abs(q - c) - h;
      return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }
    void main() {
      vec2 S = vec2(uAsp, 1.0);
      vec2 q = vUv * S;
      float px = max(max(fwidth(q.x), fwidth(q.y)), 1e-7);   // one screen pixel in plane units
      vec3 c = vec3(0.0);
      for (int i = 0; i < 16; i++) {
        if (i >= uNB) break;
        float a = uAct[i];
        if (a < 0.003) continue;
        vec4 r = uBlk[i] * vec4(S, S);
        float dd = boxD(q, r);
        float sz = max(min(r.z - r.x, r.w - r.y), 1e-4);
        float inside = step(dd, 0.0);
        float fill = clamp(260.0 * px / sz, 0.0, 1.0);   // big on the screen: a thin, soft edge only
        float rw = clamp(sz * 0.08, px * 1.2, px * mix(2.5, 9.0, fill));
        float rim = inside * exp(dd / rw) + (1.0 - inside) * exp(-dd / (rw * 0.8)) * 0.7;
        float shim = 0.8 + 0.2 * sin((q.x * 0.7 + q.y) / sz * 9.0 - uTime * 0.005);
        c += uCol[i] * a * (inside * 0.1 * shim * fill + rim * mix(0.3, 0.8, fill));
      }
      if (uNS > 0 && (uPAmp > 0.002 || uPHold > 0.002)) {
        float best = 1e9, sAt = 0.0;
        for (int i = 0; i < 16; i++) {
          if (i >= uNS) break;
          vec2 a = uSeg[i].xy * S, b = uSeg[i].zw * S, ab = b - a;
          float L = length(ab);
          float t = clamp(dot(q - a, ab) / max(L * L, 1e-10), 0.0, 1.0);
          float dist = length(q - a - ab * t);
          if (dist < best) { best = dist; sAt = uSegS[i] + t * L; }
        }
        float pw = clamp(uPW, px * 1.4, px * 4.5);
        float x = uHead - sAt;
        float comet = x >= 0.0 ? exp(-x / uTail) : exp(x / (uTail * 0.12));
        float passed = smoothstep(-pw, pw, x);
        float I = uPAmp * comet + uPHold * passed;
        float core = exp(-pow(best / pw, 2.0)), halo = exp(-best / (pw * 4.0)) * 0.3;
        c += uPCol * I * (core + halo) + vec3(1.0) * core * uPAmp * comet * 0.45;
      }
      for (int i = 0; i < 3; i++) {
        if (uMarkA[i] < 0.003) continue;
        vec4 r = uMark[i] * vec4(S, S);
        float dd = boxD(q, r), th = max(min(r.z - r.x, r.w - r.y), 1e-5);
        float g = dd <= 0.0 ? 0.45 * clamp(14.0 * px / th, 0.25, 1.0) : exp(-dd / clamp(th * 1.5, px * 1.5, px * 6.0)) * 0.5 + exp(-dd / (px * 16.0)) * 0.1;
        c += uMarkC[i] * uMarkA[i] * g;
      }
      if (uCellA > 0.003) {
        vec4 r = uCell * vec4(S, S);
        float dd = boxD(q, r), th = max(min(r.z - r.x, r.w - r.y), 1e-5);
        vec3 col = uCellC * (dd <= 0.0 ? 0.4 : exp(-dd / clamp(th * 1.2, px * 2.0, px * 8.0)) * 0.9 + exp(-dd / (px * 26.0)) * 0.15);
        if (dd <= 0.0) {
          vec2 l = (q - r.xy) / max(r.zw - r.xy, vec2(1e-6));
          float dg = uBit > 0.5 ? step(abs(l.x - 0.5), 0.08) * step(abs(l.y - 0.5), 0.32)
                                : step(abs(length((l - 0.5) * vec2(1.7, 1.08)) - 0.27), 0.06);
          col += vec3(1.0) * dg * 1.1;
        }
        c += col * uCellA;
      }
      c = c / (1.0 + dot(c, vec3(0.3)) * 0.5);   // soft limit, so overlapping glows do not burn out
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`;

  // A soft round dot for sprites and particles.
  let dotTexCache = null;
  function dotTexture() {
    if (dotTexCache) return dotTexCache;
    const c = canvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    dotTexCache = new T.CanvasTexture(c);
    return dotTexCache;
  }
  // Polyline cuts (2D points with cumulative lengths S).
  const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function cutAt(pts, S, s) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (S[i] < s) out.push(pts[i]);
      else { out.push(lerpPt(pts[i - 1], pts[i], clamp((s - S[i - 1]) / ((S[i] - S[i - 1]) || 1), 0, 1))); break; }
    }
    return out;
  }
  function cutFrom(pts, S, s) {
    for (let i = 1; i < pts.length; i++) {
      if (S[i] > s) return [lerpPt(pts[i - 1], pts[i], clamp((s - S[i - 1]) / ((S[i] - S[i - 1]) || 1), 0, 1))].concat(pts.slice(i));
    }
    return [pts[pts.length - 1]];
  }

  // ---------------------------------------------------------------------------
  const CSS = `
  .bv-root { position: absolute; inset: 0; overflow: hidden; }
  .bv-canvas { position: absolute; inset: 0; outline: none; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
  .bv-canvas.bv-drag { cursor: grabbing; }
  .bv-canvas.bv-hot { cursor: pointer; }
  .bv-canvas canvas { display: block; width: 100%; height: 100%; }
  .bv-canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--gold-hi); border-radius: var(--r); }
  .bv-vignette { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(130% 100% at 50% 42%, transparent 52%, color-mix(in srgb, var(--void) 78%, transparent) 100%); }
  .bv-top { position: absolute; left: 12px; top: 12px; z-index: 6; display: flex; flex-direction: column; align-items: flex-start; gap: 7px;
    max-width: calc(58% - 12px); pointer-events: none; }
  .bv-presets { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 999px; pointer-events: auto;
    background: color-mix(in srgb, var(--void) 70%, transparent); border: 1px solid var(--line-soft);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .bv-btn { border: 0; background: transparent; color: var(--muted); font: 600 12px/1 var(--sans); letter-spacing: .02em;
    padding: 7px 12px; border-radius: 999px; transition: color .2s, background .2s, box-shadow .2s; }
  .bv-btn:hover { color: var(--text); background: color-mix(in srgb, var(--ceramic-hi) 40%, transparent); }
  /* (a pressed camera view or switch: a quiet state; the bright fill is for the main actions only) */
  .bv-btn[aria-pressed="true"] { color: var(--gold-hi); background: color-mix(in srgb, var(--gold) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 70%, transparent); }
  .bv-btn:focus-visible { outline: 2px solid var(--gold-hi); outline-offset: 1px; }
  .bv-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 0 8px; list-style: none;
    font: 11px/1.2 var(--mono); color: var(--muted); }
  .bv-legend i { display: inline-block; width: 16px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle;
    background: currentColor; box-shadow: 0 0 8px currentColor; }
  .bv-legend span { color: var(--muted); }
  .bv-hint { margin: 0; padding: 0 8px; font: 11px/1.3 var(--sans); color: var(--faint); transition: opacity .8s; }
  .bv-hint.bv-gone { opacity: 0; }
  /* the meaning of a word of the unit work (the drawing in a unit, the unit card) */
  .bv-term { position: absolute; left: 0; top: 0; z-index: 10; width: max-content; max-width: min(360px, calc(100% - 24px)); padding: 8px 11px 9px;
    border-radius: 8px; background: color-mix(in srgb, var(--panel) 96%, transparent); border: 1px solid var(--line); box-shadow: 0 12px 28px -12px #000;
    font: 14px/1.45 var(--sans); color: var(--text); pointer-events: none; opacity: 0; transition: opacity .12s; }
  .bv-term.bv-on { opacity: 1; }
  /* Explain: the tag above the unit at work */
  .bv-utag { position: absolute; left: 0; top: 0; z-index: 5; max-width: min(520px, 70%); padding: 5px 11px 6px; border-radius: 8px; pointer-events: none;
    background: color-mix(in srgb, var(--panel) 92%, transparent); border: 1px solid var(--line); border-left: 3px solid var(--phosphor);
    font: 13.5px/1.35 var(--mono); color: var(--text); opacity: 0; transition: opacity .25s; will-change: transform; }
  .bv-utag b { color: var(--phosphor); margin-right: 8px; letter-spacing: .04em; }
  .bv-utag span { color: var(--text); }
  .bv-term b { display: block; margin-bottom: 2px; font: 700 13.5px var(--mono); color: var(--phosphor); }
  .bv-canvas.bv-help, .bv-canvas.bv-help canvas { cursor: help; }
  .bv-tip { position: absolute; left: 0; top: 0; z-index: 9; width: 420px; max-width: calc(100% - 24px); padding: 14px 16px 14px 18px;
    border-radius: 10px; pointer-events: none; opacity: 0; transition: opacity .15s;
    background: color-mix(in srgb, var(--panel) 90%, transparent); border: 1px solid var(--line);
    box-shadow: inset 3px 0 0 var(--bv-acc, var(--gold)), 0 18px 40px -14px var(--void);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  .bv-tip.bv-on { opacity: 1; }
  .bv-tip-head { display: flex; align-items: baseline; gap: 8px; }
  .bv-tip-ref { font: 600 13px var(--mono); color: var(--faint); }
  .bv-tip-name { font: 700 20px var(--mono); color: var(--bv-acc, var(--gold-hi)); }
  .bv-tip-kind { margin-left: auto; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
  .bv-tip-role { margin: 8px 0 10px; font-size: 16px; line-height: 1.5; color: var(--text); }
  .bv-tip-state { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; padding-top: 7px;
    border-top: 1px solid var(--line-soft); font: 14.5px/1.5 var(--mono); font-variant-numeric: tabular-nums; }
  .bv-tip-state dt { color: var(--faint); white-space: nowrap; }
  .bv-tip-state dd { margin: 0; color: var(--phosphor); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bv-fail { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); padding: 24px; text-align: center; }
  @media (max-width: 700px) {
    .bv-legend, .bv-hint { display: none; }
    .bv-top { left: 8px; top: 8px; max-width: calc(100% - 16px); }
    .bv-btn { padding: 6px 9px; font-size: 11px; }
    .bv-tip { width: 320px; }
  }`;

  const CSS2 = `
  .bv-canvas.bv-scratch { cursor: crosshair; }
  .bv-sep { width: 1px; margin: 5px 3px; background: var(--line); }
  .bv-pop { position: absolute; left: 0; top: 0; z-index: 8; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--gold);
    background: color-mix(in srgb, var(--panel2) 92%, transparent); color: var(--gold-hi); font: 600 12.5px/1 var(--sans);
    box-shadow: 0 10px 28px -8px var(--void), 0 0 16px -6px var(--gold); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .bv-pop:hover { background: var(--panel2); }
  .bv-pop:focus-visible { outline: 2px solid var(--gold-hi); outline-offset: 2px; }
  .bv-pop[hidden] { display: none; }
  .bv-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .bv-seg-label { align-self: center; padding: 0 4px 0 9px; font: 600 9.5px/1 var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--faint); }
  .bv-hud { position: absolute; left: 12px; top: 100px; z-index: 6; width: 312px; max-width: calc(100% - 24px); padding: 12px 14px 12px 16px;
    border-radius: 12px; pointer-events: none; background: color-mix(in srgb, var(--panel) 84%, transparent); border: 1px solid var(--line);
    box-shadow: inset 3px 0 0 var(--bv-leg, var(--cyan)), 0 18px 40px -16px var(--void);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  .bv-hud-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .bv-type { flex: none; padding: 4px 8px; border-radius: 999px; font: 700 10.5px/1 var(--mono); letter-spacing: .1em;
    color: var(--void); background: var(--bv-acc, var(--cyan)); }
  .bv-dev { min-width: 0; font: 600 13px/1.2 var(--sans); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bv-leg { margin: 9px 0 8px; min-height: 2.9em; font: 12.5px/1.45 var(--sans); color: var(--muted); }
  .bv-leg b { color: var(--bv-leg, var(--cyan)); font-weight: 700; }
  .bv-val { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .bv-hex { flex: none; min-width: 5.4ch; font: 700 21px/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--bv-leg, var(--cyan));
    text-shadow: 0 0 14px color-mix(in srgb, var(--bv-leg, var(--cyan)) 55%, transparent); }
  .bv-bits { display: flex; gap: 2px; flex-wrap: nowrap; min-width: 0; overflow: hidden; }
  .bv-bits i { flex: none; width: 7px; height: 13px; border-radius: 2px; background: var(--line); }
  .bv-bits i.bv-on { background: var(--bv-leg, var(--cyan)); box-shadow: 0 0 6px var(--bv-leg, var(--cyan)); }
  .bv-bits i.bv-gap { margin-left: 3px; }
  .bv-bits i[hidden] { display: none; }
  .bv-ts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 11px; }
  .bv-ts span { position: relative; padding-top: 8px; text-align: center; font: 600 10px/1 var(--mono); color: var(--faint); }
  .bv-ts span::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 4px; border-radius: 2px; background: var(--line); }
  .bv-ts i { position: absolute; left: 0; right: 0; top: 0; height: 4px; border-radius: 2px; background: var(--bv-leg, var(--cyan));
    transform-origin: left center; transform: scaleX(0); }
  .bv-ts span.bv-cur { color: var(--text); }
  .bv-ins { margin: 10px 0 0; font: 600 12.5px/1.2 var(--mono); color: var(--phosphor); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bv-mini { position: absolute; right: 12px; bottom: 56px; z-index: 6; width: 210px; height: 138px; border-radius: 10px; pointer-events: none;
    border: 1px solid var(--line-soft); background: color-mix(in srgb, var(--void) 72%, transparent);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  @media (max-width: 700px) {
    .bv-hud { top: auto; bottom: 58px; left: 8px; right: 8px; width: auto; padding: 8px 10px 9px 12px; }
    .bv-leg { min-height: 0; margin: 6px 0; }
    .bv-mini, .bv-seg-label { display: none; }
    .bv-hex { font-size: 17px; }
  }`;
  function injectStyle() {
    if (document.getElementById('bv-style')) return;
    const st = document.createElement('style');
    st.id = 'bv-style';
    st.textContent = CSS + CSS2;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Trace models: how a trace step goes through each kind of chip. One entry per die part
  // (a key of DIE_PLANS). For each phase of a bus cycle, a model lists the blocks that the
  // value passes, and for each block a card that shows how the block works (BlockPanel in
  // src/ui/blocks.js). To add a chip (for example a sound card), add a floor plan to
  // DIE_PLANS and a model to TRACE_MODELS; the journey code does not change.
  //   role 'cpu': out (address), status, in (data into the CPU), write (data out), inside
  //   role 'dev': addr, cmd, read, write
  // Each function gets ctx = { I, s, ev, m, e, part, row, col, bit, byte, phys, dev, port }
  // and returns a list of visits [[block label, card or null], ...].
  const SEG_IDX = { ES: 0, CS: 1, SS: 2, DS: 3 };
  const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
  const SREG = ['ES', 'CS', 'SS', 'DS'];
  const tcard = (kind, title, chip, sub, o) => Object.assign({ kind, title, chip, sub }, o || {});
  const STATUS_ROWS = M286
    ? [['000', 'interrupt acknowledge', 'INTA'], ['001', 'I/O read', 'IORC'], ['010', 'I/O write', 'IOWC'], ['100', 'halt', '—'],
      ['101', 'memory read (code: COD high)', 'MRDC'], ['110', 'memory write', 'MWTC'], ['111', 'passive', '—']]
    : [['000', 'interrupt acknowledge', 'INTA'], ['001', 'I/O read', 'IORC'], ['010', 'I/O write', 'IOWC'], ['011', 'halt', '—'],
      ['100', 'code fetch', 'MRDC'], ['101', 'memory read', 'MRDC'], ['110', 'memory write', 'MWTC'], ['111', 'passive', '—']];
  const statusCode = k => (M286 ? { inta: '000', ior: '001', iow: '010', halt: '100', fetch: '101', memr: '101', memw: '110' }
    : { inta: '000', ior: '001', iow: '010', halt: '011', fetch: '100', memr: '101', memw: '110' })[k] || '111';
  // The status of a bus cycle. Two units show it, each with its own text: the bus control of the
  // CPU sends it on its pins, and the status decoder of the bus controller decodes it.
  function statusCard(chip, I, title) {
    const code = statusCode(I.kind), row = STATUS_ROWS.find(r => r[0] === code) || STATUS_ROWS[STATUS_ROWS.length - 1];
    const pins = M286 ? 'M/IO, S1 and S0' : 'S2, S1 and S0';
    const sub = title === 'STATUS DECODER'
      ? `It decodes the status ${code}: ${row[1]}. ${row[2] === '—' ? 'It makes no command.' : `So it makes the command ${row[2]}.`}`
      : `It starts the bus cycle: it puts the status ${code} (${row[1]}) on the pins ${pins}.`;
    return tcard('status', title, chip, sub,
      { code, rows: STATUS_ROWS.map(r => ({ code: r[0], name: r[1], cmd: r[2] })), label: M286 ? 'M/IO S1 S0' : 'S2 S1 S0' });
  }
  const segBase = (cpu, seg) => (cpu.cache ? cpu.cache[SEG_IDX[seg] || 0].base : cpu.sregs[SEG_IDX[seg] || 0] << 4);
  function adderCard(title, chip, seg, base, off, r) {
    return tcard('adder', title, chip, M286 ? `The ${seg} base plus the offset gives the address.` : `${seg} × 16 plus the offset gives the 20-bit address.`,
      { width: ADDR_BITS, a: base & ADDR_MASK, b: off & 0xFFFF, cin: 0, r: r & ADDR_MASK, aLabel: M286 ? `${seg} base` : `${seg} × 16`, bLabel: 'offset', rLabel: 'address' });
  }
  function bufCard(title, chip, bits, value, dir, sub) {
    return tcard('buffer', title, chip, sub, { bits, value, dir, enable: dir === 'in' ? 'DT/R low, DEN' : 'DT/R high, DEN', label: dir === 'in' ? 'into the chip' : 'out of the chip' });
  }
  // Instruction decode fields of the first bytes (op, d, w, mod, reg, r/m).
  const MODRM_OPS = new Set([0x00, 0x01, 0x02, 0x03, 0x08, 0x09, 0x0A, 0x0B, 0x10, 0x11, 0x12, 0x13, 0x18, 0x19, 0x1A, 0x1B, 0x20, 0x21, 0x22, 0x23,
    0x28, 0x29, 0x2A, 0x2B, 0x30, 0x31, 0x32, 0x33, 0x38, 0x39, 0x3A, 0x3B, 0x62, 0x63, 0x69, 0x6B, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D,
    0x8E, 0x8F, 0xC0, 0xC1, 0xC4, 0xC5, 0xC6, 0xC7, 0xD0, 0xD1, 0xD2, 0xD3, 0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xF6, 0xF7, 0xFE, 0xFF, 0x80, 0x81, 0x82, 0x83]);
  function opcodeCard(chip, dec) {
    const b = dec.bytes || [], op = b[0] || 0, fields = [];
    if (op < 0x40 && (op & 7) < 4 || (op >= 0x84 && op <= 0x8B)) fields.push({ name: 'opcode', from: 7, to: 2, v: op >> 2 }, { name: 'd', from: 1, to: 1, v: (op >> 1) & 1 }, { name: 'w', from: 0, to: 0, v: op & 1 });
    else if (op >= 0xB0 && op <= 0xBF) fields.push({ name: 'opcode', from: 7, to: 4, v: op >> 4 }, { name: 'w', from: 3, to: 3, v: (op >> 3) & 1 }, { name: 'reg', from: 2, to: 0, v: op & 7 });
    else if (op >= 0x40 && op <= 0x5F) fields.push({ name: 'opcode', from: 7, to: 3, v: op >> 3 }, { name: 'reg', from: 2, to: 0, v: op & 7 });
    else fields.push({ name: 'opcode', from: 7, to: 0, v: op });
    if (MODRM_OPS.has(op) && b.length > 1) {
      const m = b[1];
      fields.push({ name: 'mod', from: 15, to: 14, v: m >> 6 }, { name: 'reg', from: 13, to: 11, v: (m >> 3) & 7 }, { name: 'r/m', from: 10, to: 8, v: m & 7 });
    }
    const text = String(dec.text || '').split(';')[0].trim();
    return tcard('opcode', 'DECODER', chip, `The decoder reads the bits of the opcode: "${text}".`, { bytes: b.slice(0, 6), text, fields });
  }
  function aluCard(chip, e) {
    const w = e.w === 16 ? 16 : 8, op = e.op, n = w === 16 ? 4 : 2;
    const sub = `${op} ${hex(e.a, n)}h, ${hex(e.b, n)}h gives ${hex(e.r, n)}h.`;
    if (/^(ADD|ADC|INC)$/.test(op)) return tcard('adder', 'ALU', chip, sub, { width: w, a: e.a, b: op === 'INC' ? 1 : e.b, cin: 0, r: e.r, aLabel: 'A', bLabel: 'B', rLabel: 'sum' });
    if (/^(SUB|SBB|CMP|DEC|NEG)$/.test(op)) return tcard('adder', 'ALU', chip, sub + (op === 'CMP' ? ' Only the flags keep the result.' : ''), { width: w, a: op === 'NEG' ? 0 : e.a, b: op === 'DEC' ? 1 : op === 'NEG' ? e.a : e.b, subtract: true, cin: 1, r: e.r, aLabel: 'A', bLabel: 'B', rLabel: 'difference' });
    if (/^(AND|OR|XOR|TEST|NOT)$/.test(op)) return tcard('logic', 'ALU', chip, sub, { op, width: w, a: e.a, b: e.b, r: e.r });
    if (/^(SHL|SAL|SHR|SAR|ROL|ROR|RCL|RCR)$/.test(op)) return tcard('shift', 'ALU', chip, sub, { op: op === 'SAL' ? 'SHL' : op, width: w, a: e.a, r: e.r, count: e.b || 1 });
    return tcard('text', 'ALU', chip, sub, { lines: [sub] });
  }
  function regCard(chip, m, writes, reads) {
    const cpu = m.cpu, last = writes[writes.length - 1];
    const seg = last && SREG.includes(last.r);
    const regs = seg ? SREG.map((nm, i) => ({ name: nm, v: cpu.sregs[i] })) : REG16.map((nm, i) => ({ name: nm, v: cpu.regs[i] }));
    const names = writes.map(w => `${w.r} gets ${hex(w.v, 4)}h`).join(', ');
    return tcard('regfile', seg ? 'SEGMENT REGS' : 'REGISTERS', chip, names ? names + '.' : 'The EU reads the registers.', { regs, write: last ? last.r : null, v: last ? last.v : 0, read: reads || [] });
  }
  const CPU_TRACE = {
    role: 'cpu',
    out(ctx) {
      const I = ctx.I, chip = NM.cpu, cpu = ctx.m.cpu;
      if (I.fpu) return [['BUS INTERFACE', tcard('text', 'BUS INTERFACE', NM.fpu, 'The coprocessor takes the bus and drives the address of its operand.', { lines: [`Operand address ${hexA(I.addr)}h`] })]];
      if (I.io) return [['BUS CONTROL', statusCard(chip, I, 'BUS CONTROL')]];
      const seg = (ctx.ev && ctx.ev.seg) || (I.kind === 'fetch' ? 'CS' : 'DS'), base = segBase(cpu, seg);
      const add = ['ADDRESS ADDER', adderCard(M286 ? 'PHYSICAL ADDER' : 'ADDRESS ADDER', chip, seg, base, I.addr - base, I.addr)];
      return ctx.short ? [add] : [add, ['BUS CONTROL', statusCard(chip, I, 'BUS CONTROL')]];
    },
    status(ctx) { return [['BUS CONTROL', statusCard(ctx.I.fpu ? NM.fpu : NM.cpu, ctx.I, 'BUS CONTROL')]]; },
    in(ctx) {
      const I = ctx.I, ev = ctx.ev || {}, chip = I.fpu ? NM.fpu : NM.cpu;
      if (I.fpu) return [['REGISTER STACK', tcard('text', 'REGISTER STACK', NM.fpu, 'The operand goes to the register stack.', { lines: [`Operand ${hex(I.data, I.width === 2 ? 4 : 2)}h`] })]];
      if (I.kind === 'fetch') {
        const q = ev.q || [], n = I.width === 2 && !(I.addr & 1) ? 2 : 1;
        return [['QUEUE', tcard('bytes', 'QUEUE', chip, `${n} code byte${n > 1 ? 's go' : ' goes'} into the prefetch queue (${q.length} of ${QSIZE}).`,
          { cells: q.map(v => ({ v })), cap: QSIZE, put: q.map((_, i) => i).slice(-n), take: [], note: 'from the bus' })]];
      }
      if (I.kind === 'inta') return [['INTERRUPTS TIMING', tcard('text', 'INTERRUPTS', chip, `The vector ${hex(I.data, 2)}h selects entry ${hex(I.data, 2)}h of the vector table.`, { lines: [`Vector ${hex(I.data, 2)}h`, `Table address ${hex(I.data * 4, 5)}h`] })]];
      return [['BUS CONTROL', bufCard('DATA IN', chip, I.width === 2 ? 16 : 8, I.data, 'in', `The value ${hex(I.data, I.width === 2 ? 4 : 2)}h comes in for the EU.`)]];
    },
    write(ctx) {
      const I = ctx.I, chip = I.fpu ? NM.fpu : NM.cpu;
      return [[I.fpu ? 'BUS INTERFACE' : 'BUS CONTROL', bufCard('DATA OUT', chip, I.width === 2 ? 16 : 8, I.data, 'out', `The value ${hex(I.data, I.width === 2 ? 4 : 2)}h goes out on the data pins.`)]];
    },
    inside(ctx) {
      const s = ctx.s, m = ctx.m, chip = s.unit === 'fpu' ? NM.fpu : NM.cpu, out = [];
      if (s.unit === 'fpu') {
        const f = (s.evs || []).find(e => e.k === 'fpu');
        return [['CONTROL', tcard('text', 'CONTROL', chip, `The ${chip} decodes "${f ? f.text : ''}".`, { lines: [f ? f.text : ''] })],
          ['REGISTER STACK', tcard('text', 'REGISTER STACK', chip, 'The register stack holds eight 80-bit values.', { lines: [`${f ? f.cycles : '?'} clocks`] })]];
      }
      const put = (label, cardV) => { const l = out[out.length - 1]; if (l && l[0] === label) l[1] = cardV || l[1]; else out.push([label, cardV]); };
      const evs = s.evs || [];
      const writes = [], p6 = [];   // p6: the 'uop', 'rat' and 'rob' events of the Pentium Pro (cards after the loop)
      for (const e of evs) {
        if (e.k === 'decode' && e.len) {
          const pop = evs.find(x => x.k === 'queue' && x.op === 'pop');
          const before = (e.bytes || []).concat(pop ? pop.q : []);
          put('QUEUE', tcard('bytes', 'QUEUE', chip, `The EU takes ${e.len} byte${e.len > 1 ? 's' : ''} from the queue.`, { cells: before.slice(0, QSIZE).map(v => ({ v })), cap: QSIZE, take: [...Array(Math.min(e.len, QSIZE)).keys()], put: [], note: 'to the decoder' }));
          put('DECODER', opcodeCard(chip, e));
        } else if (e.k === 'queue' && e.op === 'flush') {
          put('QUEUE', tcard('bytes', 'QUEUE', chip, 'The jump empties the queue. The BIU fetches from the new address.', { cells: [], cap: QSIZE, take: [], put: [], note: 'empty' }));
        } else if (e.k === 'ea') {
          const base = M286 ? segBase(m.cpu, e.seg) : (e.segv << 4);
          put('ADDRESS ADDER', adderCard(M286 ? 'OFFSET ADDER' : 'ADDRESS ADDER', chip, e.seg, base, e.off, e.phys));
        } else if (e.k === 'alu') put('ALU', aluCard(chip, e));
        else if (e.k === 'pipe' || e.k === 'btb') for (const [label, c] of P5_CARDS(e)) put(label, c);
        else if (e.k === 'uop' || e.k === 'rat' || e.k === 'rob') p6.push(e);
        else if (e.k === 'reg' && e.r !== 'IP') { writes.push(e); put(SREG.includes(e.r) ? 'SEGMENT REGS' : 'REGISTERS', regCard(chip, m, writes.filter(w => SREG.includes(w.r) === SREG.includes(e.r)))); }
        else if (e.k === 'flags' && e.old !== undefined && e.old !== e.v) {
          put('FLAGS', tcard('flags', 'FLAGS', chip, 'The ALU result sets the flags.', { old: e.old, v: e.v, names: ['CF', '', 'PF', '', 'AF', '', 'ZF', 'SF', 'TF', 'IF', 'DF', 'OF'] }));
        } else if (e.k === 'int') put('INTERRUPTS TIMING', tcard('text', 'INTERRUPTS', chip, `INT ${hex(e.vec, 2)}h: the CPU saves FLAGS, CS and IP, and loads the new CS:IP.`, { lines: [`Vector ${hex(e.vec, 2)}h`, `Table address ${hex(e.vec * 4, 5)}h`] }));
        else if (e.k === 'desc') put('SEGMENT REGS', tcard('text', M286 ? 'SEGMENT CACHES' : 'SEGMENT REGS', chip, `The ${e.sreg} descriptor cache loads.`, { lines: [`base ${hex(e.base, 6)}h`, `limit ${hex(e.limit, 4)}h`, `access ${hex(e.access, 2)}h`] }));
        else if (e.k === 'sys' || e.k === 'task') put(M286 ? 'PROTECTION CHECK' : 'MICROCODE ROM', tcard('text', M286 ? 'PROTECTION' : 'MICROCODE', chip, e.text || 'Task switch.', { lines: [e.text || `task ${hex(e.to || 0, 4)}h`] }));
      }
      for (const x of P6_CARDS(p6)) out.push(x);
      return out.length ? out : [['DECODER', null]];
    },
  };
  // A RAM bank is 8 chips of one bit: this chip gives (or keeps) one bit of the byte.
  function bankCard(ctx, dir) {
    const k = +(String(ctx.key || '').match(/(\d)$/) || [0, 0])[1], v = ctx.byte & 0xFF;
    return tcard('buffer', 'DATA I/O · 8 CHIPS', ctx.part, dir === 'out'
      ? `This chip gives bit ${k} (${(v >> k) & 1}). The 8 chips of the bank give D0–D7 at the same time: ${hex(v, 2)}h.`
      : `This chip keeps bit ${k} (${(v >> k) & 1}). Each of the 8 chips of the bank keeps one bit of ${hex(v, 2)}h.`,
      { bits: 8, value: v, dir, enable: 'CAS', label: 'D0–D7: one bit from each chip' });
  }
  const DRAM_TRACE = {
    role: 'dev',
    addr: ctx => [['ROW DEC', tcard('decoder', 'ROW DECODER', ctx.part, `RAS takes the row ${hex(ctx.row, 3)}h from the address pins.`,
      { bits: ctx.rb, value: ctx.row, inLabel: 'row address', outLabel: 'word lines' })]],
    cmd: ctx => [['CELL ARRAY', tcard('cells', 'CELL ARRAY', ctx.part, `The word line of row ${hex(ctx.row, 3)}h opens; the sense amplifiers read the row.`,
      { rows: 8, cols: 8, row: ctx.row & 7, col: ctx.col & 7, rowLabel: hex(ctx.row, 3) + 'h', colLabel: hex(ctx.col, 3) + 'h', bit: ctx.bit, write: !ctx.I.read, mem: 'dram' })]],
    read: ctx => [['COL DEC', tcard('mux', 'COLUMN DECODER', ctx.part, `CAS takes the column ${hex(ctx.col, 3)}h: the bit ${ctx.bit} goes to the output.`,
      { n: 1 << Math.min(ctx.cb, 5), sel: ctx.col & ((1 << Math.min(ctx.cb, 5)) - 1), value: ctx.bit, label: 'columns' })]]
      .concat(ctx.I.dev === 'ram' ? [['DATA IO', bankCard(ctx, 'out')]] : []),
    write: ctx => (ctx.I.dev === 'ram' ? [['DATA IO', bankCard(ctx, 'in')]] : []).concat([['COL DEC', tcard('mux', 'COLUMN DECODER', ctx.part, `CAS takes the column ${hex(ctx.col, 3)}h for the new bit.`,
      { n: 1 << Math.min(ctx.cb, 5), sel: ctx.col & ((1 << Math.min(ctx.cb, 5)) - 1), value: ctx.bit, label: 'columns' })],
      ['CELL ARRAY', tcard('cells', 'CELL ARRAY', ctx.part, `The cell (${hex(ctx.row, 3)}h, ${hex(ctx.col, 3)}h) keeps ${ctx.bit}.`,
        { rows: 8, cols: 8, row: ctx.row & 7, col: ctx.col & 7, rowLabel: hex(ctx.row, 3) + 'h', colLabel: hex(ctx.col, 3) + 'h', bit: ctx.bit, write: true, mem: 'dram' })]]),
  };
  const ROM_TRACE = {
    role: 'dev',
    addr: ctx => [['X DECODER', tcard('decoder', 'X DECODER', ctx.part, `The high address bits select row ${hex(ctx.row, 2)}h.`, { bits: 8, value: ctx.row, inLabel: 'row address', outLabel: 'word lines' })]],
    cmd: ctx => [['CELL ARRAY', tcard('cells', 'CELL ARRAY', ctx.part, `The word line of row ${hex(ctx.row, 2)}h opens the floating-gate cells.`,
      { rows: 8, cols: 8, row: ctx.row & 7, col: ctx.col & 7, rowLabel: hex(ctx.row, 2) + 'h', colLabel: hex(ctx.col, 2) + 'h', bit: ctx.byte & 1, write: false, mem: 'rom' })]],
    read: ctx => [['Y GATING', tcard('mux', 'Y GATING', ctx.part, `Column ${hex(ctx.col, 2)}h of each output connects to the output buffers.`, { n: 1 << CB, sel: ctx.col, value: ctx.byte, label: 'columns' })],
      ['OUTPUT BUFFERS', bufCard('OUTPUT BUFFERS', ctx.part, 8, ctx.byte, 'out', `OE is low: the byte ${hex(ctx.byte, 2)}h goes out on D0–D7.`)]],
    write: () => [],
  };
  // The signals of the bus controller in one bus cycle (a timing diagram card).
  function cmdWave(part, cmd, I) {
    const read = !!I.read, wr = !read;
    if (M286) {
      return tcard('wave', 'COMMAND LOGIC', part, `In Ts ALE lets the latches take the address; in Tc ${cmd} is low and DEN opens the transceivers.`, {
        cols: ['Ts', 'Tc'],
        rows: [{ name: 'CLK', clk: true, per: 0.5, duty: 0.5 }, { name: 'ALE', on: [[0.1, 0.5]] }, { name: cmd, on: [[1, 1.9]], low: true },
          { name: 'DT/R', on: [[0, 2]], low: read }, { name: 'DEN', on: [[wr ? 0.5 : 0.8, 1.95]] }],
        caps: [[0, 'Ts: ALE is high: the latches take the address.'], [1, `Tc: ${cmd} is low: the ${read ? 'chip gives' : 'chip takes'} the data.`], [1.9, `${cmd} goes high: the cycle ends.`]] });
    }
    return tcard('wave', 'COMMAND LOGIC', part, `The 8288 makes ALE in T1, then ${cmd} (low) and DEN for the data. DT/R is ${read ? 'low: data comes in' : 'high: data goes out'}.`, {
      cols: ['T1', 'T2', 'T3', 'T4'],
      rows: [{ name: 'CLK', clk: true, per: 1, duty: 1 / 3 }, { name: 'ALE', on: [[0.1, 0.6]] }, { name: cmd, on: [[wr ? 2 : 1.1, 3.9]], low: true },
        { name: 'DT/R', on: [[0, 4]], low: read }, { name: 'DEN', on: [[wr ? 0.7 : 1.3, 3.8]] }],
      caps: [[0, 'T1: ALE is high: the latches take the address.'], [1, wr ? 'T2: DEN opens the transceivers; the data goes out.' : `T2: ${cmd} goes low: the chip starts its read.`],
        [2, wr ? `T3: ${cmd} goes low: the chip takes the data.` : 'T3: the data is on the bus.'], [3, `T4: ${cmd} goes high: the cycle ends.`]] });
  }
  const BUSCTL_TRACE = {
    role: 'dev',
    visit: ctx => [['STATUS DECODER', statusCard(ctx.part, ctx.I, 'STATUS DECODER')],
      ['COMMAND LOGIC', cmdWave(ctx.part, ctx.s.token.tag, ctx.I)]],
  };
  // Any chip with a data bus buffer and register select logic (8259A, 8253/8254, 8255, 8237,
  // 8042, MC146818, 6845, VGA, RAMDAC, disk controller ...).
  const IO_TRACE = {
    role: 'dev',
    addr: ctx => {
      const [buf, rw] = IO_IN[ctx.dev] || [];
      return [[rw || buf || 'BUS INTERFACE', tcard('decoder', rw || 'REGISTER SELECT', ctx.part, `The low address bits (${hex(ctx.port & 3, 1)}) select the ${String(ctx.target || 'register').toLowerCase()}.`,
        { bits: 2, value: ctx.port & 3, inLabel: 'A1 A0', outLabel: 'registers' })]];
    },
    cmd: () => [],
    read: ctx => {
      const [buf] = IO_IN[ctx.dev] || [];
      const v = hex(ctx.I.data, 2);
      if (ctx.I.kind === 'inta') return [['PRIORITY RESOLVER', tcard('decoder', 'PRIORITY RESOLVER', ctx.part, `IRQ ${ctx.I.data & 7} has the highest priority.`, { bits: 3, value: ctx.I.data & 7, inLabel: 'IRQ', outLabel: 'in service' })],
        ['DATA BUS BUFFER', bufCard('DATA BUS BUFFER', ctx.part, 8, ctx.I.data, 'out', `The vector ${v}h goes out on D0–D7.`)]];
      return [[ctx.target || buf, tcard('text', ctx.target || 'REGISTER', ctx.part, `The ${String(ctx.target || 'register').toLowerCase()} gives ${v}h.`, { lines: [`port ${hex(ctx.port, 2)}h → ${v}h`] })],
        [buf || ctx.target, bufCard(buf || 'BUFFER', ctx.part, 8, ctx.I.data, 'out', `The value ${v}h goes out on D0–D7.`)]];
    },
    write: ctx => {
      const [buf] = IO_IN[ctx.dev] || [];
      const v = hex(ctx.I.data, 2);
      return [[buf || ctx.target, bufCard(buf || 'BUFFER', ctx.part, 8, ctx.I.data, 'in', `The value ${v}h comes in from D0–D7.`)],
        [ctx.target || buf, tcard('text', ctx.target || 'REGISTER', ctx.part, `The ${String(ctx.target || 'register').toLowerCase()} keeps ${v}h.`, { lines: [`port ${hex(ctx.port, 2)}h ← ${v}h`] })]];
    },
  };
  const PIC_IRQ_TRACE = [['IRR', null], ['PRIORITY RESOLVER', null], ['CONTROL LOGIC', null]];
  // The chips on the way (glue logic): the address latch, the data transceiver, the decoder.
  // Each is a visit list for chipVisit (the slice or the block that works, with its card).
  const GLUE = {
    // lat0 keeps A0-A7 (lat1 and lat2 keep the higher address bits)
    latch(part, I) {
      const v = I.addr & 0xFF;
      return [['L3', tcard('latch', 'ADDRESS LATCH', part, `ALE strobes the ${part}: it keeps A0–A7 = ${hex(v, 2)}h. Two more ${part} chips keep the higher address bits.`,
        { bits: 8, value: v, strobe: 'ALE', label: 'A0–A7' })]];
    },
    // xcv0 passes D0-D7, xcv1 passes D8-D15
    xcv(part, I, hiByte) {
      const d = I.width >= 2 ? (hiByte ? (I.data >>> 8) & 0xFF : I.data & 0xFF) : I.data & 0xFF;
      const lines = hiByte ? 'D8–D15' : 'D0–D7';
      return [['T3', bufCard('TRANSCEIVER', part, 8, d, I.read ? 'in' : 'out',
        I.read ? `DT/R is low: the ${part} passes ${hex(d, 2)}h (${lines}) from the system bus to the CPU. DEN enables it.`
          : `DT/R is high: the ${part} passes ${hex(d, 2)}h (${lines}) from the CPU to the system bus. DEN enables it.`)]];
    },
    dec(part, dev, y) {
      return [['3-TO-8 DECODER', tcard('decoder', '3-TO-8 DECODER', part, `The decoder turns the address into one select line: Y${y} goes low and selects the ${DEV_SEL[dev] || dev}.`,
        { bits: 3, value: y, inLabel: 'address group', outLabel: `Y${y} → ${DEV_SEL[dev] || dev}` })], ['Y0-Y7 DRIVERS', null]];
    },
    pal(I, dev) {
      const hi = (I.addr >>> 16) & 15;
      return [['AND ARRAY', tcard('decoder', 'AND ARRAY', 'PAL16L8', `The AND terms test the high address bits (${hex(hi, 1)}h): the ${DEV_SEL[dev] || dev} select output goes low.`,
        { bits: 4, value: hi, inLabel: 'A19–A16', outLabel: `${DEV_SEL[dev] || dev} select` })], ['OR GATES', null], ['OUTPUTS', null]];
    },
  };
  // The blocks that a floppy controller (uPD765) step or a DMA step passes, with cards.
  function FDC_CARD(s) {
    const e = s.e || {}, D = e.drive ? 'B:' : 'A:';
    if (s.kind === 'dma') return [['TIMING AND CONTROL', tcard('text', 'DMA CONTROL', '8237', 'Channel 2: HOLD to the CPU, then HLDA. The 8237 drives the address and the commands.', { lines: [`DRQ2 → HRQ → HLDA`, `address ${hexA(e.addr || 0)}h`] })],
      ['CH2 ADDR COUNT', tcard('counter', 'CH2 ADDRESS / COUNT', '8237', `The address counts up and the count counts down for each byte (${e.n || 1} now).`, { v: e.count || 0, reload: 0x1FF, label: 'bytes left', mode: 0, modeText: 'one step for each byte', clkLabel: 'DACK', outLabel: 'TC',
        caption: 'Each DMA transfer takes 1 from the count and adds 1 to the address. At the end the 8237 sends TC (terminal count), and the uPD765 ends the transfer.' })]];
    const op = e.op;
    if (op === 'command' || op === 'result') return [['HOST INTERFACE', tcard('buffer', 'DATA REGISTER', 'uPD765', op === 'command' ? 'The command bytes come in through 3F5h.' : 'The result bytes go out through 3F5h.', { bits: 8, value: 0, dir: op === 'command' ? 'in' : 'out', enable: 'RD WR' })],
      ['COMMAND STATUS REGS', tcard('text', 'COMMAND / STATUS', 'uPD765', e.text || '', { lines: [String(e.text || op)] })]];
    if (op === 'seek' || op === 'step') return [['SEQUENCER', tcard('counter', 'PRESENT CYLINDER', 'uPD765', `The head of ${D} goes to track ${e.cyl}.`, { v: e.cyl || 0, reload: 79, label: 'track', mode: 0, modeText: 'present cylinder', clkLabel: 'STEP', outLabel: 'SEEK END',
        caption: 'Each STEP pulse moves the head one track. When the track is correct, the uPD765 sets SEEK END and raises IRQ 6.' })],
      ['DRIVE INTERFACE', tcard('text', 'DRIVE INTERFACE', 'uPD765', 'STEP pulses and the DIRECTION line go to the drive.', { lines: ['STEP ▸▸▸', `DIR ${'in'}`] })]];
    if (op === 'read' || op === 'write') return [['DRIVE INTERFACE', tcard('text', 'DRIVE INTERFACE', 'uPD765', `${op === 'read' ? 'READ DATA' : 'WRITE DATA'} with ${D}.`, { lines: [`track ${e.cyl} side ${e.head || 0} sector ${e.sec || '?'}`] })],
      ['DATA SEPARATOR IF', tcard('text', 'DATA SEPARATOR', 'uPD765', 'MFM bits ↔ bytes. The clock bits keep the timing.', { lines: ['MFM: 1 0 0 1 0 1 …'] })],
      ['SEQUENCER', tcard('text', 'SEQUENCER', 'uPD765', 'The sequencer finds the ID field of the sector, then asks for DMA for each data byte.', { lines: ['ID → DATA → DRQ2'] })]];
    return [['SEQUENCER', tcard('text', 'uPD765', 'uPD765', e.text || op || '', { lines: [String(op || '')] })]];
  }
  // The blocks of the Sound Blaster chips for a DSP or an OPL2 step, with cards.
  function SOUND_CARD(s) {
    const e = s.e || {};
    if (e.k === 'opl') {
      const on = e.op === 'key-on', off = e.op === 'key-off';
      const v = [['REGISTER FILE', tcard('text', 'REGISTER FILE', 'YM3812', `Register ${hex(e.reg || 0, 2)}h gets ${hex(e.val || 0, 2)}h.`, { lines: [`reg ${hex(e.reg || 0, 2)}h ← ${hex(e.val || 0, 2)}h`, e.ch !== undefined ? `channel ${e.ch}` : ''] })]];
      if (on || off) {
        v.push(['ENVELOPE GENERATOR', tcard('text', 'ENVELOPE GENERATOR', 'YM3812', on ? 'KEY ON: the envelope goes up (attack), then down (decay) to the sustain level.' : 'KEY OFF: the envelope goes down (release).', { lines: [on ? 'attack → decay → sustain' : 'release → off'] })]);
        v.push(['OPERATOR UNIT', tcard('text', 'OPERATOR UNIT', 'YM3812', 'The modulator operator changes the phase of the carrier operator: FM synthesis. The result goes out in series to the YM3014B DAC.', { lines: ['modulator → carrier → DAC'] })]);
      }
      return v;
    }
    const op = e.op;
    if (op === 'dma') return [['DMA REQUEST', tcard('text', 'DMA REQUEST', 'CT1351', `DRQ 1 for each sample, ${e.rate || '?'} per second.`, { lines: [`rate ${e.rate || '?'} Hz`, e.left !== undefined ? `${e.left} bytes left` : ''] })],
      ['CPU CORE 8051', tcard('text', '8051 CORE', 'CT1351', 'The program in the ROM of the DSP takes each byte and writes it to the DAC port.', { lines: ['byte → DAC'] })],
      ['DAC PORT', tcard('text', 'DAC PORT', 'CT1351', 'The 8-bit sample goes to the DAC and the amplifier.', { lines: ['8-bit sample → speaker'] })]];
    if (op === 'irq') return [['CPU CORE 8051', tcard('text', '8051 CORE', 'CT1351', 'The block is done: the DSP raises IRQ 7.', { lines: ['IRQ 7'] })]];
    return [['HOST INTERFACE', tcard('buffer', 'HOST INTERFACE', 'CT1351', `The command ${hex(e.cmd || 0, 2)}h comes in at 22Ch.`, { bits: 8, value: e.cmd || 0, dir: 'in', enable: 'IOW' })],
      ['CPU CORE 8051', tcard('text', '8051 CORE', 'CT1351', e.text || 'The 8051 program decodes the command.', { lines: [String(e.text || op || '')] })]];
  }
  // The Pentium pipes and branch prediction, as cards: a 'pipe' event (U or V, paired or the
  // reason for no pair) or a 'btb' event (the lookup, the 2-bit counter, right or wrong).
  const BTB_STATE = ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken'];
  // The stages of a pipe event [PF, D1, D2, EX, WB] (the younger ones first). After a HLT in an older
  // stage, the younger stages hold the bytes after the HLT (the prefetcher took them, and the decoder
  // sees them as instructions, often "add [bx+si], al" for zero bytes); they never execute, so they
  // show as empty. hlt: true when a stage was cut.
  function pipeStages(e) { return pipeAfterHalt(e.stage); }   // (theme.js)
  function P5_CARDS(e) {
    // the 80486: one pipeline of 5 stages (no U and V pipes)
    if (e.k === 'pipe' && !e.pipe) {
      const st = pipeStages(e);
      return [['INSTRUCTION DECODER', tcard('pipe', 'PIPELINE', '80486', 'The 5 stages of the pipeline work on 5 instructions at the same time. Each clock, each instruction moves one stage on.' +
        (st.hlt ? ' HLT stops the CPU: the bytes after it do not go on in the pipeline.' : ''),
        { stages: ['PF', 'D1', 'D2', 'EX', 'WB'], rows: [{ name: '', items: st }], cur: 3,
          lines: ['PF ' + (st[0] || '—'), 'D1 ' + (st[1] || '—'), 'D2 ' + (st[2] || '—'), 'EX ' + (st[3] || '—'), 'WB ' + (st[4] || '—')] })]];
    }
    if (e.k === 'pipe') {
      const u = e.pipe !== 'V', st = pipeStages(e);
      // the two pipes: this instruction in its pipe (in the EX stage now), the partner in the other one
      const me = st[3] || '', mate = e.paired ? e.partner || '' : '';
      const rowU = u ? [st[0], st[1], st[2], me, st[4]] : ['', '', '', mate, ''], rowV = u ? ['', '', '', mate, ''] : [st[0], st[1], st[2], me, st[4]];
      return [[u ? 'U PIPE' : 'V PIPE', tcard('pipe', u ? 'U PIPE' : 'V PIPE', 'Pentium',
        e.paired ? `This instruction goes into the ${e.pipe} pipe, and "${e.partner}" goes into the ${u ? 'V' : 'U'} pipe in the same clock.`
          : `This instruction goes into the U pipe alone. ${e.reason ? 'No pair: ' + e.reason + '.' : ''}`,
        { stages: ['PF', 'D1', 'D2', 'EX', 'WB'], rows: [{ name: 'U', items: rowU.map(x => x || '') }, { name: 'V', items: rowV.map(x => x || '') }], cur: 3, curRow: u ? 0 : 1,
          note: e.paired ? '' : 'no pair' + (e.reason ? ': ' + e.reason : ''), clocks: e.clocks || 1,
          lines: [e.paired ? `paired with ${e.partner}` : 'no pair', `${e.clocks || 1} clock${e.clocks === 1 ? '' : 's'} alone`] })]];
    }
    const hitTxt = e.hit ? `The BTB has an entry for ${hex(e.lin >>> 0, 8)}h (set ${e.set}, way ${e.way}).` : `The BTB has no entry for ${hex(e.lin >>> 0, 8)}h: the prediction is "not taken".`;
    const v = [['BRANCH TARGET BUFFER', tcard('text', 'BRANCH TARGET BUFFER', 'Pentium',
      `${hitTxt} It predicts ${e.predicted ? 'taken' : 'not taken'}; the branch is ${e.taken ? 'taken' : 'not taken'}: ${e.right ? 'right, no lost clocks' : 'wrong'}.`,
      { lines: [`predicted ${e.predicted ? 'taken' : 'not taken'}`, `actual ${e.taken ? 'taken → ' + hex(e.target >>> 0, 8) + 'h' : 'not taken'}`, e.counter >= 0 ? `counter ${e.counter}: ${BTB_STATE[e.counter] || ''}` : (e.alloc ? 'new entry' : 'no entry')] })]];
    if (!e.right) v.push([e.pipe === 'V' ? 'V PIPE' : 'U PIPE', tcard('text', 'PIPELINE FLUSH', 'Pentium',
      `The pipes flush the instructions of the wrong path and start again at the right address: ${e.penalty || 3} clocks lost.`, { lines: [`penalty ${e.penalty || 3} clocks`, `${e.pipe || 'U'} pipe`] })]);
    return v;
  }
  // The blocks of the 80486 cache for a miss (the line fill) or a write, with cards.
  // (The Pentium: the cache that the event names, 2 ways, 32-byte lines, 64-bit bursts.)
  // The ways of one set of a cache of the CPU now (after the step: the filled way has its new
  // line): the tag of each way as hex (null = not valid) and its MESI state.
  // c: the cache object of the core ({ tag, state? }) or the 486 tag array; sh: the tag shift.
  function cacheSetNow(tagArr, stArr, set, ways, digits) {
    const tags = [], states = [];
    for (let w = 0; w < ways; w++) {
      const t = tagArr ? tagArr[set * ways + w] : -1;
      tags.push(t === undefined || t < 0 ? null : hex(t >>> 0, digits));
      states.push(stArr ? 'ISEM'[stArr[set * ways + w] & 3] : t >= 0 ? 'V' : 'I');
    }
    return { tags, states };
  }
  const lineBytes = (line, n) => { const m = window.__app && window.__app.machine, b = []; for (let i = 0; i < n; i++) b.push(m ? m.peek8(line + i) : 0); return b; };
  const cpuNow = () => { const m = window.__app && window.__app.machine; return m ? m.cpu : null; };
  function CACHE_CARD(s) {
    if (M686) return CACHE_CARD_P6(s);
    if (M586) return CACHE_CARD_P5(s);
    const e = s.e || {}, phys = e.phys >>> 0, set = e.set !== undefined ? e.set : (phys >> 4) & 127, tag = phys >>> 11, line = phys & ~15;
    const c = cpuNow(), now = cacheSetNow(c && c.ctag, null, set, 4, 6);
    // the ways of the set before the fill: the filled way had an other line (not known here)
    const before = now.tags.map((t, w) => (e.fill && w === e.way ? null : t));
    const geo = { sets: 128, ways: 4, lineBytes: 16, set, tag: hex(tag, 6), addr: hex(phys, 8), offBits: 4, setBits: 7, tagBits: 21 };
    const v = [['CACHE 8 KB', tcard('cache', 'CACHE SET SELECT', '80486', `Address bits 4-10 select set ${set} of 128. The 4 tags of the set do not have ${hex(tag, 6)}h: a ${e.write ? 'write' : 'read'} miss.`,
      Object.assign({ phase: 'lookup', tags: before, states: before.map(t => (t ? 'V' : 'I')), lines: [`address ${hex(phys, 8)}h`, `set ${set}, tag ${hex(tag, 6)}h`, 'no way has the tag: miss'],
        panel: tcard('decoder', 'CACHE SET SELECT', '80486', '', { bits: 7, value: set, inLabel: 'A4–A10', outLabel: '128 sets × 4 ways' }) }, geo))]];
    if (e.fill) {
      const bytes = lineBytes(line, 16), cells = bytes.map(x => ({ v: x }));
      v.push(['BUS INTERFACE', tcard('bus', 'BURST', '80486', 'The bus interface reads the whole 16-byte line in a burst: 2-1-1-1 clocks.',
        { mode: 'burst', lineBytes: 16, beatBytes: 2, addr: hex(line, 8), bytes, signals: [['KEN#', 'first'], ['BLAST#', 'last']], lines: [`line ${hex(line, 8)}h`, 'KEN = cacheable', 'BLAST at the last transfer'] })]);
      v.push(['CACHE 8 KB', tcard('cache', 'LINE FILL', '80486', `The 16 bytes go into way ${e.way !== undefined ? e.way : '?'} of set ${set}; the LRU bits choose the way.`,
        Object.assign({ phase: 'fill', fill: true, way: e.way || 0, tags: before, states: before.map(t => (t ? 'V' : 'I')), state: 'V', bytes, lines: [`line ${hex(line, 8)}h`, `into way ${e.way || 0} of set ${set}`],
          panel: tcard('bytes', 'LINE FILL', '80486', '', { cells, cap: 16, put: [...Array(16).keys()], take: [], note: 'from the burst' }) }, geo))]);
    } else if (e.write) v.push(['BUS INTERFACE', tcard('bus', 'WRITE THROUGH', '80486', 'A write goes to the memory always (write-through). A write miss does not fill a line.',
      { mode: 'write', addr: hex(phys, 8), note: 'no line fill', lines: [`write ${hex(phys, 8)}h`, 'no line fill'] })]);
    return v;
  }
  // The Pentium Pro: the RAT, the reservation station, the ports and the retire of one
  // instruction, from its 'rat', 'uop' and 'rob' events (in this order on the die).
  const P6_PORT = ['PORT 0 IEU FEU', 'PORT 1 IEU JEU', 'LOAD UNIT', 'STORE UNIT', 'STORE UNIT'];
  const P6_PORT_NAME = ['port 0 (ALU, shift, multiply, divide, FPU)', 'port 1 (ALU, branch)', 'port 2 (load)', 'port 3 (store address)', 'port 4 (store data)'];
  function P6_CARDS(evs) {
    const out = [], uops = evs.filter(e => e.k === 'uop'), rat = evs.find(e => e.k === 'rat'), rob = evs.find(e => e.k === 'rob');
    if (rat) {
      const rd = (rat.reads || []).map(x => `${x.r} ← ${x.rob < 0 ? 'RRF' : 'ROB ' + x.rob}${x.rob >= 0 && !x.ready ? ' (not ready)' : ''}`);
      const wr = (rat.writes || []).map(x => `${x.r} → ROB ${x.rob}`);
      // the table of the RAT now: for each register, the ROB entry of its newest value (or the RRF)
      const c = cpuNow(), T8 = c && c.rat ? c.rat.rob : null, names = ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI', 'EFLAGS'];
      const RT = c && c.rat ? c.rat.retire : null, clk = c ? c.cycles : 0;
      const table = names.map((r, i) => ({ r, now: T8 && T8[i] >= 0 && RT && RT[i] > clk ? T8[i] : -1 }));
      out.push(['RAT', tcard('rat', 'RAT', 'Pentium Pro', `The RAT renames the registers: ${wr.length ? 'each new value gets a ROB entry' : 'this instruction writes no register'}. A source comes from the ROB when its value is not yet retired.`,
        { table, reads: (rat.reads || []).map(x => ({ r: x.r, rob: x.rob, ready: !!x.ready })), writes: (rat.writes || []).map(x => ({ r: x.r, rob: x.rob })), lines: rd.concat(wr).slice(0, 5) })]);
    }
    if (uops.length) {
      const waits = uops.filter(u => u.wait), pass = uops.filter(u => u.passed && u.passed.length);
      const txt = pass.length ? `A µop of this instruction passes ${pass[0].passed.length} older µop${pass[0].passed.length > 1 ? 's' : ''} that still wait: out-of-order execution.`
        : waits.length ? `A µop waits in the reservation station: ${waits[0].wait === 'operand' ? 'its operand is not ready' : 'the ' + waits[0].wait + ' is busy'}.`
        : 'The µops have their operands, so they go to the ports at once.';
      // the 20 slots: the µops of this instruction in their slots (the clocks relative to the first issue)
      const t0 = Math.min(...uops.map(u => u.issue));
      const mu = uops.slice(0, 8).map(u => ({ slot: u.rs, kind: u.kind, port: u.port, wait: u.wait || '', issue: u.issue - t0, go: u.dispatch - t0, done: u.done - t0 }));
      out.push(['RESERVATION STATION', tcard('rs', 'RESERVATION STATION', 'Pentium Pro', txt,
        { size: 20, used: rob ? rob.rs : mu.length, uops: mu, lines: uops.slice(0, 4).map(u => `µop ${u.id} ${u.kind}: issue ${u.issue}, go ${u.dispatch}${u.wait ? ' (' + u.wait + ')' : ''}`) })]);
      const seen = new Set();
      for (const u of uops) {
        if (u.port < 0 || seen.has(u.port)) continue;
        seen.add(u.port);
        out.push([P6_PORT[u.port], tcard('port', 'PORT ' + u.port, 'Pentium Pro', `The µop "${u.kind}" goes to ${P6_PORT_NAME[u.port]}. Its result is ready after ${u.lat} clock${u.lat === 1 ? '' : 's'}.`,
          { port: u.port, uop: u.kind, lat: u.lat, dst: u.dst || '', units: P6_PORT_NAME[u.port].replace(/^port \d \(|\)$/g, ''),
            lines: [`dispatch ${u.dispatch} → done ${u.done}`, u.dst ? 'writes ' + u.dst : '', u.passed && u.passed.length ? `passes µop ${u.passed.join(', ')}` : ''] })]);
      }
    }
    if (rob) out.push(['ROB', tcard('rob', 'REORDER BUFFER', 'Pentium Pro', `The ROB retires the ${rob.uops} µop${rob.uops === 1 ? '' : 's'} of this instruction in program order, at clock ${rob.retire}. Only then the result is in the real registers.`,
      { size: 40, used: rob.rob, first: rob.first, n: rob.uops, lines: [`ROB entries in use: ${rob.rob} of 40`, `RS entries in use: ${rob.rs} of 20`, `retire at ${rob.retire} (the last at ${rob.prev})`] })]);
    return out;
  }
  // The Pentium Pro caches: the L1 miss, the L2 on the back-side bus, the 64-bit front-side bus.
  function CACHE_CARD_P6(s) {
    const e = s.e || {}, phys = e.phys >>> 0, line = phys & ~31;
    const c = cpuNow();
    if (e.level === 'L2') {
      const L2 = c && c.l2, now = cacheSetNow(L2 && L2.tag, L2 && L2.state, e.set || 0, 4, 4);
      return [['BUS INTERFACE', tcard('bus', e.hit ? 'L2 HIT' : 'L2 MISS', 'Pentium Pro',
        e.hit ? 'The back-side bus reads the line from the L2 die in the same package, at the core clock: a few clocks.' : 'The L2 does not have the line: the front-side bus (66 MHz) reads it from the memory in a burst of 4 × 8 bytes, and the L2 keeps a copy.',
        { mode: 'l2', hit: !!e.hit, lineBytes: 32, beatBytes: 8, addr: hex(line, 8), bytes: lineBytes(line, 32), l2set: e.set, l2way: e.way, l2tags: now.tags, wb: !!e.wb,
          signals: e.hit ? [] : [['KEN#', 'first'], ['CACHE#', 'first']], lines: [`line ${hex(line, 8)}h`, `L2 set ${e.set}, way ${e.way}`, e.wb ? 'write-back of an M line' : ''] })]];
    }
    const code = e.cache === 'code', blk = code ? 'L1 CODE CACHE' : 'L1 DATA CACHE';
    // the code cache: 64 sets × 4 ways, tag = bits 11-31; the data cache: 128 sets × 2 ways, tag = bits 12-31
    const C1 = c && (code ? c.icache : c.dcache), ways = code ? 4 : 2, sets = code ? 64 : 128, setBits = code ? 6 : 7;
    const set = e.set !== undefined ? e.set : (phys >> 5) & (sets - 1), tag = phys >>> (code ? 11 : 12);
    const now = cacheSetNow(C1 && C1.tag, code ? null : C1 && C1.state, set, ways, code ? 6 : 5);
    const before = now.tags.map((t, w) => (e.fill && w === e.way ? null : t));
    const st0 = now.states.map((x, w) => (e.fill && w === e.way ? 'I' : code ? (now.tags[w] ? 'S' : 'I') : x));
    return [[blk, tcard('cache', 'L1 MISS', 'Pentium Pro', `The ${code ? 'code' : 'data'} cache does not have the line of ${hex(phys, 8)}h (set ${set}). It asks the L2.`,
      { phase: 'both', sets, ways, lineBytes: 32, set, tag: hex(tag, code ? 6 : 5), addr: hex(phys, 8), offBits: 5, setBits, tagBits: 32 - 5 - setBits,
        tags: before, states: st0, fill: !!e.fill, way: e.way || 0, state: e.state || 'S', bytes: e.fill ? lineBytes(line, 32) : [],
        lines: [`line ${hex(line, 8)}h`, e.fill ? `fill into way ${e.way}${e.state ? ', state ' + e.state : ''}` : 'no fill', e.wb ? `write-back ${hex((e.wbLine || 0) >>> 0, 8)}h` : ''] })]];
  }
  function CACHE_CARD_P5(s) {
    const e = s.e || {}, phys = e.phys >>> 0, set = e.set !== undefined ? e.set : (phys >> 5) & 127, line = phys & ~31;
    const code = e.cache === 'code', blk = code ? 'CODE CACHE 8 KB' : 'DATA CACHE 8 KB', nm = code ? 'code cache' : 'data cache';
    // both caches: 128 sets × 2 ways, 32-byte lines, tag = bits 12-31 (MESI in the data cache)
    const c = cpuNow(), C1 = c && (code ? c.icache : c.dcache), tag = phys >>> 12;
    const now = cacheSetNow(C1 && C1.tag, code ? null : C1 && C1.state, set, 2, 5);
    const before = now.tags.map((t, w) => (e.fill && w === e.way ? null : t));
    const st0 = now.states.map((x, w) => (e.fill && w === e.way ? 'I' : code ? (now.tags[w] ? 'S' : 'I') : x));
    const geo = { sets: 128, ways: 2, lineBytes: 32, set, tag: hex(tag, 5), addr: hex(phys, 8), offBits: 5, setBits: 7, tagBits: 20, tags: before, states: st0 };
    const v = [[blk, tcard('cache', 'CACHE SET SELECT', 'Pentium', `Address bits 5-11 select set ${set} of 128 in the ${nm}. The 2 tags of the set do not have the line: a ${e.write ? 'write' : 'read'} miss.`,
      Object.assign({ phase: 'lookup', lines: [`address ${hex(phys, 8)}h`, `set ${set}, tag ${hex(tag, 5)}h`, 'no way has the tag: miss'],
        panel: tcard('decoder', 'CACHE SET SELECT', 'Pentium', '', { bits: 7, value: set, inLabel: 'A5–A11', outLabel: '128 sets × 2 ways' }) }, geo))]];
    if (e.wb) v.push(['BUS INTERFACE', tcard('bus', 'WRITE-BACK', 'Pentium', 'The line that goes out has the state M (only the cache has its new bytes): a burst writes it back to the memory first.',
      { mode: 'writeback', lineBytes: 32, beatBytes: 8, addr: hex((e.wbLine || 0) >>> 0, 8), bytes: lineBytes((e.wbLine || 0) >>> 0, 32), lines: [`line ${hex((e.wbLine || 0) >>> 0, 8)}h`, '4 × 8 bytes out'] })]);
    if (e.fill) {
      const bytes = lineBytes(line, 32), cells = bytes.map(x => ({ v: x }));
      v.push(['BUS INTERFACE', tcard('bus', 'BURST', 'Pentium', 'The 64-bit bus reads the whole 32-byte line in a burst of 4 transfers of 8 bytes: 2-1-1-1 clocks.',
        { mode: 'burst', lineBytes: 32, beatBytes: 8, addr: hex(line, 8), bytes, signals: [['KEN#', 'first'], ['CACHE#', 'first']], lines: [`line ${hex(line, 8)}h`, 'KEN = cacheable', 'CACHE# = line fill'] })]);
      v.push([blk, tcard('cache', 'LINE FILL', 'Pentium', `The 32 bytes go into way ${e.way !== undefined ? e.way : '?'} of set ${set}${e.state ? ', state ' + e.state : ''}.`,
        Object.assign({ phase: 'fill', fill: true, way: e.way || 0, state: e.state || (code ? 'S' : 'E'), bytes, lines: [`line ${hex(line, 8)}h`, `into way ${e.way || 0} of set ${set}${e.state ? ', state ' + e.state : ''}`],
          panel: tcard('bytes', 'LINE FILL', 'Pentium', '', { cells, cap: 32, put: [...Array(32).keys()], take: [], note: 'from the burst' }) }, geo))]);
    } else if (e.write) v.push(['BUS INTERFACE', tcard('bus', 'WRITE MISS', 'Pentium', 'A write miss goes to the memory; the Pentium does not fill a line for a write.',
      { mode: 'write', addr: hex(phys, 8), note: 'no line fill', lines: [`write ${hex(phys, 8)}h`, 'no line fill'] })]);
    return v;
  }
  // The blocks of the 80386 paging unit for a page walk, with cards.
  function PAGE_CARD(s) {
    const e = s.e || {}, lin = e.lin >>> 0, set = (lin >>> 12) & 7;
    const v = [['TLB', tcard('decoder', 'TLB', '80386', `Linear page ${hex(lin >>> 12, 5)}h: bits 12-14 select set ${set}. No way of the set has this page: a TLB miss.`, { bits: 3, value: set, inLabel: 'set', outLabel: '8 sets × 4 ways' })],
      ['PAGE WALKER', tcard('text', 'PAGE WALKER', '80386', 'Two memory reads: the page directory entry, then the page table entry.', { lines: [`CR3 → PDE[${hex(e.dir || 0, 3)}h] = ${hex(e.pde >>> 0, 8)}h`, `PTE[${hex(e.tbl || 0, 3)}h] = ${hex(e.pte >>> 0, 8)}h`, e.fault ? `#PF, error ${hex(e.err || 0, 1)}` : 'A and D bits set'] })]];
    if (!e.fault) v.push(['PAGE ADDER', tcard('adder', 'PAGE ADDER', '80386', 'The page frame from the PTE plus the offset gives the physical address.', { width: 24, a: (e.phys >>> 0) & 0xFFF000, b: lin & 0xFFF, cin: 0, aLabel: 'page frame', bLabel: 'offset', rLabel: 'physical' })]);
    return v;
  }
  // Extra models by die part. Add new chips here.
  const TRACE_MODELS = {};
  function traceModel(part) {
    if (TRACE_MODELS[part]) return TRACE_MODELS[part];
    if (part === '8086' || part === '80286' || part === '80386' || part === '80486' || part === '80586' || part === '80686' || part === '8087' || part === '80287' || part === '80387') return CPU_TRACE;
    if (DIE_PLANS[part] === DRAM_PLAN) return DRAM_TRACE;
    if (part === '2764' || part === '27128' || part === '27256' || part === '2364') return ROM_TRACE;
    if (part === '8288' || part === '82288') return BUSCTL_TRACE;
    return IO_TRACE;
  }

  class BoardView {
    constructor(host, app) {
      this.host = host;
      this.app = app;
      this.reduced = !!app.reducedMotion;
      this.visible = false;
      this.ok = false;
      this.sigs = [];
      this.fastOn = false; this.fastT = 0; this.fastLv = {};
      this.manClock = 0; this.manAnchor = 0; this.manual = false;
      this.instrStart = 0; this.instrMs = 0; this.instrEnd = 0;
      this.last = { addr: null, data: null, cmd: null, status: null, sel: null, write: false, dev: {} };
      this.lastRender = 0; this.dirty = true;
      this.crtVer = -1;
      this.hover = null; this.pinned = false;
      this.follow = true;
      this.facePos = {};
      // the Explain director (explain3d.js): xp = { shots, spot } or null; the spotlight layer
      this.xp = null; this.xpIds = null; this.xpForce = false; this.spotCv = null; this.spotG = null; this.spotKey = ''; this.spotA = 0; this.xpBoxes = new Map();
      this.chasePaused = false; this.chaseKey = ''; this.chaseCheck = 0; this.recent = []; this.followBtn = null;
      this.userT = -1e9;
      this.lastReal = 0;
      this.flash = null;
      this.decaps = new Map(); this.decapByGlow = {}; this.dieCache = new Map(); this.decapTargets = [];
      this.fx = new Map(); this.fxLine = {}; this.fxOnly = null; this.viewCam = null; this.viewCx = 0.5;
      this.tool = 'orbit'; this.scr = { last: null };
      this.injectCss();
      this.buildDom();
      try {
        this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      } catch (err) {
        htmlEl('p', { class: 'bv-fail' }, this.root, 'The 3D board needs WebGL, and this browser did not give a WebGL context.');
        return;
      }
      this.ok = true;
      this.setupRenderer();
      this.buildScene();
      this.bindInput();
      const fo = document.getElementById('opt-follow');
      this.follow = fo ? fo.checked : true;
      app.on('follow', on => { this.follow = !!on; this.chasePaused = false; this.chaseKey = ''; this.syncFollowBtn(); });
      this.syncFollowBtn();
      app.on('select', s => { if (s && s.kind === 'chip' && this.glows[s.id]) this.flash = { id: s.id, t: animNow() }; });
      app.on('mode', () => { this.dirty = true; });
      this.buildTrace();
      this.applyPreset('overview', true);
    }

    // ---------- DOM ----------
    injectCss() { injectStyle(); }
    buildDom() {
      const root = this.root = htmlEl('div', { class: 'bv-root' }, this.host);
      this.wrap = htmlEl('div', {
        class: 'bv-canvas', tabindex: '0', role: 'application', 'aria-roledescription': '3D board',
        'aria-label': 'A 3D model of the computer board. Drag to move the view. Right-drag or the arrow keys turn it, plus and minus zoom. Double-click a chip to focus on it; Esc leaves the focus.',
      }, root);
      htmlEl('div', { class: 'bv-vignette', 'aria-hidden': 'true' }, root);
      const top = htmlEl('div', { class: 'bv-top' }, root);
      // (the first row: the switch of the board views (the app puts it here), then the camera views)
      const row0 = this.modeSlot = htmlEl('div', { class: 'bv-row' }, top);
      const bar = htmlEl('div', { class: 'bv-presets', role: 'group', 'aria-label': 'Camera views' }, row0);
      this.presetBtns = {};
      for (const k in PRESETS) {
        const b = htmlEl('button', { type: 'button', class: 'bv-btn', 'aria-pressed': 'false', 'aria-label': `Camera view: ${PRESETS[k].label}` }, bar, PRESETS[k].label);
        b.addEventListener('click', () => { this.applyPreset(k); this.userT = performance.now(); });
        this.presetBtns[k] = b;
      }
      // Follow: the camera goes to the chip where the action is (a disk, the sound card, the
      // video card ...), while the machine runs. The same setting as the "Follow action" switch.
      this.followBtn = htmlEl('button', { type: 'button', class: 'bv-btn bv-follow', 'aria-pressed': 'false',
        'aria-label': 'Camera: follow the busy chips', title: 'Follow the action: the camera goes to the chip where the work is (a disk, the sound card, the video card …). The same as the "Follow action" switch. A drag or a camera view pauses it; press Follow again.' }, bar, 'Follow');
      this.followBtn.addEventListener('click', () => this.setChase(!this.chaseOn()));
      // Open chips: open the packages of all the chips, so the dies show (the decap switch)
      this.decapBtn = htmlEl('button', { type: 'button', class: 'bv-btn', 'aria-pressed': 'false', 'aria-label': 'Open the packages of all the chips',
        title: 'Open chips: take the lids off all the chips, so you see the dies. Click again to close them.' }, bar, 'Open chips');
      this.decapBtn.addEventListener('click', () => { const o = document.getElementById('opt-decap'); if (o) { o.checked = !o.checked; o.dispatchEvent(new Event('change')); } });
      // the decap tools moved to the "Decap" switch in the bottom bar
      this.toolBtns = {};
      const lg = htmlEl('ul', { class: 'bv-legend', 'aria-hidden': 'true' }, top);
      for (const [c, t] of [['cyan', 'address'], ['gold', 'data'], ['magenta', 'control'], ['lavender', FPU_ON ? 'FPU' : NM.fpu]]) {
        const li = htmlEl('li', null, lg);
        li.style.color = `var(--${c})`;
        htmlEl('i', null, li);
        htmlEl('span', null, li, t);
      }
      // (the mouse hint is in the help and in the label of the view; the board has no line of it)
      this.hint = htmlEl('p', { class: 'bv-hint', hidden: '' }, top, '');
      this.focusPill = htmlEl('div', { class: 'bv-focus', role: 'status' }, root);
      htmlEl('span', { class: 'bv-focus-tag' }, this.focusPill, 'Focus');
      this.focusName = htmlEl('b', null, this.focusPill, '');
      htmlEl('span', { class: 'bv-focus-hint' }, this.focusPill, 'Nothing hides it. Esc to leave.');
      const fx = htmlEl('button', { type: 'button', class: 'bv-focus-x', 'aria-label': 'Leave the focus mode (Esc)' }, this.focusPill, '×');
      fx.addEventListener('click', () => this.setFocus(null));
      this.focusPill.hidden = true;
      this.pop = htmlEl('button', { type: 'button', class: 'bv-pop' }, root, 'Open in the Die tab');
      this.pop.hidden = true;
      this.pop.addEventListener('click', () => { this.pop.hidden = true; if (window.__app && window.__app.selectTab) window.__app.selectTab('die'); });
      this.tip = htmlEl('div', { class: 'bv-tip', role: 'tooltip', 'aria-hidden': 'true' }, root);
      this.termEl = htmlEl('div', { class: 'bv-term', role: 'tooltip', 'aria-hidden': 'true' }, root);
      const head = htmlEl('div', { class: 'bv-tip-head' }, this.tip);
      this.tipRef = htmlEl('span', { class: 'bv-tip-ref' }, head);
      this.tipName = htmlEl('span', { class: 'bv-tip-name' }, head);
      this.tipKind = htmlEl('span', { class: 'bv-tip-kind' }, head);
      this.tipRole = htmlEl('p', { class: 'bv-tip-role' }, this.tip);
      this.tipState = htmlEl('dl', { class: 'bv-tip-state' }, this.tip);
    }

    setupRenderer() {
      const r = this.renderer;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      this.wrap.appendChild(r.domElement);
      r.domElement.setAttribute('aria-hidden', 'true');
      this.aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
      this.camera = new T.PerspectiveCamera(30, 1.6, 0.5, 400);
      this.cam = {
        target: new T.Vector3(), theta: 0, phi: 0.9, r: 40,
        g: { target: new T.Vector3(), theta: 0, phi: 0.9, r: 40 },
        flight: null, preset: 'overview', fit: true, follow: new T.Vector3(),
      };
      this.raycaster = new T.Raycaster();
      this.ptr = new T.Vector2();
    }

    // ---------- scene ----------
    buildScene() {
      const s = this.scene = new T.Scene();
      s.background = this.makeBackground();
      s.fog = new T.Fog(PAL.fog, 55, 150);
      this.buildEnv();
      this.buildLights();
      this.routes = {}; this.routeList = [];
      this.glows = {}; this.glowList = [];
      this.pick = [];
      this.pins = [];
      this.brazes = [];
      this.jleads = [];
      this.gleads = [];
      this.chipPos = {};
      this.mats = {
        plastic: new T.MeshPhysicalMaterial({ color: PAL.plastic, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.55, envMapIntensity: 0.3 }),
        ceramic: new T.MeshPhysicalMaterial({ color: THEME.ceramic, roughness: 0.34, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.32, envMapIntensity: 0.3 }),
        eprom: new T.MeshPhysicalMaterial({ color: PAL.eprom, roughness: 0.4, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.4 }),
        gold: new T.MeshPhysicalMaterial({ color: '#dba445', roughness: 0.26, metalness: 1, envMapIntensity: 1.25 }),
        tin: new T.MeshStandardMaterial({ color: PAL.tin, roughness: 0.3, metalness: 1, envMapIntensity: 1.1 }),
        steel: new T.MeshStandardMaterial({ color: PAL.steel, roughness: 0.42, metalness: 1, envMapIntensity: 0.55 }),
        black: new T.MeshStandardMaterial({ color: PAL.black, roughness: 0.6, metalness: 0 }),
        case: new T.MeshPhysicalMaterial({ color: PAL.case, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.8 }),
        caseDark: new T.MeshStandardMaterial({ color: PAL.caseDark, roughness: 0.7, metalness: 0 }),
      };
      const board = new T.Group();
      s.add(board);
      this.board = board;
      const P = this.painter = new Painter(BW, BD, PPU);
      this.paintBase(P);
      for (const r of ROUTES) this.buildRoute(r, P);
      for (const c of CHIPS) this.buildChip(c, board, P);
      this.buildBanks(board, P);
      this.buildParts(board, P);
      this.paintSilk(P);
      this.buildBoardMesh(P);
      this.buildCard();
      this.buildDiskCard();
      this.buildSoundCard();
      this.buildHdCard();
      if (M286) this.buildXCard();
      this.buildDrives();
      this.buildMonitor();
      this.buildFloor();
      this.buildPins();
      this.buildDust();
      this.buildChains();
      s.updateMatrixWorld(true);
      // The scene does not move, so the shadow map is drawn only once.
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
    }

    makeBackground() {
      const c = canvas(512, 512), g = c.getContext('2d');
      const gr = g.createRadialGradient(256, 170, 10, 256, 230, 420);
      gr.addColorStop(0, PAL.bg0);
      gr.addColorStop(0.45, PAL.bg1);
      gr.addColorStop(1, PAL.bg2);
      g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
      return colorTex(c);
    }
    buildEnv() {
      const pm = new T.PMREMGenerator(this.renderer);
      const s = new T.Scene();
      const room = new T.Mesh(new T.BoxGeometry(40, 40, 40), new T.MeshBasicMaterial({ color: PAL.room, side: T.BackSide }));
      s.add(room);
      const panel = (w, h, color, k, pos) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), side: T.DoubleSide }));
        m.position.set(pos[0], pos[1], pos[2]);
        m.lookAt(0, 0, 0);
        s.add(m);
      };
      panel(22, 10, '#ffe9cc', 2.4, [0, 13, -15]);
      panel(14, 7, '#fff1e2', 2.2, [-4, 17, 8]);
      panel(26, 4, THEME.lavender, 2.6, [0, 7, -18]);
      panel(3, 16, THEME.goldHi, 1.8, [-18, 6, 3]);
      panel(3, 12, THEME.cyan, 0.9, [18, 5, -3]);
      panel(12, 2, '#ffffff', 2.5, [8, 12, 14]);
      const rt = pm.fromScene(s, 0.03);
      this.scene.environment = rt.texture;
      s.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pm.dispose();
    }
    buildLights() {
      const s = this.scene;
      s.add(new T.HemisphereLight(PAL.hemi, PAL.room, 0.55));
      const key = new T.DirectionalLight(PAL.key, 2.2);
      key.position.set(-12, 26, 16);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const sc = key.shadow.camera;
      sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 80;
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.02;
      s.add(key); s.add(key.target);
      const rim = new T.DirectionalLight(PAL.rim, 1.6);
      rim.position.set(12, 9, -26);
      s.add(rim);
      const fill = new T.DirectionalLight(PAL.fill, 0.35);
      fill.position.set(24, 7, 12);
      s.add(fill);
    }

    paintBase(P) {
      const g = P.cc, W = P.c.width, H = P.c.height;
      const gr = g.createRadialGradient(W * 0.45, H * 0.45, 50, W * 0.5, H * 0.5, W * 0.7);
      gr.addColorStop(0, PAL.mask0);
      gr.addColorStop(1, PAL.mask1);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // ground plane under the mask: a faint cross hatch
      g.save();
      g.globalAlpha = 0.035; g.strokeStyle = PAL.hatch; g.lineWidth = 1;
      g.beginPath();
      const step = 0.3 * PPU;
      for (let x = -H; x < W; x += step) { g.moveTo(x, 0); g.lineTo(x + H, H); g.moveTo(x + H, 0); g.lineTo(x, H); }
      g.stroke();
      g.restore();
      // speckle
      g.save();
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
        g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
      }
      g.restore();
      P.kc.fillStyle = rgb(0.18, 0.5, 0); P.kc.fillRect(0, 0, W, H);
      // mounting holes
      for (const [x, z] of [[-16.1, -10.1], [16.1, -10.1], [-16.1, 10.1], [16.1, 10.1], [2.6, 10.1], [2.6, -10.3]]) {
        P.dot(x, z, 0.42, THEME.gold, rgb(0.8, 0.3, 1));
        P.dot(x, z, 0.24, PAL.hole, rgb(0, 0.9, 0));
      }
    }

    // ---------- traces ----------
    buildRoute(r, P) {
      const ch = r.n > 1 ? Math.max(0.35, (r.n - 1) * r.sp * 0.6) : 0.3;
      const path = chamfer(r.pts, ch);
      const S = cumLen(path);
      const gw = r.n > 1 ? r.sp * 1.5 : 0.13;
      const pos = [], aS = [], aL = [], aV = [], idx = [];
      const copper = PAL.copper, copperHi = PAL.copperHi;
      for (let li = 0; li < r.n; li++) {
        const off = (li - (r.n - 1) / 2) * r.sp;
        const line = offsetPoly(path, off);
        P.poly(line, r.n > 1 ? Math.min(0.034, r.sp * 0.62) : 0.045, copper, rgb(0.55, 0.42, 0));
        P.poly(line, 0.012, copperHi, null);
        for (const e of [line[0], line[line.length - 1]]) {
          P.dot(e[0], e[1], 0.034, PAL.pad, rgb(0.7, 0.3, 1));
          P.dot(e[0], e[1], 0.012, PAL.via, null);
        }
        const L = offsetPoly(path, off - gw / 2), Rr = offsetPoly(path, off + gw / 2);
        const base = pos.length / 3;
        for (let i = 0; i < path.length; i++) {
          pos.push(L[i][0], 0, L[i][1], Rr[i][0], 0, Rr[i][1]);
          aS.push(S[i], S[i]); aL.push(li, li); aV.push(-1, 1);
        }
        for (let i = 0; i < path.length - 1; i++) {
          const a = base + i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('aS', new T.Float32BufferAttribute(aS, 1));
      g.setAttribute('aLine', new T.Float32BufferAttribute(aL, 1));
      g.setAttribute('aV', new T.Float32BufferAttribute(aV, 1));
      g.setIndex(idx);
      const mat = this.busMaterial();
      const m = new T.Mesh(g, mat);
      m.position.y = 0.007;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.board.add(m);
      const rt = { ...r, path, S, len: S[S.length - 1], mat, mesh: m, prop: null, flow: 0, flowColor: new T.Color(), base: 0 };
      this.routes[r.id] = rt;
      this.routeList.push(rt);
    }
    busMaterial() {
      return new T.ShaderMaterial({
        uniforms: {
          uColor: { value: new T.Color(THEME.gold) }, uHead: { value: -10 }, uDir: { value: 1 }, uAmp: { value: 0 }, uHold: { value: 0 },
          uBitMix: { value: 1 }, uFlow: { value: 0 }, uTime: { value: 0 }, uTail: { value: 0.9 }, uBase: { value: 0 }, uBits: { value: 0 },
        },
        vertexShader: BUS_VS, fragmentShader: BUS_FS, transparent: true, depthWrite: false,
        blending: T.AdditiveBlending, toneMapped: false,
      });
    }
    buildChains() {
      this.chains = {};
      for (const k in CHAINS) {
        const segs = [];
        let off = 0;
        CHAINS[k].forEach((id, i) => {
          const r = this.routes[id];
          if (i > 0) {
            const prev = segs[i - 1].r;
            const a = project(prev.path, prev.S, r.path[0]);
            if (a.d < 0.9) off = segs[i - 1].off + a.s;
            else off = segs[i - 1].off + prev.len - project(r.path, r.S, prev.path[prev.path.length - 1]).s;
          }
          segs.push({ r, off });
        });
        let total = 0;
        for (const sg of segs) total = Math.max(total, sg.off + sg.r.len);
        this.chains[k] = { segs, total };
      }
      const f1 = this.routes.FDD1, f2 = this.routes.FDD2;
      this.chains.FDD = { segs: [{ r: f1, off: 0 }, { r: f2, off: f1.len }], total: f1.len + f2.len };
      const h1 = this.routes.HDD;
      if (h1) this.chains.HDD = { segs: [{ r: h1, off: 0 }], total: h1.len };
    }

    // ---------- chips ----------
    chipDims(spec) {
      if (spec.kind === 'plcc') return { quad: true, L: 2.42, W: 2.42, row: 2.42, lp: 0.127 * (68 / Math.max(68, spec.pins || 68)), sock: 3.3, base: 0.2, H: 0.3, plastic: false };
      // the 386 pin grid array: a larger ceramic square (drawn with leads on four sides)
      if (spec.kind === 'pga') return { quad: true, L: 3.2, W: 3.2, row: 3.2, lp: 0.09, sock: 3.9, base: 0.25, H: 0.3, plastic: false };
      if (spec.kind === 'qfp') return { quad: true, qfp: true, L: 2.5, W: 2.5, row: 2.5, lp: 0.058, sock: 2.9, base: 0.03, H: 0.2, plastic: true };
      const row = spec.wide ? 1.524 : 0.762;
      const L = spec.pins / 2 * PITCH + 0.14, W = row - 0.14;
      const plastic = !spec.kind || spec.kind === 'plastic';
      return { row, L, W, base: plastic ? 0.08 : 0.05, H: plastic ? 0.36 : 0.3, plastic };
    }
    labelCanvas(spec, d) {
      const w = 512, h = Math.max(64, Math.round(512 * d.W / d.L));
      const c = canvas(w, h), g = c.getContext('2d');
      g.lineCap = 'round'; g.lineJoin = 'round';
      const ink = spec.ink === 'lav' ? THEME.lavender : spec.kind === 'ceramic' ? PAL.inkCer : PAL.inkPl;
      const put = (str, x, y, size, align) => {
        if (!str) return;
        const maxW = spec.kind ? w * 0.26 : w * 0.8;
        const s = Math.min(size, maxW / Math.max(1, strokeTextWidth(str, 1)));
        g.lineWidth = Math.max(1.4, s * 0.12);
        strokeTextCanvas(g, str, x, y - s / 2, s, 1.5, align);
      };
      g.strokeStyle = ink; g.globalAlpha = 0.85;
      if (spec.kind === 'ceramic' || spec.kind === 'eprom') {
        put(spec.mark[0], w * 0.17, h * 0.4, h * 0.3, 'center');
        put(spec.mark[1], w * 0.83, h * 0.36, h * 0.2, 'center');
        put(spec.mark[2] || '', w * 0.83, h * 0.66, h * 0.17, 'center');
        if (spec.kind === 'eprom') put('-25', w * 0.17, h * 0.72, h * 0.15, 'center');
      } else {
        put(spec.mark[0], w / 2, h * 0.38, h * 0.3, 'center');
        g.globalAlpha = 0.6;
        put(spec.mark[1], w / 2, h * 0.72, h * 0.17, 'center');
      }
      // pin 1 dimple
      g.globalAlpha = 0.5;
      g.fillStyle = spec.kind === 'ceramic' ? PAL.dimple : PAL.dimplePl;
      g.beginPath(); g.arc(w * 0.045, h * 0.76, h * 0.07, 0, TAU); g.fill();
      return c;
    }
    makeGlow(id, parentObj, halfL, halfW, color, opts = {}) {
      const size = [halfL * 2 + 1.4, halfW * 2 + 1.4];
      const mat = glowMat(HALO_FS, {
        uColor: { value: new T.Color(color) }, uI: { value: 0 },
        uSize: { value: new T.Vector2(size[0], size[1]) }, uHalf: { value: new T.Vector2(halfL, halfW) },
      });
      const m = new T.Mesh(new T.PlaneGeometry(size[0], size[1]), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.005;
      m.renderOrder = 1;
      parentObj.add(m);
      const gl = { id, halo: mat, mats: [], labels: [], lid: null, v: 0, tgt: 0, fast: 0, col: new T.Color(color), tcol: null, pos: new T.Vector3(), obj: parentObj, ...opts };
      if (!this.glows[id]) { this.glows[id] = gl; this.glowList.push(gl); }
      else this.glows[id].extra = (this.glows[id].extra || []).concat([gl]);
      return gl;
    }
    buildChip(spec, parent, P) {
      if (spec.kind === 'plcc' || spec.kind === 'qfp' || spec.kind === 'pga') return this.buildQuad(spec, parent, P);
      const d = this.chipDims(spec);
      const grp = new T.Group();
      grp.position.set(spec.x, 0, spec.z);
      if (spec.rot) grp.rotation.y = Math.PI / 2;
      parent.add(grp);
      const mat = (spec.kind === 'ceramic' ? this.mats.ceramic : spec.kind === 'eprom' ? this.mats.eprom : this.mats.plastic).clone();
      const body = new T.Mesh(bodyGeo(d.L, d.W, d.H, spec.kind === 'ceramic' ? 0.1 : 0.13), mat);
      body.position.y = d.base;
      body.castShadow = true; body.receiveShadow = true;
      body.userData.pick = spec.glowAs || spec.id;
      grp.add(body);
      this.pick.push(body);
      const top = d.base + d.H;
      body.userData.decap = spec.id;
      this.decapTargets.push(body);
      this.registerDecap(spec.id, grp, { ...d, pins: spec.pins }, top + (spec.kind === 'ceramic' ? 0.045 : 0.006), spec.part, spec.glowAs || spec.id);
      const lc = this.labelCanvas(spec, d);
      const tex = colorTex(lc, this.aniso);
      const lmat = new T.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: '#000000', transparent: true, depthWrite: false, roughness: 0.7, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -2,
      });
      const lbl = new T.Mesh(new T.PlaneGeometry(d.L * 0.97, d.W * 0.94), lmat);
      lbl.rotation.x = -Math.PI / 2;
      lbl.position.y = top + 0.002;
      grp.add(lbl);
      const glowColor = spec.ink === 'lav' ? THEME.lavender : THEME.gold;
      const gl = this.makeGlow(spec.glowAs || spec.id, grp, d.L / 2, d.W / 2, glowColor);
      gl.mats.push(mat); gl.labels.push(lmat);
      gl.ref = spec.ref; gl.part = spec.part;
      if (spec.kind === 'ceramic') {
        const lidMat = this.mats.gold.clone();
        lidMat.roughnessMap = this.brushedMap();
        lidMat.roughness = 1;
        const lid = new T.Mesh(new T.BoxGeometry(1.9, 0.035, d.W * 0.66), lidMat);
        lid.position.y = top + 0.018;
        lid.castShadow = true;
        grp.add(lid);
        const ring = new T.Mesh(new T.BoxGeometry(2.08, 0.012, d.W * 0.76), this.mats.gold);
        ring.position.y = top + 0.006;
        grp.add(ring);
        gl.lid = lidMat;
        // gold braze pads along both edges
        for (let i = 0; i < spec.pins / 2; i++) {
          const x = (i - (spec.pins / 2 - 1) / 2) * PITCH;
          for (const zz of [-1, 1]) this.brazes.push({ grp, x, y: top + 0.004, z: zz * (d.W / 2 - 0.07) });
        }
        if (spec.id === 'cpu') {
          this.glint = glowMat(GLINT_FS, { uT: { value: -1 }, uColor: { value: new T.Color('#fff2c8') }, uAmp: { value: 1 } });
          const gm = new T.Mesh(new T.PlaneGeometry(1.9, d.W * 0.66), this.glint);
          gm.rotation.x = -Math.PI / 2;
          gm.position.y = top + 0.037;
          gm.renderOrder = 3;
          grp.add(gm);
        }
      }
      if (spec.kind === 'eprom') {
        // the quartz window sits over the die: it goes away when the package is open
        const win = this.buildWindow(grp, top, gl), de = this.decaps.get(spec.id);
        if (de) de.window = win;
      }
      // pins
      const half = spec.pins / 2;
      for (let i = 0; i < half; i++) {
        const x = (i - (half - 1) / 2) * PITCH;
        this.pins.push({ grp, x, z: d.row / 2, rot: 0, gold: spec.kind === 'ceramic' });
        this.pins.push({ grp, x, z: -d.row / 2, rot: Math.PI, gold: spec.kind === 'ceramic' });
      }
      if (P) this.paintFootprint(P, spec, d);
      gl.pos.set(spec.x, 0.3, spec.z);
      return grp;
    }
    // ---------- expansion cards ----------
    // World positions of the chips on a card (for glows, the runner and die zoom).
    placeCardChips(grp, chips) {
      grp.updateMatrixWorld(true);
      for (const cs of chips) {
        const p = grp.localToWorld(new T.Vector3(cs.x, 0.5, cs.z));
        this.chipPos[cs.id] = p;
        const g = this.glows[cs.glowAs || cs.id];
        if (g && !g.placed) { g.pos.copy(p); g.placed = true; }
      }
    }
    // The VGA card: controller ASIC, RAMDAC, 256 KB video DRAM, video BIOS, two crystals, DB-15.
    buildVgaCard() {
      const c = VCARD;
      const grp = this.card = this.buildCardBoard(c, VGA_CHIPS, 'VGA ADAPTER', `ANATOMY VGA 256K  ${M286 ? '16' : '8'}-BIT  REV A`);
      const P = grp.userData.painter;
      for (const [z, f] of [[-1.25, '25.175'], [0.25, '28.322']]) {
        const cs = roundRect(new T.Shape(), 0.42, 1.1, 0.2);
        const g = new T.ExtrudeGeometry(cs, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 });
        g.rotateX(-Math.PI / 2);
        const can = new T.Mesh(g, this.mats.steel);
        can.position.set(6.55, 0.06, z);
        can.castShadow = true;
        grp.add(can);
        if (P) { P.rect(6.55 - 0.3, z - 0.65, 0.6, 1.3, THEME.silk, rgb(0.45, 0.8, 0), 0.022); P.text(f, 6.55, z + 0.72, 0.12, { align: 'center' }); }
      }
      if (P) { P.text('VIDEO BIOS C0000', 5.4, 1.28, 0.12, { align: 'center', alpha: 0.7 }); P.text('256 KB  4 PLANES', -3.4, 1.35, 0.14, { align: 'center', alpha: 0.7 }); grp.userData.repaint(); }
      // DB-15 on the bracket
      const db = new T.Mesh(new T.BoxGeometry(0.42, 0.5, 1.2), this.mats.steel);
      db.position.set(-c.len / 2 - 0.25, -0.35, -0.9);
      grp.add(db);
      const shell = new T.Mesh(new T.BoxGeometry(0.2, 0.34, 0.9), this.mats.black);
      shell.position.set(-c.len / 2 - 0.5, -0.35, -0.9);
      grp.add(shell);
      this.monitorCable(c);
    }
    monitorCable(c) {
      const curve = new T.CatmullRomCurve3([
        new T.Vector3(c.x - c.len / 2 - 0.45, 3.3, c.z - 0.1),
        new T.Vector3(c.x - c.len / 2 - 1.6, 2.4, c.z - 1.6),
        new T.Vector3(-15.8, 0.2, -14.5),
        new T.Vector3(-11, FLOOR_Y + 0.12, -19),
        new T.Vector3(-6, FLOOR_Y + 0.12, -24),
        new T.Vector3(MONITOR.x - 2.5, 1.2, MONITOR.z - 7.2),
      ]);
      const cable = new T.Mesh(new T.TubeGeometry(curve, 80, 0.12, 10, false), new T.MeshPhysicalMaterial({ color: PAL.cable, roughness: 0.55, clearcoat: 0.4 }));
      cable.castShadow = true;
      this.scene.add(cable);
    }
    // Cards stand in the slots one behind the other. A card between the camera and the
    // point it looks at (a chip on the card behind) is hidden for as long as it blocks.
    // ---------- focus mode ----------
    // A double-click on a component focuses it. Until Esc, every object between the camera
    // and the component (or around the camera) hides, so nothing covers the component.
    // While the trace shows a die, the same test keeps that die clear.
    setFocus(obj, name) {
      this.focus = obj ? { obj, name, box: null } : null;
      this.focusKey = '';
      if (this.focusPill) {
        this.focusPill.hidden = !obj;
        if (obj) this.focusName.textContent = name || 'component';
      }
      if (!obj) this.applyHidden(new Set());
      this.dirty = true;
    }
    // The objects that can hide a component: the parts on the board and the other big parts.
    occluders() {
      if (this.occl) return this.occl;
      const out = [], v = new T.Vector3();
      const add = o => {
        if (o.isLight || o.isInstancedMesh || o.isPoints || o.isSprite || o === this.trG || o === this.runnerGroup) return;
        const b = new T.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        b.getSize(v);
        if (v.x > 18 || v.z > 14 || v.y < 0.03) return;   // the board, the floor, flat traces
        out.push({ obj: o, box: b.expandByScalar(0.02) });
      };
      for (const o of this.board.children) add(o);
      for (const o of this.scene.children) if (o !== this.board) add(o);
      return (this.occl = out);
    }
    focusTarget() {
      if (this.tr && !this.trHold && this.trInDie && this.tr.rider) {
        const at = this.riderAt(this.tr.rider, this.tr.rider.E);
        if (at && at.dive) return { obj: at.dive.e.grp, key: 'tr' + at.dive.e.key };
      }
      return this.focus ? { obj: this.focus.obj, key: 'f' + this.focus.obj.uuid, f: this.focus } : null;
    }
    focusOcclude(cam, ft) {
      const key = ft.key + '|' + cam.x.toFixed(3) + ',' + cam.y.toFixed(3) + ',' + cam.z.toFixed(3);
      if (key === this.focusKey) return;
      this.focusKey = key;
      const box = new T.Box3().setFromObject(ft.obj), ctr = box.getCenter(new T.Vector3());
      const pts = [ctr];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new T.Vector3(x, y, z).lerp(ctr, 0.2));
      const within = (a, b) => { for (let o = b; o; o = o.parent) if (o === a) return true; return false; };
      const ray = new T.Ray(), hit = new T.Vector3(), hide = new Set();
      if (this.focusSib !== ft.key) {
        // the other parts in the groups above the component (for example the chips on the same card)
        this.focusSib = ft.key;
        const sib = [], v = new T.Vector3();
        for (let a = ft.obj; a && a.parent && a.parent !== this.scene; a = a.parent) {
          for (const o of a.parent.children) {
            if (o === a || o.isLight || o.isSprite) continue;
            const b = new T.Box3().setFromObject(o);
            if (b.isEmpty()) continue;
            b.getSize(v);
            if (v.x > 18 || v.z > 14) continue;
            if (b.intersectsBox(box)) continue;   // it touches the component (the card board under it)
            sib.push({ obj: o, box: b.expandByScalar(0.01) });
          }
        }
        this.focusSibList = sib;
      }
      for (const c of this.occluders().concat(this.focusSibList || [])) {
        if (within(c.obj, ft.obj) || within(ft.obj, c.obj)) continue;
        if (c.box.containsPoint(cam)) { hide.add(c.obj); continue; }
        for (const p of pts) {
          ray.origin.copy(cam);
          ray.direction.subVectors(p, cam).normalize();
          if (ray.intersectBox(c.box, hit) && cam.distanceTo(hit) < cam.distanceTo(p) - 0.01) { hide.add(c.obj); break; }
        }
      }
      this.applyHidden(hide);
    }
    applyHidden(set) {
      const prev = this.focusHidden || new Set();
      let changed = false;
      for (const o of prev) if (!set.has(o)) { o.visible = true; changed = true; }
      for (const o of set) if (o.visible) { o.visible = false; changed = true; }
      this.focusHidden = set;
      if (!changed) return;
      // the pins of the hidden parts (they are in shared instanced meshes)
      const all = new Set();
      for (const o of set) o.traverse(x => all.add(x));
      for (const is of this.instSets || []) {
        const a = is.mesh.instanceMatrix.array;
        let ch = false;
        is.owners.forEach((g, i) => {
          const h = all.has(g) ? 1 : 0;
          if (h === is.hid[i]) return;
          is.hid[i] = h; ch = true;
          if (h) a.fill(0, i * 16, i * 16 + 16); else a.set(is.orig.subarray(i * 16, i * 16 + 16), i * 16);
        });
        if (ch) is.mesh.instanceMatrix.needsUpdate = true;
      }
      this.dirty = true;
    }
    updateOcclusion(cam, target) {
      const ft = this.focusTarget();
      if (ft) { this.focusOcclude(cam, ft); return; }
      if (this.focusHidden && this.focusHidden.size) { this.applyHidden(new Set()); this.focusKey = ''; }
      for (const cg of [this.card, this.dcard, this.xcard]) {
        if (!cg) continue;
        const z = cg.position.z, len = cg.userData.len || 11;
        const block = (cam.z - z) * (target.z - z) < -1e-4 && target.y > 0.45 && Math.abs(target.x - cg.position.x) < len / 2 + 1.5 && cam.distanceTo(target) < 16;
        if (cg.visible === block) { cg.visible = !block; this.dirty = true; }
      }
    }

    // ---------- 80286 board parts ----------
    // The 80286 in a 68-lead ceramic chip carrier (grey-blue ceramic, gold lid) in a socket.
    buildQuad(spec, parent, P) {
      const d = this.chipDims(spec);
      const grp = new T.Group();
      grp.position.set(spec.x, 0, spec.z);
      parent.add(grp);
      const so = d.sock, sh = 0.42;
      if (!d.qfp) {
        const outer = roundRect(new T.Shape(), so, so, 0.14);
        outer.holes.push(roundRect(new T.Path(), d.L + 0.18, d.W + 0.18, 0.05));
        const sg = new T.ExtrudeGeometry(outer, { depth: sh, bevelEnabled: false, curveSegments: 4 });
        sg.rotateX(-Math.PI / 2);
        const sock = new T.Mesh(sg, new T.MeshPhysicalMaterial({ color: PAL.slot, roughness: 0.55, clearcoat: 0.3, envMapIntensity: 0.4 }));
        sock.castShadow = true; sock.receiveShadow = true;
        grp.add(sock);
        const well = new T.Mesh(new T.BoxGeometry(d.L + 0.18, 0.08, d.W + 0.18), this.mats.black);
        well.position.y = 0.04;
        grp.add(well);
      }
      // the chip carrier (ceramic) or a plastic quad flat package
      const mat = (d.qfp ? this.mats.plastic : this.mats.ceramic).clone();
      const bg = new T.ExtrudeGeometry(roundRect(new T.Shape(), d.L - 0.06, d.W - 0.06, 0.06), { depth: d.H - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
      bg.rotateX(-Math.PI / 2);
      bg.translate(0, 0.03, 0);
      const body = new T.Mesh(bg, mat);
      body.position.y = d.base;
      body.castShadow = true; body.receiveShadow = true;
      body.userData.pick = spec.glowAs || spec.id;
      body.userData.decap = spec.id;
      grp.add(body);
      this.pick.push(body);
      this.decapTargets.push(body);
      const top = d.base + d.H;
      this.registerDecap(spec.id, grp, { ...d, pins: spec.pins }, top + (d.qfp ? 0.006 : 0.045), spec.part, spec.glowAs || spec.id);
      // marking around the lid
      const c = canvas(512, 512), g = c.getContext('2d');
      g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = PAL.inkCer; g.globalAlpha = 0.85;
      for (const [str, y, sz] of d.qfp ? [[spec.mark[0], 200, 70], [spec.mark[1], 300, 40]] : [[spec.mark[0], 30, 44], [spec.mark[1], 452, 32]]) {
        g.lineWidth = sz * 0.12;
        strokeTextCanvas(g, str, 256, y, Math.min(sz, 400 / strokeTextWidth(str, 1)), 1.5, 'center');
      }
      g.globalAlpha = 0.6; g.fillStyle = d.qfp ? PAL.dimplePl : PAL.dimple;
      g.beginPath(); g.moveTo(8, 8); g.lineTo(60, 8); g.lineTo(8, 60); g.closePath(); g.fill();
      const tex = colorTex(c, this.aniso);
      const lmat = new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#000000', transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
      const lbl = new T.Mesh(new T.PlaneGeometry(d.L * 0.97, d.W * 0.97), lmat);
      lbl.rotation.x = -Math.PI / 2;
      lbl.position.y = top + 0.002;
      grp.add(lbl);
      const gl = this.makeGlow(spec.glowAs || spec.id, grp, so / 2, so / 2, THEME.gold);
      gl.mats.push(mat); gl.labels.push(lmat);
      gl.ref = spec.ref; gl.part = spec.part;
      if (d.qfp) {
        // gull-wing leads on four sides, and their pads
        const n = spec.pins / 4;
        for (let sd = 0; sd < 4; sd++) {
          for (let i = 0; i < n; i++) {
            const off = (i - (n - 1) / 2) * d.lp, rot = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][sd];
            const x = sd === 1 ? d.L / 2 : sd === 3 ? -d.L / 2 : off, z = sd === 0 ? -d.W / 2 : sd === 2 ? d.W / 2 : off;
            this.gleads.push({ grp, x, z, rot, y: 0 });
            if (P && i % 2 === 0) {
              const r = d.L / 2 + 0.16, [px, pz] = sd === 0 ? [off, -r] : sd === 1 ? [r, off] : sd === 2 ? [off, r] : [-r, off];
              P.rect(spec.x + px - 0.03, spec.z + pz - 0.03, 0.06 + (sd % 2 ? 0.12 : 0), 0.06 + (sd % 2 ? 0 : 0.12), PAL.pad, rgb(0.75, 0.28, 1));
            }
          }
        }
        if (P) { const o = d.L + 0.7; P.rect(spec.x - o / 2, spec.z - o / 2, o, o, THEME.silk, rgb(0.45, 0.8, 0), 0.02); P.text(`${spec.ref} ${spec.mark[0]}`, spec.x - o / 2, spec.z + o / 2 + 0.12, 0.2); }
        gl.pos.set(spec.x, 0.4, spec.z);
        return grp;
      }
      const lidMat = this.mats.gold.clone();
      lidMat.roughnessMap = this.brushedMap();
      lidMat.roughness = 1;
      const ls = d.L * 0.56;
      const lid = new T.Mesh(new T.BoxGeometry(ls, 0.035, ls), lidMat);
      lid.position.y = top + 0.018;
      lid.castShadow = true;
      grp.add(lid);
      const ring = new T.Mesh(new T.BoxGeometry(ls + 0.16, 0.012, ls + 0.16), this.mats.gold);
      ring.position.y = top + 0.006;
      grp.add(ring);
      gl.lid = lidMat;
      this.glint = glowMat(GLINT_FS, { uT: { value: -1 }, uColor: { value: new T.Color('#fff4dc') }, uAmp: { value: 1 } });
      const gm = new T.Mesh(new T.PlaneGeometry(ls, ls), this.glint);
      gm.rotation.x = -Math.PI / 2;
      gm.position.y = top + 0.037;
      gm.renderOrder = 3;
      grp.add(gm);
      // J-leads on four sides, and the socket contacts behind them
      const n = spec.pins / 4;
      for (let sd = 0; sd < 4; sd++) {
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * d.lp;
          const rot = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][sd];
          const x = sd === 1 ? d.L / 2 : sd === 3 ? -d.L / 2 : off, z = sd === 0 ? -d.W / 2 : sd === 2 ? d.W / 2 : off;
          this.jleads.push({ grp, x, z, rot, y: d.base - 0.12 });
        }
      }
      if (P) {
        // socket pins: two staggered rows of pads on each side
        for (let sd = 0; sd < 4; sd++) {
          for (let i = 0; i < n; i++) {
            const off = (i - (n - 1) / 2) * 0.17, r = so / 2 + 0.12 + (i % 2) * 0.2;
            const [px, pz] = sd === 0 ? [off, -r] : sd === 1 ? [r, off] : sd === 2 ? [off, r] : [-r, off];
            P.pad(spec.x + px, spec.z + pz, 0.1, 0.1);
          }
        }
        const o = so + 0.72;
        P.rect(spec.x - o / 2, spec.z - o / 2, o, o, THEME.silk, rgb(0.45, 0.8, 0), 0.022);
        P.dot(spec.x - o / 2 + 0.25, spec.z - o / 2 + 0.25, 0.08, THEME.silk, rgb(0.45, 0.8, 0));
        P.text(`${spec.ref} ${spec.part}`, spec.x - o / 2, spec.z + o / 2 + 0.16, 0.24);
      }
      gl.pos.set(spec.x, 0.4, spec.z);
      return grp;
    }
    buildXCard() {
      const c = XCARD;
      this.xcard = this.buildCardBoard(c, XCARD_CHIPS, '1 MB EXTENDED MEMORY', 'ANATOMY-286 16-BIT  100000-1FFFFF');
      if (this.glows.xram) this.glows.xram.pos.set(c.x, 3, c.z);
    }
    crystal(parent, P, x, z, id, ref, alongX) {
      const xg = new T.Group();
      xg.position.set(x, 0, z);
      if (alongX) xg.rotation.y = Math.PI / 2;
      parent.add(xg);
      const cs = new T.Shape();
      roundRect(cs, 1.1, 0.42, 0.2);
      const can = new T.Mesh(new T.ExtrudeGeometry(cs, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3 }), this.mats.steel);
      can.geometry.rotateX(-Math.PI / 2);
      can.geometry.rotateY(Math.PI / 2);
      can.position.y = 0.06;
      can.castShadow = true;
      can.userData.pick = id;
      xg.add(can);
      this.pick.push(can);
      const [w, dd] = alongX ? [1.3, 0.6] : [0.6, 1.3];
      P.rect(x - w / 2, z - dd / 2, w, dd, THEME.silk, rgb(0.45, 0.8, 0), 0.022);
      if (alongX) { P.pad(x - 0.25, z, 0.18, 0.18); P.pad(x + 0.25, z, 0.18, 0.18); P.text(ref, x - 1.2, z - 0.11, 0.22, { align: 'center' }); }
      else { P.pad(x, z - 0.25, 0.18, 0.18); P.pad(x, z + 0.25, 0.18, 0.18); P.text(ref, x, z - 1.25, 0.22, { align: 'center' }); }
      this.makeGlow(id, xg, 0.25, 0.6, THEME.magenta).pos.set(x, 0.3, z);
    }
    // A 3 V coin cell in its holder (it keeps the RTC and CMOS alive).
    buildBattery(parent, P) {
      const x = 15.4, z = 2.6;
      const holder = new T.Mesh(new T.CylinderGeometry(0.82, 0.86, 0.16, 40), this.mats.black);
      holder.position.set(x, 0.08, z);
      holder.castShadow = true;
      parent.add(holder);
      const cell = new T.Mesh(new T.CylinderGeometry(0.68, 0.68, 0.12, 48), this.mats.steel);
      cell.position.set(x, 0.2, z);
      cell.castShadow = true;
      cell.userData.pick = 'bat';
      parent.add(cell);
      this.pick.push(cell);
      const clip = new T.Mesh(new T.BoxGeometry(0.34, 0.05, 1.2), this.mats.tin);
      clip.position.set(x, 0.29, z);
      parent.add(clip);
      P.cc.strokeStyle = THEME.silk; P.cc.lineWidth = 0.022 * PPU;
      P.cc.beginPath(); P.cc.arc(P.X(x), P.Z(z), 0.98 * PPU, 0, TAU); P.cc.stroke();
      P.text('BT1 3V +', x - 0.9, z + 1.15, 0.18);
      const g = new T.Group();
      g.position.set(x, 0, z);
      parent.add(g);
      this.makeGlow('bat', g, 0.8, 0.8, THEME.phosphor).pos.set(x, 0.3, z);
    }
    paintSilk286(P) {
      const mg = { color: THEME.magenta, alpha: 0.7 };
      P.text(NM.board, 10.0, 2.0, 0.46, { align: 'center' });
      P.text('AT SYSTEM BOARD  REV A', 10.0, 2.8, 0.2, { align: 'center', alpha: 0.75 });
      P.text('(C) 2026', 10.0, 3.25, 0.2, { align: 'center', alpha: 0.75 });
      P.text('16 MHZ', -16.3, -4.55, 0.2);
      P.text('14.31818 MHZ', 11.2, -10.72, 0.18);
      P.text('A0-A23', -7.7, -4.2, 0.17, { color: THEME.cyan, alpha: 0.7 });
      P.text('D0-D15', -5.95, -1.6, 0.16, { rot: Math.PI / 2, color: THEME.goldHi, alpha: 0.7 });
      P.text('SA0-SA23', 1.95, 1.2, 0.2, { rot: Math.PI / 2, color: THEME.cyan, alpha: 0.7 });
      P.text('SD0-SD15', -0.7, -0.5, 0.2, { rot: -Math.PI / 2, color: THEME.goldHi, alpha: 0.7, align: 'center' });
      P.text('D0-D7', -12.8, 3.55, 0.18, { color: THEME.goldHi, alpha: 0.7 });
      P.text('D8-D15', -12.8, 10.72, 0.16, { color: THEME.goldHi, alpha: 0.7 });
      P.text('XD0-XD7  SA0-SA9', 4.2, -6.05, 0.15, { alpha: 0.6 });
      P.text('MRDC MWTC', -16.05, 0.4, 0.16, { rot: Math.PI / 2, ...mg });
      P.text('S1 S0 M/IO', -9.3, -5.1, 0.14, { align: 'center', ...mg });
      P.text('ALE', -7.3, -5.55, 0.16, mg);
      P.text('DEN DT/R', -5.6, 0.2, 0.15, { rot: Math.PI / 2, ...mg });
      P.text('INTR', -3.5, -7.65, 0.16, mg);
      P.text('ERROR IRQ13', -3.9, -6.45, 0.15, mg);
      P.text('PEREQ PEACK', -12.6, -0.75, 0.11, { color: THEME.lavender, alpha: 0.8 });
      P.text('BUSY ERROR', -12.6, 0.45, 0.11, { color: THEME.lavender, alpha: 0.8 });
      P.text('CLK', -13.75, -3.2, 0.14, mg);
      P.text('U5 82288', -12.6, -6.45, 0.2);
      P.text('U10 U11 74LS245', -5.6, 3.3, 0.2);
      P.text('XD BUS', 14.3, 0.75, 0.14, { align: 'center', alpha: 0.7 });
      P.text('ROM', 8.0, 5.5, 0.22);
      P.text('ROM', 8.0, 8.9, 0.22);
      for (const b of BANKS) P.text(b.silk, -14.0, b.z + 1.3, 0.2, { rot: -Math.PI / 2 });
      P.text('J1 J3 J5  ISA / AT 16-BIT SLOTS', -14.0, -10.82, 0.16, { alpha: 0.8 });
      P.text('16-BIT', -2.25, -7.5, 0.13, { align: 'center', alpha: 0.7 });
      P.cc.strokeStyle = 'rgba(241,238,224,0.12)'; P.cc.lineWidth = 3;
      P.cc.strokeRect(0.25 * PPU, 0.25 * PPU, (BW - 0.5) * PPU, (BD - 0.5) * PPU);
    }

    // Fine streaks for a brushed-metal roughness (G channel).
    brushedMap() {
      if (this.brushed) return this.brushed;
      const c = canvas(256, 128), g = c.getContext('2d');
      g.fillStyle = rgb(0, 0.26, 0); g.fillRect(0, 0, 256, 128);
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 700; i++) {
        g.fillStyle = rgb(0, 0.16 + rnd() * 0.2, 0);
        g.fillRect(rnd() * 256, rnd() * 128, 20 + rnd() * 90, 1);
      }
      const gr = g.createLinearGradient(0, 0, 256, 128);
      gr.addColorStop(0, 'rgba(0,40,0,0.25)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,30,0,0.2)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
      this.brushed = new T.CanvasTexture(c);
      return this.brushed;
    }
    buildWindow(grp0, top, gl) {
      const grp = new T.Group();
      grp0.add(grp);
      const cav = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 0.01, 32), new T.MeshStandardMaterial({ color: '#08060c', roughness: 0.4 }));
      cav.position.y = top + 0.003;
      grp.add(cav);
      const dc = canvas(64, 64), g = dc.getContext('2d');
      g.fillStyle = '#6b5a3a'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#c9a45a';
      for (let y = 4; y < 60; y += 7) for (let x = 4; x < 60; x += 5) if ((x * 7 + y * 3) % 11 > 3) g.fillRect(x, y, 3, 4);
      g.strokeStyle = '#f6d27a'; g.lineWidth = 2; g.strokeRect(2, 2, 60, 60);
      const dt = colorTex(dc);
      const dieMat = new T.MeshStandardMaterial({ map: dt, emissiveMap: dt, emissive: '#000000', roughness: 0.3, metalness: 0.6 });
      const die = new T.Mesh(new T.BoxGeometry(0.3, 0.02, 0.24), dieMat);
      die.position.y = top + 0.012;
      grp.add(die);
      const glass = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.035, 40), new T.MeshPhysicalMaterial({
        color: '#e8e0ff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
      }));
      glass.position.y = top + 0.02;
      grp.add(glass);
      gl.die = dieMat;
      return grp;
    }
    paintFootprint(P, spec, d) {
      const rot = !!spec.rot;
      const W2 = (w, dd) => (rot ? [dd, w] : [w, dd]);
      // local (lx, lz) -> world
      const at = (lx, lz) => (rot ? [spec.x + lz, spec.z - lx] : [spec.x + lx, spec.z + lz]);
      const half = spec.pins / 2;
      for (let i = 0; i < half; i++) {
        const x = (i - (half - 1) / 2) * PITCH;
        for (const zz of [-1, 1]) {
          const [wx, wz] = at(x, zz * d.row / 2);
          const [pw, pd] = W2(0.15, 0.22);
          P.pad(wx, wz, pw, pd);
        }
      }
      // silkscreen outline and pin-1 mark
      const [ow, od] = W2(d.L + 0.2, d.row + 0.34);
      P.rect(spec.x - ow / 2, spec.z - od / 2, ow, od, THEME.silk, rgb(0.45, 0.8, 0), 0.022);
      const [nx, nz] = at(-d.L / 2 - 0.1, 0);
      P.dot(nx, nz, 0.07, THEME.silk, rgb(0.45, 0.8, 0));
      // reference and part
      const label = `${spec.ref} ${spec.part}`;
      const size = 0.24;
      if (spec.silk === 'none') return;
      if (rot) {
        P.text(label, spec.x, spec.z - d.L / 2 - 0.36, size * 0.9, { align: 'center', color: spec.ink === 'lav' ? THEME.lavender : THEME.silk });
      } else if (spec.silk === 'below') {
        P.text(label, spec.x - d.L / 2, spec.z + d.row / 2 + 0.26, size, { color: spec.ink === 'lav' ? THEME.lavender : THEME.silk });
      } else if (spec.silk === 'right') {
        P.text(label, spec.x + d.L / 2 + 0.3, spec.z - size / 2, size);
      } else {
        P.text(label, spec.x - d.L / 2, spec.z - d.row / 2 - 0.26 - size, size);
      }
    }
    buildBanks(parent, P) {
      const spec = BANK_SPEC;
      const d = this.chipDims(spec);
      const geo = bodyGeo(d.L, d.W, d.H, 0.13);
      const lc = this.labelCanvas(spec, d);
      const tex = colorTex(lc, this.aniso);
      const lgeo = new T.PlaneGeometry(d.L * 0.97, d.W * 0.94);
      lgeo.rotateX(-Math.PI / 2);
      const m4 = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(0, Math.PI / 2, 0)), one = new T.Vector3(1, 1, 1);
      for (const b of BANKS) {
        const mat = this.mats.plastic.clone();
        const body = new T.InstancedMesh(geo, mat, 8);
        const lmat = new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#000000', transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
        const lbl = new T.InstancedMesh(lgeo, lmat, 8);
        for (let i = 0; i < 8; i++) {
          const x = RAM_X(i);
          m4.compose(new T.Vector3(x, d.base, b.z), q, one);
          body.setMatrixAt(i, m4);
          m4.compose(new T.Vector3(x, d.base + d.H + 0.002, b.z), q, one);
          lbl.setMatrixAt(i, m4);
          const g = new T.Group();
          g.position.set(x, 0, b.z); g.rotation.y = Math.PI / 2;
          parent.add(g);
          this.registerDecap(b.id + i, g, { ...d, pins: 16 }, d.base + d.H + 0.006, spec.part, b.id);
          const half = 8;
          for (let k = 0; k < half; k++) {
            const px = (k - (half - 1) / 2) * PITCH;
            this.pins.push({ grp: g, x: px, z: d.row / 2, rot: 0 });
            this.pins.push({ grp: g, x: px, z: -d.row / 2, rot: Math.PI });
          }
          this.paintFootprint(P, { ...spec, ref: '', x, z: b.z, rot: 1, silk: 'none' }, d);
        }
        body.castShadow = true; body.receiveShadow = true;
        body.userData.pick = b.id;
        body.userData.decapBank = b.id;
        this.decapTargets.push(body);
        parent.add(body); parent.add(lbl);
        this.pick.push(body);
        const cx = (RAM_X(0) + RAM_X(7)) / 2, span = RAM_X(7) - RAM_X(0) + d.W;
        const hg = new T.Group();
        hg.position.set(cx, 0, b.z);
        parent.add(hg);
        const gl = this.makeGlow(b.id, hg, span / 2, d.L / 2, THEME.gold);
        gl.mats.push(mat); gl.labels.push(lmat);
        gl.pos.set(cx, 0.3, b.z);
        gl.ref = 'U20–U35'; gl.part = spec.part;
      }
    }
    // Crystal, capacitors, speaker, slot, keyboard socket, power header.
    buildParts(parent, P) {
      // crystals HC-49
      if (M286) { this.crystal(parent, P, -15.6, -2.8, 'xtal', 'Y1'); this.crystal(parent, P, 13.4, -9.9, 'xtal2', 'Y2', true); }
      else this.crystal(parent, P, -15.6, -1.8, 'xtal', 'Y1');
      // electrolytic capacitors
      const cc = canvas(256, 64), g = cc.getContext('2d');
      g.fillStyle = PAL.capSleeve; g.fillRect(0, 0, 256, 64);
      g.fillStyle = PAL.capStripe; g.fillRect(0, 0, 40, 64);
      g.strokeStyle = PAL.capSleeve; g.lineWidth = 4;
      for (let y = 10; y < 60; y += 14) { g.beginPath(); g.moveTo(14, y); g.lineTo(26, y); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 2, 256, 3);
      const sleeve = new T.MeshPhysicalMaterial({ map: colorTex(cc), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.9 });
      const capGeo = new T.CylinderGeometry(0.32, 0.32, 0.95, 28);
      const topGeo = new T.CylinderGeometry(0.3, 0.3, 0.02, 28);
      for (const [x, z] of M286 ? [[-16.0, 4.6], [-16.0, 9.6], [12.6, 4.2], [16.1, 0.9], [8.8, -10.1], [16.2, -1.2], [-6.0, 6.9], [-2.2, -6.9]]
        : [[-16.0, 4.6], [-16.0, 9.6], [9.0, 1.6], [16.1, 1.2], [8.6, -10.1], [16.1, -1.3], [-6.0, 6.9], [-2.2, -6.9]]) {
        const cap = new T.Mesh(capGeo, sleeve);
        cap.position.set(x, 0.5, z);
        cap.rotation.y = Math.random() * TAU;
        cap.castShadow = true;
        parent.add(cap);
        const t = new T.Mesh(topGeo, this.mats.steel);
        t.position.set(x, 0.98, z);
        parent.add(t);
        P.cc.strokeStyle = THEME.silk; P.cc.lineWidth = 0.022 * PPU;
        P.cc.beginPath(); P.cc.arc(P.X(x), P.Z(z), 0.4 * PPU, 0, TAU); P.cc.stroke();
        P.text('+', x + 0.38, z - 0.62, 0.18);
      }
      // small decoupling capacitors next to many chips
      const dGeo = new T.SphereGeometry(0.13, 12, 8);
      dGeo.scale(1.25, 0.8, 0.7);
      const dMat = new T.MeshPhysicalMaterial({ color: '#b8793a', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
      const spots = [];
      for (const c of CHIPS) {
        const d = this.chipDims(c);
        if (d.quad) spots.push([c.x + d.sock / 2 + 0.25, c.z + d.sock / 2 + 0.1]);
        else if (c.rot) spots.push([c.x + 0.62, c.z + d.L / 2 + 0.2]);
        else spots.push([c.x + d.L / 2 + 0.3, c.z + d.row / 2 + 0.05]);
      }
      for (let i = 0; i < 8; i += 2) spots.push([RAM_X(i) + 0.72, 7.3 - 0.95], [RAM_X(i + 1) + 0.72, 7.3 + 0.95]);
      const dm = new T.InstancedMesh(dGeo, dMat, spots.length);
      const m4 = new T.Matrix4();
      spots.forEach(([x, z], i) => {
        m4.makeTranslation(x, 0.14, z);
        dm.setMatrixAt(i, m4);
        P.pad(x - 0.12, z, 0.1, 0.12); P.pad(x + 0.12, z, 0.1, 0.12);
      });
      dm.castShadow = true;
      parent.add(dm);
      this.buildSpeaker(parent, P);
      if (M286) this.buildBattery(parent, P);
      // ISA slots (the 80286 board adds a 16-bit AT slot with its extension connector)
      const slotMat = new T.MeshPhysicalMaterial({ color: PAL.slot, roughness: 0.5, clearcoat: 0.3 });
      const slitMat = new T.MeshBasicMaterial({ color: PAL.slit });
      const conn = (x, z, len, n) => {
        const slot = new T.Mesh(new T.BoxGeometry(len, 0.85, 0.68), slotMat);
        slot.position.set(x, 0.425, z);
        slot.castShadow = true;
        parent.add(slot);
        const slit = new T.Mesh(new T.BoxGeometry(len - 0.4, 0.02, 0.18), slitMat);
        slit.position.set(x, 0.855, z);
        parent.add(slit);
        P.rect(x - len / 2 - 0.15, z - 0.44, len + 0.3, 0.88, THEME.silk, rgb(0.45, 0.8, 0), 0.02);
        for (let i = 0; i < n; i++) { P.pad(x - (n - 1) * 0.15 + i * 0.3, z - 0.2, 0.12, 0.16); P.pad(x - (n - 1) * 0.15 + i * 0.3, z + 0.2, 0.12, 0.16); }
      };
      for (const cd of M286 ? [VID, DCARD, XCARD, SBCARD, HDCARD] : [VID, DCARD, SBCARD, HDCARD]) {
        conn(cd.x + (cd.fo || 0), cd.z, 9.6, 31);
        if (cd.ext !== undefined) conn(cd.x + cd.ext, cd.z, 2.8, 9);
      }
      // keyboard DIN socket
      const kg = new T.Group();
      kg.position.set(15.3, 0, -10.25);
      parent.add(kg);
      const shell = new T.Mesh(new T.BoxGeometry(1.7, 1.45, 1.5), this.mats.steel);
      shell.position.y = 0.73;
      shell.castShadow = true;
      shell.userData.pick = 'kbd';
      kg.add(shell);
      this.pick.push(shell);
      const face = new T.Mesh(new T.CylinderGeometry(0.62, 0.62, 0.12, 36), this.mats.black);
      face.rotation.x = Math.PI / 2;
      face.position.set(0, 0.75, -0.78);
      kg.add(face);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.15 + i * 0.175) + Math.PI;
        const h = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.04, 10), new T.MeshBasicMaterial({ color: '#000000' }));
        h.rotation.x = Math.PI / 2;
        h.position.set(Math.cos(a) * 0.36, 0.75 - Math.sin(a) * 0.36, -0.84);
        kg.add(h);
      }
      this.makeGlow('kbd', kg, 0.85, 0.75, THEME.magenta).pos.set(15.3, 0.3, -10.25);
      P.text('J2 KBD', 13.3, -10.7, 0.22);
      // power header
      const ph = new T.Mesh(new T.BoxGeometry(3.0, 0.9, 0.62), new T.MeshPhysicalMaterial({ color: PAL.header, roughness: 0.45, clearcoat: 0.3 }));
      ph.position.set(6.5, 0.45, -10.2);
      ph.castShadow = true;
      parent.add(ph);
      for (let i = 0; i < 6; i++) {
        const pin = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), this.mats.tin);
        pin.position.set(6.5 - 1.25 + i * 0.5, 0.9, -10.2);
        parent.add(pin);
      }
      P.text('P8 +5V GND', 6.5, -9.55, 0.2, { align: 'center' });
    }
    buildSpeaker(parent, P) {
      const g = this.spk = new T.Group();
      g.position.set(SPEAKER.x, 0, SPEAKER.z);
      parent.add(g);
      const r = SPEAKER.r;
      const basket = new T.Mesh(new T.CylinderGeometry(r, r * 0.55, 0.9, 48, 1, true), new T.MeshStandardMaterial({ color: PAL.basket, roughness: 0.6, metalness: 0.4, side: T.DoubleSide }));
      basket.position.y = 0.45;
      basket.castShadow = true;
      g.add(basket);
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new T.Vector2(0.35 + t * (r - 0.5), 0.35 + Math.pow(t, 1.4) * 0.62));
      }
      pts.push(new T.Vector2(r - 0.05, 0.99));
      const coneMat = new T.MeshPhysicalMaterial({ color: PAL.cone, roughness: 0.85, sheen: 1, sheenColor: new T.Color(PAL.coneSheen), sheenRoughness: 0.6, side: T.DoubleSide });
      this.cone = new T.Mesh(new T.LatheGeometry(pts, 64), coneMat);
      g.add(this.cone);
      const cap = new T.Mesh(new T.SphereGeometry(0.45, 32, 16, 0, TAU, 0, Math.PI / 2), new T.MeshPhysicalMaterial({ color: PAL.spkCap, roughness: 0.3, clearcoat: 1 }));
      cap.scale.y = 0.5;
      cap.position.y = 0.35;
      this.cone.add(cap);
      const rim = new T.Mesh(new T.TorusGeometry(r, 0.1, 12, 72), this.mats.case);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.0;
      rim.castShadow = true;
      g.add(rim);
      // perforated grille
      const gc = canvas(512, 512), gg = gc.getContext('2d');
      gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, 512, 512);
      gg.fillStyle = '#000000';
      for (let y = 10; y < 512; y += 22) for (let x = (y / 22) % 2 ? 21 : 10; x < 512; x += 22) {
        const dx = x - 256, dy = y - 256;
        if (dx * dx + dy * dy < 236 * 236) { gg.beginPath(); gg.arc(x, y, 7.5, 0, TAU); gg.fill(); }
      }
      const at = new T.CanvasTexture(gc);
      const grille = new T.Mesh(new T.CircleGeometry(r - 0.04, 64), new T.MeshStandardMaterial({
        color: PAL.grille, metalness: 0.9, roughness: 0.38, alphaMap: at, alphaTest: 0.5, side: T.DoubleSide, envMapIntensity: 1,
      }));
      grille.rotation.x = -Math.PI / 2;
      grille.position.y = 1.08;
      grille.castShadow = true;
      grille.userData.pick = 'spk';
      g.add(grille);
      this.pick.push(grille);
      this.spkRing = glowMat(RING_FS, { uColor: { value: new T.Color(THEME.magenta) }, uI: { value: 0 } });
      const ring = new T.Mesh(new T.PlaneGeometry(r * 2.8, r * 2.8), this.spkRing);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      g.add(ring);
      P.cc.strokeStyle = THEME.silk; P.cc.lineWidth = 0.025 * PPU;
      P.cc.beginPath(); P.cc.arc(P.X(SPEAKER.x), P.Z(SPEAKER.z), (r + 0.25) * PPU, 0, TAU); P.cc.stroke();
      P.text('SPKR', SPEAKER.x - r - 0.2, SPEAKER.z + r + 0.2, 0.22);
      this.makeGlow('spk', g, 0.01, 0.01, THEME.magenta).pos.set(SPEAKER.x, 0.5, SPEAKER.z);
    }
    paintSilk(P) {
      if (M286) return this.paintSilk286(P);
      const s = 0.2;
      P.text('ANATOMY-86', 7.3, -1.35, 0.46, { align: 'center' });
      P.text('SYSTEM BOARD  REV A', 7.3, -0.55, 0.2, { align: 'center', alpha: 0.75 });
      P.text('(C) 2026', 7.3, -0.1, 0.2, { align: 'center', alpha: 0.75 });
      P.text('14.31818 MHZ', -16.3, -3.7, 0.2);
      P.text('AD0-AD15 A16-A19', -6.75, -2.95, 0.17, { color: THEME.cyan, alpha: 0.7 });
      P.text('LOCAL BUS', -6.75, -0.95, 0.17, { alpha: 0.6 });
      P.text('A0-A19', 1.95, 1.2, s, { rot: Math.PI / 2, color: THEME.cyan, alpha: 0.7 });
      P.text('D0-D15', -0.7, -0.5, s, { rot: -Math.PI / 2, color: THEME.goldHi, alpha: 0.7, align: 'center' });
      P.text('D0-D7', -12.8, 3.55, 0.18, { color: THEME.goldHi, alpha: 0.7 });
      P.text('D8-D15', -12.8, 10.72, 0.16, { color: THEME.goldHi, alpha: 0.7 });
      P.text('I/O  SA0-SA7  D0-D7', 5.8, -6.25, 0.16, { alpha: 0.6 });
      P.text('MRDC MWTC', -16.05, 0.4, 0.16, { rot: Math.PI / 2, color: THEME.magenta, alpha: 0.7 });
      P.text('IORC IOWC INTA', -7.9, -6.95, 0.15, { color: THEME.magenta, alpha: 0.7 });
      P.text('S0-S2', -9.25, -4.55, 0.16, { color: THEME.magenta, alpha: 0.7 });
      P.text('ALE', -4.2, -5.9, 0.16, { color: THEME.magenta, alpha: 0.7 });
      P.text('DEN DT/R', -5.05, -0.2, 0.15, { rot: Math.PI / 2, color: THEME.magenta, alpha: 0.7 });
      P.text('INTR', -3.5, -7.65, 0.16, { color: THEME.magenta, alpha: 0.7 });
      P.text('NMI', -11.0, -4.45, 0.16, { color: THEME.magenta, alpha: 0.7 });
      P.text('RQ/GT0 QS0 QS1', -12.2, 0.12, 0.13, { color: THEME.lavender, alpha: 0.75 });
      P.text('CLK', -13.75, -2.35, 0.14, { color: THEME.magenta, alpha: 0.7 });
      P.text('U5 8288', -12.55, -5.1, 0.24);
      P.text('U10 U11 8286', -3.4, 3.75, 0.2);
      P.text('CS', 3.05, -2.2, 0.16, { color: THEME.magenta, alpha: 0.7 });
      P.text('ROM', 8.0, 5.5, 0.22);
      P.text('ROM', 8.0, 8.9, 0.22);
      for (const b of BANKS) P.text(b.silk, -14.0, b.z + 1.3, 0.2, { rot: -Math.PI / 2 });
      P.text('J1 J3 ISA SLOTS 8-BIT', CARD.x + 4.95, CARD.z + 0.62, 0.18, { align: 'right' });
      // board outline highlight
      P.cc.strokeStyle = 'rgba(239,230,216,0.12)'; P.cc.lineWidth = 3;
      P.cc.strokeRect(0.25 * PPU, 0.25 * PPU, (BW - 0.5) * PPU, (BD - 0.5) * PPU);
    }
    buildBoardMesh(P) {
      const cm = colorTex(P.c, this.aniso);
      const dm = new T.CanvasTexture(P.k);
      dm.anisotropy = this.aniso;
      for (const t of [cm, dm]) { t.repeat.set(1 / BW, 1 / BD); t.offset.set(0.5, 0.5); }
      const top = new T.MeshPhysicalMaterial({
        map: cm, roughnessMap: dm, metalnessMap: dm, bumpMap: dm, bumpScale: 1.4, roughness: 1, metalness: 1,
        clearcoat: 0.5, clearcoatRoughness: 0.34, envMapIntensity: 0.32,
      });
      const edge = new T.MeshStandardMaterial({ color: PAL.edge, roughness: 0.7 });
      const m = new T.Mesh(boardGeo(BW, BD, 0.16, 0.5), [top, edge]);
      m.receiveShadow = true;
      this.board.add(m);
      // brass standoffs
      const so = new T.CylinderGeometry(0.22, 0.22, -FLOOR_Y - 0.16, 6);
      for (const [x, z] of [[-16.1, -10.1], [16.1, -10.1], [-16.1, 10.1], [16.1, 10.1]]) {
        const s = new T.Mesh(so, this.mats.gold);
        s.position.set(x, (FLOOR_Y - 0.16) / 2, z);
        this.board.add(s);
      }
    }
    // An ISA card that stands in a slot. Card local x runs along the card, local z runs
    // down to the gold fingers, local +y points out of the component side (world +z).
    buildCardBoard(c, chips, title, sub) {
      const grp = new T.Group();
      grp.position.set(c.x, 0.25 + c.h / 2, c.z);
      grp.rotation.x = Math.PI / 2;
      this.scene.add(grp);
      const P = new Painter(c.len, c.h, 90);
      const g = P.cc;
      const gr = g.createLinearGradient(0, 0, 0, P.c.height);
      gr.addColorStop(0, PAL.cardTop); gr.addColorStop(1, THEME.mask);
      g.fillStyle = gr; g.fillRect(0, 0, P.c.width, P.c.height);
      P.kc.fillStyle = rgb(0.18, 0.5, 0); P.kc.fillRect(0, 0, P.c.width, P.c.height);
      const fo = c.fo || 0, fx = [];
      for (let i = 0; i < 31; i++) fx.push(fo - 4.5 + i * 0.3);
      if (c.ext !== undefined) for (let i = 0; i < 9; i++) fx.push(c.ext - 1.2 + i * 0.3);
      fx.forEach((x, i) => {
        P.rect(x - 0.1, c.h / 2 - 0.62, 0.2, 0.6, PAL.finger, rgb(0.7, 0.25, 1));
        const tx = x < fo - 1 ? chips[1].x + (i % 6 - 2.5) * 0.12 : chips[0].x + ((i % 10) - 4.5) * 0.18;
        P.poly([[x, c.h / 2 - 0.62], [x, 1.35], [tx, 1.35 - Math.abs(tx - x) * 0.25]], 0.035, PAL.copper, rgb(0.55, 0.42, 0));
      });
      for (const cs of chips) this.buildChip(cs, grp, P);
      P.text(title, -5.2, -1.98, 0.26);
      P.text(sub, -5.2, -1.56, 0.17, { alpha: 0.7 });
      const cm = colorTex(P.c, this.aniso), dm = new T.CanvasTexture(P.k);
      for (const t of [cm, dm]) { t.repeat.set(1 / c.len, 1 / c.h); t.offset.set(0.5, 0.5); }
      const mat = new T.MeshPhysicalMaterial({ map: cm, roughnessMap: dm, metalnessMap: dm, bumpMap: dm, bumpScale: 1.2, roughness: 1, metalness: 1, clearcoat: 0.5, clearcoatRoughness: 0.3 });
      const bm = new T.Mesh(boardGeo(c.len, c.h, 0.12, 0.15), [mat, new T.MeshStandardMaterial({ color: PAL.edge, roughness: 0.7 })]);
      bm.castShadow = true; bm.receiveShadow = true;
      bm.userData.pick = chips[0].glowAs || chips[0].id;
      grp.userData = { painter: P, len: c.len, repaint: () => { cm.needsUpdate = true; dm.needsUpdate = true; } };
      grp.add(bm);
      this.pick.push(bm);
      // bracket
      const br = new T.Mesh(new T.BoxGeometry(0.06, 1.5, c.h + 1.0), this.mats.steel);
      br.position.set(-c.len / 2 - 0.03, -0.2, -0.3);
      br.castShadow = true;
      grp.add(br);
      const lip = new T.Mesh(new T.BoxGeometry(0.9, 1.5, 0.06), this.mats.steel);
      lip.position.set(-c.len / 2 - 0.45, -0.2, -c.h / 2 - 0.8);
      grp.add(lip);
      this.placeCardChips(grp, chips);
      return grp;
    }
    buildCard() {
      if (VGA) return this.buildVgaCard();
      const c = CARD;
      const grp = this.card = this.buildCardBoard(c, CARD_CHIPS, 'CGA COLOR ADAPTER', 'ANATOMY-86 VIDEO  REV A');
      const de9 = new T.Mesh(new T.BoxGeometry(0.4, 0.5, 1.4), this.mats.black);
      de9.position.set(-c.len / 2 - 0.25, -0.35, -0.9);
      grp.add(de9);
      if (this.glows.crtc) this.glows.crtc.pos.set(c.x + 1.7, 3, c.z);
      if (this.glows.vram0) this.glows.vram0.pos.set(c.x - 2.6, 3, c.z);
      if (this.glows.vram1) this.glows.vram1.pos.set(c.x - 2.6, 2.5, c.z);
      this.monitorCable(c);
    }
    buildSoundCard() {
      const c = SBCARD;
      const grp = this.sbcard = this.buildCardBoard(c, SB_CHIPS, 'SOUND BLASTER 2.0', 'CT1350B  220H  IRQ 7  DMA 1  FM 388H');
      // the jacks and the joystick / MIDI port on the bracket
      const db = new T.Mesh(new T.BoxGeometry(0.42, 0.5, 1.8), this.mats.steel);
      db.position.set(-c.len / 2 - 0.25, -0.35, -0.2);
      grp.add(db);
      for (const z of [-1.6, -1.2, 1.2]) {
        const jack = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.5, 16), this.mats.black);
        jack.rotation.z = Math.PI / 2; jack.position.set(-c.len / 2 - 0.2, -0.35, z);
        grp.add(jack);
      }
      if (this.glows.sbdsp) this.glows.sbdsp.pos.set(c.x + 0.9, 3, c.z);
      if (this.glows.opl) this.glows.opl.pos.set(c.x - 3.4, 3, c.z);
    }
    buildDiskCard() {
      const c = DCARD;
      const grp = this.dcard = this.buildCardBoard(c, DISK_CHIPS, 'FLOPPY CONTROLLER uPD765', 'PORTS 3F2-3F7  DMA 2  IRQ 6');
      // 34-pin header on the top edge for the ribbon cable
      const hd = new T.Mesh(new T.BoxGeometry(2.4, 0.5, 0.55), this.mats.black);
      hd.position.set(3.4, 0.28, -c.h / 2 + 0.4);
      grp.add(hd);
      if (this.glows.fdc) this.glows.fdc.pos.set(c.x + 0.4, 3.5, c.z);
    }
    buildHdCard() {
      const c = HDCARD;
      const grp = this.hdcard = this.buildCardBoard(c, HD_CHIPS, 'IDE HARD DISK CARD', 'PORTS 1F0-1F7 3F6  IRQ 14  16-BIT');
      // the 40-pin header on the top edge for the drive cable
      const hd = new T.Mesh(new T.BoxGeometry(2.8, 0.5, 0.55), this.mats.black);
      hd.position.set(3.4, 0.28, -c.h / 2 + 0.4);
      grp.add(hd);
      if (this.glows.hdc) this.glows.hdc.pos.set(c.x + 1.2, 3.5, c.z);
    }
    // The bezel of the hard drive C: in the cage (the same size as the floppy faces).
    paintHardDrive(disk) {
      const dv = this.hdrive, g = dv.canvas.getContext('2d'), W = 512, H = 100;
      g.clearRect(0, 0, W, H);
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, PAL.drive0); gr.addColorStop(1, PAL.drive1);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
      // the vents of the bezel
      g.fillStyle = '#050307';
      for (let k = 0; k < 9; k++) g.fillRect(100 + k * 30, 26, 18, 22);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = THEME.goldHi; g.lineWidth = 3.2;
      strokeTextCanvas(g, dv.letter, 26, 24, 32, 1.6);
      g.strokeStyle = disk ? PAL.driveInk : PAL.driveOff; g.lineWidth = 2;
      const name = disk ? String(disk.name || 'DISK').toUpperCase().replace(/[^A-Z0-9 .:()+\-/]/g, ' ').slice(0, 20) : 'HARD DISK: NO IMAGE';
      strokeTextCanvas(g, name, 100, 62, Math.min(18, 250 / Math.max(1, strokeTextWidth(name, 1))), 1.5);
      if (disk && disk.size) {
        g.strokeStyle = PAL.driveInk2;
        strokeTextCanvas(g, Math.round(disk.size / 1048576) + ' MB', 386, 62, 16, 1.5, 'right');
      }
      dv.tex.needsUpdate = true;
    }
    // Three drives in a small steel cage behind the board: the two slim 3.5-inch floppy drives
    // A: and B:, and the hard drive C: (its bezel has the label and the activity LED).
    buildDrives() {
      const B = BAY;
      const grp = this.bay = new T.Group();
      grp.position.set(B.x, FLOOR_Y, B.z);
      grp.rotation.y = B.rot;
      this.scene.add(grp);
      grp.updateMatrixWorld(true);
      const cageH = B.dh * 3 + 1.2;
      const cage = new T.Mesh(new T.BoxGeometry(B.w + 0.5, cageH, B.d), new T.MeshStandardMaterial({ color: PAL.cage, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.35 }));
      cage.position.y = 0.35 + cageH / 2;
      cage.castShadow = true; cage.receiveShadow = true;
      grp.add(cage);
      const foot = new T.Mesh(new T.BoxGeometry(B.w + 1.2, 0.35, B.d + 0.6), this.mats.case);
      foot.position.y = 0.175;
      foot.castShadow = true; foot.receiveShadow = true;
      grp.add(foot);
      this.drives = [];
      for (let i = 0; i < 3; i++) {
        const y = 0.35 + 0.3 + (2 - i) * (B.dh + 0.3) + B.dh / 2;
        const bc = canvas(512, 100);
        const tex = colorTex(bc, this.aniso);
        const face = new T.Mesh(new T.PlaneGeometry(B.w, B.dh), new T.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 }));
        face.position.set(0, y, B.d / 2 + 0.012);
        face.userData.pick = i === 2 ? 'hdd' : i ? 'fddB' : 'fddA';
        grp.add(face);
        this.pick.push(face);
        const ledMat = new T.MeshStandardMaterial({ color: '#0d2a18', emissive: THEME.phosphor, emissiveIntensity: 0 });
        const led = new T.Mesh(new T.BoxGeometry(0.34, 0.12, 0.06), ledMat);
        led.position.set(B.w / 2 - 0.75, y - B.dh * 0.22, B.d / 2 + 0.04);
        grp.add(led);
        const ledGlow = glowMat(HALO_FS, { uColor: { value: new T.Color(THEME.phosphor) }, uI: { value: 0 }, uSize: { value: new T.Vector2(1.6, 1.2) }, uHalf: { value: new T.Vector2(0.17, 0.06) } });
        const lg = new T.Mesh(new T.PlaneGeometry(1.6, 1.2), ledGlow);
        lg.position.set(B.w / 2 - 0.75, y - B.dh * 0.22, B.d / 2 + 0.1);
        grp.add(lg);
        const drive = { canvas: bc, tex, ledMat, ledGlow, key: null, busy: 0, y, letter: 'ABC'[i] + ':' };
        this.facePos[['fddA', 'fddB', 'hdd'][i]] = grp.localToWorld(new T.Vector3(0, y, B.d / 2));
        if (i === 2) { this.hdrive = drive; this.paintHardDrive(null); continue; }
        const btn = new T.Mesh(new T.BoxGeometry(0.7, 0.26, 0.12), this.mats.caseDark);
        btn.position.set(B.w / 2 - 1.05, y + B.dh * 0.18, B.d / 2 + 0.05);
        grp.add(btn);
        this.drives.push(drive);
        this.paintDrive(drive, null);
      }
      // ribbon cable: disk card header -> drive B -> drive A (rear connectors)
      const c = DCARD;
      const hx = c.x + 3.4, top = 0.25 + c.h + 0.35;
      const rear = -B.d / 2 - 0.2;
      const yB = this.drives[1].y, yA = this.drives[0].y;
      const W = (x, y, z) => grp.localToWorld(new T.Vector3(x, y, z));
      const c1 = new T.CatmullRomCurve3([
        new T.Vector3(hx, top, c.z),
        new T.Vector3(hx - 0.5, top + 1.3, c.z - 1.2),
        new T.Vector3(hx - 6, top + 1.0, c.z - 4.5),
        W(3.5, yB + 1.6, rear - 1.8),
        W(1.2, yB, rear - 0.6),
        W(0.4, yB, rear),
      ]);
      const c2 = new T.CatmullRomCurve3([
        W(0.4, yB, rear),
        W(-0.9, yB - 0.2, rear - 0.9),
        W(-1.2, yA + 0.2, rear - 0.9),
        W(-0.4, yA, rear),
      ]);
      this.buildRibbon('FDD1', c1);
      this.buildRibbon('FDD2', c2);
      this.makeGlow('fddA', grp, 0.01, 0.01, THEME.phosphor).pos.set(B.x, 1.5, B.z);
      this.makeGlow('fddB', grp, 0.01, 0.01, THEME.phosphor).pos.set(B.x, 1.5, B.z);
      // the hard drive cable: the IDE card header -> the rear connector of drive C:
      const h = HDCARD, hhx = h.x + 3.4, htop = 0.25 + h.h + 0.35, yC = this.hdrive.y;
      const c3 = new T.CatmullRomCurve3([
        new T.Vector3(hhx, htop, h.z),
        new T.Vector3(hhx - 0.4, htop + 1.5, h.z - 1.0),
        new T.Vector3(hhx - 5, htop + 1.6, h.z - 6.0),
        W(-2.2, yC + 2.4, rear - 2.4),
        W(-1.0, yC, rear - 0.7),
        W(-0.6, yC, rear),
      ]);
      this.buildRibbon('HDD', c3);
      this.makeGlow('hdd', grp, 0.01, 0.01, THEME.phosphor).pos.set(B.x, 1.0, B.z);
    }
    // A flat grey ribbon along a curve, with a glow layer that uses the bus shader.
    buildRibbon(id, curve) {
      const n = 17, W = 1.25, seg = 90;
      const fr = curve.computeFrenetFrames(seg, false);
      const pts = curve.getSpacedPoints(seg);
      const S = [0];
      for (let i = 1; i <= seg; i++) S.push(S[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const side = i => fr.binormals[i];
      const up = i => fr.normals[i];
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const b = side(i);
        for (const s of [-1, 1]) {
          const p = pts[i].clone().addScaledVector(b, s * W / 2);
          pos.push(p.x, p.y, p.z); uv.push(s < 0 ? 0 : 1, S[i]);
        }
        if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (!this.ribbonTex) {
        const rc = canvas(256, 8), rg = rc.getContext('2d');
        for (let k = 0; k < n * 2; k++) {
          rg.fillStyle = k < 2 ? '#8a2a3a' : k % 2 ? '#5f5868' : '#8d8697';
          rg.fillRect(k * 256 / (n * 2), 0, 256 / (n * 2) + 1, 8);
        }
        this.ribbonTex = colorTex(rc);
        this.ribbonTex.wrapT = T.RepeatWrapping;
      }
      const body = new T.Mesh(g, new T.MeshStandardMaterial({ map: this.ribbonTex, roughness: 0.6, metalness: 0.05, side: T.DoubleSide }));
      body.castShadow = true;
      this.scene.add(body);
      // glow lines a little above both faces of the cable
      const gp = [], aS = [], aL = [], aV = [], gi = [];
      const gw = W / n * 1.8;
      for (const face of [1, -1]) {
        for (let li = 0; li < n; li++) {
          const off = (li - (n - 1) / 2) * (W / n);
          const base = gp.length / 3;
          for (let i = 0; i <= seg; i++) {
            const b = side(i), u = up(i);
            for (const s of [-1, 1]) {
              const p = pts[i].clone().addScaledVector(b, off + s * gw / 2).addScaledVector(u, face * 0.02);
              gp.push(p.x, p.y, p.z); aS.push(S[i]); aL.push(li); aV.push(s);
            }
            if (i < seg) { const a = base + i * 2; gi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
          }
        }
      }
      const gg = new T.BufferGeometry();
      gg.setAttribute('position', new T.Float32BufferAttribute(gp, 3));
      gg.setAttribute('aS', new T.Float32BufferAttribute(aS, 1));
      gg.setAttribute('aLine', new T.Float32BufferAttribute(aL, 1));
      gg.setAttribute('aV', new T.Float32BufferAttribute(aV, 1));
      gg.setIndex(gi);
      const mat = this.busMaterial();
      const m = new T.Mesh(gg, mat);
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.scene.add(m);
      const rt = { id, n, sp: W / n, bit: 0, path: [], S, len: S[seg], mat, mesh: m, prop: null, flow: 0, flowColor: new T.Color(), base: 0 };
      this.routes[id] = rt;
      this.routeList.push(rt);
    }
    paintDrive(dv, disk) {
      const g = dv.canvas.getContext('2d'), W = 512, H = 100;
      g.clearRect(0, 0, W, H);
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, PAL.drive0); gr.addColorStop(1, PAL.drive1);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
      // the disk slot; a blue disk edge shows in it when a disk is inserted
      g.fillStyle = '#050307';
      g.fillRect(96, 26, 290, 22);
      if (disk) {
        g.fillStyle = '#2d3f94'; g.fillRect(100, 29, 282, 16);
        g.fillStyle = '#c7ccd8'; g.fillRect(150, 32, 70, 10);
        g.fillStyle = '#e9e2d4'; g.fillRect(250, 32, 110, 10);
      }
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = THEME.goldHi; g.lineWidth = 3.2;
      strokeTextCanvas(g, dv.letter, 26, 24, 32, 1.6);
      g.strokeStyle = disk ? PAL.driveInk : PAL.driveOff; g.lineWidth = 2;
      const name = disk ? String(disk.name || 'DISK').toUpperCase().replace(/[^A-Z0-9 .:()+\-/]/g, ' ').slice(0, 20) : 'NO DISK';
      strokeTextCanvas(g, name, 100, 62, Math.min(18, 250 / Math.max(1, strokeTextWidth(name, 1))), 1.5);
      if (disk && disk.size) {
        g.strokeStyle = PAL.driveInk2;
        strokeTextCanvas(g, Math.round(disk.size / 1024) + 'K', 386, 62, 16, 1.5, 'right');
      }
      dv.tex.needsUpdate = true;
    }
    updateDrives(now, dt) {
      if (!this.drives) return;
      const disks = this.app.machine.disks || [];
      const fl = this.fastLv.fdc || 0;
      let busyMax = 0;
      this.drives.forEach((dv, i) => {
        const d = disks[i] || null;
        const key = d ? `${d.name}|${d.size}` : '';
        if (key !== dv.key) { dv.key = key; this.paintDrive(dv, d); this.dirty = true; }
        let b = d ? clamp(+d.busy || 0, 0, 1) : 0;
        if (d && fl > b && (d.busy > 0.02 || i === 0)) b = Math.max(b, fl * 0.8);
        dv.busy += (b - dv.busy) * (1 - Math.exp(-dt / (b > dv.busy ? 30 : 160)));
        if (dv.busy < 0.003) dv.busy = 0;
        dv.ledMat.emissiveIntensity = dv.busy * 3.2;
        dv.ledGlow.uniforms.uI.value = dv.busy * 1.6;
        const g = this.glows[i ? 'fddB' : 'fddA'];
        if (g) g.tgt = Math.max(g.tgt, dv.busy * 0.8);
        busyMax = Math.max(busyMax, dv.busy);
      });
      this.diskBusy = busyMax;
      const hv = this.hdrive;
      if (hv) {
        const d = this.app.machine.hdisk || null, key = d ? `${d.name}|${d.size}` : '';
        if (key !== hv.key) { hv.key = key; this.paintHardDrive(d); this.dirty = true; }
        let b = d ? clamp(+d.busy || 0, 0, 1) : 0;
        const fh = this.fastLv.hdc || 0;
        if (d && fh > b) b = Math.max(b, fh * 0.8);
        hv.busy += (b - hv.busy) * (1 - Math.exp(-dt / (b > hv.busy ? 30 : 160)));
        if (hv.busy < 0.003) hv.busy = 0;
        hv.ledMat.emissiveIntensity = hv.busy * 3.2;
        hv.ledGlow.uniforms.uI.value = hv.busy * 1.6;
        const g = this.glows.hdd;
        if (g) g.tgt = Math.max(g.tgt, hv.busy * 0.8);
        this.hdBusy = hv.busy;
      }
    }
    buildMonitor() {
      const M = MONITOR;
      const g = this.monitor = new T.Group();
      g.position.set(M.x, FLOOR_Y, M.z);
      g.rotation.y = 0.08;
      g.scale.setScalar(0.82);
      this.scene.add(g);
      const cy = 5.95 + 0.6;
      // bezel with a screen opening
      const sh = roundRect(new T.Shape(), M.w, M.h, 0.7);
      const hole = roundRect(new T.Path(), 10.6, 8.0, 0.9, 0, 0.35);
      sh.holes.push(hole);
      const bz = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 4, curveSegments: 10 }), this.mats.case);
      bz.position.set(0, cy, 0);
      bz.castShadow = true;
      bz.userData.pick = 'monitor';
      g.add(bz);
      this.pick.push(bz);
      // back housing: a tapered box
      const hb = new T.BoxGeometry(1, 1, 1, 1, 1, 1);
      const p = hb.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), k = z < 0 ? 0.62 : 1;
        p.setXYZ(i, p.getX(i) * (M.w - 0.6) * k, p.getY(i) * (M.h - 0.6) * k + (z < 0 ? 0.6 : 0), z * 8);
      }
      hb.computeVertexNormals();
      const back = new T.Mesh(hb, this.mats.caseDark);
      back.position.set(0, cy, -4);
      back.castShadow = true;
      g.add(back);
      // screen: a slightly curved plane with the CRT picture
      this.scrCanvas = canvas(768, 576);
      const sg = this.scrCanvas.getContext('2d');
      sg.fillStyle = '#050806'; sg.fillRect(0, 0, 768, 576);
      this.scrTex = colorTex(this.scrCanvas, this.aniso);
      const geo = new T.PlaneGeometry(10.6, 8.0, 24, 18);
      const gp = geo.attributes.position;
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i) / 5.3, y = gp.getY(i) / 4.0;
        gp.setZ(i, 0.32 * (1 - 0.5 * x * x - 0.5 * y * y));
      }
      geo.computeVertexNormals();
      this.scrMat = new T.MeshPhysicalMaterial({
        color: '#000000', emissive: '#ffffff', emissiveMap: this.scrTex, emissiveIntensity: 1.35,
        roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.55,
      });
      const scr = new T.Mesh(geo, this.scrMat);
      scr.position.set(0, cy + 0.35, 0.05);
      scr.userData.pick = 'monitor';
      g.add(scr);
      this.scrMesh = scr;
      this.pick.push(scr);
      const inner = new T.Mesh(new T.PlaneGeometry(11.2, 8.6), new T.MeshStandardMaterial({ color: '#07050a', roughness: 0.9 }));
      inner.position.set(0, cy + 0.35, -0.05);
      g.add(inner);
      // soft phosphor glow around the glass
      this.scrGlow = glowMat(HALO_FS, {
        uColor: { value: new T.Color('#9fe8c0') }, uI: { value: 0.12 }, uSize: { value: new T.Vector2(15, 12) }, uHalf: { value: new T.Vector2(5.3, 4.0) },
      });
      const sgm = new T.Mesh(new T.PlaneGeometry(15, 12), this.scrGlow);
      sgm.position.set(0, cy + 0.35, 1.0);
      g.add(sgm);
      // chin details: badge, knobs, power light
      const bc = canvas(512, 64), bgc = bc.getContext('2d');
      bgc.lineCap = 'round'; bgc.strokeStyle = PAL.badge; bgc.lineWidth = 3.2; bgc.globalAlpha = 0.85;
      strokeTextCanvas(bgc, M286 ? 'A286 COLOR DISPLAY' : 'A86 COLOR DISPLAY', 256, 18, 28, 1.6, 'center');
      const badge = new T.Mesh(new T.PlaneGeometry(4.2, 0.52), new T.MeshStandardMaterial({ map: colorTex(bc, this.aniso), transparent: true, roughness: 0.5, metalness: 0.3 }));
      badge.position.set(-2.8, cy - M.h / 2 + 0.52, 0.93);
      g.add(badge);
      for (const x of [3.6, 4.4]) {
        const k = new T.Mesh(new T.CylinderGeometry(0.22, 0.24, 0.25, 24), this.mats.caseDark);
        k.rotation.x = Math.PI / 2;
        k.position.set(x, cy - M.h / 2 + 0.55, 1.0);
        g.add(k);
      }
      const led = new T.Mesh(new T.SphereGeometry(0.09, 12, 8), new T.MeshStandardMaterial({ color: '#113322', emissive: THEME.phosphor, emissiveIntensity: 2.2 }));
      led.position.set(5.3, cy - M.h / 2 + 0.55, 0.95);
      g.add(led);
      // stand
      const neck = new T.Mesh(new T.CylinderGeometry(1.0, 1.5, 1.0, 32), this.mats.caseDark);
      neck.position.set(0, 0.8, -2.2);
      g.add(neck);
      const foot = new T.Mesh(new T.CylinderGeometry(3.4, 3.6, 0.3, 48), this.mats.case);
      foot.scale.z = 0.75;
      foot.position.set(0, 0.15, -2.2);
      foot.castShadow = true; foot.receiveShadow = true;
      g.add(foot);
    }
    buildFloor() {
      const c = canvas(256, 256), g = c.getContext('2d');
      const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#8a8a8a'); gr.addColorStop(1, '#000000');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      const floor = new T.Mesh(new T.PlaneGeometry(110, 90), new T.MeshStandardMaterial({
        color: PAL.floor, roughness: 0.8, metalness: 0, alphaMap: new T.CanvasTexture(c), transparent: true, depthWrite: false,
      }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, FLOOR_Y, -5);
      floor.receiveShadow = true;
      this.scene.add(floor);
    }
    buildPins() {
      const geoA = new T.BoxGeometry(0.085, 0.03, 0.11); geoA.translate(0, 0.21, -0.045);
      const geoB = new T.BoxGeometry(0.07, 0.21, 0.03); geoB.translate(0, 0.105, 0);
      const geoC = new T.BoxGeometry(0.1, 0.02, 0.1); geoC.translate(0, 0.01, 0);
      const geo = mergeGeos([geoA, geoB, geoC]);
      const mat = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.28, metalness: 1, envMapIntensity: 1.2 });
      const im = new T.InstancedMesh(geo, mat, this.pins.length);
      this.scene.updateMatrixWorld(true);
      const m = new T.Matrix4(), l = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1);
      const tin = new T.Color(PAL.pinTin), gold = new T.Color('#e8bd62');
      this.pins.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        l.compose(new T.Vector3(p.x, 0, p.z), q, one);
        m.multiplyMatrices(p.grp.matrixWorld, l);
        im.setMatrixAt(i, m);
        im.setColorAt(i, p.gold ? gold : tin);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = true;
      this.scene.add(im);
      const inst = (mesh, owners) => ({ mesh, owners, orig: mesh.instanceMatrix.array.slice(), hid: new Uint8Array(owners.length) });
      this.instSets = [inst(im, this.pins.map(p => p.grp))];
      this.pins = null;
      if (this.jleads.length) {
        const a = new T.BoxGeometry(0.07, 0.3, 0.035); a.translate(0, 0.15, 0.03);
        const b2 = new T.BoxGeometry(0.07, 0.035, 0.09); b2.translate(0, 0.3, 0.0);
        const c2 = new T.BoxGeometry(0.06, 0.02, 0.1); c2.translate(0, 0.0, -0.02);
        const jm = new T.InstancedMesh(mergeGeos([a, b2, c2]), this.mats.tin, this.jleads.length);
        this.jleads.forEach((j, i) => {
          q.setFromAxisAngle(up, j.rot);
          l.compose(new T.Vector3(j.x, j.y, j.z), q, one);
          m.multiplyMatrices(j.grp.matrixWorld, l);
          jm.setMatrixAt(i, m);
        });
        jm.instanceMatrix.needsUpdate = true;
        jm.castShadow = true;
        this.scene.add(jm);
        this.instSets.push(inst(jm, this.jleads.map(j => j.grp)));
        this.jleads = null;
      }
      if (this.gleads.length) {
        const a = new T.BoxGeometry(0.03, 0.02, 0.2); a.translate(0, 0.1, 0.08);
        const b2 = new T.BoxGeometry(0.03, 0.12, 0.02); b2.translate(0, 0.06, 0.18);
        const c2 = new T.BoxGeometry(0.03, 0.015, 0.12); c2.translate(0, 0.008, 0.24);
        const gm = new T.InstancedMesh(mergeGeos([a, b2, c2]), this.mats.tin, this.gleads.length);
        this.gleads.forEach((j, i) => {
          q.setFromAxisAngle(up, j.rot);
          l.compose(new T.Vector3(j.x, j.y, j.z), q, one);
          m.multiplyMatrices(j.grp.matrixWorld, l);
          gm.setMatrixAt(i, m);
        });
        gm.instanceMatrix.needsUpdate = true;
        this.scene.add(gm);
        this.instSets.push(inst(gm, this.gleads.map(j => j.grp)));
        this.gleads = null;
      }
      const bz = new T.InstancedMesh(new T.BoxGeometry(0.1, 0.02, 0.1), this.mats.gold, this.brazes.length);
      this.brazes.forEach((b, i) => {
        l.makeTranslation(b.x, b.y, b.z);
        m.multiplyMatrices(b.grp.matrixWorld, l);
        bz.setMatrixAt(i, m);
      });
      bz.instanceMatrix.needsUpdate = true;
      this.scene.add(bz);
      this.instSets.push(inst(bz, this.brazes.map(b => b.grp)));
      this.brazes = null;
    }

    // ---------- signals ----------
    // A signal is a set of timed pulses on chains and glows on chips, in bus clocks.
    addSig(entries, glows, e, now, ms, end) {
      const manual = ms >= 300;
      const sig = { chains: entries, glows, t0: now, ms, tClk: e ? e.t : 0, manual, end, k: e && e.len ? 4 / e.len : 1 };
      if (manual && e && e.t > this.manClock) { this.manClock = e.t; this.manAnchor = now; }
      this.sigs.push(sig);
      if (this.sigs.length > 40) this.sigs.splice(0, this.sigs.length - 40);
      return sig;
    }
    phaseOf(s, now) {
      if (s.manual) return ((this.manClock - s.tClk) + Math.min(1, (now - this.manAnchor) / s.ms)) * (s.k || 1);
      return (now - s.t0) / s.ms * (s.k || 1);
    }
    busSig(e, now, ms) {
      const kind = e.k === 'fetch' ? 'fetch' : e.type;
      const fpu = e.owner === 'fpu';
      const read = kind === 'fetch' || kind === 'memr' || kind === 'ior' || kind === 'inta';
      let dev = kind === 'inta' ? 'pic' : (e.dev || 'none');
      dev = DEV_ALIAS[dev] || dev;
      const addr = (e.addr >>> 0) & ADDR_MASK, width = e.width || 1;
      const odd = addr & 1;
      let d16 = e.data & 0xFFFF;
      const memDev = dev === 'ram' || dev === 'rom' || dev === 'vram' || dev === 'xram' || dev === 'vrom';
      if (memDev && width === 1) d16 = odd ? (e.data & 0xFF) << 8 : e.data & 0xFF;
      if (!memDev) d16 = e.data & (width === 2 ? 0xFFFF : 0xFF);
      const lo = !memDev || width >= 2 || !odd, hi = memDev && (width >= 2 || odd);
      const C = THEME;
      const colL = fpu ? C.lavender : C.cyan;
      const colD = kind === 'memw' ? C.goldHi : C.gold;
      const ch = [], gl = [];
      const st = STATUS[kind];
      ch.push({ id: 'S02', p0: 0, p1: 0.6, bits: st, color: C.magenta, hold: 0.6, h1: 1.2, h2: 1.7 });
      gl.push({ id: 'bus', color: C.magenta, p0: 0, p1: kind === 'halt' ? 1.2 : 3.3, lv: 0.8 });
      gl.push({ id: fpu ? 'fpu' : 'cpu', color: colL, p0: 0, p1: 1.0, lv: 0.75 });
      if (fpu) {
        ch.push({ id: 'RQ', p0: 0, p1: 0.5, bits: 1, color: C.lavender, hold: 0.7, h1: 3.8, h2: 4.4 });
        gl.push({ id: 'fpu', color: C.lavender, p0: 0, p1: 3.8, lv: 0.8 });
      }
      this.last.status = st;
      if (kind === 'halt') return this.addSig(ch, gl, e, now, ms, 2.2);
      const aChain = dev === 'ram' ? 'A_ram' : dev === 'rom' ? 'A_rom' : IO_DEV[dev] ? 'A_io' : SLOT_DEV[dev] ? 'A_slot' : kind === 'ior' || kind === 'iow' ? 'A_io' : 'A_ram';
      if (kind !== 'inta') {
        ch.push({ id: fpu ? 'L_addr_fpu' : 'L_addr_cpu', p0: 0, p1: 0.75, bits: addr, color: colL, hold: 0.55, h1: 1.0, h2: 1.35 });
        ch.push({ id: 'ALE', p0: 0.15, p1: 0.6, bits: 1, color: C.magenta, hold: 0.8, h1: 0.95, h2: 1.3 });
        for (const k of ['lat0', 'lat1', 'lat2']) gl.push({ id: k, color: C.cyan, p0: 0.6, p1: 3.6, lv: 0.75 });
        ch.push({ id: aChain, p0: 0.75, p1: 1.7, bits: addr, color: C.cyan, hold: 0.5, h1: 3.6, h2: 4.3 });
        this.last.addr = addr;
      }
      const cmd = CMD_BIT[kind];
      const slot = !!SLOT_DEV[dev];
      const cmdRoute = slot ? 'CMD_SLOT' : (kind === 'ior' || kind === 'iow' || kind === 'inta') ? 'CMD_IO' : 'CMD_MEM';
      ch.push({ id: cmdRoute, p0: 1.0, p1: 1.7, bits: 1 << cmd, color: C.magenta, hold: 0.7, h1: 3.2, h2: 3.8 });
      this.last.cmd = CMD_NAME[cmd];
      ch.push({ id: 'DEN', p0: 1.15, p1: 1.7, bits: 1 | (read ? 0 : 2), color: C.magenta, hold: 0.55, h1: 3.4, h2: 3.9 });
      this.last.write = !read;
      // chip select from the 74LS138
      const csR = dev === 'ram' ? 'CS_ram' : dev === 'rom' ? 'CS_rom' : IO_DEV[dev] ? 'CS_' + dev : null;
      if (csR && kind !== 'inta') {
        ch.push({ id: csR, p0: 1.0, p1: 1.5, bits: 1, color: C.magenta, hold: 0.65, h1: 3.4, h2: 3.9 });
        gl.push({ id: 'dec', color: C.magenta, p0: 0.9, p1: 3.3, lv: 0.75 });
        this.last.sel = DEV_SEL[dev];
      }
      // target devices
      const tg = [];
      const devCol = dev === 'fdc' || dev === 'hdc' ? C.cyan : memDev && !slot ? C.gold : slot ? C.phosphor : C.magenta;
      if (dev === 'fdc') ch.push({ id: 'FDD', p0: 1.6, p1: 3.0, rev: read ? 1 : 0, bits: 0x1FFFF, color: C.cyan, hold: 0.35, h1: 3.4, h2: 4.4 });
      if (dev === 'hdc' && this.chains.HDD) ch.push({ id: 'HDD', p0: 1.6, p1: 3.0, rev: read ? 1 : 0, bits: 0x1FFFF, color: C.cyan, hold: 0.35, h1: 3.4, h2: 4.4 });
      if (dev === 'ram') { if (lo) tg.push('ramE'); if (hi) tg.push('ramO'); }
      else if (dev === 'rom') { if (lo) tg.push('romE'); if (hi) tg.push('romO'); }
      else if (dev === 'vram') { if (VGA) tg.push('vmem', 'vga'); else tg.push('vram0', 'vram1'); }
      else if (dev === 'vga') tg.push(DAC_PORT(addr) ? 'dac' : 'vga');
      else if (dev === 'vrom') tg.push('vbios');
      else if (dev === 'fdc') tg.push('fdc');
      else if (dev === 'hdc') tg.push('hdc', 'hdd');
      else if (dev === 'sb') tg.push('sbdsp');
      else if (dev === 'opl') tg.push('opl');
      else if (dev === 'xram') tg.push('xram');
      else if (slot) tg.push('crtc');
      else if (this.glows[dev]) tg.push(dev);
      for (const id of tg) gl.push({ id, color: devCol, p0: 1.2, p1: 3.7, lv: 1 });
      // Follow notes the chip: for the RAM, the chip of one data bit (the lowest bit that is 1, as
      // in the trace), as the Top view does
      if (dev === 'ram') {
        const bit = b => { let k = 0; while (k < 7 && !((b >> k) & 1)) k++; return (b >> k) & 1 ? k : 0; };
        const nt = [];
        if (lo) nt.push('ramE' + bit(d16 & 0xFF));
        if (hi) nt.push('ramO' + bit(d16 >> 8));
        this.chaseNote(nt, now);
      } else if (tg.length) this.chaseNote(tg, now);
      // data
      const dChains = [];
      if (dev === 'ram') { if (lo) dChains.push('D_ramE'); if (hi) dChains.push('D_ramO'); }
      else if (dev === 'rom') { if (lo) dChains.push('D_romE'); if (hi) dChains.push('D_romO'); }
      else if (slot) dChains.push('D_slot');
      else if (dev !== 'none' && dev !== 'fpu') dChains.push('D_io');
      // the 80287 sits on the CPU data lines: its operands move in I/O cycles at F8h-FFh
      const lData = dev === 'fpu' ? 'L_fpu' : fpu ? 'L_data_fpu' : 'L_data_cpu';
      if (dev === 'fpu') ch.push({ id: 'RQ', p0: 0, p1: 0.6, bits: 3, color: C.lavender, hold: 0.6, h1: 3.4, h2: 4.2 });
      if (M286 && IO_DEV[dev] && dev !== 'fpu') gl.push({ id: 'xdb', color: C.gold, p0: 1.4, p1: 3.6, lv: 0.7 });
      if (lo && dev !== 'fpu') gl.push({ id: 'xcv0', color: C.gold, p0: 1.2, p1: 3.6, lv: 0.8 });
      if (hi && dev !== 'fpu') gl.push({ id: 'xcv1', color: C.gold, p0: 1.2, p1: 3.6, lv: 0.8 });
      if (read) {
        for (const id of dChains) ch.push({ id, p0: 1.7, p1: 2.6, rev: 1, bits: d16, color: colD, hold: 0.6, h1: 3.5, h2: 4.2 });
        ch.push({ id: lData, p0: 2.6, p1: 3.2, rev: 1, bits: d16, color: fpu ? C.lavender : colD, hold: 0.55, h1: 3.6, h2: 4.2 });
        gl.push({ id: fpu ? 'fpu' : 'cpu', color: C.gold, p0: 3.0, p1: 3.8, lv: 0.9 });
      } else {
        ch.push({ id: lData, p0: 1.0, p1: 1.6, bits: d16, color: fpu ? C.lavender : colD, hold: 0.55, h1: 3.5, h2: 4.1 });
        for (const id of dChains) ch.push({ id, p0: 1.6, p1: 2.6, bits: d16, color: colD, hold: 0.6, h1: 3.5, h2: 4.2 });
      }
      this.last.data = { v: e.data, w: width, read };
      if (memDev || dev !== 'none') this.last.dev[dev] = { addr, data: e.data, w: width, read, kind };
      return this.addSig(ch, gl, e, now, ms, 4.6);
    }
    event(e, clockMs) {
      if (!this.ok) return;
      const now = animNow();
      this.dieFx(e, now, clockMs);
      // In trace mode the steps draw the signals, one at a time.
      if (this.app.tracing) return;
      this.liveUnits(e, now, clockMs);
      // a small sound for each bus cycle when the playback is slow enough to follow
      const slow = this.visible && typeof Sfx !== 'undefined' && clockMs / (this.app.motion || 1) >= 60;
      switch (e.k) {
        case 'fetch': case 'bus':
          this.busSig(e, now, clockMs);
          if (slow && e.type !== 'halt') Sfx.arrive(e.k === 'fetch' || e.type === 'memr' || e.type === 'ior' ? 'data' : e.type === 'memw' ? 'addr' : 'ctrl');
          break;
        case 'int':
          if (e.src === 'irq') {
            if (slow) Sfx.arrive('irq');
            const ch = [{ id: 'INTR', p0: 0, p1: 1.2, bits: 1, color: THEME.magenta, hold: 0.9, h1: 3, h2: 4 }];
            const gl = [{ id: 'pic', color: THEME.magenta, p0: 0, p1: 3, lv: 1 }, { id: 'cpu', color: THEME.magenta, p0: 1.1, p1: 3, lv: 0.8 }];
            if (M286 && e.vec >= 0x70 && e.vec <= 0x77) {
              // IRQ8-15 come from the slave 8259A through IRQ2; IRQ13 is the 80287 ERROR line
              gl.push({ id: 'pic2', color: THEME.magenta, p0: 0, p1: 3, lv: 1 });
              if (e.vec === 0x75) { ch.push({ id: 'NMI', p0: 0, p1: 1.2, bits: 1, color: THEME.lavender, hold: 0.8, h1: 3, h2: 4 }); gl.push({ id: 'fpu', color: THEME.lavender, p0: 0, p1: 2.5, lv: 1 }); }
              if (e.vec === 0x70) gl.push({ id: 'rtc', color: THEME.phosphor, p0: 0, p1: 2.5, lv: 1 });
            }
            this.addSig(ch, gl, e, now, clockMs, 4.5);
          } else if (e.src === 'nmi') {
            this.addSig([{ id: 'NMI', p0: 0, p1: 1.6, bits: 1, color: THEME.magenta, hold: 0.9, h1: 3, h2: 4 }],
              [{ id: 'fpu', color: THEME.lavender, p0: 0, p1: 2.5, lv: 1 }, { id: 'nmi', color: THEME.magenta, p0: 0.5, p1: 3, lv: 1 },
                { id: 'cpu', color: THEME.magenta, p0: 1.4, p1: 3.2, lv: 0.9 }], e, now, clockMs, 4.5);
          } else {
            this.addSig([], [{ id: 'cpu', color: THEME.magenta, p0: 0, p1: 2.5, lv: 0.7 }], e, now, clockMs, 3.5);
          }
          break;
        case 'fpu': {
          const len = clamp(e.cycles || 20, 3, 60);
          this.addSig([{ id: 'QS', p0: 0, p1: 0.4, bits: 3, color: THEME.lavender, hold: 0.8, h1: 1.5, h2: 2.2 }],
            [{ id: 'fpu', color: THEME.lavender, p0: 0, p1: len, lv: 1, lid: 1 }], e, now, clockMs, len + 1);
          break;
        }
        case 'desc': case 'sys': case 'task':
          this.addSig([], [{ id: 'cpu', color: e.k === 'task' ? THEME.magenta : THEME.lavender, p0: 0, p1: 2.5, lv: 0.6 }], e, now, clockMs, 3.5);
          break;
        case 'queue':
          if (e.op === 'pop') this.addSig([{ id: 'QS', p0: 0, p1: 0.3, bits: 1, color: THEME.magenta, hold: 0.45, h1: 0.6, h2: 1.2 }], [], e, now, clockMs, 1.3);
          break;
        default:
      }
    }
    instr(events, info) {
      if (!this.ok) return;
      const now = animNow();
      this.curEvents = events;
      this.manual = info.clockMs >= 300;
      if (this.manual) {
        this.sigs = this.sigs.filter(s => !s.manual);
        this.manClock = 0; this.manAnchor = now;
      }
      this.instrStart = now; this.instrMs = info.clockMs; this.instrEnd = now + info.cycles * info.clockMs;
      if (this.tr) this.traceClear();
      this.dirty = true;
    }
    fast(stats) {
      if (!this.ok) return;
      const now = animNow();
      this.fastOn = true; this.fastT = now;
      const b = stats.bus || {}, dv = b.dev || {};
      const lv = x => 1 - Math.exp(-(x || 0) / 60);
      const io = (dv.pic || 0) + (dv.pit || 0) + (dv.ppi || 0) + (dv.dma || 0) + (dv.nmi || 0) + (dv.pic2 || 0) + (dv.kbc || 0) + (dv.rtc || 0) + (dv.dma2 || 0) + (dv.a20 || 0);
      const slot = (dv.vram || 0) + (dv.crtc || 0) + (dv.cga || 0) + (dv.fdc || 0) * 6 + (dv.hdc || 0) + (dv.xram || 0) + (dv.vga || 0) * 4 + (dv.vrom || 0);
      const all = (b.fetch || 0) + (b.memr || 0) + (b.memw || 0) + (b.ior || 0) + (b.iow || 0);
      this.fastLv = {
        all: lv(all), ram: lv(dv.ram), rom: lv(dv.rom), io: lv(io), slot: lv(slot), fpu: lv(b.fpu), inta: lv((b.inta || 0) * 20),
        memr: lv((b.memr || 0) + (b.fetch || 0)), memw: lv(b.memw), ior: lv(b.ior), iow: lv(b.iow),
        pic: lv((dv.pic || 0) * 8), pit: lv((dv.pit || 0) * 8), ppi: lv((dv.ppi || 0) * 8), dma: lv((dv.dma || 0) * 8), nmi: lv((dv.nmi || 0) * 8),
        vram: lv(dv.vram), crtc: lv(((dv.crtc || 0) + (dv.cga || 0)) * 4), fdc: lv((dv.fdc || 0) * 6), hdc: lv(dv.hdc),
        pic2: lv((dv.pic2 || 0) * 8), kbc: lv(((dv.kbc || 0) + (dv.a20 || 0)) * 8), rtc: lv((dv.rtc || 0) * 8), dma2: lv((dv.dma2 || 0) * 8), xram: lv(dv.xram), fpuio: lv((dv.fpu || 0) * 4), vga: lv((dv.vga || 0) * 4), vrom: lv(dv.vrom),
      };
      // Now and then, replay the bus cycles of one sampled instruction as real pulses.
      if (stats.sample && !this.reduced && now - (this.lastSample || 0) > 420) {
        this.lastSample = now;
        const ms = 26;
        for (const e of stats.sample) {
          this.dieFx(e, now + (e.t || 0) * ms, ms);
          this.liveUnits(e, now + (e.t || 0) * 70, 70);
          if (e.k !== 'fetch' && e.k !== 'bus') continue;
          const s = this.busSig(e, now, ms);
          s.t0 = now + e.t * ms;
          s.manual = false;
        }
      }
    }
    reset() {
      if (!this.ok) return;
      this.sigs.length = 0;
      this.fastOn = false; this.fastLv = {};
      this.last = { addr: null, data: null, cmd: null, status: null, sel: null, write: false, dev: {} };
      for (const r of this.routeList) {
        const u = r.mat.uniforms;
        u.uAmp.value = 0; u.uHold.value = 0; u.uFlow.value = 0; u.uBase.value = 0;
        r.flow = 0; r.prop = null;
      }
      for (const g of this.glowList) { g.v = 0; g.tgt = 0; g.fast = 0; }
      this.instrEnd = 0;
      this.traceClear();
      this.dirty = true;
    }
    setReducedMotion(on) {
      this.reduced = !!on;
      if (this.ok) { this.cam.flight = null; this.cam.follow.set(0, 0, 0); this.dirty = true; }
    }

    evalChain(c, ph) {
      const chain = this.chains[c.id];
      if (!chain) return;
      const u = (ph - c.p0) / Math.max(0.05, c.p1 - c.p0);
      if (u < 0) return;
      const L = chain.total;
      let head, amp;
      if (this.reduced) { head = c.rev ? -1e4 : 1e4; amp = 0; }
      else {
        const d = Math.min(u, 1.3) * (L + 1.2);
        head = c.rev ? L - d : d;
        amp = u < 1 ? 1 : Math.max(0, 1 - (u - 1) * 3.5);
      }
      let hold = c.hold * (ph < c.h1 ? 1 : Math.max(0, 1 - (ph - c.h1) / (c.h2 - c.h1)));
      if (this.reduced) hold = Math.min(1, hold * 1.35);
      const score = amp + hold;
      if (score <= 0.002) return;
      for (const sg of chain.segs) {
        const r = sg.r;
        if (r.prop && r.prop.score >= score) continue;
        r.prop = { score, head: head - sg.off, dir: c.rev ? -1 : 1, amp, hold, bits: Math.floor((c.bits || 0) / Math.pow(2, r.bit)) & ((1 << r.n) - 1), color: c.color };
      }
    }
    evalGlow(g, ph) {
      const gl = this.glows[g.id];
      if (!gl) return;
      const env = smooth(g.p0, g.p0 + 0.25, ph) * (1 - smooth(g.p1, g.p1 + 0.6, ph));
      const v = env * g.lv;
      if (v > gl.tgt) { gl.tgt = v; gl.tcol = g.color; }
    }

    updateSignals(now, dt) {
      for (const r of this.routeList) r.prop = null;
      for (const g of this.glowList) { g.tgt = 0; g.tcol = null; }
      for (let i = this.sigs.length - 1; i >= 0; i--) {
        const s = this.sigs[i];
        const ph = this.phaseOf(s, now);
        if (ph > s.end) { this.sigs.splice(i, 1); continue; }
        if (ph < 0) continue;
        for (const c of s.chains) this.evalChain(c, ph);
        for (const g of s.glows) this.evalGlow(g, ph);
      }
      if (this.tr) this.traceGlows(now);
      this.updateDrives(now, dt);
      if (this.fastOn && (now - this.fastT > 250 || this.app.mode !== 'fast' || !this.app.running)) { this.fastOn = false; this.fastLv = {}; }
      const F = this.fastLv, fk = 1 - Math.exp(-dt / 180);
      const flowOf = {
        LB_cpu: F.all, LB_x: F.all, LB_fpu: F.fpu,
        SA_t: F.all, SA_dn: Math.max(F.ram || 0, F.rom || 0), SA_ramL: F.ram, SA_romR: F.rom, SA_up1: Math.max(F.io || 0, F.slot || 0), SA_io: F.io, SA_slot: F.slot,
        SD_t: F.all, SD_dn: Math.max(F.ram || 0, F.rom || 0), SD_evL: F.ram, SD_odL: F.ram, SD_dn2: Math.max(F.ram || 0, F.rom || 0), SD_evR: F.rom, SD_odR: F.rom,
        SD_up: Math.max(F.io || 0, F.slot || 0), SD_io: F.io, SD_slot: F.slot,
        S02: F.all, ALE: F.all, DEN: F.all, CMD_MEM: Math.max(F.memr || 0, F.memw || 0), CMD_IO: Math.max(F.ior || 0, F.iow || 0, F.inta || 0), CMD_SLOT: F.slot,
        INTR: F.inta, RQ: Math.max(F.fpu || 0, F.fpuio || 0), ERR: 0, LB_fpu: Math.max(F.fpu || 0, F.fpuio || 0),
        CS_pic2: F.pic2, CS_kbc: F.kbc, CS_rtc: F.rtc, CS_dma2: F.dma2, QS: F.all, CS_ram: F.ram, CS_rom: F.rom, CS_pic: F.pic, CS_pit: F.pit, CS_ppi: F.ppi, CS_dma: F.dma, CS_nmi: F.nmi,
      };
      const k = 1 - Math.exp(-dt / 60);
      const tNow = now % 1e6;
      const tone = this.app.machine.lastTone > 0 && this.app.mode === 'fast' && this.app.running;
      const clkBase = this.clockTick(now);
      this.activity = 0;
      for (const r of this.routeList) {
        const u = r.mat.uniforms;
        const p = r.prop;
        if (p) {
          u.uHead.value = p.head; u.uDir.value = p.dir; u.uAmp.value = p.amp; u.uHold.value = p.hold;
          u.uBits.value = p.bits; u.uBitMix.value = 1; u.uColor.value.set(p.color);
          r.flowColor.set(p.color);
        } else {
          u.uAmp.value *= 1 - k; u.uHold.value *= 1 - k;
          if (u.uAmp.value < 0.003) u.uAmp.value = 0;
          if (u.uHold.value < 0.003) u.uHold.value = 0;
        }
        let ft = (flowOf[r.id] || 0) * (this.reduced ? 0.35 : 0.55);
        if (r.id === 'SPKR' && tone) ft = 0.6;
        if (r.id.startsWith('FDD')) ft = Math.max(F.fdc || 0, this.diskBusy || 0) * 0.7;
        if (r.id === 'HDD') ft = Math.max(F.hdc || 0, this.hdBusy || 0) * 0.7;
        r.flow += (ft - r.flow) * fk;
        if (r.flow < 0.002) r.flow = 0;
        u.uFlow.value = this.reduced ? 0 : r.flow;
        if (this.reduced) u.uHold.value = Math.max(u.uHold.value, r.flow * 0.6);
        if (!p && r.flow > 0.01) {
          u.uBitMix.value = 0;
          u.uColor.value.set(r.id.startsWith('SA') || r.id === 'LB_cpu' || r.id.startsWith('FDD') || r.id === 'HDD' ? THEME.cyan : r.id.startsWith('SD') || r.id === 'LB_x' ? THEME.gold : r.id === 'LB_fpu' || r.id === 'RQ' ? THEME.lavender : THEME.magenta);
        }
        u.uTime.value = tNow;
        let base = 0;
        if (r.id.startsWith('CLK')) { base = clkBase; if (!p) { u.uBits.value = 1; u.uBitMix.value = 1; u.uColor.value.set(THEME.magenta); } }
        u.uBase.value = base;
        this.activity += u.uAmp.value + u.uHold.value + r.flow;
      }
      // chips
      const kUp = 1 - Math.exp(-dt / 45), kDn = 1 - Math.exp(-dt / 260);
      const fastChip = {
        cpu: F.all, fpu: F.fpu, bus: F.all, lat0: F.all, lat1: F.all, lat2: F.all, xcv0: F.all, xcv1: F.all,
        dec: Math.max(F.io || 0, F.ram || 0, F.rom || 0) * 0.7, pic: F.pic, pit: F.pit, ppi: F.ppi, dma: F.dma, nmi: F.nmi,
        ramE: F.ram, ramO: F.ram, romE: F.rom, romO: F.rom, vram0: F.vram, vram1: F.vram, crtc: F.crtc, fdc: F.fdc, hdc: F.hdc,
        pic2: F.pic2, kbc: F.kbc, rtc: F.rtc, dma2: F.dma2, xram: F.xram, xdb: F.io,
        vga: Math.max(F.vga || 0, F.vram || 0), vmem: F.vram, dac: F.vga, vbios: F.vrom,
      };
      const fastCol = { hdc: THEME.cyan, cpu: THEME.cyan, fpu: THEME.lavender, bus: THEME.magenta, dec: THEME.magenta, pic: THEME.magenta, pit: THEME.magenta, ppi: THEME.magenta, dma: THEME.magenta, nmi: THEME.magenta, vram0: THEME.phosphor, vram1: THEME.phosphor, crtc: THEME.phosphor, fdc: THEME.cyan, pic2: THEME.magenta, kbc: THEME.magenta, rtc: THEME.phosphor, dma2: THEME.magenta, xram: THEME.gold, xdb: THEME.gold, vga: THEME.phosphor, vmem: THEME.phosphor, dac: THEME.phosphor, vbios: THEME.gold, lat0: THEME.cyan, lat1: THEME.cyan, lat2: THEME.cyan };
      for (const g of this.glowList) {
        const f = (fastChip[g.id] || 0) * 0.75;
        g.fast += (f - g.fast) * fk;
        let tgt = g.tgt, tcol = g.tcol;
        if (g.fast > tgt) { tgt = g.fast; tcol = fastCol[g.id] || THEME.gold; }
        if (g.id === 'clk') { tgt = Math.max(tgt, clkBase * 0.8); if (!tcol) tcol = THEME.magenta; }
        if (g.id === 'spk' || g.id === 'xtal') { if (g.id === 'spk' && tone) { tgt = 0.8; tcol = THEME.magenta; } }
        if (this.hover === g.id && tgt < 0.32) { tgt = 0.32; tcol = THEME.goldHi; }
        if (this.flash && this.flash.id === g.id) {
          const a = 1 - (now - this.flash.t) / 1400;
          if (a <= 0) this.flash = null; else if (a > tgt) { tgt = a; tcol = THEME.goldHi; }
        }
        g.v += (tgt - g.v) * (tgt > g.v ? kUp : kDn);
        if (g.v < 0.002) g.v = 0;
        if (tcol) g.col.lerp(new T.Color(tcol), tgt > g.v ? 0.5 : 0.15);
        this.applyGlow(g);
        if (g.extra) for (const x of g.extra) { x.v = g.v; x.col.copy(g.col); this.applyGlow(x); }
        this.activity += g.v;
      }
      // speaker cone
      if (this.cone) {
        const vib = tone && !this.reduced ? Math.sin(now * 0.08) * 0.035 + Math.sin(now * 0.211) * 0.02 : 0;
        this.cone.position.y = vib;
        this.spkRing.uniforms.uI.value = (this.glows.spk ? this.glows.spk.v : 0) * 0.8;
      }
    }
    applyGlow(g) {
      const v = g.v;
      g.halo.uniforms.uI.value = v * 0.95;
      g.halo.uniforms.uColor.value.copy(g.col);
      for (const m of g.mats) { m.emissive.copy(g.col); m.emissiveIntensity = v * 0.05; }
      for (const m of g.labels) { m.emissive.copy(g.col); m.emissiveIntensity = v * 1.3; }
      if (g.lid) { g.lid.emissive.copy(g.col); g.lid.emissiveIntensity = g.id === 'fpu' ? v * 0.55 : v * 0.18; }
      if (g.die) { g.die.emissive.copy(g.col); g.die.emissiveIntensity = v * 1.2; }
      const dl = this.decapByGlow && this.decapByGlow[g.id];
      if (dl) for (const e of dl) if (e.mat) { e.mat.emissive.setRGB(1, 1, 1).lerp(g.col, Math.min(1, v * 1.4)); e.mat.emissiveIntensity = 0.12 + v * (e.fxMesh && e.fxMesh.visible ? 0.2 : 0.6); }
    }
    // Brightness of the clock lines: a tick per CPU clock.
    clockTick(now) {
      if (this.fastOn) return 0.22 + 0.06 * Math.sin(now * 0.05);
      if (this.manual && now - this.manAnchor < 2000 && this.app.clock > 0) return 0.06 + 0.5 * Math.exp(-(now - this.manAnchor) / 160);
      if (now < this.instrEnd) {
        if (this.instrMs < 25 || this.reduced) return 0.2;
        const f = ((now - this.instrStart) / this.instrMs) % 1;
        return 0.06 + 0.4 * Math.pow(1 - f, 4);
      }
      return 0.05;
    }

    // ---------- camera ----------
    fitRadius() {
      const aspect = this.camera.aspect || 1.6;
      const vf = this.camera.fov * Math.PI / 360;
      const hf = Math.atan(Math.tan(vf) * aspect);
      return aspect < 1.1 ? Math.max(34, 22 / Math.tan(hf)) : Math.max(34, 20 / Math.tan(hf), 14.5 / Math.tan(vf));
    }
    // Follow: on when the "Follow action" switch is on and the user has not taken the camera.
    chaseOn() { return this.follow && !this.chasePaused; }
    syncFollowBtn() { if (this.followBtn) this.followBtn.setAttribute('aria-pressed', this.chaseOn() ? 'true' : 'false'); }
    // The Follow button: on = resume (and the switch on); off = the switch off.
    setChase(on) {
      this.chaseKey = '';
      this.chasePaused = false;
      if (on !== this.follow) {
        const fo = document.getElementById('opt-follow');
        if (fo) { fo.checked = on; fo.dispatchEvent(new Event('change')); } else this.follow = on;
      }
      this.syncFollowBtn();
      this.dirty = true;
    }
    // The user takes the camera: Follow waits until the button is pressed again.
    pauseChase() {
      if (!this.chaseOn()) return;
      this.chasePaused = true; this.chaseKey = '';
      this.syncFollowBtn();
    }
    // Follow (the same rule as the Top view): each bus cycle notes its target chips (the last 6,
    // see busSig). The camera frames the CPU and the targets of the last 1.8 s, and it moves only
    // when that set changes. It keeps its angle; the floating screen at the right is allowed for.
    chaseNote(ids, t) {
      for (const id of ids) {
        const k = this.recent.findIndex(x => x.id === id);
        if (k >= 0) this.recent.splice(k, 1);
        this.recent.push({ id, t });
      }
      while (this.recent.length > 6) this.recent.shift();
    }
    chasePos(id) {
      const e = this.decaps.get(id);
      if (e && e.grp && /^ram[EO]\d$/.test(id)) return e.grp.getWorldPosition(new T.Vector3());
      const p = this.facePos[id] || (this.glows[id] && this.glows[id].pos.lengthSq() > 0 ? this.glows[id].pos : null) || this.chipPos[id];
      return p ? p.clone() : null;
    }
    chaseStep() {
      const now = animNow();
      if (now - this.chaseCheck < 200) return;
      this.chaseCheck = now;
      const ids = [...new Set(this.recent.filter(x => now - x.t < 1800 && x.t < now + 50).map(x => x.id))];
      if (!ids.length) return;
      ids.push('cpu');
      const pts = ids.map(id => this.chasePos(id)).filter(Boolean);
      if (!pts.length) return;
      const key = ids.slice().sort().join(',');
      if (key === this.chaseKey) return;
      this.chaseKey = key;
      const box = new T.Box3();
      for (const q of pts) { q.y = Math.min(q.y, 3); box.expandByPoint(q); }
      const ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
      const c = this.cam, KF = 2 * Math.tan(this.camera.fov * Math.PI / 360), asp = this.camera.aspect || 1.6;
      const { right: monW } = this.trCover(false);
      const free = this.w > 0 ? clamp((this.w - monW) / this.w, 0.4, 1) : 1;
      const th = c.g.theta, ph = clamp(c.g.phi, 0.6, 1.0);
      // the box on the screen: its width, and its depth shortened by the tilt of the camera
      const r = clamp(Math.max((sz.x + 2) / (KF * asp * free), (sz.z + 2) * Math.cos(ph) / KF) * 1.08 + 1.5, 9, this.fitRadius());
      // the middle of the box goes to the middle of the free part of the view
      if (monW && this.h) ctr.addScaledVector(new T.Vector3(Math.cos(th), 0, -Math.sin(th)), (monW / 2) * KF * r / this.h);
      ctr.y = clamp(ctr.y, 0.2, 2.5);
      c.flight = null; c.fit = false; c.preset = null;
      for (const k in this.presetBtns) this.presetBtns[k].setAttribute('aria-pressed', 'false');
      c.g.target.copy(ctr); c.g.r = r; c.g.theta = th; c.g.phi = ph;
      this.dirty = true;
    }
    applyPreset(name, instant) {
      const p = PRESETS[name];
      if (!p) return;
      if (!instant) this.pauseChase();
      if (this.focus) this.setFocus(null);
      const c = this.cam;
      c.preset = name;
      c.fit = !p.r;
      for (const k in this.presetBtns) this.presetBtns[k].setAttribute('aria-pressed', k === name ? 'true' : 'false');
      const tall = name === 'overview' && (this.camera.aspect || 1.6) < 1.1;
      const tgt = new T.Vector3(...p.target);
      if (tall) tgt.x -= 5.8;
      if (tall) tgt.z -= 1.5;
      this.flyTo(tgt, tall ? 0.1 : p.theta, tall ? 0.62 : p.phi, p.r || this.fitRadius(), instant);
    }
    flyTo(target, theta, phi, r, instant) {
      const c = this.cam;
      this.dieUpGoal = null;   // zoomToDie sets it again after the flight starts
      let th = theta;
      while (th - c.theta > Math.PI) th -= TAU;
      while (th - c.theta < -Math.PI) th += TAU;
      c.g.target.copy(target); c.g.theta = th; c.g.phi = phi; c.g.r = r;
      if (instant || this.reduced) {
        c.target.copy(target); c.theta = th; c.phi = phi; c.r = r; c.flight = null;
      } else {
        c.flight = { t: 0, dur: 1300, from: { target: c.target.clone(), theta: c.theta, phi: c.phi, r: c.r } };
      }
      this.dirty = true;
    }
    userMoved() {
      const c = this.cam;
      this.pauseChase();
      // in trace mode the camera stays where the user puts it until the token leaves this chip
      if (this.tr) this.trHold = this.trChipKey() || 'board';
      this.dieUpGoal = null;
      if (this.trCV) { this.trCV.set(0, 0, 0); this.trRV.set(0, 0, 0); }
      c.flight = null;
      c.fit = false;
      this.userT = performance.now();
      if (c.preset) { for (const k in this.presetBtns) this.presetBtns[k].setAttribute('aria-pressed', 'false'); c.preset = null; }
      if (this.hint && !this.hint.classList.contains('bv-gone')) this.hint.classList.add('bv-gone');
    }
    clampGoal() {
      const g = this.cam.g;
      g.phi = clamp(g.phi, 0.12, 1.55);
      g.r = clamp(g.r, 0.1, 90);         // close enough to see single cells on a die
      g.target.x = clamp(g.target.x, -22, 22);
      g.target.z = clamp(g.target.z, -24, 14);
      g.target.y = clamp(g.target.y, -0.5, 9);
    }
    updateCamera(dt, now) {
      const c = this.cam;
      const before = [c.theta, c.phi, c.r, c.target.x, c.target.y, c.target.z];
      const held = !!this.tr && this.trHeldNow();
      const track = !!this.tr && !!this.tr.cam && this.follow && !c.flight && !held && !this.reduced;
      if (!track) this.trTrackOn = false;
      const trCam = !track && !!this.tr && this.follow && !c.flight && !held && this.trCamGoal();
      if (!trCam) this.trCamT = 0;
      const chasing = !this.tr && this.chaseOn() && !this.reduced && this.app.running;
      if (chasing) this.chaseStep();
      if (track) this.trTrack();
      else if (trCam) this.trCamStep();
      else if (c.flight) {
        const f = c.flight;
        f.t += dt;
        const u = easeInOut(clamp(f.t / f.dur, 0, 1));
        c.target.lerpVectors(f.from.target, c.g.target, u);
        c.theta = lerp(f.from.theta, c.g.theta, u);
        c.phi = lerp(f.from.phi, c.g.phi, u);
        // a gentle arc: pull back a little in the middle of the flight
        c.r = lerp(f.from.r, c.g.r, u) * (1 + 0.12 * Math.sin(u * Math.PI));
        if (f.t >= f.dur) c.flight = null;
      } else {
        const k = 1 - Math.exp(-dt / (chasing ? 420 : 110));
        c.theta += (c.g.theta - c.theta) * k;
        c.phi += (c.g.phi - c.phi) * k;
        c.r += (c.g.r - c.r) * k;
        c.target.lerp(c.g.target, k);
      }
      const want = new T.Vector3();                  // (the old small drift: none now)
      c.follow.lerp(want, 1 - Math.exp(-dt / 2600));
      const t = c.target.clone().add(c.follow);
      const sp = Math.sin(c.phi);
      this.camera.position.set(t.x + c.r * sp * Math.sin(c.theta), t.y + c.r * Math.cos(c.phi), t.z + c.r * sp * Math.cos(c.theta));
      // trace mode can roll the camera, so the text of a die on a card is upright
      if (!this.camUp) this.camUp = new T.Vector3(0, 1, 0);
      const upGoal = this.tr && this.trUpGoal ? this.trUpGoal : !this.tr && this.dieUpGoal ? this.dieUpGoal : new T.Vector3(0, 1, 0);
      if (track && this.trUpNow) { if (this.camUp.distanceToSquared(this.trUpNow) > 1e-12) { this.camUp.copy(this.trUpNow); this.dirty = true; } }
      else if (this.camUp.distanceToSquared(upGoal) > 1e-6) { this.camUp.lerp(upGoal, this.reduced ? 1 : 1 - Math.exp(-dt / 260)).normalize(); this.dirty = true; }
      this.camera.up.copy(this.camUp);
      this.camera.lookAt(t);
      // a near plane that follows the zoom, so close views of a die do not clip
      const near = clamp(c.r * 0.04, 0.003, 0.5);
      if (Math.abs(this.camera.near - near) > near * 0.05) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
      const after = [c.theta, c.phi, c.r, c.target.x, c.target.y, c.target.z];
      let moving = c.flight !== null || c.follow.lengthSq() > 1e-6 && want.distanceToSquared(c.follow) > 1e-4;
      for (let i = 0; i < 6; i++) if (Math.abs(after[i] - before[i]) > 1e-5) moving = true;
      return moving;
    }

    // ---------- input ----------
    bindInput() {
      const el = this.wrap;
      this.ptrs = new Map();
      el.addEventListener('dragstart', e => e.preventDefault());
      el.addEventListener('pointerdown', e => this.onDown(e));
      el.addEventListener('pointermove', e => this.onMove(e));
      el.addEventListener('pointerup', e => this.onUp(e));
      el.addEventListener('pointercancel', e => this.onUp(e));
      el.addEventListener('pointerleave', () => { this.lastPtr = null; this.termShow(null); if (!this.ptrs.size && !this.pinned) { this.hoverAt = null; this.setHover(null); } });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        this.userMoved();
        // zoom toward the point under the pointer
        const k = Math.exp(clamp(dy, -200, 200) * 0.0012), g = this.cam.g;
        const rc = this.renderer.domElement.getBoundingClientRect();
        if (rc.width) {
          this.ptr.set((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
          this.raycaster.setFromCamera(this.ptr, this.camera);
          const fwd = new T.Vector3();
          this.camera.getWorldDirection(fwd);
          const hit = new T.Vector3();
          if (this.raycaster.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(fwd, this.cam.target), hit)) {
            g.target.sub(hit).multiplyScalar(k).add(hit);
          }
        }
        g.r *= k;
        this.clampGoal();
      }, { passive: false });
      el.addEventListener('dblclick', e => {
        // a decapped chip: fly straight down over its die
        const de = this.decapAt(e.clientX, e.clientY);
        if (this.isOpen(de)) {
          this.zoomToDie(de);
          if (de.key === 'cpu' || de.key === 'fpu') setTimeout(() => this.showPop(de.key, e.clientX, e.clientY), 900);
          return;
        }
        const id = this.pickAt(e.clientX, e.clientY);
        if (!id) return;
        this.focusOn(id);
      });
      el.addEventListener('contextmenu', e => e.preventDefault());
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this.focus && this.visible) this.setFocus(null);
      });
      el.addEventListener('keydown', e => this.onKey(e));
    }
    focusOn(id) {
      const g = this.glows[id];
      let pos;
      if (id === 'monitor') pos = new T.Vector3(MONITOR.x, 5.6, MONITOR.z);
      else if (this.facePos[id]) pos = this.facePos[id].clone();
      else if (g) pos = g.pos.clone();
      else if (id === 'spk') pos = new T.Vector3(SPEAKER.x, 0.5, SPEAKER.z);
      if (!pos) return;
      pos.y = Math.min(pos.y, 3);
      const r = id === 'monitor' ? 18 : id.startsWith('ram') ? 13 : 9;
      this.cam.preset = null;
      for (const k in this.presetBtns) this.presetBtns[k].setAttribute('aria-pressed', 'false');
      this.cam.fit = false;
      this.userT = performance.now();
      const A = CHASE_A[id];
      this.flyTo(pos, A ? A[0] : this.cam.theta, id === 'monitor' ? 1.3 : A ? A[1] : clamp(this.cam.phi, 0.55, 1.05), A ? CHASE_R[id] : r);
      if (g && g.obj) this.setFocus(g.obj, INFO[id] ? INFO[id][0] : id);
    }
    onDown(e) {
      // A left-button drag can start a native drag of selected text; then the browser cancels the
      // pointer events and the drag stops (a right-button drag has no native drag). So the view
      // stops the native selection and drag here.
      if (e.button === 0) { e.preventDefault(); const sel = window.getSelection && window.getSelection(); if (sel && sel.rangeCount) sel.removeAllRanges(); }
      if (this.pop && !this.pop.hidden) this.pop.hidden = true;
      if (this.tool === 'scratch' && e.button === 0 && !e.shiftKey && !this.ptrs.size) {
        this.scr = { last: null };
        if (this.scratchAt(e.clientX, e.clientY)) {
          this.scratching = e.pointerId;
          try { this.wrap.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
          this.setHover(null);
          return;
        }
      }
      this.wrap.focus({ preventScroll: true });
      try { this.wrap.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // left drag (and one finger) moves the view, like the Die tab; right drag, middle drag
      // or Shift turns the camera
      this.down = { x: e.clientX, y: e.clientY, t: animNow(), moved: false, pan: e.button === 0 && !e.shiftKey, type: e.pointerType };
      if (this.ptrs.size === 2) { this.down.moved = true; this.pinch = this.pinchState(); }
      this.wrap.classList.add('bv-drag');
    }
    pinchState() {
      const [a, b] = [...this.ptrs.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    onMove(e) {
      if (this.scratching === e.pointerId) { this.scratchAt(e.clientX, e.clientY); return; }
      const p = this.ptrs.get(e.pointerId);
      if (!p) { this.hoverAt = { x: e.clientX, y: e.clientY }; this.lastPtr = { x: e.clientX, y: e.clientY, t: 0 }; return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const d = this.down;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (!d.moved) return;
      this.userMoved();
      const h = this.wrap.clientHeight || 1;
      const c = this.cam;
      if (this.ptrs.size >= 2) {
        const s = this.pinchState(), o = this.pinch;
        if (o && s.d > 0) {
          // two fingers: pinch zooms, a twist turns, an up or down drag tilts
          c.g.r *= o.d / s.d;
          let da = s.ang - o.ang;
          if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
          c.g.theta += da;
          c.g.phi -= (s.my - o.my) / h * 2.2;
        }
        this.pinch = s;
      } else if (d.pan) this.panBy(dx, dy, h);
      else {
        c.g.theta -= dx / h * 2.6;
        c.g.phi -= dy / h * 2.2;
      }
      this.clampGoal();
      this.setHover(null);
    }
    // Move the view in the screen plane: the point under the pointer follows the pointer.
    panBy(dx, dy, h) {
      const c = this.cam;
      const k = 2 * c.r * Math.tan(this.camera.fov * Math.PI / 360) / h;
      this.camera.updateMatrixWorld();
      const e = this.camera.matrixWorld.elements;
      const right = new T.Vector3(e[0], e[1], e[2]), up = new T.Vector3(e[4], e[5], e[6]);
      c.g.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    }
    onUp(e) {
      if (this.scratching === e.pointerId) { this.scratching = null; this.scr.last = null; return; }
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      const d = this.down;
      if (this.ptrs.size < 2) this.pinch = null;
      if (!this.ptrs.size) {
        this.wrap.classList.remove('bv-drag');
        if (d && !d.moved && e.type === 'pointerup') {
          const id = this.pickAt(e.clientX, e.clientY);
          if (id) {
            this.app.select('chip', id);
            if (d.type !== 'mouse') { this.pinned = true; this.hoverAt = null; this.setHover(id, e.clientX, e.clientY); }
          } else if (this.pinned) { this.pinned = false; this.setHover(null); }
        }
        this.down = null;
      }
    }
    onKey(e) {
      const c = this.cam;
      let used = true;
      switch (e.key) {
        case 'ArrowLeft': c.g.theta += 0.14; break;
        case 'ArrowRight': c.g.theta -= 0.14; break;
        case 'ArrowUp': c.g.phi -= 0.1; break;
        case 'ArrowDown': c.g.phi += 0.1; break;
        case '+': case '=': c.g.r *= 0.87; break;
        case '-': case '_': c.g.r /= 0.87; break;
        case 'Home': this.applyPreset('overview'); return e.preventDefault();
        case 'Escape': this.pinned = false; this.setHover(null); used = false; break;
        default: used = false;
      }
      if (used) { e.preventDefault(); this.userMoved(); this.clampGoal(); }
    }
    pickAt(cx, cy) {
      const rc = this.renderer.domElement.getBoundingClientRect();
      if (!rc.width) return null;
      this.ptr.set((cx - rc.left) / rc.width * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ptr, this.camera);
      const hit = this.raycaster.intersectObjects(this.pick, false)[0];
      return hit ? hit.object.userData.pick : null;
    }
    updateHover(now) {
      // close to a die (or while the trace token is inside a chip) the tooltip would cover
      // the units: no chip tooltips then
      const inDie = this.tr && this.trTokAt && this.trInDie;
      if (this.cam.r < 5 || inDie) {
        if (this.hover || this.pinned) { this.pinned = false; this.setHover(null); }
        this.hoverAt = null;
        this.wrap.classList.remove('bv-hot');
        // the words of the unit work: their meaning (the drawing moves, so look again often)
        const L = this.lastPtr;
        if (L && !this.ptrs.size && now - L.t > 120) { L.t = now; this.termShow(this.termAt(L.x, L.y), L.x, L.y); }
        return;
      }
      if (this.termOn) this.termShow(null);
      if (this.pinned) { if (this.hover && now - (this.tipT || 0) > 200) this.fillTip(this.hover); return; }
      if (this.hoverAt && !this.ptrs.size) {
        const { x, y } = this.hoverAt;
        this.hoverAt = null;
        const id = this.pickAt(x, y);
        this.wrap.classList.toggle('bv-hot', !!id);
        this.setHover(this.tool === 'scratch' ? null : id, x, y);
      } else if (this.hover && now - (this.tipT || 0) > 200) this.fillTip(this.hover);
    }
    // The tooltip of a word of the unit work: the text of the drawing under the pointer (in the
    // window on the unit, or in the unit card) and its meaning (BlockPanel.termTip). On the
    // drawing but on no known word: the unit and its work.
    termAt(x, y) {
      if (typeof BlockPanel === 'undefined' || !BlockPanel.termTip) return null;
      // the drawing of the unit on the die (UnitFx): the pointer in the canvas of the unit
      const U = this.uRect, o = this.lastUnit;
      if (U && o && o.spec === U.spec && o.words) {
        const cr = this.renderer.domElement.getBoundingClientRect(), vx = x - cr.left, vy = y - cr.top, r = U.r;
        if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) {
          const cx = (vx - r.x) / r.w * o.cw, cy = (vy - r.y) / r.h * o.ch, pad = 3 * o.cw / Math.max(1, r.w);
          let best = null, bd = 12 * o.cw / Math.max(1, r.w);
          for (const q of o.words) {
            const d = Math.hypot(Math.max(q.x - cx, 0, cx - q.x - q.w), Math.max(q.y - cy, 0, cy - q.y - q.h));
            if (d <= pad && (!best || d < bd)) { best = q; bd = d; }
          }
          const tip = best ? BlockPanel.termTip(best.s, U.spec) : null;
          if (tip) return tip;
          return U.spec.title ? { term: String(U.spec.title), text: String(U.spec.sub || '') } : null;
        }
      }
      const on = [];
      if (this.win && this.winSpec && this.win.el.style.visibility !== 'hidden' && +this.win.el.style.opacity > 0.3) on.push([this.win.el, this.winSpec]);
      if (this.bcard && this.cardShown && this.bcard.el.classList.contains('bk-on') && !this.bcard.min) on.push([this.bcard.el, this.cardShown]);
      for (const [el, spec] of on) {
        const R = el.getBoundingClientRect();
        if (x < R.left || x > R.right || y < R.top || y > R.bottom) continue;
        let best = null, bd = 10;
        for (const t of el.querySelectorAll('svg text')) {
          if (t.closest('[style*="display: none"]')) continue;
          const b = t.getBoundingClientRect();
          if (!b.width) continue;
          const d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
          if (d < bd) { bd = d; best = t; }
        }
        const tip = best ? BlockPanel.termTip(best.textContent, spec) : null;
        if (tip) return tip;
        return spec.title ? { term: String(spec.title), text: String(spec.sub || '') } : null;
      }
      return null;
    }
    termShow(tip, x, y) {
      const el = this.termEl;
      if (!el) return;
      const key = tip ? tip.term + '|' + tip.text : '';
      if (!tip) { if (this.termOn) { this.termOn = ''; el.classList.remove('bv-on'); this.wrap.classList.remove('bv-help'); } return; }
      if (key !== this.termOn) {
        this.termOn = key;
        el.textContent = '';
        htmlEl('b', null, el, tip.term);
        el.appendChild(document.createTextNode(tip.text));
      }
      const hr = this.root.getBoundingClientRect(), tw = el.offsetWidth, th = el.offsetHeight;
      let px = x - hr.left + 16, py = y - hr.top + 18;
      if (px + tw > hr.width - 8) px = x - hr.left - tw - 16;
      if (py + th > hr.height - 8) py = y - hr.top - th - 14;
      el.style.transform = `translate(${Math.round(clamp(px, 8, Math.max(8, hr.width - tw - 8)))}px, ${Math.round(clamp(py, 8, Math.max(8, hr.height - th - 8)))}px)`;
      el.classList.add('bv-on');
      this.wrap.classList.add('bv-help');
    }
    // (for tools/xpunits.mjs) the tooltip of a word of a card
    xpTermTip(text, card) { return typeof BlockPanel !== 'undefined' && BlockPanel.termTip ? BlockPanel.termTip(text, card) : null; }
    setHover(id, x, y) {
      if (!id) {
        if (this.hover) { this.hover = null; this.tip.classList.remove('bv-on'); }
        return;
      }
      if (id !== this.hover) { this.hover = id; this.fillTip(id); }
      this.placeTip(x, y);
      this.tip.classList.add('bv-on');
    }
    placeTip(cx, cy) {
      const hr = this.root.getBoundingClientRect(), tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let x = cx - hr.left + 18, y = cy - hr.top + 18;
      // keep clear of the top-right corner (the floating screen lives there)
      const inTR = cx - hr.left > hr.width * 0.55 && cy - hr.top < hr.height * 0.45;
      if (x + tw > hr.width - 10 || inTR) x = cx - hr.left - tw - 18;
      if (y + th > hr.height - 54) y = cy - hr.top - th - 14;
      x = clamp(x, 8, Math.max(8, hr.width - tw - 8));
      y = clamp(y, 8, Math.max(8, hr.height - th - 8));
      this.tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    fillTip(id) {
      this.tipT = performance.now();
      const key = id.startsWith('lat') ? 'lat' : id.startsWith('xcv') ? 'xcv' : id.startsWith('vram') ? 'crtc' : id.startsWith('fdd') ? 'fdd' : id.startsWith('xram') ? 'xram' : id;
      const info = INFO[key];
      if (!info) return;
      const g = this.glows[id];
      const ref = id === 'crtc' || id.startsWith('vram') || id === 'cgrom' || id === 'vga' || id === 'vmem' || id === 'dac' || id === 'vbios' ? 'J1' : id === 'fdc' ? 'J3' : id.startsWith('xram') ? 'J5' : id === 'fddA' ? 'A:' : id === 'fddB' ? 'B:' : g && g.ref ? g.ref : '';
      this.tipRef.textContent = ref;
      this.tipName.textContent = id.startsWith('vram') ? '4416 VRAM' : info[0];
      this.tipKind.textContent = info[1];
      this.tipRole.textContent = info[2];
      const acc = { fpu: 'lavender', cpu: 'gold-hi', lat0: 'cyan', lat1: 'cyan', lat2: 'cyan', bus: 'magenta', dec: 'magenta', pic: 'magenta', pit: 'magenta', ppi: 'magenta', dma: 'magenta', nmi: 'magenta', crtc: 'phosphor', vram0: 'phosphor', vram1: 'phosphor', monitor: 'phosphor', vga: 'phosphor', vmem: 'phosphor', dac: 'phosphor', vbios: 'gold', cgrom: 'phosphor', fdc: 'cyan', fddA: 'phosphor', fddB: 'phosphor', pic2: 'magenta', kbc: 'magenta', rtc: 'phosphor', dma2: 'magenta', bat: 'phosphor', xtal2: 'magenta' }[id] || 'gold';
      this.tip.style.setProperty('--bv-acc', `var(--${acc})`);
      const rows = this.stateOf(id);
      if (this.fxLine[id] && (this.decapByGlow[id] || []).some(x => this.isOpen(x))) rows.push(['on the die', this.fxLine[id]]);
      const dl = this.tipState;
      dl.textContent = '';
      for (const [k, v] of rows) { htmlEl('dt', null, dl, k); htmlEl('dd', null, dl, String(v)); }
      dl.hidden = !rows.length;
    }
    // Live VGA state (the VGA core is optional: every field is guarded).
    vgaState(id) {
      const vg = this.app.machine.vga;
      if (!vg) return [['state', 'VGA core not loaded']];
      const rows = [];
      const pick = (...names) => { for (const n of names) if (vg[n] !== undefined && vg[n] !== null) return vg[n]; return undefined; };
      try {
        const mode = pick('mode', 'modeNumber');
        if (mode !== undefined) rows.push(['mode', typeof mode === 'object' ? (mode.name || mode.id || JSON.stringify(mode).slice(0, 18)) : hex2(mode) + 'h']);
        const w = pick('width', 'w'), h = pick('height', 'h');
        if (w && h) rows.push(['resolution', `${w} × ${h}`]);
        else if (typeof mode === 'object' && mode.width) rows.push(['resolution', `${mode.width} × ${mode.height}`]);
        const cr = pick('crtc', 'cr');
        if (cr && cr[12] !== undefined) rows.push(['start address', hex4((cr[12] << 8) | cr[13])]);
        if (id === 'dac') {
          const wi = pick('dacWrite', 'dacWriteIndex', 'dacIndex');
          if (wi !== undefined) rows.push(['DAC entry being written', typeof wi === 'number' ? wi : String(wi)]);
          const pm = pick('pixelMask', 'dacMask');
          if (pm !== undefined) rows.push(['pixel mask', hex2(pm) + 'h']);
        }
        if (id === 'vmem') { const seq = pick('seq'); if (seq) rows.push(['map mask', bin(seq[2] & 15, 4)]); }
      } catch (e) { /* partial state */ }
      if (id === 'vbios') rows.push(['range', 'C0000–C7FFF'], ['signature', '55AAh']);
      return rows.length ? rows : [['state', 'running']];
    }
    stateOf(id) {
      const m = this.app.machine, c = m.cpu, L = this.last;
      const lastDev = d => {
        const x = L.dev[d];
        if (!x) return ['last access', '—'];
        return ['last ' + (x.read ? 'read' : 'write'), `[${hexA(x.addr)}] ${x.read ? '=' : '←'} ${x.w === 2 ? hex4(x.data) : hex2(x.data)}`];
      };
      const diskState = i => { const d = (m.disks || [])[i]; return d ? (d.name || 'disk') + ((d.busy || 0) > 0.05 ? ' · busy' : '') : 'empty'; };
      try {
        switch (id) {
          case 'cpu': {
            const rows = [['CS:IP', `${hex4(c.sregs[1])}:${hex4(c.ip)}`], ['FLAGS', hex4(c.flags)], ['queue', `${c.q.length} / ${QSIZE} bytes`]];
            if (M286) {
              if (c.msw !== undefined) rows.push(['MSW', `${hex4(c.msw)} · ${c.msw & 1 ? 'protected' : 'real'} mode`]);
              if (c.cpl !== undefined) rows.push(['CPL', c.cpl]);
              const cs = c.cache && c.cache[1];
              if (cs) rows.push(['CS base', hexA(cs.base)]);
              rows.push(['A20', m.a20 ? 'on' : 'off (wraps at 1 MB)']);
            } else rows.push(['clocks', c.cycles.toLocaleString('en-US')]);
            return rows;
          }
          case 'pic2': { const q = m.pic2; if (!q) return []; return [['IRR', hex2(q.irr)], ['ISR', hex2(q.isr)], ['IMR', hex2(q.imr)], ['vector base', hex2(q.base) + 'h']]; }
          case 'kbc': { const k = m.kbc; if (!k) return []; return [['command byte', hex2(k.cmdByte) + 'h'], ['output port', hex2(k.outPort) + 'h'], ['A20 gate', m.a20 ? 'on' : 'off'], ['reset line', k.outPort & 1 ? 'high' : 'low']]; }
          case 'rtc': { const r = m.rtc; if (!r) return []; const t = new Date(Date.now() + (r.offset || 0)); return [['index 70h', hex2(r.index) + 'h'], ['NMI', r.nmiOff ? 'masked' : 'enabled'], ['time', t.toTimeString().slice(0, 8)]]; }
          case 'dma2': { const d = m.dma2; if (!d) return []; return [['mask', bin(d.mask, 4)], ['ch 4 address', hex4(d.addr[0])]]; }
          case 'xram': return [['range', '100000–1FFFFF'], ['A20', m.a20 ? 'on' : 'off'], lastDev('xram')];
          case 'bat': return [['voltage', '3.0 V'], ['keeps', 'RTC and 50 bytes CMOS']];
          case 'xtal2': return [['frequency', '14.31818 MHz'], ['8254 clock', '1.193182 MHz (÷ 12)']];
          case 'fpu': {
            const f = m.fpu;
            if (!f) return [];
            return [['TOP', f.top], ['SW', hex4(f.sw)], ['CW', hex4(f.cw)], ['ST(0)', f.describe(0)]];
          }
          case 'clk': return M286 ? [['crystal', '16 MHz'], ['CLK', '16 MHz'], ['processor clock', '8 MHz (CLK ÷ 2)'], ['PCLK', '8 MHz']]
            : [['crystal', '14.31818 MHz'], ['CLK', '4.77 MHz (÷ 3)'], ['PCLK', '2.39 MHz (÷ 6)']];
          case 'xtal': return M286 ? [['frequency', '16 MHz'], ['CPU clock', '8 MHz']] : [['frequency', '14.31818 MHz'], ['CPU clock', '4.772727 MHz']];
          case 'bus': return [['last status', L.status === null ? '—' : `${L.status.toString(2).padStart(3, '0')} ${STATUS_NAME[L.status]}`], ['last command', L.cmd || '—']];
          case 'lat0': case 'lat1': case 'lat2': {
            const part = { lat0: [0, 'A0–A7'], lat1: [8, 'A8–A15'], lat2: [16, M286 ? 'A16–A23' : 'A16–A19'] }[id];
            const a = L.addr;
            return [['latched', a === null ? '—' : hex2((a >> part[0]) & (id === 'lat2' && !M286 ? 0xF : 0xFF)) + 'h  ' + part[1]], ['full address', a === null ? '—' : hexA(a)]];
          }
          case 'xcv0': case 'xcv1': {
            const d = L.data;
            const v = d ? (id === 'xcv0' ? d.v & 0xFF : (d.w === 2 ? d.v >> 8 : d.v) & 0xFF) : null;
            return [['bits', id === 'xcv0' ? 'D0–D7' : 'D8–D15'], ['last data', v === null ? '—' : hex2(v) + 'h'], ['DT/R', d ? (d.read ? 'receive (read)' : 'transmit (write)') : '—']];
          }
          case 'dec': return [['last select', L.sel || '—']];
          case 'pic': { const p = m.pic; return [['IRR', hex2(p.irr)], ['ISR', hex2(p.isr)], ['IMR', hex2(p.imr)], ['vector base', hex2(p.base) + 'h']]; }
          case 'pit': return m.pit.ch.map((ch, i) => [`counter ${i}`, `${hex4(ch.count)} / ${hex4(ch.reload & 0xFFFF)} · mode ${ch.mode}`]);
          case 'ppi': { const b = m.ppi.portB; return [['port B', `${hex2(b)}  ${bin(b, 8)}`], ['speaker', (b & 3) === 3 ? 'on' : 'off'], ['port A', hex2(m.kbd.data) + 'h']]; }
          case 'dma': { const d = m.dma; return [['mask', bin(d.mask, 4)], ['ch 0 address', hex4(d.addr[0])], ['ch 0 count', hex4(d.count[0])]]; }
          case 'nmi': return [['port A0h', hex2(m.nmiMask) + 'h'], ['NMI', m.nmiMask & 0x80 ? 'enabled' : 'masked']];
          case 'romE': case 'romO': return [['range', M286 ? 'F0000–FFFFF, FF0000' : 'F0000–FFFFF'], ['bytes', id === 'romE' ? 'even (D0–D7)' : 'odd (D8–D15)'], lastDev('rom')];
          case 'ramE': case 'ramO': return [['range', '00000–9FFFF'], ['bytes', id === 'ramE' ? 'even (D0–D7)' : 'odd (D8–D15)'], lastDev('ram')];
          case 'vga': case 'vmem': case 'dac': case 'vbios': return this.vgaState(id);
          case 'cgrom': if (!m.crtc) return []; return [['row address', m.crtc.r[9] !== undefined ? `${m.crtc.r[9] + 1} scan lines` : '—'], ['read by', '6845 while the beam draws text']];
          case 'crtc': case 'vram0': case 'vram1': case 'cgal': {
            const k = m.crtc;
            if (!k) return [];
            const cur = k.cursor;
            return [['cursor', `row ${Math.floor(cur / 80)}, col ${cur % 80}`], ['start', hex4(k.start)], ['mode 3D8h', hex2(k.mode) + 'h'], lastDev('vram')];
          }
          case 'monitor': return [['picture', '80 × 25 text, 16 colors'], ['cursor', `${Math.floor(m.crtc.cursor / 80)}, ${m.crtc.cursor % 80}`]];
          case 'spk': return [['tone', m.lastTone > 0 ? `${Math.round(m.lastTone)} Hz` : 'off']];
          case 'fdc': { const F = this.app.machine.fdc; return [['ports', '3F2h, 3F4h, 3F5h'], ['phase', F ? `${F.phase}${F.cmd ? ' · ' + F.cmd : ''}` : '—'], lastDev('fdc'), ['drive A:', diskState(0)], ['drive B:', diskState(1)]]; }
          case 'fddA': case 'fddB': {
            const i = id === 'fddA' ? 0 : 1, d = (m.disks || [])[i];
            if (!d) return [['disk', 'none']];
            return [['disk', d.name || '—'], ['type', d.label || (d.size ? Math.round(d.size / 1024) + ' KB' : '—')], ['last sector', d.lastSector >= 0 ? d.lastSector : '—'], ['reads / writes', (d.reads || 0) + ' / ' + (d.writes || 0)], ['light', (d.busy || 0) > 0.05 ? 'on' : 'off']];
          }
          case 'kbd': return [['waiting keys', m.kbd.fifo.length], ['last scan code', hex2(m.kbd.data) + 'h']];
          case 'hdc': case 'hdd': {
            const d = m.hdisk, I = m.ide;
            if (!d) return [['disk', 'none (Disks tab: New bootable C:)']];
            const cmd = I ? { 0x20: 'READ SECTORS', 0x30: 'WRITE SECTORS', 0x40: 'READ VERIFY', 0xEC: 'IDENTIFY', 0x91: 'INIT PARAMETERS' }[I.lastCmd] || (I.lastCmd ? hex2(I.lastCmd) + 'h' : '—') : '—';
            return [['disk', d.name || '—'], ['geometry', `${d.cyls} cyl × ${d.heads} heads × ${d.spt} sectors`], ['last command', cmd], ['status 1F7h', I ? hex2(I.status) + 'h' : '—'],
              ['last sector', d.lastSector >= 0 ? d.lastSector : '—'], ['reads / writes', (d.reads || 0) + ' / ' + (d.writes || 0)], ['light', (d.busy || 0) > 0.05 ? 'on' : 'off']];
          }
          default: return [];
        }
      } catch (err) {
        return [];
      }
    }

    // ---------- decap: scratch the package open ----------
    registerDecap(key, grp, d, planeY, part, glowId) {
      const e = { key, grp, d, planeY, part: DIE_OF(part), glowId, cov: 0, mesh: null, dirty: false, auto: null };
      this.decaps.set(key, e);
      (this.decapByGlow[glowId] = this.decapByGlow[glowId] || []).push(e);
      return e;
    }
    dieImage(part, d, cw, ch, turn) {
      const key = `${part}|${d.pins}|${cw}|${ch}|${turn ? 1 : 0}`;
      if (this.dieCache.has(key)) return this.dieCache.get(key);
      const c = canvas(cw, ch);
      drawInterior(c.getContext('2d'), cw, ch, d, part, 1, null, turn);
      this.dieCache.set(key, c);
      return c;
    }
    ensureDecap(e) {
      if (e.mesh) { e.mesh.visible = true; return e; }
      const d = e.d;
      const ppu = Math.min(400, 2048 / (d.L * 0.97));   // sharp enough for a close zoom
      e.cw = Math.max(64, Math.round(d.L * 0.97 * ppu));
      e.ch = Math.max(32, Math.round(d.W * 0.94 * ppu));
      e.mask = canvas(Math.max(16, Math.round(e.cw / 4)), Math.max(8, Math.round(e.ch / 4)));
      e.comp = canvas(e.cw, e.ch);
      e.turn = Math.abs(e.grp.rotation.y) > 0.1;   // a chip with rot: the die turns 90 degrees
      e.die = this.dieImage(e.part, d, e.cw, e.ch, false);   // (the camera of a die view turns with the die)
      e.tex = colorTex(e.comp, this.aniso);
      e.mat = new T.MeshPhysicalMaterial({
        map: e.tex, emissiveMap: e.tex, emissive: '#ffffff', emissiveIntensity: 0.12, transparent: true, depthWrite: false,
        roughness: 0.34, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.22, envMapIntensity: 0.6,
        iridescence: 0.45, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 520],
        polygonOffset: true, polygonOffsetFactor: -4,
      });
      const m = new T.Mesh(new T.PlaneGeometry(d.L * 0.97, d.W * 0.94), e.mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = e.planeY;
      m.renderOrder = 4;
      e.grp.add(m);
      e.mesh = m;
      return e;
    }
    // Wear the package away around a point (chip local x along the package, z across it).
    paintAt(e, lx, lz, k) {
      const d = e.d, mw = e.mask.width, mh = e.mask.height;
      const x = (lx + d.L * 0.485) / (d.L * 0.97) * mw, y = (lz + d.W * 0.47) / (d.W * 0.94) * mh;
      const r = 0.3 / (d.L * 0.97) * mw;
      const g = e.mask.getContext('2d');
      for (let j = 0; j < 3; j++) {
        const jx = x + (Math.random() - 0.5) * r * 0.7, jy = y + (Math.random() - 0.5) * r * 0.7, rr = r * (j ? 0.45 : 1);
        const gr = g.createRadialGradient(jx, jy, 0, jx, jy, rr);
        gr.addColorStop(0, `rgba(255,255,255,${0.42 * k})`); gr.addColorStop(0.55, `rgba(255,255,255,${0.22 * k})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(jx, jy, rr, 0, TAU); g.fill();
      }
      e.cov = Math.min(1, e.cov + Math.PI * r * r * 0.25 * k / (mw * mh));
      e.dirty = true;
    }
    composite(e, rim) {
      const g = e.comp.getContext('2d'), cw = e.cw, ch = e.ch;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, cw, ch);
      if (rim) {
        // a dark worn edge around the opening
        g.save(); g.filter = 'blur(4px)'; g.drawImage(e.mask, 0, 0, cw, ch); g.restore();
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = 'rgba(34,24,30,0.94)'; g.fillRect(0, 0, cw, ch);
        g.globalCompositeOperation = 'source-over';
      }
      let t = this.tmpC;
      if (!t || t.width < cw || t.height < ch) t = this.tmpC = canvas(Math.max(cw, t ? t.width : 0), Math.max(ch, t ? t.height : 0));
      const tg = t.getContext('2d');
      tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, t.width, t.height);
      tg.drawImage(e.die, 0, 0);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(e.mask, 0, 0, cw, ch);
      tg.globalCompositeOperation = 'source-over';
      g.drawImage(t, 0, 0, cw, ch, 0, 0, cw, ch);
      e.tex.needsUpdate = true;
      e.maskVer = (e.maskVer || 0) + 1;
    }
    decapAll() {
      const now = performance.now();
      for (const e of this.decaps.values()) {
        this.ensureDecap(e);
        if (this.reduced) { this.fillMask(e); continue; }
        e.auto = { t0: now + Math.random() * 600, dur: 700 + Math.random() * 500 };
      }
      this.dirty = true;
    }
    fillMask(e) {
      const g = e.mask.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, e.mask.width, e.mask.height);
      e.cov = 1; e.auto = null; e.dirty = true;
    }
    restoreAll() {
      for (const e of this.decaps.values()) {
        if (!e.mesh) continue;
        e.mask.getContext('2d').clearRect(0, 0, e.mask.width, e.mask.height);
        e.cov = 0; e.auto = null; e.dirty = false; e.win = null;
        e.mesh.visible = false;
        if (e.fxMesh) e.fxMesh.visible = false;
      }
      if (this.pop) this.pop.hidden = true;
      this.fx.clear();
      this.dirty = true;
    }
    updateDecap(rnow, rdt) {
      this.decapBusy = false;
      for (const e of this.decaps.values()) {
        if (e.window) {
          const hide = !!(e.auto || (e.mesh && e.mesh.visible && (e.cov > 0.02 || e.win)));
          if (e.window.visible === hide) { e.window.visible = !hide; this.dirty = true; }
        }
        if (e.auto) {
          const u = (rnow - e.auto.t0) / e.auto.dur;
          if (u > 0) {
            const g = e.mask.getContext('2d'), mw = e.mask.width, mh = e.mask.height;
            if (e.auto.round) { this.paintWindow(e, Math.min(1, u)); e.dirty = true; if (u >= 1) e.auto = null; }
            else if (u >= 1) this.fillMask(e);
            else {
              const R = easeOut(u) * Math.hypot(mw, mh) * 0.62;
              const gr = g.createRadialGradient(mw / 2, mh / 2, 0, mw / 2, mh / 2, Math.max(1, R));
              gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
              g.fillStyle = gr; g.fillRect(0, 0, mw, mh);
              e.cov = Math.max(e.cov, u);
              e.dirty = true;
            }
          }
          this.decapBusy = true;
        }
        if (e.dirty) { this.composite(e, !e.auto); e.dirty = false; this.decapBusy = true; }
      }
      this.updateDust(rdt / 1000);
    }
    buildDust() {
      const n = 260;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      const pts = new T.Points(g, new T.PointsMaterial({
        size: 0.07, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
      }));
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.dust = { n, g, pos, col, base: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), i: 0, alive: 0 };
    }
    spawnDust(p) {
      const D = this.dust;
      if (!D || this.reduced) return;
      for (let k = 0; k < 5; k++) {
        const i = D.i++ % D.n;
        D.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.12; D.pos[i * 3 + 1] = p.y + 0.03; D.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.12;
        D.vel[i * 3] = (Math.random() - 0.5) * 1.1; D.vel[i * 3 + 1] = 0.7 + Math.random() * 1.3; D.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.1;
        const gold = Math.random() < 0.4;
        D.base[i * 3] = gold ? 1 : 0.6; D.base[i * 3 + 1] = gold ? 0.78 : 0.52; D.base[i * 3 + 2] = gold ? 0.4 : 0.66;
        D.life[i] = D.max[i] = 0.45 + Math.random() * 0.6;
      }
      D.alive = 1.2;
    }
    updateDust(dt) {
      const D = this.dust;
      if (!D || D.alive <= 0) return;
      D.alive -= dt;
      for (let i = 0; i < D.n; i++) {
        if (D.life[i] <= 0) { D.col[i * 3] = D.col[i * 3 + 1] = D.col[i * 3 + 2] = 0; continue; }
        D.life[i] -= dt;
        D.vel[i * 3 + 1] -= 3.4 * dt;
        for (let k = 0; k < 3; k++) D.pos[i * 3 + k] += D.vel[i * 3 + k] * dt;
        if (D.pos[i * 3 + 1] < 0.01) { D.pos[i * 3 + 1] = 0.01; D.vel[i * 3 + 1] *= -0.3; }
        const a = Math.max(0, D.life[i] / D.max[i]);
        for (let k = 0; k < 3; k++) D.col[i * 3 + k] = D.base[i * 3 + k] * a;
      }
      D.g.attributes.position.needsUpdate = true;
      D.g.attributes.color.needsUpdate = true;
      this.decapBusy = true;
    }
    // ---------- live activity inside the open dies ----------
    layOf(e) {
      if (!e.lay) {
        if (!e.cw) { const ppu = Math.min(400, 2048 / (e.d.L * 0.97)); e.cw = Math.max(64, Math.round(e.d.L * 0.97 * ppu)); e.ch = Math.max(32, Math.round(e.d.W * 0.94 * ppu)); }
        e.lay = dieLayout(e.cw, e.ch, e.d, e.part);
      }
      return e.lay;
    }
    // open: scratched open, or opened with a round window (then cov can stay 0)
    isOpen(e) { return !!(e && e.mesh && e.mesh.visible && (e.cov > 0.02 || e.win)); }
    // Index of the n-th block with this label, or -1.
    bIdx(e, label, n = 0) {
      if (e.part === '80286' && BLK_286[label]) label = BLK_286[label];
      else if (e.part === '80386' && BLK_386[label]) label = BLK_386[label];
      else if (e.part === '80486' && BLK_486[label]) label = BLK_486[label];
      else if (e.part === '80586' && BLK_586[label]) label = BLK_586[label];
      else if (e.part === '80686' && BLK_686[label]) label = BLK_686[label];
      const b = this.layOf(e).blocks;
      for (let i = 0; i < b.length; i++) if (b[i].label === label && n-- === 0) return i;
      return -1;
    }
    bCtr(e, i) { const b = this.layOf(e).blocks[i]; return b ? [b.x + b.w / 2, b.y + b.h / 2] : [e.cw / 2, e.ch / 2]; }
    // The pin whose bond pad is nearest to a die point.
    padNear(e, pt, bottom) {
      let best = null, bd = 1e9;
      for (const p of this.layOf(e).pins) {
        if (bottom !== undefined && p.bottom !== bottom) continue;
        const dd = Math.hypot(p.p[0] - pt[0], p.p[1] - pt[1]);
        if (dd < bd) { bd = dd; best = p; }
      }
      return best;
    }
    // A die route through points: a pin object enters or leaves through its finger and pad.
    dieRoute(e, refs) {
      const out = [];
      refs.forEach((r, k) => {
        let pts;
        if (r && r.p) pts = k === 0 ? [r.e, r.p] : [r.p, r.e];
        else pts = [r];
        for (const p of pts) {
          if (out.length) {
            const a = out[out.length - 1];
            if (Math.abs(a[0] - p[0]) > 0.5 && Math.abs(a[1] - p[1]) > 0.5) out.push([p[0], a[1]]);   // Manhattan corner
          }
          out.push(p.slice());
        }
      });
      return out;
    }
    ensureFx(e) {
      if (e.fxMesh) return e;
      const L = this.layOf(e), n = Math.min(16, L.blocks.length);
      const V4 = k => Array.from({ length: k }, () => new T.Vector4());
      const C3 = k => Array.from({ length: k }, () => new T.Color());
      const u = {
        uBlk: { value: V4(16) }, uAct: { value: new Float32Array(16) }, uCol: { value: C3(16) }, uNB: { value: n },
        uSeg: { value: V4(16) }, uSegS: { value: new Float32Array(16) }, uNS: { value: 0 },
        uHead: { value: 0 }, uTail: { value: 0.05 }, uPAmp: { value: 0 }, uPHold: { value: 0 }, uPCol: { value: new T.Color() }, uPW: { value: 0.004 },
        uMark: { value: V4(3) }, uMarkA: { value: new Float32Array(3) }, uMarkC: { value: C3(3) },
        uCell: { value: new T.Vector4() }, uCellA: { value: 0 }, uBit: { value: 0 }, uCellC: { value: new T.Color() },
        uAsp: { value: e.cw / e.ch }, uTime: { value: 0 }, uMin: { value: 0.02 },
      };
      for (let i = 0; i < n; i++) u.uBlk.value[i].copy(this.uvRect(e, L.blocks[i]));
      const dieV = L.dh / e.ch;
      u.uPW.value = dieV * 0.014; u.uTail.value = dieV * 0.3; u.uMin.value = dieV * 0.05;
      const mat = glowMat(DFX_FS, u);
      mat.polygonOffset = true; mat.polygonOffsetFactor = -12;
      const m = new T.Mesh(new T.PlaneGeometry(e.d.L * 0.97, e.d.W * 0.94), mat);
      m.position.z = 0.0005;
      m.renderOrder = 7;
      m.visible = false;
      e.mesh.add(m);
      e.fxMesh = m; e.fxU = u;
      return e;
    }
    uvRect(e, r) {
      const x = r.x !== undefined ? r.x : r[0], y = r.y !== undefined ? r.y : r[1], w = r.w !== undefined ? r.w : r[2], h = r.h !== undefined ? r.h : r[3];
      return new T.Vector4(x / e.cw, 1 - (y + h) / e.ch, (x + w) / e.cw, 1 - y / e.ch);
    }
    // Add a timed activity item to the die of chip key (phase windows in bus clocks).
    addFx(key, ev, now, ms, spec) {
      if (this.fxOnly && key !== this.fxOnly) return null;
      const e = this.decaps.get(key);
      if (!this.isOpen(e)) return null;
      this.ensureFx(e);
      const it = Object.assign({ t0: now, ms, tClk: ev ? ev.t || 0 : 0, manual: ms >= 300, end: 4.8, blocks: [], k: ev && ev.len ? 4 / ev.len : 1 }, spec);
      it.blocks = it.blocks.map(b => [typeof b[0] === 'number' ? b[0] : this.bIdx(e, b[0], b[5] || 0), b[1], b[2], b[3], new T.Color(b[4])]).filter(b => b[0] >= 0);
      if (it.path) {
        const P = it.path, asp = e.cw / e.ch, segs = [], cum = [];
        let s = 0;
        for (let i = 0; i < P.pts.length - 1 && segs.length < 16; i++) {
          const a = P.pts[i], b = P.pts[i + 1];
          const au = [a[0] / e.cw, 1 - a[1] / e.ch], bu = [b[0] / e.cw, 1 - b[1] / e.ch];
          segs.push(new T.Vector4(au[0], au[1], bu[0], bu[1]));
          cum.push(s);
          s += Math.hypot((bu[0] - au[0]) * asp, bu[1] - au[1]);
        }
        P.segs = segs; P.cum = cum; P.len = s; P.color = new T.Color(P.col || THEME.gold);
      }
      if (it.marks) it.marks = it.marks.map(m => ({ r: this.uvRect(e, m[0]), p0: m[1], p1: m[2], c: new T.Color(m[3]) }));
      if (it.cell) { it.cell.r = this.uvRect(e, it.cell.rect); it.cell.c = new T.Color(it.cell.col); }
      let L = this.fx.get(key);
      if (!L) this.fx.set(key, L = []);
      L.push(it);
      if (L.length > 10) L.splice(0, L.length - 10);
      if (spec.line) this.fxLine[e.glowId] = spec.line;
      return it;
    }
    // Make die activity from one micro-event (explain mode, or a replayed fast-mode sample).
    dieFx(ev, now, ms) {
      if (!this.decaps.size) return;
      const C = THEME, F = (k, spec) => this.addFx(k, ev, now, ms, spec);
      const cpu = this.decaps.get('cpu'), fpu = this.decaps.get('fpu');
      switch (ev.k) {
        case 'fetch': case 'bus': this.busFx(ev, now, ms); return;
        case 'queue':
          if (ev.op === 'pop') F('cpu', { blocks: [['QUEUE', 0, 1, 0.9, C.gold], ['DECODER', 0.3, 1.4, 0.7, C.gold]], end: 2.2 });
          else if (ev.op === 'flush') F('cpu', { blocks: [['QUEUE', 0, 1.2, 1, C.magenta]], end: 2.2 });
          return;
        case 'decode':
          if (this.isOpen(cpu)) F('cpu', { blocks: [['DECODER', 0, 1.6, 1, C.gold], ['MICROCODE ROM', 0.5, 2.2, 0.9, C.lavender]],
            path: { pts: this.dieRoute(cpu, [this.bCtr(cpu, this.bIdx(cpu, 'QUEUE')), this.bCtr(cpu, this.bIdx(cpu, 'DECODER')), this.bCtr(cpu, this.bIdx(cpu, 'MICROCODE ROM'))]), p0: 0, p1: 1.4, col: C.gold, hold: 0.3 },
            end: 3, line: ev.text });
          return;
        case 'alu':
          if (this.isOpen(cpu)) F('cpu', { blocks: [['ALU', 0, 1.2, 1, C.cyan], ['FLAGS', 0.5, 1.6, 0.8, C.cyan]],
            path: { pts: this.dieRoute(cpu, [this.bCtr(cpu, this.bIdx(cpu, 'REGISTERS')), this.bCtr(cpu, this.bIdx(cpu, 'ALU')), this.bCtr(cpu, this.bIdx(cpu, 'FLAGS'))]), p0: 0, p1: 1.2, col: C.cyan, hold: 0.3 },
            end: 2.6, line: `ALU ${ev.op}` });
          return;
        case 'reg': if (ev.r !== 'IP') F('cpu', { blocks: [[ev.r.length === 2 && 'CSDSESSS'.includes(ev.r) ? 'SEGMENT REGS' : 'REGISTERS', 0, 1.2, 0.9, C.goldHi]], end: 2.2 }); return;
        case 'flags': F('cpu', { blocks: [['FLAGS', 0, 1.2, 0.9, C.goldHi]], end: 2.2 }); return;
        case 'ea':
          if (this.isOpen(cpu)) F('cpu', { blocks: [['SEGMENT REGS', 0, 1.2, 0.8, C.cyan], ['ADDRESS ADDER', 0.2, 1.5, 1, C.cyan]],
            path: { pts: this.dieRoute(cpu, [this.bCtr(cpu, this.bIdx(cpu, 'SEGMENT REGS')), this.bCtr(cpu, this.bIdx(cpu, 'ADDRESS ADDER'))]), p0: 0, p1: 0.9, col: C.cyan, hold: 0.3 },
            end: 2.6, line: `EA ${ev.seg}:${hex4(ev.off)} = ${hexA(ev.phys)}` });
          return;
        case 'desc':
          F('cpu', { blocks: [['SEGMENT CACHES', 0, 2.2, 1, C.lavender], ['PROTECTION CHECK', 0.4, 2.6, 0.9, C.magenta]], end: 3.4,
            line: `${ev.sreg} ← ${hex4(ev.sel || 0)} · base ${hexA(ev.base || 0)} · limit ${hex4(ev.limit || 0)}${ev.table ? ' (' + ev.table + ')' : ''}` });
          return;
        case 'sys':
          F('cpu', { blocks: [['CONTROL ROM', 0, 2.2, 1, C.lavender], ['SEGMENT CACHES', 0.4, 2.6, 0.8, C.lavender]], end: 3.2, line: ev.text || ev.op });
          return;
        case 'task':
          F('cpu', { blocks: [['SEGMENT CACHES', 0, 3, 1, C.magenta], ['PROTECTION CHECK', 0, 3, 1, C.magenta], ['REGISTERS', 0.5, 3.2, 1, C.magenta]], end: 4,
            line: `task switch ${hex4(ev.from || 0)} → ${hex4(ev.to || 0)}` });
          return;
        case 'iq':
          F('cpu', { blocks: [['DECODED QUEUE', 0, 1.4, clamp(0.35 + (ev.n || 0) * 0.22, 0, 1), C.gold], ['INSTRUCTION DECODER', 0, 1.0, 0.6, C.gold]], end: 2.2,
            line: `decoded instruction queue: ${ev.n || 0} of 3` });
          return;
        case 'int': {
          F('cpu', { blocks: [['INTERRUPTS TIMING', 0, 2, 1, C.magenta], ['MICROCODE ROM', 0.8, 2.8, 0.8, C.magenta]], end: 3.5 });
          if (M286 && ev.src === 'exc') F('cpu', { blocks: [['PROTECTION CHECK', 0, 2.6, 1, C.magenta]], end: 3.4, line: `${ev.name || 'exception'} (INT ${hex2(ev.vec)}h)${ev.err !== undefined ? ' error code ' + hex4(ev.err) : ''}` });
          if (ev.src === 'irq') {
            const pic = this.decaps.get('pic');
            if (this.isOpen(pic)) {
              const irq = (ev.vec - (this.app.machine.pic.base || 8)) & 7;
              F('pic', { blocks: [['IRR', 0, 1.6, 1, C.magenta], ['PRIORITY RESOLVER', 0.4, 2.2, 1, C.magenta], ['CONTROL LOGIC', 0.8, 2.6, 0.9, C.magenta]],
                path: { pts: this.dieRoute(pic, [this.padNear(pic, this.bCtr(pic, this.bIdx(pic, 'IRR'))), this.bCtr(pic, this.bIdx(pic, 'IRR')), this.bCtr(pic, this.bIdx(pic, 'PRIORITY RESOLVER')), this.bCtr(pic, this.bIdx(pic, 'CONTROL LOGIC')), this.padNear(pic, this.bCtr(pic, this.bIdx(pic, 'CONTROL LOGIC')))]), p0: 0, p1: 1.8, col: C.magenta, hold: 0.3 },
                end: 3.5, line: `IRQ${irq} → INTR (vector ${hex2(ev.vec)}h)` });
            }
            if (ev.vec === 8) F('pit', { blocks: [['COUNTER 0', 0, 1.2, 1, C.magenta]], end: 2.2, line: 'counter 0 reached zero: IRQ0' });
          } else if (ev.src === 'nmi') {
            F('nmi', { blocks: [['D FLIP-FLOP 2', 0, 1.6, 1, C.magenta]], end: 2.6 });
            F('fpu', { blocks: [['STATUS', 0, 1.6, 1, C.magenta]], end: 2.6 });
          }
          return;
        }
        case 'fpu': {
          if (!this.isOpen(fpu)) return;
          const len = clamp(ev.cycles || 20, 3, 60);
          F('fpu', { blocks: [['MICROCODE ROM', 0, len, 0.8, C.lavender], ['MANTISSA', 0.5, len, 0.9, C.lavender], ['EXPONENT', 0.5, len, 0.8, C.lavender], ['REGISTER STACK', 1, len + 0.5, 1, C.lavender]],
            path: { pts: this.dieRoute(fpu, [this.bCtr(fpu, this.bIdx(fpu, 'MICROCODE ROM')), this.bCtr(fpu, this.bIdx(fpu, 'MANTISSA')), this.bCtr(fpu, this.bIdx(fpu, 'EXPONENT')), this.bCtr(fpu, this.bIdx(fpu, 'REGISTER STACK'))]), p0: 0, p1: Math.min(len, 6), col: C.lavender, hold: 0.35 },
            end: len + 1.5, line: ev.text });
          return;
        }
        default:
      }
    }
    busFx(ev, now, ms) {
      const C = THEME, I = busInfo(ev), F = (k, spec) => this.addFx(k, ev, now, ms, spec);
      const { kind, read, dev, addr, d16, lo, hi } = I;
      const st = STATUS[kind], cmd = CMD_BIT[kind];
      // 8086 or 8087: the bus unit
      const who = I.fpu ? 'fpu' : 'cpu', we = this.decaps.get(who);
      if (this.isOpen(we)) {
        const bc = I.fpu ? 'BUS INTERFACE' : 'BUS CONTROL';
        const adP = this.padNear(we, this.bCtr(we, this.bIdx(we, bc)));
        const dst = I.fpu ? 'REGISTER STACK' : kind === 'fetch' ? 'QUEUE' : 'REGISTERS';
        if (M286 && !I.fpu) F(who, { blocks: [['OFFSET ADDER', 0, 0.8, 0.7, C.cyan], ['PROTECTION CHECK', 0.1, 1.0, 0.7, C.magenta]], end: 1.8 });
        if (!I.fpu) F(who, { blocks: [['ADDRESS ADDER', 0, 1.1, 0.9, C.cyan], ['SEGMENT REGS', 0, 0.9, 0.6, C.cyan]],
          path: { pts: this.dieRoute(we, [this.bCtr(we, this.bIdx(we, 'ADDRESS ADDER')), this.bCtr(we, this.bIdx(we, 'BUS CONTROL')), adP]), p0: 0, p1: 0.9, col: C.cyan, hold: 0.2 }, end: 2 });
        if (kind !== 'halt') {
          const dp = this.dieRoute(we, read ? [adP, this.bCtr(we, this.bIdx(we, bc)), this.bCtr(we, this.bIdx(we, dst))] : [this.bCtr(we, this.bIdx(we, dst)), this.bCtr(we, this.bIdx(we, bc)), adP]);
          F(who, { blocks: [[bc, 0, 4, 0.9, I.fpu ? C.lavender : C.magenta], [dst, read ? 2.8 : 1, read ? 4 : 2, 0.9, C.gold]],
            path: { pts: dp, p0: read ? 2.6 : 1.1, p1: read ? 3.6 : 2.1, col: C.gold, hold: 0.25 },
            line: `${TYPE_NAME[kind] || kind} ${hexA(addr)}${kind === 'inta' ? '' : ' = ' + hex4(d16)}` });
        }
      }
      if (kind === 'fetch') F('fpu', { blocks: [['QUEUE TRACKER', 2.4, 4, 0.7, C.lavender]], end: 4.6 });
      // 8288 bus controller
      const bus = this.decaps.get('bus');
      if (this.isOpen(bus)) {
        const outP = this.padNear(bus, this.bCtr(bus, this.bIdx(bus, 'OUTPUT DRIVERS')), true);
        F('bus', { blocks: [['STATUS DECODER', 0, 1.2, 1, C.magenta], ['CONTROL SIGNAL GEN', 0.1, 1, 0.8, C.magenta]].concat(kind === 'halt' ? [] : [['COMMAND LOGIC', 0.8, 3.3, 1, C.magenta], ['OUTPUT DRIVERS', 1, 3.4, 1, C.magenta]]),
          path: { pts: this.dieRoute(bus, [this.padNear(bus, this.bCtr(bus, this.bIdx(bus, 'STATUS DECODER')), false), this.bCtr(bus, 0), this.bCtr(bus, 1), this.bCtr(bus, 3), outP]), p0: 0, p1: 1.6, col: C.magenta, hold: 0.3 },
          line: `${NM.status} ${st.toString(2).padStart(3, '0')} → ${kind === 'halt' ? 'no command' : CMD_NAME[cmd]}` });
      }
      // 8282 latches: each bit slice shows the latched address bit
      if (kind !== 'inta' && kind !== 'halt') {
        ['lat0', 'lat1', 'lat2'].forEach((k, j) => {
          const nb = j === 2 && !M286 ? 4 : 8, byte = (addr >> (8 * j)) & ((1 << nb) - 1);
          const bl = [[M286 ? 'LE OE CONTROL' : 'STB OE CONTROL', 0.2, 1.0, 1, C.magenta]];
          for (let b = 0; b < nb; b++) bl.push(['L' + b, 0.3 + b * 0.03, 3.8, (byte >> b) & 1 ? 1 : 0.14, C.cyan]);
          F(k, { blocks: bl, line: `latched ${hex2(byte)}h = ${bin(byte, j === 2 && !M286 ? 4 : 8)}` });
        });
      }
      // 8286 transceivers: the bit slices show the data byte and the direction
      for (const [k, on, byte] of [['xcv0', lo, d16 & 0xFF], ['xcv1', hi, (d16 >> 8) & 0xFF]]) {
        const e = this.decaps.get(k);
        if (!on || !this.isOpen(e) || kind === 'halt') continue;
        const bl = [[M286 ? 'DIR G CONTROL' : 'T OE CONTROL', 1.2, 3.5, 0.9, C.magenta]];
        for (let b = 0; b < 8; b++) bl.push(['T' + b, 1.4, 3.6, (byte >> b) & 1 ? 1 : 0.14, C.gold]);
        const A = this.padNear(e, [e.cw / 2, 0], false), B = this.padNear(e, [e.cw / 2, e.ch], true);
        F(k, { blocks: bl, path: { pts: this.dieRoute(e, read ? [B, [e.cw / 2, e.ch / 2], A] : [A, [e.cw / 2, e.ch / 2], B]), p0: read ? 2.2 : 1.3, p1: read ? 3.1 : 2.2, col: C.gold, hold: 0.25 },
          line: `DT/R ${read ? 'receive' : 'transmit'} · ${hex2(byte)}h = ${bin(byte, 8)}` });
      }
      // 74LS138: the selected Y output
      if (DEC_Y[dev] !== undefined && kind !== 'inta') {
        const e = this.decaps.get('dec');
        if (this.isOpen(e)) {
          const y = DEC_Y[dev], drv = this.layOf(e).blocks[this.bIdx(e, 'Y0-Y7 DRIVERS')];
          const mk = [drv.x + drv.w * y / 8, drv.y, drv.w / 8, drv.h];
          F('dec', { blocks: [['INPUT BUFFERS', 0.8, 1.4, 1, C.cyan], ['ENABLE', 0.9, 1.5, 0.8, C.magenta], ['3-TO-8 DECODER', 1, 2.2, 1, C.magenta], ['Y0-Y7 DRIVERS', 1.2, 3.3, 0.5, C.magenta]],
            marks: [[mk, 1.3, 3.4, C.magenta]],
            path: { pts: this.dieRoute(e, [this.padNear(e, this.bCtr(e, 0)), this.bCtr(e, 0), this.bCtr(e, 2), [mk[0] + mk[2] / 2, mk[1] + mk[3] / 2], this.padNear(e, [mk[0] + mk[2] / 2, mk[1] + mk[3]])]), p0: 0.9, p1: 1.9, col: C.magenta, hold: 0.3 },
            line: `A → Y${y} active (low) → ${dev.toUpperCase()}` });
        }
      }
      F('clk', { blocks: [['READY SYNC', 1, 3, 0.6, C.magenta]], end: 3.6 });
      // the target device
      const m = this.app.machine;
      if (dev === 'ram') {
        if (lo) this.dramFx('ramE', addr & ~1 | 0, m.mem[(I.width === 2 ? addr & ~1 : addr) & 0xFFFFF], read, ev, now, ms);
        if (hi) this.dramFx('ramO', addr | 1, m.mem[(addr | 1) & 0xFFFFF], read, ev, now, ms);
      } else if (dev === 'rom') {
        if (lo) this.romFx('romE', addr & ~1, m.mem[addr & ~1 & 0xFFFFF], ev, now, ms);
        if (hi) this.romFx('romO', addr | 1, m.mem[(addr | 1) & 0xFFFFF], ev, now, ms);
      } else if (dev === 'vram') {
        for (const g of this.vramChips(addr, read)) this.cardDramFx(g, read, ev, now, ms);
        if (VGA) F('vgac', { blocks: [['CPU INTERFACE', 1, 2.4, 1, C.phosphor], ['MEMORY CONTROLLER', 1.4, 3.6, 1, C.phosphor], [read ? 'GRAPHICS LATCHES' : 'ALU ROTATE', 1.8, 3.6, 0.9, C.goldHi]].concat(read ? [] : [['BIT MASK', 1.9, 3.6, 0.8, C.goldHi]]),
          path: { pts: this.dieRouteTo('vgac', ['CPU INTERFACE', read ? 'GRAPHICS LATCHES' : 'ALU ROTATE', 'MEMORY CONTROLLER']), p0: 1.1, p1: 2.6, col: C.phosphor, hold: 0.3 }, line: `video memory ${hexA(addr)}` });
      } else if (dev === 'crtc' || dev === 'cga') {
        this.ioFx('crtc', addr & 0xFFFF, d16 & 0xFF, read, false, ev, now, ms);
      } else if (dev === 'vga') {
        this.ioFx(DAC_PORT(addr & 0xFFFF) ? 'dac' : 'vgac', addr & 0xFFFF, d16 & 0xFF, read, false, ev, now, ms);
        if (DAC_PORT(addr & 0xFFFF)) F('vgac', { blocks: [['CPU INTERFACE', 1, 2.4, 0.8, C.phosphor], ['DAC INTERFACE', 1.4, 3.4, 1, C.phosphor]], end: 4 });
      } else if (dev === 'vrom') {
        this.romFx('vbios', addr, m.mem[addr & ADDR_MASK], ev, now, ms);
      } else if (dev === 'xram') {
        const g = this.xramChip(addr, I.width === 2 ? (I.lo ? 0 : 1) : (addr & 1));
        if (g) this.cardDramFx(g, read, ev, now, ms);
      } else if (dev === 'fdc' || IO_DEV[dev] || kind === 'inta') {
        this.ioFx(dev, addr & 0xFFFF, d16 & 0xFF, read, kind === 'inta', ev, now, ms);
      }
    }
    // One 4164 of a bank per data bit: chip k stores bit k. Its 16-bit address comes in two
    // halves on the same 8 pins: RAS latches the row (low 8 bits), CAS the column.
    dramCell(e, row, col, rb = RB, cb = rb) {
      const MSB = 1 << (rb - 1), CMSB = 1 << (cb - 1);
      const L = this.layOf(e), q = (row & MSB ? 2 : 0) + (col & CMSB ? 1 : 0), Q = L.blocks[q];
      const pr = Math.max(1.4, Q.h / 36) / 2, pc = pr * 1.6;
      const nr = Math.max(1, Math.floor(Q.h / pr)), nc = Math.max(1, Math.floor(Q.w / pc));
      const gr = Math.floor((row & (MSB - 1)) / MSB * nr), gc = Math.floor((col & (CMSB - 1)) / CMSB * nc);
      const cell = [Q.x + gc * pc, Q.y + gr * pr, pc, pr];
      return { q, Q, cell, pr, pc, rd: 4 + (row & MSB ? 1 : 0), sa: 6 + (col & CMSB ? 1 : 0), cd: 8,
        word: [Q.x, cell[1] + pr * 0.24, Q.w, pr * 0.26], bitl: [cell[0] + pc * 0.4, Q.y, pc * 0.2, Q.h] };
    }
    dramFx(bank, phys, byte, read, ev, now, ms) {
      const C = THEME, ca = (phys >> 1) & ((1 << (2 * RB)) - 1), row = ca & ((1 << RB) - 1), col = ca >> RB;
      for (let k = 0; k < 8; k++) {
        const key = bank + k, e = this.decaps.get(key);
        if (!this.isOpen(e)) continue;
        const bit = (byte >> k) & 1, D = this.dramCell(e, row, col);
        const cc = [D.cell[0] + D.pc / 2, D.cell[1] + D.pr / 2];
        const aPin = this.padNear(e, this.bCtr(e, D.rd)), dPin = this.padNear(e, this.bCtr(e, D.cd), true);
        const line = `row ${hexR(row)}h · col ${hexR(col)}h · bit ${bit} (D${k}) · ${read ? 'read' : 'write'}`;
        this.addFx(key, ev, now, ms, { blocks: [[D.rd, 0.9, 2.3, 1, C.cyan], [D.q, 1.4, 3.4, 0.28, C.gold], [D.cd, 1.8, 2.9, 1, C.cyan], [D.sa, 1.9, 3.4, 1, C.gold]],
          path: { pts: this.dieRoute(e, [aPin, this.bCtr(e, D.rd), [D.Q.x + (col & (1 << (RB - 1)) ? 0 : D.Q.w), cc[1]], cc]), p0: 0.8, p1: 1.7, col: C.cyan, hold: 0.25 },
          marks: [[D.word, 1.4, 3.5, '#ff9a86'], [D.bitl, 2.0, 3.5, '#b9d2ff']],
          cell: { rect: D.cell, bit, p0: 2.0, p1: 3.9, col: bit ? C.phosphor : '#7f9cff' }, line });
        const sa = this.bCtr(e, D.sa), cd = this.bCtr(e, D.cd);
        this.addFx(key, ev, now, ms, { blocks: [],
          path: { pts: this.dieRoute(e, read ? [cc, [cc[0], sa[1]], sa, cd, dPin] : [dPin, cd, sa, [cc[0], sa[1]], cc]), p0: read ? 2.3 : 1.6, p1: read ? 3.4 : 2.8, col: C.gold, hold: 0.25 } });
      }
    }
    // The DRAM chips of the cards that one video or extended-memory access reaches.
    // g = { key, row, col, rb, cb, bit, dq, what }
    vramChips(addr, read) {
      const m = this.app.machine, out = [];
      if (!VGA) {
        // CGA: two 16K x 4 chips; chip 0 holds the low nibble, chip 1 the high nibble
        const ca = (addr - 0xB8000) & 0x3FFF, byte = m.mem[addr & ADDR_MASK];
        for (let k = 0; k < 2; k++) out.push({ key: 'vram' + k, row: ca & 0xFF, col: ca >> 8, rb: 8, cb: 6, bit: (byte >> (4 * k)) & 0xF, bits: 4, dq: k ? 'D4–D7' : 'D0–D3', what: 'CGA video RAM' });
        return out;
      }
      // VGA: four planes of 64 KB, two 64K x 4 chips per plane
      const vg = m.vga;
      const ca = addr & 0xFFFF;
      let planes = 0xF;
      try { if (vg && vg.seq && !read) planes = vg.seq[2] & 0xF; if (vg && vg.gc && read) planes = 1 << (vg.gc[4] & 3); } catch (e) { /* no VGA core yet */ }
      for (let pl = 0; pl < 4; pl++) {
        if (!(planes & (1 << pl))) continue;
        let byte = m.mem[addr & ADDR_MASK];
        try { if (vg && vg.planes && vg.planes[pl]) byte = vg.planes[pl][ca]; } catch (e) { /* no planes */ }
        for (let k = 0; k < 2; k++) out.push({ key: 'vdram' + (pl * 2 + k), row: ca & 0xFF, col: ca >> 8, rb: 8, cb: 8, bit: (byte >> (4 * k)) & 0xF, bits: 4, dq: k ? 'D4–D7' : 'D0–D3', what: 'plane ' + pl });
      }
      return out;
    }
    xramChip(addr, odd) {
      const ca = ((addr - 0x100000) >> 1) & 0x3FFFF, byte = this.app.machine.mem[addr & ADDR_MASK];
      let k = 0;
      while (k < 4 && !((byte >> k) & 1)) k++;
      return { key: 'xram' + ((odd ? 5 : 0) + Math.min(k, 4)), row: ca & 0x1FF, col: ca >> 9, rb: 9, cb: 9, bit: (byte >> k) & 1, bits: 1, dq: 'D' + k, what: 'extended memory' };
    }
    // A route over the centres of named blocks of a chip.
    dieRouteTo(key, labels) {
      const e = this.decaps.get(key);
      if (!e) return [];
      return this.dieRoute(e, labels.map(l => this.bCtr(e, this.bIdx(e, l))));
    }
    cardDramFx(g, read, ev, now, ms) {
      const C = THEME, e = this.decaps.get(g.key);
      if (!this.isOpen(e)) return;
      const D = this.dramCell(e, g.row, g.col, g.rb, g.cb);
      const cc = [D.cell[0] + D.pc / 2, D.cell[1] + D.pr / 2];
      const sa = this.bCtr(e, D.sa), cd = this.bCtr(e, D.cd);
      const hx = v => (v > 0xFF ? hex(v, 3) : hex2(v));
      this.addFx(g.key, ev, now, ms, { blocks: [[D.rd, 0.9, 2.3, 1, C.cyan], [D.q, 1.4, 3.4, 0.28, C.phosphor], [D.cd, 1.8, 2.9, 1, C.cyan], [D.sa, 1.9, 3.4, 1, C.phosphor]],
        path: { pts: this.dieRoute(e, read ? [cc, [cc[0], sa[1]], sa, cd, this.padNear(e, cd, true)] : [this.padNear(e, cd, true), cd, sa, [cc[0], sa[1]], cc]), p0: read ? 2.2 : 1.5, p1: read ? 3.4 : 2.8, col: C.phosphor, hold: 0.25 },
        marks: [[D.word, 1.4, 3.5, '#ff9a86'], [D.bitl, 2.0, 3.5, '#b9d2ff']],
        cell: { rect: D.cell, bit: g.bit ? 1 : 0, p0: 2.0, p1: 3.9, col: g.bit ? C.phosphor : '#7f9cff' },
        line: `${g.what} · row ${hx(g.row)}h · col ${hx(g.col)}h · ${g.dq} = ${g.bits > 1 ? hex(g.bit, 1) + 'h' : g.bit}` });
    }
    romCell(e, phys) {
      const ca = (phys >> 1) & ((1 << (8 + CB)) - 1), row = (ca >> CB) & 0xFF, col = ca & ((1 << CB) - 1);
      const A = this.layOf(e).blocks[0];
      const pr = A.h / 256, cellW = A.w / (8 << CB);
      return { ca, row, col, A, word: [A.x, A.y + row * pr, A.w, Math.max(pr, 0.35)], bitl: [A.x + col * 8 * cellW, A.y, Math.max(cellW * 8, 0.5), A.h], pr, cellW };
    }
    romFx(key, phys, byte, ev, now, ms) {
      const C = THEME, e = this.decaps.get(key);
      if (!this.isOpen(e)) return;
      const R = this.romCell(e, phys);
      const xd = this.bCtr(e, 1), yg = this.bCtr(e, 3), ob = this.bCtr(e, 4);
      const hit = [R.bitl[0] + R.bitl[2] / 2, R.word[1] + R.word[3] / 2];
      this.addFx(key, ev, now, ms, { blocks: [[1, 0.9, 2.4, 1, C.cyan], [2, 1.2, 2.6, 1, C.cyan], [0, 1.5, 3.2, 0.25, C.gold], [3, 1.9, 3.2, 1, C.gold], [4, 2.2, 3.7, 1, C.gold]],
        marks: [[R.word, 1.4, 3.4, '#ff9a86'], [R.bitl, 1.8, 3.4, '#b9d2ff']],
        path: { pts: this.dieRoute(e, [this.padNear(e, xd), xd, [xd[0], hit[1]], hit, [hit[0], yg[1]], yg, ob, this.padNear(e, ob, true)]), p0: 0.9, p1: 3.3, col: C.gold, hold: 0.25 },
        line: `row ${hex2(R.row)}h · column ${hex2(R.col)}h · byte ${hex2(byte)}h` });
    }
    ioFx(dev, port, data, read, inta, ev, now, ms) {
      const C = THEME;
      const key = dev === 'fdc' ? 'fdc' : dev, e = this.decaps.get(key);
      if (!this.isOpen(e)) return;
      const cr = this.app.machine.crtc;
      const tgt = inta ? 'ISR' : ioBlock(dev, port, read, cr ? cr.index : 0);
      const ins = (IO_IN[dev] || []).filter(l => this.bIdx(e, l) >= 0);
      const ti = this.bIdx(e, tgt);
      const pts = ins.map(l => this.bCtr(e, this.bIdx(e, l)));
      if (ti >= 0) pts.push(this.bCtr(e, ti));
      if (!pts.length) pts.push([e.cw / 2, e.ch / 2]);
      const pin = this.padNear(e, pts[0]);
      const route = this.dieRoute(e, read ? pts.slice().reverse().concat([pin]) : [pin].concat(pts));
      const bl = ins.map((l, i) => [l, 1 + i * 0.2, 3.4, 1, C.magenta]);
      if (ti >= 0) bl.push([ti, 1.5, 3.8, 1, inta ? C.magenta : read ? C.gold : C.goldHi]);
      if (dev === 'pic' && inta) bl.push(['DATA BUS BUFFER', 2.2, 3.8, 1, C.gold]);
      if (dev === 'vgac' && tgt === 'ALU ROTATE') bl.push(['GRAPHICS LATCHES', 1.7, 3.6, 0.8, C.goldHi], ['BIT MASK', 1.7, 3.6, 0.8, C.goldHi]);
      this.addFx(key, ev, now, ms, { blocks: bl, path: { pts: route, p0: read ? 2.0 : 1.2, p1: read ? 3.4 : 2.8, col: read ? C.gold : C.goldHi, hold: 0.3 },
        line: inta ? `INTA: vector ${hex2(data)}h from the ISR` : `${read ? 'IN' : 'OUT'} port ${hex2(port)}h ${read ? '→' : '←'} ${hex2(data)}h · ${tgt || ''}` });
    }
    // Per frame: evaluate the items and the steady states, and set the overlay uniforms.
    updateFx(now, dt) {
      const F = this.fastLv || {}, m = this.app.machine;
      const tone = m.lastTone > 0 && this.app.mode === 'fast' && this.app.running;
      const amb = {
        clk: [['CRYSTAL OSC', 0.35, THEME.magenta], ['DIVIDE BY 3', this.clockTick(now) * 1.2, THEME.magenta], ['PCLK DIVIDE BY 2', this.clockTick(now) * 1.2, THEME.magenta], ['CLK DRIVERS', this.clockTick(now) * 1.3, THEME.magenta]],
        pit: [['COUNTER 0', 0.1 + 0.08 * Math.sin(now * 0.02), THEME.magenta]].concat(tone ? [['COUNTER 2', 0.55 + 0.25 * Math.sin(now * 0.05), THEME.magenta]] : []),
        cgrom: [['CELL ARRAY', 0.1 + 0.06 * Math.sin(now * 0.021), THEME.phosphor], ['OUTPUT BUFFERS', 0.12 + 0.06 * Math.sin(now * 0.033), THEME.phosphor]],
        vgac: [['CRTC', 0.16 + 0.08 * Math.sin(now * 0.017), THEME.phosphor], ['CLOCK SELECT', 0.22, THEME.magenta], ['DAC INTERFACE', 0.12 + 0.05 * Math.sin(now * 0.029), THEME.phosphor], ['MEMORY CONTROLLER', 0.08, THEME.phosphor]],
        dac: [['DAC RED', 0.14 + 0.08 * Math.sin(now * 0.031), '#ff6a6a'], ['DAC GREEN', 0.14 + 0.08 * Math.sin(now * 0.027), '#6aff9a'], ['DAC BLUE', 0.14 + 0.08 * Math.sin(now * 0.023), '#6aa8ff'], ['PIXEL PORT', 0.12, THEME.phosphor]],
        rtc: [['OSCILLATOR', 0.3, THEME.phosphor], ['DIVIDER CHAIN', 0.12 + 0.1 * Math.sin(now * 0.004), THEME.phosphor]],
        crtc: [['HORIZ TIMING', 0.18 + 0.1 * Math.sin(now * 0.03), THEME.phosphor], ['VERT TIMING', 0.14, THEME.phosphor], ['REFRESH ADDR', (F.vram || 0) * 0.8, THEME.phosphor]],
        fdc: [['SEQUENCER', (this.diskBusy || 0) * 0.9, THEME.cyan], ['DRIVE INTERFACE', (this.diskBusy || 0) * 0.8, THEME.cyan], ['DATA SEPARATOR IF', (this.diskBusy || 0) * (0.6 + 0.4 * Math.sin(now * 0.04)), THEME.cyan]],
      };
      if (this.fastOn) {
        const fa = F.all || 0;
        amb.cpu = [['BUS CONTROL', fa * 0.6, THEME.magenta], ['QUEUE', fa * 0.5, THEME.gold], ['DECODER', fa * 0.5, THEME.gold], ['MICROCODE ROM', fa * 0.45, THEME.lavender], ['ALU', fa * 0.35, THEME.cyan], ['REGISTERS', fa * 0.35, THEME.goldHi]];
        amb.bus = [['STATUS DECODER', fa * 0.5, THEME.magenta], ['COMMAND LOGIC', fa * 0.5, THEME.magenta], ['OUTPUT DRIVERS', fa * 0.45, THEME.magenta]];
        amb.fpu = [['REGISTER STACK', (F.fpu || 0) * 0.6, THEME.lavender], ['MANTISSA', (F.fpu || 0) * 0.5, THEME.lavender]];
        for (let k = 0; k < 8; k++) for (const b of ['ramE', 'ramO']) amb[b + k] = [['CELL ARRAY', (F.ram || 0) * 0.35, THEME.gold], ['SENSE AMPS', (F.ram || 0) * 0.5, THEME.gold], ['ROW DEC', (F.ram || 0) * 0.4, THEME.cyan]];
        amb.romE = amb.romO = [['CELL ARRAY', (F.rom || 0) * 0.35, THEME.gold], ['OUTPUT BUFFERS', (F.rom || 0) * 0.6, THEME.gold]];
        amb.pic = [['DATA BUS BUFFER', (F.pic || 0) * 0.6, THEME.magenta], ['IRR', (F.inta || 0) * 0.6, THEME.magenta], ['ISR', (F.inta || 0) * 0.6, THEME.magenta]];
        amb.dma = [['TIMING AND CONTROL', (F.dma || 0) * 0.6, THEME.magenta], ['CH2 ADDR COUNT', (this.diskBusy || 0) * 0.6, THEME.cyan]];
      }
      const keys = new Set([...this.fx.keys(), ...Object.keys(amb)]);
      const tNow = now % 1e6;
      for (const key of keys) {
        const e = this.decaps.get(key);
        if (!this.isOpen(e)) { this.fx.delete(key); if (e && e.fxMesh) e.fxMesh.visible = false; continue; }
        this.ensureFx(e);
        const u = e.fxU, act = u.uAct.value, cols = u.uCol.value;
        act.fill(0);
        let any = 0;
        const put = (i, v, c) => { if (i >= 0 && i < 16 && v > act[i]) { act[i] = v; cols[i].copy(c); } };
        for (const [lab, v, c] of amb[key] || []) if (v > 0.01) put(this.bIdx(e, lab), v, new T.Color(c));
        let path = null, pph = 0, cell = null, cph = 0;
        const marks = [];
        const L = this.fx.get(key) || [];
        for (let i = L.length - 1; i >= 0; i--) {
          const it = L[i], ph = this.phaseOf(it, now);
          if (ph > it.end) { L.splice(i, 1); continue; }
          if (ph < 0) continue;
          for (const [bi, p0, p1, lv, c] of it.blocks) put(bi, lv * smooth(p0, p0 + 0.2, ph) * (1 - smooth(p1, p1 + 0.5, ph)), c);
          if (it.path && ph >= it.path.p0 && !path) { path = it.path; pph = ph; }
          if (it.marks) for (const mk of it.marks) marks.push([mk, smooth(mk.p0, mk.p0 + 0.2, ph) * (1 - smooth(mk.p1, mk.p1 + 0.5, ph))]);
          if (it.cell && !cell) { cell = it.cell; cph = ph; }
        }
        if (!L.length) this.fx.delete(key);
        for (let i = 0; i < 16; i++) any = Math.max(any, act[i]);
        // the signal path
        if (path) {
          const uu = (pph - path.p0) / Math.max(0.05, path.p1 - path.p0);
          const fade = 1 - smooth(path.p1 + 0.3, path.p1 + 1.1, pph);
          const n = path.segs.length;
          u.uNS.value = n;
          for (let i = 0; i < n; i++) { u.uSeg.value[i].copy(path.segs[i]); u.uSegS.value[i] = path.cum[i]; }
          u.uPCol.value.copy(path.color);
          if (this.reduced) { u.uHead.value = 1e3; u.uPAmp.value = 0; u.uPHold.value = 0.8 * fade; }
          else { u.uHead.value = Math.min(uu, 1.2) * (path.len + u.uTail.value * 2); u.uPAmp.value = uu < 1 ? 1 : Math.max(0, 1 - (uu - 1) * 3); u.uPHold.value = (path.hold || 0.25) * fade; }
          any = Math.max(any, u.uPAmp.value + u.uPHold.value);
        } else { u.uNS.value = 0; u.uPAmp.value = 0; u.uPHold.value = 0; }
        for (let i = 0; i < 3; i++) {
          const mk = marks[i];
          u.uMarkA.value[i] = mk ? mk[1] : 0;
          if (mk) { u.uMark.value[i].copy(mk[0].r); u.uMarkC.value[i].copy(mk[0].c); any = Math.max(any, mk[1]); }
        }
        if (cell) {
          const a = smooth(cell.p0, cell.p0 + 0.2, cph) * (1 - smooth(cell.p1, cell.p1 + 0.6, cph));
          u.uCell.value.copy(cell.r); u.uCellC.value.copy(cell.c); u.uBit.value = cell.bit; u.uCellA.value = a;
          any = Math.max(any, a);
        } else u.uCellA.value = 0;
        u.uTime.value = tNow;
        e.fxMesh.visible = any > 0.004;
        if (e.fxMesh.visible) this.fxBusy = true;
      }
    }
    // Open a round window in a package (the runner uses it before it dives in).
    openWindow(e) {
      this.ensureDecap(e);
      // (open already, or opening: no second animation; the detail tiles stay)
      if (e.cov > 0.35 || e.win || (e.auto && e.auto.round)) return;
      const L = this.layOf(e);
      e.win = { rx: (L.dw / 2 + L.pm * 2.2) / e.cw * e.mask.width, ry: Math.min(e.ch * 0.5, (L.dh / 2 + L.pm * 2.2)) / e.ch * e.mask.height };
      if (this.reduced) { this.paintWindow(e, 1); e.cov = Math.max(e.cov, 0.4); e.dirty = true; return; }
      e.auto = { t0: performance.now(), dur: 650, round: true };
    }
    paintWindow(e, u) {
      const g = e.mask.getContext('2d'), mw = e.mask.width, mh = e.mask.height, w = e.win;
      g.save();
      g.translate(mw / 2, mh / 2);
      g.scale(w.rx / w.ry, 1);
      const R = w.ry * easeOut(u);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, R));
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.86, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, Math.max(1, R), 0, TAU); g.fill();
      g.restore();
    }
    // World position of a die point (base px) just above the die, and of a pin tip.
    dieW(e, pt, lift = 0.004) {
      e.mesh.updateWorldMatrix(true, false);
      return e.mesh.localToWorld(new T.Vector3((pt[0] / e.cw - 0.5) * e.d.L * 0.97, (0.5 - pt[1] / e.ch) * e.d.W * 0.94, lift));
    }
    pinW(e, pin) {
      e.grp.updateWorldMatrix(true, false);
      return e.grp.localToWorld(new T.Vector3(pin.lx, 0.2, (pin.bottom ? 1 : -1) * e.d.row / 2));
    }
    dieScale(e) { return this.layOf(e).dh / e.ch * e.d.W * 0.94; }

    // ---------- detail tiles: parts of a die drawn again at screen resolution ----------
    // A pool of tiles; each is a region of a die at a scale (base px -> tile px), on top of the die
    // texture (a finer tile over a coarser one). updateDetail adds the tile of the view when the
    // camera rests. Explain knows its shots ahead: xpPrefetch queues for each shot on a die a row of
    // tiles, from its region at full scale to the whole die, and the frame loop draws one queued
    // tile in each frame. So a zoom into a unit never shows a blurred die.
    updateDetail(rnow) {
      const D = this.detail || (this.detail = { key: '', t: 0, moveT: 0, cam: '' });
      this.syncTiles();
      // the queued tiles (Explain): strips of them in each frame, about 8 ms of drawing
      const t0 = performance.now();
      while (performance.now() - t0 < 8) {
        if (!this.tileJob) {
          const j = this.tileQ && this.tileQ.shift();
          if (!j) break;
          if (!j.e || !j.e.mesh || this.findTile(j.e, j.x0, j.y0, j.x1, j.y1, j.S, j.keep)) continue;
          this.tileJob = this.beginTile(j.e, j.x0, j.y0, j.x1, j.y1, j.S, !!j.e.win && j.e.cov <= 0.35);
          this.tileJob.keep = j.keep || 0;
        }
        if (this.stepTile(this.tileJob, t0 + 8)) { this.addTile(this.finishTile(this.tileJob), this.tileJob.keep); this.tileJob = null; }
      }
      const c = this.cam, vc = this.viewCam;
      let ck;
      if (vc) {
        // the runner camera: at rest when it moves less than a small part of its distance
        vc.updateMatrixWorld();
        const pos = new T.Vector3().setFromMatrixPosition(vc.matrixWorld), q = new T.Quaternion().setFromRotationMatrix(vc.matrixWorld);
        const dist = Math.max(0.005, vc.near * 50);
        if (!D.vp || D.vp.distanceTo(pos) > dist * 0.02 || D.vq.angleTo(q) > 0.01) { D.vp = pos; D.vq = q; D.vn = (D.vn || 0) + 1; }
        ck = 'v' + D.vn;
      }
      else {
        // very small moves (the end of a camera spring) do not count as a move
        const q = c.r * 0.003;
        ck = [Math.round(Math.log(c.r) * 300), Math.round(c.theta * 600), Math.round(c.phi * 600),
          Math.round(c.target.x / q), Math.round(c.target.y / q), Math.round(c.target.z / q)].join();
      }
      if (ck !== D.cam) { D.cam = ck; D.moveT = rnow; }
      if ((!vc && c.flight) || rnow - D.moveT < 70 || rnow - D.t < 60) return;   // wait until the camera rests
      D.t = rnow;
      const rc = this.renderer.domElement.getBoundingClientRect();
      if (!rc.width || !this.decaps.size) return;
      const e = this.decapAt(rc.left + rc.width * (this.viewCx || 0.5), rc.top + rc.height / 2);
      if (!this.isOpen(e) || e.auto) return;
      const reg = this.regionOnDie(e);
      if (!reg) return;
      const [x0, y0, x1, y1] = reg;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const need = Math.min(rc.width * dpr / (x1 - x0), rc.height * dpr / (y1 - y0));   // screen px per base px
      if (need < 1.2) return;
      const key = `${e.key}|${Math.round(x0)}|${Math.round(y0)}|${Math.round(x1)}|${Math.round(y1)}|${e.maskVer || 0}`;
      if (key === D.key) return;
      D.key = key;
      this.ensureTile(e, x0, y0, x1, y1, Math.min(need * 1.05, 96));
    }
    // The part of the die texture (base px) that a camera sees (the view camera by default), or null.
    regionOnDie(e, cam) {
      const m = e.mesh;
      m.updateWorldMatrix(true, false);
      const inv = new T.Matrix4().copy(m.matrixWorld).invert();
      const n = new T.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
      const plane = new T.Plane().setFromNormalAndCoplanarPoint(n, new T.Vector3().setFromMatrixPosition(m.matrixWorld));
      const W = e.d.L * 0.97, H = e.d.W * 0.94;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, hits = 0;
      const v2 = new T.Vector2(), hit = new T.Vector3();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        v2.set(sx, sy);
        this.raycaster.setFromCamera(v2, cam || this.viewCam || this.camera);
        if (!this.raycaster.ray.intersectPlane(plane, hit)) continue;
        hit.applyMatrix4(inv);
        const px = (hit.x / W + 0.5) * e.cw, py = (0.5 - hit.y / H) * e.ch;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        hits++;
      }
      if (hits < 4) return null;
      x0 = clamp(x0, 0, e.cw); x1 = clamp(x1, 0, e.cw); y0 = clamp(y0, 0, e.ch); y1 = clamp(y1, 0, e.ch);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return [x0, y0, x1, y1];
    }
    // A tile of the pool that covers this region at this scale, or null.
    findTile(e, x0, y0, x1, y1, S, keep) {
      const win = !!e.win && e.cov <= 0.35;
      for (const t of this.tiles || []) {
        if (t.e === e && t.win === win && (win || t.maskVer === (e.maskVer || 0)) && t.x0 <= x0 + 0.5 && t.y0 <= y0 + 0.5 && t.x1 >= x1 - 0.5 && t.y1 >= y1 - 0.5 && t.S >= S * 0.85) { t.used = Math.max(t.used, performance.now() + (keep || 0)); return t; }
      }
      return null;
    }
    // A tile of the pool that covers this region at this scale (else a new one, drawn now).
    ensureTile(e, x0, y0, x1, y1, S) {
      const t = this.findTile(e, x0, y0, x1, y1, S);
      if (t) return t;
      const j = this.beginTile(e, x0, y0, x1, y1, S, !!e.win && e.cov <= 0.35);
      this.stepTile(j, Infinity);
      return this.addTile(this.finishTile(j), 0);
    }
    // A new tile in the pool. keep (ms): how long it must stay (a tile of the step now stays until
    // its moment in the step); the pool drops the tile with the oldest use (or keep time) first.
    addTile(t, keep) {
      const T0 = this.tiles || (this.tiles = []), now = performance.now();
      t.used = now + (keep || 0);
      T0.push(t);
      while (T0.length > 20) {
        let k = 0;
        T0.forEach((q, i) => { if (q.used < T0[k].used) k = i; });
        this.dropTile(T0[k]);
        T0.splice(k, 1);
      }
      // the finer tiles over the coarser ones
      T0.slice().sort((p, q) => p.S - q.S).forEach((q, i) => { q.mesh.renderOrder = 5 + i * 0.01; q.mesh.position.z = 0.0002 + i * 0.00001; });
      this.dirty = true;
      return t;
    }
    // Draw a tile. win: the package has a round window (Explain, the trace): the tile uses the
    // shape of the open window (not the mask, which grows while the window opens), so it is right
    // before the window is open; it shows when the window is open.
    // A tile is drawn in horizontal strips (beginTile, stepTile until it is done, finishTile), so
    // a large tile can take some frames and no frame is long.
    beginTile(e, x0, y0, x1, y1, S, win) {
      S = Math.min(S, 96);
      let tw = Math.max(2, Math.round((x1 - x0) * S)), th = Math.max(2, Math.round((y1 - y0) * S));
      const cap = 3072;
      if (tw > cap || th > cap) { const k = cap / Math.max(tw, th); tw = Math.round(tw * k); th = Math.round(th * k); S *= k; }
      const c = canvas(tw, th);
      return { e, x0, y0, x1, y1, S, win, c, g: c.getContext('2d'), tw, th, y: 0, sh: Math.max(48, Math.ceil(th / 8)) };
    }
    // Draw strips of the tile until the time limit (performance.now()); true: the tile is complete.
    stepTile(j, until) {
      const { e, g, S, x0, y0, x1 } = j;
      while (j.y < j.th) {
        const a = performance.now(), y = j.y, h = Math.min(j.sh, j.th - y);
        g.save();
        g.beginPath(); g.rect(0, y, j.tw, h); g.clip();
        g.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
        drawInterior(g, e.cw, e.ch, e.d, e.part, S, [x0, y0 + y / S, x1, y0 + (y + h) / S], false);
        g.restore();
        j.y += h;
        // the next strip: about 6 ms of drawing
        const ms = performance.now() - a;
        if (ms > 0.5) j.sh = clamp(Math.round(h * 6 / ms), 16, 1024);
        if (performance.now() >= until) break;
      }
      return j.y >= j.th;
    }
    finishTile(j) {
      const { e, g, x0, y0, x1, y1, win, c, tw, th } = j, rw = x1 - x0, rh = y1 - y0;
      let S = j.S;
      g.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
      g.globalCompositeOperation = 'destination-in';
      const mk = e.mask, sx = mk.width / e.cw, sy = mk.height / e.ch;
      if (win) {
        // the open window: an ellipse (paintWindow at its end), in base px
        const rx = e.win.rx / sx, ry = e.win.ry / sy;
        g.translate(e.cw / 2, e.ch / 2);
        g.scale(rx / ry, 1);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, ry));
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.86, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(-e.cw * 4, -e.ch * 2, e.cw * 8, e.ch * 4);
      } else {
        // show it only where the package is open (the mask)
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(mk, x0 * sx, y0 * sy, rw * sx, rh * sy, 0, 0, tw, th);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      const tex = colorTex(c, this.aniso);
      const mat = new T.MeshPhysicalMaterial({
        transparent: true, depthWrite: false, emissive: '#ffffff', emissiveIntensity: 0.12,
        roughness: 0.34, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.22, envMapIntensity: 0.6,
        iridescence: 0.45, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 520],
        polygonOffset: true, polygonOffsetFactor: -8, map: tex, emissiveMap: tex,
      });
      const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
      const W = e.d.L * 0.97, H = e.d.W * 0.94;
      mesh.position.set(((x0 + rw / 2) / e.cw - 0.5) * W, (0.5 - (y0 + rh / 2) / e.ch) * H, 0.0002);
      mesh.scale.set(rw / e.cw * W, rh / e.ch * H, 1);
      mesh.renderOrder = 5;
      mesh.visible = false;
      e.mesh.add(mesh);
      return { e, x0, y0, x1, y1, S, win, maskVer: e.maskVer || 0, mesh, tex, used: 0 };
    }
    dropTile(t) {
      if (t.mesh.parent) t.mesh.parent.remove(t.mesh);
      t.mesh.geometry.dispose(); t.mesh.material.dispose(); t.tex.dispose();
      this.dirty = true;
    }
    // Each frame: a tile shows while its die is open (and its window, or its mask, is the same).
    syncTiles() {
      for (const t of this.tiles || []) {
        const e = t.e, ok = this.isOpen(e) && !e.auto && (t.win ? !!e.win && e.cov <= 0.35 : t.maskVer === (e.maskVer || 0));
        if (t.mesh.visible !== ok) { t.mesh.visible = ok; this.dirty = true; }
        if (ok) t.mesh.material.emissiveIntensity = e.mat.emissiveIntensity;
      }
    }
    hideDetail() {
      for (const t of this.tiles || []) if (t.mesh.visible) { t.mesh.visible = false; this.dirty = true; }
      if (this.detail) this.detail.key = '';
    }
    // Explain: queue the tiles of a step (the step now, or the next one) before the camera gets
    // there. The camera path of the step is known (its shots, and the zoom path between two shots:
    // xpCamAt), so the tiles follow it: for each view on the path (each shot, and points of each
    // move to it) the region of the die that it sees, at the scale that it needs. A tile is a little
    // larger than its view, so the views near it use it too.
    xpPrefetch(s, ms, soon) {
      if (!this.xp || !this.xp.shots || !s) return;
      let X;
      try { X = this.xpPlan(s, ms); } catch (err) { return; }
      const J = this.trJourney(s), rc = this.renderer.domElement.getBoundingClientRect();
      if (!rc.width || !X.scenes.length) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2), dies = [];
      for (const g of J.segs) if (g.dive && !dies.includes(g.dive.e)) dies.push(g.dive.e);
      if (!dies.length) return;
      // the views: the camera before the step (now, or the end of the step now), then each shot
      const c = this.cam, last = this.tr && this.tr.shots && this.tr.shots.length ? this.tr.shots[this.tr.shots.length - 1].shot : null;
      let A = soon || !last ? { tgt: c.target.clone(), r: c.r, th: c.theta, phi: c.phi, up: this.camUp ? this.camUp.clone() : null } : last;
      const views = [];
      X.scenes.forEach((S, k) => {
        const B = S.shot;
        if (!B || !B.tgt) return;
        for (const u of [0.2, 0.4, 0.6, 0.8]) views.push({ st: this.xpCamAt(A, B, u), t: S.ts - (1 - u) * (S.blend || 0), k });
        views.push({ st: B, t: S.ts, k });
        A = B;
      });
      const jobs = [];
      for (const v of views) {
        const cam = this.shotCam(v.st);
        // the die of the view: the nearest die that the ray through the middle of the view meets
        let hit = null;
        for (const e of dies) { const h = this.centerOnDie(e, cam); if (h && (!hit || h.d < hit.d)) hit = h; }
        if (hit) {
          const e = hit.e, reg = this.regionOnDie(e, cam);
          if (!reg) continue;
          const cx = hit.x, cy = hit.y;
          const need = Math.min(rc.width * dpr / (reg[2] - reg[0]), rc.height * dpr / (reg[3] - reg[1]));
          if (need < 1.2) continue;
          // the tile: the scale in steps of 1.25, the region 1.5 times the view of that scale, on a
          // grid of a quarter of the view: the views near each other on the path get the same tile
          const St = Math.min(96, Math.pow(1.25, Math.ceil(Math.log(need * 1.02) / Math.log(1.25))));
          const vw = rc.width * dpr / St, vh = rc.height * dpr / St, gx = vw / 4, gy = vh / 4;
          const j = { e, x0: clamp(Math.floor((cx - vw * 0.675) / gx) * gx, 0, e.cw), y0: clamp(Math.floor((cy - vh * 0.675) / gy) * gy, 0, e.ch),
            x1: clamp(Math.ceil((cx + vw * 0.675) / gx) * gx, 0, e.cw), y1: clamp(Math.ceil((cy + vh * 0.675) / gy) * gy, 0, e.ch), S: St, t: v.t,
            keep: soon ? Math.max(0, v.t) + (X.lead || 1500) + 6000 : 500 };
          // (a job that an earlier one covers is not needed)
          if (!jobs.some(q => q.e === e && q.x0 <= j.x0 + 0.5 && q.y0 <= j.y0 + 0.5 && q.x1 >= j.x1 - 0.5 && q.y1 >= j.y1 - 0.5 && q.S >= j.S * 0.85)) jobs.push(j);
        }
      }
      jobs.sort((p, q) => p.t - q.t);
      this.tileQ = soon ? jobs.concat(this.tileQ || []) : (this.tileQ || []).concat(jobs);
      if (this.tileQ.length > 80) this.tileQ.length = 80;
    }
    // The point of a die (base px) where the ray through the middle of the view of cam meets it, and
    // its distance; null when the ray does not meet the die itself.
    centerOnDie(e, cam) {
      const m = e.mesh;
      if (!m) return null;
      m.updateWorldMatrix(true, false);
      const n = new T.Vector3(0, 0, 1).transformDirection(m.matrixWorld), o = new T.Vector3().setFromMatrixPosition(m.matrixWorld);
      this.raycaster.setFromCamera(new T.Vector2(0, 0), cam);
      const hit = new T.Vector3();
      if (!this.raycaster.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(n, o), hit)) return null;
      const d = hit.distanceTo(this.raycaster.ray.origin);
      hit.applyMatrix4(new T.Matrix4().copy(m.matrixWorld).invert());
      const W = e.d.L * 0.97, H = e.d.W * 0.94, x = (hit.x / W + 0.5) * e.cw, y = (0.5 - hit.y / H) * e.ch;
      return x >= 0 && x <= e.cw && y >= 0 && y <= e.ch ? { e, x, y, d } : null;
    }
    // The camera of Explain between the shots A and B at u (0..1): the state of xpCamera.
    xpCamAt(A, B, u) {
      const sm = u * u * u * (u * (6 * u - 15) + 10);
      let th = B.th;
      while (th - A.th > Math.PI) th -= TAU;
      while (th - A.th < -Math.PI) th += TAU;
      const D = A.tgt.distanceTo(B.tgt), KW = 2 * Math.tan(this.camera.fov * Math.PI / 360) * (this.camera.aspect || 1.6);
      const q = zoomPath([0, 0, KW * A.r], [D, 0, KW * B.r]).at(sm);
      let r = q[2] / KW;
      if (!(r > 0) || !isFinite(r)) r = Math.exp(Math.log(A.r) + (Math.log(B.r) - Math.log(A.r)) * sm);
      const Y = new T.Vector3(0, 1, 0), up = (A.up || Y).clone().lerp(B.up || Y, sm);
      return { tgt: A.tgt.clone().lerp(B.tgt, D > 1e-9 ? clamp(q[0] / D, 0, 1) : sm), r, th: A.th + (th - A.th) * sm, phi: A.phi + (B.phi - A.phi) * sm, up: up.lengthSq() > 1e-9 ? up.normalize() : null };
    }
    // The decap entry of the package top under a screen point, or null.
    decapAt(cx, cy) {
      const rc = this.renderer.domElement.getBoundingClientRect();
      if (!rc.width) return null;
      this.ptr.set((cx - rc.left) / rc.width * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ptr, this.viewCam || this.camera);
      const hit = this.raycaster.intersectObjects(this.decapTargets, false)[0];
      if (!hit) return null;
      const ud = hit.object.userData;
      return this.decaps.get(ud.decap || (ud.decapBank ? ud.decapBank + hit.instanceId : '')) || null;
    }
    // Look straight down at a decapped die, with the package length across the screen.
    zoomToDie(e) {
      const d = e.d, target = new T.Vector3();
      e.mesh.getWorldPosition(target);
      const q = new T.Quaternion();
      e.grp.getWorldQuaternion(q);
      const v = new T.Vector3(1, 0, 0).applyQuaternion(q), nrm = new T.Vector3(0, 1, 0).applyQuaternion(q);
      const face = nrm.y < 0.7;            // a chip on a vertical card: look at the card face
      let th = face ? Math.atan2(nrm.x, nrm.z) : Math.atan2(-v.z, v.x);
      while (th - this.cam.theta > Math.PI) th -= 2 * Math.PI;
      while (th - this.cam.theta < -Math.PI) th += 2 * Math.PI;
      const asp = this.camera.aspect || 1.6, k = 2 * Math.tan(this.camera.fov * Math.PI / 360) * 0.92;
      const r = clamp(Math.max(d.L * 0.97 / (k * asp), d.W * 0.94 / k), 0.35, 90);
      this.cam.preset = null;
      for (const kk in this.presetBtns) this.presetBtns[kk].setAttribute('aria-pressed', 'false');
      this.cam.fit = false;
      this.userT = performance.now();
      this.flyTo(target, th, face ? clamp(Math.acos(clamp(nrm.y, -1, 1)), 0.2, 1.55) : 0.16, r);
      // a die on a card stands up: turn the camera so its text is upright
      this.dieUpGoal = face && e.mesh ? this.dieUp(e) : null;
      this.setFocus(e.grp, (INFO[e.glowId] ? INFO[e.glowId][0] : e.part) + ' die');
    }
    // Open the package of a chip and look down at its die; with a block label (for example
    // 'ALU'), move closer to that block. key: a decap key ('cpu', 'fpu', 'pic', 'ramE3', ...)
    // or a glow id. Returns false when the chip has no die here. Used by the Die tab.
    focusChip(key, block) {
      if (!this.ok) return false;
      const e = this.decaps.get(key) || (this.decapByGlow[key] || [])[0];
      if (!e) { this.focusOn(key); return false; }
      this.openWindow(e);
      this.zoomToDie(e);
      if (block) {
        const L = this.layOf(e), want = String(block).toUpperCase();
        let bi = this.bIdx(e, want);
        if (bi < 0) bi = L.blocks.findIndex(b => b.label && (b.label.toUpperCase().includes(want) || want.includes(b.label.toUpperCase())));
        if (bi >= 0) {
          const b = L.blocks[bi], p = this.dieW(e, this.bCtr(e, bi));
          const span = Math.max(b.w / e.cw * e.d.L * 0.97, b.h / e.ch * e.d.W * 0.94);   // block size in world units
          this.cam.g.target.copy(p);
          this.cam.g.r = clamp(span * 2.4, 0.1, this.cam.g.r);
          if (this.cam.flight) this.cam.flight.dur = 1500;
        }
      }
      return true;
    }
    // Scratch at a screen point. It returns true when the pointer is on a package top.
    scratchAt(cx, cy) {
      const rc = this.renderer.domElement.getBoundingClientRect();
      if (!rc.width) return false;
      this.ptr.set((cx - rc.left) / rc.width * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ptr, this.camera);
      const hit = this.raycaster.intersectObjects(this.decapTargets, false)[0];
      if (!hit || !hit.face || hit.face.normal.y < 0.6) { this.scr.last = null; return false; }
      const ud = hit.object.userData;
      const e = this.decaps.get(ud.decap || (ud.decapBank ? ud.decapBank + hit.instanceId : ''));
      if (!e) return false;
      this.ensureDecap(e);
      const lp = e.grp.worldToLocal(hit.point.clone());
      const last = this.scr.last;
      if (last && last.e === e) {
        const dist = Math.hypot(lp.x - last.x, lp.z - last.z), n = Math.max(1, Math.ceil(dist / 0.08));
        for (let i = 1; i <= n; i++) this.paintAt(e, lerp(last.x, lp.x, i / n), lerp(last.z, lp.z, i / n), 0.8);
      } else this.paintAt(e, lp.x, lp.z, 1);
      this.scr.last = { e, x: lp.x, z: lp.z };
      this.spawnDust(hit.point);
      this.dirty = true;
      return true;
    }
    setTool(k) {
      this.tool = k;
      for (const t in this.toolBtns) this.toolBtns[t].setAttribute('aria-pressed', t === k ? 'true' : 'false');
      this.wrap.classList.toggle('bv-scratch', k === 'scratch');
      this.hint.classList.remove('bv-gone');
      this.hint.textContent = k === 'scratch'
        ? 'Drag over a chip to scratch the package open · right-drag or Shift to pan · scroll to zoom'
        : 'Drag to move · right-drag or Shift to turn · scroll to zoom · double-click a chip to focus';
      if (k === 'scratch') this.setHover(null);
    }
    showPop(id, cx, cy) {
      const hr = this.root.getBoundingClientRect();
      this.pop.textContent = `Open the ${id === 'fpu' ? '8087' : '8086'} in the Die tab`;
      this.pop.hidden = false;
      const x = clamp(cx - hr.left + 12, 8, hr.width - this.pop.offsetWidth - 8), y = clamp(cy - hr.top + 12, 8, hr.height - 90);
      this.pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      this.pop.focus({ preventScroll: true });
      clearTimeout(this.popT);
      this.popT = setTimeout(() => { this.pop.hidden = true; }, 8000);
    }
    // Move the renderer canvas into the runner view (one WebGL context for both tabs).
    attachTo(el) {
      const c = this.renderer.domElement;
      if (c.parentNode !== el) el.appendChild(c);
      this.setHover(null);
      this.w = 0;
    }

    // ---------- shared route helpers (board and runner) ----------
    // The points of a chain of trace bundles, as one polyline on the board plane.
    chainPts(id, trim, rev) {
      const ch = this.chains[id];
      if (!ch) return [];
      let pts = [];
      ch.segs.forEach((sg, k) => {
        if (!sg.r.path.length) return;
        let p = sg.r.path.map(a => a.slice());
        if (k > 0 && pts.length > 1) {
          const S = cumLen(pts), a = project(pts, S, p[0]), b = project(sg.r.path, sg.r.S, pts[pts.length - 1]);
          if (a.d <= b.d) pts = cutAt(pts, S, a.s); else p = cutFrom(sg.r.path, sg.r.S, b.s);
        }
        pts = pts.concat(p);
      });
      if (trim && pts.length > 1) { const S = cumLen(pts), a = project(pts, S, trim); pts = cutAt(pts, S, a.s); }
      if (rev) pts.reverse();
      return pts;
    }
    // Where a device is: its name, its address and data chains, its chip select, and the
    // point on a card for the devices in the slots.
    devTarget(dev, lo, port) {
      const C = CARD, D = DCARD;
      const card = (lx, lz) => new T.Vector3(C.x + lx, 0.25 + C.h / 2 - lz, C.z + 0.5);
      const cp = id => { const q = this.chipPos[id]; return q ? q.clone() : null; };
      switch (dev) {
        case 'ram': return { name: lo ? 'RAM bank even' : 'RAM bank odd', xz: [-7.9, lo ? 5.6 : 9.0], cs: 'CS_ram', a: 'A_ram', d: lo ? 'D_ramE' : 'D_ramO' };
        case 'xram': return { name: DEV_NAME.xram, a: 'A_slot', d: 'D_slot', card: cp('xram0') || new T.Vector3(XCARD.x - 3.5, 0.25 + XCARD.h / 2 + 0.75, XCARD.z + 0.5) };
        case 'vga': return { name: DEV_NAME.vga, a: 'A_slot', d: 'D_slot', card: cp(DAC_PORT(port || 0) ? 'dac' : 'vgac') };
        case 'vrom': return { name: DEV_NAME.vrom, a: 'A_slot', d: 'D_slot', card: cp('vbios') };
        case 'fpu': return { name: DEV_NAME.fpu, xz: DEV_XZ.fpu, a: null, cs: null, d: null };
        case 'rom': return { name: M286 ? (lo ? 'ROM 27128 even' : 'ROM 27128 odd') : (lo ? 'ROM 2764 even' : 'ROM 2764 odd'), xz: [5.5, lo ? 5.6 : 9.0], cs: 'CS_rom', a: 'A_rom', d: lo ? 'D_romE' : 'D_romO' };
        case 'vram': return { name: VGA ? 'VGA video memory' : DEV_NAME.vram, a: 'A_slot', d: 'D_slot', card: cp(VGA ? 'vgac' : 'vram0') || card(-2.6, -0.35) };
        case 'crtc': case 'cga': return { name: DEV_NAME[dev], a: 'A_slot', d: 'D_slot', card: cp('crtc') || card(1.7, -0.5) };
        case 'fdc': return { name: DEV_NAME.fdc, a: 'A_slot', d: 'D_slot', card: new T.Vector3(D.x + 3.4, 0.25 + D.h + 0.45, D.z) };
        case 'sb': return { name: DEV_NAME.sb, a: 'A_slot', d: 'D_slot', card: cp('sbdsp') };
        case 'hdc': return { name: DEV_NAME.hdc, a: 'A_slot', d: 'D_slot', card: cp('hdc') };
        case 'opl': return { name: DEV_NAME.opl, a: 'A_slot', d: 'D_slot', card: cp('opl') };
        case 'none': return { name: DEV_NAME.none, a: 'A_ram', d: null };
        default: return { name: DEV_NAME[dev] || dev, xz: DEV_XZ[dev], cs: 'CS_' + dev, a: 'A_io', d: 'D_io' };
      }
    }

    // ---------- trace mode ----------
    // The steps of the trace story play as one continuous flow. A signal line grows from
    // its source at a steady speed, and a token rides on its front. The lines of a bus
    // cycle stay lit while the cycle lasts (the address is still on the bus when the
    // command comes), then they fade out slowly. The camera moves once per bus cycle.
    buildTrace() {
      this.trG = new T.Group();
      this.scene.add(this.trG);
      this.flows = [];
      this.trOrbs = [];
      this.trLayer = htmlEl('div', { class: 'bv-tr', 'aria-hidden': 'true' }, this.root);
      this.trTok = htmlEl('div', { class: 'bv-tok' }, this.trLayer);
      this.trTokTag = htmlEl('i', null, this.trTok);
      this.trTokVal = htmlEl('b', null, this.trTok);
      this.trTokRoute = htmlEl('span', { class: 'bv-tok-route' }, this.trTok);
      this.trTokNow = htmlEl('span', { class: 'bv-tok-now' }, this.trTok);
      this.trDot = htmlEl('div', { class: 'bv-dot' }, this.trLayer);
      this.trLabs = [];
      this.trHeld = new Set();
      this.trCV = new T.Vector3(); this.trRV = new T.Vector3();
      this.tr = null;
    }
    trColor(c) { return { addr: THEME.cyan, data: THEME.gold, ctrl: THEME.magenta, fpu: THEME.lavender, eu: THEME.phosphor }[c] || THEME.gold; }
    // The glow ids of the chips that answer a bus cycle.
    trTargets(I) {
      const d = I.dev;
      if (d === 'ram') return [I.lo && 'ramE', I.hi && 'ramO'].filter(Boolean);
      if (d === 'rom') return [I.lo && 'romE', I.hi && 'romO'].filter(Boolean);
      if (d === 'vram') return VGA ? ['vmem', 'vga'] : ['vram0', 'vram1'];
      if (d === 'vga') return [DAC_PORT(I.addr & 0xFFFF) ? 'dac' : 'vga'];
      if (d === 'vrom') return ['vbios'];
      if (d === 'crtc' || d === 'cga') return ['crtc'];
      if (d === 'none') return [];
      return this.glows[d] ? [d] : [];
    }
    trPos(id) {
      const g = this.glows[id];
      if (g && g.pos && g.pos.lengthSq() > 0) return g.pos.clone();
      const q = this.chipPos[id];
      if (q) return q.clone();
      const xz = DEV_XZ[id];
      return xz ? new T.Vector3(xz[0], 0.3, xz[1]) : null;
    }
    // An arc from a to b (for the jumps up into the cards and between routes).
    trHop(a, b, h) {
      const out = [], hh = h === undefined ? clamp(0.3 + a.distanceTo(b) * 0.08, 0.3, 2) : h;
      for (let i = 1; i <= 20; i++) {
        const t = i / 20, p = a.clone().lerp(b, t);
        p.y += Math.sin(Math.PI * t) * hh;
        out.push(p);
      }
      return out;
    }
    // Join polylines into one path; a gap becomes a small arc.
    trJoin(parts) {
      let out = [];
      for (const p of parts) {
        if (!p || !p.length) continue;
        if (out.length) {
          const last = out[out.length - 1];
          if (last.distanceTo(p[0]) > 0.2) out = out.concat(this.trHop(last, p[0]));
        }
        out = out.concat(p);
      }
      return out;
    }
    // The picture of one step: token legs, extra lines, and the chips that take part.
    trSpec(s) {
      if (s._v) return s._v;
      const Y = 0.07;
      const tr = pts => pts.map(p => new T.Vector3(p[0], Y, p[1]));
      const route = id => (this.routes[id] ? tr(this.routes[id].path) : []);
      const v = { legs: [], extra: [], from: [], mid: [], to: [], labels: [], at: null, col: this.trColor(s.token.col) };
      const who = s.I && s.I.fpu ? 'fpu' : 'cpu';
      if (s.kind === 'inside') {
        v.at = this.trPos(s.unit) || new T.Vector3();
        v.to = [s.unit];
        return (s._v = v);
      }
      if (s.kind === 'sound') {
        const id = s.e && s.e.k === 'opl' ? 'opl' : 'sbdsp';
        v.at = this.trPos(id) || new T.Vector3();
        v.to = [id];
        return (s._v = v);
      }
      if (s.kind === 'page' || s.kind === 'cache' || s.kind === 'btb') {
        v.at = this.trPos('cpu') || new T.Vector3();
        v.to = ['cpu'];
        return (s._v = v);
      }
      if (s.kind === 'fdc' || s.kind === 'dma') {
        // the floppy controller on its card, or the DMA controller on the board
        const id = s.kind === 'fdc' ? 'fdc' : 'dma';
        v.at = this.trPos(id) || new T.Vector3();
        v.to = [id];
        if (s.kind === 'dma') v.mid = ['fdc'];
        return (s._v = v);
      }
      if (s.kind === 'irq') {
        v.legs.push({ pts: route('INTR'), tok: s.token });
        v.from = [M286 && s.e && s.e.vec >= 0x70 ? 'pic2' : 'pic']; v.mid = M286 && s.e && s.e.vec >= 0x70 ? ['pic'] : [];
        v.to = ['cpu'];
        v.labels.push({ id: 'pic', text: `8259A · INTR, vector ${s.token.val}`, cls: 'tl-ctrl' });
        return (s._v = v);
      }
      const I = s.I, tg = this.devTarget(I.dev, I.lo, I.addr & 0xFFFF);
      const tgs = this.trTargets(I);
      const tpos = tg.card ? tg.card.clone() : (tgs.length ? this.trPos(tgs[0]) : null);
      const name = Story.devName(I);
      const Laddr = () => tr(this.chainPts(I.fpu ? 'L_addr_fpu' : 'L_addr_cpu'));
      const Ldata = rev => tr(this.chainPts(I.dev === 'fpu' ? 'L_fpu' : I.fpu ? 'L_data_fpu' : 'L_data_cpu', null, rev));
      const Achain = () => (tg.a ? tr(this.chainPts(tg.a, tg.xz || null)) : []);
      const Dchain = (rev, t2) => { const x = t2 || tg; return x.d ? tr(this.chainPts(x.d, x.xz || null, rev)) : []; };
      const toCard = pts => (tg.card && pts.length ? pts.concat(this.trHop(pts[pts.length - 1], tg.card, 0.6)) : pts);
      const fromCard = pts => (tg.card && pts.length ? this.trHop(tg.card, pts[0], 0.6).concat(pts) : pts);
      const other = I.lo && I.hi && (I.dev === 'ram' || I.dev === 'rom') ? this.devTarget(I.dev, false, 0) : null;
      const xcv = I.dev === 'fpu' ? [] : [I.lo && 'xcv0', I.hi && 'xcv1'].filter(Boolean);
      if (M286 && IO_DEV[I.dev] && I.dev !== 'fpu') xcv.push('xdb');
      const val = s.token.val;
      const addrLeg = () => ({ pts: toCard(this.trJoin([Laddr(), Achain()])), tok: s.phase === 'all' ? { tag: I.io ? 'PORT' : 'ADDR', val: hexA(I.addr) + 'h', col: 'addr' } : s.token });
      const dataRead = tok => ({ pts: this.trJoin([fromCard(Dchain(true)), Ldata(true)]), tok });
      const cmdRoute = tg.card ? 'CMD_SLOT' : (I.io || I.kind === 'inta') ? 'CMD_IO' : 'CMD_MEM';
      const cmdPts = () => { const p = this.trJoin([route('S02'), route(cmdRoute)]); return tg.card ? toCard(p) : p; };
      // the board parts of the journey (the dies go between them)
      v.bp = {
        addr: toCard(this.trJoin([Laddr(), Achain()])), s02: route('S02'), cmd: tg.card ? toCard(route(cmdRoute)) : route(cmdRoute),
        dataR: this.trJoin([fromCard(Dchain(true)), Ldata(true)]), dataW: toCard(this.trJoin([Ldata(false), Dchain(false)])),
      };
      if (s.phase === 'addr') {
        v.legs.push(addrLeg());
        v.from = [who]; v.mid = ['lat0', 'lat1', 'lat2']; v.to = tgs;
        v.labels.push({ id: 'lat1', text: `${NM.lat} latches · hold ${hexA(I.addr)}h`, cls: 'tl-addr' });
        if (tpos) v.labels.push({ at: tpos, text: `${name} · address in`, cls: 'tl-addr' });
      } else if (s.phase === 'cmd') {
        if (I.kind === 'halt') { v.at = this.trPos('bus'); v.to = ['bus']; v.labels.push({ id: 'bus', text: `${NM.bus} · status HALT`, cls: 'tl-ctrl' }); return (s._v = v); }
        v.legs.push({ pts: cmdPts(), tok: s.token });
        if (tg.cs && this.routes[tg.cs] && I.kind !== 'inta') {
          if (this.decaps.has('dec')) {
            // the token goes through the decoder on the chip-select line; the command line glows too
            v.dec = { cs: route(tg.cs), pal: M286 && (I.dev === 'ram' || I.dev === 'rom') && this.decaps.has('pal') };
            v.extra.push(v.bp.cmd);
          } else v.extra.push(route(tg.cs));
        }
        v.from = [who]; v.mid = ['bus'].concat(tg.cs && I.kind !== 'inta' ? ['dec'] : []); v.to = tgs;
        v.labels.push({ id: 'bus', text: `${NM.bus} · ${s.token.tag}`, cls: 'tl-ctrl' });
        if (tg.cs && I.kind !== 'inta') v.labels.push({ id: 'dec', text: `decoder · selects ${DEV_SEL[I.dev] || name}`, cls: 'tl-ctrl' });
      } else if (s.phase === 'data') {
        if (I.read) {
          v.legs.push(dataRead(s.token));
          if (other) v.extra.push(Dchain(true, other));
          v.from = tgs; v.mid = xcv; v.to = [who];
          if (tpos) v.labels.push({ at: tpos, text: `${name} · sends ${val}`, cls: 'tl-data' });
        } else {
          v.legs.push({ pts: toCard(this.trJoin([Ldata(false), Dchain(false)])), tok: s.token });
          if (other) v.extra.push(Dchain(false, other));
          v.from = [who]; v.mid = xcv; v.to = tgs;
          if (tpos) v.labels.push({ at: tpos, text: `${name} · keeps ${val}`, cls: 'tl-data' });
        }
      } else {
        // a short prefetch: the address goes out, the code comes back
        v.legs.push(addrLeg());
        v.legs.push(dataRead({ tag: 'CODE', val, col: 'data' }));
        v.extra.push(cmdPts());
        if (tg.cs && this.routes[tg.cs]) v.extra.push(route(tg.cs));
        if (other) v.extra.push(Dchain(true, other));
        v.from = [who]; v.mid = ['lat0', 'lat1', 'lat2', 'bus', 'dec'].concat(xcv); v.to = tgs;
        if (tpos) v.labels.push({ at: tpos, text: `${name} · sends ${val}`, cls: 'tl-data' });
      }
      return (s._v = v);
    }
    // Even points along the token path, so the lit part grows at a constant speed.
    trResample(pts, step) {
      if (pts.length < 2) return pts.slice();
      const out = [pts[0].clone()];
      let carry = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = a.distanceTo(b);
        let s = step - carry;
        while (s < L) { out.push(a.clone().lerp(b, s / L)); s += step; }
        carry = L - (s - step);
      }
      out.push(pts[pts.length - 1].clone());
      return out;
    }
    // A ribbon along a path, drawn by the flow shader: lit up to uHead, bright at the front.
    flowMesh(pts, hw) {
      const n = pts.length;
      const pos = [], aS = [], aV = [], idx = [];
      let s = 0, lx = 0, lz = 1;
      for (let i = 0; i < n; i++) {
        if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let nx = -(b.z - a.z), nz = b.x - a.x;
        const l = Math.hypot(nx, nz);
        if (l > 1e-6) { nx /= l; nz /= l; lx = nx; lz = nz; } else { nx = lx; nz = lz; }
        const p = pts[i];
        pos.push(p.x + nx * hw, p.y, p.z + nz * hw, p.x - nx * hw, p.y, p.z - nz * hw);
        aS.push(s, s); aV.push(-1, 1);
        if (i < n - 1) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('aS', new T.Float32BufferAttribute(aS, 1));
      g.setAttribute('aV', new T.Float32BufferAttribute(aV, 1));
      g.setIndex(idx);
      const mat = new T.ShaderMaterial({
        uniforms: { uColor: { value: new T.Color() }, uHead: { value: 0 }, uAlpha: { value: 0 }, uTail: { value: 1.2 } },
        vertexShader: FLOW_VS, fragmentShader: FLOW_FS, transparent: true, depthWrite: false, depthTest: false,
        blending: T.AdditiveBlending, toneMapped: false, side: T.DoubleSide,
      });
      const m = new T.Mesh(g, mat);
      m.frustumCulled = false;
      m.renderOrder = 9;
      return m;
    }
    makeOrb(color) {
      const tex = dotTexture();
      const spr = (s, o) => {
        const x = new T.Sprite(new T.SpriteMaterial({ map: tex, color, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: o, toneMapped: false }));
        x.scale.setScalar(s); x.renderOrder = 12;
        return x;
      };
      const g = new T.Group();
      const core = new T.Mesh(new T.SphereGeometry(0.075, 16, 10), new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, depthTest: false, transparent: true }));
      core.renderOrder = 13;
      const glow = spr(0.85, 1), halo = spr(2.4, 0.3);
      g.add(halo, glow, core);
      g.visible = false;
      this.trG.add(g);
      return { g, core, glow, halo, born: animNow(), fadeT: 0, park: 1, size: 1 };
    }
    dropOrb(o) {
      this.trG.remove(o.g);
      o.core.geometry.dispose(); o.core.material.dispose(); o.glow.material.dispose(); o.halo.material.dispose();
    }

    // ---------- the journey of a step: inside the dies and over the board ----------
    // A journey is a list of segments: 'move' (the token moves along points) and 'dwell'
    // (the token waits in a block while the block card shows how the block works). The
    // weights set the time: blocks get most of it, the travel over the board is fast.
    get runner() { const r = this.app.view ? this.app.view('runner') : null; return r && r.dieKit ? r : null; }
    // The decap entry of a chip, with its package opened (a round window).
    dieEntry(key) {
      const e = key ? this.decaps.get(key) : null;
      if (!e) return null;
      this.openWindow(e);
      return e;
    }
    // The "up" of the die picture in the world (the top of the die texture).
    dieUp(e) {
      e.mesh.updateWorldMatrix(true, false);
      return new T.Vector3(0, 1, 0).transformDirection(e.mesh.matrixWorld);
    }
    // Segments for a visit of one chip: in by a pin and its bond wire, legs from unit to unit, a
    // dwell in each unit, and out by a bond wire and a pin. The journey then picks the pins (the
    // pin nearest to the board line of the value), routes the legs through the channels of the
    // die (BoardKit.layRoute) and makes each dwell a slow part through its unit.
    // visits: [[block label, card or null], ...] from a trace model.
    chipVisit(e, visits, o = {}) {
      const R = this.runner;
      if (!e || !R || !visits || !visits.length) return [];
      const K = R.dieKit(e);
      const dv = { e, s: K.s, nrm: K.nrm, upv: this.dieUp(e), K };
      const ctr = visits.map(v => K.C(v[0])), low = v => v.toLowerCase();
      const segs = [];
      if (o.in) {
        const pin = this.padNear(e, ctr[0]);
        segs.push({ kind: 'move', bond: 'in', pin, dive: dv, label: `In through a pin of the ${NM.cpu === e.part ? 'CPU' : 'chip'}` });
        segs.push({ kind: 'move', leg: { from: { pin }, to: { unit: visits[0][0] } }, dive: dv, label: `To the ${low(visits[0][0])}` });
      }
      visits.forEach((v, i) => {
        if (i > 0) segs.push({ kind: 'move', leg: { from: { unit: visits[i - 1][0] }, to: { unit: v[0] } }, dive: dv, label: `To the ${low(v[0])}` });
        segs.push({ kind: 'dwell', at: K.W([ctr[i]])[0], dive: dv, block: v[0], card: v[1] || null, label: v[1] && v[1].sub ? v[1].sub : low(v[0]) });
      });
      if (o.out) {
        const pin = this.padNear(e, ctr[ctr.length - 1], o.bottom);
        segs.push({ kind: 'move', leg: { from: { unit: visits[visits.length - 1][0] }, to: { pin } }, dive: dv, label: 'To a pad at the edge of the die' });
        segs.push({ kind: 'move', bond: 'out', pin, bottom: o.bottom, dive: dv, label: 'Out through the bond wire and a pin' });
      }
      return segs;
    }
    // The layout label of a unit name of a trace model, and the indices of all its blocks.
    blkLabel(e, label) {
      return (e.part === '80286' && BLK_286[label]) || (e.part === '80386' && BLK_386[label]) || (e.part === '80486' && BLK_486[label]) || (e.part === '80586' && BLK_586[label]) || (e.part === '80686' && BLK_686[label]) || label;
    }
    blocksIdx(e, label) {
      const lbl = this.blkLabel(e, label), out = [];
      this.layOf(e).blocks.forEach((b, i) => { if (b.label === lbl) out.push(i); });
      return out;
    }
    boardSeg(pts, label) {
      return pts && pts.length > 1 ? [{ kind: 'move', pts: this.trResample(pts, 0.08), dive: null, w: 0.35, label }] : [];
    }
    // The chip that answers a bus cycle, and the facts that its model needs.
    traceTarget(I) {
      const m = this.app.machine;
      let key = null, k = 0, phys = 0, g = null;
      const port = I.addr & 0xFFFF;
      let dev = I.dev;
      if (I.dev === 'ram') {
        phys = I.lo ? (I.width === 2 ? I.addr & ~1 : I.addr) : I.addr | 1;
        const by = m.mem[phys & 0xFFFFF];
        while (k < 7 && !((by >> k) & 1)) k++;
        if (!((by >> k) & 1)) k = 0;
        key = (I.lo ? 'ramE' : 'ramO') + k;
      } else if (I.dev === 'rom') { key = I.lo ? 'romE' : 'romO'; phys = I.lo ? I.addr & ~1 : I.addr | 1; }
      else if (IO_DEV[I.dev] || I.kind === 'inta') key = I.dev;
      if (I.dev === 'vram') { const gs = this.vramChips(I.addr, I.read); g = gs.find(x => x.bit) || gs[0]; if (g) key = g.key; }
      else if (I.dev === 'xram') { g = this.xramChip(I.addr, I.width === 2 ? (I.lo ? 0 : 1) : I.addr & 1); key = g.key; }
      else if (I.dev === 'crtc' || I.dev === 'cga') { key = 'crtc'; dev = 'crtc'; }
      else if (I.dev === 'vga') { key = dev = DAC_PORT(port) ? 'dac' : 'vgac'; }
      else if (I.dev === 'fdc') key = 'fdc';
      else if (I.dev === 'sb') { key = dev = 'sbdsp'; }
      else if (I.dev === 'opl') { key = dev = 'opl'; }
      else if (I.dev === 'vrom') { key = 'vbios'; phys = I.addr; }
      const e = this.dieEntry(key);
      if (!e) return null;
      const byte = m.mem[phys & 0xFFFFF];
      const ctx = { I, m, e, part: e.part, dev, port, phys, byte, key };
      if (g) Object.assign(ctx, { row: g.row, col: g.col, bit: g.bit, rb: g.rb || RB, cb: g.cb || RB });
      else if (I.dev === 'ram') { const c0 = (phys >> 1) & ((1 << (2 * RB)) - 1); Object.assign(ctx, { row: c0 & ((1 << RB) - 1), col: c0 >> RB, bit: (byte >> k) & 1, rb: RB, cb: RB }); }
      else if (I.dev === 'rom' || I.dev === 'vrom') { const rc = this.romCell(e, phys); Object.assign(ctx, { row: rc.row, col: rc.col }); }
      else ctx.target = I.kind === 'inta' ? 'ISR' : ioBlock(dev, port, I.read, m.crtc ? m.crtc.index : 0);
      return { e, ctx, model: traceModel(e.part) };
    }
    // All the segments of a step, in order, and the timing of each one.
    trJourney(s) {
      if (s._j) return s._j;
      const v = this.trSpec(s), segs = [];
      const add = list => { for (const x of list) if (x) segs.push(x); };
      const m = this.app.machine;
      const who = ((s.I && s.I.fpu) || s.unit === 'fpu') && !FPU_ON ? 'fpu' : 'cpu';
      const ce = this.runner ? this.dieEntry(who) : null;
      const cm = traceModel(ce ? ce.part : '8086');
      if (!this.runner) {
        for (const lg of v.legs) add(this.boardSeg(lg.pts, ''));
      } else if (s.kind === 'inside') {
        add(this.chipVisit(ce, cm.inside({ s, m })));
      } else if (s.kind === 'page') {
        add(this.chipVisit(ce, PAGE_CARD(s)));
      } else if (s.kind === 'cache') {
        add(this.chipVisit(ce, CACHE_CARD(s)));
      } else if (s.kind === 'btb') {
        add(this.chipVisit(ce, P5_CARDS(s.e || {})));
      } else if (s.kind === 'sound') {
        add(this.chipVisit(this.dieEntry(s.e && s.e.k === 'opl' ? 'opl' : 'sbdsp'), SOUND_CARD(s)));
      } else if (s.kind === 'fdc' || s.kind === 'dma') {
        const e = this.dieEntry(s.kind === 'fdc' ? 'fdc' : 'dma');
        const card = FDC_CARD(s);
        add(this.chipVisit(e, card));
      } else if (s.kind === 'irq') {
        const pe = this.dieEntry(M286 && s.e && s.e.vec >= 0x70 ? 'pic2' : 'pic');
        add(this.chipVisit(pe, PIC_IRQ_TRACE, { out: true }));
        add(this.boardSeg(this.routes.INTR ? this.routes.INTR.path.map(p => new T.Vector3(p[0], 0.07, p[1])) : [], `INTR goes to the ${NM.cpu}`));
        add(this.chipVisit(ce, [['INTERRUPTS TIMING', null]], { in: true }));
      } else if (s.kind === 'bus') {
        const I = s.I, bp = v.bp || {}, ev = s.e;
        const ctxC = { I, s, ev, m };
        const tg = I.kind === 'halt' ? null : this.traceTarget(I);
        const tm = tg ? tg.model : null, tctx = tg ? Object.assign(tg.ctx, { s, ev }) : null;
        const name = Story.devName(I);
        const devVisit = (list, o) => (tg && list && list.length ? this.chipVisit(tg.e, list, o) : []);
        // a board leg through a chip on the way: the leg to the point nearest the chip, the work
        // in the chip, the rest of the leg
        const via = (pts, id, visits, l1, l2) => {
          const ge = this.dieEntry(id), P = this.trPos(id);
          if (!ge || !P || !pts || pts.length < 2) { add(this.boardSeg(pts, l1)); return; }
          let k = 0, bd = Infinity;
          pts.forEach((q, j) => { const d = Math.hypot(q.x - P.x, q.z - P.z); if (d < bd) { bd = d; k = j; } });
          add(this.boardSeg(pts.slice(0, k + 1), l1));
          add(this.chipVisit(ge, visits, { in: true, out: true }));
          add(this.boardSeg(pts.slice(k), l2));
        };
        const xcvId = I.lo ? 'xcv0' : 'xcv1', xcvE = I.dev === 'fpu' ? null : this.decaps.get(xcvId);
        if (s.phase === 'addr') {
          add(this.chipVisit(ce, cm.out(ctxC), { out: true }));
          const le = this.decaps.get('lat0');
          if (le && !I.fpu) via(bp.addr, 'lat0', GLUE.latch(le.part, I), `On the local bus to the ${NM.lat} latches`, `On the address bus to the ${name}`);
          else add(this.boardSeg(bp.addr, `On the address bus, through the ${NM.lat} latches, to the ${name}`));
          if (tm) add(devVisit(tm.addr ? tm.addr(tctx) : [], { in: true }));
        } else if (s.phase === 'cmd') {
          const be = this.dieEntry('bus'), bm = be ? traceModel(be.part) : null;
          const bctx = Object.assign({ I, s, ev, m }, { part: be ? be.part : NM.bus });
          if (I.kind === 'halt') add(this.chipVisit(be, bm ? bm.visit(bctx).slice(0, 1) : [], { in: true }));
          else {
            add(this.chipVisit(ce, cm.status(ctxC), { out: true }));
            add(this.boardSeg(bp.s02, `The status lines go to the ${NM.bus}`));
            add(this.chipVisit(be, bm ? bm.visit(bctx) : [], { in: true, out: true }));
            if (v.dec) {
              // the chip select: the decoder (on the AT boards the PAL16L8 first for the memory)
              const B = this.trPos('bus'), D = this.trPos('dec'), cs = v.dec.cs, pe = v.dec.pal ? this.dieEntry('pal') : null, de = this.dieEntry('dec');
              let at = B;
              if (pe) {
                const Pp = this.trPos('pal');
                add(this.boardSeg([at.clone()].concat(this.trHop(at, Pp, 0.5)), `The ${NM.bus} gives the command; the address goes to the decoder`));
                add(this.chipVisit(pe, GLUE.pal(I, I.dev), { in: true, out: true }));
                at = Pp;
              }
              if (de) {
                add(this.boardSeg([at.clone()].concat(this.trHop(at, D, 0.5)), pe ? 'The select goes to the 74LS138' : `The ${NM.bus} gives the command; the address goes to the decoder`));
                if (!pe) add(this.chipVisit(de, GLUE.dec(de.part, I.dev, DEC_Y[I.dev] !== undefined ? DEC_Y[I.dev] : 0), { in: true, out: true }));
                at = D;
              }
              const csPts = cs && cs.length ? [at.clone()].concat(this.trHop(at, cs[0], 0.3), cs) : [];
              add(this.boardSeg(csPts, `The chip select goes to the ${name}`));
            } else add(this.boardSeg(bp.cmd, `${s.token.tag} goes to the ${name}`));
            if (tm) add(devVisit(tm.cmd ? tm.cmd(tctx) : [], { in: true }));
          }
        } else if (s.phase === 'data') {
          if (I.read) {
            if (tm) add(devVisit(tm.read ? tm.read(tctx) : [], { out: true }));
            if (xcvE) via(bp.dataR, xcvId, GLUE.xcv(xcvE.part, I, !I.lo), `On the system data bus to the ${NM.xcv} transceivers`, `On the local bus to the ${I.fpu ? NM.fpu : NM.cpu}`);
            else add(this.boardSeg(bp.dataR, `On the data bus, through the ${NM.xcv} transceivers, to the ${I.fpu ? NM.fpu : NM.cpu}`));
            add(this.chipVisit(ce, cm.in(ctxC), { in: true }));
          } else {
            add(this.chipVisit(ce, cm.write(ctxC), { out: true }));
            if (xcvE) via(bp.dataW, xcvId, GLUE.xcv(xcvE.part, I, !I.lo), `On the local bus to the ${NM.xcv} transceivers`, `On the system data bus to the ${name}`);
            else add(this.boardSeg(bp.dataW, `On the data bus, through the ${NM.xcv} transceivers, to the ${name}`));
            if (tm) add(devVisit(tm.write ? tm.write(tctx) : [], { in: true }));
          }
        } else {
          // one-step prefetch: the address goes out, the code comes back to the queue
          add(this.chipVisit(ce, cm.out(Object.assign({ short: true }, ctxC)), { out: true }));
          add(this.boardSeg(bp.addr, `On the address bus to the ${name}`));
          if (tm && tm.read) {
            const a = tm.addr ? tm.addr(tctx) : [], r = tm.read(tctx);
            add(devVisit(a.slice(0, 1).concat(r.slice(-1)), { in: true, out: true }));
          }
          add(this.boardSeg(bp.dataR, 'The code bytes go back on the data bus'));
          add(this.chipVisit(ce, cm.in(ctxC), { in: true }));
        }
      }
      // the pins: the pin of the chip nearest to the board line of the value (before a bond
      // wire in, after a bond wire out)
      const boardEnd = (i, dir) => {
        for (let j = i + dir; j >= 0 && j < segs.length; j += dir) {
          const q = segs[j];
          if (!q.dive) return q.pts && q.pts.length ? (dir < 0 ? q.pts[q.pts.length - 1] : q.pts[0]) : null;
          if (q.dive.e !== segs[i].dive.e) return null;
        }
        return null;
      };
      segs.forEach((sg, i) => {
        if (!sg.bond) return;
        const e = sg.dive.e, K = sg.dive.K, E = boardEnd(i, sg.bond === 'in' ? -1 : 1);
        if (E) {
          let bd = Infinity;
          for (const pin of this.layOf(e).pins) {
            if (sg.bottom !== undefined && pin.bottom !== sg.bottom) continue;
            const d = this.pinW(e, pin).distanceTo(E);
            if (d < bd) { bd = d; sg.pin = pin; }
          }
        }
        sg.pts = sg.bond === 'in' ? K.pinIn(sg.pin) : K.pinOut(sg.pin);
        const leg = segs[i + (sg.bond === 'in' ? 1 : -1)];
        if (leg && leg.leg) leg.leg[sg.bond === 'in' ? 'from' : 'to'] = { pin: sg.pin };
      });
      // the legs in a die: through its channels, from port to port
      for (const sg of segs) {
        if (!sg.leg) continue;
        const e = sg.dive.e, K = sg.dive.K;
        const end = x => { if (x.pin) return { pt: x.pin.p.slice() }; const ks = this.blocksIdx(e, x.unit); return ks.length ? { blocks: ks } : { pt: K.C(x.unit) }; };
        sg.pts = K.W(layRoute(this.layOf(e), end(sg.leg.from), end(sg.leg.to)));
      }
      // the units: in at the port where the leg in ends, to the working part, out at the port
      // where the leg out starts
      const flat = [];
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        if (sg.kind !== 'dwell') { flat.push(sg); continue; }
        const prev = flat[flat.length - 1], next = segs[i + 1], c = sg.at;
        const pin = prev && prev.pts && prev.dive && prev.dive.e === sg.dive.e ? prev.pts[prev.pts.length - 1] : null;
        const pout = next && next.pts && next.dive && next.dive.e === sg.dive.e ? next.pts[0] : null;
        const pts = [pin, c, pout].filter(Boolean).map(v => v.clone()).filter((v, j, a) => j === 0 || v.distanceTo(a[j - 1]) > 1e-6);
        sg.kind = 'move'; sg.unit = true;
        sg.pts = pts.length > 1 ? pts : [c.clone(), c.clone()];
        sg.ci = Math.max(0, sg.pts.findIndex(v => v.distanceTo(c) < 1e-6));
        flat.push(sg);
      }
      // join the segments where they do not touch (a short straight line or an arc)
      const J = { segs: [], v };
      let last = null;
      for (const sg of flat) {
        if (!sg.pts || !sg.pts.length) continue;
        const p0 = sg.pts[0];
        if (last) {
          const gap = last.distanceTo(p0);
          // (a long gap is an arc over the board: a part of the board, also next to a chip)
          if (gap > 0.004) J.segs.push({ kind: 'move', pts: gap > 0.3 ? [last.clone()].concat(this.trHop(last, p0, clamp(gap * 0.15, 0.05, 1))) : [last.clone(), p0.clone()], dive: gap > 0.3 ? null : sg.dive || null, label: sg.label });
        }
        J.segs.push(sg);
        last = sg.pts[sg.pts.length - 1];
      }
      for (const sg of J.segs) {
        sg.cum = [0];
        for (let i = 1; i < sg.pts.length; i++) sg.cum.push(sg.cum[i - 1] + sg.pts[i].distanceTo(sg.pts[i - 1]));
        sg.len = sg.cum[sg.cum.length - 1] || 0;
      }
      // (a first plan: equal parts; the flow plan sets the real times)
      J.segs.forEach((sg, i) => { sg.t0 = i / J.segs.length; sg.t1 = (i + 1) / J.segs.length; });
      J.start = J.segs.length ? J.segs[0].pts[0] : null;
      J.end = last;
      return (s._j = J);
    }
    // ---------- the flow of a step: one continuous line, at a constant speed on the screen ----------
    // (the same rules as the Top view; see "The flow of the trace" in ARCHITECTURE.md)
    // The time of a step at this speed (the app asks the view before it starts the step).
    traceDur(s, ms) {
      s._ms = ms;
      if (this.xp && this.xp.shots) {
        // the camera goes from the view now to the first shot of the step (the token waits)
        const X = this.xpPlan(s, ms), U = this.xpTime || { travel: 1 }, c = this.cam;
        s._xpLead = ms && ms < 1000 ? 900 : this.xpCutMs({ tgt: c.target.clone(), r: c.r }, X.scenes[0].shot, 1200 * clamp(1 / (U.travel || 1), 0.6, 3));
        return s._xpLead + X.Tm;
      }
      return this.flowFull(s, ms, animNow()).T;
    }
    // Explain: a card of the tour (no token); its drawing plays on the animation clock.
    xpCardStep(now) {
      const c = this.xpCard;
      this.showCard(c.spec, clamp((now - c.t0) / c.dur, 0, 1));
      if (this.bcard) this.bcard.place(12, this.xpTopPx || 60);   // (under the program strip; placeTrace needs a step)
      return true;
    }
    // Explain: the times and the camera shots of a step. The token moves at XP_PX_S on the screen
    // of the shot; a unit with a card holds it for the work (XP_WORK_S); a unit without a card
    // only passes it. A chip with work gets its own shot (the whole die); the parts between go in
    // a board shot. Between two shots the camera moves (XP_CUT) while the token waits. A short
    // step (ms < 1000: a later code fetch) has one shot and little work time.
    // Returns { Tm, scenes: [{ ts (ms from the start), shot }] }; sets t0, t1, fin, fout of the parts.
    xpPlan(s, ms) {
      const J = this.trJourney(s), segs = J.segs, U = this.xpTime || { travel: 1, work: 1, read: 1 };
      const key = `${ms}|${U.travel}|${U.work}|${U.read}|${this.w}x${this.h}`;
      const put = X => { segs.forEach((g, i) => { [g.t0, g.t1, g.fin, g.fout] = X.segT[i]; }); J.runs = X.runs; return X; };
      if (J._xp && J._xp.key === key) return put(J._xp);   // (the normal plan can change the parts in between)
      const quick = !!ms && ms < 1000;
      const PX = XP_PX_S * U.travel * (quick ? 1.6 : 1), WORK = XP_WORK_S * 1000 * U.work * (quick ? 0.25 : 1);
      // a slow signal speed makes the camera moves slower too (and lets the long moves take longer)
      const slow = clamp(1 / (U.travel || 1), 0.6, 3);
      // the scenes: each unit that works (a close shot; the moves to it from the unit before in
      // the same chip belong to it: the camera follows the token), or the parts between (the board)
      const groups = [];
      const addB = (a, b) => { if (a >= b) return; const L = groups[groups.length - 1]; if (L && !L.w && L.w !== 0) L.b = b; else groups.push({ a, b }); };
      for (let i = 0; i < segs.length;) {
        const e = segs[i].dive ? segs[i].dive.e : null;
        let j = i + 1;
        if (e) while (j < segs.length && segs[j].dive && segs[j].dive.e === e) j++;
        const ws = [];
        if (e && !quick) for (let k = i; k < j; k++) if (segs[k].unit && segs[k].card) ws.push(k);
        if (!ws.length) { addB(i, j); i = j; continue; }
        addB(i, ws[0]);
        ws.forEach((w, k) => groups.push({ a: k ? ws[k - 1] + 1 : w, b: w + 1, w, follow: k > 0 }));
        addB(ws[ws.length - 1] + 1, j);
        i = j;
      }
      const dieShot = e => { const g = this.segCtx({ dive: segs.find(x => x.dive && x.dive.e === e).dive }, false); return { tgt: g.tgt, r: g.r, th: g.th, phi: g.phi, up: g.up }; };
      // a unit with work: always the close shot of the unit (also for a card of text)
      const unitShot = sg => { const g = this.segCtx(sg, false, true); return { tgt: g.tgt, r: g.r, th: g.th, phi: g.phi, up: g.up }; };
      const scenes = groups.map((G, k) => {
        if (G.w !== undefined) return { G, shot: unitShot(segs[G.w]) };
        const part = segs.slice(G.a, G.b), e0 = part[0] && part[0].dive ? part[0].dive.e : null;
        if (e0 && part.every(g => g.dive && g.dive.e === e0)) return { G, shot: dieShot(e0) };
        const box = new T.Box3();
        for (const g of part) for (const q of g.pts) box.expandByPoint(q);
        // the ends of the chips before and after, so the move from and to them makes sense
        const prev = segs[G.a - 1], next = segs[G.b];
        if (prev && prev.pts.length) box.expandByPoint(prev.pts[prev.pts.length - 1]);
        if (next && next.pts.length) box.expandByPoint(next.pts[0]);
        return { G, shot: this.xpShotBox(box) };
      });
      // the times. The parts become pieces: a move (its length on the screen of its shot) or a
      // stop (the work of a unit; a short stop in a unit that only passes the value; a camera
      // move while the token waits). The moves between two stops are one run: its time comes from
      // its whole length on the screen, so all its parts have the same speed, and the run speeds up
      // and slows down smoothly (xpEase).
      const FOLLOW = 1200 * slow, RUN_MIN = (quick ? 300 : 1000) * Math.sqrt(slow), RUN_MAX = 6000 * slow;
      const ACC = (quick ? 250 : 850) * Math.sqrt(slow), PASS = quick ? 0 : XP_PASS * Math.sqrt(slow);
      const items = [];
      scenes.forEach((S, k) => {
        const follow = !!S.G.follow;
        if (k > 0 && !follow) items.push({ k: 'cut', ms: this.xpCutMs(scenes[k - 1].shot, S.shot, XP_CUT * slow), S });
        // the length of a part on the screen of the shot (projected: a bond wire that goes down
        // to the board is short on the screen)
        const cam = this.shotCam(S.shot);
        for (let i = S.G.a; i < S.G.b; i++) {
          const g = segs[i], n = g.pts.length - 1;
          g.fin = g.fout = 0; g.xp = true;
          if (g.unit) {
            // in to the working point of the unit, the work (or a short stop), out of the unit
            const ci = clamp(g.ci || 0, 0, Math.max(0, n));
            const w = g.card ? Math.max(g.card.kind === 'text' ? WORK * 0.8 : WORK, quick ? 0 : this.xpReadMs(g, U.read || 1)) : PASS;
            items.push({ k: 'move', g, part: 'in', a: 0, b: ci, cam, S });
            items.push({ k: 'stop', g, ms: w, S, work: !!g.card });
            items.push({ k: 'move', g, part: 'out', a: ci, b: n, cam, S });
          } else items.push({ k: 'move', g, part: 'all', a: 0, b: n, cam, S });
        }
      });
      let t = 0, run = [];
      const runs = [];
      const close = () => {
        if (!run.length) return;
        // the lengths on the screen: with the camera of each part's shot; a run into a follow scene
        // (the camera moves with the token to the next unit): all its parts with the camera there
        const fq = run.find(q => q.S.G.follow), intoFollow = !!fq;
        for (const q of run) q.len = this.projLen(q.g.pts, fq ? fq.cam : q.cam, q.a, q.b);
        const L = run.reduce((n, q) => n + q.len, 0);
        const T0 = L / PX * 1000, a0 = clamp(ACC / Math.max(1, T0), 0.2, 0.5);
        let T = L > 0.5 ? clamp(T0 / (1 - a0), RUN_MIN, Math.max(RUN_MIN, RUN_MAX)) : 0;
        if (intoFollow) T = Math.max(T, FOLLOW);
        let x = t;
        for (const q of run) { const d = L > 0.5 ? T * q.len / L : T / run.length; q.t0 = x; x += d; q.t1 = x; }
        // (a run into a follow scene: the camera moves with it, so both use the full S-curve)
        if (T > 0) runs.push({ t0: t, t1: t + T, ms: T, a: intoFollow ? 0.5 : clamp(ACC / T, 0.2, 0.5) });
        t += T;
        run = [];
      };
      for (const it of items) {
        if (it.k === 'move') { run.push(it); continue; }
        close();
        it.t0 = t; t += it.ms; it.t1 = t;
      }
      close();
      // the parts: their times from the pieces
      for (const it of items) {
        const g = it.g;
        if (!g) continue;
        if (it.part === 'all') { g.t0 = it.t0; g.t1 = it.t1; }
        else if (it.part === 'in') { g.t0 = it.t0; g._in = it.t1 - it.t0; }
        else if (it.part === 'out') { g.t1 = it.t1; g._out = it.t1 - it.t0; }
      }
      for (const g of segs) if (g.unit && g.xp) { const dt = (g.t1 || 0) - (g.t0 || 0); g.fin = dt > 0 ? g._in / dt : 0; g.fout = dt > 0 ? g._out / dt : 0; }
      // the camera: a cut moves it while the token waits; a follow scene moves it with the token
      // from the last stop to the arrival at its unit
      let lastStop = 0;
      for (const it of items) {
        if (it.k === 'cut') { it.S.ts = it.t1; it.S.blend = it.ms; }
        if (it.k === 'stop' && it.work && it.S.G.follow && it.g === segs[it.S.G.w]) { it.S.ts = it.t0; it.S.blend = Math.max(300, it.t0 - lastStop); }
        if (it.k !== 'move') lastStop = it.t1;
      }
      scenes.forEach((S, k) => { if (S.ts === undefined) { S.ts = 0; S.blend = k ? XP_CUT : 0; } });
      const Tm = Math.max(120, t);
      for (const q of runs) { q.t0 /= Tm; q.t1 = Math.min(1, q.t1 / Tm); }
      for (const g of segs) { g.t0 = (g.t0 || 0) / Tm; g.t1 = Math.min(1, (g.t1 || 0) / Tm); }
      J.runs = runs;
      J._xp = { key, Tm, runs, scenes: scenes.map(S => ({ ts: S.ts, shot: S.shot, blend: S.blend || XP_CUT })), segT: segs.map(g => [g.t0, g.t1, g.fin, g.fout]) };
      return J._xp;
    }
    // A camera at a shot of Explain (for the length of a part on the screen).
    shotCam(shot) {
      const c = this.camera.clone(), t = shot.tgt || new T.Vector3(), sp = Math.sin(shot.phi);
      const th = shot.th === null || shot.th === undefined ? this.cam.theta : shot.th;
      c.position.set(t.x + shot.r * sp * Math.sin(th), t.y + shot.r * Math.cos(shot.phi), t.z + shot.r * sp * Math.cos(th));
      c.up.copy(shot.up || new T.Vector3(0, 1, 0));
      c.near = clamp(shot.r * 0.04, 0.003, 0.5);
      c.updateProjectionMatrix();
      c.lookAt(t);
      c.updateMatrixWorld(true);
      return c;
    }
    // The length on the screen (px) of the points a..b of a path, seen by the camera cam.
    projLen(pts, cam, a, b) {
      let L = 0, px = 0, py = 0;
      const q = new T.Vector3();
      for (let i = a; i <= b && i < pts.length; i++) {
        q.copy(pts[i]).project(cam);
        const x = q.x * this.w / 2, y = q.y * this.h / 2;
        if (i > a) L += Math.hypot(x - px, y - py);
        px = x; py = y;
      }
      return L;
    }
    // The time of a camera move between two shots: longer for a large zoom change and for a long
    // way (in units of the view size), so the picture never jumps.
    xpCutMs(A, B, base) {
      if (!A || !B || !A.tgt || !B.tgt) return base;
      // S: the length of the zoom path (xpCamera), in units of the view size
      const KW = 2 * Math.tan(this.camera.fov * Math.PI / 360) * (this.camera.aspect || 1.6);
      const S = Math.abs(zoomPath([0, 0, KW * Math.max(1e-6, A.r)], [A.tgt.distanceTo(B.tgt), 0, KW * Math.max(1e-6, B.r)]).S) || 0;
      return base * clamp(0.75 + 0.6 * S, 1, 3.6);
    }
    // Explain: the position in time of the token in a run of moves (E: 0..1 of the step). The
    // speed of the token follows a smooth ramp up at the start of the run (a smoothstep over the
    // fraction q.a of the run), stays, and a smooth ramp down at its end: no sudden start or stop.
    xpEase(runs, E) {
      for (const q of runs) {
        if (E < q.t0 || E >= q.t1) continue;
        const L = q.t1 - q.t0, r = (E - q.t0) / L, a = q.a || 0.5, v = 1 / (1 - a);
        const ramp = x => x * x * x - x * x * x * x / 2;     // the way of a ramp: the speed is 3x^2 - 2x^3
        const p = r < a ? v * a * ramp(r / a) : r > 1 - a ? 1 - v * a * ramp((1 - r) / a) : v * (a / 2 + r - a);
        return q.t0 + clamp(p, 0, 1) * L;
      }
      return E;
    }
    // Explain: the text of a unit at work (its chip, its name, and what it does now).
    xpUnitText(g) {
      if (!g || !g.unit || !g.dive) return null;
      const e = g.dive.e, name = String(g.block || '').toLowerCase();
      const card = g.card, text = card && card.sub ? card.sub : g.label && g.label !== name ? g.label : '';
      // the name in normal case; a word with a digit and a short name (KB, TLB, ALU ...) stay in capitals
      const ACR = /^(kb|tlb|alu|fpu|rom|ram|dram|io|i\/o|btb|rob|rs|rat|rrf|pal|cpu|biu|eu|au|iu|bu|agu|fifo|msrom|ms|lru|dac|crtc|pll|sb|mob|ieu|feu|jeu|mmx|dsp|opl|l[0-9])$/;
      const unit = String(g.block || '').split(' ').map((w, k) => {
        const lw = w.toLowerCase();
        if (/\d/.test(w) || ACR.test(lw)) return w.toUpperCase();
        return k ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
      }).join(' ');
      return { chip: e.part, unit, text };
    }
    xpUnitCap(g) {
      const u = this.xpUnitText(g);
      return u && u.text ? `${u.chip} · ${u.unit}: ${u.text}` : '';
    }
    xpReadMs(g, read) {
      const u = this.xpUnitText(g);
      return u && u.text ? (900 + (u.unit.length + u.text.length) * 48) * read : 0;
    }
    // Explain: the unit of the step that works now (null: the token is not at work in a unit).
    xpNowUnit() {
      const t = this.tr, r = t && t.rider;
      if (!r || r.done || animNow() < r.t0) return null;
      const at = r.at;
      return at && at.seg && at.seg.unit && at.seg.card && at.dive ? at.seg : null;
    }
    // The camera goal of a part of the journey: the whole die for a part in a chip (for a unit
    // with a card: the unit, larger), and the part with its ends for a part on the board (then the
    // camera follows the token: tgt null).
    segCtx(sg, bg, unitAlways) {
      const KF = 2 * Math.tan(this.camera.fov * Math.PI / 360), asp = this.camera.aspect || 1.6;
      const cov = this.xpCovers(), cardW = cov.left, monW = cov.right;
      const free = this.w > 0 ? clamp((this.w - cardW - monW) / this.w, 0.35, 1) : 1;
      const freeH = this.h > 0 ? clamp((this.xp ? this.h - cov.top - cov.bottom : this.h - 2 * (this.trOff || 0) - 56) / this.h, 0.35, 1) : 1;
      if (sg.dive) {
        const e = sg.dive.e, L = this.layOf(e), n = sg.dive.nrm || new T.Vector3(0, 1, 0), up = sg.dive.upv || new T.Vector3(0, 0, -1);
        const dw = L.dw / e.cw * e.d.L * 0.97, dh = L.dh / e.ch * e.d.W * 0.94;
        const side = Math.abs(n.y) > 0.7 ? Math.max(dw, dh) : dw;
        let r = Math.max(side / (KF * asp * free), dh / (KF * freeH)) * 1.1;
        let ctr = this.dieW(e, [e.cw / 2, e.ch / 2], 0.006);
        // a part that goes out of the die (a bond wire, a pin): the view shows its points too
        if (!sg.unit && sg.pts) for (const p of sg.pts) r = Math.max(r, 2.3 * p.distanceTo(ctr) / (KF * freeH));
        if (sg.unit && sg.card && (sg.card.kind !== 'text' || unitAlways) && !bg) {
          const b = L.blocks[this.bIdx(e, sg.block)];
          if (b) {
            const bw = b.w / e.cw * e.d.L * 0.97 * FLOW_UNIT_M, bh = b.h / e.ch * e.d.W * 0.94 * FLOW_UNIT_M;
            r = Math.max(bw / (KF * asp * free), bh / (KF * freeH), r / 10);
            ctr = this.dieW(e, [b.x + b.w / 2, b.y + b.h / 2], 0.006);
            if (unitAlways) r *= XP_UNIT_Z;   // (Explain: the close shot of the unit)
          }
        }
        const phi = Math.max(0.06, Math.acos(clamp(n.y, -1, 1)));
        let th, upv = null;
        if (n.y < 0.7) { th = Math.atan2(n.x, n.z); upv = up.clone(); } else th = Math.atan2(-up.x, -up.z);
        // move the die to the middle of the free part of the view
        if (cardW || monW) {
          const right = new T.Vector3().crossVectors(up, n).normalize();
          ctr.addScaledVector(right, -((cardW - monW) / 2) * KF * r / Math.max(1, this.h));
        }
        // (Explain) and to the middle between the program strip and the caption bar
        if (this.xp && (cov.top || cov.bottom)) ctr.addScaledVector(up, -((cov.bottom - cov.top) / 2) * KF * r / Math.max(1, this.h));
        return { tgt: ctr, r, th, phi, up: upv };
      }
      const R = Math.max(5, this.fitRadius());
      if (bg || !sg.pts || sg.pts.length < 2) return { tgt: null, r: R, th: null, phi: 0.62, up: null };
      const a = sg.pts[0], b = sg.pts[sg.pts.length - 1];
      const r = clamp(Math.max(Math.abs(b.x - a.x) / (KF * asp * free), Math.abs(b.z - a.z) / (KF * freeH)) * 1.35 + 3, 5, R);
      return { tgt: null, r, th: null, phi: 0.62, up: null };
    }
    // Screen px for one world unit at the camera distance r.
    pxAt(r) { return Math.max(200, this.h || 600) / (2 * Math.tan(this.camera.fov * Math.PI / 360) * r); }
    // The plan of a step: the camera goal and the time of each part, and the pan (the camera
    // moves to the start first: for a new value, and when the start is far from the view).
    // opt.bg: the plan of a token in parallel (its units only pass it; no pan).
    flowPlan(s, ms, opt = {}) {
      const J = this.trJourney(s), segs = J.segs, k = clamp((ms || 1700) / 1700, 0.08, 3);
      let Tm = 0;
      for (const sg of segs) {
        sg.fin = sg.fout = 0;
        sg.ctx = this.segCtx(sg, opt.bg);
        const work = sg.unit && sg.card && sg.card.kind !== 'text' && !opt.bg;
        const sec = sg.unit ? (work ? FLOW_UNIT_S : FLOW_PASS_S) : Math.max(0.2, sg.len * this.pxAt(sg.ctx.r) / FLOW_PX_S);
        sg.dt = sec * 1000 * k;
        Tm += sg.dt;
      }
      Tm = Math.max(120, Tm);
      let t = 0;
      for (const sg of segs) { sg.t0 = t / Tm; t += sg.dt; sg.t1 = Math.min(1, t / Tm); }
      let pan = 0, jump = false;
      if (!opt.bg && J.start && segs.length) {
        jump = !!(this.flowLast && this.flowLast.distanceTo(J.start) > 1e-3);
        if (this.follow && !this.reduced) {
          const c = this.cam, g = segs[0].ctx, tg = g.tgt || J.start, KW = 2 * Math.tan(this.camera.fov * Math.PI / 360) * (this.camera.aspect || 1.6);
          let dth = g.th === null ? 0 : g.th - c.theta;
          while (dth > Math.PI) dth -= TAU;
          while (dth < -Math.PI) dth += TAU;
          const S = zoomPath([0, 0, KW * c.r], [c.target.distanceTo(tg), 0, KW * g.r]).S + 0.5 * (Math.abs(dth) + Math.abs(g.phi - c.phi));
          if (jump || S > 0.35) pan = clamp(S * 1350, 700, 5000) * Math.sqrt(k);
        }
      }
      return { segs, Tm, T: pan + Tm, pan, jump };
    }
    // The plan of a step with its camera track, in two passes: the time of each part on the
    // board or in a die comes from the zoom that the track really has at that time (so the
    // token keeps its screen speed also while the camera zooms). The work in parallel (s.bg,
    // for example a prefetch) has its own tokens; the step ends when all of them are done.
    // The result stays for traceStep (the app asks traceDur first, in the same frame).
    flowFull(s, ms, now) {
      const C = this.flowCache;
      if (C && C.s === s && C.ms === ms && C.now === now) return C.f;
      const f = this.flowPlan(s, ms), k = clamp((ms || 1700) / 1700, 0.08, 3);
      f.bg = [];
      for (let pass = 0; pass < 2; pass++) {
        const cam = this.flowCamera(f);
        let Tm = 0;
        for (const sg of f.segs) {
          if (!sg.unit) {
            const a = Math.floor((f.pan + sg.t0 * f.Tm) / cam.dtS), b = Math.min(cam.n - 1, Math.ceil((f.pan + sg.t1 * f.Tm) / cam.dtS));
            let lr = Infinity;
            for (let i = Math.max(0, a); i <= b; i++) lr = Math.min(lr, cam.L[i]);
            const r = isFinite(lr) ? Math.min(sg.ctx.r, Math.exp(lr)) : sg.ctx.r;
            sg.dt = Math.max(0.2, sg.len * this.pxAt(r) / FLOW_PX_S) * 1000 * k;
          }
          Tm += sg.dt;
        }
        Tm = Math.max(120, Tm);
        let t = 0;
        for (const sg of f.segs) { sg.t0 = t / Tm; t += sg.dt; sg.t1 = Math.min(1, t / Tm); }
        f.Tm = Tm; f.T = f.pan + Tm;
      }
      f.mainT = f.T;
      f.bg = (s.bg || []).map(b => { const q = this.flowPlan(b, ms, { bg: true }); q.s = b; return q; }).filter(q => q.segs.length);
      for (const q of f.bg) f.T = Math.max(f.T, f.pan + q.Tm);
      f.cam = this.flowCamera(f);
      // the first token in parallel: its times from the real zoom too, where the camera follows
      // it (fol), and at most 12 times closer than its own goal
      const q = f.bg[0];
      if (q && f.cam.fol.some(Boolean)) {
        const c = f.cam;
        let Tm = 0;
        for (const sg of q.segs) {
          if (!sg.unit) {
            const a = Math.floor((f.pan + sg.t0 * q.Tm) / c.dtS), b = Math.min(c.n - 1, Math.ceil((f.pan + sg.t1 * q.Tm) / c.dtS));
            let lr = Infinity;
            for (let i = Math.max(0, a); i <= b; i++) if (c.fol[i]) lr = Math.min(lr, c.L[i]);
            if (isFinite(lr)) sg.dt = Math.max(sg.dt, Math.max(0.2, sg.len * this.pxAt(clamp(Math.exp(lr), sg.ctx.r / 12, sg.ctx.r)) / FLOW_PX_S) * 1000 * k);
          }
          Tm += sg.dt;
        }
        Tm = Math.max(120, Tm);
        let t = 0;
        for (const sg of q.segs) { sg.t0 = t / Tm; t += sg.dt; sg.t1 = Math.min(1, t / Tm); }
        q.Tm = q.T = Tm;
        f.T = Math.max(f.T, f.pan + Tm);
        f.cam = this.flowCamera(f);
      }
      this.flowCache = { s, ms, now, f };
      return f;
    }
    // ---------- Explain (the director is in explain3d.js) ----------
    // o = { shots: a fixed camera shot for each trace step, spot: the spotlight } or null (off).
    xpSet(o) {
      this.xp = o || null;
      this.xpIds = null; this.spotKey = '';
      if (o && !this.spotCv) {
        this.spotCv = htmlEl('canvas', { class: 'bv-spot', 'aria-hidden': 'true' }, this.root);
        this.spotG = this.spotCv.getContext('2d');
      }
      if (this.spotCv) this.spotCv.hidden = !o;
      if (o && this.bcard && this.bcard.min) this.bcard.setMin(false);
      this.dirty = true;
    }
    // The world box of a part of the board (a chip by its glow id, the CGA card, the monitor,
    // the drive cage, or 'die:<key>' for an opened die).
    xpBox(id) {
      if (this.xpBoxes.has(id)) return this.xpBoxes.get(id);
      let obj = null;
      if (id === 'monitor') obj = this.monitor;
      else if (id === 'cga') obj = this.card;
      else if (id === 'drives') obj = this.bay;
      else if (id.startsWith('die:')) { const e = this.decaps.get(id.slice(4)); obj = e ? e.mesh : null; }
      else if (id === 'screenTL' && this.scrMesh) {          // the top-left quarter of the screen (the first cells and the corner)
        const s = this.scrMesh, box = new T.Box3();
        s.updateWorldMatrix(true, false);
        for (const [x, y] of [[-5.7, 4.4], [0.6, 4.4], [-5.7, 0.4], [0.6, 0.4]]) box.expandByPoint(s.localToWorld(new T.Vector3(x, y, 0.33)));
        this.xpBoxes.set(id, box);
        return box;
      }
      else if (this.glows[id]) obj = this.glows[id].obj;
      const box = obj ? new T.Box3().setFromObject(obj) : null;
      if (box && !id.startsWith('die:')) this.xpBoxes.set(id, box);
      return box;
    }
    // The tour: light these parts only, and fly to them (o.fly: false = keep the camera).
    xpFocus(ids, o = {}) {
      this.xpIds = ids || [];
      this.xpForce = true;                           // (the spotlight of these parts, not of the step)
      this.spotKey = '';
      this.dirty = true;
      if (o.fly === false || !ids || !ids.length) return;
      // one die: the die framing of the trace
      if (ids.length === 1 && ids[0].startsWith('die:') && this.runner && !this.tr) {
        const e = this.dieEntry(ids[0].slice(4));
        if (e) {
          const K = this.runner.dieKit(e), g = this.segCtx({ dive: { e, nrm: K.nrm, upv: this.dieUp(e) } }, false);
          this.flyTo(g.tgt, g.th, g.phi, g.r);
          return;
        }
      }
      const box = new T.Box3();
      for (const id of ids) { const b = this.xpBox(id); if (b) box.union(b); }
      if (box.isEmpty()) return;
      const sh = this.xpShotBox(box, o.theta, o.phi, o.keepY);
      if (this.tr) {                                 // a step is on: its shot moves the camera
        const c = this.cam;
        this.tr.camB = { v0: { t: c.target.clone(), r: c.r, th: c.theta, ph: c.phi, up: (this.camUp || new T.Vector3(0, 1, 0)).clone() }, t0: animNow(), dur: 1100 };
        this.tr.shot = sh; this.tr.shots = null;
      } else this.flyTo(sh.tgt, sh.th, sh.phi, sh.r);
    }
    // A shot that frames a world box (the camera keeps a pleasant fixed angle).
    xpShotBox(box, theta = 0.22, phi = 0.85, keepY = false) {
      const ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
      const KF = 2 * Math.tan(this.camera.fov * Math.PI / 360), asp = this.camera.aspect || 1.6;
      const { right: monW } = this.trCover(true);
      const free = this.w > 0 ? clamp((this.w - monW) / this.w, 0.45, 1) : 1;
      // the box on the screen: its width, and its height as the camera sees it (the depth
      // shortened by the tilt, the height of a standing part stretched)
      const vert = sz.z * Math.cos(phi) + sz.y * Math.sin(phi);
      const pad = keepY ? 0.4 : 1.5;
      const r = clamp(Math.max((sz.x + pad) / (KF * asp * free), (vert + pad) / (KF * 0.62)) * 1.12 + (keepY ? 0.3 : 1.5), 1.2, this.fitRadius());
      if (monW && this.h) ctr.addScaledVector(new T.Vector3(Math.cos(theta), 0, -Math.sin(theta)), (monW / 2) * KF * r / this.h);
      if (!keepY) ctr.y = clamp(ctr.y, 0, 3);
      return { tgt: ctr, r, th: theta, phi, up: null };
    }
    // The shot of a trace step: the whole die for a step inside one chip, else the whole path.
    xpShot(J) {
      const segs = J.segs;
      if (!segs.length) return null;
      const e0 = segs[0].dive ? segs[0].dive.e : null;
      if (e0 && segs.every(g => g.dive && g.dive.e === e0)) {
        const g = this.segCtx({ dive: segs[0].dive }, false);
        return { tgt: g.tgt, r: g.r, th: g.th, phi: g.phi, up: g.up };
      }
      const box = new T.Box3();
      for (const g of segs) for (const q of g.pts) box.expandByPoint(q);
      return this.xpShotBox(box);
    }
    // The camera: from the view at the start of the move (B.v0) to the shot, then still. The zoom
    // and the pan follow the path of van Wijk and Nuij (zoomPath): for a long way the camera goes
    // out, across and in again, so the picture moves at an even speed on the screen.
    xpCamera(shot, B, now) {
      if (!shot) return;
      const c = this.cam, v = B ? B.v0 : null;
      const u = v ? clamp((now - B.t0) / (B.dur || 1), 0, 1) : 1, sm = u * u * u * (u * (6 * u - 15) + 10);
      let th = shot.th;
      if (v) { while (th - v.th > Math.PI) th -= TAU; while (th - v.th < -Math.PI) th += TAU; }
      if (v) {
        const D = v.t.distanceTo(shot.tgt), KW = 2 * Math.tan(this.camera.fov * Math.PI / 360) * (this.camera.aspect || 1.6);
        const q = zoomPath([0, 0, KW * v.r], [D, 0, KW * shot.r]).at(sm);
        c.target.copy(v.t).lerp(shot.tgt, D > 1e-9 ? clamp(q[0] / D, 0, 1) : sm);
        c.r = q[2] / KW;
        if (!(c.r > 0) || !isFinite(c.r)) c.r = Math.exp(Math.log(v.r) + (Math.log(shot.r) - Math.log(v.r)) * sm);
      } else { c.target.copy(shot.tgt); c.r = shot.r; }
      c.theta = v ? v.th + (th - v.th) * sm : th; c.phi = v ? v.ph + (shot.phi - v.ph) * sm : shot.phi;
      c.g.target.copy(c.target); c.g.r = c.r; c.g.theta = c.theta; c.g.phi = c.phi;
      c.follow.set(0, 0, 0);
      const up = shot.up || new T.Vector3(0, 1, 0);
      this.trUpNow = v ? v.up.clone().lerp(up, sm).normalize() : up.clone();
    }
    // The spotlight: the whole view dark, except soft openings around the path of the trace step
    // (and the dies it visits), or around the parts of xpFocus.
    drawSpot(now) {
      const cv = this.spotCv;
      if (!cv || !this.xp || !this.xp.spot) return;
      const w = this.w, h = this.h, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); this.spotKey = ''; }
      const cam = this.camera, P = new T.Vector3();
      const scr = p => { P.copy(p).project(cam); return P.z > 1 ? null : [(P.x + 1) / 2 * w, (1 - P.y) / 2 * h]; };
      const rects = [], paths = [];
      const boxRect = b => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
        for (let i = 0; i < 8; i++) {
          const q = scr(new T.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
          if (!q) continue;
          n++; x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
        }
        if (n) rects.push([x0, y0, x1 - x0, y1 - y0]);
      };
      const tr = this.tr;
      let uR = null;
      if (tr && tr.rider && !this.xpForce) {
        const dies = new Set();
        for (const g of tr.rider.J.segs) {
          if (g.dive) dies.add(g.dive.e);
          const pts = g.pts.map(scr).filter(Boolean);
          if (pts.length > 1) paths.push(pts);
        }
        for (const e of dies) { const b = new T.Box3().setFromObject(e.mesh); boxRect(b); }
        if (tr.rider.at) { const q = scr(tr.rider.at.pos); if (q) rects.push([q[0] - 40, q[1] - 40, 80, 80]); }
        // a unit at work: the other units of its die go dim too (their names do not compete with it)
        const sg = tr.rider.at && tr.rider.at.seg;
        if (sg && sg.unit && sg.card && sg.dive && tr.rider.E < 1) uR = this.blockScreen(sg.dive.e, sg.block);
      } else if (this.xpIds) for (const id of this.xpIds) { const b = this.xpBox(id); if (b) boxRect(b); }
      // (the dim around the unit fades in and out)
      this.spotU = (this.spotU || 0) + ((uR ? 1 : 0) - (this.spotU || 0)) * 0.12;
      if (!uR && this.spotU < 0.02) this.spotU = 0;
      if (uR) this.spotUR = uR;
      const uA = this.spotU && this.spotUR ? this.spotU : 0, UR = this.spotUR;
      const key = [w, h, ...rects.map(r => r.map(v => Math.round(v / 3)).join(',')), ...paths.map(p => p.length + ':' + Math.round(p[0][0] / 3) + ',' + Math.round(p[p.length - 1][1] / 3)),
        Math.round(uA * 25), uA ? [UR.x, UR.y, UR.w, UR.h].map(v => Math.round(v / 3)).join(',') : ''].join('|');
      if (key === this.spotKey) return;
      this.spotKey = key;
      const g = this.spotG;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(7, 4, 11, 0.74)';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      g.filter = 'blur(16px)';
      g.fillStyle = '#000'; g.strokeStyle = '#000';
      for (const [x, y, rw, rh] of rects) { g.beginPath(); g.roundRect ? g.roundRect(x - 22, y - 22, rw + 44, rh + 44, 26) : g.rect(x - 22, y - 22, rw + 44, rh + 44); g.fill(); }
      g.lineWidth = 46; g.lineJoin = 'round'; g.lineCap = 'round';
      for (const pts of paths) { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); }
      g.filter = 'none';
      if (uA) {
        // all but the unit at work: a second dim layer
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(7, 4, 11, ${(0.6 * uA).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-out';
        g.filter = 'blur(8px)';
        g.fillStyle = '#000';
        const m = 12;
        g.beginPath(); g.roundRect ? g.roundRect(UR.x - m, UR.y - m, UR.w + 2 * m, UR.h + 2 * m, 12) : g.rect(UR.x - m, UR.y - m, UR.w + 2 * m, UR.h + 2 * m); g.fill();
        g.filter = 'none';
      }
      g.globalCompositeOperation = 'source-over';
    }
    // The trace outside Explain: while a unit of a die works and it is large on the screen, the
    // rest of the view goes dim (the same second layer as the spotlight of Explain), so the eye goes
    // to the unit and its drawing. It fades in and out.
    drawUnitDim() {
      const r = this.tr && this.tr.rider, sg = r && r.at && r.at.seg;
      let uR = null;
      if (sg && sg.unit && sg.card && sg.dive && r.E < 1 && !this.reduced) {
        const R = this.blockScreen(sg.dive.e, sg.block);
        if (R && R.w > 110 && R.h > 70) uR = R;
      }
      this.udimA = (this.udimA || 0) + ((uR ? 1 : 0) - (this.udimA || 0)) * 0.12;
      if (!uR && this.udimA < 0.02) this.udimA = 0;
      if (uR) this.udimR = uR;
      if (!this.udimA) {
        if (this.spotCv && !this.spotCv.hidden) { this.spotCv.hidden = true; this.spotKey = ''; }
        return;
      }
      if (!this.spotCv) {
        this.spotCv = htmlEl('canvas', { class: 'bv-spot', 'aria-hidden': 'true' }, this.root);
        this.spotG = this.spotCv.getContext('2d');
      }
      const cv = this.spotCv, w = this.w, h = this.h, dpr = Math.min(2, window.devicePixelRatio || 1), U = this.udimR, a = this.udimA;
      cv.hidden = false;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); this.spotKey = ''; }
      const key = ['u', w, h, Math.round(a * 25), ...[U.x, U.y, U.w, U.h].map(v => Math.round(v / 3))].join('|');
      if (key === this.spotKey) return;
      this.spotKey = key;
      const g = this.spotG;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(7, 4, 11, ${(0.55 * a).toFixed(3)})`;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      g.filter = 'blur(8px)';
      g.fillStyle = '#000';
      const m = 12;
      g.beginPath(); g.roundRect ? g.roundRect(U.x - m, U.y - m, U.w + 2 * m, U.h + 2 * m, 12) : g.rect(U.x - m, U.y - m, U.w + 2 * m, U.h + 2 * m); g.fill();
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    }
    // Where the token of a plan is e ms after the start of the step (null during the pan).
    planAt(p, e) {
      if (e < p.pan || !p.segs.length) return null;
      return this.riderAt({ J: { segs: p.segs } }, (e - p.pan) / p.Tm);
    }
    // The camera track of a step: the goal of the part where the token is (target, log r,
    // theta, phi, up), sampled at 60 Hz, with a look-ahead (the view zooms out before the token
    // leaves a close part), smoothed in both directions, with limits for the zoom and the pan in
    // each frame. The start: a zoom path from the camera now (the pan), or a short blend.
    // After the main token, the camera follows a token in parallel when it is in the same die.
    flowCamera(f) {
      const dtS = 1000 / 60, n = Math.max(2, Math.ceil(f.T / dtS) + 1), c = this.cam;
      const mk = () => new Float64Array(n);
      const X = mk(), Y = mk(), Z = mk(), LR = mk(), TH = mk(), PH = mk(), UX = mk(), UY = mk(), UZ = mk(), FOL = new Uint8Array(n);
      const lastSg = f.segs[f.segs.length - 1], endDie = lastSg && lastSg.dive ? lastSg.dive.e : null;
      let th0 = c.theta, bgOn = false;
      for (let i = 0; i < n; i++) {
        const e = i * dtS;
        let at = this.planAt(f, Math.min(e, f.pan + f.Tm)), wide = false;
        // after the main token: the token in parallel when it is in the same die; until then the
        // whole die (so the camera does not wait close on the last unit)
        if (f.bg && f.bg.length && e > f.pan + f.Tm) {
          const ab = this.planAt(f.bg[0], e - f.pan);
          if (endDie && ab && ab.E < 1 && ab.dive && ab.dive.e === endDie) bgOn = true;
          if (bgOn && ab) { at = ab; FOL[i] = 1; }
          else wide = !!(at && at.dive && at.seg.unit && f.bg.some(q => e - f.pan < q.Tm));
        }
        const sg = at ? at.seg : f.segs[0];
        let g = sg ? sg.ctx : null;
        if (wide) g = sg.ctxDie || (sg.ctxDie = this.segCtx({ dive: sg.dive }, false));
        const pos = at ? at.pos : sg ? sg.pts[0] : c.target;
        if (g && g.tgt) { X[i] = g.tgt.x; Y[i] = g.tgt.y; Z[i] = g.tgt.z; } else { X[i] = pos.x; Y[i] = Math.min(pos.y, 1.2); Z[i] = pos.z; }
        LR[i] = Math.log(g ? g.r : c.r);
        PH[i] = g ? g.phi : c.phi;
        let th = g && g.th !== null ? g.th : th0;
        while (th - th0 > Math.PI) th -= TAU;
        while (th - th0 < -Math.PI) th += TAU;
        TH[i] = th0 = th;
        if (g && g.up) { UX[i] = g.up.x; UY[i] = g.up.y; UZ[i] = g.up.z; } else { UX[i] = 0; UY[i] = 1; UZ[i] = 0; }
      }
      const ahead = Math.round(250 / dtS), L2 = mk();
      for (let i = 0; i < n; i++) { let m = LR[i]; for (let j = i + 1; j <= Math.min(n - 1, i + ahead); j++) m = Math.max(m, LR[j]); L2[i] = m; }
      const smoothA = (a, tau) => {
        const al = 1 - Math.exp(-dtS / tau);
        for (let i = 1; i < a.length; i++) a[i] = a[i - 1] + (a[i] - a[i - 1]) * al;
        for (let i = a.length - 2; i >= 0; i--) a[i] = a[i + 1] + (a[i] - a[i + 1]) * al;
      };
      smoothA(L2, 260); smoothA(X, 180); smoothA(Y, 180); smoothA(Z, 180);
      smoothA(TH, 300); smoothA(PH, 300); smoothA(UX, 300); smoothA(UY, 300); smoothA(UZ, 300);
      // the zoom limit, forward and backward (so a zoom out starts early enough)
      for (let i = 1; i < n; i++) L2[i] = clamp(L2[i], L2[i - 1] - CAM_DLZ, L2[i - 1] + CAM_DLZ);
      for (let i = n - 2; i >= 0; i--) L2[i] = clamp(L2[i], L2[i + 1] - CAM_DLZ, L2[i + 1] + CAM_DLZ);
      // the pan limit (screen px at the zoom of that moment), forward and backward
      const lim = (i, j) => {
        const dx = X[i] - X[j], dy = Y[i] - Y[j], dz = Z[i] - Z[j], d = Math.hypot(dx, dy, dz) * this.pxAt(Math.exp(L2[i]));
        if (d > CAM_DPX) { const q = CAM_DPX / d; X[i] = X[j] + dx * q; Y[i] = Y[j] + dy * q; Z[i] = Z[j] + dz * q; }
      };
      for (let i = 1; i < n; i++) lim(i, i - 1);
      for (let i = n - 2; i >= 0; i--) lim(i, i + 1);
      const v0 = { t: c.target.clone().add(c.follow), r: c.r, th: c.theta, ph: c.phi, up: (this.camUp || new T.Vector3(0, 1, 0)).clone() };
      if (f.pan) {
        const np = Math.min(n - 1, Math.round(f.pan / dtS)), KW = 2 * Math.tan(this.camera.fov * Math.PI / 360) * (this.camera.aspect || 1.6);
        const B = new T.Vector3(X[np], Y[np], Z[np]), D = v0.t.distanceTo(B);
        const zp = zoomPath([0, 0, KW * v0.r], [D, 0, KW * Math.exp(L2[np])]);
        for (let i = 0; i < np; i++) {
          const u = i / np, sm = u * u * (3 - 2 * u), q = zp.at(sm), w = D > 1e-9 ? q[0] / D : sm;
          X[i] = v0.t.x + (B.x - v0.t.x) * w; Y[i] = v0.t.y + (B.y - v0.t.y) * w; Z[i] = v0.t.z + (B.z - v0.t.z) * w;
          L2[i] = Math.log(q[2] / KW);
          TH[i] = v0.th + (TH[np] - v0.th) * sm; PH[i] = v0.ph + (PH[np] - v0.ph) * sm;
          UX[i] = v0.up.x + (UX[np] - v0.up.x) * sm; UY[i] = v0.up.y + (UY[np] - v0.up.y) * sm; UZ[i] = v0.up.z + (UZ[np] - v0.up.z) * sm;
        }
      }
      return { n, dtS, X, Y, Z, L: L2, TH, PH, UX, UY, UZ, v0, blend: f.pan ? 0 : 350, fol: FOL };
    }
    // The camera on its track (the time of the step now), with a blend from the view at the
    // start of the step or when the user gives the camera back.
    trTrack() {
      const t = this.tr, C = t.cam, c = this.cam, now = animNow();
      if (t.shots && t.shots.length > 1 && now > t.t0) {
        const e = now - t.t0;
        let j = 0;
        while (j + 1 < t.shots.length && e >= t.shots[j + 1].ts - t.shots[j + 1].blend) j++;
        if (j > 0) {
          const A = t.shots[j - 1].shot, bl = t.shots[j].blend, Bv = { v0: { t: A.tgt.clone(), r: A.r, th: A.th, ph: A.phi, up: (A.up || new T.Vector3(0, 1, 0)).clone() }, t0: t.t0 + t.shots[j].ts - bl, dur: bl };
          this.xpCamera(t.shots[j].shot, Bv, now);
          return;
        }
      }
      if (t.shot) { this.xpCamera(t.shot, t.camB, now); return; }
      if (!this.trTrackOn) {
        this.trTrackOn = true;
        if (now - t.tStart > 50) t.camB = { v0: { t: c.target.clone().add(c.follow), r: c.r, th: c.theta, ph: c.phi, up: (this.camUp || new T.Vector3(0, 1, 0)).clone() }, t0: now, dur: 700 };
      }
      const x = clamp((now - t.tStart) / (t.sc || 1) / C.dtS, 0, C.n - 1), a = Math.floor(x), f = x - a, b = Math.min(C.n - 1, a + 1);
      const at = A => A[a] + (A[b] - A[a]) * f;
      let tx = at(C.X), ty = at(C.Y), tz = at(C.Z), lr = at(C.L), th = at(C.TH), ph = at(C.PH);
      const up = new T.Vector3(at(C.UX), at(C.UY), at(C.UZ));
      const B = t.camB;
      if (B && B.dur && now - B.t0 < B.dur) {
        const u = clamp((now - B.t0) / B.dur, 0, 1), sm = u * u * (3 - 2 * u), v = B.v0;
        let t0 = v.th;
        while (th - t0 > Math.PI) t0 += TAU;
        while (th - t0 < -Math.PI) t0 -= TAU;
        tx = v.t.x + (tx - v.t.x) * sm; ty = v.t.y + (ty - v.t.y) * sm; tz = v.t.z + (tz - v.t.z) * sm;
        lr = Math.log(v.r) + (lr - Math.log(v.r)) * sm;
        th = t0 + (th - t0) * sm; ph = v.ph + (ph - v.ph) * sm;
        up.set(v.up.x + (up.x - v.up.x) * sm, v.up.y + (up.y - v.up.y) * sm, v.up.z + (up.z - v.up.z) * sm);
      }
      c.follow.set(0, 0, 0);
      c.target.set(tx, ty, tz); c.r = Math.exp(lr); c.theta = th; c.phi = ph;
      c.g.target.copy(c.target); c.g.r = c.r; c.g.theta = th; c.g.phi = ph;
      this.trUpNow = up.lengthSq() > 1e-9 ? up.normalize() : new T.Vector3(0, 1, 0);
    }
    addFlow(pts, o) {
      if (!pts || pts.length < 2) return null;
      const mesh = this.flowMesh(pts, o.hw || 0.075);
      mesh.material.uniforms.uTail.value = o.tail || 1.2;
      // lines on the board go under the chip packages; lines on a die stay on top of it
      if (o.depth) mesh.material.depthTest = true;
      this.trG.add(mesh);
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
      const f = { mesh, pts, cum, len: cum[cum.length - 1], t0: o.t0, dur: o.dur, cyc: o.cyc, fadeT: 0, born: o.born || o.t0, rider: o.rider || null, si: o.si === undefined ? -1 : o.si, head: 0 };
      mesh.material.uniforms.uColor.value.set(o.col);
      this.flows.push(f);
      return f;
    }
    // The flows and the token of one step. done: put them in their end state (for Back).
    // opt.bg: a token in parallel (thin dim lines, a small token).
    stepFlows(s, t0, dur, cyc, done, opt = {}) {
      const J = this.trJourney(s), v = J.v;
      const rider = { J, t0, dur, cyc, E: done ? 1 : 0, orb: null, lastSeg: -1, s, done: !!done, bg: !!opt.bg, at: null };
      const col = this.trColor(s.token.col);
      J.segs.forEach((sg, si) => {
        if (sg.pts.length < 2 || sg.len < 1e-6) return;
        // inside a die the lines are thin and dim, so they do not cover the units' work
        const w = (sg.dive ? sg.dive.s * 0.01 : 0.08) * (opt.bg ? 0.6 : 1);
        const f = this.addFlow(sg.pts, { t0, dur, cyc, col, rider, si, hw: w, tail: sg.dive ? sg.dive.s * 0.6 : 1.2, born: done ? t0 - 1e6 : t0, depth: !sg.dive });
        if (f) f.amax = (sg.dive ? 0.5 : 1) * (opt.bg ? 0.5 : 1);
      });
      if (!opt.bg) for (const x of v.extra) this.addFlow(x, { t0: t0 + dur * 0.35, dur: dur * 0.3, cyc, col: THEME.magenta, hw: 0.05, depth: true });
      if (done) for (const f of this.flows) if (f.cyc === cyc && !f.rider) f.t0 = t0 - 1e6;
      if (!done && J.segs.length) {
        rider.orb = this.makeOrb(v.col);
        rider.orb.born = t0;
        if (opt.bg) rider.orb.small = 0.6;
        this.trOrbs.push({ o: rider.orb, cyc, rider });
      }
      return rider;
    }
    traceStep(story, i, info) {
      if (!this.ok) return;
      if (!story) { this.traceClear(); return; }
      info = info || {};
      const now = animNow();
      const s = story.steps[i];
      const f = this.flowFull(s, this.app.stepMs, now);   // (the speed setting; info.ms is the time of the step)
      const xps = !!(this.xp && this.xp.shots);
      const sc = info.ms ? Math.max(160, info.ms) / f.T : 1;
      const X = xps ? this.xpPlan(s, s._ms !== undefined ? s._ms : this.app.stepMs) : null;
      const lead = xps ? s._xpLead || 900 : 0;
      const transit = xps ? lead : f.pan * sc, dur = Math.max(120, xps ? X.Tm : f.Tm * sc);
      const cycOf = x => (x.kind === 'inside' ? null : x.e || x);
      const cyc = cycOf(s);
      const replay = this.tr && this.tr.story === story && (info.back || i !== this.tr.i + 1);
      if (replay) {
        // Back, or a jump in the list: put the earlier steps back in their end state
        this.flowsClear();
        for (let k = 0; k < i; k++) {
          const x = story.steps[k], c = cycOf(x);
          this.stepFlows(x, now, 1, c, true);
          if (c !== cyc) for (const fl of this.flows) if (fl.cyc === c) fl.fadeT = now - 900;
        }
        this.trCyc = undefined;
      }
      for (const t of this.trOrbs) if (t.cyc === null && !t.o.fadeT) t.o.fadeT = now;
      if (cyc !== this.trCyc) {
        for (const fl of this.flows) if (fl.cyc !== cyc && !fl.fadeT) fl.fadeT = now;
        for (const t of this.trOrbs) if (t.cyc !== cyc && !t.o.fadeT) t.o.fadeT = now;
        this.trHeld.clear();
        this.trCyc = cyc;
      }
      // the tokens in parallel of the last step end with it
      for (const t of this.trOrbs) if (t.rider && t.rider.bg && !t.o.fadeT) t.o.fadeT = now;
      // the data of a read leaves from the target, where the address and the command wait
      if (s.phase === 'data' && s.I && s.I.read) for (const t of this.trOrbs) if (t.cyc === cyc && !t.o.fadeT) t.o.fadeT = now + transit;
      if (this.tr && this.tr.v && cycOf(this.tr.s) === cyc) for (const id of this.tr.v.to.concat(this.tr.v.mid)) this.trHeld.add(id);
      const rider = this.stepFlows(s, now + transit, dur, cyc, false);
      const bg = f.bg.map(q => this.stepFlows(q.s, now + transit, Math.max(120, q.Tm * sc), cyc, false, { bg: true }));
      this.tr = { story, i, s, v: this.trSpec(s), t0: now + transit, dur, cyc, rider, orb: rider.orb, transit, tStart: now, bg, cam: f.cam, sc, camB: { v0: f.cam.v0, t0: now, dur: f.cam.blend } };
      this.trTrackOn = false;
      if (xps) {
        this.tr.shots = X.scenes; this.tr.shot = X.scenes[0].shot; this.tr.camB = { v0: f.cam.v0, t0: now, dur: lead }; this.xpForce = false; this.spotKey = '';
        this.xpPrefetch(s, s._ms !== undefined ? s._ms : this.app.stepMs, true);
      }
      if (rider.J.end) this.flowLast = rider.J.end.clone();
      this.trSetLabels(this.tr.v);
      this.trG.visible = true;
      this.dirty = true;
    }
    flowsClear() {
      for (const f of this.flows) { this.trG.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); }
      for (const t of this.trOrbs) this.dropOrb(t.o);
      this.flows = []; this.trOrbs = [];
      this.trHeld.clear();
    }
    traceClear() {
      this.tr = null;
      this.trCyc = undefined;
      this.trHold = null;
      if (!this.trG) return;
      this.flowsClear();
      this.trSetLabels(null);
      this.trTok.style.opacity = 0;
      if (this.trDot) this.trDot.style.opacity = 0;
      this.trWin = null;
      this.unitWindow(null, 0);
      if (this.uTagEl) this.uTagEl.style.opacity = 0;
      this.showCard(null);
      if (this.bGlows) for (const g of this.bGlows.values()) g.tgt = 0;
      if (this.uFx) for (const o of this.uFx.values()) { o.tgt = 0; o.v = 0; o.mat.opacity = 0; o.mesh.visible = false; }
      this.lastUnit = null;
      this.dirty = true;
    }
    // Chip labels: new ones fade in, the old ones fade out (they are not reused).
    trSetLabels(v) {
      const rn = performance.now();
      for (const L of this.trLabs) if (!L.dying) { L.dying = rn; L.el.style.opacity = 0; }
      if (v) for (const w of v.labels) {
        const el = htmlEl('div', { class: 'bv-lab ' + (w.cls || '') }, this.trLayer, w.text);
        this.trLabs.push({ el, at: w.at ? w.at.clone() : this.trPos(w.id), born: rn, dying: 0 });
      }
    }
    // When the caption bar of the trace covers the bottom of the view (it is now under the view,
    // so only a small window can make it cover), move the picture up by half of the part that it
    // covers, so the middle of the free part is the middle of the view.
    trViewOffset() {
      const bar = this.tr ? document.getElementById('trace') : null;
      let hgt = 0;
      if (bar && !bar.hidden && bar.offsetParent) {
        const a = bar.getBoundingClientRect(), b = this.host.getBoundingClientRect();
        if (a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left) hgt = b.bottom - a.top + 10;
      }
      const want = Math.round(Math.min(hgt, this.h * 0.5) / 2);
      if (Math.abs(want - (this.trOff || 0)) < 3) return;
      this.trOff = want;
      if (want) this.camera.setViewOffset(this.w, this.h, 0, want, this.w, this.h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
    // Where the token of a rider is at its progress E (0..1 of the time of its parts). It moves
    // at a constant speed; in a unit it comes in, waits at the working part, and goes out.
    riderAt(r, E) {
      const segs = r.J.segs;
      if (!segs.length) return null;
      E = clamp(E, 0, 1);
      // Explain: the token speeds up and slows down in each run of moves
      if (r.J.runs && this.xp && this.xp.shots && !r.bg && !this.reduced) E = this.xpEase(r.J.runs, E);
      let i = 0;
      while (i < segs.length - 1 && segs[i].t1 <= E) i++;
      const sg = segs[i], local = clamp((E - sg.t0) / Math.max(1e-6, sg.t1 - sg.t0), 0, 1);
      let d = (this.reduced ? 1 : local) * sg.len;
      if (sg.unit && !this.reduced) {
        const dc = sg.cum[sg.ci || 0];
        const xs = sg.xp && this.xp && this.xp.shots, fi = xs ? sg.fin : sg.fin || FLOW_IN, fo = xs ? sg.fout : sg.fout || FLOW_IN;
        d = local < fi ? dc * (local / fi) : local > 1 - fo ? dc + (sg.len - dc) * ((local - 1 + fo) / Math.max(1e-9, fo)) : dc;
      }
      let j = 0;
      while (j < sg.pts.length - 2 && sg.cum[j + 1] < d) j++;
      const a = sg.pts[j], b = sg.pts[Math.min(j + 1, sg.pts.length - 1)];
      const pos = a.clone().lerp(b, clamp((d - sg.cum[j]) / ((sg.cum[j + 1] - sg.cum[j]) || 1), 0, 1));
      return { pos, seg: sg, i, local, dive: sg.dive, d, E };
    }
    // The camera: still over a whole die while the token is in a chip (only the inside
    // moves); it frames the path while the token travels over the board.
    trCamGoal() {
      const t = this.tr, c = this.cam;
      if (!t || !t.rider || !t.rider.J.segs.length) return false;
      const now = animNow(), r = t.rider;
      const at = this.riderAt(r, now < r.t0 ? 0 : r.E);
      if (!at) return false;
      const k = 2 * Math.tan(this.camera.fov * Math.PI / 360), asp = this.camera.aspect || 1.6;
      let rr, phi = c.g.phi, th = c.g.theta;
      if (at.dive) {
        const e = at.dive.e, L = this.layOf(e), n = at.dive.nrm || new T.Vector3(0, 1, 0);
        const dw = L.dw / e.cw * e.d.L * 0.97, dh = L.dh / e.ch * e.d.W * 0.94;
        // the block card covers the left part of the view and the screen may cover the
        // right part: fit the die in the free part between them
        const { left: cardW, right: monW } = this.trCover();
        const free = this.w > 0 ? clamp((this.w - cardW - monW) / this.w, 0.35, 1) : 1;
        const up = at.dive.upv || new T.Vector3(0, 0, -1);
        // the die text runs along the canvas x axis: its world direction is up × normal
        const side = Math.abs(n.y) > 0.7 ? Math.max(dw, dh) : dw;
        // the trace bar covers the bottom (the view offset moves the picture up) and the
        // camera buttons the top: fit the die height in the rest
        const freeH = this.h > 0 ? clamp((this.h - 2 * (this.trOff || 0) - 56) / this.h, 0.35, 1) : 1;
        rr = Math.max(side / (k * asp * free), dh / (k * freeH)) * 1.1;
        phi = Math.max(0.06, Math.acos(clamp(n.y, -1, 1)));
        if (n.y < 0.7) { th = Math.atan2(n.x, n.z); this.trUpGoal = up.clone(); }
        else { this.trUpGoal = null; th = Math.atan2(-up.x, -up.z); }
        const ctr = this.dieW(e, [e.cw / 2, e.ch / 2], 0.006);
        // move the die to the middle of the free part of the view
        if (cardW || monW) {
          const right = new T.Vector3().crossVectors(up, n).normalize();
          const upp = k * rr / Math.max(1, this.h);   // world units per screen px at the die
          ctr.addScaledVector(right, -((cardW - monW) / 2) * upp);
        }
        c.g.target.copy(ctr);
      } else {
        const sg = at.seg, box = new T.Box3();
        for (const p of sg.pts) box.expandByPoint(p);
        const ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
        rr = clamp(Math.max(sz.x / (k * asp), sz.z / k) * 1.25 + 3, 5, this.fitRadius());
        phi = 0.62;
        this.trUpGoal = null;
        c.g.target.copy(ctr).setY(Math.min(ctr.y, 1.2));
      }
      while (th - c.theta > Math.PI) th -= TAU;
      while (th - c.theta < -Math.PI) th += TAU;
      c.g.r = rr; c.g.phi = phi; c.g.theta = th;
      return true;
    }
    // Explain: the parts of the view that the player covers: the card of the unit at the left
    // (always there in Explain), the program strip at the top and the caption bar at the bottom
    // (in px of the view). Else only the card and the screen (trCover).
    xpCovers() {
      const tc = this.trCover(true), out = { left: tc.left, right: tc.right, top: 0, bottom: 0 };
      if (!this.xp || !this.renderer) return out;
      // (Explain has no card at the side of a unit: only the clock card of the tour)
      out.left = this.xpCard ? (this.cardEl && this.cardEl.offsetWidth || 450) + 24 : 0;
      const hr = this.renderer.domElement.getBoundingClientRect();
      if (!hr.height) return out;
      const P = this.root.querySelector('.xp3-prog'), B = this.root.querySelector('.xp3-bar');
      if (P && P.offsetParent) out.top = clamp(P.getBoundingClientRect().bottom - hr.top + 8, 0, hr.height * 0.4);
      if (B && B.offsetParent) out.bottom = clamp(hr.bottom - B.getBoundingClientRect().top + 8, 0, hr.height * 0.5);
      this.xpTopPx = out.top;
      return out;
    }
    // The parts of the view that other things cover: the block card at the left, and the
    // screen (the floating monitor) at the right when it is tall.
    // trace: for the plan of a step (the card takes its space during all of the trace).
    trCover(trace) {
      let min = true;
      if (this.bcard) min = this.bcard.min;
      else { try { const v = localStorage.getItem('a86:boardCardMin'); if (v !== null) min = v === 'true'; } catch (err) { /* the default */ } }
      const left = min ? 0 : trace ? (this.cardEl && this.cardEl.offsetWidth || 300) + 24 : this.cardEl && this.cardShown ? this.cardEl.offsetWidth + 24 : 0;
      let right = 0;
      const mon = document.getElementById('monitor'), hr = this.host.getBoundingClientRect();
      if (mon && !mon.hidden && mon.offsetParent && hr.width) {
        const r = mon.getBoundingClientRect();
        if (r.left > hr.left + hr.width * 0.45 && r.bottom - hr.top > hr.height * 0.3 && r.top < hr.bottom) right = Math.max(0, hr.right - r.left + 12);
      }
      return { left, right: Math.min(right, hr.width * 0.45) };
    }
    // The chip where the token of the current step is ('board' between chips).
    trChipKey() {
      const t = this.tr, r = t && t.rider;
      if (!r) return null;
      const at = this.riderAt(r, animNow() < r.t0 ? 0 : r.E);
      return at ? (at.dive ? at.dive.e.key : 'board') : null;
    }
    // True while the user holds the camera (the token is still in the same chip).
    trHeldNow() {
      if (!this.trHold) return false;
      const k = this.trChipKey();
      if (k && k !== this.trHold) { this.trHold = null; this.trCV.set(0, 0, 0); this.trRV.set(0, 0, 0); return false; }
      return true;
    }
    // Springs for the camera: target, and (log r, phi, theta). No sudden start or stop.
    trCamStep() {
      const c = this.cam, rn = performance.now();
      let ms = clamp(rn - (this.trCamT || rn - 16), 0, 250);
      this.trCamT = rn;
      if (this.reduced) { c.target.copy(c.g.target); c.r = c.g.r; c.phi = c.g.phi; c.theta = c.g.theta; return; }
      const cur = new T.Vector3(Math.log(c.r), c.phi, c.theta), tgt = new T.Vector3(Math.log(c.g.r), c.g.phi, c.g.theta);
      while (ms > 0) {
        const sec = Math.min(ms, 33) / 1000;
        springV(c.target, this.trCV, c.g.target, 4.5, sec);
        springV(cur, this.trRV, tgt, 4.0, sec);
        ms -= 33;
      }
      c.r = Math.exp(cur.x); c.phi = cur.y; c.theta = cur.z;
    }
    flowEase(f) { return f < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * f) : 1; }
    // A soft glow over one block of a die (a quad on the die, in die plane units).
    // All the parts of a unit (a DRAM has 4 cell array quarters, 2 row decoders ...).
    blockGlows(e, label) {
      const L = this.layOf(e), lbl = this.blkLabel(e, label);
      const out = [];
      L.blocks.forEach((b, i) => { if (b.label === lbl) { const g = this.blockGlow(e, i); if (g) out.push(g); } });
      return out;
    }
    blockGlow(e, bi) {
      if (!this.bGlows) this.bGlows = new Map();
      const key = e.key + '|' + bi;
      let g = this.bGlows.get(key);
      if (!g) {
        const L = this.layOf(e);
        const b = L.blocks[bi];
        if (!b) return null;
        const W = e.d.L * 0.97, H = e.d.W * 0.94, bw = b.w / e.cw * W, bh = b.h / e.ch * H, m = Math.min(bw, bh) * 0.35;
        const mat = new T.ShaderMaterial({
          uniforms: { uColor: { value: new T.Color(THEME.goldHi) }, uI: { value: 0 }, uFill: { value: 0.16 }, uIn: { value: new T.Vector2(bw / (bw + 2 * m), bh / (bh + 2 * m)) } },
          vertexShader: UV_VS, fragmentShader: BLOCK_FS, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, toneMapped: false,
        });
        const mesh = new T.Mesh(new T.PlaneGeometry(bw + 2 * m, bh + 2 * m), mat);
        mesh.position.set(((b.x + b.w / 2) / e.cw - 0.5) * W, (0.5 - (b.y + b.h / 2) / e.ch) * H, 0.001);
        mesh.renderOrder = 7;
        e.mesh.add(mesh);
        g = { mesh, mat, v: 0, tgt: 0 };
        this.bGlows.set(key, g);
      }
      return g;
    }
    // The work of a die unit, drawn on the die: a canvas texture over the unit rectangle,
    // painted by UnitFx (src/ui/unitfx.js) with the values of the block card.
    unitOverlay(e, label) {
      if (!this.uFx) this.uFx = new Map();
      const key = e.key + '|' + label;
      let o = this.uFx.get(key);
      if (o) return o;
      const L = this.layOf(e), bi = this.bIdx(e, label), b = L.blocks[bi];
      if (!b) return null;
      const W = e.d.L * 0.97, H = e.d.W * 0.94, bw = b.w / e.cw * W, bh = b.h / e.ch * H;
      const big = 768, cw = bw >= bh ? big : Math.max(128, Math.round(big * bw / bh)), ch = bw >= bh ? Math.max(128, Math.round(big * bh / bw)) : big;
      const c = canvas(cw, ch), tex = colorTex(c, this.aniso);
      const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, opacity: 0 });
      const mesh = new T.Mesh(new T.PlaneGeometry(bw, bh), mat);
      mesh.position.set(((b.x + b.w / 2) / e.cw - 0.5) * W, (0.5 - (b.y + b.h / 2) / e.ch) * H, 0.0012);
      mesh.renderOrder = 10;   // (over the die effects, the glow of the blocks and the path lines; under the token)
      mesh.visible = false;
      e.mesh.add(mesh);
      o = { mesh, mat, tex, c, g: c.getContext('2d'), cw, ch, v: 0, tgt: 0, spec: null, u: 0 };
      this.uFx.set(key, o);
      return o;
    }
    // zs: canvas px for one px of the drawing (0: the drawing picks it from the canvas size)
    paintUnit(o, spec, u, now, zs = 0) {
      if (typeof UnitFx === 'undefined' || !spec) return;
      o.g.clearRect(0, 0, o.cw, o.ch);
      // a dark backing, so the painted name of the unit does not show through the drawing
      o.g.fillStyle = 'rgb(6, 8, 16)';
      o.g.fillRect(0, 0, o.cw, o.ch);
      try { UnitFx.draw(o.g, o.cw, o.ch, spec, u, now, this.reduced, zs); o.words = UnitFx.words || []; } catch (err) { /* keep the die art */ }
      o.tex.needsUpdate = true;
      o.spec = spec; o.u = u;
    }
    // Explain: the scale of the drawing of a unit, so that 1 px of the drawing is about 1 px on the
    // screen (the words keep their size). It changes only for a new card or a large zoom (the
    // drawing does not move while the camera settles).
    unitZoom(o, sg) {
      const R = this.blockScreen(sg.dive.e, sg.block);
      if (!R || !(R.w > 8) || !(R.h > 8)) return o.zs || 0;
      const want = clamp(Math.max(o.cw / R.w, o.ch / R.h), 1, 6);
      if (!o.zs || o.zsSpec !== sg.card || Math.abs(Math.log(want / o.zs)) > 0.4) { o.zs = want; o.zsSpec = sg.card; }
      return o.zs;
    }
    // The screen rectangle of a unit of a die in px of the view (null: not in front of the camera).
    blockScreen(e, label) {
      const b = this.layOf(e).blocks[this.bIdx(e, label)];
      if (!b || !this.w) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
        const p = this.dieW(e, q, 0.006).project(this.camera);
        if (p.z > 1) return null;
        const sx = (p.x + 1) / 2 * this.w, sy = (1 - p.y) / 2 * this.h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    // Outside the trace: when the camera is close to an open die, each micro-event plays
    // the drawing of its unit (the same cards as the trace), one unit after the other.
    dieNear(e) {
      if (!e || !e.mesh || !e.mesh.visible || !(e.cov > 0.02 || e.win)) return false;
      const p = new T.Vector3();
      e.mesh.getWorldPosition(p);
      return this.camera.position.distanceTo(p) < Math.max(6, e.d.L * 3);
    }
    liveUnits(ev, now, clockMs) {
      if (!this.visible || typeof UnitFx === 'undefined' || this.cam.r > 12) return;
      const m = this.app.machine, dur = clamp(clockMs * 4, 280, 2600), jobs = [];
      const push = (e, visits, t0) => {
        if (!this.dieNear(e) || !visits) return;
        visits.forEach(([label, card], k) => { if (card) jobs.push({ e, label, card, t0: t0 + k * dur * 0.6 }); });
      };
      const cpu = this.decaps.get('cpu'), fpu = this.decaps.get('fpu');
      if (ev.k === 'fetch' || ev.k === 'bus') {
        const I = Story.busInfo(ev), ce = I.fpu ? fpu : cpu;
        const ctx = { I, s: { token: { tag: '' } }, ev, m };
        if (I.kind !== 'halt') {
          push(ce, I.read ? CPU_TRACE.out(ctx).concat(CPU_TRACE.in(ctx)) : CPU_TRACE.out(ctx).concat(CPU_TRACE.write(ctx)), now);
          const near = [...this.decaps.values()].some(x => x !== ce && this.dieNear(x));
          if (near) {
            const tg = this.traceTarget(I);
            if (tg && this.dieNear(tg.e)) {
              const tc = Object.assign(tg.ctx, { s: { token: { tag: '' } }, ev }), md = tg.model;
              const list = [].concat(md.addr ? md.addr(tc) : [], md.cmd ? md.cmd(tc) : [], I.read ? (md.read ? md.read(tc) : []) : (md.write ? md.write(tc) : []));
              push(tg.e, list, now + dur * 0.4);
            }
          }
        }
      } else if (['decode', 'alu', 'reg', 'ea', 'flags', 'int', 'desc', 'fpu'].includes(ev.k) || (ev.k === 'queue' && ev.op === 'flush')) {
        const unit = ev.k === 'fpu' ? 'fpu' : 'cpu';
        const evs = ev.k === 'decode' ? [ev].concat((this.curEvents || []).filter(x => x.k === 'queue' && x.op === 'pop').slice(0, 1)) : [ev];
        push(unit === 'fpu' && !FPU_ON ? fpu : cpu, CPU_TRACE.inside({ s: { evs, unit }, m }), now);   // the 486 / Pentium FPU is on the CPU die
      }
      else if (ev.k === 'page') push(cpu, PAGE_CARD({ e: ev }), now);
      else if (ev.k === 'cache' && !ev.hit) push(cpu, CACHE_CARD({ e: ev }), now);
      else if (ev.k === 'btb' || ev.k === 'pipe') push(cpu, P5_CARDS(ev), now);
      else if (ev.k === 'uop' || ev.k === 'rat' || ev.k === 'rob') push(cpu, P6_CARDS([ev]), now);
      else if (ev.k === 'sb' || ev.k === 'opl') push(this.decaps.get(ev.k === 'opl' ? 'opl' : 'sbdsp'), SOUND_CARD({ e: ev }), now);
      if (!jobs.length) return;
      if (!this.liveJobs) this.liveJobs = [];
      for (const j of jobs) {
        // a new event in the same unit replaces the old one
        this.liveJobs = this.liveJobs.filter(x => !(x.e === j.e && x.label === j.label));
        j.dur = dur;
        this.liveJobs.push(j);
      }
      if (this.liveJobs.length > 24) this.liveJobs.splice(0, this.liveJobs.length - 24);
    }
    updateLiveUnits(now) {
      if (!this.liveJobs || !this.liveJobs.length) return false;
      if (this.tr) { this.liveJobs.length = 0; return false; }
      const on = new Set();
      let busy = false;
      for (let k = this.liveJobs.length - 1; k >= 0; k--) {
        const j = this.liveJobs[k], u = (now - j.t0) / j.dur;
        if (u > 3 || !this.dieNear(j.e)) { this.liveJobs.splice(k, 1); continue; }
        if (u < 0) { busy = true; continue; }
        const o = this.unitOverlay(j.e, j.label);
        if (!o) continue;
        this.paintUnit(o, j.card, this.reduced ? 1 : clamp(u, 0, 1), now);
        o.tgt = u < 2 ? 1 : 0;
        on.add(o);
        for (const g of this.blockGlows(j.e, j.label)) { g.tgt = u < 1.2 ? 0.5 : 0; g.mat.uniforms.uFill.value = 0; }
        busy = true;
      }
      for (const o of this.uFx ? this.uFx.values() : []) {
        if (!on.has(o)) o.tgt = 0;
        o.v += (o.tgt - o.v) * (o.tgt > o.v ? 0.25 : 0.05);
        if (o.v < 0.01) o.v = 0;
        o.mat.opacity = o.v;
        o.mesh.visible = o.v > 0;
        if (o.v > 0) busy = true;
      }
      if (this.bGlows) for (const g of this.bGlows.values()) {
        g.v += (g.tgt - g.v) * (g.tgt > g.v ? 0.2 : 0.08);
        if (g.v < 0.003) g.v = 0;
        g.mat.uniforms.uI.value = g.v;
        g.tgt = 0;
      }
      return busy;
    }
    // The window into a unit: the exact drawing of the card (the bits, the lines, the cells with
    // the real values), on the unit itself (its rectangle on the screen). It is at least 300 px
    // wide, centred on the unit, and it fades in as the unit grows on the screen. Returns its
    // opacity.
    unitWindow(sg, u) {
      // (Explain: a card of text gets its window too; the camera is close to the unit)
      const spec = sg && sg.card && (sg.card.kind !== 'text' || (this.xp && this.xp.shots)) && sg.dive ? sg.card : null;
      let a = 0, r = null;
      if (spec && this.w) {
        const e = sg.dive.e, b = this.layOf(e).blocks[this.bIdx(e, sg.block)];
        if (b) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, ok = true;
          for (const q of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
            const p = this.dieW(e, q, 0.006).project(this.camera);
            if (p.z > 1) { ok = false; break; }
            const sx = (p.x + 1) / 2 * this.w, sy = (1 - p.y) / 2 * this.h;
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
          }
          if (ok) { r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; a = clamp((Math.max(r.w, r.h) - 140) / 80, 0, 1); }
        }
      }
      // Explain: the unit itself shows its work (UnitFx on the die); its title and facts go in a
      // small tag above the unit (no window over it)
      // (the rectangle of the unit on the screen: the tooltips of the words of its drawing)
      this.uRect = spec && r && a ? { r, spec } : null;
      // the unit itself shows its work (UnitFx on the die); the title and the facts go in the tag
      if (typeof UnitFx !== 'undefined') {
        if (this.win) { this.win.el.style.opacity = 0; this.win.el.style.visibility = 'hidden'; }
        this.unitTag(spec, r, a);
        return 0;
      }
      if (this.uTagEl) this.uTagEl.style.opacity = 0;
      if (!this.win) {
        if (!a || typeof BlockPanel === 'undefined') return 0;
        this.win = new BlockPanel(this.trLayer);
        this.win.setReducedMotion(this.reduced);
        this.win.el.classList.add('bk-inplace');
        this.trLayer.insertBefore(this.win.el, this.trLayer.firstChild);   // under the labels
      }
      const W = this.win;
      if (!a) { W.el.style.opacity = 0; W.el.style.visibility = 'hidden'; return 0; }
      if (this.winSpec !== spec) { W.show(spec); this.winSpec = spec; W.el.classList.add('bk-inplace'); }
      W.update(this.reduced ? 1 : u);
      const w0 = W.el.offsetWidth || 340, h0 = W.el.offsetHeight || 200;
      const sc = Math.min(Math.max(r.w * 1.08, 300) / w0, Math.max(r.h * 1.08, 200) / h0 * 1.6);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      W.el.style.visibility = 'visible';
      W.el.style.opacity = a;
      W.el.style.transform = `translate(${cx - w0 * sc / 2}px, ${cy - h0 * sc / 2}px) scale(${sc})`;
      return a;
    }
    // The tag above a unit at work (Explain): the title of its card and its short facts.
    unitTag(spec, r, a) {
      if (!this.uTagEl) this.uTagEl = htmlEl('div', { class: 'bv-utag', 'aria-hidden': 'true' }, this.trLayer);
      const el = this.uTagEl;
      if (!spec || !r || !a) { el.style.opacity = 0; return; }
      if (this.uTagSpec !== spec) {
        this.uTagSpec = spec;
        el.textContent = '';
        // the name of the work in normal case (a short name such as TLB or a word with a digit stays)
        const t = String(spec.title || '').split(' ').map((w, k) => (/\d/.test(w) || /^(TLB|ALU|FPU|ROM|RAM|BTB|ROB|RS|RAT|RRF|LRU|EU|BIU|AU|IU|BU|AGU|FIFO|MOB|DSP|OPL|EIP|IP|CS|DS|ES|SS|FS|GS|SP|I\/O|IO|U|V|PF|EX|WB|µOPS?)$/.test(w) ? w : k ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
        htmlEl('b', null, el, t);
        const facts = (Array.isArray(spec.lines) ? spec.lines : []).filter(Boolean).slice(0, 3).join(' · ');
        if (facts) htmlEl('span', null, el, facts);
      }
      const x = clamp(r.x + r.w / 2, 140, this.w - 140), top = r.y - 10, lim = this.xp ? (this.xpTopPx || 60) + 44 : 128;
      // above the unit; when there is no room (under the program strip), in the top of the unit
      const y = top < lim ? r.y + 8 : top;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${top < lim ? '0' : '-100%'})`;
      el.style.opacity = a;
    }
    showCard(spec, u) {
      if (!spec) {
        if (this.bcard && this.cardShown) { this.bcard.hide(); this.cardShown = null; }
        if (this.trLine) this.trLine.style.opacity = 0;
        return;
      }
      if (typeof BlockPanel === 'undefined') return;
      if (!this.bcard) {
        this.bcard = new BlockPanel(this.root, { minKey: 'boardCardMin', minDefault: true });
        this.cardEl = this.bcard.el;
        this.bcard.setReducedMotion(this.reduced);
        this.cardEl.classList.add('bv-card');
      }
      if (this.xp && this.bcard.min) this.bcard.setMin(false);   // (Explain: the card is always open)
      if (this.cardShown !== spec) { this.bcard.show(spec); this.cardShown = spec; }
      this.bcard.update(this.reduced ? 1 : u);
    }
    updateTrace(now) {
      let busy = false;
      for (const t of this.trOrbs) {
        const r = t.rider;
        if (!r || r.done) continue;
        r.E = this.reduced ? 1 : clamp((now - r.t0) / r.dur, 0, 1);
        r.at = this.riderAt(r, now < r.t0 ? 0 : r.E);
        if (r.E < 1) busy = true;
      }
      for (let k = this.flows.length - 1; k >= 0; k--) {
        const f = this.flows[k];
        let e;
        if (f.rider) {
          const r = f.rider, at = r.at;
          e = r.done || r.E >= 1 ? 1 : now < r.t0 || !at ? 0 : f.si < at.i ? 1 : f.si > at.i ? 0 : clamp(at.d / Math.max(1e-9, f.len), 0, 1);
        }
        else e = this.reduced ? 1 : this.flowEase(clamp((now - f.t0) / f.dur, 0, 1));
        let a = clamp((now - f.born) / 250, 0, 1);
        if (f.fadeT && now > f.fadeT) {
          const tt = now - f.fadeT;
          a *= 0.2 * Math.exp(-tt / 4500) + 0.8 * Math.exp(-tt / 500);
        }
        if (f.fadeT && now > f.fadeT && a < 0.01) {
          this.trG.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose();
          this.flows.splice(k, 1);
          continue;
        }
        const U = f.mesh.material.uniforms;
        U.uHead.value = e * f.len + (e >= 1 ? f.len * 0.05 + 0.02 : 0);
        U.uAlpha.value = a * (f.amax || 1);
        if (e < 1 || f.fadeT || a < 1) busy = true;
      }
      // the tokens: on their path, waiting in a block, or parked at the end
      let curAt = null;
      const bgUnits = [];
      for (let k = this.trOrbs.length - 1; k >= 0; k--) {
        const t = this.trOrbs[k], o = t.o, r = t.rider;
        const at = r ? r.at || this.riderAt(r, now < r.t0 ? 0 : r.E) : null;
        if (!at) continue;
        let a = clamp((now - o.born) / 220, 0, 1);
        if (o.fadeT && now > o.fadeT) a *= Math.exp(-(now - o.fadeT) / 260);
        if (o.fadeT && now > o.fadeT && a < 0.02) { this.dropOrb(o); this.trOrbs.splice(k, 1); continue; }
        // the token is small inside a die, and very small over a unit that shows its work
        // (Explain: the camera comes very close to a unit, so the token also follows the distance)
        const xpK = this.xp && this.xp.shots ? clamp(this.cam.r / 2.5, 0.25, 1) : 1;
        const size = (at.dive ? clamp(at.dive.s * 0.3, 0.02, 0.35) * (at.seg.unit && at.seg.card ? 0.3 : 1) : 1) * (o.small || 1) * xpK;
        o.size += (size - o.size) * 0.25;
        o.park += ((r.E >= 1 ? 0.6 : 1) - o.park) * 0.15;
        o.g.visible = true;
        o.g.position.copy(at.pos);
        const pulse = at.seg.unit && !this.reduced ? 1 + 0.18 * Math.sin(now * 0.012) : 1;
        const s0 = (0.4 + 0.6 * a) * o.park * o.size;
        o.glow.scale.setScalar(0.85 * s0 * pulse);
        o.halo.scale.setScalar(2.4 * s0 * pulse);
        // over a unit that shows its work, the token has no halo (it would cover the drawing)
        const quiet = at.seg.unit && at.seg.card && at.dive;
        o.glow.material.opacity = a * (quiet ? 0.45 : 1); o.halo.material.opacity = quiet ? 0 : 0.3 * a; o.core.material.opacity = a;
        o.core.scale.setScalar(s0);
        t.pos = at.pos;
        busy = true;
        if (r === (this.tr && this.tr.rider)) curAt = at;
        else if (r.bg && at.seg.unit && at.dive && r.E < 1 && !o.fadeT) bgUnits.push(at.seg);
      }
      // the current step: block glow, block card, sounds
      const r = this.tr && this.tr.rider;
      if (this.bGlows) for (const g of this.bGlows.values()) g.tgt = 0;
      // the units that a token in parallel passes: a dim glow
      for (const sg of bgUnits) for (const g of this.blockGlows(sg.dive.e, sg.block)) { g.tgt = Math.max(g.tgt, 0.35); g.mat.uniforms.uFill.value = 0.1; }
      this.trWin = null;
      // the units of the chip keep their last picture a short time, then it fades
      const fxOn = new Set();
      this.trInDie = !!(curAt && curAt.dive);
      if (r && curAt && now >= r.t0) {
        const sg = curAt.seg;
        if (sg.dive && sg.unit) {
          // the work plays while the token waits at the working part of the unit
          const xs = sg.xp && this.xp && this.xp.shots, fi = xs ? sg.fin : sg.fin || FLOW_IN, fo = xs ? sg.fout : sg.fout || FLOW_IN;
          const u = this.reduced ? 1 : clamp((curAt.local - fi) / Math.max(1e-6, 1 - fi - fo), 0, 1);
          const o = sg.card && typeof UnitFx !== 'undefined' ? this.unitOverlay(sg.dive.e, sg.block) : null;
          // with a drawing of the unit's work, only a thin edge glows (no bright fill over it)
          for (const g of this.blockGlows(sg.dive.e, sg.block)) { g.tgt = o ? 0.5 : 1; g.mat.uniforms.uFill.value = o ? 0 : 0.16; }
          if (o) { o.tgt = 1; fxOn.add(o); this.paintUnit(o, sg.card, u, now, this.unitZoom(o, sg)); this.lastUnit = o; }
          // a unit of a die shows its work itself (its drawing on the die, and a tag above it): no
          // card at the side, no window over it
          if (this.xpForce) this.showCard(null);
          // (a card of text only: the camera does not come close to the unit outside Explain, so the
          // card at the side keeps the text)
          else if (o && (sg.card.kind !== 'text' || (this.xp && this.xp.shots))) { this.showCard(null); this.trWin = { sg, u }; }
          else { this.showCard(sg.card, u); this.trWin = { sg, u }; }
          this.cardAt = sg.card ? sg.at : this.cardAt;
        } else if (sg.dive) {
          // between two blocks of the same chip: the last card stays
          if (this.cardShown) this.bcard.update(1);
        } else this.showCard(null);
        if (curAt.i !== r.lastSeg && typeof Sfx !== 'undefined') {
          const was = r.lastSeg >= 0 ? r.J.segs[r.lastSeg] : null;
          if (sg.dive && (!was || !was.dive || was.dive.e !== sg.dive.e)) Sfx.enter();
          else if (!sg.dive && was && was.dive) Sfx.leave();
          else if (sg.unit) Sfx.tick(1.3);
          r.lastSeg = curAt.i;
        }
        if (r.E >= 1 && !r.arrived) { r.arrived = true; if (typeof Sfx !== 'undefined') Sfx.arrive(r.s.token.col); }
      } else if (!r) this.showCard(null);
      if (this.uFx) {
        for (const o of this.uFx.values()) {
          // the last unit stays while the token is in the same chip; the others fade
          if (!fxOn.has(o)) o.tgt = o === this.lastUnit && this.trInDie ? 0.85 : 0;
          o.v += (o.tgt - o.v) * (o.tgt > o.v ? 0.25 : 0.03);
          if (o.v < 0.01) o.v = 0;
          o.mat.opacity = o.v;
          o.mesh.visible = o.v > 0;
          if (o.v > 0 && o.v < 0.99) busy = true;
        }
      }
      if (this.bGlows) {
        for (const g of this.bGlows.values()) {
          g.v += (g.tgt - g.v) * (g.tgt > g.v ? 0.2 : 0.08);
          if (g.v < 0.003) g.v = 0;
          g.mat.uniforms.uI.value = g.v * (this.reduced ? 1 : 0.85 + 0.15 * Math.sin(now * 0.008));
          if (g.v > 0) busy = true;
        }
      }
      // the label on the tip: what, from where, to where, and what happens now
      this.trTokAt = curAt ? curAt.pos : null;
      this.trInCard = !!(curAt && curAt.seg.unit && curAt.seg.card);
      if (curAt) {
        const s = this.tr.s;
        const now2 = curAt.seg.label ? String(curAt.seg.label).replace(/<[^>]+>/g, '') : '';
        const route = s.toName ? `${s.fromName} → ${s.toName}` : s.fromName || '';
        const key = [s.token.tag, s.token.val, s.token.col, route, now2].join('|');
        if (this.trTokKey !== key) {
          this.trTokKey = key;
          this.trTokTag.textContent = s.token.tag;
          this.trTokVal.textContent = s.token.val || '';
          this.trTokRoute.textContent = route;
          this.trTokNow.textContent = curAt.seg.unit && curAt.seg.card ? '' : now2;
          this.trTok.className = 'bv-tok tl-' + s.token.col;
        }
      }
      const rn = performance.now();
      for (let k = this.trLabs.length - 1; k >= 0; k--) if (this.trLabs[k].dying && rn - this.trLabs[k].dying > 600) { this.trLabs[k].el.remove(); this.trLabs.splice(k, 1); }
      return busy || this.trLabs.some(L => rn - L.born < 600) || (this.tr && now < this.tr.t0);
    }
    // The chips of the step glow as the signal reaches them; the chips of the earlier steps
    // of the same bus cycle stay a little lit.
    traceGlows(now) {
      const t = this.tr, v = t.v;
      const f = t.rider ? (now < t.rider.t0 ? 0 : t.rider.E) : 1;
      const set = (id, lv, color) => { const g = this.glows[id]; if (g && lv > g.tgt) { g.tgt = lv; g.tcol = color; } };
      for (const id of this.trHeld) set(id, 0.4, v.col);
      for (const id of v.from) set(id, 0.75 - 0.3 * f, v.col);
      for (const id of v.mid) set(id, 0.3 + 0.45 * smooth(0.15, 0.6, f), v.col);
      for (const id of v.to) set(id, 0.25 + 0.75 * smooth(0.6, 1, f), v.col);
    }
    // Screen positions of the tip label, the chip labels, the block card and its line.
    placeTrace() {
      const on = !!this.tr && this.visible;
      this.trLayer.style.display = on ? '' : 'none';
      if (!on) return;
      const w = this.w, h = this.h, cam = this.camera;
      const scr = p => { const q = p.clone().project(cam); return q.z > 1 || Math.abs(q.x) > 1.2 || Math.abs(q.y) > 1.2 ? null : [(q.x + 1) / 2 * w, (1 - q.y) / 2 * h]; };
      const put = (el, p, dy, show) => {
        const xy = p && show ? scr(p) : null;
        if (!xy) { el.style.opacity = 0; return; }
        el.style.opacity = 1;
        el.style.transform = `translate(${clamp(xy[0], 120, w - 120).toFixed(1)}px, ${(xy[1] + dy).toFixed(1)}px) translate(-50%, -100%)`;
      };
      // the window into the unit (the exact drawing of its card), and the token over it
      const wa = this.unitWindow(this.trWin ? this.trWin.sg : null, this.trWin ? this.trWin.u : 0);
      const dxy = wa && this.trTokAt ? scr(this.trTokAt) : null;
      if (dxy) {
        this.trDot.style.opacity = wa;
        this.trDot.style.transform = `translate(${dxy[0].toFixed(1)}px, ${dxy[1].toFixed(1)}px) translate(-50%, -50%)`;
        this.trDot.style.setProperty('--c', this.trColor(this.tr.s.token.col));
      } else this.trDot.style.opacity = 0;
      // inside a block with a card, the card tells the story: the tip label stays small
      if (this.xpForce) this.trTok.style.opacity = 0;
      else if (this.trInDie && this.trTokAt) {
        // inside a die the label must not cover the units: it stays at the top of the view
        this.trTok.style.opacity = this.trInCard ? 0 : 1;
        this.trTok.style.transform = `translate(${(w / 2).toFixed(1)}px, ${this.xp ? (this.xpTopPx || 60) : 8}px) translate(-50%, 0)`;
      } else put(this.trTok, this.trTokAt, -18, !!this.trTokAt && !(this.trInCard && this.cardShown));
      const up = new T.Vector3(0, 0.55, 0);
      const close = this.cam.r < 4;
      const f = this.tr && this.tr.rider ? this.tr.rider.E : 1;
      let k = 0;
      for (const L of this.trLabs) {
        if (L.dying) continue;
        put(L.el, L.at ? L.at.clone().add(up) : null, -6, !close && !!L.at && (k === 0 || f > 0.55 || this.reduced));
        k++;
      }
      // the block card sits at the left; a line goes from the card to its block
      if (this.cardShown && this.cardEl) {
        const narrow = w < 640;
        const cx = 12, cy = this.xp ? (this.xpTopPx || 60) : narrow ? 8 : 52;
        this.bcard.place(cx, cy);
        if (!this.trLine) {
          this.trLine = svgEl('svg', { class: 'bv-cardline', 'aria-hidden': 'true' });
          this.trLine.appendChild(svgEl('path', { d: '' }));
          this.trLine.appendChild(svgEl('circle', { r: 4 }));
          this.trLayer.appendChild(this.trLine);
        }
        const xy = this.cardAt ? scr(this.cardAt) : null;
        if (xy && !narrow) {
          const x0 = cx + this.cardEl.offsetWidth, y0 = cy + Math.min(60, this.cardEl.offsetHeight / 2);
          this.trLine.firstChild.setAttribute('d', `M${x0},${y0} C${x0 + 40},${y0} ${xy[0] - 40},${xy[1]} ${xy[0]},${xy[1]}`);
          this.trLine.lastChild.setAttribute('cx', xy[0]); this.trLine.lastChild.setAttribute('cy', xy[1]);
          this.trLine.style.opacity = 1;
        } else this.trLine.style.opacity = 0;
      } else if (this.trLine) this.trLine.style.opacity = 0;
    }

    // ---------- view contract ----------
    show() {
      this.visible = true;
      this.dirty = true;
      if (!this.ok) return;
      if (this.trG) this.trG.visible = true;
      this.attachTo(this.wrap);
      this.viewCam = null; this.viewCx = 0.5;
      this.dirty = true;
      if (this.runnerGroup) this.runnerGroup.visible = false;
      this.resize();
    }
    hide() {
      this.visible = false;
      if (this.ok) { this.setHover(null); this.pop.hidden = true; this.scratching = null; }
    }
    resize() {
      if (!this.ok) return;
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w / h < 1 ? 42 : 30;
      this.camera.clearViewOffset();
      this.trOff = 0;
      this.camera.updateProjectionMatrix();
      if (this.cam.fit && this.cam.preset === 'overview') this.applyPreset('overview', true);
      this.dirty = true;
    }
    updateCrt() {
      const v = this.app.crtVersion, src = this.app.crtCanvas;
      if (v === this.crtVer || !src || !src.width || !src.height) return false;
      this.crtVer = v;
      const g = this.scrCanvas.getContext('2d');
      g.drawImage(src, 0, 0, this.scrCanvas.width, this.scrCanvas.height);
      this.scrTex.needsUpdate = true;
      return true;
    }
    // One step of everything that the board and the runner views share. now and dt are
    // animation time (slow motion); rnow and rdt are real time for the controls.
    simStep(now, dt) {
      if (this.manual) {
        const ck = this.app.clock;
        if (ck > this.manClock) { this.manClock = ck; this.manAnchor = now; }
      }
      dt = clamp(dt || 16, 0.05, 100);
      this.updateSignals(now, dt);
      this.fxBusy = false;
      this.updateFx(now, dt);
      const crt = this.updateCrt();
      if (this.glint) {
        const t = ((now / 7000) % 1) * 1.9 - 0.45;
        const cd = this.decaps.get('cpu');
        const open = cd && cd.mesh && cd.mesh.visible ? clamp(1 - cd.cov * 3, 0, 1) : 1;
        this.glint.uniforms.uT.value = this.reduced ? 0.3 : t;
        this.glint.uniforms.uAmp.value = (this.reduced ? 0.35 : 1) * open;
      }
      const rnow = performance.now(), rdt = clamp(rnow - (this.lastReal || rnow - 16), 1, 100);
      this.lastReal = rnow;
      this.updateDecap(rnow, rdt);
      this.updateDetail(rnow);
      return { crt, rnow, rdt };
    }
    frame(now, dt) {
      if (!this.ok || !this.visible) return;
      if (!this.w) this.resize();
      if (!this.w) return;
      const s = this.simStep(now, dt);
      const trBusy = this.tr ? this.updateTrace(now) : this.xpCard ? this.xpCardStep(now) : this.updateLiveUnits(now);
      this.trViewOffset();
      const moving = this.updateCamera(s.rdt, s.rnow);
      this.updateOcclusion(this.camera.position, this.cam.target.clone().add(this.cam.follow));
      this.updateHover(s.rnow);
      // dim the board in trace mode, so the parts of the step stand out
      const exp = this.tr ? 0.55 : 1.05, ex = this.renderer.toneMappingExposure;
      const dimming = Math.abs(ex - exp) > 0.003;
      if (dimming) this.renderer.toneMappingExposure = ex + (exp - ex) * (1 - Math.exp(-s.rdt / 260));
      const busy = moving || s.crt || this.activity > 0.01 || this.fastOn || this.dirty || this.decapBusy || this.fxBusy || trBusy || dimming;
      const gap = busy ? 0 : this.reduced ? 500 : 33;
      if (s.rnow - this.lastRender < gap) return;
      this.renderer.render(this.scene, this.camera);
      this.placeTrace();
      if (this.xp) this.drawSpot(now);
      else this.drawUnitDim();
      this.lastRender = s.rnow;
      this.dirty = false;
    }
  }
  // ---------------------------------------------------------------------------
  // Runner view: a camera that rides over the board behind the pulse of each bus cycle.
  // It uses the renderer and the scene of the board view (one WebGL context).
  const RUN_Y = 0.075;
  const RUN_PACE = 170;            // animation ms per clock when the bus cycles come too fast
  const TYPE_NAME = { fetch: 'CODE', memr: 'MEMR', memw: 'MEMW', ior: 'IOR', iow: 'IOW', inta: 'INTA' };
  const DEV_NAME = {
    pic: '8259A interrupt controller', pit: M286 ? '8254 timer' : '8253 timer', ppi: M286 ? 'port 61h logic' : '8255 PPI', dma: '8237 DMA', nmi: 'NMI mask latch',
    pic2: 'slave 8259A', kbc: '8042 keyboard controller', rtc: 'MC146818 RTC and CMOS', dma2: 'second 8237 DMA', xram: '1 MB extended memory card', fpu: '80287 coprocessor',
    vram: 'CGA video RAM', crtc: '6845 CRT controller', cga: 'CGA mode register', vga: 'VGA controller', vrom: 'VGA BIOS ROM', fdc: 'floppy controller', none: 'no device',
    sb: 'Sound Blaster DSP', opl: 'YM3812 FM synthesizer', hdc: 'IDE hard disk controller',
  };

  // A critically damped spring on a Vector3 (exact solution, stable at any dt in seconds).
  function springV(x, v, tgt, omega, dt) {
    if (!(dt > 0)) return;
    const e = Math.exp(-omega * dt);
    for (const k of ['x', 'y', 'z']) {
      const c = x[k] - tgt[k], tmp = (v[k] + omega * c) * dt;
      v[k] = (v[k] - omega * tmp) * e;
      x[k] = tgt[k] + (c + tmp) * e;
    }
  }
  // Quiet synthesized sound effects for the runner (off by default). The audio context
  // starts only after a user gesture, and only while the page sound toggle is on.
  class RunnerSfx {
    constructor() { this.ctx = null; this.want = false; this.last = {}; }
    // the "Effects" switch of the page controls all the sound effects
    pageOn() { return typeof Sfx !== 'undefined' ? Sfx.on : false; }
    get live() { return this.want && this.ctx && this.ctx.state === 'running' && this.pageOn(); }
    gesture() {
      if (!this.want || !this.pageOn()) return;
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }
    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const c = this.ctx = new AC();
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -24; comp.ratio.value = 4;
        this.master = c.createGain(); this.master.gain.value = 0.55;
        this.master.connect(comp); comp.connect(c.destination);
        // whoosh: looped noise through a band-pass filter
        const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
        const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
        this.bp = c.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 1.4; this.bp.frequency.value = 400;
        this.wg = c.createGain(); this.wg.gain.value = 0;
        src.connect(this.bp); this.bp.connect(this.wg); this.wg.connect(this.master); src.start();
        // hum inside a die
        this.hg = c.createGain(); this.hg.gain.value = 0;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
        for (const [f, g] of [[55, 1], [110, 0.35], [165, 0.12]]) {
          const o = c.createOscillator(); o.frequency.value = f;
          const og = c.createGain(); og.gain.value = g;
          o.connect(og); og.connect(lp); o.start();
        }
        lp.connect(this.hg); this.hg.connect(this.master);
      } catch (e) { this.ctx = null; }
    }
    setWant(on) { this.want = on; if (on) this.gesture(); else this.silence(); }
    silence() { if (!this.ctx) return; const t = this.ctx.currentTime; this.wg.gain.setTargetAtTime(0, t, 0.05); this.hg.gain.setTargetAtTime(0, t, 0.1); }
    // no continuous sounds (a noise and a hum were not pleasant): only short tones
    update() { if (this.ctx) this.silence(); }
    limited(key, ms) {
      const n = performance.now();
      if (n - (this.last[key] || 0) < ms) return true;
      this.last[key] = n;
      return false;
    }
    blip(freq, dur = 0.08, type = 'sine', vol = 0.035, delay = 0) {
      if (!this.live) return;
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.92, t + dur);
      f.type = 'lowpass'; f.frequency.value = 2400;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    click() {
      if (!this.live || this.limited('click', 40)) return;
      this.blip(1800, 0.02, 'sine', 0.012);
    }
    cycle(kind) {
      if (this.limited('cycle', 90)) return;
      if (kind === 'inta') { this.blip(740, 0.07); this.blip(988, 0.08, 'sine', 0.03, 0.07); }
      else if (kind === 'ior' || kind === 'iow') this.blip(kind === 'ior' ? 392 : 349, 0.1, 'square', 0.018);
      else if (kind === 'memw') this.blip(523, 0.1, 'triangle', 0.04);
      else this.blip(kind === 'fetch' ? 587 : 659, 0.08, 'sine', 0.03);
    }
    select() { if (!this.limited('sel', 60)) this.blip(1320, 0.04, 'sine', 0.02); }
  }

  class RunnerView {
    constructor(host, app) {
      this.host = host;
      this.app = app;
      this.reduced = !!app.reducedMotion;
      this.visible = false;
      this.mode = storage.get('runMode', 'auto');
      this.camMode = storage.get('runCam', 'chase');
      this.into = storage.get('runInto', true);
      this.zoomT = this.zoomS = clamp(+storage.get('runZoom', 1) || 1, 0.3, 4);
      this.sfx = new RunnerSfx();
      this.sfx.want = true;   // (the Effects switch of the Sound menu turns the runner sounds on and off)
      this.queue = [];
      this.cur = null;
      this.route = null;
      this.instrText = '';
      this.hudKey = '';
      this.w = 0; this.h = 0;
      injectStyle();
      this.buildDom();
    }
    get board() {
      const b = this.app.view ? this.app.view('board') : null;
      return b && b.ok ? b : null;
    }
    buildDom() {
      const root = this.root = htmlEl('div', { class: 'bv-root' }, this.host);
      this.wrap = htmlEl('div', {
        class: 'bv-canvas', tabindex: '0', role: 'img',
        'aria-label': 'Runner camera. It rides over the board behind the pulse of the current bus cycle, from the CPU to the target chip and back. Scroll or plus and minus to zoom.',
      }, root);
      this.wrap.style.cursor = 'default';
      htmlEl('div', { class: 'bv-vignette', 'aria-hidden': 'true' }, root);
      const top = htmlEl('div', { class: 'bv-top' }, root);
      const row = this.modeSlot = htmlEl('div', { class: 'bv-row' }, top);
      const seg = (label, items, cur, cb) => {
        const g = htmlEl('div', { class: 'bv-presets', role: 'group', 'aria-label': label }, row);
        htmlEl('span', { class: 'bv-seg-label', 'aria-hidden': 'true' }, g, { 'Signal to follow': 'Follow', Camera: 'Camera', 'Into chips': 'Into chips', 'Sound effects': 'Sound' }[label]);
        const btns = {};
        for (const [k, t] of items) {
          const b = htmlEl('button', { type: 'button', class: 'bv-btn', 'aria-pressed': k === cur ? 'true' : 'false', 'aria-label': `${label}: ${t}` }, g, t);
          b.addEventListener('click', () => { for (const x in btns) btns[x].setAttribute('aria-pressed', x === k ? 'true' : 'false'); cb(k); });
          btns[k] = b;
        }
        return btns;
      };
      seg('Signal to follow', [['auto', 'Auto'], ['addr', 'Address'], ['data', 'Data'], ['ctrl', 'Control']], this.mode, k => {
        this.mode = k; storage.set('runMode', k);
        if (this.cur) this.setRoute(this.buildRoute(this.cur.e));
      });
      seg('Camera', [['chase', 'Chase'], ['side', 'Side'], ['top', 'Top']], this.camMode, k => { this.camMode = k; storage.set('runCam', k); });
      seg('Into chips', [['off', 'Off'], ['on', 'On']], this.into ? 'on' : 'off', k => {
        this.into = k === 'on'; storage.set('runInto', this.into);
        if (this.cur) this.setRoute(this.buildRoute(this.cur.e));
      });
      this.bindZoom();
      const hud = this.hud = htmlEl('section', { class: 'bv-hud', 'aria-hidden': 'true' }, root);
      const ht = htmlEl('div', { class: 'bv-hud-top' }, hud);
      this.hType = htmlEl('span', { class: 'bv-type' }, ht, 'IDLE');
      this.hDev = htmlEl('span', { class: 'bv-dev' }, ht, 'waiting for a bus cycle');
      this.hLeg = htmlEl('p', { class: 'bv-leg' }, hud, 'Step or run the program. The camera follows each bus cycle.');
      const val = htmlEl('div', { class: 'bv-val' }, hud);
      this.hHex = htmlEl('b', { class: 'bv-hex' }, val, '—');
      this.hBits = htmlEl('span', { class: 'bv-bits' }, val);
      this.bits = [];
      for (let i = ADDR_BITS - 1; i >= 0; i--) {
        const b = htmlEl('i', i % 4 === 3 && i < ADDR_BITS - 1 ? { class: 'bv-gap' } : null, this.hBits);
        this.bits[i] = b;
      }
      const ts = htmlEl('div', { class: 'bv-ts' }, hud);
      this.tSeg = [];
      for (let i = 0; i < 4; i++) {
        const s = htmlEl('span', null, ts);
        const f = htmlEl('i', null, s);
        s.appendChild(document.createTextNode('T' + (i + 1)));
        this.tSeg.push([s, f]);
      }
      this.hIns = htmlEl('p', { class: 'bv-ins' }, hud, '');
      this.mini = htmlEl('canvas', { class: 'bv-mini', 'aria-hidden': 'true' }, root);
    }

    // ---------- 3D extras in the board scene ----------
    buildExtras(b) {
      const rx = this.rx = new T.Group();
      b.scene.add(rx);
      b.runnerGroup = rx;
      this.cam = new T.PerspectiveCamera(55, 1.6, 0.03, 260);
      rx.add(this.cam);
      const tex = dotTexture();
      this.orbCore = new T.Mesh(new T.SphereGeometry(0.05, 18, 12), new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
      this.orbGlow = new T.Sprite(new T.SpriteMaterial({ map: tex, color: THEME.cyan, blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      this.orbHalo = new T.Sprite(new T.SpriteMaterial({ map: tex, color: THEME.cyan, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35, toneMapped: false }));
      this.orbGlow.scale.setScalar(0.55);
      this.orbHalo.scale.setScalar(1.8);
      this.orb = new T.Group();
      this.orb.add(this.orbCore, this.orbGlow, this.orbHalo);
      rx.add(this.orb);
      const addMat = () => new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, side: T.DoubleSide });
      // trail
      const N = this.trailN = 72;
      const tg = new T.BufferGeometry();
      tg.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 6), 3));
      tg.setAttribute('color', new T.BufferAttribute(new Float32Array(N * 6), 3));
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      tg.setIndex(idx);
      this.trail = new T.Mesh(tg, addMat());
      this.trail.frustumCulled = false;
      this.trail.renderOrder = 6;
      rx.add(this.trail);
      this.hist = [];
      // route highlight
      this.hl = new T.Mesh(new T.BufferGeometry(), addMat());
      this.hl.frustumCulled = false;
      this.hl.renderOrder = 5;
      rx.add(this.hl);
      // speed lines, in camera space
      const L = 90;
      this.lines = [];
      for (let i = 0; i < L; i++) this.lines.push(this.newLine({}, true));
      const lg = new T.BufferGeometry();
      lg.setAttribute('position', new T.BufferAttribute(new Float32Array(L * 6), 3));
      this.speed = new T.LineSegments(lg, new T.LineBasicMaterial({ color: '#d9eeff', transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      this.speed.frustumCulled = false;
      this.cam.add(this.speed);
      this.orbS = { x: new T.Vector3(-9.5, 0.1, -2), v: new T.Vector3() };
      this.camS = { a: new T.Vector3(), o: new T.Vector3(), l: new T.Vector3(), u: new T.Vector3(0, 1, 0), av: new T.Vector3(), ov: new T.Vector3(), lv: new T.Vector3(), uv: new T.Vector3() };
      this.orbCol = new T.Color(THEME.cyan); this.wA = 2; this.orbOn = false; this.orbA = 0; this.osc = 1; this.blur = 0;
      this.roll = 0; this.lastYaw = null; this.fwd = new T.Vector3(1, 0, 0); this.fwdV = new T.Vector3();
      this.lastOrb = new T.Vector3();
      this.snap = true;
    }
    newLine(l, any) {
      const r = 0.35 + Math.random() * 1.8, a = Math.random() * TAU;
      l.x = Math.cos(a) * r; l.y = Math.sin(a) * r * 0.65; l.z = any ? -0.4 - Math.random() * 14 : -14;
      l.len = 0.3 + Math.random() * 0.9;
      return l;
    }

    // ---------- routes ----------
    chainPoly(id, trim, rev) {
      return this.board.chainPts(id, trim, rev);
    }
    target(dev, lo) { return this.board.devTarget(dev, lo, this.curPort || 0); }
    buildRoute(e) {
      const C = THEME;
      const I0 = busInfo(e);
      const { kind, fpu, read, dev, addr, width, memDev, lo, hi, d16 } = I0;
      const dn = !memDev && width !== 2 ? 8 : 16;
      this.curPort = addr & 0xFFFF;
      const tg = this.target(dev, lo);
      const who = fpu ? NM.fpu : NM.cpu;
      const colL = fpu ? C.lavender : C.cyan, colD = kind === 'memw' ? C.goldHi : C.gold, colDL = fpu ? C.lavender : colD;
      const vA = { v: addr, n: ADDR_BITS }, vD = { v: d16, n: dn };
      const st = STATUS[kind], cmd = CMD_BIT[kind];
      const legs = [];
      const tr = pts => pts.map(p => new T.Vector3(p[0], RUN_Y, p[1]));
      const add = (pts3, p0, p1, label, color, val, hop, dv) => {
        if (!pts3 || !pts3.length) return;
        if (M286) label = label.replace(/^T1 ·/, 'Ts ·').replace(/^T[234] ·/, 'Tc ·');
        if (!hop && legs.length) {
          const a = legs[legs.length - 1].pts, last = a[a.length - 1];
          if (last.distanceTo(pts3[0]) > 0.25) {
            const hp = p0 + Math.min(Math.max(0.15, (p1 - p0) * 0.3), (p1 - p0) * 0.45);
            add(this.hopPts(last, pts3[0]), p0, hp, label, color, val, true);
            p0 = hp;
          }
        }
        const cum = [0];
        for (let i = 1; i < pts3.length; i++) cum.push(cum[i - 1] + pts3[i].distanceTo(pts3[i - 1]));
        legs.push({ pts: pts3, cum, len: cum[cum.length - 1], p0, p1, label, color: new T.Color(color), css: color, val, hop: !!hop, dive: dv ? dv.scale * (dv.zoom || 1) : 0, center: dv ? dv.center : null, upv: dv ? dv.upv : null, nrm: dv ? dv.nrm : null, dieS: dv ? dv.scale : 0, zoomF: dv ? dv.zoom || 1 : 1 });
      };
      const Laddr = () => tr(this.chainPoly(fpu ? 'L_addr_fpu' : 'L_addr_cpu'));
      const Ldata = rev => tr(this.chainPoly(dev === 'fpu' ? 'L_fpu' : fpu ? 'L_data_fpu' : 'L_data_cpu', null, rev));
      const Achain = () => tr(this.chainPoly(tg.a, tg.xz || null));
      const Dchain = rev => (tg.d ? tr(this.chainPoly(tg.d, tg.xz || null, rev)) : null);
      const CS = () => (this.board.routes[tg.cs] ? tr(this.board.routes[tg.cs].path) : []);
      const dName = `<b>${tg.name}</b>`;
      const hopCard = (p0, p1, up) => {
        if (!tg.card) return;
        const a = legs[legs.length - 1].pts, last = a[a.length - 1];
        add(up ? this.hopPts(last, tg.card, 0.6) : this.hopPts(tg.card, last, 0.6), p0, p1, `T2 · up the ISA slot to the ${dName}`, up ? colL : colD, up ? vA : vD, true);
      };
      const hxA = hexA(addr), hexD = dn === 8 ? hex2(d16) : hex4(d16);
      const xcvT = dev === 'fpu' ? 'the local data bus' : `${NM.xcv} transceiver`;
      const aLeg = (p0, p1) => {
        add(Laddr(), p0, p0 + (p1 - p0) * 0.45, `T1 · the ${who} drives address <b>${hxA}</b> on ${NM.abus} → ${NM.lat} latches`, colL, vA);
        add(Achain(), p0 + (p1 - p0) * 0.45, p1, `T1 · ALE latches it · system address bus → ${dName}`, C.cyan, vA);
      };
      const csLeg = (p0, p1) => {
        add(Laddr(), p0, p0 + (p1 - p0) * 0.45, `T1 · the ${who} drives address <b>${hxA}</b> on ${NM.abus} → ${NM.lat} latches`, colL, vA);
        add(tr(this.board.routes.SA_t.path), p0 + (p1 - p0) * 0.45, p0 + (p1 - p0) * 0.6, `T1 · ALE strobe: the ${NM.lat} latches keep the address on the system bus`, C.cyan, vA);
        add(CS(), p0 + (p1 - p0) * 0.6, p1, `T2 · the 74LS138 decodes it: chip select → ${dName}`, C.magenta, vA);
      };
      const readBack = (p0, p1) => {
        add(Dchain(true), p0, p0 + (p1 - p0) * 0.62, `T3 · ${dName} puts data <b>${hexD}</b> on the system data bus`, colD, vD);
        add(Ldata(true), p0 + (p1 - p0) * 0.62, p1, `T3 · ${xcvT} (DT/R = receive) → ${who}`, colDL, vD);
      };
      const writeOut = (p0, p1) => {
        add(Ldata(false), p0, p0 + (p1 - p0) * 0.4, `T2 · the ${who} drives data <b>${hexD}</b> → ${xcvT} (DT/R = transmit)`, colDL, vD);
        add(Dchain(false), p0 + (p1 - p0) * 0.4, p1, `T3 · system data bus → ${dName} (write)`, colD, vD);
      };
      const mode = this.mode;
      const DV = mode === 'auto' ? this.planDive(e, busInfo(e)) : null;
      if (kind === 'inta') {
        if (mode === 'data') readBack(1.7, 3.3);
        else if (mode === 'ctrl') {
          add(tr(this.board.routes.S02.path), 0, 0.6, `T1 · ${NM.status} = interrupt acknowledge → ${NM.bus}`, C.magenta, { v: 0, n: 3 });
          add(tr(this.board.routes.CMD_IO.path), 1.0, 1.8, `T2 · the ${NM.bus} drives <b>INTA</b> → 8259A`, C.magenta, { v: 16, n: 5 });
        } else {
          const dd = DV && DV.dev;
          add(tr(this.board.routes.INTR.path), 0, dd ? 1.0 : 1.3, `<b>INTR</b> ← 8259A: an interrupt request reaches the ${NM.cpu}`, C.magenta, { v: 1, n: 1 });
          if (mode === 'auto') {
            if (dd) { this.addSteps(add, DV.dev, 1.0, 2.9); readBack(2.9, 3.9); } else readBack(1.7, 3.3);
          }
        }
      } else if (mode === 'ctrl') {
        add(tr(this.board.routes.S02.path), 0, 0.6, `T1 · ${NM.status} = <b>${st.toString(2).padStart(3, '0')}</b> (${STATUS_NAME[st]}) → ${NM.bus}`, C.magenta, { v: st, n: 3 });
        if (kind !== 'halt') {
          const cr = tg.card ? 'CMD_SLOT' : (kind === 'ior' || kind === 'iow') ? 'CMD_IO' : 'CMD_MEM';
          add(tr(this.board.routes[cr].path), 1.0, 1.8, `T2 · the ${NM.bus} drives <b>${CMD_NAME[cmd]}</b> → ${dName}`, C.magenta, { v: 1 << cmd, n: 5 });
          add(tr(this.board.routes.DEN.path), 1.8, 2.6, `T2 · DEN on, DT/R = ${read ? 'receive' : 'transmit'} → ${NM.xcv} transceivers`, C.magenta, { v: read ? 1 : 3, n: 2 });
        }
      } else if (mode === 'addr') {
        aLeg(0, 1.7);
        hopCard(1.7, 2.1, true);
      } else if (mode === 'data') {
        if (read) {
          if (tg.card) add([tg.card.clone()], 1.5, 1.6, `T3 · ${dName}`, colD, vD);
          readBack(1.7, 3.3);
        } else { writeOut(1.0, 2.6); hopCard(2.6, 3.0, false); }
      } else if (read) {
        // Into chips: the cycle starts inside the CPU (T1), the memory or I/O chip works in T2–T3
        let o = 0;
        if (DV && DV.cpu) { this.addSteps(add, DV.cpu, 0, 0.45); o = 0.45; }
        const dd = DV && DV.dev && (tg.cs || tg.card);
        if (tg.cs) csLeg(o, dd ? 1.2 : 1.6); else { aLeg(o, dd ? 1.0 : 1.5); hopCard(dd ? 1.0 : 1.5, dd ? 1.2 : 1.8, true); }
        if (dd) { this.addSteps(add, DV.dev, 1.2, 3.1); if (tg.d) readBack(3.1, 3.95); }
        else if (tg.d) readBack(1.8, 3.4);
      } else {
        let o = 0;
        if (DV && DV.cpu) { this.addSteps(add, DV.cpu, 0, 0.4); o = 0.4; }
        const dd = DV && DV.dev && (tg.cs || tg.card), tA = dd ? 1.0 : 1.3;
        if (tg.cs) csLeg(o, tA); else aLeg(o, tA);
        const L = Ldata(false);
        if (L.length && legs.length) {
          const a = legs[legs.length - 1].pts;
          add(this.hopPts(a[a.length - 1], L[0], 1.6), tA, tA + 0.4, `T2 · back to the ${who}: the data leaves the CPU`, colDL, vD, true);
        }
        if (tg.d) writeOut(tA + 0.4, dd ? 2.1 : 3.1);
        if (dd) this.addSteps(add, DV.dev, 2.1, 3.8);
        else hopCard(3.1, 3.4, false);
      }
      return { legs, kind, fpu, dev, tg, read, addr, d16, e, lo, hi };
    }
    // ---------- into the chips ----------
    // World helpers for one die: points, bond wires (an arc up from the die), pins.
    dieKit(e) {
      const b = this.board, s = b.dieScale(e);
      const W = pts => pts.map(p => b.dieW(e, p, 0.006));
      const bond = (a, c) => {
        const out = [];
        for (let i = 1; i < 10; i++) { const t = i / 10; out.push(b.dieW(e, [lerp(a[0], c[0], t), lerp(a[1], c[1], t)], 0.006 + Math.sin(Math.PI * t) * s * 0.12)); }
        return out;
      };
      const pinIn = pin => [b.pinW(e, pin), b.dieW(e, pin.e, 0.006)].concat(bond(pin.e, pin.p), [b.dieW(e, pin.p, 0.006)]);
      const pinOut = pin => [b.dieW(e, pin.p, 0.006)].concat(bond(pin.p, pin.e), [b.dieW(e, pin.e, 0.006), b.pinW(e, pin)]);
      const route = refs => W(b.dieRoute(e, refs));
      e.grp.updateWorldMatrix(true, false);
      const upv = new T.Vector3(0, 0, -1).transformDirection(e.grp.matrixWorld);   // up in the die text
      e.mesh.updateWorldMatrix(true, false);
      const nrm = new T.Vector3(0, 0, 1).transformDirection(e.mesh.matrixWorld);   // out of the die
      return { b, e, s, W, pinIn, pinOut, route, upv, nrm, center: b.dieW(e, [e.cw / 2, e.ch / 2], 0.006), C: k => b.bCtr(e, typeof k === 'number' ? k : b.bIdx(e, k)) };
    }
    stepsCpu(e, I) {
      if (!e) return null;
      const K = this.dieKit(e), C = THEME, st = STATUS[I.kind];
      const bc = I.fpu ? 'BUS INTERFACE' : 'BUS CONTROL', src = I.fpu ? 'REGISTER STACK' : 'ADDRESS ADDER';
      const pad = K.b.padNear(e, K.C(bc));
      return [
        { pts: K.W([K.C(src)]), label: I.fpu ? '8087: the bus interface takes the bus (RQ/GT0) for an operand'
          : M286 ? `Address unit: segment base + offset = <b>${hexA(I.addr)}h</b>, checked against the limit` : `Σ in the bus unit: segment × 16 + offset = <b>${hex5(I.addr)}h</b>`, color: C.cyan, val: { v: I.addr, n: ADDR_BITS } },
        { pts: K.route([K.C(src), K.C(bc)]), label: `Bus control starts ${M286 ? 'Ts' : 'T1'}: ${NM.status} = <b>${st.toString(2).padStart(3, '0')}</b> (${STATUS_NAME[st]})`, color: C.magenta, val: { v: st, n: 3 } },
        { pts: K.route([K.C(bc), pad.p]).concat(K.pinOut(pad)), label: M286 ? 'The address drivers put A0–A23 on the pins' : 'The AD pins drive the address out of the chip', color: C.cyan, val: { v: I.addr, n: ADDR_BITS } },
      ].map(x => Object.assign(x, { scale: K.s, center: K.center, upv: K.upv, nrm: K.nrm }));
    }
    stepsDram(e, I, k, byte, phys, g) {
      const K = this.dieKit(e), b = K.b, C = THEME;
      if (!g) { const c0 = (phys >> 1) & ((1 << (2 * RB)) - 1); g = { row: c0 & ((1 << RB) - 1), col: c0 >> RB, rb: RB, cb: RB, bit: (byte >> k) & 1, bits: 1, dq: 'D' + k, ca: c0 }; }
      const row = g.row, col = g.col, bit = g.bits > 1 ? hex(g.bit, 1) + 'h' : g.bit, ca = g.ca !== undefined ? g.ca : (col << g.rb) | row;
      const hexR = v => (g.rb > 8 || g.cb > 8 ? hex(v, 3) : hex2(v));
      const D = b.dramCell(e, row, col, g.rb, g.cb);
      const rd = K.C(D.rd), sa = K.C(D.sa), cd = K.C(D.cd), cc = [D.cell[0] + D.pc / 2, D.cell[1] + D.pr / 2];
      const entry = [D.Q.x + (col & (1 << (g.cb - 1)) ? 0 : D.Q.w), cc[1]];
      const aPin = b.padNear(e, rd), dPin = b.padNear(e, cd, true);
      const cell = `(${hexR(row)}h, ${hexR(col)}h)`;
      const s1 = { pts: K.pinIn(aPin).concat(K.route([aPin.p, rd]).slice(1)), label: `Row decoder: RAS latches row <b>${hexR(row)}h</b> (the low ${g.rb} bits of the chip address ${hex(ca, 5)}h)`, color: C.cyan, val: { v: row, n: g.rb } };
      const s2 = { pts: K.W([rd, entry, cc]), label: `Word line <b>${hexR(row)}h</b> opens a row of ${(1 << g.cb) * (g.bits || 1)} cells`, color: '#ff9a86', val: { v: row, n: g.rb } };
      let steps;
      if (I.read) {
        steps = [s1, s2,
          { pts: K.W([cc]), label: `CAS latches column <b>${hexR(col)}h</b>: cell ${cell} holds ${g.bits > 1 ? 'nibble' : 'bit'} <b>${bit}</b>`, color: C.phosphor, val: { v: g.bit, n: g.bits || 1 }, zoom: 0.07 },
          { pts: K.W([cc, [cc[0], sa[1]], sa]), label: `Sense amplifier reads <b>${bit}</b> from cell ${cell}`, color: C.gold, val: { v: g.bit, n: g.bits || 1 } },
          { pts: K.route([sa, cd, dPin.p]).concat(K.pinOut(dPin)), label: `Output buffer drives <b>${g.dq}</b> = ${bit} onto the data bus`, color: C.gold, val: { v: g.bit, n: g.bits || 1 } }];
      } else {
        steps = [s1, s2,
          { pts: K.pinIn(dPin).concat(K.route([dPin.p, cd, sa]).slice(1)), label: `Column decoder: CAS selects column <b>${hexR(col)}h</b> · ${g.dq} in = ${bit}`, color: C.goldHi, val: { v: bit, n: 1 } },
          { pts: K.W([sa, [cc[0], sa[1]], cc]), label: `The write amplifier stores <b>${bit}</b> in cell ${cell}`, color: C.phosphor, val: { v: g.bit, n: g.bits || 1 } },
          { pts: K.W([cc]), label: `Cell ${cell} now holds <b>${bit}</b>`, color: C.phosphor, val: { v: g.bit, n: g.bits || 1 }, zoom: 0.07 }];
      }
      return steps.map(x => Object.assign(x, { scale: K.s, center: K.center, upv: K.upv, nrm: K.nrm }));
    }
    stepsRom(e, phys, byte) {
      const K = this.dieKit(e), b = K.b, C = THEME, R = b.romCell(e, phys);
      const xd = K.C(1), yg = K.C(3), ob = K.C(4), hit = [R.bitl[0] + R.bitl[2] / 2, R.word[1] + R.word[3] / 2];
      const aPin = b.padNear(e, xd), dPin = b.padNear(e, ob, true);
      return [
        { pts: K.pinIn(aPin).concat(K.route([aPin.p, xd]).slice(1)), label: `X decoder selects row <b>${hex2(R.row)}h</b> (${M286 ? 'A6–A13' : 'A5–A12'})`, color: C.cyan, val: { v: R.row, n: 8 } },
        { pts: K.W([xd, [xd[0], hit[1]], hit]), label: `Word line <b>${hex2(R.row)}h</b>: the floating-gate cells of the row answer`, color: '#ff9a86', val: { v: R.row, n: 8 } },
        { pts: K.W([hit, [hit[0], yg[1]], yg]), label: `Y gating picks column <b>${hex2(R.col)}h</b> of ${1 << CB} for each output`, color: C.gold, val: { v: R.col, n: CB } },
        { pts: K.route([yg, ob, dPin.p]).concat(K.pinOut(dPin)), label: `Output buffers drive the byte <b>${hex2(byte)}h</b> onto D0–D7`, color: C.gold, val: { v: byte, n: 8 } },
      ].map(x => Object.assign(x, { scale: K.s, center: K.center, upv: K.upv, nrm: K.nrm }));
    }
    stepsIo(e, I, dev) {
      const K = this.dieKit(e), b = K.b, C = THEME, port = I.addr & 0xFFFF, data = I.d16 & 0xFF;
      const cr = this.app.machine.crtc;
      const inta = I.kind === 'inta', tgt = inta ? 'ISR' : ioBlock(dev, port, I.read, cr ? cr.index : 0);
      const ins = (IO_IN[dev] || []).filter(l => b.bIdx(e, l) >= 0);
      const pts = ins.map(l => K.C(l));
      const tp = b.bIdx(e, tgt) >= 0 ? K.C(tgt) : [e.cw / 2, e.ch / 2];
      const pin = b.padNear(e, pts[0] || tp);
      const name = (tgt || 'logic').toLowerCase();
      const first = pts[0] || tp, second = pts[1] || first;
      const steps = [];
      if (!I.read) {
        steps.push({ pts: K.pinIn(pin).concat(K.route([pin.p, first]).slice(1)), label: `Data bus buffer takes <b>${hex2(data)}h</b> from D0–D7`, color: C.goldHi, val: { v: data, n: 8 } });
        if (second !== first) steps.push({ pts: K.W([first, second]), label: `Read/write logic decodes port <b>${hex2(port)}h</b> (A0, A1, WR)`, color: C.magenta, val: { v: port & 3, n: 2 } });
        steps.push({ pts: K.route([second, tp]), label: `The ${name} takes the new value <b>${hex2(data)}h</b>`, color: C.gold, val: { v: data, n: 8 } });
      } else {
        steps.push({ pts: K.pinIn(pin).concat(K.route([pin.p, second]).slice(1)), label: inta ? 'Control logic: the second INTA pulse asks for the vector' : `Read/write logic decodes port <b>${hex2(port)}h</b> (A0, A1, RD)`, color: C.magenta, val: { v: port & 3, n: 2 } });
        steps.push({ pts: K.route([second, tp]), label: inta ? 'The ISR bit sets: this IRQ is now in service' : `The ${name} is selected`, color: C.magenta, val: { v: data, n: 8 } });
        steps.push({ pts: K.route([tp, first, pin.p]).concat(K.pinOut(pin)), label: `Data bus buffer drives <b>${hex2(data)}h</b> onto D0–D7${inta ? ' (the vector)' : ''}`, color: C.gold, val: { v: data, n: 8 } });
      }
      return steps.map(x => Object.assign(x, { scale: K.s, center: K.center, upv: K.upv, nrm: K.nrm }));
    }
    // Plan the dives for a bus cycle. It opens the package windows and restarts the die
    // activity of those chips on the runner's clock, so the die and the orb stay in step.
    planDive(ev, I) {
      const b = this.board, cur = this.cur;
      if (!b || !this.into || !this.diveOk || !cur) return null;
      const out = {}, m = this.app.machine, keys = [];
      if (I.kind !== 'inta') {
        const who = I.fpu ? 'fpu' : 'cpu', e = b.decaps.get(who);
        if (e) { keys.push(who); out.cpu = e; }
      }
      let key = null, k = 0, phys = 0;
      if (I.dev === 'ram') { const by = m.mem[(I.lo ? (I.width === 2 ? I.addr & ~1 : I.addr) : I.addr | 1) & 0xFFFFF]; k = 0; while (k < 7 && !((by >> k) & 1)) k++; if (!((by >> k) & 1)) k = 0; key = (I.lo ? 'ramE' : 'ramO') + k; phys = I.lo ? (I.width === 2 ? I.addr & ~1 : I.addr) : I.addr | 1; }
      else if (I.dev === 'rom') { key = I.lo ? 'romE' : 'romO'; phys = I.lo ? I.addr & ~1 : I.addr | 1; }
      else if (IO_DEV[I.dev] || I.kind === 'inta') key = I.dev;
      let g = null, ioKey = I.dev;
      if (I.dev === 'vram') { const gs = b.vramChips(I.addr, I.read); g = gs.find(x => x.bit) || gs[0]; if (g) key = g.key; }
      else if (I.dev === 'xram') { g = b.xramChip(I.addr, I.width === 2 ? (I.lo ? 0 : 1) : I.addr & 1); key = g.key; }
      else if (I.dev === 'crtc' || I.dev === 'cga') { key = 'crtc'; ioKey = 'crtc'; }
      else if (I.dev === 'vga') { key = ioKey = DAC_PORT(I.addr & 0xFFFF) ? 'dac' : 'vgac'; }
      else if (I.dev === 'fdc') key = 'fdc';
      else if (I.dev === 'vrom') { key = 'vbios'; phys = I.addr; }
      const de = key ? b.decaps.get(key) : null;
      if (de) keys.push(key);
      for (const kk of keys) {
        const e = b.decaps.get(kk);
        b.openWindow(e);
        e.cov = Math.max(e.cov, 0.4);
        b.fx.delete(kk);
        b.fxOnly = kk;
        b.busFx(ev, cur.t0, cur.ms);
        b.fxOnly = null;
      }
      if (out.cpu) out.cpu = this.stepsCpu(out.cpu, I);
      if (de) {
        const byte = m.mem[phys & 0xFFFFF];
        out.dev = g ? this.stepsDram(de, I, 0, 0, 0, g) : I.dev === 'ram' ? this.stepsDram(de, I, k, byte, phys)
          : I.dev === 'rom' || I.dev === 'vrom' ? this.stepsRom(de, phys, byte) : this.stepsIo(de, I, ioKey);
      }
      return out;
    }
    addSteps(add, steps, p0, p1) {
      if (!steps || !steps.length) return;
      const share = (p1 - p0) / steps.length;
      steps.forEach((s, i) => add(s.pts, p0 + i * share, p0 + i * share + share * 0.68, s.label, s.color, s.val, false, s));
    }

    hopPts(a, b, h) {
      const out = [], hh = h === undefined ? clamp(0.35 + a.distanceTo(b) * 0.09, 0.35, 2.4) : h;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, p = a.clone().lerp(b, t);
        p.y += Math.sin(Math.PI * t) * hh;
        out.push(p);
      }
      return out;
    }
    setRoute(r) {
      this.route = r;
      // a faint glowing line along the whole route
      const pos = [], col = [], idx = [];
      const k = this.reduced ? 0.9 : 0.32;
      for (const lg of r.legs) {
        const pts = lg.pts;
        if (pts.length < 2) continue;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          let nx = -(b.z - a.z), nz = b.x - a.x;
          const l = Math.hypot(nx, nz) || 1;
          const hw = lg.dive ? lg.dive * 0.012 : 0.03;
          nx = nx / l * hw; nz = nz / l * hw;
          const base = pos.length / 3;
          pos.push(pts[i].x + nx, pts[i].y + 0.004, pts[i].z + nz, pts[i].x - nx, pts[i].y + 0.004, pts[i].z - nz);
          for (let j = 0; j < 2; j++) col.push(lg.color.r * k, lg.color.g * k, lg.color.b * k);
          if (i < pts.length - 1) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      if (this.hl.geometry) this.hl.geometry.dispose();
      this.hl.geometry = g;
      this.hudKey = '';
    }
    posAt(ph) {
      const legs = this.route.legs;
      if (!legs.length) return null;
      let leg = legs[0];
      for (const l of legs) if (ph >= l.p0) leg = l;
      let u = clamp((ph - leg.p0) / Math.max(0.01, leg.p1 - leg.p0), 0, 1);
      if (leg.hop) u = u * u * (3 - 2 * u);
      const d = u * leg.len, pts = leg.pts, cum = leg.cum;
      let i = 0;
      while (i < pts.length - 2 && cum[i + 1] < d) i++;
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      const t = (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
      const p = a.clone().lerp(b, clamp(t, 0, 1));
      const tan = b.clone().sub(a);
      if (tan.lengthSq() < 1e-8) tan.copy(this.fwd);
      tan.normalize();
      return { p, tan, leg, u };
    }

    // ---------- view contract ----------
    show() {
      this.visible = true;
      const b = this.board;
      if (!b) {
        if (!this.failed) { this.failed = true; htmlEl('p', { class: 'bv-fail' }, this.root, 'The runner needs the 3D board, and WebGL is not available.'); }
        return;
      }
      if (!this.rx) this.buildExtras(b);
      b.attachTo(this.wrap);
      if (b.trG) b.trG.visible = false;
      this.rx.visible = true;
      this.snap = true;
      this.w = 0;
      this.resize();
    }
    hide() {
      this.visible = false;
      if (this.rx) this.rx.visible = false;
      this.sfx.silence();
      const b = this.board;
      if (b) for (const cg of [b.card, b.dcard, b.xcard]) if (cg) cg.visible = true;
    }
    resize() {
      const b = this.board;
      if (!b || !this.visible || !this.cam) return;
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h || (w === this.w && h === this.h)) return;
      this.w = w; this.h = h;
      b.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      b.renderer.setSize(w, h, false);
      b.w = 0;
      this.cam.aspect = w / h;
      this.cam.fov = w / h < 1 ? 72 : 52;
      // the HUD sits on the left: move the centre of the view to the right
      this.offX = w >= 700 && w / h > 1.1;
      if (this.offX) this.cam.setViewOffset(w, h, -Math.round(w * 0.12), 0, w, h);
      else this.cam.clearViewOffset();
      this.cam.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.mini.width = Math.round(210 * dpr); this.mini.height = Math.round(138 * dpr);
      this.miniBase = null;
    }
    reset() {
      this.queue.length = 0;
      this.cur = null;
      this.route = null;
      if (this.hist) this.hist.length = 0;
      if (this.hl && this.hl.geometry) { this.hl.geometry.dispose(); this.hl.geometry = new T.BufferGeometry(); }
      this.hudKey = '';
    }
    instr(events, info) {
      this.instrText = info.text || '';
      this.manual = info.clockMs >= 300;
      if (this.manual) { this.queue.length = 0; }
    }
    event(e, clockMs) {
      if (e.k !== 'fetch' && e.k !== 'bus') return;
      if (e.type === 'halt') return;
      const item = { e, ms: clockMs, t0: animNow(), tClk: e.t, manual: clockMs >= 300, instr: this.instrText, k: e.len ? 4 / e.len : 1 };
      if (item.manual) { this.start(item); return; }
      this.queue.push(item);
      if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    }
    fast(stats) {
      if (!this.visible || this.cur || this.queue.length || !stats.sample) return;
      const dec = stats.sample.find(x => x.k === 'decode');
      const ins = dec ? dec.text : '';
      for (const e of stats.sample) {
        if ((e.k === 'fetch' || e.k === 'bus') && e.type !== 'halt') this.queue.push({ e, ms: RUN_PACE, t0: 0, tClk: e.t, manual: false, instr: ins, k: e.len ? 4 / e.len : 1 });
        if (this.queue.length >= 4) break;
      }
    }
    setReducedMotion(on) {
      this.reduced = !!on;
      if (this.route) this.setRoute(this.route);
      this.snap = true;
    }
    start(item) {
      // the 3D parts of the runner exist only after the tab shows for the first time
      if (!this.board || !this.rx) return;
      const prev = this.cur;
      this.cur = item;
      // dive only when a clock lasts long enough in real time (slow motion, slow speeds, clock steps)
      this.diveOk = item.manual || item.ms / (this.app.motion || 1) >= 220;
      this.setRoute(this.buildRoute(item.e));
      // no teleport: when the orb is still on screen, it glides to the new route
      const leg0 = this.route.legs[0];
      if ((this.orbOn || performance.now() - (this.orbOffT || 0) < 1500) && leg0 && leg0.pts.length) {
        const d = this.orbS.x.distanceTo(leg0.pts[0]);
        if (d > 0.04) this.glide = { cur: item, from: this.orbS.x.clone(), dur: clamp(0.25 + d * 0.03, 0.3, 0.8), h: Math.min(1.6, d * 0.12) };
      }
      if (!prev || prev.e !== item.e) this.sfx.cycle(this.route.kind);
    }

    frame(now, dt) {
      const b = this.board;
      if (!this.visible || !b || !this.cam) return;
      if (!this.w) this.resize();
      if (!this.w) return;
      b.viewCam = this.cam;
      b.viewCx = this.offX ? 0.62 : 0.5;
      const s = b.simStep(now, dt);
      // the next bus cycle
      if (this.cur && (b.phaseOf(this.cur, now) > 4.4 || (this.cur.manual && !this.manual))) this.cur = null;
      if (!this.cur && this.queue.length) {
        const it = this.queue.shift();
        it.t0 = now;
        it.ms = Math.max(it.ms, RUN_PACE);
        this.start(it);
      }
      let st = null, ph = 0;
      if (this.cur && this.route) {
        ph = Math.max(0, b.phaseOf(this.cur, now));
        st = this.posAt(ph);
      }
      this.lastSt = st; this.lastPh = ph;
      const adt = clamp(dt || 16, 0, 250);
      this.updateMotion(st, ph, now, adt, s.rdt);
      const v = this.updateCamera(st, s.rnow, s.rdt);
      this.updateOrb(st, now, s.rdt);
      this.updateSfx(st, ph, v);
      this.updateHud(st, ph);
      this.drawMini(st);
      b.renderer.toneMappingExposure = 1.05;
      b.renderer.render(b.scene, this.cam);
    }
    // ---------- motion ----------
    // The orb follows its route through a critically damped spring on the animation clock,
    // so it never jumps; the camera rides on springs in real time, relative to an anchor.
    updateMotion(st, ph, now, adt, rdt) {
      const cur = this.cur, O = this.orbS;
      const A = adt / 1000, Rs = rdt / 1000;
      let target = null;
      if (st) {
        target = st.p.clone();
        const G = this.glide;
        if (G && G.cur === cur) {
          const u = clamp(ph / G.dur, 0, 1);
          if (u < 1) {
            const e = easeInOut(u);
            const base = G.from.clone().lerp(target, e);
            base.y += Math.sin(Math.PI * u) * G.h;
            target = base;
          } else this.glide = null;
        }
        if (!this.orbOn && performance.now() - (this.orbOffT || 0) > 1500) { O.x.copy(target); O.v.set(0, 0, 0); }
        const tau = clamp(0.1 * ((cur && cur.ms) || 60) / (cur && cur.k ? 1 / cur.k : 1), 6, 90) / 1000;
        springV(O.x, O.v, target, 1 / tau, A);
        this.orbOn = true;
        this.orbA = Math.min(1, this.orbA + Rs * 6);
        this.lastLeg = st.leg;
      } else {
        this.orbA = Math.max(0, this.orbA - Rs * 2.2);
        if (this.orbA <= 0 && this.orbOn) { this.orbOn = false; this.orbOffT = performance.now(); }
        O.v.multiplyScalar(Math.exp(-A * 8));
      }
      return target;
    }
    updateOrb(st, now, rdt) {
      const leg = st ? st.leg : this.lastLeg;
      const on = this.orbOn && !this.reduced && !!leg;
      this.orb.visible = on;
      const dv = leg && leg.dive ? leg.dieS || leg.dive : 0;
      this.speed.visible = on && this.camMode === 'chase' && !dv;
      // the orb shrinks inside a chip, so that the die stays visible
      const want = dv ? clamp(dv * 0.12, 0.004, 1) : 1;
      const k = 1 - Math.exp(-rdt / 180);
      this.osc += (want - this.osc) * k;
      const O = this.orbS;
      if (on) {
        this.orb.position.copy(O.x);
        this.orbCol.lerp(leg.color, 1 - Math.exp(-rdt / 90));
        this.orbGlow.material.color.copy(this.orbCol);
        this.orbHalo.material.color.copy(this.orbCol);
        const a = this.orbA, pulse = 1 + 0.1 * Math.sin(now * 0.012);
        this.orbCore.scale.setScalar(this.osc * a);
        // a light motion blur: the glow stretches along the screen velocity
        const p0 = O.x.clone().project(this.cam), p1 = O.x.clone().addScaledVector(O.v, -0.035).project(this.cam);
        const dx = (p0.x - p1.x) * this.w, dy = (p0.y - p1.y) * this.h;
        const sp = Math.hypot(dx, dy), str = clamp(sp / 40, 0, 2.2);
        this.blur += (str - this.blur) * (1 - Math.exp(-rdt / 60));
        const ang = Math.atan2(dy, dx);
        for (const [sprite, s0, op] of [[this.orbGlow, 0.55, 1], [this.orbHalo, 1.8, 0.35]]) {
          sprite.material.rotation = ang;
          sprite.scale.set(s0 * this.osc * pulse * (1 + this.blur), s0 * this.osc * pulse / (1 + this.blur * 0.25), 1);
          sprite.material.opacity = op * a;
        }
      }
      // trail: a ribbon that faces the camera and fades with age
      const H = this.hist, rnow = performance.now();
      const eps = 0.012 * this.osc;
      if (on && this.orbA > 0.5 && (!H.length || H[0].p.distanceTo(O.x) > eps)) H.unshift({ p: O.x.clone(), c: this.orbCol.clone(), t: rnow, w: this.osc });
      while (H.length && (H.length > this.trailN || rnow - H[H.length - 1].t > 700)) H.pop();
      const pos = this.trail.geometry.attributes.position, col = this.trail.geometry.attributes.color;
      const N = this.trailN, cp = this.cam.position;
      const side = new T.Vector3(), dir = new T.Vector3(), toC = new T.Vector3();
      for (let i = 0; i < N; i++) {
        const h = H[i];
        if (!h || H.length < 2) { for (let j = 0; j < 2; j++) { pos.setXYZ(i * 2 + j, 0, -50, 0); col.setXYZ(i * 2 + j, 0, 0, 0); } continue; }
        const nb = H[Math.min(i + 1, H.length - 1)], pb = H[Math.max(i - 1, 0)];
        dir.subVectors(pb.p, nb.p);
        toC.subVectors(cp, h.p);
        side.crossVectors(dir, toC);
        const l = side.length() || 1;
        const age = clamp((rnow - h.t) / 700, 0, 1), f = (1 - i / H.length) * (1 - age);
        const w = (0.04 * f + 0.003) * h.w;
        side.multiplyScalar(w / l);
        pos.setXYZ(i * 2, h.p.x + side.x, h.p.y + side.y, h.p.z + side.z);
        pos.setXYZ(i * 2 + 1, h.p.x - side.x, h.p.y - side.y, h.p.z - side.z);
        const a = f * f * 0.85 * this.orbA;
        for (let j = 0; j < 2; j++) col.setXYZ(i * 2 + j, h.c.r * a, h.c.g * a, h.c.b * a);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
    }
    updateCamera(st, rnow, rdt) {
      const Y = new T.Vector3(0, 1, 0), O = this.orbS, R = rdt / 1000;
      const leg = st ? st.leg : (this.orbOn ? this.lastLeg : null);
      const Z = this.zoomS += (this.zoomT - this.zoomS) * (1 - Math.exp(-rdt / 110));
      const dv = leg && leg.dive ? leg.dieS || leg.dive : 0;
      let anchor, off, look = new T.Vector3(), up = Y.clone(), wA = 30, wO = 4.5;
      // the forward direction follows the orb velocity (smoothed)
      if (O.v.lengthSq() > 1e-10) {
        const f = O.v.clone(); f.y = 0;
        if (f.lengthSq() > 1e-10) springV(this.fwd, this.fwdV, f.normalize(), 7, R);
      }
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(1, 0, 0);
      const fw = this.fwd.clone().normalize();
      const right = new T.Vector3().crossVectors(fw, Y).normalize();
      const yaw = Math.atan2(fw.x, fw.z);
      let rate = 0;
      if (this.lastYaw !== null) { let d = yaw - this.lastYaw; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; rate = d / Math.max(1, rdt); }
      this.lastYaw = yaw;
      this.roll += (clamp(-rate * 140, -0.45, 0.45) - this.roll) * (1 - Math.exp(-rdt / 260));
      if (this.reduced) {
        if (dv && leg.center) { anchor = leg.center.clone(); off = leg.nrm.clone().multiplyScalar(dv * 2.4 * Z); up = leg.upv.clone(); }
        else { anchor = new T.Vector3(0, 0, -0.5); off = new T.Vector3(0, 31, 15).multiplyScalar(Z); }
        this.snap = true;
      } else if (dv && leg.center) {
        // inside a chip: a top view of the whole die, text upright; the cell step goes close
        const close = leg.zoomF && leg.zoomF < 1;
        anchor = close ? O.x.clone() : leg.center.clone();
        off = leg.nrm.clone().multiplyScalar(dv * (close ? 0.3 : 2.4) * Z);
        up = leg.upv.clone();
        wA = 6; wO = 3.2;
      } else if (this.orbOn) {
        anchor = O.x.clone();
        if (this.camMode === 'side') off = right.clone().multiplyScalar(-4.2 * Z).addScaledVector(Y, 2.1 * Z).addScaledVector(fw, -0.6 * Z);
        else if (this.camMode === 'top') { off = Y.clone().multiplyScalar(9.5 * Z).addScaledVector(fw, -0.4 * Z); up = fw.clone(); }
        else {
          off = fw.clone().multiplyScalar(-2.3 * Z).addScaledVector(Y, (0.95 + Math.max(0, O.x.y - RUN_Y) * 0.4) * Z);
          look = fw.clone().multiplyScalar(1.7 * Z); look.y = -0.25 * Z;
          up = Y.clone().multiplyScalar(Math.cos(this.roll)).addScaledVector(right, Math.sin(this.roll));
        }
      } else {
        // between bus cycles: glide back to the CPU and circle it slowly
        const a = rnow * 0.00012;
        anchor = new T.Vector3(...(DEV_XZ.cpu ? [DEV_XZ.cpu[0], 0.3, DEV_XZ.cpu[1]] : [-9.5, 0.3, -2]));
        off = new T.Vector3(Math.sin(a) * 5.5 + 2, 3.4, Math.cos(a) * 5.5 + 2).multiplyScalar(Z);
        wA = 1.6; wO = 1.4;
        this.lastYaw = null;
      }
      const C = this.camS;
      if (this.snap) {
        C.a.copy(anchor); C.o.copy(off); C.l.copy(look); C.u.copy(up);
        C.av.set(0, 0, 0); C.ov.set(0, 0, 0); C.lv.set(0, 0, 0); C.uv.set(0, 0, 0);
        this.snap = false;
      } else {
        // the anchor stiffness eases in, so that the camera never whips to a new target
        this.wA += (wA - this.wA) * (1 - Math.exp(-rdt / (wA > this.wA ? 500 : 60)));
        springV(C.a, C.av, anchor, this.wA, R);
        springV(C.o, C.ov, off, wO, R);
        springV(C.l, C.lv, look, wO, R);
        springV(C.u, C.uv, up, 5, R);
      }
      const eye = C.a.clone().add(C.o), at = C.a.clone().add(C.l);
      this.cam.position.copy(eye);
      this.cam.up.copy(C.u.lengthSq() > 1e-6 ? C.u.clone().normalize() : Y);
      this.cam.lookAt(at);
      const near = clamp(eye.distanceTo(at) * 0.02, 0.0008, 0.03);
      if (Math.abs(this.cam.near - near) > near * 0.08) { this.cam.near = near; this.cam.updateProjectionMatrix(); }
      if (this.board) this.board.updateOcclusion(eye, at);
      // speed lines
      const v = this.orbOn ? O.v.length() / Math.max(0.02, this.osc) : 0;
      const sk = clamp(v / 30, 0, 1);
      this.speed.material.opacity += (sk * 0.5 - this.speed.material.opacity) * (1 - Math.exp(-rdt / 120));
      if (this.speed.visible) {
        const arr = this.speed.geometry.attributes.position;
        const mv = (0.002 + sk * 0.03) * rdt;
        this.lines.forEach((l, i) => {
          l.z += mv;
          if (l.z > -0.3) this.newLine(l, false);
          const s = l.len * (0.4 + sk * 2);
          arr.setXYZ(i * 2, l.x, l.y, l.z); arr.setXYZ(i * 2 + 1, l.x, l.y, l.z - s);
        });
        arr.needsUpdate = true;
      }
      return v;
    }
    // ---------- zoom by wheel and pinch ----------
    bindZoom() {
      const el = this.wrap, P = new Map();
      const setZ = z => { this.zoomT = clamp(z, 0.3, 4); storage.set('runZoom', this.zoomT); };
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        setZ(this.zoomT * Math.exp(clamp(dy, -200, 200) * 0.0015));
      }, { passive: false });
      let d0 = 0, z0 = 1;
      const dist = () => { const [a, b] = [...P.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
      el.addEventListener('pointerdown', e => {
        P.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (P.size === 2) { d0 = dist(); z0 = this.zoomT; }
        el.focus({ preventScroll: true });
        if (this.sfx) this.sfx.gesture();
      });
      el.addEventListener('pointermove', e => {
        if (!P.has(e.pointerId)) return;
        P.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (P.size === 2 && d0 > 0) setZ(z0 * d0 / Math.max(10, dist()));
      });
      const end = e => { P.delete(e.pointerId); if (P.size < 2) d0 = 0; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', e => {
        if (e.key === '+' || e.key === '=') { setZ(this.zoomT * 0.85); e.preventDefault(); }
        else if (e.key === '-' || e.key === '_') { setZ(this.zoomT / 0.85); e.preventDefault(); }
      });
    }
    updateSfx(st, ph, v) {
      const S = this.sfx;
      if (!S.want) return;
      const leg = st ? st.leg : null;
      S.update(clamp(v / 20, 0, 1), !!(leg && leg.dive), !!st && this.visible && !this.reduced);
      if (!st) return;
      if (leg !== this.sndLeg) {
        this.sndLeg = leg;
        if (/ALE|chip select|latch/i.test(leg.label)) S.select();
      }
      // a click per T-state when a clock is slow enough to hear it
      const cur = this.cur, kk = (cur && cur.k) || 1, clk = Math.floor(ph / kk);
      if (clk !== this.sndClk) {
        this.sndClk = clk;
        if (cur && (cur.manual || cur.ms / (this.app.motion || 1) >= 150)) S.click();
      }
    }
    updateHud(st, ph) {
      const r = this.route, cur = this.cur;
      const acc = !r ? 'var(--faint)' : r.fpu ? 'var(--lavender)' : r.kind === 'ior' || r.kind === 'iow' || r.kind === 'inta' ? 'var(--magenta)' : r.kind === 'memw' ? 'var(--gold-hi)' : 'var(--gold)';
      const key = st ? `${r.e.t}|${r.addr}|${st.leg.label}|${r.kind}` : 'idle';
      if (key !== this.hudKey) {
        this.hudKey = key;
        this.hud.style.setProperty('--bv-acc', acc);
        if (!st) {
          this.hType.textContent = 'IDLE';
          this.hDev.textContent = 'waiting for a bus cycle';
          this.hLeg.textContent = this.app.mode === 'fast' ? 'Fast mode: the camera follows sampled bus cycles.' : 'Step or run the program. The camera follows each bus cycle.';
          this.hHex.textContent = '—';
          this.bits.forEach(b => { b.hidden = true; });
          this.hud.style.setProperty('--bv-leg', 'var(--faint)');
        } else {
          this.hType.textContent = (r.fpu ? NM.fpu + ' ' : '') + TYPE_NAME[r.kind];
          this.hDev.textContent = '→ ' + r.tg.name;
          this.hLeg.innerHTML = st.leg.label;
          const v = st.leg.val || { v: 0, n: 0 };
          this.hHex.textContent = v.n > 16 ? hexA(v.v) : v.n > 12 ? hex4(v.v) : v.n > 8 ? hex(v.v, 3) : v.n > 4 ? hex2(v.v) : (v.v >>> 0).toString(2).padStart(Math.max(1, v.n), '0');
          this.bits.forEach((b, i) => { b.hidden = i >= v.n; b.classList.toggle('bv-on', !!((v.v >>> i) & 1)); });
          this.hud.style.setProperty('--bv-leg', '#' + st.leg.color.getHexString(T.SRGBColorSpace));
          this.hIns.textContent = cur && cur.instr ? cur.instr : '';
        }
      }
      // T-states: T1-T4 on the 8086; Ts, Tc and wait states (Tw) on the 80286
      const kk = (cur && cur.k) || (M286 ? 4 / 3 : 1), nT = clamp(Math.round(4 / kk), 1, 4), clk = ph / kk;
      if (nT !== this.nT) {
        this.nT = nT;
        this.tSeg[0][0].parentNode.style.gridTemplateColumns = `repeat(${nT}, 1fr)`;
        this.tSeg.forEach(([s], i) => { s.hidden = i >= nT; s.lastChild.textContent = M286 ? ['Ts', 'Tc', 'Tw', 'Tw'][i] : 'T' + (i + 1); });
      }
      for (let i = 0; i < 4; i++) {
        const [s, f] = this.tSeg[i];
        const fill = st ? clamp(clk - i, 0, 1) : 0;
        f.style.transform = `scaleX(${fill.toFixed(3)})`;
        s.classList.toggle('bv-cur', !!st && Math.floor(clk) === i);
      }
    }
    drawMini(st) {
      const c = this.mini, g = c.getContext('2d'), W = c.width, H = c.height;
      if (!W) return;
      const sc = Math.min((W - 16) / BW, (H - 16) / BD), ox = W / 2, oz = H / 2;
      const X = x => ox + x * sc, Z = z => oz + z * sc;
      if (!this.miniBase) {
        const bc = this.miniBase = canvas(W, H), bg = bc.getContext('2d');
        bg.fillStyle = PAL.miniBg; bg.strokeStyle = PAL.miniLine; bg.lineWidth = 1;
        bg.fillRect(X(-BW / 2), Z(-BD / 2), BW * sc, BD * sc); bg.strokeRect(X(-BW / 2) + 0.5, Z(-BD / 2) + 0.5, BW * sc, BD * sc);
        const rect = (x, z, w, d, col) => { bg.fillStyle = col; bg.fillRect(X(x - w / 2), Z(z - d / 2), w * sc, d * sc); };
        for (const ch of CHIPS) {
          if (ch.kind === 'plcc') { rect(ch.x, ch.z, 3.3, 3.3, THEME.gold); continue; }
          const L = ch.pins / 2 * PITCH + 0.14, Wd = ch.wide ? 1.38 : 0.62;
          const col = ch.id === 'cpu' ? THEME.gold : ch.id === 'fpu' ? THEME.lavender : PAL.miniChip;
          if (ch.rot) rect(ch.x, ch.z, Wd, L, col); else rect(ch.x, ch.z, L, Wd, col);
        }
        for (const bk of BANKS) for (let i = 0; i < 8; i++) rect(RAM_X(i), bk.z, 0.62, 2.17, PAL.miniRam);
        rect(CARD.x, CARD.z, 11, 0.3, '#5fd4ff55'); rect(DCARD.x, DCARD.z, 11, 0.3, '#5fd4ff33');
      }
      g.clearRect(0, 0, W, H);
      g.drawImage(this.miniBase, 0, 0);
      if (this.route) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        for (const lg of this.route.legs) {
          g.strokeStyle = lg.css; g.globalAlpha = 0.85; g.lineWidth = Math.max(1.5, W / 120);
          g.setLineDash(lg.hop ? [3, 3] : []);
          g.beginPath();
          lg.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
          g.stroke();
        }
        g.setLineDash([]); g.globalAlpha = 1;
      }
      if (st) {
        const x = X(st.p.x), z = Z(st.p.z), r = Math.max(3, W / 50);
        const gr = g.createRadialGradient(x, z, 0, x, z, r * 3);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, st.leg.css); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, z, r * 3, 0, TAU); g.fill();
      }
    }
  }

  // The layout, the dies and the trace models, for the 2D top view (src/ui/topview.js).
  const BoardKit = {
    layRoute, zoomPath, M286, M386, M486, M586, M686, FPU_ON, BLK_286, BLK_386, BLK_486, BLK_586, BLK_686, P5_CARDS, P6_CARDS, VGA, NM, BW, BD, SBCARD, SB_CHIPS, PITCH, CHIPS, BANKS, BANK_SPEC, RAM_X, CARD_CHIPS, VGA_CHIPS, DISK_CHIPS, XCARD_CHIPS,
    CARD, VCARD, DCARD, XCARD, ROUTES, CHAINS, DIE_PLANS, DIE_OF, dieLayout, drawInterior, INFO, IO_IN, IO_DEV, DEV_ALIAS,
    ioBlock, busInfo, DAC_PORT, RB, CB, ADDR_MASK, ADDR_BITS, hexA, CPU_TRACE, PIC_IRQ_TRACE, traceModel, TRACE_MODELS, FDC_CARD, PAGE_CARD, SOUND_CARD, CACHE_CARD,
    STATUS, CMD_BIT, CMD_NAME, DEV_NAME, DEV_SEL, PAL, chamfer, cumLen, project, cutAt, cutFrom,
    chipDims: spec => BoardView.prototype.chipDims.call(null, spec),
    vramChips: (m, addr, read) => BoardView.prototype.vramChips.call({ app: { machine: m } }, addr, read),
    xramChip: (m, addr, odd) => BoardView.prototype.xramChip.call({ app: { machine: m } }, addr, odd),
  };
  return { BoardView, RunnerView, BoardKit };
})();
