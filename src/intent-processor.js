const logger = require('./utils/logger');

// Task classification and parameter extraction are now handled by the model
// itself via tool-calling (see input-layer.js: TASK_TOOLS, buildDynamicTaskTools,
// runWithTools) — the model picks the right tool and supplies structured
// arguments directly, instead of this layer trying to regex-parse them.
//
// This layer's remaining job is the safety gate: block obviously destructive
// or malicious input before it ever reaches the model or a tool call.
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