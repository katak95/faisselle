# Build and run Faisselle locally

## You need

- Node.js 24 and pnpm 10.7.0
- CMake
- **Mac:** Xcode Command Line Tools
- **Windows:** Rust, the Vulkan SDK, Visual Studio C++ Build Tools
- **Linux:** Rust, the Vulkan SDK, `libpulse-dev`, `pkg-config`. On Ubuntu 24.04 or newer, these packages can stand in for the Vulkan SDK:

  ```sh
  sudo apt install libpulse-dev pkg-config libvulkan-dev glslc spirv-headers
  ```

On Linux, clone into a folder whose path has no spaces: Electron's sandbox can't start from one.

## Run it

```sh
git clone https://github.com/katak95/faisselle.git
cd faisselle
pnpm install --frozen-lockfile
pnpm -C app native   # builds the audio, system and transcription helpers (first time, and after they change)
pnpm dev             # opens Faisselle from source
```

The first run downloads the AI models, like the installed app.

- **Separate profile:** `YOGURT_USER_DATA=/tmp/yogurt-dev pnpm dev` keeps your real meetings out of it.
- **Without models:** `YOGURT_FAKE=1 pnpm dev` swaps in a fake transcriber, notes model and call audio, so the whole app runs in seconds.
- **Mac permissions:** `pnpm dev` starts Electron as *Faisselle Dev* (`com.katak95.faisselle.dev`), answering for its own microphone, call audio, calendar, Accessibility and notifications rather than your terminal's, under its own name in System Settings, apart from the installed app. Signed with your Apple Development certificate when you have one, what you allow stays allowed; macOS may ask once for `codesign` to use its key. See `app/scripts/dev-identity.mjs`.
- **Linux sandbox:** on Ubuntu 24.04 and other systems that turn off unprivileged user namespaces, Electron's sandbox helper must be owned by root. `pnpm dev` prints the two `sudo` commands when it isn't, and they're needed again after `node_modules` is reinstalled.

## Test

```sh
pnpm -C app typecheck
pnpm -C app test   # unit tests
pnpm -C app e2e    # builds, then drives the app with Playwright in fake mode
```

## Build an installer

```sh
pnpm -C app build
pnpm -C app exec electron-builder --mac   # or --win, --linux, on that platform
```

Installers land in `app/dist/`. They're unsigned unless signing is set up; see `app/scripts/release-mac.sh` for the Mac.

## Release

A new Yogurt version is released by itself: [`sync-yogurt.yml`](../.github/workflows/sync-yogurt.yml) merges it into `main` and tags Yogurt X.Y.Z as Faisselle X.Y.(Z×100) ([Following Yogurt](syncing-with-yogurt.md)).

To release a Faisselle change between two Yogurt versions, from an up-to-date, clean `main`:

```sh
sh app/scripts/faisselle-release.sh
```

It tags `main` with the next Faisselle number (0.3.6201, 0.3.6202…, [`app/scripts/version.mjs`](../app/scripts/version.mjs)) and pushes the tag. GitHub Actions builds Mac (signed and notarized), Windows and Linux, and publishes one release once all three pass. Installed copies update from it. `app/scripts/release.sh` is Yogurt's: don't use it in Faisselle.
