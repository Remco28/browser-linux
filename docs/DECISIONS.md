# Decisions

Append-only, newest last. Each entry records **what we decided and why**, so a later reader can tell a deliberate choice from an accident. The architecture lives in [PLAN.md](PLAN.md); this is the intent behind it.

---

## 2026-09-21 — first design conversation

### Who it is for

Me and my children. Anyone else can use it, but it is not built for the average person to approve of.

**It is an opinionated OS.** Our defaults, our look, our choices. When two options are equal, we take ours rather than the safe one. "Would someone complain about this?" is not a question we ask.

### What it is for

- **A disposable Linux to tinker with and learn on.** Break it freely; importing a container puts it back. This is the single best reason to run an OS in a browser.
- **A lego set.** Change anything, including the things you would never touch on a real desktop — up to and including abandoning the conventional desktop completely. The window manager is just a package we installed.
- **Small personal tools.** The messy-CSV-into-readable-HTML example: shell, `awk`, `python`, `gcc` are all at home here. Fencing tournaments, credit-card exports, whatever needs parsing.
- **Not** a workstation, not a daily driver, not a place to run heavy software.

### Agents configure the distro, but they do not run inside it

The wish was a coding agent living *in* the distro, doing most of its configuration. That version does not work, and it is worth writing down why so it is not re-attempted:

- Modern agents are built on Node or Bun, and neither has 32-bit builds. Node dropped 32-bit Linux in 2017, Electron in 2019, and the wider ecosystem is following. A 32-bit guest cannot run them.
- Configuring an OS is **build-time** work anyway. Recipes, package lists, config files, desktop setup.

So the decision:

- Agents edit the **recipe** on a real machine; the browser OS is the output they build. Same shape as every other repo here — agents work *on* it, not inside it.
- To touch a **running** distro, the agent reaches in **from outside**: SSH over Tailscale, or the shared folder. It is faster there than it would be inside, and it can also edit the recipe in the same breath.
- A small **Python or Go** client inside the guest is possible if a satellite agent is ever wanted — both compile for 32-bit — but it is not the plan.

The loop that results: **edit the recipe → build → boot it in the browser → fold any live tweaks back into the recipe.**

### Networking: Tailscale, and no server of ours

- **Tailscale is the network story.** It works in userspace, which is exactly what a VM with no real network card needs, and it gives the distro its own name on our private network.
- An **exit node** at home gives the guest real internet through our own connection.
- The guest is therefore a **client** to the open internet and a **device** on the tailnet. It never serves the open internet. Nothing of ours has to run on a server, which is how the project stays static.
- **A service in the guest, reached from inside the guest: yes.** Plain loopback. No caveats, nothing to build.
- **A service in the guest, reached from elsewhere on the tailnet: yes.** Phone, home server, another laptop.
- **Reached from the host browser: no.** The VM is not a machine on the host's network — that port is inside an emulator. A browser *inside* the distro is the intended answer, and it is enough.
- **Files move in and out through the shared folder**, not through the network.

### The container can be the whole OS

A realization worth keeping: the export does not have to be a *diff* against a base image. It can carry the entire disk.

- A whole-OS container is genuinely self-contained. It does not care what the site is serving, so an old container still boots after we move the base on, and a stranger's visit costs the site almost nothing.
- The public site shrinks to a bootloader — a few hundred KB — with the megabytes living in the user's own Drive.
- The cost is size: a few hundred MB to carry instead of a few MB, and a slower import.

**We build both and compare by using them.** One file format, a `mode` field in the manifest, and export offers a choice. The diff stays the default until experience says otherwise.

### Hosting: GitHub Pages

Stated by the human. It fits: the app is entirely static, so there is nothing for a server to do, and it needs no extra vendor or account.

The four limits that shape the layout, and the reasons the disk image is not committed:

- 1 GB recommended published site, 100 GB/month soft bandwidth, 10 builds/hour soft.
- **100 MB hard limit per file in git**, and LFS pointers are not served. The image is fetched into the deployed artifact instead, so it stays out of git history. **Not** a Release asset: measured, those send no `Access-Control-Allow-Origin`, so a browser fetch of one is blocked outright.
- **No custom response headers**, so no `COOP`/`COEP`, so no `SharedArrayBuffer` and no threads. Harmless while v86 is single-threaded; it is the one thing that would force a move to Cloudflare Pages or Vercel.
- **`Cache-Control: max-age=600`** on everything Pages serves, so a large image would be re-fetched after ten minutes. This is why the image is cached in **browser storage keyed by content hash** rather than left to HTTP caching — the storage design already removes that dependency.

### Keeping the site from being a target

Public Pages is the only option on a free plan, so the site cannot be hidden — only made uninteresting to strangers. The instinct, and it is the right one: gate the boot behind a click, keep search engines out.

- The limit is **soft**. Exceeding 100 GB/month gets the site warned or throttled, never billed, so this protects availability rather than money.
- The real traffic is **crawlers and scrapers**, not people. They refetch large files forever, ignore the rules polite crawlers follow — and they do not click buttons, which is exactly why a click-gate works.
- The strongest lever is a **small image**, which is already the design direction.
- Push the heavy bytes off the Pages meter entirely — object storage with CORS, such as Cloudflare R2 (free egress), once the image outgrows Pages. A Release asset does **not** serve this purpose: it fails CORS from a browser.
- Be honest about what this is: obscurity, not security. The image URL is in the shipped JavaScript. It stops accidents and casual visitors, not a determined person.

### It has to feel fast

- **Choose smaller software; do not write cleverer code.** Inside the guest, an Electron-shaped anything is out and a tiny window manager is in. Lean and old-school beats optimised and modern, and it is more fun.
- **Our own code is not emulated.** The page, the emulator wiring and the storage layer run natively, at full speed. Micro-optimising them buys little. What matters is **bytes and I/O**: how fast the image arrives, how fast browser storage answers, and not holding memory the VM needs.
- **"Feels fast" is a latency and perception problem, not a throughput problem.** Never show a blank screen. Cache what can be cached. Make the *second* boot the one that feels instant. Lean on **resume**, which can feel faster than a real machine's cold boot.
- Guest RAM and screen resolution are dials worth keeping modest. A weaker host machine is honestly slower, and we should say so rather than hide it.
- **Measured, from the prototype:** emulator up at 2.6 s, first pixels at **98 s** on a headless box booting TinyCore. The guest is blank until it sets a video mode, then draws everything at once. So the state line says "waiting for the guest to draw" rather than "running" — an optimistic green light over a black screen is precisely the dishonesty this project should not ship.

### Fullscreen and the keyboard are first-class

- Browser fullscreen on the canvas works, and it is how this is meant to be used.
- Two things to build for, or it will feel like a website instead of an OS: tell the **guest** to change its resolution to match, so the screen is crisp rather than stretched; and **capture the keyboard** (Keyboard Lock), because otherwise the browser keeps Ctrl+W, Ctrl+T and friends for itself.
- **Match, never stretch.** The guest is told to change mode so pixels stay 1:1, with whole-number scaling as the fallback when an exact fit is impossible. Upscaling the canvas blurs text, and this is the machine's only screen.
- **High-DPI means emulate fewer pixels, not more.** A small guest mode scaled up on a 4K display is sharper *and* considerably faster than chasing `devicePixelRatio`.
- **Remember comfort, not a resolution.** Which modes exist depends on the machine in front of you, so what travels is "I like text this big", and the mode is derived from the screen.
- The page's own controls — export, import, settings — must stay reachable while fullscreen, and the app needs its own way out once the keyboard is captured.

### The pointer has to stay where you aimed it

Found by using it, and it was our bug rather than the emulator's.

- **v86 sends mouse movement as raw host-pixel deltas and never divides by the display scale.** So a screen shown at anything other than 1:1 moves the guest's cursor at the wrong rate: shrunk, it lags your hand; enlarged, it runs ahead and reaches the screen's edges before your hand does — which is exactly how controls at the edges become unclickable. The gap compounds with every movement.
- **Therefore whole-number scaling is a hard requirement, not a nicety.** A fractional "fit" was the default, and it was the whole problem.
- **Two honest answers**: show the guest at 1:1, where the pointer is exact; or **capture the pointer** (`lock_mouse`), which hides the host cursor and asks for unadjusted movement, so there is no second cursor left to disagree with.
- **A guest that enables the VMware absolute pointer escapes the constraint entirely.** v86 sends absolute coordinates too, but only uses them when the guest opts in, and stock TinyCore's X has no vmmouse driver, so it never does. This is a reason to want a known-good mouse driver in *our* image: with it, scaling stops being a correctness problem.
- **Do not hide the drift.** When no whole number fits, the scale is labelled "pointer drifts" and capture is one click away. Silently showing a screen whose pointer is wrong is the worst available option.
- **The lasting fix is a guest mode that fits the screen** — a small menu of resolutions in the image, so 1:1 is usually available. That is distro work (M7), not page work.
- **Measured:** a 1600×680 stage cannot hold the 1024×768 guest at a whole number, so it fits at 0.885× and drifts; a 1500×930 stage gives 1× and an exact pointer.

### Text has to be readable

- **Two problems wearing one coat.** The mush is partly ours: a fractional scale resamples every glyph. Whole-number scaling with nearest-neighbour keeps pixels square and strokes even, so 2× is not just bigger than a 1.4× fit, it is sharper.
- **The rest is the image's problem.** Stock TinyCore paints 6×13 bitmap fonts with no antialiasing, and nothing page-side makes that pleasant. Our own image ships a real font stack — DejaVu, fontconfig, hinted rendering — and that is the actual fix.
- **Integer *upscaling* is the cheap trick that works today.** A small guest mode shown at 2× makes bitmap text larger and still perfectly crisp, which is the closest thing to a font fix available before we build our own image.
