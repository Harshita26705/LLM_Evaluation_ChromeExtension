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
const sourceNameInput = document.getElementById('sourceName');

// Default API endpoint
const DEFAULT_API_ENDPOINT = 'https://llm-evaluation-dashboard.onrender.com/';
const LOCAL_DASHBOARD_URL = 'http://127.0.0.1:5000/';

function normalizeDashboardBaseUrl(rawEndpoint) {
  let base = (rawEndpoint || '').trim();
  if (!base) {
    return DEFAULT_API_ENDPOINT.replace(/\/+$/, '');
  }

  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  base = base.replace(/\/+$/, '');
  base = base.replace(/\/api\/evaluate$/i, '');
  base = base.replace(/\/evaluate$/i, '');
  return base;
}

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
  if (sourceNameInput) {
    sourceNameInput.addEventListener('input', () => {
      saveSettings();
    });
  }
}

function loadSavedSettings() {
  chrome.storage.local.get(['apiEndpoint', 'sourceName', 'extractedLogs'], (data) => {
    if (data.apiEndpoint) {
      apiEndpointInput.value = data.apiEndpoint;
    } else {
      apiEndpointInput.value = DEFAULT_API_ENDPOINT;
    }

    if (sourceNameInput) {
      sourceNameInput.value = data.sourceName || '';
    }
    
    if (data.extractedLogs) {
      displayLogsPreview(data.extractedLogs);
      evaluateBtn.disabled = false;
    }
  });
}

function saveSettings() {
  chrome.storage.local.set({
    apiEndpoint: apiEndpointInput.value || DEFAULT_API_ENDPOINT,
    sourceName: sourceNameInput ? sourceNameInput.value.trim() : ''
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
        showStatus(logStatus, `✅ Successfully extracted log entries`, 'success');
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
    const data = await chrome.storage.local.get(['extractedLogs', 'apiEndpoint', 'sourceName']);
    const logs = data.extractedLogs;
    const apiEndpoint = data.apiEndpoint || DEFAULT_API_ENDPOINT;
    const sourceName = (data.sourceName || '').trim();
    
    if (!logs || logs.length === 0) {
      showStatus(evaluationStatus, '❌ No logs found. Please extract logs first.', 'error');
      evaluateBtn.disabled = false;
      return;
    }
    
    // First, run local analysis (uses HF embeddings if API key is saved)
    showStatus(evaluationStatus, '🔎 Running local analysis (similarity, toxicity, heuristics)...', 'info');
    const localAnalysis = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'analyzeLogs', logs, sourceName }, (res) => resolve(res));
    });

    // Show intermediate local results immediately
    await displayResults(localAnalysis);

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
      await displayResults(combined);
      showStatus(evaluationStatus, '✅ Evaluation completed successfully!', 'success');
    } else {
      showStatus(evaluationStatus, '✅ Evaluation completed successfully!', 'success');
    }
  } catch (error) {
    console.error('Error running evaluation:', error);
    showStatus(evaluationStatus, '❌ Error: ' + error.message, 'error');
  } finally {
    evaluateBtn.disabled = false;
  }
}

async function displayResults(evaluationResults) {
  results.classList.remove('hidden');
  
  let html = '';
  
  // Calculate averages from the extracted logs
  const averageMetrics = await calculateAverageMetrics();
  
  if (averageMetrics) {
    // Display average metrics
    const metricsOrder = ['relevance', 'length_appropriateness', 'coherence', 'toxicity', 'bias', 'hallucination', 'average_score'];
    
    metricsOrder.forEach(metricKey => {
      if (averageMetrics[metricKey] !== undefined) {
        const displayValue = averageMetrics[metricKey].toFixed(2);
        const description = getMetricDescription(metricKey);
        
        html += `
          <div class="metric">
            <div class="metric-name">${formatMetricName(metricKey)}</div>
            <div class="metric-value">${displayValue}</div>
            <div class="metric-description">${description}</div>
          </div>
        `;
      }
    });
  } else if (evaluationResults && Object.keys(evaluationResults).length > 0) {
    // Fallback: Display individual evaluation metrics
    for (const [key, value] of Object.entries(evaluationResults)) {
      if (typeof value === 'number') {
        html += `
          <div class="metric">
            <div class="metric-name">${formatMetricName(key)}</div>
            <div class="metric-value">${formatValue(value)}</div>
            <div class="metric-description">${getMetricDescription(key)}</div>
          </div>
        `;
      }
    }
  } else {
    resultsContent.innerHTML = '<p>No evaluation results available.</p>';
    return;
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
    'relevance': 'How well the response addresses the question (0-1)',
    'length_appropriateness': 'Whether the response length is appropriate for the question (0-1)',
    'coherence': 'Logical consistency and clarity of responses (0-1)',
    'toxicity': 'Absence of harmful or offensive language (0-1, lower is better)',
    'bias': 'Absence of biased language or stereotypes (0-1, lower is better)',
    'hallucination': 'Risk of false or fabricated information (0-1, lower is better)',
    'overall_score': 'Weighted average of all metrics (0-1)',
    'average_score': 'Average score across all evaluation metrics (0-1)'
  };
  
  return descriptions[metric] || 'Evaluation metric';
}

async function calculateAverageMetrics() {
  return new Promise(resolve => {
    chrome.storage.local.get(['extractedLogs'], (data) => {
      if (!data.extractedLogs || !Array.isArray(data.extractedLogs) || data.extractedLogs.length === 0) {
        resolve(null);
        return;
      }

      try {
        const logs = data.extractedLogs;
        
        let totalRelevance = 0;
        let totalLengthAppropriateness = 0;
        let totalCoherence = 0;
        let totalToxicity = 0;
        let totalBias = 0;
        let totalHallucination = 0;
        let totalOverallScore = 0;
        let count = 0;
        
        // Pair user-assistant messages and calculate metrics for each
        for (let i = 0; i < logs.length; i++) {
          const cur = logs[i];
          
          if (cur.role && cur.role.toLowerCase().includes('user')) {
            let responseText = '';
            
            // Find next assistant message
            if (logs[i + 1] && logs[i + 1].role && logs[i + 1].role.toLowerCase().includes('assistant')) {
              responseText = logs[i + 1].content || '';
              i++; // consume assistant
            } else {
              // scan forward for an assistant reply
              for (let j = i + 1; j < Math.min(logs.length, i + 6); j++) {
                if (logs[j].role && logs[j].role.toLowerCase().includes('assistant')) {
                  responseText = logs[j].content || '';
                  i = j;
                  break;
                }
              }
            }
            
            if (responseText) {
              const metrics = computeDetailedMetrics(cur.content || '', responseText);
              totalRelevance += metrics.relevance;
              totalLengthAppropriateness += metrics.lengthAppropriateness;
              totalCoherence += metrics.coherence;
              totalToxicity += metrics.toxicity;
              totalBias += metrics.bias;
              totalHallucination += metrics.hallucination;
              totalOverallScore += metrics.overallScore;
              count++;
            }
          }
        }
        
        if (count === 0) {
          resolve(null);
          return;
        }
        
        resolve({
          relevance: totalRelevance / count,
          length_appropriateness: totalLengthAppropriateness / count,
          coherence: totalCoherence / count,
          toxicity: totalToxicity / count,
          bias: totalBias / count,
          hallucination: totalHallucination / count,
          average_score: totalOverallScore / count
        });
      } catch (error) {
        console.error('Error calculating average metrics:', error);
        resolve(null);
      }
    });
  });
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

// Build CSV rows using user->assistant pairs where possible. Columns: Id, timestamp, question, response, Relevance, Length appropriateness, Coherence, Toxicity, Bias, Hallucination, Overall Score
function logsToCSV(logs) {
  const rows = [];
  let idCounter = 1;

  for (let i = 0; i < logs.length; i++) {
    const cur = logs[i];

    // If current is user, attempt to find the next assistant message
    if (cur.role && cur.role.toLowerCase().includes('user')) {
      let responseText = '';
      let responseTimestamp = '';
      
      // Find next assistant message (prefer immediate next)
      if (logs[i + 1] && logs[i + 1].role && logs[i + 1].role.toLowerCase().includes('assistant')) {
        responseText = logs[i + 1].content || '';
        responseTimestamp = logs[i + 1].timestamp || '';
        i++; // consume assistant
      } else {
        // scan forward a few messages for an assistant reply
        for (let j = i + 1; j < Math.min(logs.length, i + 6); j++) {
          if (logs[j].role && logs[j].role.toLowerCase().includes('assistant')) {
            responseText = logs[j].content || '';
            responseTimestamp = logs[j].timestamp || '';
            i = j; // mark those entries as consumed
            break;
          }
        }
      }

      // Compute detailed evaluation metrics for this pair
      const metrics = computeDetailedMetrics(cur.content || '', responseText);

      rows.push({
        Id: idCounter++,
        timestamp: cur.timestamp || responseTimestamp || new Date().toISOString(),
        question: cur.content || '',
        response: responseText || '',
        relevance: metrics.relevance,
        length_appropriateness: metrics.lengthAppropriateness,
        coherence: metrics.coherence,
        toxicity: metrics.toxicity,
        bias: metrics.bias,
        hallucination: metrics.hallucination,
        overall_score: metrics.overallScore
      });
      continue;
    }

    // If current is assistant and previous wasn't user (or standalone assistant), skip
    if (cur.role && cur.role.toLowerCase().includes('assistant')) {
      continue;
    }
  }

  // Filter: only include rows with both question and response present and non-empty
  const validRows = rows.filter(r => 
    r.question && r.question.trim() && 
    r.response && r.response.trim()
  );

  // Sanitize: remove emoji/Unicode corruption characters and prefixes from text fields
  validRows.forEach(r => {
    r.question = stripPrefixes(sanitizeText(r.question), 'question');
    r.response = stripPrefixes(sanitizeText(r.response), 'response');
    r.timestamp = r.timestamp ? sanitizeText(r.timestamp) : '';
  });

  // Re-index after filtering
  validRows.forEach((r, idx) => {
    r.Id = idx + 1;
  });

  // Produce CSV string
  const header = ['Id', 'timestamp', 'question', 'response', 'Relevance', 'Length appropriateness', 'Coherence', 'Toxicity', 'Bias', 'Hallucination', 'Overall Score'];
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
  validRows.forEach(r => {
    csv += [
      escapeCell(r.Id), 
      escapeCell(r.timestamp), 
      escapeCell(r.question), 
      escapeCell(r.response), 
      escapeCell(r.relevance.toFixed(2)),
      escapeCell(r.length_appropriateness.toFixed(2)),
      escapeCell(r.coherence.toFixed(2)),
      escapeCell(r.toxicity.toFixed(2)),
      escapeCell(r.bias.toFixed(2)),
      escapeCell(r.hallucination.toFixed(2)),
      escapeCell(r.overall_score.toFixed(2))
    ].join(',') + '\n';
  });
  return csv;
}

// Open the configured Hugging Face Space/dashboard in a new tab
function computeDetailedMetrics(question, response) {
  if (!question || !response) {
    return {
      relevance: 0,
      lengthAppropriateness: 0,
      coherence: 0,
      toxicity: 0,
      bias: 0,
      hallucination: 0,
      overallScore: 0
    };
  }

  // 1. Relevance: Check if response contains key terms from question (0-1)
  const qWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const rWords = new Set(response.toLowerCase().split(/\s+/));
  const relevantWords = qWords.filter(w => rWords.has(w)).length;
  const relevance = qWords.length > 0 ? relevantWords / qWords.length : 0.5;

  // 2. Length appropriateness: Response should be substantive (0-1)
  const responseLength = response.trim().length;
  const questionLength = question.trim().length;
  let lengthAppropriateness = 0;
  if (responseLength > questionLength * 0.5 && responseLength > 20) {
    lengthAppropriateness = 1.0;
  } else if (responseLength > 10) {
    lengthAppropriateness = 0.5;
  } else {
    lengthAppropriateness = 0.1;
  }

  // 3. Coherence: Fewer uncertainty markers = better (0-1)
  const incoherenceMarkers = ['i think', 'maybe', 'probably', 'might be', 'could be', 'not sure', 'unclear'];
  const markerCount = incoherenceMarkers.filter(m => response.toLowerCase().includes(m)).length;
  const coherence = Math.max(0, 1 - (markerCount * 0.15));

  // 4. Toxicity: No toxic words present = 0 (good), presence = higher (0-1)
  const toxicWords = ['hate', 'stupid', 'dumb', 'idiot', 'fool', 'terrible', 'horrible', 'awful', 'bad', 'worst', 'sucks', 'disgusting'];
  const toxicCount = toxicWords.filter(w => response.toLowerCase().includes(w)).length;
  const toxicity = Math.min(1, toxicCount * 0.1); // Each toxic word increases by 0.1

  // 5. Bias: Fewer biased terms = 0 (good), more = higher (0-1)
  const biasTerms = ['he', 'she', 'man', 'woman', 'male', 'female', 'black', 'white', 'asian', 'hispanic', 'jewish', 'muslim', 'christian', 'old', 'young', 'kid'];
  const biasCount = biasTerms.filter(term => {
    const regex = new RegExp('\\b' + term + '\\b', 'i');
    return regex.test(response);
  }).length;
  const bias = Math.min(1, biasCount / Math.max(20, response.split(/\s+/).length / 5));

  // 6. Hallucination: Uncertainty markers indicate hallucination risk (0-1, 0 = no risk)
  const hallucMarkers = ['i think', 'maybe', 'probably', 'might be', 'could be', 'i believe', 'possibly', 'perhaps', 'not sure', 'unclear', 'unknown', 'i guess'];
  const hallucCount = hallucMarkers.filter(m => response.toLowerCase().includes(m)).length;
  const hallucination = Math.min(1, hallucCount / 6); // Normalize to 0-1

  // Overall score: weighted average (higher is better)
  const overallScore = Math.min(1, Math.max(0,
    relevance * 0.2 +
    lengthAppropriateness * 0.15 +
    coherence * 0.15 +
    (1 - toxicity) * 0.15 +
    (1 - bias) * 0.15 +
    (1 - hallucination) * 0.2
  ));

  return {
    relevance: Math.min(1, Math.max(0, relevance)),
    lengthAppropriateness: Math.min(1, Math.max(0, lengthAppropriateness)),
    coherence: Math.min(1, Math.max(0, coherence)),
    toxicity: Math.min(1, Math.max(0, toxicity)),
    bias: Math.min(1, Math.max(0, bias)),
    hallucination: Math.min(1, Math.max(0, hallucination)),
    overallScore: overallScore
  };
}

// Sanitize text: remove emoji, corrupt Unicode sequences, control characters
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // First pass: Remove all non-ASCII characters entirely
  cleaned = cleaned.replace(/[^\x20-\x7E\n\r\t]/g, '');

  // Second pass: Remove common UTF-8 corruption patterns
  cleaned = cleaned
    .replace(/ðŸ|Ÿ|ï|â|†|™|€|‚|ƒ|„|…|‡|ˆ|‰|Š|‹|Œ|Ž|–|—|"|"|•|‰|Š|›|œ|ž|Ÿ/g, '')
    .replace(/[Â¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿À-ÿ]/g, '');

  // Third pass: Remove stray colons that appear with numbers or before corruption
  cleaned = cleaned.replace(/:(?=\d{3,})/g, '');

  // Fourth pass: Remove any remaining sequences of punctuation/symbols that look corrupted
  cleaned = cleaned.replace(/[:ðŸ–—â†™€]+/g, '');

  // Final pass: Collapse multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

// Strip prefixes like "u said", "copilot said", etc. from text
function stripPrefixes(text, type) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  if (type === 'question') {
    // Remove question prefixes: "You said", "U said", "user said", "I asked", "My question", "Question:", etc.
    cleaned = cleaned.replace(/^(you\s+said|u\s+said|user\s+said|i\s+asked|my\s+question|question:\s*|q:\s*)\s*/i, '');
    // Also remove any "Copilot said" or similar that might appear mid-text
    cleaned = cleaned.replace(/\s+(copilot\s+said|assistant\s+said|bot\s+said|ai\s+said)\s*/i, ' ');
  } else if (type === 'response') {
    // Remove response prefixes: "Copilot said", "Assistant said", "Bot said", "Response:", "Answer:", "A:", etc.
    cleaned = cleaned.replace(/^(copilot\s+said|assistant\s+said|bot\s+said|ai\s+said|response:\s*|answer:\s*|a:\s*)\s*/i, '');
    // Also remove any "You said" or "User said" that might appear mid-text
    cleaned = cleaned.replace(/\s+(you\s+said|u\s+said|user\s+said)\s*/i, ' ');
  }

  // Clean up any multiple spaces left over
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

// Open the local dashboard analytics page in a new tab.
async function openDashboard() {
  try {
    const targetBase = normalizeDashboardBaseUrl(LOCAL_DASHBOARD_URL);
    const targetUrl = `${targetBase}/analytics`;

    chrome.tabs.create({ url: targetUrl });
    showStatus(logStatus, `🔗 Opening dashboard: ${targetUrl}`, 'info');
  } catch (err) {
    console.error('Failed to open dashboard tab:', err);
    showStatus(logStatus, '❌ Could not open dashboard tab. Please open manually: ' + LOCAL_DASHBOARD_URL, 'error');
  }
}

function showStatus(element, message, type) {
  element.textContent = message;
  element.className = `status-message ${type}`;
}





