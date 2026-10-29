const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { createPreview } = require('../video-processor');
const { normalizeJpgStyle } = require('../jpg-style');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stderr) : reject(new Error(stderr)));
  });
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-style-'));
  try {
    const videoPath = path.join(directory, '示例视频.mp4');
    await run([
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=320x180:rate=5', '-t', '4', '-c:v', 'mpeg4', videoPath
    ]);
    const options = {
      outputType: 'jpg', frameCount: 4, jpgInfoEnabled: true,
      jpgInfoFields: ['folder', 'filename', 'size', 'resolution', 'fps', 'duration', 'videoCodec', 'audioCodec', 'subtitles'],
      jpgInfoPosition: 'bottom', jpgInfoFont: 'yahei', jpgInfoFontSize: 22,
      jpgCommentEnabled: true, jpgComment: '测试注释: 100% 完成',
      jpgTileBorder: true, jpgTileBorderWidth: 5,
      jpgGrayscale: true, jpgOuterBorder: true, jpgOuterBorderWidth: 8,
      jpgOuterBorderColor: '#ff0000', jpgBevel: true, jpgBevelWidth: 4
    };
    const normalized = normalizeJpgStyle(options);
    assert.equal(normalized.jpgInfoFields.length, 9);
    assert.equal(normalizeJpgStyle({ jpgInfoFontSize: 999, jpgOuterBorderColor: 'bad' }).jpgInfoFontSize, 36);
    assert.equal(normalizeJpgStyle({ jpgInfoFields: ['filename', 'bad'] }).jpgInfoFields.length, 1);

    const zh = await createPreview(videoPath, { ...options, jpgInfoLanguage: 'zh' });
    const zhBytes = await fs.readFile(zh.outputPath);
    assert.ok(zhBytes.length > 0);
    const info = await run(['-hide_banner', '-i', zh.outputPath, '-frames:v', '1', '-f', 'null', '-']);
    assert.match(info, /976x936/, '数据栏和外框应增加预览图尺寸');
    const noBevel = await createPreview(videoPath, { ...options, jpgInfoLanguage: 'zh', jpgBevel: false });
    assert.notDeepEqual(zhBytes, await fs.readFile(noBevel.outputPath), '白边不应遮住倒角效果');

    const top = await createPreview(videoPath, {
      outputType: 'jpg', frameCount: 1, jpgInfoEnabled: true,
      jpgInfoFields: ['filename'], jpgInfoPosition: 'top',
      jpgCommentEnabled: true, jpgComment: 'A'.repeat(160)
    });
    const topInfo = await run(['-hide_banner', '-i', top.outputPath, '-frames:v', '1', '-f', 'null', '-']);
    const topDimensions = topInfo.match(/480x(\d+)/);
    assert.ok(topDimensions && Number(topDimensions[1]) > 400, '顶部数据栏应自动换行并留足高度');

    const en = await createPreview(videoPath, { ...options, jpgInfoLanguage: 'en' });
    const enBytes = await fs.readFile(en.outputPath);
    assert.notDeepEqual(zhBytes, enBytes, '切换字段语言应改变预览图文字');
    assert.deepEqual(await fs.readdir(directory).then((names) => names.filter((name) => name.startsWith('video-preview-'))), []);
    process.stdout.write('JPG 影片数据、中文/英文字段、白边、灰度、外框和倒角效果通过。\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
