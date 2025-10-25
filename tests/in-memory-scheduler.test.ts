import { describe, it, expect } from "vitest";

import { InMemoryScheduler } from "../src/adapters/in-memory/InMemoryScheduler";
import type { PhaseTimeout } from "../src/domain/commands/PhaseTimeout";

describe("InMemoryScheduler", () => {
  it("dispatches commands once their delay elapses", async () => {
    const dispatched: PhaseTimeout[] = [];
    const scheduler = new InMemoryScheduler((command) => {
      dispatched.push(command);
    });

    await scheduler.scheduleTimeout("round-1", "prompt", 2_000);

    await scheduler.runFor(1_000);
    expect(dispatched).toEqual([]);

    await scheduler.runFor(1_000);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("PhaseTimeout");
    expect(dispatched[0]?.phase).toBe("prompt");
    expect(dispatched[0]?.at).toBe(2_000);
  });

  it("delivers timeouts in the order they are scheduled to fire", async () => {
    const dispatched: PhaseTimeout[] = [];
    const scheduler = new InMemoryScheduler((command) => {
      dispatched.push(command);
    });

    await scheduler.scheduleTimeout("round-1", "guessing", 500);
    await scheduler.scheduleTimeout("round-1", "guessing", 1_500);

    await scheduler.runFor(1_500);
    expect(dispatched).toHaveLength(2);
    expect(dispatched.map((command) => command.at)).toEqual([500, 1_500]);
  });

  it("processes follow-up timeouts scheduled during dispatch", async () => {
    const dispatched: string[] = [];
    const scheduler = new InMemoryScheduler(async (command) => {
      dispatched.push(`${command.phase}-${command.at}`);
      await scheduler.scheduleTimeout("round-1", command.phase, 500);
    });

    await scheduler.scheduleTimeout("round-1", "voting", 1_000);

    await scheduler.runFor(2_000);
    expect(dispatched).toEqual(["voting-1000", "voting-1500", "voting-2000"]);
  });
});
