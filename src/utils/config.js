module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  mlModelPath: process.env.ML_MODEL_PATH || './src/models/intent-classifier.js',
  dockerImage: process.env.DOCKER_IMAGE || 'ai-task-runner:latest',
  logLevel: process.env.LOG_LEVEL || 'info',
  ollamaHost: process.env.OLLAMA_HOST || 'https://ollama.com',
  ollamaApiKey: process.env.OLLAMA_API_KEY || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud',
  // Optional — set to enable "tokens left" tracking in the CLI menu.
  ollamaTokenBudget: process.env.OLLAMA_TOKEN_BUDGET
    ? parseInt(process.env.OLLAMA_TOKEN_BUDGET, 10)
    : null,
};