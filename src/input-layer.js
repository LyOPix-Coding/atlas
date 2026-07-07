const logger = require('./utils/logger');
const { AIProvider } = require('./utils/ai-provider');
const { v4: uuidv4 } = require('uuid');
const config = require('./utils/config');
const { SYSTEM_IDENTITY } = require('./utils/identity');
const conversationStore = require('./utils/conversation-store');
const aiUsage = require('./utils/ai-usage');
const savedPrompts = require('./utils/saved-prompts');

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
        'Write and run a brand-new JavaScript function to do something none of the other tools (including previously learned tasks) already cover — custom calculations, string/array/object manipulation, algorithms, data transforms, etc. The function is generated on the fly, validated for safety (no require/fetch/file/network/eval), executed immediately in a sandbox, and saved to the task registry. Once saved, it automatically becomes its own directly-callable tool on future turns. Do NOT call generate_function to fix or improve a task that already exists — use edit_function for that instead; check whether a matching task tool already exists first.',
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
  {
    type: 'function',
    function: {
      name: 'edit_function',
      description:
        'View or edit the code, description, or example params of a previously generated/learned task — one already listed among your own tools. Call it with only "taskName" first to see its current code, description, and params. If the task\'s behavior is wrong, incomplete, or needs improvement, call it again with "taskName" plus "code" (and optionally "description"/"params") to apply a fix. The edited code is validated for safety and test-executed before being saved — if it fails, you\'ll get a real error back so you can revise and try again. Use this instead of generate_function whenever a matching task already exists; do not create a duplicate task for something you can just fix here.',
      parameters: {
        type: 'object',
        properties: {
          taskName: {
            type: 'string',
            description: 'The exact name of the existing task to view or edit (matches one of your other tool names).',
          },
          code: {
            type: 'string',
            description:
              'New full function code to replace the existing implementation. Must define a single top-level function taking a `params` object and returning { success: true, result: VALUE } or { success: false, error: MESSAGE }.',
          },
          description: {
            type: 'string',
            description: 'New description for the task.',
          },
          params: {
            type: 'object',
            description:
              'New example params for the task. Also used as the test input when code is being edited, unless the task\'s existing params make more sense as a test case.',
          },
        },
        required: ['taskName'],
      },
    },
  },
];

const STATIC_TOOLS = [...WEB_TOOLS, ...TASK_TOOLS, ...CODE_TOOLS];
const STATIC_TOOL_NAMES = new Set(STATIC_TOOLS.map((t) => t.function.name));
const TASK_TOOL_NAMES = new Set(TASK_TOOLS.map((t) => t.function.name));

const MAX_TOOL_ITERATIONS = 9999;

class InputLayer {
  constructor(app, intentProcessor, taskExecutor) {
    this.app = app;
    this.intentProcessor = intentProcessor;
    this.taskExecutor = taskExecutor;

    this.ai = new AIProvider({
      host: config.aiHost,
      headers: { Authorization: `Bearer ${config.aiApiKey}` },
    });

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
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

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

  jsonSchemaType(value) {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (value !== null && typeof value === 'object') return 'object';
    return 'string';
  }

  buildParamSchema(exampleParams) {
    const properties = {};
    const required = [];

    if (exampleParams && typeof exampleParams === 'object') {
      for (const [key, value] of Object.entries(exampleParams)) {
        properties[key] = {
          type: this.jsonSchemaType(value),
          description: `Value for "${key}"`,
        };
        required.push(key);
      }
    }

    return { type: 'object', properties, required };
  }

  buildDynamicTaskTools() {
    const taskNames = this.taskExecutor.registry.listTasks();

    return taskNames
      .filter((name) => !STATIC_TOOL_NAMES.has(name))
      .map((name) => {
        const task = this.taskExecutor.registry.getTask(name);
        return {
          type: 'function',
          function: {
            name,
            description:
              (task && task.description) || `Previously learned task: ${name}`,
            parameters: this.buildParamSchema(task && task.params),
          },
        };
      });
  }

  getToolSchemas() {
    return [...STATIC_TOOLS, ...this.buildDynamicTaskTools()];
  }

  async handleRequest(input, clientRequestId) {
    const requestId = clientRequestId || uuidv4();

    if (!input) {
      return { httpStatus: 400, body: { error: 'Missing "input" field' } };
    }

    logger.info(`Received request [${requestId}]: ${input}`);

    const isContinuation = !!conversationStore.get(requestId);
    savedPrompts.record(requestId, input, !isContinuation);

    const isSimpleQuestion = isContinuation
      ? true
      : await this.classifyInput(input, requestId);

    if (isSimpleQuestion) {
      logger.debug(`Routing to AI provider for question: ${input}`);
      const aiResult = await this.askAI(input, requestId);
      return {
        httpStatus: 200,
        body: { status: 'completed', requestId, type: 'question', result: aiResult },
      };
    }

    logger.debug(`Routing to command handling for: ${input}`);
    const commandOutcome = await this.handleCommand(input, requestId);

    if (commandOutcome.rejected) {
      logger.warn(`Request [${requestId}] rejected: ${commandOutcome.reason}`);
      return {
        httpStatus: 403,
        body: { status: 'rejected', reason: commandOutcome.reason, requestId },
      };
    }

    return {
      httpStatus: 200,
      body: { status: 'completed', requestId, type: 'command', result: commandOutcome.result },
    };
  }

  async handleCommand(input, requestId) {
    const safety = this.intentProcessor.checkSafety(input);
    if (!safety.approved) {
      return { rejected: true, reason: safety.reason };
    }

    const messages = [
      { role: 'system', content: SYSTEM_IDENTITY },
      {
        role: 'user',
        content: `${input}\n\n(This is a command — use the appropriate tool to actually perform it, then briefly confirm what you did.)`,
      },
    ];

    const { answer, toolResults, toolsUsed } = await this.runWithTools(messages, requestId);

    const taskCall = [...toolResults]
      .reverse()
      .find((t) => t.name !== 'web_search' && t.name !== 'web_fetch');

    if (taskCall) {
      return {
        rejected: false,
        result: { ...taskCall.result, assistantMessage: answer, toolsUsed },
      };
    }

    return {
      rejected: false,
      result: { success: false, message: answer, toolsUsed },
    };
  }

  async classifyInput(input, requestId) {
    const lowerInput = input.toLowerCase();

    const matchesQuestion = this.strongQuestionKeywords.some((kw) => lowerInput.includes(kw));
    const matchesCommand = this.strongCommandKeywords.some((kw) => lowerInput.includes(kw));

    if (matchesQuestion && !matchesCommand) {
      logger.debug(`Fast-path [${requestId}]: QUESTION (keyword match)`);
      return true;
    }

    if (matchesCommand && !matchesQuestion) {
      logger.debug(`Fast-path [${requestId}]: COMMAND (keyword match)`);
      return false;
    }

    logger.debug(`Ambiguous input [${requestId}], asking model to classify: ${input}`);
    return await this.classifyWithModel(input, requestId);
  }

  async callAI(params, purpose, requestId) {
    const response = await this.ai.chat(params);
    aiUsage.record({
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

      const response = await this.callAI(
        { model: config.aiModel, messages: [{ role: 'user', content: prompt }] },
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

  async askAI(question, requestId) {
    try {
      const existing = conversationStore.get(requestId);
      const isContinuation = !!existing;

      logger.debug(
        isContinuation
          ? `Continuing conversation [${requestId}] (${existing.length} prior messages) with: ${question}`
          : `Calling AI provider (${config.aiModel}) with: ${question}`
      );

      const messages = existing || [{ role: 'system', content: SYSTEM_IDENTITY }];

      messages.push({
        role: 'user',
        content: isContinuation
          ? question
          : question + ' (give me a short answer, like your speaking from a tts)',
      });

      const { answer, toolsUsed } = await this.runWithTools(messages, requestId);

      messages.push({ role: 'assistant', content: answer });
      conversationStore.save(requestId, messages);

      logger.debug(`AI response: ${answer.slice(0, 100)}...`);
      return { answer, requestId, toolsUsed };
    } catch (err) {
      logger.error(`AI provider error: ${err.message}`);
      return {
        answer: `I encountered an error: ${err.message}. The AI provider isn't wired up yet — see src/utils/ai-provider.js.`,
      };
    }
  }

  async runWithTools(messages, requestId) {
    const toolResults = [];
    const toolsUsed = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const tools = this.getToolSchemas();

      const response = await this.callAI(
        { model: config.aiModel, messages, tools },
        'chat',
        requestId
      );

      const toolCalls = response.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        return { answer: response.message.content, toolResults, toolsUsed };
      }

      messages.push(response.message);

      for (const call of toolCalls) {
        toolsUsed.push(call.function.name);
        const result = await this.executeTool(call, requestId);
        toolResults.push({ name: call.function.name, args: call.function.arguments || {}, result });
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: JSON.stringify(result),
        });
      }
    }

    logger.warn(`Tool loop [${requestId}] hit max iterations (${MAX_TOOL_ITERATIONS}), forcing final answer`);
    const finalResponse = await this.callAI(
      { model: config.aiModel, messages },
      'chat-forced-final',
      requestId
    );
    return { answer: finalResponse.message.content, toolResults, toolsUsed };
  }

  async executeTool(call, requestId) {
    const name = call.function.name;
    const args = call.function.arguments || {};

    try {
      if (name === 'web_search') {
        logger.info(`Tool call [${requestId}]: web_search("${args.query}")`);
        const results = await this.ai.webSearch({ query: args.query });
        return (results.results || []).slice(0, 5).map((r) => ({
          title: r.title,
          url: r.url,
          content: (r.content || '').slice(0, 1000),
        }));
      }

      if (name === 'web_fetch') {
        logger.info(`Tool call [${requestId}]: web_fetch("${args.url}")`);
        const result = await this.ai.webFetch({ url: args.url });
        return {
          title: result.title,
          content: (result.content || '').slice(0, 3000),
        };
      }

      if (name === 'generate_function') {
        logger.info(`Tool call [${requestId}]: generate_function("${args.description}")`);

        if (!args.description) {
          return { success: false, error: 'Missing "description" for generate_function' };
        }

        const taskParams = { input: args.description, ...(args.params || {}) };
        const result = await this.taskExecutor.execute('unknown', taskParams, requestId);

        return {
          success: result.success,
          taskName: result.taskName,
          result: result.result,
          error: result.error,
          generatedCode: result.generatedCode,
          reused: result.reused || false,
          similarity: result.similarity,
          repaired: result.repaired || false,
          repairAttempts: result.repairAttempts,
        };
      }

      if (name === 'edit_function') {
        logger.info(`Tool call [${requestId}]: edit_function("${args.taskName}")`);

        if (!args.taskName) {
          return { success: false, error: 'Missing "taskName" for edit_function' };
        }

        return await this.taskExecutor.editGeneratedTask(args.taskName, {
          code: args.code,
          description: args.description,
          params: args.params,
        });
      }

      if (TASK_TOOL_NAMES.has(name) || this.taskExecutor.registry.hasTask(name)) {
        logger.info(`Tool call [${requestId}]: ${name}(${JSON.stringify(args)})`);
        return await this.taskExecutor.execute(name, args, requestId);
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