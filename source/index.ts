import type {
  Fetcher,
  ScheduledEvent,
  ExecutionContext,
} from '@cloudflare/workers-types';
import puppeteer from '@cloudflare/puppeteer';

interface Env {
  BROWSER: Fetcher;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const browser = await puppeteer.launch(env.BROWSER as any);
    const page = await browser.newPage();
    await page.goto('https://www.andrewkingart.ca/s/shop');

    const results = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));

      return links.flatMap((link) => {
        if (!new URL(link.href).pathname.startsWith('/product/')) {
          return [];
        }

        return {href: link.href, text: link.textContent ?? ''};
      });
    });

    console.log(results);
  },
};
