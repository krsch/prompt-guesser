import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { RealScheduler } from "../src/adapters/RealScheduler.js";
import {
  PhaseTimeout,
  type CommandContext,
  type MessageBus,
  type GameGateway,
  type RoundGateway,
  type Scheduler,
  createGameConfig,
} from "../src/core.js";
import { FakeGameGateway, FakeRoundGateway } from "./support/testContext.js";

describe("RealScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("dispatches a PhaseTimeout with the expected parameters", async () => {
    const gameGateway: GameGateway = new FakeGameGateway();
    const roundGateway: RoundGateway = new FakeRoundGateway();
    const game = await gameGateway.createGame(
      "alice",
      createGameConfig({
        promptDurationMs: 1,
        guessingDurationMs: 1,
        votingDurationMs: 1,
      }),
    );
    const round = await roundGateway.startNewRound(
      game.id,
      ["alice", "bob"],
      "alice",
      Date.now(),
    );

    const context: CommandContext = {
      gameGateway,
      roundGateway,
      bus: { publish: vi.fn() } as MessageBus,
      imageGenerator: { generate: vi.fn() },
      scheduler: {} as Scheduler,
    };

    const dispatch = vi.fn().mockResolvedValue(undefined);
    const contextFactory = vi.fn().mockResolvedValue(context);

    const scheduler = new RealScheduler({
      contextFactory,
      dispatch,
    });

    await scheduler.scheduleTimeout("round-1", "prompt", 5000);
    await roundGateway.saveRoundState({ ...round, id: "round-1" });

    expect(contextFactory).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const [command, providedContext] = dispatch.mock.calls[0] ?? [];
    expect(providedContext).toBe(context);
    expect(command).toBeInstanceOf(PhaseTimeout);
    expect((command as PhaseTimeout).roundId).toBe("round-1");
    expect((command as PhaseTimeout).phase).toBe("prompt");
  });
});
