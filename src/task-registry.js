const fs = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');

class TaskRegistry {
  constructor() {
    this.registryPath = path.join(__dirname, '../tasks/generated-tasks.json');
    this.tasks = {};
    this.loadRegistry();
  }

  async loadRegistry() {
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      this.tasks = JSON.parse(data);
      logger.info(`Loaded ${Object.keys(this.tasks).length} learned tasks`);
    } catch (err) {
      logger.debug('No existing task registry, starting fresh');
      this.tasks = {};
    }
  }

  async saveRegistry() {
    try {
      await fs.writeFile(this.registryPath, JSON.stringify(this.tasks, null, 2), 'utf-8');
      logger.info('Task registry saved');
    } catch (err) {
      logger.error(`Failed to save registry: ${err.message}`);
    }
  }

  getTask(taskName) {
    return this.tasks[taskName];
  }

  // `embedding` is optional — a vector (array of numbers) representing the
  // semantic content of the original request, used for de-duplication. Tasks
  // registered before this feature existed simply won't have one until
  // updateTaskEmbedding() backfills it.
  async registerTask(taskName, code, params, description, tags, embedding) {
    this.tasks[taskName] = {
      name: taskName,
      code: code,
      params: params,
      description: description,
      tags: tags,
      embedding: embedding || undefined,
      createdAt: new Date().toISOString(),
    };
    await this.saveRegistry();
    logger.info(`Registered new task: ${taskName}`);
  }

  // Lazily backfills an embedding onto an existing task (e.g. one created
  // before semantic de-dup existed, or where the first embed() call failed).
  async updateTaskEmbedding(taskName, embedding) {
    if (!this.tasks[taskName] || !embedding) return;
    this.tasks[taskName].embedding = embedding;
    await this.saveRegistry();
    logger.debug(`Backfilled embedding for task: ${taskName}`);
  }

  hasTask(taskName) {
    return taskName in this.tasks;
  }

  listTasks() {
    return Object.keys(this.tasks);
  }

  async clearAll() {
    this.tasks = {};
    await this.saveRegistry();
    logger.info('Cleared all created (learned) programs');
  }
}

module.exports = TaskRegistry;