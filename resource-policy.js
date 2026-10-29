const os = require('node:os');

function cpuUsage(before, after) {
  let total = 0;
  let idle = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const first = before[index].times;
    const second = after[index].times;
    for (const field of Object.keys(second)) total += second[field] - first[field];
    idle += second.idle - first.idle;
  }
  return total > 0 ? (total - idle) / total : 0;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function sampleSystemLoad() {
  const before = os.cpus();
  await delay(300);
  const cpuBusy = cpuUsage(before, os.cpus()) >= 0.8;
  const memoryBusy = os.freemem() < Math.min(2 * 1024 ** 3, os.totalmem() * 0.15);
  return { cpuBusy, memoryBusy };
}

async function waitForCapacity(onWait, sample = sampleSystemLoad, pause = delay, signal) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (signal?.aborted) throw new Error('已终止');
    const { cpuBusy, memoryBusy } = await sample();
    if (signal?.aborted) throw new Error('已终止');
    if (!cpuBusy && !memoryBusy) return;
    if (attempt === 7) return;
    if (attempt === 0) onWait();
    await pause(1000);
  }
}

module.exports = { cpuUsage, waitForCapacity };
