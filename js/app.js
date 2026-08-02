// js/app.js
import { connect, disconnect, sendCommand, bleState } from './ble.js';
import { initUI, updateConnectionState, appendLog, updateState, els, renderWorldClock } from './ui.js';

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('Service Worker registered', reg);
        }).catch(err => {
            console.error('Service Worker registration failed', err);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    
    // Live Browser Clock and Initial World Clock
    setInterval(() => {
        const now = new Date();
        els.browserClock.textContent = `This device: ${now.toLocaleTimeString([], { hour12: false })}`;
        if (!bleState.connected) {
            renderWorldClock(Math.floor(now.getTime() / 1000));
        }
    }, 1000);
    // Initial call
    els.browserClock.textContent = `This device: ${new Date().toLocaleTimeString([], { hour12: false })}`;
    renderWorldClock(Math.floor(Date.now() / 1000));
    
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

    function setupHoldToRepeat(btn, cmd) {
        let holdTimeout;
        let holdInterval;

        const start = (e) => {
            if (e.type === 'touchstart') e.preventDefault();
            sendCommand(cmd, appendLog);
            holdTimeout = setTimeout(() => {
                holdInterval = setInterval(() => sendCommand(cmd, appendLog), 120);
            }, 400);
        };
        const stop = () => {
            clearTimeout(holdTimeout);
            clearInterval(holdInterval);
        };

        btn.addEventListener('mousedown', start);
        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('mouseup', stop);
        btn.addEventListener('mouseleave', stop);
        btn.addEventListener('touchend', stop);
        btn.addEventListener('touchcancel', stop);
    }

    // Alarm
    document.getElementById('btn-alarm-cycle').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));
    setupHoldToRepeat(document.getElementById('btn-alarm-up'), 'BTN:UP');
    setupHoldToRepeat(document.getElementById('btn-alarm-down'), 'BTN:DOWN');
    document.getElementById('btn-alarm-dismiss').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));

    // Timer
    document.getElementById('btn-timer-cycle').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));
    setupHoldToRepeat(document.getElementById('btn-timer-up'), 'BTN:UP');
    setupHoldToRepeat(document.getElementById('btn-timer-down'), 'BTN:DOWN');
    document.getElementById('btn-timer-stop').addEventListener('click', () => sendCommand('BTN:ALARM', appendLog));
});
