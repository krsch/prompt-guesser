import type {
  Command,
  CommandContext,
} from "@prompt-guesser/core/domain/commands/Command.js";
import { StartNewRound } from "@prompt-guesser/core/domain/commands/StartNewRound.js";
import { SubmitDecoy } from "@prompt-guesser/core/domain/commands/SubmitDecoy.js";
import { SubmitPrompt } from "@prompt-guesser/core/domain/commands/SubmitPrompt.js";
import { SubmitVote } from "@prompt-guesser/core/domain/commands/SubmitVote.js";
import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";
import type { MessageBus } from "@prompt-guesser/core/domain/ports/MessageBus.js";
import type { RoundGateway } from "@prompt-guesser/core/domain/ports/RoundGateway.js";
import type { RoundId } from "@prompt-guesser/core/domain/typedefs.js";
import { Hono } from "hono";

import type { PublishedEvent } from "./adapters/WebSocketBus.js";

type DispatchCommand = (command: Command, context: CommandContext) => Promise<void>;

export interface EventBus extends MessageBus {
  waitFor(
    predicate: (payload: PublishedEvent) => boolean,
    timeoutMs?: number,
  ): Promise<PublishedEvent>;
}

export interface CreateBackendAppOptions {
  readonly port: number;
  readonly gateway: RoundGateway;
  readonly bus: EventBus;
  readonly logger: Logger;
  readonly createContext: () => CommandContext;
  readonly dispatch: DispatchCommand;
}

export function createBackendApp({
  port,
  gateway,
  bus,
  logger,
  createContext,
  dispatch,
}: CreateBackendAppOptions): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next): Promise<Response> => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.json({ ok: true });
    }
    await next();
    return c.res;
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, timestamp: Date.now(), config: { port } }),
  );

  app.post("/api/round/start", async (c) => {
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
    let command: StartNewRound;
    try {
      command = new StartNewRound(body.players, activePlayer, now);
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }

    const eventPromise = bus.waitFor(
      ({ event }) =>
        (event as { readonly type?: string; readonly at?: number }).type ===
          "RoundStarted" && (event as { readonly at?: number }).at === now,
      2000,
    );

    try {
      await dispatch(command, context);
      const { event } = await eventPromise;
      return c.json(event);
    } catch (error) {
      void eventPromise.catch(() => undefined);
      logger.error?.("Failed to start round", { error });
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/api/round/:id", async (c) => {
    const roundId = c.req.param("id") as RoundId;
    try {
      const state = await gateway.loadRoundState(roundId);
      return c.json(state);
    } catch (error) {
      logger.error?.("Failed to load round", { roundId, error });
      return c.json({ error: "Round not found" }, 404);
    }
  });

  app.post("/api/round/:id/prompt", async (c) => {
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

  app.post("/api/round/:id/decoy", async (c) => {
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

  app.post("/api/round/:id/vote", async (c) => {
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
