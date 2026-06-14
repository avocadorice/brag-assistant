import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import type { Interface as ReadlineInterface } from 'node:readline';
import { GoogleGenAI } from '@google/genai';
import { analyzeForRambling } from './coach.js';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
const MAIN_WAV = '/tmp/brag_main.wav';
const SNAP_WAV = '/tmp/brag_snap.wav';

export function checkSox(): boolean {
  try { execSync('which rec', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export function speakText(text: string): void {
  try { execSync(`say ${JSON.stringify(text)}`, { stdio: 'ignore' }); }
  catch { /* TTS is best-effort */ }
}

export async function transcribeFile(filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) return null;
  try {
    const base64Audio = fs.readFileSync(filePath).toString('base64');
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        parts: [
          { text: 'Transcribe this audio verbatim. Return only the spoken words, nothing else.' },
          { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
        ],
      }],
    });
    return response.text?.trim() ?? null;
  } catch { return null; }
}

export interface RecordResult {
  transcript: string;
  wasInterrupted: boolean;
  interruptMessage: string | null;
}

// Records with real-time rambling detection. Every ANALYSIS_INTERVAL ms,
// snapshots the audio and asks Gemini if we should interrupt.
export async function recordWithCoaching(
  question: string,
  rl: ReadlineInterface,
  ANALYSIS_INTERVAL = 25_000
): Promise<RecordResult> {
  try { fs.unlinkSync(MAIN_WAV); } catch { /* ok */ }
  try { fs.unlinkSync(SNAP_WAV); } catch { /* ok */ }

  console.log('\n  Press Enter to start recording...');
  await new Promise<void>(resolve => rl.once('line', () => resolve()));

  const rec = spawn('rec', ['-r', '16000', '-c', '1', '-e', 'signed', '-b', '16', MAIN_WAV], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  process.stdout.write('  \x1b[31m● REC\x1b[0m  Speaking... Press Enter to stop.\n');

  let wasInterrupted = false;
  let interruptMessage: string | null = null;

  // Resolve when user presses Enter OR interrupt fires
  await new Promise<void>((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(analysisTimer);
      rl.removeListener('line', onLine);
      resolve();
    };

    const onLine = () => finish();
    rl.on('line', onLine);

    const analysisTimer = setInterval(async () => {
      if (done) return;
      if (!fs.existsSync(MAIN_WAV) || fs.statSync(MAIN_WAV).size < 8000) return;

      try { fs.copyFileSync(MAIN_WAV, SNAP_WAV); } catch { return; }

      const snapTranscript = await transcribeFile(SNAP_WAV);
      if (!snapTranscript || done) return;

      const analysis = await analyzeForRambling(question, snapTranscript);
      if (analysis.shouldInterrupt && analysis.interruptMessage && !done) {
        wasInterrupted = true;
        interruptMessage = analysis.interruptMessage;
        rec.kill('SIGTERM');
        // Brief pause so sox flushes, then audible interrupt
        await new Promise(r => setTimeout(r, 200));
        process.stdout.write('\n');
        speakText(analysis.interruptMessage);
        finish();
      }
    }, ANALYSIS_INTERVAL);
  });

  if (!rec.killed) rec.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));

  process.stdout.write('  Transcribing...');
  const transcript = await transcribeFile(MAIN_WAV) ?? '';
  process.stdout.write(' done.\n');

  return { transcript, wasInterrupted, interruptMessage };
}

// Simple record + transcribe (used in non-coaching contexts)
export async function recordAndTranscribe(ask: (q: string) => Promise<string>): Promise<string | null> {
  try { fs.unlinkSync(MAIN_WAV); } catch { /* ok */ }

  await ask('\n  Press Enter to start recording...');
  const rec = spawn('rec', ['-r', '16000', '-c', '1', '-e', 'signed', '-b', '16', MAIN_WAV], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  await ask('  \x1b[31m● REC\x1b[0m  Speaking... Press Enter when done.');
  rec.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));

  process.stdout.write('  Transcribing...');
  const transcript = await transcribeFile(MAIN_WAV);
  process.stdout.write(transcript ? ' done.\n' : ' failed.\n');
  return transcript;
}
