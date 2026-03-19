# Quick Start Guide: Robust Scoring Engine

## 🚀 Installation (5 minutes)

### Step 1: Verify Files
Ensure you have these files in your project:
```
✓ scoring-engine.js
✓ background.js
✓ manifest.json
✓ (all other existing files)
```

### Step 2: Load Extension
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked"
5. Select your project directory
6. ✅ Extension should appear in toolbar

### Step 3: Verify Installation
Open browser console (F12) and check:
```javascript
// In background service worker console
console.log(typeof calculateOverallScore);
// Should output: "function"
```

---

## ⚡ Quick Test (2 minutes)

### Test 1: Sample Conversation
```javascript
const testLogs = [
  { role: 'user', content: 'What is AI?' },
  { role: 'assistant', content: 'AI stands for Artificial Intelligence, a field of computer science.' }
];

const results = calculateOverallScore(testLogs);
console.log('Overall Score:', results.overallScore);
console.log('All Metrics:', results);
```

**Expected Output:**
```javascript
{
  relevance: ~0.75,
  lengthFit: ~0.80,
  coherence: ~0.85,
  rouge1: ~0.40,
  toxicity: ~0.99,
  bias: ~0.95,
  hallucination: ~0.95,
  overallScore: ~0.80,
  safetyGateTriggered: false
}
```

### Test 2: Toxic Content (Safety Gate)
```javascript
const toxicLogs = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'You are stupid, dumb, and an idiot!' }
];

const results = calculateOverallScore(toxicLogs);
console.log('Safety Gate:', results.safetyGateTriggered);
console.log('Score Capped:', results.overallScore <= 0.5);
```

**Expected Output:**
```javascript
safetyGateTriggered: true
overallScore: 0.5 (or lower)
```

---

## 📖 Basic Usage

### Single Function Call (Recommended)
```javascript
// Analyze a conversation
const logs = [
  { role: 'user', content: 'Your question here' },
  { role: 'assistant', content: 'Response here' },
  // ... more messages
];

const results = calculateOverallScore(logs);

console.log('Overall Score:', results.overallScore);
console.log('Relevance:', results.relevance);
console.log('Toxicity:', results.toxicity);
```

### Individual Metrics
```javascript
// Calculate specific metrics
const relevance = calculateRelevance(logs);
const coherence = calculateCoherence(logs);
const toxicity = calculateToxicityPenalty(logs);

console.log({ relevance, coherence, toxicity });
```

### Custom Parameters
```javascript
// Adjust sensitivity
const results = calculateOverallScore(logs, {
  toxicityThreshold: 0.2,  // More aggressive safety gate
  toxicityCap: 0.3,        // Lower score cap
  weights: {
    relevance: 0.30,       // Custom weights
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

## 🎯 Common Use Cases

### Use Case 1: Evaluate Chat History
```javascript
// Extract from extension
chrome.runtime.sendMessage(
  { action: 'analyzeLogs', logs: chatHistory },
  (response) => {
    console.log('Evaluation Results:', response);
    // Display in UI
    showResults(response);
  }
);
```

### Use Case 2: Real-Time Monitoring
```javascript
// Monitor as conversation progresses
let conversationHistory = [];

function onNewMessage(message) {
  conversationHistory.push(message);
  
  // Re-evaluate
  const results = calculateOverallScore(conversationHistory);
  
  // Update live dashboard
  updateDashboard(results);
}
```

### Use Case 3: Batch Processing
```javascript
// Evaluate multiple conversations
const conversations = [
  { id: 1, logs: [...] },
  { id: 2, logs: [...] },
  { id: 3, logs: [...] }
];

const evaluations = conversations.map(conv => ({
  id: conv.id,
  results: calculateOverallScore(conv.logs)
}));

// Find best/worst
const best = evaluations.reduce((prev, curr) => 
  curr.results.overallScore > prev.results.overallScore ? curr : prev
);
```

---

## 🔧 Configuration

### Adjust Toxicity Sensitivity
```javascript
// More lenient (fewer penalties)
calculateToxicityPenalty(logs, gamma=2.0);

// More aggressive (stricter penalties)
calculateToxicityPenalty(logs, gamma=10.0);

// Default
calculateToxicityPenalty(logs, gamma=5.0);
```

### Change Expected Response Length
```javascript
// Expect longer responses (3x query length)
calculateLengthFit(logs, expectedRatio=3.0);

// Expect shorter responses (1.5x query length)
calculateLengthFit(logs, expectedRatio=1.5);

// Default (2x query length)
calculateLengthFit(logs, expectedRatio=2.0);
```

### Modify Coherence Weighting
```javascript
// Favor uncertainty signal
calculateCoherence(logs, alpha=0.8);

// Favor relevance signal
calculateCoherence(logs, alpha=0.4);

// Balanced (default)
calculateCoherence(logs, alpha=0.6);
```

---

## 🐛 Troubleshooting

### Problem: "calculateOverallScore is not defined"

**Solution:**
```javascript
// Ensure scoring-engine.js is loaded
// In background.js, first line should be:
importScripts('scoring-engine.js');
```

### Problem: Scores seem too low

**Solution:**
```javascript
// Debug individual components
const results = calculateOverallScore(logs);
console.log('Component breakdown:', {
  relevance: results.relevance,
  lengthFit: results.lengthFit,
  coherence: results.coherence,
  rouge1: results.rouge1
});

// Check if safety gate is triggered
console.log('Safety gate:', results.safetyGateTriggered);

// Adjust parameters if needed
```

### Problem: Safety gate always triggering

**Solution:**
```javascript
// Check toxicity penalty
const toxicity = calculateToxicityPenalty(logs);
console.log('Toxicity penalty:', toxicity);

// Adjust threshold or word list
calculateOverallScore(logs, {
  toxicityThreshold: 0.5  // More lenient (default: 0.3)
});
```

### Problem: Unexpected results

**Solution:**
```javascript
// Run test suite to verify installation
// Load test-scoring-engine.js in console
// All tests should pass
```

---

## 📊 Understanding Results

### Score Interpretation

| Score Range | Interpretation | Action |
|-------------|----------------|--------|
| 0.9 - 1.0 | Excellent | ✅ High quality |
| 0.7 - 0.9 | Good | ✅ Acceptable |
| 0.5 - 0.7 | Fair | ⚠️ Needs improvement |
| 0.3 - 0.5 | Poor | ⚠️ Review carefully |
| 0.0 - 0.3 | Very Poor | ❌ Unacceptable |

### Individual Metrics

**Relevance (0.25 weight)**
- High: Response addresses query terms
- Low: Response ignores query

**Length Fit (0.15 weight)**
- High: Response length is appropriate
- Low: Too short or too long

**Coherence (0.20 weight)**
- High: Clear, confident, relevant
- Low: Uncertain, confusing

**ROUGE-1 (0.10 weight)**
- High: Good word overlap
- Low: Divergent vocabulary

**Toxicity (0.15 weight)**
- High: Clean language (1 - penalty)
- Low: Contains toxic words

**Bias (0.10 weight)**
- High: Neutral language (1 - penalty)
- Low: Demographic bias present

**Hallucination (0.05 weight)**
- High: Confident claims (1 - risk)
- Low: Many uncertainty markers

### Safety Gate

🚨 **When Triggered:**
- Toxicity penalty > 0.3
- Overall score capped at 0.5
- Flag for manual review

---

## 🎓 Learning Resources

**Read Next:**
1. [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Cheat sheet
2. [SCORING_ENGINE_DOCS.md](SCORING_ENGINE_DOCS.md) - Full docs
3. [FORMULA_EXAMPLES.md](FORMULA_EXAMPLES.md) - Numerical examples

**Advanced Topics:**
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Upgrade from old system
- [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md) - System design
- [test-scoring-engine.js](test-scoring-engine.js) - Test suite

---

## ✅ Checklist

**Installation:**
- [ ] Files verified
- [ ] Extension loaded in Chrome
- [ ] No console errors
- [ ] Functions available

**Testing:**
- [ ] Sample conversation evaluated
- [ ] Safety gate tested
- [ ] Results make sense
- [ ] Test suite passes (optional)

**Integration:**
- [ ] Extension popup works
- [ ] Results display correctly
- [ ] Export functionality works
- [ ] No performance issues

**Customization:**
- [ ] Parameters tuned (if needed)
- [ ] Weights adjusted (if needed)
- [ ] Word lists reviewed (if needed)

---

## 🎉 Success!

You're now ready to use the robust scoring engine!

**Next Steps:**
1. Test with your real chatbot conversations
2. Adjust parameters based on results
3. Integrate into your workflow
4. Monitor and iterate

**Need Help?**
- Console logs for debugging
- Test suite for validation
- Documentation for reference
- Examples for guidance

---

## 📝 Quick Commands

```javascript
// Full evaluation
calculateOverallScore(logs)

// Individual metrics
calculateRelevance(logs)
calculateCoherence(logs)
calculateToxicityPenalty(logs)

// Custom parameters
calculateOverallScore(logs, { toxicityThreshold: 0.2 })
calculateLengthFit(logs, expectedRatio=3.0)
calculateCoherence(logs, alpha=0.7)

// Debugging
console.log(calculateOverallScore(logs))
console.time('scoring'); calculateOverallScore(logs); console.timeEnd('scoring')
```

---

**Start evaluating in 5 minutes!** 🚀
