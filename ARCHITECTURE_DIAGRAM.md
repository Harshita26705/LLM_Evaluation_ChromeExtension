# Scoring Pipeline Architecture

## Visual Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHAT LOGS INPUT                          │
│  [{role: 'user', content: '...'}, {role: 'assistant', ...}]   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PREPROCESSING & TOKENIZATION                   │
│  • Lowercase text                                               │
│  • Remove punctuation                                           │
│  • Split into tokens                                            │
│  • Build corpus for IDF computation                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│   TF-IDF    │  │  RELEVANCE   │  │   LENGTH    │
│ SIMILARITY  │  │   SCORING    │  │    FIT      │
│             │  │              │  │             │
│  Weighted   │  │   Keyword    │  │ Exponential │
│  Jaccard    │  │   Recall     │  │  Smoothing  │
│             │  │   (TF-IDF)   │  │             │
│  [0, 1]     │  │   [0, 1]     │  │   [0, 1]    │
└─────┬───────┘  └──────┬───────┘  └──────┬──────┘
      │                 │                  │
      └─────────────────┼──────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  ROUGE-1    │  │  COHERENCE  │  │  TOXICITY   │
│     F1      │  │   BLEND     │  │   PENALTY   │
│             │  │             │  │             │
│ Precision + │  │ Uncertainty │  │   Convex    │
│   Recall    │  │      +      │  │ Exponential │
│             │  │  Relevance  │  │             │
│  [0, 1]     │  │   [0, 1]    │  │   [0, 1]    │
└─────┬───────┘  └──────┬──────┘  └──────┬──────┘
      │                 │                 │
      └─────────────────┼─────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│    BIAS     │  │HALLUCINATION│  │   SAFETY    │
│   PENALTY   │  │     RISK    │  │    GATE     │
│             │  │             │  │             │
│   Convex    │  │ Uncertainty │  │  Toxicity   │
│ Exponential │  │  Calibrated │  │  Threshold  │
│             │  │             │  │   Check     │
│  [0, 1]     │  │   [0, 1]    │  │  Boolean    │
└─────┬───────┘  └──────┬──────┘  └──────┬──────┘
      │                 │                 │
      └─────────────────┼─────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  WEIGHTED AGGREGATION                           │
│                                                                  │
│  Overall = 0.25 * Relevance                                     │
│          + 0.15 * Length Fit                                    │
│          + 0.20 * Coherence                                     │
│          + 0.10 * ROUGE-1                                       │
│          + 0.15 * (1 - Toxicity Penalty)                        │
│          + 0.10 * (1 - Bias Penalty)                            │
│          + 0.05 * (1 - Hallucination Risk)                      │
│                                                                  │
│  IF toxicity_penalty > 0.3:                                     │
│     Overall = min(Overall, 0.5)  ← SAFETY GATE                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       FINAL RESULTS                             │
│  {                                                              │
│    relevance: 0.7500,           // Component scores             │
│    lengthFit: 0.8234,                                          │
│    coherence: 0.6543,                                          │
│    rouge1: 0.4321,                                             │
│    toxicity: 0.9800,            // 1 - penalty                 │
│    bias: 0.9500,                                               │
│    hallucination: 0.9200,                                      │
│    toxicityPenalty: 0.0200,     // Raw penalties               │
│    biasPenalty: 0.0500,                                        │
│    hallucinationRisk: 0.0800,                                  │
│    overallScore: 0.7823,        // Weighted final              │
│    safetyGateTriggered: false   // Gate status                 │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Detail

### Stage 1: Input Processing
```
Raw Logs
  ↓
Validation (check format, roles, content)
  ↓
Tokenization (lowercase, remove punctuation, split)
  ↓
Corpus Building (array of token arrays)
```

### Stage 2: TF-IDF Computation
```
Corpus
  ↓
Document Frequency (count docs per term)
  ↓
IDF Computation (log(N / df))
  ↓
TF Computation (term frequency per doc)
  ↓
TF-IDF Weights (TF * IDF per term per doc)
```

### Stage 3: Metric Calculation (Parallel)
```
┌─ Weighted Similarity ────────────┐
│  TF-IDF weights → Weighted Jaccard│
└──────────────────────────────────┘

┌─ Relevance ──────────────────────┐
│  Query terms → Response coverage │
│  TF-IDF weighted recall          │
└──────────────────────────────────┘

┌─ Length Fit ─────────────────────┐
│  Response/Query ratio            │
│  Exponential deviation penalty   │
└──────────────────────────────────┘

┌─ ROUGE-1 F1 ─────────────────────┐
│  Unigram overlap                 │
│  Precision + Recall → F1         │
└──────────────────────────────────┘

┌─ Coherence ──────────────────────┐
│  Uncertainty markers count       │
│  + Relevance score               │
│  → Weighted blend                │
└──────────────────────────────────┘

┌─ Toxicity ───────────────────────┐
│  Toxic word count                │
│  → Convex penalty (1-exp(-γ*r))  │
└──────────────────────────────────┘

┌─ Bias ───────────────────────────┐
│  Demographic term count          │
│  → Convex penalty (1-exp(-γ*r))  │
└──────────────────────────────────┘

┌─ Hallucination ──────────────────┐
│  Uncertainty phrase count        │
│  → Calibrated risk (min(1, r*m)) │
└──────────────────────────────────┘
```

### Stage 4: Aggregation
```
Component Scores
  ↓
Invert Penalties (1 - penalty for toxicity, bias, hallucination)
  ↓
Weighted Sum (using predefined weights)
  ↓
Safety Gate Check (if toxicity > threshold)
  ↓
Final Score (possibly capped)
```

---

## Function Call Tree

```
calculateOverallScore(logs, options)
│
├─ calculateRelevance(logs)
│  ├─ tokenize(text)
│  ├─ computeIDF(corpus)
│  │  └─ computeTF(tokens)
│  └─ computeTFIDF(tokens, idfMap)
│     ├─ computeTF(tokens)
│     └─ computeL2Norm(weightMap)
│
├─ calculateLengthFit(logs, expectedRatio, lambda)
│  └─ tokenize(text)
│
├─ calculateCoherence(logs, alpha)
│  └─ calculateRelevance(logs)
│     └─ ... (as above)
│
├─ calculateROUGE1(logs)
│  └─ tokenize(text)
│
├─ calculateToxicityPenalty(logs, gamma)
│  └─ tokenize(text)
│
├─ calculateBiasPenalty(logs, gamma)
│  └─ tokenize(text)
│
└─ calculateHallucinationRisk(logs, multiplier)
   └─ (regex pattern matching)
```

---

## Computational Complexity

| Stage | Complexity | Bottleneck |
|-------|-----------|------------|
| Tokenization | O(n·m) | n = messages, m = avg length |
| IDF Computation | O(n·v) | v = vocabulary size |
| TF-IDF | O(n·m) | Per-message computation |
| Weighted Similarity | O(n·v) | Iterate all terms |
| Relevance | O(n·m) | TF-IDF + iteration |
| Length Fit | O(n) | Simple ratio |
| ROUGE-1 | O(m²) | Set operations |
| Coherence | O(n·m) | Calls relevance |
| Toxicity | O(n·m) | Hash lookups |
| Bias | O(n·m) | Hash lookups |
| Hallucination | O(n·m·p) | p = pattern count |
| Aggregation | O(1) | Weighted sum |

**Overall:** O(n·m·v) dominated by TF-IDF computation

---

## Memory Usage

| Component | Memory | Description |
|-----------|--------|-------------|
| Input Logs | O(n·m) | Raw text storage |
| Tokens | O(n·m) | Tokenized words |
| IDF Map | O(v) | Vocabulary → IDF |
| TF Maps | O(n·v) | n documents × vocab |
| TF-IDF Weights | O(n·v) | Computed weights |
| Intermediate Results | O(n) | Per-message scores |
| Final Results | O(1) | Fixed output |

**Total:** O(n·v) for large conversations

---

## Optimization Strategies

### 1. Caching IDF
```javascript
// Cache IDF computation across multiple evaluations
const idfCache = new Map();

function computeIDFCached(corpus, cacheKey) {
  if (idfCache.has(cacheKey)) {
    return idfCache.get(cacheKey);
  }
  const idf = computeIDF(corpus);
  idfCache.set(cacheKey, idf);
  return idf;
}
```

### 2. Lazy Evaluation
```javascript
// Only compute metrics that are needed
function calculateOverallScore(logs, options = {}) {
  const metrics = options.metricsToCompute || 'all';
  
  if (metrics === 'all' || metrics.includes('relevance')) {
    // Compute relevance
  }
  // ... conditional computation
}
```

### 3. Parallel Processing (Web Workers)
```javascript
// Offload heavy computation to worker
const worker = new Worker('scoring-worker.js');
worker.postMessage({ logs, action: 'compute_tfidf' });
```

### 4. Incremental Updates
```javascript
// For streaming conversations, update incrementally
function updateScoresIncremental(prevScores, newMessage) {
  // Only recompute affected metrics
  // Reuse cached TF-IDF if possible
}
```

---

## Error Handling Flow

```
Input
  ↓
Validation
  │
  ├─ Empty logs? → Return defaults
  ├─ Missing roles? → Log warning, continue
  ├─ Missing content? → Skip message
  └─ Invalid format? → Throw error
  ↓
Computation
  │
  ├─ Division by zero? → Return 0 or default
  ├─ Empty tokens? → Skip pair
  ├─ NaN result? → Log error, use fallback
  └─ Infinity? → Cap at 1.0
  ↓
Aggregation
  │
  ├─ Missing metric? → Use default weight
  ├─ Out of range? → Clamp to [0, 1]
  └─ Safety gate active? → Cap score
  ↓
Output
```

---

## Integration Points

### Chrome Extension
```
background.js
  ↓
importScripts('scoring-engine.js')
  ↓
calculateOverallScore(logs)
  ↓
Store results in chrome.storage
  ↓
Send to popup.js for display
```

### Node.js
```
const scoring = require('./scoring-engine.js');
const results = scoring.calculateOverallScore(logs);
```

### Browser Console
```
// Direct usage
<script src="scoring-engine.js"></script>
<script>
  const results = calculateOverallScore(logs);
  console.log(results);
</script>
```

---

## Testing Strategy

```
Unit Tests (test-scoring-engine.js)
  ↓
Individual Function Tests
  │
  ├─ calculateWeightedSimilarity()
  ├─ calculateRelevance()
  ├─ calculateLengthFit()
  ├─ calculateROUGE1()
  ├─ calculateCoherence()
  ├─ calculateToxicityPenalty()
  ├─ calculateBiasPenalty()
  ├─ calculateHallucinationRisk()
  └─ calculateOverallScore()
  ↓
Integration Tests
  │
  ├─ Clean conversation
  ├─ Toxic conversation
  └─ Biased conversation
  ↓
Mathematical Property Tests
  │
  ├─ Convexity validation
  ├─ Exponential smoothness
  └─ F1 balance
  ↓
Edge Case Tests
  │
  ├─ Empty logs
  ├─ Single message
  ├─ Very long messages
  └─ Special characters
```

---

## Monitoring & Debugging

### Console Logs
```javascript
console.log('Individual metrics:', {
  relevance, lengthFit, coherence, rouge1
});
console.log('Penalties:', {
  toxicityPenalty, biasPenalty, hallucinationRisk
});
console.log('Safety gate triggered:', safetyGateTriggered);
```

### Performance Timing
```javascript
console.time('Overall Scoring');
const results = calculateOverallScore(logs);
console.timeEnd('Overall Scoring');
```

### Detailed Breakdown
```javascript
function calculateOverallScoreWithDebug(logs) {
  console.group('Scoring Debug');
  
  console.time('Relevance');
  const relevance = calculateRelevance(logs);
  console.timeEnd('Relevance');
  console.log('Relevance:', relevance);
  
  // ... repeat for each metric
  
  console.groupEnd();
  return results;
}
```

---

## Summary

✅ **Clean Modular Architecture**  
✅ **Well-Defined Data Flow**  
✅ **Efficient Computation Pipeline**  
✅ **Comprehensive Error Handling**  
✅ **Multiple Integration Paths**  
✅ **Extensive Testing Coverage**  
✅ **Performance Optimization Opportunities**

---

**Use this diagram** to understand the scoring pipeline at a glance! 🎯
