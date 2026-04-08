const logger = require('./utils/logger');

class InputLayer {
  constructor(app, intentProcessor, taskExecutor) {
    this.app = app;
    this.intentProcessor = intentProcessor;
    this.taskExecutor = taskExecutor;
    this.setupRoutes();
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Main input endpoint
    this.app.post('/request', async (req, res) => {
      try {
        const { input, requestId } = req.body;

        if (!input) {
          return res.status(400).json({ error: 'Missing "input" field' });
        }

        logger.info(`Received request [${requestId}]: ${input}`);

        // Pass to Intent Processing Layer
        const intentResult = await this.intentProcessor.process(input, requestId);

        if (!intentResult.approved) {
          logger.warn(`Request [${requestId}] rejected: ${intentResult.reason}`);
          return res.status(403).json({
            status: 'rejected',
            reason: intentResult.reason,
            requestId,
          });
        }

        // If approved, execute task
        const taskResult = await this.taskExecutor.execute(
          intentResult.task,
          intentResult.params,
          requestId
        );

        res.json({
          status: 'completed',
          requestId,
          result: taskResult,
        });
      } catch (err) {
        logger.error(`Error in /request: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
}

module.exports = InputLayer;