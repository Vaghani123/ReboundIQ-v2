const { RSI, MACD, BollingerBands, SMA, EMA, ATR, ADX, Stochastic } = require('technicalindicators');
const config = require('../config');

function calculate_rsi(df) {
    const closes = df.map(d => d.close);
    const rsiInput = {
        values: closes,
        period: config.RSI_PERIOD
    };
    const rsi = RSI.calculate(rsiInput);
    if (!rsi || rsi.length === 0) return { value: 50, score: 0, signal: "NEUTRAL" };
    
    const current_rsi = rsi[rsi.length - 1];
    
    let score = 0;
    if (current_rsi <= config.RSI_OVERSOLD) {
        score = 1.0;
    } else if (current_rsi >= config.RSI_OVERBOUGHT) {
        score = -1.0;
    } else if (current_rsi < 50) {
        score = (50 - current_rsi) / (50 - config.RSI_OVERSOLD);
    } else {
        score = -(current_rsi - 50) / (config.RSI_OVERBOUGHT - 50);
    }
    
    let signal = "NEUTRAL";
    if (current_rsi <= config.RSI_OVERSOLD) signal = "OVERSOLD";
    else if (current_rsi >= config.RSI_OVERBOUGHT) signal = "OVERBOUGHT";
    
    return {
        value: current_rsi,
        score: Math.max(-1, Math.min(1, score)),
        signal: signal
    };
}

function calculate_macd(df) {
    const closes = df.map(d => d.close);
    const macdInput = {
        values: closes,
        fastPeriod: config.MACD_FAST,
        slowPeriod: config.MACD_SLOW,
        signalPeriod: config.MACD_SIGNAL,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    };
    const macd = MACD.calculate(macdInput);
    if (!macd || macd.length === 0) return { macd: 0, signal: 0, histogram: 0, score: 0, crossover: "NEUTRAL" };
    
    const current = macd[macd.length - 1];
    const prev = macd.length > 1 ? macd[macd.length - 2] : null;
    
    const current_hist = current.histogram || 0;
    const prev_hist = prev ? prev.histogram || 0 : 0;
    const current_macd = current.MACD || 0;
    const current_signal = current.signal || 0;
    
    let score = 0;
    if (current_hist > 0 && prev_hist <= 0) {
        score = 0.8;
    } else if (current_hist < 0 && prev_hist >= 0) {
        score = -0.8;
    } else if (current_hist > 0) {
        score = Math.min(0.6, current_hist / (Math.abs(current_macd) + 1e-10));
    } else {
        score = Math.max(-0.6, current_hist / (Math.abs(current_macd) + 1e-10));
    }
    
    const crossover = current_macd > current_signal ? "BULLISH" : "BEARISH";
    
    return {
        macd: current_macd,
        signal: current_signal,
        histogram: current_hist,
        score: Math.max(-1, Math.min(1, score)),
        crossover: crossover
    };
}

function calculate_bollinger(df) {
    const closes = df.map(d => d.close);
    const bbInput = {
        period: config.BOLLINGER_PERIOD,
        values: closes,
        stdDev: config.BOLLINGER_STD_DEV
    };
    const bb = BollingerBands.calculate(bbInput);
    if (!bb || bb.length === 0) return { upper: 0, lower: 0, middle: 0, position: 0.5, score: 0, signal: "NEUTRAL" };
    
    const current_bb = bb[bb.length - 1];
    const current_price = closes[closes.length - 1];
    
    const band_width = current_bb.upper - current_bb.lower;
    let position = 0.5;
    if (band_width > 0) {
        position = (current_price - current_bb.lower) / band_width;
    }
    
    let score = 0;
    if (position <= 0.0) score = 1.0;
    else if (position >= 1.0) score = -1.0;
    else score = 1.0 - (2.0 * position);
    
    let signal = "NEUTRAL";
    if (position < 0.2) signal = "OVERSOLD";
    else if (position > 0.8) signal = "OVERBOUGHT";
    
    return {
        upper: current_bb.upper,
        lower: current_bb.lower,
        middle: current_bb.middle,
        position: position,
        score: Math.max(-1, Math.min(1, score)),
        signal: signal
    };
}

function calculate_moving_averages(df) {
    const closes = df.map(d => d.close);
    const smaShortInput = { period: config.SMA_SHORT, values: closes };
    const smaLongInput = { period: config.SMA_LONG, values: closes };
    const emaShortInput = { period: config.EMA_SHORT, values: closes };
    const emaLongInput = { period: config.EMA_LONG, values: closes };
    
    const smaShort = SMA.calculate(smaShortInput);
    const smaLong = SMA.calculate(smaLongInput);
    const emaShort = EMA.calculate(emaShortInput);
    const emaLong = EMA.calculate(emaLongInput);
    
    const cur_sma_s = smaShort.length > 0 ? smaShort[smaShort.length - 1] : null;
    const cur_sma_l = smaLong.length > 0 ? smaLong[smaLong.length - 1] : null;
    const cur_ema_s = emaShort.length > 0 ? emaShort[emaShort.length - 1] : null;
    const cur_ema_l = emaLong.length > 0 ? emaLong[emaLong.length - 1] : null;
    const current_price = closes[closes.length - 1];
    
    let cross_type = "INSUFFICIENT DATA";
    let cross_score = 0.0;
    
    if (cur_sma_s !== null && cur_sma_l !== null) {
        if (cur_sma_s > cur_sma_l) {
            cross_type = "GOLDEN CROSS";
            cross_score = 0.7;
        } else {
            cross_type = "DEATH CROSS";
            cross_score = -0.7;
        }
    }
    
    let price_vs_sma = 0.0;
    if (cur_sma_s !== null) {
        const pct_above = (current_price - cur_sma_s) / cur_sma_s;
        price_vs_sma = Math.max(-1, Math.min(1, pct_above * 10));
    }
    
    const score = (cross_score * 0.6) + (price_vs_sma * 0.4);
    
    return {
        sma_short: cur_sma_s,
        sma_long: cur_sma_l,
        ema_short: cur_ema_s,
        ema_long: cur_ema_l,
        cross_type: cross_type,
        score: Math.max(-1, Math.min(1, score)),
        price_above_sma50: cur_sma_s !== null ? current_price > cur_sma_s : null
    };
}

function calculate_atr(df) {
    const input = {
        high: df.map(d => d.high),
        low: df.map(d => d.low),
        close: df.map(d => d.close),
        period: 14
    };
    const atr = ATR.calculate(input);
    const val = atr.length > 0 ? atr[atr.length - 1] : 0;
    return { value: val, score: 0, signal: "VOLATILITY" };
}

function calculate_adx(df) {
    const input = {
        high: df.map(d => d.high),
        low: df.map(d => d.low),
        close: df.map(d => d.close),
        period: 14
    };
    const adx = ADX.calculate(input);
    if (!adx || adx.length === 0) return { adx: 0, score: 0, signal: "NEUTRAL" };
    
    const current = adx[adx.length - 1];
    const val = current.adx;
    
    let signal = "WEAK TREND";
    let score = 0;
    if (val > 25) {
        signal = "STRONG TREND";
        score = 0.5;
    }
    if (val > 50) {
        signal = "VERY STRONG";
        score = 0.8;
    }
    
    return { adx: val, score: score, signal: signal };
}

function calculate_stochastic(df) {
    const input = {
        high: df.map(d => d.high),
        low: df.map(d => d.low),
        close: df.map(d => d.close),
        period: 14,
        signalPeriod: 3
    };
    const stoch = Stochastic.calculate(input);
    if (!stoch || stoch.length === 0) return { k: 50, d: 50, score: 0, signal: "NEUTRAL" };
    
    const current = stoch[stoch.length - 1];
    const k = current.k;
    const d = current.d;
    
    let signal = "NEUTRAL";
    let score = 0;
    if (k < 20) {
        signal = "OVERSOLD";
        score = 0.8;
    } else if (k > 80) {
        signal = "OVERBOUGHT";
        score = -0.8;
    }
    
    return { k: k, d: d, score: score, signal: signal };
}

function calculate_volume_analysis(df) {
    const volumes = df.map(d => d.volume);
    const smaVolInput = { period: 20, values: volumes };
    const avgVols = SMA.calculate(smaVolInput);
    
    const current_vol = volumes[volumes.length - 1];
    const avg = avgVols.length > 0 ? avgVols[avgVols.length - 1] : null;
    
    const vol_ratio = (avg && avg > 0) ? current_vol / avg : 1.0;
    
    const price_change = df.length >= 2 ? df[df.length - 1].close - df[df.length - 2].close : 0;
    
    let signal = "NORMAL";
    let score = 0.0;
    
    if (vol_ratio > 1.5 && price_change > 0) {
        signal = "HIGH VOL RALLY";
        score = 0.8;
    } else if (vol_ratio > 1.5 && price_change < 0) {
        signal = "HIGH VOL SELLOFF";
        score = -0.8;
    }
    
    return {
        current_volume: current_vol,
        avg_volume_20d: avg || 0,
        volume_ratio: vol_ratio,
        signal: signal,
        score: score
    };
}

function get_all_signals(df) {
    if (!df || df.length < 30) return null;
    
    const rsi = calculate_rsi(df);
    const macd = calculate_macd(df);
    const bollinger = calculate_bollinger(df);
    const ma = calculate_moving_averages(df);
    const volume = calculate_volume_analysis(df);
    const atr = calculate_atr(df);
    const adx = calculate_adx(df);
    const stoch = calculate_stochastic(df);
    
    return {
        rsi: rsi,
        macd: macd,
        bollinger: bollinger,
        moving_avg: ma,
        volume: volume,
        atr: atr,
        adx: adx,
        stochastic: stoch
    };
}

module.exports = {
    get_all_signals
};
