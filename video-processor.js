const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const { normalizeJpgStyle } = require('./jpg-style');

const TILE_WIDTH = 480;
const TILE_HEIGHT = 270;
const MIN_FRAME_COUNT = 1;
const MAX_JPG_FRAME_COUNT = 36;
const MAX_GIF_FRAME_COUNT = 1000;
const DEFAULT_GIF_MAX_DURATION_SECONDS = 20;
const MAX_GIF_FPS = 100;
const CPU_THREAD_LIMIT = Math.max(1, Math.floor(os.availableParallelism() / 2));
const NORMAL_RESOURCES = {
  threads: CPU_THREAD_LIMIT,
  extractWorkers: Math.min(2, CPU_THREAD_LIMIT),
  inputsPerFfmpeg: Math.min(6, CPU_THREAD_LIMIT),
  priority: os.constants.priority.PRIORITY_BELOW_NORMAL
};
const LOW_RESOURCES = {
  threads: 1,
  extractWorkers: 1,
  inputsPerFfmpeg: Math.min(2, CPU_THREAD_LIMIT),
  priority: os.constants.priority.PRIORITY_LOW
};
const FRAME_FILTER = [
  `scale=${TILE_WIDTH}:${TILE_HEIGHT}:force_original_aspect_ratio=decrease`,
  `pad=${TILE_WIDTH}:${TILE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`
].join(',');

function runFfmpeg(args, resources, { collectStderr = false, onProgressLine, cwd } = {}) {
  if (resources.signal?.aborted) return Promise.reject(new Error('已终止'));
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, [
      '-filter_threads', '1', '-filter_complex_threads', String(resources.threads), ...args
    ], { windowsHide: true, cwd, signal: resources.signal });
    if (process.pid) {
      try {
        os.setPriority(process.pid, resources.priority);
      } catch {
        // Priority changes can be denied by Windows; processing remains functional.
      }
    }
    let stderr = '';
    let progressBuffer = '';

    process.stderr.on('data', (chunk) => {
      const output = chunk.toString();
      stderr = collectStderr ? stderr + output : (stderr + output).slice(-65536);
      if (onProgressLine) {
        progressBuffer += output;
        let newline;
        while ((newline = progressBuffer.indexOf('\n')) !== -1) {
          onProgressLine(progressBuffer.slice(0, newline).trim());
          progressBuffer = progressBuffer.slice(newline + 1);
        }
      }
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (resources.signal?.aborted) {
        reject(new Error('已终止'));
      } else if (code === 0 || collectStderr) {
        resolve(stderr);
      } else {
        reject(new Error(stderr.trim() || `FFmpeg 退出码：${code}`));
      }
    });
  });
}

async function getVideoMetadata(filePath, resources) {
  const output = await runFfmpeg(
    ['-hide_banner', '-i', filePath],
    resources,
    { collectStderr: true }
  );
  const match = output.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) {
    throw new Error('无法读取视频时长');
  }

  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('视频时长无效');
  }
  const streams = output.split(/\r?\n/).filter((line) => /Stream #\d+:\d+/.test(line));
  const video = streams.find((line) => /\bVideo:\s*/.test(line)) || '';
  const audio = streams.find((line) => /\bAudio:\s*/.test(line)) || '';
  const dimensions = video.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const frameRate = video.match(/\b(\d+(?:\.\d+)?)\s+fps\b/);
  return {
    duration,
    resolution: dimensions ? `${dimensions[1]}x${dimensions[2]}` : null,
    fps: frameRate ? Number(frameRate[1]) : null,
    videoCodec: video.match(/\bVideo:\s*([^\s,(]+)/)?.[1] || null,
    audioCodec: audio.match(/\bAudio:\s*([^\s,(]+)/)?.[1] || null,
    subtitles: streams.filter((line) => /\bSubtitle:\s*/.test(line))
      .map((line) => line.match(/\bSubtitle:\s*([^\s,(]+)/)?.[1]).filter(Boolean)
  };
}

async function getVideoDuration(filePath, resources) {
  return (await getVideoMetadata(filePath, resources)).duration;
}

function normalizeOptions(options = {}) {
  const outputType = options.outputType === 'gif' ? 'gif' : 'jpg';
  const requestedCount = Number(outputType === 'gif' ? options.gifFrameCount : options.frameCount);
  const maxFrameCount = outputType === 'gif' ? MAX_GIF_FRAME_COUNT : MAX_JPG_FRAME_COUNT;
  const frameCount = Number.isFinite(requestedCount)
    ? Math.min(maxFrameCount, Math.max(MIN_FRAME_COUNT, Math.floor(requestedCount)))
    : 9;
  const requestedDuration = Number(options.gifMaxDurationSeconds);
  const gifMaxDurationSeconds = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? Math.min(1000, Math.max(0.1, Math.round(requestedDuration * 10) / 10))
    : DEFAULT_GIF_MAX_DURATION_SECONDS;
  const requestedFps = Number(options.gifPlaybackFps);
  const gifPlaybackFps = Number.isFinite(requestedFps) && requestedFps > 0
    ? Math.min(MAX_GIF_FPS, Math.max(0.1, Math.round(requestedFps * 10) / 10))
    : 5;
  const requestedExtractionFps = Number(options.gifExtractionFps);
  const gifExtractionFps = Number.isFinite(requestedExtractionFps) && requestedExtractionFps > 0
    ? Math.min(60, Math.max(1, Math.floor(requestedExtractionFps)))
    : 1;
  return {
    ...normalizeJpgStyle(options),
    outputType,
    frameCount,
    gifMaxDurationSeconds,
    gifSamplingMode: options.gifSamplingMode === 'per-second' ? 'per-second' : 'count',
    gifQualityMode: options.gifQualityMode === 'size' ? 'size' : 'quality',
    gifPlaybackFps,
    gifExtractionFps,
    tempDirectory: typeof options.tempDirectory === 'string' ? options.tempDirectory.trim() : '',
    lowPriority: options.lowPriority === true
  };
}

async function hasUsableFile(filePath) {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

async function extractFrameAt(filePath, outputPath, timestamp, resources, accurateSeek = false) {
  const seekArguments = accurateSeek
    ? ['-threads', '1', '-i', filePath, '-ss', timestamp.toFixed(3)]
    : ['-ss', timestamp.toFixed(3), '-threads', '1', '-i', filePath];

  await runFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    ...seekArguments,
    '-map', '0:v:0',
    '-vf', FRAME_FILTER,
    '-frames:v', '1',
    '-an',
    '-sn',
    '-q:v', '3',
    '-threads', '1',
    outputPath
  ], resources);
}

async function extractFrameWithFallback(filePath, outputPath, timestamp, resources) {
  const attempts = [
    [timestamp, false],
    [timestamp, true],
    [Math.max(0, timestamp - 0.1), false],
    [Math.max(0, timestamp - 1), false],
    [Math.max(0, timestamp - 1), true]
  ];
  for (const [candidate, accurateSeek] of attempts) {
    try {
      await extractFrameAt(filePath, outputPath, candidate, resources, accurateSeek);
      if (await hasUsableFile(outputPath)) return;
    } catch (error) {
      if (resources.signal?.aborted) throw error;
    }
  }
  throw new Error(`无法在 ${timestamp.toFixed(2)} 秒附近提取视频帧`);
}

async function extractFrames(filePath, outputDirectory, duration, frameCount, report, resources) {
  const framePaths = Array.from({ length: frameCount }, (_unused, index) =>
    path.join(outputDirectory, `frame_${String(index + 1).padStart(2, '0')}.jpg`)
  );
  const timestamps = framePaths.map((_framePath, index) =>
    duration * (index + 0.5) / frameCount
  );

  for (let start = 0; start < frameCount; start += resources.inputsPerFfmpeg) {
    if (resources.signal?.aborted) throw new Error('已终止');
    const batchPaths = framePaths.slice(start, start + resources.inputsPerFfmpeg);
    const inputArguments = timestamps.slice(start, start + resources.inputsPerFfmpeg).flatMap((timestamp) => [
      '-ss', timestamp.toFixed(3),
      '-threads', '1',
      '-i', filePath
    ]);
    const outputArguments = batchPaths.flatMap((framePath, index) => [
      '-map', `${index}:v:0`,
      '-vf', FRAME_FILTER,
      '-frames:v', '1',
      '-an',
      '-sn',
      '-q:v', '3',
      '-threads', '1',
      framePath
    ]);

    try {
      await runFfmpeg([
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-y',
        ...inputArguments,
        ...outputArguments
      ], resources);
    } catch (error) {
      if (resources.signal?.aborted) throw error;
      // Missing outputs are retried below with per-frame seek fallbacks.
    }
    report(5 + 70 * Math.min(start + resources.inputsPerFfmpeg, frameCount) / frameCount, '抽取视频帧');
  }

  const missingFrameIndexes = [];
  for (let index = 0; index < framePaths.length; index += 1) {
    if (!await hasUsableFile(framePaths[index])) missingFrameIndexes.push(index);
  }
  let nextMissingIndex = 0;

  async function worker() {
    while (nextMissingIndex < missingFrameIndexes.length) {
      if (resources.signal?.aborted) throw new Error('已终止');
      const frameIndex = missingFrameIndexes[nextMissingIndex];
      nextMissingIndex += 1;
      await extractFrameWithFallback(
        filePath,
        framePaths[frameIndex],
        timestamps[frameIndex],
        resources
      );
    }
  }

  const workerCount = Math.min(resources.extractWorkers, missingFrameIndexes.length);
  if (missingFrameIndexes.length > 0) report(75, '补全缺失帧');
  const outcomes = await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker())
  );
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  return framePaths;
}

async function extractFramesPerSecond(filePath, outputDirectory, extractionFps, duration, report, resources) {
  const framePattern = path.join(outputDirectory, 'frame_%02d.jpg');
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-stats_period', '0.5', '-progress', 'pipe:2',
    '-threads', String(resources.threads), '-i', filePath,
    '-map', '0:v:0',
    '-vf', `setpts=PTS-STARTPTS,fps=${extractionFps},${FRAME_FILTER}`,
    '-an', '-sn', '-q:v', '3',
    '-start_number', '1',
    '-threads', String(resources.threads),
    framePattern
  ], resources, { onProgressLine: (line) => {
    const match = line.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match || !duration) return;
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    report(5 + 70 * Math.min(1, seconds / duration), '抽取视频帧');
  } });
  const fileNames = (await fs.readdir(outputDirectory))
    .filter((name) => /^frame_\d+\.jpg$/.test(name))
    .sort((first, second) => Number(first.slice(6, -4)) - Number(second.slice(6, -4)));
  if (fileNames.length === 0) throw new Error('无法从视频中提取帧');
  return fileNames.map((name) => path.join(outputDirectory, name));
}

const INFO_LABELS = {
  zh: {
    folder: '文件夹', filename: '文件名', size: '文件大小', resolution: '分辨率',
    fps: '帧率', duration: '视频时长', videoCodec: '视频编码',
    audioCodec: '音频编码', subtitles: '字幕', comment: '注释'
  },
  en: {
    folder: 'Folder', filename: 'Filename', size: 'File size', resolution: 'Resolution',
    fps: 'FPS', duration: 'Duration', videoCodec: 'Video codec',
    audioCodec: 'Audio codec', subtitles: 'Subtitles', comment: 'Comment'
  }
};

async function buildInfoLines(filePath, metadata, style) {
  if (!style.jpgInfoEnabled) return [];
  const seconds = Math.floor(metadata.duration);
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0')).join(':');
  const fileSize = style.jpgInfoFields.includes('size') ? (await fs.stat(filePath)).size : 0;
  const divisor = style.jpgSizeUnit === 'GB' ? 1024 ** 3 : style.jpgSizeUnit === 'MB' ? 1024 ** 2 : 1;
  const size = style.jpgSizeUnit === 'B'
    ? `${fileSize} B` : `${(fileSize / divisor).toFixed(2)} ${style.jpgSizeUnit}`;
  const values = {
    folder: path.dirname(filePath),
    filename: path.basename(filePath),
    size,
    resolution: metadata.resolution || '—',
    fps: metadata.fps === null ? '—' : String(metadata.fps),
    duration: time,
    videoCodec: metadata.videoCodec || '—',
    audioCodec: metadata.audioCodec || '—',
    subtitles: metadata.subtitles.length
      ? metadata.subtitles.join(', ') : style.jpgInfoLanguage === 'en' ? 'None' : '无'
  };
  const labels = INFO_LABELS[style.jpgInfoLanguage];
  const lines = style.jpgInfoFields.map((field) => `${labels[field]}: ${values[field]}`);
  if (style.jpgCommentEnabled && style.jpgComment.trim()) {
    lines.push(`${labels.comment}: ${style.jpgComment.trim()}`);
  }
  return lines;
}

async function fontFile(font) {
  const candidates = {
    yahei: ['msyh.ttc', 'NotoSansSC-VF.ttf', 'simhei.ttf', 'arial.ttf'],
    simhei: ['simhei.ttf', 'msyh.ttc', 'NotoSansSC-VF.ttf', 'arial.ttf'],
    arial: ['arial.ttf', 'msyh.ttc']
  }[font];
  for (const name of candidates) {
    const location = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', name);
    try {
      await fs.access(location);
      return location.replace(/\\/g, '/').replace(/:/g, '\\:');
    } catch {}
  }
  throw new Error('找不到可用于影片数据的系统字体');
}

function wrapInfoLines(lines, width, fontSize) {
  const maxWidth = width - 32;
  const wrapped = [];
  for (const line of lines) {
    let part = '';
    let usedWidth = 0;
    for (const character of line) {
      const characterWidth = character.charCodeAt(0) < 128 ? fontSize * 0.5 : fontSize;
      if (part && usedWidth + characterWidth > maxWidth) {
        wrapped.push(part);
        part = '  ';
        usedWidth = fontSize;
      }
      part += character;
      usedWidth += characterWidth;
    }
    wrapped.push(part);
  }
  return wrapped;
}

async function createGrid(framePaths, outputPath, frameCount, resources, style, infoLines) {
  const columns = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / columns);
  const temporaryDirectory = path.dirname(framePaths[0]);
  const framePattern = path.join(temporaryDirectory, 'frame_%02d.jpg');
  const tileFilter = [
    `tile=layout=${columns}x${rows}`,
    `nb_frames=${frameCount}`,
    'padding=0',
    'margin=0',
    'color=black'
  ].join(':');
  const filters = [];
  if (style.jpgTileBorder) {
    filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=white:t=${style.jpgTileBorderWidth}`);
  }
  if (style.jpgBevel) {
    const width = style.jpgBevelWidth;
    const inset = style.jpgTileBorder ? style.jpgTileBorderWidth : 0;
    filters.push(
      `drawbox=x=${inset}:y=${inset}:w=iw-${2 * inset}:h=${width}:color=white@0.5:t=fill`,
      `drawbox=x=${inset}:y=${inset}:w=${width}:h=ih-${2 * inset}:color=white@0.5:t=fill`,
      `drawbox=x=${inset}:y=ih-${inset + width}:w=iw-${2 * inset}:h=${width}:color=black@0.5:t=fill`,
      `drawbox=x=iw-${inset + width}:y=${inset}:w=${width}:h=ih-${2 * inset}:color=black@0.5:t=fill`
    );
  }
  filters.push(tileFilter);
  if (style.jpgGrayscale) filters.push('hue=s=0');
  if (infoLines.length > 0) {
    const displayLines = wrapInfoLines(infoLines, columns * TILE_WIDTH, style.jpgInfoFontSize);
    const lineHeight = Math.ceil(style.jpgInfoFontSize * 1.35) + 6;
    const panelHeight = 20 + lineHeight * displayLines.length;
    await fs.writeFile(path.join(temporaryDirectory, 'jpg-info.txt'), displayLines.join('\n'), 'utf8');
    const top = style.jpgInfoPosition === 'top';
    filters.push(`pad=iw:ih+${panelHeight}:0:${top ? panelHeight : 0}:color=0x172033`);
    filters.push([
      `drawtext=fontfile='${await fontFile(style.jpgInfoFont)}'`,
      'textfile=jpg-info.txt',
      'expansion=none',
      `fontsize=${style.jpgInfoFontSize}`,
      `fontcolor=0x${style.jpgInfoColor.slice(1)}`,
      'line_spacing=6',
      'x=16',
      `y=${top ? 10 : rows * TILE_HEIGHT + 10}`
    ].join(':'));
  }
  if (style.jpgOuterBorder) {
    const width = style.jpgOuterBorderWidth;
    filters.push(`pad=iw+${2 * width}:ih+${2 * width}:${width}:${width}:color=0x${style.jpgOuterBorderColor.slice(1)}`);
  }

  await runFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-framerate', '1',
    '-start_number', '1',
    '-threads', String(resources.threads),
    '-i', framePattern,
    '-vf', filters.join(','),
    '-frames:v', '1',
    '-q:v', '2',
    '-threads', String(resources.threads),
    outputPath
  ], resources, { cwd: temporaryDirectory });
}

async function createGif(framePaths, outputPath, options, report, resources) {
  const framePattern = path.join(path.dirname(framePaths[0]), 'frame_%02d.jpg');
  const frameCount = framePaths.length;
  const durationCentiseconds = options.gifSamplingMode === 'per-second'
    ? null
    : Math.max(
      Math.ceil(frameCount * 100 / MAX_GIF_FPS),
      Math.min(frameCount * 100, Math.round(options.gifMaxDurationSeconds * 100))
    );
  const frameRate = durationCentiseconds === null
    ? `${Math.round(options.gifPlaybackFps * 10)}/10`
    : `${frameCount * 100}/${durationCentiseconds}`;
  const compact = options.gifQualityMode === 'size';
  const palettePath = path.join(path.dirname(framePaths[0]), 'palette.png');
  report(75, '生成 GIF 调色板');
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-framerate', frameRate,
    '-threads', String(resources.threads),
    '-i', framePattern,
    '-vf', compact
      ? 'scale=272:153:flags=area,palettegen=max_colors=48'
      : 'palettegen=max_colors=128',
    '-frames:v', '1',
    '-threads', String(resources.threads),
    palettePath
  ], resources);
  report(85, '编码 GIF');
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-stats_period', '0.5', '-progress', 'pipe:2',
    '-framerate', frameRate,
    '-threads', String(resources.threads),
    '-i', framePattern,
    '-threads', String(resources.threads),
    '-i', palettePath,
    '-filter_complex', compact
      ? '[0:v]scale=272:153:flags=area[scaled];[scaled][1:v]paletteuse=dither=none:diff_mode=rectangle'
      : '[0:v][1:v]paletteuse=dither=bayer',
    '-loop', '0',
    '-threads', String(resources.threads),
    outputPath
  ], resources, { onProgressLine: (line) => {
    const match = line.match(/^frame=(\d+)/);
    if (match) report(85 + 14 * Math.min(1, Number(match[1]) / frameCount), '编码 GIF');
  } });
  return durationCentiseconds === null
    ? Math.round(frameCount / options.gifPlaybackFps * 100) / 100
    : durationCentiseconds / 100;
}

async function createPreview(filePath, options = {}, onProgress = () => {}) {
  const normalizedOptions = normalizeOptions(options);
  const resources = { ...(normalizedOptions.lowPriority ? LOW_RESOURCES : NORMAL_RESOURCES), signal: options.signal };
  const report = (percent, stage) => onProgress({ videoPercent: Math.round(percent), stage });
  report(0, '读取视频信息');
  const source = path.parse(filePath);
  const outputPath = normalizedOptions.outputType === 'jpg'
    ? path.join(source.dir, `${source.name}预览.jpg`)
    : null;
  const gifPath = normalizedOptions.outputType === 'gif'
    ? path.join(source.dir, `${source.name}预览.gif`)
    : null;
  const finalPath = outputPath || gifPath;
  const stagedPath = options.signal
    ? path.join(source.dir, `${source.name}预览.${process.pid}-${Math.random().toString(36).slice(2)}${outputPath ? '.jpg' : '.gif'}`)
    : finalPath;
  const tempRoot = normalizedOptions.tempDirectory || os.tmpdir();
  let temporaryDirectory;
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(tempRoot, 'video-preview-'));
  } catch (error) {
    throw new Error(`临时图片目录不可用：${tempRoot}（${error.message}）`);
  }

  try {
    let framePaths;
    let metadata;
    if (normalizedOptions.outputType === 'gif' && normalizedOptions.gifSamplingMode === 'per-second') {
      let duration = null;
      try {
        duration = await getVideoDuration(filePath, resources);
      } catch {
        // Some streams have no declared duration; extraction remains supported.
      }
      report(5, '抽取视频帧');
      framePaths = await extractFramesPerSecond(filePath, temporaryDirectory, normalizedOptions.gifExtractionFps, duration, report, resources);
    } else {
      metadata = await getVideoMetadata(filePath, resources);
      report(5, '抽取视频帧');
      framePaths = await extractFrames(filePath, temporaryDirectory, metadata.duration, normalizedOptions.frameCount, report, resources);
    }
    if (outputPath) {
      report(80, '拼接 JPG 预览图');
      const infoLines = await buildInfoLines(filePath, metadata, normalizedOptions);
      await createGrid(framePaths, stagedPath, normalizedOptions.frameCount, resources, normalizedOptions, infoLines);
    }
    const gifDurationSeconds = gifPath
      ? await createGif(framePaths, stagedPath, normalizedOptions, report, resources)
      : null;
    if (resources.signal?.aborted) throw new Error('已终止');
    if (stagedPath !== finalPath) await fs.rename(stagedPath, finalPath);
    report(100, '处理完成');
    return {
      outputPath,
      gifPath,
      gifFrameCount: gifPath ? framePaths.length : null,
      gifDurationSeconds
    };
  } finally {
    if (stagedPath !== finalPath) await fs.rm(stagedPath, { force: true }).catch(() => {});
    try {
      await fs.rm(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
    } catch (error) {
      // Windows or security software may briefly keep a decoded frame locked.
      // The generated preview is valid, so a delayed temp cleanup must not
      // turn a successful video conversion into a failed result.
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
    }
  }
}

module.exports = { createPreview };
