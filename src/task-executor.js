const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const Docker = require('dockerode');
const logger = require('./utils/logger');
const config = require('./utils/config');
const TaskRegistry = require('./task-registry');
const CodeGenerator = require('./code-generator');
const SelfAwareness = require('./self-awareness');
const WebSearch = require('./web-search');
const embeddingsService = require('./utils/embeddings');

class TaskExecutor {
  constructor() {
    this.registry = new TaskRegistry();
    this.codeGenerator = new CodeGenerator();
    this.selfAwareness = new SelfAwareness();
    this.webSearch = new WebSearch();

    this.docker = new Docker();
    this.imageReady = false;
  }

  async execute(task, params, requestId) {
    try {
      logger.info(`Executing task [${requestId}]: ${task}`);

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

      if (this.registry.hasTask(task)) {
        logger.info(`Executing learned task [${requestId}]: ${task}`);
        return await this.executeLearned(task, params);
      }

      logger.info(`Unknown task [${requestId}]: ${task} → Generating code`);
      return await this.learnAndExecute(task, params, requestId);
    } catch (err) {
      logger.error(`Task execution error: ${err.message}`);
      throw err;
    }
  }

  async findSimilarTask(description) {
    const queryEmbedding = await embeddingsService.embed(description);

    if (!queryEmbedding) {
      return { queryEmbedding: null, match: null };
    }

    let bestName = null;
    let bestScore = 0;

    for (const name of this.registry.listTasks()) {
      const task = this.registry.getTask(name);
      if (!task) continue;

      let taskEmbedding = task.embedding;

      if (!taskEmbedding) {
        const textToEmbed = (task.params && task.params.input) || task.description || name;
        taskEmbedding = await embeddingsService.embed(textToEmbed);
        if (taskEmbedding && typeof this.registry.updateTaskEmbedding === 'function') {
          await this.registry.updateTaskEmbedding(name, taskEmbedding);
        }
      }

      if (!taskEmbedding) continue;

      const score = embeddingsService.cosineSimilarity(queryEmbedding, taskEmbedding);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }

    if (bestName && bestScore >= config.taskSimilarityThreshold) {
      logger.info(
        `Found similar existing task "${bestName}" (similarity ${bestScore.toFixed(3)}) — reusing instead of generating`
      );
      return { queryEmbedding, match: { taskName: bestName, similarity: bestScore } };
    }

    return { queryEmbedding, match: null };
  }

  async executeWithRepair(code, params, taskName, description) {
    let currentCode = code;
    let lastError = null;
    const maxAttempts = config.maxRepairAttempts;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.executeInDocker(currentCode, params, taskName);
        return {
          result,
          finalCode: currentCode,
          repaired: attempt > 0,
          repairAttempts: attempt,
        };
      } catch (err) {
        lastError = err;

        if (attempt === maxAttempts) {
          break;
        }

        logger.warn(
          `Task "${taskName}" failed (attempt ${attempt + 1}/${maxAttempts + 1}): ${err.message} — attempting self-repair`
        );

        let repairedCode;
        try {
          repairedCode = await this.codeGenerator.repairCode(currentCode, err.message, description);
        } catch (repairErr) {
          logger.error(`Repair generation failed for "${taskName}": ${repairErr.message}`);
          break;
        }

        const validation = await this.codeGenerator.validateCode(repairedCode);
        if (!validation.valid) {
          logger.warn(`Repaired code for "${taskName}" failed validation: ${validation.reason}`);
          break;
        }

        currentCode = repairedCode;
      }
    }

    throw new Error(
      `Task "${taskName}" failed after ${maxAttempts} self-repair attempt(s): ${lastError ? lastError.message : 'unknown error'}`
    );
  }

  async learnAndExecute(taskName, params, requestId) {
    try {
      const rawInput = params && params.input ? params.input : JSON.stringify(params);

      const { queryEmbedding, match } = await this.findSimilarTask(rawInput);

      if (match) {
        const reusedResult = await this.executeLearned(match.taskName, params);
        return {
          ...reusedResult,
          reused: true,
          similarity: match.similarity,
        };
      }

      let resolvedName = taskName;
      if (!resolvedName || resolvedName === 'unknown') {
        resolvedName = await this.codeGenerator.generateTaskName(rawInput);
        logger.info(`Resolved task name [${requestId}]: ${resolvedName}`);
      }

      const generatedCode = await this.codeGenerator.generateTaskCode(
        JSON.stringify(params),
        resolvedName
      );

      logger.debug(`Generated code for ${resolvedName}`);

      const validation = await this.codeGenerator.validateCode(generatedCode);
      if (!validation.valid) {
        return {
          success: false,
          error: `Code validation failed: ${validation.reason}`,
          generatedCode: generatedCode,
        };
      }

      await this.registry.registerTask(
        resolvedName,
        generatedCode,
        params,
        `Auto-generated task for: ${resolvedName}`,
        undefined,
        queryEmbedding
      );

      const { result, finalCode, repaired, repairAttempts } = await this.executeWithRepair(
        generatedCode,
        params,
        resolvedName,
        rawInput
      );

      if (repaired && finalCode !== generatedCode) {
        await this.registry.updateTaskCode(resolvedName, finalCode);
      }

      return {
        success: true,
        result: result.result,
        learned: true,
        taskName: resolvedName,
        generatedCode: finalCode,
        repaired,
        repairAttempts,
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
      const description = (taskDef.params && taskDef.params.input) || taskDef.description || taskName;

      const { result, finalCode, repaired, repairAttempts } = await this.executeWithRepair(
        taskDef.code,
        params,
        taskName,
        description
      );

      if (repaired && finalCode !== taskDef.code) {
        await this.registry.updateTaskCode(taskName, finalCode);
      }

      return {
        success: true,
        result: result.result,
        taskName: taskName,
        generatedCode: finalCode,
        repaired,
        repairAttempts,
      };
    } catch (err) {
      logger.error(`Learned task execution error: ${err.message}`);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async editGeneratedTask(taskName, updates = {}) {
    if (!this.registry.hasTask(taskName)) {
      return { success: false, error: `No such task: "${taskName}".` };
    }

    const task = this.registry.getTask(taskName);
    const { code: newCode, description: newDescription, params: newParams } = updates;

    if (newCode === undefined && newDescription === undefined && newParams === undefined) {
      return {
        success: true,
        viewOnly: true,
        taskName,
        code: task.code,
        description: task.description,
        params: task.params,
      };
    }

    if (newCode !== undefined) {
      const validation = await this.codeGenerator.validateCode(newCode);
      if (!validation.valid) {
        return { success: false, error: `Edited code failed validation: ${validation.reason}` };
      }

      const funcName = this.extractFunctionName(newCode);
      if (!funcName) {
        return {
          success: false,
          error: 'Could not find a top-level function in the edited code (expected `function name(params) { ... }`).',
        };
      }

      const testParams = newParams !== undefined ? newParams : task.params;
      try {
        var testResult = await this.executeInDocker(newCode, testParams, taskName);
      } catch (err) {
        return {
          success: false,
          error: `Edited code failed a test run with params ${JSON.stringify(testParams)}: ${err.message}`,
        };
      }
    }

    const updatedTask = await this.registry.editTask(taskName, {
      ...(newCode !== undefined ? { code: newCode } : {}),
      ...(newDescription !== undefined ? { description: newDescription } : {}),
      ...(newParams !== undefined ? { params: newParams } : {}),
    });

    return {
      success: true,
      taskName,
      description: updatedTask.description,
      params: updatedTask.params,
      testResult: typeof testResult !== 'undefined' ? testResult.result : undefined,
    };
  }

  async ensureSandboxImage() {
    if (this.imageReady) return;

    try {
      const images = await this.docker.listImages({
        filters: { reference: [config.dockerImage] },
      });

      if (images.length > 0) {
        this.imageReady = true;
        return;
      }

      logger.info(`Docker image "${config.dockerImage}" not found — building from docker/Dockerfile...`);
      const dockerDir = path.join(__dirname, '../docker');
      const stream = await this.docker.buildImage(
        { context: dockerDir, src: ['Dockerfile'] },
        { t: config.dockerImage }
      );

      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, res) => (err ? reject(err) : resolve(res)));
      });

      logger.info(`Docker image "${config.dockerImage}" built successfully`);
      this.imageReady = true;
    } catch (err) {
      throw new Error(
        `Could not prepare Docker sandbox image: ${err.message}. Is Docker running and accessible?`
      );
    }
  }

  async executeInDocker(code, params, taskName) {
    await this.ensureSandboxImage();

    const funcName = this.extractFunctionName(code);
    if (!funcName) {
      throw new Error('Could not extract function name from generated code');
    }

    logger.debug(`Executing ${taskName} in Docker sandbox (function: ${funcName})`);

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

    let container;
    let timedOut = false;
    let timeoutHandle;
    const chunks = [];

    try {
      container = await this.docker.createContainer({
        Image: config.dockerImage,
        Cmd: ['-e', wrapper],
        Tty: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: false,
        User: 'node',
        HostConfig: {
          Memory: config.sandboxMemoryMb * 1024 * 1024,
          MemorySwap: config.sandboxMemoryMb * 1024 * 1024,
          NanoCpus: Math.round(config.sandboxCpuLimit * 1e9),
          PidsLimit: config.sandboxPidsLimit,
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          Tmpfs: { '/tmp': 'rw,size=16m,noexec' },
          AutoRemove: false,
        },
      });

      const attachStream = await container.attach({ stream: true, stdout: true, stderr: true });
      attachStream.on('data', (chunk) => chunks.push(chunk));

      await container.start();

      timeoutHandle = setTimeout(() => {
        timedOut = true;
        container.kill().catch(() => {});
      }, config.sandboxTimeoutMs);

      const waitResult = await container
        .wait()
        .catch((err) => ({ StatusCode: -1, _waitErr: err.message }));

      clearTimeout(timeoutHandle);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const output = Buffer.concat(chunks).toString('utf-8');

      if (timedOut) {
        throw new Error(`Sandbox execution timed out after ${config.sandboxTimeoutMs}ms`);
      }

      if (waitResult.StatusCode !== 0) {
        throw new Error(
          `Sandbox exited with non-zero status (${waitResult.StatusCode}): ${output.slice(0, 500)}`
        );
      }

      const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
      const lastLine = lines[lines.length - 1];

      if (!lastLine) {
        throw new Error('Sandbox produced no output');
      }

      return JSON.parse(lastLine);
    } catch (err) {
      logger.error(`Sandbox execution error: ${err.message}`);
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
      if (container) {
        try {
          await container.remove({ force: true });
        } catch (removeErr) {
          logger.warn(`Failed to remove sandbox container: ${removeErr.message}`);
        }
      }
    }
  }

  extractFunctionName(code) {
    let match = code.match(/async\s+function\s+(\w+)/);
    if (!match) {
      match = code.match(/function\s+(\w+)/);
    }
    return match ? match[1] : null;
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

  resolveSandboxedPath(userPath) {
    if (!userPath || typeof userPath !== 'string') {
      throw new Error('Missing or invalid file path');
    }

    const resolved = path.resolve(config.fileSandboxRoot, userPath);
    const relative = path.relative(config.fileSandboxRoot, resolved);

    const escapesRoot = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

    if (escapesRoot) {
      throw new Error(`Path "${userPath}" resolves outside the allowed file sandbox`);
    }

    return resolved;
  }

  async fileRead(params) {
    const safePath = this.resolveSandboxedPath(params.path);
    const content = await fs.readFile(safePath, 'utf-8');
    return { path: params.path, size: content.length, content: content.slice(0, 1000) };
  }

  async fileWrite(params) {
    const safePath = this.resolveSandboxedPath(params.path);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, params.content, 'utf-8');
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