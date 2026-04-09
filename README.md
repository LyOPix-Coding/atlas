# AI Core

A self-learning, multi-layer AI system that accepts natural language input, intelligently processes requests, and executes tasks in isolated sandboxes. The system can teach itself new capabilities by generating, validating, and executing custom code.

## Architecture

The AI Core consists of three main layers:

### 1. Input Layer
- Accepts requests via HTTP POST endpoints
- Distinguishes between simple questions (answered by Ollama LLM) and commands (processed by intent layer)
- Auto-generates unique `requestId` for tracking
- Returns both status and results

### 2. Intent Processing Layer
- Classifies user input into task types (math, file operations, GPIO, custom tasks)
- Validates requests for legality and feasibility
- Uses pattern matching and AI to understand natural language
- Implements safety gates to prevent harmful operations

### 3. Task Execution Layer
- Executes built-in tasks (HTTP requests, file read/write, GPIO control)
- **Self-programs**: When encountering unknown tasks, generates JavaScript code automatically
- Validates generated code for dangerous patterns
- Saves learned tasks to persistent registry for future use
- Executes tasks in isolated Node.js sandboxes

## Features

### Smart Question Answering
Ask natural language questions—system routes them to Ollama LLM for answers:
- "What is the capital of France?"
- "What is 2+3?"
- "Tell me about machine learning"

### Built-in Task Support
- **HTTP Requests**: `fetch https://example.com`, `post to https://api.example.com`
- **File Operations**: `read test.txt`, `write to output.txt content: hello`
- **GPIO Control**: `set pin 17 to high` (for Raspberry Pi)
- **Math Operations**: `multiply 3 by 5`, `divide 20 by 4`, `add 8 and 3`

### Self-Programming
Ask the system to do something it doesn't know:
- System generates JavaScript function automatically
- Code is validated for safety (no network access, file deletion, spawning processes)
- Generated code is executed in sandbox
- Task is saved to registry for future use

Example:
```
Input: "reverse the string hello"
Response: 
{
  "success": true,
  "taskName": "reverse_string",
  "description": "Reverses the input string character by character",
  "result": "olleh",
  "generatedCode": "function execute_reverse_string(params) { ... }"
}
```

### Safety & Validation
- Three-layer validation: legality check → feasibility check → safety evaluation
- Automatic code validation blocks dangerous patterns
- Blacklist prevents destructive operations
- All requests tracked via `requestId`

## Installation

### Prerequisites
- **Node.js** 14+
- **Ollama** (for AI capabilities)
- **Docker** (optional, for Phase 2 sandboxing)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/ai-core.git
cd ai-core
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file (copy from `.env.example`):
```bash
PORT=3000
HOST=localhost
ML_MODEL_PATH=./src/models/intent-classifier.js
DOCKER_IMAGE=ai-task-runner:latest
LOG_LEVEL=debug
```

4. Install Ollama models:
```bash
ollama pull orca-mini
ollama pull dolphin-mixtral
```

5. Start the server:
```bash
npm start
```

Server runs on `http://localhost:3000`

## Usage

### HTTP API

**Endpoint**: `POST /request`

**Headers**: `Content-Type: application/json`

**Request Body**:
```json
{
  "input": "your request here",
  "requestId": "optional-custom-id"
}
```

**Response**:
```json
{
  "status": "completed",
  "requestId": "auto-generated-uuid",
  "type": "question|command",
  "result": {
    "success": true,
    "result": "answer or result here"
  }
}
```

### Examples

**Question**:
```json
{
  "input": "What is the capital of France?"
}
```

**Math Operation**:
```json
{
  "input": "multiply 5 by 3"
}
```

**File Operation**:
```json
{
  "input": "read test.txt"
}
```

**Self-Programming**:
```json
{
  "input": "count vowels in the word beautiful"
}
```

### Testing with Postman

1. Open Postman
2. Create a new POST request to `http://localhost:3000/request`
3. Set header: `Content-Type: application/json`
4. Paste request body
5. Click Send

## Architecture Details

### Task Registry
Learned tasks are saved to `tasks/generated-tasks.json`:
```json
{
  "reverse_string": {
    "name": "reverse_string",
    "code": "function execute_reverse_string(params) { ... }",
    "params": { "str": "example" },
    "description": "Reverses a string",
    "createdAt": "2026-04-09T00:00:00.000Z"
  }
}
```

### Code Generation Pipeline

1. **User Input** → Intent Classifier
2. **Unknown Task Detected** → Task Naming (Ollama generates descriptive name)
3. **Code Generation** (Ollama/dolphin-mixtral generates JavaScript)
4. **Code Validation** (regex patterns check for dangerous operations)
5. **Execution** (run in isolated Node.js sandbox)
6. **Persistence** (save to registry for future use)

### Safety Validation
Blocks code containing:
- `require()` calls
- Network requests (fetch, HTTP)
- File system operations (delete, unlink)
- Process control (exit, kill)
- `eval()` or dynamic code execution

## Project Structure

```
ai-core/
├── src/
│   ├── index.js                 # Server entry point
│   ├── input-layer.js           # HTTP/question handling
│   ├── intent-processor.js      # Task classification & validation
│   ├── task-executor.js         # Task execution & code generation
│   ├── code-generator.js        # AI code generation
│   ├── task-registry.js         # Learned task persistence
│   ├── models/
│   │   └── intent-classifier.js # Intent classification logic
│   └── utils/
│       ├── logger.js            # Logging utility
│       └── config.js            # Configuration
├── tasks/
│   └── generated-tasks.json     # Registry of learned tasks
├── tests/
│   └── integration.test.js      # Test suite
├── package.json
├── .env.example
├── README.md
└── .gitignore
```

## Roadmap (Future Phases)

- **Phase 2**: Docker sandboxing for complete isolation
- **Phase 3**: Request queuing and async execution
- **Phase 4**: WebSocket real-time updates
- **Phase 5**: Device control module (GPIO, smart home, Bluetooth)
- **Phase 6**: Database logging and audit trails
- **Phase 7**: Metrics and performance monitoring
- **Phase 8**: Multi-step task planning and workflows
- **Phase 9**: Memory and context persistence
- **Phase 10**: Rate limiting and anti-abuse protection

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | localhost | Server host |
| `ML_MODEL_PATH` | ./src/models/intent-classifier.js | Intent model path |
| `DOCKER_IMAGE` | ai-task-runner:latest | Docker image for Phase 2 |
| `LOG_LEVEL` | debug | Logging level (debug/info/warn/error) |

### Ollama Models

- **orca-mini**: Fast, lightweight model for Q&A (3.3B parameters)
- **dolphin-mixtral**: Better code generation (8x7B mixture of experts)

## Logging

All activity is logged with timestamps and request IDs:

```
[INFO] 2026-04-09T00:14:27.994Z Received request [4e0a3b19-...]: add 8 and 3 together
[INFO] 2026-04-09T00:14:27.995Z Executing task [4e0a3b19-...]: add
[INFO] 2026-04-09T00:14:56.710Z Registered new task: add
```

## Performance

- **Question answering**: ~2-5 seconds (depends on Ollama model)
- **Task execution**: <100ms for simple operations
- **Code generation**: ~30-90 seconds (first-time learning)
- **Learned task execution**: <100ms (registry lookup + execution)

## Limitations

- **Code generation**: Limited to pure JavaScript (no external modules)
- **Network access**: Blocked for security (future: configurable whitelist)
- **File system**: Limited to current directory
- **Concurrency**: Single-threaded (Phase 3 will add queuing)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT

## Author

Tanner Ordonez

## Support

For issues, questions, or feature requests, open an issue on GitHub.

---

**Status**: Active development. Currently in Phase 1 (self-programming executor).
