import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";

import { OpenAIImageGenerator } from "./adapters/OpenAIImageGenerator.js";
import { RealScheduler } from "./adapters/RealScheduler.js";
import { WebSocketBus } from "./adapters/WebSocketBus.js";
import { createBackendApp } from "./app.js";
import type { GameId, ImageGenerator, PhaseTimeout } from "./core.js";
import {
  BroadcastReactor,
  GameService,
  ImageGenerationReactor,
  InMemoryGameStore,
  PhaseSchedulerReactor,
  createGameConfig,
} from "./core.js";
import { createConsoleLogger } from "./logger.js";
import { createSessionStore } from "./session.js";

const DEFAULT_PORT = Number(process.env["PORT"] ?? 8787);
export async function startServer(): Promise<void> {
  const logger = createConsoleLogger("backend-local");
  const bus = new WebSocketBus(logger);
  const config = createGameConfig();
  const gameStore = new InMemoryGameStore();
  const sessionStore = createSessionStore();
  const initialGame = {
    id: "game-1" as GameId,
    lobby: {
      host: "host",
      players: ["host"],
      config,
    },
  };
  await gameStore.createGame(initialGame);

  let service: GameService;
  const scheduler = new RealScheduler({
    runTimeout: async (cmd: PhaseTimeout, gameId: GameId): Promise<void> => {
      await service.run(gameId, cmd);
    },
    logger,
  });

  const reactorContext = { bus, scheduler, logger };

  const reactors = [
    new BroadcastReactor(),
    new PhaseSchedulerReactor(),
    new ImageGenerationReactor(
      createImageGeneratorOrStub(logger, process.env["OPENAI_API_KEY"]),
    ),
  ];

  service = new GameService({
    store: gameStore,
    reactors,
    reactorContext,
  });

  const app = createBackendApp({
    port: DEFAULT_PORT,
    gameStore,
    bus,
    defaultConfig: config,
    logger,
    service,
    scheduler,
    sessionStore,
  });

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/ws/:gameId",
    upgradeWebSocket((c: Context) => {
      const gameId = c.req.param("gameId");
      return {
        onOpen(_event: Event, ws: WSContext<WebSocket>): void {
          const rawSocket = ws.raw;
          if (!rawSocket) {
            logger.warn("WebSocket connection missing raw handle", { gameId });
            return;
          }
          bus.attach(`game:${gameId}`, rawSocket);
        },
      };
    }),
  );

  const frontendPath = resolveFrontendPath();
  if (frontendPath) {
    const staticMiddleware = serveStatic({
      root: frontendPath,
      rewriteRequestPath: (path: string): string => {
        const normalized = path.startsWith("/") ? path.slice(1) : path;
        const isAsset =
          normalized.endsWith(".js") ||
          normalized.endsWith(".css") ||
          normalized.endsWith(".map");
        if (isAsset) return normalized;
        if (normalized === "" || normalized.startsWith("lobby")) return "lobby.html";
        if (normalized.startsWith("login")) return "login.html";
        if (normalized.startsWith("game/")) return "game.html";
        return normalized;
      },
    });

    app.use("/*", async (c: Context, next): Promise<Response> => {
      if (c.req.path.startsWith("/api")) {
        const res = await next();
        return res ?? c.json({ error: "Not found" }, 404);
      }

      if (c.req.path === "/") {
        return c.redirect("/lobby", 302);
      }

      if (c.req.path.startsWith("/game/")) {
        const sessionId = readSessionId(c.req.header("cookie"));
        if (!sessionId || !sessionStore.get(sessionId)) {
          const redirectUrl = `/login?next=${encodeURIComponent(c.req.path)}`;
          return c.redirect(redirectUrl, 302);
        }
      }

      const served = await staticMiddleware(c, async () => undefined);
      if (served) return served;

      const { readFile } = await import("node:fs/promises");
      const fallbackPath = join(frontendPath, "lobby.html");
      if (!existsSync(fallbackPath)) {
        return c.json({ error: "Frontend build not found" }, 404);
      }
      const contents = await readFile(fallbackPath, "utf8");
      return c.html(contents);
    });
  }

  const server = serve({ fetch: app.fetch, port: DEFAULT_PORT }, (info: AddressInfo) => {
    logger.info("Server listening", info);
  });

  injectWebSocket(server);
}

function resolveFrontendPath(): string | null {
  const current = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(current, "../../../packages/frontend/dist"),
    join(current, "../../../packages/frontend"),
    join(current, "../../../frontend/dist"),
    join(current, "../../../frontend"),
  ];

  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "lobby.html")) ||
      existsSync(join(candidate, "index.html"))
    ) {
      return candidate;
    }
  }
  return null;
}

function readSessionId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const parsed = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((pair) => pair.trim().split("=", 2))
      .filter(([key, value]) => Boolean(key) && Boolean(value))
      .map(([key = "", value = ""]) => [
        decodeURIComponent(key),
        decodeURIComponent(value),
      ]),
  );
  return parsed["pg-session"];
}

void startServer().catch((error) => {
  createConsoleLogger("backend-local").error("Failed to start backend", { error });
  process.exit(1);
});

function createImageGeneratorOrStub(
  logger: ReturnType<typeof createConsoleLogger>,
  apiKey: string | undefined,
): ImageGenerator {
  if (apiKey) {
    logger.info("Using OpenAI image generator");
    return new OpenAIImageGenerator({ apiKey, logger });
  }

  logger.warn("OPENAI_API_KEY missing; falling back to placeholder image generator");
  return {
    async generate(prompt: string): Promise<string> {
      const encoded = encodeURIComponent(prompt);
      return `https://dummyimage.com/1024x1024/1f2937/ffffff&text=${encoded}`;
    },
  };
}
