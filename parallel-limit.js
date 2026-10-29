const fs = require('node:fs/promises');
const path = require('node:path');

const POLL_MS = 250;
const STALE_MS = 10000;

function interrupted(signal) {
  if (signal?.aborted) throw new Error('已终止');
}

async function pause(signal) {
  let onAbort;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, POLL_MS);
    onAbort = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  signal?.removeEventListener('abort', onAbort);
  interrupted(signal);
}

async function reclaimStaleSlot(filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (Date.now() - stat.mtimeMs < STALE_MS) return;
  const reaperPath = `${filePath}.reaper`;
  let reaper;
  try {
    reaper = await fs.open(reaperPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      const reaperStat = await fs.stat(reaperPath).catch(() => null);
      if (reaperStat && Date.now() - reaperStat.mtimeMs >= STALE_MS) {
        await fs.rm(reaperPath, { force: true });
      }
      return;
    }
    throw error;
  }
  try {
    const current = await fs.stat(filePath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!current || Date.now() - current.mtimeMs < STALE_MS) return;
    let owner;
    try {
      owner = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch { /* A process can exit before writing its owner record. */ }
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        return;
      } catch (error) {
        if (error.code !== 'ESRCH') return;
      }
    }
    await fs.rm(filePath, { force: true });
  } finally {
    await reaper.close();
    await fs.rm(reaperPath, { force: true });
  }
}

async function acquireVideoSlot(userDataPath, getLimit, signal, onWait = () => {}) {
  const directory = path.join(userDataPath, 'video-slots');
  await fs.mkdir(directory, { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let waiting = false;
  while (true) {
    interrupted(signal);
    const limit = Math.max(1, Math.min(32, Math.floor(Number(await getLimit()) || 5)));
    const occupiedNames = (await fs.readdir(directory)).filter((name) => name.endsWith('.lock'));
    if (occupiedNames.length >= limit) {
      if (!waiting) { waiting = true; onWait(); }
      for (const name of occupiedNames) await reclaimStaleSlot(path.join(directory, name));
      await pause(signal);
      continue;
    }
    for (let index = 0; index < limit; index += 1) {
      interrupted(signal);
      const filePath = path.join(directory, `${index}.lock`);
      let handle;
      try {
        handle = await fs.open(filePath, 'wx');
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await reclaimStaleSlot(filePath);
        continue;
      }
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token }), 'utf8');
      } catch (error) {
        await handle.close();
        await fs.rm(filePath, { force: true });
        throw error;
      }
      await handle.close();
      let currentLimit;
      let currentOccupied;
      try {
        currentLimit = Math.max(1, Math.min(32, Math.floor(Number(await getLimit()) || 5)));
        currentOccupied = (await fs.readdir(directory)).filter((name) => name.endsWith('.lock')).length;
      } catch (error) {
        await fs.rm(filePath, { force: true });
        throw error;
      }
      if (currentOccupied > currentLimit) {
        await fs.rm(filePath, { force: true });
        break;
      }
      const heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(filePath, now, now).catch(() => {});
      }, 1000);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        try {
          const owner = JSON.parse(await fs.readFile(filePath, 'utf8'));
          if (owner.token === token) await fs.rm(filePath, { force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    }
    if (!waiting) {
      waiting = true;
      onWait();
    }
    await pause(signal);
  }
}

module.exports = { acquireVideoSlot };
