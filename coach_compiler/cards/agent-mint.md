---
id: agent-mint
title: Mint an agent — the four-step Factory (asset model, features, timing and reward, backtest)
tags: mint, create agent, build agent, factory, asset model, markets, signal family, variant, indicators, decision frequency, training length, reward, backtest, launch, how to make an agent, four steps
---
The Factory mints a reinforcement-learning agent in four steps, with no code. Every
agent is a quantitative RL model: a neural-network policy trained with PPO on
cleansed, normalised market data and backtested before it sees a competition. It
sizes positions continuously, goes long or short, and decides deterministically in
milliseconds with no inference bill. You choose what it looks at, how fast it acts
and what it optimises.

The four steps: 1) Asset model — which markets it trades; 2) Features — which signal
family and variant it learns from; 3) Timing and reward — how often it decides, how
long it trains, what it optimises; 4) Backtest and launch — read the results on
held-out data, then launch.

**1. Asset model.** Pick one or more markets from Roostoo's full universe — 67
crypto perps (BTC, ETH, SOL, XRP, BNB and more) and 21 bStocks (tokenized-stock
perps such as NVDAB, TSLAB, METAB), all USD-quoted and tradable long or short. One
market makes a specialist (cleaner signal, faster training, concentrated risk);
several markets make a generalist (more diversification, a wider task for the
policy to learn). See Tradable instruments for the full list. Commodities such as
gold and silver, and FX pairs, are on the roadmap — not available yet.

**2. Features: signal family and variant.** This is the agent's eyes. A signal
family decides which market behaviour the agent learns to exploit. Each family has
five variants, and a variant is a blend of three or four indicators from the
family's palette. After the reward, nothing shapes behaviour more.

| Family | What it bets on | Where it shines | Where it bleeds |
|---|---|---|---|
| Momentum | Trends persist | Sustained moves, clean trends | Choppy ranges, whipsaws |
| Mean Reversion | Stretched prices snap back | Ranges, quiet volatility | Real breakouts, regime shifts |
| Breakout | Compression resolves into expansion | Volatility expansion, news | False breaks in dead markets |
| Flow | Crowded positioning unwinds | Perps with active funding, squeezes | Calm tape with flat funding |
| All indicators | A blend of everything | Regime-agnostic exploration | Slower to train, noisier |

The indicator palette, by what each reads: Trend — EMA cross, MACD, ADX; Momentum —
RSI, Stochastic RSI; Volatility and range — ATR, Bollinger Bands, Donchian channels;
Volume and flow — VWAP, OBV, funding rate.

What this means: two agents that differ only by family behave like different traders
— same assets, same reward, opposite instincts in the same hour. Match the family to
the regime you expect, or hedge by minting one agent per family and entering them all
(entries are per agent, so this is a strategy, not a workaround). Fewer indicators
mean a cleaner signal: lean variants train faster and are easier to read in the
decision log; broader variants see more and hesitate more.

**3. Timing and reward.**

| Setting | Options | Trade-off |
|---|---|---|
| Decision frequency | 1m, 5m, 15m | Faster means more trades, more fees and more noise; slower means fewer, cleaner decisions |
| Training length | Short, Standard, Long | Longer converges better and takes longer |
| Reward | Sharpe, Sortino, Calmar, Entropy, Volatility Penalty | The objective the policy optimises |

Sharpe is the balanced default. See Reward function design for the rest.

**4. Backtest and launch.** Roostoo trains the policy, runs it on held-out historical
data and shows the equity curve, return, drawdown and win rate per market. Change the
configuration and the results go stale until you re-run. Launch when it looks right.
A backtest is the agent's first exam, not its record — Paper Mode is the live forward
test that counts.
