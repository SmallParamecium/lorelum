/** Wait for settlement (including rejection), without granting a fresh timeout budget. */
export async function waitForSettlement(
  task: Promise<unknown>,
  deadline: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits for successful completion until a fixed deadline without retaining a stale timer.
 * Rejections remain visible to callers that need the operation's original failure.
 */
export async function waitForCompletionOrDeadline<T>(
  task: Promise<T>,
  deadline: number,
): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      timer = setTimeout(() => resolve(false), remaining);
      void task.then(
        () => resolve(true),
        (error: unknown) => reject(error),
      );
    });
  } finally {
    clearTimeout(timer);
  }
}
