const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { collectVideoSelections } = require('../video-files');
const { createJob, activeJobs, requestCancel, isCancelled, markMainWindow, hasMainWindow } = require('../processing-state');
const { createPreview } = require('../video-processor');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-mini-'));
  try {
    const folder = path.join(root, 'folder');
    await fs.mkdir(folder);
    const video = path.join(folder, 'test.mp4');
    const other = path.join(root, 'other.mkv');
    await fs.writeFile(video, 'fixture');
    await fs.writeFile(other, 'fixture');
    const selection = await collectVideoSelections([folder, other], 10);
    assert.deepEqual(selection.fileEntries, [0, 1]);
    assert.deepEqual(selection.entries.map((entry) => entry.total), [1, 1]);

    const job = await createJob(root, { items: selection.entries, index: 0, total: 2 });
    assert.equal((await activeJobs(root)).length, 1);
    await requestCancel(root, job.id, 0);
    assert.equal(await isCancelled(root, job.id, 0), true);
    assert.equal(await isCancelled(root, job.id, 1), false);
    await requestCancel(root, job.id);
    assert.equal(await isCancelled(root, job.id, 1), true);
    await job.close();
    assert.equal((await activeJobs(root)).length, 0);
    assert.deepEqual((await fs.readdir(path.join(root, 'jobs'))), []);

    assert.equal(await hasMainWindow(root), false);
    const removeWindow = await markMainWindow(root);
    assert.equal(await hasMainWindow(root), true);
    await removeWindow();
    assert.equal(await hasMainWindow(root), false);

    const finalPath = path.join(folder, 'test预览.jpg');
    await fs.writeFile(finalPath, 'previous result');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(createPreview(video, { signal: controller.signal }), /已终止/);
    assert.equal(await fs.readFile(finalPath, 'utf8'), 'previous result');
    assert.deepEqual((await fs.readdir(folder)).sort(), ['test.mp4', 'test预览.jpg']);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'testsrc2=size=640x360:rate=30', '-t', '20', '-c:v', 'mpeg4', video
      ], { windowsHide: true });
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error(`测试视频生成失败：${code}`)));
    });
    const activeController = new AbortController();
    let timer;
    await assert.rejects(createPreview(video, { frameCount: 9, signal: activeController.signal }, ({ videoPercent }) => {
      if (videoPercent >= 5 && !timer) timer = setTimeout(() => activeController.abort(), 25);
    }), /已终止|AbortError|aborted/i);
    clearTimeout(timer);
    assert.equal(await fs.readFile(finalPath, 'utf8'), 'previous result');
    assert.deepEqual((await fs.readdir(folder)).sort(), ['test.mp4', 'test预览.jpg']);
    process.stdout.write('多输入项归属、独立/全部终止、主窗口检测与取消时成品保留：通过。\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
