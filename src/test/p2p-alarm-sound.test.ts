import { describe, expect, it, vi } from 'vitest';

class FakeGain {
  gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect() {
    return this;
  }
}

class FakeOscillator {
  type = '';
  frequency = { setValueAtTime: vi.fn() };
  connect() {
    return this;
  }
  start = vi.fn();
  stop = vi.fn();
}

class FakeBufferSource {
  buffer: unknown = null;
  loop = false;
  connect() {
    return this;
  }
  start = vi.fn();
  stop = vi.fn();
}

const oscillators: FakeOscillator[] = [];

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createGain() {
    return new FakeGain();
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    oscillators.push(oscillator);
    return oscillator;
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return new FakeBufferSource();
  }
}

describe('P2P alarm playback', () => {
  it('resumes a suspended context and schedules the full audible pattern', async () => {
    Object.defineProperty(window, 'AudioContext', {
      value: FakeAudioContext,
      configurable: true,
    });
    const { playP2PAlarm, unlockP2PAlarmAudio } = await import('@/features/exchanges/p2p-alarm-sound');

    expect(await unlockP2PAlarmAudio()).toBe(true);
    expect(await playP2PAlarm()).toBe(true);
    // 3 "ti" ticks + 4 beeps + 4 "la" notes.
    expect(oscillators).toHaveLength(11);
    expect(oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true);
  });
});
