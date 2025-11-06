// DOM elements
const extractLogsBtn = document.getElementById('extractLogs');
const evaluateBtn = document.getElementById('evaluateBtn');
const exportBtn = document.getElementById('exportBtn');
const openDashboardBtn = document.getElementById('openDashboardBtn');
const logStatus = document.getElementById('logStatus');
const evaluationStatus = document.getElementById('evaluationStatus');
const results = document.getElementById('results');
const resultsContent = document.getElementById('resultsContent');
const logsPreview = document.getElementById('logsPreview');
const logsContent = document.getElementById('logsContent');
const apiEndpointInput = document.getElementById('apiEndpoint');
const hfApiKeyInput = document.getElementById('hfApiKey');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');

// Default API endpoint
const DEFAULT_API_ENDPOINT = 'https://harshitasuri-llm-eval-v3.hf.space';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  setupEventListeners();
});

function setupEventListeners() {
  extractLogsBtn.addEventListener('click', extractLogs);
  evaluateBtn.addEventListener('click', runEvaluation);
  exportBtn.addEventListener('click', exportResults);
  if (openDashboardBtn) openDashboardBtn.addEventListener('click', openDashboard);
  apiEndpointInput.addEventListener('input', () => {
    saveSettings();
  });

  saveApiKeyBtn.addEventListener('click', async () => {
    const key = hfApiKeyInput.value.trim();
    // save locally and inform background
    await chrome.runtime.sendMessage({ action: 'setApiKey', apiKey: key });
    chrome.storage.local.set({ hfApiKey: key });
    showStatus(logStatus, key ? '✅ API key saved (stored locally)' : '✅ API key cleared', 'success');
  });
}

function loadSavedSettings() {
  chrome.storage.local.get(['apiEndpoint', 'extractedLogs'], (data) => {
    if (data.apiEndpoint) {
      apiEndpointInput.value = data.apiEndpoint;
    } else {
      apiEndpointInput.value = DEFAULT_API_ENDPOINT;
    }
    
    if (data.extractedLogs) {
      displayLogsPreview(data.extractedLogs);
      evaluateBtn.disabled = false;
    }
    // load API key if present
    chrome.storage.local.get(['hfApiKey'], (d) => {
      if (d.hfApiKey) hfApiKeyInput.value = d.hfApiKey;
    });
  });
}

function saveSettings() {
  chrome.storage.local.set({
    apiEndpoint: apiEndpointInput.value || DEFAULT_API_ENDPOINT
  });
}

async function extractLogs() {
  extractLogsBtn.disabled = true;
  showStatus(logStatus, 'Extracting logs from current page...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
      // First ensure content script is injected
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (err) {
      console.log('Content script may already be injected:', err);
    }

    // Small delay to ensure content script is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now try to extract logs
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractLogs' });
    
    if (response && response.success) {
      const logs = response.logs;
      
      if (logs && logs.length > 0) {
        // Save logs to storage
        await chrome.storage.local.set({ extractedLogs: logs });
        
        displayLogsPreview(logs);
        showStatus(logStatus, `✅ Successfully extracted ${logs.length} log entries`, 'success');
        evaluateBtn.disabled = false;
      } else {
        showStatus(logStatus, '⚠️ No logs found on this page. Make sure you\'re on a page with chatbot logs.', 'warning');
      }
    } else {
      showStatus(logStatus, '❌ Failed to extract logs. Error: ' + (response?.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error extracting logs:', error);
    showStatus(logStatus, '❌ Error: ' + error.message, 'error');
  } finally {
    extractLogsBtn.disabled = false;
  }
}

function displayLogsPreview(logs) {
  logsPreview.classList.remove('hidden');
  logsContent.textContent = JSON.stringify(logs, null, 2);
}

async function runEvaluation() {
  evaluateBtn.disabled = true;
  showStatus(evaluationStatus, '🔄 Running evaluation...', 'info');
  results.classList.add('hidden');
  
  try {
    const data = await chrome.storage.local.get(['extractedLogs', 'apiEndpoint']);
    const logs = data.extractedLogs;
    const apiEndpoint = data.apiEndpoint || DEFAULT_API_ENDPOINT;
    
    if (!logs || logs.length === 0) {
      showStatus(evaluationStatus, '❌ No logs found. Please extract logs first.', 'error');
      evaluateBtn.disabled = false;
      return;
    }
    
    // First, run local analysis (uses HF embeddings if API key is saved)
    showStatus(evaluationStatus, '🔎 Running local analysis (similarity, toxicity, heuristics)...', 'info');
    const localAnalysis = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'analyzeLogs', logs }, (res) => resolve(res));
    });

    // Show intermediate local results immediately
    displayResults(localAnalysis);

    // Next, call the external evaluation endpoint (Spaces) if configured
    showStatus(evaluationStatus, '🌐 Calling external evaluation API (if available)...', 'info');
    const response = await chrome.runtime.sendMessage({
      action: 'evaluate',
      logs: logs,
      apiEndpoint: apiEndpoint
    });

    if (response.success) {
      // Merge external results with localAnalysis for a combined view
      const combined = { ...localAnalysis, external: response.results };
      displayResults(combined);
      showStatus(evaluationStatus, '✅ Evaluation completed successfully (local + external)!', 'success');
    } else {
      showStatus(evaluationStatus, '⚠️ External evaluation failed, showing local analysis. Error: ' + response.error, 'warning');
    }
  } catch (error) {
    console.error('Error running evaluation:', error);
    showStatus(evaluationStatus, '❌ Error: ' + error.message, 'error');
  } finally {
    evaluateBtn.disabled = false;
  }
}

function displayResults(evaluationResults) {
  results.classList.remove('hidden');
  
  if (!evaluationResults || Object.keys(evaluationResults).length === 0) {
    resultsContent.innerHTML = '<p>No evaluation results available.</p>';
    return;
  }
  
  let html = '';
  
  // Format results as metrics
  for (const [key, value] of Object.entries(evaluationResults)) {
    html += `
      <div class="metric">
        <div class="metric-name">${formatMetricName(key)}</div>
        <div class="metric-value">${formatValue(value)}</div>
        <div class="metric-description">${getMetricDescription(key)}</div>
      </div>
    `;
  }
  
  resultsContent.innerHTML = html;
}

function formatMetricName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

function formatValue(value) {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return value;
}

function getMetricDescription(metric) {
  const descriptions = {
    'accuracy': 'Overall accuracy of the chatbot responses',
    'response_time': 'Average response time in seconds',
    'user_satisfaction': 'User satisfaction score',
    'coherence': 'Response coherence score',
    'relevance': 'Response relevance score',
    'fluency': 'Response fluency score'
  };
  
  return descriptions[metric] || 'Evaluation metric';
}

async function exportResults() {
  try {
    // Export as CSV that matches the dashboard's expected columns: reference, model_name, response
    const stored = await chrome.storage.local.get(['extractedLogs']);
    const logs = stored.extractedLogs || [];

    if (!logs || logs.length === 0) {
      alert('No extracted logs to export. Please extract logs first.');
      return;
    }

    const csv = logsToCSV(logs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm-eval-dataset-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(logStatus, `✅ CSV exported (${logs.length} messages). Upload to the dashboard CSV tab.`, 'success');
  } catch (error) {
    console.error('Error exporting CSV:', error);
    alert('Failed to export CSV: ' + error.message);
  }
}

// Build CSV rows using user->assistant pairs where possible. Columns: reference, model_name, response
function logsToCSV(logs) {
  const rows = [];

  for (let i = 0; i < logs.length; i++) {
    const cur = logs[i];
    const next = logs[i + 1];

    // If current is user and next is assistant, use pair
    if (cur.role && cur.role.toLowerCase().includes('user') && next && next.role && next.role.toLowerCase().includes('assistant')) {
      rows.push({ reference: cur.content || '', model_name: next.metadata?.model || next.source || 'Chatbot', response: next.content || '' });
      i++; // skip next since consumed
      continue;
    }

    // If the message itself is assistant-only, include with empty reference
    if (cur.role && cur.role.toLowerCase().includes('assistant')) {
      rows.push({ reference: '', model_name: cur.metadata?.model || cur.source || 'Chatbot', response: cur.content || '' });
      continue;
    }
  }

  // Fallback: if rows is empty, create rows from any messages with empty reference
  if (rows.length === 0) {
    logs.forEach(l => {
      rows.push({ reference: '', model_name: l.metadata?.model || l.source || 'Chatbot', response: l.content || '' });
    });
  }

  // Produce CSV string
  const header = ['reference', 'model_name', 'response'];
  const escapeCell = (s) => {
    if (s === null || s === undefined) return '';
    const str = String(s);
    // Escape quotes
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  let csv = header.join(',') + '\n';
  rows.forEach(r => {
    csv += [escapeCell(r.reference), escapeCell(r.model_name), escapeCell(r.response)].join(',') + '\n';
  });
  return csv;
}

// Open the configured Hugging Face Space/dashboard in a new tab
function openDashboard() {
  const endpoint = apiEndpointInput.value && apiEndpointInput.value.trim() ? apiEndpointInput.value.trim() : DEFAULT_API_ENDPOINT;
  let url = endpoint;
  // If user provided a Space root, ensure it has protocol
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    chrome.tabs.create({ url });
    showStatus(logStatus, `🔗 Opening dashboard: ${url}`, 'info');
  } catch (err) {
    console.error('Failed to open dashboard tab:', err);
    showStatus(logStatus, '❌ Could not open dashboard tab. Please open manually: ' + url, 'error');
  }
}

function showStatus(element, message, type) {
  element.textContent = message;
  element.className = `status-message ${type}`;
}





