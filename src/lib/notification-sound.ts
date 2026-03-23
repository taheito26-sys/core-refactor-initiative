/**
 * Notification sound + browser push notification utilities.
 * Uses Web Audio API for in-app chime (no external file needed).
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Play a short, pleasant two-tone chime */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // First tone — higher pitch
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now); // A5
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second tone — slightly lower, delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1174.66, now + 0.12); // D6
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.12, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.4);
  } catch {
    // Audio not available — fail silently
  }
}

/** Request browser notification permission */
export async function requestPushPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** Show a browser push notification */
export function showBrowserNotification(title: string, body?: string, onClick?: () => void) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Only show when tab is not focused
  if (document.hasFocus()) return;

  try {
    const n = new Notification(title, {
      body: body ?? undefined,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'deal-notification',
      renotify: true,
    });

    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }

    // Auto-close after 6s
    setTimeout(() => n.close(), 6000);
  } catch {
    // SW-only environments — fail silently
  }
}
