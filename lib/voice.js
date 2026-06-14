import { spawn, execSync } from 'child_process';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const TMP_WAV = '/tmp/interview_answer.wav';

export function checkSox() {
  try { execSync('which rec', { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

export function speakText(text) {
  try { execSync(`say ${JSON.stringify(text)}`, { stdio: 'ignore' }); }
  catch (_) {}
}

export async function recordAndTranscribe(ask) {
  // Clean up previous recording
  try { fs.unlinkSync(TMP_WAV); } catch (_) {}

  await ask('\n  Press Enter to start recording...');

  const rec = spawn('rec', ['-r', '16000', '-c', '1', '-e', 'signed', '-b', '16', TMP_WAV], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  await ask('  \x1b[31m● REC\x1b[0m  Speaking... Press Enter when done.');
  rec.kill('SIGTERM');

  // Brief pause for the file to flush
  await new Promise(r => setTimeout(r, 400));

  if (!fs.existsSync(TMP_WAV) || fs.statSync(TMP_WAV).size < 1000) {
    return null;
  }

  process.stdout.write('  Transcribing...');
  try {
    const audioData = fs.readFileSync(TMP_WAV);
    const base64Audio = audioData.toString('base64');

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        parts: [
          { text: 'Transcribe this audio verbatim. Return only the spoken words, nothing else.' },
          { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
        ],
      }],
    });

    process.stdout.write(' done.\n');
    return response.text.trim();
  } catch (err) {
    process.stdout.write(` failed: ${err.message}\n`);
    return null;
  }
}
