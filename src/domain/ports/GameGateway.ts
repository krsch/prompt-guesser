import type { GameConfig } from "../GameConfig.js";
import type { PlayerId, RoundId } from "../typedefs.js";

export type GameId = string;
export type GamePhase = "lobby" | "active" | "finished";

export interface GameState {
  readonly id: GameId;
  players: PlayerId[];
  readonly host: PlayerId;
  activeRoundId: RoundId | undefined;
  currentRoundIndex: number;
  cumulativeScores: Record<PlayerId, number>;
  readonly config: GameConfig;
  phase: GamePhase;
}

export interface GameGateway {
  loadGameState(gameId: GameId): Promise<GameState>;
  saveGameState(state: GameState): Promise<void>;
  createGame(host: PlayerId, config: GameConfig): Promise<GameState>;
}
