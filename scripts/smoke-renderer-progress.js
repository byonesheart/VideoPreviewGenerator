const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DEFAULT_JPG_STYLE } = require('../jpg-style');

class Element {
  constructor() {
    this.style = {};
    this.classList = { add() {}, remove() {} };
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.listeners = {};
    this.attributes = {};
  }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(...children) {
    this.children = children;
    this.textContent = children.map((child) => child.textContent).join('');
  }
  append(...children) { this.children = [...(this.children || []), ...children]; }
  appendChild(child) { this.append(child); }
}

async function main() {
  const root = path.join(__dirname, '..');
  const elements = new Map();
  const intervals = [];
  let jobs = [];
  let savedSettings;
  let copiedText;
  const videoPreview = {
    getSettings: async () => ({
      ...DEFAULT_JPG_STYLE,
      frameCount: 9, gifFrameCount: 9, gifMaxDurationSeconds: 20,
      gifSamplingMode: 'count', gifQualityMode: 'quality', gifPlaybackFps: 5, gifExtractionFps: 1,
      maxVideos: 100, maxConcurrentVideos: 5,
      tempDirectory: '', systemTempDirectory: 'C:\\Windows\\Temp', lowPriority: false
    }),
    selectTempDirectory: async () => 'D:\\frames-temp',
    saveSettings: async (settings) => { savedSettings = settings; },
    getInitialFiles: async () => [],
    getQuickCommands: async (paths) => ({
      jpg: `JPG ${paths.join(' ') || '<路径>'}`,
      gif: `GIF ${paths.join(' ') || '<路径>'}`,
      hasSelection: paths.length > 0
    }),
    copyText: async (value) => { copiedText = value; },
    getRecentLog: async () => '暂无处理日志',
    getActiveJobs: async () => jobs,
    onProgress(callback) { videoPreview.progress = callback; },
    onLogUpdate() {}
  };
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector);
      },
      createElement: () => new Element()
    },
    window: { videoPreview, addEventListener() {} },
    setInterval: (_callback, milliseconds) => intervals.push(milliseconds)
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'renderer.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('#jpg-info-controls').disabled, true);
  elements.get('#jpg-info-enabled').checked = true;
  await elements.get('#jpg-info-enabled').listeners.change();
  assert.equal(elements.get('#jpg-info-controls').disabled, false);
  assert.equal(savedSettings.jpgInfoEnabled, true);
  elements.get('#jpg-info-language').value = 'en';
  await elements.get('#jpg-info-language').listeners.change();
  assert.equal(savedSettings.jpgInfoLanguage, 'en');
  await elements.get('#choose-temp-directory').listeners.click();
  assert.equal(savedSettings.tempDirectory, 'D:\\frames-temp');
  await elements.get('#reset-temp-directory').listeners.click();
  assert.equal(savedSettings.tempDirectory, '');
  assert.equal(elements.get('#temp-directory').title, 'C:\\Windows\\Temp');
  elements.get('#low-priority').checked = true;
  await elements.get('#low-priority').listeners.change();
  assert.equal(savedSettings.lowPriority, true);
  assert.equal(elements.get('#gif-quality-mode').value, 'quality');
  elements.get('#gif-quality-mode').value = 'size';
  await elements.get('#gif-quality-mode').listeners.change();
  assert.equal(savedSettings.gifQualityMode, 'size');
  elements.get('#max-concurrent-videos').value = '3';
  await elements.get('#max-concurrent-videos').listeners.change();
  assert.equal(savedSettings.maxConcurrentVideos, 3);
  assert.ok(intervals.includes(500), '后台任务应至少每 500 毫秒刷新一次');
  assert.match(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), /backgroundThrottling:\s*false/);
  const html = fs.readFileSync(path.join(root, 'renderer.html'), 'utf8');
  assert.match(html, /id="work-page"/);
  assert.match(html, /id="settings-page"[^>]*hidden/);
  elements.get('#show-settings-page').listeners.click();
  assert.equal(elements.get('#work-page').hidden, true);
  assert.equal(elements.get('#settings-page').hidden, false);
  assert.equal(elements.get('#show-settings-page').attributes['aria-pressed'], 'true');
  elements.get('#show-work-page').listeners.click();
  assert.equal(elements.get('#work-page').hidden, false);
  assert.equal(elements.get('#settings-page').hidden, true);
  elements.get('#show-log-tab').listeners.click();
  assert.equal(elements.get('#progress-view').hidden, true);
  assert.equal(elements.get('#log-view').hidden, false);
  assert.equal(elements.get('#show-log-tab').attributes['aria-selected'], 'true');
  elements.get('#show-progress-tab').listeners.click();
  assert.equal(elements.get('#progress-view').hidden, false);
  assert.equal(elements.get('#log-view').hidden, true);

  jobs = [{
    outputType: 'gif', total: 1, index: 0, videoPercent: 85,
    stage: '编码 GIF', filePath: 'C:\\clip.mp4'
  }];
  await vm.runInContext('refreshBackgroundJobs()', context);
  assert.equal(elements.get('#progress-percent').textContent, '85%');
  assert.match(elements.get('#status-text').textContent, /clip\.mp4/);

  jobs = [{ outputType: 'jpg', total: 4, completed: 1, activePercent: 1.5,
    stage: '抽帧', filePath: 'C:\\parallel.mp4', videoPercent: 75 }];
  await vm.runInContext('refreshBackgroundJobs()', context);
  assert.equal(elements.get('#progress-percent').textContent, '63%');

  jobs = [];
  await vm.runInContext('refreshBackgroundJobs()', context);
  assert.equal(elements.get('#progress-percent').textContent, '100%');
  assert.match(elements.get('#status-text').textContent, /后台任务已结束/);
  context.inputs = [
    { path: 'C:\\folder1', type: 'folder' },
    { path: 'C:\\folder2', type: 'folder' },
    { path: 'C:\\direct.mp4', type: 'video' }
  ];
  vm.runInContext('addInputs(inputs)', context);
  assert.equal(elements.get('#file-count').textContent, '1 个视频，2 个文件夹');
  assert.equal(vm.runInContext('selectedInputs.length', context), 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.get('#jpg-command').value, /<软件安装路径>/);
  assert.match(elements.get('#jpg-command').value, /<视频或文件夹路径>/);
  assert.match(elements.get('#gif-command').value, /<视频或文件夹路径>/);
  assert.doesNotMatch(elements.get('#jpg-command').value, /C:\\folder1/);
  assert.match(elements.get('#jpg-command-status').textContent, /复制时会带入已选的 3 项/);
  await elements.get('#copy-gif-command').listeners.click();
  assert.equal(copiedText, 'GIF C:\\folder1 C:\\folder2 C:\\direct.mp4');
  assert.match(elements.get('#gif-command-status').textContent, /已复制 GIF/);
  assert.doesNotMatch(elements.get('#gif-command').value, /C:\\folder1/);
  await elements.get('#copy-jpg-command').listeners.click();
  assert.equal(copiedText, 'JPG C:\\folder1 C:\\folder2 C:\\direct.mp4');
  assert.doesNotMatch(elements.get('#jpg-command').value, /C:\\folder1/);
  elements.get('#clear-button').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.get('#jpg-command').value, /<视频或文件夹路径>/);
  const renderLog = vm.runInContext('renderLog', context);
  renderLog('[2026/9/26] 成功 1/2：a.mp4\n[2026/9/26] 失败 2/2：b.mp4；无法解码\n[2026/9/26] 处理结束：成功 1 个，失败 1 个。');
  const logRows = elements.get('#log-content').children;
  assert.equal(logRows[0].className, undefined);
  assert.equal(logRows[1].className, 'log-error');
  assert.equal(logRows[2].className, undefined);
  process.stdout.write('后台任务出现时立即显示，结束后从 85% 收到 100%。\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
