import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Interface as ReadlineInterface } from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORY_BANK = path.join(__dirname, '..', 'story-bank.json');

interface Story {
  title: string;
  text: string;
  addedAt: string;
}

interface StoryBank {
  stories: Story[];
}

function load(): StoryBank {
  try { return JSON.parse(fs.readFileSync(STORY_BANK, 'utf8')) as StoryBank; }
  catch { return { stories: [] }; }
}

function save(data: StoryBank): void {
  fs.writeFileSync(STORY_BANK, JSON.stringify(data, null, 2));
}

export async function addStory(rl: ReadlineInterface): Promise<void> {
  const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

  console.log('\nAdd a story to your bank. Double Enter when done.\n');
  const title = await ask('Title: ');
  if (!title.trim()) return;

  console.log('Text (double Enter to finish):');
  const lines: string[] = [];
  let blankCount = 0;

  await new Promise<void>(resolve => {
    rl.on('line', function handler(line) {
      if (line === '') {
        blankCount++;
        if (blankCount >= 2) { rl.removeListener('line', handler); resolve(); return; }
      } else {
        blankCount = 0;
      }
      lines.push(line);
    });
  });

  const text = lines.join('\n').trim();
  if (!text) return;

  const bank = load();
  bank.stories.push({ title, text, addedAt: new Date().toISOString() });
  save(bank);
  console.log(`\nSaved: "${title}"\n`);
}

export function listStories(): void {
  const { stories } = load();
  if (!stories.length) { console.log('\nNo stories yet.\n'); return; }
  console.log(`\n${stories.length} stories:\n`);
  stories.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.title}`);
    console.log(`     ${s.text.slice(0, 80)}...\n`);
  });
  console.log('  Enter a number to read the full story, or press Enter to go back.');
}

export function getStory(index: number): Story | undefined {
  const { stories } = load();
  return stories[index];
}

export function updateStory(index: number, updates: { title?: string; text?: string }): boolean {
  const bank = load();
  const story = bank.stories[index];
  if (!story) return false;
  if (updates.title) story.title = updates.title;
  if (updates.text)  story.text  = updates.text;
  save(bank);
  return true;
}

export function searchStories(query: string): Array<Story & { index: number }> {
  const { stories } = load();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return stories
    .map((s, index) => {
      const haystack = (s.title + ' ' + s.text).toLowerCase();
      const score = terms.filter(t => haystack.includes(t)).length;
      return { ...s, index, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
