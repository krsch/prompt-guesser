import { Command, type CommandContext } from "./Command.js";
import { finalizeRound } from "./FinalizeRound.js";
import { transitionToVoting } from "./PhaseTransitions.js";
import type { RoundId, RoundPhase, TimePoint } from "../typedefs.js";

export class PhaseTimeout extends Command {
  readonly type = "PhaseTimeout" as const;

  constructor(
    public readonly roundId: RoundId,
    public readonly phase: Exclude<RoundPhase, "scoring" | "finished">,
    public readonly at: TimePoint,
  ) {
    super();
  }

  async execute({ gateway, bus, config, logger, scheduler }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);

    if (state.phase !== this.phase) {
      return;
    }

    if (this.phase === "prompt") {
      state.phase = "finished";
      state.finishedAt = this.at;
      state.scores = Object.fromEntries(state.players.map((playerId) => [playerId, 0] as const));

      await gateway.saveRoundState(state);

      logger?.info?.("Prompt phase timed out; ending round", {
        type: this.type,
        roundId: state.id,
        at: this.at,
      });

      await bus.publish(`round:${state.id}`, {
        type: "RoundFinished",
        roundId: state.id,
        at: this.at,
        scores: state.scores,
      });
      return;
    }

    if (this.phase === "guessing") {
      const prompts = state.prompts ?? {};

      await transitionToVoting(state, prompts, this.at, {
        gateway,
        bus,
        logger,
        config,
        scheduler,
      });
      return;
    }

    if (this.phase === "voting") {
      await finalizeRound(state, this.at, gateway, bus, logger, this.type);
    }
  }
}
