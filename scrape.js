import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, '.session');
const OUT = path.join(__dirname, 'output.json');
const BASE = 'https://www.hellointerview.com';

async function scrollToBottom(page) {
  for (let i = 0; i < 15; i++) {
    const before = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.body.scrollHeight);
    if (after === before) break;
  }
}

async function reapplyMarkers(page, sessionRows) {
  await page.evaluate((rows) => {
    const heading = Array.from(document.querySelectorAll('h5')).find(h => h.innerText?.trim() === 'Past Sessions');
    if (!heading) return;
    let rowIdx = 0;
    let el = heading.nextElementSibling;
    while (el && rowIdx < rows.length) {
      const pTags = el.querySelectorAll('p');
      for (const p of pTags) {
        const text = p.innerText?.trim();
        if (text && text.length > 20 && (text.includes('?') || /tell me|describe|share|give|how did|can you/i.test(text))) {
          let clickable = p;
          while (clickable.parentElement && clickable.parentElement !== document.body) {
            if (window.getComputedStyle(clickable.parentElement).cursor === 'pointer') { clickable = clickable.parentElement; break; }
            clickable = clickable.parentElement;
          }
          clickable.setAttribute('data-scrape-id', rows[rowIdx].marker);
          rowIdx++;
        }
      }
      el = el.nextElementSibling;
    }
  }, sessionRows);
}

async function readPageText(page) {
  return page.evaluate(() => {
    const root = document.querySelector('main') || document.body;
    const seen = new Set();
    const out = [];
    for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code')) {
      const t = el.innerText?.trim();
      if (t && t.length > 3 && !seen.has(t)) {
        seen.add(t);
        out.push({ tag: el.tagName.toLowerCase(), text: t });
      }
    }
    return out;
  });
}

async function main() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    viewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();

  // ── 1. Login ────────────────────────────────────────────────────────────────
  console.log('Opening login page...');
  await page.goto(`${BASE}/login?callback_url=%2F`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  if (page.url().includes('/login')) {
    console.log('👉 Please sign in. Script continues automatically once logged in.\n');
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 180_000 });
  }
  console.log('✅ Logged in\n');

  // ── 2. Go to practice/behavioral and scroll to load all past sessions ────────
  console.log('Loading practice/behavioral page...');
  await page.goto(`${BASE}/practice/behavioral`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2000);
  await scrollToBottom(page);
  await page.waitForTimeout(1000);

  // ── 3 & 4. Paginate, click each session by position, capture content ──────────
  // Load existing data, deduplicate by URL, skip already-scraped sessions
  let existing = { sessions: [] };
  if (fs.existsSync(OUT)) {
    try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) {}
  }
  // Deduplicate existing sessions by URL
  const dedupedExisting = [...new Map(
    existing.sessions.filter(s => s.url).map(s => [s.url, s])
  ).values()];
  const seenUrls = new Set(dedupedExisting.map(s => s.url));
  console.log(`Already have ${seenUrls.size} sessions cached — will skip those.\n`);

  const result = { scrapedAt: new Date().toISOString(), sessions: [...dedupedExisting] };
  let pageNum = 1;

  // Returns question texts on current page (in order)
  const getSessionTexts = () => page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h5'))
      .find(h => h.innerText?.trim() === 'Past Sessions');
    if (!heading) return [];
    const rows = [];
    let el = heading.nextElementSibling;
    while (el) {
      for (const p of el.querySelectorAll('p')) {
        const text = p.innerText?.trim();
        if (!text || text.length < 20) continue;
        if (!text.includes('?') && !/tell me|describe|share|give|how did|can you/i.test(text)) continue;
        rows.push(text.slice(0, 300));
      }
      el = el.nextElementSibling;
    }
    return rows;
  });

  // Clicks the Nth session row (0-indexed) on the current page
  const clickSession = (n) => page.evaluate((n) => {
    const heading = Array.from(document.querySelectorAll('h5'))
      .find(h => h.innerText?.trim() === 'Past Sessions');
    if (!heading) return false;
    let count = 0;
    let el = heading.nextElementSibling;
    while (el) {
      for (const p of el.querySelectorAll('p')) {
        const text = p.innerText?.trim();
        if (!text || text.length < 20) continue;
        if (!text.includes('?') && !/tell me|describe|share|give|how did|can you/i.test(text)) continue;
        if (count === n) {
          let clickable = p;
          while (clickable.parentElement && clickable.parentElement !== document.body) {
            if (window.getComputedStyle(clickable.parentElement).cursor === 'pointer') {
              clickable = clickable.parentElement; break;
            }
            clickable = clickable.parentElement;
          }
          clickable.click();
          return true;
        }
        count++;
      }
      el = el.nextElementSibling;
    }
    return false;
  }, n);

  const goToPage = async (targetPage) => {
    await page.goto(`${BASE}/practice/behavioral`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1000);
    if (targetPage > 1) {
      await page.evaluate((n) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.innerText?.trim() === String(n) && !b.disabled);
        if (btn) btn.click();
      }, targetPage);
      await page.waitForTimeout(1500);
    }
  };

  while (true) {
    console.log(`\n── Page ${pageNum} ──`);
    const texts = await getSessionTexts();
    console.log(`  Found ${texts.length} sessions`);

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      process.stdout.write(`  [${i + 1}/${texts.length}] ${text.slice(0, 65)} ... `);
      try {
        await clickSession(i);
        await page.waitForTimeout(2000);

        const url = page.url();
        if (seenUrls.has(url)) {
          console.log('(already cached, skipping)');
        } else {
          const content = await readPageText(page);
          console.log(`✓ (${content.length} nodes)`);
          seenUrls.add(url);
          result.sessions.push({ question: text, url, content });
        }
        // Always navigate back to exact page — goBack() loses SPA pagination state
        await goToPage(pageNum);
      } catch (err) {
        console.log(`✗ ${err.message.slice(0, 70)}`);
        result.sessions.push({ question: text, url: null, content: [], error: err.message });
        await goToPage(pageNum);
      }

      if (result.sessions.length % 5 === 0) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    }

    // Get total pages from the pagination control, then stop when done
    const maxPage = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const nums = btns.map(b => parseInt(b.innerText?.trim())).filter(n => !isNaN(n) && n > 0);
      return nums.length > 0 ? Math.max(...nums) : 1;
    });
    if (pageNum >= maxPage) break;

    // Click the next page number button
    await page.evaluate((nextPageNum) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText?.trim() === String(nextPageNum) && !b.disabled);
      if (btn) btn.click();
    }, pageNum + 1);
    await page.waitForTimeout(1500);
    pageNum++;
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

  await browser.close();
  console.log(`\n✅ Done — ${result.sessions.length} sessions saved to output.json`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
