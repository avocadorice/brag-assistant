import readline from 'node:readline';
import { loadKnowledgeBase, retrieve, type KnowledgeEntry } from './lib/knowledge.js';
import { generateAnswer, editAnswer, getFollowUp, getRecruiterFollowUp, amendStoryText, type ConversationMessage } from './lib/claude.js';
import { addStory, listStories, getStory, updateStory, searchStories } from './lib/stories.js';
import { checkSox, speakText, recordAndTranscribe, recordWithCoaching } from './lib/voice.js';
import { coachAnswer } from './lib/coach.js';
import { pickQuestion } from './lib/questions.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const hr = () => console.log('\n' + '─'.repeat(60));

// ── Answer mode ────────────────────────────────────────────────────────────────

async function answerMode(kb: KnowledgeEntry[]): Promise<void> {
  hr();
  const question = await ask(bold('Question: '));
  if (!question.trim()) return;

  const level = (await ask('Level [Senior/Staff] (default Senior): ')).trim() || 'Senior';

  console.log(dim('\nRetrieving relevant stories...'));
  const sources = retrieve(question, kb);
  console.log(dim(`Found ${sources.length} relevant sources: ${sources.map(s => s.title ?? s.question?.slice(0, 40) ?? s.type).join(', ')}\n`));

  console.log(dim('Generating answer...\n'));
  let answer = await generateAnswer(question, sources, level);

  while (true) {
    hr();
    console.log(bold('DRAFT ANSWER:\n'));
    console.log(answer);
    hr();
    console.log(cyan('\nOptions: [enter] to edit  |  done  |  mock (simulate follow-ups)  |  quit'));
    const input = (await ask('> ')).trim().toLowerCase();

    if (input === '') {
      const edit = await ask('Edit instruction: ');
      if (edit.trim()) {
        console.log(dim('\nRevising...\n'));
        answer = await editAnswer(question, answer, edit, sources);
      }
    } else if (input === 'done') {
      console.log(green('\n✓ Answer saved for this session.\n'));
      break;
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

async function mockMode(question: string, initialAnswer: string, sources: KnowledgeEntry[]): Promise<void> {
  hr();
  console.log(bold('MOCK INTERVIEW\n'));
  console.log(dim('Interviewer asks → You answer → Interviewer follows up.\n'));

  const history: ConversationMessage[] = [
    { role: 'user', content: `Interviewer: ${question}` },
    { role: 'assistant', content: `Candidate: ${initialAnswer}` },
  ];

  console.log(bold('Interviewer: ') + question);
  console.log('\n' + bold('You (AI): ') + initialAnswer);

  for (let round = 0; round < 4; round++) {
    hr();
    console.log(dim('Getting follow-up question...'));
    const followUp = await getFollowUp(history);
    console.log('\n' + bold('Interviewer: ') + followUp);
    history.push({ role: 'user', content: followUp });

    console.log(cyan('\nYour answer (or press Enter for AI response, "done" to end):'));
    const userInput = await ask('> ');
    if (userInput.toLowerCase() === 'done') break;

    const candidateAnswer = userInput.trim()
      ? userInput
      : (console.log(dim('\nGenerating AI response...\n')), await generateAnswer(followUp, sources));

    console.log('\n' + bold('You: ') + candidateAnswer);
    history.push({ role: 'assistant', content: candidateAnswer });
  }

  hr();
  console.log(green('Mock interview complete.\n'));
}

// ── Practice mode ──────────────────────────────────────────────────────────────

async function practiceMode(kb: KnowledgeEntry[], useVoice: boolean): Promise<void> {
  hr();
  const question = pickQuestion(kb);
  const sources = retrieve(question, kb);

  console.log(bold('\nINTERVIEWER:\n'));
  console.log(cyan(question) + '\n');
  speakText(question);

  if (useVoice) {
    await voicePracticeRound(question, sources);
  } else {
    await textPracticeRound(question, sources);
  }
}

async function voicePracticeRound(question: string, sources: KnowledgeEntry[]): Promise<void> {
  // Record with real-time rambling detection
  const { transcript, wasInterrupted, interruptMessage } = await recordWithCoaching(question, rl);

  if (!transcript) { console.log(dim('No audio captured.\n')); return; }

  hr();
  console.log(bold('YOU SAID:\n'));
  console.log(dim(transcript) + '\n');

  if (wasInterrupted && interruptMessage) {
    console.log('\x1b[33m⚡ INTERRUPTED: ' + interruptMessage + '\x1b[0m\n');
  }

  // Coach analysis
  console.log(dim('Analyzing...\n'));
  const feedback = await coachAnswer(question, transcript, wasInterrupted);

  hr();
  console.log(bold('COACH FEEDBACK:\n'));
  console.log(green('✓ What landed:\n') + feedback.landed + '\n');
  console.log('\x1b[31m✗ What to cut:\x1b[0m\n' + feedback.cut + '\n');
  console.log(cyan('→ What to say instead:\n') + feedback.instead + '\n');

  // Options
  hr();
  console.log(dim('Options:  ideal  |  followup  |  retry  |  done'));
  const choice = (await ask('> ')).trim().toLowerCase();

  if (choice === 'ideal') {
    console.log(dim('\nGenerating ideal answer...\n'));
    const ideal = await generateAnswer(question, sources);
    hr();
    console.log(bold('IDEAL ANSWER:\n') + ideal + '\n');
    speakText(ideal);
    await ask(dim('Press Enter to continue...'));
  } else if (choice === 'followup') {
    const followUp = await getFollowUp([
      { role: 'user', content: question },
      { role: 'assistant', content: transcript },
    ]);
    console.log('\n' + bold('FOLLOW-UP: ') + yellow(followUp) + '\n');
    speakText(followUp);
    await voicePracticeRound(followUp, sources);
    return;
  } else if (choice === 'retry') {
    console.log(dim('\nTake two.\n'));
    await voicePracticeRound(question, sources);
    return;
  }

  hr();
  console.log(green('Session done.\n'));
}

async function textPracticeRound(question: string, sources: KnowledgeEntry[]): Promise<void> {
  const answer = await ask('Your answer: ');
  if (!answer.trim()) return;

  console.log(dim('\nAnalyzing...\n'));
  const feedback = await coachAnswer(question, answer, false);

  hr();
  console.log(bold('COACH FEEDBACK:\n'));
  console.log(green('✓ What landed:\n') + feedback.landed + '\n');
  console.log('\x1b[31m✗ What to cut:\x1b[0m\n' + feedback.cut + '\n');
  console.log(cyan('→ What to say instead:\n') + feedback.instead + '\n');

  hr();
  console.log(dim('Options:  ideal  |  followup  |  retry  |  done'));
  const choice = (await ask('> ')).trim().toLowerCase();

  if (choice === 'ideal') {
    console.log(dim('\nGenerating ideal answer...\n'));
    console.log(bold('IDEAL ANSWER:\n') + await generateAnswer(question, sources) + '\n');
  } else if (choice === 'followup') {
    const followUp = await getFollowUp([
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
    ]);
    console.log('\n' + bold('FOLLOW-UP: ') + yellow(followUp) + '\n');
    await textPracticeRound(followUp, sources);
  } else if (choice === 'retry') {
    await textPracticeRound(question, sources);
  }
}

// ── Recruiter call prep mode ───────────────────────────────────────────────────

async function recruiterCallMode(kb: KnowledgeEntry[], companyName: string): Promise<void> {
  const prefix = `[${companyName} Recruiter Call]`;
  const companyStories = kb
    .filter(e => e.source === 'story-bank' && e.title?.startsWith(prefix))
    .sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''));

  if (companyStories.length === 0) {
    console.log(yellow(`\n  No stories found for "${companyName}". Add some with option 4.\n`));
    return;
  }

  const questionsStory = companyStories.find(s =>
    s.title?.toLowerCase().includes('questions to ask')
  );
  const practiceStories = companyStories.filter(s =>
    !s.title?.toLowerCase().includes('questions to ask')
  );

  hr();
  console.log(bold(`RECRUITER CALL PREP — ${companyName.toUpperCase()}`));
  console.log(dim(`  ${practiceStories.length} questions to practice\n`));

  for (let i = 0; i < practiceStories.length; i++) {
    const story = practiceStories[i];
    const question = story.title!.replace(prefix, '').trim();

    hr();
    console.log(dim(`  Question ${i + 1} of ${practiceStories.length}`));
    console.log('\n' + bold('RECRUITER: ') + cyan(question) + '\n');
    speakText(question);

    await recruiterPracticeRound(question, story.text, companyName);

    if (i < practiceStories.length - 1) {
      const next = (await ask(dim('\n[Enter] next  |  quit: '))).trim().toLowerCase();
      if (next === 'quit') break;
    }
  }

  if (questionsStory) {
    hr();
    console.log(bold('YOUR QUESTIONS FOR THEM:\n'));
    console.log(green(questionsStory.text) + '\n');
  }

  hr();
  console.log(green(`Good luck with ${companyName}!\n`));
}

async function recruiterPracticeRound(
  question: string,
  idealAnswer: string,
  company: string
): Promise<void> {
  console.log(dim('Your answer (or Enter to skip to ideal):'));
  const answer = await ask('> ');

  if (!answer.trim()) {
    hr();
    console.log(bold('YOUR SAVED ANSWER:\n'));
    console.log(idealAnswer + '\n');
    speakText(idealAnswer);
    await ask(dim('Press Enter to continue...'));
    return;
  }

  console.log(dim('\nAnalyzing...\n'));
  const feedback = await coachAnswer(question, answer, false);

  hr();
  console.log(bold('COACH FEEDBACK:\n'));
  console.log(green('✓ What landed:\n') + feedback.landed + '\n');
  console.log('\x1b[31m✗ What to cut:\x1b[0m\n' + feedback.cut + '\n');
  console.log(cyan('→ What to say instead:\n') + feedback.instead + '\n');

  hr();
  console.log(dim('Options:  ideal  |  followup  |  retry  |  done'));
  const choice = (await ask('> ')).trim().toLowerCase();

  if (choice === 'ideal') {
    hr();
    console.log(bold('YOUR SAVED ANSWER:\n'));
    console.log(idealAnswer + '\n');
    speakText(idealAnswer);
    await ask(dim('Press Enter to continue...'));
  } else if (choice === 'followup') {
    const followUp = await getRecruiterFollowUp([
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
    ], company);
    hr();
    console.log(bold('RECRUITER: ') + yellow(followUp) + '\n');
    speakText(followUp);
    await recruiterPracticeRound(followUp, idealAnswer, company);
  } else if (choice === 'retry') {
    await recruiterPracticeRound(question, idealAnswer, company);
  }
}

// ── Cue mode ───────────────────────────────────────────────────────────────────

function getBeats(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.split(/[.!?]/)[0].trim())
    .filter(Boolean)
    .slice(0, 4);
}

async function cueMode(): Promise<void> {
  while (true) {
    hr();
    console.log(bold('CUE MODE') + dim(' — type a keyword to find your answer\n'));
    const query = (await ask('Keyword (or Enter to quit): ')).trim();
    if (!query) break;

    const results = searchStories(query);
    if (!results.length) {
      console.log(yellow('\n  No matches found.\n'));
      continue;
    }

    hr();
    results.forEach((s, i) => {
      const label = s.title.replace(/^\[.*?\]\s*/, '');
      const beats = getBeats(s.text).join(' → ');
      console.log(`  ${i + 1}. ${bold(label)}`);
      console.log(`     ${dim(beats)}\n`);
    });

    const pick = (await ask('Pick a number to expand (or Enter to search again): ')).trim();
    const idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || !results[idx]) continue;

    const story = results[idx];
    hr();
    console.log(bold(story.title.replace(/^\[.*?\]\s*/, '')) + '\n');
    console.log(story.text + '\n');
    speakText(story.text);
    await ask(dim('Press Enter to search again...'));
  }
}

// ── Main menu ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(bold('\n  RAG Assistant'));
  console.log(dim('  Loading knowledge base...\n'));

  const kb = await loadKnowledgeBase();
  console.log(green(`  Loaded ${kb.length} entries from your sources\n`));

  const hasSox = checkSox();

  while (true) {
    hr();
    console.log(bold('What would you like to do?'));
    console.log('  1. Recruiter call prep — company-specific questions in sequence');
    console.log('  2. Practice — random behavioral question, answer it yourself');
    console.log('  3. Answer a question (AI drafts, you refine)');
    console.log('  4. Add a story to your story bank');
    console.log('  5. List your stories');
    console.log('  6. Cue — keyword lookup with anchor preview');
    console.log('  7. Exit\n');

    const choice = (await ask('> ')).trim();

    if (choice === '1') {
      const company = (await ask('Company name (e.g. SynthBee): ')).trim();
      if (company) await recruiterCallMode(kb, company);
    } else if (choice === '2') {
      let useVoice = false;
      if (hasSox) {
        const mode = (await ask(dim('Mode? [voice/text] (default: text): '))).trim().toLowerCase();
        useVoice = mode === 'voice' || mode === 'v';
      } else {
        console.log(dim('  (Voice mode requires sox — install with: brew install sox)\n'));
      }
      await practiceMode(kb, useVoice);
    } else if (choice === '3') {
      await answerMode(kb);
    } else if (choice === '4') {
      await addStory(rl);
      const updated = await loadKnowledgeBase();
      kb.length = 0;
      kb.push(...updated);
    } else if (choice === '5') {
      let browsingStories = true;
      while (browsingStories) {
        listStories();
        const pick = (await ask('> ')).trim();
        const idx = parseInt(pick, 10) - 1;
        if (isNaN(idx)) { browsingStories = false; break; }
        const story = getStory(idx);
        if (!story) continue;
        hr();
        console.log(bold(story.title) + '\n');
        console.log(story.text + '\n');
        console.log(dim('Options:  edit  |  Enter to go back'));
        const action = (await ask('> ')).trim().toLowerCase();
        if (action === 'edit') {
          hr();
          const newTitle = (await ask(`Title (Enter to keep): `)).trim();

          console.log(dim('\nAmendment notes — describe what to add, change, or cut.\nAI will revise the full story to incorporate your notes.\n(Enter to skip text edit)'));
          const notes = (await ask('> ')).trim();

          if (notes) {
            console.log(dim('\nRevising...\n'));
            let revised = await amendStoryText(story.text, notes);

            while (true) {
              hr();
              console.log(bold('REVISED STORY:\n'));
              console.log(revised + '\n');
              console.log(dim('Options:  accept  |  retry  |  cancel'));
              const confirm = (await ask('> ')).trim().toLowerCase();
              if (confirm === 'accept') {
                updateStory(idx, { title: newTitle || undefined, text: revised });
                console.log(green('\nSaved.\n'));
                break;
              } else if (confirm === 'retry') {
                const moreNotes = (await ask(dim('Additional notes for retry (or Enter to retry same): '))).trim();
                console.log(dim('\nRevising...\n'));
                revised = await amendStoryText(story.text, moreNotes || notes);
              } else {
                console.log(dim('\nCancelled.\n'));
                break;
              }
            }
          } else if (newTitle) {
            updateStory(idx, { title: newTitle });
            console.log(green('\nTitle updated.\n'));
          }
        }
      }
    } else if (choice === '6') {
      await cueMode();
    } else if (choice === '7' || choice === 'exit' || choice === 'quit') {
      console.log('\n  Good luck!\n');
      rl.close();
      break;
    }
  }
}

main().catch(err => { console.error('Fatal:', (err as Error).message); process.exit(1); });
