const marketData = require('./services/market_data');
const config = require('./config');

async function check() {
    console.log("Deep-Scan Alpha Research...");
    const results = await marketData.evaluate_alpha_discovery();
    console.log("Active Discoveries:", results.length);
    results.forEach(r => {
        console.log(`--- ${r.symbol} (${r.name}) ---`);
        console.log(`Score:   ${r.alpha_score}/10`);
        console.log(`Signal:  ${r.signal}`);
        console.log(`DD %:    ${r.drawdown_pct}% (Target: -15% to -30%)`);
        console.log(`Inst %:  ${r.inst_own_pct}% (Target: >65%)`);
        console.log(`Growth:  ${r.rev_growth}% (Target: >25%)`);
        console.log(`Valuation: ${r.valuation_status}`);
        console.log("----------------------------");
    });

    console.log("\nWatchlist Alpha Check...");
    const watchlist = await marketData.get_watchlist_data({ score: 0 }); 
    console.log("Watchlist count:", watchlist.length);
    watchlist.forEach(r => {
        console.log(`${r.symbol}: Score ${r.alpha_score} (${r.signal})`);
    });
}

check().catch(console.error);
