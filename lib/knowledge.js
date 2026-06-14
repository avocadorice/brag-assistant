import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Loaders ────────────────────────────────────────────────────────────────────

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch (_) { return null; }
}

async function loadDocx(file) {
  try {
    const result = await mammoth.extractRawText({ path: path.join(ROOT, file) });
    return result.value;
  } catch (_) { return ''; }
}

function loadCsv(file) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return parse(raw, { columns: true, skip_empty_lines: true });
  } catch (_) { return []; }
}

// ── Source parsers ─────────────────────────────────────────────────────────────

function parseHelloInterview(data) {
  if (!data?.sessions) return [];
  return data.sessions
    .filter(s => s.content?.length > 2)
    .map(s => {
      const text = s.content.map(c => c.text).join('\n');
      return {
        source: 'hellointerview',
        type: 'session',
        question: s.question,
        url: s.url,
        text,
        themes: extractThemes(s.question + ' ' + text),
      };
    });
}

function parseNotion(data) {
  if (!data?.sections) return [];
  const entries = [];
  for (const [label, section] of Object.entries(data.sections)) {
    for (const page of section.pages || []) {
      const text = flattenNotionContent(page.content || []);
      if (!text.trim()) continue;
      entries.push({
        source: 'notion',
        type: label.toLowerCase(),
        title: page.title,
        id: page.id,
        text,
        themes: extractThemes(page.title + ' ' + text),
      });
    }
  }
  return entries;
}

function flattenNotionContent(content) {
  return content.map(block => {
    if (block.type === 'child_page') {
      return `\n## ${block.title}\n${flattenNotionContent(block.content || [])}`;
    }
    return block.text || '';
  }).join('\n');
}

function parseStoryBank(data) {
  if (!data?.stories) return [];
  return data.stories.map(s => ({
    source: 'story-bank',
    type: 'story',
    title: s.title,
    text: s.text,
    addedAt: s.addedAt,
    themes: extractThemes(s.title + ' ' + s.text),
  }));
}

function parseSideProjects(data) {
  if (!data?.projects) return [];
  return data.projects.map(p => ({
    source: 'side-project',
    type: 'side-project',
    title: p.title,
    name: p.name,
    tech: p.tech,
    text: `${p.title}\n\n${p.description}\n\nTech: ${p.tech.join(', ')}\n\nWhy I built it: ${p.why}`,
    themes: [...(p.themes || []), ...extractThemes(p.description + ' ' + p.why)],
  }));
}

// ── Theme extraction ───────────────────────────────────────────────────────────

const THEME_KEYWORDS = {
  conflict:      ['conflict', 'disagree', 'disagreed', 'tension', 'pushback', 'friction', 'coworker', 'teammate'],
  ownership:     ['ownership', 'drove', 'led', 'responsible', 'accountable', 'owned', 'initiative'],
  ambiguity:     ['unclear', 'ambiguous', 'ambiguity', 'requirements', 'undefined', 'uncertain'],
  impact:        ['impact', 'improved', 'reduced', 'increased', 'saved', 'latency', 'cost', 'revenue'],
  leadership:    ['lead', 'led', 'mentored', 'guided', 'team', 'cross-functional', 'stakeholder'],
  failure:       ['mistake', 'failed', 'outage', 'incident', 'wrong', 'learned', 'retrospective'],
  collaboration: ['collaborated', 'partnership', 'cross-team', 'aligned', 'worked with'],
  growth:        ['grew', 'learned', 'improved', 'comfort zone', 'skill', 'feedback', 'learning', 'curious', 'explore'],
  pride:         ['proud', 'proudest', 'meaningful', 'impactful', 'accomplishment', 'achievement'],
  delivery:      ['delivered', 'shipped', 'launched', 'deadline', 'project', 'timeline'],
  creativity:    ['built', 'created', 'designed', 'personal', 'side project', 'hobby', 'weekend', 'fun', 'game', 'gift', 'creative'],
};

function extractThemes(text) {
  const lower = text.toLowerCase();
  return Object.entries(THEME_KEYWORDS)
    .filter(([, keywords]) => keywords.some(k => lower.includes(k)))
    .map(([theme]) => theme);
}

// ── Main loader ────────────────────────────────────────────────────────────────

export async function loadKnowledgeBase() {
  const [hiData, notionData, storyBankData, sideProjectsData, bragDoc, questionsDoc] = await Promise.all([
    Promise.resolve(loadJson('output.json')),
    Promise.resolve(loadJson('notion-output.json')),
    Promise.resolve(loadJson('story-bank.json')),
    Promise.resolve(loadJson('side-projects.json')),
    loadDocx('from-gdrive/Brag doc.docx'),
    loadDocx('from-gdrive/Questions I find myself asking.docx'),
  ]);

  const entries = [
    ...parseHelloInterview(hiData),
    ...parseNotion(notionData),
    ...parseStoryBank(storyBankData || { stories: [] }),
    ...parseSideProjects(sideProjectsData || { projects: [] }),
  ];

  // Add brag doc and questions doc as single entries
  if (bragDoc.trim()) {
    entries.push({
      source: 'gdrive',
      type: 'brag-doc',
      title: 'Brag Doc',
      text: bragDoc,
      themes: extractThemes(bragDoc),
    });
  }
  if (questionsDoc.trim()) {
    entries.push({
      source: 'gdrive',
      type: 'self-reflection',
      title: 'Questions I find myself asking',
      text: questionsDoc,
      themes: extractThemes(questionsDoc),
    });
  }

  return entries;
}

// ── Retrieval ──────────────────────────────────────────────────────────────────

export function retrieve(question, entries, topK = 6) {
  const qThemes = extractThemes(question);
  const qLower = question.toLowerCase();
  const qWords = qLower.split(/\W+/).filter(w => w.length > 3);

  const scored = entries.map(entry => {
    let score = 0;

    // Theme overlap
    const themeOverlap = entry.themes.filter(t => qThemes.includes(t)).length;
    score += themeOverlap * 3;

    // Keyword overlap
    const entryLower = (entry.title || '') + ' ' + entry.text;
    const wordMatches = qWords.filter(w => entryLower.toLowerCase().includes(w)).length;
    score += wordMatches;

    // Boost story-bank entries (most deliberate/recent)
    if (entry.source === 'story-bank') score += 2;
    // Boost hellointerview sessions (actual practice)
    if (entry.source === 'hellointerview') score += 1;
    // Boost side projects for passion/outside-work questions
    if (entry.source === 'side-project') score += 1;

    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry);
}
