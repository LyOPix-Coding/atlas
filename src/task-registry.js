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

  async registerTask(taskName, code, params, description, tags) {
    this.tasks[taskName] = {
      name: taskName,
      code: code,
      params: params,
      description: description,
      tags: tags,
      createdAt: new Date().toISOString(),
    };
    await this.saveRegistry();
    logger.info(`Registered new task: ${taskName}`);
  }

  hasTask(taskName) {
    return taskName in this.tasks;
  }

  listTasks() {
    return Object.keys(this.tasks);
  }
}

module.exports = TaskRegistry;