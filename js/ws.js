// js/ws.js

export const wsState = {
    connected: false
};

let ws = null;

export function connectWS(onStateChange, onDataReceived, onLog) {
    if (ws) {
        ws.close();
    }
    
    onStateChange('connecting');
    // Using the fixed IP of the ESP32 AP
    ws = new WebSocket('ws://192.168.4.1:81');
    
    ws.onopen = () => {
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
                epoch: data.epoch,
                mode: data.mode,
                alarmRinging: data.ringing,
                is12hFormat: data['12h'],
                settingMode: data.setting,
                tmrState: data.tmr,
                swElapsedMs: data.swMs,
                tmrRemainingMs: data.tmrMs,
                buzzerVolume: data.vol !== undefined ? data.vol : 180,
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
