const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const PROMPTS_PATH = path.join(DATA_DIR, 'saved-prompts.json');
const MAX_ENTRIES = 200;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

class SavedPrompts {
  constructor() {
    this.prompts = readJson(PROMPTS_PATH, []);
  }

  record(requestId, input, isNew) {
    this.prompts.push({
      requestId,
      input,
      isNew,
      timestamp: new Date().toISOString(),
    });

    if (this.prompts.length > MAX_ENTRIES) {
      this.prompts = this.prompts.slice(-MAX_ENTRIES);
    }
    writeJson(PROMPTS_PATH, this.prompts);
  }

  list(limit = 20) {
    return this.prompts.slice(-limit).reverse();
  }
}

module.exports = new SavedPrompts();