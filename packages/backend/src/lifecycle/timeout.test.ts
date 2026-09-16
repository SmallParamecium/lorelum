import { expect, test } from "bun:test";

import { waitForCompletionOrDeadline } from "./deadline";
import { createTimeoutSignal } from "./timeout";

test("a disposed timeout signal never aborts after its former deadline", async () => {
  const timeout = createTimeoutSignal(10);
  timeout.dispose();

  await Bun.sleep(20);

  expect(timeout.signal.aborted).toBe(false);
  expect(timeout.timedOut()).toBe(false);
});

test("a timeout signal remains observable while it is active", async () => {
  const timeout = createTimeoutSignal(10);
  try {
    await Bun.sleep(20);

    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.timedOut()).toBe(true);
    expect(timeout.signal.reason).toMatchObject({ name: "TimeoutError" });
  } finally {
    timeout.dispose();
  }
});

test("a completed wait removes its deadline timer", async () => {
  let finish!: () => void;
  const task = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = performance.now();
  const waiting = waitForCompletionOrDeadline(task, Date.now() + 1_000);

  finish();

  await expect(waiting).resolves.toBe(true);
  expect(performance.now() - started).toBeLessThan(100);
});
