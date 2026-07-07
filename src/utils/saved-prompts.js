const { readJson, writeJson } = require('./json-store');

const PROMPTS_FILE = 'saved-prompts.json';
const MAX_ENTRIES = 200;

class SavedPrompts {
  constructor() {
    this.prompts = readJson(PROMPTS_FILE, []);
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
    writeJson(PROMPTS_FILE, this.prompts);
  }

  list(limit = 20) {
    return this.prompts.slice(-limit).reverse();
  }
}

module.exports = new SavedPrompts();
