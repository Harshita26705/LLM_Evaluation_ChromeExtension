# Quick Reference Card: Scoring Formulas

## TL;DR - What Changed

| Metric | Old → New | Key Benefit |
|--------|-----------|-------------|
| Similarity | Jaccard → TF-IDF Weighted Jaccard | Weights important terms higher |
| BLEU | Unigram overlap → ROUGE-1 F1 | Balances precision & recall |
| Length | Default 0.75 → Exponential smoothing | Smooth penalty curve |
| Toxicity | Linear → Convex exponential | Accelerating penalty |
| Bias | Linear → Convex exponential | Accelerating penalty |
| Coherence | Uncertainty only → Uncertainty + Relevance | Two-signal blend |
| Overall | Weighted sum → Weighted sum + Safety gate | Caps toxic scores |

---

## Cheat Sheet: All Formulas

### 1. Weighted Jaccard (TF-IDF)
```
J_weighted = Σ min(w_i^A, w_i^B) / Σ max(w_i^A, w_i^B)
where w_i = TF * IDF = (count_i) * log(N / df_i)
```
**Usage:** `calculateWeightedSimilarity(logs)`  
**Range:** [0, 1] — 0 = no overlap, 1 = identical

---

### 2. ROUGE-1 F1
```
Precision = |overlap| / |candidate|
Recall = |overlap| / |reference|
F1 = 2 * (P * R) / (P + R)
```
**Usage:** `calculateROUGE1(logs)`  
**Range:** [0, 1] — 0 = no overlap, 1 = perfect match

---

### 3. Length Appropriateness
```
Score = exp(-λ * |log(ratio / expected)|)
where ratio = response_len / query_len
```
**Usage:** `calculateLengthFit(logs, expected=2.0, λ=0.5)`  
**Range:** [0, 1] — 1 = perfect length, decays smoothly  
**Tip:** Increase λ for stricter penalty

---

### 4. Toxicity Penalty (Convex)
```
Penalty = 1 - exp(-γ * toxic_ratio)
where toxic_ratio = toxic_words / total_words
```
**Usage:** `calculateToxicityPenalty(logs, γ=5.0)`  
**Range:** [0, 1] — 0 = clean, 1 = highly toxic  
**Tip:** Increase γ for more aggressive penalty

---

### 5. Bias Penalty (Convex)
```
Penalty = 1 - exp(-γ * bias_ratio)
where bias_ratio = bias_terms / total_words
```
**Usage:** `calculateBiasPenalty(logs, γ=4.0)`  
**Range:** [0, 1] — 0 = neutral, 1 = highly biased

---

### 6. Coherence (Blend)
```
Coherence = α * (1 - uncertainty_density) + (1-α) * relevance
where uncertainty_density = markers / responses
```
**Usage:** `calculateCoherence(logs, α=0.6)`  
**Range:** [0, 1] — 1 = highly coherent  
**Tip:** α controls uncertainty vs relevance weight

---

### 7. Hallucination Risk
```
Risk = min(1, uncertainty_per_response * multiplier)
where uncertainty_per_response = phrase_count / responses
```
**Usage:** `calculateHallucinationRisk(logs, multiplier=0.3)`  
**Range:** [0, 1] — 0 = confident, 1 = likely hallucinating

---

### 8. Overall Score (Safety Gate)
```
Score_raw = Σ (w_i * metric_i)
Score_final = min(Score_raw, cap) if toxicity > threshold
```
**Default Weights:**
- Relevance: 0.25
- Length: 0.15
- Coherence: 0.20
- ROUGE-1: 0.10
- Toxicity: 0.15
- Bias: 0.10
- Hallucination: 0.05

**Usage:** `calculateOverallScore(logs, options)`  
**Range:** [0, 1] — 1 = perfect score  
**Safety Gate:** If toxicity > 0.3, cap at 0.5

---

## Quick Customization

### Make Toxicity More Aggressive
```javascript
calculateToxicityPenalty(logs, gamma=10.0)  // Default: 5.0
```

### Expect Longer Responses
```javascript
calculateLengthFit(logs, expectedRatio=3.0)  // Default: 2.0
```

### Change Coherence Weighting
```javascript
calculateCoherence(logs, alpha=0.8)  // Default: 0.6 (favor uncertainty)
calculateCoherence(logs, alpha=0.4)  // Favor relevance
```

### Custom Overall Weights
```javascript
calculateOverallScore(logs, {
  weights: {
    relevance: 0.30,    // Increase from 0.25
    lengthFit: 0.10,
    coherence: 0.20,
    rouge1: 0.10,
    toxicity: 0.15,
    bias: 0.10,
    hallucination: 0.05
  }
})
```

### Adjust Safety Gate
```javascript
calculateOverallScore(logs, {
  toxicityThreshold: 0.2,  // More aggressive (default: 0.3)
  toxicityCap: 0.3         // Lower cap (default: 0.5)
})
```

---

## Common Use Cases

### 1. Quick Overall Evaluation
```javascript
const results = calculateOverallScore(logs);
console.log('Overall Score:', results.overallScore);
console.log('Safety Gate:', results.safetyGateTriggered);
```

### 2. Individual Metric Analysis
```javascript
const relevance = calculateRelevance(logs);
const coherence = calculateCoherence(logs);
const toxicity = calculateToxicityPenalty(logs);
```

### 3. Debugging Low Scores
```javascript
const results = calculateOverallScore(logs);
console.log('Component Scores:', {
  relevance: results.relevance,
  lengthFit: results.lengthFit,
  coherence: results.coherence,
  rouge1: results.rouge1
});
console.log('Penalties:', {
  toxicity: results.toxicityPenalty,
  bias: results.biasPenalty,
  hallucination: results.hallucinationRisk
});
```

### 4. Comparing Conversations
```javascript
const conversation1 = calculateOverallScore(logs1);
const conversation2 = calculateOverallScore(logs2);

if (conversation1.overallScore > conversation2.overallScore) {
  console.log('Conversation 1 is better');
}
```

---

## Memory Joggers

### Higher is Better (Except...)
✅ All component scores: 0 = bad, 1 = good  
❌ Raw penalties: 0 = good, 1 = bad (but inverted in overall score)

### When Safety Gate Triggers
⚠️ `toxicityPenalty > 0.3` → `overallScore <= 0.5`  
Even if other metrics are high!

### Convexity Intuition
📈 Linear: `0.01 → 0.01, 0.10 → 0.10` (proportional)  
📈 Convex: `0.01 → 0.05, 0.10 → 0.39` (accelerating)

### Log-Space Length
📏 Symmetric: 2x too long = 0.5x too short (same penalty)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| All scores too low | Check if logs format is correct (role + content) |
| Toxicity penalty too high | Review toxic word list, adjust gamma |
| Length score always low | Adjust expectedRatio for your use case |
| Coherence seems wrong | Check if relevance is computed correctly |
| Safety gate always on | Lower toxicityThreshold or review word list |

---

## Mathematical Properties

✓ **Normalized** - All scores ∈ [0, 1]  
✓ **Convex** - Toxicity & bias penalties accelerate  
✓ **Smooth** - Length penalty is differentiable  
✓ **Balanced** - ROUGE-1 F1 balances P & R  
✓ **Robust** - TF-IDF handles term importance  
✓ **Safe** - High toxicity caps overall score

---

## Quick Links

📚 [Full Documentation](SCORING_ENGINE_DOCS.md)  
📖 [Migration Guide](MIGRATION_GUIDE.md)  
📊 [Formula Examples](FORMULA_EXAMPLES.md)  
🧪 [Test Suite](test-scoring-engine.js)

---

**Print this card** and keep it handy while developing! 🎯
