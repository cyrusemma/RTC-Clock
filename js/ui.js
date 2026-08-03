// js/ui.js
export const els = {
    warning: document.getElementById('ble-warning'),
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
    timerTime: document.getElementById('timer-time'),
    timerState: document.getElementById('timer-state'),
    timerRingContainer: document.getElementById('timer-ring-container'),
    
    logContent: document.getElementById('log-content')
};

export function initUI() {
    if (!navigator.bluetooth) {
        els.warning.classList.add('hidden');
    }
}

export function updateConnectionState(state, deviceName) {
    els.indicator.className = `indicator ${state}`;
    if (state === 'connected') {
        els.statusText.textContent = 'Connected';
        if (deviceName) {
            els.deviceName.textContent = deviceName;
            els.deviceName.classList.remove('hidden');
        }
        els.connectBtn.textContent = 'Disconnect';
    } else if (state === 'connecting') {
        els.statusText.textContent = 'Connecting...';
        els.deviceName.classList.add('hidden');
        els.connectBtn.textContent = 'Connecting';
    } else {
        els.statusText.textContent = 'Disconnected';
        els.deviceName.classList.add('hidden');
        els.connectBtn.textContent = 'Connect';
    }
}

export function appendLog(msg, type = 'sys') {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
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
            return `<div class="world-clock-row"><span>${z.label}</span><span>${formatted}</span></div>`;
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
        return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="clock-tick" />`;
    }).join('');

    els.analogueContainer.innerHTML = `
    <svg viewBox="0 0 200 200" class="analogue-clock">
        <circle cx="100" cy="100" r="97" class="clock-face" />
        ${ticks}
        <line x1="100" y1="100" x2="${h2.x.toFixed(2)}" y2="${h2.y.toFixed(2)}" class="clock-hand-hour" />
        <line x1="100" y1="100" x2="${m2.x.toFixed(2)}" y2="${m2.y.toFixed(2)}" class="clock-hand-min" />
        <line x1="100" y1="100" x2="${s2.x.toFixed(2)}" y2="${s2.y.toFixed(2)}" class="clock-hand-sec" />
        <circle cx="100" cy="100" r="4" class="clock-center" />
    </svg>`;
}

export function renderTimerRing(remainingMs, totalMs, isRinging) {
    const radius = 90;
    const circumference = 2 * Math.PI * radius;
    const fraction = totalMs > 0 ? Math.max(0, remainingMs / totalMs) : 0;
    const offset = circumference * (1 - fraction);
    const ringClass = isRinging ? 'timer-ring-progress ringing' : 'timer-ring-progress';

    els.timerRingContainer.innerHTML = `
    <svg viewBox="0 0 200 200" class="timer-ring">
        <circle cx="100" cy="100" r="${radius}" class="timer-ring-bg" />
        <circle cx="100" cy="100" r="${radius}" class="${ringClass}"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
            transform="rotate(-90 100 100)" />
    </svg>`;
}

export function renderAlarmCards(alarms, activeSlot) {
    if (!alarms || alarms.length === 0) return;
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const html = alarms.map((alarm, i) => {
        const timeStr = `${pad(alarm.h)}:${pad(alarm.m)}`;
        const disabledClass = (alarm.en || alarm.sn) ? '' : 'disabled';
        const dayStr = days.map((d, di) => {
            const active = (alarm.rep & (1 << di)) ? 'style="color: var(--primary-color);"' : '';
            return `<span ${active}>${d}</span>`;
        }).join(' ');

        return `
        <div class="alarm-card ${disabledClass}" data-slot="${i}">
            <div class="alarm-card-time">${timeStr}</div>
            <div class="alarm-card-details" style="text-align: right;">
                <div style="font-weight: 700;">${alarm.sn ? 'SNZ' : (alarm.en ? 'ON' : 'OFF')}</div>
                <div class="alarm-card-days" style="display:flex;gap:6px;">${dayStr}</div>
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
        const cm = Math.floor((ms % 1000) / 10);
        const s = Math.floor(ms / 1000) % 60;
        const m = Math.floor(ms / 60000);
        els.swTime.textContent = `${pad(m)}:${pad(s)}.${pad(cm)}`;
        const swStates = ['Ready', 'Running', 'Paused'];
        els.swState.textContent = swStates[state.swState] || 'Unknown';

        // Laps
        if (state.lapCount > 0) {
            els.swLapsContainer.classList.remove('hidden');
            if (state.laps && state.laps.length > 0) {
                els.swLaps.innerHTML = state.laps.map((lapMs, i) => {
                    const lcm = Math.floor((lapMs % 1000) / 10);
                    const ls = Math.floor(lapMs / 1000) % 60;
                    const lm = Math.floor(lapMs / 60000);
                    return `<div>Lap ${i + 1}: ${pad(lm)}:${pad(ls)}.${pad(lcm)}</div>`;
                }).join('');
            } else {
                els.swLaps.innerHTML = `<div>${state.lapCount} laps recorded... (Syncing)</div>`;
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
        if (state.tmrSetField !== 0) {
            let m = pad(state.tmrInitMin);
            let s = pad(state.tmrInitSec);
            if (state.tmrSetField === 1) m = `<span class="editing">${m}</span>`;
            if (state.tmrSetField === 2) s = `<span class="editing">${s}</span>`;
            els.timerTime.innerHTML = `${m}:${s}.00`;
        } else {
            const ms = state.tmrRemainingMs;
            const cm = Math.floor((ms % 1000) / 10);
            const s = Math.floor(ms / 1000) % 60;
            const m = Math.floor(ms / 60000);
            els.timerTime.textContent = `${pad(m)}:${pad(s)}.${pad(cm)}`;
        }
        
        const tmrStates = ['Ready', 'Running', 'Paused', 'Ringing'];
        els.timerState.textContent = tmrStates[state.tmrState] || 'Unknown';
        
        const totalMs = (state.tmrInitMin * 60 + state.tmrInitSec) * 1000;
        const isRinging = state.tmrState === 3;
        renderTimerRing(state.tmrRemainingMs, totalMs, isRinging);

        if (state.tmrState === 3) {
            els.timerRingingBanner.classList.remove('hidden');
        } else {
            els.timerRingingBanner.classList.add('hidden');
        }
    }
}
