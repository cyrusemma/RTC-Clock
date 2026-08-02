// js/app.js
import { connect, disconnect, sendCommand, bleState } from './ble.js';
import { initUI, updateConnectionState, appendLog, updateState, els, renderWorldClock, renderAnalogueClock } from './ui.js';

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
    
    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });

    // Analogue / Digital Clock Toggle
    let analogueMode = false;
    document.getElementById('btn-clock-toggle').addEventListener('click', () => {
        analogueMode = !analogueMode;
        if (analogueMode) {
            els.clockDigital.classList.add('hidden');
            els.clockAnalogue.classList.remove('hidden');
        } else {
            els.clockDigital.classList.remove('hidden');
            els.clockAnalogue.classList.add('hidden');
        }
    });

    // Independent browser clock / offline analogue clock
    // (Runs when not connected so analogue view still works)
    setInterval(() => {
        const now = new Date();
        els.browserClock.textContent = `This device: ${now.toLocaleTimeString([], { hour12: false })}`;
        if (!bleState.connected) {
            renderWorldClock(Math.floor(now.getTime() / 1000));
            if (analogueMode) {
                renderAnalogueClock(Math.floor(now.getTime() / 1000), -(new Date().getTimezoneOffset() / 60));
            }
        }
    }, 1000);
    // Initial call
    els.browserClock.textContent = `This device: ${new Date().toLocaleTimeString([], { hour12: false })}`;
    renderWorldClock(Math.floor(Date.now() / 1000));
    
    // Connection
    els.connectBtn.addEventListener('click', () => {
        if (bleState.connected) {
            disconnect(updateConnectionState, appendLog);
        } else {
            connect(updateConnectionState, wrappedUpdateState, appendLog);
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

    // ─── Scroll Picker Factory ────────────────────────────────────────────────
    function initScrollPicker(el, initialValue, onCommit) {
        const min = parseInt(el.dataset.min);
        const max = parseInt(el.dataset.max);
        let currentValue = initialValue;
        let startY = 0;
        let startValue = initialValue;
        let dragging = false;
        let commitTimer = null;
        const displayEl = el.nextElementSibling; // .picker-value

        // Visual center-line
        const line = document.createElement('div');
        line.className = 'picker-center-line';
        el.appendChild(line);

        const update = (val) => {
            currentValue = Math.max(min, Math.min(max, val));
            if (displayEl) displayEl.textContent = String(currentValue).padStart(2, '0');
        };

        const scheduleCommit = () => {
            clearTimeout(commitTimer);
            commitTimer = setTimeout(() => onCommit(currentValue), 800);
        };

        const pointerDown = (y) => {
            dragging = true;
            startY = y;
            startValue = currentValue;
            clearTimeout(commitTimer);
        };

        const pointerMove = (y) => {
            if (!dragging) return;
            const steps = Math.round((startY - y) / 30);
            const newVal = Math.max(min, Math.min(max, startValue + steps));
            if (newVal !== currentValue) {
                update(newVal);
                if (navigator.vibrate) navigator.vibrate(8);
            }
        };

        const pointerUp = () => {
            if (dragging) { dragging = false; scheduleCommit(); }
        };

        el.addEventListener('touchstart', e => pointerDown(e.touches[0].clientY), { passive: true });
        el.addEventListener('touchmove', e => pointerMove(e.touches[0].clientY), { passive: true });
        el.addEventListener('touchend', pointerUp);
        el.addEventListener('mousedown', e => { pointerDown(e.clientY); e.preventDefault(); });
        window.addEventListener('mousemove', e => pointerMove(e.clientY));
        window.addEventListener('mouseup', pointerUp);

        update(initialValue);
        return { getValue: () => currentValue, setValue: update };
    }

    // Alarm pickers
    let alarmDraft = { h: 0, m: 0 };
    const alarmPickerH = initScrollPicker(
        document.getElementById('alarm-picker-hour'), 0,
        v => { alarmDraft.h = v; }
    );
    const alarmPickerM = initScrollPicker(
        document.getElementById('alarm-picker-min'), 0,
        v => { alarmDraft.m = v; }
    );
    document.getElementById('btn-alarm-set').addEventListener('click', () => {
        alarmDraft.h = alarmPickerH.getValue();
        alarmDraft.m = alarmPickerM.getValue();
        sendCommand(`SET_ALARM:${String(alarmDraft.h).padStart(2,'0')},${String(alarmDraft.m).padStart(2,'0')},1`, appendLog);
    });
    document.getElementById('btn-alarm-enable').addEventListener('click', () => {
        sendCommand('BTN:ALARM', appendLog); // cycles enable/disable in firmware
    });

    // Timer pickers
    let timerDraft = { min: 0, sec: 0 };
    const timerPickerMin = initScrollPicker(
        document.getElementById('timer-picker-min'), 0,
        v => { timerDraft.min = v; }
    );
    const timerPickerSec = initScrollPicker(
        document.getElementById('timer-picker-sec'), 0,
        v => { timerDraft.sec = v; }
    );
    document.getElementById('btn-timer-set').addEventListener('click', () => {
        timerDraft.min = timerPickerMin.getValue();
        timerDraft.sec = timerPickerSec.getValue();
        sendCommand(`SET_TIMER:${String(timerDraft.min).padStart(2,'0')},${String(timerDraft.sec).padStart(2,'0')}`, appendLog);
    });

    // ─── Web Audio Alarm ──────────────────────────────────────────────────────
    let audioCtx = null;
    let alarmInterval = null;
    let lastAlarmState = false;

    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playAlarmSound() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        [880, 660].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0, now + i * 0.3);
            gain.gain.linearRampToValueAtTime(0.18, now + i * 0.3 + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.3 + 0.28);
            osc.start(now + i * 0.3);
            osc.stop(now + i * 0.3 + 0.3);
        });
    }

    function startAlarm() {
        if (alarmInterval) return;
        playAlarmSound();
        alarmInterval = setInterval(playAlarmSound, 700);
    }

    function stopAlarm() {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }

    // Hook alarm state changes by wrapping updateState
    const _origUpdateState = updateState;
    const wrappedUpdateState = (state) => {
        _origUpdateState(state);
        const alarmActive = state.alarmRinging || state.tmrState === 3;
        if (alarmActive && !lastAlarmState) startAlarm();
        if (!alarmActive && lastAlarmState) stopAlarm();
        lastAlarmState = alarmActive;
    };

    // Re-wire BLE to use our wrapped state handler
    connect.__stateCallback = wrappedUpdateState;

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
