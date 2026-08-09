// js/app.js
import { connect, disconnect, sendCommand, bleState, readAlarms, readLaps } from './ble.js?v=4';
import { connectWS, disconnectWS, sendCommandWS, wsState } from './ws.js?v=4';
import { initUI, updateConnectionState, appendLog, updateState, els, renderWorldClock, renderAnalogueClock, renderAlarmCards, setActiveModeView } from './ui.js?v=4';

function sendCmd(cmd) {
    if (wsState.connected) {
        sendCommandWS(cmd, appendLog);
    } else if (bleState.connected) {
        sendCommand(cmd, appendLog);
    } else {
        appendLog('Error: Not connected', 'sys');
    }
}

window.selectMode = (mode) => {
    setActiveModeView(mode);
    sendCmd(`MODE:${mode}`);
};

els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        window.selectMode(parseInt(tab.dataset.mode));
    });
});

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

    // Fullscreen Toggle
    if (els.fullscreenToggle) {
        els.fullscreenToggle.addEventListener('click', () => {
            document.body.classList.toggle('fullscreen-mode');
        });
    }

    // PWA Install Prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        els.pwaInstallBanner.classList.remove('hidden');
    });
    if (els.btnPwaInstall) {
        els.btnPwaInstall.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    els.pwaInstallBanner.classList.add('hidden');
                }
                deferredPrompt = null;
            }
        });
    }
    els.pwaDismissBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            els.pwaInstallBanner.classList.add('hidden');
        });
    });

    // iOS Install Tooltip
    const isIos = () => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod/.test(userAgent);
    };
    const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);
    if (isIos() && !isInStandaloneMode()) {
        els.iosInstallTooltip.classList.remove('hidden');
    }
    if (els.btnIosDismiss) {
        els.btnIosDismiss.addEventListener('click', () => els.iosInstallTooltip.classList.add('hidden'));
    }

    // Notifications
    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
    document.body.addEventListener('click', requestNotificationPermission, { once: true });

    function showNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: 'icon.png' });
        }
    }

    // ── Dropdown toggle helper ─────────────────────────────────────────────
    function setupDropdown(btnId, menuId, wrapId) {
        const btn  = document.getElementById(btnId);
        const menu = document.getElementById(menuId);
        if (!btn || !menu) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            const wrap = document.getElementById(wrapId);
            if (wrap && !wrap.contains(e.target)) menu.classList.remove('open');
        });
    }
    setupDropdown('connect-menu-btn', 'connect-menu', 'connect-dropdown-wrap');
    setupDropdown('clock-settings-btn', 'clock-settings-menu', 'clock-settings-wrap');

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
    setInterval(() => {
        const now = new Date();
        els.browserClock.textContent = now.toLocaleTimeString([], { hour12: false });
        if (!bleState.connected) {
            renderWorldClock(Math.floor(now.getTime() / 1000));
            if (analogueMode) {
                renderAnalogueClock(Math.floor(now.getTime() / 1000), -(new Date().getTimezoneOffset() / 60));
            }
        }
    }, 1000);
    // Initial call
    els.browserClock.textContent = new Date().toLocaleTimeString([], { hour12: false });
    renderWorldClock(Math.floor(Date.now() / 1000));
    
    // BLE Connection (via dropdown)
    els.connectBtn.addEventListener('click', () => {
        document.getElementById('connect-menu').classList.remove('open');
        if (!navigator.bluetooth && !bleState.connected && !wsState.connected) {
            return;
        }
        if (bleState.connected) {
            disconnect(updateConnectionState, appendLog);
        } else {
            connect((state) => updateConnectionState(state, bleState.deviceName), wrappedUpdateState, appendLog);
        }
    });

    // WiFi Connection (via dropdown)
    const wifiConnectBtn = document.getElementById('wifi-connect-btn');
    if (wifiConnectBtn) {
        wifiConnectBtn.addEventListener('click', () => {
            document.getElementById('connect-menu').classList.remove('open');
            if (wsState.connected) {
                disconnectWS(updateConnectionState, appendLog);
            } else {
                connectWS((state) => updateConnectionState(state, 'WiFi'), wrappedUpdateState, appendLog);
            }
        });
    }

    // Clock settings dropdown buttons
    const btnModeShort = document.getElementById('btn-mode-short');
    const btnModeLong  = document.getElementById('btn-mode-long');
    const btnTzUp      = document.getElementById('btn-tz-up');
    const btnTzDown    = document.getElementById('btn-tz-down');
    if (btnModeShort) btnModeShort.addEventListener('click', () => { sendCmd('BTN:MODE_SHORT'); document.getElementById('clock-settings-menu').classList.remove('open'); });
    if (btnModeLong)  btnModeLong.addEventListener('click',  () => { sendCmd('BTN:MODE_LONG');  document.getElementById('clock-settings-menu').classList.remove('open'); });
    if (btnTzUp)      btnTzUp.addEventListener('click',      () => { sendCmd('BTN:UP');          document.getElementById('clock-settings-menu').classList.remove('open'); });
    if (btnTzDown)    btnTzDown.addEventListener('click',    () => { sendCmd('BTN:DOWN');        document.getElementById('clock-settings-menu').classList.remove('open'); });

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
    const alarmEnabledToggle = document.getElementById('alarm-enabled-toggle');
    const alarmPickerH = initScrollPicker(
        document.getElementById('alarm-picker-hour'), 0,
        v => { alarmDraft.h = v; }
    );
    const alarmPickerM = initScrollPicker(
        document.getElementById('alarm-picker-min'), 0,
        v => { alarmDraft.m = v; }
    );

    function refreshAlarmEnabledToggle() {
        if (!alarmEnabledToggle) return;
        alarmEnabledToggle.textContent = alarmDraft.en ? 'ON' : 'OFF';
        alarmEnabledToggle.classList.toggle('primary-btn', !!alarmDraft.en);
    }
    
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

    if (alarmEnabledToggle) {
        alarmEnabledToggle.addEventListener('click', () => {
            alarmDraft.en = alarmDraft.en ? 0 : 1;
            refreshAlarmEnabledToggle();
        });
    }

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
        } else {
            alarmDraft.en = 0;
            alarmDraft.rep = 0;
        }

        alarmPickerH.setValue(alarmDraft.h);
        alarmPickerM.setValue(alarmDraft.m);
        els.alarmEditSlotLabel.textContent = `(Slot ${slot + 1})`;
        refreshAlarmEnabledToggle();
        
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
    
    // Timer Input editing logic
    function setupTimerInput(displayEl, inputEl, pickerObj, updateDraft) {
        displayEl.addEventListener('click', () => {
            inputEl.value = pickerObj.getValue();
            inputEl.classList.remove('hidden');
            displayEl.classList.add('hidden');
            inputEl.focus();
        });
        
        inputEl.addEventListener('blur', () => {
            inputEl.classList.add('hidden');
            displayEl.classList.remove('hidden');
            let val = parseInt(inputEl.value);
            if (isNaN(val)) val = pickerObj.getValue();
            pickerObj.setValue(val);
            updateDraft(val);
        });
        
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') inputEl.blur();
        });
    }
    setupTimerInput(els.timerMinDisplay, els.timerInputMin, timerPickerMin, v => timerDraft.min = v);
    setupTimerInput(els.timerSecDisplay, els.timerInputSec, timerPickerSec, v => timerDraft.sec = v);

    // Timer Presets
    els.presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const presetMin = parseInt(btn.dataset.preset);
            timerPickerMin.setValue(presetMin);
            timerPickerSec.setValue(0);
            timerDraft.min = presetMin;
            timerDraft.sec = 0;
            sendCmd(`SET_TIMER:${String(presetMin).padStart(2,'0')},00`);
            if (navigator.vibrate) navigator.vibrate(20);
        });
    });

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
        if (alarmActive && !lastAlarmState) {
            startAlarm();
            let notifTitle = state.alarmRinging ? 'Alarm Ringing!' : 'Timer Done!';
            showNotification(notifTitle, 'Open the clock app to dismiss.');
        }
        if (!alarmActive && lastAlarmState) {
            stopAlarm();
        }
        lastAlarmState = alarmActive;
    };

    // Re-wire BLE to use our wrapped state handler
    // (WS already uses wrappedUpdateState from its connect call)

    // Stopwatch
    document.getElementById('btn-sw-start').addEventListener('click', () => sendCmd('BTN:UP'));
    document.getElementById('btn-sw-pause').addEventListener('click', () => sendCmd('BTN:DOWN'));
    document.getElementById('btn-sw-lap').addEventListener('click', () => {
        sendCmd('BTN:LAP');
        if (navigator.vibrate) navigator.vibrate(30);
    });
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
