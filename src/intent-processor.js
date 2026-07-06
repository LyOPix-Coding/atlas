const logger = require('./utils/logger');

class IntentProcessor {
  checkSafety(input) {
    if (!input || typeof input !== 'string') {
      return { approved: false, reason: 'Invalid input' };
    }

    logger.debug(`Safety check: ${input}`);

    const lower = input.toLowerCase();

    if (lower.includes('delete all') || lower.includes('delete_all') || lower.includes('rm -rf')) {
      return { approved: false, reason: 'Destructive operation blocked' };
    }

    if (lower.includes('format') || lower.includes('wipe') || lower.includes('destroy')) {
      return { approved: false, reason: 'Destructive operation blocked' };
    }

    if (lower.includes('hack') || lower.includes('crack') || lower.includes('exploit')) {
      return { approved: false, reason: 'Malicious operation blocked' };
    }

    if (lower.includes('spam') || lower.includes('phish') || lower.includes('malware')) {
      return { approved: false, reason: 'Malicious operation blocked' };
    }

    return { approved: true, reason: 'Operation allowed' };
  }
}

module.exports = IntentProcessor;