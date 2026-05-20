// Escape Room Prop Controller — Web Bluetooth client.
//
// Talks to three BLE peripherals:
//
// 1. Treasure Hunt (ESP32-C3 in ~/treasurehunt)
//    - Advertises a custom service with one writable string characteristic.
//    - Service:        12345678-1234-1234-1234-1234567890ab
//    - Characteristic: abcd1234-abcd-1234-abcd-12345678abcd  (WRITE)
//    - Firmware command parsing (BLE_TreasureHunt.ino `currentClueCallback`):
//        value == "0"          -> reset to title (returns early)
//        value == "1"          -> start hunt from saved progress (returns early)
//        else if atoi in 0..5  -> jump directly to that clue index
//    - The two `return` early-exits mean bare "0" / "1" payloads can never reach
//      the jump handler, so we can't use "0" / "1" to force-jump to Flower /
//      Strawberry. Workaround: prefix the digit with a space — e.g. " 0" — which
//      fails both string-equality checks but still parses via atoi(). That's why
//      the "Jump to clue" buttons in index.html send " 0".." 5" instead of bare
//      digits. The "Reset" and "Start" buttons still send bare "0" / "1".
//
// 2. Voice Recognizer (ESP32 in ~/voice-recognizer)
//    - Advertises name "VoiceRecognizer" using the Nordic UART Service (NUS).
//    - Service: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
//    - RX (WRITE  — host -> device): 6E400002-B5A3-F393-E0A9-E50E24DCCA9E
//    - TX (NOTIFY — device -> host): 6E400003-B5A3-F393-E0A9-E50E24DCCA9E
//    - Commands: "v0".."v30" (volume), "?" (status).
//
// 3. AnimalRaw (ESP32 in ~/AnimalRaw/esp32)
//    - Advertises name "AnimalRaw" with a custom NUS-style service.
//    - Service: a17a0001-1234-4321-abcd-1234567890ab
//    - WRITE:   a17a0002-1234-4321-abcd-1234567890ab  (host -> device)
//    - NOTIFY:  a17a0003-1234-4321-abcd-1234567890ab  (device -> host)
//    - Commands: "reset", "lock", "unlock", "auto", "arm", "disarm", "?".
//      `lock` / `unlock` set the relay and suspend auto-control until `auto`
//      or `reset` resumes it. `arm` / `disarm` gates the Nicla sound input
//      so the prop can be silenced during room setup.
//
// Web Bluetooth requires a user gesture for requestDevice() and a secure
// context (HTTPS or localhost) — GitHub Pages serves both.

"use strict";

const PROP_CONFIG = {
  treasurehunt: {
    label: "TreasureHunt",
    service: "12345678-1234-1234-1234-1234567890ab",
    writeChar: "abcd1234-abcd-1234-abcd-12345678abcd",
    // Two filters because Web Bluetooth handles `name` and `services` filters
    // differently across platforms:
    //   - Chrome / desktop Edge / Android: matches via the namePrefix entry
    //     (CoreBluetooth's name limitation doesn't apply).
    //   - Bluefy on iOS: iOS has no OS-level name-based scan filter, so the
    //     namePrefix entry never matches. The services entry is what surfaces
    //     the device — and only works because the firmware (post-2026-05) now
    //     puts the service UUID in the primary advertising packet, with the
    //     local name moved to the scan response. (Pre-2026-05 firmware kept
    //     the name in the primary packet and omitted the UUID, which made
    //     the prop completely invisible to a filtered requestDevice on iOS.)
    requestOptions: () => ({
      filters: [
        { namePrefix: "Treasure" },
        { services: ["12345678-1234-1234-1234-1234567890ab"] },
      ],
      optionalServices: ["12345678-1234-1234-1234-1234567890ab"],
    }),
    // Fallback used by the "Show all devices" button — some Web Bluetooth
    // implementations (Bluefy in particular) miss the service UUID when it
    // lives in the BLE scan response rather than the primary advertisement.
    // acceptAllDevices is forbidden together with `filters`.
    acceptAllOptions: () => ({
      acceptAllDevices: true,
      optionalServices: ["12345678-1234-1234-1234-1234567890ab"],
    }),
    hasNotify: false,
  },
  voice: {
    label: "VoiceRecognizer",
    service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    writeChar: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
    notifyChar: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
    // Two filters for the same reason as Treasure Hunt above — namePrefix is
    // the Chrome/Android path; the services entry is what makes the prop
    // discoverable on Bluefy/iOS now that the firmware advertises the NUS
    // service UUID in the primary packet (with the name moved to the scan
    // response). See the longer note on the treasurehunt entry.
    requestOptions: () => ({
      filters: [
        { namePrefix: "Voice" },
        { services: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] },
      ],
      optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"],
    }),
    acceptAllOptions: () => ({
      acceptAllDevices: true,
      optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"],
    }),
    hasNotify: true,
  },
  animalraw: {
    label: "AnimalRaw",
    service: "a17a0001-1234-4321-abcd-1234567890ab",
    writeChar: "a17a0002-1234-4321-abcd-1234567890ab",
    notifyChar: "a17a0003-1234-4321-abcd-1234567890ab",
    // Two filters — namePrefix for Chrome/Android, services for Bluefy/iOS.
    // See the longer note on the treasurehunt entry.
    requestOptions: () => ({
      filters: [
        { namePrefix: "Animal" },
        { services: ["a17a0001-1234-4321-abcd-1234567890ab"] },
      ],
      optionalServices: ["a17a0001-1234-4321-abcd-1234567890ab"],
    }),
    acceptAllOptions: () => ({
      acceptAllDevices: true,
      optionalServices: ["a17a0001-1234-4321-abcd-1234567890ab"],
    }),
    hasNotify: true,
  },
};

// Per-prop runtime state. Populated by connect(), cleared by disconnect().
const propState = {
  treasurehunt: null,
  voice: null,
  animalraw: null,
};

const logEl = document.getElementById("log");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function log(tag, message, propKey) {
  const entry = document.createElement("div");
  entry.className = "log-entry";

  const time = new Date().toLocaleTimeString([], { hour12: false });
  const tagClass = `log-tag-${tag}`;
  const tagText = propKey ? `${tag.toUpperCase()} · ${PROP_CONFIG[propKey].label}` : tag.toUpperCase();

  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-tag ${tagClass}">${escapeHtml(tagText)}</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(propKey, state) {
  const card = document.querySelector(`.prop-card[data-prop="${propKey}"]`);
  if (!card) return;

  const pill = card.querySelector("[data-status]");
  const controls = card.querySelector("[data-controls]");
  const connectBtn = card.querySelector('[data-action="connect"]');
  const disconnectBtn = card.querySelector('[data-action="disconnect"]');
  const connectAllBtn = card.querySelector('[data-action="connect-all"]');

  pill.classList.remove("connected", "connecting");

  if (state === "connected") {
    pill.textContent = "Connected";
    pill.classList.add("connected");
    controls.removeAttribute("disabled");
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    if (connectAllBtn) connectAllBtn.disabled = true;
  } else if (state === "connecting") {
    pill.textContent = "Connecting…";
    pill.classList.add("connecting");
    controls.setAttribute("disabled", "");
    connectBtn.disabled = true;
    disconnectBtn.disabled = true;
    if (connectAllBtn) connectAllBtn.disabled = true;
  } else {
    pill.textContent = "Disconnected";
    controls.setAttribute("disabled", "");
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    if (connectAllBtn) connectAllBtn.disabled = false;
  }
}

async function connect(propKey, options = { acceptAll: false }) {
  const config = PROP_CONFIG[propKey];
  if (!navigator.bluetooth) {
    log("error", "Web Bluetooth is not available in this browser.", propKey);
    return;
  }

  try {
    setStatus(propKey, "connecting");
    const requestOpts = options.acceptAll
      ? config.acceptAllOptions()
      : config.requestOptions();
    log(
      "info",
      options.acceptAll
        ? "Requesting device (showing all nearby devices)…"
        : "Requesting device…",
      propKey,
    );

    const device = await navigator.bluetooth.requestDevice(requestOpts);

    log("info", `Selected "${device.name || "(no name)"}" — connecting GATT…`, propKey);

    device.addEventListener("gattserverdisconnected", () => onDisconnected(propKey));

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(config.service);
    const writeChar = await service.getCharacteristic(config.writeChar);

    let notifyChar = null;
    if (config.hasNotify) {
      notifyChar = await service.getCharacteristic(config.notifyChar);
      await notifyChar.startNotifications();
      notifyChar.addEventListener("characteristicvaluechanged", (event) => {
        const value = decoder.decode(event.target.value);
        log("recv", value, propKey);
      });
    }

    propState[propKey] = { device, server, writeChar, notifyChar };
    setStatus(propKey, "connected");
    log("info", "Connected.", propKey);
  } catch (err) {
    setStatus(propKey, "disconnected");
    if (err && err.name === "NotFoundError") {
      log("warn", "Selection cancelled.", propKey);
    } else {
      log("error", err && err.message ? err.message : String(err), propKey);
    }
  }
}

function onDisconnected(propKey) {
  propState[propKey] = null;
  setStatus(propKey, "disconnected");
  log("warn", "Device disconnected.", propKey);
}

function disconnect(propKey) {
  const state = propState[propKey];
  if (!state) return;
  try {
    if (state.device.gatt.connected) {
      state.device.gatt.disconnect();
    }
  } catch (err) {
    log("error", err.message || String(err), propKey);
  }
  // gattserverdisconnected fires and triggers onDisconnected().
}

async function sendCommand(propKey, payload) {
  const state = propState[propKey];
  if (!state) {
    log("error", "Not connected.", propKey);
    return;
  }
  try {
    const bytes = encoder.encode(payload);
    // writeValueWithoutResponse is faster but not universally supported;
    // writeValue (with response) is the safe default for both firmware paths.
    if (state.writeChar.writeValueWithResponse) {
      await state.writeChar.writeValueWithResponse(bytes);
    } else {
      await state.writeChar.writeValue(bytes);
    }
    log("sent", payload, propKey);
  } catch (err) {
    log("error", err.message || String(err), propKey);
  }
}

// ---------- UI wiring ----------

function wireCollapseToggle(propKey, card) {
  const toggle = card.querySelector("[data-collapse-toggle]");
  if (!toggle) return;

  const storageKey = `propCollapsed:${propKey}`;
  let savedState = null;
  try {
    savedState = localStorage.getItem(storageKey);
  } catch (_) {} // private-mode Safari etc.
  if (savedState === "1") {
    card.classList.add("collapsed");
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    const willCollapse = !card.classList.contains("collapsed");
    card.classList.toggle("collapsed", willCollapse);
    toggle.setAttribute("aria-expanded", willCollapse ? "false" : "true");
    try {
      localStorage.setItem(storageKey, willCollapse ? "1" : "0");
    } catch (_) {}
  });
}

function wireProp(propKey) {
  const card = document.querySelector(`.prop-card[data-prop="${propKey}"]`);
  if (!card) return;

  wireCollapseToggle(propKey, card);

  card
    .querySelector('[data-action="connect"]')
    .addEventListener("click", () => connect(propKey));

  const showAllBtn = card.querySelector('[data-action="connect-all"]');
  if (showAllBtn) {
    showAllBtn.addEventListener("click", () =>
      connect(propKey, { acceptAll: true }),
    );
  }

  card
    .querySelector('[data-action="disconnect"]')
    .addEventListener("click", () => disconnect(propKey));

  card.querySelectorAll("[data-send]").forEach((btn) => {
    btn.addEventListener("click", () => sendCommand(propKey, btn.dataset.send));
  });

  const customForm = card.querySelector("[data-custom-form]");
  if (customForm) {
    const input = card.querySelector("[data-custom-input]");
    customForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value;
      if (value.length === 0) return;
      sendCommand(propKey, value);
      input.value = "";
    });
  }
}

function wireVoiceVolumeSlider() {
  const card = document.querySelector('.prop-card[data-prop="voice"]');
  const slider = card.querySelector("[data-volume-slider]");
  const value = card.querySelector("[data-volume-value]");
  const sendBtn = card.querySelector("[data-volume-send]");

  slider.addEventListener("input", () => {
    value.textContent = slider.value;
  });

  sendBtn.addEventListener("click", () => {
    sendCommand("voice", `v${slider.value}`);
  });
}

function init() {
  if (!navigator.bluetooth) {
    document.getElementById("compat-warning").classList.remove("hidden");
    document.querySelectorAll('[data-action="connect"]').forEach((b) => {
      b.disabled = true;
    });
  }

  Object.keys(PROP_CONFIG).forEach(wireProp);
  wireVoiceVolumeSlider();

  document.getElementById("clear-log").addEventListener("click", () => {
    logEl.innerHTML = "";
  });

  log("info", "Ready. Click Connect on a prop card to begin.");
}

document.addEventListener("DOMContentLoaded", init);
