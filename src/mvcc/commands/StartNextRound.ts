import { CommandError } from "../errors.js";
import type {
  CommandResult,
  GameCommand,
  GameState,
  PlayerId,
  RoundId,
  RoundState,
  TimePoint,
} from "../types.js";

export class StartNextRound implements GameCommand {
  readonly type = "StartNextRound";

  constructor(
    private readonly roundId: RoundId,
    private readonly activePlayer: PlayerId,
    private readonly seed: number,
    private readonly startedAt: TimePoint,
  ) {}

  apply(state: GameState): CommandResult {
    const currentRound = state.currentRound?.state;
    if (
      currentRound &&
      currentRound.phase !== "finished" &&
      currentRound.phase !== "failed"
    ) {
      return {
        kind: "rejected",
        error: new CommandError("Cannot start next round while another round is active"),
      };
    }

    const players = state.lobby.players;
    if (players.length < 3) {
      return { kind: "rejected", error: new CommandError("Need at least 3 players") };
    }

    if (!players.includes(this.activePlayer)) {
      return {
        kind: "rejected",
        error: new CommandError("Active player must be part of the lobby"),
      };
    }

    const round: RoundState = {
      id: this.roundId,
      players: [...players],
      activePlayer: this.activePlayer,
      phase: "prompt",
      seed: this.seed,
      startedAt: this.startedAt,
      prompts: {},
    };

    const nextState: GameState = {
      ...state,
      currentRound: { id: round.id, state: round },
    };

    return { kind: "ok", state: nextState };
  }
}
