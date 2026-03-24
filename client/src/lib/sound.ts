// Procedural sound effects using Web Audio API — no external files needed.

let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}
export function isMuted(): boolean { return muted; }

function play(fn: (ctx: AudioContext, t: number) => void) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  fn(c, c.currentTime);
}

// ── Individual sounds ──

export function sfxHit() {
  play((c, t) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.1);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  });
}

export function sfxPlayerHit() {
  play((c, t) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.15);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

export function sfxKill() {
  play((c, t) => {
    // Two-note fanfare
    for (let i = 0; i < 2; i++) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(i === 0 ? 440 : 660, t + i * 0.1);
      gain.gain.setValueAtTime(0.12, t + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(t + i * 0.1);
      osc.stop(t + i * 0.1 + 0.2);
    }
  });
}

export function sfxLevelUp() {
  play((c, t) => {
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t + i * 0.12);
      gain.gain.setValueAtTime(0.15, t + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.3);
      osc.connect(gain).connect(c.destination);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.3);
    });
  });
}

export function sfxHeal() {
  play((c, t) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.linearRampToValueAtTime(800, t + 0.15);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

export function sfxEquip() {
  play((c, t) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.08);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  });
}

export function sfxLoot() {
  play((c, t) => {
    // Coin-like ding
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

export function sfxDeath() {
  play((c, t) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.6);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.6);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}

export function sfxArrow() {
  play((c, t) => {
    // Whoosh
    const bufferSize = 4096;
    const noiseBuffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.1);
    filter.Q.value = 2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    noise.connect(filter).connect(gain).connect(c.destination);
    noise.start(t);
    noise.stop(t + 0.1);
  });
}

export function sfxCleave() {
  play((c, t) => {
    // Wide slash
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

// Ambient forest sounds (subtle procedural wind + birds)
let ambientStarted = false;
let ambientGain: GainNode | null = null;

export function startAmbient() {
  if (ambientStarted || muted) return;
  const c = getCtx();
  if (!c) return;
  ambientStarted = true;

  // Wind noise (filtered white noise)
  const bufferSize = 2 * c.sampleRate; // 2 seconds
  const noiseBuffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 400;
  filter.Q.value = 0.5;

  // LFO for wind variation
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 0.15;
  lfoGain.gain.value = 100;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  ambientGain = c.createGain();
  ambientGain.gain.value = 0.03; // very subtle

  noise.connect(filter).connect(ambientGain).connect(c.destination);
  noise.start();

  // Occasional bird chirps
  setInterval(() => {
    if (muted || !ambientGain) return;
    if (Math.random() > 0.3) return;
    play((c, t) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      const baseFreq = 2000 + Math.random() * 2000;
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.linearRampToValueAtTime(baseFreq + 500 * (Math.random() - 0.3), t + 0.08);
      osc.frequency.linearRampToValueAtTime(baseFreq - 200, t + 0.12);
      gain.gain.setValueAtTime(0.015, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }, 3000 + Math.random() * 4000);
}

export function stopAmbient() {
  ambientStarted = false;
  if (ambientGain) {
    ambientGain.gain.value = 0;
    ambientGain = null;
  }
}

export function sfxChat() {
  play((c, t) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, t);
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  });
}
