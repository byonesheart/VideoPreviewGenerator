const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { collectVideoSelections } = require('../video-files');
const { recentLog } = require('../processing-log');

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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-quota-'));
  try {
    const directVideo = path.join(directory, 'direct.mp4');
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=64x36:rate=5', '-t', '1', '-c:v', 'mpeg4', directVideo
    ]);
    const folders = [];
    for (let index = 1; index <= 5; index += 1) {
      const folder = path.join(directory, `folder${index}`);
      const nested = path.join(folder, 'sub');
      await fs.mkdir(nested, { recursive: true });
      for (const filePath of [
        path.join(nested, 'b2.mp4'), path.join(nested, 'b10.mp4'),
        path.join(folder, 'z.mp4')
      ]) await fs.copyFile(directVideo, filePath);
      folders.push(folder);
    }

    const selected = await collectVideoSelections([...folders, directVideo], 2);
    assert.equal(selected.folders.length, 5);
    assert.ok(selected.folders.every((folder) => folder.found === 3 && folder.chosen === 2));
    assert.equal(selected.skippedByLimit, 5);
    assert.equal(selected.filePaths.length, 11);
    assert.ok(selected.filePaths.includes(directVideo));
    for (const folder of folders) {
      assert.ok(selected.filePaths.includes(path.join(folder, 'sub', 'b2.mp4')));
      assert.ok(selected.filePaths.includes(path.join(folder, 'sub', 'b10.mp4')));
      assert.ok(!selected.filePaths.includes(path.join(folder, 'z.mp4')));
    }
    const overlapping = await collectVideoSelections([folders[0], path.join(folders[0], 'sub')], 2);
    assert.equal(overlapping.filePaths.length, 2);
    assert.equal(overlapping.duplicateCount, 2);

    const executable = process.argv[2] || require('electron');
    const args = [
      ...(process.argv[2] ? [] : ['.']), '--quick', '--jpg', '--frames', '1',
      '--max-videos', '2', ...folders, directVideo
    ];
    const result = await run(executable, args);
    if (!process.argv[2]) assert.match(result.stdout, /已生成 11 个/);
    assert.ok((await fs.stat(path.join(directory, 'direct预览.jpg'))).size > 0);
    for (const folder of folders) {
      for (const name of ['b2', 'b10']) {
        assert.ok((await fs.stat(path.join(folder, 'sub', `${name}预览.jpg`))).size > 0);
      }
      await assert.rejects(fs.stat(path.join(folder, 'z预览.jpg')), { code: 'ENOENT' });
    }
    const logLines = (await recentLog(path.join(process.env.APPDATA, 'video-preview-grid'))).split('\n');
    const resultLines = logLines.filter((line) => line.includes(directory) && /\] 成功 \d+\/11：/.test(line));
    assert.equal(resultLines.length, 11);
    resultLines.forEach((line, index) => {
      assert.ok(line.includes(`成功 ${index + 1}/11：${selected.filePaths[index]}`));
    });
    const lastResultIndex = logLines.indexOf(resultLines.at(-1));
    assert.ok(logLines.slice(lastResultIndex + 1).some((line) => line.includes('处理结束：成功 11 个，失败 0 个')));
    assert.ok(!logLines.some((line) => line.includes(directory) && line.includes('文件夹完成：')));
    process.stdout.write('5 个文件夹分别限额、子文件夹共用额度、独立文件不受限、重叠去重：通过。\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
