import { expect, test } from '@playwright/test';

/**
 * Mobile browsers keep an AudioContext suspended until the page has had a real
 * user gesture. Headless Chromium does not reproduce that policy reliably, so
 * this spec installs a deterministic stand-in: the context starts suspended and
 * `resume()` only succeeds after a pointer/touch/key event. That lets us assert
 * the actual fallback UI and the real alarm scheduler without relying on the
 * browser's autoplay heuristics.
 */
type AlarmProbe = {
  contexts: number;
  oscillators: number;
  resumes: number;
  blockedResumes: number;
  state: 'suspended' | 'running' | null;
  gesture: boolean;
};

const readProbe = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __alarmProbe: AlarmProbe }).__alarmProbe);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
});

test('mobile autoplay block shows the enable-sound fallback and a tap starts the alarm', async ({ page }) => {
  const now = new Date().toISOString();
  const alert = {
    id: '11111111-1111-1111-1111-111111111111',
    order_number: '22812345678901234',
    side: 'buy',
    asset: 'USDT',
    fiat: 'QAR',
    amount: 1000,
    price: 3.65,
    total: 3650,
    counterparty: 'Test Buyer',
    order_status: 'PENDING',
    first_seen_at: now,
    push_count: 0,
  };
  const watch = {
    user_id: '00000000-0000-0000-0000-000000000000',
    enabled: true,
    last_checked_at: now,
    last_ok_at: now,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  const credential = {
    id: 'c1',
    exchange: 'binance',
    label: 'Test Binance',
    api_key: 'test',
    last_synced_at: null,
    last_sync_error: null,
    created_at: now,
  };

  await page.addInitScript(() => {
    localStorage.setItem('p2p_dev_mode', 'true');
    localStorage.setItem('pwa-install-skipped', '1');
    localStorage.setItem('tracker_settings', JSON.stringify({ language: 'en' }));

    const probe = {
      contexts: 0,
      oscillators: 0,
      resumes: 0,
      blockedResumes: 0,
      state: null as 'suspended' | 'running' | null,
      gesture: false,
    };
    (window as unknown as { __alarmProbe: typeof probe }).__alarmProbe = probe;

    // Capture phase runs before the app's own primeP2PAlarmAudio listener, so
    // the policy stand-in sees the same gesture the browser would.
    for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
      window.addEventListener(event, () => { probe.gesture = true; }, true);
    }

    class AutoplayPolicyAudioContext {
      state: 'suspended' | 'running' = 'suspended';
      currentTime = 0;
      destination = { connect() {}, disconnect() {} };

      constructor() {
        probe.contexts += 1;
        probe.state = this.state;
      }

      createGain() {
        return {
          gain: {
            value: 1,
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect(node: unknown) { return node; },
          disconnect() {},
        };
      }

      createOscillator() {
        probe.oscillators += 1;
        return {
          type: 'sine',
          frequency: { setValueAtTime() {} },
          connect(node: unknown) { return node; },
          start() {},
          stop() {},
          disconnect() {},
        };
      }

      createBuffer() { return {}; }

      createBufferSource() {
        return {
          buffer: null,
          loop: false,
          connect(node: unknown) { return node; },
          start() {},
          stop() {},
          disconnect() {},
        };
      }

      resume() {
        probe.resumes += 1;
        if (!probe.gesture) {
          probe.blockedResumes += 1;
          // A blocked resume stays pending until a gesture in a real browser.
          return new Promise<void>(() => {});
        }
        this.state = 'running';
        probe.state = this.state;
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: AutoplayPolicyAudioContext,
    });
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      writable: true,
      value: AutoplayPolicyAudioContext,
    });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    if (table === 'exchange_credentials') {
      await route.fulfill({ json: [credential] });
      return;
    }
    if (table === 'p2p_order_watch') {
      await route.fulfill({ json: watch });
      return;
    }
    if (table === 'p2p_order_alerts') {
      // Let the page settle before the alert arrives, so the test starts from
      // the same no-gesture state as a merchant who opened the console and
      // then received a new order.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ json: [alert] });
      return;
    }
    // Dev mode has no real JWT, so unrelated queries fail like they do against
    // the live project. A generic `{}` would break array-shaped RPCs such as
    // custody_mirror_status and crash the shell before the alert can mount.
    await route.fulfill({ status: 401, json: { message: 'JWT expired' } });
  });

  await page.goto('/trading/orders');
  await expect(page).toHaveURL(/\/trading\/orders/);

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('Open P2P order on Binance')).toBeVisible();

  const enableButton = dialog.getByRole('button', { name: 'Tap to enable the alarm sound' });
  await expect(enableButton).toBeVisible();

  // The alert arrived before any gesture: one suspended context, no notes.
  const blocked = await readProbe(page);
  expect(blocked.contexts).toBe(1);
  expect(blocked.state).toBe('suspended');
  expect(blocked.gesture).toBe(false);
  expect(blocked.blockedResumes).toBeGreaterThanOrEqual(1);
  expect(blocked.oscillators).toBe(0);

  // Tapping the fallback is a real user gesture; the shared context resumes
  // and the real alarm scheduler starts the 3 + 4 + 4 note pattern.
  await enableButton.tap();
  await expect(enableButton).toBeHidden();
  await expect.poll(async () => (await readProbe(page)).state).toBe('running');
  await expect.poll(async () => (await readProbe(page)).oscillators).toBe(11);

  const unlocked = await readProbe(page);
  expect(unlocked.gesture).toBe(true);
  expect(unlocked.contexts).toBe(1);
  expect(unlocked.blockedResumes).toBeGreaterThanOrEqual(1);
});
