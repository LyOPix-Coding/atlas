const logger = require('./utils/logger');
const { Ollama } = require('ollama');
const { v4: uuidv4 } = require('uuid');
const config = require('./utils/config');
const { SYSTEM_IDENTITY } = require('./utils/identity');
const conversationStore = require('./utils/conversation-store');
const ollamaUsage = require('./utils/ollama-usage');
const savedPrompts = require('./utils/saved-prompts');

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

const TASK_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make an HTTP request (GET, POST, PUT, or DELETE) to a URL and return the response status and body.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to request, including protocol (https://...)' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default GET)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: 'Read the contents of a file from the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: 'Write content to a file on the local filesystem, creating or overwriting it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gpio_set',
      description: 'Set a GPIO pin (Raspberry Pi) to HIGH or LOW.',
      parameters: {
        type: 'object',
        properties: {
          pin: { type: 'number', description: 'GPIO pin number' },
          state: { type: 'string', enum: ['HIGH', 'LOW'], description: 'Desired pin state' },
        },
        required: ['pin', 'state'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'email_send',
      description: 'Send an email to a recipient with a subject and body (currently simulated, not actually delivered).',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' },
        },
        required: ['to'],
      },
    },
  },
];

const CODE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'generate_function',
      description:
        'Write and run a brand-new JavaScript function to do something none of the other tools cover — custom calculations, string/array/object manipulation, algorithms, data transforms, etc. The function is generated on the fly, validated for safety (no require/fetch/file/network/eval), executed immediately in a sandbox, and saved to the task registry so it can be reused later. Use this whenever the user asks you to write, create, build, or run code/a function/a script to do something specific that the other tools do not already handle.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'Clear, specific description of what the function should do, e.g. "reverse a string" or "check if a number is prime".',
          },
          params: {
            type: 'object',
            description:
              'Optional input values to pass to the generated function when it runs, as key-value pairs, e.g. { "str": "hello world" }.',
          },
        },
        required: ['description'],
      },
    },
  },
];

const ALL_TOOLS = [...WEB_TOOLS, ...TASK_TOOLS, ...CODE_TOOLS];

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
        const { httpStatus, body } = await this.handleRequest(input, clientRequestId);
        res.status(httpStatus).json(body);
      } catch (err) {
        logger.error(`Error in /request: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  // Core routing logic, shared by the HTTP route and the CLI menu.
  async handleRequest(input, clientRequestId) {
    const requestId = clientRequestId || uuidv4(); // Auto-generate if not provided

// TODO:

    if (!input) {
      return { httpStatus: 400, body: { error: 'Missing "input" field' } };
    }

    logger.info(`Received request [${requestId}]: ${input}`);

    // An existing requestId with saved history means the user is continuing
    // a prior chat — skip reclassification and stay on the question path.
    const isContinuation = !!conversationStore.get(requestId);
    savedPrompts.record(requestId, input, !isContinuation);

    const isSimpleQuestion = isContinuation
      ? true
      : await this.classifyInput(input, requestId);

    if (isSimpleQuestion) {
      logger.debug(`Routing to Ollama for question: ${input}`);
      const ollamaResult = await this.askOllama(input, requestId);
      return {
        httpStatus: 200,
        body: { status: 'completed', requestId, type: 'question', result: ollamaResult },
      };
    }

    // Otherwise, it's a command → Intent Processing
    logger.debug(`Routing to Intent Processing for command: ${input}`);
    const intentResult = await this.intentProcessor.process(input, requestId);

    if (!intentResult.approved) {
      logger.warn(`Request [${requestId}] rejected: ${intentResult.reason}`);
      return {
        httpStatus: 403,
        body: { status: 'rejected', reason: intentResult.reason, requestId },
      };
    }

    // If approved, execute task
    const taskResult = await this.taskExecutor.execute(
      intentResult.task,
      intentResult.params,
      requestId
    );

    return {
      httpStatus: 200,
      body: { status: 'completed', requestId, type: 'command', result: taskResult },
    };
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

  // Wraps this.ollama.chat() so every call gets logged to the Ollama call
  // history and its token usage counted toward the tracked total.
  async callOllama(params, purpose, requestId) {
    const response = await this.ollama.chat(params);
    ollamaUsage.record({
      purpose,
      requestId,
      model: params.model,
      promptTokens: response.prompt_eval_count || 0,
      completionTokens: response.eval_count || 0,
    });
    return response;
  }

  async classifyWithModel(input, requestId) {
    try {
      const prompt = `Classify the following user input as exactly one of two categories:

QUESTION - the user is asking for information, an explanation, a fact, or a definition. Nothing needs to be done or executed, only answered.
COMMAND - the user wants an action performed: math, file read/write, HTTP requests, GPIO control, sending email, or any other task-like instruction (including things phrased conversationally, like "reverse this string" or "can you multiply 4 and 5").

User input: "${input}"

Respond with exactly one word, either QUESTION or COMMAND. Nothing else.`;

      const response = await this.callOllama(
        { model: config.ollamaModel, messages: [{ role: 'user', content: prompt }] },
        'classify',
        requestId
      );

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
      const existing = conversationStore.get(requestId);
      const isContinuation = !!existing;

      logger.debug(
        isContinuation
          ? `Continuing conversation [${requestId}] (${existing.length} prior messages) with: ${question}`
          : `Calling Ollama Cloud (${config.ollamaModel}) with: ${question}`
      );

      const messages = existing || [{ role: 'system', content: SYSTEM_IDENTITY }];

      messages.push({
        role: 'user',
        content: isContinuation
          ? question
          : question + ' (give me a short answer, like your speaking from a tts)',
      });

      const { answer, toolsUsed } = await this.chatWithTools(messages, requestId);

      messages.push({ role: 'assistant', content: answer });
      conversationStore.save(requestId, messages);

      logger.debug(`Ollama response: ${answer.slice(0, 100)}...`);
      return { answer, requestId, toolsUsed };
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
    const toolsUsed = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.callOllama(
        { model: config.ollamaModel, messages, tools: ALL_TOOLS },   // was WEB_TOOLS
        'chat',
        requestId
      );

      const toolCalls = response.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        return { answer: response.message.content, toolsUsed };
      }

      // Model wants to use a tool — record its request, then feed back results.
      messages.push(response.message);

      for (const call of toolCalls) {
        toolsUsed.push(call.function.name);
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
    const finalResponse = await this.callOllama(
      { model: config.ollamaModel, messages },
      'chat-forced-final',
      requestId
    );
    return { answer: finalResponse.message.content, toolsUsed };
  }

  async executeTool(call, requestId) {
    const name = call.function.name;
    const args = call.function.arguments || {};

    const BUILTIN_TASK_TOOLS = ['http_request', 'file_read', 'file_write', 'gpio_set', 'email_send'];

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

      if (BUILTIN_TASK_TOOLS.includes(name)) {
        logger.info(`Tool call [${requestId}]: ${name}(${JSON.stringify(args)})`);
        return await this.taskExecutor.execute(name, args, requestId);
      }

      if (name === 'generate_function') {
        logger.info(`Tool call [${requestId}]: generate_function("${args.description}")`);

        if (!args.description) {
          return { success: false, error: 'Missing "description" for generate_function' };
        }

        // Reuses the existing learn-and-execute pipeline (code gen -> validate ->
        // register in task registry -> sandboxed execution), same path the
        // command router falls back to for unrecognized tasks.
        const taskParams = { input: args.description, ...(args.params || {}) };
        const result = await this.taskExecutor.execute('unknown', taskParams, requestId);

        return {
          success: result.success,
          taskName: result.taskName,
          result: result.result,
          error: result.error,
          generatedCode: result.generatedCode,
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