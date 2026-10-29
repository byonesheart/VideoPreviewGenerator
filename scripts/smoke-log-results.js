const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const { recentLog } = require('../processing-log');

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-log-'));
  try {
    const good = path.join(directory, 'good.mp4');
    const bad = path.join(directory, 'bad.mp4');
    assert.equal((await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=5', '-t', '1', '-c:v', 'mpeg4', good
    ])).code, 0);
    await fs.writeFile(bad, 'not a video');

    const executable = process.argv[2] || require('electron');
    const args = [...(process.argv[2] ? [] : ['.']), '--quick', '--jpg', '--frames', '1', good, bad];
    const result = await run(executable, args);
    assert.match(result.stderr, /有 1 个视频处理失败/);

    const lines = (await recentLog(path.join(process.env.APPDATA, 'video-preview-grid'))).split('\n');
    const successIndex = lines.findIndex((line) => line.includes(`成功 1/2：${good}`));
    const failureIndex = lines.findIndex((line) => line.includes(`失败 2/2：${bad}`));
    const summaryIndex = lines.findIndex((line, index) => index > failureIndex
      && line.includes('处理结束：成功 1 个，失败 1 个'));
    assert.ok(successIndex >= 0 && failureIndex > successIndex && summaryIndex > failureIndex,
      '应先逐条记录成功和失败，最后才记录汇总');
    assert.ok((await fs.stat(path.join(directory, 'good预览.jpg'))).size > 0);
    process.stdout.write('逐视频成功/失败日志与最终汇总顺序：通过。\n');
  } finally {
    if (path.dirname(directory) === os.tmpdir()) {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
