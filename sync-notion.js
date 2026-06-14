import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'notion-output.json');
const TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';

// Root pages/databases to sync
const ROOTS = [
  { id: 'ea465d04-bd17-488d-aa67-329c3fdd186d', label: 'Behavioral' },
  { id: '778eff96-bace-4d5d-bd5f-6b2e775659dc', label: 'System Design' },
  { id: 'bd25da83-73ae-4e7d-9e2e-92459f351724', label: 'DSA' },
];

// ── API helpers ────────────────────────────────────────────────────────────────

async function notionGet(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': NOTION_VERSION },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

// Fetch all pages in a database (handles pagination)
async function queryDatabase(dbId) {
  const pages = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionPost(`/databases/${dbId}/query`, body);
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

// Fetch all blocks for a page/block (handles pagination)
async function getBlocks(blockId) {
  const blocks = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notionGet(`/blocks/${blockId}/children?${params}`);
    blocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

// Extract plain text from a rich_text array
function richText(arr = []) {
  return arr.map(t => t.plain_text).join('');
}

// Convert a block to readable text
function blockToText(block) {
  const t = block.type;
  const b = block[t];
  if (!b) return null;
  switch (t) {
    case 'paragraph':          return richText(b.rich_text);
    case 'heading_1':          return `# ${richText(b.rich_text)}`;
    case 'heading_2':          return `## ${richText(b.rich_text)}`;
    case 'heading_3':          return `### ${richText(b.rich_text)}`;
    case 'bulleted_list_item': return `• ${richText(b.rich_text)}`;
    case 'numbered_list_item': return richText(b.rich_text);
    case 'code':               return richText(b.rich_text);
    case 'quote':              return richText(b.rich_text);
    case 'callout':            return richText(b.rich_text);
    case 'toggle':             return richText(b.rich_text);
    case 'to_do':              return `[${b.checked ? 'x' : ' '}] ${richText(b.rich_text)}`;
    default:                   return null;
  }
}

// Recursively fetch a page and all its child blocks/pages
async function fetchPageContent(pageId) {
  const blocks = await getBlocks(pageId);
  const content = [];

  for (const block of blocks) {
    const text = blockToText(block);
    if (text && text.trim()) content.push({ type: block.type, text: text.trim() });

    // Recurse into child pages and child databases
    if (block.type === 'child_page') {
      const childTitle = block.child_page?.title || '(untitled)';
      const childContent = await fetchPageContent(block.id);
      content.push({ type: 'child_page', title: childTitle, id: block.id, content: childContent });
    } else if (block.has_children && block.type !== 'child_database') {
      // Recurse into toggles, callouts, etc. that have children
      const childBlocks = await fetchPageContent(block.id);
      content.push(...childBlocks);
    }
  }

  return content;
}

// Get page title from properties
function getPageTitle(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === 'title') {
      return richText(prop.title);
    }
  }
  return '(untitled)';
}

// ── Incremental sync ───────────────────────────────────────────────────────────

async function main() {
  if (!TOKEN) { console.error('NOTION_TOKEN not set in .env'); process.exit(1); }

  // Load existing data indexed by page ID for incremental sync
  let existing = {};
  if (fs.existsSync(OUT)) {
    try {
      const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      for (const section of Object.values(data.sections || {})) {
        for (const page of section.pages || []) {
          if (page.id) existing[page.id] = page;
        }
      }
    } catch (_) {}
  }
  console.log(`Loaded ${Object.keys(existing).length} cached pages\n`);

  const result = { syncedAt: new Date().toISOString(), sections: {} };
  let newCount = 0, skipCount = 0;

  for (const root of ROOTS) {
    console.log(`\n── ${root.label} ──`);
    const section = { id: root.id, label: root.label, pages: [] };
    result.sections[root.label] = section;

    // Check if this is a database or a page
    let isDatabase = false;
    try {
      await notionGet(`/databases/${root.id}`);
      isDatabase = true;
    } catch (_) {}

    let pagesToSync = [];

    if (isDatabase) {
      // Query all rows in the database
      const dbPages = await queryDatabase(root.id);
      console.log(`  ${dbPages.length} entries in database`);
      pagesToSync = dbPages.map(p => ({
        id: p.id,
        title: getPageTitle(p),
        lastEdited: p.last_edited_time,
      }));
    } else {
      // It's a page — fetch its direct child pages
      const blocks = await getBlocks(root.id);
      const rootPage = await notionGet(`/pages/${root.id}`);
      pagesToSync = [{ id: root.id, title: getPageTitle(rootPage), lastEdited: rootPage.last_edited_time }];

      // Also include child pages found in blocks
      for (const block of blocks) {
        if (block.type === 'child_page') {
          pagesToSync.push({
            id: block.id,
            title: block.child_page?.title || '(untitled)',
            lastEdited: block.last_edited_time,
          });
        }
      }
      console.log(`  ${pagesToSync.length} pages (root + children)`);
    }

    for (const { id, title, lastEdited } of pagesToSync) {
      const cached = existing[id];

      // Skip if already cached and not modified since last sync
      if (cached && cached.lastEdited === lastEdited) {
        process.stdout.write(`  [skip] ${title.slice(0, 60)}\n`);
        section.pages.push(cached);
        skipCount++;
        continue;
      }

      process.stdout.write(`  [sync] ${title.slice(0, 60)} ... `);
      try {
        const content = await fetchPageContent(id);
        const page = { id, title, lastEdited, content };
        section.pages.push(page);
        newCount++;
        console.log(`✓ (${content.length} blocks)`);
      } catch (err) {
        console.log(`✗ ${err.message}`);
        if (cached) section.pages.push(cached); // keep old version on error
      }
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\n✅ Done — ${newCount} synced, ${skipCount} unchanged — saved to notion-output.json`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
