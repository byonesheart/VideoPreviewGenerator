function buildQuickCommands(executablePath, appPath, isPackaged, filePaths) {
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const paths = Array.isArray(filePaths) ? filePaths.filter((value) => typeof value === 'string' && value) : [];
  const targetPaths = paths.length ? paths : ['<视频或文件夹路径>'];
  const executable = `& ${quote(executablePath)}${isPackaged ? '' : ` ${quote(appPath)}`}`;
  const argumentsText = targetPaths.map(quote).join(' ');
  return {
    jpg: `${executable} --quick --jpg ${argumentsText}`,
    gif: `${executable} --quick --gif ${argumentsText}`,
    hasSelection: paths.length > 0
  };
}

module.exports = { buildQuickCommands };
