const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '../../data');
const HISTORY_PATH = path.join(DATA_DIR, 'ai-call-history.json');
const USAGE_PATH = path.join(DATA_DIR, 'token-usage.json');
const MAX_HISTORY_ENTRIES = 200;

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

class AIUsage {
  constructor() {
    this.history = readJson(HISTORY_PATH, []);
    this.usage = readJson(USAGE_PATH, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }

  record({ purpose, requestId, model, promptTokens = 0, completionTokens = 0 }) {
    const totalTokens = promptTokens + completionTokens;

    const entry = {
      timestamp: new Date().toISOString(),
      purpose,
      requestId,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
    };

    this.history.push(entry);
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history = this.history.slice(-MAX_HISTORY_ENTRIES);
    }
    writeJson(HISTORY_PATH, this.history);

    this.usage.promptTokens += promptTokens;
    this.usage.completionTokens += completionTokens;
    this.usage.totalTokens += totalTokens;
    writeJson(USAGE_PATH, this.usage);

    logger.debug(`AI call [${requestId || 'n/a'}] ${purpose}: ${totalTokens} tokens`);
  }

  getHistory(limit = 20) {
    return this.history.slice(-limit).reverse();
  }

  getUsageSummary() {
    const budget = config.aiTokenBudget;
    const used = this.usage.totalTokens;

    return {
      promptTokens: this.usage.promptTokens,
      completionTokens: this.usage.completionTokens,
      used,
      budget: budget || null,
      remaining: budget ? Math.max(budget - used, 0) : null,
    };
  }
}

module.exports = new AIUsage();
