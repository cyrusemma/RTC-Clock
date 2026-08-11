// js/VirtualRTC.js

export class VirtualRTC {
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
                { h: 0, m: 0, en: 0, rep: 0, sn: 0 },
                { h: 0, m: 0, en: 0, rep: 0, sn: 0 },
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
        } else if (cmd === 'SET_VOLUME') {
            const v = parseInt(args[0]);
            this.state.buzzerVolume = isNaN(v) ? 180 : Math.max(0, Math.min(255, v));
        } else {
            needsUpdate = false;
        }

        return needsUpdate ? this.getState() : null;
    }
}
