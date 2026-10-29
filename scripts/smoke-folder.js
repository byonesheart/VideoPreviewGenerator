const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { collectVideoPaths, VIDEO_EXTENSIONS } = require('../video-files');
const { appendLog, recentLog } = require('../processing-log');

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ stdout, stderr }) : reject(new Error(stderr || `退出码：${code}`)));
  });
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-folder-'));
  const executable = process.argv[2] || require('electron');
  try {
    const nested = path.join(directory, '子目录');
    await fs.mkdir(nested);
    const first = path.join(directory, 'a.mp4');
    const second = path.join(nested, 'b2.mpeg');
    const third = path.join(nested, 'b10.mpg');
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=25', '-t', '1', '-c:v', 'mpeg4', first
    ]);
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=25', '-t', '1', '-c:v', 'mpeg1video', second
    ]);
    await fs.copyFile(second, third);
    await fs.writeFile(path.join(nested, 'ignore.txt'), 'not a video');

    assert.ok(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', 'mpeg', 'mpg']
      .every((extension) => VIDEO_EXTENSIONS.includes(extension)));
    assert.deepEqual(await collectVideoPaths([directory, first]), [second, third, first]);
    await appendLog(directory, '测试日志');
    assert.match(await recentLog(directory), /测试日志/);

    const args = process.argv[2]
      ? ['--quick', '--jpg', '--frames', '1', '--max-videos', '2', directory]
      : ['.', '--quick', '--jpg', '--frames', '1', '--max-videos', '2', directory];
    const result = await run(executable, args);
    if (!process.argv[2]) assert.match(result.stdout, /已生成 2 个/);
    assert.ok((await fs.stat(path.join(nested, 'b2预览.jpg'))).size > 0);
    assert.ok((await fs.stat(path.join(nested, 'b10预览.jpg'))).size > 0);
    await assert.rejects(fs.stat(path.join(directory, 'a预览.jpg')), { code: 'ENOENT' });
    process.stdout.write('递归扫描、自然排序、最大数量、MPEG/MPG 和日志测试通过。\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
