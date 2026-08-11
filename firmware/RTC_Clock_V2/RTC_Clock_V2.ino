// ============================================================================
// ESP32-C3 RTC ALARM CLOCK — FIRMWARE V2.0
// ============================================================================
// Transport:   BLE (notify + write)  AND  WiFi WebSocket (ws://192.168.4.1/ws)
// Web UI:      Served from SPIFFS at http://192.168.4.1
// Features:    4 alarms, snooze, 8 laps, NTP sync, full bidirectional control
// Protocol:    All commands are plain-text strings (same over BLE and WebSocket)
//              Telemetry is a 34-byte binary packet over BLE (NOTIFY) and
//              a JSON string over WebSocket (TEXT frame) every 250 ms
// ============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <time.h>
#include <sys/time.h>
#include <Preferences.h>

// WiFi / WebSocket
#include <WiFi.h>
#include <WiFiAP.h>
#include <WebServer.h>
#include <WebSocketsServer.h>

// NTP
#include "esp_sntp.h"

// BLE
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ============================================================================
// COMPILE-TIME CONFIGURATION
// ============================================================================
#define FW_VERSION        "2.0.0"
#define PROTOCOL_VERSION  2

// WiFi AP credentials — change these to whatever you want
#define WIFI_AP_SSID      "RTC-Clock"
#define WIFI_AP_PASSWORD  "12345678"   // min 8 chars; set "" for open network

// NTP — used if you also join a router in STA mode (optional)
#define NTP_SERVER        "pool.ntp.org"

// BLE UUIDs (kept from V1 so existing apps still pair)
#define SERVICE_UUID          "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_TELEMETRY_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26a8"  // READ | NOTIFY | WRITE
#define CHAR_ALARM_LIST_UUID  "cba1d466-344c-4be3-ab3f-189f80dd7518"  // READ (alarm list)
#define CHAR_LAPS_UUID        "d1a7c123-4561-47ab-a9bc-9a7e6a1bcdef"  // READ (laps)

// Hardware
#define SDA_PIN           8
#define SCL_PIN           9
#define BUZZER_PIN        3
#define ALARM_BUTTON_PIN  4
#define UP_BUTTON_PIN     5
#define DOWN_BUTTON_PIN   6
#define MODE_BUTTON_PIN   7

#define LONG_PRESS_MS     1500
#define DEBOUNCE_MS       50
#define TELEMETRY_MS      250   // how often we push state

// Snooze
#define SNOOZE_MINUTES    5

// ---- LEDC PWM Buzzer (Volume Control) ----
#define BUZZER_LEDC_CHANNEL   0
#define BUZZER_LEDC_FREQ_HZ   2000    // Alarm carrier freq in Hz
#define BUZZER_LEDC_RES_BITS  8       // 8-bit resolution (0-255 volume scale)
#define BUZZER_VOLUME_DEFAULT 180     // Default safe volume

enum BuzzerPattern {
  BUZZ_OFF_PAT = 0,
  BUZZ_ALARM,        // Urgent double beep
  BUZZ_TIMER,        // Continuous single tone
  BUZZ_SNOOZE_BLIP   // Confirm blip
};

BuzzerPattern currentBuzzPattern = BUZZ_OFF_PAT;
unsigned long buzzPatternStart = 0;
bool          snoozeBlipDone   = false;
uint8_t       buzzerVolume     = BUZZER_VOLUME_DEFAULT;

// ============================================================================
// ENUMS
// ============================================================================
enum AppMode    { MODE_CLOCK, MODE_STOPWATCH, MODE_ALARM_SET, MODE_TIMER };
enum SwState    { SW_STOPPED, SW_RUNNING, SW_PAUSED };
enum TmrState   { TMR_STOPPED, TMR_RUNNING, TMR_PAUSED, TMR_RINGING };

// ============================================================================
// ALARM STRUCT  (4 slots)
// ============================================================================
#define MAX_ALARMS 8
struct Alarm {
  uint8_t  hour;
  uint8_t  minute;
  bool     enabled;
  bool     snoozeActive;
  uint8_t  snoozeHour;
  uint8_t  snoozeMin;
  uint8_t  repeatDays;  // bitmask: bit0=Sun … bit6=Sat, 0x7F = every day
};
Alarm alarms[MAX_ALARMS];
int8_t   ringAlarmIdx = -1;   // which alarm slot is currently ringing (-1 = none)

// UI state for alarm editing
int  alarmViewSlot  = 0;   // which slot is currently shown on OLED (0-7)
int  alarmEditField = 0;   // 0=view, 1=hour, 2=min, 3=enabled

// ============================================================================
// STOPWATCH
// ============================================================================
#define MAX_LAPS 8
SwState         sw_state      = SW_STOPPED;
unsigned long   sw_start_ms   = 0;
unsigned long   sw_elapsed_ms = 0;
unsigned long   laps[MAX_LAPS];
uint8_t         lapCount      = 0;

// ============================================================================
// COUNTDOWN TIMER
// ============================================================================
TmrState      tmr_state        = TMR_STOPPED;
int           tmr_init_hr      = 0;
int           tmr_init_min     = 5;
int           tmr_init_sec     = 0;
int           tmr_set_field    = 0;   // 0=view, 1=hr, 2=min, 3=sec
unsigned long tmr_target_ms    = 0;
unsigned long tmr_remaining_ms = 300000;

// ============================================================================
// CLOCK & GLOBAL STATE
// ============================================================================
AppMode  currentAppMode  = MODE_CLOCK;
bool     setting_mode    = false;
int      setting_pos     = 0;    // 0=hour 1=min 2=sec 3=tz
bool     is_12h          = false;
int      tz_offset       = 0;   // UTC offset in hours
struct tm setting_time;

// ============================================================================
// HARDWARE OBJECTS
// ============================================================================
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);
Preferences prefs;

// ============================================================================
// NETWORK OBJECTS
// ============================================================================
WebServer        httpServer(80);
WebSocketsServer wsServer(81);
bool             wsClientConnected = false;
uint8_t          wsClientNum       = 0;

// ============================================================================
// BLE OBJECTS
// ============================================================================
BLEServer*         pServer          = nullptr;
BLECharacteristic* pCharTelemetry   = nullptr;
BLECharacteristic* pCharAlarmList   = nullptr;
BLECharacteristic* pCharLaps        = nullptr;
bool               bleConnected     = false;

// ============================================================================
// TIMING
// ============================================================================
unsigned long lastTelemetry = 0;

// ============================================================================
// LOGGING
// ============================================================================
void logEvent(const char* msg) {
  Serial.printf("[%lu] %s\n", millis(), msg);
}
void logEvent(const String& msg) { logEvent(msg.c_str()); }

// ============================================================================
// SETTINGS PERSISTENCE
// ============================================================================
void loadSettings() {
  prefs.begin("clk2", true);
  is_12h    = prefs.getBool("12h", false);
  tz_offset = prefs.getChar("tz", 0);
  tmr_init_hr  = prefs.getUChar("tmh", 0);
  tmr_init_min = prefs.getUChar("tmm", 5);
  tmr_init_sec = prefs.getUChar("tms", 0);
  buzzerVolume = prefs.getUChar("vol", BUZZER_VOLUME_DEFAULT);
  for (int i = 0; i < MAX_ALARMS; i++) {
    char key[8];
    snprintf(key, sizeof(key), "ah%d", i);  alarms[i].hour       = prefs.getUChar(key, 7);
    snprintf(key, sizeof(key), "am%d", i);  alarms[i].minute     = prefs.getUChar(key, 0);
    snprintf(key, sizeof(key), "ae%d", i);  alarms[i].enabled    = prefs.getBool(key, false);
    snprintf(key, sizeof(key), "ar%d", i);  alarms[i].repeatDays = prefs.getUChar(key, 0x7F);
    alarms[i].snoozeActive = false;
  }
  prefs.end();
  tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
}

void saveSettings() {
  prefs.begin("clk2", false);
  prefs.putBool("12h", is_12h);
  prefs.putChar("tz",  (int8_t)tz_offset);
  prefs.putUChar("tmh", tmr_init_hr);
  prefs.putUChar("tmm", tmr_init_min);
  prefs.putUChar("tms", tmr_init_sec);
  prefs.putUChar("vol", buzzerVolume);
  for (int i = 0; i < MAX_ALARMS; i++) {
    char key[8];
    snprintf(key, sizeof(key), "ah%d", i);  prefs.putUChar(key, alarms[i].hour);
    snprintf(key, sizeof(key), "am%d", i);  prefs.putUChar(key, alarms[i].minute);
    snprintf(key, sizeof(key), "ae%d", i);  prefs.putBool(key,  alarms[i].enabled);
    snprintf(key, sizeof(key), "ar%d", i);  prefs.putUChar(key, alarms[i].repeatDays);
  }
  prefs.end();
}
// ============================================================================
// BUZZER — PWM via LEDC (Core 3.0+ Compatible)
// ============================================================================
void buzzerRaw(bool on) {
  if (on) {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSIONVAL(3, 0, 0)
    ledcWrite(BUZZER_PIN, buzzerVolume);
#else
    ledcWrite(BUZZER_LEDC_CHANNEL, buzzerVolume);
#endif
  } else {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSIONVAL(3, 0, 0)
    ledcWrite(BUZZER_PIN, 0);
#else
    ledcWrite(BUZZER_LEDC_CHANNEL, 0);
#endif
  }
}

void setBuzzerPattern(BuzzerPattern p) {
  if (currentBuzzPattern == p) return;
  currentBuzzPattern = p;
  buzzPatternStart   = millis();
  snoozeBlipDone     = false;
  if (p == BUZZ_OFF_PAT) buzzerRaw(false);
}

void updateBuzzer() {
  if (currentBuzzPattern == BUZZ_OFF_PAT) {
    buzzerRaw(false);
    return;
  }
  unsigned long elapsed = millis() - buzzPatternStart;
  switch (currentBuzzPattern) {
    case BUZZ_ALARM: {
      unsigned long t = elapsed % 500;
      bool on = (t < 100) || (t >= 200 && t < 300);
      buzzerRaw(on);
      break;
    }
    case BUZZ_TIMER: {
      unsigned long t = elapsed % 1000;
      if (t < 800) {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSIONVAL(3, 0, 0)
        ledcWriteTone(BUZZER_PIN, 1000);
#else
        ledcWriteTone(BUZZER_LEDC_CHANNEL, 1000);
#endif
        buzzerRaw(true);
      } else {
        buzzerRaw(false);
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSIONVAL(3, 0, 0)
        ledcWriteTone(BUZZER_PIN, BUZZER_LEDC_FREQ_HZ);
#else
        ledcWriteTone(BUZZER_LEDC_CHANNEL, BUZZER_LEDC_FREQ_HZ);
#endif
      }
      break;
    }
    case BUZZ_SNOOZE_BLIP: {
      if (snoozeBlipDone) { buzzerRaw(false); return; }
      unsigned long t = elapsed;
      if      (t < 100)  buzzerRaw(true);
      else if (t < 200)  buzzerRaw(false);
      else if (t < 300)  buzzerRaw(true);
      else if (t < 400)  buzzerRaw(false);
      else {
        buzzerRaw(false);
        snoozeBlipDone = true;
        currentBuzzPattern = BUZZ_OFF_PAT;
      }
      break;
    }
    default:
      buzzerRaw(false);
      break;
  }
}

// ============================================================================
// UPDATE CLOCK FROM setting_time
// ============================================================================
void updateClock() {
  time_t t = mktime(&setting_time);
  struct timeval tv = { .tv_sec = t, .tv_usec = 0 };
  settimeofday(&tv, nullptr);
  logEvent("Clock updated manually");
}

// ============================================================================
// BUILD ALARM-LIST BLE PACKET  (MAX_ALARMS × 4 bytes = 16 bytes)
// [slot×4+0] hour  [slot×4+1] minute  [slot×4+2] enabled|snooze  [slot×4+3] repeatDays
// ============================================================================
void refreshAlarmListChar() {
  uint8_t buf[MAX_ALARMS * 4];
  for (int i = 0; i < MAX_ALARMS; i++) {
    buf[i*4+0] = alarms[i].hour;
    buf[i*4+1] = alarms[i].minute;
    uint8_t flags = 0;
    if (alarms[i].enabled)     flags |= 0x01;
    if (alarms[i].snoozeActive) flags |= 0x02;
    buf[i*4+2] = flags;
    buf[i*4+3] = alarms[i].repeatDays;
  }
  if (pCharAlarmList) {
    pCharAlarmList->setValue(buf, sizeof(buf));
  }
}

// ============================================================================
// BUILD LAPS BLE PACKET  (lapCount × 4 bytes, up to 32 bytes)
// ============================================================================
void refreshLapsChar() {
  uint8_t buf[MAX_LAPS * 4];
  for (int i = 0; i < lapCount; i++) {
    uint32_t ms = (uint32_t)laps[i];
    buf[i*4+0] = (ms >> 24) & 0xFF;
    buf[i*4+1] = (ms >> 16) & 0xFF;
    buf[i*4+2] = (ms >> 8)  & 0xFF;
    buf[i*4+3] =  ms        & 0xFF;
  }
  if (pCharLaps) {
    pCharLaps->setValue(buf, lapCount * 4);
  }
}

// ============================================================================
// TELEMETRY — send current device state to all connected clients
// BLE: 34-byte binary packet via NOTIFY on pCharTelemetry
// WebSocket: JSON string TEXT frame
//
// Binary layout (34 bytes):
//  [0]     protocol version (2)
//  [1-4]   epoch uint32 big-endian
//  [5]     currentAppMode
//  [6]     flags: b0=anyAlarmRinging b1=is12h b2=settingMode b3=bleConn b4=wsConn
//  [7]     tmr_state
//  [8-11]  sw_elapsed_ms uint32 BE
//  [12-15] tmr_remaining_ms uint32 BE
//  [16]    tmr_init_min
//  [17]    tmr_init_sec
//  [18]    tmr_set_field
//  [19]    (int8) tz_offset
//  [20]    setting_pos
//  [21]    sw_state
//  [22]    ringAlarmIdx (0xFF = none)
//  [23]    lapCount
//  [24]    alarmViewSlot
//  [25]    alarmEditField
//  [26-33] reserved (zero)
// ============================================================================
void publishTelemetry(struct tm* now) {
  if (millis() - lastTelemetry < TELEMETRY_MS) return;
  lastTelemetry = millis();

  time_t epoch = mktime(now);

  // ---- BLE binary packet ----
  if (bleConnected && pCharTelemetry) {
    uint8_t p[34] = {};
    p[0]  = PROTOCOL_VERSION;
    p[1]  = (epoch >> 24) & 0xFF;
    p[2]  = (epoch >> 16) & 0xFF;
    p[3]  = (epoch >> 8)  & 0xFF;
    p[4]  =  epoch        & 0xFF;
    p[5]  = (uint8_t)currentAppMode;
    uint8_t fl = 0;
    if (ringAlarmIdx >= 0)  fl |= 0x01;
    if (is_12h)             fl |= 0x02;
    if (setting_mode)       fl |= 0x04;
    if (bleConnected)       fl |= 0x08;
    if (wsClientConnected)  fl |= 0x10;
    p[6]  = fl;
    p[7]  = (uint8_t)tmr_state;
    p[8]  = (sw_elapsed_ms >> 24) & 0xFF;
    p[9]  = (sw_elapsed_ms >> 16) & 0xFF;
    p[10] = (sw_elapsed_ms >> 8)  & 0xFF;
    p[11] =  sw_elapsed_ms        & 0xFF;
    p[12] = (tmr_remaining_ms >> 24) & 0xFF;
    p[13] = (tmr_remaining_ms >> 16) & 0xFF;
    p[14] = (tmr_remaining_ms >> 8)  & 0xFF;
    p[15] =  tmr_remaining_ms        & 0xFF;
    p[16] = (uint8_t)tmr_init_min;
    p[17] = (uint8_t)tmr_init_sec;
    p[18] = (uint8_t)tmr_set_field;
    p[19] = (uint8_t)(int8_t)tz_offset;
    p[20] = (uint8_t)setting_pos;
    p[21] = (uint8_t)sw_state;
    p[22] = (ringAlarmIdx >= 0) ? (uint8_t)ringAlarmIdx : 0xFF;
    p[23] = lapCount;
    p[24] = (uint8_t)alarmViewSlot;
    p[25] = (uint8_t)alarmEditField;
    p[26] = (uint8_t)tmr_init_hr;
    for (int i = 27; i < 34; i++) p[i] = 0;
    pCharTelemetry->setValue(p, sizeof(p));
    pCharTelemetry->notify();
  }

  // ---- WebSocket JSON ----
  if (wsClientConnected) {
    // Build alarm JSON inline (no heap alloc)
    char alarmJson[160];
    int  pos = 0;
    pos += snprintf(alarmJson + pos, sizeof(alarmJson) - pos, "[");
    for (int i = 0; i < MAX_ALARMS; i++) {
      pos += snprintf(alarmJson + pos, sizeof(alarmJson) - pos,
        "{\"h\":%d,\"m\":%d,\"en\":%s,\"sn\":%s,\"rep\":%d}%s",
        alarms[i].hour, alarms[i].minute,
        alarms[i].enabled ? "true" : "false",
        alarms[i].snoozeActive ? "true" : "false",
        alarms[i].repeatDays,
        (i < MAX_ALARMS - 1) ? "," : "");
    }
    pos += snprintf(alarmJson + pos, sizeof(alarmJson) - pos, "]");

    char lap_json[120];
    int lp = 0;
    lp += snprintf(lap_json + lp, sizeof(lap_json) - lp, "[");
    for (int i = 0; i < lapCount; i++) {
      lp += snprintf(lap_json + lp, sizeof(lap_json) - lp,
        "%lu%s", laps[i], (i < lapCount - 1) ? "," : "");
    }
    lp += snprintf(lap_json + lp, sizeof(lap_json) - lp, "]");

    char json[512];
    snprintf(json, sizeof(json),
      "{"
        "\"v\":%d,"
        "\"epoch\":%ld,"
        "\"mode\":%d,"
        "\"ringing\":%s,"
        "\"ringSlot\":%d,"
        "\"12h\":%s,"
        "\"setting\":%s,"
        "\"tz\":%d,"
        "\"settingPos\":%d,"
        "\"sw\":%d,"
        "\"swMs\":%lu,"
        "\"tmr\":%d,"
        "\"tmrMs\":%lu,"
        "\"tmrMin\":%d,"
        "\"tmrSec\":%d,"
        "\"tmrField\":%d,"
        "\"lapCount\":%d,"
        "\"laps\":%s,"
        "\"alarms\":%s,"
        "\"alarmSlot\":%d,"
        "\"alarmField\":%d"
      "}",
      PROTOCOL_VERSION,
      (long)epoch,
      (int)currentAppMode,
      (ringAlarmIdx >= 0) ? "true" : "false",
      ringAlarmIdx,
      is_12h ? "true" : "false",
      setting_mode ? "true" : "false",
      tz_offset,
      setting_pos,
      (int)sw_state,
      sw_elapsed_ms,
      (int)tmr_state,
      tmr_remaining_ms,
      tmr_init_min,
      tmr_init_sec,
      tmr_set_field,
      lapCount,
      lap_json,
      alarmJson,
      alarmViewSlot,
      alarmEditField
    );
    wsServer.sendTXT(wsClientNum, json);
  }
}

// ============================================================================
// COMMAND PARSER  (identical logic whether the source is BLE, WebSocket, or Serial)
// ============================================================================
void parseCommand(const String& raw) {
  String cmd = raw;
  cmd.trim();
  if (cmd.length() == 0) return;
  logEvent("CMD: " + cmd);

  // --- Virtual button presses ---
  if (cmd == "BTN:UP")              { doUpPress();         return; }
  if (cmd == "BTN:DOWN")            { doDownPress();       return; }
  if (cmd == "BTN:ALARM")           { doAlarmPress();      return; }
  if (cmd == "BTN:MODE_SHORT")      { doModeShortPress();  return; }
  if (cmd == "BTN:MODE_LONG")       { doModeLongPress();   return; }
  if (cmd == "BTN:LAP")             { doLapPress();        return; }
  if (cmd == "BTN:SNOOZE")          { doSnooze();          return; }

  // --- Mode override ---
  if (cmd.startsWith("MODE:")) {
    int m = cmd.substring(5).toInt();
    if (m >= 0 && m <= 3) { currentAppMode = (AppMode)m; }
    return;
  }

  // --- Time sync: SYNC:<epoch_unix>,<tz_offset> ---
  if (cmd.startsWith("SYNC:")) {
    int comma = cmd.indexOf(',', 5);
    if (comma > 0) {
      time_t ep = (time_t)cmd.substring(5, comma).toInt();
      tz_offset = cmd.substring(comma + 1).toInt();
      struct timeval tv = { .tv_sec = ep, .tv_usec = 0 };
      settimeofday(&tv, nullptr);
      saveSettings();
      logEvent("Time synced from client");
    }
    return;
  }

  // --- Set single alarm: SET_ALARM:<slot>,<hh>,<mm>,<enabled 0/1>,<repeatDays> ---
  if (cmd.startsWith("SET_ALARM:")) {
    String r = cmd.substring(10);
    int c[4];
    int prev = 0;
    for (int i = 0; i < 4; i++) {
      c[i] = r.indexOf(',', prev);
      if (c[i] < 0) return; // malformed
      prev = c[i] + 1;
    }
    int slot = r.substring(0, c[0]).toInt();
    if (slot < 0 || slot >= MAX_ALARMS) return;
    alarms[slot].hour       = r.substring(c[0]+1, c[1]).toInt();
    alarms[slot].minute     = r.substring(c[1]+1, c[2]).toInt();
    alarms[slot].enabled    = r.substring(c[2]+1, c[3]).toInt() != 0;
    alarms[slot].repeatDays = r.substring(c[3]+1).toInt();
    saveSettings();
    refreshAlarmListChar();
    return;
  }

  // --- Enable/disable alarm: ALARM_EN:<slot>,<0/1> ---
  if (cmd.startsWith("ALARM_EN:")) {
    int comma = cmd.indexOf(',', 9);
    if (comma > 0) {
      int slot = cmd.substring(9, comma).toInt();
      bool en  = cmd.substring(comma + 1).toInt() != 0;
      if (slot >= 0 && slot < MAX_ALARMS) {
        alarms[slot].enabled = en;
        saveSettings();
        refreshAlarmListChar();
      }
    }
    return;
  }

  // --- Timer preset: SET_TIMER:<hr>,<min>,<sec> (or <min>,<sec>) ---
  if (cmd.startsWith("SET_TIMER:")) {
    int comma = cmd.indexOf(',', 10);
    if (comma > 0) {
      int comma2 = cmd.indexOf(',', comma + 1);
      if (comma2 > 0) {
        tmr_init_hr = cmd.substring(10, comma).toInt();
        tmr_init_min = cmd.substring(comma + 1, comma2).toInt();
        tmr_init_sec = cmd.substring(comma2 + 1).toInt();
      } else {
        tmr_init_hr = 0;
        tmr_init_min = cmd.substring(10, comma).toInt();
        tmr_init_sec = cmd.substring(comma + 1).toInt();
      }
      tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
      saveSettings();
    }
    return;
  }

  // --- Reset timer: RESET_TIMER ---
  if (cmd == "RESET_TIMER") {
    tmr_state = TMR_STOPPED;
    tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
    setBuzzerPattern(BUZZ_OFF_PAT);
    logEvent("Timer reset command received");
    return;
  }

  // --- Time format: SET_TIMEFORMAT:<12|24> ---
  if (cmd.startsWith("SET_TIMEFORMAT:")) {
    is_12h = cmd.substring(15).toInt() == 12;
    saveSettings();
    return;
  }

  // --- Timezone: SET_TIMEZONE:<-12..14> ---
  if (cmd.startsWith("SET_TIMEZONE:")) {
    int tz = cmd.substring(13).toInt();
    if (tz >= -12 && tz <= 14) { tz_offset = tz; saveSettings(); }
    return;
  }

  // --- Dismiss alarm: DISMISS_ALARM:<slot> ---
  if (cmd.startsWith("DISMISS_ALARM:")) {
    int slot = cmd.substring(14).toInt();
    if (slot == ringAlarmIdx) {
      ringAlarmIdx = -1;
      setBuzzerPattern(BUZZ_OFF_PAT);
      logEvent("Alarm dismissed via app");
    }
    return;
  }

  // --- Snooze: SNOOZE:<slot> ---
  if (cmd.startsWith("SNOOZE:")) {
    int slot = cmd.substring(7).toInt();
    if (slot == ringAlarmIdx && slot >= 0 && slot < MAX_ALARMS) {
      doSnooze();
    }
    return;
  }

  // --- Volume: SET_VOLUME:<0-255> ---
  if (cmd.startsWith("SET_VOLUME:")) {
    int v = cmd.substring(11).toInt();
    if (v < 0)   v = 0;
    if (v > 255) v = 255;
    buzzerVolume = (uint8_t)v;
    saveSettings();
    logEvent("Volume set to " + String(buzzerVolume));
    return;
  }

  // --- Buzz test: BUZZ_TEST ---
  if (cmd == "BUZZ_TEST") {
    setBuzzerPattern(BUZZ_ALARM);
    logEvent("Buzz test started — send BUZZ_OFF to stop");
    return;
  }

  // --- Silence: BUZZ_OFF ---
  if (cmd == "BUZZ_OFF") {
    setBuzzerPattern(BUZZ_OFF_PAT);
    logEvent("Buzzer silenced");
    return;
  }

  logEvent("Unknown command: " + cmd);
}

// ============================================================================
// ACTION FUNCTIONS  (called by BOTH processButtons AND parseCommand)
// ============================================================================

void doModeShortPress() {
  if (setting_mode) {
    setting_pos++;
    if (setting_pos > 3) { updateClock(); setting_mode = false; }
  } else {
    switch (currentAppMode) {
      case MODE_CLOCK:      currentAppMode = MODE_STOPWATCH; break;
      case MODE_STOPWATCH:  currentAppMode = MODE_ALARM_SET; alarmEditField = 0; break;
      case MODE_ALARM_SET:  currentAppMode = MODE_TIMER; tmr_set_field = 0; break;
      case MODE_TIMER:      currentAppMode = MODE_CLOCK; break;
    }
    logEvent("Mode changed");
  }
}

void doModeLongPress() {
  if (currentAppMode == MODE_CLOCK && !setting_mode) {
    setting_mode = true;
    time_t now = time(nullptr);
    setting_time = *localtime(&now);
    setting_pos = 0;
    logEvent("Entered clock-set mode");
  }
}

void doUpPress() {
  switch (currentAppMode) {
    case MODE_CLOCK:
      if (setting_mode) {
        if      (setting_pos == 0) setting_time.tm_hour = (setting_time.tm_hour + 1) % 24;
        else if (setting_pos == 1) setting_time.tm_min  = (setting_time.tm_min  + 1) % 60;
        else if (setting_pos == 2) setting_time.tm_sec  = (setting_time.tm_sec  + 1) % 60;
        else if (setting_pos == 3) { tz_offset++; if (tz_offset > 14) tz_offset = -12; saveSettings(); }
      }
      break;
    case MODE_STOPWATCH:
      if (sw_state != SW_RUNNING) {
        sw_start_ms = millis() - sw_elapsed_ms;
        sw_state = SW_RUNNING;
        logEvent("Stopwatch started");
      }
      break;
    case MODE_ALARM_SET:
      if      (alarmEditField == 1) { alarms[alarmViewSlot].hour   = (alarms[alarmViewSlot].hour   + 1) % 24; saveSettings(); refreshAlarmListChar(); }
      else if (alarmEditField == 2) { alarms[alarmViewSlot].minute = (alarms[alarmViewSlot].minute + 1) % 60; saveSettings(); refreshAlarmListChar(); }
      else if (alarmEditField == 0) { alarmViewSlot = (alarmViewSlot + 1) % MAX_ALARMS; } // scroll through slots
      break;
    case MODE_TIMER:
      if (tmr_set_field == 1) {
        tmr_init_hr = (tmr_init_hr + 1) % 24;
        tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        saveSettings();
      } else if (tmr_set_field == 2) {
        tmr_init_min = (tmr_init_min + 1) % 100;
        tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        saveSettings();
      } else if (tmr_set_field == 3) {
        tmr_init_sec = (tmr_init_sec + 1) % 60;
        tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        saveSettings();
      } else if (tmr_set_field == 0 && (tmr_state == TMR_STOPPED || tmr_state == TMR_PAUSED)) {
        if (tmr_remaining_ms > 0) {
          tmr_target_ms = millis() + tmr_remaining_ms;
          tmr_state = TMR_RUNNING;
          logEvent("Timer started");
        }
      }
      break;
  }
}

void doDownPress() {
  switch (currentAppMode) {
    case MODE_CLOCK:
      if (setting_mode) {
        if      (setting_pos == 0) setting_time.tm_hour = (setting_time.tm_hour + 23) % 24;
        else if (setting_pos == 1) setting_time.tm_min  = (setting_time.tm_min  + 59) % 60;
        else if (setting_pos == 2) setting_time.tm_sec  = (setting_time.tm_sec  + 59) % 60;
        else if (setting_pos == 3) { tz_offset--; if (tz_offset < -12) tz_offset = 14; saveSettings(); }
      } else {
        is_12h = !is_12h;
        saveSettings();
      }
      break;
    case MODE_STOPWATCH:
      if (sw_state == SW_RUNNING) { sw_state = SW_PAUSED; sw_elapsed_ms = millis() - sw_start_ms; logEvent("Stopwatch paused"); }
      break;
    case MODE_ALARM_SET:
      if      (alarmEditField == 0) { alarmViewSlot = (alarmViewSlot + MAX_ALARMS - 1) % MAX_ALARMS; }
      else if (alarmEditField == 1) { alarms[alarmViewSlot].hour   = (alarms[alarmViewSlot].hour   + 23) % 24; saveSettings(); refreshAlarmListChar(); }
      else if (alarmEditField == 2) { alarms[alarmViewSlot].minute = (alarms[alarmViewSlot].minute + 59) % 60; saveSettings(); refreshAlarmListChar(); }
      break;
    case MODE_TIMER:
      if (tmr_set_field == 1) {
        tmr_init_hr = (tmr_init_hr + 23) % 24;
        tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        saveSettings();
      } else if (tmr_set_field == 2) {
        tmr_init_min = (tmr_init_min + 99) % 100;
        tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        saveSettings();
      } else if (tmr_set_field == 3) {
        tmr_init_sec = (tmr_init_sec + 59) % 60;
        tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        saveSettings();
      } else if (tmr_set_field == 0) {
        if (tmr_state == TMR_RUNNING) {
          tmr_state = TMR_PAUSED;
          logEvent("Timer paused");
        } else if (tmr_state == TMR_PAUSED || tmr_state == TMR_STOPPED) {
          tmr_state = TMR_STOPPED;
          tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
        }
      }
      break;
  }
}

void doAlarmPress() {
  if (ringAlarmIdx >= 0) {
    // Dismiss ringing alarm
    ringAlarmIdx = -1;
    setBuzzerPattern(BUZZ_OFF_PAT);
    logEvent("Alarm dismissed (button)");
    return;
  }
  if (tmr_state == TMR_RINGING) {
    tmr_state = TMR_STOPPED;
    tmr_remaining_ms = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
    setBuzzerPattern(BUZZ_OFF_PAT);
    logEvent("Timer dismissed");
    return;
  }
  switch (currentAppMode) {
    case MODE_STOPWATCH:
      sw_state = SW_STOPPED;
      sw_elapsed_ms = 0;
      lapCount = 0;
      logEvent("Stopwatch reset");
      break;
    case MODE_ALARM_SET:
      // Cycle: view → editHour → editMin → toggle enabled → view
      alarmEditField = (alarmEditField + 1) % 4;
      if (alarmEditField == 3) {
        alarms[alarmViewSlot].enabled = !alarms[alarmViewSlot].enabled;
        saveSettings();
        refreshAlarmListChar();
        alarmEditField = 0;
      }
      break;
    case MODE_TIMER:
      if (tmr_state == TMR_STOPPED || tmr_state == TMR_PAUSED) {
        tmr_set_field = (tmr_set_field + 1) % 4;
      }
      break;
    default: break;
  }
}

void doLapPress() {
  if (currentAppMode == MODE_STOPWATCH && sw_state == SW_RUNNING) {
    if (lapCount < MAX_LAPS) {
      laps[lapCount++] = sw_elapsed_ms;
      refreshLapsChar();
      logEvent("Lap recorded");
    }
  }
}

void doSnooze() {
  if (ringAlarmIdx < 0) return;
  int slot = ringAlarmIdx;
  // Set snooze time = now + SNOOZE_MINUTES
  time_t now = time(nullptr);
  time_t adjusted = now + (tz_offset * 3600);
  struct tm *t = localtime(&adjusted);
  int snoozeMin = (t->tm_min + SNOOZE_MINUTES) % 60;
  int snoozeHour = t->tm_hour + (t->tm_min + SNOOZE_MINUTES) / 60;
  snoozeHour = snoozeHour % 24;
  alarms[slot].snoozeActive = true;
  alarms[slot].snoozeHour   = snoozeHour;
  alarms[slot].snoozeMin    = snoozeMin;
  ringAlarmIdx = -1;
  setBuzzerPattern(BUZZ_SNOOZE_BLIP);
  logEvent("Alarm snoozed");
}

// ============================================================================
// PHYSICAL BUTTON HANDLER
// ============================================================================
void processButtons() {
  static bool last_up = HIGH, last_dn = HIGH, last_alm = HIGH, last_mode = HIGH;
  static unsigned long modePress = 0;
  static bool modeLongDone = false;

  bool r_up   = digitalRead(UP_BUTTON_PIN);
  bool r_dn   = digitalRead(DOWN_BUTTON_PIN);
  bool r_alm  = digitalRead(ALARM_BUTTON_PIN);
  bool r_mode = digitalRead(MODE_BUTTON_PIN);

  // MODE: long vs short
  if (r_mode == LOW) {
    if (last_mode == HIGH) { modePress = millis(); modeLongDone = false; }
    else if (!modeLongDone && millis() - modePress >= LONG_PRESS_MS) {
      modeLongDone = true;
      doModeLongPress();
    }
  } else if (last_mode == LOW) {
    if (!modeLongDone) doModeShortPress();
  }
  last_mode = r_mode;

  static unsigned long debounceMs = 0;
  if (millis() - debounceMs > DEBOUNCE_MS) {
    if (last_up  == HIGH && r_up  == LOW) { 
      if (ringAlarmIdx >= 0) { doSnooze(); }
      else { doUpPress(); }
      debounceMs = millis(); 
    }
    if (last_dn  == HIGH && r_dn  == LOW) { 
      if (ringAlarmIdx >= 0) { doSnooze(); }
      else { doDownPress(); }
      debounceMs = millis(); 
    }
    if (last_alm == HIGH && r_alm == LOW) { doAlarmPress(); debounceMs = millis(); }
    last_up  = r_up;
    last_dn  = r_dn;
    last_alm = r_alm;
  }
}
// ============================================================================
// ALARM CHECK  (called every loop iteration)
// ============================================================================
void checkAlarms(struct tm* now) {
  if (ringAlarmIdx >= 0) return; // already ringing, don't trigger another

  for (int i = 0; i < MAX_ALARMS; i++) {
    if (!alarms[i].enabled) continue;

    // Check snooze
    if (alarms[i].snoozeActive) {
      if (now->tm_hour == alarms[i].snoozeHour && now->tm_min == alarms[i].snoozeMin && now->tm_sec == 0) {
        alarms[i].snoozeActive = false;
        ringAlarmIdx = i;
        setBuzzerPattern(BUZZ_ALARM);
        logEvent("Snooze alarm triggered");
      }
      continue;
    }

    // Check normal alarm
    if (now->tm_hour == alarms[i].hour && now->tm_min == alarms[i].minute && now->tm_sec == 0) {
      // Check repeat days (bit 0 = Sunday … bit 6 = Saturday; 0 = one-shot only)
      bool shouldRing = false;
      if (alarms[i].repeatDays == 0) {
        shouldRing = true;         // one-shot: always fire then auto-disable
        alarms[i].enabled = false;
        saveSettings();
      } else {
        uint8_t wday = now->tm_wday; // 0=Sun
        shouldRing = (alarms[i].repeatDays >> wday) & 0x01;
      }
      if (shouldRing) {
        ringAlarmIdx = i;
        setBuzzerPattern(BUZZ_ALARM);
        logEvent("Alarm triggered: slot " + String(i));
      }
    }
  }
}

// ============================================================================
// OLED DRAW HELPERS
// ============================================================================

// Draw a small highlight box behind the currently-edited field
void drawEditBox(int x, int y, int w, int h) {
  u8g2.drawRBox(x - 1, y - h + 2, w + 2, h + 1, 2);
}

void drawClock(struct tm* disp) {
  char ts[16], ds[14], tzs[8];

  if (is_12h) {
    int h12 = disp->tm_hour % 12; if (h12 == 0) h12 = 12;
    const char* ap = disp->tm_hour >= 12 ? "PM" : "AM";
    snprintf(ts, sizeof(ts), "%02d:%02d:%02d%s", h12, disp->tm_min, disp->tm_sec, ap);
  } else {
    snprintf(ts, sizeof(ts), "%02d:%02d:%02d", disp->tm_hour, disp->tm_min, disp->tm_sec);
  }
  snprintf(ds, sizeof(ds), "%04d-%02d-%02d", disp->tm_year+1900, disp->tm_mon+1, disp->tm_mday);
  snprintf(tzs, sizeof(tzs), "UTC%+d", tz_offset);

  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 12, "CLOCK");
  // Status bar right
  if (bleConnected && wsClientConnected) u8g2.drawStr(80, 12, "BLE+WiFi");
  else if (bleConnected)                 u8g2.drawStr(100, 12, "BLE");
  else if (wsClientConnected)            u8g2.drawStr(97, 12, "WiFi");
  u8g2.drawLine(0, 14, 128, 14);

  u8g2.setFont(u8g2_font_logisoso18_tf);

  if (setting_mode) {
    // Draw highlight box over the currently-edited field
    // Approximate x positions for HH : MM : SS in logisoso18
    const int xH = 2, xM = 35, xS = 68, xTZ = 2;
    if (setting_pos == 0) { u8g2.setDrawColor(0); drawEditBox(xH, 45, 26, 18); u8g2.setDrawColor(1); }
    if (setting_pos == 1) { u8g2.setDrawColor(0); drawEditBox(xM, 45, 26, 18); u8g2.setDrawColor(1); }
    if (setting_pos == 2) { u8g2.setDrawColor(0); drawEditBox(xS, 45, 26, 18); u8g2.setDrawColor(1); }
  }

  u8g2.drawStr(2, 45, ts);

  u8g2.setFont(u8g2_font_6x10_tf);
  if (setting_mode && setting_pos == 3) {
    u8g2.drawStr(0, 60, "TZ:"); u8g2.drawStr(20, 60, tzs);
  } else {
    u8g2.drawStr(0, 60, ds);
    u8g2.drawStr(90, 60, is_12h ? "12H" : "24H");
    if (!setting_mode) u8g2.drawStr(0, 60, ds);
    u8g2.drawStr(100, 12, tzs);
  }
}

void drawStopwatch() {
  unsigned long total_sec = sw_elapsed_ms / 1000;
  char ts[12];
  snprintf(ts, sizeof(ts), "%02lu:%02lu.%02lu",
           (total_sec / 60) % 100, total_sec % 60, (sw_elapsed_ms % 1000) / 10);

  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 12, "STOPWATCH");
  const char* stStr = sw_state == SW_RUNNING ? "RUN" : sw_state == SW_PAUSED ? "PAUSE" : "READY";
  u8g2.drawStr(90, 12, stStr);
  if (lapCount > 0) {
    char lc[8]; snprintf(lc, sizeof(lc), "L:%d", lapCount);
    u8g2.drawStr(110, 12, lc);
  }
  u8g2.drawLine(0, 14, 128, 14);

  u8g2.setFont(u8g2_font_logisoso18_tf);
  u8g2.drawStr(5, 45, ts);

  u8g2.setFont(u8g2_font_6x10_tf);
  // Show last lap if available
  if (lapCount > 0) {
    unsigned long lastLap = laps[lapCount - 1];
    char lts[14];
    unsigned long ls = lastLap / 1000;
    snprintf(lts, sizeof(lts), "LAP%d %02lu:%02lu.%02lu", lapCount,
             (ls / 60) % 100, ls % 60, (lastLap % 1000) / 10);
    u8g2.drawStr(0, 60, lts);
  } else {
    u8g2.drawStr(0, 60, "UP:GO DN:PAUSE ALM:RST");
  }
}

void drawAlarmSet() {
  Alarm &a = alarms[alarmViewSlot];
  char ts[6];
  snprintf(ts, sizeof(ts), "%02d:%02d", a.hour, a.minute);

  u8g2.setFont(u8g2_font_6x10_tf);
  char hdr[16]; snprintf(hdr, sizeof(hdr), "ALARM A%d/A%d", alarmViewSlot+1, MAX_ALARMS);
  u8g2.drawStr(0, 12, hdr);
  u8g2.drawStr(90, 12, a.enabled ? (a.snoozeActive ? "SNZ" : "ON") : "OFF");
  u8g2.drawLine(0, 14, 128, 14);

  u8g2.setFont(u8g2_font_logisoso18_tf);

  if (alarmEditField == 1) { u8g2.setDrawColor(0); drawEditBox(28, 45, 26, 18); u8g2.setDrawColor(1); }
  if (alarmEditField == 2) { u8g2.setDrawColor(0); drawEditBox(64, 45, 26, 18); u8g2.setDrawColor(1); }

  u8g2.drawStr(28, 45, ts);

  u8g2.setFont(u8g2_font_6x10_tf);
  if      (alarmEditField == 1) u8g2.drawStr(10, 60, "EDITING: HOUR");
  else if (alarmEditField == 2) u8g2.drawStr(10, 60, "EDITING: MIN");
  else                          u8g2.drawStr(0,  60, "UP/DN:SLOT ALM:EDIT");
}

void drawTimer() {
  char ts[16];
  if (tmr_set_field != 0) {
    snprintf(ts, sizeof(ts), "%02d:%02d:%02d", tmr_init_hr, tmr_init_min, tmr_init_sec);
  } else {
    unsigned long rem = tmr_remaining_ms;
    unsigned long s   = rem / 1000;
    snprintf(ts, sizeof(ts), "%02lu:%02lu:%02lu", (s/3600), (s/60)%60, s%60);
  }

  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 12, "TIMER");
  const char* stStr = tmr_state == TMR_RINGING ? "DONE!" :
                      tmr_state == TMR_RUNNING  ? "RUN"   :
                      tmr_state == TMR_PAUSED   ? "PAUSE" : "READY";
  u8g2.drawStr(90, 12, stStr);
  u8g2.drawLine(0, 14, 128, 14);

  // Progress bar (only when running/paused and total > 0)
  unsigned long total = (((tmr_init_hr * 60UL) + tmr_init_min) * 60UL + tmr_init_sec) * 1000UL;
  if (total > 0 && tmr_set_field == 0) {
    int barW = (int)((128.0f * tmr_remaining_ms) / total);
    u8g2.drawBox(0, 50, barW, 4);
  }

  u8g2.setFont(u8g2_font_logisoso18_tf);
  if (tmr_set_field == 1) { u8g2.setDrawColor(0); drawEditBox(0, 45, 26, 18); u8g2.setDrawColor(1); }
  if (tmr_set_field == 2) { u8g2.setDrawColor(0); drawEditBox(36, 45, 26, 18); u8g2.setDrawColor(1); }
  if (tmr_set_field == 3) { u8g2.setDrawColor(0); drawEditBox(72, 45, 26, 18); u8g2.setDrawColor(1); }
  u8g2.drawStr(0, 45, ts);

  u8g2.setFont(u8g2_font_6x10_tf);
  if      (tmr_set_field == 1) u8g2.drawStr(10, 63, "EDITING: HR");
  else if (tmr_set_field == 2) u8g2.drawStr(10, 63, "EDITING: MIN");
  else if (tmr_set_field == 3) u8g2.drawStr(10, 63, "EDITING: SEC");
  else                         u8g2.drawStr(0,  63, "UP:GO DN:PAUSE");
}

// ============================================================================
// BLE CALLBACKS
// ============================================================================
class BLECharCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue();
    if (v.length() > 0) parseCommand(v);
  }
};
class BLEServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*)    override { bleConnected = true;  logEvent("BLE connected");    }
  void onDisconnect(BLEServer*) override { bleConnected = false; logEvent("BLE disconnected"); BLEDevice::startAdvertising(); }
};

// ============================================================================
// WEBSOCKET CALLBACK
// ============================================================================
void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsClientConnected = true;
      wsClientNum = num;
      logEvent("WebSocket client connected");
      // Send immediate telemetry so app syncs fast
      lastTelemetry = 0;
      break;
    case WStype_DISCONNECTED:
      wsClientConnected = false;
      logEvent("WebSocket client disconnected");
      break;
    case WStype_TEXT:
      parseCommand(String((char*)payload));
      break;
    default: break;
  }
}

// ============================================================================
// HTTP — serve a minimal redirect page; full UI will be SPIFFS in a later phase
// ============================================================================
void setupHTTP() {
  httpServer.on("/", []() {
    httpServer.send(200, "text/html",
      "<!DOCTYPE html><html><head>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>RTC Clock</title>"
      "<style>body{font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#eee}"
      "h1{color:#0df}p{color:#aaa}</style></head><body>"
      "<h1>RTC Clock V2</h1>"
      "<p>Connect your webapp to <b>ws://192.168.4.1:81</b> for real-time control.</p>"
      "<p>Firmware: " FW_VERSION " | Protocol: " + String(PROTOCOL_VERSION) + "</p>"
      "</body></html>");
  });
  httpServer.begin();
  logEvent("HTTP server started on port 80");
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(300);
  logEvent("=== RTC Clock V2.0 booting ===");

  // GPIO
  Wire.setPins(SDA_PIN, SCL_PIN);
  Wire.begin();

  // ---- LEDC PWM for transistor-driven buzzer ----
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSIONVAL(3, 0, 0)
  ledcAttach(BUZZER_PIN, BUZZER_LEDC_FREQ_HZ, BUZZER_LEDC_RES_BITS);
  ledcWrite(BUZZER_PIN, 0);  // off at startup
#else
  ledcSetup(BUZZER_LEDC_CHANNEL, BUZZER_LEDC_FREQ_HZ, BUZZER_LEDC_RES_BITS);
  ledcAttachPin(BUZZER_PIN, BUZZER_LEDC_CHANNEL);
  ledcWrite(BUZZER_LEDC_CHANNEL, 0);  // off at startup
#endif

  pinMode(ALARM_BUTTON_PIN, INPUT_PULLUP);
  pinMode(UP_BUTTON_PIN,    INPUT_PULLUP);
  pinMode(DOWN_BUTTON_PIN,  INPUT_PULLUP);
  pinMode(MODE_BUTTON_PIN,  INPUT_PULLUP);

  // OLED
  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 20, "RTC Clock V2.0");
  u8g2.drawStr(0, 35, "Starting WiFi...");
  u8g2.sendBuffer();

  // Load settings
  loadSettings();

  // ---- WiFi AP ----
  WiFi.mode(WIFI_AP);
  if (strlen(WIFI_AP_PASSWORD) >= 8) {
    WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
  } else {
    WiFi.softAP(WIFI_AP_SSID); // open
  }
  delay(500);
  IPAddress myIP = WiFi.softAPIP();
  logEvent("WiFi AP started. IP: " + myIP.toString());

  // WebSocket server
  wsServer.begin();
  wsServer.onEvent(onWsEvent);
  logEvent("WebSocket server started on port 81");

  // HTTP server
  setupHTTP();

  // ---- BLE ----
  u8g2.clearBuffer();
  u8g2.drawStr(0, 20, "RTC Clock V2.0");
  u8g2.drawStr(0, 35, "Starting BLE...");
  u8g2.sendBuffer();

  BLEDevice::init("RTC-Clock-V2");
  BLEDevice::setMTU(247);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new BLEServerCB());

  BLEService* svc = pServer->createService(BLEUUID(SERVICE_UUID), 30);

  // Main telemetry char (read + notify + write)
  pCharTelemetry = svc->createCharacteristic(
    CHAR_TELEMETRY_UUID,
    BLECharacteristic::PROPERTY_READ    |
    BLECharacteristic::PROPERTY_WRITE   |
    BLECharacteristic::PROPERTY_WRITE_NR|
    BLECharacteristic::PROPERTY_NOTIFY  |
    BLECharacteristic::PROPERTY_INDICATE
  );
  pCharTelemetry->addDescriptor(new BLE2902());
  pCharTelemetry->setCallbacks(new BLECharCB());

  // Alarm list char (read-only, polled by app on connect)
  pCharAlarmList = svc->createCharacteristic(
    CHAR_ALARM_LIST_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  refreshAlarmListChar();

  // Laps char (read-only)
  pCharLaps = svc->createCharacteristic(
    CHAR_LAPS_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  refreshLapsChar();

  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  // ---- Default clock time (overridden by SYNC: from app) ----
  struct tm t = {};
  t.tm_year = 2026 - 1900; t.tm_mon = 6; t.tm_mday = 1;
  t.tm_hour = 12; t.tm_min = 0; t.tm_sec = 0;
  time_t ep = mktime(&t);
  struct timeval tv = { .tv_sec = ep, .tv_usec = 0 };
  settimeofday(&tv, nullptr);

  tmr_remaining_ms = ((tmr_init_min * 60UL) + tmr_init_sec) * 1000UL;

  // Boot complete display
  u8g2.clearBuffer();
  u8g2.drawStr(0, 20, "RTC Clock V2.0");
  char ipStr[24]; snprintf(ipStr, sizeof(ipStr), "WiFi: %s", myIP.toString().c_str());
  u8g2.drawStr(0, 35, ipStr);
  u8g2.drawStr(0, 50, "BLE: RTC-Clock-V2");
  u8g2.sendBuffer();
  delay(2000);

  logEvent("=== Boot complete ===");
}

// ============================================================================
// LOOP
// ============================================================================
void loop() {
  // Service network
  httpServer.handleClient();
  wsServer.loop();

  // Physical buttons
  processButtons();

  // Serial commands (bench testing)
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    parseCommand(line);
  }

  // Compute adjusted time
  time_t raw     = time(nullptr);
  time_t adj     = raw + ((time_t)tz_offset * 3600);
  struct tm* now = localtime(&adj);

  // Alarm check
  checkAlarms(now);

  // Timer engine
  if (tmr_state == TMR_RUNNING) {
    unsigned long ms = millis();
    if (ms >= tmr_target_ms) {
      tmr_remaining_ms = 0;
      tmr_state = TMR_RINGING;
      setBuzzerPattern(BUZZ_TIMER);
      logEvent("Timer finished");
    } else {
      tmr_remaining_ms = tmr_target_ms - ms;
    }
  }

  // Stopwatch engine
  if (sw_state == SW_RUNNING) {
    sw_elapsed_ms = millis() - sw_start_ms;
  }

  // Buzzer — driven by pattern engine
  updateBuzzer();

  // OLED Refresh Rate Limiter
  static unsigned long lastOledUpdate = 0;
  unsigned int oledInterval = 200; // default 5 FPS
  if (currentAppMode == MODE_STOPWATCH && sw_state == SW_RUNNING) {
    oledInterval = 33; // 30 FPS for smooth stopwatch count
  } else if (tmr_state == TMR_RINGING || ringAlarmIdx >= 0) {
    oledInterval = 100; // 10 FPS for alarm notifications
  }
  
  if (millis() - lastOledUpdate >= oledInterval) {
    lastOledUpdate = millis();
    u8g2.clearBuffer();
    switch (currentAppMode) {
      case MODE_CLOCK:
        drawClock(setting_mode ? &setting_time : now);
        break;
      case MODE_STOPWATCH:
        drawStopwatch();
        break;
      case MODE_ALARM_SET:
        drawAlarmSet();
        break;
      case MODE_TIMER:
        drawTimer();
        break;
    }
    // Ringing overlay
    if ((ringAlarmIdx >= 0 || tmr_state == TMR_RINGING) && (millis() / 500) % 2 == 0) {
      u8g2.setFont(u8g2_font_6x10_tf);
      u8g2.setDrawColor(1);
      const char* msg = (ringAlarmIdx >= 0) ? "!!! ALARM !!!" : "!!! TIMER !!!";
      u8g2.drawStr(24, 64, msg);
    }
    u8g2.sendBuffer();
  }

  // Telemetry (BLE + WebSocket)
  publishTelemetry(now);
}
