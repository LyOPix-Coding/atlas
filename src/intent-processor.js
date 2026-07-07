const logger = require('./utils/logger');

const BLOCKED_KEYWORDS = [
  { words: ['delete all', 'delete_all', 'rm -rf'], reason: 'Destructive operation blocked' },
  { words: ['format', 'wipe', 'destroy'], reason: 'Destructive operation blocked' },
  { words: ['hack', 'crack', 'exploit'], reason: 'Malicious operation blocked' },
  { words: ['spam', 'phish', 'malware'], reason: 'Malicious operation blocked' },
];

class IntentProcessor {
  checkSafety(input) {
    if (!input || typeof input !== 'string') {
      return { approved: false, reason: 'Invalid input' };
    }

    logger.debug(`Safety check: ${input}`);

    const lower = input.toLowerCase();
    const blocked = BLOCKED_KEYWORDS.find(({ words }) => words.some((w) => lower.includes(w)));

    if (blocked) {
      return { approved: false, reason: blocked.reason };
    }

    return { approved: true, reason: 'Operation allowed' };
  }
}

module.exports = IntentProcessor;
