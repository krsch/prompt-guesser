import { Command, type CommandContext } from "./Command.js";
import { finalizeRound } from "./FinalizeRound.js";
import type { PlayerId, RoundId, TimePoint } from "../typedefs.js";

export class SubmitVote extends Command {
  readonly type = "SubmitVote" as const;

  constructor(
    public readonly roundId: RoundId,
    public readonly playerId: PlayerId,
    public readonly promptIndex: number,
    public readonly at: TimePoint,
  ) {
    super();
  }

  async execute({ gateway, bus, logger }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);

    if (state.phase !== "voting") {
      throw new Error("Cannot submit vote when round is not in voting phase");
    }

    if (!state.players.includes(this.playerId)) {
      throw new Error("Player is not part of this round");
    }

    if (this.playerId === state.activePlayer) {
      throw new Error("Active player cannot vote in their own round");
    }

    if (this.promptIndex < 0 || this.promptIndex >= state.shuffleOrder!.length) {
      throw new Error("Invalid vote index");
    }

    const { inserted, votes } = await gateway.appendVote(
      this.roundId,
      this.playerId,
      this.promptIndex,
    );

    if (!inserted) {
      logger?.info?.("Vote submission ignored; already stored", {
        type: this.type,
        roundId: state.id,
        playerId: this.playerId,
        at: this.at,
      });
      return;
    }

    const eligibleVoterCount = state.players.length - 1;
    if (Object.keys(votes).length !== eligibleVoterCount) {
      return;
    }

    state.votes = votes;

    await finalizeRound(state, this.at, gateway, bus, logger, this.type);
  }
}
