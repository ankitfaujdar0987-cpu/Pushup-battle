// Sound effects made with the browser's Web Audio (no sound files needed).

let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem("pb-muted") === "1";
} catch (e) {}

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// One short note.
function tone(freq, start, length, type = "sine", volume = 0.2) {
  const c = getCtx();
  if (!c || muted) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.05);
}

export const sounds = {
  countdown() { tone(660, 0, 0.18, "square", 0.12); },
  go() { tone(990, 0, 0.5, "square", 0.15); },
  tick() { tone(1200, 0, 0.05, "square", 0.08); },
  rep() { tone(880, 0, 0.08, "triangle", 0.18); },
  opponentRep() { tone(330, 0, 0.08, "triangle", 0.08); },
  alert() {
    tone(300, 0, 0.15, "sawtooth", 0.1);
    tone(220, 0.16, 0.2, "sawtooth", 0.1);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.25, "triangle", 0.2));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, i * 0.2, 0.3, "sine", 0.2));
  },
  draw() {
    tone(440, 0, 0.2, "sine", 0.18);
    tone(440, 0.25, 0.2, "sine", 0.18);
  },
  connect() {
    tone(523, 0, 0.12, "sine", 0.15);
    tone(784, 0.13, 0.18, "sine", 0.15);
  },
  disconnect() {
    tone(784, 0, 0.12, "sine", 0.15);
    tone(523, 0.13, 0.18, "sine", 0.15);
  },
};

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem("pb-muted", value ? "1" : "0");
  } catch (e) {}
}