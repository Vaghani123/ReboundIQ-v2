const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const market_data = require('./services/market_data');
const news_sentiment = require('./services/news_sentiment');
const tech = require('./services/technical_analysis');
const predictor = require('./services/predictor');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

let cached_data = {
    prices: [],
    articles: [],
    aggregate_sentiment: {
        score: 0.0, label: "NO DATA", article_count: 0,
        bullish_count: 0, bearish_count: 0, neutral_count: 0,
    },
    technical_signals: null,
    prediction: {
        prediction: "AWAITING DATA",
        score: 0.0,
        confidence: 0.0,
        signals_breakdown: {}
    },
    ticker_name: config.DEFAULT_TICKER,
    alpha_discovery: [],
    last_updated: null,
    status: "Initializing... please wait for the first data fetch."
};

async function fetch_data_loop() {
    try {
        cached_data.status = "Fetching new data...";
        
        let articles = [];
        let aggregate_sentiment = null;
        try {
            articles = await news_sentiment.get_news_with_sentiment(72);
            aggregate_sentiment = news_sentiment.get_aggregate_sentiment(articles);
        } catch (e) {
            console.error("Error fetching news:", e);
            aggregate_sentiment = {
                score: 0.0, label: "NO DATA", article_count: 0,
                bullish_count: 0, bearish_count: 0, neutral_count: 0,
            };
        }
        
        let prices = [];
        try {
            prices = await market_data.get_watchlist_data(aggregate_sentiment);
        } catch (e) {
            console.error("Error fetching watchlist:", e);
        }
        
        let alpha_discovery = [];
        try {
            alpha_discovery = await market_data.evaluate_alpha_discovery();
        } catch (e) {
            console.error("Error in alpha discovery engine:", e);
        }
        
        let technical_signals = null;
        try {
            const df = await market_data.get_ticker_data(config.DEFAULT_TICKER);
            const raw_technical_signals = tech.get_all_signals(df);
            if (raw_technical_signals) {
                technical_signals = {};
                for (const [k, v] of Object.entries(raw_technical_signals)) {
                    technical_signals[k] = Object.fromEntries(
                        Object.entries(v).filter(([sk, _]) => !sk.endsWith('_series'))
                    );
                }
            }
        } catch (e) {
            console.error("Error fetching technicals:", e);
        }
        
        const prediction = predictor.predict_market(technical_signals, aggregate_sentiment);
        
        // Calculate Fear & Greed Index (0-100)
        let fg_score = 50; // Neutral
        if (technical_signals && technical_signals.rsi) {
            // S&P 500 RSI (Technical Momentum) - Weight 60%
            const rsi = technical_signals.rsi.value || 50;
            fg_score = (rsi); // Directly mapping RSI to F&G is a common proxy
        }
        // Adjust by news sentiment - Weight 40%
        fg_score = (fg_score * 0.6) + (((aggregate_sentiment.score + 1) * 50) * 0.4);
        fg_score = Math.max(0, Math.min(100, fg_score));

        let fg_label = "NEUTRAL";
        if (fg_score > 75) fg_label = "EXTREME GREED";
        else if (fg_score > 60) fg_label = "GREED";
        else if (fg_score < 25) fg_label = "EXTREME FEAR";
        else if (fg_score < 40) fg_label = "FEAR";

        let intel_text = "Market sentiment is currently " + aggregate_sentiment.label + ". ";
        if (alpha_discovery.length > 0) {
            const top_pick = alpha_discovery[0];
            if (top_pick.alpha_score >= 7.5) {
                intel_text += `High-conviction Alpha discovery identified in ${top_pick.symbol} (${top_pick.name}) with a score of ${top_pick.alpha_score.toFixed(1)}/10. `;
            } else {
                intel_text += `Scanning deep-tech sectors. Top current framework fit: ${top_pick.symbol}. `;
            }
        }
        intel_text += "Monitoring 13F whale alignment for Photonics and Quantum Computing.";

        cached_data.market_overview = {
            fear_greed_score: fg_score,
            fear_greed_label: fg_label,
            market_state: prediction.prediction,
            news_mood: aggregate_sentiment.label,
            details: {
                rsi: technical_signals ? (technical_signals.rsi ? technical_signals.rsi.value : 50) : 50,
                sentiment_score: aggregate_sentiment.score,
                volatility: (technical_signals && technical_signals.bollinger) ? (technical_signals.bollinger.bandwidth || 0.02) : 0.02,
                intel_summary: intel_text
            }
        };
        
        cached_data.prices = prices;
        cached_data.articles = articles;
        cached_data.aggregate_sentiment = aggregate_sentiment;
        cached_data.technical_signals = technical_signals;
        cached_data.prediction = prediction;
        cached_data.ticker_name = config.DEFAULT_TICKER;
        cached_data.alpha_discovery = alpha_discovery;
        cached_data.last_updated = Date.now();
        const nowStr = new Date(cached_data.last_updated).toLocaleString();
        cached_data.status = `Last updated: ${nowStr} (Refreshing every 5 minutes) | Data: yahoo-finance2 + RSS`;
        
        console.log("Background fetch complete.");
    } catch (e) {
        console.error("Error in background fetch loop:", e);
        cached_data.status = `Error: ${e.message}`;
    }
}

// Start loop
fetch_data_loop();
setInterval(fetch_data_loop, 300000); // 5 minutes

app.get('/api/data', (req, res) => {
    res.json(cached_data);
});

app.post('/api/refresh', async (req, res) => {
    fetch_data_loop(); // Trigger in background
    res.json({ success: true, message: "Refresh triggered." });
});

app.all('/api/watchlist', async (req, res) => {
    const data = req.body;
    let ticker = data.ticker ? data.ticker.trim().toUpperCase() : '';
    if (!ticker) {
        return res.status(400).json({ error: "No ticker provided" });
    }
    
    if (req.method === 'DELETE') {
        const idx = config.WATCHLIST.indexOf(ticker);
        if (idx !== -1) {
            config.WATCHLIST.splice(idx, 1);
            delete config.TICKER_NAMES[ticker];
            
            // Rewrite config.js content to remove ticker
            const configPath = path.join(__dirname, 'config.js');
            try {
                let content = fs.readFileSync(configPath, 'utf8');
                content = content.replace(new RegExp(`"\\^?${ticker.replace('^', '\\^')}",?\\s*`, 'g'), '');
                content = content.replace(new RegExp(`"\\^?${ticker.replace('^', '\\^')}": ".*?",?\\s*`, 'g'), '');
                fs.writeFileSync(configPath, content);
                return res.json({ success: true, message: `Removed ${ticker}` });
            } catch (e) {
                console.error(e);
            }
        }
        return res.status(404).json({ error: "Ticker not in watchlist" });
    } else if (req.method === 'POST') {
        const YahooFinance = require('yahoo-finance2').default;
        const yahooFinance = new YahooFinance();
        let name = ticker;
        try {
            const quote = await yahooFinance.quote(ticker);
            if (quote && quote.shortName) name = quote.shortName;
        } catch (e) {
            // fallback
        }
        
        if (!config.WATCHLIST.includes(ticker)) {
            config.WATCHLIST.push(ticker);
            config.TICKER_NAMES[ticker] = name;
            
            const configPath = path.join(__dirname, 'config.js');
            try {
                // simple append logic - since config.js is a module we'll just write it manually
                // to avoid complex AST parsing, let's keep it simple. The user can add manually if this fails.
                // Or we can just let it persist in memory for now. Let's just persist in memory.
            } catch (e) {
                console.error(e);
            }
        }
        
        return res.json({ success: true, ticker: ticker, name: name });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
