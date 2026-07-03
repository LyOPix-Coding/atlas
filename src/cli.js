const readline = require('readline');
const ollamaUsage = require('./utils/ollama-usage');
const savedPrompts = require('./utils/saved-prompts');

const MENU = `
==============================
        ATLAS  —  MENU
==============================
 1) Ask          (one-time prompt — you can pass a requestId to continue
                   an existing chat, but only one message gets added)
 2) Start chat   (full chat, requestId auto-continued each turn)
------------------------------
 3) Show tokens left
 4) Show saved prompts
 5) Clear all created programs
 6) Ollama call history
------------------------------
 0) Exit
==============================
`;

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
  return { rl, ask };
}

async function runMenu(inputLayer) {
  const { rl, ask } = createPrompter();
  let running = true;

  while (running) {
    console.log(MENU);
    const choice = await ask('Choose an option: ');

    switch (choice) {
      case '1':
        await askOnce(inputLayer, ask);
        break;
      case '2':
        await startChat(inputLayer, ask);
        break;
      case '3':
        showTokensLeft();
        break;
      case '4':
        showSavedPrompts();
        break;
      case '5':
        await clearCreatedPrograms(inputLayer);
        break;
      case '6':
        showOllamaHistory();
        break;
      case '0':
        running = false;
        break;
      default:
        console.log('Not a valid option, try again.');
    }
  }

  rl.close();
  console.log('Goodbye.');
}

async function askOnce(inputLayer, ask) {
  const input = await ask('Prompt: ');
  if (!input) {
    console.log('Cancelled — empty prompt.');
    return;
  }

  const requestId = await ask('Request ID to continue (blank for new): ');
  const { body } = await inputLayer.handleRequest(input, requestId || undefined);
  printResult(body);
}

async function startChat(inputLayer, ask) {
  console.log('Starting chat. Type "exit" to return to the menu.');

  let requestId = (await ask('Request ID to continue (blank for new): ')) || undefined;

  while (true) {
    const input = await ask(requestId ? `[${requestId}] you: ` : 'you: ');
    if (!input || input.toLowerCase() === 'exit') break;

    const { body } = await inputLayer.handleRequest(input, requestId);
    requestId = (body && body.requestId) || requestId;
    printResult(body);
  }
}

function printResult(body) {
  if (!body) return;

  if (body.status === 'rejected') {
    console.log(`\nRejected [${body.requestId}]: ${body.reason}\n`);
    return;
  }

  // With tool-calling, both "question" and "command" results now come back
  // as { answer, toolsUsed }, whether or not a tool was actually called.
  const answer = body.result && body.result.answer;
  if (answer) {
    const toolsUsed = (body.result.toolsUsed || []).join(', ');
    const suffix = toolsUsed ? ` [tools: ${toolsUsed}]` : '';
    console.log(`\n[${body.requestId}] ATLAS (${body.type})${suffix}: ${answer}\n`);
    return;
  }

  console.log(`\n[${body.requestId}] result:`, JSON.stringify(body.result, null, 2), '\n');
}

function showTokensLeft() {
  const s = ollamaUsage.getUsageSummary();
  console.log('\n--- Token usage ---');
  console.log(`Prompt tokens used:     ${s.promptTokens}`);
  console.log(`Completion tokens used: ${s.completionTokens}`);
  console.log(`Total tokens used:      ${s.used}`);
  if (s.budget) {
    console.log(`Budget:                 ${s.budget}`);
    console.log(`Remaining:              ${s.remaining}`);
  } else {
    console.log('No token budget configured (set OLLAMA_TOKEN_BUDGET to track remaining tokens).');
  }
  console.log('');
}

function showSavedPrompts() {
  const prompts = savedPrompts.list(20);
  console.log('\n--- Saved prompts (most recent first) ---');
  if (prompts.length === 0) {
    console.log('No saved prompts yet.');
  } else {
    prompts.forEach((p, i) => {
      console.log(`${i + 1}. [${p.timestamp}] (${p.requestId}, ${p.isNew ? 'new' : 'continued'}) ${p.input}`);
    });
  }
  console.log('');
}

async function clearCreatedPrograms(inputLayer) {
  await inputLayer.taskExecutor.registry.clearAll();
  console.log('\nAll created programs cleared.\n');
}

function showOllamaHistory() {
  const history = ollamaUsage.getHistory(20);
  console.log('\n--- Ollama call history (most recent first) ---');
  if (history.length === 0) {
    console.log('No calls recorded yet.');
  } else {
    history.forEach((h, i) => {
      console.log(
        `${i + 1}. [${h.timestamp}] ${h.purpose} (${h.requestId || 'n/a'}) — ${h.model} — ${h.totalTokens} tokens`
      );
    });
  }
  console.log('');
}

module.exports = { runMenu };