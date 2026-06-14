import type { KnowledgeEntry } from './knowledge.js';

export const QUESTION_BANK: string[] = [
  // Ownership / impact
  "Tell me about the most technically complex problem you've solved.",
  "Describe a system you designed or owned end-to-end.",
  "Tell me about a project you're most proud of.",
  "Give me an example of when you improved a process or system significantly.",
  "Tell me about a time you drove an engineering initiative beyond your core responsibilities.",
  "What's the biggest technical risk you've taken? How did it turn out?",

  // Ambiguity / decision-making
  "Tell me about a time you had to make a decision with incomplete information.",
  "Describe a time when you had to work with ambiguous requirements.",
  "Tell me about a time you had to prioritize competing demands.",
  "Give me an example of a time you had to balance technical debt with feature delivery.",

  // Conflict / influence
  "Describe a situation where you had to push back on a stakeholder's request.",
  "Tell me about a conflict you had with a coworker or manager. How did you resolve it?",
  "Tell me about a time you had to influence without authority.",
  "Describe a situation where you had to coordinate across multiple teams.",
  "Tell me about a time you had to advocate for engineering quality or reliability.",

  // Failure / growth
  "Give me an example of a time you failed. What did you learn?",
  "Tell me about a time your project or approach didn't go as planned.",
  "Tell me about a time you had to learn something new quickly.",
  "Tell me about a time you received critical feedback. How did you respond?",

  // Leadership / collaboration
  "Tell me about a time you mentored or developed another engineer.",
  "Describe a situation where you had to unblock a team that was stuck.",
  "Tell me about a time you led a project with a tight deadline.",
  "Give me an example of a time you got a team aligned around a difficult technical decision.",
];

export function pickQuestion(kb: KnowledgeEntry[]): string {
  const hiQuestions = kb
    .filter(e => e.source === 'hellointerview' && e.question)
    .map(e => e.question as string);

  const pool = [...hiQuestions, ...QUESTION_BANK];
  return pool[Math.floor(Math.random() * pool.length)];
}
