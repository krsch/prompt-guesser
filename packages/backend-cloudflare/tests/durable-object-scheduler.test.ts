import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { DurableObjectScheduler } from "../src/adapters/DurableObjectScheduler.js";
import { PhaseTimeout } from "../src/core.js";
import {
  createFakeDurableObjectState,
  FakeDurableObjectStorage,
} from "./support/fakes.js";

const GAME_ID = "game-123";
const ROUND_ID = "round-abc";

describe("DurableObjectScheduler", () => {
  let storage: FakeDurableObjectStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new FakeDurableObjectStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists alarm state and schedules a wakeup", async () => {
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);
    const state = createFakeDurableObjectState(storage);
    const runTimeout = vi.fn();
    const scheduler = new DurableObjectScheduler({ state, runTimeout });

    await scheduler.scheduleTimeout(ROUND_ID, "prompt", 1_000, GAME_ID);

    const alarm = await storage.get<{
      readonly roundId: string;
      readonly phase: string;
      readonly runAt: number;
      readonly gameId: string;
    }>("alarm");
    expect(alarm).toMatchObject({ roundId: ROUND_ID, phase: "prompt", gameId: GAME_ID });
    expect(typeof alarm?.runAt).toBe("number");
    expect(storage.alarms).toEqual([now.getTime() + 1_000]);
    expect(runTimeout).not.toHaveBeenCalled();
  });

  it("re-queues alarms that fire too early", async () => {
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);
    const state = createFakeDurableObjectState(storage);
    await storage.put("alarm", {
      roundId: ROUND_ID,
      phase: "prompt",
      runAt: now.getTime() + 5_000,
      gameId: GAME_ID,
    });

    const runTimeout = vi.fn();
    const scheduler = new DurableObjectScheduler({ state, runTimeout });

    await scheduler.triggerAlarm();

    expect(runTimeout).not.toHaveBeenCalled();
    expect(storage.alarms).toEqual([now.getTime() + 5_000]);
  });

  it("dispatches expired alarms", async () => {
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);
    const state = createFakeDurableObjectState(storage);
    await storage.put("alarm", {
      roundId: ROUND_ID,
      phase: "prompt",
      runAt: now.getTime() - 1,
      gameId: GAME_ID,
    });

    const runTimeout = vi.fn();
    const scheduler = new DurableObjectScheduler({ state, runTimeout });

    await scheduler.triggerAlarm();

    expect(runTimeout).toHaveBeenCalledTimes(1);
    const [command, gameId] = runTimeout.mock.calls[0] ?? [];
    expect(gameId).toBe(GAME_ID);
    expect(command).toBeInstanceOf(PhaseTimeout);
    expect((command as PhaseTimeout).phase).toBe("prompt");
    const alarm = await storage.get("alarm");
    expect(alarm).toBeUndefined();
  });
});
