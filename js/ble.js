// js/ble.js
/*
 * FIRMWARE COMPATIBILITY REQUIREMENT
 * The connected firmware MUST have a write-enabled BLE characteristic 
 * (PROPERTY_WRITE + PROPERTY_WRITE_NR) with an onWrite() handler.
 * If the firmware only has notify/read, buttons in this webapp will do nothing!
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const ALARM_CHAR_UUID = 'cba1d466-344c-4be3-ab3f-189f80dd7518';
const LAPS_CHAR_UUID = 'd1a7c123-4561-47ab-a9bc-9a7e6a1bcdef';

let bluetoothDevice = null;
let characteristic = null;
let alarmCharacteristic = null;
let lapsCharacteristic = null;

export const bleState = {
    connected: false,
    deviceName: ''
};

const textEncoder = new TextEncoder();

/*
 * Web Bluetooth runs one GATT operation at a time per device. Firing a read
 * while a write is still in flight rejects with "GATT operation already in
 * progress", which showed up as dropped commands and half-loaded alarm lists.
 * Funnel every read and write through this queue so they take turns.
 */
let gattQueue = Promise.resolve();
function withGatt(op) {
    const run = gattQueue.then(op, op);
    // Keep the chain alive even when an operation rejects
    gattQueue = run.then(() => {}, () => {});
    return run;
}

export async function connect(onStateChange, onDataReceived, onLog) {
    try {
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: 'RTC-Clock-V2' }
            ],
            optionalServices: [SERVICE_UUID]
        });
        
        bleState.deviceName = bluetoothDevice.name;
        onStateChange('connecting');
        
        bluetoothDevice.addEventListener('gattserverdisconnected', () => {
            bleState.connected = false;
            characteristic = null;
            alarmCharacteristic = null;
            lapsCharacteristic = null;
            onStateChange('disconnected');
            onLog('Device disconnected', 'sys');
        });

        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        characteristic = await service.getCharacteristic(CHAR_UUID);
        try {
            alarmCharacteristic = await service.getCharacteristic(ALARM_CHAR_UUID);
            lapsCharacteristic = await service.getCharacteristic(LAPS_CHAR_UUID);
        } catch (e) {
            console.warn("Could not find V2 characteristics, might be V1 firmware", e);
        }
        
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const dataView = event.target.value;
            const len = dataView.byteLength;

            if (len < 25) {
                console.warn(`BLE RX: Packet too short (${len} bytes), ignoring.`);
                onLog(`RX Warning: Packet too short (${len} bytes), ignoring.`, 'sys');
                return;
            }

            const proto = dataView.getUint8(0);

            if (proto === 2 && len >= 34) {
                // ── V2 protocol (34-byte) ────────────────────────────────
                onDataReceived(parsePacketV2(dataView));
            } else if (proto === 1 && len >= 25) {
                // ── V1 protocol (25-byte) — fallback for older firmware ──
                console.info('BLE RX: V1 firmware detected, using fallback parser.');
                onDataReceived(parsePacketV1(dataView));
            } else {
                onLog(`RX Error: Unknown protocol v${proto} with ${len} bytes.`, 'sys');
            }
        });
        
        bleState.connected = true;
        onStateChange('connected');
        onLog(`Connected to ${bleState.deviceName}`, 'sys');
        
    } catch (error) {
        console.error(error);
        onStateChange('disconnected');
        onLog(`Connect Error: ${error.message}`, 'sys');
    }
}

export async function disconnect(onStateChange, onLog) {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    }
}

export async function sendCommand(cmd, onLog) {
    if (!characteristic) {
        onLog('Error: Not connected', 'sys');
        return;
    }
    try {
        const data = textEncoder.encode(cmd);
        await withGatt(() => {
            if (characteristic.properties.writeWithoutResponse) {
                return characteristic.writeValueWithoutResponse(data);
            } else if (characteristic.properties.write) {
                return characteristic.writeValueWithResponse(data);
            }
            return characteristic.writeValue(data);
        });
        onLog(`TX: ${cmd}`, 'tx');
    } catch (error) {
        console.error(error);
        onLog(`TX Error: ${error.message}`, 'sys');
    }
}

export async function readAlarms() {
    if (!alarmCharacteristic) return null;
    try {
        const dv = await withGatt(() => alarmCharacteristic.readValue());
        // 4 slots × 4 bytes. A short read means a firmware mismatch, and
        // parsing it would throw halfway through and blank the list.
        if (dv.byteLength < 16) {
            console.warn(`Alarm characteristic too short (${dv.byteLength} bytes)`);
            return null;
        }
        const alarms = [];
        for (let i = 0; i < 4; i++) {
            const flags = dv.getUint8(i * 4 + 2);
            alarms.push({
                h: dv.getUint8(i * 4),
                m: dv.getUint8(i * 4 + 1),
                en: !!(flags & 0x01),
                sn: !!(flags & 0x02),
                rep: dv.getUint8(i * 4 + 3)
            });
        }
        return alarms;
    } catch (e) {
        console.error("Failed to read alarms", e);
        return null;
    }
}

export async function readLaps(count) {
    if (!lapsCharacteristic || count <= 0) return [];
    try {
        const dv = await withGatt(() => lapsCharacteristic.readValue());
        const laps = [];
        const readable = Math.floor(dv.byteLength / 4);
        for (let i = 0; i < count && i < 8 && i < readable; i++) {
            laps.push(dv.getUint32(i * 4, false)); // Big endian
        }
        return laps;
    } catch (e) {
        console.error("Failed to read laps", e);
        return [];
    }
}

// ── V2 Parser: 34-byte packet (firmware V2.0) ────────────────────────────────
function parsePacketV2(dv) {
    const protocolVersion = dv.getUint8(0);
    const epoch           = dv.getUint32(1, false);   // big-endian
    const mode            = dv.getUint8(5);
    const flags           = dv.getUint8(6);
    const tmrState        = dv.getUint8(7);
    const swElapsedMs     = dv.getUint32(8, false);
    const tmrRemainingMs  = dv.getUint32(12, false);
    const tmrInitMin      = dv.getUint8(16);
    const tmrInitSec      = dv.getUint8(17);
    const tmrSetField     = dv.getUint8(18);
    const timezoneOffset  = dv.getInt8(19);           // signed
    const settingPosition = dv.getUint8(20);
    const swState         = dv.getUint8(21);
    const ringingSlot     = dv.getUint8(22);          // 0xFF = none
    const lapCount        = dv.getUint8(23);
    const alarmViewSlot   = dv.getUint8(24);
    const alarmEditField  = dv.getUint8(25);
    const tmrInitHr       = dv.getUint8(26);          // firmware packs hours here
    // Volume added in firmware 2.1.0; older builds leave this byte as 0,
    // which would read as "muted", so fall back to the default.
    const rawVolume       = dv.getUint8(27);
    const buzzerVolume    = rawVolume === 0 ? 180 : rawVolume;
    // [28-33] reserved — ignored

    return {
        protocolVersion,
        epoch,
        mode,
        alarmRinging:    !!(flags & 0x01),
        is12hFormat:     !!(flags & 0x02),
        settingMode:     !!(flags & 0x04),
        bleConn:         !!(flags & 0x08),
        wsConn:          !!(flags & 0x10),
        tmrState,
        swElapsedMs,
        tmrRemainingMs,
        buzzerVolume,
        tmrInitHr,
        tmrInitMin,
        tmrInitSec,
        tmrSetField,
        timezoneOffset,
        settingPosition,
        swState,
        ringingSlot,
        lapCount,
        alarmViewSlot,
        alarmEditField
    };
}

// ── V1 Parser: 25-byte packet (firmware V1 — fallback) ───────────────────────
// Layout:
//  [0]     uint8   protocol version (1)
//  [1-4]   uint32  epoch big-endian
//  [5]     uint8   mode
//  [6]     uint8   flags: b0=alarmRinging b1=alarmEnabled b2=is12h b3=settingMode
//  [7]     uint8   timer state
//  [8]     uint8   alarm hour
//  [9]     uint8   alarm minute
//  [10]    uint8   alarm set field
//  [11]    uint8   stopwatch state
//  [12-15] uint32  stopwatch elapsed ms
//  [16-19] uint32  timer remaining ms
//  [20]    uint8   timer init minutes
//  [21]    uint8   timer init seconds
//  [22]    uint8   timer set field
//  [23]    int8    timezone offset
//  [24]    uint8   setting position
function parsePacketV1(dv) {
    const protocolVersion = dv.getUint8(0);
    const epoch           = dv.getUint32(1, false);
    const mode            = dv.getUint8(5);
    const flags           = dv.getUint8(6);
    const tmrState        = dv.getUint8(7);
    const swState         = dv.getUint8(11);
    const swElapsedMs     = dv.getUint32(12, false);
    const tmrRemainingMs  = dv.getUint32(16, false);
    const tmrInitMin      = dv.getUint8(20);
    const tmrInitSec      = dv.getUint8(21);
    const tmrSetField     = dv.getUint8(22);
    const timezoneOffset  = dv.getInt8(23);
    const settingPosition = dv.getUint8(24);

    return {
        protocolVersion,
        epoch,
        mode,
        alarmRinging:    !!(flags & 0x01),
        is12hFormat:     !!(flags & 0x04),
        settingMode:     !!(flags & 0x08),
        bleConn:         true,   // V1 doesn't report this; assume connected
        wsConn:          false,
        tmrState,
        swElapsedMs,
        tmrRemainingMs,
        tmrInitHr:      0,      // V1 has no timer-hours field
        tmrInitMin,
        tmrInitSec,
        tmrSetField,
        timezoneOffset,
        settingPosition,
        swState,
        ringingSlot:    0xFF,   // V1 doesn't have per-slot tracking
        lapCount:       0,
        alarmViewSlot:  0,
        alarmEditField: 0
    };
}
