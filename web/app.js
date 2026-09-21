/**
 * browser-linux — prototype
 *
 * Boots a stock 32-bit Linux in this tab with v86. There is no persistence yet:
 * reloading throws the machine away. That is the next milestone, and the hard one.
 *
 * Two deliberate choices are visible here. Nothing downloads until Start is
 * pressed, because a click is one thing a scraper will not do and 19 MB is real
 * bandwidth. And the machine's screen is *fitted*, not stretched, because this
 * is meant to be read.
 */

const V86 = globalThis.V86;

/**
 * The images are served from our own origin, and that is not a preference.
 *
 * v86's own host, i.copy.sh, answers **403** to any request carrying a referer
 * from another origin, so it cannot be hotlinked from a page we serve. The
 * obvious fallback did not work either: GitHub release assets redirect to
 * objects.githubusercontent.com, which sends no `Access-Control-Allow-Origin`,
 * so the fetch is blocked outright. Both were tested rather than assumed.
 *
 * Same-origin sidesteps CORS entirely. The images are deliberately not in git —
 * they are 29 MB of immutable binary that would bloat every clone. Local work
 * uses `tools/fetch-images.sh`; CI runs the same script before deploying.
 */
const IMAGES = [
  {
    id: "tinycore",
    label: "TinyCore 11 — desktop, 19 MB",
    url: "images/TinyCore-11.0.iso",
    device: "cdrom",
    memoryMb: 128,
  },
  {
    id: "shell",
    label: "Buildroot Linux — text shell, 7 MB",
    url: "images/linux4.iso",
    device: "cdrom",
    memoryMb: 64,
  },
];

const el = {
  frame: document.getElementById("frame"),
  image: document.getElementById("image"),
  start: document.getElementById("start"),
  restart: document.getElementById("restart"),
  fullscreen: document.getElementById("fullscreen"),
  scale: document.getElementById("scale"),
  state: document.getElementById("state"),
  stage: document.getElementById("stage"),
  screen: document.getElementById("screen_container"),
  canvas: document.querySelector("#screen_container canvas"),
  idle: document.getElementById("idle"),
  guest: document.getElementById("guest"),
  screenFit: document.getElementById("screen-fit"),
  log: document.getElementById("log"),
};

let booting = false;
// Whether the guest has ever taken over its own screen.
let drew = false;
let broken = false;
// The size the canvas has before anything boots. A canvas with no width or
// height attribute is 300×150 in every browser, and mistaking that for a video
// mode the guest chose is exactly how a green light ends up over a black screen.
let idleMode = "";

/**
 * Every state and footer change, in order, with the time it happened.
 *
 * The smoke test reads this back, which is how a question like "why did it say
 * running before anything was on screen?" gets answered by the machine instead
 * of by guessing. One array, and a whole class of confusion goes away.
 */
const history = [];
globalThis.__history = history;
const record = (what, text) =>
  history.push({ t: Math.round(performance.now()), what, text: String(text ?? "") });

function setState(text, kind = "") {
  el.state.textContent = text;
  el.state.className = `state ${kind}`;
  record("state", text);
}

function say(text, kind = "") {
  el.log.textContent = text ?? "";
  el.log.className = `mono ${kind}`;
  record("say", String(text ?? ""));
}

/**
 * The footer ticker, which is deliberately not part of the history. Download
 * progress arrives in hundreds of chunks; recording those would bury the
 * handful of lines that actually say what the machine did.
 */
function progress(text) {
  el.log.textContent = text ?? "";
  el.log.className = "mono";
}

function selectedImage() {
  return IMAGES.find((image) => image.id === el.image.value) ?? IMAGES[0];
}

/** Read the whole image ourselves so the wait is honest and failures are visible. */
async function fetchWithProgress(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  let shownAt = 0;
  const mb = (n) => (n / 1048576).toFixed(1);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    // Nobody can read the footer at chunk rate, and a 19 MB image arrives in
    // hundreds of pieces. Throttling keeps the DOM out of the download loop.
    const now = performance.now();
    if (now - shownAt < 100) continue;
    shownAt = now;
    progress(
      total
        ? `downloading ${mb(got)} / ${mb(total)} MB — ${Math.floor((got / total) * 100)}%`
        : `downloading ${mb(got)} MB`,
    );
  }
  const bytes = new Uint8Array(got);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function start() {
  if (booting) return;
  booting = true;
  const image = selectedImage();
  el.start.disabled = true;
  el.image.disabled = true;
  el.idle.hidden = true;
  setState("working", "busy");
  try {
    const buffer = await fetchWithProgress(image.url, image.label);
    say("starting emulator…");
    const emulator = new V86({
      wasm_path: "vendor/v86.wasm",
      memory_size: image.memoryMb * 1024 * 1024,
      // Headroom for a 1080p guest mode, which is what a crisp fullscreen needs.
      vga_memory_size: 16 * 1024 * 1024,
      // No sound, for now. v86 otherwise opens an audio device the moment it
      // starts, which Chrome (correctly) warns about under its autoplay policy.
      // We have no use for audio yet, and a quiet console is worth more.
      disable_speaker: true,
      screen_container: el.screen,
      bios: { url: "vendor/seabios.bin" },
      vga_bios: { url: "vendor/vgabios.bin" },
      [image.device]: { buffer },
      autostart: true,
    });
    emulator.add_listener("emulator-ready", () => {
      // The emulator being ready is not the guest being on screen. Measured on a
      // headless box, the guest draws nothing at all for ~95 seconds. A green
      // light over a black screen is a lie, so it stays amber and says what it
      // is actually waiting for.
      if (!drew) {
        setState("booting", "busy");
        say(`${image.label} — waiting for the guest to draw`);
      }
    });
    el.restart.disabled = false;
    el.fullscreen.disabled = false;
  } catch (err) {
    broken = true;
    setState("failed", "bad");
    say(err instanceof Error ? err.message : String(err), "bad");
    el.idle.hidden = false;
    el.start.disabled = false;
    el.image.disabled = false;
  } finally {
    booting = false;
  }
}

/* ---- fitting the guest's screen into this one --------------------------- */

function refit() {
  const canvas = el.canvas;
  if (!canvas?.width || !canvas?.height) return;
  const mode = el.scale.value;
  const boxW = el.stage.clientWidth;
  const boxH = el.stage.clientHeight;
  const raw = Math.min(boxW / canvas.width, boxH / canvas.height);
  const scale =
    mode === "fit" ? raw : Number(mode) <= raw ? Number(mode) : raw;
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
  el.screenFit.textContent = `${scale.toFixed(2)}×`;
}

/** The guest picks its own mode; when it changes, the fit has to follow. */
function watchGuestMode() {
  let last = "";
  setInterval(() => {
    const canvas = el.canvas;
    if (!canvas?.width) return;
    const mode = `${canvas.width}×${canvas.height}`;
    if (mode === last) return;
    last = mode;
    // Until the guest sets a mode, the canvas is just the size the element
    // happens to be. There is no guest yet, so saying "guest 300×150" is worse
    // than saying nothing.
    if (!idleMode || mode === idleMode) return;
    el.guest.textContent = `guest ${mode}`;
    refit();
    // The first mode change means the guest took over its own screen. That is
    // the moment worth calling "running" — not when the emulator object appeared.
    if (!drew && !broken) {
      drew = true;
      setState("running", "ok");
      say(`${selectedImage().label} — guest is drawing`);
    }
  }, 400);
}

/* ---- fullscreen and the keyboard --------------------------------------- */

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  try {
    await el.frame.requestFullscreen();
  } catch (err) {
    say(`fullscreen refused: ${err.message}`, "bad");
    return;
  }
  // Claim the keys the browser would otherwise keep for itself. Chrome only,
  // fullscreen only — a bonus when it works, never something we rely on.
  // Escape is deliberately NOT captured: the browser's own way out stays.
  try {
    await navigator.keyboard?.lock(["KeyW", "KeyT", "KeyN"]);
  } catch {
    /* not available here; the tab keeps its shortcuts, which is survivable */
  }
}

function wireChrome() {
  let idleTimer;
  const wake = () => {
    el.frame.classList.remove("idle-ui");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.fullscreenElement) el.frame.classList.add("idle-ui");
    }, 2500);
  };
  document.addEventListener("mousemove", wake, { passive: true });
  document.addEventListener("keydown", wake);
  window.addEventListener("fullscreenchange", () => {
    wake();
    if (!document.fullscreenElement) navigator.keyboard?.unlock?.();
    setTimeout(refit, 100);
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    // Resizing is a storm; let it settle before touching the guest's screen.
    resizeTimer = setTimeout(refit, 200);
  });
}

function init() {
  for (const image of IMAGES) {
    const option = document.createElement("option");
    option.value = image.id;
    option.textContent = image.label;
    el.image.append(option);
  }
  if (!V86) {
    setState("failed", "bad");
    say("vendor/libv86.js did not load", "bad");
    return;
  }
  el.start.addEventListener("click", start);
  el.restart.addEventListener("click", () => location.reload());
  el.fullscreen.addEventListener("click", toggleFullscreen);
  el.scale.addEventListener("change", refit);
  wireChrome();
  idleMode = el.canvas ? `${el.canvas.width}×${el.canvas.height}` : "";
  watchGuestMode();
  setState("idle");
}

init();
