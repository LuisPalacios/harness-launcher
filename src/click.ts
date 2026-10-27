// Tells a single click from a double click on a button that only reports clicks,
// such as an editor title action or a status bar item.

/** Short enough to keep a single click responsive, long enough for a relaxed double click. */
export const DOUBLE_CLICK_MS = 400;

export class ClickTracker {
  private pending: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly windowMs: number = DOUBLE_CLICK_MS) {}

  /** Runs `onSingle` once the window passes without a second click, or `onDouble` on the second click. */
  click(onSingle: () => void, onDouble: () => void): void {
    if (this.pending !== undefined) {
      clearTimeout(this.pending);
      this.pending = undefined;
      onDouble();
      return;
    }
    this.pending = setTimeout(() => {
      this.pending = undefined;
      onSingle();
    }, this.windowMs);
  }
}
