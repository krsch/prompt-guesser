import { Hono } from "hono";
import type { Context, Next } from "hono";

import type { PublishedEvent } from "./adapters/WebSocketBus.js";
import {
  SubmitDecoy,
  SubmitPrompt,
  SubmitVote,
  type GameConfig,
  type GameGateway,
  type GameId,
} from "./core.js";
import type {
  Command,
  CommandContext,
  Logger,
  MessageBus,
  RoundGateway,
  RoundId,
} from "./core.js";

type DispatchCommand = (command: Command, context: CommandContext) => Promise<void>;

export interface EventBus extends MessageBus {
  waitFor(
    predicate: (payload: PublishedEvent) => boolean,
    timeoutMs?: number,
  ): Promise<PublishedEvent>;
}

export interface CreateBackendAppOptions {
  readonly port: number;
  readonly gameGateway: GameGateway;
  readonly roundGateway: RoundGateway;
  readonly bus: EventBus;
  readonly defaultConfig: GameConfig;
  readonly getActiveGameId: () => GameId;
  readonly setActiveGameId: (gameId: GameId) => void;
  readonly logger: Logger;
  readonly createContext: () => CommandContext;
  readonly dispatch: DispatchCommand;
}

export function createBackendApp({
  port,
  gameGateway,
  roundGateway,
  bus,
  defaultConfig,
  getActiveGameId,
  setActiveGameId,
  logger,
  createContext,
  dispatch,
}: CreateBackendAppOptions): Hono {
  const app = new Hono();

  app.use("/api/*", async (c: Context, next: Next): Promise<Response> => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.json({ ok: true });
    }
    await next();
    return c.res;
  });

  app.get("/api/health", (c: Context) =>
    c.json({ ok: true, timestamp: Date.now(), config: { port } }),
  );

  app.post("/api/round/start", async (c: Context) => {
    const body = await c.req
      .json<{
        readonly players: readonly string[];
        readonly activePlayer?: string;
      }>()
      .catch(() => null);

    if (!body || !Array.isArray(body.players) || body.players.length === 0) {
      return c.json({ error: "players array is required" }, 400);
    }

    const activePlayer = body.activePlayer ?? body.players[0];
    if (typeof activePlayer !== "string" || activePlayer.length === 0) {
      return c.json({ error: "activePlayer must be provided" }, 400);
    }

    const now = Date.now();
    const context = createContext();
    let gameId = getActiveGameId();

    let gameState = await gameGateway
      .loadGameState(gameId)
      .catch(async () => gameGateway.createGame(activePlayer, defaultConfig));
    gameId = gameState.id;
    setActiveGameId(gameId);

    gameState.players = [...body.players];
    gameState.cumulativeScores = Object.fromEntries(
      gameState.players.map((playerId) => [
        playerId,
        gameState.cumulativeScores[playerId] ?? 0,
      ]),
    );
    gameState.activeRoundId = undefined;
    gameState.phase = "active";
    gameState.currentRoundIndex += 1;
    await gameGateway.saveGameState(gameState);

    const round = await roundGateway.startNewRound(
      gameState.id,
      gameState.players,
      activePlayer,
      now,
    );

    gameState.activeRoundId = round.id;
    await gameGateway.saveGameState(gameState);

    const event = {
      type: "RoundStarted" as const,
      gameId,
      roundId: round.id,
      players: [...round.players],
      activePlayer: round.activePlayer,
      at: now,
      promptDurationMs: gameState.config.promptDurationMs,
    };

    try {
      await context.scheduler.scheduleTimeout(
        round.id,
        "prompt",
        gameState.config.promptDurationMs,
      );
      await bus.publish(`round:${round.id}`, event);
      return c.json(event);
    } catch (error) {
      logger.error?.("Failed to start round", { error });
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/api/round/:id", async (c: Context) => {
    const roundId = c.req.param("id") as RoundId;
    try {
      const state = await roundGateway.loadRoundState(roundId);
      return c.json(state);
    } catch (error) {
      logger.error?.("Failed to load round", { roundId, error });
      return c.json({ error: "Round not found" }, 404);
    }
  });

  app.post("/api/round/:id/prompt", async (c: Context) => {
    const roundId = c.req.param("id") as RoundId;
    const body = await c.req
      .json<{
        readonly playerId: string;
        readonly prompt: string;
      }>()
      .catch(() => null);

    if (!body || typeof body.playerId !== "string" || typeof body.prompt !== "string") {
      return c.json({ error: "playerId and prompt are required" }, 400);
    }

    const command = new SubmitPrompt(roundId, body.playerId, body.prompt, Date.now());

    try {
      await dispatch(command, createContext());
      return c.json({ ok: true });
    } catch (error) {
      logger.warn?.("Prompt submission failed", { roundId, error });
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.post("/api/round/:id/decoy", async (c: Context) => {
    const roundId = c.req.param("id") as RoundId;
    const body = await c.req
      .json<{
        readonly playerId: string;
        readonly prompt: string;
      }>()
      .catch(() => null);

    if (!body || typeof body.playerId !== "string" || typeof body.prompt !== "string") {
      return c.json({ error: "playerId and prompt are required" }, 400);
    }

    const command = new SubmitDecoy(roundId, body.playerId, body.prompt, Date.now());

    try {
      await dispatch(command, createContext());
      return c.json({ ok: true });
    } catch (error) {
      logger.warn?.("Decoy submission failed", { roundId, error });
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.post("/api/round/:id/vote", async (c: Context) => {
    const roundId = c.req.param("id") as RoundId;
    const body = await c.req
      .json<{
        readonly playerId: string;
        readonly promptIndex: number;
      }>()
      .catch(() => null);

    if (
      !body ||
      typeof body.playerId !== "string" ||
      typeof body.promptIndex !== "number"
    ) {
      return c.json({ error: "playerId and promptIndex are required" }, 400);
    }

    const command = new SubmitVote(roundId, body.playerId, body.promptIndex, Date.now());

    try {
      await dispatch(command, createContext());
      return c.json({ ok: true });
    } catch (error) {
      logger.warn?.("Vote submission failed", { roundId, error });
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  return app;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
