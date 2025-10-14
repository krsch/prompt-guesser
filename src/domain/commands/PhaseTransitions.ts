import type { CommandContext } from "./Command.js";
import type { RoundState } from "../ports/RoundGateway.js";
import type { PlayerId, TimePoint } from "../typedefs.js";

type PhaseTransitionContext = Pick<
  CommandContext,
  "gateway" | "bus" | "logger" | "config" | "scheduler"
>;

export async function transitionToGuessing(
  state: RoundState,
  at: TimePoint,
  imageUrl: string,
  { gateway, bus, logger, scheduler, config }: PhaseTransitionContext,
): Promise<void> {
  state.phase = "guessing";
  state.imageUrl = imageUrl;

  await gateway.saveRoundState(state);

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
  state: RoundState,
  prompts: Record<PlayerId, string>,
  at: TimePoint,
  { gateway, bus, logger, config, scheduler }: PhaseTransitionContext,
): Promise<void> {
  const promptEntries = Object.entries(prompts) as [PlayerId, string][];

  const shuffled = await gateway.shufflePrompts(state.id, promptEntries);

  const shuffledPrompts = shuffled.map(([, prompt]) => prompt);
  const shuffledPromptOwners = shuffled.map(([playerId]) => playerId);

  state.prompts = { ...prompts };
  state.shuffledPrompts = shuffledPrompts;
  state.shuffledPromptOwners = shuffledPromptOwners;
  state.phase = "voting";
  state.votes = {};

  await gateway.saveRoundState(state);

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
