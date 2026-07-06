const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const InputLayer = require('./input-layer');
const IntentProcessor = require('./intent-processor');
const TaskExecutor = require('./task-executor');
const logger = require('./utils/logger');
const { runMenu } = require('./cli');

const app = express();
app.use(express.json());

const intentProcessor = new IntentProcessor();
const taskExecutor = new TaskExecutor();
const inputLayer = new InputLayer(app, intentProcessor, taskExecutor);

runMenu(inputLayer).then(() => process.exit(0));

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await taskExecutor.cleanup();
  process.exit(0);
});