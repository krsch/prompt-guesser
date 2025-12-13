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

    await scheduler.scheduleTimeout("round-1", "prompt", 5000, "game-1");

    await vi.runOnlyPendingTimersAsync();

    expect(runTimeout).toHaveBeenCalledTimes(1);

    const [command, gameId] = runTimeout.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(PhaseTimeout);
    expect((command as PhaseTimeout).roundId).toBe("round-1");
    expect((command as PhaseTimeout).phase).toBe("prompt");
    expect(gameId).toBe("game-1");
  });

  it("reschedules when called twice for the same phase", async () => {
    const runTimeout = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RealScheduler({ runTimeout });

    await scheduler.scheduleTimeout("round-1", "prompt", 1000, "game-1");
    await scheduler.scheduleTimeout("round-1", "prompt", 2000, "game-1");

    expect(runTimeout).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(runTimeout).toHaveBeenCalledTimes(1);
  });

  it("logs errors from runTimeout", async () => {
    const error = new Error("boom");
    const runTimeout = vi.fn().mockRejectedValue(error);
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const scheduler = new RealScheduler({ runTimeout, logger });

    await scheduler.scheduleTimeout("round-1", "prompt", 100, "game-1");
    await vi.runOnlyPendingTimersAsync();

    expect(logger.error).toHaveBeenCalled();
  });
});
