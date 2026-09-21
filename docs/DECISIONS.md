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

### Hosting: GitHub Pages

Stated by the human. It fits: the app is entirely static, so there is nothing for a server to do, and it needs no extra vendor or account.

The four limits that shape the layout, and the reasons the disk image is not committed:

- 1 GB recommended published site, 100 GB/month soft bandwidth, 10 builds/hour soft.
- **100 MB hard limit per file in git**, and LFS pointers are not served. The image is published as a **Release asset** instead — CDN-backed, CORS-enabled, out of git history.
- **No custom response headers**, so no `COOP`/`COEP`, so no `SharedArrayBuffer` and no threads. Harmless while v86 is single-threaded; it is the one thing that would force a move to Cloudflare Pages or Vercel.
- **`Cache-Control: max-age=600`** on everything Pages serves, so a large image would be re-fetched after ten minutes. This is why the image is cached in **browser storage keyed by content hash** rather than left to HTTP caching — the storage design already removes that dependency.

### It has to feel fast

- **Choose smaller software; do not write cleverer code.** Inside the guest, an Electron-shaped anything is out and a tiny window manager is in. Lean and old-school beats optimised and modern, and it is more fun.
- **Our own code is not emulated.** The page, the emulator wiring and the storage layer run natively, at full speed. Micro-optimising them buys little. What matters is **bytes and I/O**: how fast the image arrives, how fast browser storage answers, and not holding memory the VM needs.
- **"Feels fast" is a latency and perception problem, not a throughput problem.** Never show a blank screen. Cache what can be cached. Make the *second* boot the one that feels instant. Lean on **resume**, which can feel faster than a real machine's cold boot.
- Guest RAM and screen resolution are dials worth keeping modest. A weaker host machine is honestly slower, and we should say so rather than hide it.

### Fullscreen and the keyboard are first-class

- Browser fullscreen on the canvas works, and it is how this is meant to be used.
- Two things to build for, or it will feel like a website instead of an OS: tell the **guest** to change its resolution to match, so the screen is crisp rather than stretched; and **capture the keyboard** (Keyboard Lock), because otherwise the browser keeps Ctrl+W, Ctrl+T and friends for itself.
- The page's own controls — export, import, settings — must stay reachable while fullscreen.
