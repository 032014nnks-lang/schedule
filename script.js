// State management
let state = {
    workStyle: 'office',
    calendarStatus: {}, // { "2024-04-15": "remote" }
    tasks: [], // { id, title, date, checked: false }
    links: [] // { id, title, url }
};

let currentDate = new Date();
let selectedTaskDate = null;

const WORK_STYLE_LABELS = {
    learning: 'LC',
    office: '本',
    remote: '在',
    holiday: '休'
};

// Elements
const elWorkStyleSelect = document.getElementById('work-style-select');
const elUrgentCount = document.getElementById('urgent-task-count');
const elCalendarTitle = document.getElementById('calendar-title');
const elCalendarDays = document.getElementById('calendar-days');

const elTodayTaskList = document.getElementById('today-task-list');
const elFutureTaskList = document.getElementById('future-task-list');
const elSelectedTaskGroup = document.getElementById('selected-task-group');
const elSelectedTaskTitle = document.getElementById('selected-task-title');
const elSelectedTaskList = document.getElementById('selected-task-list');
const elLinkList = document.getElementById('link-list');

const elImportStatus = document.getElementById('import-status');
const elPasteImportBtn = document.getElementById('paste-import-btn');

// Initialize
function init() {
    loadState();

    // 勤務形態は表示専用
    syncWorkStyleDisplay();
    elWorkStyleSelect.disabled = true;

    // Calendar navigation
    document.getElementById('prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    setupModals();
    setupTabs();
    setupPasteImport();

    renderCalendar();
    renderTasks();
    renderLinks();
}

function loadState() {
    const saved = localStorage.getItem('scheduleState');
    if (saved) {
        state = JSON.parse(saved);
        state.tasks = state.tasks || [];
        state.links = state.links || [];
        state.calendarStatus = state.calendarStatus || {};
    }
}

function saveState() {
    localStorage.setItem('scheduleState', JSON.stringify(state));
    updateUrgentCount();
}

function syncWorkStyleDisplay() {
    const todayStr = getLocalIsoDate(new Date());
    const todayStatus = state.calendarStatus[todayStr];
    if (todayStatus) {
        elWorkStyleSelect.value = todayStatus;
    } else {
        elWorkStyleSelect.value = state.workStyle || 'office';
    }
}

// Helpers
function getLocalIsoDate(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().split('T')[0];
}

function normalizeText(value) {
    return (value || '').replace(/[\s\u3000]/g, '');
}

function toHalfWidth(value) {
    return (value || '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function detectWorkStyleFromText(text) {
    const normalized = toHalfWidth(normalizeText(text));

    if (!normalized) {
        return 'holiday';
    }
    if (normalized.includes('ラーニングセンター')) {
        return 'learning';
    }
    if (normalized.includes('本社8階')) {
        return 'office';
    }
    if (normalized.includes('在宅')) {
        return 'remote';
    }

    return null;
}

function pickDominantNumber(values) {
    const counts = {};
    values.forEach((value) => {
        const key = String(value);
        counts[key] = (counts[key] || 0) + 1;
    });

    let winner = null;
    let maxCount = 0;
    Object.keys(counts).forEach((key) => {
        if (counts[key] > maxCount) {
            maxCount = counts[key];
            winner = Number(key);
        }
    });

    return winner;
}

function splitTableRows(rawText) {
    return rawText
        .split(/\r?\n/)
        .map((line) => line.split('\t').map((cell) => cell.trim()))
        .filter((row) => row.some((cell) => cell !== ''));
}

function findQaColumn(rows) {
    let headerRowIndex = -1;
    let qaColIndex = -1;

    rows.forEach((row, rowIndex) => {
        if (qaColIndex !== -1) {
            return;
        }
        row.forEach((cell, colIndex) => {
            const text = normalizeText(cell);
            if (text.includes('エントリー') && text.toUpperCase().includes('QA')) {
                headerRowIndex = rowIndex;
                qaColIndex = colIndex;
            }
        });
    });

    return { headerRowIndex, qaColIndex };
}

function parseDateToken(cell) {
    const normalized = toHalfWidth(normalizeText(cell));
    if (!normalized) {
        return null;
    }

    const ymd = normalized.match(/(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
    if (ymd) {
        return {
            type: 'ymd',
            year: Number(ymd[1]),
            month: Number(ymd[2]),
            day: Number(ymd[3])
        };
    }

    const md = normalized.match(/(\d{1,2})[\/\-月](\d{1,2})/);
    if (md) {
        return {
            type: 'md',
            month: Number(md[1]),
            day: Number(md[2])
        };
    }

    const d = normalized.match(/^(\d{1,2})(?:日|\(.+\))?$/);
    if (d) {
        return {
            type: 'd',
            day: Number(d[1])
        };
    }

    return null;
}

function extractDateTokenFromRow(row, qaColIndex) {
    const searchLimit = Math.min(row.length - 1, qaColIndex >= 0 ? qaColIndex : row.length - 1);
    let dayOnly = null;

    for (let i = 0; i <= searchLimit; i += 1) {
        const token = parseDateToken(row[i]);
        if (!token) {
            continue;
        }
        if (token.type === 'ymd' || token.type === 'md') {
            return token;
        }
        if (!dayOnly) {
            dayOnly = token;
        }
    }

    return dayOnly;
}

function extractScheduleFromPastedTable(rawText) {
    const rows = splitTableRows(rawText);
    if (rows.length === 0) {
        throw new Error('貼り付け内容が空です。');
    }

    const { headerRowIndex, qaColIndex } = findQaColumn(rows);
    if (headerRowIndex === -1 || qaColIndex === -1) {
        throw new Error('「エントリー（QA）」列が見つかりませんでした。');
    }

    const dataRows = rows.slice(headerRowIndex + 1);
    const parsedRows = [];

    dataRows.forEach((row) => {
        const qaText = row[qaColIndex] || '';
        const status = detectWorkStyleFromText(qaText);
        if (!status) {
            return;
        }

        const dateToken = extractDateTokenFromRow(row, qaColIndex);
        if (!dateToken) {
            return;
        }

        parsedRows.push({ status, dateToken });
    });

    if (parsedRows.length === 0) {
        throw new Error('日付行と勤務形態の組み合わせを抽出できませんでした。');
    }

    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const explicitYears = parsedRows
        .filter((row) => row.dateToken.type === 'ymd')
        .map((row) => row.dateToken.year);
    const explicitMonths = parsedRows
        .filter((row) => row.dateToken.type === 'ymd' || row.dateToken.type === 'md')
        .map((row) => row.dateToken.month);

    const inferredYear = pickDominantNumber(explicitYears) || currentYear;
    const inferredMonth = pickDominantNumber(explicitMonths) || currentMonth;

    const normalizedEntries = parsedRows
        .map((row) => {
            const token = row.dateToken;
            let year = inferredYear;
            let month = inferredMonth;
            let day = token.day;

            if (token.type === 'ymd') {
                year = token.year;
                month = token.month;
            } else if (token.type === 'md') {
                month = token.month;
            }

            if (month < 1 || month > 12 || day < 1 || day > 31) {
                return null;
            }

            return {
                year,
                month,
                day,
                status: row.status
            };
        })
        .filter(Boolean);

    if (normalizedEntries.length === 0) {
        throw new Error('有効な日付データを作成できませんでした。');
    }

    const dominantMonth = pickDominantNumber(normalizedEntries.map((entry) => entry.month)) || inferredMonth;
    const monthEntries = normalizedEntries.filter((entry) => entry.month === dominantMonth);
    const yearForMonth = pickDominantNumber(monthEntries.map((entry) => entry.year)) || inferredYear;

    const entries = {};
    monthEntries.forEach((entry) => {
        const dateKey = `${entry.year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`;
        entries[dateKey] = entry.status;
    });

    if (Object.keys(entries).length === 0) {
        throw new Error('対象月の勤務形態を抽出できませんでした。');
    }

    return {
        entries,
        year: yearForMonth,
        month: dominantMonth
    };
}

function applyImportedSchedule(result) {
    const { entries, year, month } = result;
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;

    Object.keys(state.calendarStatus).forEach((key) => {
        if (key.startsWith(prefix)) {
            delete state.calendarStatus[key];
        }
    });

    Object.keys(entries).forEach((dateKey) => {
        state.calendarStatus[dateKey] = entries[dateKey];
    });

    currentDate = new Date(year, month - 1, 1);
    syncWorkStyleDisplay();
    saveState();
    renderCalendar();
}

function setImportStatus(message, type) {
    if (!elImportStatus) {
        return;
    }
    elImportStatus.textContent = message;
    elImportStatus.classList.remove('success', 'error');
    if (type) {
        elImportStatus.classList.add(type);
    }
}

function setupPasteImport() {
    const pasteModal = document.getElementById('paste-modal');
    const pasteInput = document.getElementById('paste-input');
    const savePasteBtn = document.getElementById('save-paste');
    const cancelPasteBtn = document.getElementById('cancel-paste');

    if (!elPasteImportBtn || !pasteModal || !pasteInput || !savePasteBtn || !cancelPasteBtn) {
        return;
    }

    const closePasteModal = () => {
        pasteModal.classList.remove('active');
    };

    elPasteImportBtn.addEventListener('click', () => {
        pasteModal.classList.add('active');
        pasteInput.focus();
    });

    cancelPasteBtn.addEventListener('click', closePasteModal);

    savePasteBtn.addEventListener('click', () => {
        const rawText = pasteInput.value;
        setImportStatus('貼り付けデータを解析中です...', null);

        try {
            const result = extractScheduleFromPastedTable(rawText);
            applyImportedSchedule(result);
            setImportStatus(
                `${result.year}年${result.month}月の勤務形態を${Object.keys(result.entries).length}件取り込みました。`,
                'success'
            );
            pasteInput.value = '';
            closePasteModal();
        } catch (error) {
            console.error(error);
            setImportStatus(error.message || '取り込みに失敗しました。', 'error');
        }
    });

    window.addEventListener('click', (e) => {
        if (e.target === pasteModal) {
            closePasteModal();
        }
    });
}

// Calendar Logic
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    elCalendarTitle.textContent = `${year}年 ${month + 1}月`;
    elCalendarDays.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const todayStr = getLocalIsoDate(new Date());

    for (let i = 0; i < firstDay; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'day empty';
        elCalendarDays.appendChild(emptyDiv);
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const dayDate = new Date(year, month, i);
        const dayStr = getLocalIsoDate(dayDate);
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day';
        dayDiv.textContent = i;

        if (dayDate.getDay() === 0) {
            dayDiv.classList.add('sunday');
        }

        if (dayStr === todayStr) {
            dayDiv.classList.add('today');
        }
        if (dayStr === selectedTaskDate) {
            dayDiv.classList.add('selected-day');
        }

        const status = state.calendarStatus[dayStr];
        if (status) {
            dayDiv.dataset.status = status;
            dayDiv.classList.add('has-status');

            const label = document.createElement('span');
            label.className = 'day-status-label';
            label.textContent = WORK_STYLE_LABELS[status] || '';
            dayDiv.appendChild(label);
        }

        const indicator = document.createElement('div');
        indicator.className = 'day-indicator';
        dayDiv.appendChild(indicator);

        dayDiv.addEventListener('click', () => {
            selectedTaskDate = dayStr;
            renderCalendar();
            renderTasks();
        });

        elCalendarDays.appendChild(dayDiv);
    }
}

// Tasks Logic
function renderTasks() {
    const todayStr = getLocalIsoDate(new Date());

    elTodayTaskList.innerHTML = '';
    elFutureTaskList.innerHTML = '';
    if (elSelectedTaskList) {
        elSelectedTaskList.innerHTML = '';
    }

    state.tasks.forEach((task) => {
        const li = document.createElement('li');
        li.className = 'task-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.checked;
        checkbox.addEventListener('change', () => {
            task.checked = checkbox.checked;
            saveState();
            renderTasks();
        });

        const label = document.createElement('span');
        label.className = 'task-label';
        label.textContent = task.title;

        const dateSpan = document.createElement('span');
        dateSpan.className = 'task-date';
        if (task.date) {
            const parts = task.date.split('-');
            if (parts.length === 3) {
                dateSpan.textContent = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
            }
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'task-delete';
        delBtn.innerHTML = '&times;';
        delBtn.onclick = () => {
            state.tasks = state.tasks.filter((t) => t.id !== task.id);
            saveState();
            renderTasks();
        };

        li.appendChild(checkbox);
        li.appendChild(label);
        if (task.date) {
            li.appendChild(dateSpan);
        }
        li.appendChild(delBtn);

        if (task.date <= todayStr || !task.date) {
            elTodayTaskList.appendChild(li);
        } else {
            elFutureTaskList.appendChild(li);
        }

        if (selectedTaskDate && task.date === selectedTaskDate && elSelectedTaskList) {
            const selectedLi = li.cloneNode(true);
            const selectedCheckbox = selectedLi.querySelector('.task-checkbox');
            if (selectedCheckbox) {
                selectedCheckbox.addEventListener('change', () => {
                    task.checked = selectedCheckbox.checked;
                    saveState();
                    renderTasks();
                });
            }
            const selectedDelBtn = selectedLi.querySelector('.task-delete');
            if (selectedDelBtn) {
                selectedDelBtn.onclick = () => {
                    state.tasks = state.tasks.filter((t) => t.id !== task.id);
                    saveState();
                    renderTasks();
                };
            }
            elSelectedTaskList.appendChild(selectedLi);
        }
    });

    if (elSelectedTaskGroup && elSelectedTaskTitle) {
        if (selectedTaskDate) {
            const parts = selectedTaskDate.split('-');
            const month = Number(parts[1]);
            const day = Number(parts[2]);
            elSelectedTaskTitle.textContent = `${month}月${day}日のタスク`;
            elSelectedTaskGroup.style.display = '';
        } else {
            elSelectedTaskGroup.style.display = 'none';
        }
    }

    updateUrgentCount();
}

// Links Logic
function renderLinks() {
    elLinkList.innerHTML = '';
    state.links.forEach((link) => {
        const li = document.createElement('li');
        li.className = 'link-item';

        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.title;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';

        const delBtn = document.createElement('button');
        delBtn.className = 'task-delete';
        delBtn.innerHTML = '&times;';
        delBtn.onclick = () => {
            state.links = state.links.filter((l) => l.id !== link.id);
            saveState();
            renderLinks();
        };

        li.appendChild(a);
        li.appendChild(delBtn);
        elLinkList.appendChild(li);
    });
}

function updateUrgentCount() {
    const todayStr = getLocalIsoDate(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = getLocalIsoDate(tomorrowDate);

    const urgentTasks = state.tasks.filter(
        (t) => !t.checked && t.date && (t.date === todayStr || t.date === tomorrowStr)
    );

    elUrgentCount.textContent = urgentTasks.length;
}

function toggleGroup(groupId) {
    const groupElement = event.currentTarget.parentElement;
    groupElement.classList.toggle('collapsed');
}

window.toggleGroup = toggleGroup;

function setupTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });
}

function setupModals() {
    const taskModal = document.getElementById('task-modal');
    const linkModal = document.getElementById('link-modal');

    document.getElementById('add-task-btn').addEventListener('click', () => {
        document.getElementById('task-date').value = getLocalIsoDate(new Date());
        taskModal.classList.add('active');
    });
    document.getElementById('add-link-btn').addEventListener('click', () => {
        linkModal.classList.add('active');
    });

    const closeTask = () => taskModal.classList.remove('active');
    const closeLink = () => linkModal.classList.remove('active');

    document.getElementById('cancel-task').addEventListener('click', closeTask);
    document.getElementById('cancel-link').addEventListener('click', closeLink);

    document.getElementById('save-task').addEventListener('click', () => {
        const title = document.getElementById('task-title').value;
        const date = document.getElementById('task-date').value;
        if (title.trim() === '') {
            return;
        }

        state.tasks.push({
            id: Date.now().toString(),
            title: title.trim(),
            date,
            checked: false
        });

        saveState();
        renderTasks();

        document.getElementById('task-title').value = '';
        closeTask();
    });

    document.getElementById('save-link').addEventListener('click', () => {
        const title = document.getElementById('link-title').value;
        let url = document.getElementById('link-url').value;
        if (title.trim() === '' || url.trim() === '') {
            return;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `https://${url}`;
        }

        state.links.push({
            id: Date.now().toString(),
            title: title.trim(),
            url
        });

        saveState();
        renderLinks();

        document.getElementById('link-title').value = '';
        document.getElementById('link-url').value = '';
        closeLink();
    });

    window.addEventListener('click', (e) => {
        if (e.target === taskModal) {
            closeTask();
        }
        if (e.target === linkModal) {
            closeLink();
        }
    });
}

init();
