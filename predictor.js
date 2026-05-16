const config = require('../config');

function _classify(score) {
    const t = config.PREDICTION_THRESHOLDS;
    if (score >= t.STRONG_BULL) return "STRONG BULL 🐂🐂";
    else if (score >= t.BULL) return "BULL 🐂";
    else if (score >= t.NEUTRAL_LOW) return "NEUTRAL ➖";
    else if (score >= t.BEAR) return "BEAR 🐻";
    else return "STRONG BEAR 🐻🐻";
}

function _detect_dip(technical_signals, sentiment_data, overall_score) {
    const rsi_val = technical_signals.rsi.value;
    const rsi_oversold = rsi_val < config.DIP_RSI_THRESHOLD;
    const bollinger_low = technical_signals.bollinger.position < 0.2;
    const sentiment_score = sentiment_data.score || 0.0;

    let conditions_met = [];
    if (rsi_oversold) conditions_met.push(`RSI oversold (${rsi_val.toFixed(1)})`);
    if (bollinger_low) conditions_met.push(`Price near lower Bollinger Band`);
    if (sentiment_score < -0.1) conditions_met.push(`Negative sentiment (${(sentiment_score > 0 ? '+' : '')}${sentiment_score.toFixed(3)})`);
    if (overall_score < -0.2) conditions_met.push(`Bearish signals (${(overall_score > 0 ? '+' : '')}${overall_score.toFixed(3)})`);

    const is_dip = conditions_met.length >= 3;

    let rsi_score = 0.0;
    if (rsi_val < 40) {
        rsi_score = Math.min(100.0, Math.pow(40.0 - rsi_val, 1.35));
    }

    const bb_pos = technical_signals.bollinger.position;
    let bb_score = 0.0;
    if (bb_pos < 0.2) {
        bb_score = Math.min(100.0, (0.2 - bb_pos) * 200.0);
    }

    let macd_score = 0;
    if (technical_signals.macd.crossover === "BULLISH") macd_score += 20;
    if (technical_signals.macd.histogram > 0) macd_score += 10;

    const vol_ratio = technical_signals.volume.volume_ratio || 1.0;
    const vol_bonus = Math.min(25.0, Math.max(0.0, (vol_ratio - 1.0) * 15.0));

    const base_rebound = (rsi_score * 0.45) + (bb_score * 0.35) + macd_score + vol_bonus;

    let sentiment_mult = 1.0;
    if (sentiment_score < -0.4) sentiment_mult = 0.3;
    else if (sentiment_score < -0.15) sentiment_mult = 0.7;
    else if (sentiment_score > 0.15) sentiment_mult = 1.25;

    const dip_probability = Math.floor(Math.min(99.0, Math.max(0.0, base_rebound * sentiment_mult)));

    const strength = dip_probability >= 70 ? "STRONG" : (dip_probability >= 40 ? "MODERATE" : "WEAK");
    const recommendation = dip_probability >= 70 ? "Prime Rebound Candidate" : "Not a strong dip yet";

    return {
        is_dip,
        details: {
            strength,
            dip_probability,
            conditions: conditions_met,
            recommendation
        }
    };
}

function stdDev(arr) {
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b) / n;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}

function predict_market(technical_signals, sentiment_data) {
    if (!technical_signals) {
        return {
            prediction: "NO DATA", score: 0.0, confidence: 0.0,
            signals_breakdown: {}, dip_detected: false, dip_details: null
        };
    }

    let scores = {};
    scores["sentiment"] = sentiment_data.score || 0.0;
    scores["rsi"] = technical_signals.rsi.score;
    scores["macd"] = technical_signals.macd.score;
    scores["moving_avg"] = technical_signals.moving_avg.score;
    scores["bollinger"] = technical_signals.bollinger.score;
    scores["volume"] = technical_signals.volume.score;

    let weighted_score = 0;
    for (const key of Object.keys(config.SIGNAL_WEIGHTS)) {
        weighted_score += scores[key] * config.SIGNAL_WEIGHTS[key];
    }

    const score_values = Object.values(scores);
    let confidence = 75.0;
    if (score_values.length > 1) {
        const std_val = stdDev(score_values);
        const agreement = 1.0 - Math.min(1.0, std_val);
        const magnitude = Math.abs(weighted_score);
        const raw_confidence = (agreement * 0.7 + magnitude * 0.3);
        confidence = Math.round((75.0 + (raw_confidence * 24.9)) * 10) / 10;
    }

    const prediction = _classify(weighted_score);
    const { is_dip, details } = _detect_dip(technical_signals, sentiment_data, weighted_score);

    let signals_breakdown = {};
    for (const key of Object.keys(config.SIGNAL_WEIGHTS)) {
        signals_breakdown[key] = {
            score: Math.round(scores[key] * 10000) / 10000,
            weight: config.SIGNAL_WEIGHTS[key],
            weighted: Math.round((scores[key] * config.SIGNAL_WEIGHTS[key]) * 10000) / 10000
        };
    }

    return {
        prediction,
        score: Math.round(weighted_score * 10000) / 10000,
        confidence: Math.min(99.9, confidence),
        signals_breakdown,
        dip_detected: is_dip,
        dip_details: details
    };
}

function evaluate_buy_sell_framework(symbol, info, rsi_14 = 50) {
    let price = info.currentPrice || 0;
    if (price === 0) price = info.previousClose || 1;

    const high_52w = info.fiftyTwoWeekHigh || price;
    let drawdown_pct = 0;
    if (high_52w && high_52w > 0) {
        drawdown_pct = ((price - high_52w) / high_52w) * 100;
    }

    let alpha_score = 0;
    const max_score = 10;
    let reasons = [];

    // 1. Institutional Alignment (13F / Stakes) - 3 pts
    const inst_own = info.heldPercentInstitutions || 0;
    const inst_own_pct = inst_own * 100;
    if (inst_own_pct > 65) {
        alpha_score += 3;
        reasons.push("High institutional backing (65%+). Aligned with 13F whale positioning.");
    } else if (inst_own_pct > 40) {
        alpha_score += 1.5;
        reasons.push("Moderate institutional interest.");
    }

    // 2. Growth Momentum (Revenue/EPS) - 3 pts
    const rev_growth = info.revenueGrowth || 0;
    if (rev_growth > 0.25) {
        alpha_score += 3;
        reasons.push(`Explosive revenue growth (${(rev_growth * 100).toFixed(1)}%). Valuation expansion likely.`);
    } else if (rev_growth > 0.10) {
        alpha_score += 1.5;
        reasons.push("Steady growth trajectory.");
    }

    // 3. The 'Credo Rule' (Premium to Discounted Correction) - 2 pts
    // User likes ~20% drawdown for entry
    if (drawdown_pct <= -15 && drawdown_pct >= -30) {
        alpha_score += 2;
        reasons.push("Corrected from premium to discounted valuation (-20% zone). Prime entry window.");
    } else if (drawdown_pct < -30) {
        reasons.push("Significant drawdown; check for structural slowing before entry.");
    }

    // 4. Balance Sheet / Margin Quality - 2 pts
    const margins = info.profitMargins || 0;
    if (margins > 0.15) {
        alpha_score += 2;
        reasons.push("High-margin business model. Efficient TAM capture.");
    }

    const peg = info.pegRatio || 0;
    const pe = info.forwardPE || 0;
    let valuation_status = "Fairly Valued";
    if (peg && peg > 0 && peg < 1.2) valuation_status = "Undervalued (PEG)";
    else if (peg > 2.5 || pe > 40) valuation_status = "Premium Valuation";

    let signal = "WAIT";
    if (alpha_score >= 7.5 && drawdown_pct <= -10) {
        signal = "BUY";
    } else if (alpha_score >= 5 && drawdown_pct <= -15) {
        signal = "BUY";
    } else if (alpha_score < 3.5) {
        signal = "AVOID";
    }

    return {
        symbol,
        name: info.shortName || symbol,
        signal,
        alpha_score: alpha_score,
        drawdown_pct: Math.round(drawdown_pct * 100) / 100,
        valuation_status,
        inst_own_pct: Math.round(inst_own_pct * 10) / 10,
        fwd_pe: pe ? Math.round(pe * 10) / 10 : "N/A",
        rev_growth: Math.round(rev_growth * 1000) / 10,
        reasons,
        price
    };
}

module.exports = {
    predict_market,
    evaluate_buy_sell_framework
};
