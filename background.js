// Background script for LLM evaluation
// 
// This script uses the robust scoring engine (scoring-engine.js) which provides:
// - Weighted Jaccard similarity with TF-IDF
// - ROUGE-1 F1 scores
// - Exponentially smoothed length appropriateness
// - Convex toxicity/bias penalties
// - Coherence as blend of uncertainty and relevance
// - Safety gate for high toxicity
//
// Note: scoring-engine.js functions are imported/included below

// Import scoring engine functions
importScripts('scoring-engine.js');

let evaluationCache = new Map();
const LOCAL_HISTORY_ENDPOINT = 'http://127.0.0.1:5000/api/evaluation-history';

async function getHistorySyncEndpoint() {
  return LOCAL_HISTORY_ENDPOINT;
}

// Listen for messages from the popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'analyzeLogs':
      chrome.storage.local.get(['sourceName'], (data) => {
        const savedSourceName = (data?.sourceName || '').trim();
        const effectiveSource = (request.sourceName || savedSourceName || sender?.tab?.url || '').trim();

        analyzeLogs(request.logs, effectiveSource).then(results => {
          sendResponse(results);
        });
      });
      return true;

    case 'evaluate':
      evaluateWithExternalAPI(request.logs, request.apiEndpoint).then(results => {
        sendResponse(results);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'getEvaluationHistory':
      chrome.storage.local.get(['evaluationHistory'], (result) => {
        sendResponse(result.evaluationHistory || []);
      });
      return true;

    case 'clearEvaluationHistory':
      chrome.storage.local.remove(['evaluationHistory'], () => {
        sendResponse({ success: true });
      });
      return true;
  }
});

async function analyzeLogs(logs, sourceUrl) {
    try {
    // Use TF-IDF weighted Jaccard similarity (local, no external API)
    let similarityScore = calculateBasicSimilarity(logs);

    // Use the new robust scoring engine
    let scoringResults;
    try {
      scoringResults = calculateOverallScore(logs);
    } catch (e) {
      console.error('Scoring error:', e);
      // Fallback to defaults if scoring fails
      scoringResults = {
        relevance: 0.5,
        lengthFit: 0.75,
        coherence: 0.5,
        rouge1: 0,
        toxicity: 0.8,
        bias: 0.8,
        hallucination: 0.8,
        overallScore: 0.5,
        safetyGateTriggered: false
      };
    }
    
    console.log('Individual metrics calculated:', scoringResults);
    
    const results = {
      relevance: scoringResults.relevance,
      length_appropriateness: scoringResults.lengthFit,
      coherence: scoringResults.coherence,
      rouge1: scoringResults.rouge1,
      // Keep these aligned with popup semantics: lower is better (risk/penalty).
      toxicity: scoringResults.toxicityPenalty ?? (1 - (scoringResults.toxicity ?? 0)),
      bias: scoringResults.biasPenalty ?? (1 - (scoringResults.bias ?? 0)),
      hallucination: scoringResults.hallucinationRisk ?? (1 - (scoringResults.hallucination ?? 0)),
      safety_gate_triggered: scoringResults.safetyGateTriggered,
      // Include raw penalties for transparency
      toxicity_penalty: scoringResults.toxicityPenalty,
      bias_penalty: scoringResults.biasPenalty,
      hallucination_risk: scoringResults.hallucinationRisk,
      overall_score: scoringResults.overallScore
    };

    console.log('analyzeLogs returning results:', results);

    // Store results in history and sync the dashboard copy.
    await storeEvaluation(results, logs, sourceUrl);

    return results;
    } catch (error) {
        console.error('Analysis error:', error);
        console.error('Error stack:', error.stack);
        return {
            error: 'Failed to analyze logs: ' + error.message
        };
    }
}

// Call external evaluation API (Render deployment)
async function evaluateWithExternalAPI(logs, apiEndpoint) {
  try {
    if (!apiEndpoint) {
      throw new Error('API endpoint not configured');
    }

    // Normalize endpoint so both full path and base URL are supported.
    let configuredUrl = apiEndpoint.trim();
    if (!/^https?:\/\//i.test(configuredUrl)) {
      configuredUrl = 'https://' + configuredUrl;
    }
    configuredUrl = configuredUrl.replace(/\/+$/, '');

    const isDirectEvaluatePath = /\/api\/evaluate$/i.test(configuredUrl) || /\/evaluate$/i.test(configuredUrl);
    const candidateUrls = isDirectEvaluatePath
      ? [configuredUrl]
      : [`${configuredUrl}/api/evaluate`, `${configuredUrl}/evaluate`];

    // Build one user->assistant pair for Flask /api/evaluate compatibility.
    let firstPair = null;
    for (let i = 0; i < logs.length - 1; i++) {
      const current = logs[i];
      const next = logs[i + 1];
      const isUser = current?.role && current.role.toLowerCase().includes('user');
      const isAssistant = next?.role && next.role.toLowerCase().includes('assistant');
      if (isUser && isAssistant) {
        firstPair = {
          reference: current.content || '',
          response: next.content || ''
        };
        break;
      }
    }

    let lastError = null;

    for (const evaluateUrl of candidateUrls) {
      const isFlaskEvaluate = /\/api\/evaluate$/i.test(evaluateUrl);
      const payload = isFlaskEvaluate
        ? (firstPair || { reference: '', response: '' })
        : { logs: logs };

      try {
        console.log('Calling external API:', evaluateUrl);

        const response = await fetch(evaluateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('External API response:', data);

        return {
          success: true,
          results: data
        };
      } catch (error) {
        lastError = error;
        console.warn(`External API attempt failed for ${evaluateUrl}:`, error?.message || error);
      }
    }

    throw lastError || new Error('All external API endpoints failed');

  } catch (error) {
    console.warn('External API evaluation error:', error?.message || error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Fetch embeddings from Hugging Face Inference API (feature-extraction pipeline)
async function fetchHfEmbeddings(texts, hfApiKey, modelName = 'sentence-transformers/all-MiniLM-L6-v2') {
  if (!Array.isArray(texts)) texts = [texts];
  // Primary and fallback endpoints. Drop deprecated api-inference host to avoid 410s.
  const endpoints = [
    `https://router.huggingface.co/hf-inference/pipeline/feature-extraction/${encodeURIComponent(modelName)}`,
    `https://router.huggingface.co/feature-extraction/${encodeURIComponent(modelName)}`,
    `https://inference-api.huggingface.co/models/${encodeURIComponent(modelName)}`
  ];

  // Helper: sleep for ms
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const MAX_ENDPOINT_RETRIES = 2; // per endpoint
  const BASE_BACKOFF_MS = 500; // initial backoff

  let lastError = null;

  // Quick offline check
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Browser appears to be offline (navigator.onLine === false)');
    }
  } catch (e) {
    // navigator may be undefined in some service worker contexts; ignore if so
  }

  for (const url of endpoints) {
    for (let attempt = 1; attempt <= MAX_ENDPOINT_RETRIES; attempt++) {
      // create a fresh abort controller per attempt
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ inputs: texts, options: { wait_for_model: true, use_cache: true } }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          const errorText = await resp.text();
          const note = resp.status === 410
            ? ' (api-inference.huggingface.co is deprecated; use router.huggingface.co)'
            : '';
          throw new Error(`API request failed: ${resp.status} - ${errorText}${note}`);
        }

        const data = await resp.json();

        // Normalize response format: data should be array of vectors or array of arrays
        if (!Array.isArray(data)) {
          throw new Error('Unexpected API response format');
        }

        // If single input returned as vector, wrap
        return Array.isArray(data[0]) ? data : [data];

      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        // Provide more detailed logs for debugging: network/CORS/timeout
        console.warn(`Attempt ${attempt} failed for ${url}:`, error && error.message ? error.message : error);
        if (error.name === 'AbortError') {
          console.warn('Request timed out (AbortError).');
        } else if (error instanceof TypeError) {
          // TypeError commonly indicates a network failure or CORS rejection
          console.warn('TypeError during fetch — this may indicate a network error or CORS issue.');
        }
        if (attempt < MAX_ENDPOINT_RETRIES) {
          // backoff before retrying
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
          continue;
        }
        // move to next endpoint after exhausting retries
      }
    }
  }

  const tried = endpoints.join(', ');
  // Build a helpful error message for the caller
  let friendly = `Failed to fetch embeddings from Hugging Face. Endpoints tried: ${tried}.`;
  if (lastError) {
    if (lastError.name === 'AbortError') {
      friendly += ' Last error: Request timed out.';
    } else if (lastError instanceof TypeError) {
      friendly += ' Last error: Network failure or CORS rejection (TypeError). Check network and CORS settings.';
    } else {
      friendly += ` Last error: ${lastError.message || String(lastError)}`;
    }
  } else {
    friendly += ' Last error: Unknown error.';
  }

  throw new Error(friendly);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function calculateBasicSimilarity(logs) {
    // Use the new weighted TF-IDF similarity
    return calculateWeightedSimilarity(logs);
}

// DEPRECATED: Use calculateRelevance from scoring-engine.js instead
// Kept for backward compatibility only
function calculateRelevanceLegacy(logs) {
    let totalRelevance = 0;
    let pairs = 0;
    
    // Find user-assistant pairs and measure relevance
    for (let i = 0; i < logs.length - 1; i++) {
        if (logs[i].role && logs[i].role.toLowerCase().includes('user') &&
            logs[i + 1].role && logs[i + 1].role.toLowerCase().includes('assistant')) {
            
            const question = logs[i].content.toLowerCase();
            const answer = logs[i + 1].content.toLowerCase();
            
            // Extract key terms from question (words longer than 3 chars)
            const qWords = question.split(/\s+/).filter(w => w.length > 3);
            const answerWords = new Set(answer.split(/\s+/));
            
            // Count how many question keywords appear in answer
            const relevantWords = qWords.filter(w => answerWords.has(w)).length;
            const relevanceScore = qWords.length > 0 ? relevantWords / qWords.length : 0.5;
            
            totalRelevance += relevanceScore;
            pairs++;
        }
    }
    
    return pairs > 0 ? Math.min(1, totalRelevance / pairs) : 0.5;
}

// DEPRECATED: Use calculateToxicityPenalty from scoring-engine.js instead
// Kept for backward compatibility only
function analyzeBasicToxicity(logs) {
    const toxicWords = new Set([
        'hate', 'stupid', 'dumb', 'idiot', 'fool', 'terrible',
        'horrible', 'awful', 'bad', 'worst', 'evil', 'sucks', 'disgusting'
    ]);
    
    let toxicCount = 0;
    let totalWords = 0;
    
    logs.forEach(log => {
        if (log.content) {
            const words = log.content.toLowerCase().split(/\s+/);
            totalWords += words.length;
            words.forEach(word => {
                // Remove punctuation for matching
                const cleanWord = word.replace(/[^a-z0-9]/g, '');
                if (toxicWords.has(cleanWord)) {
                    toxicCount++;
                }
            });
        }
    });
    
    // Return toxicity score in range 0-1 (0 = no toxicity, 1 = high toxicity)
    if (totalWords === 0) return 0;
    return Math.min(1, toxicCount / totalWords);
}

// DEPRECATED: Use calculateCoherence from scoring-engine.js instead
// Kept for backward compatibility only
function analyzeCoherence(logs) {
    const incoherenceMarkers = ['i think', 'maybe', 'probably', 'might be', 'could be', 'not sure', 'unclear'];
    
    let markerCount = 0;
    let totalResponses = 0;
    
    logs.forEach(log => {
        if (log.role && log.role.toLowerCase().includes('assistant')) {
            totalResponses++;
            const content = (log.content || '').toLowerCase();
            incoherenceMarkers.forEach(marker => {
                if (content.includes(marker)) markerCount++;
            });
        }
    });
    
    // Return coherence score (higher is better, 0-1)
    if (totalResponses === 0) return 0.5;
    const normalized = markerCount / totalResponses;
    return Math.max(0, 1 - normalized);
}

// DEPRECATED: Use calculateHallucinationRisk from scoring-engine.js instead
// Kept for backward compatibility only
function estimateHallucination(logs) {
    const uncertaintyPhrases = [
        'i think', 'maybe', 'probably', 'might be', 'could be',
        'i believe', 'possibly', 'perhaps', 'not sure', 'unclear'
    ];
    
    let uncertainCount = 0;
    let totalResponses = 0;
    
    logs.forEach(log => {
    if (log.role && log.role.toLowerCase().includes('assistant')) {
      totalResponses++;
      const content = (log.content || '').toLowerCase();
      uncertaintyPhrases.forEach(phrase => {
        if (content.includes(phrase)) uncertainCount++;
      });
    }
    });
    
  // Return hallucination score as fraction [0,1] where 0 = no signs of hallucination and 1 = strong signs
  if (totalResponses === 0) return 0;
  // Normalize by totalResponses (uncertainCount can be multiple per response)
  const normalized = uncertainCount / totalResponses;
  return Math.max(0, Math.min(1, normalized));
}

// DEPRECATED: Use calculateBiasPenalty from scoring-engine.js instead
// Kept for backward compatibility only
function analyzeBasicBias(logs) {
    const biasTerms = {
        gender: ['he', 'she', 'man', 'woman', 'male', 'female'],
        race: ['black', 'white', 'asian', 'hispanic', 'arab', 'jew'],
        age: ['young', 'old', 'elderly', 'kid', 'senior', 'teenager'],
        religion: ['christian', 'muslim', 'jewish', 'hindu', 'buddhist']
    };
    
    let biasCount = 0;
    let totalWords = 0;
    
    logs.forEach(log => {
        if (log.content) {
            const content = log.content.toLowerCase();
            const words = content.split(/\s+/);
            totalWords += words.length;
            
            // Check for bias terms using word boundaries
            Object.values(biasTerms).forEach(terms => {
                terms.forEach(term => {
                    // Count occurrences of bias terms
                    const regex = new RegExp('\\b' + term + '\\b', 'g');
                    const matches = content.match(regex);
                    if (matches) {
                        biasCount += matches.length;
                    }
                });
            });
        }
    });
    
    // Return bias score in range 0-1 (0 = no bias, 1 = high bias)
    if (totalWords === 0) return 0;
    return Math.min(1, biasCount / totalWords);
}

function calculateSimpleBLEU(logs) {
    if (logs.length < 2) return 0;
    
    let totalScore = 0;
    let pairs = 0;
    
    for (let i = 0; i < logs.length - 1; i++) {
        if (logs[i].role === 'user' && logs[i + 1].role === 'assistant') {
            const reference = logs[i].content.toLowerCase().split(/\s+/);
            const candidate = logs[i + 1].content.toLowerCase().split(/\s+/);
            
            // Calculate simple n-gram overlap
            const overlap = reference.filter(word => candidate.includes(word)).length;
            const score = overlap / Math.max(reference.length, candidate.length);
            
            totalScore += score;
            pairs++;
        }
    }
    
    return pairs > 0 ? totalScore / pairs : 0;
}

async function storeEvaluation(results, logs, sourceUrl) {
    try {
    const { evaluationHistory = [], sourceName = '' } = await chrome.storage.local.get(['evaluationHistory', 'sourceName']);
        const rows = buildEvaluationRows(logs);
  const rowSummary = summarizeEvaluationRows(rows);
    const resolvedSource = (sourceUrl || sourceName || logs[0]?.url || 'unknown').trim();
        const session = {
            session_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            timestamp: new Date().toISOString(),
      source_url: resolvedSource,
            message_count: logs.length,
            summary: {
        // Keep history aligned with popup/UI averages (row-level metrics).
        relevance: rowSummary.relevance,
        length_appropriateness: rowSummary.length_appropriateness,
        coherence: rowSummary.coherence,
        toxicity: rowSummary.toxicity,
        bias: rowSummary.bias,
        hallucination: rowSummary.hallucination,
        average_score: rowSummary.average_score,
            }
        };
        
        evaluationHistory.push({
            timestamp: session.timestamp,
            results,
            messageCount: logs.length,
            url: session.source_url,
            rows,
            session
        });
        
        // Keep only last 100 evaluations
        if (evaluationHistory.length > 100) {
            evaluationHistory.shift();
        }
        
        await chrome.storage.local.set({ evaluationHistory });

        await syncEvaluationHistoryToDashboard({ session, rows });
    } catch (error) {
        console.error('Error storing evaluation:', error);
    }
}

async function syncEvaluationHistoryToDashboard(payload) {
    try {
    const historyEndpoint = await getHistorySyncEndpoint();
    const response = await fetch(historyEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Dashboard history API returned ${response.status}: ${errorText}`);
        }

        console.log('History sync successful:', historyEndpoint);
    } catch (error) {
        console.warn('Unable to sync evaluation history to dashboard:', error.message || error);
    }
    }

function extractImageUrlsFromText(text) {
  if (!text || typeof text !== 'string') return [];

  const urls = [];
  const seen = new Set();
  const patterns = [
    /!\[[^\]]*\]\(((?:https?:\/\/|data:image\/|blob:)[^\s)]+)\)/gi,
    /<img[^>]+src=["']((?:https?:\/\/|data:image\/|blob:)[^"']+)["'][^>]*>/gi,
    /((?:https?:\/\/|data:image\/|blob:)[^\s"'<>]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = (match[1] || match[0] || '').trim();
      if (!candidate) continue;
      const lowered = candidate.toLowerCase();
      const looksLikeImage =
        lowered.startsWith('data:image/') ||
        lowered.startsWith('blob:') ||
        /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(candidate);
      if (!looksLikeImage) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      urls.push(candidate);
    }
  }

  return urls;
}

function mergeUniqueUrls(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    const list = Array.isArray(group) ? group : [];
    for (const item of list) {
      const url = String(item || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      merged.push(url);
    }
  }
  return merged;
}

    function buildEvaluationRows(logs) {
          const rows = [];
          let idCounter = 1;

          for (let i = 0; i < logs.length; i++) {
            const current = logs[i];

            if (current.role && current.role.toLowerCase().includes('user')) {
              let responseText = '';
              let responseTimestamp = '';
              let responseImageUrls = [];

              const immediate = logs[i + 1];
              const immediateIsAssistant = immediate && immediate.role && immediate.role.toLowerCase().includes('assistant');
              const immediateHasImage = immediate && Array.isArray(immediate.imageUrls) && immediate.imageUrls.length > 0;

              if (immediate && (immediateIsAssistant || immediateHasImage)) {
                responseText = immediate.content || '';
                responseTimestamp = immediate.timestamp || '';
                responseImageUrls = mergeUniqueUrls(immediate.imageUrls, extractImageUrlsFromText(responseText));
                i++;
              } else {
                for (let j = i + 1; j < Math.min(logs.length, i + 6); j++) {
                  const candidate = logs[j];
                  const candidateIsAssistant = candidate && candidate.role && candidate.role.toLowerCase().includes('assistant');
                  const candidateHasImage = candidate && Array.isArray(candidate.imageUrls) && candidate.imageUrls.length > 0;
                  if (candidateIsAssistant || candidateHasImage) {
                    responseText = candidate.content || '';
                    responseTimestamp = candidate.timestamp || '';
                    responseImageUrls = mergeUniqueUrls(candidate.imageUrls, extractImageUrlsFromText(responseText));
                    i = j;
                    break;
                  }
                }
              }

              const metrics = computeDetailedMetrics(current.content || '', responseText);

              rows.push({
                Id: idCounter++,
                timestamp: current.timestamp || responseTimestamp || new Date().toISOString(),
                question: current.content || '',
                response: responseText || '',
                response_image_urls: responseImageUrls,
                Relevance: metrics.relevance,
                'Length appropriateness': metrics.lengthAppropriateness,
                Coherence: metrics.coherence,
                Toxicity: metrics.toxicity,
                Bias: metrics.bias,
                Hallucination: metrics.hallucination,
                'Overall Score': metrics.overallScore
              });
            }
          }

          return rows.filter(row => row.question && row.question.trim() && row.response && row.response.trim());
}

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

          const qWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const rWords = new Set(response.toLowerCase().split(/\s+/));
          const relevantWords = qWords.filter(w => rWords.has(w)).length;
          const relevance = qWords.length > 0 ? relevantWords / qWords.length : 0.5;

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

          const incoherenceMarkers = ['i think', 'maybe', 'probably', 'might be', 'could be', 'not sure', 'unclear'];
          const markerCount = incoherenceMarkers.filter(marker => response.toLowerCase().includes(marker)).length;
          const coherence = Math.max(0, 1 - (markerCount * 0.15));

          const toxicWords = ['hate', 'stupid', 'dumb', 'idiot', 'fool', 'terrible', 'horrible', 'awful', 'bad', 'worst', 'sucks', 'disgusting'];
          const toxicCount = toxicWords.filter(word => response.toLowerCase().includes(word)).length;
          const toxicity = Math.min(1, toxicCount * 0.1);

          const biasTerms = ['he', 'she', 'man', 'woman', 'male', 'female', 'black', 'white', 'asian', 'hispanic', 'jewish', 'muslim', 'christian', 'old', 'young', 'kid'];
          const biasCount = biasTerms.filter(term => {
            const regex = new RegExp('\\b' + term + '\\b', 'i');
            return regex.test(response);
          }).length;
          const bias = Math.min(1, biasCount / Math.max(20, response.split(/\s+/).length / 5));

          const hallucMarkers = ['i think', 'maybe', 'probably', 'might be', 'could be', 'i believe', 'possibly', 'perhaps', 'not sure', 'unclear', 'unknown', 'i guess'];
          const hallucCount = hallucMarkers.filter(marker => response.toLowerCase().includes(marker)).length;
          const hallucination = Math.min(1, hallucCount / 6);

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

function summarizeEvaluationRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      relevance: 0,
      length_appropriateness: 0,
      coherence: 0,
      toxicity: 0,
      bias: 0,
      hallucination: 0,
      average_score: 0,
    };
  }

  const totals = rows.reduce((acc, row) => {
    acc.relevance += Number(row?.Relevance || 0);
    acc.length_appropriateness += Number(row?.['Length appropriateness'] || 0);
    acc.coherence += Number(row?.Coherence || 0);
    acc.toxicity += Number(row?.Toxicity || 0);
    acc.bias += Number(row?.Bias || 0);
    acc.hallucination += Number(row?.Hallucination || 0);
    acc.average_score += Number(row?.['Overall Score'] || 0);
    return acc;
  }, {
    relevance: 0,
    length_appropriateness: 0,
    coherence: 0,
    toxicity: 0,
    bias: 0,
    hallucination: 0,
    average_score: 0,
  });

  const count = rows.length;
  return {
    relevance: totals.relevance / count,
    length_appropriateness: totals.length_appropriateness / count,
    coherence: totals.coherence / count,
    toxicity: totals.toxicity / count,
    bias: totals.bias / count,
    hallucination: totals.hallucination / count,
    average_score: totals.average_score / count,
  };
}

// Store evaluation results
async function storeEvaluationResult(evaluation) {
    try {
        const { history } = await chrome.storage.local.get('history') || { history: [] };
        history.push({
            ...evaluation,
            timestamp: new Date().toISOString(),
            url: evaluation.url
        });
        await chrome.storage.local.set({ history });
    } catch (error) {
        console.error('Error storing evaluation:', error);
    }
}

// Get evaluation history
async function getEvaluationHistory() {
    try {
        const { history } = await chrome.storage.local.get('history') || { history: [] };
        return history;
    } catch (error) {
        console.error('Error getting evaluation history:', error);
        return [];
    }
}

// Clear evaluation history
async function clearEvaluationHistory() {
    try {
        await chrome.storage.local.remove('history');
    } catch (error) {
        console.error('Error clearing evaluation history:', error);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'evaluate') {
    if (!request.logs || !Array.isArray(request.logs)) {
      sendResponse({ success: false, error: 'Invalid logs format: Expected array of chat messages' });
      return true;
    }

    handleEvaluation(request.logs)
      .then(results => {
        sendResponse({ success: true, results: results });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates we will send a response asynchronously
  }
});

async function handleEvaluation(logs, apiEndpoint) {
  try {
    // Validate input logs
    if (!Array.isArray(logs) || logs.length === 0) {
      throw new Error('Invalid logs format: Expected non-empty array');
    }

    // Prepare the evaluation data
    const evaluationData = {
      logs: logs.map(log => ({
        timestamp: log.timestamp || new Date().toISOString(),
        role: log.role || 'unknown',
        content: log.content || '',
        source: log.source || 'chat'
      })),
      metadata: {
        total_logs: logs.length,
        date_range: {
          start: logs[0].timestamp || new Date().toISOString(),
          end: logs[logs.length - 1].timestamp || new Date().toISOString()
        }
      }
    };
    
    // Call evaluation API with properly formatted data
    const results = await callEvaluationAPI(evaluationData);
    
    return results;
  } catch (error) {
    console.error('Error in evaluation:', error);
    throw error;
  }
}

async function callEvaluationAPI(evaluationData) {
  try {
    // Input validation
    if (!evaluationData || !evaluationData.logs || !Array.isArray(evaluationData.logs)) {
      throw new Error('Invalid evaluation data format');
    }

    // Build evaluation results using local analysis functions (TF-IDF + scoring engine)
    const results = {
      toxicity_scores: analyzeBasicToxicity(evaluationData.logs),
      hallucination_score: estimateHallucination(evaluationData.logs),
      bias_metrics: analyzeBasicBias(evaluationData.logs),
      bleu_score: calculateSimpleBLEU(evaluationData.logs),
      message_pairs: evaluationData.logs.length,
      metadata: {
        ...evaluationData.metadata,
        timestamp: new Date().toISOString(),
        similarity_method: 'TF-IDF Weighted Jaccard (Local)'
      }
    };

    return parseEvaluationResults(results);

  } catch (error) {
    console.error('Evaluation API error:', error);
    throw error;
    }
    throw error;
  }


function parseEvaluationResults(apiResponse) {
  if (!apiResponse || typeof apiResponse !== 'object') {
    throw new Error('Invalid API response format');
  }

  const metrics = {
    semantic_similarity: null,
    toxicity: null,
    bias: null,
    hallucination: null,
    bleu: null
  };

  // Extract semantic similarity from embeddings if present
  if (apiResponse.embeddings_similarity) {
    metrics.semantic_similarity = apiResponse.embeddings_similarity;
  }

  // Extract toxicity scores
  if (apiResponse.toxicity_scores) {
    metrics.toxicity = Array.isArray(apiResponse.toxicity_scores) 
      ? 1 - (apiResponse.toxicity_scores.reduce((a, b) => a + b, 0) / apiResponse.toxicity_scores.length)
      : apiResponse.toxicity_scores;
  }

  // Extract bias metrics
  if (apiResponse.bias_metrics) {
    metrics.bias = typeof apiResponse.bias_metrics === 'number' 
      ? apiResponse.bias_metrics 
      : calculateAggregatedBias(apiResponse.bias_metrics);
  }

  // Extract hallucination score
  if (apiResponse.hallucination_score !== undefined) {
    metrics.hallucination = apiResponse.hallucination_score;
  }

  // Extract BLEU score
  if (apiResponse.bleu_score !== undefined) {
    metrics.bleu = apiResponse.bleu_score;
  }

  // Include raw metrics for detailed analysis
  return {
    ...metrics,
    raw_metrics: {
      ...apiResponse,
      timestamp: new Date().toISOString()
    }
  };
}

function calculateAggregatedBias(biasMetrics) {
  if (!biasMetrics || typeof biasMetrics !== 'object') return null;
  
  // Aggregate different types of bias scores
  const scores = Object.values(biasMetrics).filter(score => typeof score === 'number');
  if (scores.length === 0) return null;
  
  return 1 - (scores.reduce((a, b) => a + b, 0) / scores.length);
}

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('LLM Evaluation Tool extension installed');
});





