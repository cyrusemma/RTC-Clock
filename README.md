# RTC Clock V2.0 — ESP32-C3 Firmware

## What's new vs V1

| Feature | V1 | V2 |
|---|---|---|
| Alarms | 1 | **4 slots** with snooze + repeat days |
| Snooze | ❌ | ✅ 5-minute snooze per alarm |
| Stopwatch laps | ❌ | ✅ up to 8 laps |
| BLE characteristics | 1 | **3** (telemetry, alarm list, laps) |
| WiFi | ❌ | ✅ **AP mode hotspot + WebSocket** |
| Time sync | Manual only | Manual + app SYNC command |
| Edit highlight | ❌ | ✅ Box drawn over active field |
| Progress bar | ❌ | ✅ Timer progress bar on OLED |
| Protocol version | 1 (7 byte) | **2 (34 byte)** |

---

## Required Libraries (Arduino IDE → Manage Libraries)

| Library | Search for |
|---|---|
| U8g2 | `U8g2 by oliver` |
| WebSockets | `WebSockets by Markus Sattler` |
| ESP32 board package | `ESP32 by Espressif Systems` (Boards Manager) |

BLE and WiFi are built into the ESP32 Arduino core — no extra install needed.

---

## Board Settings (Arduino IDE)

```
Board:           ESP32C3 Dev Module
Upload Speed:    921600
USB CDC On Boot: Enabled   ← important for Serial monitor
Flash Size:      4MB
Partition Scheme: Default 4MB with spiffs
```

---

## WiFi — How it works

The ESP32 creates its **own WiFi hotspot** (Access Point mode).  
No router needed.

| Setting | Value |
|---|---|
| SSID | `RTC-Clock` |
| Password | `12345678` |
| Device IP | `192.168.4.1` |
| HTTP | `http://192.168.4.1` |
| WebSocket | `ws://192.168.4.1:81` |

**Phone → Settings → WiFi → connect to `RTC-Clock` → open browser → 192.168.4.1**

---

## BLE — UUIDs (unchanged from V1)

| | UUID |
|---|---|
| Service | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Telemetry char (READ/WRITE/NOTIFY) | `beb5483e-36e1-4688-b7f5-ea07361b26a8` |
| Alarm list char (READ) | `cba1d466-344c-4be3-ab3f-189f80dd7518` |
| Laps char (READ) | `d1a7c123-4561-47ab-a9bc-9a7e6a1bcdef` |

---

## Command Protocol (same over BLE write AND WebSocket text)

### Virtual buttons
```
BTN:UP
BTN:DOWN
BTN:ALARM
BTN:MODE_SHORT
BTN:MODE_LONG
BTN:LAP
BTN:SNOOZE
```

### Direct commands
```
SYNC:<unix_epoch>,<tz_offset>
  e.g.  SYNC:1753000000,0

SET_ALARM:<slot 0-3>,<hh>,<mm>,<enabled 0/1>,<repeatDays bitmask>
  e.g.  SET_ALARM:0,7,30,1,31       ← slot 0, 07:30, enabled, weekdays
        SET_ALARM:1,9,0,1,127       ← slot 1, 09:00, enabled, every day
        repeatDays bits: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
        0x7F (127) = every day | 0x1F (31) = Mon-Fri | 0 = one-shot

ALARM_EN:<slot>,<0/1>
  e.g.  ALARM_EN:0,0   ← disable slot 0

DISMISS_ALARM:<slot>
SNOOZE:<slot>

SET_TIMER:<min>,<sec>
SET_TIMER:<hr>,<min>,<sec>
  e.g.  SET_TIMER:10,30      ← 10 min 30 sec
        SET_TIMER:1,10,30    ← 1 hr 10 min 30 sec

RESET_TIMER
  Stops the timer and reloads the configured duration.

SET_VOLUME:<0-255>           ← firmware 2.1.0+
  e.g.  SET_VOLUME:180
  Buzzer loudness via PWM duty cycle. Requires a PASSIVE buzzer;
  an active (self-oscillating) buzzer only responds to on/off.

SET_TIMEFORMAT:<12|24>
SET_TIMEZONE:<-12..14>

MODE:<0=Clock|1=Stopwatch|2=Alarm|3=Timer>
```

---

## WebSocket Telemetry (JSON, every 250ms)

```json
{
  "v": 2,
  "epoch": 1753000000,
  "mode": 0,
  "ringing": false,
  "ringSlot": -1,
  "12h": false,
  "setting": false,
  "tz": 0,
  "settingPos": 0,
  "sw": 0,
  "swMs": 0,
  "tmr": 0,
  "tmrMs": 300000,
  "tmrHr": 0,
  "tmrMin": 5,
  "tmrSec": 0,
  "vol": 180,
  "tmrField": 0,
  "lapCount": 0,
  "laps": [],
  "alarms": [
    {"h":7,"m":30,"en":true,"sn":false,"rep":127},
    {"h":0,"m":0,"en":false,"sn":false,"rep":127},
    {"h":0,"m":0,"en":false,"sn":false,"rep":127},
    {"h":0,"m":0,"en":false,"sn":false,"rep":127}
  ],
  "alarmSlot": 0,
  "alarmField": 0
}
```

### mode values
| Value | Screen |
|---|---|
| 0 | Clock |
| 1 | Stopwatch |
| 2 | Alarm settings |
| 3 | Timer |

### sw values (stopwatch state)
| Value | State |
|---|---|
| 0 | Stopped |
| 1 | Running |
| 2 | Paused |

### tmr values (timer state)
| Value | State |
|---|---|
| 0 | Stopped |
| 1 | Running |
| 2 | Paused |
| 3 | Ringing |

---

## BLE Telemetry (binary, 34 bytes, same cadence)

```
[0]     Protocol version (2)
[1-4]   Epoch uint32 big-endian
[5]     Current mode (0-3)
[6]     Flags: b0=anyRinging b1=is12h b2=settingMode b3=bleConn b4=wsConn
[7]     Timer state (0-3)
[8-11]  Stopwatch elapsed ms uint32 BE
[12-15] Timer remaining ms uint32 BE
[16]    Timer init minutes
[17]    Timer init seconds
[18]    Timer set field (0-2)
[19]    Timezone offset (signed int8)
[20]    Setting position (0-3)
[21]    Stopwatch state (0-2)
[22]    Ringing alarm slot (0xFF = none)
[23]    Lap count
[24]    Alarm view slot (0-3)
[25]    Alarm edit field (0-2)
[26]    Timer init hours
[27]    Buzzer volume (0-255)   ← firmware 2.1.0+ (0 on older builds)
[28-33] Reserved (0)
```

---

## Webapp Integration (WebSocket — recommended)

```javascript
const ws = new WebSocket('ws://192.168.4.1:81');

ws.onmessage = (e) => {
  const state = JSON.parse(e.data);
  // state.epoch, state.alarms[], state.tmrMs, etc.
};

// Sync time on connect
ws.onopen = () => {
  const epoch = Math.floor(Date.now() / 1000);
  const tz = -new Date().getTimezoneOffset() / 60;
  ws.send(`SYNC:${epoch},${tz}`);
};

// Set an alarm
ws.send('SET_ALARM:0,7,30,1,127');

// Dismiss
ws.send('DISMISS_ALARM:0');
```

---

## Webapp Integration (BLE — Chrome/Edge only)

```javascript
const device = await navigator.bluetooth.requestDevice({
  filters: [{ name: 'RTC-Clock-V2' }],
  optionalServices: ['4fafc201-1fb5-459e-8fcc-c5c9c331914b']
});
const server  = await device.gatt.connect();
const service = await server.getPrimaryService('4fafc201-1fb5-459e-8fcc-c5c9c331914b');
const char    = await service.getCharacteristic('beb5483e-36e1-4688-b7f5-ea07361b26a8');

await char.startNotifications();
char.addEventListener('characteristicvaluechanged', (e) => {
  const data = e.target.value; // DataView, 34 bytes
  const proto  = data.getUint8(0);
  const epoch  = data.getUint32(1);
  const mode   = data.getUint8(5);
  // etc.
});

// Send a command
const enc = new TextEncoder();
await char.writeValue(enc.encode('SYNC:' + Math.floor(Date.now()/1000) + ',0'));
```

---

## Pin Summary

The OLED is driven as an **SH1106 128x64 over hardware I2C**
(`U8G2_SH1106_128X64_NONAME_F_HW_I2C`). If your panel is an **SSD1306**
the image will look shifted or garbled — swap the constructor to
`U8G2_SSD1306_128X64_NONAME_F_HW_I2C`.

The buzzer is driven with LEDC PWM so the app's volume slider works, which
assumes a **passive** buzzer. An active buzzer generates its own tone and
will only respond to on/off, not to the volume setting.

| Pin | Function |
|---|---|
| 8 | SDA (OLED) |
| 9 | SCL (OLED) |
| 3 | Buzzer |
| 4 | Alarm button |
| 5 | UP button |
| 6 | DOWN button |
| 7 | MODE button |

All buttons wired to GND with INPUT_PULLUP (active LOW).
