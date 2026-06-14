import 'dotenv/config';
import readline from 'readline';
import { loadKnowledgeBase, retrieve } from './lib/knowledge.js';
import { generateAnswer, editAnswer, getFollowUp } from './lib/claude.js';
import { addStory, listStories } from './lib/stories.js';
import { checkSox, speakText, recordAndTranscribe } from './lib/voice.js';
import { pickQuestion } from './lib/questions.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

function hr() { console.log('\n' + '─'.repeat(60)); }
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function cyan(s) { return `\x1b[36m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }

// ── Answer mode ────────────────────────────────────────────────────────────────

async function answerMode(kb) {
  hr();
  const question = await ask(bold('Question: '));
  if (!question.trim()) return;

  const level = (await ask('Level [Senior/Staff] (default Senior): ')).trim() || 'Senior';

  console.log(dim('\nRetrieving relevant stories...'));
  const sources = retrieve(question, kb);
  console.log(dim(`Found ${sources.length} relevant sources: ${sources.map(s => s.title || s.question?.slice(0, 40) || s.type).join(', ')}\n`));

  console.log(dim('Generating answer...\n'));
  let answer = await generateAnswer(question, sources, level);

  while (true) {
    hr();
    console.log(bold('DRAFT ANSWER:\n'));
    console.log(answer);
    hr();
    console.log(cyan('\nOptions: [enter] to edit  |  done  |  mock (simulate follow-ups)  |  quit'));
    const input = (await ask('> ')).trim().toLowerCase();

    if (input === 'done' || input === '') {
      if (input === '') {
        const edit = await ask('Edit instruction: ');
        if (edit.trim()) {
          console.log(dim('\nRevising...\n'));
          answer = await editAnswer(question, answer, edit, sources);
        }
      } else {
        console.log(green('\n✓ Answer saved for this session.\n'));
        break;
      }
    } else if (input === 'mock') {
      await mockMode(question, answer, sources);
      break;
    } else if (input === 'quit') {
      break;
    } else {
      console.log(dim('\nRevising...\n'));
      answer = await editAnswer(question, answer, input, sources);
    }
  }
}

// ── Mock interview mode ────────────────────────────────────────────────────────

async function mockMode(question, initialAnswer, sources) {
  hr();
  console.log(bold('MOCK INTERVIEW\n'));
  console.log(dim('Interviewer asks → You answer → Interviewer follows up. Type your own answer or press Enter for AI.\n'));

  const history = [
    { role: 'user', content: `Interviewer: ${question}` },
    { role: 'assistant', content: `Candidate: ${initialAnswer}` },
  ];

  console.log(bold('Interviewer: ') + question);
  console.log('\n' + bold('You (AI): ') + initialAnswer);

  let round = 0;
  while (round < 4) {
    hr();
    console.log(dim('Getting follow-up question...'));
    const followUp = await getFollowUp(history);
    console.log('\n' + bold('Interviewer: ') + followUp);

    history.push({ role: 'user', content: followUp });

    console.log(cyan('\nYour answer (or press Enter for AI response, "done" to end):'));
    const userInput = await ask('> ');

    if (userInput.toLowerCase() === 'done') break;

    let candidateAnswer;
    if (userInput.trim()) {
      candidateAnswer = userInput;
    } else {
      console.log(dim('\nGenerating AI response...\n'));
      candidateAnswer = await generateAnswer(followUp, sources);
    }

    console.log('\n' + bold('You: ') + candidateAnswer);
    history.push({ role: 'assistant', content: candidateAnswer });
    round++;
  }

  hr();
  console.log(green('Mock interview complete.\n'));
}

// ── Practice mode ──────────────────────────────────────────────────────────────

async function practiceMode(kb, useVoice) {
  hr();

  // Pick question
  const question = pickQuestion(kb);
  const sources = retrieve(question, kb);

  console.log(bold('\nINTERVIEWER:\n'));
  console.log(cyan(question) + '\n');

  if (useVoice) speakText(question);

  // Get initial answer
  let answer = await getAnswer(useVoice, 'Your answer');
  if (!answer) return;

  if (useVoice) {
    hr();
    console.log(bold('You said:\n'));
    console.log(answer + '\n');
  }

  // Follow-up loop
  const history = [
    { role: 'user', content: question },
    { role: 'assistant', content: answer },
  ];

  let round = 0;
  while (round < 3) {
    hr();
    console.log(dim('Generating follow-up...'));
    const followUp = await getFollowUp(history);

    console.log('\n' + bold('FOLLOW-UP:\n'));
    console.log(yellow(followUp) + '\n');
    if (useVoice) speakText(followUp);

    const followUpAnswer = await getAnswer(useVoice, 'Your answer (or type "done" to finish)');
    if (!followUpAnswer || followUpAnswer.toLowerCase() === 'done') break;

    if (useVoice) {
      hr();
      console.log(bold('You said:\n'));
      console.log(followUpAnswer + '\n');
    }

    history.push({ role: 'user', content: followUp });
    history.push({ role: 'assistant', content: followUpAnswer });
    round++;
  }

  hr();
  console.log(green('Practice session done.\n'));
  console.log(dim('Tip: Run "npm run prep" again and pick option 1 to generate a polished answer for this question.\n'));
}

async function getAnswer(useVoice, prompt) {
  if (useVoice) {
    const transcript = await recordAndTranscribe(ask);
    return transcript;
  }
  return ask(`${prompt}: `);
}

// ── Main menu ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold('\n  Interview Prep Assistant'));
  console.log(dim('  Loading knowledge base...\n'));

  const kb = await loadKnowledgeBase();
  console.log(green(`  Loaded ${kb.length} entries from your sources\n`));

  const hasSox = checkSox();

  while (true) {
    hr();
    console.log(bold('What would you like to do?'));
    console.log('  1. Answer a question (AI drafts, you refine)');
    console.log('  2. Practice — get a random question, answer it yourself');
    console.log('  3. Add a story to your story bank');
    console.log('  4. List your stories');
    console.log('  5. Exit\n');

    const choice = (await ask('> ')).trim();

    if (choice === '1') {
      await answerMode(kb);
    } else if (choice === '2') {
      let useVoice = false;
      if (hasSox) {
        const mode = (await ask(dim('Mode? [voice/text] (default: text): '))).trim().toLowerCase();
        useVoice = mode === 'voice' || mode === 'v';
      } else if (choice === '2') {
        console.log(dim('  (Voice mode requires sox — install with: brew install sox)\n'));
      }
      await practiceMode(kb, useVoice);
    } else if (choice === '3') {
      await addStory(rl);
      const updated = await loadKnowledgeBase();
      kb.length = 0;
      kb.push(...updated);
    } else if (choice === '4') {
      listStories();
    } else if (choice === '5' || choice === 'exit' || choice === 'quit') {
      console.log('\n  Good luck!\n');
      rl.close();
      break;
    }
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
