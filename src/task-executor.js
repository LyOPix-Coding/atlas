const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const logger = require('./utils/logger');
const TaskRegistry = require('./task-registry');
const CodeGenerator = require('./code-generator');

class TaskExecutor {
  constructor() {
    this.registry = new TaskRegistry();
    this.codeGenerator = new CodeGenerator();
  }

  async execute(task, params, requestId, lt) {
    try {
      logger.info(`Executing task [${requestId}]: ${task}`);

      // if (lt) {
      //   return await this.executeLearned(task, params);
      // }

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
      // Step 1: Generate Name
      const generatedName = await this.codeGenerator.generateTaskName(
        JSON.stringify(params)
      );

      // Step 2: Generate Code
      const generatedCode = await this.codeGenerator.generateTaskCode(
        JSON.stringify(params),
        generatedName
      );

      // Step 3: Generate Description
      const generatedDescription = await this.codeGenerator.generateTaskDescription(
        JSON.stringify(params),
        generatedCode
      )

      // Step 4: Generate Tags
      const generatedTags = await this.codeGenerator.generateTaskTags(
        JSON.stringify(params),
        generatedName,
        generatedCode
      );

      logger.debug(`Generated code, name, tags, and description for ${taskName}`);

      // Step 3: Validate code
      const validation = await this.codeGenerator.validateCode(generatedCode);
      if (!validation.valid) {
        return {
          success: false,
          error: `Code validation failed: ${validation.reason}`,
          generatedCode: generatedCode,
        };
      }

      // Step 4: Register the task (save to registry)
      await this.registry.registerTask(
        generatedName,
        generatedCode,
        params,
        generatedDescription,
        generatedTags
      );

      // Step 5: Execute in Docker sandbox
      const result = await this.executeInDocker(generatedCode, params, taskName);

      return {
        success: true,
        result: result.result,
        learned: true,
        taskName: generatedCode,
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
      logger.debug(`Executing ${taskName} in Docker sandbox`);

      // Extract function name
      let funcNameMatch = code.match(/(?:async\s+)?function\s+(\w+)/);
      if (!funcNameMatch) {
        throw new Error('Could not extract function name from generated code');
      }
      const funcName = funcNameMatch[1];

      // Create wrapper script
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

      // Write to temp file
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `task_${Date.now()}.js`);

      await fs.writeFile(tempFile, wrapper, 'utf-8');
      logger.debug(`Created temp file: ${tempFile}`);

      // Run in Docker container
      const { spawn } = require('child_process');

      return new Promise((resolve, reject) => {
        const docker = spawn('docker', [
          'run',
          '--rm',
          '-v', `${tempFile}:/task/script.js`,
          'atlas-container:latest',
          '/task/script.js'
        ]);

        let output = '';
        let errorOutput = '';

        docker.stdout.on('data', (data) => {
          output += data.toString();
          logger.debug(`Docker stdout: ${data.toString()}`);
        });

        docker.stderr.on('data', (data) => {
          errorOutput += data.toString();
          logger.debug(`Docker stderr: ${data.toString()}`);
        });

        docker.on('close', async (code) => {
          try {
            await fs.unlink(tempFile);
            logger.debug(`Cleaned up temp file: ${tempFile}`);

            if (code !== 0) {
              logger.error(`Docker exited with code ${code}: ${errorOutput}`);
              reject(new Error(`Docker execution failed: ${errorOutput}`));
              return;
            }

            const result = JSON.parse(output.trim());
            logger.debug(`Docker result: ${JSON.stringify(result)}`);
            resolve(result);
          } catch (err) {
            logger.error(`Error processing Docker result: ${err.message}`);
            reject(err);
          }
        });

        docker.on('error', (err) => {
          logger.error(`Docker spawn error: ${err.message}`);
          reject(err);
        });
      });
    } catch (err) {
      logger.error(`Docker execution error: ${err.message}`);
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