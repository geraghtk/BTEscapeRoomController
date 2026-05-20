# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **zero-build static web app** — `index.html` + `styles.css` + `app.js` — that drives BLE escape-room props over the Web Bluetooth API. Deployed via GitHub Pages, and the iOS workflow goes through the Bluefy browser. There is no package manager, no bundler, no test suite, and no CI; edits to the three source files are the entirety of the build.

## Running and deploying

Web Bluetooth requires a secure context, so opening `index.html` from the filesystem won't work. Serve over `localhost` for local dev:

```powershell
python -m http.server 8000
# open http://localhost:8000
```

Deployment is automatic: pushing to `main` updates the GitHub Pages site. No build step. There are no tests or linters to run.

To verify firmware-side changes you also need to flash the matching prop. PlatformIO isn't on PATH for this user — invoke it via:

```
C:/Users/Kevin/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0/LocalCache/local-packages/Python313/Scripts/pio.exe run -d <project-dir> --target upload
```

## Architecture

The whole app is wired around a single dictionary in `app.js`: `PROP_CONFIG`. Each entry describes one prop's BLE GATT layout (service / write / notify UUIDs), the `requestDevice` filter to use, and whether it has a notify characteristic. Every other piece of logic — `connect()`, `disconnect()`, `sendCommand()`, `setStatus()`, `wireProp()`, the activity log — is prop-agnostic and dispatches on the `data-prop="<key>"` attribute that ties an HTML `<section class="prop-card">` to its `PROP_CONFIG` key. To add a new prop you (1) add a `PROP_CONFIG` entry, (2) add a matching `<section>` in `index.html`, and (3) wire prop-specific UI helpers inside `init()` (the volume slider for `voice` is the only example today). The runtime state per prop lives in the `propState` object and is set/cleared by `connect`/`disconnect`.

The opening comment block of `app.js` is the canonical reference for each prop's BLE protocol — including non-obvious quirks like Treasure Hunt's bare-digit vs. space-prefix-digit payloads (the `" 0".." 5"` strings come from how the firmware's two early-returning string-equality checks have to be sidestepped by `atoi`). Update it when you change a protocol.

## Firmware lives in sibling repos

The three props' firmware repos must stay in sync with this app's `PROP_CONFIG`:

| Prop             | Repo                                | BLE library                |
|------------------|-------------------------------------|----------------------------|
| Treasure Hunt    | `C:/Users/Kevin/treasurehunt`       | ESP32 BLE Arduino (BLEDevice.h) |
| Voice Recognizer | `C:/Users/Kevin/voice-recognizer`   | ESP32 BLE Arduino (BLEDevice.h) |
| Animal Raw       | `C:/Users/Kevin/AnimalRaw/esp32`    | ESP32 BLE Arduino (BLEDevice.h) |

Whenever you change a BLE service/characteristic UUID, command string, or advertising layout in one of those repos, the controller's `PROP_CONFIG` (and probably the in-card commands in `index.html`) needs the matching change here.

## Load-bearing comments — don't paraphrase them away

Two comment blocks in this project encode hard-won lessons. Read them in full before changing the surrounding code; both came from real debugging incidents and have been re-broken at least once by "simplifying" them.

1. **Web Bluetooth filters in `app.js`'s `PROP_CONFIG`** — each prop uses *both* a `namePrefix:` filter and a `services:` filter. The `namePrefix` is for Chrome/Android; the `services` filter is the only thing that works on iOS/Bluefy (CoreBluetooth has no name-based scan filter at the OS level). Don't "tighten" either to `name:`-only or remove the services filter — that has regressed iOS discovery multiple times.

2. **Split-packet BLE advertising in each prop firmware** — every prop's `setup()` explicitly calls `BLEAdvertising::setAdvertisementData()` *and* `setScanResponseData()`. The primary packet carries `Flags + 128-bit Service UUID` (so iOS can match the services filter); the scan response carries the `Complete Local Name` (so the picker still shows "VoiceRecognizer" etc. via iOS active scanning). Don't fall back to a plain `BLEDevice::startAdvertising()` with no custom data — the library defaults put the name in the primary packet and omit the service UUID, which makes the prop invisible to a filtered `requestDevice()` on Bluefy.

There's also a "Show all nearby devices" fallback link on every card (`data-action="connect-all"`). It uses `acceptAllDevices: true` and exists as belt-and-braces for any future Web Bluetooth client that doesn't honor either filter cleanly. Keep it.

## README staleness note

`README.md` still says "the third prop, AnimalRaw, doesn't currently expose any BLE control surface" — that's outdated; AnimalRaw was given a BLE control surface (advertises as `AnimalRaw`, custom NUS-style service, commands `reset`/`lock`/`unlock`/`auto`/`arm`/`disarm`/`?`). If you touch `README.md` for an unrelated reason, fix that paragraph too.

## Project-specific memory (lives outside the repo)

Past-debugging lessons for this project are stored under the user's Claude config directory — **not** in the project tree, and **not** committed to git:

```
C:\Users\Kevin\.claude\projects\C--Users-Kevin-BTEscapeRoomController\memory\
├── MEMORY.md                                  (index, auto-loaded into context each session)
└── feedback-web-bluetooth-name-filter.md      (the iOS/Bluefy lesson; see §"Load-bearing comments")
```

The directory name is the project's absolute path with `:\` rewritten to `--` and `\` to `-`. The folder is per-user and machine-local; don't try to mirror it into the repo.
