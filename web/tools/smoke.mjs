#!/usr/bin/env bun
/**
 * Drive the prototype in headless Chrome and bring back evidence.
 *
 * Booting a VM is not something a screenshot alone can prove, so this collects
 * both: the page's own state line, the console (a quiet console is the point),
 * and a PNG of whatever is on the guest's screen.
 *
 *   bun tools/smoke.mjs [url] [waitMs] [out.png]
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2] ?? "http://127.0.0.1:8080/";
const waitMs = Number(process.argv[3] ?? 45000);
const outPng = process.argv[4] ?? "smoke.png";
const port = Number(process.env.CDP_PORT ?? 9333);
const chromePath = process.env.CHROME ?? "google-chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "bl-chrome-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1600,900",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let chromeNoise = "";
chrome.stderr.on("data", (chunk) => {
  chromeNoise += chunk.toString();
});

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("chrome never exposed a page target");
}

/**
 * The console is collected to hear from the *app*, so complaints this harness
 * causes itself are dropped. Reading the canvas back to build the boot timeline
 * makes Chrome grumble about readback performance; that is ours, not the guest's.
 */
const SELF_INFLICTED = [/willReadFrequently/];
const ws = new WebSocket(await debuggerUrl());
let seq = 0;
const pending = new Map();
const console_ = [];
const note = (line) => {
  if (!SELF_INFLICTED.some((re) => re.test(line))) console_.push(line);
};

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    note(
      `${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "?").join(" ")}`,
    );
  }
  if (msg.method === "Runtime.exceptionThrown") {
    note(`exception: ${msg.params.exceptionDetails.exception?.description ?? "?"}`);
  }
  if (msg.method === "Log.entryAdded" && msg.params.entry.level !== "verbose") {
    note(`${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("could not attach to chrome")));
});

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  return res.result?.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Page.navigate", { url: target });
await sleep(2500);

const started = await evaluate(`(() => {
  const b = document.getElementById("start");
  if (!b) return "no start button";
  b.click();
  return "clicked";
})()`);

/**
 * Poll while it boots, because "how long until I see something" is the number
 * this project lives or dies on — a machine that feels fast while being slow.
 * Only changes are kept, so the timeline reads as the handful of moments that
 * actually happened rather than a wall of identical samples.
 */
const sampler = `(() => {
  const c = document.querySelector("#screen_container canvas");
  if (!c || !c.width) return null;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  let d;
  try {
    d = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch (err) {
    return null;
  }
  const seen = new Set();
  let lit = 0, n = 0;
  for (let y = 0; y < c.height; y += 8) {
    for (let x = 0; x < c.width; x += 8) {
      const i = (y * c.width + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      if (r + g + b > 48) lit++;
      n++;
    }
  }
  return { mode: c.width + "x" + c.height, colours: seen.size, litPercent: Math.round((lit / n) * 100) };
})()`;

const stepMs = 5000;
const timeline = [];
let previous = null;
for (let waited = 0; waited < waitMs; waited += stepMs) {
  await sleep(Math.min(stepMs, waitMs - waited));
  const sample = await evaluate(sampler);
  const key = JSON.stringify(sample);
  if (key === previous) continue;
  previous = key;
  timeline.push({ seconds: Math.round((waited + stepMs) / 1000), ...(sample ?? {}) });
}

const state = await evaluate(`(() => {
  const c = document.querySelector("#screen_container canvas");
  return {
    state: document.getElementById("state")?.textContent,
    log: document.getElementById("log")?.textContent,
    guest: document.getElementById("guest")?.textContent,
    fitted: document.getElementById("screen-fit")?.textContent,
    canvas: c ? [c.width, c.height] : null,
  };
})()`);

/** What the page said about itself, in order — the answer to "why did it say
 * that, then?" without a second run and a guess. */
const history = await evaluate("globalThis.__history ?? []");

/**
 * The screen is read back as numbers, not left to a screenshot nobody opens.
 * A blank guest is the failure that looks most like success once it is a PNG:
 * one colour and 0% lit means nothing ever reached the video mode.
 */
const screenStats = timeline.at(-1) ?? null;

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) {
  await Bun.write(outPng, Buffer.from(shot.result.data, "base64"));
}

console.log(
  JSON.stringify(
    {
      target,
      started,
      waitMs,
      ...state,
      screen: screenStats,
      timeline,
      history,
      console: console_,
      png: outPng,
    },
    null,
    2,
  ),
);

ws.close();
chrome.kill("SIGKILL");
if (!shot.result?.data) {
  console.error("no screenshot returned");
  console.error(chromeNoise.slice(-800));
  process.exit(1);
}
