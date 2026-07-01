const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[LOG_LEVEL] || 1;

module.exports = {
  debug: (msg) => currentLevel <= 1 && console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`),
  info: (msg) => currentLevel <= 2 && console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => currentLevel <= 3 && console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
  error: (msg) => currentLevel <= 4 && console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
};