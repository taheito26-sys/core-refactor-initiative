let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1174.66, now + 0.12);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.12, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.4);
  } catch {
    // noop
  }
}

export async function requestPushPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

interface BrowserNotificationOptions {
  body?: string;
  tag?: string;
  onClick?: () => void;
  suppress?: boolean;
}

export function showBrowserNotification(title: string, options: BrowserNotificationOptions = {}) {
  if (options.suppress) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;

  try {
    const notification = new Notification(title, {
      body: options.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: options.tag,
    });

    if (options.onClick) {
      notification.onclick = () => {
        window.focus();
        options.onClick?.();
        notification.close();
      };
    }
    setTimeout(() => notification.close(), 6000);
  } catch {
    // noop
  }
}
