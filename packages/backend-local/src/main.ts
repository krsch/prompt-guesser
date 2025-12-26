import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { TransformResult } from "esbuild";
import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
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
const tsCache = new Map<
  string,
  { readonly mtimeMs: number; readonly code: Uint8Array }
>();
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
    app.get("/*", async (c: Context): Promise<Response> => {
      if (c.req.path.startsWith("/api")) {
        return c.json({ error: "Not found" }, 404);
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

      const requestPath = resolveFrontendRequestPath(c.req.path);
      const resolvedPath = normalize(join(frontendPath, requestPath));
      if (!resolvedPath.startsWith(frontendPath)) {
        return c.json({ error: "Invalid path" }, 400);
      }

      const { readFile, stat } = await import("node:fs/promises");
      const exists = await stat(resolvedPath)
        .then((info) => info.isFile())
        .catch(() => false);

      if (exists) {
        const mimeType = getMimeType(resolvedPath);
        const headers = new Headers();
        if (mimeType) {
          headers.set("Content-Type", mimeType);
        }
        const contents = await readFile(resolvedPath);
        return new Response(toArrayBuffer(new Uint8Array(contents)), { headers });
      }

      if (requestPath.endsWith(".js")) {
        const tsCandidate = resolvedPath.replace(/\.js$/, ".ts");
        const tsExists = await stat(tsCandidate)
          .then((info) => info.isFile())
          .catch(() => false);
        if (tsExists) {
          const code = await compileFrontendModule(tsCandidate);
          const headers = new Headers({
            "Content-Type": "text/javascript; charset=utf-8",
          });
          return new Response(toArrayBuffer(code), { headers });
        }
      }

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
    join(current, "../../../frontend/dist"),
    join(current, "../../../frontend"),
    join(current, "../../../docs/frontend"),
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

function resolveFrontendRequestPath(path: string): string {
  if (path.startsWith("/lobby.js")) return "lobby.js";
  if (path.startsWith("/game.js")) return "game.js";
  if (path.startsWith("/shared.js")) return "shared.js";
  if (path.startsWith("/styles.css")) return "styles.css";
  if (path === "/" || path.startsWith("/lobby")) return "lobby.html";
  if (path.startsWith("/login")) return "login.html";
  if (path.startsWith("/game/")) return "game.html";
  return path === "/" ? "lobby.html" : path.slice(1);
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

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function compileFrontendModule(tsPath: string): Promise<Uint8Array> {
  const { readFile, stat } = await import("node:fs/promises");
  const info = await stat(tsPath);
  const cached = tsCache.get(tsPath);
  if (cached && cached.mtimeMs === info.mtimeMs) {
    return cached.code;
  }

  const source = await readFile(tsPath, "utf8");
  const esbuild = await import("esbuild");
  const result: TransformResult = await esbuild.transform(source, {
    loader: "ts",
    format: "esm",
    sourcemap: "inline",
    sourcefile: tsPath,
    target: "es2022",
  });
  const encoded = new TextEncoder().encode(result.code);
  // eslint-disable-next-line functional/immutable-data
  tsCache.set(tsPath, { mtimeMs: info.mtimeMs, code: encoded });
  return encoded;
}

function getMimeType(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return undefined;
  }
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
