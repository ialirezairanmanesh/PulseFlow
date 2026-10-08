# PulseFlow device mirror

Live Android screen + touch inside the PulseFlow dashboard (left pane).

Uses [NetrisTV/ws-scrcpy](https://github.com/NetrisTV/ws-scrcpy) (PR [#344](https://github.com/NetrisTV/ws-scrcpy/pull/344) — Android 14/15 server) as a local sidecar on port **3848**.

## Setup

```bash
./setup.sh
```

Requires: Node.js, npm, git, `adb` on PATH, and the usual native build tools for `node-gyp` (on Ubuntu: `build-essential`).

`make run` / `./run.sh` call setup automatically if `ws-scrcpy/dist` is missing. For redroid **14**, the Android 14/15 branch is required (cloned automatically).

## Run

Started automatically with the dashboard:

```bash
make run
# Mirror: http://127.0.0.1:3848
```

Or alone:

```bash
./start.sh
```

## Use with redroid

1. Load binder + start redroid (`make redroid-start`).
2. `make run` (UI + bridge + mirror).
3. `make redroid-run-debug` (or your app on `localhost:5555`).
4. In PulseFlow → **Find running apps** → **Connect**.
5. Left pane streams the device; right pane keeps Problems / Widgets / …

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `PULSEFLOW_MIRROR_PORT` | `3848` | HTTP port for ws-scrcpy |
| `NEXT_PUBLIC_MIRROR_PORT` | `3848` | Port the Next.js UI probes / embeds |
| `NEXT_PUBLIC_MIRROR_HOST` | `127.0.0.1` | Host for the iframe |

## Fit-to-screen (dashboard iframe)

The left pane deep-links with `fitToScreen=true` so the mirror fills the iframe
instead of the default WebCodecs `480×480` box. Patches under `patches/` are
applied by `setup.sh` on every build.
