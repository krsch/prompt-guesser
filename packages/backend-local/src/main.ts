import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { InMemoryRoundGateway } from "@prompt-guesser/core/adapters/in-memory/InMemoryRoundGateway.js";
import type { CommandContext } from "@prompt-guesser/core/domain/commands/Command.js";
import { StartNewRound } from "@prompt-guesser/core/domain/commands/StartNewRound.js";
import { SubmitDecoy } from "@prompt-guesser/core/domain/commands/SubmitDecoy.js";
import { SubmitPrompt } from "@prompt-guesser/core/domain/commands/SubmitPrompt.js";
import { SubmitVote } from "@prompt-guesser/core/domain/commands/SubmitVote.js";
import { dispatchCommand } from "@prompt-guesser/core/domain/dispatchCommand.js";
import { GameConfig } from "@prompt-guesser/core/domain/GameConfig.js";
import type { ImageGenerator } from "@prompt-guesser/core/domain/ports/ImageGenerator.js";
import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";
import type { RoundId } from "@prompt-guesser/core/domain/typedefs.js";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenAIImageGenerator } from "./adapters/OpenAIImageGenerator.js";
import { RealScheduler } from "./adapters/RealScheduler.js";
import { WebSocketBus } from "./adapters/WebSocketBus.js";
import { createConsoleLogger } from "./logger.js";

const DEFAULT_PORT = Number(process.env["PORT"] ?? 8787);
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"] ?? "";

export async function startServer(): Promise<void> {
  const logger = createConsoleLogger("backend-local");
  const gateway = new InMemoryRoundGateway();
  const bus = new WebSocketBus(logger);
  const config = GameConfig.withDefaults();
  const imageGenerator = createImageGenerator(logger);

  let scheduler: RealScheduler;

  const createContext = (): CommandContext => ({
    gateway,
    bus,
    imageGenerator,
    config,
    scheduler,
    logger,
  });

  scheduler = new RealScheduler({
    contextFactory: async (): Promise<CommandContext> => createContext(),
    logger,
  });

  const app = new Hono();

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

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
    c.json({ ok: true, timestamp: Date.now(), config: { port: DEFAULT_PORT } }),
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
      await dispatchCommand(command, context);
      const { event } = await eventPromise;
      return c.json(event);
    } catch (error) {
      void eventPromise.catch(() => undefined);
      logger.error("Failed to start round", { error });
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/api/round/:id", async (c) => {
    const roundId = c.req.param("id") as RoundId;
    try {
      const state = await gateway.loadRoundState(roundId);
      return c.json(state);
    } catch (error) {
      logger.error("Failed to load round", { roundId, error });
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
      await dispatchCommand(command, createContext());
      return c.json({ ok: true });
    } catch (error) {
      logger.warn("Prompt submission failed", { roundId, error });
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
      await dispatchCommand(command, createContext());
      return c.json({ ok: true });
    } catch (error) {
      logger.warn("Decoy submission failed", { roundId, error });
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
      await dispatchCommand(command, createContext());
      return c.json({ ok: true });
    } catch (error) {
      logger.warn("Vote submission failed", { roundId, error });
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.get(
    "/ws/:roundId",
    upgradeWebSocket((c) => {
      const roundId = c.req.param("roundId");
      return {
        onOpen(_event, ws): void {
          const rawSocket = ws.raw;
          if (!rawSocket) {
            logger.warn("WebSocket connection missing raw handle", { roundId });
            return;
          }
          bus.attach(`round:${roundId}`, rawSocket);
        },
      };
    }),
  );

  const frontendPath = resolveFrontendPath();
  if (frontendPath) {
    app.get("/*", async (c): Promise<Response> => {
      const filePath = join(frontendPath, "index.html");
      if (!existsSync(filePath)) {
        return c.json({ error: "Frontend build not found" }, 404);
      }

      const { readFile } = await import("node:fs/promises");
      const contents = await readFile(filePath, "utf8");
      return c.html(contents);
    });
  }

  const server = serve({ fetch: app.fetch, port: DEFAULT_PORT }, (info) => {
    logger.info("Server listening", info);
  });

  injectWebSocket(server);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function resolveFrontendPath(): string | null {
  const current = fileURLToPath(new URL(".", import.meta.url));
  const candidate = join(current, "../../frontend/dist");
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function createImageGenerator(logger: Logger): ImageGenerator {
  if (!OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY is not set. Using placeholder image generator.");
    return {
      async generate(prompt: string): Promise<string> {
        const encodedPrompt = encodeURIComponent(prompt);
        return `https://dummyimage.com/1024x1024/1f2937/ffffff&text=${encodedPrompt}`;
      },
    } satisfies ImageGenerator;
  }

  return new OpenAIImageGenerator({ apiKey: OPENAI_API_KEY, logger });
}

void startServer().catch((error) => {
  createConsoleLogger("backend-local").error("Failed to start backend", { error });
  process.exit(1);
});
