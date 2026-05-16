const Parser = require('rss-parser');
const parser = new Parser();
const vader = require('vader-sentiment');
const config = require('../config');

const FINANCIAL_LEXICON = {
    "rally": 2.5, "surge": 2.5, "soar": 2.8, "bullish": 3.0,
    "upgrade": 2.0, "beat": 1.8, "outperform": 2.0, "boom": 2.5,
    "breakout": 2.0, "recovery": 1.8, "gains": 1.5, "profit": 1.5,
    "growth": 1.5, "record high": 3.0, "strong earnings": 2.5,
    "crash": -3.5, "plunge": -3.0, "tumble": -2.5, "bearish": -3.0,
    "downgrade": -2.0, "miss": -1.8, "underperform": -2.0,
    "selloff": -2.5, "sell-off": -2.5, "recession": -3.0,
    "decline": -1.5, "slump": -2.0, "fear": -2.0, "panic": -2.8,
    "correction": -1.8, "bankruptcy": -3.5, "default": -2.5,
    "inflation": -1.0, "rate hike": -1.5, "layoffs": -2.0,
    "tariff": -1.5, "bear market": -3.0, "crisis": -3.0,
    "bubble": -2.0, "warning": -1.5,
};

const MARKET_IMPACT_KEYWORDS = [
    "tariff", "tax", "trade", "economy", "market", "stock", "fed", 
    "interest rate", "inflation", "oil", "bitcoin", "crypto", "dollar", 
    "jobs", "china", "mexico", "canada", "deficit", "spending", "budget"
];

function analyze_sentiment(text) {
    // vader-sentiment supports custom lexicons by updating the instance/dictionary, 
    // but the node package doesn't easily expose updating the dictionary.
    // Instead we can just use the base vader and optionally add scores. 
    // For simplicity, we'll use base vader scores which generally handles these words well enough.
    // But to match python closely, let's just use the default vader.
    
    const scores = vader.SentimentIntensityAnalyzer.polarity_scores(text);
    
    // Quick heuristic to apply financial lexicon:
    let compound = scores.compound;
    for (const word in FINANCIAL_LEXICON) {
        if (text.toLowerCase().includes(word)) {
            compound += (FINANCIAL_LEXICON[word] * 0.05); // scale down the raw impact
        }
    }
    compound = Math.max(-1, Math.min(1, compound));
    
    let label = "NEUTRAL";
    if (compound >= 0.15) label = "BULLISH";
    else if (compound <= -0.15) label = "BEARISH";
    
    return {
        compound: Math.round(compound * 10000) / 10000,
        positive: Math.round(scores.pos * 10000) / 10000,
        negative: Math.round(scores.neg * 10000) / 10000,
        neutral: Math.round(scores.neu * 10000) / 10000,
        label: label
    };
}

function _clean_text(text) {
    if (!text) return "";
    return text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function identify_tickers(text) {
    const text_lower = text.toLowerCase();
    let tickers_found = new Set();
    
    const market_terms = ["market", "s&p 500", "magnificent 7", "mag 7", "wall street"];
    for (const term of market_terms) {
        if (text_lower.includes(term)) {
            tickers_found.add("Market/Mag7");
            break;
        }
    }
    
    for (const [ticker, name] of Object.entries(config.TICKER_NAMES)) {
        if (ticker.startsWith("^")) {
            if (text_lower.includes(name.toLowerCase())) {
                tickers_found.add(ticker);
            }
        } else {
            const regex = new RegExp(`\\b${ticker}\\b`, "i");
            if (regex.test(text) || text_lower.includes(name.toLowerCase())) {
                tickers_found.add(ticker);
            }
        }
    }
    
    return Array.from(tickers_found);
}

async function fetch_news(max_age_hours = 48) {
    let articles = [];
    const cutoff = new Date(Date.now() - max_age_hours * 3600 * 1000);
    
    for (const [source_name, feed_url] of Object.entries(config.NEWS_FEEDS)) {
        try {
            const feed = await parser.parseURL(feed_url);
            let count = 0;
            for (const entry of feed.items) {
                if (count >= config.MAX_ARTICLES_PER_SOURCE) break;
                
                let pub_date = new Date(entry.pubDate || entry.isoDate || Date.now());
                if (isNaN(pub_date)) pub_date = new Date();
                
                if (pub_date < cutoff) continue;
                
                const title = _clean_text(entry.title);
                const summary = _clean_text(entry.contentSnippet || entry.content || "");
                if (!title) continue;
                
                articles.push({
                    title,
                    summary: summary.substring(0, 500),
                    source: source_name,
                    link: entry.link || "",
                    published: pub_date
                });
                count++;
            }
        } catch (e) {
            console.error(`Error fetching ${source_name}:`, e.message);
        }
    }
    
    articles.sort((a, b) => b.published - a.published);
    return articles;
}

async function fetch_trump_truths(max_age_hours = 48) {
    let articles = [];
    const feed_url = "https://trumpstruth.org/feed";
    const cutoff = new Date(Date.now() - max_age_hours * 3600 * 1000);
    
    try {
        const feed = await parser.parseURL(feed_url);
        for (const entry of feed.items) {
            let pub_date = new Date(entry.pubDate || entry.isoDate || Date.now());
            if (isNaN(pub_date)) pub_date = new Date();
            
            if (pub_date < cutoff) continue;
            
            const title = _clean_text(entry.title);
            const content = _clean_text(entry.contentSnippet || entry.content || "");
            const full_text = (title + " " + content).toLowerCase();
            
            // Filter for market impact keywords
            const impacts_market = MARKET_IMPACT_KEYWORDS.some(kw => full_text.includes(kw));
            
            if (impacts_market) {
                articles.push({
                    title: `TRUMP (Truth): ${title.substring(0, 100)}`,
                    summary: content.substring(0, 500),
                    source: "Truth Social",
                    link: entry.link || "",
                    published: pub_date,
                    forced_ticker: "Market/Mag7" // Tag as market impact
                });
            }
        }
    } catch (e) {
        console.error("Error fetching Truth Social:", e.message);
    }
    
    return articles;
}

async function get_news_with_sentiment(max_age_hours = 48) {
    let rss_articles = await fetch_news(max_age_hours);
    let trump_articles = await fetch_trump_truths(max_age_hours);
    
    let all_articles = [...rss_articles, ...trump_articles];
    
    let unique_articles = [];
    let seen_titles = new Set();
    for (const a of all_articles) {
        if (!seen_titles.has(a.title)) {
            seen_titles.add(a.title);
            unique_articles.push(a);
        }
    }
    
    let filtered_articles = [];
    for (const article of unique_articles) {
        const combined = `${article.title}. ${article.summary}`;
        article.sentiment = analyze_sentiment(combined);
        
        let tickers = identify_tickers(combined);
        if (article.forced_ticker && !tickers.includes(article.forced_ticker)) {
            tickers.push(article.forced_ticker);
        }
        article.tickers = tickers;
        
        if (tickers.length > 0) {
            filtered_articles.push(article);
        }
    }
    
    return filtered_articles;
}


function get_aggregate_sentiment(articles) {
    if (!articles || articles.length === 0) {
        return {
            score: 0.0, label: "NO DATA", article_count: 0,
            bullish_count: 0, bearish_count: 0, neutral_count: 0
        };
    }
    
    const now = new Date();
    let weighted_sum = 0.0;
    let weight_total = 0.0;
    let bullish = 0, bearish = 0, neutral = 0;
    
    for (const article of articles) {
        const age_hours = (now - article.published) / 1000 / 3600;
        const recency_weight = Math.max(0.2, 1.0 - (age_hours / 72));
        const compound = article.sentiment.compound;
        
        weighted_sum += compound * recency_weight;
        weight_total += recency_weight;
        
        if (article.sentiment.label === "BULLISH") bullish++;
        else if (article.sentiment.label === "BEARISH") bearish++;
        else neutral++;
    }
    
    const avg_score = weight_total > 0 ? weighted_sum / weight_total : 0.0;
    
    let label = "NEUTRAL";
    if (avg_score >= 0.15) label = "BULLISH";
    else if (avg_score <= -0.15) label = "BEARISH";
    
    return {
        score: Math.round(avg_score * 10000) / 10000,
        label: label,
        article_count: articles.length,
        bullish_count: bullish,
        bearish_count: bearish,
        neutral_count: neutral
    };
}

module.exports = {
    get_news_with_sentiment,
    get_aggregate_sentiment
};
