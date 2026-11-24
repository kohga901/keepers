import puppeteer from 'puppeteer-core';
import { publicUrl } from '../src/catalog.mjs';

export async function localBrowser(executablePath) {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  return {
    async render(url) {
      publicUrl(url);
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        await page.setRequestInterception(true);
        page.on('request', request => {
          try {
            const target = new URL(request.url());
            if (['data:', 'blob:', 'about:'].includes(target.protocol)) return request.continue();
            publicUrl(target.href);
            return ['image', 'font', 'media'].includes(request.resourceType()) ? request.abort() : request.continue();
          } catch { return request.abort(); }
        });
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForNetworkIdle({ idleTime: 700, concurrency: 2, timeout: 10_000 }).catch(() => {});
        return { html: await page.content(), url: page.url(), status: response?.status() ?? 0 };
      } finally { await context.close(); }
    },
    close: () => browser.close(),
  };
}
