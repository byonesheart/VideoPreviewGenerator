const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, shell } = require('electron');
const quickArgumentIndex = process.argv.indexOf('--quick');
const miniMode = process.argv.includes('--mini');
const miniHasLock = miniMode ? app.requestSingleInstanceLock() : true;
if (!miniHasLock) app.quit();
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
if (quickArgumentIndex >= 0) {
  app.commandLine.appendSwitch('disable-software-rasterizer');
}
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createPreview } = require('./video-processor');
const contextMenu = require('./context-menu');
const { VIDEO_EXTENSIONS, classifyVideoInputs, collectVideoSelections } = require('./video-files');
const { logFilePath, appendLog, recentLog, clearTodayLog } = require('./processing-log');
const { createJob, activeJobs, requestCancel, isCancelled, markMainWindow, hasMainWindow } = require('./processing-state');
const { waitForCapacity } = require('./resource-policy');
const { acquireVideoSlot } = require('./parallel-limit');
const { buildQuickCommands } = require('./quick-commands');
const { DEFAULT_JPG_STYLE, normalizeJpgStyle } = require('./jpg-style');

const DEFAULT_SETTINGS = {
  ...DEFAULT_JPG_STYLE,
  frameCount: 9,
  gifFrameCount: 9,
  gifMaxDurationSeconds: 20,
  gifSamplingMode: 'count',
  gifQualityMode: 'quality',
  gifPlaybackFps: 5,
  gifExtractionFps: 1,
  maxVideos: 100,
  maxConcurrentVideos: 5,
  tempDirectory: '',
  lowPriority: false,
  miniLowPriority: false,
  miniOnContextMenu: true,
  miniOnQuickCommand: true,
  miniAutoClose: true,
  miniCloseAction: 'ask'
};

function normalizeMiniCloseAction(value) {
  return ['ask', 'terminate', 'minimize'].includes(value) ? value : 'ask';
}

function normalizeFrameCount(value, maxFrameCount) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.min(maxFrameCount, Math.max(1, Math.floor(count))) : 9;
}

function normalizeGifDuration(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.min(1000, Math.max(0.1, Math.round(seconds * 10) / 10))
    : DEFAULT_SETTINGS.gifMaxDurationSeconds;
}

function normalizeGifPlaybackFps(value) {
  const fps = Number(value);
  return Number.isFinite(fps) && fps > 0
    ? Math.min(100, Math.max(0.1, Math.round(fps * 10) / 10))
    : DEFAULT_SETTINGS.gifPlaybackFps;
}

function normalizeGifExtractionFps(value) {
  const fps = Number(value);
  return Number.isFinite(fps) && fps > 0
    ? Math.min(60, Math.max(1, Math.floor(fps)))
    : DEFAULT_SETTINGS.gifExtractionFps;
}

function normalizeMaxVideos(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0
    ? Math.min(10000, Math.max(1, Math.floor(count)))
    : DEFAULT_SETTINGS.maxVideos;
}

function normalizeMaxConcurrentVideos(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0
    ? Math.min(32, Math.max(1, Math.floor(count)))
    : DEFAULT_SETTINGS.maxConcurrentVideos;
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    return {
      ...normalizeJpgStyle(saved),
      frameCount: normalizeFrameCount(saved.frameCount ?? DEFAULT_SETTINGS.frameCount, 36),
      gifFrameCount: normalizeFrameCount(saved.gifFrameCount ?? saved.frameCount ?? DEFAULT_SETTINGS.gifFrameCount, 1000),
      gifMaxDurationSeconds: normalizeGifDuration(saved.gifMaxDurationSeconds ?? DEFAULT_SETTINGS.gifMaxDurationSeconds),
      gifSamplingMode: saved.gifSamplingMode === 'per-second' ? 'per-second' : 'count',
      gifQualityMode: saved.gifQualityMode === 'size' ? 'size' : 'quality',
      gifPlaybackFps: normalizeGifPlaybackFps(saved.gifPlaybackFps ?? DEFAULT_SETTINGS.gifPlaybackFps),
      gifExtractionFps: normalizeGifExtractionFps(saved.gifExtractionFps ?? DEFAULT_SETTINGS.gifExtractionFps),
      maxVideos: normalizeMaxVideos(saved.maxVideos ?? DEFAULT_SETTINGS.maxVideos),
      maxConcurrentVideos: normalizeMaxConcurrentVideos(saved.maxConcurrentVideos),
      tempDirectory: typeof saved.tempDirectory === 'string' ? saved.tempDirectory : '',
      lowPriority: saved.lowPriority === true,
      miniLowPriority: saved.miniLowPriority === undefined ? saved.lowPriority === true : saved.miniLowPriority === true,
      miniOnContextMenu: saved.miniOnContextMenu !== false,
      miniOnQuickCommand: saved.miniOnQuickCommand !== false,
      miniAutoClose: saved.miniAutoClose !== false,
      miniCloseAction: normalizeMiniCloseAction(saved.miniCloseAction)
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings) {
  const normalized = {
    ...normalizeJpgStyle(settings),
    frameCount: normalizeFrameCount(settings?.frameCount, 36),
    gifFrameCount: normalizeFrameCount(settings?.gifFrameCount, 1000),
    gifMaxDurationSeconds: normalizeGifDuration(settings?.gifMaxDurationSeconds),
    gifSamplingMode: settings?.gifSamplingMode === 'per-second' ? 'per-second' : 'count',
    gifQualityMode: settings?.gifQualityMode === 'size' ? 'size' : 'quality',
    gifPlaybackFps: normalizeGifPlaybackFps(settings?.gifPlaybackFps),
    gifExtractionFps: normalizeGifExtractionFps(settings?.gifExtractionFps),
    maxVideos: normalizeMaxVideos(settings?.maxVideos),
    maxConcurrentVideos: normalizeMaxConcurrentVideos(settings?.maxConcurrentVideos),
    tempDirectory: typeof settings?.tempDirectory === 'string' ? settings.tempDirectory.trim() : '',
    lowPriority: settings?.lowPriority === true,
    miniLowPriority: settings?.miniLowPriority === true,
    miniOnContextMenu: settings?.miniOnContextMenu !== false,
    miniOnQuickCommand: settings?.miniOnQuickCommand !== false,
    miniAutoClose: settings?.miniAutoClose !== false,
    miniCloseAction: normalizeMiniCloseAction(settings?.miniCloseAction)
  };
  await fs.writeFile(settingsPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 780,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  window.once('ready-to-show', () => window.show());
  window.loadFile('renderer.html');
}

let miniWindow = null;
let miniTray = null;
let closingMiniWindow = false;
let miniHadJobs = false;
let miniLastJobs = [];
let miniStartedAt = 0;
let miniNoJobsSince = 0;
let miniSettingsQueue = Promise.resolve();
if (miniMode && miniHasLock) {
  app.on('second-instance', () => {
    if (miniWindow?.isVisible()) {
      miniWindow.focus();
    }
  });
}

function showMiniWindow() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  miniWindow.show();
  miniWindow.focus();
}

function updateMiniSetting(key, value) {
  miniSettingsQueue = miniSettingsQueue.catch(() => {}).then(async () => {
    const settings = await loadSettings();
    settings[key] = value;
    return saveSettings(settings);
  });
  return miniSettingsQueue;
}

async function closeMiniWindow() {
  if (!miniWindow || closingMiniWindow) return;
  const settings = await loadSettings();
  let action = settings.miniCloseAction;
  if (action === 'ask') {
    const choice = await dialog.showMessageBox(miniWindow, {
      type: 'question', title: '关闭进度小窗',
      message: '要结束正在处理的任务，还是隐藏窗口并在后台继续处理？',
      buttons: ['结束任务', '隐藏至后台', '取消'], defaultId: 1, cancelId: 2, noLink: true,
      checkboxLabel: '以后默认进行这次的选择', checkboxChecked: false
    });
    if (choice.response === 2) return;
    action = choice.response === 0 ? 'terminate' : 'minimize';
    if (choice.checkboxChecked) await updateMiniSetting('miniCloseAction', action);
  }
  if (action === 'minimize') {
    if (!miniTray) {
      await dialog.showMessageBox(miniWindow, {
        type: 'warning', message: '托盘图标尚未就绪，请稍后重试。', buttons: ['确定']
      });
      return;
    }
    miniWindow.hide();
    return;
  }
  const jobs = await activeJobs(app.getPath('userData'));
  await Promise.all(jobs.map((job) => requestCancel(app.getPath('userData'), job.id).catch(() => {})));
  closingMiniWindow = true;
  miniWindow.close();
}

function createMiniWindow() {
  miniStartedAt = Date.now();
  miniWindow = new BrowserWindow({
    width: 480, height: 440, minWidth: 380, minHeight: 280,
    show: false, backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  miniWindow.on('close', (event) => {
    if (!closingMiniWindow) {
      event.preventDefault();
      void closeMiniWindow().catch((error) => dialog.showErrorBox('关闭小窗失败', error.message));
    }
  });
  miniWindow.on('closed', () => {
    miniTray?.destroy();
    miniTray = null;
  });
  void app.getFileIcon(process.execPath, { size: 'small' }).then((icon) => {
    if (miniWindow.isDestroyed()) return;
    miniTray = new Tray(icon);
    miniTray.setToolTip('视频预览处理进度');
    miniTray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示处理进度', click: showMiniWindow }
    ]));
    miniTray.on('click', showMiniWindow);
    miniTray.on('double-click', showMiniWindow);
  }).catch((error) => process.stderr.write(`托盘图标创建失败：${error.message}\n`));
  miniWindow.loadFile('mini.html').then(() => {
    if (!miniWindow.isDestroyed()) miniWindow.show();
  }).catch((error) => {
    dialog.showErrorBox('进度小窗加载失败', error.message);
  });
}

ipcMain.handle('mini-state', async () => {
  const userDataPath = app.getPath('userData');
  const jobs = await activeJobs(userDataPath);
  if (jobs.length) {
    miniHadJobs = true;
    miniLastJobs = jobs;
    miniNoJobsSince = 0;
  } else if (!miniNoJobsSince) {
    miniNoJobsSince = Date.now();
  }
  const settings = await loadSettings();
  const mainOpen = await hasMainWindow(userDataPath);
  if (mainOpen || (jobs.length === 0 && settings.miniAutoClose
    && Date.now() - (miniHadJobs ? miniNoJobsSince : miniStartedAt) > (miniHadJobs ? 1500 : 3000))) {
    closingMiniWindow = true;
    miniWindow?.close();
  }
  return { jobs: jobs.length ? jobs : miniLastJobs, activeCount: jobs.length,
    lowPriority: settings.miniLowPriority, miniAutoClose: settings.miniAutoClose };
});
ipcMain.handle('mini-cancel', (_event, id, inputIndex) => requestCancel(app.getPath('userData'), id, inputIndex));
ipcMain.handle('mini-cancel-all', async () => {
  const userDataPath = app.getPath('userData');
  const jobs = await activeJobs(userDataPath);
  await Promise.all(jobs.map((job) => requestCancel(userDataPath, job.id)));
});
ipcMain.handle('mini-set-toggle', (_event, key, value) => {
  if (!['miniLowPriority', 'miniAutoClose'].includes(key) || typeof value !== 'boolean') throw new Error('无效的设置');
  return updateMiniSetting(key, value);
});

async function processVideos(event, filePaths, options = {}) {
  const userDataPath = app.getPath('userData');
  const send = (channel, payload) => {
    if (event && !event.sender.isDestroyed()) event.sender.send(channel, payload);
  };
  let logQueue = Promise.resolve();
  const writeLog = (message) => {
    logQueue = logQueue.then(async () => {
      try {
        await appendLog(userDataPath, message);
      } catch (error) {
        process.stderr.write(`日志写入失败：${error.message}\n`);
      }
      send('log-updated', message);
    });
    return logQueue;
  };
  let job = null;
  try {
    job = await createJob(userDataPath, {
      outputType: options.outputType === 'gif' ? 'gif' : 'jpg',
      total: 0,
      index: 0,
      filePath: filePaths[0] || '',
      videoPercent: 0,
      stage: '扫描视频文件',
      items: filePaths.map((filePath) => ({ path: filePath, type: 'input', total: 0, done: 0, status: 'scanning', percent: 0 }))
    });
  } catch (error) {
    process.stderr.write(`实时状态写入失败：${error.message}\n`);
  }
  if (job && options.showMiniWindow) {
    try {
      if (!await hasMainWindow(userDataPath)) {
        const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--mini'];
        spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (error) {
      process.stderr.write(`小窗启动失败：${error.message}\n`);
    }
  }
  let stateErrorReported = false;
  const updateJob = (changes) => {
    if (!job) return Promise.resolve();
    return job.update(changes).catch((error) => {
      if (!stateErrorReported) process.stderr.write(`实时状态写入失败：${error.message}\n`);
      stateErrorReported = true;
    });
  };
  const heartbeat = job ? setInterval(() => { void updateJob({}); }, 1000) : null;
  const running = new Map();
  let cancelAll = false;
  const cancelledEntries = new Set();
  const checkCancellation = async () => {
    if (!job) return;
    if (!cancelAll && await isCancelled(userDataPath, job.id, 'all')) {
      cancelAll = true;
      for (const task of running.values()) task.controller.abort();
    }
    for (const entryIndex of new Set([...running.values()].map((task) => task.entryIndex))) {
      if (!cancelledEntries.has(entryIndex) && await isCancelled(userDataPath, job.id, entryIndex)) {
        cancelledEntries.add(entryIndex);
        for (const task of running.values()) {
          if (task.entryIndex === entryIndex) task.controller.abort();
        }
      }
    }
  };
  const cancelPoll = job ? setInterval(() => { void checkCancellation().catch(() => {}); }, 200) : null;

  try {
    await writeLog(`开始扫描 ${filePaths.length} 个输入：${filePaths[0] || ''}`);
    const maxVideos = normalizeMaxVideos(options.maxVideos);
    const selection = await collectVideoSelections(filePaths, maxVideos);
    const selected = selection.filePaths;
    const results = new Array(selected.length);
    const messages = new Array(selected.length);
    let nextLogIndex = 0;
    let nextIndex = 0;
    let completed = 0;
    const items = selection.entries.map((entry) => ({
      path: entry.path, type: entry.type, total: entry.total, done: 0, errors: 0, cancelled: 0,
      status: entry.total ? 'waiting' : 'complete', activePercent: 0, percent: 0
    }));
    const activeTasks = () => [...running.values()];
    const updateItem = (entryIndex) => {
      const item = items[entryIndex];
      const active = activeTasks().filter((task) => task.entryIndex === entryIndex);
      item.activePercent = active.reduce((sum, task) => sum + task.videoPercent / 100, 0);
      item.percent = active[0]?.videoPercent || 0;
      item.stage = active[0]?.stage || '';
      item.status = item.done >= item.total ? (item.cancelled ? 'cancelled' : item.errors ? 'error' : 'complete')
        : cancelledEntries.has(entryIndex) || cancelAll ? 'cancelled'
          : active.length ? 'processing' : 'waiting';
    };
    const updateProgressState = (changes = {}) => updateJob({
      total: selected.length, completed, index: completed,
      activePercent: activeTasks().reduce((sum, task) => sum + task.videoPercent / 100, 0),
      running: activeTasks().map(({ index, entryIndex, filePath, videoPercent, stage }) =>
        ({ index, entryIndex, filePath, videoPercent, stage })),
      items, ...changes
    });
    const flushLogs = () => {
      while (nextLogIndex < messages.length && messages[nextLogIndex] !== undefined) {
        void writeLog(messages[nextLogIndex]);
        nextLogIndex += 1;
      }
    };
    await updateProgressState({ filePath: selected[0] || '', stage: selected.length ? '等待处理' : '未找到视频' });
    const workerCount = Math.min(normalizeMaxConcurrentVideos(options.maxConcurrentVideos), selected.length);
    await writeLog(`开始${options.outputType === 'gif' ? 'GIF' : 'JPG'}处理：${selection.folders.length} 个文件夹分别最多 ${maxVideos} 个视频，实际处理 ${selected.length} 个；最多并行 ${workerCount} 个，${options.lowPriority === true ? '低优先级' : '常规'}模式。`);
    let cachedLimit = normalizeMaxConcurrentVideos(options.maxConcurrentVideos);
    let limitReadAt = 0;
    const getGlobalLimit = async () => {
      if (Date.now() - limitReadAt >= 1000) {
        cachedLimit = (await loadSettings()).maxConcurrentVideos;
        limitReadAt = Date.now();
      }
      return cachedLimit;
    };

    async function processOne(index) {
      const filePath = selected[index];
      const entryIndex = selection.fileEntries[index];
      const item = items[entryIndex];
      const controller = new AbortController();
      const task = { index, entryIndex, filePath, controller, videoPercent: 0, stage: '等待处理' };
      running.set(index, task);
      updateItem(entryIndex);
      await updateProgressState({ filePath, videoPercent: 0, stage: task.stage });
      let lastStateAt = 0;
      let lastStage = task.stage;
      const report = (videoPercent, stage) => {
        task.videoPercent = videoPercent;
        task.stage = stage;
        updateItem(entryIndex);
        const now = Date.now();
        send('generation-progress', {
          index, total: selected.length, filePath, status: 'processing', videoPercent, stage
        });
        if (now - lastStateAt >= 400 || videoPercent === 100 || stage !== lastStage) {
          void updateProgressState({ filePath, videoPercent, stage });
          lastStateAt = now;
          lastStage = stage;
        }
      };
      let releaseSlot;
      try {
        await checkCancellation();
        if (cancelAll || cancelledEntries.has(entryIndex)) controller.abort();
        if (options.lowPriority && !controller.signal.aborted) {
          await waitForCapacity(() => report(0, '系统负荷较高，等待空闲'),
            undefined, undefined, controller.signal);
        }
        releaseSlot = await acquireVideoSlot(userDataPath,
          getGlobalLimit,
          controller.signal, () => report(0, '等待并行处理名额'));
        if (controller.signal.aborted) throw new Error('已终止');
        const outputs = await createPreview(filePath, { ...options, signal: controller.signal },
          ({ videoPercent, stage }) => report(videoPercent, stage));
        results[index] = { filePath, ...outputs, success: true };
        messages[index] = `成功 ${index + 1}/${selected.length}：${filePath} -> ${outputs.outputPath || outputs.gifPath}`;
        send('generation-progress', {
          index, total: selected.length, filePath, ...outputs, status: 'success'
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = controller.signal.aborted;
        results[index] = { filePath, success: false, cancelled, error: cancelled ? '已终止' : message };
        messages[index] = `${cancelled ? '终止' : '失败'} ${index + 1}/${selected.length}：${filePath}；${message.replace(/\s+/g, ' ')}`;
        send('generation-progress', {
          index, total: selected.length, filePath, error: message, status: 'error'
        });
      } finally {
        if (releaseSlot) await releaseSlot().catch((error) => {
          process.stderr.write(`并行名额释放失败：${error.message}\n`);
        });
        running.delete(index);
        item.done += 1;
        if (!results[index].success && !results[index].cancelled) item.errors += 1;
        if (results[index].cancelled) item.cancelled += 1;
        completed += 1;
        updateItem(entryIndex);
        const next = activeTasks()[0];
        await updateProgressState({ filePath: next?.filePath || '', videoPercent: next?.videoPercent || 0,
          stage: next?.stage || '等待下一个视频' });
        flushLogs();
      }
    }
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < selected.length && !cancelAll) {
        const index = nextIndex;
        nextIndex += 1;
        await processOne(index);
      }
    }));
    for (; nextLogIndex < messages.length; nextLogIndex += 1) {
      if (messages[nextLogIndex]) void writeLog(messages[nextLogIndex]);
    }
    if (cancelAll && nextIndex < selected.length) {
      await writeLog(`全部任务已终止，剩余 ${selected.length - nextIndex} 个视频未处理。`);
    }
    const completedResults = results.filter(Boolean);
    await writeLog(`处理结束：成功 ${completedResults.filter((result) => result.success).length} 个，失败 ${completedResults.filter((result) => !result.success && !result.cancelled).length} 个，终止 ${completedResults.filter((result) => result.cancelled).length} 个，文件夹额度跳过 ${selection.skippedByLimit} 个，重复路径跳过 ${selection.duplicateCount} 个。`);
    return completedResults;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (cancelPoll) clearInterval(cancelPoll);
    await logQueue;
    if (job) await job.close().catch((error) => {
      process.stderr.write(`实时状态清理失败：${error.message}\n`);
    });
  }
}

ipcMain.handle('select-videos', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择视频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '视频文件', extensions: VIDEO_EXTENSIONS },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('select-folder-videos', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择视频文件夹（包含子文件夹）',
    properties: ['openDirectory', 'multiSelections']
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('select-temp-directory', async () => {
  const settings = await loadSettings();
  const result = await dialog.showOpenDialog({
    title: '选择临时图片存储位置',
    defaultPath: settings.tempDirectory || os.tmpdir(),
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('classify-video-inputs', (_event, paths) => classifyVideoInputs(paths));
ipcMain.handle('get-recent-log', () => recentLog(app.getPath('userData')));
ipcMain.handle('get-active-jobs', () => activeJobs(app.getPath('userData'), process.pid));
ipcMain.handle('clear-log', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '清空当天日志',
    message: '确定清空今天的处理日志吗？',
    detail: '其他日期的日志会保留。正在运行的任务会继续写入后续日志。',
    buttons: ['取消', '清空当天日志'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  return response === 1 ? clearTodayLog(app.getPath('userData')) : false;
});
ipcMain.handle('show-log-file', async () => {
  const filePath = logFilePath(app.getPath('userData'));
  try {
    await fs.access(filePath);
    shell.showItemInFolder(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('generate-previews', async (event, payload) => {
  const filePaths = Array.isArray(payload) ? payload : payload.filePaths;
  const options = Array.isArray(payload) ? {} : payload.options;
  return processVideos(event, filePaths, options);
});

ipcMain.handle('save-settings', (_event, settings) => saveSettings(settings));
ipcMain.handle('get-settings', async () => ({ ...await loadSettings(), systemTempDirectory: os.tmpdir() }));
ipcMain.handle('get-initial-files', () => classifyVideoInputs(process.argv.slice(app.isPackaged ? 1 : 2)));
ipcMain.handle('get-quick-commands', (_event, filePaths) =>
  buildQuickCommands(process.execPath, app.getAppPath(), app.isPackaged, filePaths));
ipcMain.handle('copy-text', (_event, value) => {
  clipboard.writeText(String(value));
});

ipcMain.handle('install-context-menu', () => contextMenu.install(app));
ipcMain.handle('uninstall-context-menu', () => contextMenu.uninstall());

const quickArguments = quickArgumentIndex >= 0 ? process.argv.slice(quickArgumentIndex + 1) : [];
const quickFromContextMenu = quickArguments.includes('--from-context-menu');
let quickFrameCount = null;
let quickGifDuration = null;
let quickGifSamplingMode = null;
let quickGifPlaybackFps = null;
let quickGifExtractionFps = null;
let quickMaxVideos = null;
let quickOutputType = 'jpg';
const quickFilePaths = [];
for (let index = 0; index < quickArguments.length; index += 1) {
  const argument = quickArguments[index];
  if (argument === '--gif') {
    quickOutputType = 'gif';
  } else if (argument === '--jpg' || argument === '--no-gif') {
    quickOutputType = 'jpg';
  } else if (argument === '--frames') {
    quickFrameCount = Number(quickArguments[index + 1]);
    quickGifSamplingMode = 'count';
    index += 1;
  } else if (argument.startsWith('--frames=')) {
    quickFrameCount = Number(argument.slice('--frames='.length));
    quickGifSamplingMode = 'count';
  } else if (argument === '--gif-duration') {
    quickGifDuration = Number(quickArguments[index + 1]);
    quickGifSamplingMode = 'count';
    index += 1;
  } else if (argument.startsWith('--gif-duration=')) {
    quickGifDuration = Number(argument.slice('--gif-duration='.length));
    quickGifSamplingMode = 'count';
  } else if (argument === '--gif-every-second') {
    quickOutputType = 'gif';
    quickGifSamplingMode = 'per-second';
  } else if (argument === '--gif-fps') {
    quickOutputType = 'gif';
    quickGifSamplingMode = 'per-second';
    quickGifPlaybackFps = Number(quickArguments[index + 1]);
    index += 1;
  } else if (argument.startsWith('--gif-fps=')) {
    quickOutputType = 'gif';
    quickGifSamplingMode = 'per-second';
    quickGifPlaybackFps = Number(argument.slice('--gif-fps='.length));
  } else if (argument === '--gif-extract-fps') {
    quickOutputType = 'gif';
    quickGifSamplingMode = 'per-second';
    quickGifExtractionFps = Number(quickArguments[index + 1]);
    index += 1;
  } else if (argument.startsWith('--gif-extract-fps=')) {
    quickOutputType = 'gif';
    quickGifSamplingMode = 'per-second';
    quickGifExtractionFps = Number(argument.slice('--gif-extract-fps='.length));
  } else if (argument === '--max-videos') {
    quickMaxVideos = Number(quickArguments[index + 1]);
    index += 1;
  } else if (argument.startsWith('--max-videos=')) {
    quickMaxVideos = Number(argument.slice('--max-videos='.length));
  } else if (!argument.startsWith('--')) {
    quickFilePaths.push(argument);
  }
}

app.whenReady().then(async () => {
  if (miniMode) {
    if (!miniHasLock) return;
    if (await hasMainWindow(app.getPath('userData'))) {
      app.quit();
      return;
    }
    createMiniWindow();
    return;
  }
  if (quickArgumentIndex >= 0) {
    if (quickFilePaths.length === 0) {
      process.stderr.write('快速模式需要至少一个视频路径。\n');
      process.exit(1);
    }
    const savedSettings = await loadSettings();
    const showMiniWindow = (quickFromContextMenu ? savedSettings.miniOnContextMenu : savedSettings.miniOnQuickCommand)
      && !await hasMainWindow(app.getPath('userData'));
    const results = await processVideos(null, quickFilePaths, {
      ...normalizeJpgStyle(savedSettings),
      outputType: quickOutputType,
      frameCount: quickOutputType === 'jpg' ? quickFrameCount ?? savedSettings.frameCount : savedSettings.frameCount,
      gifFrameCount: quickOutputType === 'gif' ? quickFrameCount ?? savedSettings.gifFrameCount : savedSettings.gifFrameCount,
      gifMaxDurationSeconds: quickGifDuration ?? savedSettings.gifMaxDurationSeconds,
      gifSamplingMode: quickGifSamplingMode ?? savedSettings.gifSamplingMode,
      gifQualityMode: savedSettings.gifQualityMode,
      gifPlaybackFps: quickGifPlaybackFps ?? savedSettings.gifPlaybackFps,
      gifExtractionFps: quickGifExtractionFps ?? savedSettings.gifExtractionFps,
      maxVideos: quickMaxVideos ?? savedSettings.maxVideos,
      maxConcurrentVideos: savedSettings.maxConcurrentVideos,
      tempDirectory: savedSettings.tempDirectory,
      lowPriority: showMiniWindow ? savedSettings.miniLowPriority : savedSettings.lowPriority,
      showMiniWindow
    });
    if (results.length === 0) {
      process.stderr.write('未找到受支持的视频文件。\n');
      process.exit(1);
    }
    const failed = results.filter((result) => !result.success);
    if (failed.length > 0) {
      process.stderr.write(`有 ${failed.length} 个视频处理失败：\n`);
      for (const result of failed) {
        process.stderr.write(`- ${result.filePath}: ${result.error}\n`);
      }
      process.exit(1);
    }
    process.stdout.write(`已生成 ${results.length} 个 ${quickOutputType.toUpperCase()} 预览文件。\n`);
    process.exit(0);
  }

  await markMainWindow(app.getPath('userData'));
  const mainWindowHeartbeat = setInterval(() => {
    void markMainWindow(app.getPath('userData')).catch(() => {});
  }, 1000);
  app.on('before-quit', () => {
    clearInterval(mainWindowHeartbeat);
    try {
      fsSync.rmSync(path.join(app.getPath('userData'), 'main-windows', `${process.pid}.json`), { force: true });
    } catch { /* A stale marker expires after four seconds. */ }
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
