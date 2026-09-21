# browser-linux

A lightweight Linux distribution that runs entirely inside a web browser — with a graphical desktop, and all of its state living in the browser and in a container file you own.

**Status: planning.** There is no code yet. [docs/PLAN.md](docs/PLAN.md) holds the architecture, the decisions already made and the ones still open.

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

## Intended layout

```
web/            the page: canvas, input, container import/export, settings
web/emulator/   v86 wiring: boot config, block-device backend, state save/restore
web/store/      browser storage: overlay blocks, config, quota and eviction handling
image/          the distro build: base disk image, reproducible from a recipe
docs/           the plan, decisions, and what is still unknown
```

Nothing in `web/` talks to a server except to fetch the immutable base image and the emulator bundle. There is no backend to write.

## License

Not chosen yet. Two things to settle before it is: the emulator's own notice must ship with any bundle of it, and a Linux image carries the licenses of everything inside it. See the plan's notes on shipping a distribution.

## Inspiration

The v86 project and its demos, WebVM and CheerpX, JSLinux, and the long line of hobby operating systems that fit in a tab.
