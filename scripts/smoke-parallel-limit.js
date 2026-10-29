const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { acquireVideoSlot } = require('../parallel-limit');

function holder(root) {
  const child = fork(__filename, ['--hold', root], { silent: true });
  let acquired = false;
  const ready = new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message === 'acquired') { acquired = true; resolve(); }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!acquired) reject(new Error(`名额子进程提前退出：${code}`));
    });
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { child, ready, release: async () => { child.send('release'); await exited; } };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-slots-'));
  const holders = [];
  try {
    const first = await acquireVideoSlot(root, async () => 2);
    const second = await acquireVideoSlot(root, async () => 2);
    assert.equal((await fs.readdir(path.join(root, 'video-slots'))).filter((name) => name.endsWith('.lock')).length, 2);
    let thirdStarted = false;
    const thirdPromise = acquireVideoSlot(root, async () => 2).then((release) => {
      thirdStarted = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(thirdStarted, false, '并行满额时不应启动第三个视频');
    await first();
    const third = await thirdPromise;
    assert.equal(thirdStarted, true);
    await second();
    await third();

    const highSlot = await acquireVideoSlot(root, async () => 3);
    const middleSlot = await acquireVideoSlot(root, async () => 3);
    let loweredStarted = false;
    const lowered = acquireVideoSlot(root, async () => 1).then((release) => {
      loweredStarted = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(loweredStarted, false, '下调限制后应等待已有任务减少');
    await highSlot();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(loweredStarted, false, '旧名额中的任务尚未结束时不得超额');
    await middleSlot();
    const afterLowering = await lowered;
    await afterLowering();

    const occupied = await acquireVideoSlot(root, async () => 1);
    const controller = new AbortController();
    const waiting = acquireVideoSlot(root, async () => 1, controller.signal);
    controller.abort();
    await assert.rejects(waiting, /已终止/);
    await occupied();

    const stalePath = path.join(root, 'video-slots', '0.lock');
    await fs.writeFile(stalePath, JSON.stringify({ pid: 99999999, token: 'stale' }));
    const old = new Date(Date.now() - 20000);
    await fs.utimes(stalePath, old, old);
    const reclaimed = await acquireVideoSlot(root, async () => 1);
    await reclaimed();
    const staleReaper = `${stalePath}.reaper`;
    await fs.writeFile(stalePath, JSON.stringify({ pid: 99999999, token: 'stale-again' }));
    await fs.writeFile(staleReaper, 'abandoned');
    await fs.utimes(stalePath, old, old);
    await fs.utimes(staleReaper, old, old);
    const afterReaper = await acquireVideoSlot(root, async () => 1);
    await afterReaper();
    const firstProcess = holder(root);
    const secondProcess = holder(root);
    holders.push(firstProcess, secondProcess);
    await Promise.all([firstProcess.ready, secondProcess.ready]);
    const thirdProcess = holder(root);
    holders.push(thirdProcess);
    let thirdProcessStarted = false;
    void thirdProcess.ready.then(() => { thirdProcessStarted = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(thirdProcessStarted, false, '跨进程满额时第三个视频应等待');
    await firstProcess.release();
    await thirdProcess.ready;
    await Promise.all([secondProcess.release(), thirdProcess.release()]);
    assert.deepEqual(await fs.readdir(path.join(root, 'video-slots')), []);
    process.stdout.write('跨进程全局名额、动态下调、满额等待、取消等待及崩溃锁回收：通过。\n');
  } finally {
    for (const holder of holders) {
      if (holder.child.exitCode === null) holder.child.kill();
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[2] === '--hold') {
  acquireVideoSlot(process.argv[3], async () => 2).then((release) => {
    process.send('acquired');
    process.on('message', async (message) => {
      if (message === 'release') { await release(); process.exit(0); }
    });
  }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
} else {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
