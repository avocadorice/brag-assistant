import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORY_BANK = path.join(__dirname, '..', 'story-bank.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STORY_BANK, 'utf8')); } catch (_) { return { stories: [] }; }
}

function save(data) {
  fs.writeFileSync(STORY_BANK, JSON.stringify(data, null, 2));
}

export async function addStory(rl) {
  const ask = (q) => new Promise(res => rl.question(q, res));

  console.log('\n── Add a Story ──────────────────────────────────────────');
  console.log('Dump it raw — you can refine it later.\n');

  const title = await ask('Title (short label for this story): ');
  console.log('Story (press Enter twice when done):');

  const lines = [];
  let emptyCount = 0;
  await new Promise(res => {
    const handler = (line) => {
      if (line === '') {
        emptyCount++;
        if (emptyCount >= 2) { rl.removeListener('line', handler); res(); }
      } else {
        emptyCount = 0;
        lines.push(line);
      }
    };
    rl.on('line', handler);
  });

  const text = lines.join('\n').trim();
  if (!text) { console.log('Nothing entered, cancelled.'); return; }

  const data = load();
  data.stories.push({ title, text, addedAt: new Date().toISOString() });
  save(data);

  console.log(`\n✅ Story "${title}" saved to story-bank.json`);
}

export function listStories() {
  const data = load();
  if (!data.stories.length) { console.log('No stories yet.'); return; }
  console.log('\n── Story Bank ───────────────────────────────────────────');
  data.stories.forEach((s, i) => {
    const date = new Date(s.addedAt).toLocaleDateString();
    console.log(`  ${i + 1}. [${date}] ${s.title}`);
    console.log(`     ${s.text.slice(0, 100)}...`);
  });
}
