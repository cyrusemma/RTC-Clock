// js/app.js
import { connect, disconnect, sendCommand, bleState, readAlarms, readLaps } from './ble.js';
import { connectWS, disconnectWS, sendCommandWS, wsState } from './ws.js';
import { initUI, updateConnectionState, appendLog, updateState, els, renderWorldClock, renderAnalogueClock, renderAlarmCards } from './ui.js';

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
            // Render immediately if not waiting for BLE tick
            if (!bleState || !bleState.connected) {
                renderAnalogueClock(Math.floor(Date.now() / 1000), -(new Date().getTimezoneOffset() / 60));
            }
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
    
    // Command Router
    function sendCmd(cmd) {
        if (wsState.connected) {
            sendCommandWS(cmd, appendLog);
        } else if (bleState.connected) {
            sendCommand(cmd, appendLog);
        } else {
            appendLog('Error: Not connected', 'sys');
        }
    }

    // Connection
    els.connectBtn.addEventListener('click', () => {
        if (bleState.connected) {
            disconnect(updateConnectionState, appendLog);
        } else {
            connect(updateConnectionState, wrappedUpdateState, appendLog);
        }
    });

    const wifiConnectBtn = document.getElementById('wifi-connect-btn');
    if (wifiConnectBtn) {
        wifiConnectBtn.addEventListener('click', () => {
            if (wsState.connected) {
                disconnectWS(updateConnectionState, appendLog);
                wifiConnectBtn.textContent = 'WiFi Connect';
            } else {
                connectWS(updateConnectionState, wrappedUpdateState, appendLog);
                wifiConnectBtn.textContent = 'WiFi Disconnect';
            }
        });
    }

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
            sendCmd(`MODE:${tab.dataset.mode}`);
        });
    });

    // Clock
    document.getElementById('btn-sync').addEventListener('click', () => {
        const epoch = Math.floor(Date.now() / 1000);
        const tz = -(new Date().getTimezoneOffset() / 60);
        sendCmd(`SYNC:${epoch},${tz}`);
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
    let alarmDraft = { h: 0, m: 0, en: 0, rep: 0, slot: 0 };
    const alarmPickerH = initScrollPicker(
        document.getElementById('alarm-picker-hour'), 0,
        v => { alarmDraft.h = v; }
    );
    const alarmPickerM = initScrollPicker(
        document.getElementById('alarm-picker-min'), 0,
        v => { alarmDraft.m = v; }
    );
    
    // Day Repeat Buttons
    const dayBtns = document.querySelectorAll('.day-btn');
    dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const day = parseInt(btn.dataset.day);
            btn.classList.toggle('active');
            if (btn.classList.contains('active')) {
                alarmDraft.rep |= (1 << day);
            } else {
                alarmDraft.rep &= ~(1 << day);
            }
        });
    });

    els.alarmCancelBtn.addEventListener('click', () => {
        els.alarmEditor.classList.add('hidden');
    });

    document.getElementById('btn-alarm-set').addEventListener('click', () => {
        alarmDraft.h = alarmPickerH.getValue();
        alarmDraft.m = alarmPickerM.getValue();
        sendCmd(`SET_ALARM:${alarmDraft.slot},${String(alarmDraft.h).padStart(2,'0')},${String(alarmDraft.m).padStart(2,'0')},${alarmDraft.en ? 1 : 0},${alarmDraft.rep}`);
        els.alarmEditor.classList.add('hidden');
    });

    // Alarm Cards Click
    els.alarmCardsContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.alarm-card');
        if (!card) return;
        const slot = parseInt(card.dataset.slot);
        
        // Find existing alarm data if any
        let existing = null;
        if (bleState.connected && lastBleState && lastBleState.alarms) {
            existing = lastBleState.alarms[slot];
        } else if (wsState.connected && lastBleState && lastBleState.alarms) {
            existing = lastBleState.alarms[slot];
        }

        alarmDraft.slot = slot;
        if (existing) {
            alarmDraft.h = existing.h;
            alarmDraft.m = existing.m;
            alarmDraft.en = existing.en ? 1 : 0;
            alarmDraft.rep = existing.rep;
        }

        alarmPickerH.setValue(alarmDraft.h);
        alarmPickerM.setValue(alarmDraft.m);
        els.alarmEditSlotLabel.textContent = `(Slot ${slot + 1})`;
        
        dayBtns.forEach(btn => {
            const day = parseInt(btn.dataset.day);
            if (alarmDraft.rep & (1 << day)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        els.alarmEditor.classList.remove('hidden');
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
        sendCmd(`SET_TIMER:${String(timerDraft.min).padStart(2,'0')},${String(timerDraft.sec).padStart(2,'0')}`);
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
    let isFetchingAlarms = false;
    let isFetchingLaps = false;
    let lastBleState = null;

    const wrappedUpdateState = async (state) => {
        lastBleState = state;
        
        // Inject BLE alarms/laps if missing
        if (bleState.connected) {
            if (!state.alarms && !isFetchingAlarms) {
                isFetchingAlarms = true;
                state.alarms = await readAlarms();
                isFetchingAlarms = false;
            }
            if (state.lapCount > 0 && (!state.laps || state.laps.length !== state.lapCount) && !isFetchingLaps) {
                isFetchingLaps = true;
                state.laps = await readLaps(state.lapCount);
                isFetchingLaps = false;
            }
        }
        
        _origUpdateState(state);
        const alarmActive = state.alarmRinging || state.tmrState === 3;
        if (alarmActive && !lastAlarmState) startAlarm();
        if (!alarmActive && lastAlarmState) stopAlarm();
        lastAlarmState = alarmActive;
    };

    // Re-wire BLE to use our wrapped state handler
    // (WS already uses wrappedUpdateState from its connect call)

    // Stopwatch
    document.getElementById('btn-sw-start').addEventListener('click', () => sendCmd('BTN:UP'));
    document.getElementById('btn-sw-pause').addEventListener('click', () => sendCmd('BTN:DOWN'));
    document.getElementById('btn-sw-lap').addEventListener('click', () => sendCmd('BTN:LAP'));
    document.getElementById('btn-sw-reset').addEventListener('click', () => sendCmd('BTN:ALARM'));

    function setupHoldToRepeat(btn, cmd) {
        let holdTimeout;
        let holdInterval;

        const start = (e) => {
            if (e.type === 'touchstart') e.preventDefault();
            sendCmd(cmd);
            holdTimeout = setTimeout(() => {
                holdInterval = setInterval(() => sendCmd(cmd), 120);
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
    if (els.alarmSnoozeBtn) {
        els.alarmSnoozeBtn.addEventListener('click', () => {
            if (lastBleState && lastBleState.ringingSlot !== undefined && lastBleState.ringingSlot !== 0xFF) {
                sendCmd(`SNOOZE:${lastBleState.ringingSlot}`);
            } else {
                sendCmd('BTN:SNOOZE');
            }
        });
    }
    document.getElementById('btn-alarm-dismiss').addEventListener('click', () => sendCmd('BTN:ALARM'));

    // Timer
    setupHoldToRepeat(document.getElementById('btn-timer-up'), 'BTN:UP');
    setupHoldToRepeat(document.getElementById('btn-timer-down'), 'BTN:DOWN');
    document.getElementById('btn-timer-cycle').addEventListener('click', () => sendCmd('BTN:ALARM'));
    document.getElementById('btn-timer-stop').addEventListener('click', () => sendCmd('BTN:ALARM'));
});
