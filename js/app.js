// js/app.js
import { connect, disconnect, sendCommand, bleState } from './ble.js';
import { initUI, updateConnectionState, appendLog, updateState, els } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    
    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });

    // Connection
    els.connectBtn.addEventListener('click', () => {
        if (bleState.connected) {
            disconnect(updateConnectionState, appendLog);
        } else {
            connect(updateConnectionState, updateState, appendLog);
        }
    });

    // WiFi Settings
    els.wifiBtn.addEventListener('click', () => {
        els.wifiModal.classList.remove('hidden');
    });

    els.wifiCancel.addEventListener('click', () => {
        els.wifiModal.classList.add('hidden');
    });

    els.wifiSend.addEventListener('click', () => {
        const ssid = els.wifiSsid.value;
        const pass = els.wifiPass.value;
        if (ssid) {
            sendCommand(`WIFI:${ssid},${pass}`, appendLog);
            els.wifiModal.classList.add('hidden');
            els.wifiSsid.value = '';
            els.wifiPass.value = '';
        }
    });

    // Tabs
    els.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            sendCommand(`MODE:${tab.dataset.mode}`, appendLog);
        });
    });

    // Clock
    document.getElementById('btn-sync').addEventListener('click', () => {
        const epoch = Math.floor(Date.now() / 1000);
        const tz = -(new Date().getTimezoneOffset() / 60);
        sendCommand(`SYNC:${epoch},${tz}`, appendLog);
    });

    // Stopwatch
    document.getElementById('btn-sw-start').addEventListener('click', () => sendCommand('BTN:UP', appendLog));
    document.getElementById('btn-sw-pause').addEventListener('click', () => sendCommand('BTN:DOWN', appendLog));
    document.getElementById('btn-sw-reset').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));

    // Alarm
    document.getElementById('btn-alarm-cycle').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));
    document.getElementById('btn-alarm-up').addEventListener('click', () => sendCommand('BTN:UP', appendLog));
    document.getElementById('btn-alarm-down').addEventListener('click', () => sendCommand('BTN:DOWN', appendLog));
    document.getElementById('btn-alarm-dismiss').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));

    // Timer
    document.getElementById('btn-timer-cycle').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));
    document.getElementById('btn-timer-up').addEventListener('click', () => sendCommand('BTN:UP', appendLog));
    document.getElementById('btn-timer-down').addEventListener('click', () => sendCommand('BTN:DOWN', appendLog));
    document.getElementById('btn-timer-stop').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));
});
