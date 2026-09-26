let context;
let lastPlayed = 0;
export async function enableDriverSound() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return false;
  context ||= new Audio();
  if (context.state !== 'running') await context.resume();
  return context.state === 'running';
}
export async function playDriverAlert(force = false) {
  if (!context || (!force && Date.now() - lastPlayed < 4000)) return;
  if (!(await enableDriverSound())) return;
  lastPlayed = Date.now();
  // Three clearly separated chimes, without clipping or an endless alarm.
  for (let i = 0; i < 3; i++) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + i * 0.6;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(i % 2 ? 1100 : 880, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.65, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start); oscillator.stop(start + 0.5);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
