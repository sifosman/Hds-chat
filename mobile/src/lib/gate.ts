// Tiny request gate for auth screens: every async request takes a generation ticket
// and only a still-current ticket may apply its result (auth.set, navigation, UI).
// next() issues a ticket; bump() invalidates in-flight work but keeps the gate usable
// (e.g. a new invite token); invalidate() closes it permanently (unmount).
export class RequestGate {
  private gen = 0;
  private live = true;
  next() { return ++this.gen; }
  bump() { return ++this.gen; }
  invalidate() { this.live = false; ++this.gen; }
  current(g: number) { return this.live && this.gen === g; }
}
