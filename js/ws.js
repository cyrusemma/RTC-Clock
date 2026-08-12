// js/ws.js

export const wsState = {
    connected: false
};

let ws = null;

let connectTimeout = null;

export function connectWS(onStateChange, onDataReceived, onLog) {
    if (ws) {
        ws.close();
    }

    // The clock speaks plain ws://, which a page served over HTTPS is not
    // allowed to open. This is the main way WiFi "does nothing" on an iPhone,
    // where it is the only transport available — so say it plainly.
    if (window.location.protocol === 'https:') {
        onStateChange('disconnected');
        onLog('WiFi blocked: this page is on HTTPS and the clock speaks ws://. Open the app over http:// (e.g. http://192.168.4.1) while joined to the clock\'s WiFi.', 'sys');
        return;
    }

    onStateChange('connecting');
    // Use window.location.hostname dynamically if available, otherwise default to ESP32 AP IP
    const host = (window.location && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.protocol !== 'file:')
        ? window.location.hostname
        : '192.168.4.1';

    try {
        ws = new WebSocket(`ws://${host}:81`);
    } catch (err) {
        ws = null;
        onStateChange('disconnected');
        onLog(`WiFi Error: ${err.message}`, 'sys');
        return;
    }

    // Without this the status sits on "Connecting..." forever when the phone
    // is not actually on the clock's network.
    clearTimeout(connectTimeout);
    connectTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            onLog(`No answer from ${host}:81 — check you are joined to the clock's WiFi.`, 'sys');
            ws.close();
        }
    }, 8000);

    ws.onopen = () => {
        clearTimeout(connectTimeout);
        wsState.connected = true;
        onStateChange('connected');
        onLog('Connected via WiFi', 'sys');
    };
    
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.v !== 2) {
                console.warn(`WS Protocol version mismatch: expected 2, got ${data.v}`);
            }
            
            // Map JSON to the exact same structure as BLE parsePacket
            const parsed = {
                protocolVersion: data.v,
                // The firmware's epoch field is really "true UTC + tz_offset"
                // (a bug shared by the BLE packet — see the long comment above
                // correctEpoch() in ble.js for the full explanation). Undo it
                // the same way here so both transports hand off genuine UTC.
                epoch: data.epoch - data.tz * 3600,
                mode: data.mode,
                alarmRinging: data.ringing,
                is12hFormat: data['12h'],
                settingMode: data.setting,
                tmrState: data.tmr,
                swElapsedMs: data.swMs,
                tmrRemainingMs: data.tmrMs,
                buzzerVolume: data.vol !== undefined ? data.vol : 180,
                // Older firmware (< 2.1.0) omits tmrHr; default to 0 so the
                // timer total does not compute as NaN.
                tmrInitHr: data.tmrHr !== undefined ? data.tmrHr : 0,
                tmrInitMin: data.tmrMin,
                tmrInitSec: data.tmrSec,
                tmrSetField: data.tmrField,
                timezoneOffset: data.tz,
                settingPosition: data.settingPos,
                swState: data.sw,
                ringingSlot: data.ringSlot,
                lapCount: data.lapCount,
                alarmViewSlot: data.alarmSlot,
                alarmEditField: data.alarmField,
                // WS specific (included for convenience since BLE needs to fetch these)
                alarms: data.alarms || [],
                laps: data.laps || []
            };
            
            onDataReceived(parsed);
        } catch (err) {
            onLog(`WS Parse Error: ${err.message}`, 'sys');
        }
    };
    
    ws.onclose = () => {
        clearTimeout(connectTimeout);
        wsState.connected = false;
        onStateChange('disconnected');
        onLog('WiFi disconnected', 'sys');
        ws = null;
    };
    
    ws.onerror = (err) => {
        onLog(`WS Error`, 'sys');
    };
}

export function disconnectWS(onStateChange, onLog) {
    if (ws) {
        ws.close();
    }
}

export function sendCommandWS(cmd, onLog) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        onLog('Error: WiFi Not connected', 'sys');
        return;
    }
    ws.send(cmd);
    onLog(`TX (WiFi): ${cmd}`, 'tx');
}
