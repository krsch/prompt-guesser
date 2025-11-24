import { sValidator } from "@hono/standard-validator";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { array, minLength, number, object, optional, pipe, string } from "valibot";

import type { PublishedEvent } from "./adapters/WebSocketBus.js";
import {
  JoinLobby,
  KickLobbyPlayer,
  LeaveLobby,
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
  readonly logger: Logger;
  readonly service: GameService;
  readonly scheduler: Scheduler;
}

export function createBackendApp({
  port,
  gameStore,
  bus: _bus,
  defaultConfig,
  logger,
  service,
  scheduler,
}: CreateBackendAppOptions): Hono {
  const app = new Hono();
  const playerSchema = object({
    playerId: pipe(string(), minLength(1)),
  }) satisfies StandardSchemaV1;
  const createGameSchema = object({
    host: optional(pipe(string(), minLength(1))),
  }) satisfies StandardSchemaV1;

  const startRoundSchema = object({
    players: pipe(array(pipe(string(), minLength(1))), minLength(3)),
    activePlayer: optional(pipe(string(), minLength(1))),
  }) satisfies StandardSchemaV1;

  const promptSchema = object({
    playerId: pipe(string(), minLength(1)),
    prompt: pipe(string(), minLength(1)),
  }) satisfies StandardSchemaV1;

  const voteSchema = object({
    playerId: pipe(string(), minLength(1)),
    promptIndex: number(),
  }) satisfies StandardSchemaV1;

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

  app.post(
    "/api/games",
    sValidator("json", createGameSchema, handleValidationFailure),
    async (c) => {
      const { host } = c.req.valid("json");
      const resolvedHost = host ?? "host";

      const gameId = createGameId();

      try {
        await gameStore.createGame({
          id: gameId,
          lobby: {
            host: resolvedHost,
            players: [resolvedHost],
            config: defaultConfig,
          },
        });

        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.newResponse(JSON.stringify(visible), {
          status: 201,
          headers: {
            "content-type": "application/json",
            Location: `/api/games/${gameId}`,
          },
        });
      } catch (error) {
        logger.error?.("Failed to create lobby", { error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.get("/api/games/:gameId", async (c: Context) => {
    const gameId = c.req.param("gameId") as GameId;
    try {
      const game = await gameStore.loadGame(gameId);
      c.header("Cache-Control", "no-store");
      return c.json(projectVisibleState(game));
    } catch (error) {
      logger.error?.("Failed to load lobby", { error });
      return c.json(formatError("Lobby not found", "not_found"), 404);
    }
  });

  app.post(
    "/api/games/:gameId/lobby/join",
    sValidator("json", playerSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const { playerId } = c.req.valid("json");

      try {
        await service.run(gameId, new JoinLobby(playerId));
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.json(visible);
      } catch (error) {
        logger.error?.("Failed to join lobby", { error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.post(
    "/api/games/:gameId/lobby/leave",
    sValidator("json", playerSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const { playerId } = c.req.valid("json");

      try {
        await service.run(gameId, new LeaveLobby(playerId));
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.json(visible);
      } catch (error) {
        logger.error?.("Failed to leave lobby", { error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.post(
    "/api/games/:gameId/lobby/kick",
    sValidator("json", playerSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const { playerId } = c.req.valid("json");

      try {
        await service.run(gameId, new KickLobbyPlayer(playerId));
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.json(visible);
      } catch (error) {
        logger.error?.("Failed to kick player", { error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/start",
    sValidator("json", startRoundSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const payload = c.req.valid("json");
      const players = payload.players as readonly string[];
      const fallbackActivePlayer = players[0];
      if (!fallbackActivePlayer) {
        return c.json(formatError("At least one player required"), 400);
      }
      const activePlayer = payload.activePlayer ?? fallbackActivePlayer;

      const now = Date.now();
      const roundId = `round-${now}` as RoundId;
      const seed = now;

      try {
        await gameStore.loadGame(gameId);

        await service.run(gameId, new SetLobbyPlayers(players));
        await service.run(gameId, new StartNextRound(roundId, activePlayer, seed, now));
        await scheduler.scheduleTimeout(
          roundId,
          "prompt",
          defaultConfig.promptDurationMs,
          gameId,
        );
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.newResponse(JSON.stringify(visible), {
          status: 201,
          headers: {
            "content-type": "application/json",
            Location: `/api/games/${gameId}/rounds/${roundId}`,
          },
        });
      } catch (error) {
        if (error instanceof Error && /not found/i.test(error.message)) {
          logger.warn?.("Attempted to start round for missing game", { gameId });
          return c.json(formatError("Game not found", "not_found"), 404);
        }
        logger.error?.("Failed to start round", { error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.get("/api/games/:gameId/rounds/:id", async (c: Context) => {
    const gameId = c.req.param("gameId") as GameId;
    const roundId = c.req.param("id") as RoundId;
    try {
      const game = await gameStore.loadGame(gameId);
      const current = game.currentRound;
      if (!current || current.id !== roundId) {
        return c.json(formatError("Round not found", "not_found"), 404);
      }
      const visible = projectVisibleState(game).currentRound?.state;
      if (!visible) {
        return c.json(formatError("Round not found", "not_found"), 404);
      }
      c.header("Cache-Control", "no-store");
      return c.json(visible);
    } catch (error) {
      logger.error?.("Failed to load round", { roundId, error });
      return c.json(formatError("Round not found", "not_found"), 404);
    }
  });

  app.post(
    "/api/games/:gameId/rounds/:id/prompt",
    sValidator("json", promptSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const roundId = c.req.param("id") as RoundId;
      const { playerId, prompt } = c.req.valid("json");

      const command = new SubmitPrompt(roundId, playerId, prompt);

      try {
        await service.run(gameId, command);
        return c.json({ ok: true });
      } catch (error) {
        logger.warn?.("Prompt submission failed", { roundId, error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/:id/decoy",
    sValidator("json", promptSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const roundId = c.req.param("id") as RoundId;
      const { playerId, prompt } = c.req.valid("json");

      const command = new SubmitDecoy(roundId, playerId, prompt);

      try {
        await service.run(gameId, command);
        return c.json({ ok: true });
      } catch (error) {
        logger.warn?.("Decoy submission failed", { roundId, error });
        return c.json(formatError(error), 400);
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/:id/vote",
    sValidator("json", voteSchema, handleValidationFailure),
    async (c) => {
      const gameId = c.req.param("gameId") as GameId;
      const roundId = c.req.param("id") as RoundId;
      const { playerId, promptIndex } = c.req.valid("json");

      const command = new SubmitVote(roundId, playerId, promptIndex);

      try {
        await service.run(gameId, command);
        return c.json({ ok: true });
      } catch (error) {
        logger.warn?.("Vote submission failed", { roundId, error });
        return c.json(formatError(error), 400);
      }
    },
  );

  return app;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function formatError(
  error: unknown,
  code = "invalid_request",
): { readonly error: { readonly code: string; readonly message: string } } {
  return { error: { code, message: getErrorMessage(error) } };
}

function createGameId(): GameId {
  return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as GameId;
}

function formatStandardIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  if (!issues.length) return "Invalid request body";
  const issue = issues[0];
  if (!issue) return "Invalid request body";
  const path = issue.path
    ?.map((segment) => {
      const key = typeof segment === "object" && "key" in segment ? segment.key : segment;
      return typeof key === "symbol" ? "" : String(key);
    })
    .filter((value) => value.length > 0)
    .join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function handleValidationFailure(
  result: {
    readonly success: boolean;
    readonly error?: readonly StandardSchemaV1.Issue[];
  },
  c: Context,
): Response | undefined {
  if (!result.success && result.error) {
    return c.json(formatError(formatStandardIssues(result.error)), 400);
  }
  return undefined;
}

// Explicit game creation is required; no auto-create helpers here.
