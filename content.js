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
          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              if (isValidLogEntry(item)) {
                logs.push(normalizeLogEntry(item, 'localStorage'));
              }
            });
          } else if (isValidLogEntry(parsed)) {
            logs.push(normalizeLogEntry(parsed, 'localStorage'));
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
                logs.push(normalizeLogEntry(item, 'sessionStorage'));
              }
            });
          } else if (isValidLogEntry(parsed)) {
            logs.push(normalizeLogEntry(parsed, 'sessionStorage'));
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
  
  // Look for common chat message selectors
  const selectors = [
    '[class*="chat"]',
    '[class*="message"]',
    '[id*="chat"]',
    '[id*="message"]',
    '[data-testid*="chat"]',
    '[data-testid*="message"]'
  ];
  
  selectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        const text = element.textContent?.trim();
        if (text && text.length > 0) {
          // Check if it looks like a chat message
          if (element.classList.toString().toLowerCase().includes('user') ||
              element.classList.toString().toLowerCase().includes('bot') ||
              element.classList.toString().toLowerCase().includes('assistant')) {
            
            const role = element.classList.toString().toLowerCase().includes('user') ? 'user' : 
                       element.classList.toString().toLowerCase().includes('bot') ? 'assistant' : 
                       element.classList.toString().toLowerCase().includes('assistant') ? 'assistant' : 'unknown';
            
            logs.push({
              timestamp: new Date().toISOString(),
              role: role,
              content: text,
              source: 'DOM',
              metadata: {
                className: element.className,
                id: element.id
              }
            });
          }
        }
      });
    } catch (error) {
      console.error(`Error extracting from selector ${selector}:`, error);
    }
  });
  
  return logs;
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
  const hasContent = entry.content || entry.message || entry.text || entry.response;
  const hasTimestamp = entry.timestamp || entry.time || entry.created_at;
  
  return hasContent || hasTimestamp;
}

function normalizeLogEntry(entry, source) {
  return {
    timestamp: entry.timestamp || entry.time || entry.created_at || new Date().toISOString(),
    role: entry.role || entry.type || entry.sender || 'unknown',
    content: entry.content || entry.message || entry.text || entry.response || JSON.stringify(entry),
    source: source,
    metadata: {
      original: entry
    }
  };
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





