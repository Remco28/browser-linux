#!/usr/bin/env bun
/**
 * Drive the prototype in headless Chrome and bring back evidence.
 *
 * Booting a VM is not something a screenshot alone can prove, so this collects
 * both: the page's own state line, the console (a quiet console is the point),
 * and a PNG of whatever is on the guest's screen.
 *
 *   bun tools/smoke.mjs [url] [waitMs] [out.png] [imageId]
 *
 * The last argument picks which image to boot ("tinycore", "shell"), which is
 * how the second entry in the picker gets tested at all. `SMOKE_WINDOW=1500,1100`
 * sets the window, which is how the fitting rules get tested against a screen
 * tall enough to show the guest at 1x — the case that keeps the pointer exact.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2] ?? "http://127.0.0.1:8080/";
const waitMs = Number(process.argv[3] ?? 45000);
const outPng = process.argv[4] ?? "smoke.png";
const imageId = process.argv[5] ?? "";
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
    `--window-size=${process.env.SMOKE_WINDOW ?? "1600,900"}`,
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
  // A probe that throws returns undefined, which is indistinguishable from a
  // probe that legitimately found nothing. Say so out loud instead: a silently
  // empty timeline is how a broken measurement passes for a quiet machine.
  if (res.result?.exceptionDetails) {
    note(`probe threw: ${res.result.exceptionDetails.exception?.description ?? "?"}`);
  }
  return res.result?.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Page.navigate", { url: target });
await sleep(2500);

const started = await evaluate(`(() => {
  const pick = ${JSON.stringify(imageId)};
  if (pick) {
    const select = document.getElementById("image");
    if (!select) return "no image picker";
    if (![...select.options].some((o) => o.value === pick)) return "no such image: " + pick;
    select.value = pick;
  }
  const b = document.getElementById("start");
  if (!b) return "no start button";
  b.click();
  return "clicked";
})()`);

/**
 * Read what the guest is showing, from inside the page.
 *
 * Written as a real function and then stringified, rather than typed straight
 * into a template literal, and that is not a style choice. A probe travelling
 * inside a template literal has every backslash resolved on the way through: a
 * newline escape becomes a real newline before the page parses it, the page then
 * reports a syntax error, the probe returns undefined, and an empty timeline
 * looks exactly like a quiet machine. That is precisely what happened here.
 *
 * Polling, meanwhile, because "how long until I see something" is the number
 * this project lives or dies on: a machine that feels fast while being slow.
 * Only changes are kept, so the timeline reads as the handful of moments that
 * actually happened rather than a wall of identical samples.
 */
function readScreen() {
  const c = document.querySelector("#screen_container canvas");
  const box = document.querySelector("#screen_container > div");
  // v86 reports itself in two places: DOS-style text goes into a div, graphics
  // go onto the canvas. A shell-only image never touches the canvas, so reading
  // only the canvas measures half the screen and calls a working shell blank.
  const lines = (box ? box.innerText : "").split("\n");
  const text = lines.map((s) => s.trim()).filter(Boolean).slice(-2).join(" / ").slice(0, 160);
  const blank = { mode: null, colours: 0, litPercent: 0, text };
  if (!c || !c.width) return blank;
  const ctx = c.getContext("2d");
  if (!ctx) return blank;
  let d;
  try {
    d = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch (err) {
    return blank;
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
  return { mode: c.width + "x" + c.height, colours: seen.size, litPercent: Math.round((lit / n) * 100), text };
}

const sampler = `(${readScreen.toString()})()`;

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
    image: document.getElementById("image")?.value,
    guest: document.getElementById("guest")?.textContent,
    fitted: document.getElementById("screen-fit")?.textContent,
    canvas: c ? [c.width, c.height] : null,
  };
})()`);

/**
 * The geometry the pointer depends on, measured rather than assumed.
 *
 * v86 maps mouse movement against the element it was handed, so that element must
 * be exactly the size of the screen being shown — and the scale must be 1 unless
 * the pointer is captured, because v86 sends movement as raw host-pixel deltas
 * and never divides by the display scale. Both were wrong at once, and the
 * symptom was a guest cursor that drifted away from the host's: something no
 * screenshot shows and no amount of looking at the page reveals. So it is a
 * number, checked every run.
 */
const geometry = await evaluate(`(() => {
  const c = document.querySelector("#screen_container canvas");
  const box = document.getElementById("screen_container");
  const stage = document.getElementById("stage");
  if (!c || !box || !stage) return null;
  const cr = c.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const scale = cr.width / c.width;
  const captured = Boolean(document.pointerLockElement);
  const fits = Math.abs(br.width - cr.width) <= 1 && Math.abs(br.height - cr.height) <= 1;
  const room = Math.min(sr.width / c.width, sr.height / c.height);
  const whole = Math.max(1, Math.floor(room));
  let verdict;
  if (!fits) verdict = "container is not the size of the screen v86 measures";
  else if (captured) verdict = "captured: relative movement, no reference cursor to drift from";
  else if (scale === 1) verdict = "exact";
  else verdict = "DRIFTS at " + scale.toFixed(3) + "x: no whole number fits, since " +
    Math.round(sr.width) + "x" + Math.round(sr.height) + " cannot hold " +
    c.width + "x" + c.height + " (only " + room.toFixed(2) + "x of it)";
  return {
    guest: c.width + "x" + c.height,
    shown: Math.round(cr.width) + "x" + Math.round(cr.height),
    container: Math.round(br.width) + "x" + Math.round(br.height),
    stage: Math.round(sr.width) + "x" + Math.round(sr.height),
    wholeThatFits: whole,
    scale: Number(scale.toFixed(3)),
    captured: captured,
    verdict: verdict,
  };
})()`);

/**
 * Does capture actually work? It is the fix for the drifting pointer, so it is
 * worth knowing rather than hoping. A programmatic click would not do — pointer
 * lock needs real user activation — so this dispatches a genuine input event at
 * the button.
 */
const captureTarget = await evaluate(`(() => {
  const b = document.getElementById("capture");
  if (!b || b.disabled) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
let captureWorked = null;
if (captureTarget) {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: captureTarget.x, y: captureTarget.y, button: "left", clickCount: 1, buttons: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: captureTarget.x, y: captureTarget.y, button: "left", clickCount: 1, buttons: 0,
  });
  await sleep(700);
  captureWorked = await evaluate("Boolean(document.pointerLockElement)");
}

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
      geometry,
      captureWorked,
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
