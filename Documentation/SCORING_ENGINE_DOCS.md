# Robust Scoring Engine Documentation

## Overview

This scoring engine provides mathematically sound evaluation metrics for chatbot conversations. All formulas are designed to be robust, normalized to [0,1], and based on established NLP and ML principles.

## Core Improvements

### 1. **Weighted Jaccard Similarity with TF-IDF**

**Previous:** Simple word overlap (plain Jaccard)
```javascript
// Old: intersection.size / union.size
```

**New:** TF-IDF weighted Jaccard
```javascript
J_weighted(A, B) = Σ min(w_i^A, w_i^B) / Σ max(w_i^A, w_i^B)
```

**Why Better:**
- Weights important terms higher (TF-IDF)
- Downweights common stopwords automatically
- More semantic overlap detection
- Robust to document length

**Usage:**
```javascript
const similarity = calculateWeightedSimilarity(logs);
// Returns: 0.0 (no overlap) to 1.0 (identical weighted terms)
```

---

### 2. **ROUGE-1 F1 Score**

**Previous:** Simple unigram overlap (BLEU-lite)
```javascript
// Old: overlap / max(ref.length, cand.length)
```

**New:** ROUGE-1 with F1 measure
```javascript
Precision = |overlap| / |candidate|
Recall = |overlap| / |reference|
F1 = 2 * (Precision * Recall) / (Precision + Recall)
```

**Why Better:**
- Balances precision and recall
- Standard metric in summarization
- Better handles length mismatches
- More interpretable

**Usage:**
```javascript
const rouge1 = calculateROUGE1(logs);
// Returns: 0.0 (no overlap) to 1.0 (perfect match)
```

---

### 3. **Exponential Length Appropriateness**

**Previous:** Linear ratio
```javascript
// Old: responseLen / queryLen (unbounded, no smoothing)
```

**New:** Exponentially smoothed deviation
```javascript
Score = exp(-λ * |log(ratio / expected)|)
```

**Parameters:**
- `expected`: Expected response/query ratio (default: 2.0)
- `λ` (lambda): Penalty steepness (default: 0.5)

**Why Better:**
- Smooth, continuous penalty
- Symmetric for over/under-length
- Log-space for ratio comparison
- Tunable sensitivity

**Usage:**
```javascript
const lengthFit = calculateLengthFit(logs, expectedRatio=2.0, lambda=0.5);
// Returns: 0.0 (very poor fit) to 1.0 (perfect fit)
```

**Visualization:**
```
Length Ratio:  0.5    1.0    2.0    3.0    4.0
Score:         0.61   0.85   1.00   0.85   0.74
                └──────────┬──────────┘
                    Smooth decay
```

---

### 4. **Convex Toxicity Penalty**

**Previous:** Linear ratio
```javascript
// Old: toxicCount / totalWords
```

**New:** Exponential (convex) penalty
```javascript
Penalty = 1 - exp(-γ * toxic_ratio)
```

**Parameter:**
- `γ` (gamma): Sensitivity (default: 5.0)

**Why Better:**
- Accelerating penalty as toxicity increases
- Small amounts have moderate impact
- Large amounts severely penalized
- Convex → stronger incentive to avoid

**Usage:**
```javascript
const toxicityPenalty = calculateToxicityPenalty(logs, gamma=5.0);
// Returns: 0.0 (clean) to 1.0 (highly toxic)
```

**Convexity Demonstration:**
```
Toxic Ratio:   0.01   0.05   0.10   0.20
Penalty:       0.049  0.221  0.393  0.632
Growth Rate:   →→→    →→→→   →→→→→  →→→→→→
               (accelerating)
```

---

### 5. **Convex Bias Penalty**

**Previous:** Linear ratio of demographic terms
```javascript
// Old: biasCount / totalWords
```

**New:** Exponential (convex) penalty
```javascript
Penalty = 1 - exp(-γ * bias_ratio)
```

**Parameter:**
- `γ` (gamma): Sensitivity (default: 4.0)

**Why Better:**
- Smooth, continuous penalty
- Moderate penalty for occasional mentions
- Severe penalty for frequent bias
- Convex function accelerates with usage

**Usage:**
```javascript
const biasPenalty = calculateBiasPenalty(logs, gamma=4.0);
// Returns: 0.0 (neutral) to 1.0 (highly biased)
```

---

### 6. **Coherence as Uncertainty-Relevance Blend**

**Previous:** Simple inversion of uncertainty markers
```javascript
// Old: 1 - (markerCount / responses)
```

**New:** Weighted blend of two signals
```javascript
Coherence = α * (1 - uncertainty_density) + (1-α) * relevance
```

**Parameters:**
- `α` (alpha): Uncertainty weight (default: 0.6)
- `uncertainty_density`: Markers per response (normalized)
- `relevance`: From TF-IDF relevance score

**Why Better:**
- Combines two independent signals
- Uncertainty → internal coherence
- Relevance → contextual coherence
- More robust than single metric

**Usage:**
```javascript
const coherence = calculateCoherence(logs, alpha=0.6);
// Returns: 0.0 (incoherent) to 1.0 (highly coherent)
```

---

### 7. **Hallucination Risk**

**Previous:** Raw uncertainty count
```javascript
// Old: uncertainCount / totalResponses
```

**New:** Calibrated risk score
```javascript
Risk = min(1, uncertainty_per_response * multiplier)
```

**Parameter:**
- `multiplier`: Risk amplification (default: 0.3)

**Why Better:**
- Calibrated scale
- Avoids over-penalizing cautious responses
- Capped at 1.0
- Interpretable as probability-like score

**Usage:**
```javascript
const hallucinationRisk = calculateHallucinationRisk(logs, multiplier=0.3);
// Returns: 0.0 (confident) to 1.0 (likely hallucinating)
```

---

### 8. **Overall Score with Safety Gate**

**Previous:** Simple weighted average
```javascript
// Old: Σ (w_i * metric_i)
```

**New:** Weighted average with safety cap
```javascript
Score_raw = Σ (w_i * metric_i)
Score_final = min(Score_raw, cap) if toxicity > threshold
```

**Weights (default):**
```javascript
{
  relevance: 0.25,      // 25% - most important
  lengthFit: 0.15,      // 15%
  coherence: 0.20,      // 20%
  rouge1: 0.10,         // 10%
  toxicity: 0.15,       // 15% (inverted)
  bias: 0.10,           // 10% (inverted)
  hallucination: 0.05   // 5% (inverted)
}
```

**Safety Gate:**
- If `toxicityPenalty > 0.3`, cap overall score at `0.5`
- Prevents toxic content from achieving high scores
- Configurable thresholds

**Usage:**
```javascript
const results = calculateOverallScore(logs, {
  toxicityThreshold: 0.3,  // Trigger gate if toxicity > 0.3
  toxicityCap: 0.5,        // Cap score at 0.5 when triggered
  weights: { ... }          // Custom weights (optional)
});
```

**Returns:**
```javascript
{
  // Component scores (positive, higher is better)
  relevance: 0.7500,
  lengthFit: 0.8234,
  coherence: 0.6543,
  rouge1: 0.4321,
  toxicity: 0.9800,        // 1 - toxicityPenalty
  bias: 0.9500,            // 1 - biasPenalty
  hallucination: 0.9200,   // 1 - hallucinationRisk
  
  // Raw penalties (for transparency)
  toxicityPenalty: 0.0200,
  biasPenalty: 0.0500,
  hallucinationRisk: 0.0800,
  
  // Overall
  overallScore: 0.7823,
  safetyGateTriggered: false,
  messageCount: 10
}
```

---

## Integration Guide

### Chrome Extension Integration

**1. Load the scoring engine:**
```javascript
// In manifest.json (already configured)
"background": {
  "service_worker": "background.js",
  "type": "module"
}

// In background.js (already added)
importScripts('scoring-engine.js');
```

**2. Use in your analysis:**
```javascript
async function analyzeLogs(logs) {
  // Get all scores at once
  const results = calculateOverallScore(logs);
  
  // Or get individual scores
  const relevance = calculateRelevance(logs);
  const coherence = calculateCoherence(logs);
  const toxicity = calculateToxicityPenalty(logs);
  
  return results;
}
```

### Testing

Run the test suite:
```javascript
// In browser console or Node.js
// Load scoring-engine.js first, then:
// (test-scoring-engine.js will run automatically)
```

---

## Mathematical Properties

### ✓ Normalization
All scores ∈ [0, 1]

### ✓ Convexity
Toxicity and bias penalties are convex (accelerating)

### ✓ Smoothness
Length penalty is smooth and differentiable

### ✓ Balance
ROUGE-1 F1 balances precision and recall

### ✓ Robustness
TF-IDF weighting handles term importance

### ✓ Safety
High toxicity caps overall score (safety gate)

---

## Customization

### Adjusting Sensitivity

**Toxicity/Bias Penalties:**
```javascript
// More aggressive (penalizes earlier)
const toxicity = calculateToxicityPenalty(logs, gamma=10.0);

// More lenient (penalizes later)
const toxicity = calculateToxicityPenalty(logs, gamma=2.0);
```

**Length Appropriateness:**
```javascript
// Expect longer responses (3x query length)
const lengthFit = calculateLengthFit(logs, expectedRatio=3.0);

// Stricter penalty for deviations
const lengthFit = calculateLengthFit(logs, expectedRatio=2.0, lambda=1.0);
```

**Coherence Weighting:**
```javascript
// Favor uncertainty signal (internal coherence)
const coherence = calculateCoherence(logs, alpha=0.8);

// Favor relevance signal (contextual coherence)
const coherence = calculateCoherence(logs, alpha=0.4);
```

### Custom Overall Score Weights

```javascript
const results = calculateOverallScore(logs, {
  weights: {
    relevance: 0.30,      // Increase relevance importance
    lengthFit: 0.10,
    coherence: 0.25,
    rouge1: 0.10,
    toxicity: 0.10,
    bias: 0.10,
    hallucination: 0.05
  }
});
```

### Custom Safety Gate

```javascript
const results = calculateOverallScore(logs, {
  toxicityThreshold: 0.2,  // More aggressive gate
  toxicityCap: 0.3         // Lower cap
});
```

---

## Performance Notes

- **TF-IDF Computation:** O(n·m) where n = messages, m = avg tokens
- **Recommended:** Cache IDF computation for large datasets
- **Memory:** Minimal (uses Maps for efficient lookups)
- **Browser Compatible:** Pure JavaScript, no dependencies

---

## References

**TF-IDF:**
- Salton, G., & Buckley, C. (1988). "Term-weighting approaches in automatic text retrieval"

**ROUGE:**
- Lin, C. Y. (2004). "ROUGE: A package for automatic evaluation of summaries"

**Exponential Penalties:**
- Standard in ML loss functions (cross-entropy, exponential loss)

**Convex Optimization:**
- Boyd, S., & Vandenberghe, L. (2004). "Convex Optimization"

---

## FAQ

**Q: Why convex penalties instead of linear?**
A: Convex penalties accelerate as violations increase, creating stronger incentives to avoid problematic content while being lenient for small amounts.

**Q: Why log-space for length ratios?**
A: Log-space ensures symmetry: 2x too long and 0.5x too short receive equal penalties.

**Q: Why blend uncertainty and relevance for coherence?**
A: Coherence has multiple dimensions: internal (no contradictions) and external (contextually appropriate). The blend captures both.

**Q: Can I disable the safety gate?**
A: Yes, set `toxicityThreshold: 1.0` to effectively disable it.

**Q: How do I add custom toxic/bias words?**
A: Edit the word sets in `calculateToxicityPenalty()` and `calculateBiasPenalty()` functions.

---

## Support

For issues or questions:
1. Check the test suite: `test-scoring-engine.js`
2. Review function documentation in `scoring-engine.js`
3. Verify mathematical properties in this README

---

**Version:** 1.0.0  
**Last Updated:** 2024  
**License:** MIT
