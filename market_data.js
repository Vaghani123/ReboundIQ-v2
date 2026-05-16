const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const config = require('../config');
const tech = require('./technical_analysis');
const predictor = require('./predictor');

async function get_ticker_data(symbol, period = '2y', interval = '1d') {
    try {
        const queryOptions = { period1: period, interval: interval };
        // period1 can be a date or a string like '2022-01-01', but yahoo-finance2 uses dates.
        // Let's compute period1 date based on period="2y"
        const now = new Date();
        const start = new Date();
        if (period === '2y') start.setFullYear(now.getFullYear() - 2);
        else if (period === '1y') start.setFullYear(now.getFullYear() - 1);
        else if (period === '6mo') start.setMonth(now.getMonth() - 6);
        else start.setFullYear(now.getFullYear() - 2);

        const result = await yahooFinance.historical(symbol, { period1: start, period2: now, interval });
        return result;
    } catch (e) {
        console.error(`Error fetching historical data for ${symbol}:`, e.message);
        return [];
    }
}

async function get_watchlist_data(aggregate_sentiment) {
    const promises = config.WATCHLIST.map(async (symbol) => {
        try {
            // Fetch both historical for tech and quoteSummary for fundamentals
            const [df, quoteSummary] = await Promise.all([
                get_ticker_data(symbol),
                yahooFinance.quoteSummary(symbol, { 
                    modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] 
                }).catch(() => null)
            ]);

            if (!df || df.length < 2) return null;

            const current_price = df[df.length - 1].close;
            const prev_close = df[df.length - 2].close;
            const change = current_price - prev_close;
            const change_pct = (change / prev_close) * 100;

            let alpha_score = 5.0; // Default
            let signal = "WAIT";

            if (quoteSummary) {
                const priceInfo = quoteSummary.price || {};
                const summaryDetail = quoteSummary.summaryDetail || {};
                const keyStats = quoteSummary.defaultKeyStatistics || {};
                const financialData = quoteSummary.financialData || {};

                const info = {
                    currentPrice: current_price,
                    previousClose: prev_close,
                    fiftyTwoWeekHigh: summaryDetail.fiftyTwoWeekHigh || current_price,
                    pegRatio: keyStats.pegRatio,
                    forwardPE: summaryDetail.forwardPE,
                    revenueGrowth: financialData.revenueGrowth || keyStats.revenueGrowth || 0,
                    profitMargins: financialData.profitMargins || keyStats.profitMargins || 0,
                    heldPercentInstitutions: keyStats.heldPercentInstitutions || 0,
                    shortName: priceInfo.shortName || config.TICKER_NAMES[symbol] || symbol
                };

                const framework = predictor.evaluate_buy_sell_framework(symbol, info);
                alpha_score = framework.alpha_score;
                signal = framework.signal;
            } else {
                // Technical fallback for indices/crypto
                const tech_signals = tech.get_all_signals(df);
                const pred = predictor.predict_market(tech_signals, aggregate_sentiment);
                alpha_score = pred.confidence * 10;
                signal = pred.prediction;
            }

            return {
                symbol: symbol,
                name: config.TICKER_NAMES[symbol] || symbol,
                price: Math.round(current_price * 100) / 100,
                change: Math.round(change * 100) / 100,
                change_pct: Math.round(change_pct * 100) / 100,
                alpha_score: alpha_score,
                signal: signal,
                volume: df[df.length - 1].volume || 0
            };
        } catch (e) {
            console.error(`Error processing watchlist for ${symbol}:`, e.message);
            return null;
        }
    });

    return (await Promise.all(promises)).filter(r => r !== null);
}

async function evaluate_alpha_discovery() {
    // Parallelize fetching to avoid sequential timeout issues
    const scanPromises = config.DISCOVERY_LIST.map(async (symbol) => {
        try {
            const quoteSummary = await yahooFinance.quoteSummary(symbol, { 
                modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] 
            });
            
            const priceInfo = quoteSummary.price || {};
            const summaryDetail = quoteSummary.summaryDetail || {};
            const keyStats = quoteSummary.defaultKeyStatistics || {};
            const financialData = quoteSummary.financialData || {};

            const info = {
                currentPrice: priceInfo.regularMarketPrice,
                previousClose: priceInfo.regularMarketPreviousClose,
                fiftyTwoWeekHigh: summaryDetail.fiftyTwoWeekHigh,
                pegRatio: keyStats.pegRatio,
                forwardPE: summaryDetail.forwardPE,
                revenueGrowth: financialData.revenueGrowth || keyStats.revenueGrowth || 0,
                profitMargins: financialData.profitMargins || keyStats.profitMargins || 0,
                heldPercentInstitutions: keyStats.heldPercentInstitutions || 0,
                debtToEquity: summaryDetail.debtToEquity || keyStats.debtToEquity,
                shortName: priceInfo.shortName
            };

            return predictor.evaluate_buy_sell_framework(symbol, info);
        } catch (e) {
            console.error(`Discovery failed for ${symbol}:`, e.message);
            return null;
        }
    });

    const results = (await Promise.all(scanPromises))
        .filter(r => {
            if (!r) return false;
            // Filter out absolute AVOID stocks, show everything else with decent alpha
            return r.signal !== "AVOID" && r.alpha_score >= 3.5;
        });

    // Sort by Alpha Score (highest first), then by Drawdown (closest to -20%)
    results.sort((a, b) => {
        if (b.alpha_score !== a.alpha_score) return b.alpha_score - a.alpha_score;
        return Math.abs(a.drawdown_pct + 20) - Math.abs(b.drawdown_pct + 20);
    });

    return results;
}

module.exports = {
    get_ticker_data,
    get_watchlist_data,
    evaluate_alpha_discovery
};
