import { describe, it, expect } from "vitest";

import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway";
import { GameConfig } from "../src/domain/GameConfig";
import { StartNewRound } from "../src/domain/commands/StartNewRound";
import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt";
import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy";
import { SubmitVote } from "../src/domain/commands/SubmitVote";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import type { ImageGenerator } from "../src/domain/ports/ImageGenerator";

const players = ["alex", "bailey", "casey", "devon"];
const activePlayer = players[0];

const imageGenerator: ImageGenerator = {
  async generate() {
    return "https://example.com/generated.png";
  },
};

describe("Integration: play a full round", () => {
  it("walks through prompt, guessing and voting phases", async () => {
    const gateway = new InMemoryRoundGateway();
    gateway.shufflePrompts = async (_roundId, prompts) => prompts;
    const events: { channel: string; event: any }[] = [];
    const bus: MessageBus = {
      async publish(channel, event) {
        events.push({ channel, event });
      },
    };

    const config = GameConfig.withDefaults();

    const startedAt = Date.UTC(2024, 4, 20, 12, 0, 0);

    await new StartNewRound(players, activePlayer, startedAt).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });

    const roundStarted = events.find((entry) => entry.event.type === "RoundStarted");
    expect(roundStarted).toBeDefined();
    const roundId = roundStarted!.event.roundId as string;

    const promptTime = startedAt + 10_000;
    await new SubmitPrompt(roundId, activePlayer, "A cat playing piano", promptTime).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });

    const guessingEvents = events.filter((entry) => entry.event.type === "PhaseChanged");
    expect(guessingEvents.some((entry) => entry.event.phase === "guessing")).toBe(true);

    await new SubmitDecoy(roundId, players[1], "A dog painting", promptTime + 1_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });
    await new SubmitDecoy(roundId, players[2], "A rabbit skiing", promptTime + 2_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });
    await new SubmitDecoy(roundId, players[3], "A turtle surfing", promptTime + 3_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });

    const roundStateAfterPrompts = await gateway.loadRoundState(roundId);
    expect(roundStateAfterPrompts.phase).toBe("voting");
    expect(new Set(roundStateAfterPrompts.shuffledPrompts)).toEqual(
      new Set([
        "A cat playing piano",
        "A dog painting",
        "A rabbit skiing",
        "A turtle surfing",
      ]),
    );
    expect(roundStateAfterPrompts.shuffledPromptOwners).toEqual(players);

    await new SubmitVote(roundId, players[1], 0, promptTime + 5_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });
    await new SubmitVote(roundId, players[2], 2, promptTime + 6_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });
    await new SubmitVote(roundId, players[3], 1, promptTime + 7_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
    });

    const finalState = await gateway.loadRoundState(roundId);
    expect(finalState.phase).toBe("finished");
    expect(finalState.scores).toEqual({
      [players[0]]: 3,
      [players[1]]: 4,
      [players[2]]: 1,
      [players[3]]: 0,
    });
    expect(finalState.finishedAt).toBeDefined();

    const phases = events
      .filter((entry) => entry.event.type === "PhaseChanged")
      .map((entry) => entry.event.phase);

    expect(phases).toEqual([
      "guessing",
      "voting",
      "scoring",
    ]);

    expect(
      events.some(
        (entry) => entry.event.type === "RoundFinished" && entry.event.roundId === roundId,
      ),
    ).toBe(true);
  });
});
