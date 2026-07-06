const readline = require('readline');
const os = require('os');
const path = require('path');
const fsSync = require('fs');
const { spawnSync } = require('child_process');
const ollamaUsage = require('./utils/ollama-usage');
const savedPrompts = require('./utils/saved-prompts');
const config = require('./utils/config');

let apiServer = null;

function buildMenu() {
  const apiStatus = apiServer
    ? `RUNNING at http://${config.host}:${config.port}`
    : 'not running';

  return `
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
 7) Start API server   [${apiStatus}]
 8) Edit a generated task
------------------------------
 0) Exit
==============================
`;
}

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
  return { rl, ask };
}

async function runMenu(inputLayer) {
  const { rl, ask } = createPrompter();
  let running = true;

  while (running) {
    console.log(buildMenu());
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
      case '7':
        startApiServer(inputLayer);
        break;
      case '8':
        await editGeneratedTask(inputLayer, ask);
        break;
      case '0':
        running = false;
        break;
      default:
        console.log('Not a valid option, try again.');
    }
  }

  await stopApiServer();
  rl.close();
  console.log('Goodbye.');
}

function startApiServer(inputLayer) {
  if (apiServer) {
    console.log(`\nAPI server is already running at http://${config.host}:${config.port}\n`);
    return;
  }

  const server = inputLayer.app.listen(config.port, config.host, () => {
    console.log(`\nAPI server listening at http://${config.host}:${config.port}`);
    console.log(`POST http://${config.host}:${config.port}/request`);
    console.log(`GET  http://${config.host}:${config.port}/health\n`);
  });

  server.on('error', (err) => {
    console.log(`\nFailed to start API server: ${err.message}\n`);
    if (apiServer === server) apiServer = null;
  });

  apiServer = server;
}

function stopApiServer() {
  if (!apiServer) return Promise.resolve();

  return new Promise((resolve) => {
    apiServer.close(() => {
      apiServer = null;
      resolve();
    });
  });
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

  const answer = body.result && body.result.answer;
  if (answer) {
    const toolsUsed = (body.result.toolsUsed || []).join(', ');
    const suffix = toolsUsed ? ` [tools: ${toolsUsed}]` : '';
    console.log(`\n[${body.requestId}] ATLAS (${body.type})${suffix}: ${answer}\n`);

    if ((body.result.toolsUsed || []).includes('generate_function')) {
      console.log('(generated a new function this turn — check "Clear all created programs" menu or tasks/generated-tasks.json for the saved code)\n');
    }
    return;
  }

  if (body.result && body.result.repaired) {
    console.log(`(this task needed ${body.result.repairAttempts} self-repair attempt(s) before it ran successfully — the fixed code was saved back to the registry)\n`);
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

// --- Generated task editing -------------------------------------------

function getEditorCommand() {
  if (process.env.EDITOR) return process.env.EDITOR;
  return process.platform === 'win32' ? 'notepad' : 'nano';
}

async function editGeneratedTask(inputLayer, ask) {
  const registry = inputLayer.taskExecutor.registry;
  const taskNames = registry.listTasks();

  if (taskNames.length === 0) {
    console.log('\nNo generated tasks to edit.\n');
    return;
  }

  console.log('\n--- Generated tasks ---');
  taskNames.forEach((name, i) => {
    const task = registry.getTask(name);
    console.log(`${i + 1}. ${name} — ${(task && task.description) || '(no description)'}`);
  });
  console.log('');

  const choice = await ask('Task number to edit (blank to cancel): ');
  if (!choice) {
    console.log('Cancelled.\n');
    return;
  }

  const index = parseInt(choice, 10) - 1;
  const taskName = taskNames[index];
  if (!taskName) {
    console.log('Not a valid task number.\n');
    return;
  }

  let task = registry.getTask(taskName);
  let editing = true;

  while (editing) {
    console.log(`\n--- ${taskName} ---`);
    console.log(`Description:   ${task.description || '(none)'}`);
    console.log(`Params:        ${JSON.stringify(task.params)}`);
    console.log(`Created:       ${task.createdAt || 'unknown'}`);
    if (task.editedAt) console.log(`Last edited:   ${task.editedAt}`);
    if (task.repairedAt) console.log(`Last repaired: ${task.repairedAt}`);
    console.log(`\nCode:\n${task.code}\n`);

    console.log('1) Edit code (opens in your text editor)');
    console.log('2) Edit description');
    console.log('3) Edit params (JSON)');
    console.log('4) Delete this task');
    console.log('0) Done — back to menu');

    const action = await ask('Choose an action: ');

    switch (action) {
      case '1':
        await editTaskCode(inputLayer, taskName, task, ask);
        task = registry.getTask(taskName); // reload in case it was saved
        break;

      case '2': {
        const newDescription = await ask('New description: ');
        if (newDescription) {
          await registry.editTask(taskName, { description: newDescription });
          task = registry.getTask(taskName);
          console.log('Description updated.\n');
        } else {
          console.log('Cancelled — empty description.\n');
        }
        break;
      }

      case '3': {
        const newParamsRaw = await ask('New params as JSON (e.g. {"n": 5}): ');
        try {
          const newParams = JSON.parse(newParamsRaw);
          await registry.editTask(taskName, { params: newParams });
          task = registry.getTask(taskName);
          console.log('Params updated.\n');
        } catch (err) {
          console.log(`Invalid JSON, not saved: ${err.message}\n`);
        }
        break;
      }

      case '4': {
        const confirm = await ask(`Type the task name again to confirm deletion of "${taskName}": `);
        if (confirm === taskName) {
          await registry.deleteTask(taskName);
          console.log(`Deleted "${taskName}".\n`);
          editing = false;
        } else {
          console.log('Confirmation did not match — not deleted.\n');
        }
        break;
      }

      case '0':
        editing = false;
        break;

      default:
        console.log('Not a valid option.\n');
    }
  }
}

// Opens the task's code in an external text editor against a temp file,
// blocks until the editor process exits, then validates and saves the
// result through the same safety pipeline as freshly generated code.
async function editTaskCode(inputLayer, taskName, task, ask) {
  const registry = inputLayer.taskExecutor.registry;
  const taskExecutor = inputLayer.taskExecutor;

  const tempFile = path.join(os.tmpdir(), `atlas_edit_${taskName}_${Date.now()}.js`);
  fsSync.writeFileSync(tempFile, task.code, 'utf-8');

  const editor = getEditorCommand();
  console.log(`\nOpening ${tempFile} in "${editor}" — save and close the editor to continue.`);

  const result = spawnSync(editor, [tempFile], { stdio: 'inherit' });

  if (result.error) {
    console.log(`Could not launch editor "${editor}": ${result.error.message}`);
    await ask(`Manually edit ${tempFile}, then press Enter here when done: `);
  }

  let editedCode;
  try {
    editedCode = fsSync.readFileSync(tempFile, 'utf-8');
  } catch (err) {
    console.log(`Could not read edited file: ${err.message}\n`);
    return;
  } finally {
    try {
      fsSync.unlinkSync(tempFile);
    } catch (_) {
      // best-effort cleanup
    }
  }

  if (editedCode.trim() === task.code.trim()) {
    console.log('No changes detected.\n');
    return;
  }

  const validation = await taskExecutor.codeGenerator.validateCode(editedCode);
  if (!validation.valid) {
    console.log(`Edited code failed validation: ${validation.reason}\nNot saved.\n`);
    return;
  }

  const funcName = taskExecutor.extractFunctionName(editedCode);
  if (!funcName) {
    console.log(
      'Could not find a top-level function in the edited code (expected `function name(params) { ... }`). Not saved.\n'
    );
    return;
  }

  await registry.editTask(taskName, { code: editedCode });
  console.log(`Saved. Entry point function: ${funcName}\n`);
}

module.exports = { runMenu };