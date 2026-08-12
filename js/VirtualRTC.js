// js/VirtualRTC.js

export class VirtualRTC {
    // Matches SNOOZE_MINUTES in the firmware (RTC_Clock_V2.ino)
    static SNOOZE_MS = 5 * 60 * 1000;

    constructor() {
        this.state = {
            mode: 0,
            epoch: Math.floor(Date.now() / 1000),
            timezoneOffset: -(new Date().getTimezoneOffset() / 60),
            is12hFormat: false,
            settingMode: false,
            settingPosition: 0,
            
            // Stopwatch
            swElapsedMs: 0,
            swState: 0, // 0: Ready, 1: Running, 2: Paused
            lapCount: 0,
            laps: [],
            
            // Alarms
            alarms: [
                { h: 7, m: 0, en: 1, rep: 0, sn: 0 },
                { h: 0, m: 0, en: 0, rep: 0, sn: 0 },
                { h: 0, m: 0, en: 0, rep: 0, sn: 0 },
                { h: 0, m: 0, en: 0, rep: 0, sn: 0 }
            ],
            alarmViewSlot: 0,
            alarmRinging: false,
            ringingSlot: 0xFF,
            
            // Timer
            tmrInitHr: 0,
            tmrInitMin: 0,
            tmrInitSec: 0,
            tmrRemainingMs: 0,
            tmrState: 0, // 0: Ready, 1: Running, 2: Paused, 3: Ringing
            tmrSetField: 0,
            
            // System
            buzzerVolume: 180
        };
        
        this.lastTickTime = performance.now();
        this.running = true;
    }

    // Call this every frame
    tick() {
        if (!this.running) return null;
        
        const now = performance.now();
        const deltaMs = now - this.lastTickTime;
        this.lastTickTime = now;
        
        this.state.epoch = Math.floor(Date.now() / 1000);
        
        let stateChanged = false;

        // Stopwatch logic
        if (this.state.swState === 1) {
            this.state.swElapsedMs += deltaMs;
            stateChanged = true;
        }

        // Timer logic
        if (this.state.tmrState === 1) {
            this.state.tmrRemainingMs -= deltaMs;
            if (this.state.tmrRemainingMs <= 0) {
                this.state.tmrRemainingMs = 0;
                this.state.tmrState = 3; // Ringing
            }
            stateChanged = true;
        }
        
        return stateChanged ? { ...this.state } : null;
    }

    getState() {
        this.state.epoch = Math.floor(Date.now() / 1000);
        return { ...this.state };
    }

    /**
     * Fire any alarm that is due. Honours the repeat-day bitmask and pending
     * snoozes. Returns true when the ringing state changed, so the caller
     * knows it has to push a UI update.
     */
    checkAlarms(now = new Date()) {
        if (this.state.alarmRinging) return false;

        const h = now.getHours();
        const m = now.getMinutes();
        const todayBit = 1 << now.getDay();
        const nowMs = now.getTime();

        for (let i = 0; i < this.state.alarms.length; i++) {
            const alarm = this.state.alarms[i];
            if (!alarm.en) continue;

            // A snoozed alarm re-rings when its snooze window expires
            if (alarm.sn && alarm.snoozeUntil) {
                if (nowMs >= alarm.snoozeUntil) {
                    alarm.sn = 0;
                    alarm.snoozeUntil = 0;
                    this.state.alarmRinging = true;
                    this.state.ringingSlot = i;
                    return true;
                }
                continue;
            }

            if (alarm.h !== h || alarm.m !== m) continue;
            // rep === 0 means a one-shot alarm: fires on any day
            if (alarm.rep && !(alarm.rep & todayBit)) continue;

            // Prevent re-triggering within the same minute
            const stamp = `${i}-${now.toDateString()}-${h}-${m}`;
            if (this.lastTriggeredAlarm === stamp) continue;
            this.lastTriggeredAlarm = stamp;

            this.state.alarmRinging = true;
            this.state.ringingSlot = i;
            return true;
        }
        return false;
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
    }

    handleCommand(cmdStr) {
        let needsUpdate = true;
        const parts = cmdStr.split(':');
        const cmd = parts[0];
        const args = parts[1] ? parts[1].split(',') : [];

        if (cmd === 'MODE') {
            this.state.mode = parseInt(args[0]);
        } else if (cmd === 'SYNC') {
            // Already handled by system clock
        } else if (cmd === 'BTN') {
            const btn = args[0];
            if (this.state.mode === 1) { // Stopwatch
                if (btn === 'UP') {
                    if (this.state.swState === 0 || this.state.swState === 2) {
                        this.state.swState = 1; // Start
                    }
                } else if (btn === 'DOWN') {
                    if (this.state.swState === 1) {
                        this.state.swState = 2; // Pause
                    }
                } else if (btn === 'LAP') {
                    if (this.state.swState === 1) {
                        this.state.laps.push(this.state.swElapsedMs);
                        this.state.lapCount = this.state.laps.length;
                    }
                } else if (btn === 'ALARM') {
                    this.state.swState = 0;
                    this.state.swElapsedMs = 0;
                    this.state.laps = [];
                    this.state.lapCount = 0;
                }
            } else if (this.state.mode === 3) { // Timer
                if (this.state.tmrState === 3 && btn === 'ALARM') {
                    this.state.tmrState = 0; // Stop ringing
                    this.state.tmrRemainingMs = (this.state.tmrInitHr * 3600 + this.state.tmrInitMin * 60 + this.state.tmrInitSec) * 1000;
                } else if (btn === 'UP') {
                    if (this.state.tmrState === 0 || this.state.tmrState === 2) {
                        this.state.tmrState = 1; // Start
                    }
                } else if (btn === 'DOWN') {
                    if (this.state.tmrState === 1) {
                        this.state.tmrState = 2; // Pause
                    }
                } else if (btn === 'ALARM') {
                    this.state.tmrState = 0;
                    this.state.tmrRemainingMs = (this.state.tmrInitHr * 3600 + this.state.tmrInitMin * 60 + this.state.tmrInitSec) * 1000;
                }
            } else if (this.state.mode === 2 || this.state.alarmRinging) {
                if (btn === 'ALARM') {
                    this.state.alarmRinging = false;
                }
            }
        } else if (cmd === 'RESET_TIMER') {
            this.state.tmrState = 0;
            this.state.tmrRemainingMs = (this.state.tmrInitHr * 3600 + this.state.tmrInitMin * 60 + this.state.tmrInitSec) * 1000;
        } else if (cmd === 'SET_TIMER') {
            if (args.length === 3) {
                this.state.tmrInitHr = parseInt(args[0]) || 0;
                this.state.tmrInitMin = parseInt(args[1]) || 0;
                this.state.tmrInitSec = parseInt(args[2]) || 0;
            } else {
                this.state.tmrInitHr = 0;
                this.state.tmrInitMin = parseInt(args[0]) || 0;
                this.state.tmrInitSec = parseInt(args[1]) || 0;
            }
            this.state.tmrRemainingMs = (this.state.tmrInitHr * 3600 + this.state.tmrInitMin * 60 + this.state.tmrInitSec) * 1000;
            this.state.tmrState = 0;
        } else if (cmd === 'SET_ALARM') {
            const slot = parseInt(args[0]);
            this.state.alarms[slot] = {
                h: parseInt(args[1]),
                m: parseInt(args[2]),
                en: parseInt(args[3]),
                rep: parseInt(args[4]),
                sn: 0
            };
        } else if (cmd === 'ALARM_EN') {
            const slot = parseInt(args[0]);
            const alarm = this.state.alarms[slot];
            if (alarm) {
                alarm.en = parseInt(args[1]) ? 1 : 0;
                // Disabling the alarm that is currently ringing also silences it
                if (!alarm.en) {
                    alarm.sn = 0;
                    alarm.snoozeUntil = 0;
                    if (this.state.ringingSlot === slot) {
                        this.state.alarmRinging = false;
                        this.state.ringingSlot = 0xFF;
                    }
                }
            }
        } else if (cmd === 'DISMISS_ALARM') {
            const slot = args.length ? parseInt(args[0]) : this.state.ringingSlot;
            // The firmware only acts when the slot is the one actually ringing
            // (`slot == ringAlarmIdx`). Mirror that, so a stray or duplicated
            // command cannot switch off an alarm that was never involved.
            if (slot !== this.state.ringingSlot) return null;
            const alarm = this.state.alarms[slot];
            if (alarm) {
                alarm.sn = 0;
                alarm.snoozeUntil = 0;
                // One-shot alarms switch off once dismissed; repeating ones stay armed
                if (!alarm.rep) alarm.en = 0;
            }
            this.state.alarmRinging = false;
            this.state.ringingSlot = 0xFF;
        } else if (cmd === 'SNOOZE') {
            const slot = args.length ? parseInt(args[0]) : this.state.ringingSlot;
            // Same guard as DISMISS_ALARM: only the ringing alarm can be snoozed
            if (slot !== this.state.ringingSlot) return null;
            const alarm = this.state.alarms[slot];
            if (alarm) {
                alarm.sn = 1;
                alarm.snoozeUntil = Date.now() + VirtualRTC.SNOOZE_MS;
            }
            this.state.alarmRinging = false;
            this.state.ringingSlot = 0xFF;
        } else if (cmd === 'SET_VOLUME') {
            const v = parseInt(args[0]);
            this.state.buzzerVolume = isNaN(v) ? 180 : Math.max(0, Math.min(255, v));
        } else {
            needsUpdate = false;
        }

        return needsUpdate ? this.getState() : null;
    }
}
