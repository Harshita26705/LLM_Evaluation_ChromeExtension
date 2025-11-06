// Initialize charts and load data
let metricsChart;
let trendChart;

document.addEventListener('DOMContentLoaded', async () => {
    await loadAndDisplayData();
});

async function loadAndDisplayData() {
    const history = await chrome.runtime.sendMessage({ action: 'getEvaluationHistory' });
    updateMetricsSummary(history);
    updateCharts(history);
    updateHistoryTable(history);
}

function updateMetricsSummary(history) {
    if (history.length === 0) return;

    const averages = {
        similarity: average(history.map(h => h.similarity)),
        bleu: average(history.map(h => h.bleuScore)),
        toxicity: average(history.map(h => h.toxicityScore)),
        hallucination: average(history.map(h => h.hallucinationScore))
    };

    document.getElementById('avg-similarity').textContent = formatPercentage(averages.similarity);
    document.getElementById('avg-bleu').textContent = formatPercentage(averages.bleu);
    document.getElementById('avg-toxicity').textContent = formatPercentage(averages.toxicity);
    document.getElementById('avg-hallucination').textContent = formatPercentage(averages.hallucination);
}

function updateCharts(history) {
    updateMetricsChart(history);
    updateTrendChart(history);
}

function updateMetricsChart(history) {
    const ctx = document.getElementById('metricsChart').getContext('2d');
    
    if (metricsChart) {
        metricsChart.destroy();
    }

    const latestEntry = history[history.length - 1];
    
    metricsChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Semantic Similarity', 'BLEU Score', 'Toxicity', 'Hallucination Risk', 'Bias'],
            datasets: [{
                label: 'Latest Evaluation',
                data: [
                    latestEntry.similarity,
                    latestEntry.bleuScore,
                    latestEntry.toxicityScore,
                    latestEntry.hallucinationScore,
                    latestEntry.biasScore
                ],
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                borderColor: 'rgba(54, 162, 235, 1)',
                pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(54, 162, 235, 1)'
            }]
        },
        options: {
            scales: {
                r: {
                    beginAtZero: true,
                    max: 1
                }
            }
        }
    });
}

function updateTrendChart(history) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (trendChart) {
        trendChart.destroy();
    }

    const dates = history.map(h => new Date(h.timestamp).toLocaleDateString());
    
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Semantic Similarity',
                    data: history.map(h => h.similarity),
                    borderColor: 'rgba(54, 162, 235, 1)',
                    fill: false
                },
                {
                    label: 'BLEU Score',
                    data: history.map(h => h.bleuScore),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    fill: false
                },
                {
                    label: 'Toxicity',
                    data: history.map(h => h.toxicityScore),
                    borderColor: 'rgba(255, 99, 132, 1)',
                    fill: false
                }
            ]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    max: 1
                }
            }
        }
    });
}

function updateHistoryTable(history) {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';

    history.reverse().forEach(entry => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(entry.timestamp).toLocaleString()}</td>
            <td>${entry.url}</td>
            <td>${formatPercentage(entry.similarity)}</td>
            <td>${formatPercentage(entry.bleuScore)}</td>
            <td>${formatPercentage(entry.toxicityScore)}</td>
            <td>${formatPercentage(entry.hallucinationScore)}</td>
            <td>${formatPercentage(entry.biasScore)}</td>
        `;
        tbody.appendChild(row);
    });
}

async function exportData() {
    const history = await chrome.runtime.sendMessage({ action: 'getEvaluationHistory' });
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm-evaluation-history-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function clearHistory() {
    if (confirm('Are you sure you want to clear all evaluation history?')) {
        await chrome.runtime.sendMessage({ action: 'clearEvaluationHistory' });
        await loadAndDisplayData();
    }
}

function average(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function formatPercentage(value) {
    return `${(value * 100).toFixed(1)}%`;
}