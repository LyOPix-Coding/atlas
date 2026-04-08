const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const logger = require('./utils/logger');

class TaskExecutor {
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
        default:
          throw new Error(`Unknown task: ${task}`);
      }
    } catch (err) {
      logger.error(`Task execution error: ${err.message}`);
      throw err;
    }
  }

  async httpRequest(params) {
    return new Promise((resolve, reject) => {
      const url = new URL(params.url);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.request(url, { method: params.method }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
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

  async cleanup() {
    logger.info('Executor cleanup (no Docker containers to kill yet)');
  }
}

module.exports = TaskExecutor;