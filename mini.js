const jobsElement = document.querySelector('#jobs');
const summaryElement = document.querySelector('#summary');
const cancelAllButton = document.querySelector('#cancel-all');
const lowPriorityInput = document.querySelector('#low-priority');
const autoCloseInput = document.querySelector('#auto-close');
let refreshing = false;

function addText(parent, className, value) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function itemProgress(item) {
  if (!item.total) return item.status === 'scanning' ? 0 : 100;
  return Math.min(100, Math.round(100 * (item.done + (item.activePercent ??
    (item.status === 'processing' ? item.percent / 100 : 0))) / item.total));
}

function render(state) {
  lowPriorityInput.checked = state.lowPriority;
  autoCloseInput.checked = state.miniAutoClose;
  cancelAllButton.disabled = state.activeCount === 0;
  summaryElement.textContent = state.activeCount
    ? `正在运行 ${state.activeCount} 个任务；低优先级切换对之后启动的任务生效`
    : '当前没有正在运行的任务';
  jobsElement.replaceChildren();
  if (!state.jobs.length) {
    addText(jobsElement, 'empty', '等待视频处理任务…');
    return;
  }
  for (const job of state.jobs) {
    const card = document.createElement('section');
    card.className = 'job';
    addText(card, 'job-title', `${job.outputType?.toUpperCase() || 'JPG'} · ${job.completed ?? job.index ?? 0}/${job.total || 0} 个视频`);
    const items = Array.isArray(job.items) ? job.items : [];
    if (!items.length) addText(card, 'detail', job.stage || '正在扫描视频文件');
    items.forEach((item, inputIndex) => {
      const row = document.createElement('div');
      row.className = 'item';
      const head = document.createElement('div');
      head.className = 'item-head';
      const name = addText(head, 'name', item.path || '未知路径');
      name.title = item.path || '';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '终止';
      button.disabled = state.activeCount === 0 || ['scanning', 'cancelled', 'complete'].includes(item.status)
        || item.done >= item.total;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await window.miniPreview.cancel(job.id, inputIndex); }
        catch (error) { summaryElement.textContent = `终止失败：${error.message || error}`; button.disabled = false; }
      });
      head.append(button);
      row.append(head);
      addText(row, 'detail', `${item.type === 'folder' ? '文件夹' : item.type === 'input' ? '输入项' : '视频'} · ${item.status === 'scanning' ? '扫描中' : `${item.done}/${item.total}`} · ${item.status === 'cancelled' ? '已终止' : item.status === 'error' ? '失败' : item.status === 'processing' ? item.stage : '等待或已完成'}`);
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.value = itemProgress(item);
      row.append(bar);
      card.append(row);
    });
    jobsElement.append(card);
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { render(await window.miniPreview.state()); }
  catch (error) { summaryElement.textContent = `读取进度失败：${error.message || error}`; }
  finally { refreshing = false; }
}

cancelAllButton.addEventListener('click', async () => {
  cancelAllButton.disabled = true;
  try { await window.miniPreview.cancelAll(); }
  catch (error) { summaryElement.textContent = `终止失败：${error.message || error}`; }
  await refresh();
});
for (const [input, key] of [[lowPriorityInput, 'miniLowPriority'], [autoCloseInput, 'miniAutoClose']]) {
  input.addEventListener('change', async () => {
    try { await window.miniPreview.setToggle(key, input.checked); }
    catch (error) { summaryElement.textContent = `保存设置失败：${error.message || error}`; await refresh(); }
  });
}

void refresh();
setInterval(() => { void refresh(); }, 500);
