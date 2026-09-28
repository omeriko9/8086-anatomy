// The Explore ring (WP8 of the design): every story step of every instruction of the program,
// Next and Back, the registers that changed. A stub until WP8: the shell shows a note instead.
class ExploreScreen {
  constructor(shell) { this.shell = shell; this.on = false; }
  open() { this.on = true; if (this.shell && this.shell.note) this.shell.note("Explore is not in this build yet. The Workbench has every step."); }
  close() { this.on = false; }
}
