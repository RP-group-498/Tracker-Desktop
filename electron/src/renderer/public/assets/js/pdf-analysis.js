const { ipcRenderer } = require('electron');
const path = require('path');

// Configuration — API calls for time predictions go to FastAPI backend
const API_BASE_URL = 'http://localhost:8001/api/tasks';
const USER_ID = 'student_123';

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const pdfInput = document.getElementById('pdfInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const removeFileBtn = document.getElementById('removeFileBtn');
const taskDetailsForm = document.getElementById('taskDetailsForm');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeText = document.getElementById('analyzeText');
const analyzeSpinner = document.getElementById('analyzeSpinner');
const resultsCard = document.getElementById('resultsCard');

let selectedFile = null;
let currentInputMode = 'pdf';
let currentTaskData = null;
let isEditMode = false;
let hasUnsavedChanges = false;
let hasBeenSaved = false; // Track if tasks have been saved (one-time edit only)

// Format time in minutes to human-readable format
function formatTime(minutes) {
    if (minutes === 0 || !minutes) {
        return "0 minutes";
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0 && mins > 0) {
        const hourStr = hours === 1 ? "hour" : "hours";
        const minStr = mins === 1 ? "minute" : "minutes";
        return `${hours} ${hourStr} ${mins} ${minStr}`;
    } else if (hours > 0) {
        const hourStr = hours === 1 ? "hour" : "hours";
        return `${hours} ${hourStr}`;
    }
    else {
        const minStr = mins === 1 ? "minute" : "minutes";
        return `${mins} ${minStr}`;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupNavigation();
    setMinDate();
    setupTimeAdjustmentListeners();
});

// Set minimum date to today
function setMinDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('deadline').setAttribute('min', today);
}

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
    // Tab switching
    const tabLinks = document.querySelectorAll('.tab-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');

            // Update active link
            tabLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update active content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');

            // Update mode
            currentInputMode = tabId === 'pdfTab' ? 'pdf' : 'text';
        });
    });

    // Browse button
    browseBtn.addEventListener('click', () => {
        pdfInput.click();
    });

    // File input change
    pdfInput.addEventListener('change', (e) => {
        handleFileSelect(e.target.files[0]);
    });

    // Upload area click
    uploadArea.addEventListener('click', () => {
        pdfInput.click();
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');

        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            handleFileSelect(file);
        } else {
            showNotification('Please select a valid PDF file', 'error');
        }
    });

    // Remove file button
    removeFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFileSelection();
    });

    // Form submission
    taskDetailsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await analyzeTask();
    });
}

// Handle file selection
function handleFileSelect(file) {
    if (!file) return;

    if (file.type !== 'application/pdf') {
        showNotification('Please select a PDF file', 'error');
        return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    uploadArea.style.display = 'none';
    fileInfo.style.display = 'flex';
}

// Clear file selection
function clearFileSelection() {
    selectedFile = null;
    pdfInput.value = '';
    uploadArea.style.display = 'block';
    fileInfo.style.display = 'none';
}

// Analyze task
async function analyzeTask() {
    let analysisData = {
        deadline: document.getElementById('deadline').value,
        credits: parseInt(document.getElementById('credits').value),
        weight: parseInt(document.getElementById('weight').value)
    };

    // Input-specific validation
    if (currentInputMode === 'pdf') {
        if (!selectedFile) {
            showNotification('Please select a PDF file', 'error');
            return;
        }
        analysisData.pdfPath = selectedFile.path;
    } else {
        const textContent = document.getElementById('textContent').value.trim();
        if (!textContent) {
            showNotification('Please paste your task content', 'error');
            return;
        }
        analysisData.textContent = textContent;
    }

    // Common validation
    if (!analysisData.deadline || !analysisData.credits || !analysisData.weight) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    if (analysisData.credits < 1 || analysisData.credits > 4) {
        showNotification('Credits must be between 1 and 4', 'error');
        return;
    }

    if (analysisData.weight < 0 || analysisData.weight > 100) {
        showNotification('Weight must be between 0 and 100', 'error');
        return;
    }

    // Show loading state
    setLoadingState(true);
    resultsCard.style.display = 'none';

    // Reset save state for new analysis
    hasBeenSaved = false;
    hasUnsavedChanges = false;
    isEditMode = false;

    try {
        // Step 1: Analyze content via IPC → FastAPI /api/tasks/analyze
        const result = await ipcRenderer.invoke('analyze-pdf', analysisData);

        if (result && result.tasks && result.tasks.length > 0) {
            const taskData = result.tasks[0];
            currentTaskData = taskData;

            // Step 2: Get time predictions from FastAPI
            await getPredictionsFromAPI(taskData);

            displayResults(taskData);

            showNotification('Analysis completed successfully! You can now adjust times and save.', 'success');
        } else {
            throw new Error('No results returned from analysis');
        }
    } catch (error) {
        console.error('Analysis error:', error);
        const source = currentInputMode === 'pdf' ? 'PDF' : 'text content';
        showNotification(`Failed to analyze ${source}. Please try again.`, 'error');
    } finally {
        setLoadingState(false);
    }
}

// Get time predictions from API
async function getPredictionsFromAPI(taskData) {
    try {
        console.log('Calling /predict-batch API...');

        const subtasks = taskData.sub_tasks.map(subtask => {
            if (typeof subtask === 'object' && subtask.name) {
                return {
                    name: subtask.name,
                    ai_suggested_time: subtask.estimated_minutes || null
                };
            }
            return {
                name: subtask,
                ai_suggested_time: null
            };
        });

        const requestData = {
            user_id: USER_ID,
            main_task: {
                name: taskData.task_name || 'Assignment',
            },
            subtasks: subtasks
        };

        console.log('Request data:', requestData);

        const response = await fetch(`${API_BASE_URL}/predict-batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`API error! status: ${response.status}`);
        }

        const predictions = await response.json();
        console.log('API Response:', predictions);

        if (predictions.predictions && predictions.predictions.length > 0) {
            let totalEstimatedTime = 0;

            taskData.sub_tasks = taskData.sub_tasks.map((subtask, index) => {
                const prediction = predictions.predictions[index];

                let aiEstimateMinutes = 0;
                if (typeof subtask === 'object' && subtask.estimated_minutes) {
                    aiEstimateMinutes = subtask.estimated_minutes;
                }

                let finalTime;
                if (prediction.method === 'warm_start') {
                    finalTime = prediction.predicted_time;
                } else {
                    finalTime = aiEstimateMinutes;
                }

                totalEstimatedTime += finalTime;

                if (typeof subtask === 'object') {
                    return {
                        ...subtask,
                        estimated_minutes: finalTime,
                        ai_estimated_minutes: aiEstimateMinutes,
                        api_predicted_minutes: prediction.predicted_time,
                        confidence: prediction.confidence,
                        method: prediction.method
                    };
                } else {
                    return {
                        name: subtask,
                        estimated_minutes: finalTime,
                        ai_estimated_minutes: aiEstimateMinutes,
                        api_predicted_minutes: prediction.predicted_time,
                        confidence: prediction.confidence,
                        method: prediction.method
                    };
                }
            });

            taskData.total_estimated_time = totalEstimatedTime;
        }

        console.log('Updated task data with predictions');
    } catch (error) {
        console.error('Failed to get predictions from API:', error);
        showNotification('Time estimation unavailable - using default estimates', 'warning');
    }
}

// Display results
function displayResults(task) {
    document.getElementById('resultTaskName').textContent = task.task_name || 'N/A';
    document.getElementById('resultDaysLeft').textContent = task.metrics.days_left + ' days';
    document.getElementById('resultDifficulty').textContent = task.metrics.difficulty_rating + '/5';

    const priorityElement = document.getElementById('resultPriority');
    priorityElement.textContent = task.priority;
    priorityElement.className = 'info-value priority-badge ' + task.priority;

    const urgencyScore = task.mcdm_calculation.urgency_score;
    const impactScore = task.mcdm_calculation.impact_score;
    const difficultyScore = task.mcdm_calculation.difficulty_score;
    const finalScore = task.mcdm_calculation.final_weighted_score;

    document.getElementById('urgencyScore').textContent = urgencyScore;
    document.getElementById('urgencyBar').style.width = urgencyScore + '%';

    document.getElementById('impactScore').textContent = impactScore;
    document.getElementById('impactBar').style.width = impactScore + '%';

    document.getElementById('difficultyScore').textContent = difficultyScore;
    document.getElementById('difficultyBar').style.width = difficultyScore + '%';

    document.getElementById('finalScore').textContent = finalScore.toFixed(1);

    const subtasksList = document.getElementById('subtasksList');
    subtasksList.innerHTML = '';

    if (task.sub_tasks && task.sub_tasks.length > 0) {
        let totalSubtaskMinutes = 0;
        task.sub_tasks.forEach((subtask, index) => {
            const li = document.createElement('li');
            li.setAttribute('data-subtask-index', index);

            if (typeof subtask === 'object' && subtask.name) {
                let minutes = subtask.estimated_minutes;
                if (minutes === undefined || minutes === null) {
                    const hours = subtask.estimated_hours || 0;
                    minutes = hours * 60;
                }
                totalSubtaskMinutes += minutes;
                li.setAttribute('data-original-time', minutes);

                const timeStr = formatTime(minutes);

                let headerContent = `<strong>${subtask.name}</strong> <span class="subtask-time" style="color: #7c3aed; font-weight: 600;">(${timeStr})</span>`;

                if (subtask.confidence) {
                    const confidenceColor = subtask.confidence === 'HIGH' ? '#10b981' :
                                           subtask.confidence === 'MEDIUM' ? '#f59e0b' : '#ef4444';
                    headerContent += ` <span style="color: ${confidenceColor}; font-size: 0.85em;">[${subtask.confidence}]</span>`;
                }

                if (subtask.method) {
                    const estimateSource = subtask.method === 'warm_start' ? 'API Prediction' : 'AI Estimate';
                    const methodColor = subtask.method === 'warm_start' ? '#10b981' : '#6b7280';
                    headerContent += ` <span style="color: ${methodColor}; font-size: 0.8em; font-style: italic;">(${estimateSource})</span>`;
                }

                const headerDiv = document.createElement('div');
                headerDiv.className = 'subtask-header';
                headerDiv.innerHTML = headerContent;

                const minTime = Math.max(10, minutes - 20);
                const maxTime = minutes + 40;

                const adjustmentDiv = document.createElement('div');
                adjustmentDiv.className = 'time-adjustment';
                adjustmentDiv.innerHTML = `
                    <div class="slider-container">
                        <span class="slider-label">Adjust Time:</span>
                        <input type="range"
                               class="time-slider"
                               min="${minTime}"
                               max="${maxTime}"
                               step="10"
                               value="${minutes}"
                               data-subtask-index="${index}">
                        <span class="slider-value">${minutes} min</span>
                    </div>
                    <div class="time-comparison">
                        <span class="predicted-time">Predicted: ${minutes} min</span>
                        <span class="time-difference neutral">Difference: 0 min</span>
                    </div>
                `;

                li.appendChild(headerDiv);
                li.appendChild(adjustmentDiv);
            } else {
                li.textContent = subtask;
            }

            subtasksList.appendChild(li);
        });

        if (totalSubtaskMinutes > 0) {
            const totalLi = document.createElement('li');
            totalLi.setAttribute('id', 'totalTimeItem');
            const totalTimeStr = formatTime(totalSubtaskMinutes);
            totalLi.innerHTML = `<strong style="color: #7c3aed;">Total Estimated Time: ${totalTimeStr}</strong>`;
            totalLi.style.borderTop = '2px solid #7c3aed';
            totalLi.style.marginTop = '10px';
            totalLi.style.paddingTop = '10px';
            subtasksList.appendChild(totalLi);
        }

        const actionsDiv = document.getElementById('subtasksActions');
        if (actionsDiv) {
            actionsDiv.style.display = 'flex';
        }

        const adjustTimesBtn = document.getElementById('adjustTimesBtn');
        if (adjustTimesBtn) {
            adjustTimesBtn.style.display = 'inline-block';
            if (hasBeenSaved) {
                adjustTimesBtn.style.display = 'none';
            }
        }

        const saveAllTasksBtn = document.getElementById('saveAllTasksBtn');
        if (saveAllTasksBtn) {
            saveAllTasksBtn.style.display = 'none';
        }
        const cancelEditBtn = document.getElementById('cancelEditBtn');
        if (cancelEditBtn) {
            cancelEditBtn.style.display = 'none';
        }
    } else {
        subtasksList.innerHTML = '<li>No subtasks available</li>';
        document.getElementById('subtasksActions').style.display = 'none';
    }

    document.getElementById('taskDescription').textContent = task.task_description || 'No description available';

    resultsCard.style.display = 'block';
    setTimeout(() => {
        resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// Set loading state
function setLoadingState(isLoading) {
    analyzeBtn.disabled = isLoading;
    if (isLoading) {
        analyzeText.style.display = 'none';
        analyzeSpinner.style.display = 'inline-block';
    } else {
        analyzeText.style.display = 'inline';
        analyzeSpinner.style.display = 'none';
    }
}

// Show notification
function showNotification(message, type = 'info') {
    if (type === 'error') {
        alert('Error: ' + message);
    } else if (type === 'warning') {
        console.warn('Warning: ' + message);
    } else if (type === 'success') {
        console.log('Success: ' + message);
    } else {
        console.log('Info: ' + message);
    }
}

// Setup Time Adjustment Listeners
function setupTimeAdjustmentListeners() {
    const adjustTimesBtn = document.getElementById('adjustTimesBtn');
    const saveAllTasksBtn = document.getElementById('saveAllTasksBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    if (adjustTimesBtn) {
        adjustTimesBtn.addEventListener('click', toggleEditMode);
    }

    if (saveAllTasksBtn) {
        saveAllTasksBtn.addEventListener('click', saveAllTasks);
    }

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', cancelEdit);
    }
}

// Toggle Edit Mode
function toggleEditMode() {
    if (hasBeenSaved && !isEditMode) {
        showNotification('Tasks have already been saved. You cannot edit them again.', 'warning');
        return;
    }

    isEditMode = !isEditMode;
    const subtasksList = document.getElementById('subtasksList');
    const adjustTimesBtn = document.getElementById('adjustTimesBtn');
    const saveAllTasksBtn = document.getElementById('saveAllTasksBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    if (isEditMode) {
        subtasksList.classList.add('edit-mode');

        const adjustmentDivs = document.querySelectorAll('.time-adjustment');
        adjustmentDivs.forEach(div => {
            div.classList.add('active');
        });

        adjustTimesBtn.style.display = 'none';
        saveAllTasksBtn.style.display = 'inline-block';
        cancelEditBtn.style.display = 'inline-block';

        const sliders = document.querySelectorAll('.time-slider');
        sliders.forEach(slider => {
            slider.addEventListener('input', handleSliderChange);
        });
    } else {
        subtasksList.classList.remove('edit-mode');

        const adjustmentDivs = document.querySelectorAll('.time-adjustment');
        adjustmentDivs.forEach(div => {
            div.classList.remove('active');
        });

        adjustTimesBtn.style.display = 'inline-block';
        saveAllTasksBtn.style.display = 'none';
        cancelEditBtn.style.display = 'none';

        const sliders = document.querySelectorAll('.time-slider');
        sliders.forEach(slider => {
            slider.removeEventListener('input', handleSliderChange);
        });
    }
}

// Handle Slider Change
function handleSliderChange(event) {
    const slider = event.target;
    const newValue = parseInt(slider.value);
    const subtaskIndex = parseInt(slider.getAttribute('data-subtask-index'));

    const sliderValueSpan = slider.parentElement.querySelector('.slider-value');
    sliderValueSpan.textContent = `${newValue} min`;

    const listItem = document.querySelector(`li[data-subtask-index="${subtaskIndex}"]`);
    const originalTime = parseInt(listItem.getAttribute('data-original-time'));

    const timeSpan = listItem.querySelector('.subtask-time');
    timeSpan.textContent = `(${formatTime(newValue)})`;

    const timeComparisonDiv = slider.parentElement.parentElement.querySelector('.time-comparison');
    const predictedTimeSpan = timeComparisonDiv.querySelector('.predicted-time');
    predictedTimeSpan.textContent = `Predicted: ${originalTime} min`;

    const differenceSpan = timeComparisonDiv.querySelector('.time-difference');
    const difference = newValue - originalTime;

    if (difference > 0) {
        differenceSpan.className = 'time-difference positive';
        differenceSpan.textContent = `Difference: +${difference} min`;
    } else if (difference < 0) {
        differenceSpan.className = 'time-difference negative';
        differenceSpan.textContent = `Difference: ${difference} min`;
    } else {
        differenceSpan.className = 'time-difference neutral';
        differenceSpan.textContent = `Difference: 0 min`;
    }

    if (currentTaskData && currentTaskData.sub_tasks && currentTaskData.sub_tasks[subtaskIndex]) {
        currentTaskData.sub_tasks[subtaskIndex].user_selected_minutes = newValue;
    }

    hasUnsavedChanges = true;
    updateTotalTime();
}

// Update Total Time
function updateTotalTime() {
    let totalMinutes = 0;
    const sliders = document.querySelectorAll('.time-slider');

    sliders.forEach(slider => {
        totalMinutes += parseInt(slider.value);
    });

    const totalTimeItem = document.getElementById('totalTimeItem');
    if (totalTimeItem) {
        const totalTimeStr = formatTime(totalMinutes);
        totalTimeItem.innerHTML = `<strong style="color: #7c3aed;">Total Estimated Time: ${totalTimeStr}</strong>`;
    }
}

// Cancel Edit
function cancelEdit() {
    if (hasUnsavedChanges) {
        const confirmed = confirm('You have unsaved changes. Are you sure you want to cancel?');
        if (!confirmed) {
            return;
        }
    }

    const listItems = document.querySelectorAll('li[data-subtask-index]');
    listItems.forEach(listItem => {
        const originalTime = parseInt(listItem.getAttribute('data-original-time'));
        const subtaskIndex = parseInt(listItem.getAttribute('data-subtask-index'));
        const slider = listItem.querySelector('.time-slider');

        if (slider) {
            slider.value = originalTime;

            const sliderValueSpan = slider.parentElement.querySelector('.slider-value');
            sliderValueSpan.textContent = `${originalTime} min`;

            const timeSpan = listItem.querySelector('.subtask-time');
            timeSpan.textContent = `(${formatTime(originalTime)})`;

            const differenceSpan = listItem.querySelector('.time-difference');
            differenceSpan.className = 'time-difference neutral';
            differenceSpan.textContent = `Difference: 0 min`;
        }

        if (currentTaskData && currentTaskData.sub_tasks && currentTaskData.sub_tasks[subtaskIndex]) {
            currentTaskData.sub_tasks[subtaskIndex].user_selected_minutes = null;
        }
    });

    updateTotalTime();
    hasUnsavedChanges = false;
    toggleEditMode();
}

// Save All Tasks
async function saveAllTasks() {
    if (!currentTaskData) {
        showNotification('No task data available to save', 'error');
        return;
    }

    const predictions = currentTaskData.sub_tasks.map((subtask, index) => {
        const userSelectedTime = subtask.user_selected_minutes || subtask.estimated_minutes;

        return {
            subtask_text: subtask.name,
            subtask_number: index + 1,
            method: subtask.method || 'cold_start',
            predicted_time: subtask.estimated_minutes,
            user_estimate: userSelectedTime,
            confidence: subtask.confidence || 'MEDIUM',
            category: subtask.category || 'general'
        };
    });

    const requestData = {
        user_id: USER_ID,
        main_task: {
            name: currentTaskData.task_name,
            difficulty: currentTaskData.metrics.difficulty_rating,
            deadline: currentTaskData.metrics.deadline,
            days_left: currentTaskData.metrics.days_left,
            credits: currentTaskData.metrics.credits,
            weight: currentTaskData.metrics.percentage || currentTaskData.weight,
            final_mcdm_score: currentTaskData.mcdm_calculation.final_weighted_score,
            priority: currentTaskData.priority
        },
        predictions: predictions
    };

    console.log('Saving tasks:', requestData);

    const saveBtn = document.getElementById('saveAllTasksBtn');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const response = await fetch(`${API_BASE_URL}/save-tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`API error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Save response:', result);

        showNotification('Tasks saved successfully! Times are now locked and cannot be edited again.', 'success');
        hasUnsavedChanges = false;
        hasBeenSaved = true;

        isEditMode = true;
        toggleEditMode();

        const adjustTimesBtn = document.getElementById('adjustTimesBtn');
        if (adjustTimesBtn) {
            adjustTimesBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to save tasks:', error);
        showNotification('Failed to save tasks. Please try again.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}
