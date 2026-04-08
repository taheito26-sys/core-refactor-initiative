/**
 * notification-sounds.ts
 *
 * Category-specific notification chimes using Web Audio API.
 * Includes Do Not Disturb (DND) scheduler.
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ─── DND Scheduler ──────────────────────────────────────────────────────────

const DND_KEY = '__notif_dnd__';

export interface DndSchedule {
  enabled: boolean;
  /** HH:mm 24h format */
  startTime: string;
  endTime: string;
}

export function getDndSchedule(): DndSchedule {
  try {
    const raw = localStorage.getItem(DND_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { enabled: false, startTime: '22:00', endTime: '07:00' };
}

export function setDndSchedule(schedule: DndSchedule) {
  localStorage.setItem(DND_KEY, JSON.stringify(schedule));
}

function isDndActive(): boolean {
  const s = getDndSchedule();
  if (!s.enabled) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = s.startTime.split(':').map(Number);
  const [eh, em] = s.endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Handles overnight ranges (e.g. 22:00 → 07:00)
  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

// ─── Category chime profiles ────────────────────────────────────────────────

type ChimeCategory = 'deal' | 'message' | 'order' | 'invite' | 'approval' | 'settlement' | 'agreement' | 'system';

interface ChimeProfile {
  freq1: number;
  freq2: number;
  delay: number;
  duration: number;
  volume: number;
}

const CHIME_PROFILES: Record<ChimeCategory, ChimeProfile> = {
  deal:       { freq1: 523.25, freq2: 659.25, delay: 0.1,  duration: 0.3, volume: 0.14 },
  message:    { freq1: 880,    freq2: 1174.66, delay: 0.12, duration: 0.25, volume: 0.12 },
  order:      { freq1: 440,    freq2: 554.37,  delay: 0.08, duration: 0.28, volume: 0.13 },
  invite:     { freq1: 659.25, freq2: 783.99,  delay: 0.1,  duration: 0.35, volume: 0.13 },
  approval:   { freq1: 392,    freq2: 523.25,  delay: 0.15, duration: 0.4,  volume: 0.15 },
  settlement: { freq1: 349.23, freq2: 440,     delay: 0.12, duration: 0.32, volume: 0.12 },
  agreement:  { freq1: 587.33, freq2: 739.99,  delay: 0.1,  duration: 0.3,  volume: 0.13 },
  system:     { freq1: 880,    freq2: 1174.66, delay: 0.12, duration: 0.25, volume: 0.10 },
};

function mapCategoryToChime(category: string): ChimeCategory {
  const cat = category.toLowerCase();
  if (cat === 'deal' || cat === 'merchant') return 'deal';
  if (cat === 'message') return 'message';
  if (cat === 'order') return 'order';
  if (cat === 'invite' || cat === 'network') return 'invite';
  if (cat === 'approval') return 'approval';
  if (cat === 'settlement') return 'settlement';
  if (cat === 'agreement') return 'agreement';
  return 'system';
}

/**
 * Play a category-specific notification chime.
 * Respects DND schedule — returns silently if active.
 */
export function playCategoryChime(category: string): void {
  if (isDndActive()) return;
  try {
    const c = ctx();
    const profile = CHIME_PROFILES[mapCategoryToChime(category)];
    const now = c.currentTime;

    const osc1 = c.createOscillator();
    const gain1 = c.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(profile.freq1, now);
    gain1.gain.setValueAtTime(profile.volume, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + profile.duration);
    osc1.connect(gain1).connect(c.destination);
    osc1.start(now);
    osc1.stop(now + profile.duration);

    const osc2 = c.createOscillator();
    const gain2 = c.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(profile.freq2, now + profile.delay);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(profile.volume * 0.8, now + profile.delay);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + profile.delay + profile.duration);
    osc2.connect(gain2).connect(c.destination);
    osc2.start(now + profile.delay);
    osc2.stop(now + profile.delay + profile.duration);
  } catch {
    // noop — user hasn't interacted with page yet
  }
}

/**
 * Trigger haptic feedback if available (Capacitor / Navigator API).
 */
export async function triggerHaptic(): Promise<void> {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([50, 30, 50]);
    }
  } catch {
    // noop
  }
}
