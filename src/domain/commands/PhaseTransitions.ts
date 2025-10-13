import type { CommandContext } from "./Command.js";
import type { RoundState } from "../ports/RoundGateway.js";
import type { PlayerId, RoundPhase, TimePoint } from "../typedefs.js";

type PhaseTransitionContext = Pick<CommandContext, "gateway" | "bus" | "logger" | "config">;

function assertPromptValue(playerId: PlayerId, prompt: unknown): asserts prompt is string {
  if (typeof prompt !== "string") {
    throw new Error(`Prompt for player ${playerId} is not a string`);
  }
}

function assertPhaseScheduled(phase: RoundPhase, deadline: TimePoint | undefined): asserts deadline is TimePoint {
  if (typeof deadline !== "number" || Number.isNaN(deadline)) {
    throw new Error(`Cannot schedule ${phase} phase without a valid deadline`);
  }
}

export async function transitionToGuessing(
  state: RoundState,
  at: TimePoint,
  imageUrl: string,
  { gateway, bus, logger, config }: PhaseTransitionContext,
): Promise<void> {
  state.phase = "guessing";
  state.guessingDeadline = at + config.guessingDurationMs;
  state.imageUrl = imageUrl;

  await gateway.saveRoundState(state);

  assertPhaseScheduled("guessing", state.guessingDeadline);
  await gateway.scheduleTimeout(state.id, "guessing", state.guessingDeadline);

  logger?.info?.("Round entering guessing phase", {
    roundId: state.id,
    at,
    phase: state.phase,
  });

  await bus.publish(`round:${state.id}`, {
    type: "PhaseChanged",
    phase: state.phase,
    at,
  });
}

export async function transitionToVoting(
  state: RoundState,
  prompts: Record<PlayerId, string>,
  at: TimePoint,
  { gateway, bus, logger, config }: PhaseTransitionContext,
): Promise<void> {
  const promptEntries = Object.entries(prompts) as [PlayerId, unknown][];

  if (promptEntries.length === 0) {
    throw new Error("Cannot transition to voting without any prompts");
  }

  if (!(state.activePlayer in prompts)) {
    throw new Error("Active player's prompt missing when transitioning to voting");
  }

  const typedEntries = promptEntries.map(([playerId, value]) => {
    assertPromptValue(playerId, value);
    if (!state.players.includes(playerId)) {
      throw new Error(`Prompt submitted by unknown player ${playerId}`);
    }
    return [playerId, value] as [PlayerId, string];
  });

  const shuffled = await gateway.shufflePrompts(state.id, typedEntries);

  if (shuffled.length !== typedEntries.length) {
    throw new Error("Shuffled prompt count does not match inputs");
  }

  const shuffledPrompts = shuffled.map(([playerId, prompt]) => {
    assertPromptValue(playerId, prompt);
    return prompt;
  });
  const shuffledPromptOwners = shuffled.map(([playerId]) => playerId);

  state.prompts = { ...prompts };
  state.shuffledPrompts = shuffledPrompts;
  state.shuffledPromptOwners = shuffledPromptOwners;
  state.phase = "voting";
  state.votingDeadline = at + config.votingDurationMs;
  state.votes = {};

  await gateway.saveRoundState(state);

  assertPhaseScheduled("voting", state.votingDeadline);
  await gateway.scheduleTimeout(state.id, "voting", state.votingDeadline);

  await bus.publish(`round:${state.id}`, {
    type: "PromptsReady",
    roundId: state.id,
    prompts: [...shuffledPrompts],
    votingDeadline: state.votingDeadline,
    at,
  });

  logger?.info?.("Round entering voting phase", {
    roundId: state.id,
    at,
    phase: state.phase,
  });

  await bus.publish(`round:${state.id}`, {
    type: "PhaseChanged",
    phase: state.phase,
    at,
  });
}
