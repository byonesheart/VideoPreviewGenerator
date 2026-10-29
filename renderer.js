const chooseButton = document.querySelector('#choose-button');
const workPage = document.querySelector('#work-page');
const settingsPage = document.querySelector('#settings-page');
const showWorkPageButton = document.querySelector('#show-work-page');
const showSettingsPageButton = document.querySelector('#show-settings-page');
const chooseFolderButton = document.querySelector('#choose-folder-button');
const clearButton = document.querySelector('#clear-button');
const generateJpgButton = document.querySelector('#generate-jpg-button');
const generateGifButton = document.querySelector('#generate-gif-button');
const installContextButton = document.querySelector('#install-context-button');
const uninstallContextButton = document.querySelector('#uninstall-context-button');
const fileList = document.querySelector('#file-list');
const fileCount = document.querySelector('#file-count');
const progressBar = document.querySelector('#progress-bar');
const progressPercent = document.querySelector('#progress-percent');
const statusText = document.querySelector('#status-text');
const resultList = document.querySelector('#result-list');
const contextStatus = document.querySelector('#context-status');
const frameCountInput = document.querySelector('#frame-count');
const jpgInfoEnabledInput = document.querySelector('#jpg-info-enabled');
const jpgInfoControls = document.querySelector('#jpg-info-controls');
const jpgInfoLanguageInput = document.querySelector('#jpg-info-language');
const jpgInfoPositionInput = document.querySelector('#jpg-info-position');
const jpgInfoFontInput = document.querySelector('#jpg-info-font');
const jpgInfoFontSizeInput = document.querySelector('#jpg-info-font-size');
const jpgInfoColorInput = document.querySelector('#jpg-info-color');
const jpgInfoFields = {
  folder: document.querySelector('#jpg-info-folder'),
  filename: document.querySelector('#jpg-info-filename'),
  size: document.querySelector('#jpg-info-size'),
  resolution: document.querySelector('#jpg-info-resolution'),
  fps: document.querySelector('#jpg-info-fps'),
  duration: document.querySelector('#jpg-info-duration'),
  videoCodec: document.querySelector('#jpg-info-video-codec'),
  audioCodec: document.querySelector('#jpg-info-audio-codec'),
  subtitles: document.querySelector('#jpg-info-subtitles')
};
const jpgSizeUnitInput = document.querySelector('#jpg-size-unit');
const jpgCommentEnabledInput = document.querySelector('#jpg-comment-enabled');
const jpgCommentInput = document.querySelector('#jpg-comment');
const jpgTileBorderInput = document.querySelector('#jpg-tile-border');
const jpgTileBorderWidthInput = document.querySelector('#jpg-tile-border-width');
const jpgGrayscaleInput = document.querySelector('#jpg-grayscale');
const jpgOuterBorderInput = document.querySelector('#jpg-outer-border');
const jpgOuterBorderWidthInput = document.querySelector('#jpg-outer-border-width');
const jpgOuterBorderColorInput = document.querySelector('#jpg-outer-border-color');
const jpgBevelInput = document.querySelector('#jpg-bevel');
const jpgBevelWidthInput = document.querySelector('#jpg-bevel-width');
const gifFrameCountInput = document.querySelector('#gif-frame-count');
const gifMaxDurationInput = document.querySelector('#gif-max-duration');
const gifSamplingModeInput = document.querySelector('#gif-sampling-mode');
const gifQualityModeInput = document.querySelector('#gif-quality-mode');
const gifPlaybackFpsInput = document.querySelector('#gif-playback-fps');
const gifExtractionFpsInput = document.querySelector('#gif-extraction-fps');
const maxVideosInput = document.querySelector('#max-videos');
const maxConcurrentVideosInput = document.querySelector('#max-concurrent-videos');
const tempDirectoryInput = document.querySelector('#temp-directory');
const chooseTempDirectoryButton = document.querySelector('#choose-temp-directory');
const resetTempDirectoryButton = document.querySelector('#reset-temp-directory');
const lowPriorityInput = document.querySelector('#low-priority');
const miniOnContextMenuInput = document.querySelector('#mini-on-context-menu');
const miniOnQuickCommandInput = document.querySelector('#mini-on-quick-command');
const miniAutoCloseInput = document.querySelector('#mini-auto-close');
const miniCloseActionInput = document.querySelector('#mini-close-action');
let miniLowPriority = false;
const gifCountSettings = document.querySelector('#gif-count-settings');
const gifPerSecondSettings = document.querySelector('#gif-per-second-settings');
const logContent = document.querySelector('#log-content');
const showLogButton = document.querySelector('#show-log-button');
const clearLogButton = document.querySelector('#clear-log-button');
const backgroundJobs = document.querySelector('#background-jobs');
const progressView = document.querySelector('#progress-view');
const logView = document.querySelector('#log-view');
const showProgressTab = document.querySelector('#show-progress-tab');
const showLogTab = document.querySelector('#show-log-tab');
const jpgCommand = document.querySelector('#jpg-command');
const gifCommand = document.querySelector('#gif-command');
const copyJpgCommandButton = document.querySelector('#copy-jpg-command');
const copyGifCommandButton = document.querySelector('#copy-gif-command');
const commandStatuses = {
  jpg: document.querySelector('#jpg-command-status'),
  gif: document.querySelector('#gif-command-status')
};
let selectedInputs = [];
let isGenerating = false;
let videoPercents = [];
let hadBackgroundJobs = false;
let isPollingJobs = false;
let isPollingLog = false;

const exampleCommandPrefix = "& '<软件安装路径>\\视频九宫格预览生成器.exe' --quick";
jpgCommand.value = `${exampleCommandPrefix} --jpg '<视频或文件夹路径>'`;
gifCommand.value = `${exampleCommandPrefix} --gif '<视频或文件夹路径>'`;

function showPage(type) {
  const isSettings = type === 'settings';
  workPage.hidden = isSettings;
  settingsPage.hidden = !isSettings;
  showWorkPageButton.classList[isSettings ? 'remove' : 'add']('active');
  showSettingsPageButton.classList[isSettings ? 'add' : 'remove']('active');
  showWorkPageButton.setAttribute('aria-pressed', String(!isSettings));
  showSettingsPageButton.setAttribute('aria-pressed', String(isSettings));
}

function showInformationTab(type) {
  const isLog = type === 'log';
  progressView.hidden = isLog;
  logView.hidden = !isLog;
  showProgressTab.classList[isLog ? 'remove' : 'add']('active');
  showLogTab.classList[isLog ? 'add' : 'remove']('active');
  showProgressTab.setAttribute('aria-selected', String(!isLog));
  showLogTab.setAttribute('aria-selected', String(isLog));
  if (isLog) refreshLog();
}

function refreshQuickCommands() {
  const message = selectedInputs.length
    ? `仅显示示例路径；复制时会带入已选的 ${selectedInputs.length} 项，完成后自动退出。`
    : '仅显示示例路径；复制后请替换视频或文件夹路径，完成后自动退出。';
  for (const status of Object.values(commandStatuses)) status.textContent = message;
}

async function copyQuickCommand(outputType) {
  try {
    await window.videoPreview.saveSettings(getOptions());
    const commands = await window.videoPreview.getQuickCommands(selectedInputs.map((input) => input.path));
    await window.videoPreview.copyText(commands[outputType]);
    commandStatuses[outputType].textContent = commands.hasSelection
      ? `已复制 ${outputType.toUpperCase()} 指令，已带入所选项目的实际路径；页面仍只显示示例路径。`
      : `已复制 ${outputType.toUpperCase()} 指令；运行前请替换视频或文件夹示例路径。`;
  } catch (error) {
    commandStatuses[outputType].textContent = `复制失败：${error.message || error}`;
  }
}

function renderLog(content) {
  if (!content || content === '暂无处理日志') {
    logContent.textContent = '暂无处理日志';
    return;
  }
  const lines = content.split('\n');
  logContent.replaceChildren(...lines.map((line, index) => {
    const row = document.createElement('span');
    if (/^\[[^\]]+\]\s+失败\s+\d+\/\d+：/.test(line)) row.className = 'log-error';
    row.textContent = line + (index < lines.length - 1 ? '\n' : '');
    return row;
  }));
}

function fileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function folderName(filePath) {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join('\\') || '当前目录';
}

function renderFiles() {
  const folderCount = selectedInputs.filter((input) => input.type === 'folder').length;
  fileCount.textContent = `${selectedInputs.length - folderCount} 个视频，${folderCount} 个文件夹`;
  clearButton.disabled = selectedInputs.length === 0 || isGenerating;
  generateJpgButton.disabled = selectedInputs.length === 0 || isGenerating;
  generateGifButton.disabled = selectedInputs.length === 0 || isGenerating;
  chooseButton.disabled = isGenerating;
  chooseFolderButton.disabled = isGenerating;

  if (selectedInputs.length === 0) {
    fileList.className = 'file-list empty-state';
    fileList.innerHTML = `
      <div class="empty-icon">＋</div>
      <p>还没有选择视频</p>
      <span>支持 MP4、MKV、AVI、MOV、WMV、FLV、WebM、TS、M4V、MPEG、MPG</span>
    `;
    return;
  }

  fileList.className = 'file-list';
  const rows = selectedInputs.slice(0, 100).map(({ path: filePath, type: inputType }) => {
    const name = fileName(filePath);
    const extension = inputType === 'folder' ? '目录'
      : name.includes('.') ? name.split('.').pop().toUpperCase() : 'FILE';
    const row = document.createElement('div');
    row.className = 'file-row';

    const type = document.createElement('div');
    type.className = 'file-type';
    type.textContent = extension.slice(0, 4);

    const info = document.createElement('div');
    info.className = 'file-info';

    const nameElement = document.createElement('div');
    nameElement.className = 'file-name';
    nameElement.title = name;
    nameElement.textContent = name;

    const pathElement = document.createElement('div');
    pathElement.className = 'file-path';
    pathElement.title = inputType === 'folder' ? filePath : folderName(filePath);
    pathElement.textContent = inputType === 'folder'
      ? `含子文件夹；最多处理 ${maxVideosInput.value} 个视频 · ${filePath}`
      : folderName(filePath);

    info.append(nameElement, pathElement);
    row.append(type, info);
    return row;
  });
  if (selectedInputs.length > 100) {
    const more = document.createElement('div');
    more.className = 'file-row';
    more.textContent = `列表只显示前 100 项；共选择 ${selectedInputs.length} 项`;
    rows.push(more);
  }
  fileList.replaceChildren(...rows);
}

function addInputs(inputs) {
  const existing = new Set(selectedInputs.map((input) => input.path.toLowerCase()));
  for (const input of inputs) {
    if (input.type !== 'folder' && (input.type !== 'video' || !isVideoPath(input.path))) continue;
    if (!existing.has(input.path.toLowerCase())) {
      selectedInputs.push(input);
      existing.add(input.path.toLowerCase());
    }
  }
  renderFiles();
  refreshQuickCommands();
}

function isVideoPath(filePath) {
  return /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|mpeg|mpg|mts|m2ts)$/i.test(filePath);
}

function getOptions() {
  const normalize = (input, maxFrameCount, fallback) => {
    const count = Number.parseInt(input.value, 10);
    input.value = Number.isFinite(count) ? Math.min(maxFrameCount, Math.max(1, count)) : fallback;
    return Number(input.value);
  };
  const parsedDuration = Number(gifMaxDurationInput.value);
  const gifMaxDurationSeconds = Number.isFinite(parsedDuration) && parsedDuration > 0
    ? Math.min(1000, Math.max(0.1, Math.round(parsedDuration * 10) / 10))
    : 20;
  gifMaxDurationInput.value = gifMaxDurationSeconds;
  const parsedFps = Number(gifPlaybackFpsInput.value);
  const gifPlaybackFps = Number.isFinite(parsedFps) && parsedFps > 0
    ? Math.min(100, Math.max(0.1, Math.round(parsedFps * 10) / 10))
    : 5;
  gifPlaybackFpsInput.value = gifPlaybackFps;
  const extractionFps = normalize(gifExtractionFpsInput, 60, 1);
  const maxVideos = normalize(maxVideosInput, 10000, 100);
  const maxConcurrentVideos = normalize(maxConcurrentVideosInput, 32, 5);
  return {
    frameCount: normalize(frameCountInput, 36, 9),
    jpgInfoEnabled: jpgInfoEnabledInput.checked,
    jpgInfoLanguage: jpgInfoLanguageInput.value,
    jpgInfoFields: Object.entries(jpgInfoFields).filter(([, input]) => input.checked).map(([field]) => field),
    jpgSizeUnit: jpgSizeUnitInput.value,
    jpgInfoFont: jpgInfoFontInput.value,
    jpgInfoFontSize: Number(jpgInfoFontSizeInput.value),
    jpgInfoColor: jpgInfoColorInput.value,
    jpgInfoPosition: jpgInfoPositionInput.value,
    jpgCommentEnabled: jpgCommentEnabledInput.checked,
    jpgComment: jpgCommentInput.value,
    jpgTileBorder: jpgTileBorderInput.checked,
    jpgTileBorderWidth: Number(jpgTileBorderWidthInput.value),
    jpgGrayscale: jpgGrayscaleInput.checked,
    jpgOuterBorder: jpgOuterBorderInput.checked,
    jpgOuterBorderWidth: Number(jpgOuterBorderWidthInput.value),
    jpgOuterBorderColor: jpgOuterBorderColorInput.value,
    jpgBevel: jpgBevelInput.checked,
    jpgBevelWidth: Number(jpgBevelWidthInput.value),
    gifFrameCount: normalize(gifFrameCountInput, 1000, 9),
    gifMaxDurationSeconds,
    gifSamplingMode: gifSamplingModeInput.value,
    gifQualityMode: gifQualityModeInput.value,
    gifPlaybackFps,
    gifExtractionFps: extractionFps,
    maxVideos,
    maxConcurrentVideos,
    tempDirectory: tempDirectoryInput.value,
    lowPriority: lowPriorityInput.checked,
    miniLowPriority,
    miniOnContextMenu: miniOnContextMenuInput.checked,
    miniOnQuickCommand: miniOnQuickCommandInput.checked,
    miniAutoClose: miniAutoCloseInput.checked,
    miniCloseAction: miniCloseActionInput.value
  };
}

function updateGifControls() {
  const perSecond = gifSamplingModeInput.value === 'per-second';
  gifCountSettings.hidden = perSecond;
  gifPerSecondSettings.hidden = !perSecond;
}

function updateJpgControls() {
  jpgInfoControls.disabled = !jpgInfoEnabledInput.checked;
  jpgCommentInput.disabled = !jpgInfoEnabledInput.checked || !jpgCommentEnabledInput.checked;
}

async function initializeSettings() {
  const settings = await window.videoPreview.getSettings();
  frameCountInput.value = settings.frameCount;
  jpgInfoEnabledInput.checked = settings.jpgInfoEnabled;
  jpgInfoLanguageInput.value = settings.jpgInfoLanguage;
  jpgInfoPositionInput.value = settings.jpgInfoPosition;
  jpgInfoFontInput.value = settings.jpgInfoFont;
  jpgInfoFontSizeInput.value = settings.jpgInfoFontSize;
  jpgInfoColorInput.value = settings.jpgInfoColor;
  for (const [field, input] of Object.entries(jpgInfoFields)) input.checked = settings.jpgInfoFields.includes(field);
  jpgSizeUnitInput.value = settings.jpgSizeUnit;
  jpgCommentEnabledInput.checked = settings.jpgCommentEnabled;
  jpgCommentInput.value = settings.jpgComment;
  jpgTileBorderInput.checked = settings.jpgTileBorder;
  jpgTileBorderWidthInput.value = settings.jpgTileBorderWidth;
  jpgGrayscaleInput.checked = settings.jpgGrayscale;
  jpgOuterBorderInput.checked = settings.jpgOuterBorder;
  jpgOuterBorderWidthInput.value = settings.jpgOuterBorderWidth;
  jpgOuterBorderColorInput.value = settings.jpgOuterBorderColor;
  jpgBevelInput.checked = settings.jpgBevel;
  jpgBevelWidthInput.value = settings.jpgBevelWidth;
  updateJpgControls();
  gifFrameCountInput.value = settings.gifFrameCount;
  gifMaxDurationInput.value = settings.gifMaxDurationSeconds;
  gifSamplingModeInput.value = settings.gifSamplingMode;
  gifQualityModeInput.value = settings.gifQualityMode;
  gifPlaybackFpsInput.value = settings.gifPlaybackFps;
  gifExtractionFpsInput.value = settings.gifExtractionFps;
  maxVideosInput.value = settings.maxVideos;
  maxConcurrentVideosInput.value = settings.maxConcurrentVideos;
  tempDirectoryInput.value = settings.tempDirectory || '';
  tempDirectoryInput.placeholder = settings.systemTempDirectory || '系统临时目录';
  tempDirectoryInput.title = tempDirectoryInput.value || tempDirectoryInput.placeholder;
  lowPriorityInput.checked = settings.lowPriority === true;
  miniLowPriority = settings.miniLowPriority === true;
  miniOnContextMenuInput.checked = settings.miniOnContextMenu;
  miniOnQuickCommandInput.checked = settings.miniOnQuickCommand;
  miniAutoCloseInput.checked = settings.miniAutoClose;
  miniCloseActionInput.value = settings.miniCloseAction;
  updateGifControls();
}

async function getDroppedInputs(files) {
  const paths = [];
  for (const file of files) {
    const filePath = file.path || window.videoPreview.getPathForFile(file);
    if (filePath) paths.push(filePath);
  }
  return window.videoPreview.classifyVideoInputs(paths);
}

function setProgress(percent, text) {
  const safePercent = Math.max(0, Math.min(100, percent));
  progressBar.style.width = `${safePercent}%`;
  progressPercent.textContent = `${Math.round(safePercent)}%`;
  statusText.textContent = text;
}

function addResult({ filePath, status, error, outputPath, gifPath, gifFrameCount, gifDurationSeconds }) {
  const row = document.createElement('div');
  row.className = `result-row ${status}`;
  const dot = document.createElement('span');
  dot.className = 'result-dot';
  const name = document.createElement('span');
  name.className = 'result-name';
  const resultText = status === 'success'
    ? `已生成：${fileName(outputPath || gifPath)}${gifPath ? `（${gifFrameCount} 帧，约 ${gifDurationSeconds} 秒）` : ''}`
    : `处理失败：${fileName(filePath)}（${error}）`;
  name.title = error || fileName(filePath);
  name.textContent = resultText;
  row.append(dot, name);
  resultList.appendChild(row);
}

chooseButton.addEventListener('click', async () => {
  if (isGenerating) return;
  const files = await window.videoPreview.selectVideos();
  addInputs(files.map((filePath) => ({ path: filePath, type: 'video' })));
});

chooseFolderButton.addEventListener('click', async () => {
  if (isGenerating) return;
  try {
    const folders = await window.videoPreview.selectFolderVideos();
    addInputs(folders.map((filePath) => ({ path: filePath, type: 'folder' })));
    if (folders.length) statusText.textContent = `已添加 ${folders.length} 个文件夹；每个文件夹最多处理 ${maxVideosInput.value} 个视频`;
  } catch (error) {
    statusText.textContent = `读取文件夹失败：${error.message || error}`;
  }
});

frameCountInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
jpgInfoEnabledInput.addEventListener('change', () => {
  updateJpgControls();
  window.videoPreview.saveSettings(getOptions());
});
jpgCommentEnabledInput.addEventListener('change', () => {
  updateJpgControls();
  window.videoPreview.saveSettings(getOptions());
});
for (const input of [
  jpgInfoLanguageInput, jpgInfoPositionInput, jpgInfoFontInput, jpgInfoFontSizeInput,
  jpgInfoColorInput, ...Object.values(jpgInfoFields), jpgSizeUnitInput, jpgCommentInput,
  jpgTileBorderInput, jpgTileBorderWidthInput, jpgGrayscaleInput,
  jpgOuterBorderInput, jpgOuterBorderWidthInput, jpgOuterBorderColorInput,
  jpgBevelInput, jpgBevelWidthInput
]) input.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
gifFrameCountInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
gifMaxDurationInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
gifPlaybackFpsInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
gifQualityModeInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
gifExtractionFpsInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
maxVideosInput.addEventListener('change', () => {
  window.videoPreview.saveSettings(getOptions());
  renderFiles();
});
maxConcurrentVideosInput.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
gifSamplingModeInput.addEventListener('change', () => {
  updateGifControls();
  window.videoPreview.saveSettings(getOptions());
});
chooseTempDirectoryButton.addEventListener('click', async () => {
  try {
    const directory = await window.videoPreview.selectTempDirectory();
    if (!directory) return;
    tempDirectoryInput.value = directory;
    tempDirectoryInput.title = directory;
    await window.videoPreview.saveSettings(getOptions());
  } catch (error) {
    statusText.textContent = `设置临时图片目录失败：${error.message || error}`;
  }
});
resetTempDirectoryButton.addEventListener('click', async () => {
  tempDirectoryInput.value = '';
  tempDirectoryInput.title = tempDirectoryInput.placeholder;
  await window.videoPreview.saveSettings(getOptions());
});
lowPriorityInput.addEventListener('change', () => {
  miniLowPriority = lowPriorityInput.checked;
  window.videoPreview.saveSettings(getOptions());
});
for (const input of [miniOnContextMenuInput, miniOnQuickCommandInput, miniAutoCloseInput, miniCloseActionInput]) {
  input.addEventListener('change', () => window.videoPreview.saveSettings(getOptions()));
}

clearButton.addEventListener('click', () => {
  if (isGenerating) return;
  selectedInputs = [];
  resultList.innerHTML = '';
  setProgress(0, '等待开始');
  renderFiles();
  refreshQuickCommands();
});

copyJpgCommandButton.addEventListener('click', () => copyQuickCommand('jpg'));
copyGifCommandButton.addEventListener('click', () => copyQuickCommand('gif'));
showWorkPageButton.addEventListener('click', () => showPage('work'));
showSettingsPageButton.addEventListener('click', () => showPage('settings'));
showProgressTab.addEventListener('click', () => showInformationTab('progress'));
showLogTab.addEventListener('click', () => showInformationTab('log'));

window.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!isGenerating) fileList.classList.add('drag-over');
});

window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) fileList.classList.remove('drag-over');
});

window.addEventListener('drop', async (event) => {
  event.preventDefault();
  fileList.classList.remove('drag-over');
  if (isGenerating) return;

  try {
    const inputs = await getDroppedInputs(event.dataTransfer.files);
    if (inputs.length === 0) {
      statusText.textContent = '未识别到视频文件，请拖入受支持的视频或文件夹';
      return;
    }
    addInputs(inputs);
    showPage('work');
    statusText.textContent = `已添加 ${inputs.length} 个视频或文件夹，可继续拖入或开始生成`;
  } catch (error) {
    statusText.textContent = `读取拖入路径失败：${error.message || error}`;
  }
});

showLogButton.addEventListener('click', async () => {
  if (!await window.videoPreview.showLogFile()) statusText.textContent = '尚未生成日志文件';
});

clearLogButton.addEventListener('click', async () => {
  clearLogButton.disabled = true;
  try {
    if (await window.videoPreview.clearLog()) {
      renderLog('暂无处理日志');
    }
  } catch (error) {
    statusText.textContent = `清空日志失败：${error.message || error}`;
  } finally {
    clearLogButton.disabled = false;
    refreshLog();
  }
});

installContextButton.addEventListener('click', async () => {
  installContextButton.disabled = true;
  uninstallContextButton.disabled = true;
  contextStatus.textContent = '正在设置右键菜单…';
  try {
    const result = await window.videoPreview.installContextMenu();
    contextStatus.textContent = `已为文件夹和 ${result.extensions} 种视频格式设置 JPG、GIF 右键命令；Windows 11 请点击“显示更多选项”。`;
  } catch (error) {
    contextStatus.textContent = `设置失败：${error.message || error}`;
  } finally {
    installContextButton.disabled = false;
    uninstallContextButton.disabled = false;
  }
});

uninstallContextButton.addEventListener('click', async () => {
  installContextButton.disabled = true;
  uninstallContextButton.disabled = true;
  contextStatus.textContent = '正在移除右键菜单…';
  try {
    const result = await window.videoPreview.uninstallContextMenu();
    contextStatus.textContent = `已移除文件夹和 ${result.extensions} 种视频格式的右键菜单。`;
  } catch (error) {
    contextStatus.textContent = `移除失败：${error.message || error}`;
  } finally {
    installContextButton.disabled = false;
    uninstallContextButton.disabled = false;
  }
});

async function generate(outputType) {
  if (isGenerating || selectedInputs.length === 0) return;
  isGenerating = true;
  videoPercents = [];
  resultList.innerHTML = '';
  renderFiles();
  const folderCount = selectedInputs.filter((input) => input.type === 'folder').length;
  setProgress(0, `准备处理 ${folderCount} 个文件夹和 ${selectedInputs.length - folderCount} 个视频；每个文件夹最多 ${maxVideosInput.value} 个`);

  try {
    const options = { ...getOptions(), outputType };
    await window.videoPreview.saveSettings(options);
    const results = await window.videoPreview.generatePreviews({
      filePaths: selectedInputs.map((input) => input.path),
      options
    });
    renderLog(await window.videoPreview.getRecentLog());
    const successCount = results.filter((result) => result.success).length;
    const failedCount = results.length - successCount;
    setProgress(100, failedCount === 0
      ? `全部完成，共生成 ${successCount} 个 ${outputType.toUpperCase()} 文件`
      : `处理完成：成功 ${successCount} 个，失败 ${failedCount} 个`);
  } catch (error) {
    statusText.textContent = `生成失败：${error.message || error}`;
  } finally {
    isGenerating = false;
    renderFiles();
  }
}

generateJpgButton.addEventListener('click', () => generate('jpg'));
generateGifButton.addEventListener('click', () => generate('gif'));

window.videoPreview.onProgress((progress) => {
  const videoPercent = progress.videoPercent || 0;
  videoPercents[progress.index] = progress.status === 'processing' ? videoPercent : 100;
  const percent = videoPercents.reduce((sum, value) => sum + (value || 0), 0) / progress.total;

  if (progress.status === 'processing') {
    setProgress(percent, `正在处理第 ${progress.index + 1} / ${progress.total} 个：${fileName(progress.filePath)} · ${progress.stage || '处理中'} ${videoPercent}%`);
  } else {
    addResult(progress);
    setProgress(percent, progress.status === 'success'
      ? `已完成第 ${progress.index + 1} / ${progress.total} 个`
      : `第 ${progress.index + 1} 个处理失败`);
  }
});

function renderBackgroundJobs(jobs) {
  backgroundJobs.hidden = jobs.length === 0;
  backgroundJobs.replaceChildren(...jobs.map((job) => {
    const percent = job.total > 0
      ? Math.min(100, ((job.completed ?? job.index) + (job.activePercent ?? (job.videoPercent || 0) / 100)) / job.total * 100)
      : 0;
    const row = document.createElement('div');
    row.className = 'background-job';
    const label = document.createElement('div');
    label.className = 'background-job-label';
    label.textContent = `后台 ${job.outputType.toUpperCase()} · ${job.total ? `${Math.min(job.index + 1, job.total)}/${job.total}` : '扫描中'} · ${job.filePath ? fileName(job.filePath) : '准备中'} · ${job.stage} ${job.videoPercent || 0}%`;
    const track = document.createElement('div');
    track.className = 'background-job-track';
    const fill = document.createElement('div');
    fill.className = 'background-job-fill';
    fill.style.width = `${percent}%`;
    track.appendChild(fill);
    row.append(label, track);
    return row;
  }));
  if (jobs.length > 0 && !isGenerating) {
    const job = jobs[0];
    const percent = job.total > 0
      ? ((job.completed ?? job.index) + (job.activePercent ?? (job.videoPercent || 0) / 100)) / job.total * 100 : 0;
    setProgress(percent, `后台正在处理：${job.filePath ? fileName(job.filePath) : job.stage} · ${job.stage} ${job.videoPercent || 0}%`);
  } else if (jobs.length === 0 && hadBackgroundJobs && !isGenerating) {
    setProgress(100, '后台任务已结束；可查看处理日志确认结果');
  }
  hadBackgroundJobs = jobs.length > 0;
}

async function refreshBackgroundJobs() {
  if (isPollingJobs) return;
  isPollingJobs = true;
  try {
    renderBackgroundJobs(await window.videoPreview.getActiveJobs());
  } catch (error) {
    statusText.textContent = `读取后台任务失败：${error.message || error}`;
  } finally {
    isPollingJobs = false;
  }
}

async function refreshLog() {
  if (isPollingLog) return;
  isPollingLog = true;
  try {
    const content = await window.videoPreview.getRecentLog();
    if (logContent.textContent !== content) {
      const atBottom = logContent.scrollTop + logContent.clientHeight >= logContent.scrollHeight - 20;
      renderLog(content);
      if (atBottom) logContent.scrollTop = logContent.scrollHeight;
    }
  } catch (error) {
    statusText.textContent = `读取日志失败：${error.message || error}`;
  } finally {
    isPollingLog = false;
  }
}

window.videoPreview.onLogUpdate((message) => {
  const lines = logContent.textContent === '暂无处理日志'
    ? [] : logContent.textContent.split('\n');
  lines.push(`[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${message}`);
  renderLog(lines.slice(-100).join('\n'));
  logContent.scrollTop = logContent.scrollHeight;
});

renderFiles();
refreshQuickCommands();
initializeSettings();
window.videoPreview.getInitialFiles().then(addInputs);
refreshBackgroundJobs();
refreshLog();
setInterval(refreshBackgroundJobs, 500);
setInterval(refreshLog, 1000);
window.addEventListener('focus', refreshBackgroundJobs);
