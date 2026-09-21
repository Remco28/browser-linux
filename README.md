# browser-linux

A lightweight Linux distribution that runs entirely inside a web browser — with a graphical desktop, and all of its state living in the browser and in a container file you own.

**Status: a prototype that boots.** Linux comes up in the tab and that is genuinely all it does so far — no persistence, so a reload is a fresh machine. [docs/PLAN.md](docs/PLAN.md) holds the architecture, the decisions made and the ones still open; [docs/DECISIONS.md](docs/DECISIONS.md) holds the reasoning behind them.

**Try it:** <https://remco28.github.io/browser-linux/> — press Start, then give it a minute. The guest starts from firmware like a real machine, and the screen stays honestly blank until it takes over.

## Running it locally

```bash
web/tools/fetch-images.sh       # the disk images: 27 MB, deliberately not in git
cd web && bun tools/serve.mjs   # then open http://127.0.0.1:8080/
```

To check it without a window:

```bash
cd web && bun tools/smoke.mjs http://127.0.0.1:8080/ 130000 /tmp/boot.png
```

That drives headless Chrome, clicks Start, and brings back evidence rather than a hope: the boot timeline, what the page said about itself and when, the console, and a screenshot. A blank screen shows up as one colour and 0% lit instead of as a PNG nobody opens.

## The idea

Any computer with a modern browser can be your computer for ten minutes. You open a URL, your OS boots in the tab, and everything is yours again — files, settings, installed packages, the desktop layout — because none of it was ever on the borrowed machine.

Nothing is uploaded. The server only ever hands out the base image. Your data does not leave the browser unless you export it.

## How you would actually use it

1. Open the site. A lightweight Linux boots in the tab — a real one, with a real shell and real packages.
2. Use it. Change things. Install something.
3. Everything you change is written to browser storage, so closing the tab and coming back restores it.
4. **Export** — one file lands in Downloads. That file is your container. Put it in Google Drive, or anywhere else.
5. On another machine: open the same URL, hand it the container, and your OS is back — same files, same settings, same desktop.

Import is not a reinstall. It is a restore.

## What it is not

- **Not a workstation.** Deliberately small: a window manager, a terminal, a file manager, maybe a small browser. No office suite, no GPU, no 64-bit binaries.
- **Not a cloud service.** No account, no sync, no server that knows who you are.
- **Not a daily driver.** A portable environment for a borrowed or throwaway machine.

## Why this is possible at all

x86 emulation in WebAssembly is now mature enough to boot unmodified 32-bit Linux at usable speed, draw a real desktop into a `<canvas>`, and snapshot the whole machine into a file. That last capability is what makes the container idea work rather than being wishful, and it is why the plan leans on [v86](https://github.com/copy/v86) — BSD-2 licensed, real hardware emulation, native state save and restore — over a faster but more closed alternative.

## Layout

```
web/            the page: canvas, input, fitting, fullscreen, the state line
web/vendor/     v86 and its BIOS, vendored — there is no build step on purpose
web/images/     the disk images, fetched by script, never committed
tools/          the dev server and the headless smoke test (under web/tools/)
docs/           the plan, decisions, and what is still unknown
```

Still to come, per the plan: the emulator wiring split out (`web/emulator/`), the storage layer (`web/store/`), and the distro build (`image/`, reproducible from a recipe).

Nothing in `web/` talks to a server except to fetch the disk images and the emulator bundle. There is no backend to write.

## License

Not chosen yet. Two things are already handled, though: the emulator's BSD-2 notice ships with the bundle at [`web/vendor/LICENSE.v86`](web/vendor/LICENSE.v86), and any Linux image we distribute will carry the licences of everything inside it. See the plan's notes on shipping a distribution.

## Inspiration

The v86 project and its demos, WebVM and CheerpX, JSLinux, and the long line of hobby operating systems that fit in a tab.
