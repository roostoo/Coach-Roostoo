---
id: family-breakout
title: Breakout family (signal family + its strategy variants)
tags: breakout, squeeze, volatility expansion, range, compression, consolidation, explosive, donchian, brk
---
The Breakout family waits for a quiet, compressed range and then jumps on the
expansion when price finally breaks out. Real breakouts are rare, so it trades
seldom and accepts small losses on false starts to catch the occasional big
move.

Its five strategy variants each fix a different indicator view (all are built
around the Donchian channel or the Bollinger squeeze — the canonical range
signals):
- **Channel Break** — Donchian + ATR + OBV: the classic new-high break with
  volume context.
- **Squeeze Pop** — Bollinger + ATR + Donchian: waits for the bands to pinch,
  then plays the pop.
- **Break + Volume Flow** — Donchian + OBV + VWAP: demands real volume flow
  behind the break.
- **Funding-Fueled Break** — Donchian + Funding + ATR: breaks powered by a
  crowded funding reset.
- **Trend-Gated Break** — Donchian + ADX + EMA-X: only takes breaks in the
  direction of an established trend.

A typical setup: a 15-minute decision clock and a Sortino reward (it wants the
skewed, catch-the-big-move payoff). It always sees the 7 base features on top
of the variant's indicators.

Honest trade-off: in a market that just chops sideways it will keep getting
faked out on small losses while it waits — the wins come from the few moves
that actually run. It plays breakouts either way — long on upside breaks, short
on breakdowns.
