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

  async registerTask(taskName, code, params, description, embedding) {
    this.tasks[taskName] = {
      name: taskName,
      code: code,
      params: params,
      description: description,
      embedding: embedding || undefined,
      createdAt: new Date().toISOString(),
    };
    await this.saveRegistry();
    logger.info(`Registered new task: ${taskName}`);
  }

  async updateTaskEmbedding(taskName, embedding) {
    if (!this.tasks[taskName] || !embedding) return;
    this.tasks[taskName].embedding = embedding;
    await this.saveRegistry();
    logger.debug(`Backfilled embedding for task: ${taskName}`);
  }

  async updateTaskCode(taskName, code) {
    if (!this.tasks[taskName] || !code) return;
    this.tasks[taskName].code = code;
    this.tasks[taskName].repairedAt = new Date().toISOString();
    await this.saveRegistry();
    logger.info(`Updated code for task "${taskName}" after self-repair`);
  }

  async editTask(taskName, updates) {
    const task = this.tasks[taskName];
    if (!task) {
      throw new Error(`No such task: ${taskName}`);
    }

    const newInput = updates.params && updates.params.input;
    const inputChanged =
      newInput !== undefined && newInput !== (task.params && task.params.input);
    const descriptionChanged =
      updates.description !== undefined && updates.description !== task.description;

    if (updates.code !== undefined) task.code = updates.code;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.params !== undefined) task.params = updates.params;

    if (inputChanged || descriptionChanged) {
      task.embedding = undefined;
    }

    task.editedAt = new Date().toISOString();

    await this.saveRegistry();
    logger.info(`Manually edited task: ${taskName}`);
    return task;
  }

  async deleteTask(taskName) {
    if (!(taskName in this.tasks)) return false;
    delete this.tasks[taskName];
    await this.saveRegistry();
    logger.info(`Deleted task: ${taskName}`);
    return true;
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