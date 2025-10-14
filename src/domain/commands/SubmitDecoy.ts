import { Command, type CommandContext } from "./Command.js";
import { transitionToVoting } from "./PhaseTransitions.js";
import type { PlayerId, RoundId, TimePoint } from "../typedefs.js";

export class SubmitDecoy extends Command {
  readonly type = "SubmitDecoy" as const;

  constructor(
    public readonly roundId: RoundId,
    public readonly playerId: PlayerId,
    public readonly prompt: string,
    public readonly at: TimePoint,
  ) {
    super();
  }

  async execute({ gateway, bus, config, logger, scheduler }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);

    if (state.phase !== "guessing") {
      throw new Error("Cannot submit decoy when round is not in guessing phase");
    }

    if (!state.players.includes(this.playerId)) {
      throw new Error("Player is not part of this round");
    }

    if (state.activePlayer === this.playerId) {
      throw new Error("Active player cannot submit a decoy prompt");
    }

    const { inserted, prompts } = await gateway.appendPrompt(
      this.roundId,
      this.playerId,
      this.prompt,
    );

    if (!inserted) {
      logger?.info?.("Decoy submission ignored; already stored", {
        type: this.type,
        roundId: state.id,
        playerId: this.playerId,
        at: this.at,
      });
      return;
    }

    logger?.info?.("Decoy submitted", {
      type: this.type,
      roundId: state.id,
      playerId: this.playerId,
      at: this.at,
    });

    const totalPlayers = state.players.length;
    if (Object.keys(prompts).length < totalPlayers) {
      return;
    }

    await transitionToVoting(state, prompts, this.at, {
      gateway,
      bus,
      logger,
      config,
      scheduler,
    });
  }
}
