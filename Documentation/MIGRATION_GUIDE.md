# Migration Guide: Old vs New Scoring Functions

## Quick Summary

| Metric | Old Approach | New Approach | Improvement |
|--------|-------------|--------------|-------------|
| **Similarity** | Plain Jaccard | TF-IDF Weighted Jaccard | Weights important terms |
| **BLEU-lite** | Unigram overlap | ROUGE-1 F1 | Balances precision/recall |
| **Length** | None/Default | Exponential smoothing | Penalizes deviations smoothly |
| **Toxicity** | Linear ratio | Convex exponential | Accelerating penalty |
| **Bias** | Linear ratio | Convex exponential | Accelerating penalty |
| **Coherence** | Uncertainty only | Uncertainty + Relevance | Two-signal blend |
| **Overall** | Weighted avg | Weighted avg + Safety gate | Caps toxic content |

---

## Function Mapping

### ❌ Old → ✅ New

```javascript
// SIMILARITY
❌ calculateBasicSimilarity(logs)
✅ calculateWeightedSimilarity(logs)

// RELEVANCE
❌ calculateRelevance(logs)  // Simple keyword recall
✅ calculateRelevance(logs)  // TF-IDF weighted recall

// BLEU-LITE
❌ calculateSimpleBLEU(logs)
✅ calculateROUGE1(logs)

// LENGTH
❌ // No function, used default 0.75
✅ calculateLengthFit(logs, expectedRatio=2.0, lambda=0.5)

// TOXICITY
❌ analyzeBasicToxicity(logs)  // Returns toxicity score
✅ calculateToxicityPenalty(logs)  // Returns penalty [0,1]
   // Use (1 - penalty) for positive score

// BIAS
❌ analyzeBasicBias(logs)  // Returns bias score
✅ calculateBiasPenalty(logs)  // Returns penalty [0,1]
   // Use (1 - penalty) for positive score

// COHERENCE
❌ analyzeCoherence(logs)  // Uncertainty markers only
✅ calculateCoherence(logs, alpha=0.6)  // Uncertainty + relevance blend

// HALLUCINATION
❌ estimateHallucination(logs)  // Raw count
✅ calculateHallucinationRisk(logs, multiplier=0.3)  // Calibrated risk

// OVERALL
❌ Manual weighted sum in analyzeLogs()
✅ calculateOverallScore(logs, options)  // Includes safety gate
```

---

## Code Changes Required

### 1. Update background.js (Already Done ✓)

**Before:**
```javascript
let toxicity, coherence, bias, hallucination, relevance;
let lengthAppropriateness = 0.75;

try { toxicity = analyzeBasicToxicity(logs) || 0; } catch(e) { ... }
try { coherence = analyzeCoherence(logs) || 0; } catch(e) { ... }
try { bias = analyzeBasicBias(logs) || 0; } catch(e) { ... }
try { hallucination = estimateHallucination(logs) || 0; } catch(e) { ... }
try { relevance = calculateRelevance(logs) || 0; } catch(e) { ... }

const results = {
  relevance: relevance,
  length_appropriateness: lengthAppropriateness,
  coherence: coherence,
  toxicity: toxicity,
  bias: bias,
  hallucination: hallucination,
  overall_score: (relevance * 0.2 + lengthAppropriateness * 0.15 + 
                  coherence * 0.15 + toxicity * 0.15 + bias * 0.15 + 
                  (1 - hallucination) * 0.2)
};
```

**After:**
```javascript
const scoringResults = calculateOverallScore(logs);

const results = {
  relevance: scoringResults.relevance,
  length_appropriateness: scoringResults.lengthFit,
  coherence: scoringResults.coherence,
  rouge1: scoringResults.rouge1,
  toxicity: scoringResults.toxicity,
  bias: scoringResults.bias,
  hallucination: scoringResults.hallucination,
  overall_score: scoringResults.overallScore,
  safety_gate_triggered: scoringResults.safetyGateTriggered,
  toxicity_penalty: scoringResults.toxicityPenalty,
  bias_penalty: scoringResults.biasPenalty,
  hallucination_risk: scoringResults.hallucinationRisk
};
```

### 2. Update manifest.json (Already Done ✓)

**Added:**
```json
"background": {
  "service_worker": "background.js",
  "type": "module"
}
```

### 3. Add scoring-engine.js import (Already Done ✓)

**In background.js:**
```javascript
importScripts('scoring-engine.js');
```

---

## Key Behavioral Changes

### 1. Toxicity/Bias Scores Are Now Inverted

**Old behavior:**
- `analyzeBasicToxicity()` returned `[0,1]` where 1 = toxic
- Higher values were BAD

**New behavior:**
- `calculateToxicityPenalty()` returns penalty `[0,1]` where 1 = toxic
- But `overallScore` contains `toxicity` field which is `1 - penalty`
- Higher values are GOOD (consistent with other metrics)

**Migration:**
```javascript
// Old
const toxicity = analyzeBasicToxicity(logs);  // 0.1 = toxic
const toxicityScore = 1 - toxicity;  // Convert to positive score

// New
const results = calculateOverallScore(logs);
const toxicityScore = results.toxicity;  // Already positive (0.9 = clean)
const toxicityPenalty = results.toxicityPenalty;  // Raw penalty if needed
```

### 2. Length Now Actually Computed

**Old behavior:**
- Always returned `0.75` (hardcoded default)

**New behavior:**
- Computed per user-assistant pair
- Penalizes deviations from expected ratio (default 2x)
- Returns score `[0,1]` where 1 = perfect length

### 3. Coherence Now Multi-Signal

**Old behavior:**
- Only counted uncertainty markers
- `coherence = 1 - (markers / responses)`

**New behavior:**
- Blends uncertainty (60%) + relevance (40%)
- More robust, harder to fool
- Better captures conversation flow

### 4. Overall Score Has Safety Gate

**Old behavior:**
- Simple weighted sum
- Toxic content could still score moderately high if other metrics were good

**New behavior:**
- If `toxicityPenalty > 0.3`, overall score capped at `0.5`
- Prevents toxic conversations from achieving high scores
- Can be disabled with `toxicityThreshold: 1.0`

---

## Testing Your Integration

### Step 1: Verify Functions Load

```javascript
// In browser console after loading extension
console.log(typeof calculateOverallScore);  // Should be "function"
console.log(typeof calculateWeightedSimilarity);  // Should be "function"
```

### Step 2: Test with Sample Data

```javascript
const testLogs = [
  { role: 'user', content: 'What is AI?' },
  { role: 'assistant', content: 'AI stands for Artificial Intelligence...' }
];

const results = calculateOverallScore(testLogs);
console.log(results);
// Should return object with all metrics
```

### Step 3: Verify Safety Gate

```javascript
const toxicLogs = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'You are stupid and dumb!' }
];

const results = calculateOverallScore(toxicLogs);
console.log('Safety gate triggered:', results.safetyGateTriggered);
console.log('Overall score:', results.overallScore);
// Should show: safetyGateTriggered = true, overallScore <= 0.5
```

### Step 4: Run Full Test Suite

```bash
# If you have Node.js installed
node test-scoring-engine.js

# Or in browser console:
# 1. Load scoring-engine.js
# 2. Load test-scoring-engine.js
# Should see all tests pass
```

---

## Backward Compatibility

The old functions are **marked as DEPRECATED** but still present in `background.js`:
- `calculateRelevanceLegacy()`
- `analyzeBasicToxicity()`
- `analyzeCoherence()`
- `estimateHallucination()`
- `analyzeBasicBias()`

These can be removed once you've verified the new system works correctly.

---

## Troubleshooting

### Issue: "calculateOverallScore is not defined"

**Solution:** Ensure `scoring-engine.js` is loaded before `background.js`:
```javascript
// In background.js, first line after comments:
importScripts('scoring-engine.js');
```

### Issue: Scores seem too low/high

**Solution:** Adjust parameters:
```javascript
// Less aggressive toxicity penalty
calculateToxicityPenalty(logs, gamma=3.0);  // Default is 5.0

// More lenient length expectations
calculateLengthFit(logs, expectedRatio=3.0);  // Default is 2.0

// Different coherence weighting
calculateCoherence(logs, alpha=0.5);  // Default is 0.6
```

### Issue: Safety gate triggering too often

**Solution:** Adjust threshold:
```javascript
calculateOverallScore(logs, {
  toxicityThreshold: 0.5  // Default is 0.3 (more aggressive)
});
```

### Issue: Want different overall weights

**Solution:** Customize weights:
```javascript
calculateOverallScore(logs, {
  weights: {
    relevance: 0.30,
    lengthFit: 0.10,
    coherence: 0.20,
    rouge1: 0.10,
    toxicity: 0.15,
    bias: 0.10,
    hallucination: 0.05
  }
});
```

---

## Performance Comparison

| Metric | Old Time | New Time | Notes |
|--------|----------|----------|-------|
| Similarity | Fast | Moderate | TF-IDF adds computation |
| Relevance | Fast | Moderate | TF-IDF adds computation |
| Length | N/A | Fast | New metric |
| ROUGE-1 | Fast | Fast | Similar to old BLEU |
| Coherence | Fast | Moderate | Calls relevance |
| Toxicity | Fast | Fast | Same lookup |
| Bias | Fast | Fast | Same lookup |
| Overall | Fast | Moderate | Computes all metrics |

**Recommendation:** For large datasets (>100 messages), consider caching TF-IDF computations.

---

## Next Steps

1. ✅ Load the extension in Chrome
2. ✅ Test with sample conversations
3. ✅ Verify scores make sense
4. ✅ Adjust parameters if needed
5. ✅ Remove deprecated functions after validation
6. ✅ Update UI if displaying new metrics (rouge1, safety gate)

---

## Questions?

Refer to:
- **Full Documentation:** `SCORING_ENGINE_DOCS.md`
- **Implementation:** `scoring-engine.js`
- **Tests:** `test-scoring-engine.js`
- **Integration:** `background.js` (lines 1-120)
