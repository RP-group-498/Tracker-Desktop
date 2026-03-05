const { ipcRenderer } = require('electron');

// Configuration — updated to point at FastAPI backend on port 8001
const API_BASE_URL = 'http://localhost:8001/api/tasks';
const USER_ID = 'student_123';

// State
let currentDate = new Date();
let tasks = [];
let currentFilter = 'all';

// Per-task timer state: { [taskId]: { segmentStart, accumulated, isPaused, timerInterval } }
const taskTimers = {};

// DOM Elements
const calendarDays = document.getElementById('calendarDays');
const currentMonthElement = document.getElementById('currentMonth');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const todoList = document.getElementById('todoList');
const emptyState = document.getElementById('emptyState');
const filterButtons = document.querySelectorAll('.filter-btn');

// Statistics elements
const highPriorityCount = document.getElementById('highPriorityCount');
const mediumPriorityCount = document.getElementById('mediumPriorityCount');
const lowPriorityCount = document.getElementById('lowPriorityCount');
const totalTasksCount = document.getElementById('totalTasksCount');

// Time estimation elements
const totalEstimatedTime = document.getElementById('totalEstimatedTime');

// Modal elements
const taskModal = document.getElementById('taskModal');
const closeModalBtn = document.getElementById('closeModal');
const modalDate = document.getElementById('modalDate');
const modalTaskList = document.getElementById('modalTaskList');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupNavigation();
    loadTasksFromAPI();
    renderCalendar();

    // Set up real-time polling to refresh tasks every 5 seconds
    setInterval(() => {
        loadTasksFromAPI(true); // Silent mode to reduce console spam
    }, 5000);
});

// Setup Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.getAttribute('data-page');
            ipcRenderer.send('navigate', page);
        });
    });
}

// Setup Event Listeners
function setupEventListeners() {
    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });

    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            renderTodoList();
        });
    });

    closeModalBtn.addEventListener('click', () => {
        taskModal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target === taskModal) {
            taskModal.style.display = 'none';
        }
    });

    modalTaskList.addEventListener('click', (e) => {
        const btn = e.target;
        const subtaskDescription = btn.dataset.subtaskDescription;
        if (!subtaskDescription) return;

        if (btn.classList.contains('start-task-btn')) {
            startTask(subtaskDescription);
        } else if (btn.classList.contains('pause-task-btn')) {
            pauseTask(subtaskDescription);
        } else if (btn.classList.contains('resume-task-btn')) {
            resumeTask(subtaskDescription);
        } else if (btn.classList.contains('mark-complete-btn')) {
            markTaskComplete(subtaskDescription);
        }
    });
}

// Load tasks from API
async function loadTasksFromAPI(silent = false) {
    try {
        if (!silent) console.log('Fetching tasks from API...');
        const response = await fetch(`${API_BASE_URL}/tasks/${USER_ID}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!silent) console.log('API Response:', data);

        tasks = data.tasks.map(task => {
            let priority = 'Medium';
            if (task.main_task && task.main_task.difficulty) {
                const difficulty = task.main_task.difficulty;
                if (difficulty >= 4) priority = 'High';
                else if (difficulty <= 2) priority = 'Low';
            }

            return {
                id: task.task_id,
                name: task.subtask || 'Unnamed Task',
                description: task.main_task ? task.main_task.name : '',
                category: task.category || 'general',
                predicted_time: task.predicted_time || 0,
                user_estimate: task.user_estimate,
                actual_time: task.actual_time,
                status: task.status || 'scheduled',
                time_allocation_date: task.time_allocation_date,
                created_date: task.created_date,
                completed_date: task.completed_date,
                confidence: task.confidence || 'UNKNOWN',
                method: task.method || 'unknown',
                priority: priority,
                predictedActiveStart: task.predictedActiveStart,
                predictedActiveEnd: task.predictedActiveEnd
            };
        });

        if (!silent) console.log(`Loaded ${tasks.length} tasks`);

        tasks.forEach(task => {
            if (task.status === 'in_progress' && !taskTimers[task.id]) {
                taskTimers[task.id] = {
                    segmentStart: Date.now(),
                    accumulated: 0,
                    isPaused: false,
                    timerInterval: setInterval(() => updateTimerDisplay(task.id), 1000)
                };
            } else if (task.status === 'paused' && !taskTimers[task.id]) {
                taskTimers[task.id] = {
                    segmentStart: null,
                    accumulated: 0,
                    isPaused: true,
                    timerInterval: null
                };
            } else if (task.status === 'completed' && taskTimers[task.id]) {
                clearInterval(taskTimers[task.id].timerInterval);
                delete taskTimers[task.id];
            }
        });

        renderTodoList();
        updateStatistics();
        renderCalendar();
        updateTimeEstimation();

    } catch (error) {
        console.error('Failed to load tasks from API:', error);
        showNotification('Failed to load tasks. Make sure the API is running at ' + API_BASE_URL, 'error');
    }
}

// Render Calendar
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    currentMonthElement.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    calendarDays.innerHTML = '';

    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const dayElement = createDayElement(day, year, month - 1, true);
        calendarDays.appendChild(dayElement);
    }

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();

        const dayElement = createDayElement(day, year, month, false, isToday);
        calendarDays.appendChild(dayElement);
    }

    const totalCells = calendarDays.children.length;
    const remainingCells = 42 - totalCells;

    for (let day = 1; day <= remainingCells; day++) {
        const dayElement = createDayElement(day, year, month + 1, true);
        calendarDays.appendChild(dayElement);
    }
}

// Create day element
function createDayElement(day, year, month, isOtherMonth = false, isToday = false) {
    const dayElement = document.createElement('div');
    dayElement.className = 'calendar-day';

    if (isOtherMonth) {
        dayElement.classList.add('other-month');
    }
    if (isToday) {
        dayElement.classList.add('today');
    }

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const tasksForDay = tasks.filter(task => {
        if (!task.time_allocation_date) return false;
        const taskDate = task.time_allocation_date.split('T')[0];
        return taskDate === dateStr;
    });

    if (tasksForDay.length > 0) {
        dayElement.classList.add('has-task');

        const hasFailed = tasksForDay.some(task => task.status === 'failed');
        const hasCompleted = tasksForDay.some(task => task.status === 'completed');

        if (hasFailed) {
            dayElement.classList.add('has-failed-task');
        } else if (hasCompleted) {
            dayElement.classList.add('has-completed-task');
        }

        dayElement.addEventListener('click', () => {
            showTasksForDate(dateStr, tasksForDay);
        });
    }

    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;

    if (tasksForDay.length > 0) {
        const taskCount = document.createElement('div');
        taskCount.className = 'task-count';

        const failedCount = tasksForDay.filter(t => t.status === 'failed').length;
        const completedCount = tasksForDay.filter(t => t.status === 'completed').length;

        if (failedCount > 0) {
            taskCount.style.backgroundColor = '#ef4444';
            taskCount.style.color = 'white';
            taskCount.textContent = `${failedCount} ✗`;
        } else if (completedCount === tasksForDay.length) {
            taskCount.style.backgroundColor = '#10b981';
            taskCount.style.color = 'white';
            taskCount.textContent = `${completedCount} ✓`;
        } else {
            taskCount.textContent = tasksForDay.length;
        }

        dayElement.appendChild(dayNumber);
        dayElement.appendChild(taskCount);
    } else {
        dayElement.appendChild(dayNumber);
    }

    return dayElement;
}

// Show tasks for a specific date in modal
function showTasksForDate(dateStr, tasksForDay) {
    const date = new Date(dateStr);
    const formattedDate = date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    modalDate.textContent = formattedDate;
    modalTaskList.innerHTML = '';

    tasksForDay.forEach(task => {
        const taskElement = createModalTaskElement(task);
        modalTaskList.appendChild(taskElement);
    });

    taskModal.style.display = 'block';
}

// Create modal task element
function createModalTaskElement(task) {
    const taskItem = document.createElement('div');
    const isFailed = task.status === 'failed';
    taskItem.className = `modal-task-item ${task.priority} ${isFailed ? 'failed' : ''}`;
    taskItem.setAttribute('data-task-id', task.id);

    const estimatedTime = task.user_estimate || task.predicted_time;
    const timeStr = formatTime(estimatedTime);
    const statusBadge = getStatusBadge(task.status);
    const isCompleted = task.status === 'completed';

    const activeWindowHtml = task.predictedActiveStart && task.predictedActiveEnd ? `
        <div class="modal-meta-item">
            <span class="meta-label">Active Window:</span>
            <span class="meta-value">${task.predictedActiveStart} - ${task.predictedActiveEnd}</span>
        </div>
    ` : '';

    let buttonHTML;
    let timerHTML = '';

    if (isCompleted) {
        buttonHTML = '<button class="btn-sm btn-success" disabled style="background-color:#10b981;border:none;color:white;cursor:default;">✓ Completed</button>';
    } else if (isFailed) {
        buttonHTML = '<button class="btn-sm btn-danger" disabled style="background-color:#ef4444;border:none;color:white;cursor:default;">✗ Failed</button>';
    } else {
        const timer = taskTimers[task.id];
        if (!timer) {
            buttonHTML = `<button class="btn-sm btn-primary start-task-btn" data-subtask-description="${task.name}">▶ Start</button>`;
        } else if (timer.isPaused) {
            timerHTML = `<span id="timer-${task.id}" style="font-size:0.85em;color:#f59e0b;font-weight:600;">${formatElapsed(timer.accumulated)}</span>`;
            buttonHTML = `
                <button class="btn-sm resume-task-btn" data-subtask-description="${task.name}" style="background-color:#f59e0b;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">▶ Resume</button>
                <button class="btn-sm mark-complete-btn" data-subtask-description="${task.name}" style="background-color:#10b981;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">✓ Complete</button>
            `;
        } else {
            const totalSecs = timer.accumulated + Math.floor((Date.now() - timer.segmentStart) / 1000);
            timerHTML = `<span id="timer-${task.id}" style="font-size:0.85em;color:#10b981;font-weight:600;">${formatElapsed(totalSecs)}</span>`;
            buttonHTML = `
                <button class="btn-sm pause-task-btn" data-subtask-description="${task.name}" style="background-color:#f59e0b;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">Pause</button>
                <button class="btn-sm mark-complete-btn" data-subtask-description="${task.name}" style="background-color:#10b981;border:none;color:white;padding:4px 10px;border-radius:4px;cursor:pointer;">✓ Complete</button>
            `;
        }
    }

    taskItem.innerHTML = `
        <div class="modal-task-header">
            <div class="modal-task-title ${isFailed ? 'failed-title' : ''}">${task.name}</div>
            ${timerHTML}
            ${buttonHTML}
            ${statusBadge}
        </div>
        ${task.description ? `<div class="modal-task-description"><strong>Main Task:</strong> ${task.description}</div>` : ''}
        <div class="modal-task-meta">
            <div class="modal-meta-item">
                <span class="meta-label">Category:</span>
                <span class="meta-value">${task.category}</span>
            </div>
            <div class="modal-meta-item">
                <span class="meta-label">Estimated Time:</span>
                <span class="meta-value">${timeStr}</span>
            </div>
            ${activeWindowHtml}
            <div class="modal-meta-item">
                <span class="meta-label">Confidence:</span>
                <span class="meta-value confidence-${task.confidence}">${task.confidence}</span>
            </div>
            <div class="modal-meta-item">
                <span class="meta-label">Method:</span>
                <span class="meta-value">${task.method}</span>
            </div>
            ${task.actual_time ? `
            <div class="modal-meta-item">
                <span class="meta-label">Actual Time:</span>
                <span class="meta-value">${formatTime(task.actual_time)}</span>
            </div>
            ` : ''}
        </div>
    `;

    return taskItem;
}

// Format elapsed seconds as MM:SS
function formatElapsed(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Update live timer display for a running task
function updateTimerDisplay(taskId) {
    const timer = taskTimers[taskId];
    if (!timer || timer.isPaused) return;

    const totalSecs = timer.accumulated + Math.floor((Date.now() - timer.segmentStart) / 1000);
    const timerEl = document.getElementById(`timer-${taskId}`);
    if (timerEl) {
        timerEl.textContent = formatElapsed(totalSecs);
    }
}

// Re-render a single task item in the modal in-place
function refreshModalTask(task) {
    const existing = document.querySelector(`.modal-task-item[data-task-id="${task.id}"]`);
    if (existing) {
        existing.replaceWith(createModalTaskElement(task));
    }
}

// Parse "02:13 PM" into a Date on the given dateStr
function parseActiveTime(timeStr, dateStr) {
    if (!timeStr || !dateStr) return null;
    const date = new Date(dateStr);
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    let hour24 = hours;
    if (period === 'PM' && hours !== 12) hour24 += 12;
    if (period === 'AM' && hours === 12) hour24 = 0;
    date.setHours(hour24, minutes, 0, 0);
    return date;
}

// Start task — validates active window then starts timer
async function startTask(subtaskDescription) {
    const task = tasks.find(t => t.name === subtaskDescription);
    if (!task) { showNotification('Task not found.', 'error'); return; }

    if (!task.time_allocation_date || !task.predictedActiveStart || !task.predictedActiveEnd) {
        showNotification('Task does not have an allocated time window.', 'error');
        return;
    }

    const now = new Date();
    const nowStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const startTime = parseActiveTime(task.predictedActiveStart, task.time_allocation_date);
    const endTime   = parseActiveTime(task.predictedActiveEnd,   task.time_allocation_date);

    if (now < startTime) {
        showNotification(`Active window hasn't started yet. Starts at: ${task.predictedActiveStart}. Now: ${nowStr}`, 'error');
        return;
    }
    if (now > endTime) {
        showNotification(`Active window has ended. Window was: ${task.predictedActiveStart} - ${task.predictedActiveEnd}. Now: ${nowStr}`, 'error');
        return;
    }

    const btn = document.querySelector(`button.start-task-btn[data-subtask-description="${subtaskDescription}"]`);
    if (btn) { btn.textContent = 'Starting...'; btn.disabled = true; }

    try {
        const response = await fetch(`${API_BASE_URL}/start-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtask: subtaskDescription, user_id: USER_ID })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        taskTimers[task.id] = {
            segmentStart: Date.now(),
            accumulated: 0,
            isPaused: false,
            timerInterval: setInterval(() => updateTimerDisplay(task.id), 1000)
        };

        task.status = 'in_progress';
        refreshModalTask(task);
        showNotification('Task started! Timer is running.', 'success');

    } catch (error) {
        console.error('Error starting task:', error);
        showNotification(`Error: ${error.message}`, 'error');
        if (btn) { btn.textContent = '▶ Start'; btn.disabled = false; }
    }
}

// Pause task — freezes timer, updates DB status to "paused"
async function pauseTask(subtaskDescription) {
    const task = tasks.find(t => t.name === subtaskDescription);
    if (!task) return;

    const timer = taskTimers[task.id];
    if (!timer || timer.isPaused) return;

    timer.accumulated += Math.floor((Date.now() - timer.segmentStart) / 1000);
    timer.isPaused = true;
    clearInterval(timer.timerInterval);
    timer.timerInterval = null;

    try {
        await fetch(`${API_BASE_URL}/pause-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtask: subtaskDescription, user_id: USER_ID })
        });
        task.status = 'paused';
    } catch (error) {
        console.error('Error updating pause status:', error);
    }

    refreshModalTask(task);
    showNotification('Task paused.', 'info');
}

// Resume task — restarts timer, updates DB status to "in_progress"
async function resumeTask(subtaskDescription) {
    const task = tasks.find(t => t.name === subtaskDescription);
    if (!task) return;

    const timer = taskTimers[task.id];
    if (!timer || !timer.isPaused) return;

    timer.segmentStart = Date.now();
    timer.isPaused = false;
    timer.timerInterval = setInterval(() => updateTimerDisplay(task.id), 1000);

    try {
        await fetch(`${API_BASE_URL}/resume-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtask: subtaskDescription, user_id: USER_ID })
        });
        task.status = 'in_progress';
    } catch (error) {
        console.error('Error updating resume status:', error);
    }

    refreshModalTask(task);
    showNotification('Task resumed.', 'info');
}

// Get status badge HTML
function getStatusBadge(status) {
    const badges = {
        'scheduled': '<span class="status-badge scheduled">Scheduled</span>',
        'in_progress': '<span class="status-badge in-progress">In Progress</span>',
        'completed': '<span class="status-badge completed">Completed</span>',
        'failed': '<span class="status-badge failed">⚠️ Failed - Time Expired</span>'
    };
    return badges[status] || '<span class="status-badge">Unknown</span>';
}

// Render Todo List
function renderTodoList() {
    let filteredTasks = tasks.filter(task => task.status !== 'completed');

    if (currentFilter !== 'all') {
        filteredTasks = filteredTasks.filter(task => task.priority === currentFilter);
    }

    filteredTasks.sort((a, b) => {
        if (!a.time_allocation_date) return 1;
        if (!b.time_allocation_date) return -1;
        return new Date(a.time_allocation_date) - new Date(b.time_allocation_date);
    });

    if (filteredTasks.length === 0) {
        todoList.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    todoList.innerHTML = '';

    filteredTasks.forEach(task => {
        const taskElement = createTodoElement(task);
        todoList.appendChild(taskElement);
    });
}

// Create todo element
function createTodoElement(task) {
    const todoItem = document.createElement('div');
    const isFailed = task.status === 'failed';
    todoItem.className = `todo-item ${task.priority} ${isFailed ? 'failed' : ''}`;

    const estimatedTime = task.user_estimate || task.predicted_time;
    const timeStr = formatTime(estimatedTime);
    const allocationDate = task.time_allocation_date
        ? formatDate(task.time_allocation_date.split('T')[0])
        : 'Not scheduled';

    const activeWindowInfo = task.predictedActiveStart && task.predictedActiveEnd ? `
        <div class="todo-meta-item">
            <span>🕒</span>
            <span>${task.predictedActiveStart} - ${task.predictedActiveEnd}</span>
        </div>
    ` : '';

    todoItem.innerHTML = `
        <div class="todo-header">
            <div class="todo-title ${isFailed ? 'failed-title' : ''}">${task.name}</div>
        </div>
        <div class="todo-meta">
            <div class="todo-meta-item">
                <span>📅</span>
                <span>${allocationDate}</span>
            </div>
            ${activeWindowInfo}
            <div class="todo-meta-item">
                <span>⏱️</span>
                <span>${timeStr}</span>
            </div>
            <div class="todo-meta-item">
                <span class="priority-badge ${task.priority}">${task.priority}</span>
            </div>
            <div class="todo-meta-item">
                <span class="confidence-badge ${task.confidence}">${task.confidence}</span>
            </div>
            ${isFailed ? '<div class="todo-meta-item"><span class="status-badge failed">⚠️ Time Window Expired</span></div>' : ''}
        </div>
        ${task.description ? `<div class="todo-description"><strong>Main Task:</strong> ${task.description}</div>` : ''}
    `;

    return todoItem;
}

// Mark task as complete — uses timer for actual_time
async function markTaskComplete(subtaskDescription) {
    const task = tasks.find(t => t.name === subtaskDescription);
    if (!task) { showNotification('Task not found.', 'error'); return; }

    const timer = taskTimers[task.id];
    if (!timer) {
        showNotification('You must start the task before completing it.', 'error');
        return;
    }

    const totalSeconds = timer.isPaused
        ? timer.accumulated
        : timer.accumulated + Math.floor((Date.now() - timer.segmentStart) / 1000);
    const actualTimeMinutes = Math.max(1, Math.round(totalSeconds / 60));
    const estimatedTime = task.user_estimate || task.predicted_time || 0;

    const buttons = document.querySelectorAll(`button[data-subtask-description="${subtaskDescription}"]`);
    buttons.forEach(btn => { btn.textContent = 'Saving...'; btn.disabled = true; btn.style.opacity = '0.7'; });

    try {
        const response = await fetch(`${API_BASE_URL}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtask: subtaskDescription, user_id: USER_ID, actual_time: actualTimeMinutes })
        });

        const result = await response.json();

        if (response.ok) {
            showNotification(`Task completed! Actual time: ${actualTimeMinutes} min (Estimated: ${estimatedTime} min)`, 'success');

            clearInterval(timer.timerInterval);
            delete taskTimers[task.id];

            task.status = 'completed';
            task.actual_time = actualTimeMinutes;

            refreshModalTask(task);
            await loadTasksFromAPI();
        } else {
            throw new Error(result.message || result.detail || 'Failed to mark task complete');
        }
    } catch (error) {
        console.error('Error marking task complete:', error);
        showNotification(`Error: ${error.message}`, 'error');
        buttons.forEach(btn => { btn.textContent = '✓ Complete'; btn.disabled = false; btn.style.opacity = '1'; });
    }
}

// Fetch available time from APDIS API
async function updateAvailableTime() {
    const availableTimeElement = document.getElementById('availableTime');
    if (!availableTimeElement) return;

    try {
        const response = await fetch(`${API_BASE_URL}/active-time/user/user_003`);

        if (!response.ok) throw new Error('Failed to fetch available time');

        const data = await response.json();
        const totalMinutes = data.total_predicted_minutes || 0;

        availableTimeElement.textContent = formatTime(totalMinutes);
    } catch (error) {
        console.error('Error fetching available time:', error);
        availableTimeElement.textContent = 'Unavailable';
    }
}

// Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format time
function formatTime(minutes) {
    if (!minutes || minutes === 0) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
}

// Update statistics
function updateStatistics() {
    const incompleteTasks = tasks.filter(t => t.status !== 'completed');
    const high = incompleteTasks.filter(t => t.priority === 'High').length;
    const medium = incompleteTasks.filter(t => t.priority === 'Medium').length;
    const low = incompleteTasks.filter(t => t.priority === 'Low').length;
    const total = incompleteTasks.length;

    highPriorityCount.textContent = high;
    mediumPriorityCount.textContent = medium;
    lowPriorityCount.textContent = low;
    totalTasksCount.textContent = total;
}

// Update time estimation
function updateTimeEstimation() {
    const incompleteTasks = tasks.filter(task => task.status !== 'completed');
    const totalMinutes = incompleteTasks.reduce((sum, task) => {
        const estimatedTime = task.user_estimate || task.predicted_time || 0;
        return sum + estimatedTime;
    }, 0);
    totalEstimatedTime.textContent = formatTime(totalMinutes);
}

// Show notification
function showNotification(message, type = 'info') {
    console.log(`${type}: ${message}`);
}

// Refresh tasks button (optional - can be called manually)
window.refreshTasks = loadTasksFromAPI;
