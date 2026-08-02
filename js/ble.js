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

export async function connect(onStateChange, onDataReceived, onLog) {
    try {
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'RTC-Clock' }],
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
            if (dataView.byteLength === 34) {
                const parsed = parsePacket(dataView);
                if (parsed.protocolVersion !== 2) {
                    console.warn(`Protocol version mismatch: expected 2, got ${parsed.protocolVersion}`);
                }
                
                // We emit the parsed packet immediately.
                // We will rely on app.js to fetch alarms/laps periodically or trigger them.
                onDataReceived(parsed);
            } else {
                onLog(`RX Error: Received ${dataView.byteLength} bytes, expected 34`, 'sys');
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
        if (characteristic.properties.writeWithoutResponse) {
            await characteristic.writeValueWithoutResponse(data);
        } else if (characteristic.properties.write) {
            await characteristic.writeValueWithResponse(data);
        } else {
            await characteristic.writeValue(data);
        }
        onLog(`TX: ${cmd}`, 'tx');
    } catch (error) {
        console.error(error);
        onLog(`TX Error: ${error.message}`, 'sys');
    }
}

export async function readAlarms() {
    if (!alarmCharacteristic) return null;
    try {
        const dv = await alarmCharacteristic.readValue();
        const alarms = [];
        for (let i = 0; i < 4; i++) {
            alarms.push({
                h: dv.getUint8(i * 4),
                m: dv.getUint8(i * 4 + 1),
                en: dv.getUint8(i * 4 + 2) !== 0,
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
        const dv = await lapsCharacteristic.readValue();
        const laps = [];
        for (let i = 0; i < count && i < 8; i++) {
            laps.push(dv.getUint32(i * 4, false)); // Big endian
        }
        return laps;
    } catch (e) {
        console.error("Failed to read laps", e);
        return [];
    }
}

function parsePacket(dv) {
    const protocolVersion = dv.getUint8(0);
    const epoch = dv.getUint32(1, false);
    const mode = dv.getUint8(5);
    const flags = dv.getUint8(6);
    const tmrState = dv.getUint8(7);
    const swElapsedMs = dv.getUint32(8, false);
    const tmrRemainingMs = dv.getUint32(12, false);
    const tmrInitMin = dv.getUint8(16);
    const tmrInitSec = dv.getUint8(17);
    const tmrSetField = dv.getUint8(18);
    const timezoneOffset = dv.getInt8(19);
    const settingPosition = dv.getUint8(20);
    const swState = dv.getUint8(21);
    const ringingSlot = dv.getUint8(22);
    const lapCount = dv.getUint8(23);
    const alarmViewSlot = dv.getUint8(24);
    const alarmEditField = dv.getUint8(25);

    return {
        protocolVersion, epoch, mode,
        alarmRinging: !!(flags & 0b0001),
        is12hFormat: !!(flags & 0b0010),
        settingMode: !!(flags & 0b0100),
        bleConn: !!(flags & 0b1000),
        wsConn: !!(flags & 0b10000),
        tmrState, swElapsedMs, tmrRemainingMs,
        tmrInitMin, tmrInitSec, tmrSetField,
        timezoneOffset, settingPosition, swState,
        ringingSlot, lapCount, alarmViewSlot, alarmEditField
    };
}
