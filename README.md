# LLM Evaluation Tool - Chrome Extension

A Chrome extension that evaluates chatbot performance using robust, mathematically sound scoring formulas including TF-IDF weighted similarity, ROUGE-1 F1, exponential penalties, and safety gates.

## ✨ New: Robust Scoring Engine

This extension now features a **mathematically rigorous scoring engine** with:

- ✅ **Weighted Jaccard Similarity with TF-IDF** - Smarter semantic overlap detection
- ✅ **ROUGE-1 F1 Score** - Balanced precision and recall for response quality
- ✅ **Exponential Length Smoothing** - Smooth penalties for length deviations
- ✅ **Convex Toxicity/Bias Penalties** - Accelerating penalties for harmful content
- ✅ **Coherence Blending** - Combines uncertainty markers with relevance
- ✅ **Safety Gate** - Caps overall score when toxicity exceeds threshold
- ✅ **Normalized [0,1]** - All metrics normalized for consistency

📚 **[Full Documentation](SCORING_ENGINE_DOCS.md)** | 🚀 **[Quick Start](QUICK_START.md)** | 📖 **[Migration Guide](MIGRATION_GUIDE.md)** | 📊 **[Formula Examples](FORMULA_EXAMPLES.md)**  
📑 **[Documentation Index](DOCUMENTATION_INDEX.md)** - Complete guide to all documentation files

## Features

- 🔍 **Automatic Log Extraction**: Extracts chatbot logs from various sources:
  - localStorage and sessionStorage
  - DOM elements (chat messages)
  - Network logs (via background script)
  
- 📊 **Performance Evaluation**: Advanced metrics include:
  - **Relevance** - TF-IDF weighted keyword recall
  - **Length Appropriateness** - Exponentially smoothed ratio
  - **Coherence** - Uncertainty + relevance blend
  - **ROUGE-1 F1** - Balanced overlap score
  - **Toxicity** - Convex penalty for harmful content
  - **Bias** - Convex penalty for biased language
  - **Hallucination Risk** - Calibrated uncertainty score
  - **Overall Score** - Weighted combination with safety gate

- 📥 **Export Results**: Export evaluation results as JSON for further analysis

- 🎨 **Modern UI**: Beautiful, intuitive interface with step-by-step workflow

## Installation

### Option 1: Load Unpacked Extension (Development)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the project directory

### Option 2: Create Icons

Before loading the extension, you need to create icon files:
- `icons/icon16.png` (16x16 pixels)
- `icons/icon48.png` (48x48 pixels)
- `icons/icon128.png` (128x128 pixels)

You can use any image editor to create these icons, or use placeholder images.

## Usage

1. **Navigate to a webpage** that contains chatbot logs or conversations
2. **Click the extension icon** in your Chrome toolbar
3. **Click "Extract Chatbot Logs"** to scan the current page for chatbot logs
4. **Configure the API endpoint** (defaults to LLM Eval V3 by HarshitaSuri)
5. **Click "Evaluate Performance"** to send logs to the evaluation API
6. **View the results** in the extension popup
7. **Export results** as JSON if needed

## Configuration

### API Endpoint

The extension connects to the Hugging Face Space API. The default endpoint is:
```
https://harshitasuri-llm-eval-v3.hf.space
```

You can modify this in the extension popup if you're using a different instance.

### Supported Log Formats

The extension can extract logs from:
- **JSON stored in localStorage/sessionStorage** with keys containing "chat", "log", "message", or "conversation"
- **DOM elements** with classes/IDs containing chat-related keywords
- **Common chatbot frameworks** (with proper DOM structure)

## Project Structure

```
PROJECT/
├── manifest.json              # Extension manifest
├── popup.html                 # Extension popup UI
├── popup.css                  # Popup styles
├── popup.js                   # Popup logic
├── content.js                 # Content script for log extraction
├── background.js              # Background service worker for API calls
├── scoring-engine.js          # 🆕 Robust scoring functions (TF-IDF, ROUGE-1, etc.)
├── test-scoring-engine.js     # 🆕 Test suite for scoring functions
├── SCORING_ENGINE_DOCS.md     # 🆕 Complete documentation of formulas
├── MIGRATION_GUIDE.md         # 🆕 Guide for upgrading from old system
├── FORMULA_EXAMPLES.md        # 🆕 Numerical examples for each formula
├── icons/                     # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md                  # This file
```

## API Integration

The extension attempts to connect to Hugging Face Space APIs using common endpoint patterns:
- `/api/predict`
- `/api/chat`
- `/api/evaluate`
- `/api/v1/evaluate`

If the API is not available or returns an error, the extension will generate mock evaluation results for demonstration purposes. You'll need to adjust the `background.js` file to match the actual API structure of your Hugging Face Space.

### Customizing API Integration

To customize the API integration for your specific Hugging Face Space:

1. Open `background.js`
2. Modify the `callEvaluationAPI` function to match your API endpoint structure
3. Update `parseEvaluationResults` to parse your API's response format
4. Adjust the data format in `prepareEvaluationData` if needed

## Development

### Testing the Scoring Engine

Run the comprehensive test suite:
```bash
# In Node.js environment
node test-scoring-engine.js

# Or in browser console:
# 1. Load scoring-engine.js
# 2. Load test-scoring-engine.js
# All tests should pass with detailed output
```

### Testing Extension

1. Load the extension in developer mode
2. Open a webpage with chatbot logs
3. Use the extension popup to extract and evaluate logs
4. Check the browser console for any errors

### Debugging

- **Popup**: Right-click extension icon → Inspect popup
- **Content Script**: Use Chrome DevTools on the target webpage
- **Background Script**: Go to `chrome://extensions/` → Click "service worker" link
- **Scoring Engine**: Console.log results from `calculateOverallScore()`

## Permissions

The extension requires the following permissions:
- `activeTab`: To access the current tab's content
- `storage`: To save extracted logs and settings
- `scripting`: To inject content scripts
- `host_permissions`: To make API calls to Hugging Face Spaces

## Troubleshooting

### No logs found
- Ensure you're on a page that contains chatbot conversations
- Check if logs are stored in localStorage/sessionStorage
- Verify that chat messages are visible in the DOM

### API connection fails
- Verify the API endpoint URL is correct
- Check if the Hugging Face Space is running
- Review the API response format and update `background.js` if needed

### Extension not loading
- Ensure all required files are present
- Create the icon files (or use placeholders)
- Check `manifest.json` for syntax errors

## Future Enhancements

- [ ] Real-time log monitoring
- [ ] Support for more log formats
- [ ] Custom evaluation criteria
- [ ] Historical evaluation tracking
- [ ] Export to CSV/Excel
- [ ] Visualization charts for metrics

## License

MIT License - Feel free to modify and use for your projects.

## Credits

- LLM Eval V3 Dashboard: [HarshitaSuri on Hugging Face](https://huggingface.co/spaces/harshitasuri/llm-eval-v3)

## Support

For issues or questions, please check:
- The Hugging Face Space documentation
- Chrome Extension development docs
- The extension's console logs for error messages





