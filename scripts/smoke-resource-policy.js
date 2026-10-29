const assert = require('node:assert/strict');
const { cpuUsage, waitForCapacity } = require('../resource-policy');

async function main() {
  const before = [{ times: { user: 10, system: 10, idle: 80 } }];
  const after = [{ times: { user: 60, system: 30, idle: 110 } }];
  assert.equal(cpuUsage(before, after), 0.7);

  const loads = [
    { cpuBusy: true, memoryBusy: false },
    { cpuBusy: false, memoryBusy: true },
    { cpuBusy: false, memoryBusy: false }
  ];
  let waitingNotices = 0;
  let pauses = 0;
  await waitForCapacity(
    () => { waitingNotices += 1; },
    async () => loads.shift(),
    async () => { pauses += 1; }
  );
  assert.equal(waitingNotices, 1);
  assert.equal(pauses, 2);

  pauses = 0;
  await waitForCapacity(
    () => {},
    async () => ({ cpuBusy: true, memoryBusy: true }),
    async () => { pauses += 1; }
  );
  assert.equal(pauses, 7, '高负荷时等待应有上限');
  process.stdout.write('CPU/内存负荷判断与有上限的等待：通过。\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
