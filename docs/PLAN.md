# browser-linux — plan

A custom, lightweight Linux distribution that boots inside a web browser, keeps all of its state in browser storage, and can be exported to a single file you carry around.

This document is the working plan. Decisions are recorded with the reason, so a later reader can tell a deliberate choice from an accident. Section 8 lists what is still undecided.

---

## 1. The goal

A real Linux, small enough to be pleasant, with a graphical desktop, that boots in a tab on any modern browser. Your files, settings and installed packages persist between visits. You can export the whole thing to one file and restore it on a different computer.

**Definition of done for v1** — the five steps in the README work end to end, on two different machines, with no server ever seeing user data:

1. open a URL, get a desktop;
2. change something (a file, a setting, an installed package);
3. reload, and it is still there;
4. export one file;
5. on another machine, import that file, and it is *the same system* — not a fresh one.

### Non-goals

- 64-bit binaries. (v86 emulates 32-bit x86 only — see §3.)
- Any server-side compute, account, or sync service.
- Performance that competes with a native machine.
- Running on your main machine as a daily driver.

---

## 2. The actual hard problem: state

Booting Linux in a browser is a solved problem — several projects do it. The part that is *not* solved by copying an existing demo is **state**:

- Browser storage is not a disk. It is a quota that the browser may evict, behind an API that is asynchronous and slow compared to a block device. `localStorage` holds a few megabytes and is unusable for this; the real primitive is **IndexedDB**, plus `navigator.storage.persist()` so the origin is not evicted out from under the user.
- A real disk image is tens to hundreds of megabytes, and rewriting it in full every time a file changes is not viable.
- "Export and import" has two different meanings, and they need different machinery:
  - **Boot my OS** — restore the disk. The machine starts fresh, the filesystem is yours again.
  - **Resume my session** — restore the disk *and* RAM and CPU state, i.e. the system is exactly as you left it, mid-command.

Everything else in this plan follows from taking those seriously.

---

## 3. Decision: the emulator

Two credible options. Both are x86-in-WebAssembly; they are not the same kind of thing.

| | **v86** | **CheerpX** (WebVM) |
|---|---|---|
| Approach | emulates x86 **hardware** (CPU, disk, VGA, PS/2, NIC) | emulates Linux **syscalls**, x86→wasm JIT for user-mode code |
| Speed | slower; a JIT for translated machine code | considerably faster; runs Node.js |
| Disk | your own image, fetched or plugged in | virtual block device, **streamed from the server as needed** |
| Graphics | VGA with SVGA + **Bochs VBE** → a real X desktop draws into a canvas | no emulated VGA; a desktop needs another layer (WebVM 2.0 ships one) |
| State save/restore | **first-class API** (`save_state` / `restore_state`, zstd-compressed) | persistence via its block device; not a hardware snapshot |
| Licence | **Simplified BSD** — ship it, bundle it, fork it | commercial product; free for personal projects, most non-commercial use and evaluations |
| Bitness | 32-bit only, no multicore | 32-bit x86 user-mode |

**Verdict: v86**, for three reasons that all point the same way for *this* project.

1. **Persistence is the product**, and v86 treats the machine as the thing you serialize. Save/restore is a documented API, not something we would have to invent.
2. **The GUI falls out for free.** Bochs VBE gives the guest a real framebuffer, so X draws into the canvas. With CheerpX there is no VGA hardware, so a desktop means building the extra layer WebVM built.
3. **We are distributing a distribution.** BSD-2 means the image and emulator bundle can be handed out without a licensing conversation.

The cost is performance: v86 is the slower of the two, and its CPU omits 64-bit extensions, multicore, and some protected-mode and FPU details. For a small distro running a window manager and a terminal, that is an acceptable trade — and CheerpX remains a genuine escape hatch if speed ever becomes the binding constraint, at the price of the licence and a rebuilt GUI path.

---

## 4. Decision: the base distribution

Constraints: 32-bit x86, small, boots under v86, has a GUI, and has a package manager so "install something and keep it" is meaningful.

| Option | Size | Notes |
|---|---|---|
| **Alpine Linux (x86)** | ~50 MB | musl, active, real `apk` packages, 32-bit supported. v86 documents an Alpine guest setup and ships a Dockerfile to build an image, so the build is reproducible. Heavier than the others once X is in. |
| TinyCore | ~20 MB | Already has a small GUI and a persistence model of its own (extensions + backup), which may fight ours. Tiny repositories. |
| Buildroot | ~5–30 MB | The real "custom distribution": you choose the kernel, init, libc and every package. Reproducible and tiny, but you build the userland yourself and iteration is slow. |
| Debian + XFCE | 300 MB+ | Documented for v86, but not lightweight. |

**Verdict: start on Alpine x86, keep Buildroot as the destination.** Alpine gets us to a shell, a package manager and a desktop fastest, from a recipe we can keep in the repo. Once the product works, replacing the base with a Buildroot image is a swap of an artifact, not a redesign — that is the point of keeping the base immutable and content-hashed (§5).

The word "custom" in "custom distribution" is therefore a *staging* decision, not a settled one: today it means our chosen package set, branding and defaults on top of Alpine; later it can mean a Buildroot image we build end to end. See open question Q2.

---

## 5. Decision: storage and the container

**The base image is immutable. Everything the user does is an overlay.**

The base disk image is versioned, content-hashed, and never written to. All writes land in a sparse **overlay** of block-granularity changes, kept in IndexedDB. A boot is: read the base, apply the overlay. This is the same idea as a container image layer, and it buys three things:

- **Export stays small.** Only dirty blocks travel, not a 200 MB disk.
- **Upgrades stay possible.** New base, same overlay, when the change is compatible.
- **Corruption stays contained** and detectable — a base that no longer matches its hash is caught, not silently booted.

### The container file

One file, and it is a **zip**, because the user will end up looking inside it:

```
manifest.json     format version, base image id + hash, created-at, counts, checksums
blocks.bin        the overlay: sparse block map + changed block data
config.json       settings, desktop/window state, first-run answers
state.zst         optional: full machine state from v86 save_state (mode "resume")
```

Rules that make it safe to import:

- **Versioned and hash-checked.** A container made against base `v3` says so. Importing it against `v5` either migrates or refuses with a clear message — it never half-applies.
- **Two import modes**, chosen by the user, because they mean different things: `boot` (disk only, starts clean, everything intact) and `resume` (disk + RAM/CPU, exactly as left). `state.zst` is optional and large — RAM-sized — so it is not written into every export by default.
- **Import is a merge, not an overwrite.** The container is a diff against a known base, so importing onto a machine with local changes is a decision point, not a silent clobber.

What we deliberately do **not** do: sync. A container is a fork of your OS. Two machines that both import it and both change it will diverge, and resolving that needs a merge story and an identity layer that this project does not want.

### Browser storage, honestly

- `navigator.storage.persist()` on first run, and surface *whether it was granted* — without it, the OS can be evicted and the user must be told, not surprised.
- `navigator.storage.estimate()` in a settings panel: bytes used, bytes available.
- Writes are block-level and debounced; the overlay is flushed on a timer and on `visibilitychange`.
- IndexedDB is asynchronous and slower than a block device. The first version can keep block reads in memory and only persist changes; measure before optimising.

---

## 6. Where it runs

The app is fully static: HTML, JS, a wasm emulator bundle, and one large binary (the disk image). No backend.

| Piece | Where | Why |
|---|---|---|
| Page + emulator bundle | **GitHub Pages** | Same repo, free, custom domain, no extra account or vendor. |
| Base disk image | **GitHub Releases** asset | Repos and Pages have per-file limits (~100 MB), Pages will not serve LFS pointers, and release assets are CDN-backed with CORS. Keeps a big binary out of git history. |
| The user's container | their own storage | Never ours. Exported to Downloads, carried by the user. |

Fallbacks if the image grows past what Releases will serve, or if custom response headers are needed: **Cloudflare Pages** or **Vercel** (a static host with a strong CDN — this is also what the Gravity index recommends), with the image moved to object storage (R2/S3/B2). Custom headers matter only if we ever want `SharedArrayBuffer`/threads, which needs `COOP` + `COEP` and which GitHub Pages cannot set.

---

## 7. Constraints and gotchas to design around

- **32-bit only.** v86 has no 64-bit extensions and no multicore. Package choices and binaries must be i386/x86. Anything modern that is 64-bit-only is simply out of reach.
- **Networking is second-class, but it has an answer.** v86's NIC is emulated (NE2000) and the browser cannot open raw sockets, so reaching the outside normally means a relay — a server of ours, which would be the one thing that breaks "no backend". **Tailscale avoids that entirely**: it runs in userspace inside the guest, so the distro gets a real address on our private network and internet through a home exit node, with nothing of ours to run. File exchange stays on the **9p shared filesystem**, not on the network. See [DECISIONS.md](DECISIONS.md).
- **Licences.** Bundling v86 obliges us to ship its BSD-2 notice. Shipping a Linux image means shipping the licences of everything inside it — normal for a distribution, worth doing properly once and then forgetting.
- **Upstream etiquette.** v86 does not accept issues or pull requests written by generative AI tools. Fork and vendor freely; do not send patches upstream from this project.
- **Graphics details we will hit.** Screen resolution changes via VBE, absolute vs relative mouse (pointer-lock), keyboard layout and clipboard are each a small project. The canvas is the easy part.
- **Mobile** is a question, not a given: IndexedDB behaviour and memory limits on iOS Safari make this meaningfully harder. Assume desktop browsers unless Q6 says otherwise.
- **Time, not just correctness.** v86 boots are slow; a first paint should show progress, not a blank canvas.

---

## 8. Open questions

Settled in the first design conversation — the reasoning is in [DECISIONS.md](DECISIONS.md):

- **Q1 emulator: v86.** Confirmed.
- **Q3 desktop: a real X desktop inside the VM, with a small browser in the guest.** A browser *inside* the distro is enough; the host browser never needs to reach into the VM.
- **Q4 internet: yes, via Tailscale.** The guest is a client to the open internet and a device on the tailnet, with no server of ours to run.

Still open:

1. **Base distribution: how custom?** Alpine dressed up now and Buildroot later (the staged recommendation), or go straight to a from-scratch Buildroot image? This decides whether milestone 7 is a swap or the whole project — and leaning towards *more* custom, since the point is an OS of our own rather than a lightly-dressed Alpine.
2. **Container scope:** overlay diff only (recommended), or a full disk image for portability to a non-our-base Linux later?
3. **Is mobile in scope?** If yes, it constrains storage and memory decisions from day one.
4. **Name.** `browser-linux` is the repo. The distribution itself will want a name and a look.

## 8a. What it is, who it is for, and how it must feel

Not architecture — intent, but it constrains the architecture, so it lives here too. Full reasoning in [DECISIONS.md](DECISIONS.md).

| | |
|---|---|
| **Audience** | Family. An opinionated OS: our defaults, our look, our choices. Not built to be approved of by everyone. |
| **Purpose** | A disposable Linux to tinker with and learn on; a lego set where even the desktop convention is negotiable; a home for small personal tools (messy CSV → readable HTML). |
| **Agents** | They configure the distro from **outside** — recipe, build, then fold live tweaks back in. Not inside the guest: no 32-bit Node or Bun exists, and configuring an OS is build-time work. |
| **Network** | Tailscale with a home exit node. A client to the internet, a device on the tailnet, never a server to the world. Host browser cannot reach guest ports; a browser *inside* the guest can. |
| **Performance** | Choose dramatically smaller software rather than write cleverer code. Our own web code runs natively, so what matters is bytes and I/O. "Feels fast" is latency and perception: never blank, cache, make the second boot the fast one, lean on resume. |
| **Fullscreen** | First-class, with two musts: match the guest resolution so it is crisp, and capture the keyboard so the browser stops keeping Ctrl+W. |

---

## 9. Milestones

Each one ends in something observable. M1–M5 are the spine; M6+ is polish and distribution.

| | Milestone | Done when |
|---|---|---|
| **M0** | Planning | This document exists, the repo exists, the questions above are answered. |
| **M1** | It boots | A stock 32-bit image boots in v86 from a local page: canvas, keyboard, mouse. No persistence. Just "Linux is on screen". |
| **M2** | It persists | Changes survive a reload, via the overlay in IndexedDB. `persist()` is requested and its result is shown. |
| **M3** | It has a desktop | X with a small window manager, resolution handling, usable mouse and keyboard, a terminal, and a way to open more than one window. |
| **M4** | The container | Export writes a zip; import restores it; a mismatched or corrupt container is refused with a reason a human can act on. |
| **M5** | Resume | Optional state save/restore so a session comes back mid-command, with the size cost shown before it is written. |
| **M6** | It is pleasant | File exchange with the host (9p and/or drag-and-drop), clipboard, sound, screenshots, sensible defaults. |
| **M7** | It is our distribution | The image is built from our own recipe in-repo: our package set, our branding, first-run setup, our name. |
| **M8** | It is reachable | Deployed: page on Pages, image on Releases, custom domain, and a documented upgrade path for the base image. |

## 10. References

- v86 — <https://github.com/copy/v86> (emulator; hardware list, guest support, state save/restore, 9p filesystem, Alpine guest setup)
- v86 npm package — <https://www.npmjs.com/package/v86>
- CheerpX — <https://cheerpx.io/docs/overview> (syscall-level alternative, licensing, and its own comparison with v86)
- WebVM 2.0 — <https://labs.leaningtech.com/blog/webvm-20> (a browser Linux desktop built on CheerpX; worth reading for what the desktop layer costs)
- Buildroot — the path to a genuinely custom image
- Alpine Linux x86 — base for the first image
