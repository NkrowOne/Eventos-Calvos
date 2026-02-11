import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backup = path.join(LOG_DIR, `bot.${Date.now()}.log`);
        fs.renameSync(LOG_FILE, backup);
      }
    }
  } catch {}
}

export function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', category: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  const line = `[${timestamp}] [${level}] [${category}] ${message}${dataStr}`;
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

export function readLogs(lines: number = 100): string[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

export function getLogFilePath(): string {
  return LOG_FILE;
}
