/**
 * The merchant's own alarm sound for the P2P order alert, kept on this device
 * only (IndexedDB). Storage can be unavailable (private mode, cleared site
 * data), so every call fails soft and the built-in alarm is used instead.
 *
 * Playback lives here too: browsers block audio until the page has had a user
 * gesture, so the first tap/keypress anywhere unlocks one shared AudioContext.
 * The alarm then uses that context for both the built-in pattern and the
 * merchant's uploaded sound, which avoids the HTMLAudioElement autoplay block.
 */
import { useEffect, useState } from 'react';

const DB_NAME = 'p2p-alarm-sound';
const STORE = 'sound';
const KEY = 'current';
export const MAX_ALARM_SOUND_BYTES = 5 * 1024 * 1024;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface AlarmSound { name: string; blob: Blob }

export const loadAlarmSound = () => run<AlarmSound>('readonly', (s) => s.get(KEY));
export const saveAlarmSound = (sound: AlarmSound) => run('readwrite', (s) => s.put(sound, KEY));
export const clearAlarmSound = () => run('readwrite', (s) => s.delete(KEY));

// ── Playback ────────────────────────────────────────────────────────────────
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let customSource: AudioBufferSourceNode | null = null;
let customBuffer: AudioBuffer | null = null;
let customKey = '';
let loadingCustom = false;

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = window.AudioContext || (window as AudioWindow).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    master = audioCtx.createGain();
    master.gain.value = 0.9;
    master.connect(audioCtx.destination);
    return audioCtx;
  } catch {
    return null;
  }
}

/** Resumes a suspended context and waits for it to actually run. */
async function runningContext(): Promise<AudioContext | null> {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    try {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 800)),
      ]);
    } catch {
      // Autoplay policy: the next user gesture gets another try.
    }
  }
  return ctx.state === 'running' ? ctx : null;
}

/**
 * Must be called from a real user gesture (tap, click, key press) on browsers
 * that enforce autoplay rules. Starts a one-sample silent buffer, which is
 * what iOS needs before later Web Audio playback is allowed.
 */
export async function unlockP2PAlarmAudio(): Promise<boolean> {
  const ctx = await runningContext();
  if (!ctx) return false;
  try {
    const silent = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = silent;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // A running context is still usable even if the silent unlock fails.
  }
  return true;
}

/**
 * Installs one-time gesture listeners so the first interaction on any merchant
 * page unlocks the alarm for later automatic alerts. Returns a cleanup function.
 */
export function primeP2PAlarmAudio(): () => void {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
    window.removeEventListener('touchstart', onGesture);
  };
  function onGesture() {
    void unlockP2PAlarmAudio().then((ok) => {
      if (ok) cleanup();
    });
  }
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
  window.addEventListener('touchstart', onGesture, { passive: true });
  return cleanup;
}

interface AlarmNote {
  at: number;
  freq: number;
  duration: number;
  gain: number;
  type: OscillatorType;
}

/** "ti ti ti, beep beep beep beep, la la la la" — deliberately hard to miss. */
const ALARM_NOTES: AlarmNote[] = [
  ...Array.from({ length: 3 }, (_, i) => ({
    at: i * 0.14, freq: 1568, duration: 0.07, gain: 0.3, type: 'square' as const,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    at: 0.55 + i * 0.26, freq: 880, duration: 0.17, gain: 0.38, type: 'square' as const,
  })),
  ...[659.25, 783.99, 987.77, 1318.51].map((freq, i) => ({
    at: 1.75 + i * 0.27, freq, duration: 0.22, gain: 0.34, type: 'triangle' as const,
  })),
];

function playBuiltInPattern(ctx: AudioContext) {
  if (!master) return;
  const start = ctx.currentTime + 0.02;
  for (const note of ALARM_NOTES) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.freq, start + note.at);
    gain.gain.setValueAtTime(0.0001, start + note.at);
    gain.gain.exponentialRampToValueAtTime(note.gain, start + note.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.duration);
    osc.connect(gain).connect(master);
    osc.start(start + note.at);
    osc.stop(start + note.at + note.duration + 0.02);
  }
}

/** Decodes the merchant's uploaded file once per stored version. */
async function customAlarmBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (loadingCustom) return customBuffer;
  const sound = await loadAlarmSound();
  if (!sound?.blob) {
    customBuffer = null;
    customKey = '';
    return null;
  }
  const key = `${sound.name}:${sound.blob.size}:${sound.blob.type}`;
  if (customBuffer && customKey === key) return customBuffer;
  loadingCustom = true;
  try {
    const decoded = await ctx.decodeAudioData(await sound.blob.arrayBuffer());
    customBuffer = decoded;
    customKey = key;
    return decoded;
  } catch {
    customBuffer = null;
    customKey = '';
    return null;
  } finally {
    loadingCustom = false;
  }
}

function startCustomAlarm(ctx: AudioContext, buffer: AudioBuffer) {
  if (!master) return false;
  if (customSource) return true;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(master);
  source.start(0);
  customSource = source;
  return true;
}

/** Plays the merchant's sound, or the built-in pattern when none is saved. */
export async function playP2PAlarm(): Promise<boolean> {
  const ctx = await runningContext();
  if (!ctx) return false;
  if (customSource) return true;
  const buffer = await customAlarmBuffer(ctx);
  if (buffer && startCustomAlarm(ctx, buffer)) return true;
  playBuiltInPattern(ctx);
  return true;
}

/** Stops a looping custom sound; the built-in pattern stops on its own. */
export function stopP2PAlarm() {
  if (!customSource) return;
  try {
    customSource.stop();
  } catch {
    // Already stopped.
  }
  customSource.disconnect();
  customSource = null;
}

/**
 * Rings while `active` is true: the chosen sound loops, or the built-in pattern
 * repeats every 3.5 seconds. `blocked` is true when the browser has not allowed
 * audio yet; the alert shows an "enable sound" button in that case.
 */
export function useAlarm(active: boolean) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!active) {
      stopP2PAlarm();
      setBlocked(false);
      return;
    }
    let cancelled = false;
    const ring = () => {
      void playP2PAlarm().then((ok) => {
        if (!cancelled) setBlocked(!ok);
      });
      if ('vibrate' in navigator) navigator.vibrate([500, 200, 500, 200, 700]);
    };
    void ring();
    const timer = window.setInterval(ring, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stopP2PAlarm();
      if ('vibrate' in navigator) navigator.vibrate(0);
    };
  }, [active]);

  const enable = async () => {
    const ok = await unlockP2PAlarmAudio();
    if (!ok) {
      setBlocked(true);
      return;
    }
    const played = await playP2PAlarm();
    setBlocked(!played);
  };

  return { blocked, enable };
}
