// js/app.js
import { connect, disconnect, sendCommand, bleState, readAlarms, readLaps } from './ble.js?v=23';
import { connectWS, disconnectWS, sendCommandWS, wsState } from './ws.js?v=23';
import { initUI, updateConnectionState, appendLog, updateState, els, renderWorldClock, renderAnalogueClock, renderAlarmCards, setActiveModeView, isIosDevice, getAlarmLabel, setAlarmLabel, renderTimerPresets, renderActiveTimerLabel, TIMER_STICKERS, getSticker } from './ui.js?v=23';
import { VirtualRTC } from './VirtualRTC.js?v=23';

let virtualRTC = null;
let wrappedUpdateState = null;
// Last state pushed to the UI, so a view switch can paint straight away
// instead of waiting for the next telemetry frame.
let lastKnownState = null;

// ── Alarm list cache ──────────────────────────────────────────────────────
// Telemetry frames never carry the alarm list, so reading it on every frame
// meant a GATT read four times a second, competing with the notifications and
// with the user's own command writes. Keep the last read and refresh it only
// when the alarms can actually have changed.
let cachedAlarms = null;
let alarmsDirty = true;
let lastAlarmReadAt = 0;

// Same story for the stopwatch laps: keyed on the lap count the device reports,
// so a re-read only happens when a lap is actually added or cleared.
let cachedLaps = [];
let cachedLapCount = -1;
let lastLapReadAt = 0;
const ALARM_CHANGING_CMD = /^(SET_ALARM|ALARM_EN|SNOOZE|DISMISS_ALARM)/;

export function invalidateAlarmCache() {
    alarmsDirty = true;
}

function sendCmd(cmd) {
    // Anything that edits an alarm makes the cached list stale
    if (ALARM_CHANGING_CMD.test(cmd)) alarmsDirty = true;
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

// The app-local pages (About This Project, How It Works) are not one of the
// four device modes, so they live outside setActiveModeView's mode switch —
// see openAppPage/closeAppPage below.
let activeAppPage = null;

window.selectMode = (mode) => {
    // Leaving an app page must force setActiveModeView to actually repaint:
    // it no-ops when `mode` matches whatever it last drew, which is still the
    // last real mode — the app page was drawn on top without telling it.
    const wasAppPage = !!activeAppPage;
    activeAppPage = null;
    setActiveModeView(mode, wasAppPage);
    // Paint the alarm list right away — over BLE/WS the MODE round-trip is
    // async, and waiting for it leaves the screen blank.
    if (mode === 2) {
        const snapshot = lastKnownState || (virtualRTC && virtualRTC.getState());
        if (snapshot && snapshot.alarms) {
            renderAlarmCards(snapshot.alarms, snapshot.alarmViewSlot);
        }
    }
    sendCmd(`MODE:${mode}`);
};

// Full-screen app pages (About, How It Works). Unlike a mode switch, opening
// one must NOT send a MODE: command — the device's own state does not change
// while someone is reading the credits.
function openAppPage(id) {
    const page = document.getElementById(id);
    if (!page) return;
    document.querySelectorAll('.view').forEach(v => {
        v.classList.add('hidden');
        v.classList.remove('active');
    });
    page.classList.remove('hidden');
    page.classList.add('active');
    activeAppPage = id;
    const menu = document.getElementById('main-menu');
    if (menu) {
        menu.classList.add('hidden');
        menu.classList.remove('flex');
    }
}

function closeAppPage() {
    if (!activeAppPage) return;
    // Re-run window.selectMode's own bookkeeping by way of the same mode
    // number it already believes is current — clay-tab .active reflects it.
    const activeTab = document.querySelector('.clay-tab.active[data-mode]');
    const mode = activeTab ? parseInt(activeTab.dataset.mode) : 0;
    activeAppPage = null;
    setActiveModeView(mode, true);
}

// Called from alarm card toggle switch in ui.renderAlarmCards
window.toggleAlarm = (slot, enable) => {
    sendCmd(`ALARM_EN:${slot},${enable ? 1 : 0}`);
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
    
    // ── Activity Log Drawer Handler ─────────────────────────
    const logToggleBtn = document.getElementById('log-toggle-btn');
    const logCloseBtn  = document.getElementById('log-close-btn');
    const logDrawer    = document.getElementById('log-drawer');
    const logBackdrop  = document.getElementById('log-backdrop');

    function openLogDrawer() {
        if (logDrawer) {
            logDrawer.classList.remove('-translate-x-full');
            logDrawer.classList.add('translate-x-0');
        }
        if (logBackdrop) {
            logBackdrop.classList.remove('hidden');
        }
    }

    function closeLogDrawer() {
        if (logDrawer) {
            logDrawer.classList.add('-translate-x-full');
            logDrawer.classList.remove('translate-x-0');
        }
        if (logBackdrop) {
            logBackdrop.classList.add('hidden');
        }
    }

    if (logToggleBtn) logToggleBtn.addEventListener('click', openLogDrawer);
    if (logCloseBtn)  logCloseBtn.addEventListener('click', closeLogDrawer);
    if (logBackdrop)  logBackdrop.addEventListener('click', closeLogDrawer);

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            document.body.classList.toggle('dark-mode'); // keep for backwards compatibility
        });
    }

    // PWA Install Prompt. Dismissals are remembered — an install nag that
    // returns on every visit is pure noise, and on iOS it sits on top of the
    // timer controls.
    const INSTALL_DISMISSED_KEY = 'installBannerDismissed';
    const IOS_TIP_DISMISSED_KEY = 'iosInstallTipDismissed';
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (localStorage.getItem(INSTALL_DISMISSED_KEY) !== '1') {
            els.pwaInstallBanner.classList.remove('hidden');
        }
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
            localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
        });
    });

    // iOS "Add to Home Screen" tip — Safari has no beforeinstallprompt, so this
    // is the only way to tell an iPhone user how to install.
    const isInStandaloneMode = () => ('standalone' in window.navigator && window.navigator.standalone) ||
                                     window.matchMedia('(display-mode: standalone)').matches;
    if (isIosDevice() && !isInStandaloneMode() && localStorage.getItem(IOS_TIP_DISMISSED_KEY) !== '1') {
        els.iosInstallTooltip.classList.remove('hidden');
    }
    if (els.btnIosDismiss) {
        els.btnIosDismiss.addEventListener('click', () => {
            els.iosInstallTooltip.classList.add('hidden');
            localStorage.setItem(IOS_TIP_DISMISSED_KEY, '1');
        });
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

    // ── Project pages (About, How It Works) ─────────────────────────────────
    const btnMenuAbout = document.getElementById('btn-menu-about');
    const btnMenuHelp  = document.getElementById('btn-menu-help');
    const btnAboutBack = document.getElementById('btn-about-back');
    const btnHelpBack  = document.getElementById('btn-help-back');
    if (btnMenuAbout) btnMenuAbout.addEventListener('click', () => openAppPage('view-about'));
    if (btnMenuHelp)  btnMenuHelp.addEventListener('click',  () => openAppPage('view-help'));
    if (btnAboutBack) btnAboutBack.addEventListener('click', closeAppPage);
    if (btnHelpBack)  btnHelpBack.addEventListener('click',  closeAppPage);

    // Fullscreen Toggle
    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log(`Error attempting to enable fullscreen: ${err.message} (${err.name})`);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
            // Close menu
            const menu = document.getElementById('main-menu');
            menu.classList.add('hidden');
            menu.classList.remove('flex');
        });
    }

    // ── V2.1 Buzzer Controls ───────────────────────────────────────────────
    if (els.volumeSlider) {
        els.volumeSlider.addEventListener('input', (e) => {
            if (els.volumeLabel) {
                const pct = Math.round((e.target.value / 255) * 100);
                els.volumeLabel.textContent = `${pct}%`;
            }
            sendCmd(`SET_VOLUME:${e.target.value}`);
        });
    }

    // Double tap/click to exit fullscreen mode
    document.addEventListener('dblclick', () => {
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen();
        }
    });

    // Analogue / Digital Clock Toggle
    let analogueMode = false;
    const btnClockToggle = document.getElementById('btn-clock-toggle');
    
    // Set initial text
    if (btnClockToggle) {
        btnClockToggle.innerHTML = `<span>🕐</span> Toggle Analogue Mode`;
    }

    btnClockToggle.addEventListener('click', () => {
        analogueMode = !analogueMode;
        if (analogueMode) {
            els.clockDigital.classList.add('hidden');
            els.clockAnalogue.classList.remove('hidden');
            
            // Highlight the button and change text
            btnClockToggle.classList.add('bg-primary/20', 'text-primary', 'border-primary/50');
            btnClockToggle.classList.remove('text-on-surface');
            btnClockToggle.innerHTML = `<span>🔢</span> Toggle Digital Mode`;
            
            // Render immediately if not waiting for BLE tick
            if (!bleState || !bleState.connected) {
                renderAnalogueClock(Math.floor(Date.now() / 1000), -(new Date().getTimezoneOffset() / 60));
            }
        } else {
            els.clockDigital.classList.remove('hidden');
            els.clockAnalogue.classList.add('hidden');
            
            // Revert button highlight and text
            btnClockToggle.classList.remove('bg-primary/20', 'text-primary', 'border-primary/50');
            btnClockToggle.classList.add('text-on-surface');
            btnClockToggle.innerHTML = `<span>🕐</span> Toggle Analogue Mode`;
        }
    });

    // 12/24hr Format Toggle
    const btnClockFormat = document.getElementById('btn-clock-format');
    if (btnClockFormat) {
        // Initial state
        if (localStorage.getItem('is12hFormat') === 'true') {
            btnClockFormat.innerHTML = `<span>24h</span> Format`;
        } else {
            btnClockFormat.innerHTML = `<span>12h</span> Format`;
        }
        
        btnClockFormat.addEventListener('click', () => {
            const current = localStorage.getItem('is12hFormat') === 'true';
            localStorage.setItem('is12hFormat', !current);
            is12hFormat = !current;
            
            if (is12hFormat) {
                btnClockFormat.innerHTML = `<span>24h</span> Format`;
                sendCmd('SET_TIMEFORMAT:12');
            } else {
                btnClockFormat.innerHTML = `<span>12h</span> Format`;
                sendCmd('SET_TIMEFORMAT:24');
            }
            
            // Force re-render
            if (lastBleState) wrappedUpdateState(lastBleState);
        });
    }

    // Independent browser clock / offline analogue clock
    setInterval(() => {
        const now = new Date();
        els.browserClock.textContent = now.toLocaleTimeString([], { hour12: false });
        if (!bleState.connected && !wsState.connected) {
            renderWorldClock(Math.floor(now.getTime() / 1000));
            if (analogueMode) {
                renderAnalogueClock(Math.floor(now.getTime() / 1000), -(new Date().getTimezoneOffset() / 60));
            }
            
            // Check VirtualRTC alarms — push to the UI so the banner and
            // alarm sound actually fire, since tick() only reports sw/timer changes.
            if (virtualRTC.checkAlarms(now)) {
                wrappedUpdateState(virtualRTC.getState());
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
            // Silently doing nothing here is what made the button look broken
            // on iPhone, where Web Bluetooth simply does not exist.
            const note = isIosDevice()
                ? 'This device has no Web Bluetooth. Join the clock\'s WiFi network, then use WiFi Connect.'
                : 'Web Bluetooth is unavailable in this browser. Use Chrome or Edge on localhost or HTTPS.';
            appendLog(note, 'sys');
            if (els.bleNote) {
                els.bleNote.textContent = note;
                els.bleNote.classList.remove('hidden');
            }
            return;
        }
        if (bleState.connected) {
            disconnect(updateConnectionState, appendLog);
        } else {
            connect((state) => {
                // A new link means the cached device data belongs to nothing
                if (state !== 'connected') cachedAlarms = null;
                alarmsDirty = true;
                cachedLaps = [];
                cachedLapCount = -1;
                updateConnectionState(state, bleState.deviceName);
            }, wrappedUpdateState, appendLog);
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

        const indicator = document.getElementById('last-synced-indicator');
        if (indicator) {
            indicator.textContent = `Last synced: Just now`;
            indicator.style.opacity = '1';
            
            if (indicator.timeoutId) clearTimeout(indicator.timeoutId);
            indicator.timeoutId = setTimeout(() => {
                indicator.style.opacity = '0.5';
                indicator.textContent = `Last synced: A few moments ago`;
            }, 10000);
        }
    });

    // ─── Scroll Picker Factory ────────────────────────────────────────────────
    const ITEM_HEIGHT = 48;      // px per scroll item
    const VISIBLE_ITEMS = 5;     // how many items visible in the picker viewport
    const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // total picker container height
    const PADDING_ITEMS = Math.floor(VISIBLE_ITEMS / 2); // spacer items top & bottom

    function initScrollPicker(el, initialValue, onCommit) {
        const min = parseInt(el.dataset.min);
        const max = parseInt(el.dataset.max);
        
        // Set the picker height explicitly
        el.style.height = PICKER_HEIGHT + 'px';
        el.style.scrollSnapType = 'y mandatory';
        el.style.overscrollBehavior = 'contain';
        
        // Build items: top padding + values + bottom padding
        let html = '';
        for (let p = 0; p < PADDING_ITEMS; p++) {
            html += `<div class="scroll-spacer" style="height:${ITEM_HEIGHT}px;flex-shrink:0;"></div>`;
        }
        for (let i = min; i <= max; i++) {
            html += `<div class="scroll-item flex items-center justify-center snap-center cursor-pointer" style="height:${ITEM_HEIGHT}px;flex-shrink:0;">${String(i).padStart(2, '0')}</div>`;
        }
        for (let p = 0; p < PADDING_ITEMS; p++) {
            html += `<div class="scroll-spacer" style="height:${ITEM_HEIGHT}px;flex-shrink:0;"></div>`;
        }
        el.innerHTML = html;
        
        let currentValue = initialValue;
        let commitTimer = null;
        let isScrolling = false;
        
        // Highlight the selected item visually
        function highlightSelected() {
            const items = el.querySelectorAll('.scroll-item');
            const centerY = el.scrollTop + (PICKER_HEIGHT / 2);
            items.forEach((item, i) => {
                const itemCenterY = item.offsetTop - el.offsetTop + (ITEM_HEIGHT / 2);
                const dist = Math.abs(centerY - itemCenterY);
                if (dist < ITEM_HEIGHT * 0.6) {
                    // Selected
                    item.style.color = 'var(--md-sys-color-primary)';
                    item.style.transform = 'scale(1.25)';
                    item.style.fontWeight = '700';
                    item.style.opacity = '1';
                } else if (dist < ITEM_HEIGHT * 1.6) {
                    // Adjacent
                    item.style.color = 'var(--md-sys-color-on-surface-variant)';
                    item.style.transform = 'scale(1)';
                    item.style.fontWeight = '400';
                    item.style.opacity = '0.5';
                } else {
                    // Far
                    item.style.color = 'var(--md-sys-color-on-surface-variant)';
                    item.style.transform = 'scale(0.85)';
                    item.style.fontWeight = '400';
                    item.style.opacity = '0.2';
                }
                item.style.transition = 'all 0.15s ease';
            });
        }
        
        // Scroll to a specific value
        const scrollToValue = (val, smooth = false) => {
            currentValue = Math.max(min, Math.min(max, val));
            const targetScrollTop = (currentValue - min) * ITEM_HEIGHT;
            el.scrollTo({ top: targetScrollTop, behavior: smooth ? 'smooth' : 'auto' });
            highlightSelected();
        };
        
        // On scroll, find closest value and highlight
        el.addEventListener('scroll', () => {
            isScrolling = true;
            highlightSelected();
            clearTimeout(commitTimer);
            commitTimer = setTimeout(() => {
                isScrolling = false;
                // Find closest item
                const rawIdx = Math.round(el.scrollTop / ITEM_HEIGHT);
                const newVal = Math.max(min, Math.min(max, rawIdx + min));
                if (newVal !== currentValue) {
                    currentValue = newVal;
                    onCommit(currentValue);
                    if (navigator.vibrate) navigator.vibrate(8);
                }
                // Snap precisely
                scrollToValue(currentValue, true);
            }, 80);
        }, { passive: true });
        
        // Click to select
        el.addEventListener('click', (e) => {
            const item = e.target.closest('.scroll-item');
            if (item) {
                const idx = Array.from(el.querySelectorAll('.scroll-item')).indexOf(item);
                if (idx !== -1) {
                    scrollToValue(idx + min, true);
                    onCommit(currentValue);
                    if (navigator.vibrate) navigator.vibrate(8);
                }
            }
        });
        
        // Initial position
        requestAnimationFrame(() => {
            scrollToValue(initialValue, false);
        });
        
        return { getValue: () => currentValue, setValue: (v) => scrollToValue(v, false) };
    }

    // Alarm pickers
    let alarmDraft = { h: 0, m: 0, en: 0, rep: 0, slot: 0, label: '' };
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
            btn.classList.toggle('day-active');
            if (btn.classList.contains('day-active')) {
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

    // The bottom nav is fixed over the scrolling page, so opening the editor has
    // to bring its full height into view. The add FAB also has to get out of the
    // way — it sits right on top of the weekday row.
    const alarmFab = document.getElementById('alarm-fab');

    // ── Alarm label ───────────────────────────────────────────────────────
    const alarmLabelRow    = document.getElementById('alarm-label-row');
    const alarmLabelValue  = document.getElementById('alarm-label-value');
    const alarmLabelSheet  = document.getElementById('alarm-label-sheet');
    const alarmLabelInput  = document.getElementById('alarm-label-input');

    function refreshAlarmLabelRow() {
        if (alarmLabelValue) alarmLabelValue.textContent = alarmDraft.label || 'None';
    }

    function openAlarmLabelSheet() {
        if (!alarmLabelSheet) return;
        alarmLabelInput.value = alarmDraft.label || '';
        alarmLabelSheet.classList.remove('hidden');
        setTimeout(() => alarmLabelInput.focus(), 50);
    }

    function closeAlarmLabelSheet() {
        if (alarmLabelSheet) alarmLabelSheet.classList.add('hidden');
    }

    if (alarmLabelRow) alarmLabelRow.addEventListener('click', openAlarmLabelSheet);
    const alarmLabelCancel = document.getElementById('alarm-label-cancel');
    const alarmLabelOk = document.getElementById('alarm-label-ok');
    if (alarmLabelCancel) alarmLabelCancel.addEventListener('click', closeAlarmLabelSheet);
    if (alarmLabelOk) {
        alarmLabelOk.addEventListener('click', () => {
            alarmDraft.label = (alarmLabelInput.value || '').trim().slice(0, 24);
            refreshAlarmLabelRow();
            closeAlarmLabelSheet();
        });
    }
    if (alarmLabelInput) {
        alarmLabelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') alarmLabelOk.click();
        });
    }
    document.querySelectorAll('[data-alarm-label-dismiss]').forEach(el =>
        el.addEventListener('click', closeAlarmLabelSheet));

    function openAlarmEditor() {
        refreshAlarmLabelRow();
        closeAlarmLabelSheet();
        els.alarmEditor.classList.remove('hidden');
        els.alarmEditor.classList.add('slide-up-active');
        if (alarmFab) alarmFab.classList.add('hidden');
        requestAnimationFrame(() => {
            // A scroll picker cannot position itself while its container is
            // display:none — scrollTop stays 0 — so the first open always came
            // up showing 00:00. Re-apply the draft now that it has layout.
            alarmPickerH.setValue(alarmDraft.h);
            alarmPickerM.setValue(alarmDraft.m);
            els.alarmEditor.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });
    }

    function closeAlarmEditor() {
        els.alarmEditor.classList.add('hidden');
        els.alarmEditor.classList.remove('slide-up-active');
        closeAlarmLabelSheet();
        if (alarmFab) alarmFab.classList.remove('hidden');
    }

    // Repaint the list from whatever alarm data we have, so an edit shows up
    // immediately instead of waiting for the next telemetry frame.
    function repaintAlarmCards() {
        const source = (lastBleState && lastBleState.alarms)
            ? lastBleState.alarms
            : (virtualRTC ? virtualRTC.getState().alarms : null);
        if (source) renderAlarmCards(source, alarmDraft.slot);
    }

    els.alarmCancelBtn.addEventListener('click', closeAlarmEditor);

    document.getElementById('btn-alarm-set').addEventListener('click', () => {
        alarmDraft.h = alarmPickerH.getValue();
        alarmDraft.m = alarmPickerM.getValue();
        sendCmd(`SET_ALARM:${alarmDraft.slot},${String(alarmDraft.h).padStart(2,'0')},${String(alarmDraft.m).padStart(2,'0')},${alarmDraft.en ? 1 : 0},${alarmDraft.rep}`);
        setAlarmLabel(alarmDraft.slot, alarmDraft.label);

        // The device echoes the new values on its next frame; patch the cached
        // list so the card does not show the old time until then.
        if (cachedAlarms && cachedAlarms[alarmDraft.slot]) {
            cachedAlarms[alarmDraft.slot] = {
                h: alarmDraft.h, m: alarmDraft.m,
                en: !!alarmDraft.en, sn: false, rep: alarmDraft.rep,
            };
        }
        closeAlarmEditor();
        repaintAlarmCards();
    });

    // Alarm Cards Click
    els.alarmCardsContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.alarm-card');
        if (!card) return;
        const slot = parseInt(card.dataset.slot);
        
        // Find existing alarm data if any. lastBleState tracks the last state
        // pushed to the UI whatever the transport, so this also works offline
        // against the VirtualRTC — previously editing only worked when a
        // device was connected.
        const source = (lastBleState && lastBleState.alarms)
            ? lastBleState.alarms
            : (virtualRTC ? virtualRTC.getState().alarms : null);
        const existing = source ? source[slot] : null;

        alarmDraft.slot = slot;
        alarmDraft.label = getAlarmLabel(slot);
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
                btn.classList.add('day-active');
            } else {
                btn.classList.remove('day-active');
            }
        });
        
        openAlarmEditor();
    });

    const btnAlarmAdd = document.getElementById('btn-alarm-add');
    if (btnAlarmAdd) {
        btnAlarmAdd.addEventListener('click', () => {
            let slot = -1;
            const alarms = (lastBleState && lastBleState.alarms)
                ? lastBleState.alarms
                : (virtualRTC ? virtualRTC.getState().alarms : null);
            if (alarms) {
                // Find first completely unused slot
                slot = alarms.findIndex(a => !a.en && !a.sn && a.h === 0 && a.m === 0 && a.rep === 0);
                if (slot === -1) {
                    // Find first disabled slot
                    slot = alarms.findIndex(a => !a.en);
                }
            }
            if (slot === -1) {
                alert("Maximum 4 alarms reached. Please edit or disable an existing alarm.");
                return;
            }
            
            alarmDraft.slot = slot;
            alarmDraft.h = 7;
            alarmDraft.m = 0;
            alarmDraft.en = 1;
            alarmDraft.rep = 0;
            // A fresh alarm starts unnamed, even if this slot was used before
            alarmDraft.label = '';

            alarmPickerH.setValue(alarmDraft.h);
            alarmPickerM.setValue(alarmDraft.m);
            els.alarmEditSlotLabel.textContent = `(New Slot ${slot + 1})`;
            refreshAlarmEnabledToggle();
            
            dayBtns.forEach(btn => {
                btn.classList.remove('day-active');
            });

            openAlarmEditor();
        });
    }

    // Timer pickers
    let timerDraft = { hr: 0, min: 0, sec: 0 };
    const timerPickerHr = initScrollPicker(
        document.getElementById('timer-picker-hr'), 0,
        v => { timerDraft.hr = v; clearActiveTimerMeta(); }
    );
    const timerPickerMin = initScrollPicker(
        document.getElementById('timer-picker-min'), 0,
        v => { timerDraft.min = v; clearActiveTimerMeta(); }
    );
    const timerPickerSec = initScrollPicker(
        document.getElementById('timer-picker-sec'), 0,
        v => { timerDraft.sec = v; clearActiveTimerMeta(); }
    );
    
    // ─── Saved Timers ─────────────────────────────────────────────────────
    // Each saved timer carries a duration, a name, a sticker and a
    // "show on lock screen" flag. Tapping a card loads it into the wheels;
    // pressing and holding opens it in the editor; the "+" card creates one.
    const TIMER_PRESETS_KEY = 'timerPresets';
    const MAX_TIMER_PRESETS = 8;
    const DEFAULT_TIMER_PRESETS = [
        { id: 'p-meeting',  name: 'Meeting',  sticker: 'meeting',  hr: 0, min: 20, sec: 0, lock: true },
        { id: 'p-sleep',    name: 'Sleep',    sticker: 'sleep',    hr: 0, min: 10, sec: 0, lock: true },
        { id: 'p-exercise', name: 'Exercise', sticker: 'exercise', hr: 0, min: 15, sec: 0, lock: true },
    ];

    const clampInt = (v, min, max) => Math.max(min, Math.min(max, parseInt(v) || 0));

    function normalizePreset(p) {
        const name = String(p && p.name ? p.name : 'Timer').trim().slice(0, 18) || 'Timer';
        return {
            id: (p && p.id) || `t-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name,
            sticker: (p && TIMER_STICKERS[p.sticker]) ? p.sticker : 'timer',
            hr: clampInt(p && p.hr, 0, 23),
            min: clampInt(p && p.min, 0, 59),
            sec: clampInt(p && p.sec, 0, 59),
            lock: !!(p && p.lock),
        };
    }

    function loadTimerPresets() {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(TIMER_PRESETS_KEY)); } catch (e) { stored = null; }
        if (Array.isArray(stored)) return stored.map(normalizePreset);

        // First run: seed the defaults and carry over the single anonymous
        // preset the old "Save Current" button used to store.
        const seeded = DEFAULT_TIMER_PRESETS.map(normalizePreset);
        try {
            const legacy = JSON.parse(localStorage.getItem('timerCustomPreset') || 'null');
            if (legacy) {
                seeded.push(normalizePreset({ id: 'p-legacy', name: 'Timer', sticker: 'timer', hr: legacy.hr, min: legacy.min, sec: legacy.sec, lock: true }));
                localStorage.removeItem('timerCustomPreset');
            }
        } catch (e) { /* nothing to migrate */ }
        localStorage.setItem(TIMER_PRESETS_KEY, JSON.stringify(seeded));
        return seeded;
    }

    let timerPresets = loadTimerPresets();
    let activeTimerMeta = null;   // the saved timer currently loaded into the wheels

    function saveTimerPresets() {
        localStorage.setItem(TIMER_PRESETS_KEY, JSON.stringify(timerPresets));
    }

    function renderPresets() {
        renderTimerPresets(timerPresets, activeTimerMeta ? activeTimerMeta.id : null, MAX_TIMER_PRESETS);
    }

    function applyPreset(preset) {
        activeTimerMeta = { id: preset.id, name: preset.name, sticker: preset.sticker, lock: preset.lock };
        timerDraft.hr = preset.hr;
        timerDraft.min = preset.min;
        timerDraft.sec = preset.sec;
        timerPickerHr.setValue(preset.hr);
        timerPickerMin.setValue(preset.min);
        timerPickerSec.setValue(preset.sec);
        renderActiveTimerLabel(activeTimerMeta);
        renderPresets();
        sendCmd(`SET_TIMER:${preset.hr},${preset.min},${preset.sec}`);
        if (navigator.vibrate) navigator.vibrate(20);
    }

    // Scrolling the wheels by hand detaches the run from any saved timer
    function clearActiveTimerMeta() {
        if (!activeTimerMeta) return;
        activeTimerMeta = null;
        renderActiveTimerLabel(null);
        renderPresets();
    }

    renderPresets();

    // ── Card interaction: tap loads, press-and-hold edits ──────────────────
    const presetsGrid = els.timerPresetsGrid;
    let holdTimer = null;
    let holdCard = null;
    // Releasing a long press still delivers a click. Swallow just that one, by
    // timestamping the release — latching a flag instead would eat the next
    // real tap whenever the trailing click never arrives (touch screens).
    let holdDidFire = false;
    let holdEndedAt = 0;

    const releaseHold = () => {
        clearTimeout(holdTimer);
        if (holdCard) holdCard.classList.remove('holding');
        holdCard = null;
    };

    const endHold = () => {
        if (holdDidFire) {
            holdDidFire = false;
            holdEndedAt = Date.now();
        }
        releaseHold();
    };

    if (presetsGrid) {
        presetsGrid.addEventListener('pointerdown', (e) => {
            const card = e.target.closest('.preset-btn');
            if (!card) return;
            holdCard = card;
            holdDidFire = false;
            card.classList.add('holding');
            holdTimer = setTimeout(() => {
                holdDidFire = true;
                releaseHold();
                const preset = timerPresets.find(p => p.id === card.dataset.presetId);
                if (preset) {
                    if (navigator.vibrate) navigator.vibrate(30);
                    openTimerEditor(preset);
                }
            }, 550);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
            presetsGrid.addEventListener(ev, endHold));
        presetsGrid.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.preset-btn')) e.preventDefault();
        });

        presetsGrid.addEventListener('click', (e) => {
            if (Date.now() - holdEndedAt < 400) return;
            if (e.target.closest('#btn-timer-preset-add')) {
                openTimerEditor(null);
                return;
            }
            const card = e.target.closest('.preset-btn');
            if (!card) return;
            const preset = timerPresets.find(p => p.id === card.dataset.presetId);
            if (preset) applyPreset(preset);
        });
    }

    // ── Timer editor sheet ────────────────────────────────────────────────
    const timerEditor      = document.getElementById('timer-editor');
    const editorTitle      = document.getElementById('timer-editor-title');
    const editorWheels     = document.getElementById('timer-edit-wheels');
    const editNameRow      = document.getElementById('timer-edit-name-row');
    const editNameValue    = document.getElementById('timer-edit-name-value');
    const editStickerRow   = document.getElementById('timer-edit-sticker-row');
    const editStickerValue = document.getElementById('timer-edit-sticker-value');
    const editStickerIcon  = document.getElementById('timer-edit-sticker-icon');
    const editLockToggle   = document.getElementById('timer-edit-lock');
    const editDeleteBtn    = document.getElementById('timer-edit-delete');
    const stickerSheet     = document.getElementById('sticker-sheet');
    const stickerGrid      = document.getElementById('sticker-grid');
    const nameSheet        = document.getElementById('name-sheet');
    const nameSheetInput   = document.getElementById('name-sheet-input');

    let editorDraft = null;
    let editPickers = null;

    function ensureEditPickers() {
        if (editPickers) return editPickers;
        editPickers = {
            hr:  initScrollPicker(document.getElementById('timer-edit-hr'),  editorDraft ? editorDraft.hr  : 0, v => { if (editorDraft) editorDraft.hr  = v; }),
            min: initScrollPicker(document.getElementById('timer-edit-min'), editorDraft ? editorDraft.min : 0, v => { if (editorDraft) editorDraft.min = v; }),
            sec: initScrollPicker(document.getElementById('timer-edit-sec'), editorDraft ? editorDraft.sec : 0, v => { if (editorDraft) editorDraft.sec = v; }),
        };
        return editPickers;
    }

    function refreshEditorRows() {
        if (!editorDraft) return;
        const s = getSticker(editorDraft.sticker);
        if (editNameValue) editNameValue.textContent = editorDraft.name;
        if (editStickerValue) editStickerValue.textContent = s.label;
        if (editStickerIcon) editStickerIcon.textContent = s.icon;
        if (editLockToggle) editLockToggle.checked = !!editorDraft.lock;
    }

    function openTimerEditor(preset) {
        editorDraft = preset
            ? { ...preset, isNew: false }
            : normalizePreset({ name: 'Timer', sticker: 'timer', hr: 0, min: 5, sec: 0, lock: true });
        if (!preset) editorDraft.isNew = true;

        if (editorTitle) editorTitle.textContent = editorDraft.isNew ? 'Add Timer' : 'Edit Timer';
        if (editDeleteBtn) editDeleteBtn.classList.toggle('hidden', !!editorDraft.isNew);
        refreshEditorRows();
        closeSubSheet('sticker');
        closeSubSheet('name');

        timerEditor.classList.remove('hidden');
        timerEditor.classList.add('flex');

        // The wheels can only be positioned once the sheet has layout
        const firstBuild = !editPickers;
        requestAnimationFrame(() => {
            const pickers = ensureEditPickers();
            if (!firstBuild) {
                pickers.hr.setValue(editorDraft.hr);
                pickers.min.setValue(editorDraft.min);
                pickers.sec.setValue(editorDraft.sec);
            }
        });
    }

    function closeTimerEditor() {
        timerEditor.classList.add('hidden');
        timerEditor.classList.remove('flex');
        closeSubSheet('sticker');
        closeSubSheet('name');
        editorDraft = null;
    }

    function openSubSheet(which) {
        const sheet = which === 'sticker' ? stickerSheet : nameSheet;
        if (!sheet) return;
        sheet.classList.remove('hidden');
        sheet.classList.add('block');
    }

    function closeSubSheet(which) {
        const sheet = which === 'sticker' ? stickerSheet : nameSheet;
        if (!sheet) return;
        sheet.classList.add('hidden');
        sheet.classList.remove('block');
    }

    function renderStickerGrid() {
        if (!stickerGrid) return;
        stickerGrid.innerHTML = Object.entries(TIMER_STICKERS).map(([key, s]) => `
            <button class="sticker-tile${editorDraft && editorDraft.sticker === key ? ' selected' : ''}" data-sticker="${key}">
                <span class="material-symbols-outlined">${s.icon}</span>
                <span>${s.label}</span>
            </button>`).join('');
    }

    function commitTimerEditor() {
        if (!editorDraft) return;
        if (editPickers) {
            editorDraft.hr  = editPickers.hr.getValue();
            editorDraft.min = editPickers.min.getValue();
            editorDraft.sec = editPickers.sec.getValue();
        }
        if (editorDraft.hr === 0 && editorDraft.min === 0 && editorDraft.sec === 0) {
            // A zero-length timer is not useful — nudge the wheels instead of saving
            if (editorWheels) {
                editorWheels.classList.remove('shake');
                void editorWheels.offsetWidth;
                editorWheels.classList.add('shake');
            }
            if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
            return;
        }

        const clean = normalizePreset(editorDraft);
        const idx = timerPresets.findIndex(p => p.id === clean.id);
        if (idx === -1) {
            if (timerPresets.length >= MAX_TIMER_PRESETS) {
                alert(`You can save up to ${MAX_TIMER_PRESETS} timers. Delete one first.`);
                return;
            }
            timerPresets.push(clean);
        } else {
            timerPresets[idx] = clean;
        }
        saveTimerPresets();
        closeTimerEditor();
        applyPreset(clean);
    }

    function deleteEditedTimer() {
        if (!editorDraft || editorDraft.isNew) return;
        if (!confirm(`Delete "${editorDraft.name}"?`)) return;
        timerPresets = timerPresets.filter(p => p.id !== editorDraft.id);
        saveTimerPresets();
        if (activeTimerMeta && activeTimerMeta.id === editorDraft.id) {
            activeTimerMeta = null;
            renderActiveTimerLabel(null);
        }
        closeTimerEditor();
        renderPresets();
    }

    if (timerEditor) {
        document.getElementById('timer-editor-cancel').addEventListener('click', closeTimerEditor);
        document.getElementById('timer-editor-save').addEventListener('click', commitTimerEditor);
        if (editDeleteBtn) editDeleteBtn.addEventListener('click', deleteEditedTimer);

        if (editStickerRow) {
            editStickerRow.addEventListener('click', () => {
                renderStickerGrid();
                openSubSheet('sticker');
            });
        }
        if (stickerGrid) {
            stickerGrid.addEventListener('click', (e) => {
                const tile = e.target.closest('.sticker-tile');
                if (!tile || !editorDraft) return;
                editorDraft.sticker = tile.dataset.sticker;
                // A still-default name follows the sticker, the way the phone does it
                if (editorDraft.isNew && (editorDraft.name === 'Timer' || Object.values(TIMER_STICKERS).some(s => s.label === editorDraft.name))) {
                    editorDraft.name = getSticker(editorDraft.sticker).label;
                }
                refreshEditorRows();
                renderStickerGrid();
                closeSubSheet('sticker');
                if (navigator.vibrate) navigator.vibrate(10);
            });
        }

        if (editNameRow) {
            editNameRow.addEventListener('click', () => {
                if (!editorDraft) return;
                nameSheetInput.value = editorDraft.name;
                openSubSheet('name');
                setTimeout(() => nameSheetInput.focus(), 50);
            });
        }
        document.getElementById('name-sheet-cancel').addEventListener('click', () => closeSubSheet('name'));
        document.getElementById('name-sheet-ok').addEventListener('click', () => {
            if (editorDraft) {
                editorDraft.name = (nameSheetInput.value || '').trim().slice(0, 18) || 'Timer';
                refreshEditorRows();
            }
            closeSubSheet('name');
        });
        nameSheetInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('name-sheet-ok').click();
        });

        if (editLockToggle) {
            editLockToggle.addEventListener('change', () => {
                if (editorDraft) editorDraft.lock = editLockToggle.checked;
            });
        }

        timerEditor.querySelectorAll('[data-sheet-dismiss]').forEach(el => {
            el.addEventListener('click', () => closeSubSheet(el.dataset.sheetDismiss));
        });
    }

    // ── Lock-screen countdown notification ────────────────────────────────
    let swRegistration = null;
    let lockNotifTimer = null;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => { swRegistration = reg; }).catch(() => {});
    }

    function formatRemaining(ms) {
        const total = Math.max(0, Math.round(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor(total / 60) % 60;
        const s = total % 60;
        const p = n => String(n).padStart(2, '0');
        return `${p(h)}:${p(m)}:${p(s)}`;
    }

    function pushLockScreenNotification() {
        if (!swRegistration || !activeTimerMeta || !activeTimerMeta.lock) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const remaining = lastBleState ? lastBleState.tmrRemainingMs : 0;
        swRegistration.showNotification(activeTimerMeta.name, {
            body: `${formatRemaining(remaining)} remaining`,
            icon: 'icon.png',
            badge: 'icon.png',
            tag: 'rtc-timer-running',
            renotify: false,
            silent: true,
            requireInteraction: true,
        }).catch(() => {});
    }

    function startLockScreenTimer() {
        if (lockNotifTimer) return;
        if (!activeTimerMeta || !activeTimerMeta.lock) return;
        pushLockScreenNotification();
        lockNotifTimer = setInterval(pushLockScreenNotification, 1000);
    }

    function stopLockScreenTimer() {
        if (lockNotifTimer) {
            clearInterval(lockNotifTimer);
            lockNotifTimer = null;
        }
        if (swRegistration && swRegistration.getNotifications) {
            swRegistration.getNotifications({ tag: 'rtc-timer-running' })
                .then(list => list.forEach(n => n.close()))
                .catch(() => {});
        }
    }

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
                sendCmd('RESET_TIMER');
                stopAlarm();
            } else {
                // Fallback virtual RTC case if no connection
                sendCmd('BTN:UP'); 
            }
        });
    }

    const btnTimerResetCmd = document.getElementById('btn-timer-reset-cmd');
    if (btnTimerResetCmd) {
        btnTimerResetCmd.addEventListener('click', () => {
            // On physical ESP32 firmware, sending BTN:DOWN when paused/stopped resets the timer countdown.
            // We also send RESET_TIMER for updated firmware & VirtualRTC fallback.
            sendCmd('BTN:DOWN');
            sendCmd('RESET_TIMER');
            if (virtualRTC) {
                virtualRTC.state.tmrState = 0;
                virtualRTC.state.tmrRemainingMs = (virtualRTC.state.tmrInitHr * 3600 + virtualRTC.state.tmrInitMin * 60 + virtualRTC.state.tmrInitSec) * 1000;
                if (wrappedUpdateState) wrappedUpdateState(virtualRTC.getState());
            }
        });
    }

    // Stop button on timer ringing banner
    const btnTimerStop = document.getElementById('btn-timer-stop');
    if (btnTimerStop) {
        btnTimerStop.addEventListener('click', () => {
            sendCmd('BTN:ALARM');
            sendCmd('RESET_TIMER');
            if (virtualRTC) {
                virtualRTC.state.tmrState = 0;
                virtualRTC.state.tmrRemainingMs = (virtualRTC.state.tmrInitHr * 3600 + virtualRTC.state.tmrInitMin * 60 + virtualRTC.state.tmrInitSec) * 1000;
                if (wrappedUpdateState) wrappedUpdateState(virtualRTC.getState());
            }
            stopAlarm();
        });
    }

    // Snooze & Dismiss buttons on alarm ringing banner
    if (els.alarmSnoozeBtn) {
        els.alarmSnoozeBtn.addEventListener('click', () => {
            const slot = (lastBleState && lastBleState.ringingSlot !== 0xFF) ? lastBleState.ringingSlot : 0;
            sendCmd(`SNOOZE:${slot}`);
            sendCmd('BTN:SNOOZE');
            if (virtualRTC) {
                virtualRTC.state.alarmRinging = false;
                if (wrappedUpdateState) wrappedUpdateState(virtualRTC.getState());
            }
            stopAlarm();
        });
    }

    const btnAlarmDismiss = document.getElementById('btn-alarm-dismiss');
    if (btnAlarmDismiss) {
        btnAlarmDismiss.addEventListener('click', () => {
            const slot = (lastBleState && lastBleState.ringingSlot !== 0xFF) ? lastBleState.ringingSlot : 0;
            sendCmd(`DISMISS_ALARM:${slot}`);
            sendCmd('BTN:ALARM');
            if (virtualRTC) {
                virtualRTC.state.alarmRinging = false;
                if (wrappedUpdateState) wrappedUpdateState(virtualRTC.getState());
            }
            stopAlarm();
        });
    }

    // Bell button is now handled by Timer Tones page below

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
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function unlockAudioContext() {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        } else if (!audioCtx) {
            getAudioCtx();
        }
    }
    window.addEventListener('pointerdown', unlockAudioContext, { once: true });
    window.addEventListener('keydown', unlockAudioContext, { once: true });

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
        } else if (type === 'chime' || type === 'wake') {
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
        } else if (type === 'radar') {
            [0, 0.15, 0.3, 0.45].forEach((offset, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = 800 - (i * 100);
                osc.connect(gain);
                gain.connect(ctx.destination);
                gain.gain.setValueAtTime(0, now + offset);
                gain.gain.linearRampToValueAtTime(0.1, now + offset + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.15);
                osc.start(now + offset);
                osc.stop(now + offset + 0.15);
            });
        } else { // 'classic' or 'synth'
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

    function startAlarm(isTimer = false) {
        if (!isTimer && selectedAlarmSound === 'custom' && customAudio) {
            customAudio.currentTime = 0;
            customAudio.play().catch(e => console.error("Audio play failed:", e));
            return;
        }
        
        if (alarmInterval) return;
        const toneToPlay = isTimer ? (localStorage.getItem('timerTone') || 'classic') : selectedAlarmSound;
        
        playAlarmSoundType(toneToPlay);
        const interval = toneToPlay === 'digital' ? 450 : (toneToPlay === 'wake' ? 1000 : 700);
        alarmInterval = setInterval(() => playAlarmSoundType(toneToPlay), interval);
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
    let renderRafHandle = null;
    let pendingRenderState = null;
    let lastTmrStateSeen = -1;

    let is12hFormat = localStorage.getItem('is12hFormat') === 'true';

    wrappedUpdateState = async (state) => {
        lastBleState = state;
        lastBleState._localTs = Date.now();
        state.is12hFormat = is12hFormat;
        
        // Inject BLE alarms/laps if missing
        if (bleState.connected) {
            if (!state.alarms) {
                // Re-read after an edit, and slowly poll for changes made on
                // the device itself — faster while the alarm view is open.
                const refreshMs = state.mode === 2 ? 2000 : 10000;
                const stale = (Date.now() - lastAlarmReadAt) > refreshMs;
                if ((alarmsDirty || stale || !cachedAlarms) && !isFetchingAlarms) {
                    isFetchingAlarms = true;
                    const fetched = await readAlarms();
                    isFetchingAlarms = false;
                    lastAlarmReadAt = Date.now();
                    if (fetched) {
                        cachedAlarms = fetched;
                        alarmsDirty = false;
                    }
                }
                state.alarms = cachedAlarms;
            }
            // Laps, like alarms, never ride along with telemetry. Cache them and
            // re-read only when the device reports a different lap count.
            // Leaving state.laps undefined on the frames where a read was still
            // in flight is what made the lap panel flip between the list and
            // "Loading laps…", and made the live lap time jump to total elapsed.
            if (state.lapCount === 0) {
                cachedLaps = [];
                cachedLapCount = 0;
                state.laps = cachedLaps;
            } else if (!state.laps || state.laps.length !== state.lapCount) {
                const canRetry = (Date.now() - lastLapReadAt) > 500;
                if (cachedLapCount !== state.lapCount && !isFetchingLaps && canRetry) {
                    isFetchingLaps = true;
                    lastLapReadAt = Date.now();
                    const fetchedLaps = await readLaps(state.lapCount);
                    isFetchingLaps = false;
                    if (fetchedLaps && fetchedLaps.length === state.lapCount) {
                        cachedLaps = fetchedLaps;
                        cachedLapCount = state.lapCount;
                    }
                    // A short read just leaves the cache alone; the count still
                    // differs so the next frame past the backoff tries again.
                }
                state.laps = cachedLaps;
            }
            // Sync virtual RTC
            virtualRTC.setState(state);
        } else if (wsState.connected) {
             virtualRTC.setState(state);
        }
        lastKnownState = state;

        // Pass to the UI layer on the next frame. Coalesced: renderLoop already
        // runs inside rAF, so scheduling one callback per call stacked them up
        // and did the same DOM work several times per frame. Keep the newest
        // state only and render it once.
        pendingRenderState = state;
        if (renderRafHandle !== null) return;

        renderRafHandle = window.requestAnimationFrame(() => {
            renderRafHandle = null;
            const state = pendingRenderState;
            pendingRenderState = null;
            if (!state) return;

            // While a device is connected AND something is counting, renderLoop
            // already repaints every frame from lastBleState using locally
            // interpolated time. Painting the raw telemetry frame here as well
            // makes the digits jump backwards between the two sources — that is
            // the flicker seen on hardware. Let the interpolating loop own the
            // frame; the alarm handling below still runs on every state.
            const interpolating = (bleState.connected || wsState.connected) &&
                                  (state.swState === 1 || state.tmrState === 1);
            if (!interpolating) _origUpdateState(state);

            // Keep the lock-screen countdown in step with the timer. Only a
            // saved timer with "Show on lock screen" enabled posts one.
            if (state.tmrState !== lastTmrStateSeen) {
                lastTmrStateSeen = state.tmrState;
                if (state.tmrState === 1) startLockScreenTimer();
                else stopLockScreenTimer();
            }

            const alarmActive = state.alarmRinging || state.tmrState === 3;

            // Debounce the alarm trigger to avoid rapid beeping when state fluctuates
            if (alarmActive !== lastAlarmState) {
                if (!window.alarmDebounceTimeout) {
                    window.alarmDebounceTimeout = setTimeout(() => {
                        if (alarmActive) {
                            const isTimer = state.tmrState === 3 && !state.alarmRinging;
                            startAlarm(isTimer);
                            let notifTitle = state.alarmRinging
                                ? 'Alarm Ringing!'
                                : (activeTimerMeta ? `${activeTimerMeta.name} finished!` : 'Timer Done!');
                            showNotification(notifTitle, 'Open the clock app to dismiss.');
                        } else {
                            stopAlarm();
                        }
                        lastAlarmState = alarmActive;
                        window.alarmDebounceTimeout = null;
                    }, 250);
                }
            } else if (window.alarmDebounceTimeout) {
                clearTimeout(window.alarmDebounceTimeout);
                window.alarmDebounceTimeout = null;
            }
        });
    };

    virtualRTC = new VirtualRTC();
    function renderLoop() {
        if (!bleState.connected && !wsState.connected) {
            const state = virtualRTC.tick();
            if (state) {
                wrappedUpdateState(state);
            }
        } else if (lastBleState && (lastBleState.swState === 1 || lastBleState.tmrState === 1)) {
            // Only interpolate between telemetry frames while something is
            // actually counting. Re-rendering the whole UI every frame when
            // nothing moves was the main source of lag — idle screens are
            // driven by the 250ms telemetry push instead.
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
    const btnSwResume = document.getElementById('btn-sw-resume');
    if (btnSwResume) btnSwResume.addEventListener('click', () => sendCmd('BTN:UP'));
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
            // e.preventDefault() removed to fix iOS Safari blocking click events
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
        btn.addEventListener('touchstart', start, { passive: true });
        btn.addEventListener('mouseup', stop);
        btn.addEventListener('mouseleave', stop);
        btn.addEventListener('touchend', stop);
        btn.addEventListener('touchcancel', stop);
    }

    // Snooze and Dismiss are wired once, further up with the ringing banner.
    // A second pair of listeners used to live here: both fired on one tap, and
    // because the first had already cleared ringingSlot, the second fell back
    // to slot 0 and snoozed or switched off an unrelated alarm.

    // Timer (Hardware Sync) - we can keep hold to repeat if we want
    const btnUp = document.getElementById('btn-timer-up');
    const btnDown = document.getElementById('btn-timer-down');
    const btnCycle = document.getElementById('btn-timer-cycle');
    if (btnUp) setupHoldToRepeat(btnUp, 'BTN:UP');
    if (btnDown) setupHoldToRepeat(btnDown, 'BTN:DOWN');
    // Timer Tones UI
    const btnTimerBell = document.getElementById('btn-timer-bell-cmd');
    const viewTimerTones = document.getElementById('view-timer-tones');
    const viewTimer = document.getElementById('view-timer');
    const btnTonesBack = document.getElementById('btn-tones-back');
    const toneOptions = document.querySelectorAll('.tone-option');
    let timerTone = localStorage.getItem('timerTone') || 'classic';

    // Initialize tone UI
    toneOptions.forEach(opt => {
        if (opt.dataset.tone === timerTone) {
            opt.classList.add('active');
            opt.querySelector('.checkmark').classList.remove('hidden');
        } else {
            opt.classList.remove('active');
            opt.querySelector('.checkmark').classList.add('hidden');
        }
    });

    if (btnTimerBell && viewTimerTones && viewTimer) {
        btnTimerBell.addEventListener('click', () => {
            viewTimer.classList.add('hidden');
            viewTimerTones.classList.remove('hidden');
        });
    }

    if (btnTonesBack && viewTimerTones && viewTimer) {
        btnTonesBack.addEventListener('click', () => {
            viewTimerTones.classList.add('hidden');
            viewTimer.classList.remove('hidden');
        });
    }

    toneOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            // Remove active from all
            toneOptions.forEach(o => {
                o.classList.remove('active');
                o.querySelector('.checkmark').classList.add('hidden');
            });
            // Add active to clicked
            opt.classList.add('active');
            opt.querySelector('.checkmark').classList.remove('hidden');
            
            // Save & play
            timerTone = opt.dataset.tone;
            localStorage.setItem('timerTone', timerTone);
            
            // Re-use alarm sound type mechanism just for preview
            playAlarmSoundType(timerTone);
        });
    });

});
