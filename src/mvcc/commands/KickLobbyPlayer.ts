import { CommandError } from "../errors.js";
import type { CommandResult, GameCommand, GameState, PlayerId } from "../types.js";

export class KickLobbyPlayer implements GameCommand {
  readonly type = "KickLobbyPlayer";

  constructor(private readonly playerId: PlayerId) {}

  apply(state: GameState): CommandResult {
    const { lobby } = state;
    if (!lobby.players.includes(this.playerId)) {
      return { kind: "ok", state };
    }

    if (lobby.host === this.playerId) {
      return { kind: "rejected", error: new CommandError("Cannot kick host") };
    }

    const remaining = lobby.players.filter((pid) => pid !== this.playerId);
    const nextState: GameState = {
      ...state,
      lobby: { ...lobby, players: remaining },
    };

    return { kind: "ok", state: nextState };
  }
}
