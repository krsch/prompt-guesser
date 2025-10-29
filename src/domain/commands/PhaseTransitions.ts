import { generateShuffle, getShuffledPrompts } from "../entities/RoundRules.js";
import type { GameConfig } from "../GameConfig.js";
import type { RoundState, ValidRoundState } from "../ports/RoundGateway.js";
import type { PlayerId, TimePoint } from "../typedefs.js";
import type { CommandContext } from "./Command.js";

type PhaseTransitionContext = Pick<
  CommandContext,
  "roundGateway" | "bus" | "logger" | "scheduler"
>;

export async function transitionToGuessing(
  state: RoundState,
  at: TimePoint,
  imageUrl: string,
  { roundGateway, bus, logger, scheduler }: PhaseTransitionContext,
  config: GameConfig,
): Promise<void> {
  state.phase = "guessing";
  state.imageUrl = imageUrl;

  await roundGateway.saveRoundState(state);

  await scheduler.scheduleTimeout(state.id, "guessing", config.guessingDurationMs);

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
  state: ValidRoundState,
  prompts: Record<PlayerId, string>,
  at: TimePoint,
  { roundGateway, bus, logger, scheduler }: PhaseTransitionContext,
  config: GameConfig,
): Promise<void> {
  state.prompts = { ...prompts };
  state.shuffleOrder = generateShuffle(state);
  state.phase = "voting";
  state.votes = {};

  await roundGateway.saveRoundState(state);

  const shuffledPrompts = getShuffledPrompts(state);

  await scheduler.scheduleTimeout(state.id, "voting", config.votingDurationMs);

  await bus.publish(`round:${state.id}`, {
    type: "PromptsReady",
    roundId: state.id,
    prompts: [...shuffledPrompts],
    votingDurationMs: config.votingDurationMs,
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
