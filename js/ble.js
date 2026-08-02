// js/ble.js
/*
 * FIRMWARE COMPATIBILITY REQUIREMENT
 * The connected firmware MUST have a write-enabled BLE characteristic 
 * (PROPERTY_WRITE + PROPERTY_WRITE_NR) with an onWrite() handler.
 * If the firmware only has notify/read, buttons in this webapp will do nothing!
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let bluetoothDevice = null;
let characteristic = null;

export const bleState = {
    connected: false,
    deviceName: ''
};

const textEncoder = new TextEncoder();

export async function connect(onStateChange, onDataReceived, onLog) {
    try {
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }]
        });
        
        bleState.deviceName = bluetoothDevice.name;
        onStateChange('connecting');
        
        bluetoothDevice.addEventListener('gattserverdisconnected', () => {
            bleState.connected = false;
            characteristic = null;
            onStateChange('disconnected');
            onLog('Device disconnected', 'sys');
        });

        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        characteristic = await service.getCharacteristic(CHAR_UUID);
        
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const dataView = event.target.value;
            if (dataView.byteLength === 25) {
                const parsed = parsePacket(dataView);
                // onLog('RX: 25 bytes', 'rx'); // Un-comment if too noisy
                if (parsed.protocolVersion !== 1) {
                    console.warn(`Protocol version mismatch: expected 1, got ${parsed.protocolVersion}`);
                }
                onDataReceived(parsed);
            } else {
                onLog(`RX Error: Received ${dataView.byteLength} bytes, expected 25`, 'sys');
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

function parsePacket(dv) {
    const protocolVersion = dv.getUint8(0);
    const epoch = dv.getUint32(1, false);
    const mode = dv.getUint8(5);
    const flags = dv.getUint8(6);
    const tmrState = dv.getUint8(7);
    const alarmHour = dv.getUint8(8);
    const alarmMin = dv.getUint8(9);
    const alarmSetField = dv.getUint8(10);
    const swState = dv.getUint8(11);
    const swElapsedMs = dv.getUint32(12, false);
    const tmrRemainingMs = dv.getUint32(16, false);
    const tmrInitMin = dv.getUint8(20);
    const tmrInitSec = dv.getUint8(21);
    const tmrSetField = dv.getUint8(22);
    const timezoneOffset = dv.getInt8(23);
    const settingPosition = dv.getUint8(24);

    return {
        protocolVersion, epoch, mode,
        alarmRinging: !!(flags & 0b0001),
        alarmEnabled: !!(flags & 0b0010),
        is12hFormat: !!(flags & 0b0100),
        settingMode: !!(flags & 0b1000),
        tmrState, alarmHour, alarmMin, alarmSetField,
        swState, swElapsedMs, tmrRemainingMs,
        tmrInitMin, tmrInitSec, tmrSetField,
        timezoneOffset, settingPosition
    };
}
