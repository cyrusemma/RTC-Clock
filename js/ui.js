// js/ui.js
export const els = {
    warning: document.getElementById('ble-warning'),
    bleNote: document.getElementById('ble-note'),
    indicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    deviceName: document.getElementById('device-name'),
    connectBtn: document.getElementById('connect-btn'),
    wifiBtn: document.getElementById('wifi-connect-btn'),
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
    
    fullscreenToggle: document.getElementById('btn-fullscreen'),
    pwaInstallBanner: document.getElementById('pwa-install-banner'),
    btnPwaInstall: document.getElementById('btn-pwa-install'),
    pwaDismissBtns: document.querySelectorAll('.pwa-dismiss'),
    iosInstallTooltip: document.getElementById('ios-install-tooltip'),
    btnIosDismiss: document.getElementById('btn-ios-dismiss'),
    presetBtns: document.querySelectorAll('.preset-btn'),
    
    // V2.1 Volume Controls
    volumeSlider: document.getElementById('volume-slider'),
    volumeLabel: document.getElementById('volume-label')
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
    const icons = { 'New York': 'location_city', 'London': 'account_balance', 'Accra': 'wb_sunny', 'Tokyo': 'landscape' };
    const html = WORLD_CLOCK_ZONES.map(z => {
        try {
            const formatted = new Intl.DateTimeFormat('en-GB', {
                timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false
            }).format(base);
            const icon = icons[z.label] || 'public';
            return `
            <div class="flex flex-col justify-center min-w-[120px] md:min-w-0 md:w-full bg-surface-variant/20 p-3 rounded-xl border border-outline-variant/20 backdrop-blur-sm snap-center shrink-0 shadow-sm hover:bg-surface-variant/40 transition-colors">
                <div class="flex items-center gap-2 mb-1">
                    <span class="material-symbols-outlined text-[14px] text-primary/70">${icon}</span>
                    <span class="text-xs text-on-surface/80 uppercase tracking-widest">${z.label}</span>
                </div>
                <div class="text-xl font-display-time-mobile text-on-surface drop-shadow-md">${formatted}</div>
            </div>`;
        } catch(e) {
            return '';
        }
    }).join('');
    els.worldClock.innerHTML = html;
}

export function renderAnalogueClock(epochSeconds, tzOffsetHours) {
    if (!els.analogueContainer.querySelector('svg')) {
        const ticks = [...Array(12)].map((_, i) => {
            const angle = i * 30;
            const x1 = 100 + 82 * Math.sin(angle * Math.PI / 180);
            const y1 = 100 - 82 * Math.cos(angle * Math.PI / 180);
            const x2 = 100 + 95 * Math.sin(angle * Math.PI / 180);
            const y2 = 100 - 95 * Math.cos(angle * Math.PI / 180);
            const isQuarter = (i % 3 === 0);
            const strokeWidth = isQuarter ? 'stroke-[3]' : 'stroke-2';
            const strokeColor = isQuarter ? 'stroke-on-surface' : 'stroke-on-surface/50';
            return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${strokeColor} ${strokeWidth}" />`;
        }).join('');

        els.analogueContainer.innerHTML = `
        <svg viewBox="0 0 200 200" class="w-[220px] h-[220px] mx-auto drop-shadow-2xl">
            <circle cx="100" cy="100" r="97" class="fill-surface-variant/20 stroke-outline-variant/40 stroke-[1.5]" />
            <circle cx="100" cy="100" r="90" class="fill-transparent stroke-outline-variant/10 stroke-[0.5]" />
            ${ticks}
            <line id="analog-hour" x1="100" y1="100" x2="100" y2="50" class="stroke-on-surface stroke-[5] clock-hand-sweep" stroke-linecap="round" />
            <line id="analog-min" x1="100" y1="100" x2="100" y2="30" class="stroke-primary-fixed stroke-[3] clock-hand-sweep" stroke-linecap="round" />
            <line id="analog-sec" x1="100" y1="100" x2="100" y2="20" class="stroke-error stroke-[1.5] clock-hand-sweep" stroke-linecap="round" />
            <circle cx="100" cy="100" r="4" class="fill-error" />
            <circle cx="100" cy="100" r="2" class="fill-on-surface" />
        </svg>`;
    }

    const d = new Date((epochSeconds + tzOffsetHours * 3600) * 1000);
    const h = d.getUTCHours() % 12;
    const m = d.getUTCMinutes();
    const s = d.getUTCSeconds();

    const hourAngle = (h + m / 60) * 30;
    const minAngle  = (m + s / 60) * 6;
    const secAngle  = s * 6;

    const hourHand = document.getElementById('analog-hour');
    const minHand = document.getElementById('analog-min');
    const secHand = document.getElementById('analog-sec');

    if (hourHand) hourHand.style.transform = `rotate(${hourAngle}deg)`;
    if (minHand) minHand.style.transform = `rotate(${minAngle}deg)`;
    if (secHand) secHand.style.transform = `rotate(${secAngle}deg)`;
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
    <svg class="absolute w-full h-full drop-shadow-lg" viewBox="0 0 100 100">
        <circle class="glass-ring-bg" cx="50" cy="50" fill="none" r="${radius}" stroke-width="6"></circle>
        <circle class="${ringClass}" cx="50" cy="50" fill="none" r="${radius}" stroke="${strokeColor}"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
            stroke-linecap="round"
            stroke-width="6" />
        <g opacity="0.4" stroke="#849495" stroke-width="1">
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
    
    // Check if we have state.is12hFormat (we need it from global or pass it, we can just use the exported one or read from localStorage)
    const is12h = localStorage.getItem('is12hFormat') === 'true';

    let html = alarms.map((alarm, i) => {
        // Hide unused alarms to make it feel like a dynamic list
        if (!alarm.en && !alarm.sn && alarm.h === 0 && alarm.m === 0 && alarm.rep === 0) {
            return '';
        }

        let h = alarm.h;
        let amPm = '';
        if (is12h) {
            amPm = h >= 12 ? ' PM' : ' AM';
            h = h % 12 || 12;
        }

        const timeStr = `${pad(h)}:${pad(alarm.m)}${amPm}`;
        const disabledClass = (alarm.en || alarm.sn) ? '' : 'opacity-50 grayscale-[0.5]';
        const dayStr = days.map((d, di) => {
            const active = (alarm.rep & (1 << di)) ? 'class="text-primary font-bold"' : 'class="text-on-surface-variant/40"';
            return `<span ${active}>${d}</span>`;
        }).join(' ');
        
        // CSS Toggle Switch HTML
        const toggleSwitch = `
            <label class="relative inline-flex items-center cursor-pointer mt-2" onclick="event.stopPropagation(); window.toggleAlarm(${i}, ${!alarm.en});">
                <input type="checkbox" class="sr-only peer" ${alarm.en ? 'checked' : ''} readonly>
                <div class="w-11 h-6 bg-surface-variant/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary border border-outline-variant/30 shadow-inner"></div>
            </label>
        `;

        // Calculate a staggered delay based on the index for the animation
        const staggerDelay = i * 100;

        return `
        <div class="glass-card rounded-2xl p-5 flex justify-between items-center cursor-pointer hover:bg-surface-variant/40 transition-all duration-300 ${disabledClass} border-t border-white/10 shadow-lg hover:-translate-y-1 hover:shadow-[0_10px_25px_rgba(0,0,0,0.3)] animate-fade-in-up" style="animation-delay: ${staggerDelay}ms; animation-fill-mode: both;" data-slot="${i}">
            <div>
                <div class="font-display-time-mobile text-headline-lg text-primary-fixed glow-text group-hover:text-primary transition-colors">${timeStr}</div>
                <div class="font-mono-label text-[10px] text-outline mt-1 uppercase tracking-wider flex gap-1.5">
                    ${dayStr}
                </div>
            </div>
            <div class="flex flex-col items-end gap-1">
                ${toggleSwitch}
            </div>
        </div>`;
    }).join('');
    
    if (html.trim() === '') {
        html = `<div class="text-center text-on-surface-variant font-mono-label py-10">No alarms set.<br>Click '+' to add one.</div>`;
    }
    
    els.alarmCardsContainer.innerHTML = html;
}

// DOM Diffing Helpers
function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
}
function setHTML(el, html) {
    if (el && el.innerHTML !== html) el.innerHTML = html;
}
function setClass(el, className, condition) {
    if (!el) return;
    if (condition && !el.classList.contains(className)) el.classList.add(className);
    else if (!condition && el.classList.contains(className)) el.classList.remove(className);
}

let lastActiveMode = -1;
export function setActiveModeView(mode) {
    if (lastActiveMode === mode) return;
    lastActiveMode = mode;
    
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

    // Bottom Nav
    const navBtns = document.querySelectorAll('.bottom-nav .clay-tab');
    navBtns.forEach((btn, idx) => {
        if (idx === mode) {
            btn.classList.add('text-primary', 'nav-active');
            btn.classList.remove('text-on-surface-variant');
        } else {
            btn.classList.remove('text-primary', 'nav-active');
            btn.classList.add('text-on-surface-variant');
        }
    });
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
        
        const amPm = state.is12hFormat ? `<span class="text-3xl md:text-5xl ml-2 text-on-surface-variant">${d.getUTCHours() >= 12 ? 'PM' : 'AM'}</span>` : '';
        setHTML(els.clockTime, `${hhStr}<span class="colon-pulse">:</span>${mmStr}<span class="colon-pulse">:</span>${ssStr}${amPm}`);
        setText(els.clockTz, `UTC${state.timezoneOffset >= 0 ? '+' : ''}${state.timezoneOffset}`);
        
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
        const dateTextEl = document.getElementById('date-text');
        if (dateTextEl) {
            setText(dateTextEl, d.toLocaleDateString(undefined, dateOptions));
        } else {
            setText(els.clockDate, d.toLocaleDateString(undefined, dateOptions));
        }
        
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
        setHTML(els.swTime, `${pad(m)}:${pad(s)}<span class="text-3xl md:text-5xl opacity-60 ml-1">.${padMs(millis)}</span>`);
        
        const swStates = ['READY', 'RUNNING', 'PAUSED'];
        setText(els.swState, swStates[state.swState] || 'UNKNOWN');
        
        // Only modify classes if they need changing to prevent thrashing
        if (els.swState.dataset.state !== String(state.swState)) {
            els.swState.dataset.state = String(state.swState);
            els.swState.classList.remove('text-tertiary-fixed-dim', 'text-primary-fixed', 'text-secondary-fixed-dim', 'bg-tertiary-fixed/10', 'bg-primary-fixed/10', 'bg-secondary-fixed/10');
        
        let stateClass = '';
        const rippleEl = document.getElementById('sw-ripple');
        if (state.swState === 1) {
            stateClass = 'state-running';
            els.swState.classList.add('text-tertiary-fixed-dim', 'bg-tertiary-fixed/10');
            if (rippleEl) rippleEl.classList.add('ripple-active');
        } else if (state.swState === 2) {
            stateClass = 'state-paused';
            els.swState.classList.add('text-secondary-fixed-dim', 'bg-secondary-fixed/10');
            if (rippleEl) rippleEl.classList.remove('ripple-active');
        } else {
            els.swState.classList.add('text-primary-fixed', 'bg-primary-fixed/10');
            if (rippleEl) rippleEl.classList.remove('ripple-active');
        }
        
        // Stopwatch ring resets every 60 seconds (60000 ms)
        renderTimerRing(ms % 60000, 60000, false, els.swRingContainer, 'timer-ring-progress', stateClass);

        // Buttons
        const btnSwStart = document.getElementById('btn-sw-start');
        const btnSwResume = document.getElementById('btn-sw-resume');
        const btnSwPause = document.getElementById('btn-sw-pause');
        const btnSwLap = document.getElementById('btn-sw-lap');
        const btnSwReset = document.getElementById('btn-sw-reset');
        
        if (state.swState === 0) { // READY
            if (btnSwStart) btnSwStart.classList.remove('hidden');
            if (btnSwResume) btnSwResume.classList.add('hidden');
            if (btnSwPause) btnSwPause.classList.add('hidden');
            if (btnSwLap) btnSwLap.classList.add('hidden');
            if (btnSwReset) btnSwReset.classList.add('hidden');
        } else if (state.swState === 1) { // RUNNING
            if (btnSwStart) btnSwStart.classList.add('hidden');
            if (btnSwResume) btnSwResume.classList.add('hidden');
            if (btnSwPause) btnSwPause.classList.remove('hidden');
            if (btnSwLap) btnSwLap.classList.remove('hidden');
            if (btnSwReset) btnSwReset.classList.add('hidden');
        } else if (state.swState === 2) { // PAUSED
            if (btnSwStart) btnSwStart.classList.add('hidden');
            if (btnSwResume) btnSwResume.classList.remove('hidden');
            if (btnSwPause) btnSwPause.classList.add('hidden');
            if (btnSwLap) btnSwLap.classList.add('hidden');
            if (btnSwReset) btnSwReset.classList.remove('hidden');
        }

        // Laps
        if (state.lapCount > 0) {
            setClass(els.swLapsContainer, 'hidden', false);
            if (state.laps && state.laps.length > 0) {
                let lastLap = 0;
                const html = state.laps.map((lapMs, i) => {
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
                    let borderClass = 'border-l-4 border-outline-variant/30';
                    if (i > 0) {
                        const diff = deltaMs - (state.laps[i-1] - (i > 1 ? state.laps[i-2] : 0));
                        if (diff < 0) {
                            deltaStr = `<span class="text-tertiary-fixed font-bold float-right">-${padMs(Math.abs(diff))}</span>`;
                            borderClass = 'border-l-4 border-tertiary-fixed';
                        } else {
                            deltaStr = `<span class="text-error font-bold float-right">+${padMs(diff)}</span>`;
                            borderClass = 'border-l-4 border-error';
                        }
                    }
                    
                    const animationClass = (i === state.laps.length - 1 && state.swState === 1) ? 'slide-in-top' : '';
                    return `
                    <div class="p-3 bg-surface-variant/20 rounded-lg ${borderClass} text-sm mb-1 shadow-sm flex justify-between items-center ${animationClass}">
                        <span class="text-outline-variant font-bold">Lap ${i + 1}</span>
                        <div class="flex flex-col items-end">
                            <span class="text-on-surface text-lg font-display-time-mobile">${pad(lm)}:${pad(ls)}.<span class="opacity-60 text-xs">${padMs(lcm)}</span></span>
                            ${deltaStr}
                        </div>
                    </div>`;
                }).join('');
                setHTML(els.swLaps, html);
            } else {
                setHTML(els.swLaps, `<div class="py-2 text-on-surface-variant text-sm italic text-center">Loading laps...</div>`);
            }
        } else {
            setClass(els.swLapsContainer, 'hidden', true);
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

        if (els.timerHrDisplay) setText(els.timerHrDisplay, pad(displayHr));
        if (els.timerMinDisplay) setText(els.timerMinDisplay, pad(displayMin));
        if (els.timerSecDisplay) setText(els.timerSecDisplay, pad(displaySec));
        
        const tmrStates = ['READY', 'RUNNING', 'PAUSED', 'RINGING'];
        const stateStr = tmrStates[state.tmrState] || 'UNKNOWN';
        
        const timerStateEl = document.getElementById('timer-state');
        const timerRipple = document.getElementById('timer-ripple');
        
        let stateClass = '';
        if (timerStateEl) {
            setText(timerStateEl, stateStr);
            if (timerStateEl.dataset.state !== String(state.tmrState)) {
                timerStateEl.dataset.state = String(state.tmrState);
                timerStateEl.classList.remove('text-tertiary-fixed-dim', 'text-primary-fixed', 'text-secondary-fixed-dim', 'text-error', 'bg-tertiary-fixed/10', 'bg-primary-fixed/10', 'bg-secondary-fixed/10', 'bg-error/10');
            
            if (state.tmrState === 1) { // RUNNING
                stateClass = 'state-running';
                timerStateEl.classList.add('text-tertiary-fixed-dim', 'bg-tertiary-fixed/10');
                if (timerRipple) timerRipple.classList.add('ripple-active');
            } else if (state.tmrState === 2) { // PAUSED
                stateClass = 'state-paused';
                timerStateEl.classList.add('text-secondary-fixed-dim', 'bg-secondary-fixed/10');
                if (timerRipple) timerRipple.classList.remove('ripple-active');
            } else if (state.tmrState === 3) { // RINGING
                timerStateEl.classList.add('text-error', 'bg-error/10');
                if (timerRipple) timerRipple.classList.remove('ripple-active');
            } else { // READY
                timerStateEl.classList.add('text-primary-fixed', 'bg-primary-fixed/10');
                if (timerRipple) timerRipple.classList.remove('ripple-active');
            }
        }
        
        if (els.timerActionIcon) {
            const label = document.getElementById('timer-action-label');
            if (state.tmrState === 1) {
                setText(els.timerActionIcon, 'pause');
                if (label) setText(label, 'Pause');
            } else if (state.tmrState === 2) {
                setText(els.timerActionIcon, 'play_arrow');
                if (label) setText(label, 'Resume');
            } else if (state.tmrState === 3) {
                setText(els.timerActionIcon, 'stop');
                if (label) setText(label, 'Stop');
            } else {
                setText(els.timerActionIcon, 'play_arrow');
                if (label) setText(label, 'Start');
            }
        }

        if (state.tmrState === 3) {
            els.timerRingingBanner.classList.remove('hidden');
        } else {
            els.timerRingingBanner.classList.add('hidden');
        }

        const isRinging = state.tmrState === 3;
        const ringContainer = document.getElementById('timer-ring-container');
        if (ringContainer) renderTimerRing(state.tmrRemainingMs, totalMs, isRinging, ringContainer, 'timer-ring-progress', stateClass);
    }

    // 5. System Settings
    if (state.buzzerVolume !== undefined) {
        if (els.volumeSlider && document.activeElement !== els.volumeSlider) {
            els.volumeSlider.value = state.buzzerVolume;
        }
        if (els.volumeLabel) {
            const pct = Math.round((state.buzzerVolume / 255) * 100);
            setText(els.volumeLabel, `${pct}%`);
        }
    }
}

}
}
