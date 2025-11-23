import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { RealScheduler } from "../src/adapters/RealScheduler.js";
import { PhaseTimeout } from "../src/core.js";

describe("RealScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("dispatches a PhaseTimeout with the expected parameters", async () => {
    const runTimeout = vi.fn().mockResolvedValue(undefined);

    const scheduler = new RealScheduler({
      runTimeout,
    });

    await scheduler.scheduleTimeout("round-1", "prompt", 5000);

    await vi.runOnlyPendingTimersAsync();

    expect(runTimeout).toHaveBeenCalledTimes(1);

    const [command] = runTimeout.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(PhaseTimeout);
    expect((command as PhaseTimeout).roundId).toBe("round-1");
    expect((command as PhaseTimeout).phase).toBe("prompt");
  });
});
