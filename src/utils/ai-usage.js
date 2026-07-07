const logger = require('./logger');
const config = require('./config');
const { readJson, writeJson } = require('./json-store');

const HISTORY_FILE = 'ai-call-history.json';
const USAGE_FILE = 'token-usage.json';
const MAX_HISTORY_ENTRIES = 200;

class AIUsage {
  constructor() {
    this.history = readJson(HISTORY_FILE, []);
    this.usage = readJson(USAGE_FILE, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }

  record({ purpose, requestId, model, promptTokens = 0, completionTokens = 0 }) {
    const totalTokens = promptTokens + completionTokens;

    this.history.push({
      timestamp: new Date().toISOString(),
      purpose,
      requestId,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
    });
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history = this.history.slice(-MAX_HISTORY_ENTRIES);
    }
    writeJson(HISTORY_FILE, this.history);

    this.usage.promptTokens += promptTokens;
    this.usage.completionTokens += completionTokens;
    this.usage.totalTokens += totalTokens;
    writeJson(USAGE_FILE, this.usage);

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
