import { CommandError } from "../errors.js";
import type { CommandResult, GameCommand, GameState, PlayerId } from "../types.js";

export class LeaveLobby implements GameCommand {
  readonly type = "LeaveLobby";

  constructor(private readonly playerId: PlayerId) {}

  apply(state: GameState): CommandResult {
    const { lobby } = state;
    if (!lobby.players.includes(this.playerId)) {
      return { kind: "rejected", error: new CommandError("Player not in lobby") };
    }

    if (lobby.host === this.playerId) {
      return { kind: "rejected", error: new CommandError("Host cannot leave lobby") };
    }

    const remaining = lobby.players.filter((pid) => pid !== this.playerId);
    const nextState: GameState = {
      ...state,
      lobby: { ...lobby, players: remaining },
    };

    return { kind: "ok", state: nextState };
  }
}
