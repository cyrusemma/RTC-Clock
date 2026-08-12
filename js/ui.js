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
    swLapCurrent: document.getElementById('sw-lap-current'),
    swLapCurrentNum: document.getElementById('sw-lap-current-num'),
    swLapCurrentTime: document.getElementById('sw-lap-current-time'),
    
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
    timerPresetsGrid: document.getElementById('timer-presets-grid'),
    timerActiveLabel: document.getElementById('timer-active-label'),
    timerActiveIcon: document.getElementById('timer-active-icon'),
    timerActiveName: document.getElementById('timer-active-name'),
    timerActiveLock: document.getElementById('timer-active-lock'),

    swRingContainer: document.getElementById('sw-ring-container'),

    logContent: document.getElementById('log-content'),
    
    fullscreenToggle: document.getElementById('btn-fullscreen'),
    pwaInstallBanner: document.getElementById('pwa-install-banner'),
    btnPwaInstall: document.getElementById('btn-pwa-install'),
    pwaDismissBtns: document.querySelectorAll('.pwa-dismiss'),
    iosInstallTooltip: document.getElementById('ios-install-tooltip'),
    btnIosDismiss: document.getElementById('btn-ios-dismiss'),

    // V2.1 Volume Controls
    volumeSlider: document.getElementById('volume-slider'),
    volumeLabel: document.getElementById('volume-label')
};

// Every browser on iOS is WebKit underneath, and WebKit ships no Web Bluetooth
// — Chrome or Edge on an iPhone cannot connect over BLE either. iPadOS reports
// itself as a Mac, hence the touch-point check.
export function isIosDevice() {
    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function initUI() {
    if (!els.bleNote) return;

    if (navigator.bluetooth) {
        els.bleNote.classList.add('hidden');
        return;
    }

    els.bleNote.textContent = isIosDevice()
        ? 'iPhone and iPad cannot use Bluetooth from a browser. Join the clock\'s WiFi, then use Menu → WiFi Connect.'
        : 'Web Bluetooth is unavailable in this browser. Use Chrome or Edge on localhost or HTTPS.';
    els.bleNote.classList.remove('hidden');
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

const WORLD_CLOCK_ICONS = { 'New York': 'location_city', 'London': 'account_balance', 'Accra': 'wb_sunny', 'Tokyo': 'landscape' };

/*
 * The firmware's tz_offset is one whole-hour integer with no DST logic — see
 * TIMEZONE_COUNTRIES above. An IANA zone like America/New_York genuinely
 * shifts between -5 and -4 across the year, so its offset can't be baked in
 * statically the way the picker's list is; it has to be computed against
 * "now" and then rounded to the nearest whole hour the device can store.
 *
 * Format `date` as if it were UTC in the target zone, then diff that against
 * the real UTC time of `date` — the standard way to recover a zone's current
 * offset without parsing a locale-formatted "GMT+9" string.
 */
export function computeZoneOffsetHours(tz, date = new Date()) {
    try {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const parts = {};
        dtf.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
        const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10);
        const asUTC = Date.UTC(
            parseInt(parts.year, 10), parseInt(parts.month, 10) - 1, parseInt(parts.day, 10),
            hour, parseInt(parts.minute, 10), parseInt(parts.second, 10)
        );
        return Math.round((asUTC - date.getTime()) / 3600000);
    } catch (e) {
        return null;
    }
}

// The country/city name shown next to the clock — set whenever the picker or
// the World Clock list is used to change the zone. Cleared implicitly: it is
// only ever rendered when its stored offset still matches the device's
// current one, so a stale or externally-changed offset just shows no name
// rather than a wrong one.
const SELECTED_TZ_KEY = 'selectedTzZone';

export function getSelectedTzZone() {
    try {
        const raw = JSON.parse(localStorage.getItem(SELECTED_TZ_KEY));
        if (raw && typeof raw.name === 'string' && Number.isInteger(raw.offset)) return raw;
    } catch (e) { /* corrupt or absent */ }
    return null;
}

export function setSelectedTzZone(name, offset) {
    localStorage.setItem(SELECTED_TZ_KEY, JSON.stringify({ name, offset }));
}

// Intl.DateTimeFormat construction is expensive — build each zone's formatter
// once instead of on every frame.
const WORLD_CLOCK_FORMATTERS = WORLD_CLOCK_ZONES.map(z => {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false
        });
    } catch (e) {
        return null;
    }
});

export function renderWorldClock(epochSeconds) {
    const base = new Date(epochSeconds * 1000);
    const icons = WORLD_CLOCK_ICONS;
    const html = WORLD_CLOCK_ZONES.map((z, zi) => {
        try {
            const fmt = WORLD_CLOCK_FORMATTERS[zi];
            if (!fmt) return '';
            const formatted = fmt.format(base);
            const icon = icons[z.label] || 'public';
            return `
            <button class="world-clock-row w-full flex items-center justify-between gap-3 bg-surface-variant/20 px-3 py-2.5 rounded-xl border border-outline-variant/20 backdrop-blur-sm shadow-sm hover:bg-surface-variant/40 active:scale-[0.98] transition-all cursor-pointer" data-tz="${z.tz}" data-label="${z.label}" title="Sync the clock to ${z.label}">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="material-symbols-outlined text-[14px] text-primary/70 shrink-0">${icon}</span>
                    <span class="text-xs text-on-surface/80 uppercase tracking-widest truncate">${z.label}</span>
                </div>
                <div class="text-lg font-display-time-mobile text-on-surface drop-shadow-md tabular-nums shrink-0">${formatted}</div>
            </button>`;
        } catch(e) {
            return '';
        }
    }).join('');
    // Only touch the DOM when the rendered minute actually changed
    setHTML(els.worldClock, html);
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
    
    let strokeColor = "#00dbe9";
    if (stateClass === 'state-running') strokeColor = '#00e383';
    else if (stateClass === 'state-paused') strokeColor = '#ffba20';

    if (!containerEl) return;

    // Build the SVG once, then only touch the attributes that actually change.
    // Rewriting innerHTML rebuilt the entire ring 60 times a second while the
    // stopwatch or timer was running, which is what made those screens lag.
    let progress = containerEl.querySelector('.progress-ring-circle');
    if (!progress) {
        containerEl.innerHTML = `
    <svg class="absolute w-full h-full drop-shadow-lg" viewBox="0 0 100 100">
        <circle class="glass-ring-bg" cx="50" cy="50" fill="none" r="${radius}" stroke-width="6"></circle>
        <circle class="progress-ring-circle" cx="50" cy="50" fill="none" r="${radius}"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-linecap="round"
            stroke-width="6" />
        <g opacity="0.4" stroke="#849495" stroke-width="1">
            <line x1="50" x2="50" y1="2" y2="6"></line>
            <line x1="50" x2="50" y1="94" y2="98"></line>
            <line x1="2" x2="6" y1="50" y2="50"></line>
            <line x1="94" x2="98" y1="50" y2="50"></line>
        </g>
    </svg>`;
        progress = containerEl.querySelector('.progress-ring-circle');
        if (!progress) return;
    }

    const offsetStr = offset.toFixed(2);
    if (progress.getAttribute('stroke-dashoffset') !== offsetStr) {
        progress.setAttribute('stroke-dashoffset', offsetStr);
    }
    if (progress.getAttribute('stroke') !== strokeColor) {
        progress.setAttribute('stroke', strokeColor);
    }
    progress.classList.toggle('animate-pulse', !!isRinging);
}

/* Alarm labels live in the browser: the firmware's SET_ALARM protocol carries
   only slot, hour, minute, enabled and repeat days, with nowhere to put a name.
   Kept in memory so a 4 Hz render does not re-parse storage every frame. */
const ALARM_LABELS_KEY = 'alarmLabels';

function loadAlarmLabels() {
    try {
        const raw = JSON.parse(localStorage.getItem(ALARM_LABELS_KEY));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    } catch (e) { /* corrupt or absent */ }
    return {};
}

let alarmLabels = loadAlarmLabels();

export function getAlarmLabel(slot) {
    return alarmLabels[slot] || '';
}

export function setAlarmLabel(slot, label) {
    const clean = String(label || '').trim().slice(0, 24);
    if (clean) alarmLabels[slot] = clean;
    else delete alarmLabels[slot];
    localStorage.setItem(ALARM_LABELS_KEY, JSON.stringify(alarmLabels));
}

export function renderAlarmCards(alarms, activeSlot) {
    const container = els.alarmCardsContainer;
    if (!container) return;

    // `undefined` means "not known yet" (a BLE alarm read is still in flight)
    // and is NOT the same as "no alarms". Telemetry frames arrive without the
    // alarm list between reads, so clobbering the cards here is what made the
    // list blink against real hardware. Hold what is already on screen.
    if (!alarms) {
        if (!container.dataset.rendered) {
            setHTML(container, `<div class="col-span-full text-center text-on-surface-variant font-mono-label py-10">Loading alarms…</div>`);
        }
        return;
    }

    if (alarms.length === 0) {
        setHTML(container, `<div class="col-span-full text-center text-on-surface-variant font-mono-label py-10">No alarms set.<br>Click '+' to add one.</div>`);
        container.dataset.rendered = '1';
        return;
    }

    const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    // The staggered entry animation belongs to the first paint only. Replaying
    // it whenever an alarm is toggled makes the whole list blink.
    const firstPaint = !container.dataset.cardsPainted;

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

        // Staggered entry, first paint only
        const entryClass = firstPaint ? ' animate-fade-in-up' : '';
        const entryStyle = firstPaint ? ` style="animation-delay: ${i * 100}ms; animation-fill-mode: both;"` : '';

        const label = (alarmLabels[i] || '').trim();
        const labelHtml = label
            ? `<div class="font-mono-label text-[10px] text-primary-fixed-dim uppercase tracking-widest mb-1 truncate max-w-[180px]">${escapeHtml(label)}</div>`
            : '';

        // A snoozed alarm looked exactly like an armed one here, even though the
        // device's own display marks it SNZ. It is still going to go off.
        const snoozedChip = alarm.sn ? `<span class="alarm-snooze-chip">Snoozed</span>` : '';

        return `
        <div class="alarm-card glass-card rounded-2xl p-5 flex justify-between items-center cursor-pointer hover:bg-surface-variant/40 transition-all duration-300 ${disabledClass} border-t border-white/10 shadow-lg hover:-translate-y-1 hover:shadow-[0_10px_25px_rgba(0,0,0,0.3)]${entryClass}"${entryStyle} data-slot="${i}">
            <div class="min-w-0">
                ${labelHtml}
                <div class="font-display-time-mobile text-headline-lg text-primary-fixed glow-text group-hover:text-primary transition-colors">${timeStr}</div>
                <div class="font-mono-label text-[10px] text-outline mt-1 uppercase tracking-wider flex gap-1.5 items-center flex-wrap">
                    ${dayStr}
                    ${snoozedChip}
                </div>
            </div>
            <div class="flex flex-col items-end gap-1">
                ${toggleSwitch}
            </div>
        </div>`;
    }).join('');
    
    const hasCards = html.trim() !== '';
    if (!hasCards) {
        html = `<div class="col-span-full text-center text-on-surface-variant font-mono-label py-10">No alarms set.<br>Click '+' to add one.</div>`;
    }

    // Diffed: rewriting this unconditionally restarts the card entry
    // animations on every frame and thrashes layout.
    setHTML(container, html);
    // Re-assigning an identical dataset value still counts as a DOM mutation,
    // so only write these once.
    if (!container.dataset.rendered) container.dataset.rendered = '1';
    if (hasCards && !container.dataset.cardsPainted) container.dataset.cardsPainted = '1';
}

/* ─────────────────────────────────────────
   SAVED TIMERS (stickers, names, lock screen)
   ───────────────────────────────────────── */

// The sticker set offered in the timer editor. `tone` is the Tailwind colour
// class used for the icon on the saved-timer card.
export const TIMER_STICKERS = {
    timer:       { label: 'Timer',       icon: 'hourglass_empty',  tone: 'text-primary' },
    meeting:     { label: 'Meeting',     icon: 'present_to_all',   tone: 'text-primary' },
    sleep:       { label: 'Sleep',       icon: 'dark_mode',        tone: 'text-tertiary' },
    exercise:    { label: 'Exercise',    icon: 'fitness_center',   tone: 'text-secondary' },
    mindfulness: { label: 'Mindfulness', icon: 'self_improvement', tone: 'text-tertiary' },
    work:        { label: 'Work',        icon: 'work',             tone: 'text-secondary' },
};

export function getSticker(key) {
    return TIMER_STICKERS[key] || TIMER_STICKERS.timer;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export function renderTimerPresets(presets, activeId, maxPresets) {
    const grid = els.timerPresetsGrid;
    if (!grid) return;

    const cards = presets.map(p => {
        const s = getSticker(p.sticker);
        const activeClass = p.id === activeId ? ' preset-active' : '';
        const lockBadge = p.lock
            ? `<span class="material-symbols-outlined preset-lock-badge" title="Shown on lock screen">lock</span>`
            : '';
        return `
        <button class="preset-btn glass-button rounded-2xl px-2 py-3 flex flex-col items-center justify-center gap-1.5 h-24 hover:-translate-y-1 transition-all group border-t border-white/5${activeClass}" data-preset-id="${p.id}">
            ${lockBadge}
            <span class="material-symbols-outlined text-[24px] ${s.tone} group-hover:scale-110 transition-transform duration-300">${s.icon}</span>
            <span class="font-mono-label text-mono-label text-on-surface truncate w-full text-center px-1">${escapeHtml(p.name)}</span>
            <span class="text-[10px] text-outline group-hover:text-on-surface-variant transition-colors">${pad(p.hr)}:${pad(p.min)}:${pad(p.sec)}</span>
        </button>`;
    }).join('');

    const addCard = presets.length >= maxPresets ? '' : `
        <button id="btn-timer-preset-add" class="rounded-2xl p-4 flex flex-col items-center justify-center h-24 border-2 border-dashed border-outline-variant/40 hover:border-primary/50 hover:bg-primary/5 transition-all group cursor-pointer text-on-surface-variant hover:text-primary">
            <span class="material-symbols-outlined text-3xl group-hover:scale-110 transition-transform">add</span>
            <span class="text-[10px] font-mono-label mt-1">New Timer</span>
        </button>`;

    setHTML(grid, cards + addCard);
}

// Name + sticker shown above the countdown ring while a saved timer runs
export function renderActiveTimerLabel(meta) {
    if (!els.timerActiveLabel) return;
    const show = !!(meta && meta.name);
    setClass(els.timerActiveLabel, 'hidden', !show);
    setClass(els.timerActiveLabel, 'flex', show);
    if (!show) return;
    const s = getSticker(meta.sticker);
    setText(els.timerActiveIcon, s.icon);
    setText(els.timerActiveName, meta.name);
    setClass(els.timerActiveLock, 'hidden', !meta.lock);
}

/* ─────────────────────────────────────────
   TIME ZONE PICKER
   ───────────────────────────────────────── */
// The firmware's SET_TIMEZONE:<-12..14> stores one whole-hour UTC offset with
// no daylight-saving logic — a fixed manual offset, the same constraint a
// physical travel clock has. Offsets below are each country's currently
// standard (non-DST) whole-hour value; fractional-hour zones (India +5:30,
// Nepal +5:45, etc.) are not representable and are left out on purpose.
export const TIMEZONE_COUNTRIES = [
    { name: 'American Samoa', offset: -11 },
    { name: 'Hawaii, USA', offset: -10 },
    { name: 'Alaska, USA', offset: -9 },
    { name: 'Los Angeles, USA', offset: -8 },
    { name: 'Vancouver, Canada', offset: -8 },
    { name: 'Denver, USA', offset: -7 },
    { name: 'Chicago, USA', offset: -6 },
    { name: 'Mexico City, Mexico', offset: -6 },
    { name: 'New York, USA', offset: -5 },
    { name: 'Toronto, Canada', offset: -5 },
    { name: 'Lima, Peru', offset: -5 },
    { name: 'Bogotá, Colombia', offset: -5 },
    { name: 'Santiago, Chile', offset: -4 },
    { name: 'Caracas, Venezuela', offset: -4 },
    { name: 'Buenos Aires, Argentina', offset: -3 },
    { name: 'São Paulo, Brazil', offset: -3 },
    { name: 'South Georgia', offset: -2 },
    { name: 'Azores, Portugal', offset: -1 },
    { name: 'United Kingdom', offset: 0 },
    { name: 'Ghana', offset: 0 },
    { name: 'Iceland', offset: 0 },
    { name: 'Senegal', offset: 0 },
    { name: 'Nigeria', offset: 1 },
    { name: 'France', offset: 1 },
    { name: 'Germany', offset: 1 },
    { name: 'Spain', offset: 1 },
    { name: 'Poland', offset: 1 },
    { name: 'Algeria', offset: 1 },
    { name: 'South Africa', offset: 2 },
    { name: 'Egypt', offset: 2 },
    { name: 'Greece', offset: 2 },
    { name: 'Israel', offset: 2 },
    { name: 'Finland', offset: 2 },
    { name: 'Kenya', offset: 3 },
    { name: 'Russia (Moscow)', offset: 3 },
    { name: 'Saudi Arabia', offset: 3 },
    { name: 'Turkey', offset: 3 },
    { name: 'Iraq', offset: 3 },
    { name: 'United Arab Emirates', offset: 4 },
    { name: 'Oman', offset: 4 },
    { name: 'Azerbaijan', offset: 4 },
    { name: 'Pakistan', offset: 5 },
    { name: 'Kazakhstan', offset: 5 },
    { name: 'Uzbekistan', offset: 5 },
    { name: 'Bangladesh', offset: 6 },
    { name: 'Kyrgyzstan', offset: 6 },
    { name: 'Thailand', offset: 7 },
    { name: 'Vietnam', offset: 7 },
    { name: 'Jakarta, Indonesia', offset: 7 },
    { name: 'Cambodia', offset: 7 },
    { name: 'China', offset: 8 },
    { name: 'Singapore', offset: 8 },
    { name: 'Philippines', offset: 8 },
    { name: 'Malaysia', offset: 8 },
    { name: 'Taiwan', offset: 8 },
    { name: 'Japan', offset: 9 },
    { name: 'South Korea', offset: 9 },
    { name: 'Sydney, Australia', offset: 10 },
    { name: 'Papua New Guinea', offset: 10 },
    { name: 'Guam', offset: 10 },
    { name: 'Solomon Islands', offset: 11 },
    { name: 'New Caledonia', offset: 11 },
    { name: 'New Zealand', offset: 12 },
    { name: 'Fiji', offset: 12 },
    { name: 'Tonga', offset: 13 },
    { name: 'Samoa', offset: 13 },
    { name: 'Kiribati (Line Islands)', offset: 14 },
];

let tzPickerBuilt = false;

export function renderTimezonePicker(container, selectedOffset) {
    if (!container) return;
    if (!tzPickerBuilt) {
        const html = TIMEZONE_COUNTRIES.map((c, i) => {
            const sign = c.offset >= 0 ? '+' : '';
            return `
            <button class="tz-row" data-offset="${c.offset}" data-name="${escapeHtml(c.name)}">
                <span class="tz-row-name">${escapeHtml(c.name)}</span>
                <span class="tz-row-right">
                    <span class="tz-row-time" id="tz-row-time-${i}">--:--</span>
                    <span class="tz-row-offset">UTC${sign}${c.offset}</span>
                </span>
            </button>`;
        }).join('');
        setHTML(container, html);
        tzPickerBuilt = true;
    }
    container.querySelectorAll('.tz-row').forEach(row => {
        setClass(row, 'tz-row-selected', parseInt(row.dataset.offset) === selectedOffset);
    });
}

// Cheap per-second tick: only touches the rows whose minute label actually
// changed, via setText's diff — call only while the picker is on screen.
export function tickTimezonePicker() {
    const nowMs = Date.now();
    TIMEZONE_COUNTRIES.forEach((c, i) => {
        const el = document.getElementById(`tz-row-time-${i}`);
        if (!el) return;
        const d = new Date(nowMs + c.offset * 3600000);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        setText(el, `${hh}:${mm}`);
    });
}

// DOM Diffing Helpers
function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
}
// Comparing against el.innerHTML looks like a diff but never matches: the
// browser re-serialises what it parsed, so `checked` comes back as
// `checked=""` and `class="a  b"` gets normalised. Any markup containing a
// boolean attribute therefore failed the check on every call and rewrote the
// whole subtree — which is what made the alarm list flicker at the telemetry
// rate. Compare against the string we actually wrote instead.
const lastWrittenHTML = new WeakMap();
function setHTML(el, html) {
    if (!el) return;
    if (lastWrittenHTML.get(el) === html) return;
    lastWrittenHTML.set(el, html);
    el.innerHTML = html;
}
function setClass(el, className, condition) {
    if (!el) return;
    if (condition && !el.classList.contains(className)) el.classList.add(className);
    else if (!condition && el.classList.contains(className)) el.classList.remove(className);
}

let lastActiveMode = -1;
// `force` repaints even when the mode number has not changed — needed when
// returning from an app-local page (About, How It Works) that is not one of
// the four device modes: the view sweep still has to re-run to bring the
// real mode view back, even though `mode` itself never moved.
export function setActiveModeView(mode, force = false) {
    if (lastActiveMode === mode && !force) return;
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

        // Show the last-picked country/city name only while it still matches
        // the device's actual offset — if the zone was changed some other way
        // (the hardware buttons, a different session) the remembered name is
        // no longer trustworthy, so this falls back to no name rather than a
        // wrong one.
        const tzCountryBtn = document.getElementById('clock-tz-country');
        if (tzCountryBtn) {
            const selected = getSelectedTzZone();
            const match = selected && selected.offset === state.timezoneOffset;
            setClass(tzCountryBtn, 'hidden', !match);
            setClass(tzCountryBtn, 'flex', !!match);
            if (match) setText(document.getElementById('clock-tz-country-text'), selected.name);
        }

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
        
        // Derived every frame (pure, no DOM writes) so the ring keeps its state styling
        let stateClass = '';
        if (state.swState === 1) stateClass = 'state-running';
        else if (state.swState === 2) stateClass = 'state-paused';

        // Only modify classes if they need changing to prevent thrashing
        if (els.swState.dataset.state !== String(state.swState)) {
            els.swState.dataset.state = String(state.swState);
            els.swState.classList.remove('text-tertiary-fixed-dim', 'text-primary-fixed', 'text-secondary-fixed-dim', 'bg-tertiary-fixed/10', 'bg-primary-fixed/10', 'bg-secondary-fixed/10');

            const rippleEl = document.getElementById('sw-ripple');
            if (state.swState === 1) {
                els.swState.classList.add('text-tertiary-fixed-dim', 'bg-tertiary-fixed/10');
                if (rippleEl) rippleEl.classList.add('ripple-active');
            } else if (state.swState === 2) {
                els.swState.classList.add('text-secondary-fixed-dim', 'bg-secondary-fixed/10');
                if (rippleEl) rippleEl.classList.remove('ripple-active');
            } else {
                els.swState.classList.add('text-primary-fixed', 'bg-primary-fixed/10');
                if (rippleEl) rippleEl.classList.remove('ripple-active');
            }
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

        // Live in-progress lap — the split since the last recorded lap, ticking
        // in real time. Only two short text nodes change per frame, so this is
        // cheap enough to run at the stopwatch's refresh rate.
        const recorded = (state.laps && state.laps.length) ? state.laps : [];
        const lastLapMs = recorded.length ? recorded[recorded.length - 1] : 0;
        const currentLapMs = Math.max(0, ms - lastLapMs);
        const swActive = state.swState === 1 || state.swState === 2;

        if (els.swLapCurrent) {
            setClass(els.swLapCurrent, 'hidden', !swActive);
            setClass(els.swLapCurrent, 'flex', swActive);
            if (swActive) {
                setText(els.swLapCurrentNum, String((state.lapCount || 0) + 1));
                const cMillis = currentLapMs % 1000;
                const cs = Math.floor(currentLapMs / 1000) % 60;
                const cm = Math.floor(currentLapMs / 60000);
                setHTML(els.swLapCurrentTime,
                    `${pad(cm)}:${pad(cs)}.<span class="opacity-60 text-xs">${padMs(cMillis)}</span>`);
            }
        }

        // Laps
        if (state.lapCount > 0 || swActive) {
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
            } else if (state.lapCount > 0) {
                // Device reports laps we have not fetched yet (BLE read pending)
                setHTML(els.swLaps, `<div class="py-2 text-on-surface-variant text-sm italic text-center">Loading laps...</div>`);
            } else {
                // Running, but nothing recorded yet — the live row above is enough
                setHTML(els.swLaps, '');
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
        
        // Derived every frame (pure, no DOM writes) so the ring keeps its state styling
        let stateClass = '';
        if (state.tmrState === 1) stateClass = 'state-running';
        else if (state.tmrState === 2) stateClass = 'state-paused';

        if (timerStateEl) {
            setText(timerStateEl, stateStr);
            // Only modify classes if they need changing to prevent thrashing
            if (timerStateEl.dataset.state !== String(state.tmrState)) {
                timerStateEl.dataset.state = String(state.tmrState);
                timerStateEl.classList.remove('text-tertiary-fixed-dim', 'text-primary-fixed', 'text-secondary-fixed-dim', 'text-error', 'bg-tertiary-fixed/10', 'bg-primary-fixed/10', 'bg-secondary-fixed/10', 'bg-error/10');

                if (state.tmrState === 1) { // RUNNING
                    timerStateEl.classList.add('text-tertiary-fixed-dim', 'bg-tertiary-fixed/10');
                    if (timerRipple) timerRipple.classList.add('ripple-active');
                } else if (state.tmrState === 2) { // PAUSED
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
