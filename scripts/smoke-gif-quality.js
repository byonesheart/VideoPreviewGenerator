const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const { createPreview } = require('../video-processor');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ stdout, stderr }) : reject(new Error(stderr || `FFmpeg 退出码：${code}`)));
  });
}

async function inspect(filePath) {
  const result = await run(['-hide_banner', '-i', filePath,
    '-progress', 'pipe:1', '-f', 'null', '-']);
  const dimensions = result.stderr.match(/Video: gif, [^\n]*?(\d{3})x(\d{3})/);
  return {
    size: (await fs.stat(filePath)).size,
    dimensions: dimensions ? `${dimensions[1]}x${dimensions[2]}` : '',
    frames: Number([...result.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]),
    duration: result.stderr.match(/Duration:\s+(\d{2}:\d{2}:\d{2}\.\d+)/)?.[1]
  };
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-gif-quality-'));
  try {
    const source = path.join(directory, 'sample.mp4');
    await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=640x360:rate=10', '-t', '8', '-c:v', 'mpeg4', source]);
    const settings = { outputType: 'gif', gifFrameCount: 40, gifMaxDurationSeconds: 8 };
    const qualityPath = (await createPreview(source, settings)).gifPath;
    const quality = await inspect(qualityPath);
    const compactPath = (await createPreview(source, { ...settings, gifQualityMode: 'size' })).gifPath;
    const compact = await inspect(compactPath);
    assert.equal(quality.dimensions, '480x270');
    assert.equal(compact.dimensions, '272x153');
    assert.equal(quality.frames, 40);
    assert.equal(compact.frames, quality.frames);
    assert.equal(compact.duration, quality.duration);
    const previousCompactSize = 161030; // The same fixture with v1.0.18's 240x135 / 32-color mode.
    assert.ok(compact.size <= previousCompactSize * 1.5,
      `此测试片段相对旧版体积优先不得超过 50%：${compact.size} vs ${previousCompactSize}`);
    const perSecondPath = (await createPreview(source, {
      outputType: 'gif', gifSamplingMode: 'per-second', gifExtractionFps: 2,
      gifPlaybackFps: 5, gifQualityMode: 'size'
    })).gifPath;
    const perSecond = await inspect(perSecondPath);
    assert.equal(perSecond.dimensions, '272x153');
    assert.equal(perSecond.frames, 16);
    assert.equal(perSecond.duration, '00:00:03.20');
    process.stdout.write(`GIF 体积优先：${previousCompactSize} → ${compact.size} 字节；指定帧数及逐秒抽帧均通过。\n`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
