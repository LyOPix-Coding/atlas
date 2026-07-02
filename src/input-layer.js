const logger = require('./utils/logger');
const { Ollama } = require('ollama');
const { v4: uuidv4 } = require('uuid');
const config = require('./utils/config');
const { SYSTEM_IDENTITY } = require('./utils/identity');

// Tool schemas the model can choose to call during askOllama's chat loop.
const WEB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current information, facts, or anything you are not confident about. Use this whenever a question involves recent events, specific facts, or anything that could have changed since you were trained.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch and read the full content of a specific URL — either one the user provided directly, or one found via web_search that needs more detail than the search snippet gives.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
        },
        required: ['url'],
      },
    },
  },
];

const MAX_TOOL_ITERATIONS = 10;

class InputLayer {
  constructor(app, intentProcessor, taskExecutor) {
    this.app = app;
    this.intentProcessor = intentProcessor;
    this.taskExecutor = taskExecutor;

    this.ollama = new Ollama({
      host: config.ollamaHost,
      headers: { Authorization: `Bearer ${config.ollamaApiKey}` },
    });

    // Strong signals that skip the model call entirely (fast path).
    // Keep these narrow and unambiguous — anything fuzzy should fall through to the classifier.
    this.strongQuestionKeywords = [
      'what is',
      'what\'s',
      'who is',
      'when is',
      'where is',
      'why is',
      'why does',
      'explain',
      'definition of',
      '?',
    ];

    this.strongCommandKeywords = [
      'multiply',
      'divide',
      'fetch http',
      'send a post',
      'send a get',
      'read file',
      'write to file',
      'save to file',
      'set pin',
      'gpio',
      'send email',
      'send an email',
    ];

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
        const isSimpleQuestion = await this.classifyInput(input, requestId);

        if (isSimpleQuestion) {
          logger.debug(`Routing to Ollama for question: ${input}`);
          const ollamaResult = await this.askOllama(input, requestId);
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

  // Routing decision: fast-path on unambiguous keyword matches, otherwise ask the model.
  async classifyInput(input, requestId) {
    const lowerInput = input.toLowerCase();

    const matchesQuestion = this.strongQuestionKeywords.some((kw) => lowerInput.includes(kw));
    const matchesCommand = this.strongCommandKeywords.some((kw) => lowerInput.includes(kw));

    // Unambiguous question, no conflicting command signal — skip the model call.
    if (matchesQuestion && !matchesCommand) {
      logger.debug(`Fast-path [${requestId}]: QUESTION (keyword match)`);
      return true;
    }

    // Unambiguous command, no conflicting question signal — skip the model call.
    if (matchesCommand && !matchesQuestion) {
      logger.debug(`Fast-path [${requestId}]: COMMAND (keyword match)`);
      return false;
    }

    // Ambiguous (both matched, or neither matched) — defer to the model.
    logger.debug(`Ambiguous input [${requestId}], asking model to classify: ${input}`);
    return await this.classifyWithModel(input, requestId);
  }

  async classifyWithModel(input, requestId) {
    try {
      const prompt = `Classify the following user input as exactly one of two categories:

QUESTION - the user is asking for information, an explanation, a fact, or a definition. Nothing needs to be done or executed, only answered.
COMMAND - the user wants an action performed: math, file read/write, HTTP requests, GPIO control, sending email, or any other task-like instruction (including things phrased conversationally, like "reverse this string" or "can you multiply 4 and 5").

User input: "${input}"

Respond with exactly one word, either QUESTION or COMMAND. Nothing else.`;

      const response = await this.ollama.chat({
        model: config.ollamaModel,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.message.content.trim().toUpperCase();

      if (raw.includes('QUESTION')) {
        logger.debug(`Classifier [${requestId}]: QUESTION`);
        return true;
      }
      if (raw.includes('COMMAND')) {
        logger.debug(`Classifier [${requestId}]: COMMAND`);
        return false;
      }

      logger.warn(`Classifier [${requestId}] returned unexpected output: "${raw}" — falling back to keyword heuristic`);
      return this.isSimpleQuestionKeywordFallback(input);
    } catch (err) {
      logger.error(`Classifier error [${requestId}]: ${err.message} — falling back to keyword heuristic`);
      return this.isSimpleQuestionKeywordFallback(input);
    }
  }

  // Broad keyword check, used only if the model call itself fails (bad key, network error, etc).
  isSimpleQuestionKeywordFallback(input) {
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

  async askOllama(question, requestId) {
    try {
      logger.debug(`Calling Ollama Cloud (${config.ollamaModel}) with: ${question}`);

      const messages = [
        { role: 'system', content: SYSTEM_IDENTITY },
        { role: 'user', content: question + ' (give me a short answer, like your speaking from a tts)' },
      ];

      const answer = await this.chatWithTools(messages, requestId);

      logger.debug(`Ollama response: ${answer.slice(0, 100)}...`);
      return { answer };
    } catch (err) {
      logger.error(`Ollama error: ${err.message}`);
      return {
        answer: `I encountered an error: ${err.message}. Make sure OLLAMA_API_KEY is set correctly.`,
      };
    }
  }

  // Runs the chat/tool-call loop: the model can call web_search / web_fetch
  // as many times as it needs (up to MAX_TOOL_ITERATIONS) before giving a final answer.
  async chatWithTools(messages, requestId) {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.ollama.chat({
        model: config.ollamaModel,
        messages,
        tools: WEB_TOOLS,
      });

      const toolCalls = response.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        return response.message.content;
      }

      // Model wants to use a tool — record its request, then feed back results.
      messages.push(response.message);

      for (const call of toolCalls) {
        const result = await this.executeTool(call, requestId);
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: JSON.stringify(result),
        });
      }
    }

    // Hit the iteration cap while the model still wanted to call tools —
    // force one last answer without giving it the option to call more.
    logger.warn(`Tool loop [${requestId}] hit max iterations (${MAX_TOOL_ITERATIONS}), forcing final answer`);
    const finalResponse = await this.ollama.chat({
      model: config.ollamaModel,
      messages,
    });
    return finalResponse.message.content;
  }

  async executeTool(call, requestId) {
    const name = call.function.name;
    const args = call.function.arguments || {};

    try {
      if (name === 'web_search') {
        logger.info(`Tool call [${requestId}]: web_search("${args.query}")`);
        const results = await this.ollama.webSearch({ query: args.query });
        return (results.results || []).slice(0, 5).map((r) => ({
          title: r.title,
          url: r.url,
          content: (r.content || '').slice(0, 1000),
        }));
      }

      if (name === 'web_fetch') {
        logger.info(`Tool call [${requestId}]: web_fetch("${args.url}")`);
        const result = await this.ollama.webFetch({ url: args.url });
        return {
          title: result.title,
          content: (result.content || '').slice(0, 3000),
        };
      }

      logger.warn(`Tool call [${requestId}]: unknown tool "${name}"`);
      return { error: `Unknown tool: ${name}` };
    } catch (err) {
      logger.error(`Tool execution error [${requestId}] (${name}): ${err.message}`);
      return { error: err.message };
    }
  }
}

module.exports = InputLayer;