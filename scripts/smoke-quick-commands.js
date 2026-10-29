const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildQuickCommands } = require('../quick-commands');

const packaged = buildQuickCommands(
  "C:\\Program Files\\视频工具's\\预览.exe", '', true,
  ["D:\\视频资料\\it's a clip.mp4", 'D:\\视频文件夹']
);
assert.equal(packaged.jpg,
  "& 'C:\\Program Files\\视频工具''s\\预览.exe' --quick --jpg 'D:\\视频资料\\it''s a clip.mp4' 'D:\\视频文件夹'");
assert.equal(packaged.gif,
  "& 'C:\\Program Files\\视频工具''s\\预览.exe' --quick --gif 'D:\\视频资料\\it''s a clip.mp4' 'D:\\视频文件夹'");
assert.equal(packaged.hasSelection, true);

const development = buildQuickCommands('C:\\Electron\\electron.exe', 'D:\\示例目录\\视频工具', false, []);
assert.equal(development.hasSelection, false);
assert.equal(development.jpg,
  "& 'C:\\Electron\\electron.exe' 'D:\\示例目录\\视频工具' --quick --jpg '<视频或文件夹路径>'");

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, '界面元素 ID 不应重复');
const jpgIndex = html.indexOf('<h2>JPG 设置</h2>');
const gifIndex = html.indexOf('<h2>GIF 设置</h2>');
const sharedIndex = html.indexOf('<h2>其他设置</h2>');
const jpgCommandIndex = html.indexOf('id="jpg-command"');
const gifCommandIndex = html.indexOf('id="gif-command"');
const fileIndex = html.indexOf('id="file-list"');
const progressIndex = html.indexOf('id="progress-view"');
const logIndex = html.indexOf('id="log-view"');
assert.ok(fileIndex >= 0 && fileIndex < progressIndex && progressIndex < logIndex && logIndex < jpgIndex);
assert.ok(jpgIndex < jpgCommandIndex && jpgCommandIndex < gifIndex);
assert.ok(gifIndex < gifCommandIndex && gifCommandIndex < sharedIndex);
assert.ok(sharedIndex < html.indexOf('<footer>'));
assert.match(html, /class="settings-side"[\s\S]*<h2>GIF 设置<\/h2>[\s\S]*<h2>其他设置<\/h2>/);
assert.match(html, /id="show-progress-tab"/);
assert.match(html, /id="show-log-tab"/);
assert.doesNotMatch(html, /class="hero"|VIDEO FRAME TOOL|class="subtitle"/);
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer.css'), 'utf8');
assert.match(css, /\.work-layout\s*\{[^}]*height:\s*clamp\(/);
assert.match(css, /\.file-list\s*\{[^}]*overflow-y:\s*auto/);
assert.match(css, /\.progress-scroll\s*\{[^}]*overflow-y:\s*auto/);
assert.match(css, /\.log-content\s*\{[^}]*overflow-y:\s*auto/);
assert.match(css, /\.settings-side\s*\{[^}]*display:\s*flex/);
assert.match(css, /\.settings-side \.shared-panel\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(html, /id="copy-jpg-command"/);
assert.match(html, /id="copy-gif-command"/);
process.stdout.write('快捷指令引号处理、示例路径及界面区域顺序正确。\n');
