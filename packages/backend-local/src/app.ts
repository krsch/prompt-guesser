import { Hono } from "hono";
import type { Context, Next } from "hono";

import type { PublishedEvent } from "./adapters/WebSocketBus.js";
import {
  SetLobbyPlayers,
  StartNextRound,
  SubmitDecoy,
  SubmitPrompt,
  SubmitVote,
  type GameConfig,
  type GameId,
  type RoundId,
  type GameStore,
  projectVisibleState,
  type Logger,
  type MessageBus,
  type Scheduler,
  type GameService,
} from "./core.js";

export interface EventBus extends MessageBus {
  waitFor(
    predicate: (payload: PublishedEvent) => boolean,
    timeoutMs?: number,
  ): Promise<PublishedEvent>;
}

export interface CreateBackendAppOptions {
  readonly port: number;
  readonly gameStore: GameStore;
  readonly bus: EventBus;
  readonly defaultConfig: GameConfig;
  readonly getActiveGameId: () => GameId;
  readonly setActiveGameId: (gameId: GameId) => void;
  readonly logger: Logger;
  readonly service: GameService;
  readonly scheduler: Scheduler;
}

export function createBackendApp({
  port,
  gameStore,
  bus: _bus,
  defaultConfig,
  getActiveGameId,
  setActiveGameId,
  logger,
  service,
  scheduler,
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

    const players = [...body.players];
    if (players.length < 3) {
      return c.json({ error: "at least three players required" }, 400);
    }

    const now = Date.now();
    const gameId = getActiveGameId();
    const roundId = `round-${now}` as RoundId;
    const seed = now;

    try {
      await gameStore.loadGame(gameId).catch(async () => {
        await gameStore.createGame({
          id: gameId,
          lobby: { host: activePlayer, players: [activePlayer], config: defaultConfig },
        });
      });
      setActiveGameId(gameId);

      await service.run(gameId, new SetLobbyPlayers(players));
      await service.run(gameId, new StartNextRound(roundId, activePlayer, seed, now));
      await scheduler.scheduleTimeout(roundId, "prompt", defaultConfig.promptDurationMs);
      const visible = projectVisibleState(await gameStore.loadGame(gameId));
      return c.json(visible);
    } catch (error) {
      logger.error?.("Failed to start round", { error });
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.get("/api/round/:id", async (c: Context) => {
    const roundId = c.req.param("id") as RoundId;
    try {
      const game = await gameStore.loadGame(getActiveGameId());
      const current = game.currentRound;
      if (!current || current.id !== roundId) {
        return c.json({ error: "Round not found" }, 404);
      }
      const visible = projectVisibleState(game).currentRound?.state;
      if (!visible) {
        return c.json({ error: "Round not found" }, 404);
      }
      return c.json(visible);
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

    const command = new SubmitPrompt(roundId, body.playerId, body.prompt);

    try {
      await service.run(getActiveGameId(), command);
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

    const command = new SubmitDecoy(roundId, body.playerId, body.prompt);

    try {
      await service.run(getActiveGameId(), command);
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

    const command = new SubmitVote(roundId, body.playerId, body.promptIndex);

    try {
      await service.run(getActiveGameId(), command);
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
