const fs = require('node:fs/promises');
const path = require('node:path');

function jobsDirectory(userDataPath) {
  return path.join(userDataPath, 'jobs');
}

async function createJob(userDataPath, initialState) {
  const directory = jobsDirectory(userDataPath);
  await fs.mkdir(directory, { recursive: true });
  const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(directory, `${id}.json`);
  const state = { id, pid: process.pid, startedAt: Date.now(), ...initialState };
  let pending = Promise.resolve();

  function update(changes = {}) {
    Object.assign(state, changes, { updatedAt: Date.now() });
    const snapshot = JSON.stringify(state);
    pending = pending.catch(() => {}).then(() => fs.writeFile(filePath, snapshot, 'utf8'));
    return pending;
  }

  await update();
  return {
    id,
    update,
    async close() {
      try {
        await pending;
      } finally {
        await fs.rm(filePath, { force: true });
        const names = await fs.readdir(directory);
        await Promise.all(names.filter((name) => name.startsWith(`${id}.cancel-`)).map((name) =>
          fs.rm(path.join(directory, name), { force: true })));
      }
    }
  };
}

function cancelPath(userDataPath, id, inputIndex) {
  if (!/^\d+-\d+-[a-z0-9]+$/.test(id)) throw new Error('无效的任务 ID');
  if (inputIndex !== 'all' && (!Number.isInteger(inputIndex) || inputIndex < 0)) {
    throw new Error('无效的输入项');
  }
  return path.join(jobsDirectory(userDataPath), `${id}.cancel-${inputIndex}`);
}

async function requestCancel(userDataPath, id, inputIndex = 'all') {
  const jobPath = path.join(jobsDirectory(userDataPath), `${id}.json`);
  await fs.access(jobPath);
  await fs.writeFile(cancelPath(userDataPath, id, inputIndex), '', 'utf8');
}

async function isCancelled(userDataPath, id, inputIndex) {
  for (const index of ['all', inputIndex]) {
    try {
      await fs.access(cancelPath(userDataPath, id, index));
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

function windowsDirectory(userDataPath) {
  return path.join(userDataPath, 'main-windows');
}

async function markMainWindow(userDataPath) {
  const directory = windowsDirectory(userDataPath);
  await fs.mkdir(directory, { recursive: true });
  const marker = path.join(directory, `${process.pid}.json`);
  await fs.writeFile(marker, JSON.stringify({ updatedAt: Date.now() }), 'utf8');
  return () => fs.rm(marker, { force: true });
}

async function hasMainWindow(userDataPath) {
  let names;
  try {
    names = await fs.readdir(windowsDirectory(userDataPath));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  for (const name of names.filter((value) => value.endsWith('.json'))) {
    try {
      const marker = JSON.parse(await fs.readFile(path.join(windowsDirectory(userDataPath), name), 'utf8'));
      if (Date.now() - marker.updatedAt < 4000) return true;
    } catch { /* A closing window can remove its marker during this scan. */ }
  }
  return false;
}

async function activeJobs(userDataPath, excludedPid = 0) {
  let names;
  try {
    names = await fs.readdir(jobsDirectory(userDataPath));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const jobs = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const job = JSON.parse(await fs.readFile(path.join(jobsDirectory(userDataPath), name), 'utf8'));
        return job.pid !== excludedPid && Date.now() - job.updatedAt < 5000 ? job : null;
      } catch {
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    return null;
  }));
  return jobs.filter(Boolean).sort((first, second) => first.startedAt - second.startedAt);
}

module.exports = { createJob, activeJobs, requestCancel, isCancelled, markMainWindow, hasMainWindow };
