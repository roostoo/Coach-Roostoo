/* ============================================================================
   RoostooSim — shared backtest replay engine for the agent-creation flows.
   Simulates "streaming trained backtest results from static CSV files":
   deterministic (seeded) per asset+config, 50 training episodes, replayable
   with auto-ramping speed. Exposes chart renderers parameterized by palette.
   Global: window.RoostooSim
============================================================================ */
(function () {
  'use strict';

  // ── Deterministic RNG ──────────────────────────────────────────────────
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Asset universe (mirrors lib/constants/assets.ts SUPPORTED_ASSETS) ──
  const ASSETS = [
    { id: 2,    symbol: 'BTC',  name: 'Bitcoin',       price: 64250,    vol: 0.8 },
    { id: 3,    symbol: 'ETH',  name: 'Ethereum',      price: 3418,     vol: 1.0 },
    { id: 1021, symbol: 'SOL',  name: 'Solana',        price: 148.6,    vol: 1.5 },
    { id: 8,    symbol: 'BNB',  name: 'BNB',           price: 591.2,    vol: 0.9 },
    { id: 4,    symbol: 'XRP',  name: 'XRP',           price: 0.5218,   vol: 1.2 },
    { id: 11,   symbol: 'ADA',  name: 'Cardano',       price: 0.4525,   vol: 1.3 },
    { id: 1037, symbol: 'AVAX', name: 'Avalanche',     price: 29.41,    vol: 1.6 },
    { id: 34,   symbol: 'DOGE', name: 'Dogecoin',      price: 0.1421,   vol: 2.0 },
    { id: 5220, symbol: 'DOT',  name: 'Polkadot',      price: 6.18,     vol: 1.2 },
    { id: 17,   symbol: 'LINK', name: 'Chainlink',     price: 14.82,    vol: 1.3 },
    { id: 5,    symbol: 'LTC',  name: 'Litecoin',      price: 78.4,     vol: 0.9 },
    { id: 1036, symbol: 'UNI',  name: 'Uniswap',       price: 9.64,     vol: 1.4 },
    { id: 1039, symbol: 'NEAR', name: 'NEAR Protocol', price: 5.42,     vol: 1.6 },
    { id: 5202, symbol: 'SUI',  name: 'Sui',           price: 1.048,    vol: 1.9 },
    { id: 339,  symbol: 'AAVE', name: 'Aave',          price: 92.3,     vol: 1.4 },
    { id: 127,  symbol: 'FET',  name: 'Fetch.ai',      price: 1.327,    vol: 2.1 },
    { id: 1022, symbol: 'HBAR', name: 'Hedera',        price: 0.0816,   vol: 1.5 },
    { id: 1059, symbol: 'SHIB', name: 'Shiba Inu',     price: 0.0000182,vol: 2.3 },
    { id: 12,   symbol: 'TRX',  name: 'Tron',          price: 0.1218,   vol: 0.7 },
    { id: 13,   symbol: 'XLM',  name: 'Stellar',       price: 0.1042,   vol: 1.1 }
  ];
  const assetBySymbol = {};
  ASSETS.forEach(a => { assetBySymbol[a.symbol] = a; });

  function coinIconUrl(sym) {
    return 'https://static.roostoo.com/static/crypto_logo/color/' + sym.toLowerCase() + '.png';
  }
  function coinIconFallback(sym) {
    return 'https://assets.coincap.io/assets/icons/' + sym.toLowerCase() + '@2x.png';
  }
  function fmtPrice(p) {
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p >= 10) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    return p.toFixed(7);
  }

  // ── Synthetic 5-minute market, seeded per asset ────────────────────────
  const MARKET_BARS = 1400;   // more history → varied, non-repeating episode windows for 300 eps
  function genMarket(symbol) {
    const a = assetBySymbol[symbol] || { price: 100, vol: 1 };
    const rng = mulberry32(hashStr('mkt:' + symbol));
    const bars = [];
    let price = a.price;
    const base = a.price;
    let drift = 0, mom = 0;
    const startTs = Date.UTC(2026, 4, 1); // May 1 2026, 5-min bars
    for (let i = 0; i < MARKET_BARS; i++) {
      if (i % 96 === 0) drift = (rng() - 0.5) * 0.0009 * a.vol;   // gentle regime shifts
      const meanRev = -0.022 * (price - base) / base;            // weak pull — lets real trends form
      const noise = (rng() - 0.5) * 0.008 * a.vol;
      mom = mom * 0.74 + noise * 0.55;                           // momentum → smooth, believable trends
      let dp = meanRev + drift + mom + noise;
      dp = Math.max(-0.018, Math.min(0.018, dp));                // cap single-bar moves — no fake spikes
      const close = price * (1 + dp);
      bars.push({ t: startTs + i * 5 * 60 * 1000, close: close, ret: dp });
      price = close;
    }
    return bars;
  }

  // ── Config quality heuristic — config genuinely changes the outcome ───
  // cfg: { frequency:'1min'|'5min'|'15min', training:'250000'|..., reward:'sharpe'|...,
  //        features: int count (default 12) }
  function cfgQuality(symbol, cfg) {
    const a = assetBySymbol[symbol] || { vol: 1 };
    const rng = mulberry32(hashStr('q:' + symbol + ':' + JSON.stringify(cfg)));
    let q = 0.46;
    q += { '250000': 0, '300000': 0.07, '350000': 0.13 }[String(cfg.training)] || 0;
    q += { sharpe: 0.10, sortino: 0.08, calmar: 0.06, volatilitypenalty: 0.04, entropy: 0.01 }[cfg.reward] || 0;
    // frequency vs. asset volatility fit
    const fit = {
      '1min':  a.vol >= 1.5 ? 0.08 : a.vol >= 1.0 ? 0.02 : -0.04,
      '5min':  a.vol >= 1.5 ? 0.05 : 0.06,
      '15min': a.vol >= 1.5 ? -0.05 : 0.05
    }[cfg.frequency] || 0;
    q += fit;
    const featN = cfg.features != null ? cfg.features : 12;
    q += (featN / 12) * 0.06;
    q += (rng() - 0.5) * 0.08; // asset-config idiosyncrasy
    return Math.max(0.18, Math.min(0.93, q));
  }

  // ── Build a full 300-episode training run ──────────────────────────────
  const EPISODES = 300;
  const STEPS = 150;
  const FEE = 0.001;
  const CASH0 = 10000;

  function buildRun(symbol, cfg) {
    const market = genMarket(symbol);
    const quality = cfgQuality(symbol, cfg);
    const rng = mulberry32(hashStr('run:' + symbol + ':' + JSON.stringify(cfg)));
    const eps = [];
    for (let e = 0; e < EPISODES; e++) {
      // learning curve: sigmoid ramp toward `quality`, spread across the 300 episodes
      const prog = 1 / (1 + Math.exp(-(e - 90) / 30));
      const skill = Math.max(0, Math.min(1, quality * prog + (rng() - 0.5) * 0.10));
      const start = 40 + Math.floor(rng() * (MARKET_BARS - STEPS - 60));
      const ep = simulateEpisode(market, start, skill, rng);
      ep.index = e;
      ep.skill = skill;
      // buy & hold over same window
      ep.buyHold = (market[start + STEPS - 1].close - market[start].close) / market[start].close * 100;
      eps.push(ep);
    }
    return { symbol: symbol, cfg: cfg, quality: quality, market: market, episodes: eps };
  }

  function simulateEpisode(market, start, skill, rng) {
    let cash = CASH0, shares = 0, pos = 0, pv = CASH0;
    const pvH = [CASH0], trades = [], probsH = [], actionsH = [];
    let reward = 0;
    for (let t = 0; t < STEPS; t++) {
      const i = start + t;
      const price = market[i].close;
      // "signal": skill peeks at smoothed forward return
      const fwd = (market[Math.min(i + 6, MARKET_BARS - 1)].close - price) / price;
      const lean = Math.tanh(fwd * 180) * skill;          // -1..1 directional confidence
      const noise = (rng() - 0.5) * (1.0 - skill * 0.75);
      const sig = Math.max(-1, Math.min(1, lean + noise));
      // build action probs (SELL, HOLD, BUY)
      const conv = 0.30 + skill * 0.5;                     // conviction
      let pBuy = 0.27 + sig * conv * 0.5;
      let pSell = 0.27 - sig * conv * 0.5;
      let pHold = 0.46;
      // position-aware gating — skilled agents trade selectively, rookies churn fees
      const gate = 0.10 + (1 - skill) * 0.55;
      if (pos === 0 && sig < 0.30) pBuy *= gate;
      if (pos === 1 && sig > -0.30) pSell *= gate;
      pBuy = Math.max(0.02, pBuy); pSell = Math.max(0.02, pSell); pHold = Math.max(0.06, pHold);
      const s = pBuy + pSell + pHold;
      const probs = [pSell / s, pHold / s, pBuy / s];
      // sample
      const r = rng();
      const action = r < probs[0] ? 0 : r < probs[0] + probs[1] ? 1 : 2;
      const prevPv = pv;
      let trade = null;
      if (action === 0 && pos === 1) {
        const usd = shares * price * (1 - FEE);
        cash += usd; shares = 0; pos = 0;
        trade = { step: t, side: 'SELL', price: price, usd: usd };
      } else if (action === 2 && pos === 0) {
        const usd = cash * 0.96;
        shares = (usd / price) * (1 - FEE);
        cash -= usd; pos = 1;
        trade = { step: t, side: 'BUY', price: price, usd: usd };
      }
      const nxt = market[Math.min(i + 1, MARKET_BARS - 1)].close;
      pv = cash + shares * nxt;
      reward += (pv - prevPv) / prevPv * 100;
      pvH.push(pv);
      probsH.push(probs);
      actionsH.push(action);
      if (trade) trades.push(trade);
    }
    // classify round-trips
    let openBuy = -1;
    trades.forEach(t => { t.outcome = 'open'; });
    for (let k = 0; k < trades.length; k++) {
      const t = trades[k];
      if (t.side === 'BUY') openBuy = k;
      else if (t.side === 'SELL' && openBuy >= 0) {
        const win = t.price > trades[openBuy].price * (1 + 2 * FEE);
        trades[openBuy].outcome = trades[k].outcome = win ? 'win' : 'loss';
        openBuy = -1;
      }
    }
    // max drawdown
    let peak = pvH[0], mdd = 0;
    for (let k = 1; k < pvH.length; k++) {
      if (pvH[k] > peak) peak = pvH[k];
      const dd = (peak - pvH[k]) / peak;
      if (dd > mdd) mdd = dd;
    }
    return {
      start: start, trades: trades, pv: pvH, probs: probsH, actions: actionsH,
      reward: reward, retPct: (pv / CASH0 - 1) * 100, maxDD: mdd * 100
    };
  }

  // ── Verdict over a finished run ────────────────────────────────────────
  function computeVerdict(run) {
    const eps = run.episodes;
    const lastN = eps.slice(-10);
    const firstN = eps.slice(0, 5);
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    const lastAvg = avg(lastN.map(e => e.retPct));
    const firstAvg = avg(firstN.map(e => e.retPct));
    const bhAvg = avg(lastN.map(e => e.buyHold));
    let wins = 0, total = 0;
    lastN.forEach(e => e.trades.forEach(t => {
      if (t.side === 'SELL' && t.outcome !== 'open') { total++; if (t.outcome === 'win') wins++; }
    }));
    const mddAvg = avg(lastN.map(e => e.maxDD));
    const rets = lastN.map(e => e.retPct);
    const m = avg(rets);
    const sd = Math.sqrt(avg(rets.map(x => (x - m) * (x - m)))) || 1;
    return {
      firstAvg: firstAvg, lastAvg: lastAvg, vsBuyHold: lastAvg - bhAvg, buyHold: bhAvg,
      winRate: total ? (wins / total) * 100 : 0, trades: total,
      maxDD: mddAvg, sharpe: Math.max(-1.2, Math.min(2.6, (m / sd) * 0.9)),
      grade: lastAvg > 6 ? 'A' : lastAvg > 3 ? 'B+' : lastAvg > 1 ? 'B' : lastAvg > 0 ? 'C' : 'D'
    };
  }

  // ── Replay controller — auto-ramping playback over 50 episodes ────────
  // opts: { run, render(state), onDone(), speed:'auto' }
  function createReplay(opts) {
    const st = {
      run: opts.run,
      ep: 0, step: 0,
      phase: 'play',            // 'play' | 'update' | 'done'
      updateT: 0,
      speedMult: 1,             // 1 | 3 | 10
      playing: false,
      raf: 0, acc: 0,
      done: false
    };
    // constant, steady pace (~5 bars/frame at 1×) — the speed pills (1×/3×/10×) multiply it
    const BASE_SPF = 5;
    function rampSPF() { return BASE_SPF * st.speedMult; }
    function tick() {
      if (!st.playing) return;
      st.acc += rampSPF();
      let guard = 4000;
      while (st.acc >= 1 && guard-- > 0 && st.phase !== 'done') {
        if (st.phase === 'play') {
          if (st.step < STEPS - 1) { st.step++; st.acc -= 1; }
          else {
            st.phase = 'update'; st.updateT = 1;
          }
        } else if (st.phase === 'update') {
          st.updateT -= 0.5;
          st.acc -= 1;
          if (st.updateT <= 0) {
            if (st.ep < EPISODES - 1) { st.ep++; st.step = 0; st.phase = 'play'; }
            else { st.phase = 'done'; }
          }
        }
      }
      opts.render(st);
      if (st.phase === 'done' && !st.done) {
        st.done = true; st.playing = false;
        if (opts.onDone) opts.onDone(st);
        return;
      }
      st.raf = requestAnimationFrame(tick);
    }
    return {
      state: st,
      play: function () { if (st.playing || st.done) return; st.playing = true; tick(); },
      pause: function () { st.playing = false; if (st.raf) cancelAnimationFrame(st.raf); },
      setSpeed: function (m) { st.speedMult = m; st.acc = 0; },
      skip: function () {
        st.playing = false; if (st.raf) cancelAnimationFrame(st.raf);
        st.ep = EPISODES - 1; st.step = STEPS - 1; st.phase = 'done';
        opts.render(st);
        if (!st.done) { st.done = true; if (opts.onDone) opts.onDone(st); }
      },
      destroy: function () { st.playing = false; if (st.raf) cancelAnimationFrame(st.raf); }
    };
  }

  // ── Streaming simulation — "CSV chunks arriving" ───────────────────────
  // onProgress(pct, bytes), onDone(run). Builds the run during the stream.
  function streamRun(symbol, cfg, onProgress, onDone) {
    const totalKB = 180 + Math.floor(mulberry32(hashStr('sz' + symbol))() * 160);
    let pct = 0;
    let run = null;
    const t0 = performance.now();
    function step() {
      pct = Math.min(1, pct + 0.13 + Math.random() * 0.16);
      onProgress(pct, Math.round(totalKB * pct));
      if (pct >= 1) {
        if (!run) run = buildRun(symbol, cfg);
        onDone(run);
      } else {
        if (!run && pct > 0.3) run = buildRun(symbol, cfg); // build mid-stream
        setTimeout(step, 90 + Math.random() * 130);
      }
    }
    setTimeout(step, 120);
    return { csvName: 'backtest_' + symbol + 'USDT_PPO_' + (cfg.frequency || '5min') + '.csv', sizeKB: totalKB };
  }

  // ── Canvas helpers ─────────────────────────────────────────────────────
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    if (r.width === 0) return null;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: r.width, H: r.height };
  }

  // Price chart with playhead + trade markers. pal: {accent, green, red, gold, grid, label, font}
  function drawPrice(cv, run, st, pal) {
    const f = fit(cv); if (!f) return;
    const ctx = f.ctx, W = f.W, H = f.H;
    ctx.clearRect(0, 0, W, H);
    const ep = run.episodes[st.ep];
    const start = ep.start, end = start + STEPS;
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < end; i++) {
      const p = run.market[i].close;
      if (p < lo) lo = p; if (p > hi) hi = p;
    }
    const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const pl = 54, pr = 10, pt = 10, pb = 20;
    const cw = W - pl - pr, ch = H - pt - pb;
    const xOf = i => pl + ((i - start) / (STEPS - 1)) * cw;
    const yOf = p => pt + (1 - (p - lo) / (hi - lo)) * ch;
    // grid
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    ctx.fillStyle = pal.label; ctx.font = '9px ' + pal.font; ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const y = pt + (k / 4) * ch;
      ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + cw, y); ctx.stroke();
      ctx.fillText(fmtPrice(hi - (k / 4) * (hi - lo)), pl - 5, y + 3);
    }
    // dim full path
    ctx.strokeStyle = pal.accentDim; ctx.lineWidth = 1.1; ctx.beginPath();
    for (let i = start; i < end; i++) {
      const x = xOf(i), y = yOf(run.market[i].close);
      i === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // traversed bold
    const head = start + Math.min(st.step, STEPS - 1);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = start; i <= head; i++) {
      const x = xOf(i), y = yOf(run.market[i].close);
      i === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // trades up to playhead
    for (let k = 0; k < ep.trades.length; k++) {
      const tr = ep.trades[k];
      if (tr.step > st.step) break;
      const x = xOf(start + tr.step), y = yOf(tr.price);
      const c = tr.outcome === 'win' ? pal.green : tr.outcome === 'loss' ? pal.red : pal.gold;
      ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 7;
      ctx.beginPath();
      if (tr.side === 'BUY') { ctx.moveTo(x, y - 9); ctx.lineTo(x - 5, y - 2); ctx.lineTo(x + 5, y - 2); }
      else { ctx.moveTo(x, y + 9); ctx.lineTo(x - 5, y + 2); ctx.lineTo(x + 5, y + 2); }
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    }
    // playhead
    if (st.phase === 'play') {
      const px = xOf(head);
      ctx.strokeStyle = pal.gold; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(px, pt); ctx.lineTo(px, pt + ch); ctx.stroke();
      ctx.setLineDash([]);
    }
    // update flash
    if (st.phase === 'update' && st.updateT > 0) {
      ctx.fillStyle = pal.flash.replace('@A', (0.16 * st.updateT).toFixed(3));
      ctx.fillRect(pl, pt, cw, ch);
    }
    // footer
    ctx.fillStyle = pal.label; ctx.textAlign = 'left';
    ctx.fillText(run.symbol + 'USDT · 5m bars · episode window @ bar ' + start + ' · step ' + st.step + '/' + STEPS, pl, H - 7);
  }

  // Equity sparkline for current episode
  function drawEquity(cv, run, st, pal) {
    const f = fit(cv); if (!f) return;
    const ctx = f.ctx, W = f.W, H = f.H;
    ctx.clearRect(0, 0, W, H);
    const ep = run.episodes[st.ep];
    const n = Math.min(st.step + 1, ep.pv.length);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ep.pv.length; i++) { if (ep.pv[i] < lo) lo = ep.pv[i]; if (ep.pv[i] > hi) hi = ep.pv[i]; }
    const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
    const pl = 6, pt = 6, pb = 6, pr = 6;
    const cw = W - pl - pr, ch = H - pt - pb;
    const xOf = i => pl + (i / (ep.pv.length - 1)) * cw;
    const yOf = v => pt + (1 - (v - lo) / (hi - lo)) * ch;
    // baseline = starting cash
    ctx.strokeStyle = pal.grid; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pl, yOf(CASH0)); ctx.lineTo(pl + cw, yOf(CASH0)); ctx.stroke();
    ctx.setLineDash([]);
    const up = ep.pv[n - 1] >= CASH0;
    ctx.strokeStyle = up ? pal.green : pal.red; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xOf(i), y = yOf(ep.pv[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = up ? pal.green : pal.red;
    ctx.beginPath(); ctx.arc(xOf(n - 1), yOf(ep.pv[n - 1]), 2.6, 0, Math.PI * 2); ctx.fill();
  }

  // Reward-per-episode learning curve, drawn up to current episode
  function drawReward(cv, run, st, pal) {
    const f = fit(cv); if (!f) return;
    const ctx = f.ctx, W = f.W, H = f.H;
    ctx.clearRect(0, 0, W, H);
    const upto = st.phase === 'done' ? EPISODES : st.ep + (st.phase === 'update' ? 1 : 0);
    const data = run.episodes.slice(0, Math.max(1, upto)).map(e => e.retPct);
    const pl = 38, pr = 8, pt = 8, pb = 16;
    const cw = W - pl - pr, ch = H - pt - pb;
    let lo = Math.min(0, ...data), hi = Math.max(0.5, ...data);
    const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
    const xOf = i => pl + (EPISODES > 1 ? (i / (EPISODES - 1)) * cw : 0);
    const yOf = v => pt + (1 - (v - lo) / (hi - lo)) * ch;
    ctx.strokeStyle = pal.grid;
    ctx.fillStyle = pal.label; ctx.font = '8.5px ' + pal.font; ctx.textAlign = 'right';
    for (let k = 0; k <= 2; k++) {
      const y = pt + (k / 2) * ch;
      ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + cw, y); ctx.stroke();
      ctx.fillText((hi - (k / 2) * (hi - lo)).toFixed(1) + '%', pl - 4, y + 3);
    }
    // zero line
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = pal.zero;
      ctx.beginPath(); ctx.moveTo(pl, yOf(0)); ctx.lineTo(pl + cw, yOf(0)); ctx.stroke();
    }
    if (data.length >= 2) {
      ctx.strokeStyle = pal.accentDim; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = xOf(i), y = yOf(data[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // moving average(8)
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const s0 = Math.max(0, i - 7);
        let s = 0; for (let j = s0; j <= i; j++) s += data[j];
        const x = xOf(i), y = yOf(s / (i - s0 + 1));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (data.length) {
      ctx.fillStyle = pal.gold; ctx.shadowColor = pal.gold; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(xOf(data.length - 1), yOf(data[data.length - 1]), 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = pal.label; ctx.textAlign = 'left';
    ctx.fillText('return per episode · avg(8)', pl, H - 5);
    ctx.textAlign = 'right';
    ctx.fillText('ep ' + Math.max(0, data.length - 1) + '/' + (EPISODES - 1), pl + cw, H - 5);
  }

  // ── Fake live data for asset pickers (24h change, volatility) ─────────
  function fakeTicker(symbol) {
    const rng = mulberry32(hashStr('tick:' + symbol + ':jun11'));
    const a = assetBySymbol[symbol] || { vol: 1 };
    const pct = (rng() - 0.45) * 6 * a.vol;
    const v = Math.abs(pct);
    return { pct: pct, vol: v < 2 ? 'low' : v < 5 ? 'med' : 'high' };
  }

  // ── Fake competitions ──────────────────────────────────────────────────
  const COMPETITIONS = [
    { id: 'c1', name: '3-Day June Trading Competition', prize: 1000, entrants: 426, starts: 'Starts in 2d 06h', fee: 0 },
    { id: 'c2', name: 'Hourly Competition', prize: 150, entrants: 78, starts: 'Starts in 42m', fee: 0 },
    { id: 'c3', name: 'Daily Agent + Human Competition', prize: 500, entrants: 213, starts: 'Starts in 6h 30m', fee: 5 }
  ];

  window.RoostooSim = {
    ASSETS: ASSETS, assetBySymbol: assetBySymbol,
    EPISODES: EPISODES, STEPS: STEPS, CASH0: CASH0,
    coinIconUrl: coinIconUrl, coinIconFallback: coinIconFallback, fmtPrice: fmtPrice,
    genMarket: genMarket, buildRun: buildRun, computeVerdict: computeVerdict,
    createReplay: createReplay, streamRun: streamRun,
    drawPrice: drawPrice, drawEquity: drawEquity, drawReward: drawReward,
    fakeTicker: fakeTicker, COMPETITIONS: COMPETITIONS,
    hashStr: hashStr, mulberry32: mulberry32
  };
})();
