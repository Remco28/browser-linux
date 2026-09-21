#!/usr/bin/env bun
/**
 * Static server for local development.
 *
 * It exists mainly to get one header right: `.wasm` must be served as
 * `application/wasm`, or the browser's streaming instantiation refuses it and
 * v86 has to fall back to a slower path. GitHub Pages gets this right; plain
 * `python3 -m http.server` is not reliable about it.
 *
 *   bun tools/serve.mjs        # then open http://127.0.0.1:8080/
 */

import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".iso": "application/octet-stream",
  ".img": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.includes("..")) return new Response("bad path", { status: 400 });
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(resolve(root, path.replace(/^\/+/, "")));
    // Logging the requests is the fastest way to spot a missing asset — but a
    // 404 has to be logged too, or the one request you need to see is the one
    // that stays quiet. It usually is the browser asking for a favicon.
    if (!(await file.exists())) {
      console.log(`  ${req.method} ${path} 404`);
      return new Response("not found", { status: 404 });
    }
    const ext = path.slice(path.lastIndexOf("."));
    console.log(`  ${req.method} ${path} ${file.size}b`);
    return new Response(file, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  },
});

console.log(`serving ${root}\n  http://127.0.0.1:${port}/`);
