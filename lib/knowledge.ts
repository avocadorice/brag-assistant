import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import { parse } from 'csv-parse/sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KnowledgeEntry {
  source: 'hellointerview' | 'notion' | 'story-bank' | 'side-project' | 'gdrive';
  type: string;
  text: string;
  themes: string[];
  title?: string;
  question?: string;
  url?: string;
  id?: string;
  name?: string;
  tech?: string[];
  addedAt?: string;
}

// ── Loaders ────────────────────────────────────────────────────────────────────

function loadJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as T; }
  catch { return null; }
}

async function loadDocx(file: string): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: path.join(ROOT, file) });
    return result.value;
  } catch { return ''; }
}

function loadCsv(file: string): Record<string, string>[] {
  try {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return parse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  } catch { return []; }
}

// ── Source parsers ─────────────────────────────────────────────────────────────

interface HiSession {
  question: string;
  url: string;
  content: Array<{ text: string }>;
}

function parseHelloInterview(data: { sessions?: HiSession[] } | null): KnowledgeEntry[] {
  if (!data?.sessions) return [];
  return data.sessions
    .filter(s => s.content?.length > 2)
    .map(s => {
      const text = s.content.map(c => c.text).join('\n');
      return {
        source: 'hellointerview' as const,
        type: 'session',
        question: s.question,
        url: s.url,
        text,
        themes: extractThemes(s.question + ' ' + text),
      };
    });
}

interface NotionPage {
  id: string;
  title: string;
  content: NotionBlock[];
}

interface NotionBlock {
  type: string;
  text?: string;
  title?: string;
  content?: NotionBlock[];
}

function parseNotion(data: { sections?: Record<string, { pages?: NotionPage[] }> } | null): KnowledgeEntry[] {
  if (!data?.sections) return [];
  const entries: KnowledgeEntry[] = [];
  for (const [label, section] of Object.entries(data.sections)) {
    for (const page of section.pages ?? []) {
      const text = flattenNotionContent(page.content ?? []);
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

function flattenNotionContent(content: NotionBlock[]): string {
  return content.map(block => {
    if (block.type === 'child_page') {
      return `\n## ${block.title}\n${flattenNotionContent(block.content ?? [])}`;
    }
    return block.text ?? '';
  }).join('\n');
}

interface Story {
  title: string;
  text: string;
  addedAt: string;
}

function parseStoryBank(data: { stories?: Story[] } | null): KnowledgeEntry[] {
  if (!data?.stories) return [];
  return data.stories.map(s => ({
    source: 'story-bank' as const,
    type: 'story',
    title: s.title,
    text: s.text,
    addedAt: s.addedAt,
    themes: extractThemes(s.title + ' ' + s.text),
  }));
}

interface SideProject {
  name: string;
  title: string;
  description: string;
  tech: string[];
  why: string;
  themes: string[];
}

function parseSideProjects(data: { projects?: SideProject[] } | null): KnowledgeEntry[] {
  if (!data?.projects) return [];
  return data.projects.map(p => ({
    source: 'side-project' as const,
    type: 'side-project',
    title: p.title,
    name: p.name,
    tech: p.tech,
    text: `${p.title}\n\n${p.description}\n\nTech: ${p.tech.join(', ')}\n\nWhy I built it: ${p.why}`,
    themes: [...(p.themes ?? []), ...extractThemes(p.description + ' ' + p.why)],
  }));
}

// ── Theme extraction ───────────────────────────────────────────────────────────

const THEME_KEYWORDS: Record<string, string[]> = {
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

export function extractThemes(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(THEME_KEYWORDS)
    .filter(([, keywords]) => keywords.some(k => lower.includes(k)))
    .map(([theme]) => theme);
}

// ── Main loader ────────────────────────────────────────────────────────────────

export async function loadKnowledgeBase(): Promise<KnowledgeEntry[]> {
  const [hiData, notionData, storyBankData, sideProjectsData, bragDoc, questionsDoc] = await Promise.all([
    Promise.resolve(loadJson<{ sessions: HiSession[] }>('output.json')),
    Promise.resolve(loadJson<{ sections: Record<string, { pages: NotionPage[] }> }>('notion-output.json')),
    Promise.resolve(loadJson<{ stories: Story[] }>('story-bank.json')),
    Promise.resolve(loadJson<{ projects: SideProject[] }>('side-projects.json')),
    loadDocx('from-gdrive/Brag doc.docx'),
    loadDocx('from-gdrive/Questions I find myself asking.docx'),
  ]);

  const entries: KnowledgeEntry[] = [
    ...parseHelloInterview(hiData),
    ...parseNotion(notionData),
    ...parseStoryBank(storyBankData),
    ...parseSideProjects(sideProjectsData),
  ];

  if (bragDoc.trim()) {
    entries.push({ source: 'gdrive', type: 'brag-doc', title: 'Brag Doc', text: bragDoc, themes: extractThemes(bragDoc) });
  }
  if (questionsDoc.trim()) {
    entries.push({ source: 'gdrive', type: 'self-reflection', title: 'Questions I find myself asking', text: questionsDoc, themes: extractThemes(questionsDoc) });
  }

  return entries;
}

// ── Retrieval ──────────────────────────────────────────────────────────────────

export function retrieve(question: string, entries: KnowledgeEntry[], topK = 6): KnowledgeEntry[] {
  const qThemes = extractThemes(question);
  const qWords = question.toLowerCase().split(/\W+/).filter(w => w.length > 3);

  const scored = entries.map(entry => {
    let score = 0;
    score += entry.themes.filter(t => qThemes.includes(t)).length * 3;
    const entryText = ((entry.title ?? '') + ' ' + entry.text).toLowerCase();
    score += qWords.filter(w => entryText.includes(w)).length;
    if (entry.source === 'story-bank') score += 2;
    if (entry.source === 'hellointerview') score += 1;
    if (entry.source === 'side-project') score += 1;
    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry);
}
