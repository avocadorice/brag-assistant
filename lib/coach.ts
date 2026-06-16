import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });

export interface RamblingAnalysis {
  shouldInterrupt: boolean;
  interruptMessage: string | null;
}

export interface CoachFeedback {
  landed: string;
  cut: string;
  instead: string;
}

// Called every ~25s on a snapshot transcript — use flash for speed
export async function analyzeForRambling(
  question: string,
  transcript: string
): Promise<RamblingAnalysis> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `You are a sharp interview coach monitoring a candidate's answer in real-time.

Question: "${question}"

Transcript so far: "${transcript}"

Is the candidate clearly rambling, losing the thread, or going on a tangent that's hurting their answer?
Only interrupt if it's clearly a problem — not just for a long answer.

Respond with JSON only, no markdown:
{
  "shouldInterrupt": boolean,
  "interruptMessage": "short spoken interruption starting with 'Let me stop you there'" | null
}`,
      config: { maxOutputTokens: 150 },
    });

    const raw = (response.text ?? '').replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(raw) as RamblingAnalysis;
  } catch {
    return { shouldInterrupt: false, interruptMessage: null };
  }
}

export async function coachAnswer(
  question: string,
  transcript: string,
  wasInterrupted: boolean
): Promise<CoachFeedback> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `You are a brutally honest but supportive interview coach.

Question: "${question}"

Candidate's answer${wasInterrupted ? ' (cut short — they were rambling)' : ''}:
"${transcript}"

Give coaching in exactly three sections. Be specific — reference actual phrases from their answer.

LANDED: What was concrete, strong, or memorable. One short paragraph.

CUT: Where they rambled, repeated themselves, oversold, or lost the thread. Be direct and specific.

INSTEAD: The tighter version of what they were trying to say — 2-3 sentences max, as if you're rewriting just the weak part.`,
    config: { maxOutputTokens: 500 },
  });

  const text = response.text ?? '';
  return {
    landed:  extract(text, 'LANDED'),
    cut:     extract(text, 'CUT'),
    instead: extract(text, 'INSTEAD'),
  };
}

function extract(text: string, section: string): string {
  const re = new RegExp(`${section}:\\s*([\\s\\S]*?)(?=\\n[A-Z]+:|$)`, 'i');
  return text.match(re)?.[1]?.trim() ?? '';
}
