import type {
  Fetcher,
  ScheduledEvent,
  ExecutionContext,
  KVNamespace,
} from '@cloudflare/workers-types';
import puppeteer from '@cloudflare/puppeteer';

interface Env {
  BROWSER: Fetcher;
  VONAGE_API_SECRET: string;
  ANDREW_KING_PAINTINGS: KVNamespace;
}

interface Stored {
  url: string;
  title: string;
  handle: string;
  cost: number;
  image?: string;
  outOfStock: boolean;
  foundAt: number;
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

    // Page is client-side rendered, wait until there is some content in the #app element
    await page.waitForSelector('#app > *');

    const results = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));

      return links.flatMap((link) => {
        const url = new URL(link.href);

        // Product links look like this:
        // https://www.andrewkingart.ca/product/-sullivan-school-/335?cp=true&sa=true&sbp=false&q=false
        const handle = /\/product\/([^/]+)\//.exec(url.pathname)?.at(1);

        if (handle == null) {
          return [];
        }

        const textContent = (link.textContent ?? '').trim();

        if (textContent.length === 0) {
          return [];
        }

        // Text content of these links looks something like:
        // "Sullivan School"\n\t  \n\t$50.00\n\t  \n\tOut of Stock
        const normalizedContent = textContent.replace(/\n\s*/gm, '|');
        const [title, cost, outOfStock] = normalizedContent.split('|');
        const costMatch = cost?.match(/(\d+(?:\.\d{2})?)/)?.at(0);

        if (!title || !costMatch) {
          return [];
        }

        // Find the nearest ancestor that contains an image, and then grab the image’s src
        const image = link.closest(':has(img)')?.querySelector('img');
        // These images have a `srcset` ordered from smallest to largest
        const imageSrc =
          image
            ?.getAttribute('srcset')
            ?.split(/\s*,\s*/)
            .at(-1)
            ?.split(/\s+/)
            .at(0) ?? image?.src;

        return {
          url: link.href,
          // Titles usually have quotes around them
          title: title.replace(/^"/, '').replace(/"$/, ''),
          // Handles have `-` characters around them, presumably derived from the quotes in the title
          handle: handle.replace(/^[^\w]/, '').replace(/[^\w]$/, ''),
          cost: Number.parseFloat(costMatch),
          image: imageSrc,
          outOfStock: Boolean(outOfStock?.trim()),
          foundAt: Date.now(),
        } as Stored;
      });
    });

    const storeResults = await Promise.all(
      results.map(async (result) => {
        const stored = await env.ANDREW_KING_PAINTINGS.get(result.handle, {
          type: 'json',
        });

        if (stored == null) {
          return result;
        }

        return null;
      }),
    );

    const newResults = storeResults.filter(
      (result): result is Stored => result != null,
    );

    console.log('New paintings found!');
    console.log(newResults);

    const firstNewResult = newResults.at(0);
    if (firstNewResult == null) return;

    // @see https://developer.vonage.com/en/messaging/sms/code-snippets/send-an-sms
    const response = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      body: JSON.stringify({
        to: '16132917722',
        from: '16477223284',
        text: firstNewResult.url,
        api_key: 'b545dc4b',
        api_secret: env.VONAGE_API_SECRET,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to send SMS: ${await response.text()}`);
    }

    console.log('SMS sent!');
    console.log(await response.json());

    await env.ANDREW_KING_PAINTINGS.put(
      firstNewResult.handle,
      JSON.stringify(firstNewResult),
    );
  },
};
