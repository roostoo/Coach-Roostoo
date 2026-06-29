/* Variation B v2 — Strategy Lab (team-feedback iteration)
   Changes vs B: copilot chat at top · uniform config across assets ·
   "?" tooltips per parameter · explicit re-run buttons · verdict renamed
   to "Selected Agent Config" · CSV disclaimer removed. */
(function () {
  'use strict';
  const S = window.RoostooSim;
  const $ = sel => document.querySelector(sel);
  const app = $('#app');

  const FEATURES = ['RSI', 'ATR', 'VWAP', 'MACD', 'StochRSI', 'EMA-X', 'Bollinger', 'OBV', 'Hour', 'Weekday', 'Day', 'Month'];

  // Branded agent avatars — the identity carried through the build → launch flow.
  const AGENT_AVATARS = ['agent-orange', 'agent-green', 'agent-blue', 'agent-purple', 'agent-red'];
  function avatarSrc(i) {
    const n = AGENT_AVATARS.length;
    return 'brand/agents/' + AGENT_AVATARS[((i % n) + n) % n] + '.png';
  }

  const state = {
    name: 'Lab Unit 01',
    avatar: 0,                        // index into AGENT_AVATARS — the agent's look
    roster: ['BTC', 'ETH'],
    active: 'BTC',
    cfg: { frequency: '5min', training: '250000', reward: 'sharpe', feats: FEATURES.map(() => true) },
    results: {},            // sym -> {run, verdict, cfgKey}
    status: {},             // sym -> 'idle'|'stream'|'play'|'done'
    addOpen: false,
    chat: [],
    chatOpen: true,
    chatBusy: false,
    suggestIdx: 0,
    theme: 'dark',
    risk: { sl: 15, slOn: true, tp: 40, tpOn: true, maxT: 25, maxOn: true, minT: 5, minOn: false },
    accepted: false,
    enrolled: {},
    launched: false
  };
  state.roster.forEach(s => { state.status[s] = 'idle'; });

  let replay = null;
  let lastFrame = null;   // {run, st} of the most recent paint — for repaint on resize/zoom

  const PAL_DARK = {
    accent: '#FF873C', accentDim: 'rgba(255,135,60,0.30)',
    green: '#00FF87', red: '#EF5144', gold: '#FEDB29',
    grid: 'rgba(255,255,255,0.05)', zero: 'rgba(255,255,255,0.16)',
    label: 'rgba(255,255,255,0.34)', flash: 'rgba(254,219,41,@A)',
    font: "'IBM Plex Mono', monospace"
  };
  const PAL_LIGHT = {
    accent: '#FF873C', accentDim: 'rgba(255,135,60,0.26)',
    green: '#16C784', red: '#EA3943', gold: '#E0A100',
    grid: 'rgba(0,0,0,0.07)', zero: 'rgba(0,0,0,0.20)',
    label: 'rgba(0,0,0,0.45)', flash: 'rgba(254,219,41,@A)',
    font: "'IBM Plex Mono', monospace"
  };
  let PAL = PAL_DARK;   // current canvas palette — swapped by applyTheme()

  function applyTheme(t) {
    state.theme = (t === 'light') ? 'light' : 'dark';
    document.body.classList.toggle('light', state.theme === 'light');
    PAL = (state.theme === 'light') ? PAL_LIGHT : PAL_DARK;
    try { localStorage.setItem('roostoo-lab-theme', state.theme); } catch (e) { /* ignore */ }
  }

  // ── tooltip copy (first-timer explanations) ────────────────────────────
  const TIPS = {
    frequency: '<b>Decision frequency</b> — how often your agent checks the market and decides to buy, sell, or hold.<br><br><b>1m</b> — checks every minute. Reacts fastest, trades the most, pays the most fees.<br><b>5m</b> — every five minutes. The balanced default.<br><b>15m</b> — slower and smoother. Fewer trades, rides longer trends.<br><br>One frequency applies to every asset in the roster.',
    training: '<b>Training steps</b> — how much practice the agent gets before its backtest is scored.<br><br><b>250k</b> — a quick draft.<br><b>300k</b> — solid middle ground.<br><b>350k</b> — most thorough; usually earns the best grades.',
    reward: '<b>Reward function</b> — what the agent is graded on while it learns.<br><br><b>Sharpe</b> — steady returns relative to overall volatility. The safe default.<br><b>Sortino</b> — only punishes downside swings, tolerates upside spikes.<br><b>Calmar</b> — prioritizes keeping drawdowns small.',
    feats: '<b>Indicators</b> — the market signals your agent can see at each step. RSI = momentum, ATR = volatility, VWAP = average traded price, MACD = trend, Bollinger = price bands, OBV = volume flow, plus calendar context (hour, weekday…).<br><br>Fewer signals = a simpler agent; more = a richer view but more noise. The same set applies to all assets.',
    ppo: '<b>PPO</b> (Proximal Policy Optimization) is the learning algorithm. Each step the agent sees the market, acts, collects a reward, then nudges its policy — never too much at once. Watch the four boxes light up as it cycles.'
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function coinImg(sym, size) {
    return '<img src="' + S.coinIconUrl(sym) + '" width="' + size + '" height="' + size + '" alt="' + sym + '" onerror="this.onerror=null;this.src=\'' + S.coinIconFallback(sym) + '\'">';
  }
  function cfgKey() {
    const c = state.cfg;
    return JSON.stringify([c.frequency, c.training, c.reward, c.feats]);
  }
  function engineCfg() {
    const c = state.cfg;
    return { frequency: c.frequency, training: c.training, reward: c.reward, features: c.feats.filter(Boolean).length, mask: c.feats.join('') };
  }
  function isFresh(sym) { const r = state.results[sym]; return !!(r && r.cfgKey === cfgKey()); }
  function testedCount() { return state.roster.filter(isFresh).length; }
  function fmtPct(x) { return (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // Convert the model's markdown reply into clean HTML. Escapes FIRST (safe),
  // then formats **bold**, *highlight*, bullet/numbered lists, and paragraphs —
  // so asterisks no longer show up literally and answers are easy to scan.
  function formatBotText(raw) {
    const esc = escapeHtml(String(raw).trim());
    const lines = esc.split('\n');
    let html = '', inList = false, listTag = '';
    const closeList = () => { if (inList) { html += '</' + listTag + '>'; inList = false; } };
    const inline = (t) => t
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (let line of lines) {
      const t = line.trim();
      if (t === '') { closeList(); continue; }
      const b = t.match(/^[-•*]\s+(.*)$/);
      const n = t.match(/^(\d+)\.\s+(.*)$/);
      if (b) {
        if (!inList || listTag !== 'ul') { closeList(); html += '<ul>'; inList = true; listTag = 'ul'; }
        html += '<li>' + inline(b[1]) + '</li>';
      } else if (n) {
        if (!inList || listTag !== 'ol') { closeList(); html += '<ol>'; inList = true; listTag = 'ol'; }
        html += '<li>' + inline(n[2]) + '</li>';
      } else {
        closeList();
        html += '<p>' + inline(t) + '</p>';
      }
    }
    closeList();
    return html;
  }

  // ── layout ─────────────────────────────────────────────────────────────
  function rootHtml() {
    return barHtml() + chatDockHtml() +
      '<div class="bench" data-screen-label="Strategy Lab v2 workbench">' +
      '<div class="rail">' + rosterHtml() + cfgHtml() + '</div>' +
      '<div class="stage">' + stageHtml() + '</div>' +
      '<div class="rail railR">' + loopHtml() + '<div class="vCard" id="vCard"></div>' + '</div>' +
      '</div>';
  }
  function barHtml() {
    const n = testedCount();
    return '<div class="bar">' +
      '<img class="icon" src="brand/roostoo-icon.png" alt="">' +
      '<span class="logo">Roostoo Labs</span><span class="dot">●</span><span class="tag">Strategy Lab — Build an Agent</span>' +
      '<span class="nameWrap">' +
      '<button class="agentAva" data-act="avatar" title="Click to change your agent\'s look"><img src="' + avatarSrc(state.avatar) + '" alt="agent avatar"></button>' +
      '<span class="lbl">Agent</span><input class="nameInput" id="inName" value="' + state.name + '"></span>' +
      '<span class="barHint" id="barHint">' + n + '/' + state.roster.length + ' backtests up to date</span>' +
      '<button class="themeBtn" data-act="theme" title="Toggle light / dark">' + (state.theme === 'light' ? '☾' : '☀') + '</button>' +
      '<button class="finalizeBtn" id="btnFinalize" data-act="finalize"' + (n === 0 ? ' disabled' : '') + '>Finalize agent →</button>' +
      '</div>';
  }

  // ── Coach Roostoo chat ─────────────────────────────────────────────────
  const CHIPS = [
    'What does 5-minute frequency mean?',
    'Which reward function should I pick?',
    'What do the indicators do?',
    'Tune it for volatile markets'
  ];
  function chipsHtml() {
    return '<span class="chips">' + CHIPS.map(c =>
      '<button class="chipQ" data-act="chat-chip" data-q="' + c + '">' + c + '</button>'
    ).join('') + '</span>';
  }
  // Persistent suggested-question strip above the input — rotates after each answer.
  const SUGGEST_POOL = [
    'What does 5-minute frequency mean?',
    'Which reward function should I pick?',
    'What do the indicators do?',
    'Tune it for volatile markets',
    'Set me up something safe and steady',
    'How many training steps should I use?',
    'What does the grade mean?',
    'Why did my backtest go stale?',
    'What is PPO?',
    'How do I read the learning curve?'
  ];
  function suggestRowHtml() {
    const n = SUGGEST_POOL.length;
    const i = ((state.suggestIdx % n) + n) % n;
    const picks = [SUGGEST_POOL[i], SUGGEST_POOL[(i + 1) % n], SUGGEST_POOL[(i + 2) % n]];
    return '<div class="chatSuggest" id="chatSuggest"><span class="suggLbl">Try asking</span>' +
      picks.map(c => '<button class="chipQ" data-act="chat-chip" data-q="' + c + '">' + c + '</button>').join('') +
      '</div>';
  }
  function refreshSuggest() {
    const el = $('#chatSuggest');
    if (el) el.outerHTML = suggestRowHtml();
  }
  function applyBtn(label, patch) {
    return '<br><button class="chatApply" data-act="chat-apply" data-v=\'' + JSON.stringify(patch) + '\'>⚑ ' + label + '</button>';
  }
  function chatDockHtml() {
    return '<div class="chatDock' + (state.chatOpen ? '' : ' closed') + '" id="chatDock">' +
      '<div class="chatTop" data-act="chat-toggle">' +
      '<span class="aiSpark">✦</span><span class="aiTitle">Coach Roostoo</span>' +
      '<span class="aiSub">Your training coach — ask about indicators, reward functions, or strategy.</span>' +
      '<button class="chatClps">' + (state.chatOpen ? 'hide ▴' : 'show ▾') + '</button>' +
      '</div>' +
      '<div class="chatBody">' +
      '<div class="chatScroll" id="chatScroll"></div>' +
      suggestRowHtml() +
      '<div class="chatInRow">' +
      '<input id="chatIn" placeholder="Ask Coach Roostoo — e.g. what does the Sharpe reward do?">' +
      '<button class="chatSend" data-act="chat-send">Send</button>' +
      '</div></div></div>';
  }
  function renderChat() {
    const sc = $('#chatScroll');
    if (!sc) return;
    sc.innerHTML = state.chat.map(m => '<div class="cm ' + m.role + '">' + m.html + '</div>').join('') +
      (state.chatBusy ? '<div class="cm bot typing">···</div>' : '');
    sc.scrollTop = sc.scrollHeight;
  }
  function pushBot(html) {
    state.chatBusy = false;
    state.chat.push({ role: 'bot', html: html });
    state.suggestIdx += 3;            // rotate to a fresh set of suggestions
    renderChat();
    refreshSuggest();
  }

  function canned(q) {
    const s = q.toLowerCase();
    if (/(volatile|choppy|aggressive|fast market|meme|risky)/.test(s))
      return 'For choppy, fast-moving markets I would check the market more often and grade on downside risk: 1m frequency, Sortino reward, 350k training steps. Your backtests will go stale — re-run them to see the effect.' +
        applyBtn('Apply: 1m · Sortino · 350k', { frequency: '1min', reward: 'sortino', training: '350000' });
    if (/(safe|conservative|steady|calm|low risk|beginner)/.test(s))
      return 'For a steadier agent: 15m frequency so it ignores minute-to-minute noise, Calmar reward to keep drawdowns small, 300k steps. Good first setup.' +
        applyBtn('Apply: 15m · Calmar · 300k', { frequency: '15min', reward: 'calmar', training: '300000' });
    if (/(frequen|1m|5m|15m|minute)/.test(s))
      return 'Decision frequency is how often your agent checks the market and picks an action — buy, sell, or hold. 1m reacts fast but trades a lot and pays more fees. 5m is the balanced default. 15m trades less and rides longer trends. One frequency applies to every asset in your roster.';
    if (/(reward|sharpe|sortino|calmar|graded)/.test(s))
      return 'The reward function is what your agent is graded on while it learns. Sharpe favors steady returns relative to volatility — the safe default. Sortino only penalizes downside swings, so it tolerates upside spikes. Calmar focuses on keeping drawdowns small.';
    if (/(indicator|feature|rsi|macd|vwap|atr|bollinger|obv|signal|sees)/.test(s))
      return 'Indicators are the market signals your agent can see: RSI (momentum), ATR (volatility), VWAP (average traded price), MACD (trend), Bollinger (price bands), OBV (volume flow), plus calendar context. Fewer signals = simpler agent; more = richer view but more noise. The same set applies to all assets.';
    if (/(training|steps|250|300|350)/.test(s))
      return 'Training steps control how much practice the agent gets before you see results. 250k is a fast draft; 350k is the most thorough — usually better grades. The backtest replays the full 300-episode training history either way.';
    if (/(grade|verdict|converge|score|why.*(low|bad|drop))/.test(s))
      return 'The grade summarizes the last 10 training episodes: average return, win rate, drawdown and Sharpe. A or B means the config converged for that asset. C or worse — try more training steps, a different reward, or fewer noisy indicators.';
    if (/(re-?run|stale|orange|refresh)/.test(s))
      return 'Any edit to the config marks every asset stale (orange dot). Hit the ↻ next to an asset, the RE-RUN button above the chart, or re-run from the verdict card to refresh its backtest.';
    if (/(ppo|algorithm|how.*(learn|train|work))/.test(s))
      return 'PPO (Proximal Policy Optimization) is the learning algorithm. Each step the agent sees the market, picks an action, gets a reward, then nudges its policy a little — never too much at once, which keeps training stable. Watch the four boxes on the right light up as it cycles.';
    if (/(learning curve|the curve|per episode|improving|getting better)/.test(s))
      return 'The learning curve plots return per training episode. The faint line is each episode; the bold line is the 8-episode moving average. Trending up then flattening high means the agent converged. Flat or falling means the config is not learning much — try more steps or a different reward.';
    return 'I can explain any setting here — frequency, reward, training steps, indicators — or describe the agent you want. Tap a suggestion below to get started.';
  }

  // Hardened Coach Roostoo system prompt, grounded in the live Strategy Lab config.
  function coachSystemPrompt() {
    const c = state.cfg;
    const indicatorsOn = c.feats.filter(Boolean).length;
    const summary = state.roster.map(sym => {
      const r = state.results[sym];
      return sym + (r ? ' (grade ' + r.verdict.grade + ', avg ' + fmtPct(r.verdict.lastAvg) + (isFresh(sym) ? '' : ', STALE') + ')' : ' (not backtested)');
    }).join(', ');
    const config = 'Decision frequency: ' + c.frequency + '. Training steps: ' + (parseInt(c.training) / 1000) + 'k. Reward function: ' + c.reward + '. Indicators enabled: ' + indicatorsOn + '/12. Asset roster: ' + summary + '.';
    return [
      "You are Coach Roostoo, an in-app coach inside Roostoo. Roostoo is a platform where AI agents and human traders compete in time-bounded trading competitions on live market data. The Agent Factory (where the user is now) is a TRAINING/BACKTESTING sandbox — agents are trained and tested here with no real money. Competitions themselves involve REAL money: real USDC/USDT entry fees and real on-chain payouts.",
      "",
      "The user is configuring a training agent in the Agent Factory. Their CURRENT configuration is:",
      config,
      "",
      "YOUR JOB:",
      "- Explain indicators, reward functions, decision frequency, training steps, strategy, and how the Roostoo platform works (competitions, fees, tiers, XP, wallets, payouts), in plain, beginner-friendly language.",
      "- ALWAYS ground answers in their current configuration above; reference the specific settings they selected. If they ask about something not enabled, explain it and note it isn't currently selected.",
      "- Be concise: 2-3 short paragraphs maximum. Use **bold** for key terms and bullet points for lists where it aids readability. Use *single asterisks* to highlight the single most important figure or fact (e.g. a fee or a number).",
      "",
      "STAYING ON TOPIC:",
      "- You are a Roostoo coach, not a general-purpose assistant.",
      "- IN SCOPE (always answer these directly): anything about trading strategy, indicators, agent config, AND how the Roostoo platform works — competition formats, entry fees, the bonus pool, tiers, XP, wallets, payouts. Competition and fee questions are part of your job, NOT off-topic. Never deflect them.",
      "- OFF TOPIC (redirect briefly): only genuinely unrelated things — general trivia, math, world facts. For those, warmly steer back to Roostoo. One line is enough.",
      "",
      "HOW YOU ANSWER — DESCRIBE, DON'T PRESCRIBE:",
      "- You EDUCATE; you do not advise. Explain how things work and the trade-offs; do not tell the user what they personally should do with real money.",
      "- This matters especially because competitions cost real money. Explain how formats, fees, and scoring work, but NEVER tell a user to enter a competition, how much to risk, or that they will win or earn — those are their decisions.",
      "- When asked for a strategy ('give me a high-risk strategy', 'what should I pick'), treat it as a request to LEARN about that strategy. Reframe 'give me X' into 'let me explain how X works'.",
      "- Present examples as ILLUSTRATIONS of how an approach works, never as INSTRUCTIONS. ALWAYS surface the risks.",
      "",
      "HARD BOUNDARY:",
      "- You do not give real-world buy/sell/hold advice on actual assets, and you do not give financial advice about entering competitions or risking money. Don't open with a refusal or disclaimer — lead with something genuinely useful (explain the mechanics, the concept, the trade-offs), and only at the END note briefly that it's educational, not financial advice.",
      "- Teaching concepts, platform mechanics, and simulator configuration is always fine.",
      "",
      "HOLD THE LINE:",
      "- If the user pushes for a directive ('just tell me what to buy', 'should I enter or not', 'will I win'), do NOT cave. Restate, without lecturing, that you share information rather than instructions about real money, and offer to go deeper on the mechanics or risks instead.",
      "",
      "ROOSTOO PLATFORM FACTS — ANSWER platform/competition questions directly using these facts (do not deflect or say it's outside your area). If a question goes beyond these facts, give what you know and point to https://roostoo.com/docs for the rest:",
      "- WHAT IT IS: AI agents and humans trade the same live market window, evaluated identically, in separate tracks (one human portfolio per competition; multiple agents allowed in agent competitions). Real money: fees and payouts in USDC/USDT, on-chain, to the user's own wallet.",
      "- FORMATS & FEES: 1-day competition = $5 (USDC or USDT); 3-day competition = $20. Minimum 6 participants to start, else it postpones ~24h.",
      "- ENTRY FEE SPLIT: 70% goes to the Bonus Pool (paid back to top-ranking participants), 30% to platform operations. Payouts settle within 60 minutes of close, enforced by smart contract.",
      "- BONUS POOL (paid every competition, to ranking participants): number of winners and the split scale with competition size — e.g. 6-14 players pays top 3; 100+ pays the top 25%. Point to docs for the full distribution table.",
      "- TIERS: Trader (default) -> Pro -> Elite. Pro/Elite earn fixed USDT Performance Bonuses on qualifying competitions, on top of Bonus Pool. Promotion requires all four metrics at once over a rolling window (competitions completed, profitability rate, average return, max drawdown). A -5% portfolio loss hard-resets you to Trader. Point to docs for exact thresholds.",
      "- PERFORMANCE BONUS: fixed USDT payouts for Pro/Elite when net return is +2% or more in a competition (more return = bigger bonus). Stacks with Bonus Pool; both settle together within 60 min.",
      "- XP & LEVELS: every entry earns XP (wins and paid ranks add multipliers); 100 levels total. Top-3 monthly XP earners get USDT bonuses ($500/$250/$100). XP rewards participation; tiers reward performance — they are separate systems.",
      "- WALLETS/PAYOUTS: non-custodial — Roostoo never holds funds; users sign from their own EVM wallet (MetaMask, Rabby, Coinbase Wallet, WalletConnect) on Base, BNB Chain, or Monad. The connected wallet is both charged for entry and paid out to. Changing it needs email OTP + a 24-hour delay. Roostoo pays payout gas; users pay only the entry fee plus their wallet's confirmation gas.",
    ].join("\n");
  }
  // Calls the Coach Roostoo serverless backend (/api/coach), which runs the
  // system prompt + output guardrail server-side. Returns the full plain-text
  // answer (the serverless function does not stream).
  async function llmReply(q) {
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: coachSystemPrompt(), message: q })
    });
    if (!res.ok) throw new Error('backend not reachable');
    const text = await res.text();
    return text.trim();
  }

  function chatSend(q, forceCanned) {
    q = (q || '').trim();
    if (!q || state.chatBusy) return;
    state.chat.push({ role: 'user', html: escapeHtml(q) });
    state.chatBusy = true;
    renderChat();
    if (forceCanned) {
      setTimeout(() => pushBot(formatBotText(canned(q))), 380 + Math.random() * 280);
    } else {
      // Try the real Coach Roostoo backend; fall back to canned if unreachable.
      llmReply(q).then(t => pushBot(formatBotText(t || canned(q)))).catch(() => pushBot(formatBotText(canned(q))));
    }
  }

  // ── left rail ──────────────────────────────────────────────────────────
  function rosterHtml() {
    const items = state.roster.map(sym => {
      const r = state.results[sym];
      const fresh = isFresh(sym);
      const st = state.status[sym];
      const running = st === 'stream' || st === 'play';
      const dotCls = running ? 'live' : fresh ? 'tested' : r ? 'stale' : '';
      const meta = fresh
        ? '<span class="meta ' + (r.verdict.lastAvg >= 0 ? 'pos' : 'neg') + '">' + r.verdict.grade + ' · ' + fmtPct(r.verdict.lastAvg) + ' avg</span>'
        : r ? '<span class="meta" style="color:var(--orange)">stale — config changed</span>'
        : '<span class="meta">not backtested</span>';
      const needRun = !running && !fresh;
      return '<button class="rItem ' + (sym === state.active ? 'on' : '') + '" data-act="pick" data-sym="' + sym + '">' +
        coinImg(sym, 26) +
        '<span class="rs"><span class="sym">' + sym + 'USDT</span><br>' + meta + '</span>' +
        '<span class="stDot ' + dotCls + '"></span>' +
        '<span class="rr' + (needRun ? ' need' : '') + '" data-act="rerun" data-sym="' + sym + '" title="Re-run backtest">↻</span>' +
        '<span class="rm" data-act="remove" data-sym="' + sym + '" title="Remove">✕</span>' +
        '</button>';
    }).join('');
    let add = '';
    if (state.addOpen) {
      const rest = S.ASSETS.filter(a => !state.roster.includes(a.symbol));
      add = '<div class="addGrid">' + rest.map(a =>
        '<span class="addCell" data-act="add" data-sym="' + a.symbol + '">' + coinImg(a.symbol, 20) + a.symbol + '</span>'
      ).join('') + '</div>';
    }
    return '<div class="panel"><h4>Asset roster <span style="font-family:var(--mono)">' + state.roster.length + '/10</span></h4>' +
      '<div class="roster">' + items + '</div>' +
      '<button class="addBtn" data-act="add-open">' + (state.addOpen ? 'Close' : '+ Add asset') + '</button>' + add +
      '</div>';
  }
  function cfgHtml() {
    const c = state.cfg;
    const radios = (field, opts, labels) => '<div class="radioRow">' + opts.map((o, i) =>
      '<span class="radio ' + (c[field] === o ? 'on' : '') + '" data-act="cfg" data-f="' + field + '" data-v="' + o + '">' + labels[i] + '</span>'
    ).join('') + '</div>';
    const fts = FEATURES.map((f, i) =>
      '<span class="ft ' + (c.feats[i] ? 'on' : 'off') + '" data-act="ft" data-i="' + i + '"><i></i>' + f + '</span>'
    ).join('');
    return '<div class="panel"><h4>Agent config <span style="color:var(--dim);font-family:var(--mono);text-transform:none">PPO <span class="qTip" data-tip="ppo">?</span></span></h4>' +
      '<div class="cfgUni">Uniform across <b>all assets</b> in the roster — per-asset tuning comes later.</div>' +
      '<div class="cfgLbl">Decision frequency <span class="qTip" data-tip="frequency">?</span></div>' + radios('frequency', ['1min', '5min', '15min'], ['1m', '5m', '15m']) +
      '<div class="cfgLbl">Training steps <span class="qTip" data-tip="training">?</span></div>' + radios('training', ['250000', '300000', '350000'], ['250k', '300k', '350k']) +
      '<div class="cfgLbl">Reward function <span class="qTip" data-tip="reward">?</span></div>' + radios('reward', ['sharpe', 'sortino', 'calmar'], ['Sharpe', 'Sortino', 'Calmar']) +
      '<div class="cfgLbl">Indicators — what the agent sees <span class="qTip" data-tip="feats">?</span><span style="color:var(--accent);margin-left:auto" id="ftCount">' + c.feats.filter(Boolean).length + '/12</span></div>' +
      '<div class="ftGrid">' + fts + '</div>' +
      '</div>';
  }
  function stageHtml() {
    return '<div class="streamLine"><span class="sDot" id="sDot"></span>' +
      '<span class="csv" id="csvName">idle</span>' +
      '<span class="streamBarMini"><i id="sFill"></i></span>' +
      '<span class="kb" id="sKb"></span><span id="runWrap"></span></div>' +
      '<div class="stagePanel">' +
      '<div class="headStats">' +
      hs('Episode', 'hsEp', 'gold') + hs('Portfolio', 'hsPv', '') + hs('Episode P&amp;L', 'hsPnl', '') +
      hs('Best avg(8)', 'hsBest', '') + hs('Position', 'hsPos', '') + hs('Trades', 'hsTr', '') +
      '<span class="spdWrap">' +
      '<button class="spd on" data-act="spd" data-v="1">1×</button>' +
      '<button class="spd" data-act="spd" data-v="3">3×</button>' +
      '<button class="spd" data-act="spd" data-v="10">10×</button>' +
      '<button class="spd" data-act="skip">SKIP ⇥</button></span>' +
      '</div>' +
      '<canvas id="cvPrice"></canvas>' +
      '<div class="lowRow">' +
      '<div><div class="miniLbl">Learning curve — return per episode</div><canvas id="cvReward"></canvas></div>' +
      '<div><div class="miniLbl">Policy π(a|s)</div>' +
      ['sell', 'hold', 'buy'].map(k =>
        '<div class="probRow"><span class="n ' + k + '">' + k.toUpperCase() + '</span><div class="probTrack"><div class="probFill ' + k + '" id="pf-' + k + '" style="width:33%"></div></div><span class="p" id="pp-' + k + '">33%</span></div>'
      ).join('') +
      '<div class="miniLbl" style="margin-top:7px">Equity</div><canvas id="cvEquity"></canvas></div>' +
      '</div>' +
      '<div class="stageIdle" id="stageIdle"><div class="idleInner">' +
      '<div class="idleTitle">No backtest yet</div>' +
      '<div class="idleSub">Set your config, then run the backtest for ' + state.active + 'USDT.</div>' +
      '<button class="runBig" data-act="rerun" data-sym="' + state.active + '">▶ Run backtest</button>' +
      '</div></div>' +
      '</div>';
  }
  function hs(l, id, cls) {
    return '<span class="hs"><span class="l">' + l + '</span><span class="v ' + cls + '" id="' + id + '">—</span></span>';
  }
  function loopHtml() {
    return '<div class="panel"><h4><span>PPO learning loop <span class="qTip" data-tip="ppo">?</span></span></h4>' +
      '<div class="loopCenter"><div class="ep" id="lcEp">0</div><div class="sub">episode</div></div>' +
      '<div class="loopGrid">' +
      loopBox('see', '1', 'SEE', 'state s<sub>t</sub> — 12 features') +
      loopBox('act', '2', 'ACT', 'sample a<sub>t</sub> ~ π') +
      loopBox('upd', '4', 'UPDATE', 'clip ε=0.2 · 5 epochs') +
      loopBox('rew', '3', 'REWARD', 'advantage Â<sub>t</sub>') +
      '</div>' +
      '<div class="loopCycleLbl">SEE → ACT → REWARD → <b>UPDATE</b> → repeat</div>' +
      '</div>';
  }
  function loopBox(id, n, t, sub) {
    return '<div class="loopBox" id="lb-' + id + '"><span class="ln">' + n + '</span><span class="lt">' + t + '</span><div class="lv" id="lv-' + id + '">' + sub + '</div></div>';
  }

  // ── backtest orchestration ─────────────────────────────────────────────
  function refreshRunWrap() {
    const w = $('#runWrap');
    if (!w) return;
    const sym = state.active;
    const st = state.status[sym];
    if (st === 'stream' || st === 'play') { w.innerHTML = ''; return; }
    w.innerHTML = isFresh(sym) ? '' :
      '<button class="runNow" data-act="rerun" data-sym="' + sym + '">↻ ' + (state.results[sym] ? 'RE-RUN BACKTEST' : 'RUN BACKTEST') + '</button>';
  }

  function startPreview(force) {
    const sym = state.active;
    if (!sym) return;
    if (replay) { replay.destroy(); replay = null; }
    const cached = state.results[sym];
    if (!force) {
      if (cached) {
        state.status[sym] = 'done';
        paintDone(sym, !isFresh(sym));
      } else {
        state.status[sym] = 'idle';
        paintIdle(sym);
      }
      refreshRoster(); refreshRunWrap();
      return;
    }
    const idleEl = $('#stageIdle'); if (idleEl) idleEl.style.display = 'none';
    state.status[sym] = 'stream';
    refreshRoster(); refreshRunWrap();
    const c = engineCfg();
    setText('#csvName', 'requesting stream…');
    const csvEl = $('#csvName'); if (csvEl) csvEl.classList.remove('stale');
    const info = S.streamRun(sym, c,
      (pct, kb) => {
        if (state.active !== sym) return;
        setText('#csvName', info.csvName);
        const f = $('#sFill'); if (f) f.style.width = (pct * 100).toFixed(0) + '%';
        setText('#sKb', kb + '/' + info.sizeKB + ' KB');
      },
      run => {
        if (state.active !== sym) return;
        state.results[sym] = { run: run, verdict: S.computeVerdict(run), cfgKey: cfgKey() };
        state.status[sym] = 'play';
        hideVerdict();
        refreshRoster(); refreshRunWrap();
        beginReplay(run);
      });
  }

  function beginReplay(run) {
    const cvP = $('#cvPrice');
    if (!cvP) return;
    setText('#csvName', 'replaying ' + run.symbol + 'USDT training episodes');
    replay = S.createReplay({
      run: run,
      render: st => paintFrame(run, st),
      onDone: () => {
        state.status[run.symbol] = 'done';
        showVerdict(run.symbol, false);
        refreshRoster();
        refreshBar();
        refreshRunWrap();
        setText('#csvName', 'backtest_' + run.symbol + 'USDT_PPO.csv — replay complete · ' + S.EPISODES + ' episodes');
      }
    });
    replay.play();
  }

  function paintFrame(run, st) {
    const cvP = $('#cvPrice'), cvR = $('#cvReward'), cvE = $('#cvEquity');
    if (!cvP) return;
    lastFrame = { run: run, st: st };
    const idleEl = $('#stageIdle'); if (idleEl) idleEl.style.display = 'none';
    S.drawPrice(cvP, run, st, PAL);
    S.drawReward(cvR, run, st, PAL);
    S.drawEquity(cvE, run, st, PAL);
    const ep = run.episodes[st.ep];
    const i = Math.max(0, Math.min(st.step, ep.probs.length - 1));
    const probs = ep.probs[i];
    ['sell', 'hold', 'buy'].forEach((k, idx) => {
      const f = $('#pf-' + k), p = $('#pp-' + k);
      if (f) f.style.width = (probs[idx] * 100).toFixed(1) + '%';
      if (p) p.textContent = (probs[idx] * 100).toFixed(0) + '%';
    });
    const pv = ep.pv[Math.min(st.step, ep.pv.length - 1)];
    const pnl = (pv / S.CASH0 - 1) * 100;
    setHs('hsEp', (st.ep + 1) + '/' + S.EPISODES, 'gold');
    setHs('hsPv', '$' + Math.round(pv).toLocaleString(), '');
    setHs('hsPnl', fmtPct(pnl), pnl >= 0 ? 'pos' : 'neg');
    let best = -Infinity;
    const upto = st.phase === 'done' ? S.EPISODES : st.ep + 1;
    for (let e = 7; e < upto; e++) {
      let s = 0; for (let j = e - 7; j <= e; j++) s += run.episodes[j].retPct;
      if (s / 8 > best) best = s / 8;
    }
    setHs('hsBest', isFinite(best) ? fmtPct(best) : '—', best >= 0 ? 'pos' : 'neg');
    let pos = 'FLAT';
    for (let k = 0; k < ep.trades.length; k++) { if (ep.trades[k].step <= st.step) pos = ep.trades[k].side === 'BUY' ? 'LONG' : 'FLAT'; }
    setHs('hsPos', pos, pos === 'LONG' ? 'pos' : '');
    setHs('hsTr', String(ep.trades.filter(t => t.step <= st.step).length), '');
    setText('#lcEp', String(st.ep));
    const activeIdx = st.phase === 'update' || st.phase === 'done' ? 3 : st.step % 3;
    [['see', 0], ['act', 1], ['rew', 2], ['upd', 3]].forEach(p => {
      const el = $('#lb-' + p[0]);
      if (el) el.classList.toggle('active', p[1] === activeIdx);
    });
    const action = ep.actions[i];
    setHtml('#lv-see', 'log-ret <b>' + ((run.market[ep.start + i].ret || 0) * 100).toFixed(2) + '%</b><br>features: <b>' + engineCfg().features + '/12</b>');
    setHtml('#lv-act', 'sampled <b class="' + (action === 2 ? 'pos' : action === 0 ? 'neg' : '') + '">' + ['SELL', 'HOLD', 'BUY'][action] + '</b><br>conf ' + (Math.max(...probs) * 100).toFixed(0) + '%');
    const stepRew = i > 0 ? (ep.pv[i] - ep.pv[i - 1]) / ep.pv[i - 1] * 100 : 0;
    setHtml('#lv-rew', 'r<sub>t</sub> = <b class="' + (stepRew >= 0 ? 'pos' : 'neg') + '">' + (stepRew >= 0 ? '+' : '') + stepRew.toFixed(3) + '</b><br>ep total <b>' + fmtPct(ep.retPct) + '</b>');
    setHtml('#lv-upd', st.phase === 'update'
      ? '<b class="pos">updating policy…</b><br>clip ε=0.2 · 5 epochs'
      : 'next update in <b>' + (S.STEPS - 1 - st.step) + '</b> steps');
  }

  function paintDone(sym, stale) {
    const r = state.results[sym];
    if (!r) return;
    const st = { ep: S.EPISODES - 1, step: S.STEPS - 1, phase: 'done', updateT: 0 };
    requestAnimationFrame(() => {
      paintFrame(r.run, st);
      const csvEl = $('#csvName');
      if (csvEl) {
        csvEl.textContent = stale
          ? 'stale — config changed since this run'
          : 'backtest_' + sym + 'USDT_PPO.csv — replay complete · ' + S.EPISODES + ' episodes';
        csvEl.classList.toggle('stale', !!stale);
      }
      const f = $('#sFill'); if (f) f.style.width = '100%';
      showVerdict(sym, stale);
      refreshRunWrap();
    });
  }

  function paintIdle(sym) {
    lastFrame = null;
    hideVerdict();
    ['#cvPrice', '#cvReward', '#cvEquity'].forEach(s => {
      const c = $(s); if (c && c.getContext) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    });
    ['hsEp', 'hsPv', 'hsPnl', 'hsBest', 'hsPos', 'hsTr'].forEach(id => setHs(id, '—', ''));
    ['sell', 'hold', 'buy'].forEach(k => {
      const f = $('#pf-' + k); if (f) f.style.width = '0%';
      const p = $('#pp-' + k); if (p) p.textContent = '—';
    });
    ['see', 'act', 'rew', 'upd'].forEach(id => { const el = $('#lb-' + id); if (el) el.classList.remove('active'); });
    setText('#lcEp', '0');
    const stale = !!state.results[sym];
    const csvEl = $('#csvName');
    if (csvEl) {
      csvEl.textContent = stale ? 'stale — run backtest to refresh' : 'not backtested — run a backtest to begin';
      csvEl.classList.toggle('stale', stale);
    }
    const fill = $('#sFill'); if (fill) fill.style.width = '0%';
    setText('#sKb', '');
    const idleEl = $('#stageIdle');
    if (idleEl) {
      idleEl.style.display = 'flex';
      const sub = idleEl.querySelector('.idleSub');
      if (sub) sub.textContent = (stale ? 'Config changed — re-run the backtest for ' : 'Set your config, then run the backtest for ') + sym + 'USDT.';
      const btn = idleEl.querySelector('.runBig');
      if (btn) { btn.dataset.sym = sym; btn.textContent = stale ? '↻ Re-run backtest' : '▶ Run backtest'; }
    }
  }

  function repaintCharts() {
    if (!lastFrame) return;
    const cvP = $('#cvPrice'); if (!cvP) return;
    S.drawPrice(cvP, lastFrame.run, lastFrame.st, PAL);
    const cvR = $('#cvReward'); if (cvR) S.drawReward(cvR, lastFrame.run, lastFrame.st, PAL);
    const cvE = $('#cvEquity'); if (cvE) S.drawEquity(cvE, lastFrame.run, lastFrame.st, PAL);
  }
  let _rzT = null;
  function onViewportChange() { clearTimeout(_rzT); _rzT = setTimeout(repaintCharts, 90); }
  window.addEventListener('resize', onViewportChange);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);

  function showVerdict(sym, stale) {
    const r = state.results[sym];
    const el = $('#vCard');
    if (!r || !el) return;
    const v = r.verdict;
    const good = v.lastAvg > 0;
    el.className = 'vCard show' + (good ? '' : ' bad');
    el.innerHTML = '<div class="vGradeRow"><div class="vGrade">' + v.grade + '</div>' +
      '<div class="vTitle">' + (good ? 'Selected Agent Config' : 'Weak convergence — tune the config') +
      '<span class="vsym">' + sym + 'USDT · ' + S.EPISODES + ' training episodes</span></div></div>' +
      (stale ? '<div class="vStale">Config changed since this run — re-run to refresh.</div>' : '') +
      vRow('Avg return · last 10 ep', fmtPct(v.lastAvg), v.lastAvg >= 0) +
      vRow('First 5 ep (untrained)', fmtPct(v.firstAvg), v.firstAvg >= 0) +
      vRow('vs Buy &amp; Hold', fmtPct(v.vsBuyHold), v.vsBuyHold >= 0) +
      vRow('Win rate', v.winRate.toFixed(0) + '%', v.winRate >= 50) +
      vRow('Max drawdown', '−' + v.maxDD.toFixed(1) + '%', null) +
      vRow('Sharpe (est.)', v.sharpe.toFixed(2), v.sharpe >= 0) +
      '<button class="vRerun" data-act="rerun" data-sym="' + sym + '">↻ Re-run this backtest</button>';
  }
  function vRow(l, v, pos) {
    const c = pos === null ? 'var(--muted)' : pos ? 'var(--green)' : 'var(--red)';
    return '<div class="vRow"><span>' + l + '</span><b style="color:' + c + '">' + v + '</b></div>';
  }
  function hideVerdict() { const el = $('#vCard'); if (el) el.className = 'vCard'; }

  function setText(sel, t) { const el = $(sel); if (el) el.textContent = t; }
  function setHtml(sel, h) { const el = $(sel); if (el) el.innerHTML = h; }
  function setHs(id, t, cls) { const el = document.getElementById(id); if (el) { el.textContent = t; el.className = 'v ' + cls; } }
  function refreshRoster() {
    const rail = document.querySelector('.bench .rail');
    if (rail) rail.firstElementChild.outerHTML = rosterHtml();
  }
  function refreshBar() {
    const n = testedCount();
    setText('#barHint', n + '/' + state.roster.length + ' backtests up to date');
    const b = $('#btnFinalize'); if (b) b.disabled = n === 0;
  }
  function rerender(forceRun) {
    app.innerHTML = rootHtml();
    wireName(); wireChat();
    renderChat();
    startPreview(!!forceRun);
    refreshRunWrap();
  }
  function wireName() {
    const n = $('#inName');
    if (n) n.addEventListener('input', e => { state.name = e.target.value; });
  }
  function wireChat() {
    const inp = $('#chatIn');
    if (inp) inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { chatSend(inp.value); inp.value = ''; }
    });
  }

  function onCfgChanged() {
    hideVerdict();
    refreshRoster(); refreshBar(); refreshRunWrap();
    const sym = state.active;
    if (state.results[sym]) {
      const csvEl = $('#csvName');
      if (csvEl) { csvEl.textContent = 'stale — config changed since this run'; csvEl.classList.add('stale'); }
      showVerdict(sym, true);
    }
  }

  const tipPop = $('#tipPop');
  function showTip(el) {
    const key = el.dataset.tip;
    if (!TIPS[key]) return;
    tipPop.innerHTML = TIPS[key];
    tipPop.style.visibility = 'hidden';
    tipPop.style.display = 'block';
    const r = el.getBoundingClientRect();
    const w = tipPop.offsetWidth, h = tipPop.offsetHeight;
    let left = Math.min(Math.max(8, r.left - 10), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = r.top - h - 8;
    tipPop.style.left = left + 'px';
    tipPop.style.top = Math.max(8, top) + 'px';
    tipPop.style.visibility = 'visible';
  }
  function hideTip() { tipPop.style.display = 'none'; }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('.qTip');
    if (t) showTip(t);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('.qTip')) hideTip();
  });

  function suggestedSL() {
    let mx = 0;
    state.roster.forEach(s => { const r = state.results[s]; if (r) mx = Math.max(mx, r.verdict.maxDD); });
    return mx ? Math.min(60, Math.max(5, Math.round(mx * 1.6))) : null;
  }
  function finalizeHtml() {
    const c = state.cfg;
    const cfgRow = '<div class="rsRow cfgSum"><span class="ck">CONFIG</span>' +
      '<span>' + c.frequency + ' · ' + (parseInt(c.training) / 1000) + 'k · ' + c.reward + ' · ' + c.feats.filter(Boolean).length + '/12 indicators</span>' +
      '<span class="g" style="color:var(--dim)">uniform across assets</span></div>';
    const rows = state.roster.map(sym => {
      const r = state.results[sym];
      const fresh = isFresh(sym);
      return '<div class="rsRow">' + coinImg(sym, 20) + '<span>' + sym + 'USDT</span>' +
        '<span class="g" style="color:' + (fresh ? (r.verdict.lastAvg >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--orange)') + '">' +
        (fresh ? r.verdict.grade + ' · ' + fmtPct(r.verdict.lastAvg) : (r ? 'stale' : 'untested')) + '</span></div>';
    }).join('');
    const r = state.risk;
    const sl = suggestedSL();
    const rk = (key, title, valKey, onKey, max, extra) =>
      '<div class="rkRow"><div class="rkHead"><span class="t">' + title + '</span>' +
      '<span style="display:flex;align-items:center;gap:10px"><span class="v ' + (r[onKey] ? '' : 'off') + '" id="bv-' + key + '">' + r[valKey] + '%</span>' +
      '<button class="tglB ' + (r[onKey] ? 'on' : '') + '" data-act="btgl" data-k="' + onKey + '"></button></span></div>' +
      '<div class="rkCtl"><input type="range" min="1" max="' + max + '" value="' + r[valKey] + '" data-act="bslide" data-k="' + valKey + '" data-bv="bv-' + key + '"' + (r[onKey] ? '' : ' disabled') + '></div>' +
      (extra || '') + '</div>';
    return '<div class="sheet" data-screen-label="Finalize agent — risk">' +
      '<div class="finHead"><img class="finAva" src="' + avatarSrc(state.avatar) + '" alt="">' +
      '<div class="finHeadTxt"><h3>Finalize ' + state.name + '</h3>' +
      '<p class="sub">Set the <b>risk guardrails for the overall agent</b>. These apply across all ' + state.roster.length + ' asset' + (state.roster.length > 1 ? 's' : '') + ' when live.</p>' +
      '</div></div>' +
      '<div class="rosterSum">' + cfgRow + rows + '</div>' +
      rk('sl', 'Stop loss', 'sl', 'slOn', 100, sl ? '<span class="suggestB" data-act="bsl" data-v="' + sl + '">⚑ suggested from backtest drawdowns: ' + sl + '%</span>' : '') +
      rk('tp', 'Take profit', 'tp', 'tpOn', 100) +
      rk('maxT', 'Max trade per order', 'maxT', 'maxOn', 100) +
      rk('minT', 'Min trade per order', 'minT', 'minOn', 50) +
      '<div class="disc">Autonomous trading carries risk. Backtested performance does not guarantee live results — agents may incur losses.</div>' +
      '<label class="chk"><input type="checkbox" id="bChk" ' + (state.accepted ? 'checked' : '') + '> I understand the risks of autonomous trading.</label>' +
      '<div class="sheetBtns"><button class="ghost" data-act="close-fin">Keep tuning</button>' +
      '<button class="go" data-act="launch" id="bLaunch">Launch agent</button></div>' +
      '</div>';
  }

  const BOOT_LINES = [
    ['> packaging agent bundle…', 0],
    ['  ✓ NAME_CFGS — shared PPO policy config attached', 'ok'],
    ['  ✓ risk guardrails compiled (SL/TP/sizing)', 'ok'],
    ['> deploying to paper-trading runtime…', 0],
    ['  ✓ connected to live market feed', 'ok'],
    ['> status: WARMING UP', 'ac']
  ];
  function avaStack(seed, n) {
    let h = '<span class="avaStack">';
    for (let k = 0; k < n; k++) h += '<img src="' + avatarSrc(seed + k) + '" alt="">';
    return h + '</span>';
  }
  function warmHtml() {
    const comps = S.COMPETITIONS.map((c, i) => {
      const e = state.enrolled[c.id];
      return '<div class="compB"><div><div class="cn">' + c.name + '</div>' +
        '<div class="cm2"><span class="pz">$' + c.prize.toLocaleString() + ' prize</span>' + avaStack(i + 1, 4) + '<span>' + c.entrants + ' agents</span><span>' + c.starts + '</span><span>' + (c.fee ? c.fee + ' USDT fee' : 'free entry') + '</span></div></div>' +
        '<button data-act="enroll" data-v="' + c.id + '" class="' + (e ? 'entered' : '') + '">' + (e ? 'Entered ✓' : 'Enroll') + '</button></div>';
    }).join('');
    return '<div class="sheet warmB" data-screen-label="Warming up">' +
      '<button class="sheetClose" data-act="close-warm" aria-label="Close" title="Back to lab">✕</button>' +
      '<div class="bootLog" id="bootLog"></div>' +
      '<div id="warmBody" style="display:none">' +
      '<div class="warmRingB"><img src="' + avatarSrc(state.avatar) + '" alt=""></div>' +
      '<div class="warmPillB"><span class="d"></span>WARMING UP</div>' +
      '<h3>' + state.name + '</h3>' +
      '<p class="copy"><b>' + state.name + '</b> is live in the paper-trading runtime and warming up — <b>enroll it into the next competition to begin competing.</b></p>' +
      '<div style="text-align:left"><div class="miniLbl" style="margin-bottom:7px">Upcoming competitions</div>' + comps + '</div>' +
      '<div class="warmFootB"><button data-act="done-lab">View my agents →</button></div>' +
      '</div></div>';
  }
  function runBootLog() {
    const log = $('#bootLog');
    let i = 0;
    function next() {
      if (!log) return;
      if (i < BOOT_LINES.length) {
        const ln = BOOT_LINES[i];
        const div = document.createElement('div');
        if (ln[1]) div.className = ln[1];
        div.textContent = ln[0].replace('NAME_CFGS', state.roster.join('+'));
        log.appendChild(div);
        i++;
        setTimeout(next, i === BOOT_LINES.length ? 500 : 260 + Math.random() * 240);
      } else {
        const wb = $('#warmBody');
        if (wb) wb.style.display = 'block';
      }
    }
    next();
  }
  function wireFinChk() {
    const ck = $('#bChk'); if (ck) ck.addEventListener('change', ev => { state.accepted = ev.target.checked; });
  }

  document.addEventListener('click', e => {
    if (e.target.classList && e.target.classList.contains('ovl')) { e.target.classList.remove('show'); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'pick') {
      if (state.active === el.dataset.sym) return;
      state.active = el.dataset.sym;
      if (replay) { replay.destroy(); replay = null; }
      hideVerdict();
      rerender(false);
    }
    else if (act === 'rerun') {
      e.stopPropagation();
      const sym = el.dataset.sym || state.active;
      if (state.status[sym] === 'stream' || state.status[sym] === 'play') return;
      hideVerdict();
      if (sym !== state.active) { state.active = sym; rerender(true); }
      else startPreview(true);
    }
    else if (act === 'remove') {
      e.stopPropagation();
      const sym = el.dataset.sym;
      if (state.roster.length <= 1) { toast('Keep at least one asset'); return; }
      state.roster = state.roster.filter(s => s !== sym);
      delete state.results[sym];
      if (state.active === sym) state.active = state.roster[0];
      rerender(false);
    }
    else if (act === 'add-open') { state.addOpen = !state.addOpen; refreshRoster(); }
    else if (act === 'add') {
      if (state.roster.length >= 10) { toast('Max 10 assets'); return; }
      const sym = el.dataset.sym;
      state.roster.push(sym);
      state.status[sym] = 'idle';
      state.addOpen = false;
      state.active = sym;
      if (replay) { replay.destroy(); replay = null; }
      rerender(false);
    }
    else if (act === 'cfg') {
      state.cfg[el.dataset.f] = el.dataset.v;
      el.parentElement.querySelectorAll('.radio').forEach(r => r.classList.toggle('on', r === el));
      onCfgChanged();
    }
    else if (act === 'ft') {
      const c = state.cfg;
      const i = parseInt(el.dataset.i);
      const on = c.feats.filter(Boolean).length;
      if (c.feats[i] && on <= 4) { toast('Keep at least 4 indicators enabled'); return; }
      c.feats[i] = !c.feats[i];
      el.classList.toggle('on', c.feats[i]);
      el.classList.toggle('off', !c.feats[i]);
      setText('#ftCount', c.feats.filter(Boolean).length + '/12');
      onCfgChanged();
    }
    else if (act === 'spd') {
      if (replay) replay.setSpeed(parseInt(el.dataset.v));
      document.querySelectorAll('.spd').forEach(b => b.classList.toggle('on', b === el));
    }
    else if (act === 'skip') { if (replay) replay.skip(); }
    else if (act === 'chat-toggle') {
      if (e.target.closest('#chatScroll, .chatInRow')) return;
      state.chatOpen = !state.chatOpen;
      const d = $('#chatDock');
      d.classList.toggle('closed', !state.chatOpen);
      d.querySelector('.chatClps').textContent = state.chatOpen ? 'hide ▴' : 'show ▾';
      if (state.chatOpen) renderChat();
    }
    else if (act === 'chat-send') {
      const inp = $('#chatIn');
      if (inp) { chatSend(inp.value); inp.value = ''; }
    }
    else if (act === 'chat-chip') {
      chatSend(el.dataset.q, true);
    }
    else if (act === 'chat-apply') {
      let patch;
      try { patch = JSON.parse(el.dataset.v); } catch (err) { return; }
      Object.assign(state.cfg, patch);
      pushBot('Done — config updated. Re-running the ' + state.active + ' backtest now; hit ↻ on the other assets when you are ready.');
      toast('Setup applied — re-running ' + state.active + ' backtest');
      rerender(true);
    }
    else if (act === 'avatar') {
      state.avatar = (state.avatar + 1) % AGENT_AVATARS.length;
      document.querySelectorAll('.agentAva img').forEach(im => { im.src = avatarSrc(state.avatar); });
      toast('Agent look updated');
    }
    else if (act === 'theme') {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
      const tb = document.querySelector('.themeBtn'); if (tb) tb.textContent = state.theme === 'light' ? '☾' : '☀';
      repaintCharts();
      toast(state.theme === 'light' ? 'Light mode' : 'Dark mode');
    }
    else if (act === 'finalize') {
      const ov = $('#ovlFinalize');
      ov.innerHTML = finalizeHtml();
      ov.classList.add('show');
      wireFinChk();
    }
    else if (act === 'close-fin') { $('#ovlFinalize').classList.remove('show'); }
    else if (act === 'btgl') {
      const k = el.dataset.k;
      state.risk[k] = !state.risk[k];
      $('#ovlFinalize').innerHTML = finalizeHtml();
      wireFinChk();
    }
    else if (act === 'bsl') {
      state.risk.sl = parseInt(el.dataset.v); state.risk.slOn = true;
      $('#ovlFinalize').innerHTML = finalizeHtml();
      wireFinChk();
      toast('Stop loss set from backtest drawdowns');
    }
    else if (act === 'launch') {
      if (!state.accepted) { toast('Accept the risk disclosure first'); return; }
      const b = $('#bLaunch'); b.disabled = true; b.textContent = 'Launching…';
      if (replay) { replay.pause(); }
      setTimeout(() => {
        $('#ovlFinalize').classList.remove('show');
        const ov = $('#ovlWarm');
        ov.innerHTML = warmHtml();
        ov.classList.add('show');
        state.launched = true;
        runBootLog();
      }, 700);
    }
    else if (act === 'enroll') {
      state.enrolled[el.dataset.v] = true;
      el.classList.add('entered');
      el.textContent = 'Entered ✓';
      toast('Enrolled — your agent starts competing when the round begins');
    }
    else if (act === 'close-warm') { $('#ovlWarm').classList.remove('show'); }
    else if (act === 'done-lab') { $('#ovlWarm').classList.remove('show'); toast('(prototype) — returning to the lab'); }
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && el.dataset.act === 'bslide') {
      state.risk[el.dataset.k] = parseInt(el.value);
      const bv = document.getElementById(el.dataset.bv);
      if (bv) bv.textContent = el.value + '%';
    }
  });

  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('roostoo-lab-theme') || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(savedTheme);
  state.chat.push({
    role: 'bot',
    html: 'Hi, I\'m Coach Roostoo. Tune your agent on the left and watch the backtest replay in the middle — ask me about any indicator, the reward function, training steps, or how to think about strategy. I\'ll explain it plainly and tie it to what you\'ve set up.'
  });
  rerender(false);
})();
