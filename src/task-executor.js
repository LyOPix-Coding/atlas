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

    // Connects to the local Docker daemon (unix socket on Linux/macOS,
    // named pipe on Windows — dockerode picks the right default).
    this.docker = new Docker();
    this.imageReady = false;
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

  // Semantic de-duplication: embeds the incoming request and compares it
  // against every existing learned task's embedding (backfilling any that
  // are missing one). Returns the best match if it clears the similarity
  // threshold, along with the query's own embedding so callers can reuse it
  // when registering a genuinely new task (avoids a second embed() call).
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

  async learnAndExecute(taskName, params, requestId) {
    try {
      const rawInput = params && params.input ? params.input : JSON.stringify(params);

      // Step -1: Check whether an existing learned task already covers this
      // request semantically, before spending a code-generation call on it.
      const { queryEmbedding, match } = await this.findSimilarTask(rawInput);

      if (match) {
        const reusedResult = await this.executeLearned(match.taskName, params);
        return {
          ...reusedResult,
          reused: true,
          similarity: match.similarity,
        };
      }

      // Step 0: If the classifier only gave us a generic label (e.g. "unknown"),
      // ask the model for a real descriptive name first.
      let resolvedName = taskName;
      if (!resolvedName || resolvedName === 'unknown') {
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

      // Step 3: Register the task (save to registry), including the
      // embedding we already computed during the dedup check above.
      await this.registry.registerTask(
        resolvedName,
        generatedCode,
        params,
        `Auto-generated task for: ${resolvedName}`,
        undefined,
        queryEmbedding
      );

      // Step 4: Execute in the Docker sandbox
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

  // Makes sure the sandbox image exists locally, building it from
  // docker/Dockerfile on first use if needed. Cached after the first
  // successful check so this doesn't add latency to every execution.
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
      // Fail closed: no image means no sandbox, and we never want to fall
      // back to running generated code directly on the host.
      throw new Error(
        `Could not prepare Docker sandbox image: ${err.message}. Is Docker running and accessible?`
      );
    }
  }

  // Runs generated/learned code inside a locked-down, disposable Docker
  // container: no network, read-only root filesystem, memory/CPU/PID caps,
  // non-root user, and a hard timeout. Code is passed directly as a `node -e`
  // argument — no host temp files, no volume mounts. Output is captured by
  // attaching to the container's stream before starting it, rather than
  // relying on container.logs() after the fact — logs()'s return shape has
  // proven inconsistent (Buffer, stream, or a plain object depending on
  // environment); attach() always returns a real Node.js stream.
  async executeInDocker(code, params, taskName) {
    await this.ensureSandboxImage();

    let funcNameMatch = code.match(/async\s+function\s+(\w+)/);
    if (!funcNameMatch) {
      funcNameMatch = code.match(/function\s+(\w+)/);
    }
    if (!funcNameMatch) {
      throw new Error('Could not extract function name from generated code');
    }
    const funcName = funcNameMatch[1];

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
        Tty: true, // merges stdout/stderr, no demux framing to parse
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: false,
        User: 'node',
        HostConfig: {
          Memory: config.sandboxMemoryMb * 1024 * 1024,
          MemorySwap: config.sandboxMemoryMb * 1024 * 1024, // == Memory → effectively disables swap
          NanoCpus: Math.round(config.sandboxCpuLimit * 1e9),
          PidsLimit: config.sandboxPidsLimit,
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          Tmpfs: { '/tmp': 'rw,size=16m,noexec' },
          AutoRemove: false, // removed manually, after reading output
        },
      });

      // Attach BEFORE starting, so we don't race the container and miss
      // early output. This always resolves to a real Node.js stream.
      const attachStream = await container.attach({ stream: true, stdout: true, stderr: true });
      attachStream.on('data', (chunk) => chunks.push(chunk));

      await container.start();

      timeoutHandle = setTimeout(() => {
        timedOut = true;
        container.kill().catch(() => {}); // best-effort; container may already be gone
      }, config.sandboxTimeoutMs);

      const waitResult = await container
        .wait()
        .catch((err) => ({ StatusCode: -1, _waitErr: err.message }));

      clearTimeout(timeoutHandle);

      // Brief grace period for the last chunk to flush after exit.
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