import { describe, it, expect, vi } from "vitest";

import { StartNewRound } from "../src/domain/commands/StartNewRound";
import { StartNewRoundInputError } from "../src/domain/errors/StartNewRoundInputError";
import type { RoundGateway } from "../src/domain/ports/RoundGateway";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import { GameConfig } from "../src/domain/GameConfig";

const makeGateway = () =>
  ({
    startNewRound: vi.fn(),
    saveRoundState: vi.fn(),
  }) satisfies Partial<RoundGateway>;

const makeBus = () =>
  ({
    publish: vi.fn(),
  }) satisfies Partial<MessageBus>;

const makeConfig = () => GameConfig.withDefaults();

describe("StartNewRound command", () => {
  it("starts a new round and publishes the round started event", async () => {
    const gateway = makeGateway();
    const bus = makeBus();
    const config = makeConfig();
    const now = Date.now();
    const players = ["p1", "p2", "p3", "p4"];
    const activePlayer = players[0];

    const roundState = {
      id: "round-1",
      players,
      activePlayer,
      phase: "prompt",
      startedAt: now,
    };
    gateway.startNewRound.mockResolvedValue(roundState);

    const command = new StartNewRound(players, activePlayer, now);
    await command.execute({
      gateway: gateway as RoundGateway,
      bus: bus as MessageBus,
      config,
    });

    expect(gateway.startNewRound).toHaveBeenCalledWith(players, activePlayer);
    expect(gateway.saveRoundState).toHaveBeenCalledTimes(1);
    expect(gateway.saveRoundState).toHaveBeenCalledWith(
      expect.objectContaining({
        promptDeadline: now + config.promptDurationMs,
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith("round:round-1", {
      type: "RoundStarted",
      roundId: "round-1",
      players,
      activePlayer,
      at: now,
      promptDeadline: now + config.promptDurationMs,
    });
  });

  it("throws when player count is below the minimum", async () => {
    const command = new StartNewRound(["p1", "p2", "p3"], "p1", Date.now());
    const gateway = makeGateway();
    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        config: makeConfig(),
      }),
    ).rejects.toThrow(StartNewRoundInputError);
    expect(gateway.startNewRound).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
  });

  it("throws when player count is above the maximum", async () => {
    const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const command = new StartNewRound(players, "p1", Date.now());
    const gateway = makeGateway();
    await expect(
      command.execute({
        gateway: gateway as RoundGateway,
        bus: makeBus() as MessageBus,
        config: makeConfig(),
      }),
    ).rejects.toThrow(StartNewRoundInputError);
    expect(gateway.startNewRound).not.toHaveBeenCalled();
    expect(gateway.saveRoundState).not.toHaveBeenCalled();
  });

  it("throws when the active player is not part of the round", async () => {
    const players = ["p1", "p2", "p3", "p4"];
    expect(() => new StartNewRound(players, "p5", Date.now())).toThrow(StartNewRoundInputError);
  });

  it("throws when players contain duplicates", () => {
    const players = ["p1", "p1", "p2", "p3"];
    expect(() => new StartNewRound(players, "p1", Date.now())).toThrow(StartNewRoundInputError);
  });

  it("throws when player identifiers contain whitespace", () => {
    expect(() => new StartNewRound(["p 1", "p2", "p3", "p4"], "p2", Date.now())).toThrow(
      StartNewRoundInputError,
    );
    expect(() => new StartNewRound(["p1", "p2", "p3", "p4"], "p 2", Date.now())).toThrow(
      StartNewRoundInputError,
    );
  });
});
