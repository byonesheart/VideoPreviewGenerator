const fs = require('node:fs/promises');
const path = require('node:path');

const VIDEO_EXTENSIONS = [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', 'mpeg', 'mpg',
  'mts', 'm2ts'
];
const VIDEO_SUFFIXES = new Set(VIDEO_EXTENSIONS.map((extension) => `.${extension}`));
const pathOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function isVideoPath(filePath) {
  return VIDEO_SUFFIXES.has(path.extname(filePath).toLowerCase());
}

function sortVideoPaths(filePaths) {
  return [...new Map(filePaths.filter(isVideoPath).map((filePath) => [
    path.resolve(filePath).toLowerCase(), path.resolve(filePath)
  ])).values()].sort((first, second) => pathOrder.compare(first, second));
}

async function collectVideoPaths(inputPaths) {
  const found = [];

  async function visit(entryPath) {
    let entry;
    try {
      entry = await fs.lstat(entryPath);
    } catch {
      return;
    }
    if (entry.isDirectory()) {
      let children;
      try {
        children = await fs.readdir(entryPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (child.isDirectory() || child.isFile()) {
          await visit(path.join(entryPath, child.name));
        }
      }
    } else if (entry.isFile() && isVideoPath(entryPath)) {
      found.push(entryPath);
    }
  }

  for (const inputPath of inputPaths) await visit(inputPath);
  return sortVideoPaths(found);
}

async function classifyVideoInputs(inputPaths) {
  const inputs = [];
  const seen = new Set();
  for (const inputPath of inputPaths) {
    const resolved = path.resolve(inputPath);
    if (seen.has(resolved.toLowerCase())) continue;
    let entry;
    try {
      entry = await fs.lstat(resolved);
    } catch {
      continue;
    }
    if (entry.isDirectory() || (entry.isFile() && isVideoPath(resolved))) {
      inputs.push({ path: resolved, type: entry.isDirectory() ? 'folder' : 'video' });
      seen.add(resolved.toLowerCase());
    }
  }
  return inputs;
}

async function collectVideoSelections(inputPaths, maxPerFolder) {
  const inputs = await classifyVideoInputs(inputPaths);
  const selected = [];
  const seenVideos = new Set();
  const folders = [];
  const entries = [];
  const fileEntries = [];
  let skippedByLimit = 0;
  let duplicateCount = 0;

  for (const input of inputs) {
    const entryIndex = entries.length;
    const entry = { ...input, total: 0 };
    entries.push(entry);
    const candidates = input.type === 'folder'
      ? await collectVideoPaths([input.path]) : [input.path];
    const chosen = input.type === 'folder'
      ? candidates.slice(0, maxPerFolder) : candidates;
    if (input.type === 'folder') {
      folders.push({ path: input.path, found: candidates.length, chosen: chosen.length });
      skippedByLimit += candidates.length - chosen.length;
    }
    for (const filePath of chosen) {
      const key = filePath.toLowerCase();
      if (seenVideos.has(key)) {
        duplicateCount += 1;
      } else {
        seenVideos.add(key);
        selected.push(filePath);
        fileEntries.push(entryIndex);
        entry.total += 1;
      }
    }
  }

  return { filePaths: selected, fileEntries, entries, folders, skippedByLimit, duplicateCount };
}

module.exports = {
  VIDEO_EXTENSIONS, isVideoPath, sortVideoPaths, collectVideoPaths,
  classifyVideoInputs, collectVideoSelections
};
