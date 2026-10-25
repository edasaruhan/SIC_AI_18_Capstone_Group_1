import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });

const options = {
  // Giriş listesi build-entries.json içinde; ağ testi de aynı listeyi okur.
  entryPoints: JSON.parse(readFileSync("build-entries.json", "utf8")).entries,
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("İzleniyor... (Ctrl+C ile çık)");
} else {
  await build(options);
}
