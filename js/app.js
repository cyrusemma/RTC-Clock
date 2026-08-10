// js/app.js
import { connect, disconnect, sendCommand, bleState, readAlarms, readLaps } from './ble.js?v=4';
import { connectWS, disconnectWS, sendCommandWS, wsState } from './ws.js?v=4';
import { initUI, updateConnectionState, appendLog, updateState, els, renderWorldClock, renderAnalogueClock, renderAlarmCards, setActiveModeView } from './ui.js?v=4';
import { VirtualRTC } from './VirtualRTC.js?v=4';

let virtualRTC = null;
let wrappedUpdateState = null;

function sendCmd(cmd) {
    if (wsState.connected) {
        sendCommandWS(cmd, appendLog);
    } else if (bleState.connected) {
        sendCommand(cmd, appendLog);
    } else {
        const newState = virtualRTC.handleCommand(cmd);
        if (newState) {
            wrappedUpdateState(newState);
        }
        appendLog(`VirtualRTC: ${cmd}`, 'sys');
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
            menu.classList.toggle('hidden');
            menu.classList.toggle('flex');
        });
        document.addEventListener('click', (e) => {
            const wrap = document.getElementById(wrapId);
            if (wrap && !wrap.contains(e.target)) {
                menu.classList.add('hidden');
                menu.classList.remove('flex');
            }
        });
    }
    setupDropdown('main-menu-btn', 'main-menu', 'main-menu-wrap');

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
        if (!bleState.connected && !wsState.connected) {
            renderWorldClock(Math.floor(now.getTime() / 1000));
            if (analogueMode) {
                renderAnalogueClock(Math.floor(now.getTime() / 1000), -(new Date().getTimezoneOffset() / 60));
            }
            
            // Check VirtualRTC alarms
            const vState = virtualRTC.getState();
            const timeObj = { h: now.getHours(), m: now.getMinutes() };
            if (!vState.alarmRinging) {
                for (let i = 0; i < vState.alarms.length; i++) {
                    const alarm = vState.alarms[i];
                    if (alarm.en && alarm.h === timeObj.h && alarm.m === timeObj.m) {
                        // Prevent re-triggering in same minute
                        if (virtualRTC.lastTriggeredAlarm !== `${i}-${timeObj.h}-${timeObj.m}`) {
                            virtualRTC.lastTriggeredAlarm = `${i}-${timeObj.h}-${timeObj.m}`;
                            virtualRTC.state.alarmRinging = true;
                            virtualRTC.state.ringingSlot = i;
                        }
                    }
                }
            }
        }
    }, 1000);
    // Initial call
    els.browserClock.textContent = new Date().toLocaleTimeString([], { hour12: false });
    renderWorldClock(Math.floor(Date.now() / 1000));
    
    // BLE Connection (via dropdown)
    els.connectBtn.addEventListener('click', () => {
        const menu = document.getElementById('main-menu');
        menu.classList.add('hidden');
        menu.classList.remove('flex');
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
            const menu = document.getElementById('main-menu');
            menu.classList.add('hidden');
            menu.classList.remove('flex');
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
    const closeSettings = () => {
        const menu = document.getElementById('main-menu');
        menu.classList.add('hidden');
        menu.classList.remove('flex');
    };
    if (btnModeShort) btnModeShort.addEventListener('click', () => { sendCmd('BTN:MODE_SHORT'); closeSettings(); });
    if (btnModeLong)  btnModeLong.addEventListener('click',  () => { sendCmd('BTN:MODE_LONG');  closeSettings(); });
    if (btnTzUp)      btnTzUp.addEventListener('click',      () => { sendCmd('BTN:UP');          closeSettings(); });
    if (btnTzDown)    btnTzDown.addEventListener('click',    () => { sendCmd('BTN:DOWN');        closeSettings(); });

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
        
        let html = '<div style="height: 44px; flex-shrink: 0;"></div>';
        for (let i = min; i <= max; i++) {
            html += `<div class="scroll-item flex items-center justify-center h-10 w-full snap-center cursor-pointer flex-shrink-0">${String(i).padStart(2, '0')}</div>`;
        }
        html += '<div style="height: 44px; flex-shrink: 0;"></div>';
        el.innerHTML = html;
        
        el.style.scrollSnapType = 'y mandatory';
        
        let currentValue = initialValue;
        let commitTimer = null;
        
        const update = (val) => {
            currentValue = Math.max(min, Math.min(max, val));
            const items = el.querySelectorAll('.scroll-item');
            const target = items[currentValue - min];
            if (target) {
                el.scrollTo({ top: target.offsetTop - el.offsetTop - 44, behavior: 'auto' });
            }
        };
        
        el.addEventListener('scroll', () => {
            clearTimeout(commitTimer);
            commitTimer = setTimeout(() => {
                const items = el.querySelectorAll('.scroll-item');
                let closest = null;
                let minDiff = Infinity;
                const center = el.scrollTop + 64;
                items.forEach((item, i) => {
                    const itemCenter = (item.offsetTop - el.offsetTop) + 20;
                    const diff = Math.abs(center - itemCenter);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = i + min;
                    }
                });
                if (closest !== null && closest !== currentValue) {
                    currentValue = closest;
                    onCommit(currentValue);
                    if (navigator.vibrate) navigator.vibrate(8);
                }
            }, 100);
        }, { passive: true });
        
        el.addEventListener('click', (e) => {
            const item = e.target.closest('.scroll-item');
            if (item) {
                const idx = Array.from(el.querySelectorAll('.scroll-item')).indexOf(item);
                if (idx !== -1) {
                    update(idx + min);
                }
            }
        });
        
        setTimeout(() => update(initialValue), 0);
        
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
    let timerDraft = { hr: 0, min: 0, sec: 0 };
    const timerPickerHr = initScrollPicker(
        document.getElementById('timer-picker-hr'), 0,
        v => { timerDraft.hr = v; }
    );
    const timerPickerMin = initScrollPicker(
        document.getElementById('timer-picker-min'), 0,
        v => { timerDraft.min = v; }
    );
    const timerPickerSec = initScrollPicker(
        document.getElementById('timer-picker-sec'), 0,
        v => { timerDraft.sec = v; }
    );
    
    // Timer Presets
    els.presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.hasAttribute('data-hr') || btn.hasAttribute('data-min')) {
                const presetHr = parseInt(btn.dataset.hr || '0');
                const presetMin = parseInt(btn.dataset.min || '0');
                const presetSec = parseInt(btn.dataset.sec || '0');
                timerPickerHr.setValue(presetHr);
                timerPickerMin.setValue(presetMin);
                timerPickerSec.setValue(presetSec);
                timerDraft.hr = presetHr;
                timerDraft.min = presetMin;
                timerDraft.sec = presetSec;
                sendCmd(`SET_TIMER:${presetHr},${presetMin},${presetSec}`);
                if (navigator.vibrate) navigator.vibrate(20);
            } else {
                // Future functionality: add custom preset
            }
        });
    });

    const btnTimerAction = document.getElementById('btn-timer-action');
    if (btnTimerAction) {
        btnTimerAction.addEventListener('click', () => {
            // First time clicking play, if we are in READY state
            if (lastBleState && lastBleState.tmrState === 0) {
                timerDraft.hr = timerPickerHr.getValue();
                timerDraft.min = timerPickerMin.getValue();
                timerDraft.sec = timerPickerSec.getValue();
                sendCmd(`SET_TIMER:${timerDraft.hr},${timerDraft.min},${timerDraft.sec}`);
                // Give it a tiny delay then send start
                setTimeout(() => sendCmd('BTN:UP'), 50);
            } else if (lastBleState && lastBleState.tmrState === 1) {
                // Running, so pause
                sendCmd('BTN:DOWN');
            } else if (lastBleState && lastBleState.tmrState === 2) {
                // Paused, so resume
                sendCmd('BTN:UP');
            } else if (lastBleState && lastBleState.tmrState === 3) {
                // Ringing, stop
                sendCmd('BTN:ALARM');
            } else {
                // Fallback virtual RTC case if no connection
                sendCmd('BTN:UP'); 
            }
        });
    }

    const btnTimerResetCmd = document.getElementById('btn-timer-reset-cmd');
    if (btnTimerResetCmd) {
        btnTimerResetCmd.addEventListener('click', () => {
            sendCmd('BTN:ALARM'); // Stop/Reset
            setTimeout(() => sendCmd('BTN:ALARM'), 50); // Make sure it cycles back out of edit mode if stuck
        });
    }

    const btnTimerBellCmd = document.getElementById('btn-timer-bell-cmd');
    if (btnTimerBellCmd) {
        btnTimerBellCmd.addEventListener('click', () => {
            document.getElementById('alarm-sound-select').focus();
        });
    }

    // ─── Web Audio Alarm ──────────────────────────────────────────────────────
    let audioCtx = null;
    let alarmInterval = null;
    let lastAlarmState = false;
    let customAudio = null;
    let selectedAlarmSound = localStorage.getItem('alarmSoundType') || 'synth';

    // Load custom audio on startup
    const customAudioData = localStorage.getItem('customAlarmSound');
    if (customAudioData) {
        customAudio = new Audio(customAudioData);
        customAudio.loop = true;
        const statusEl = document.getElementById('custom-alarm-status');
        const clearBtn = document.getElementById('btn-clear-alarm');
        if (statusEl) statusEl.textContent = 'Using Custom Sound';
        if (clearBtn) clearBtn.classList.remove('hidden');
    }
    
    const customAlarmFile = document.getElementById('custom-alarm-file');
    if (customAlarmFile) {
        customAlarmFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const data = evt.target.result;
                    localStorage.setItem('customAlarmSound', data);
                    customAudio = new Audio(data);
                    customAudio.loop = true;
                    if (isPreviewing) { stopAlarmPreview(); startAlarmPreview(); }
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    const soundSelect = document.getElementById('alarm-sound-select');
    if (soundSelect) {
        soundSelect.value = selectedAlarmSound;
        soundSelect.addEventListener('change', (e) => {
            selectedAlarmSound = e.target.value;
            localStorage.setItem('alarmSoundType', selectedAlarmSound);
            if (selectedAlarmSound === 'custom' && !customAudio) {
                if (customAlarmFile) customAlarmFile.click();
            }
        });
    }

    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playAlarmSoundType(type) {
        if (type === 'custom') return;
        
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        
        if (type === 'digital') {
            [0, 0.12, 0.24].forEach((offset) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = 1500;
                osc.connect(gain);
                gain.connect(ctx.destination);
                gain.gain.setValueAtTime(0, now + offset);
                gain.gain.linearRampToValueAtTime(0.1, now + offset + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);
                osc.start(now + offset);
                osc.stop(now + offset + 0.12);
            });
        } else if (type === 'wake') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.linearRampToValueAtTime(600, now + 0.6);
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
            osc.start(now);
            osc.stop(now + 0.8);
        } else { // 'synth'
            [880, 660].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
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
    }
    
    let isPreviewing = false;
    let previewInterval = null;
    const btnPreviewSound = document.getElementById('btn-preview-sound');
    
    if (btnPreviewSound) {
        const previewIcon = document.getElementById('preview-sound-icon');
        
        const stopAlarmPreview = () => {
            isPreviewing = false;
            if (previewIcon) previewIcon.textContent = 'play_arrow';
            btnPreviewSound.classList.remove('text-error');
            btnPreviewSound.classList.add('text-primary-fixed');
            if (customAudio) {
                customAudio.pause();
                customAudio.currentTime = 0;
            }
            if (previewInterval) {
                clearInterval(previewInterval);
                previewInterval = null;
            }
        };

        btnPreviewSound.addEventListener('click', () => {
            if (isPreviewing) {
                stopAlarmPreview();
            } else {
                isPreviewing = true;
                if (previewIcon) previewIcon.textContent = 'stop';
                btnPreviewSound.classList.add('text-error');
                btnPreviewSound.classList.remove('text-primary-fixed');
                
                if (selectedAlarmSound === 'custom' && customAudio) {
                    customAudio.currentTime = 0;
                    customAudio.play().catch(e => console.error("Audio play failed:", e));
                } else {
                    playAlarmSoundType(selectedAlarmSound);
                    const interval = selectedAlarmSound === 'digital' ? 450 : (selectedAlarmSound === 'wake' ? 1000 : 700);
                    previewInterval = setInterval(() => playAlarmSoundType(selectedAlarmSound), interval);
                }
            }
        });
    }

    function startAlarm() {
        if (selectedAlarmSound === 'custom' && customAudio) {
            customAudio.currentTime = 0;
            customAudio.play().catch(e => console.error("Audio play failed:", e));
            return;
        }
        
        if (alarmInterval) return;
        playAlarmSoundType(selectedAlarmSound);
        const interval = selectedAlarmSound === 'digital' ? 450 : (selectedAlarmSound === 'wake' ? 1000 : 700);
        alarmInterval = setInterval(() => playAlarmSoundType(selectedAlarmSound), interval);
    }

    function stopAlarm() {
        if (customAudio) {
            customAudio.pause();
            customAudio.currentTime = 0;
            return;
        }
        
        clearInterval(alarmInterval);
        alarmInterval = null;
    }

    // Hook alarm state changes by wrapping updateState
    const _origUpdateState = updateState;
    let isFetchingAlarms = false;
    let isFetchingLaps = false;
    let lastBleState = null;

    wrappedUpdateState = async (state) => {
        lastBleState = state;
        lastBleState._localTs = Date.now();
        
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
            // Sync virtual RTC
            virtualRTC.setState(state);
        } else if (wsState.connected) {
             virtualRTC.setState(state);
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

    virtualRTC = new VirtualRTC();
    function renderLoop() {
        if (!bleState.connected && !wsState.connected) {
            const state = virtualRTC.tick();
            if (state) {
                wrappedUpdateState(state);
            }
        } else if (lastBleState) {
            const state = { ...lastBleState };
            const delta = Date.now() - (state._localTs || Date.now());
            if (state.swState === 1) {
                state.swElapsedMs += delta;
            }
            if (state.tmrState === 1) {
                state.tmrRemainingMs = Math.max(0, state.tmrRemainingMs - delta);
            }
            _origUpdateState(state);
        }
        requestAnimationFrame(renderLoop);
    }
    renderLoop();
    
    // Set initial VirtualRTC state so UI isn't blank
    wrappedUpdateState(virtualRTC.getState());

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

    // Timer (Hardware Sync) - we can keep hold to repeat if we want
    const btnUp = document.getElementById('btn-timer-up');
    const btnDown = document.getElementById('btn-timer-down');
    const btnCycle = document.getElementById('btn-timer-cycle');
    if (btnUp) setupHoldToRepeat(btnUp, 'BTN:UP');
    if (btnDown) setupHoldToRepeat(btnDown, 'BTN:DOWN');
    if (btnCycle) btnCycle.addEventListener('click', () => sendCmd('BTN:ALARM'));
    const btnStop = document.getElementById('btn-timer-stop');
    if (btnStop) btnStop.addEventListener('click', () => sendCmd('BTN:ALARM'));

});
