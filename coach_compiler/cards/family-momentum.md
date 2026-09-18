---
id: family-momentum
title: Momentum family (signal family + its strategy variants)
tags: momentum, trend, ride, big moves, ema, macd, adx, donchian, directional, trend follow, mom
---
The Momentum family rides sustained directional moves and sits out the chop —
small losses when the market is range-bound, bigger wins when a move runs.

Its five strategy variants each fix a different indicator view (the variant
sets what the agent sees; indicators are never picked one by one):
- **Classic Cross** — EMA-X + MACD + ATR: the standard trend view.
- **Strength-Filtered** — EMA-X + ADX + ATR: ADX gauges trend strength, so it
  can sit out weak, choppy stretches.
- **Channel Rider** — EMA-X + Donchian + ADX: rides moves that push along the
  channel edge.
- **Volume-Confirmed** — MACD + OBV + VWAP: demands volume behind the move.
- **Momentum + Funding** — EMA-X + MACD + Funding: adds the funding rate to
  spot crowded trends.

A typical momentum setup: a calmer 15-minute decision clock (so it isn't
whipsawed by every wiggle) and a Sortino reward (rewards upside, punishes
downside swings). On top of the variant's indicators it always sees the 7
base features (log-return, volume ratio, hour, weekday, cash ratio, position
ratio, unrealized PnL).

Honest trade-off: momentum agents underperform in flat, choppy markets — they
need a real move to work. It rides trends either way — long into up-moves,
short into down-moves — and sits flat when there's no clear trend.
