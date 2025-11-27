import { sValidator } from "@hono/standard-validator";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { array, minLength, number, object, optional, pipe, string } from "valibot";

import { asDomainError } from "@prompt-guesser/core/mvcc/errors.js";

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

const MAX_JSON_BYTES = 64 * 1024;

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
  const gameParamsSchema = object({
    gameId: pipe(string(), minLength(1)),
  }) satisfies StandardSchemaV1;
  const roundParamsSchema = object({
    gameId: pipe(string(), minLength(1)),
    id: pipe(string(), minLength(1)),
  }) satisfies StandardSchemaV1;

  app.use("*", requestContextMiddleware(logger));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_JSON_BYTES,
      onError: (c) =>
        c.json(
          formatError("Payload too large", "payload_too_large", getRequestId(c)),
          413,
        ),
    }),
  );
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
        return respondWithMappedError(c, error, logger, { action: "create_lobby" });
      }
    },
  );

  app.get(
    "/api/games/:gameId",
    sValidator("param", gameParamsSchema, handleValidationFailure),
    async (c) => {
      const { gameId } = c.req.valid("param");
      try {
        const game = await gameStore.loadGame(gameId as GameId);
        c.header("Cache-Control", "no-store");
        return c.json(projectVisibleState(game));
      } catch (error) {
        logger.error?.("Failed to load lobby", { error });
        return c.json(formatError("Lobby not found", "not_found"), 404);
      }
    },
  );

  app.post(
    "/api/games/:gameId/lobby/join",
    sValidator("param", gameParamsSchema, handleValidationFailure),
    sValidator("json", playerSchema, handleValidationFailure),
    async (c) => {
      const { gameId } = c.req.valid("param");
      const { playerId } = c.req.valid("json");

      try {
        await service.run(gameId as GameId, new JoinLobby(playerId));
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.json(visible);
      } catch (error) {
        return respondWithMappedError(c, error, logger, { action: "join_lobby" });
      }
    },
  );

  app.post(
    "/api/games/:gameId/lobby/leave",
    sValidator("param", gameParamsSchema, handleValidationFailure),
    sValidator("json", playerSchema, handleValidationFailure),
    async (c) => {
      const { gameId } = c.req.valid("param");
      const { playerId } = c.req.valid("json");

      try {
        await service.run(gameId as GameId, new LeaveLobby(playerId));
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.json(visible);
      } catch (error) {
        return respondWithMappedError(c, error, logger, { action: "leave_lobby" });
      }
    },
  );

  app.post(
    "/api/games/:gameId/lobby/kick",
    sValidator("param", gameParamsSchema, handleValidationFailure),
    sValidator("json", playerSchema, handleValidationFailure),
    async (c) => {
      const { gameId } = c.req.valid("param");
      const { playerId } = c.req.valid("json");

      try {
        await service.run(gameId as GameId, new KickLobbyPlayer(playerId));
        const visible = projectVisibleState(await gameStore.loadGame(gameId));
        return c.json(visible);
      } catch (error) {
        return respondWithMappedError(c, error, logger, { action: "kick_lobby_player" });
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/start",
    sValidator("param", gameParamsSchema, handleValidationFailure),
    sValidator("json", startRoundSchema, handleValidationFailure),
    async (c) => {
      const { gameId } = c.req.valid("param");
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
        await gameStore.loadGame(gameId as GameId);

        await service.run(gameId as GameId, new SetLobbyPlayers(players));
        await service.run(
          gameId as GameId,
          new StartNextRound(roundId, activePlayer, seed, now),
        );
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
          return c.json(formatError("Game not found", "not_found", getRequestId(c)), 404);
        }
        return respondWithMappedError(c, error, logger, { action: "start_round" });
      }
    },
  );

  app.get(
    "/api/games/:gameId/rounds/:id",
    sValidator("param", roundParamsSchema, handleValidationFailure),
    async (c) => {
      const { gameId, id } = c.req.valid("param");
      const roundId = id as RoundId;
      try {
        const game = await gameStore.loadGame(gameId as GameId);
        const current = game.currentRound;
        if (!current || current.id !== roundId) {
          return c.json(
            formatError("Round not found", "not_found", getRequestId(c)),
            404,
          );
        }
        const visible = projectVisibleState(game).currentRound?.state;
        if (!visible) {
          return c.json(
            formatError("Round not found", "not_found", getRequestId(c)),
            404,
          );
        }
        c.header("Cache-Control", "no-store");
        return c.json(visible);
      } catch (error) {
        logger.error?.("Failed to load round", { roundId, error });
        return c.json(formatError("Round not found", "not_found", getRequestId(c)), 404);
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/:id/prompt",
    sValidator("param", roundParamsSchema, handleValidationFailure),
    sValidator("json", promptSchema, handleValidationFailure),
    async (c) => {
      const { gameId, id } = c.req.valid("param");
      const roundId = id as RoundId;
      const { playerId, prompt } = c.req.valid("json");

      const command = new SubmitPrompt(roundId, playerId, prompt);

      try {
        await service.run(gameId as GameId, command);
        return c.json({ ok: true });
      } catch (error) {
        return respondWithMappedError(c, error, logger, {
          action: "submit_prompt",
          roundId,
        });
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/:id/decoy",
    sValidator("param", roundParamsSchema, handleValidationFailure),
    sValidator("json", promptSchema, handleValidationFailure),
    async (c) => {
      const { gameId, id } = c.req.valid("param");
      const roundId = id as RoundId;
      const { playerId, prompt } = c.req.valid("json");

      const command = new SubmitDecoy(roundId, playerId, prompt);

      try {
        await service.run(gameId as GameId, command);
        return c.json({ ok: true });
      } catch (error) {
        return respondWithMappedError(c, error, logger, {
          action: "submit_decoy",
          roundId,
        });
      }
    },
  );

  app.post(
    "/api/games/:gameId/rounds/:id/vote",
    sValidator("param", roundParamsSchema, handleValidationFailure),
    sValidator("json", voteSchema, handleValidationFailure),
    async (c) => {
      const { gameId, id } = c.req.valid("param");
      const roundId = id as RoundId;
      const { playerId, promptIndex } = c.req.valid("json");

      const command = new SubmitVote(roundId, playerId, promptIndex);

      try {
        await service.run(gameId as GameId, command);
        return c.json({ ok: true });
      } catch (error) {
        return respondWithMappedError(c, error, logger, {
          action: "submit_vote",
          roundId,
        });
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
  requestId?: string,
): {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId?: string;
  };
} {
  const shaped = { code, message: getErrorMessage(error) };
  return requestId ? { error: { ...shaped, requestId } } : { error: shaped };
}

function createGameId(): GameId {
  return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as GameId;
}

function getRequestId(c: Context): string | undefined {
  return (c.get("requestId" as never) as string | undefined) ?? undefined;
}

function requestContextMiddleware(logger: Logger) {
  return async (c: Context, next: Next): Promise<Response> => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    c.set("requestId", requestId);

    try {
      await next();
    } catch (error) {
      logger.error("request.failed", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        error,
      });
      return c.json(
        formatError("Internal server error", "internal_error", requestId),
        500,
      );
    } finally {
      const durationMs = Date.now() - startedAt;
      const status = c.res?.status ?? 500;
      logger.info("request.completed", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs,
      });
    }

    return c.res;
  };
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
    return c.json(
      formatError(
        formatStandardIssues(result.error),
        "invalid_request",
        c.get("requestId"),
      ),
      400,
    );
  }
  return undefined;
}

// Explicit game creation is required; no auto-create helpers here.

type ErrorStatus = 400 | 404 | 500;

function mapErrorToHttp(error: unknown): {
  readonly status: ErrorStatus;
  readonly code: string;
} {
  const domain = asDomainError(error);
  if (domain) {
    if (domain.code === "not_found") return { status: 404, code: domain.code };
    if (domain.code === "conflict")
      return { status: 409 as ErrorStatus, code: domain.code };
    if (domain.code === "invalid_request") return { status: 400, code: domain.code };
    return { status: 500, code: domain.code };
  }
  return { status: 500, code: "internal_error" };
}

function respondWithMappedError(
  c: Context,
  error: unknown,
  logger: Logger,
  meta?: Record<string, unknown>,
): Response {
  const requestId = getRequestId(c);
  const { status, code } = mapErrorToHttp(error);
  const logMeta = {
    ...meta,
    error,
    requestId,
    status,
    path: c.req.path,
    method: c.req.method,
  };
  if (status >= 500) {
    logger.error?.("request.error", logMeta);
  } else {
    logger.warn?.("request.error", logMeta);
  }
  return c.json(formatError(error, code, requestId), status);
}
