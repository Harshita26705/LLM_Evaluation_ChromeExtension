// Content script to extract chatbot logs from web pages

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractLogs') {
    extractChatbotLogs()
      .then(logs => {
        sendResponse({ success: true, logs: logs });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates we will send a response asynchronously
  }
});

// Function to extract chatbot logs from various sources
async function extractChatbotLogs() {
  const logs = [];
  
  // Strategy 1: Look for common chatbot log patterns in localStorage
  logs.push(...extractFromLocalStorage());
  
  // Strategy 2: Look for chatbot logs in sessionStorage
  logs.push(...extractFromSessionStorage());
  
  // Strategy 3: Look for chat messages in DOM
  logs.push(...extractFromDOM());
  
  // Strategy 4: Look for API responses in network logs (if available)
  logs.push(...extractFromNetworkLogs());
  
  // Strategy 5: Look for console logs related to chatbot
  logs.push(...extractFromConsoleLogs());
  
  // Deduplicate logs based on timestamp and content
  return deduplicateLogs(logs);
}

function extractFromLocalStorage() {
  const logs = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.toLowerCase().includes('chat') || 
                  key.toLowerCase().includes('log') || 
                  key.toLowerCase().includes('message') ||
                  key.toLowerCase().includes('conversation'))) {
        try {
          const value = localStorage.getItem(key);
          const parsed = JSON.parse(value);
          
          // Check if it's an array of logs
          // If storage contains an array of messages, normalize each item
          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              if (isValidLogEntry(item)) {
                const normalized = normalizeRawEntry(item, 'localStorage');
                logs.push(...normalized);
              }
            });

          // If parsed is an object that contains nested arrays of messages (common shape), extract them
          } else if (parsed && typeof parsed === 'object') {
            // Common nested keys that hold message arrays
            const arrayKeys = ['messages', 'conversation', 'conversations', 'items', 'history', 'chats'];
            let foundArray = false;

            for (const k of arrayKeys) {
              if (Array.isArray(parsed[k])) {
                foundArray = true;
                parsed[k].forEach(item => {
                  if (isValidLogEntry(item)) {
                    const normalized = normalizeRawEntry(item, 'localStorage');
                    logs.push(...normalized);
                  }
                });
              }
            }

            // As a fallback, scan object values for arrays of objects
            if (!foundArray) {
              Object.values(parsed).forEach(v => {
                if (Array.isArray(v)) {
                  v.forEach(item => {
                    if (isValidLogEntry(item)) {
                      const normalized = normalizeRawEntry(item, 'localStorage');
                      logs.push(...normalized);
                    }
                  });
                }
              });
            }

            // Final fallback: if the object itself looks like a single log entry, normalize it
            if (!foundArray && isValidLogEntry(parsed)) {
              const normalized = normalizeRawEntry(parsed, 'localStorage');
              logs.push(...normalized);
            }
          }
        } catch (e) {
          // Not JSON, skip
        }
      }
    }
  } catch (error) {
    console.error('Error extracting from localStorage:', error);
  }
  return logs;
}

function extractFromSessionStorage() {
  const logs = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.toLowerCase().includes('chat') || 
                  key.toLowerCase().includes('log') || 
                  key.toLowerCase().includes('message'))) {
        try {
          const value = sessionStorage.getItem(key);
          const parsed = JSON.parse(value);
          
          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              if (isValidLogEntry(item)) {
                const normalized = normalizeRawEntry(item, 'sessionStorage');
                logs.push(...normalized);
              }
            });

          } else if (parsed && typeof parsed === 'object') {
            const arrayKeys = ['messages', 'conversation', 'conversations', 'items', 'history', 'chats'];
            let foundArray = false;

            for (const k of arrayKeys) {
              if (Array.isArray(parsed[k])) {
                foundArray = true;
                parsed[k].forEach(item => {
                  if (isValidLogEntry(item)) {
                    const normalized = normalizeRawEntry(item, 'sessionStorage');
                    logs.push(...normalized);
                  }
                });
              }
            }

            if (!foundArray) {
              Object.values(parsed).forEach(v => {
                if (Array.isArray(v)) {
                  v.forEach(item => {
                    if (isValidLogEntry(item)) {
                      const normalized = normalizeRawEntry(item, 'sessionStorage');
                      logs.push(...normalized);
                    }
                  });
                }
              });
            }

            if (!foundArray && isValidLogEntry(parsed)) {
              const normalized = normalizeRawEntry(parsed, 'sessionStorage');
              logs.push(...normalized);
            }
          }
        } catch (e) {
          // Not JSON, skip
        }
      }
    }
  } catch (error) {
    console.error('Error extracting from sessionStorage:', error);
  }
  return logs;
}

function extractFromDOM() {
  const logs = [];

  // Look for common chat message selectors (unioned)
  const selectors = [
    '[class*="chat"]',
    '[class*="message"]',
    '[id*="chat"]',
    '[id*="message"]',
    '[data-testid*="chat"]',
    '[data-testid*="message"]'
  ];

  try {
    // Collect nodes for all selectors and de-duplicate
    const nodeList = [];
    selectors.forEach(selector => {
      try { nodeList.push(...document.querySelectorAll(selector)); } catch (e) { /* ignore bad selectors */ }
    });

    const uniqueNodes = Array.from(new Set(nodeList));

    // Iterate in DOM order and infer role when missing by alternating from last known role
    for (let idx = 0; idx < uniqueNodes.length; idx++) {
      const element = uniqueNodes[idx];
      try {
        const text = element.textContent?.trim();
        if (!text) continue;

        let role = detectRoleFromElement(element);

        // If role unknown, attempt to infer from previous known entry
        if (role === 'unknown') {
          const prevKnown = logs.slice().reverse().find(l => l.role && l.role !== 'unknown');
          if (prevKnown) {
            role = prevKnown.role === 'user' ? 'assistant' : 'user';
          }
        }

        logs.push({
          timestamp: new Date().toISOString(),
          role: role,
          content: text,
          source: 'DOM',
          metadata: {
            className: element.className,
            id: element.id,
            index: idx
          }
        });
      } catch (error) {
        console.error('Error processing DOM element for chat extraction:', error);
      }
    }

  } catch (error) {
    console.error('Error extracting from DOM:', error);
  }

  return logs;
}

// Heuristic role detection from element and its ancestors/attributes
function detectRoleFromElement(element) {
  try {
    const cls = (element.className || '').toString().toLowerCase();
    const id = (element.id || '').toString().toLowerCase();

    const userKeywords = ['user', 'you', 'from-user', 'author-user', 'author-you', 'sender-user', 'user-message'];
    const assistantKeywords = ['assistant', 'bot', 'ai', 'agent', 'response', 'reply', 'assistant-message', 'bot-message'];

    for (const k of userKeywords) {
      if (cls.includes(k) || id.includes(k)) return 'user';
    }
    for (const k of assistantKeywords) {
      if (cls.includes(k) || id.includes(k)) return 'assistant';
    }

    // Check data-role or aria attributes
    const dataRole = (element.getAttribute && (element.getAttribute('data-role') || element.getAttribute('role') || element.getAttribute('data-author')) || '') .toString().toLowerCase();
    if (dataRole) {
      if (dataRole.includes('user') || dataRole.includes('you')) return 'user';
      if (dataRole.includes('assistant') || dataRole.includes('bot') || dataRole.includes('ai')) return 'assistant';
    }

    // Walk up to parent nodes to see if parent container indicates role
    let parent = element.parentElement;
    let steps = 0;
    while (parent && steps < 4) {
      const pCls = (parent.className || '').toString().toLowerCase();
      const pId = (parent.id || '').toString().toLowerCase();
      for (const k of userKeywords) {
        if (pCls.includes(k) || pId.includes(k)) return 'user';
      }
      for (const k of assistantKeywords) {
        if (pCls.includes(k) || pId.includes(k)) return 'assistant';
      }
      parent = parent.parentElement;
      steps++;
    }

    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

function extractFromNetworkLogs() {
  const logs = [];
  // Note: Content scripts can't directly access network logs
  // This would need to be handled by the background script
  // But we can try to find cached API responses in the page
  try {
    if (window.fetch) {
      // If the page has stored fetch responses, we could extract them
      // This is a placeholder for more advanced extraction
    }
  } catch (error) {
    console.error('Error extracting from network logs:', error);
  }
  return logs;
}

function extractFromConsoleLogs() {
  const logs = [];
  // Intercept console.log calls
  // This is limited as we can't retroactively get console logs
  // But we can set up interception for future logs
  return logs;
}

function isValidLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  
  // Check for common log entry properties
  const hasContent = entry.content || entry.message || entry.text || entry.response || entry.answer || entry.reply || entry.prompt || entry.question || entry.input;
  const hasTimestamp = entry.timestamp || entry.time || entry.created_at;
  
  return hasContent || hasTimestamp;
}

// Normalize a raw storage/parsed entry into one or more standard log entries
function normalizeRawEntry(entry, source) {
  // If entry already looks like a conversation pair (question/prompt + response/answer), split into two entries
  const questionKeys = ['question', 'prompt', 'input', 'query', 'user'];
  const answerKeys = ['response', 'answer', 'reply', 'output', 'bot'];

  const hasQuestion = questionKeys.some(k => entry[k] !== undefined);
  const hasAnswer = answerKeys.some(k => entry[k] !== undefined);

  const timestamp = entry.timestamp || entry.time || entry.created_at || new Date().toISOString();

  const entries = [];

  if (hasQuestion && hasAnswer) {
    const questionContent = questionKeys.map(k => entry[k]).find(v => v !== undefined) || '';
    const answerContent = answerKeys.map(k => entry[k]).find(v => v !== undefined) || '';

    entries.push({
      timestamp,
      role: 'user',
      content: String(questionContent),
      source,
      metadata: { original: entry, model: entry.model || entry.model_name }
    });

    entries.push({
      timestamp,
      role: 'assistant',
      content: String(answerContent),
      source,
      metadata: { original: entry, model: entry.model || entry.model_name }
    });

    return entries;
  }

  // Fallback: if entry already has role/content fields, normalize single entry
  const role = entry.role || entry.type || entry.sender || 'unknown';
  const content = entry.content || entry.message || entry.text || entry.response || entry.answer || entry.reply || JSON.stringify(entry);

  entries.push({
    timestamp,
    role,
    content: String(content),
    source,
    metadata: { original: entry, model: entry.model || entry.model_name }
  });

  return entries;
}

function deduplicateLogs(logs) {
  const seen = new Set();
  const unique = [];
  
  logs.forEach(log => {
    const key = `${log.timestamp}_${log.content?.substring(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(log);
    }
  });
  
  // Sort by timestamp
  return unique.sort((a, b) => {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}





