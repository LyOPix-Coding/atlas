const axios = require('axios');
const logger = require('./utils/logger');

const OLLAMA_URL = 'https://atlas-ollama.onrender.com/api/generate';

class CodeGenerator {
  async generateTaskName(input) {
    try {
      const prompt = `Given this request, generate a short task name (1-2 words, lowercase, no spaces). Respond ONLY with the name.

Request: "${input}"

Examples:
"reverse hello" → reverse_string
"count vowels in beautiful" → count_vowels
"add 5 and 3" → add_numbers
"check if palindrome" → check_palindrome

Task name:`;

      logger.debug(`Generating task name for: ${input}`);

      const response = await axios.post(OLLAMA_URL, {
        model: 'qwen2.5-coder',
        prompt: prompt,
        stream: false,
      });

      const name = response.data.response.toLowerCase().replace(/\s+/g, '_').slice(0, 50);
      logger.debug(`Generated task name: ${name}`);
      return name;
    } catch (err) {
      logger.error(`Task naming error: ${err.message}`);
      return 'unknown_task';
    }
  }

  async generateTaskDescription(input, code) {
    try {
      const prompt = `Describe what this function does in 1-2 sentences. Respond ONLY with the description.

Request: "${input}"

Code:
${code}

Description:`;

      logger.debug(`Generating task description`);

      const response = await axios.post(OLLAMA_URL, {
        model: 'qwen2.5-coder',
        prompt: prompt,
        stream: false,
      });

      const description = response.data.response.trim();
      logger.debug(`Generated description: ${description}`);
      return description.slice(0, 200);
    } catch (err) {
      logger.error(`Description generation error: ${err.message}`);
      return 'Auto-generated task';
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

      logger.debug(`Generating code for task: ${task}`);

      const response = await axios.post(OLLAMA_URL, {
        model: 'qwen2.5-coder',
        prompt: prompt,
        stream: false,
      });

      let cleaned = response.data.response
        .replace(/```javascript\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      logger.debug(`Generated code response: ${cleaned.slice(0, 300)}`);

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

  async generateTaskTags(input, task, code) {
    try {
      const prompt = `Generate an array of tags for this function:

Name of function: ${task}
What the function answers: ${input}
Code: ${code}

REQUIREMENTS:
- Only respond with the array (["", "", "", ""])
- Each tag is a keyword for the function`;

      logger.debug("Generating task tags");

      const response = await axios.post(OLLAMA_URL, {
        model: 'qwen2.5-coder',
        prompt: prompt,
        stream: false,
      });

      logger.debug("Finished Generating");

      const cleanedResponse = JSON.parse(response.data.response.match(/\[.*\]/s)?.[0] || '[]');

      return cleanedResponse;
    } catch (err) {
      logger.error("Task Tags Generation Error: " + err);
      return [];
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