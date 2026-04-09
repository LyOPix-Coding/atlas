const logger = require('./utils/logger');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class InputLayer {
  constructor(app, intentProcessor, taskExecutor) {
    this.app = app;
    this.intentProcessor = intentProcessor;
    this.taskExecutor = taskExecutor;
    this.ollamaUrl = 'http://localhost:11434/api/generate';
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
        const { input, requestId: clientRequestId } = req.body;
        const requestId = clientRequestId || uuidv4(); // Auto-generate if not provided

        if (!input) {
          return res.status(400).json({ error: 'Missing "input" field' });
        }

        logger.info(`Received request [${requestId}]: ${input}`);

        // Check if it's a simple question or a command
        const isSimpleQuestion = this.isSimpleQuestion(input);

        if (isSimpleQuestion) {
          logger.debug(`Routing to Ollama for question: ${input}`);
          const ollamaResult = await this.askOllama(input);
          return res.json({
            status: 'completed',
            requestId,
            type: 'question',
            result: ollamaResult,
          });
        }

        // Otherwise, it's a command → Intent Processing
        logger.debug(`Routing to Intent Processing for command: ${input}`);
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
          type: 'command',
          result: taskResult,
        });
      } catch (err) {
        logger.error(`Error in /request: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  isSimpleQuestion(input) {
    const lowerInput = input.toLowerCase();
    const questionKeywords = [
      'what is',
      'what\'s',
      'who is',
      'when is',
      'where is',
      'how do',
      'why',
      'explain',
      'tell me',
      'weather',
      'capital',
      'population',
      'definition',
      '?',
      'math',
      'calculate',
    ];
    return questionKeywords.some((kw) => lowerInput.includes(kw));
  }

  async askOllama(question) {
    try {
      logger.debug(`Calling Ollama with: ${question}`);
      
      const { execSync } = require('child_process');
      const command = `ollama run orca-mini ${JSON.stringify(question)}`;
      const answer = execSync(command, { encoding: 'utf-8' });
      
      logger.debug(`Ollama response: ${answer.slice(0, 100)}...`);
      return { answer };
    } catch (err) {
      logger.error(`Ollama error: ${err.message}`);
      return {
        answer: `I encountered an error: ${err.message}. Make sure Ollama is installed.`,
      };
    }
  }
}

module.exports = InputLayer;