const logger = require('./utils/logger');

class IntentProcessor {
  async process(input, requestId) {
    try {
      logger.debug(`Processing intent: ${input}`);

      if (!input || typeof input !== 'string') {
        return {
          approved: false,
          reason: 'Invalid input',
        };
      }

      // Classify the intent using pattern matching
      const classification = this.classifyIntent(input);

      logger.debug(`Classification: ${JSON.stringify(classification)}`);

      // Validate: Is the task legal/safe?
      if (!this.isLegal(classification.task)) {
        return {
          approved: false,
          reason: `Task "${classification.task}" is not permitted`,
        };
      }

      // Validate: Is it feasible?
      if (!this.isFeasible(classification.task, classification.params)) {
        return {
          approved: false,
          reason: `Task "${classification.task}" is not feasible with given parameters`,
        };
      }

      // Evaluate safety
      const safetyCheck = this.evaluateSafety(input, classification.task);
      if (!safetyCheck.approved) {
        return {
          approved: false,
          reason: safetyCheck.reason,
        };
      }

      return {
        approved: true,
        task: classification.task,
        params: classification.params,
      };
    } catch (err) {
      logger.error(`Intent processing error: ${err.message}`);
      return {
        approved: false,
        reason: 'Intent processing failed',
      };
    }
  }

  classifyIntent(input) {
    if (!input || typeof input !== 'string') {
      return { task: 'unknown', params: {} };
    }

    const lower = input.toLowerCase();

    // Math operations - CHECK THIS FIRST
    if (lower.includes('multiply') || lower.includes('times') || lower.includes('divide') || lower.includes('add') || lower.includes('subtract') || lower.includes('plus') || lower.includes('minus')) {
      return {
        task: this.extractMathOperation(input),
        params: this.extractMathParams(input),
      };
    }

    // Self-awareness — questions about ATLAS's own code/behavior. Must be checked
    // before file_read/file_write, since phrases like "read your own code" would
    // otherwise match the file-operation keywords below.
    if (this.isSelfInspectionQuery(lower)) {
      return {
        task: 'self_inspect',
        params: { question: input },
      };
    }

    // Web search — must come before file_read, since "look up" or "search for"
    // could otherwise get swept up by loose keyword matches elsewhere.
    if (this.isWebSearchQuery(lower)) {
      return {
        task: 'web_search',
        params: { query: this.extractSearchQuery(input) },
      };
    }

    // HTTP requests
    if (lower.includes('fetch') || lower.includes('http') || lower.includes('get') || lower.includes('post')) {
      return {
        task: 'http_request',
        params: {
          url: this.extractUrl(input),
          method: this.extractMethod(input) || 'GET',
        },
      };
    }

    // File read
    if (lower.includes('read') && (lower.includes('file') || lower.includes('.txt') || lower.includes('.'))) {
      return {
        task: 'file_read',
        params: {
          path: this.extractPath(input),
        },
      };
    }

    // File write
    if ((lower.includes('write') || lower.includes('save') || lower.includes('create')) && lower.includes('file')) {
      return {
        task: 'file_write',
        params: {
          path: this.extractPath(input),
          content: this.extractContent(input),
        },
      };
    }

    // GPIO control
    if (lower.includes('set') && (lower.includes('pin') || lower.includes('gpio'))) {
      return {
        task: 'gpio_set',
        params: {
          pin: this.extractPin(input),
          state: this.extractState(input),
        },
      };
    }

    // Email
    if (lower.includes('email') || (lower.includes('send') && lower.includes('mail'))) {
      return {
        task: 'email_send',
        params: {
          to: this.extractEmail(input),
          subject: this.extractSubject(input),
          body: this.extractBody(input),
        },
      };
    }

    return {
      task: 'unknown',
      params: { input: input },
    };
  }

  isSelfInspectionQuery(lower) {
    const selfPhrases = [
      'your own code',
      'your code',
      'your source',
      'yourself',
      'how do you work',
      'how you work',
      'what do you do',
      'explain your',
      'understand your',
      'analyze your',
      'introspect',
      'your architecture',
      'how are you built',
      'what does your',
    ];
    return selfPhrases.some((p) => lower.includes(p));
  }

  isWebSearchQuery(lower) {
    const searchPhrases = [
      'search the web',
      'search online',
      'search for',
      'look up',
      'google ',
      'find information about',
      'find out about',
    ];
    return searchPhrases.some((p) => lower.includes(p));
  }

  extractSearchQuery(input) {
    const stripPhrases = [
      'search the web for',
      'search online for',
      'search the web',
      'search online',
      'search for',
      'look up',
      'google',
      'find information about',
      'find out about',
    ];
    let query = input;
    const lower = input.toLowerCase();
    for (const phrase of stripPhrases) {
      const idx = lower.indexOf(phrase);
      if (idx !== -1) {
        query = input.slice(idx + phrase.length).trim();
        break;
      }
    }
    return query || input;
  }

  extractMathOperation(input) {
    const lower = input.toLowerCase();
    if (lower.includes('multiply') || lower.includes('times')) return 'multiply';
    if (lower.includes('divide')) return 'divide';
    if (lower.includes('add') || lower.includes('plus')) return 'add';
    if (lower.includes('subtract') || lower.includes('minus')) return 'subtract';
    return 'math';
  }

  extractMathParams(input) {
    const numbers = input.match(/\d+/g);
    if (numbers && numbers.length >= 2) {
      return {
        a: parseInt(numbers[0]),
        b: parseInt(numbers[1]),
      };
    }
    return { a: 0, b: 0 };
  }

  extractUrl(input) {
    const match = input.match(/(https?:\/\/[^\s]+)/);
    return match ? match[1] : 'http://example.com';
  }

  extractMethod(input) {
    if (input.toLowerCase().includes('post')) return 'POST';
    if (input.toLowerCase().includes('put')) return 'PUT';
    if (input.toLowerCase().includes('delete')) return 'DELETE';
    return 'GET';
  }

  extractPath(input) {
    const match = input.match(/['"`]([^'"`]+)['"`]/) || input.match(/\b([a-zA-Z0-9._/\\-]+\.[a-zA-Z0-9]+)\b/);
    return match ? match[1] : '/tmp/file.txt';
  }

  extractContent(input) {
    const match = input.match(/(?:content|saying|with|message|text)[:\s]+['"`]?([^'"`\n]+)['"`]?/i) || input.match(/:\s+(.+)$/);
    return match ? match[1].trim() : 'Default content';
  }

  extractPin(input) {
    const match = input.match(/pin\s+(\d+)/i);
    return match ? parseInt(match[1]) : 0;
  }

  extractState(input) {
    if (input.toLowerCase().includes('high') || input.toLowerCase().includes('on')) return 'HIGH';
    if (input.toLowerCase().includes('low') || input.toLowerCase().includes('off')) return 'LOW';
    return 'HIGH';
  }

  extractEmail(input) {
    const match = input.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1] : 'user@example.com';
  }

  extractSubject(input) {
    const match = input.match(/(?:subject)[:\s]+['"`]?([^'"`]+)['"`]?/i);
    return match ? match[1] : 'No Subject';
  }

  extractBody(input) {
    const match = input.match(/(?:body|message|content)[:\s]+['"`]?([^'"`]+)['"`]?/i);
    return match ? match[1] : '';
  }

  evaluateSafety(input, task) {
    if (!input || typeof input !== 'string') {
      return { approved: false, reason: 'Invalid input' };
    }

    const lower = input.toLowerCase();

    // Reject dangerous operations
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

    // Allow unknown tasks (they'll be validated at execution time)
    return { approved: true, reason: 'Operation allowed' };
  }

  isLegal(task) {
    const blacklist = ['delete_all', 'format_drive', 'rm_rf', 'fork_bomb'];
    // Allow unknown tasks to proceed to execution layer
    return !blacklist.includes(task.toLowerCase());
  }

  isFeasible(task, params) {
    if (task === 'http_request' && (!params.url || !params.method)) {
      return false;
    }
    if (task === 'file_read' && !params.path) {
      return false;
    }
    if (task === 'file_write' && (!params.path || !params.content)) {
      return false;
    }
    if (task === 'gpio_set' && (params.pin === undefined || !params.state)) {
      return false;
    }
    return true;
  }
}

module.exports = IntentProcessor;