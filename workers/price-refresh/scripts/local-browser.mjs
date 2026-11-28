import puppeteer from 'puppeteer-core';
import { publicUrl } from '../src/catalog.mjs';

export async function localBrowser(executablePath, { loadResources = false, waitForProduct = false } = {}) {
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
            return !loadResources && ['image', 'font', 'media'].includes(request.resourceType()) ? request.abort() : request.continue();
          } catch { return request.abort(); }
        });
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const waits = [page.waitForNetworkIdle({ idleTime: waitForProduct ? 1000 : 700, concurrency: waitForProduct ? 0 : 2, timeout: waitForProduct ? 20000 : 10000 }).catch(() => {})];
        if (waitForProduct) waits.push(page.waitForFunction(() =>
          [...document.querySelectorAll('script[type="application/ld+json"]')].some(script => /"@type"\s*:\s*"Product(?:Group)?"/.test(script.textContent) && /"(?:price|lowPrice)"\s*:\s*"?[1-9]/.test(script.textContent)) ||
          [...document.querySelectorAll('[itemprop="price"][content]')].some(node => Number(node.getAttribute('content')) > 0) ||
          /verify (?:that )?you are (?:a )?human|press (?:and|&) hold|system maintenance is in progress/i.test(document.body?.innerText?.slice(0,5000) ?? ''), { timeout: 20000 }).catch(() => {}));
        await (waitForProduct ? Promise.race(waits) : Promise.all(waits));
        return { html: await page.content(), url: page.url(), status: response?.status() ?? 0 };
      } finally { await context.close(); }
    },
    close: () => browser.close(),
  };
}
