const { Ollama } = require('ollama');
const logger = require('./utils/logger');
const config = require('./utils/config');

class CodeGenerator {
  constructor() {
    this.ollama = new Ollama({
      host: config.ollamaHost,
      headers: { Authorization: `Bearer ${config.ollamaApiKey}` },
    });
  }

  async generateTaskName(input) {
    try {
      const prompt = `Given this user request: "${input}"

Generate a short, descriptive task name in snake_case (lowercase, underscores only, no spaces, no punctuation). Examples: reverse_string, count_vowels, sum_array.

Respond with ONLY the task name, nothing else:`;

      logger.debug(`Generating task name for input: ${input}`);

      const response = await this.ollama.chat({
        model: config.ollamaModel,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.message.content.trim();

      // Sanitize: lowercase, replace non-alphanumeric with underscores, collapse repeats
      let name = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50);

      if (!name) {
        name = `task_${Date.now()}`;
      }

      logger.info(`Generated task name: ${name}`);
      return name;
    } catch (err) {
      logger.error(`Task naming error: ${err.message}`);
      return `task_${Date.now()}`;
    }
  }

  async generateTaskCode(input, task) {
    try {
      const prompt = `Generate a JavaScript function that does this: "${input}"

Requirements:
- Function name: execute_${task}
- Takes parameter: params (object)
- Returns: { success: true, result: VALUE } or { success: false, error: MESSAGE }
- Use only JavaScript, math, strings, arrays, objects
- NO require, NO fetch, NO HTTP, NO files, NO spawning
- Keep it simple and direct

Write ONLY the function code, nothing else:`;

      logger.debug(`Generating code for task: ${task} using ${config.ollamaModel}`);

      const response = await this.ollama.chat({
        model: config.ollamaModel,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.message.content.trim();

      logger.debug(`Generated code response: ${raw.slice(0, 300)}`);

      let cleaned = raw
        .replace(/```javascript\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      let functionMatch = cleaned.match(/(?:async\s+)?function\s+execute_\w+\s*\(params\)\s*\{[\s\S]*?\n\}/);

      if (!functionMatch) {
        functionMatch = cleaned.match(/(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
      }

      if (!functionMatch) {
        logger.warn(`Failed to extract function. Cleaned response:\n${cleaned}`);
        throw new Error('Failed to extract valid function from generated code');
      }

      const extracted = functionMatch[0];
      logger.info(`Successfully extracted function: ${extracted.slice(0, 150)}`);
      return extracted;
    } catch (err) {
      logger.error(`Code generation error: ${err.message}`);
      throw err;
    }
  }

  async validateCode(code) {
    const dangerousPatterns = [
      { pattern: /require\s*\(\s*['"][^'"]*['"]\s*\)/i, name: 'require() calls' },
      { pattern: /child_process|net\.connect|dgram|https\.request|http\.request/i, name: 'network/process access' },
      { pattern: /fetch\s*\(/i, name: 'fetch() calls' },
      { pattern: /XMLHttpRequest/i, name: 'XMLHttpRequest' },
      { pattern: /fs\.(rm|unlink|rmdir|remove|writeFile)/i, name: 'dangerous file operations' },
      { pattern: /process\.(exit|kill)/i, name: 'process control' },
      { pattern: /eval\s*\(/i, name: 'eval()' },
      { pattern: /new Function/i, name: 'Function constructor' },
    ];

    for (const { pattern, name } of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          valid: false,
          reason: `Dangerous operation detected: ${name}`,
        };
      }
    }

    return { valid: true };
  }
}

module.exports = CodeGenerator;