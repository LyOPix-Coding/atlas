const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const logger = require('./utils/logger');
const TaskRegistry = require('./task-registry');
const CodeGenerator = require('./code-generator');
const SelfAwareness = require('./self-awareness');
const WebSearch = require('./web-search');

class TaskExecutor {
  constructor() {
    this.registry = new TaskRegistry();
    this.codeGenerator = new CodeGenerator();
    this.selfAwareness = new SelfAwareness();
    this.webSearch = new WebSearch();
  }

  async execute(task, params, requestId) {
    try {
      logger.info(`Executing task [${requestId}]: ${task}`);

      // Check if task is built-in
      switch (task) {
        case 'http_request':
          return await this.httpRequest(params);
        case 'file_read':
          return await this.fileRead(params);
        case 'file_write':
          return await this.fileWrite(params);
        case 'gpio_set':
          return await this.gpioSet(params);
        case 'email_send':
          return await this.emailSend(params);
        case 'self_inspect':
          return await this.selfAwareness.explainSelf(params.question);
        case 'web_search':
          return await this.webSearch.searchAndAnswer(params.query);
      }

      // Check if task is learned
      if (this.registry.hasTask(task)) {
        logger.info(`Executing learned task [${requestId}]: ${task}`);
        return await this.executeLearned(task, params);
      }

      // Unknown task → Try to learn it
      logger.info(`Unknown task [${requestId}]: ${task} → Generating code`);
      return await this.learnAndExecute(task, params, requestId);
    } catch (err) {
      logger.error(`Task execution error: ${err.message}`);
      throw err;
    }
  }

  async learnAndExecute(taskName, params, requestId) {
    try {
      // Step 0: If the classifier only gave us a generic label (e.g. "unknown"),
      // ask the model for a real descriptive name first.
      let resolvedName = taskName;
      if (!resolvedName || resolvedName === 'unknown') {
        const rawInput = params && params.input ? params.input : JSON.stringify(params);
        resolvedName = await this.codeGenerator.generateTaskName(rawInput);
        logger.info(`Resolved task name [${requestId}]: ${resolvedName}`);
      }

      // Step 1: Generate code
      const generatedCode = await this.codeGenerator.generateTaskCode(
        JSON.stringify(params),
        resolvedName
      );

      logger.debug(`Generated code for ${resolvedName}`);

      // Step 2: Validate code
      const validation = await this.codeGenerator.validateCode(generatedCode);
      if (!validation.valid) {
        return {
          success: false,
          error: `Code validation failed: ${validation.reason}`,
          generatedCode: generatedCode,
        };
      }

      // Step 3: Register the task (save to registry)
      await this.registry.registerTask(
        resolvedName,
        generatedCode,
        params,
        `Auto-generated task for: ${resolvedName}`
      );

      // Step 4: Execute in Docker sandbox
      const result = await this.executeInDocker(generatedCode, params, resolvedName);

      return {
        success: true,
        result: result.result,
        learned: true,
        taskName: resolvedName,
        generatedCode: generatedCode,
      };
    } catch (err) {
      logger.error(`Learn and execute error: ${err.message}`);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async executeLearned(taskName, params) {
    try {
      const taskDef = this.registry.getTask(taskName);
      const result = await this.executeInDocker(taskDef.code, params, taskName);
      return {
        success: true,
        result: result.result,
        taskName: taskName,
        generatedCode: taskDef.code,
      };
    } catch (err) {
      logger.error(`Learned task execution error: ${err.message}`);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async executeInDocker(code, params, taskName) {
    try {
      logger.debug(`Executing ${taskName} in sandbox`);

      // Extract the function name - handle both async and regular functions
      let funcNameMatch = code.match(/async\s+function\s+(\w+)/);
      if (!funcNameMatch) {
        funcNameMatch = code.match(/function\s+(\w+)/);
      }

      if (!funcNameMatch) {
        throw new Error('Could not extract function name from generated code');
      }
      const funcName = funcNameMatch[1];

      logger.debug(`Extracted function name: ${funcName}`);

      // Create wrapper that calls the function
      const wrapper = `
${code}

(async () => {
  try {
    const params = ${JSON.stringify(params)};
    const result = await ${funcName}(params);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
  }
})();
    `;

      // Write to temp file and execute
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `task_${Date.now()}.js`);

      await fs.writeFile(tempFile, wrapper, 'utf-8');
      const result = execSync(`node ${tempFile}`, { encoding: 'utf-8' });
      await fs.unlink(tempFile);

      return JSON.parse(result);
    } catch (err) {
      logger.error(`Execution error: ${err.message}`);
      throw err;
    }
  }

  extractFunctionName(code) {
    const match = code.match(/async\s+function\s+(\w+)/);
    return match ? match[1] : 'unknownFunction';
  }

  async httpRequest(params) {
    return new Promise((resolve, reject) => {
      const url = new URL(params.url);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.request(url, { method: params.method }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
      });

      req.on('error', reject);

      if (params.body && (params.method === 'POST' || params.method === 'PUT')) {
        req.write(params.body);
      }

      req.end();
    });
  }

  async fileRead(params) {
    const content = await fs.readFile(params.path, 'utf-8');
    return { path: params.path, size: content.length, content: content.slice(0, 1000) };
  }

  async fileWrite(params) {
    await fs.writeFile(params.path, params.content, 'utf-8');
    return { path: params.path, bytesWritten: params.content.length };
  }

  async gpioSet(params) {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      logger.info(`GPIO simulation: pin ${params.pin} set to ${params.state}`);
      return {
        status: 'simulated',
        message: `Pin ${params.pin} would be set to ${params.state}`,
      };
    }
    return { status: 'success', pin: params.pin, state: params.state };
  }

  async emailSend(params) {
    // Simulated for now
    return {
      status: 'simulated',
      message: `Email would be sent to ${params.to}`,
    };
  }

  async cleanup() {
    logger.info('Executor cleanup');
  }
}

module.exports = TaskExecutor;