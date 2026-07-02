module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  mlModelPath: process.env.ML_MODEL_PATH || './src/models/intent-classifier.js',
  dockerImage: process.env.DOCKER_IMAGE || 'ai-task-runner:latest',
  logLevel: process.env.LOG_LEVEL || 'info',
  ollamaHost: process.env.OLLAMA_HOST || 'https://ollama.com',
  ollamaApiKey: process.env.OLLAMA_API_KEY || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud',
};