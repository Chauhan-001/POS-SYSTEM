/**
 * alertSound — shared "Quick Sound Alerts" implementation.
 *
 * The two-tone beep used when a new KOT reaches the kitchen. Lives here so
 * the alert plays from ANY workspace (not just the Kitchen screen) without
 * duplicating the Web Audio code. The kitchen display's mute button and the
 * app-level watcher share the `enabled` flag, so muting on the kitchen screen
 * silences alerts everywhere.
 */

let enabled = true;

/** Flip the runtime alert flag (kitchen mute button). Not persisted. */
export function setKotAlertEnabled(v: boolean): void {
  enabled = v;
}

export function isKotAlertEnabled(): boolean {
  return enabled;
}

/** Play the notification beep (two ascending sine tones, ~450 ms). */
export function playKotAlertSound(): void {
  try {
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.15, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1108, ctx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.45);
  } catch {
    // Never let a sound failure break the kitchen workflow.
  }
}
