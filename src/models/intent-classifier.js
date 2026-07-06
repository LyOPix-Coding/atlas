class IntentClassifier {
  classify(input) {
    const lower = input.toLowerCase();

    if (lower.includes('fetch') || lower.includes('http') || lower.includes('get')) {
      return {
        task: 'http_request',
        params: {
          url: this.extractUrl(input),
          method: this.extractMethod(input) || 'GET',
        },
      };
    }

    if (lower.includes('read') || lower.includes('file')) {
      return {
        task: 'file_read',
        params: {
          path: this.extractPath(input),
        },
      };
    }

    if (lower.includes('write') || lower.includes('save')) {
      return {
        task: 'file_write',
        params: {
          path: this.extractPath(input),
          content: this.extractContent(input),
        },
      };
    }

    return {
      task: 'unknown',
      params: {},
    };
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
    const match = input.match(/['"`]([^'"`]+)['"`]/) || input.match(/\s(\/[^\s]+)/);
    return match ? match[1] : '/tmp/file.txt';
  }

  extractContent(input) {
    const match = input.match(/content[:\s]+['"`]([^'"`]+)['"`]/i);
    return match ? match[1] : '';
  }
}

module.exports = IntentClassifier;