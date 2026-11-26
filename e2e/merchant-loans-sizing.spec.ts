import { expect, test } from '@playwright/test';

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } });

for (const width of [393, 597, 853]) {
  for (const language of ['en', 'ar']) {
    test(`loans fill ${width}px in ${language} despite a saved 80% app zoom`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(lang => {
        localStorage.setItem('p2p_dev_mode', 'true');
        localStorage.setItem('app-zoom-level', '0.8');
        localStorage.setItem('tracker_settings', JSON.stringify({ language: lang }));
      }, language);
      await page.goto('/trading/orders?tab=usdt');
      const continueButton = page.getByText('Continue in browser', { exact: true });
      if (await continueButton.isVisible()) await continueButton.click();
      await expect(page.locator('.ld-desk')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1');
      for (const selector of ['.main-shell', '.loans-bottom-nav']) {
        const box = await page.locator(selector).boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.width - width)).toBeLessThanOrEqual(1);
      }
      expect(await page.locator('.lg-hero h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.locator('.loans-bottom-nav a').first().click();
      await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('0.8');
      expect(await page.evaluate(() => localStorage.getItem('app-zoom-level'))).toBe('0.8');
    });
  }
}
