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
  capture: document.getElementById("capture"),
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
// The running emulator, once there is one, and whether the pointer is captured.
let emulator = null;
let captured = false;

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
    emulator = new V86({
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
    el.capture.disabled = false;
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

/**
 * Fit the guest's screen into ours — with whole numbers, because the mouse
 * depends on it.
 *
 * This is not fastidiousness. v86 sends pointer movement as raw host-pixel deltas
 * and never divides by the display scale, so a screen shown at 0.89x moves the
 * guest's cursor 0.89x as far as your hand for every pixel you move: the gap
 * compounds with every movement until clicks land nowhere near where you aimed.
 * Nothing but scale 1 keeps the two cursors together, because the guest has to
 * opt into the absolute pointer that would fix it properly — and TinyCore's X has
 * no vmmouse driver, so it never does. Capturing the mouse is the other honest
 * answer: with the host cursor hidden there is nothing to line up.
 *
 * Whole numbers also keep text legible, which is the other reason to care.
 * Fractional scaling resamples every glyph; an integer scale keeps pixels square,
 * so 2x is not merely bigger than a 1.4x fit, it is sharper.
 */
function refit() {
  const canvas = el.canvas;
  if (!canvas?.width || !canvas?.height) return;
  // Before the guest sets a mode this is the browser's default canvas, and sizing
  // it would just stretch a blank rectangle behind the curtain.
  if (`${canvas.width}×${canvas.height}` === idleMode) return;

  const boxW = el.stage.clientWidth;
  const boxH = el.stage.clientHeight;
  const roomy = Math.min(boxW / canvas.width, boxH / canvas.height);
  const whole = Math.max(1, Math.floor(roomy));

  const mode = el.scale.value;
  let scale;
  let note = "";
  if (mode === "fill") {
    scale = roomy;
  } else if (mode === "auto") {
    // Below 1 no whole number fits, and a fit that overflows the stage is worse
    // than a fractional one: you cannot see the bottom of a screen you cannot
    // scroll to. Drifting pointers beat a missing half.
    scale = roomy >= 1 ? whole : roomy;
  } else {
    scale = Number(mode);
    if (scale > roomy) {
      note = `${scale}× will not fit`;
      scale = roomy >= 1 ? whole : roomy;
    }
  }

  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
  // Nearest-neighbour is the sharp choice when enlarging by a whole number, and
  // the wrong choice when shrinking: it drops every eleventh row and leaves small
  // text jagged, where smooth scaling is merely soft.
  const wholePixels = Number.isInteger(scale) && scale > 1;
  canvas.style.imageRendering = wholePixels ? "pixelated" : "auto";

  const bits = [Number.isInteger(scale) ? `${scale}×` : `${scale.toFixed(2)}×`];
  if (note) bits.push(note);
  if (captured) bits.push("mouse captured");
  else bits.push(scale === 1 ? "pointer exact" : "pointer drifts");
  el.screenFit.textContent = bits.join(" · ");
  // What the pointer maths depends on: v86 measures the element we hand it, so it
  // has to be exactly the size of the screen we are showing.
  record("fit", el.screenFit.textContent);
}

/* ---- the mouse ---------------------------------------------------------- */

/**
 * Capture the pointer, so the host cursor stops competing with the guest's.
 *
 * v86 can lock the mouse: the host cursor disappears and the browser is asked for
 * unadjusted movement, so no pointer acceleration sits between your hand and the
 * guest. That is what makes a scaled screen clickable, and what a browser machine
 * needs to feel like a machine at all. Escape releases it — and the button says so,
 * because a hidden pointer with no visible way back is a trap.
 */
async function toggleCapture() {
  if (document.pointerLockElement) {
    document.exitPointerLock();
    return;
  }
  if (!emulator) return;
  try {
    await emulator.lock_mouse();
  } catch (err) {
    // Whether it worked is decided by the browser, so report the failure rather
    // than showing a state we are not in.
    say(`mouse capture refused: ${err?.message ?? err}`, "bad");
  }
}

/** The label reports what actually happened, never what we asked for. */
function syncCapture() {
  captured = Boolean(document.pointerLockElement);
  el.frame.classList.toggle("captured", captured);
  el.capture.textContent = captured ? "Release mouse (Esc)" : "Capture mouse";
  refit();
}

/**
 * Watch what the guest is putting on screen — and the fit has to follow it.
 *
 * A guest says something in one of two ways: pixels on the canvas, when it sets
 * a video mode, or characters in the text layer, which v86 keeps in a div for
 * DOS-style modes. Both count as drawing. Watching only the canvas is the bug
 * this used to have: a shell-only image never sets a video mode, so a working
 * prompt sat there while the interface insisted nothing had happened yet.
 */
function watchGuestMode() {
  let lastMode = "";
  let lastText = "";
  setInterval(() => {
    const canvas = el.canvas;
    if (!canvas?.width) return;
    const mode = `${canvas.width}×${canvas.height}`;
    const text = (el.screen.querySelector("div")?.textContent ?? "").trim();
    if (mode === lastMode && text === lastText) return;
    lastMode = mode;
    lastText = text;
    // Until the guest sets a mode, the canvas is just the size the element
    // happens to be. There is no guest yet, so saying "guest 300×150" is worse
    // than saying nothing.
    if (mode !== idleMode) {
      el.guest.textContent = `guest ${mode}`;
      refit();
    }
    // Either kind of output means there is something on screen at last, which is
    // the moment worth calling "running" — not when the emulator object appeared.
    if (!drew && !broken && (mode !== idleMode || text)) {
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
    if (!document.fullscreenElement) {
      navigator.keyboard?.unlock?.();
    } else {
      // Fullscreen is a request to use this as a machine, and a machine whose
      // pointer cannot be trusted is not usable. Capture on the way in.
      emulator?.lock_mouse().catch(() => {});
    }
    setTimeout(refit, 100);
  });
  document.addEventListener("pointerlockchange", syncCapture);

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
  el.capture.addEventListener("click", toggleCapture);
  el.scale.addEventListener("change", refit);
  wireChrome();
  idleMode = el.canvas ? `${el.canvas.width}×${el.canvas.height}` : "";
  watchGuestMode();
  setState("idle");
}

init();
