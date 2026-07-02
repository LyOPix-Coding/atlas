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

// Initialize layers
const intentProcessor = new IntentProcessor();
const taskExecutor = new TaskExecutor();
const inputLayer = new InputLayer(app, intentProcessor, taskExecutor);

// The interactive menu is the entry point now — the HTTP server (app.listen)
// is no longer started automatically. Routes are still wired up via
// inputLayer.setupRoutes() above if you want to call app.listen() yourself.
runMenu(inputLayer).then(() => process.exit(0));

// Graceful shutdown (relevant if the HTTP server is ever started manually)
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await taskExecutor.cleanup();
  process.exit(0);
});