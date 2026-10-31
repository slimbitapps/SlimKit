/** Kurze Töne für Start/Ende */
export function beep(kind: 'start' | 'stop' | 'error') {
  try {
    const ctx = new AudioContext();
    const notes = kind === 'start' ? [660, 880] : kind === 'stop' ? [880, 660] : [330, 260];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.08, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.09);
    });
    setTimeout(() => ctx.close(), 400);
  } catch {
    /* egal */
  }
}
