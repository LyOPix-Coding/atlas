const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(fileName, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(fileName, data) {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, fileName), JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readJson, writeJson };
