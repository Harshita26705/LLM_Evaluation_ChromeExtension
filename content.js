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

  // Strategy 3b: Fallback for image-only assistant responses.
  logs.push(...extractStandaloneChatImagesFromDOM());
  
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
        const imageUrls = extractImageUrlsFromElement(element);
        const text = element.textContent?.trim() || '';
        if (!text && imageUrls.length === 0) continue;
        const content = text || '[image-only message]';

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
          content,
          imageUrls,
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

function extractImageUrlsFromElement(element) {
  const urls = [];
  const seen = new Set();

  try {
    const images = element.querySelectorAll ? element.querySelectorAll('img') : [];
    images.forEach((img) => {
      const src = (img.getAttribute('src') || img.currentSrc || '').trim();
      if (!src || seen.has(src)) return;
      seen.add(src);
      urls.push(src);
    });
  } catch (e) {
    // Ignore extraction errors for individual DOM nodes.
  }

  return urls;
}

/**
 * Resolve the best available URL for an <img> element.
 * Tries in order: download-button href → share-button href → data-src → currentSrc → src.
 * This is important for Copilot-generated images where img.src may be an internal blob
 * but adjacent action buttons expose the real CDN URL.
 */
function resolveImageSrc(img) {
  // Walk up to at most 6 ancestor levels looking for download/share action anchors
  const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|bmp)(\?|$)/i;
  let ancestor = img.parentElement;
  for (let i = 0; i < 6 && ancestor; i++, ancestor = ancestor.parentElement) {
    // Look for <a download> or <a href="...image..."> buttons in the same container
    const anchors = ancestor.querySelectorAll('a[href], a[download]');
    for (const a of anchors) {
      const href = (a.getAttribute('href') || '').trim();
      if (!href) continue;
      // Absolute URL pointing to an image or containing image-related query params
      if (
        IMAGE_EXTS.test(href) ||
        href.startsWith('data:image/') ||
        href.startsWith('blob:') ||
        /[?&](url|src|image|img|file)=/i.test(href) ||
        /bing\.com\/images|dall-e|openai|cdn\.copilot|mediaproxy/i.test(href)
      ) {
        return href;
      }
    }
    // Also look for buttons with data-url / data-image-url / data-download-url attributes
    const buttons = ancestor.querySelectorAll('[data-url],[data-image-url],[data-download-url],[data-src]');
    for (const btn of buttons) {
      const url = (
        btn.getAttribute('data-image-url') ||
        btn.getAttribute('data-download-url') ||
        btn.getAttribute('data-url') ||
        btn.getAttribute('data-src') ||
        ''
      ).trim();
      if (url) return url;
    }
  }

  // Fallbacks on the img element itself
  return (
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.currentSrc ||
    img.getAttribute('src') ||
    ''
  ).trim();
}

function extractStandaloneChatImagesFromDOM() {
  const logs = [];
  const seen = new Set();

  try {
    const images = document.querySelectorAll('img');
    images.forEach((img) => {
      // Resolve the best URL, including from nearby download/share buttons
      const src = resolveImageSrc(img);
      if (!src || seen.has(src)) return;

      // Use rendered dimensions; fall back to attribute dimensions only if natural size unavailable
      const width = Number(img.naturalWidth || img.width || img.getAttribute('width') || 0);
      const height = Number(img.naturalHeight || img.height || img.getAttribute('height') || 0);
      const area = width * height;

      // For images where naturalWidth is 0 (lazy-load not yet triggered), accept if
      // the URL itself looks like a real image (not just any src that hasn't loaded)
      const srcLower = src.toLowerCase();
      const looksLikeImageUrl = (
        srcLower.startsWith('data:image/') ||
        srcLower.startsWith('blob:') ||
        /\.(png|jpg|jpeg|gif|webp|bmp)(\?|$)/.test(srcLower) ||
        /bing\.com\/images|dall-e|openai|cdn\.copilot|mediaproxy/i.test(src)
      );

      // Accept if size passes OR if the URL strongly identifies itself as an image
      const sizeOk = width >= 120 && height >= 120 && area >= 20000;
      if (!sizeOk && !looksLikeImageUrl) return;

      // Reject obvious UI chrome
      if (
        srcLower.includes('icon') ||
        srcLower.includes('avatar') ||
        srcLower.includes('logo') ||
        srcLower.endsWith('.svg')
      ) return;

      seen.add(src);

      const role = detectRoleFromElement(img) === 'user' ? 'user' : 'assistant';
      logs.push({
        timestamp: new Date().toISOString(),
        role,
        content: '[image-only message]',
        imageUrls: [src],
        source: 'DOM-IMAGE-FALLBACK',
        metadata: { width, height }
      });
    });
  } catch (error) {
    console.error('Error extracting standalone images:', error);
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
  const hasContent = [
    entry.content,
    entry.message,
    entry.text,
    entry.response,
    entry.answer,
    entry.reply,
    entry.prompt,
    entry.question,
    entry.input
  ].some((value) => extractEntryText(value).trim().length > 0);
  const hasTimestamp = entry.timestamp || entry.time || entry.created_at;
  
  return hasContent || hasTimestamp;
}

function extractEntryText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => extractEntryText(item))
      .filter((text) => text.trim().length > 0)
      .join('\n');
  }

  if (typeof value === 'object') {
    const obj = value;

    // Common LLM block shape: { type: "text", text: "..." }
    if (typeof obj.text === 'string' && obj.text.trim()) {
      return obj.text;
    }

    // Common nested shape: { content: [...] }, { parts: [...] }, { results: [...] }
    const nestedCollections = [obj.content, obj.parts, obj.results, obj.messages, obj.items];
    for (const collection of nestedCollections) {
      if (Array.isArray(collection)) {
        const nestedText = extractEntryText(collection);
        if (nestedText.trim()) {
          return nestedText;
        }
      }
    }

    // Some payloads wrap content under message/body/response objects.
    const nestedObjects = [obj.message, obj.body, obj.response, obj.data];
    for (const nested of nestedObjects) {
      if (nested && typeof nested === 'object') {
        const nestedText = extractEntryText(nested);
        if (nestedText.trim()) {
          return nestedText;
        }
      }
    }

    try {
      return JSON.stringify(obj);
    } catch (e) {
      return '';
    }
  }

  return '';
}

function normalizeEntryRole(entry) {
  const directRole = extractEntryText(entry.role || entry.type || entry.sender || entry.author_type).toLowerCase();
  if (directRole.includes('assistant') || directRole.includes('ai') || directRole.includes('bot')) {
    return 'assistant';
  }
  if (directRole.includes('user') || directRole.includes('human')) {
    return 'user';
  }

  const authorType = extractEntryText(entry?.author?.type).toLowerCase();
  if (authorType === 'ai' || authorType === 'assistant' || authorType === 'bot') {
    return 'assistant';
  }
  if (authorType === 'user' || authorType === 'human') {
    return 'user';
  }

  return directRole || 'unknown';
}

// Normalize a raw storage/parsed entry into one or more standard log entries
function normalizeRawEntry(entry, source) {
  // If entry already looks like a conversation pair (question/prompt + response/answer), split into two entries
  const questionKeys = ['question', 'prompt', 'input', 'query', 'user'];
  const answerKeys = ['response', 'answer', 'reply', 'output', 'bot'];

  const hasQuestion = questionKeys.some(k => entry[k] !== undefined);
  const hasAnswer = answerKeys.some(k => entry[k] !== undefined);
  const imageUrls = extractImageUrlsFromObject(entry);

  const timestamp = entry.timestamp || entry.time || entry.created_at || new Date().toISOString();

  const entries = [];

  if (hasQuestion && hasAnswer) {
    const questionContent = questionKeys.map(k => entry[k]).find(v => v !== undefined) || '';
    const answerContent = answerKeys.map(k => entry[k]).find(v => v !== undefined) || '';

    entries.push({
      timestamp,
      role: 'user',
      content: extractEntryText(questionContent),
      imageUrls,
      source,
      metadata: { original: entry, model: entry.model || entry.model_name }
    });

    entries.push({
      timestamp,
      role: 'assistant',
      content: extractEntryText(answerContent),
      imageUrls,
      source,
      metadata: { original: entry, model: entry.model || entry.model_name }
    });

    return entries;
  }

  // Fallback: if entry already has role/content fields, normalize single entry
  const role = normalizeEntryRole(entry);
  const content =
    extractEntryText(entry.content) ||
    extractEntryText(entry.message) ||
    extractEntryText(entry.text) ||
    extractEntryText(entry.response) ||
    extractEntryText(entry.answer) ||
    extractEntryText(entry.reply) ||
    extractEntryText(entry);

  entries.push({
    timestamp,
    role,
    content,
    imageUrls,
    source,
    metadata: { original: entry, model: entry.model || entry.model_name }
  });

  return entries;
}

function extractImageUrlsFromObject(value) {
  const collected = [];
  const seenUrls = new Set();
  const visited = new Set();

  function maybeAdd(url) {
    if (typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const lowered = trimmed.toLowerCase();
    const looksLikeImage =
      lowered.startsWith('data:image/') ||
      lowered.startsWith('blob:') ||
      /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(trimmed);
    if (!looksLikeImage) return;
    if (seenUrls.has(trimmed)) return;
    seenUrls.add(trimmed);
    collected.push(trimmed);
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    Object.entries(node).forEach(([key, val]) => {
      if (typeof val === 'string') {
        if (/(src|image|image_url|imageurl|thumbnail|url)/i.test(key)) {
          maybeAdd(val);
        }
      } else if (val && typeof val === 'object') {
        walk(val);
      }
    });
  }

  walk(value);
  return collected;
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





