const { AIProvider } = require('./utils/ai-provider');
const logger = require('./utils/logger');
const config = require('./utils/config');

function extractFunctionCode(raw, preferredPattern) {
  const cleaned = raw
    .replace(/```javascript\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const match =
    (preferredPattern && cleaned.match(preferredPattern)) ||
    cleaned.match(/(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);

  if (!match) {
    logger.warn(`Failed to extract function. Cleaned response:\n${cleaned}`);
    throw new Error('Failed to extract valid function from generated code');
  }

  return match[0];
}

class CodeGenerator {
  constructor() {
    this.ai = new AIProvider({
      host: config.aiHost,
      headers: { Authorization: `Bearer ${config.aiApiKey}` },
    });
  }

  async chatForCode(prompt) {
    const response = await this.ai.chat({
      model: config.aiModel,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.message.content.trim();
  }

  async generateTaskName(input) {
    try {
      const prompt = `Given this user request: "${input}"

Generate a short, descriptive task name in snake_case (lowercase, underscores only, no spaces, no punctuation). Examples: reverse_string, count_vowels, sum_array.

Respond with ONLY the task name, nothing else:`;

      logger.debug(`Generating task name for input: ${input}`);

      const raw = await this.chatForCode(prompt);

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

      logger.debug(`Generating code for task: ${task} using ${config.aiModel}`);

      const raw = await this.chatForCode(prompt);
      logger.debug(`Generated code response: ${raw.slice(0, 300)}`);

      const extracted = extractFunctionCode(raw, /(?:async\s+)?function\s+execute_\w+\s*\(params\)\s*\{[\s\S]*?\n\}/);
      logger.info(`Successfully extracted function: ${extracted.slice(0, 150)}`);
      return extracted;
    } catch (err) {
      logger.error(`Code generation error: ${err.message}`);
      throw err;
    }
  }

  async repairCode(originalCode, errorMessage, description) {
    try {
      const prompt = `The following JavaScript function failed when it was executed:

${originalCode}

Error it produced:
"${errorMessage}"
${description ? `\nWhat this function is supposed to do: "${description}"` : ''}

Fix the function so it runs correctly and actually handles the case that caused this error.

Requirements:
- Keep the same function name and signature — it must accept a single \`params\` object
- Returns: { success: true, result: VALUE } or { success: false, error: MESSAGE }
- Use only JavaScript, math, strings, arrays, objects
- NO require, NO fetch, NO HTTP, NO files, NO spawning, NO eval

Write ONLY the corrected function code, nothing else:`;

      logger.debug(`Requesting self-repair using ${config.aiModel}`);

      const raw = await this.chatForCode(prompt);
      logger.debug(`Repair response: ${raw.slice(0, 300)}`);

      const extracted = extractFunctionCode(raw, /(?:async\s+)?function\s+\w+\s*\(params\)\s*\{[\s\S]*?\n\}/);
      logger.info(`Successfully extracted repaired function: ${extracted.slice(0, 150)}`);
      return extracted;
    } catch (err) {
      logger.error(`Code repair error: ${err.message}`);
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
