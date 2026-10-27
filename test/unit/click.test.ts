import { describe, expect, test } from "bun:test";
import { ClickTracker } from "../../src/click";

const WINDOW_MS = 50;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ClickTracker", () => {
  test("a single click runs onSingle after the window", async () => {
    const tracker = new ClickTracker(WINDOW_MS);
    const calls: string[] = [];
    tracker.click(
      () => calls.push("single"),
      () => calls.push("double"),
    );
    expect(calls).toEqual([]);
    await wait(WINDOW_MS * 2);
    expect(calls).toEqual(["single"]);
  });

  test("a second click inside the window runs onDouble at once and never onSingle", async () => {
    const tracker = new ClickTracker(WINDOW_MS);
    const calls: string[] = [];
    const click = (): void =>
      tracker.click(
        () => calls.push("single"),
        () => calls.push("double"),
      );
    click();
    click();
    expect(calls).toEqual(["double"]);
    await wait(WINDOW_MS * 2);
    expect(calls).toEqual(["double"]);
  });

  test("clicks after the window start over", async () => {
    const tracker = new ClickTracker(WINDOW_MS);
    const calls: string[] = [];
    const click = (): void =>
      tracker.click(
        () => calls.push("single"),
        () => calls.push("double"),
      );
    click();
    await wait(WINDOW_MS * 2);
    click();
    await wait(WINDOW_MS * 2);
    expect(calls).toEqual(["single", "single"]);
  });
});
