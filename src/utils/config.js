module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  mlModelPath: process.env.ML_MODEL_PATH || './src/models/intent-classifier.js',
  dockerImage: process.env.DOCKER_IMAGE || 'ai-task-runner:latest',
  logLevel: process.env.LOG_LEVEL || 'info',
  ollamaHost: process.env.OLLAMA_HOST || 'https://ollama.com',
  ollamaApiKey: process.env.OLLAMA_API_KEY || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud',
  // Used only for semantic de-duplication of generated tasks (see
  // src/utils/embeddings.js). Must be a model with `ollama pull` support for
  // embeddings — nomic-embed-text is small and fast for this purpose.
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  ollamaEmbedHost: process.env.OLLAMA_EMBED_HOST || 'http://localhost:11434',
  // Cosine similarity (0-1) above which a new function request is considered
  // a duplicate of an existing learned task, and gets reused instead of
  // triggering a new code-generation call.
  taskSimilarityThreshold: process.env.TASK_SIMILARITY_THRESHOLD
    ? parseFloat(process.env.TASK_SIMILARITY_THRESHOLD)
    : 0.85,
  // Docker sandbox resource limits for executing generated/learned tasks.
  sandboxTimeoutMs: process.env.SANDBOX_TIMEOUT_MS
    ? parseInt(process.env.SANDBOX_TIMEOUT_MS, 10)
    : 10000,
  sandboxMemoryMb: process.env.SANDBOX_MEMORY_MB
    ? parseInt(process.env.SANDBOX_MEMORY_MB, 10)
    : 128,
  sandboxCpuLimit: process.env.SANDBOX_CPU_LIMIT
    ? parseFloat(process.env.SANDBOX_CPU_LIMIT)
    : 0.5,
  sandboxPidsLimit: process.env.SANDBOX_PIDS_LIMIT
    ? parseInt(process.env.SANDBOX_PIDS_LIMIT, 10)
    : 64,
  // Optional — set to enable "tokens left" tracking in the CLI menu.
  ollamaTokenBudget: process.env.OLLAMA_TOKEN_BUDGET
    ? parseInt(process.env.OLLAMA_TOKEN_BUDGET, 10)
    : null,
};