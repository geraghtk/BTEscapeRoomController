# Escape Room Prop Controller

Static web page that sends Bluetooth LE commands to the escape-room props from a
phone or laptop. Uses the [Web Bluetooth API][webble], so no native app is needed.

Currently supports two props:

| Prop                                                       | What you can control                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Treasure Hunt** (`~/treasurehunt`, ESP32-C3, e-paper)    | Reset to title, start hunt, jump directly to clue 0–5                               |
| **Voice Recognizer** (`~/voice-recognizer`, ESP32, NFC)    | Set DFPlayer volume (0–30), query status                                            |

The third prop, **AnimalRaw**, doesn't currently expose any BLE control surface
— add a command interface to its firmware and a new card to `index.html` when
it does.

## How it talks to the props

Each prop card maps directly onto its firmware's BLE GATT layout:

**Treasure Hunt** — custom service, single writable characteristic; payload is
an ASCII digit. See [`src/BLE_TreasureHunt.ino`][th-src] in the prop repo.

- Service: `12345678-1234-1234-1234-1234567890ab`
- Characteristic: `abcd1234-abcd-1234-abcd-12345678abcd` (WRITE)
- `"0"` resets to the title screen, `"1"` starts the hunt from saved progress,
  `"0".."5"` jumps directly to that clue index.

**Voice Recognizer** — Nordic UART Service (NUS); writes go to the RX
characteristic, status replies arrive over TX notifications. See
[`src/main.ino`][vr-src] in the prop repo.

- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX (write): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX (notify): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- `v0`..`v30` sets the volume (persisted to NVS), `?` queries volume + tag count.

## Browser support

Web Bluetooth needs a Chromium-based browser **or** a third-party browser
that implements the API on top of CoreBluetooth:

| Platform           | Browser                                                  |
| ------------------ | -------------------------------------------------------- |
| Windows / macOS    | Chrome, Edge, Brave, Opera (anything Chromium)           |
| Android            | Chrome (and other Chromium variants)                     |
| iOS / iPadOS       | **[Bluefy][bluefy]** — Safari/Chrome on iOS won't work   |

Safari does not implement Web Bluetooth on any platform — Apple hasn't shipped
it — but Bluefy is a dedicated Web-BLE browser that fills the gap on iPhone/iPad.
Open the GitHub Pages URL inside Bluefy and the page behaves the same as it
does in desktop Chrome.

A secure context (HTTPS or `http://localhost`) is also required. GitHub Pages
serves HTTPS by default, so this is automatic when deployed.

[bluefy]: https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055

## Hosting on GitHub Pages

1. Create a new repo (e.g. `BTEscapeRoomController`) and push these files to
   the `main` branch.
2. In **Settings → Pages**, set _Source_ to **Deploy from a branch**, branch
   `main`, folder `/ (root)`, then **Save**.
3. After ~30 seconds the page will be live at
   `https://<your-username>.github.io/BTEscapeRoomController/`.

The repo only contains static assets (`index.html`, `styles.css`, `app.js`) and
a `.nojekyll` marker so GitHub Pages doesn't pre-process the files.

## Local development

Web Bluetooth needs a secure context, so you can't just double-click
`index.html`. Use any static server on `localhost`:

```bash
# Python (already on most machines)
python -m http.server 8000
# then open http://localhost:8000
```

## Using it

1. Power on the prop (the ESP32 starts advertising immediately).
2. Open the page in Chrome/Edge.
3. On the prop's card, click **Connect**. The browser shows a native device
   picker — pick your prop, then **Pair**.
4. Once connected, the controls light up. Every command sent and every
   notification received is timestamped in the activity log at the bottom.

The browser will remember pairings per-origin, but Web Bluetooth still requires
a fresh user gesture (button click) every time you reconnect after a page load
— this is a deliberate browser security restriction.

## Adding a new prop

1. Add a `<section class="prop-card" data-prop="<key>">…</section>` to
   `index.html` mirroring the structure of the existing cards.
2. Add a matching entry under `PROP_CONFIG` in `app.js` with the BLE service +
   characteristic UUIDs and a `requestOptions()` returning the filter to use
   in `navigator.bluetooth.requestDevice()`.
3. Wire any prop-specific UI (extra sliders, buttons, etc.) inside `init()`.

[webble]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
[th-src]: https://github.com/?/treasurehunt/blob/main/src/BLE_TreasureHunt.ino
[vr-src]: https://github.com/?/voice-recognizer/blob/main/src/main.ino
