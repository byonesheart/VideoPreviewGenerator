const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { activeJobs } = require('../processing-state');
const { appendLog, clearTodayLog, recentLog } = require('../processing-log');

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `退出码：${code}`)));
  });
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-live-'));
  try {
    await appendLog(directory, '清除前');
    assert.equal(await clearTodayLog(directory), true);
    assert.equal(await recentLog(directory), '暂无处理日志');
    await appendLog(directory, '清除后');
    assert.match(await recentLog(directory), /清除后/);
    await appendLog(directory, '进度 1/1：旧视频；抽取视频帧 50%');
    await appendLog(directory, '仍在处理 1：旧视频；编码 GIF 85%');
    assert.doesNotMatch(await recentLog(directory), /旧视频/);

    const videoPath = path.join(directory, 'live.mp4');
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=128x72:rate=10', '-t', '180', '-c:v', 'mpeg4', videoPath
    ]);
    const executable = process.argv[2] || require('electron');
    const args = process.argv[2]
      ? ['--quick', '--gif-every-second', videoPath]
      : ['.', '--quick', '--gif-every-second', videoPath];
    const child = spawn(executable, args, { windowsHide: true, cwd: path.join(__dirname, '..') });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let finished = false;
    let exitCode;
    child.on('close', (code) => { finished = true; exitCode = code; });
    const userDataPath = path.join(process.env.APPDATA, 'video-preview-grid');
    let sawActive = false;
    let sawProgress = false;
    let sawLiveLog = false;
    const deadline = Date.now() + 90000;
    while (!finished && Date.now() < deadline) {
      const jobs = await activeJobs(userDataPath, process.pid);
      const job = jobs.find((entry) => entry.filePath === videoPath);
      if (job) {
        sawActive = true;
        if (job.videoPercent > 5 && job.videoPercent < 100) sawProgress = true;
      }
      if ((await recentLog(userDataPath)).includes(videoPath)) sawLiveLog = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!finished) {
      child.kill();
      throw new Error('后台任务超时');
    }
    assert.equal(exitCode, 0, stderr);
    assert.ok(sawActive, '运行中的后台任务未被发现');
    assert.ok(sawProgress, '未观察到视频内实时百分比');
    assert.ok(sawLiveLog, '未观察到运行中的日志更新');
    const videoLogLines = (await recentLog(userDataPath)).split('\n')
      .filter((line) => line.includes(videoPath));
    assert.ok(videoLogLines.length > 0);
    assert.ok(videoLogLines.every((line) => !/进度|仍在处理|\d+%/.test(line)),
      '处理百分比不应写入日志');
    assert.ok((await fs.stat(path.join(directory, 'live预览.gif'))).size > 0);
    process.stdout.write('跨进程实时进度、简洁日志与当天日志清除测试通过。\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
