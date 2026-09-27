// Assembly editor: a textarea over a syntax-highlight layer, with a gutter for line
// numbers, breakpoints, the current line and errors.

const ASM_MNEMONICS = new Set(('aaa aad aam aas adc add and call cbw clc cld cli cmc cmp cmpsb cmpsw cwd daa das dec div ' +
  'esc hlt idiv imul in inc int int3 into iret ja jae jb jbe jc jcxz je jg jge jl jle jmp jna jnae jnb jnbe jnc jne jng ' +
  'jnge jnl jnle jno jnp jns jnz jo jp jpe jpo js jz lahf lds lea les lock lodsb lodsw loop loope loopne loopnz loopz ' +
  'mov movsb movsw mul neg nop not or out pop popf push pushf rcl rcr rep repe repne repnz repz ret retf retn rol ror ' +
  'sahf sal salc sar sbb scasb scasw shl shr stc std sti stosb stosw sub test wait xchg xlat xlatb xor').split(' '));
const ASM_DIRECTIVES = new Set('org db dw dd dq dt times equ resb resw resd resq rest align cpu bits'.split(' '));
const ASM_REGS = new Set('ax bx cx dx si di bp sp al ah bl bh cl ch dl dh cs ds es ss st st0 st1 st2 st3 st4 st5 st6 st7'.split(' '));
const ASM_SIZES = new Set('byte word dword qword tword ptr short near far'.split(' '));

function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function highlightAsm(line) {
  let out = '', i = 0;
  const n = line.length;
  let first = true;
  while (i < n) {
    const c = line[i];
    if (c === ';') { out += `<span class="tk-c">${escHtml(line.slice(i))}</span>`; break; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) j++;
      out += `<span class="tk-s">${escHtml(line.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }
    if (/[A-Za-z_.$@?]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.$@?]/.test(line[j])) j++;
      const w = line.slice(i, j), lw = w.toLowerCase();
      let cls = '';
      if (line[j] === ':' && first) { cls = 'tk-l'; j++; }
      else if (ASM_DIRECTIVES.has(lw)) cls = 'tk-d';
      else if (ASM_MNEMONICS.has(lw)) cls = 'tk-m';
      else if (lw[0] === 'f' && lw.length > 2 && FPU_MNEMONICS.has(lw)) cls = 'tk-f';
      else if (ASM_REGS.has(lw)) cls = 'tk-r';
      else if (ASM_SIZES.has(lw)) cls = 'tk-o';
      else if (/^[0-9a-f]+h$/i.test(w) && /^[0-9]/.test(w)) cls = 'tk-n';
      else if (first && line.slice(0, i).trim() === '') cls = 'tk-l';
      out += cls ? `<span class="${cls}">${escHtml(line.slice(i, j))}</span>` : escHtml(line.slice(i, j));
      first = false;
      i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(line[j])) j++;
      out += `<span class="tk-n">${escHtml(line.slice(i, j))}</span>`;
      i = j; continue;
    }
    out += escHtml(c);
    i++;
  }
  return out;
}
const FPU_MNEMONICS = new Set(('f2xm1 fabs fadd faddp fbld fbstp fchs fclex fcom fcomp fcompp fdecstp fdisi fdiv fdivp ' +
  'fdivr fdivrp feni ffree fiadd ficom ficomp fidiv fidivr fild fimul fincstp finit fist fistp fisub fisubr fld fld1 ' +
  'fldcw fldenv fldl2e fldl2t fldlg2 fldln2 fldpi fldz fmul fmulp fnclex fndisi fneni fninit fnop fnsave fnstcw ' +
  'fnstenv fnstsw fpatan fprem fptan frndint frstor fsave fscale fsqrt fst fstcw fstenv fstp fstsw fsub fsubp fsubr ' +
  'fsubrp ftst fwait fxam fxch fxtract fyl2x fyl2xp1').split(' '));

class CodeEditor {
  constructor(input, hl, gutter) {
    this.input = input; this.hl = hl; this.gutter = gutter;
    this.breakpoints = new Set();
    this.errors = new Map();
    this.current = 0;
    this.onChange = null;
    this.onBreakpoint = null;
    this.lines = [];
    this.escaped = false;
    input.addEventListener('input', () => { this.render(); if (this.onChange) this.onChange(); });
    input.addEventListener('scroll', () => this.syncScroll());
    input.addEventListener('keydown', e => this.keydown(e));
    gutter.addEventListener('click', e => {
      const ln = e.target.closest('.ln');
      if (ln) this.toggleBreakpoint(+ln.dataset.line);
    });
  }
  get value() { return this.input.value; }
  set value(v) {
    this.input.value = v;
    this.breakpoints.clear();
    this.errors.clear();
    this.current = 0;
    this.input.scrollTop = 0;
    this.render();
  }
  keydown(e) {
    if (e.key === 'Escape') { this.escaped = true; return; }
    if (e.key === 'Tab' && !e.shiftKey && !this.escaped && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const s = this.input.selectionStart, v = this.input.value;
      const col = s - v.lastIndexOf('\n', s - 1) - 1;
      const pad = ' '.repeat(8 - (col % 8));
      this.input.setRangeText(pad, s, this.input.selectionEnd, 'end');
      this.render();
      if (this.onChange) this.onChange();
    }
    this.escaped = false;
  }
  cursorLine() {
    const v = this.input.value, s = this.input.selectionStart;
    let n = 1;
    for (let i = 0; i < s; i++) if (v.charCodeAt(i) === 10) n++;
    return n;
  }
  toggleBreakpoint(line) {
    if (this.breakpoints.has(line)) this.breakpoints.delete(line); else this.breakpoints.add(line);
    this.renderGutter();
    if (this.onBreakpoint) this.onBreakpoint();
  }
  setErrors(list) {
    this.errors = new Map(list.map(e => [e.line, e.msg]));
    this.render();
  }
  setCurrent(line, reveal) {
    if (line === this.current) return;
    this.current = line;
    this.renderMarks();
    if (reveal && line) this.revealLine(line);
  }
  revealLine(line) {
    const top = (line - 1) * 20, h = this.input.clientHeight;
    const st = this.input.scrollTop;
    if (top < st + 20 || top > st + h - 60) {
      this.input.scrollTop = Math.max(0, top - h / 3);
      this.syncScroll();
    }
  }
  focusLine(line) {
    const lines = this.input.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    this.input.focus();
    this.input.setSelectionRange(pos, pos);
    this.revealLine(line);
  }
  render() {
    const lines = this.input.value.split('\n');
    this.lines = lines;
    let html = '';
    for (let i = 0; i < lines.length; i++) html += `<span class="line" data-l="${i + 1}">${highlightAsm(lines[i]) || ' '}</span>`;
    html += '<span class="line"> </span><span class="line"> </span>';
    this.hl.innerHTML = html;
    this.lineEls = this.hl.children;
    this.renderGutter();
    this.syncScroll();
  }
  renderGutter() {
    const n = this.lines.length;
    let html = '';
    for (let i = 1; i <= n; i++) {
      const cls = 'ln' + (this.breakpoints.has(i) ? ' bp' : '') + (this.errors.has(i) ? ' err' : '') + (i === this.current ? ' cur' : '');
      html += `<div class="${cls}" data-line="${i}" title="${this.errors.has(i) ? escHtml(this.errors.get(i)) : 'Toggle breakpoint'}">${i}</div>`;
    }
    this.gutter.innerHTML = html;
    this.renderMarks();
    this.syncScroll();
  }
  renderMarks() {
    const els = this.lineEls || [];
    for (let i = 0; i < els.length; i++) {
      const l = i + 1;
      els[i].classList.toggle('cur', l === this.current);
      els[i].classList.toggle('err', this.errors.has(l));
    }
    const g = this.gutter.children;
    for (let i = 0; i < g.length; i++) g[i].classList.toggle('cur', i + 1 === this.current);
  }
  syncScroll() {
    this.hl.scrollTop = this.input.scrollTop;
    this.hl.scrollLeft = this.input.scrollLeft;
    this.gutter.scrollTop = this.input.scrollTop;
  }
}
