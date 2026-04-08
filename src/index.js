const express = require('express');
const dotenv = require('dotenv');
const InputLayer = require('./input-layer');
const IntentProcessor = require('./intent-processor');
const TaskExecutor = require('./task-executor');
const logger = require('./utils/logger');

dotenv.config();

const app = express();
app.use(express.json());

// Initialize layers
const intentProcessor = new IntentProcessor();
const taskExecutor = new TaskExecutor();
const inputLayer = new InputLayer(app, intentProcessor, taskExecutor);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`✓ AI Core running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await taskExecutor.cleanup();
  process.exit(0);
});