const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_ON = process.env.LOG_ON !== "false";

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = levels[LOG_LEVEL] ?? levels.info;

module.exports = {
  debug: (msg) => {
    if (!LOG_ON) return;
    if (currentLevel <= levels.debug) {
      console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`);
    }
  },

  info: (msg) => {
    if (!LOG_ON) return;
    if (currentLevel <= levels.info) {
      console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
    }
  },

  warn: (msg) => {
    if (!LOG_ON) return;
    if (currentLevel <= levels.warn) {
      console.warn(`[WARN] ${new Date().toISOString()} ${msg}`);
    }
  },

  error: (msg) => {
    if (!LOG_ON) return;
    if (currentLevel <= levels.error) {
      console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);
    }
  },
};