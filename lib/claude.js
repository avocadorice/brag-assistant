import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const MODEL = 'gemini-2.5-pro';

const RESUME = `
Barney Hsiao — Senior Software Engineer
- Magic Leap (Nov 2021–Present): distributed backend/infra, Golang, K8s, Helm, Redis, GKE, security (Keycloak OAuth, Vault, mTLS/Istio). Led 100x latency improvement via concurrency primitives.
- Netflix (Jun 2019–Jul 2021): Tech Lead for project NEO (real-time candidate search, Kafka, Netflix DGS). Service owner of jobs.netflix.com, netflixanimations.com. Rewrote mission-critical proxy with zero interruption.
- Workday (Oct 2015–Jun 2019): College Board/Common App integrations via SOAP.
- Teletrac Navman (Jan 2014–Sep 2015): Ported flagship desktop feature to web.
Stack: Golang, TypeScript, K8s, Helm, Terraform, Istio, GCP/AWS/Azure, React/Next.js, Redis, PostgreSQL, Kafka, Elasticsearch, GraphQL, REST, gRPC
`;

function formatSources(entries) {
  return entries.map((e, i) => {
    const label = `[${i + 1}] ${e.source.toUpperCase()}${e.title ? ` — ${e.title}` : e.question ? ` — "${e.question}"` : ''}`;
    return `${label}\n${e.text.slice(0, 800)}`;
  }).join('\n\n---\n\n');
}

async function generate(systemPrompt, userPrompt) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1024,
    },
  });
  return response.text;
}

// ── Answer generation ──────────────────────────────────────────────────────────

export async function generateAnswer(question, sources, level = 'Senior') {
  const systemPrompt = `You are helping Barney Hsiao prepare for ${level}-level software engineering behavioral interviews.

BARNEY'S BACKGROUND:
${RESUME}

RULES — CRITICAL:
1. Only use stories and experiences from the provided sources. Do not invent or embellish details.
2. If a source has a specific metric or outcome, use it. If not, don't make one up.
3. Write in first person as Barney.
4. Structure the answer using STAR (Situation, Task, Action, Result) but make it flow naturally — not like a rigid template.
5. Aim for ${level === 'Staff' ? '3-4' : '2-3'} minutes spoken length (~350-450 words).
6. Sound confident and senior, but stay grounded in what actually happened.
7. At the end, add a brief "Sources used:" line listing which source numbers you drew from.`;

  const userPrompt = `BEHAVIORAL QUESTION: ${question}

RELEVANT SOURCES FROM BARNEY'S HISTORY:
${formatSources(sources)}

Generate a grounded, ${level}-level answer Barney can actually use. Only use what's in the sources above.`;

  return generate(systemPrompt, userPrompt);
}

// ── Answer editing ─────────────────────────────────────────────────────────────

export async function editAnswer(question, currentAnswer, editInstruction, sources) {
  const systemPrompt = `You are helping Barney Hsiao refine a behavioral interview answer.
Only make changes the user asks for. Do not add new fabricated details — only use what's in the original answer or the provided sources.
BARNEY'S BACKGROUND: ${RESUME}`;

  const userPrompt = `QUESTION: ${question}

CURRENT ANSWER:
${currentAnswer}

AVAILABLE SOURCES:
${formatSources(sources)}

EDIT REQUEST: ${editInstruction}

Return only the updated answer, no commentary.`;

  return generate(systemPrompt, userPrompt);
}

// ── Mock interview ─────────────────────────────────────────────────────────────

export async function getFollowUp(conversationHistory) {
  const prompt = `You are a Senior/Staff-level behavioral interviewer at a top tech company.
Based on this conversation, ask one natural, probing follow-up question. Be concise — one question only.

Conversation:
${conversationHistory.map(m => `${m.role === 'user' ? 'Interviewer' : 'Candidate'}: ${m.content}`).join('\n\n')}

Follow-up question:`;

  return generate(
    'You are a realistic technical interviewer probing for specifics and depth.',
    prompt
  );
}
