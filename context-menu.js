const { spawn } = require('node:child_process');
const { VIDEO_EXTENSIONS } = require('./video-files');
const REGISTRY_ROOT = 'HKCU\\Software\\Classes\\SystemFileAssociations';
const DIRECTORY_ROOT = 'HKCU\\Software\\Classes\\Directory\\shell';
const MENU_ITEMS = [
  { verb: 'VideoPreviewGridJpg', label: '生成 JPG 预览图', flag: '--jpg' },
  { verb: 'VideoPreviewGridGif', label: '生成 GIF 动图', flag: '--gif' }
];
const LEGACY_VERB = 'VideoPreviewGrid';

function keysFor(verb) {
  return [
    `${DIRECTORY_ROOT}\\${verb}`,
    `${REGISTRY_ROOT}\\video\\shell\\${verb}`,
    ...VIDEO_EXTENSIONS.map((extension) => `${REGISTRY_ROOT}\\.${extension}\\shell\\${verb}`)
  ];
}

function runReg(args, { allowMissing = false } = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn('reg.exe', args, { windowsHide: true });
    let stderr = '';
    process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0 || (allowMissing && code === 1)) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `注册表操作失败，退出码：${code}`));
    });
  });
}

function commandFor(app, flag) {
  const executable = process.execPath;
  return app.isPackaged
    ? `"${executable}" --quick --from-context-menu ${flag} "%1"`
    : `"${executable}" "${app.getAppPath()}" --quick --from-context-menu ${flag} "%1"`;
}

async function install(app) {
  if (process.platform !== 'win32') {
    throw new Error('右键菜单设置目前仅支持 Windows');
  }

  for (const key of keysFor(LEGACY_VERB)) {
    await runReg(['delete', key, '/f'], { allowMissing: true });
  }
  for (const item of MENU_ITEMS) {
    const command = commandFor(app, item.flag);
    for (const key of keysFor(item.verb)) {
      await runReg(['add', key, '/ve', '/d', item.label, '/f']);
      await runReg(['add', key, '/v', 'MUIVerb', '/d', item.label, '/f']);
      await runReg(['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f']);
      await runReg(['add', key, '/v', 'Icon', '/d', process.execPath, '/f']);
      await runReg(['add', `${key}\\command`, '/ve', '/d', command, '/f']);
    }
  }
  return { extensions: VIDEO_EXTENSIONS.length, commands: MENU_ITEMS.length };
}

async function uninstall() {
  if (process.platform !== 'win32') {
    throw new Error('右键菜单设置目前仅支持 Windows');
  }

  for (const verb of [LEGACY_VERB, ...MENU_ITEMS.map((item) => item.verb)]) {
    for (const key of keysFor(verb)) {
      await runReg(['delete', key, '/f'], { allowMissing: true });
    }
  }
  return { extensions: VIDEO_EXTENSIONS.length, commands: MENU_ITEMS.length };
}

module.exports = { install, uninstall };
