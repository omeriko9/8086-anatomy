// The facade the reused views read (section 7.4 of the design): the api object of the old page
// (app.js makeApi) built from the Stage, plus the two shims the board needs: a runner with dieKit
// (so trace steps dive into the dies) and window.__app (two guarded back-doors of board3d.js and
// die.js). Every member is one the views really read (map 2.2).
function makeFacade(stage) {
  const handlers = {};
  const emit = (name, arg) => { for (const cb of handlers[name] || []) cb(arg); };
  const api = {
    machine: stage.machine,                                       // the real Machine, read every frame
    get model() { return typeof CPU_MODEL !== 'undefined' ? CPU_MODEL : '8086'; },
    get video() { return typeof VIDEO_CARD !== 'undefined' ? VIDEO_CARD : 'cga'; },
    get reducedMotion() { return stage.reduced; },                // read once in the constructors
    get mode() { return 'explain'; },                             // never 'fast' on this page
    get running() { return false; },                              // never true: no chase camera
    get clock() { return 0; },                                    // no manual clocking
    get tracing() { return stage.play ? stage.play.tracing : true; },   // the board skips live signals while a story plays
    get motion() { return AnimClock.scale; },
    get stepMs() { return stage.play ? stage.play.stepMs : 1700; },     // the member the old api lacked
    get crtCanvas() { return stage.monitorLive && stage.crt ? stage.crt.fullCanvas : null; },
    get crtVersion() { return stage.crt ? stage.crt.version : 0; },
    select: (kind, id) => emit('select', { kind, id }),
    view: name => (name === 'runner' ? stage.runnerShim : name === 'board' ? stage.board : name === 'die' ? stage.die : null),
    on: (name, cb) => { (handlers[name] = handlers[name] || []).push(cb); },
  };
  return { api, emit };
}
// dieKit reads only this.board and the closure's helpers (board3d.js RunnerView.dieKit), so a shim
// with a fake `this` is enough for the die dives of a trace step.
function makeRunnerShim(stage) {
  if (typeof RunnerView === 'undefined') return null;
  return { dieKit: e => RunnerView.prototype.dieKit.call({ board: stage.board }, e) };
}
// The guarded back-doors: board3d.js reads window.__app.machine for the cache cards and calls
// window.__app.selectTab('die') from its pop button; die.js calls selectTab('board') and
// views.board.focusChip on a double-click.
function installAppShim(stage, shell) {
  window.__app = {
    machine: stage.machine,
    views: { get board() { return stage.board; } },
    selectTab: id => { if (shell && shell.go) shell.go(id === 'die' ? 'explore' : 'lesson'); },
  };
}
