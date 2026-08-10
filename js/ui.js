// js/ui.js
export const els = {
    warning: document.getElementById('ble-warning'),
    bleNote: document.getElementById('ble-note'),
    indicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    deviceName: document.getElementById('device-name'),
    connectBtn: document.getElementById('connect-btn'),
    wifiBtn: document.getElementById('wifi-btn'),
    wifiModal: document.getElementById('wifi-modal'),
    wifiSsid: document.getElementById('wifi-ssid'),
    wifiPass: document.getElementById('wifi-pass'),
    wifiCancel: document.getElementById('btn-wifi-cancel'),
    wifiSend: document.getElementById('btn-wifi-send'),
    tabs: document.querySelectorAll('.clay-tab'),
    views: document.querySelectorAll('.view'),
    
    clockTime: document.getElementById('clock-time'),
    clockDate: document.getElementById('clock-date'),
    clockTz: document.getElementById('clock-tz'),
    clockDigital: document.getElementById('clock-digital'),
    clockAnalogue: document.getElementById('clock-analogue'),
    analogueContainer: document.getElementById('analogue-clock-container'),
    worldClock: document.getElementById('world-clock'),
    browserClock: document.getElementById('browser-clock'),
    
    swTime: document.getElementById('sw-time'),
    swState: document.getElementById('sw-state'),
    swLapsContainer: document.getElementById('sw-laps-container'),
    swLaps: document.getElementById('sw-laps'),
    
    alarmRingingBanner: document.getElementById('alarm-ringing-banner'),
    alarmCardsContainer: document.getElementById('alarm-cards-container'),
    alarmEditor: document.getElementById('alarm-editor'),
    alarmEditSlotLabel: document.getElementById('alarm-edit-slot-label'),
    alarmSnoozeBtn: document.getElementById('btn-alarm-snooze'),
    alarmCancelBtn: document.getElementById('btn-alarm-cancel'),
    
    timerRingingBanner: document.getElementById('timer-ringing-banner'),
    timerSetupView: document.getElementById('timer-setup-view'),
    timerRunView: document.getElementById('timer-run-view'),
    timerHrDisplay: document.getElementById('timer-hr-display'),
    timerMinDisplay: document.getElementById('timer-min-display'),
    timerSecDisplay: document.getElementById('timer-sec-display'),
    timerActionIcon: document.getElementById('timer-action-icon'),
    
    swRingContainer: document.getElementById('sw-ring-container'),

    logContent: document.getElementById('log-content'),
    
    fullscreenToggle: document.getElementById('fullscreen-toggle'),
    pwaInstallBanner: document.getElementById('pwa-install-banner'),
    btnPwaInstall: document.getElementById('btn-pwa-install'),
    pwaDismissBtns: document.querySelectorAll('.pwa-dismiss'),
    iosInstallTooltip: document.getElementById('ios-install-tooltip'),
    btnIosDismiss: document.getElementById('btn-ios-dismiss'),
    presetBtns: document.querySelectorAll('.preset-btn')
};

export function initUI() {
    if (!navigator.bluetooth) {
        if (els.bleNote) {
            els.bleNote.textContent = 'Web Bluetooth is unavailable in this browser. Use Chrome or Edge on localhost or HTTPS.';
            els.bleNote.classList.remove('hidden');
        }
    } else if (els.bleNote) {
        els.bleNote.classList.add('hidden');
    }
}

export function updateConnectionState(state, deviceName) {
    els.indicator.className = 'w-3.5 h-3.5 rounded-full shadow-inner';
    if (state === 'connected') {
        els.indicator.classList.add('bg-tertiary-fixed-dim');
        els.statusText.textContent = 'Connected';
        if (deviceName) {
            els.deviceName.textContent = deviceName;
            els.deviceName.classList.remove('hidden');
        }
        els.connectBtn.textContent = 'Disconnect';
    } else if (state === 'connecting') {
        els.indicator.classList.add('bg-secondary-fixed-dim', 'animate-pulse');
        els.statusText.textContent = 'Connecting...';
        els.deviceName.classList.add('hidden');
        els.connectBtn.textContent = 'Connecting';
    } else {
        els.indicator.classList.add('bg-error');
        els.statusText.textContent = 'Disconnected';
        els.deviceName.classList.add('hidden');
        els.connectBtn.textContent = 'Connect';
    }
}

export function appendLog(msg, type = 'sys') {
    const div = document.createElement('div');
    const colorClass = type === 'tx' ? 'text-primary-fixed' : (type === 'rx' ? 'text-tertiary-fixed-dim' : 'text-on-surface-variant');
    div.className = `py-0.5 border-b border-outline-variant/20 last:border-0 opacity-90 ${colorClass}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    div.textContent = `[${time}] ${msg}`;
    els.logContent.appendChild(div);
    if (els.logContent.children.length > 20) {
        els.logContent.removeChild(els.logContent.firstChild);
    }
    els.logContent.scrollTop = els.logContent.scrollHeight;
}

function pad(num, size = 2) {
    let s = "0000" + num;
    return s.substring(s.length - size);
}

function padMs(num) {
    let s = "00" + Math.floor(num / 10);
    return s.substring(s.length - 2);
}

const WORLD_CLOCK_ZONES = [
    { label: 'New York',  tz: 'America/New_York' },
    { label: 'London',    tz: 'Europe/London' },
    { label: 'Accra',     tz: 'Africa/Accra' },
    { label: 'Tokyo',     tz: 'Asia/Tokyo' },
];

export function renderWorldClock(epochSeconds) {
    const base = new Date(epochSeconds * 1000);
    const html = WORLD_CLOCK_ZONES.map(z => {
        try {
            const formatted = new Intl.DateTimeFormat('en-GB', {
                timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false
            }).format(base);
            return `<div class="flex justify-between py-1.5 text-xs text-on-surface border-b border-outline-variant/30 last:border-0 opacity-90"><span>${z.label}</span><span class="font-bold">${formatted}</span></div>`;
        } catch(e) {
            return '';
        }
    }).join('');
    els.worldClock.innerHTML = html;
}

export function renderAnalogueClock(epochSeconds, tzOffsetHours) {
    const d = new Date((epochSeconds + tzOffsetHours * 3600) * 1000);
    const h = d.getUTCHours() % 12;
    const m = d.getUTCMinutes();
    const s = d.getUTCSeconds();

    const hourAngle = (h + m / 60) * 30;
    const minAngle  = (m + s / 60) * 6;
    const secAngle  = s * 6;

    const hand = (angle, len) => {
        const x = 100 + len * Math.sin(angle * Math.PI / 180);
        const y = 100 - len * Math.cos(angle * Math.PI / 180);
        return { x, y };
    };

    const h2 = hand(hourAngle, 50);
    const m2 = hand(minAngle, 70);
    const s2 = hand(secAngle, 80);

    const ticks = [...Array(12)].map((_, i) => {
        const angle = i * 30;
        const x1 = 100 + 82 * Math.sin(angle * Math.PI / 180);
        const y1 = 100 - 82 * Math.cos(angle * Math.PI / 180);
        const x2 = 100 + 95 * Math.sin(angle * Math.PI / 180);
        const y2 = 100 - 95 * Math.cos(angle * Math.PI / 180);
        return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="stroke-on-surface/50 stroke-2" />`;
    }).join('');

    els.analogueContainer.innerHTML = `
    <svg viewBox="0 0 200 200" class="w-[180px] h-[180px] mx-auto drop-shadow-lg">
        <circle cx="100" cy="100" r="97" class="fill-transparent stroke-outline-variant/30 stroke-2" />
        ${ticks}
        <line x1="100" y1="100" x2="${h2.x.toFixed(2)}" y2="${h2.y.toFixed(2)}" class="stroke-on-surface stroke-[5]" stroke-linecap="round" />
        <line x1="100" y1="100" x2="${m2.x.toFixed(2)}" y2="${m2.y.toFixed(2)}" class="stroke-primary-fixed stroke-[3]" stroke-linecap="round" />
        <line x1="100" y1="100" x2="${s2.x.toFixed(2)}" y2="${s2.y.toFixed(2)}" class="stroke-error stroke-[1.5]" stroke-linecap="round" />
        <circle cx="100" cy="100" r="4" class="fill-error" />
    </svg>`;
}

export function renderTimerRing(remainingMs, totalMs, isRinging, containerEl, ringClassBase = 'timer-ring-progress', stateClass = '') {
    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    const fraction = totalMs > 0 ? Math.max(0, remainingMs / totalMs) : 0;
    const offset = circumference * (1 - fraction);
    
    let ringClass = "progress-ring-circle";
    if (isRinging) ringClass += ' animate-pulse';
    
    let strokeColor = "#00dbe9";
    if (stateClass === 'state-running') strokeColor = '#00e383';
    else if (stateClass === 'state-paused') strokeColor = '#ffba20';

    if (!containerEl) return;
    containerEl.innerHTML = `
    <svg class="absolute w-full h-full" viewBox="0 0 100 100">
        <circle class="glass-ring-bg" cx="50" cy="50" fill="none" r="${radius}" stroke-width="4"></circle>
        <circle class="${ringClass}" cx="50" cy="50" fill="none" r="${radius}" stroke="${strokeColor}"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
            stroke-linecap="round"
            stroke-width="4" />
        <g opacity="0.3" stroke="#849495" stroke-width="0.5">
            <line x1="50" x2="50" y1="2" y2="6"></line>
            <line x1="50" x2="50" y1="94" y2="98"></line>
            <line x1="2" x2="6" y1="50" y2="50"></line>
            <line x1="94" x2="98" y1="50" y2="50"></line>
        </g>
    </svg>`;
}

export function renderAlarmCards(alarms, activeSlot) {
    if (!alarms || alarms.length === 0) return;
    
    const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const html = alarms.map((alarm, i) => {
        const timeStr = `${pad(alarm.h)}:${pad(alarm.m)}`;
        const disabledClass = (alarm.en || alarm.sn) ? '' : 'opacity-50';
        const dayStr = days.map((d, di) => {
            const active = (alarm.rep & (1 << di)) ? 'class="text-primary font-bold"' : 'class="text-on-surface-variant/40"';
            return `<span ${active}>${d}</span>`;
        }).join(' ');

        return `
        <div class="glass-card rounded-2xl p-5 flex justify-between items-center cursor-pointer hover:bg-surface-variant/20 transition-all ${disabledClass}" data-slot="${i}">
            <div>
                <div class="font-display-time-mobile text-headline-lg text-primary-fixed glow-text">${timeStr}</div>
                <div class="font-mono-label text-[10px] text-outline mt-1 uppercase tracking-wider flex gap-1.5">
                    ${dayStr}
                </div>
            </div>
            <div class="flex flex-col items-end gap-1">
                <span class="font-mono-label text-xs font-bold ${alarm.en ? 'text-primary' : 'text-on-surface-variant'}">${alarm.sn ? 'SNZ' : (alarm.en ? 'ON' : 'OFF')}</span>
                <span class="material-symbols-outlined text-outline-variant text-[20px]">${alarm.en ? 'alarm_on' : 'alarm_off'}</span>
            </div>
        </div>`;
    }).join('');
    
    els.alarmCardsContainer.innerHTML = html;
}

export function setActiveModeView(mode) {
    const viewIds = ['view-clock', 'view-stopwatch', 'view-alarm', 'view-timer'];

    els.tabs.forEach(tab => {
        tab.classList.toggle('active', parseInt(tab.dataset.mode) === mode);
    });

    els.views.forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('active');
    });
    const activeViewId = viewIds[mode];
    if (activeViewId) {
        const activeView = document.getElementById(activeViewId);
        if (activeView) {
            activeView.classList.remove('hidden');
            activeView.classList.add('active');
        }
    }
}

export function updateState(state) {
    setActiveModeView(state.mode);

    // 1. Clock
    if (state.mode === 0) {
        // format epoch
        const d = new Date((state.epoch + state.timezoneOffset * 3600) * 1000);
        let h = d.getUTCHours();
        const m = d.getUTCMinutes();
        const s = d.getUTCSeconds();
        if (state.is12hFormat) {
            h = h % 12 || 12;
        }
        let hhStr = pad(h);
        let mmStr = pad(m);
        let ssStr = pad(s);
        
        if (state.settingMode) {
            if (state.settingPosition === 0) hhStr = `<span class="editing">${hhStr}</span>`;
            if (state.settingPosition === 1) mmStr = `<span class="editing">${mmStr}</span>`;
            if (state.settingPosition === 2) ssStr = `<span class="editing">${ssStr}</span>`;
            if (state.settingPosition === 3) els.clockTz.classList.add('editing');
            else els.clockTz.classList.remove('editing');
        } else {
            els.clockTz.classList.remove('editing');
        }
        
        els.clockTime.innerHTML = `${hhStr}:${mmStr}:${ssStr}`;
        els.clockTz.textContent = `UTC${state.timezoneOffset >= 0 ? '+' : ''}${state.timezoneOffset}`;
        
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
        els.clockDate.textContent = d.toLocaleDateString(undefined, dateOptions);
        
        renderWorldClock(state.epoch);
        // Always re-render analogue if visible
        renderAnalogueClock(state.epoch, state.timezoneOffset);
    }

    // 2. Stopwatch
    if (state.mode === 1) {
        const ms = state.swElapsedMs;
        const millis = ms % 1000;
        const s = Math.floor(ms / 1000) % 60;
        const m = Math.floor(ms / 60000);
        els.swTime.textContent = `${pad(m)}:${pad(s)}.${padMs(millis)}`;
        
        const swStates = ['Ready', 'Running', 'Paused'];
        els.swState.textContent = swStates[state.swState] || 'Unknown';
        
        let stateClass = '';
        if (state.swState === 1) stateClass = 'state-running';
        else if (state.swState === 2) stateClass = 'state-paused';
        
        // Stopwatch ring resets every 60 seconds (60000 ms)
        renderTimerRing(ms % 60000, 60000, false, els.swRingContainer, 'timer-ring-progress', stateClass);

        // Laps
        if (state.lapCount > 0) {
            els.swLapsContainer.classList.remove('hidden');
            if (state.laps && state.laps.length > 0) {
                let lastLap = 0;
                els.swLaps.innerHTML = state.laps.map((lapMs, i) => {
                    const deltaMs = i === 0 ? lapMs : lapMs - lastLap;
                    lastLap = lapMs;
                    
                    const deltaMillis = deltaMs % 1000;
                    const ds = Math.floor(deltaMs / 1000) % 60;
                    const dm = Math.floor(deltaMs / 60000);
                    
                    // We can show delta if we want, or just the lap time with a delta indicator.
                    const lcm = lapMs % 1000;
                    const ls = Math.floor(lapMs / 1000) % 60;
                    const lm = Math.floor(lapMs / 60000);
                    
                    let deltaStr = '';
                    if (i > 0) {
                        const diff = deltaMs - (state.laps[i-1] - (i > 1 ? state.laps[i-2] : 0));
                        if (diff < 0) {
                            deltaStr = `<span class="text-tertiary-fixed font-bold float-right">-${padMs(Math.abs(diff))}</span>`;
                        } else {
                            deltaStr = `<span class="text-error font-bold float-right">+${padMs(diff)}</span>`;
                        }
                    }
                    
                    return `<div class="py-1 border-b border-outline-variant/30 last:border-0 text-sm">Lap ${i + 1}: ${pad(lm)}:${pad(ls)}.${padMs(lcm)} ${deltaStr}</div>`;
                }).join('');
            } else {
                els.swLaps.innerHTML = `<div class="py-2 text-on-surface-variant text-sm italic">${state.lapCount} laps recorded... (Syncing)</div>`;
            }
        } else {
            els.swLapsContainer.classList.add('hidden');
        }
    }

    // 3. Alarm
    if (state.mode === 2 || state.alarmRinging) {
        if (state.alarms) {
            renderAlarmCards(state.alarms, state.alarmViewSlot);
        }
        
        if (state.alarmRinging) {
            els.alarmRingingBanner.classList.remove('hidden');
        } else {
            els.alarmRingingBanner.classList.add('hidden');
        }
    }

    // 4. Timer
    if (state.mode === 3 || state.tmrState === 3) {
        const isRunningOrPaused = state.tmrState === 1 || state.tmrState === 2;
        
        if (isRunningOrPaused || state.tmrState === 3) {
            els.timerSetupView.classList.add('hidden');
            els.timerRunView.classList.remove('hidden');
            els.timerRunView.classList.add('flex');
        } else {
            els.timerSetupView.classList.remove('hidden');
            els.timerRunView.classList.add('hidden');
            els.timerRunView.classList.remove('flex');
        }

        const ms = state.tmrRemainingMs;
        const totalMs = (state.tmrInitHr * 3600 + state.tmrInitMin * 60 + state.tmrInitSec) * 1000;
        
        let displayHr, displayMin, displaySec;
        
        if (state.tmrSetField !== 0) {
            displayHr = state.tmrInitHr;
            displayMin = state.tmrInitMin;
            displaySec = state.tmrInitSec;
        } else {
            displaySec = Math.floor(ms / 1000) % 60;
            displayMin = Math.floor(ms / 60000) % 60;
            displayHr = Math.floor(ms / 3600000);
        }

        if (els.timerHrDisplay) els.timerHrDisplay.textContent = pad(displayHr);
        if (els.timerMinDisplay) els.timerMinDisplay.textContent = pad(displayMin);
        if (els.timerSecDisplay) els.timerSecDisplay.textContent = pad(displaySec);
        
        const tmrStates = ['Ready', 'Running', 'Paused', 'Ringing'];
        const stateStr = tmrStates[state.tmrState] || 'Unknown';
        
        const timerStateEl = document.getElementById('timer-state');
        if (timerStateEl) timerStateEl.textContent = stateStr.toUpperCase();
        
        if (els.timerActionIcon) {
            if (state.tmrState === 1) els.timerActionIcon.textContent = 'pause';
            else els.timerActionIcon.textContent = 'play_arrow';
        }

        let stateClass = '';
        if (state.tmrState === 1) stateClass = 'state-running';
        else if (state.tmrState === 2) stateClass = 'state-paused';
        
        const isRinging = state.tmrState === 3;
        const ringContainer = document.getElementById('timer-ring-container');
        if (ringContainer) renderTimerRing(state.tmrRemainingMs, totalMs, isRinging, ringContainer, 'timer-ring-progress', stateClass);

        if (state.tmrState === 3) {
            els.timerRingingBanner.classList.remove('hidden');
        } else {
            els.timerRingingBanner.classList.add('hidden');
        }
    }
}
