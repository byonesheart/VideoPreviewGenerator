const fs = require('node:fs');
const ffmpegPath = require('ffmpeg-static');

if (process.platform !== 'win32' || !ffmpegPath.toLowerCase().endsWith('.exe')) {
  process.stdout.write('当前平台无需修改 FFmpeg 控制台子系统。\n');
  process.exit(0);
}

const executable = fs.readFileSync(ffmpegPath);
if (executable.toString('ascii', 0, 2) !== 'MZ') {
  throw new Error('FFmpeg 不是有效的 Windows PE 文件');
}

const peOffset = executable.readUInt32LE(0x3c);
if (executable.readUInt32LE(peOffset) !== 0x00004550) {
  throw new Error('FFmpeg 的 PE 文件头无效');
}

const optionalHeaderOffset = peOffset + 24;
const optionalHeaderMagic = executable.readUInt16LE(optionalHeaderOffset);
if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
  throw new Error('FFmpeg 使用了不支持的 PE 可选头格式');
}

const subsystemOffset = optionalHeaderOffset + 68;
const subsystem = executable.readUInt16LE(subsystemOffset);
if (subsystem === 2) {
  process.stdout.write('FFmpeg 已处于无控制台窗口模式。\n');
  process.exit(0);
}
if (subsystem !== 3) {
  throw new Error(`FFmpeg 的 PE 子系统值异常：${subsystem}`);
}

executable.writeUInt16LE(2, subsystemOffset);
fs.writeFileSync(ffmpegPath, executable);
process.stdout.write('已禁用 FFmpeg 控制台窗口。\n');
