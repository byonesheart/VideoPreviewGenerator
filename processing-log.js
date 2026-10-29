const fs = require('node:fs/promises');
const path = require('node:path');

function logFilePath(userDataPath) {
  const day = new Date().toLocaleDateString('sv-SE');
  return path.join(userDataPath, 'logs', `${day}.log`);
}

async function appendLog(userDataPath, message) {
  const filePath = logFilePath(userDataPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${message}\n`, 'utf8');
}

async function recentLog(userDataPath) {
  try {
    const file = await fs.open(logFilePath(userDataPath), 'r');
    try {
      const size = (await file.stat()).size;
      const offset = Math.max(0, size - 128 * 1024);
      const buffer = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      let content = buffer.subarray(0, bytesRead).toString('utf8');
      if (offset > 0) content = content.slice(content.indexOf('\n') + 1);
      return content.trimEnd().split('\n')
        .filter((line) => !/^\[[^\]]+\] (?:进度 \d+\/\d+：|仍在处理 \d+：)/.test(line))
        .slice(-100).join('\n') || '暂无处理日志';
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return '暂无处理日志';
    throw error;
  }
}

async function clearTodayLog(userDataPath) {
  try {
    await fs.truncate(logFilePath(userDataPath), 0);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = { logFilePath, appendLog, recentLog, clearTodayLog };
