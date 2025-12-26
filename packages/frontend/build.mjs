import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build, context } from "esbuild";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("./dist", import.meta.url));
const watchMode = process.argv.includes("--watch");

const staticFiles = ["lobby.html", "game.html", "login.html", "styles.css"];
const entryPoints = ["lobby.ts", "game.ts", "shared.js"];

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyStatic();

  const buildOptions = {
    entryPoints,
    outdir: outDir,
    format: "esm",
    sourcemap: true,
    target: "es2022",
    bundle: false,
  };

  if (watchMode) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    await copyStatic(true);
    console.log("Frontend build watching for changes...");
  } else {
    await build(buildOptions);
    console.log("Frontend build complete.");
  }
}

async function copyStatic(watch = false) {
  await Promise.all(
    staticFiles.map((file) =>
      cp(new URL(`./${file}`, import.meta.url), `${outDir}/${file}`),
    ),
  );

  if (!watch) return;

  const { watch: watchFs } = await import("node:fs");
  staticFiles.forEach((file) => {
    const watcher = watchFs(fileURLToPath(new URL(file, import.meta.url)));
    watcher.on("change", async () => {
      await cp(new URL(`./${file}`, import.meta.url), `${outDir}/${file}`);
      console.log(`Copied ${file}`);
    });
  });
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
