import { CommandError } from "../errors.js";
import type { CommandResult, GameCommand, GameState, PlayerId } from "../types.js";

export class JoinLobby implements GameCommand {
  readonly type = "JoinLobby";

  constructor(private readonly playerId: PlayerId) {}

  apply(state: GameState): CommandResult {
    if (!this.playerId) {
      return { kind: "rejected", error: new CommandError("playerId is required") };
    }

    const players = state.lobby.players;
    if (players.includes(this.playerId)) {
      return { kind: "ok", state };
    }

    const nextState: GameState = {
      ...state,
      lobby: {
        ...state.lobby,
        players: [...players, this.playerId],
      },
    };

    return { kind: "ok", state: nextState };
  }
}
