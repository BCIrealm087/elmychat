/** Await paint in current frames, tolerating only expected navigation retirement. */
export async function waitForPaint(page, count = 2) {
  const deadline = Date.now() + 10000;
  while (true) {
    const results = await Promise.allSettled(page.frames().map((frame) => frame.evaluate((count) => new Promise((done) => {
      function next() { if (--count <= 0) done(); else requestAnimationFrame(next); }
      requestAnimationFrame(next);
    }), count)));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (!failures.length) return;
    const unexpected = failures.find((error) => !/Execution context was destroyed|Frame was detached|frame has been detached/i.test(error.message));
    if (unexpected || Date.now() >= deadline) throw unexpected ?? failures[0];
  }
}
