const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:'
    ? 'http://localhost:5000/api'
    : '/api';

// DOM Elements
const refreshBtn = document.getElementById('refresh-btn');
const tabs = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');

// State
let currentSymbol = null;

// Add scroll animations
let scrollObserver;

function initScrollAnimations() {
    scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Remove transition delay after initial animation so it doesn't delay on hover/resize
                setTimeout(() => {
                    entry.target.style.transitionDelay = '0s';
                }, 600);
            }
        });
    }, {
        threshold: 0.05,
        rootMargin: "0px 0px -20px 0px"
    });

    observeElements();
}

function observeElements() {
    if (!scrollObserver) return;
    
    // Select elements that aren't already observed
    const elements = document.querySelectorAll('.glass-card:not(.animate-on-scroll), .data-table tr:not(.animate-on-scroll), .news-card:not(.animate-on-scroll)');
    
    elements.forEach((el, index) => {
        el.classList.add('animate-on-scroll');
        // Add a slight stagger based on index for grouped elements
        el.style.transitionDelay = `${(index % 15) * 0.05}s`;
        scrollObserver.observe(el);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Refresh button
    refreshBtn.addEventListener('click', () => {
        fetchData();
    });

    // Add ticker
    document.getElementById('add-ticker-btn').addEventListener('click', async () => {
        const input = document.getElementById('ticker-input');
        const ticker = input.value.trim().toUpperCase();
        if (!ticker) return;
        
        try {
            const res = await fetch(`${API_BASE}/watchlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker })
            });
            const data = await res.json();
            if (data.success) {
                input.value = '';
                // Fetch data again after short delay
                setTimeout(fetchData, 2000);
            }
        } catch (e) {
            console.error('Error adding ticker:', e);
        }
    });

    // Make removeTicker globally available
    window.removeTicker = async function(ticker) {
        if (!confirm(`Remove ${ticker} from watchlist?`)) return;
        
        statusText.textContent = `Removing ${ticker}...`;
        try {
            const res = await fetch(`${API_BASE}/watchlist`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker })
            });
            const data = await res.json();
            if (data.success) {
                setTimeout(fetchData, 1000); // Quick refresh
            }
        } catch (e) {
            console.error('Error removing ticker:', e);
        }
    };



    // Initial fetch
    fetchData();
    
    // Auto refresh every 5 mins
    setInterval(fetchData, 300000);
});

async function fetchData() {
    try {
        const res = await fetch(`${API_BASE}/data`);
        const data = await res.json();
        
        renderMarketOverview(data.market_overview);
        renderDashboard(data.prediction);
        renderWatchlist(data.prices);
        renderTechnicals(data.technical_signals, data.ticker_name);
        renderNews(data.articles, data.aggregate_sentiment);
        const predictions = data.alpha_discovery || data.buy_sell_predictions || [];
        renderPredictor(predictions);
        updateMarketStatus();
        
        // Re-apply animations to newly rendered elements
        observeElements();
        
    } catch (e) {
        console.error('Failed to fetch data:', e);
    }
}

// Render Functions

function updateMarketStatus() {
    const statusText = document.getElementById('market-status');
    const container = document.getElementById('market-hours');
    
    // Check NYSE Hours (9:30 AM - 4:00 PM ET, Mon-Fri)
    const now = new Date();
    const etTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
        weekday: 'short'
    }).formatToParts(now);
    
    const parts = {};
    etTime.forEach(({type, value}) => parts[type] = value);
    
    const hour = parseInt(parts.hour);
    const minute = parseInt(parts.minute);
    const day = parts.weekday;
    
    const isWeekend = day === 'Sat' || day === 'Sun';
    const totalMinutes = hour * 60 + minute;
    const isOpen = !isWeekend && totalMinutes >= (9 * 60 + 30) && totalMinutes < (16 * 60);
    
    if (isOpen) {
        statusText.textContent = 'MARKET OPEN (NYSE)';
        container.classList.remove('market-status-closed');
    } else {
        statusText.textContent = 'MARKET CLOSED';
        container.classList.add('market-status-closed');
    }
}

function renderMarketOverview(ov) {
    if (!ov) return;
    
    // Intel Summary
    const intelText = document.getElementById('intel-summary');
    const intelDate = document.getElementById('intel-date');
    intelDate.textContent = `LAST ANALYZED: ${new Date().toLocaleTimeString()}`;
    
    let summary = "";
    if (ov.details && ov.details.intel_summary) {
        summary = ov.details.intel_summary;
    } else if (ov.fear_greed_score > 60) {
        summary = `Market is in a ${ov.fear_greed_label} phase. Momentum is high with ${ov.news_mood} sentiment driving prices. Exercise caution with new entries as technicals approach overbought levels.`;
    } else if (ov.fear_greed_score < 40) {
        summary = `Market is experiencing ${ov.fear_greed_label}. Sentiment is ${ov.news_mood}. This may present high-probability dip-buying opportunities for fundamentally strong tickers.`;
    } else {
        summary = `Market is currently ${ov.fear_greed_label}. Momentum and sentiment are balanced. Watch for break-outs or dips in individual watchlist tickers for actionable signals.`;
    }

    // Dynamic cycling logic
    const parts = summary.split('. ').filter(s => s.trim().length > 0);
    if (parts.length > 0) {
        if (window.intelInterval) clearInterval(window.intelInterval);
        let partIdx = 0;
        
        const updateIntel = () => {
            intelText.classList.remove('animate-intel');
            void intelText.offsetWidth; // Trigger reflow
            intelText.textContent = parts[partIdx] + (parts[partIdx].endsWith('.') ? '' : '.');
            intelText.classList.add('animate-intel');
            partIdx = (partIdx + 1) % parts.length;
        };
        
        updateIntel();
        window.intelInterval = setInterval(updateIntel, 10000);
    }

    const needle = document.getElementById('fg-needle');
    const label = document.getElementById('fg-label');
    const score = document.getElementById('fg-score');
    
    // Map 0-100 to -90 to 90 degrees
    const deg = (ov.fear_greed_score / 100) * 180 - 90;
    needle.style.transform = `translateX(-50%) rotate(${deg}deg)`;
    
    score.textContent = ov.fear_greed_score.toFixed(1);
    label.textContent = ov.fear_greed_label;
    
    // Breakdown
    const breakdown = document.getElementById('fg-breakdown');
    if (ov.details) {
        breakdown.innerHTML = `<span>RSI: ${ov.details.rsi.toFixed(1)}</span> | <span>SENT: ${ov.details.sentiment_score.toFixed(2)}</span>`;
    }
    
    let color = 'var(--text-dim)';
    if (ov.fear_greed_score > 60) color = 'var(--accent-green)';
    else if (ov.fear_greed_score < 40) color = 'var(--accent-red)';
    else if (ov.fear_greed_score > 40 && ov.fear_greed_score < 60) color = 'var(--accent-yellow)';
    
    score.style.color = color;
    label.style.color = color;
}

function renderDashboard(pred) {
    if (!pred || !pred.prediction) return;
    
    const label = document.getElementById('pred-label');
    const score = document.getElementById('pred-score');
    const conf = document.getElementById('pred-conf');
    
    label.textContent = pred.prediction;
    score.textContent = (pred.score > 0 ? '+' : '') + pred.score.toFixed(4);
    conf.textContent = pred.confidence.toFixed(1) + '%';
    
    let colorClass = 'text-yellow';
    if (pred.prediction.includes('BULL')) colorClass = 'text-green';
    else if (pred.prediction.includes('BEAR')) colorClass = 'text-red';
    
    label.className = `pred-text ${colorClass}`;
    score.className = `stat-value ${colorClass}`;
    
    // Signals Breakdown
    const sigList = document.getElementById('signals-list');
    sigList.innerHTML = '';
    
    if (pred.signals_breakdown) {
        for (const [name, data] of Object.entries(pred.signals_breakdown)) {
            const row = document.createElement('div');
            row.className = 'signal-row';
            
            const normalized = Math.max(0, Math.min(1, (data.score + 1) / 2));
            const barWidth = normalized * 100;
            const barColor = data.score >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
            const wColor = data.weighted >= 0 ? 'text-green' : 'text-red';
            
            row.innerHTML = `
                <div class="signal-name">${name}</div>
                <div class="signal-bar-bg">
                    <div class="signal-bar-fill" style="width: ${barWidth}%; background-color: ${barColor}"></div>
                </div>
                <div class="signal-score ${wColor}">${data.weighted > 0 ? '+' : ''}${data.weighted.toFixed(4)}</div>
            `;
            sigList.appendChild(row);
        }
    }
    
    // Dip Alert
    const dipAlert = document.getElementById('dip-alert');
    if (pred.dip_detected) {
        dipAlert.classList.remove('hidden');
        const details = pred.dip_details;
        const color = details.strength === 'STRONG' ? 'text-red' : 'text-yellow';
        
        let html = `<h3 class="${color}" style="margin-bottom: 12px;">⚠ DIP DETECTED — ${details.strength} SIGNAL (${details.dip_probability}% Probability)</h3><ul>`;
        details.conditions.forEach(c => html += `<li style="margin-left: 20px; margin-bottom: 6px;">${c}</li>`);
        html += `</ul><p class="text-orange" style="margin-top: 12px; font-weight: 600;">→ ${details.recommendation}</p>`;
        dipAlert.innerHTML = html;
    } else {
        dipAlert.classList.add('hidden');
    }
}

function renderWatchlist(prices) {
    const tbody = document.getElementById('watchlist-body');
    tbody.innerHTML = '';
    
    if (!prices || prices.length === 0) return;
    
    prices.forEach(p => {
        const tr = document.createElement('tr');
        const changePct = p.change_pct || 0;
        const colorClass = changePct > 0 ? 'text-green' : (changePct < 0 ? 'text-red' : '');
        const arrow = changePct >= 0 ? '▲' : '▼';
        
        const alphaScore = p.alpha_score || 0;
        let alphaColor = 'dim-text';
        if (alphaScore >= 7.5) alphaColor = 'badge badge-green';
        else if (alphaScore >= 5.0) alphaColor = 'badge badge-yellow';
        
        tr.innerHTML = `
            <td class="ticker-symbol">
                <div style="font-weight: 600;">${p.symbol}</div>
                <div class="dim-text" style="font-size: 10px;">${p.name}</div>
            </td>
            <td class="text-right text-mono">$${p.price.toFixed(2)}</td>
            <td class="text-right ${colorClass}">${p.change > 0 ? '+' : ''}${p.change.toFixed(2)}</td>
            <td class="text-right ${colorClass}">${arrow} ${Math.abs(changePct).toFixed(2)}%</td>
            <td class="text-right"><span class="${alphaColor}">${alphaScore.toFixed(1)}</span></td>
            <td class="text-right dim-text" style="font-size: 11px;">${formatVolume(p.volume)}</td>
            <td class="text-center">
                <div class="mini-chart-container">
                    <div class="mini-bar-bg">
                        <div class="mini-bar-fill" style="width: 45%; background: var(--accent-primary)"></div>
                    </div>
                </div>
            </td>
            <td>
                <button class="btn-icon delete-btn" onclick="removeTicker('${p.symbol}')">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTechnicals(signals, tickerName) {
    document.getElementById('tech-ticker-name').textContent = `— ${tickerName}`;
    const grid = document.getElementById('tech-content');
    grid.innerHTML = '';
    
    if (!signals) {
        grid.innerHTML = '<div class="dim-text">No technical data available.</div>';
        return;
    }
    
    function makeCard(title, value, signal, score, scoreColor) {
        return `
            <div class="tech-item">
                <div class="tech-header">
                    <span class="tech-title">${title}</span>
                    <span class="badge badge-${scoreColor}">${signal}</span>
                </div>
                <div class="tech-val">${value}</div>
                <div class="dim-text" style="font-size: 12px">Score: ${score.toFixed(2)}</div>
            </div>
        `;
    }
    
    const rsi = signals.rsi;
    let rsiC = rsi.signal === 'OVERSOLD' ? 'green' : (rsi.signal === 'OVERBOUGHT' ? 'red' : 'yellow');
    grid.innerHTML += makeCard('RSI (14)', rsi.value ? rsi.value.toFixed(2) : 'N/A', rsi.signal, rsi.score, rsiC);
    
    const macd = signals.macd;
    let macdC = macd.crossover === 'BULLISH' ? 'green' : 'red';
    grid.innerHTML += makeCard('MACD', macd.histogram ? (macd.histogram > 0 ? '+' : '') + macd.histogram.toFixed(4) : 'N/A', macd.crossover, macd.score, macdC);
    
    const bb = signals.bollinger;
    let bbC = bb.signal === 'OVERSOLD' ? 'green' : (bb.signal === 'OVERBOUGHT' ? 'red' : 'yellow');
    grid.innerHTML += makeCard('Bollinger Bands', bb.position ? (bb.position * 100).toFixed(2) + '%' : 'N/A', bb.signal, bb.score, bbC);
    
    const ma = signals.moving_avg;
    let maC = ma.cross_type.includes('GOLDEN') ? 'green' : (ma.cross_type.includes('DEATH') ? 'red' : 'yellow');
    grid.innerHTML += makeCard('SMA 50/200', `${ma.sma_short ? ma.sma_short.toFixed(0) : 'N/A'} / ${ma.sma_long ? ma.sma_long.toFixed(0) : 'N/A'}`, ma.cross_type, ma.score, maC);

    const atr = signals.atr;
    grid.innerHTML += makeCard('ATR (14)', (atr && atr.value !== undefined) ? atr.value.toFixed(4) : 'N/A', atr ? atr.signal : 'N/A', atr ? atr.score : 0, 'yellow');
    
    const adx = signals.adx;
    let adxC = adx && adx.adx > 25 ? 'green' : 'yellow';
    grid.innerHTML += makeCard('ADX (14)', (adx && adx.adx !== undefined) ? adx.adx.toFixed(2) : 'N/A', adx ? adx.signal : 'N/A', adx ? adx.score : 0, adxC);
    
    const stoch = signals.stochastic;
    let stochC = stoch && stoch.signal === 'OVERSOLD' ? 'green' : (stoch && stoch.signal === 'OVERBOUGHT' ? 'red' : 'yellow');
    grid.innerHTML += makeCard('Stoch (%K)', (stoch && stoch.k !== undefined) ? stoch.k.toFixed(2) : 'N/A', stoch ? stoch.signal : 'N/A', stoch ? stoch.score : 0, stochC);
}

function renderNews(articles, agg) {
    if (!agg) return;
    
    const badge = document.getElementById('agg-sentiment-badge');
    badge.textContent = `${agg.label} (${(agg.score > 0 ? '+' : '') + agg.score.toFixed(4)})`;
    badge.className = `badge badge-${agg.label === 'BULLISH' ? 'green' : (agg.label === 'BEARISH' ? 'red' : 'yellow')}`;
    
    document.getElementById('news-stats').innerHTML = `
        <span class="text-green">Bullish: ${agg.bullish_count}</span>
        <span class="text-red">Bearish: ${agg.bearish_count}</span>
        <span class="text-yellow">Neutral: ${agg.neutral_count}</span>
    `;
    
    const list = document.getElementById('news-list');
    list.innerHTML = '';
    
    if (!articles) return;
    
    articles.forEach(art => {
        const el = document.createElement('div');
        el.className = 'news-article';
        
        const sent = art.sentiment;
        const sColor = sent.label === 'BULLISH' ? 'green' : (sent.label === 'BEARISH' ? 'red' : 'yellow');
        
        const tickersStr = art.tickers && art.tickers.length > 0 ? `<span class="text-cyan">[${art.tickers.join(',')}]</span> ` : '';
        
        el.innerHTML = `
            <div class="article-title">${tickersStr}<a href="${art.link}" target="_blank" class="news-link">${art.title}</a></div>
            <div class="article-meta">
                <span>Source: ${art.source}</span>
                <span>Date: ${new Date(art.published).toLocaleString()}</span>
                <span class="badge badge-${sColor}">${sent.label} (${sent.compound > 0 ? '+' : ''}${sent.compound.toFixed(3)})</span>
            </div>
            <div class="article-summary">${art.summary}</div>
        `;
        list.appendChild(el);
    });
}

function renderPredictor(predictions) {
    const tbody = document.getElementById('predictor-body');
    tbody.innerHTML = '';
    
    if (!predictions || predictions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center dim-text" style="padding: 40px;">Scanning US & LSE markets for Alpha opportunities... <br><small>This may take up to 30 seconds for the first scan.</small></td></tr>';
        return;
    }
    
    predictions.forEach(p => {
        const tr = document.createElement('tr');
        
        let sigColor = 'yellow';
        if (p.signal === 'BUY') sigColor = 'green';
        else if (p.signal === 'AVOID' || p.signal === 'SELL') sigColor = 'red';
        else if (p.signal === 'WAIT' || p.signal === 'HOLD') sigColor = 'orange';
        
        const score = p.alpha_score || 0;
        const alphaColor = score >= 7.5 ? 'text-green' : (score >= 5 ? 'text-yellow' : 'dim-text');
        
        const growth = p.rev_growth || 0;
        const growthColor = growth >= 25 ? 'text-green' : (growth >= 10 ? 'text-yellow' : 'dim-text');
        
        const dd = p.drawdown_pct || 0;
        const ddColor = (dd <= -15 && dd >= -35) ? 'text-green' : 'dim-text';
        
        tr.innerHTML = `
            <td>
                <div class="ticker-box">
                    <span class="ticker-name">${p.symbol}</span>
                    <span class="dim-text" style="font-size: 10px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;">${p.name || ''}</span>
                </div>
            </td>
            <td class="text-center"><span class="badge badge-${sigColor}">${p.signal}</span></td>
            <td class="text-right ${alphaColor}" style="font-weight: bold; font-family: 'JetBrains Mono', monospace;">${score.toFixed(1)}</td>
            <td class="text-right">${p.price ? '$' + p.price.toFixed(2) : 'N/A'}</td>
            <td>
                <div style="font-size: 11px; color: var(--text-primary);">${p.valuation_status || 'Evaluating...'}</div>
                <div class="dim-text" style="font-size: 10px; line-height: 1.2;">${(p.reasons && p.reasons.length > 0) ? p.reasons[0] : ''}</div>
            </td>
            <td class="text-right">${p.inst_own_pct || 0}%</td>
            <td class="text-right ${growthColor}">${growth}%</td>
            <td class="text-right ${ddColor}">${dd}%</td>
        `;
        tbody.appendChild(tr);
    });
}

function formatVolume(vol) {
    if (!vol) return '-';
    if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
    if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
    return vol.toString();
}
