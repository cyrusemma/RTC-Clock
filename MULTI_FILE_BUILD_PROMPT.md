# Build Spec: ESP32-C3 Clock — Modular HTML/CSS/JS BLE Controller

## Goal
Build a **modular Web Bluetooth controller** for an ESP32-C3 clock using Vanilla HTML, CSS, and JavaScript. 
The application must connect to the device over **Web Bluetooth** and let the user fully control it: Clock, Stopwatch, Alarm, and Countdown Timer — mirroring the physical device in both directions.

Unlike a single-file script, this project MUST be well-sectioned and modular to maintain focus and code quality. You should split the logic into appropriate files (e.g., `index.html`, `css/styles.css`, `js/app.js`, `js/ble.js`, `js/ui.js`).

## Hard constraints
- **Modular structure:** Separate your HTML, CSS, and JS into distinct files. 
- Vanilla JavaScript only — no frameworks (no React, Vue, etc.), no build step (no Vite, Webpack), no external JS dependencies except the browser's native `navigator.bluetooth`.
- Web Bluetooth only works in **Chrome or Edge**, and only over **HTTPS or localhost** (not `file://` in some browsers, not Safari/iOS at all). Add a visible on-page warning if `navigator.bluetooth` is undefined, explaining this instead of failing silently.
- Target small screens too (this will often be used on a phone) — responsive, large touch-friendly buttons.

## Firmware compatibility requirement (read this first)
This app is only useful against a firmware build that:
1. Has a **write-enabled** BLE characteristic (`PROPERTY_WRITE` + `PROPERTY_WRITE_NR`) with an `onWrite()` handler that parses text commands.
2. Broadcasts a **full 24-byte state packet** via notify (not just epoch/mode/alarm/timer-state) — see exact layout below.

If the connected firmware only has `PROPERTY_READ | PROPERTY_NOTIFY | PROPERTY_INDICATE` and no write support, buttons in this app will send commands that go nowhere. Don't try to work around this in the webapp — the firmware needs the write handler. Flag this clearly in a code comment at the top of your BLE logic script so future-me doesn't forget.

## BLE identifiers
```
SERVICE_UUID:        4fafc201-1fb5-459e-8fcc-c5c9c331914b
CHARACTERISTIC_UUID: beb5483e-36e1-4688-b7f5-ea07361b26a8
```

## Outgoing protocol (webapp → device, `writeValue`)
Send these as UTF-8 text strings (trailing `\n` optional, firmware trims it):

| Command              | Meaning                                   |
|-----------------------|--------------------------------------------|
| `BTN:UP`             | UP button press                            |
| `BTN:DOWN`           | DOWN button press                          |
| `BTN:ALARM`          | ALARM button press (dismiss/cycle field)   |
| `BTN:MODE_SHORT`     | MODE button short press (cycle mode)       |
| `BTN:MODE_LONG`      | MODE button long press (enter clock-set)   |
| `MODE:<0-3>`         | Jump directly to a mode (0=Clock,1=Stopwatch,2=Alarm,3=Timer) |
| `SYNC:<epoch>,<tz>`  | Push browser time + timezone offset to RTC |
| `SET_ALARM:<hh>,<mm>,<0/1>` | Set alarm hour, minute, enabled flag |

**Critical architecture rule:** the webapp is a **remote control, not a simulator**. Button clicks ONLY send a command over BLE. They must NEVER directly update the on-screen clock/alarm/timer/mode state. All on-screen state changes come exclusively from the incoming notify packet below. This guarantees what's on screen always matches the physical hardware — never build local guessing logic that runs in parallel with the device.

## Incoming protocol (device → webapp, `notify`, 24 bytes)
Parse with a `DataView`, big-endian for multi-byte fields:

| Bytes   | Field              | Notes                                      |
|---------|---------------------|---------------------------------------------|
| 0-3     | `epoch`             | uint32, use for the live clock display      |
| 4       | `mode`              | 0=Clock,1=Stopwatch,2=Alarm,3=Timer          |
| 5       | `flags`             | bit0=alarmRinging, bit1=alarmEnabled, bit2=is12hFormat, bit3=settingMode |
| 6       | `tmrState`          | 0=Stopped,1=Running,2=Paused,3=Ringing       |
| 7       | `alarmHour`         | 0-23                                         |
| 8       | `alarmMin`          | 0-59                                         |
| 9       | `alarmSetField`     | 0=view,1=editing hour,2=editing min          |
| 10      | `swState`           | 0=Stopped,1=Running,2=Paused                 |
| 11-14   | `swElapsedMs`       | uint32                                       |
| 15-18   | `tmrRemainingMs`    | uint32                                       |
| 19      | `tmrInitMin`        | 0-99                                         |
| 20      | `tmrInitSec`        | 0-59                                         |
| 21      | `tmrSetField`       | 0=view,1=editing min,2=editing sec           |
| 22      | `timezoneOffset`    | int8, signed                                 |
| 23      | `settingPosition`   | 0=hour,1=min,2=sec,3=tz (clock-set mode)     |

Every incoming packet is authoritative — overwrite whatever's on screen with these values, no merging or partial-trust logic needed.

## Features to implement

**1. Connection bar (always visible, top of page)**
- "Connect" / "Disconnect" button using `navigator.bluetooth.requestDevice` filtered by `SERVICE_UUID`.
- Connection status indicator (dot/text: Disconnected / Connecting / Connected).
- Device name once connected.
- Auto re-subscribe to notifications on reconnect.

**2. Clock view**
- Large digital time display (HH:MM:SS), 12h/24h based on `is12hFormat` flag.
- Date is not broadcast by firmware — just show time, not date, unless you extend the packet (out of scope for v1).
- Timezone offset display (UTC±N).
- When `settingMode` flag is set, show which field is being edited (`settingPosition`: hour/min/sec/tz) with a visible highlight.
- A "Sync Time" button that sends `SYNC:<current epoch>,<tz offset>`.

**3. Stopwatch view**
- Time display MM:SS.CC computed from `swElapsedMs`.
- State label: Ready / Running / Paused.
- Buttons: Start/Resume (`BTN:UP`), Pause (`BTN:DOWN`), Reset (`BTN:ALARM`).

**4. Alarm view**
- Big HH:MM display of `alarmHour`/`alarmMin`.
- ON/OFF toggle indicator based on `alarmEnabled` flag.
- Editing indicator when `alarmSetField` is 1 or 2.
- Buttons: cycle edit field / toggle enabled (`BTN:ALARM`), increment (`BTN:UP`), decrement (`BTN:DOWN`).
- Ringing state: if `alarmRinging` flag set, show a prominent red banner with a "Dismiss" button that sends `BTN:ALARM`.

**5. Timer view**
- Countdown display MM:SS.CC — show `tmrInitMin`/`tmrInitSec` while `tmrSetField != 0` (editing), otherwise show `tmrRemainingMs`.
- State label: Ready / Running / Paused / Ringing.
- Buttons: cycle edit field (`BTN:ALARM`), increment (`BTN:UP`), decrement (`BTN:DOWN`). When `tmrState` is Ringing, show a "Stop" button (`BTN:ALARM`).

**6. Mode switcher**
- 4 tabs (Clock / Stopwatch / Alarm / Timer). Clicking a tab sends `MODE:<n>` — it must NOT set the active view directly; the active view switches only once the next notify packet confirms `mode` changed.

**7. Simple activity log (optional but nice)**
- A small scrolling text panel showing the last ~20 sent commands and received packets, for debugging while pairing.

## Non-goals for this version
- No offline/simulated mode — this app assumes a real device is connected.
- No persistence (localStorage) — Web Bluetooth pairing doesn't need it, and browser storage APIs are unreliable across some contexts, so keep all state in JS variables only.
- No multi-device support — one connection at a time.

## Deliverable
A fully structured web project with separate files for HTML, CSS, and JS modules (e.g., UI, BLE, App). Test it by serving the directory locally, clicking Connect, pairing with `ESP32C3-Clock`, and confirming each mode's buttons produce a visible physical change on the hardware within ~300ms (the device's telemetry broadcast rate).
