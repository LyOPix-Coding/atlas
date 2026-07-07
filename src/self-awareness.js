const fs = require('fs').promises;
const path = require('path');
const { AIProvider } = require('./utils/ai-provider');
const logger = require('./utils/logger');
const config = require('./utils/config');
const { SYSTEM_IDENTITY } = require('./utils/identity');

const PROJECT_ROOT = path.join(__dirname, '..');

const FILE_MANIFEST = [
  { path: 'src/index.js', description: 'Server entry point: starts Express, wires up the three layers' },
  { path: 'src/input-layer.js', description: 'HTTP layer: receives requests, classifies question vs command, calls the AI provider for Q&A' },
  { path: 'src/intent-processor.js', description: 'Classifies command text into a task and params, validates legality, feasibility, and safety' },
  { path: 'src/task-executor.js', description: 'Executes built-in tasks, or generates and runs new code for unknown tasks' },
  { path: 'src/code-generator.js', description: 'Calls the AI provider to name and write JavaScript for unknown tasks, validates the code for dangerous patterns' },
  { path: 'src/task-registry.js', description: 'Persists learned tasks to tasks/generated-tasks.json' },
  { path: 'src/self-awareness.js', description: 'Lets ATLAS read and explain its own source code' },
  { path: 'src/utils/config.js', description: 'Reads environment variables into a config object' },
  { path: 'src/utils/logger.js', description: 'Console logging helper with levels' },
  { path: 'src/utils/identity.js', description: 'Defines the ATLAS system identity used in prompts' },
  { path: 'README.md', description: 'Project overview, architecture, and usage docs' },
  { path: 'package.json', description: 'Dependencies and npm scripts' },
  { path: 'src/utils/conversation-store.js', description: 'Stores the conversations into a different file' },
  { path: 'src/utils/ai-usage.js', description: 'Stores the amount of calls and tokens used into a different file' },
  { path: 'src/utils/saved-prompts.js', description: 'Stores the past prompts into a different file' },
  { path: 'src/cli.js', description: 'Gives a better UX to the user by giving a UI' },
];

class SelfAwareness {
  constructor() {
    this.ai = new AIProvider({
      host: config.aiHost,
      headers: { Authorization: `Bearer ${config.aiApiKey}` },
    });
  }

  resolveSafePath(relativePath) {
    const resolved = path.resolve(PROJECT_ROOT, relativePath);
    const relative = path.relative(PROJECT_ROOT, resolved);
    const escapesRoot = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

    if (escapesRoot) {
      throw new Error(`Refusing to read path outside project root: ${relativePath}`);
    }
    return resolved;
  }

  selectRelevantFiles(question) {
    const lower = question.toLowerCase();
    const words = lower.split(/\W+/).filter((w) => w.length > 3);

    const scored = FILE_MANIFEST.map((entry) => {
      const haystack = `${entry.path} ${entry.description}`.toLowerCase();
      const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
      return { ...entry, score };
    });

    const matched = scored.filter((e) => e.score > 0).sort((a, b) => b.score - a.score);

    if (matched.length > 0) {
      return matched.slice(0, 4);
    }

    return FILE_MANIFEST.filter((e) =>
      ['src/index.js', 'src/task-executor.js', 'src/intent-processor.js'].includes(e.path)
    );
  }

  async explainSelf(question) {
    const filesToRead = this.selectRelevantFiles(question);

    const contents = [];
    for (const file of filesToRead) {
      try {
        const fullPath = this.resolveSafePath(file.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        contents.push({ path: file.path, description: file.description, content: content.slice(0, 6000) });
      } catch (err) {
        logger.warn(`Self-awareness: could not read ${file.path}: ${err.message}`);
      }
    }

    if (contents.length === 0) {
      return { success: false, error: 'Could not read any source files to answer this question' };
    }

    const codeBlock = contents
      .map((f) => `--- ${f.path} (${f.description}) ---\n${f.content}`)
      .join('\n\n');

    const prompt = `Below is some of your own source code. Answer the user's question about yourself clearly and concisely, in plain spoken language (not a code dump), like you're speaking from a TTS.

${codeBlock}

User's question: "${question}"

Answer:`;

    try {
      const response = await this.ai.chat({
        model: config.aiModel,
        messages: [
          { role: 'system', content: SYSTEM_IDENTITY },
          { role: 'user', content: prompt },
        ],
      });

      logger.info(`Self-inspection answered using: ${contents.map((f) => f.path).join(', ')}`);

      return {
        success: true,
        result: response.message.content.trim(),
        filesConsulted: contents.map((f) => f.path),
      };
    } catch (err) {
      logger.error(`Self-awareness explanation error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = SelfAwareness;