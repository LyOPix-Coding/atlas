const { execSync } = require('child_process');
const logger = require('./utils/logger');

class CodeGenerator {
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

      logger.debug(`Generating code for task: ${task}`);

      const command = `ollama run dolphin-mixtral ${JSON.stringify(prompt)}`;
      const response = execSync(command, { encoding: 'utf-8' }).trim();

      logger.debug(`Generated code response: ${response.slice(0, 300)}`);

      let cleaned = response
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