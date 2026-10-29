const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { createPreview } = require('../video-processor');
const packagedExe = process.argv.slice(2).find((argument) => argument.toLowerCase().endsWith('.exe'));
const maxGif = process.argv.includes('--max-gif');
const customGifFrames = process.argv.find((argument) => argument.startsWith('--gif-frames='));
const customGifDuration = process.argv.find((argument) => argument.startsWith('--gif-duration='));
const longEverySecond = process.argv.includes('--long-every-second');
const everySecond = process.argv.includes('--every-second') || longEverySecond;
const customGifFps = process.argv.find((argument) => argument.startsWith('--gif-fps='));
const customExtractionFps = process.argv.find((argument) => argument.startsWith('--extract-fps='));

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr)));
  });
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preview-smoke-'));
  try {
    const jpgVideo = path.join(directory, 'jpg.mp4');
    const gifVideo = path.join(directory, 'gif.mp4');
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=320x180:rate=5', '-t', '4', '-c:v', 'mpeg4', jpgVideo
    ]);
    if (longEverySecond) {
      await run(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'testsrc2=size=64x36:rate=1', '-t', '1001', '-c:v', 'mpeg4', gifVideo
      ]);
    } else if (maxGif || customGifFrames) {
      await run(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'testsrc2=size=320x180:rate=50', '-t', '20', '-c:v', 'mpeg4', gifVideo
      ]);
    } else {
      await fs.copyFile(jpgVideo, gifVideo);
    }

    const requestedJpgFrames = maxGif ? 37 : 4;
    const expectedJpgFrames = maxGif ? 36 : 4;
    const requestedGifFrames = maxGif ? 1001 : customGifFrames ? Number(customGifFrames.split('=')[1]) : 7;
    const gifExtractionFps = customExtractionFps ? Number(customExtractionFps.split('=')[1]) : 1;
    const expectedGifFrames = longEverySecond ? 1001 * gifExtractionFps
      : everySecond ? (maxGif || customGifFrames ? 20 : 4) * gifExtractionFps
        : Math.min(1000, requestedGifFrames);
    const gifMaxDurationSeconds = customGifDuration ? Number(customGifDuration.split('=')[1]) : 20;
    const gifPlaybackFps = customGifFps ? Number(customGifFps.split('=')[1]) : 5;
    const expectedGifSeconds = everySecond
      ? expectedGifFrames / gifPlaybackFps
      : Math.max(expectedGifFrames / 100, Math.min(expectedGifFrames, gifMaxDurationSeconds));

    const tempRoot = path.join(directory, 'temporary-frames');
    await fs.mkdir(tempRoot);
    let sawCustomTemp = false;
    const jpg = packagedExe
      ? await run(packagedExe, ['--quick', '--jpg', '--frames', String(requestedJpgFrames), jpgVideo]).then(() => ({
        outputPath: path.join(directory, 'jpg预览.jpg'), gifPath: null
      }))
      : await createPreview(jpgVideo, {
        outputType: 'jpg', frameCount: requestedJpgFrames, gifFrameCount: 7,
        tempDirectory: tempRoot
      }, ({ videoPercent }) => {
        if (videoPercent >= 5) {
          sawCustomTemp ||= fsSync.readdirSync(tempRoot).some((name) => name.startsWith('video-preview-'));
        }
      });
    if (!packagedExe) {
      assert.ok(sawCustomTemp, '未使用自定义临时图片目录');
      assert.deepEqual(await fs.readdir(tempRoot), [], '临时图片未清理');
      await assert.rejects(createPreview(jpgVideo, {
        outputType: 'jpg', tempDirectory: path.join(directory, 'missing-temp')
      }), /临时图片目录不可用/);
    }
    assert.equal(jpg.outputPath, path.join(directory, 'jpg预览.jpg'));
    assert.equal(jpg.gifPath, null);
    assert.ok((await fs.stat(jpg.outputPath)).size > 0);
    if (!packagedExe) {
      const controller = new AbortController();
      await createPreview(jpgVideo, { outputType: 'jpg', frameCount: 4, signal: controller.signal });
      assert.ok((await fs.stat(jpg.outputPath)).size > 0, '已有成品应可安全替换');
      assert.ok(!(await fs.readdir(directory)).some((name) => /^jpg预览\..+\.jpg$/.test(name)), '临时成品应被清理');
    }
    await assert.rejects(fs.stat(path.join(directory, 'jpg预览.gif')), { code: 'ENOENT' });
    const jpgInfo = await run(ffmpegPath, ['-hide_banner', '-i', jpg.outputPath, '-frames:v', '1', '-f', 'null', '-']);
    assert.match(jpgInfo.stderr, expectedJpgFrames === 36 ? /2880x1620/ : /960x540/);

    const gifArguments = everySecond
      ? ['--quick', '--gif-every-second', '--gif-extract-fps', String(gifExtractionFps), '--gif-fps', String(gifPlaybackFps), gifVideo]
      : ['--quick', '--gif', '--frames', String(requestedGifFrames),
        '--gif-duration', String(gifMaxDurationSeconds), gifVideo];
    const gif = packagedExe
      ? await run(packagedExe, gifArguments).then(() => ({
        outputPath: null, gifPath: path.join(directory, 'gif预览.gif')
      }))
      : await createPreview(gifVideo, {
        outputType: 'gif', frameCount: 4,
        gifFrameCount: requestedGifFrames, gifMaxDurationSeconds,
        gifSamplingMode: everySecond ? 'per-second' : 'count', gifPlaybackFps, gifExtractionFps
      });
    assert.equal(gif.outputPath, null);
    assert.equal(gif.gifPath, path.join(directory, 'gif预览.gif'));
    assert.ok((await fs.stat(gif.gifPath)).size > 0);
    await assert.rejects(fs.stat(path.join(directory, 'gif预览.jpg')), { code: 'ENOENT' });
    const gifInfo = await run(ffmpegPath, [
      '-hide_banner', '-i', gif.gifPath,
      '-progress', 'pipe:1', '-f', 'null', '-'
    ]);
    assert.equal(Number([...gifInfo.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]), expectedGifFrames);
    const duration = gifInfo.stderr.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}\.\d+)/);
    assert.ok(duration, 'FFmpeg 未报告 GIF 时长');
    const gifSeconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    assert.ok(Math.abs(gifSeconds - expectedGifSeconds) <= 0.02,
      `GIF 时长不符：实际 ${gifSeconds} 秒，预期 ${expectedGifSeconds} 秒`);
    if (!packagedExe) {
      const lowVideo = path.join(directory, 'low.mp4');
      await fs.copyFile(jpgVideo, lowVideo);
      const lowJpg = await createPreview(lowVideo, { outputType: 'jpg', frameCount: 4, lowPriority: true });
      assert.ok((await fs.stat(lowJpg.outputPath)).size > 0);
      const lowGif = await createPreview(lowVideo, {
        outputType: 'gif', gifSamplingMode: 'per-second', gifExtractionFps: 1,
        gifPlaybackFps: 5, lowPriority: true
      });
      assert.ok((await fs.stat(lowGif.gifPath)).size > 0);
      assert.equal(lowGif.gifFrameCount, 4);
    }
    process.stdout.write(`JPG ${expectedJpgFrames} 帧、GIF ${expectedGifFrames} 帧 / ${gifSeconds} 秒均独立生成。\n`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
