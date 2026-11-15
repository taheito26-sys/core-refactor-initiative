import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Exercise the production portal styles in Chromium: DOM test runners do not lay out CSS zoom.
const styles = ['customer-home.css', 'customer-orders.css', 'customer-theme.css', 'customer-shipments.css']
  .map(file => readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8')).join('\n');

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } });

for (const width of [411, 1280]) {
  for (const zoom of [0.5, 0.8, 1, 1.25, 2]) {
    test(`short driver pages fill the screen at ${width}px and ${zoom * 100}% zoom`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(`<style>
        html { zoom: ${zoom}; --app-zoom: ${zoom}; }
        body { margin: 0; background: #020617; }
        ${styles}
      </style><div class="dr-shell"><div class="ch-root co-root cs-root dr-root" dir="rtl">
        <main class="dr-stack"><section class="ch-card cs-box">No shipments yet</section></main>
        <nav class="ch-nav dr-nav"><div class="ch-nav-in">Shipments · My month</div></nav>
      </div></div>`);
      const dimensions = await page.locator('.dr-shell').evaluate(el => {
        const root = document.querySelector('.dr-root')!;
        return { shellBottom: el.getBoundingClientRect().bottom, rootBottom: root.getBoundingClientRect().bottom,
          viewport: innerHeight, width: el.getBoundingClientRect().width, viewportWidth: innerWidth };
      });
      expect(dimensions.shellBottom).toBeGreaterThanOrEqual(dimensions.viewport - 1);
      expect(dimensions.rootBottom).toBeGreaterThanOrEqual(dimensions.viewport - 1);
      expect(dimensions.width).toBeGreaterThanOrEqual(dimensions.viewportWidth - 1);
    });
  }
}
