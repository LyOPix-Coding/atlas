const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  mlModelPath: process.env.ML_MODEL_PATH || './src/models/intent-classifier.js',
  dockerImage: process.env.DOCKER_IMAGE || 'ai-task-runner:latest',
  logLevel: process.env.LOG_LEVEL || 'info',
  ollamaHost: process.env.OLLAMA_HOST || 'https://ollama.com',
  ollamaApiKey: process.env.OLLAMA_API_KEY || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud',
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  ollamaEmbedHost: process.env.OLLAMA_EMBED_HOST || 'http://localhost:11434',
  taskSimilarityThreshold: process.env.TASK_SIMILARITY_THRESHOLD
    ? parseFloat(process.env.TASK_SIMILARITY_THRESHOLD)
    : 0.85,
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
  fileSandboxRoot: process.env.FILE_SANDBOX_ROOT
    ? path.resolve(process.env.FILE_SANDBOX_ROOT)
    : path.join(__dirname, '../../data/user-files'),
  // Max number of self-repair attempts if a learned/generated task throws at
  // runtime: on failure, the error + code are sent back to the model to
  // patch, up to this many times, before giving up entirely.
  maxRepairAttempts: process.env.REPAIR_TRIES_LIMIT
    ? parseInt(process.env.REPAIR_TRIES_LIMIT, 10)
    : 3,
  ollamaTokenBudget: process.env.OLLAMA_TOKEN_BUDGET
    ? parseInt(process.env.OLLAMA_TOKEN_BUDGET, 10)
    : null,
};