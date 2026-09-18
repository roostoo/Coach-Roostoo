---
id: family-flow
title: Flow family (signal family + its strategy variants)
tags: flow, funding, liquidation, cascade, panic, open interest, squeeze, plumbing, order flow, carry, flw
---
The Flow family trades the market's "plumbing" — funding-rate swings and the
order-flow footprints of a crowd getting offside. Every Flow variant reads the
funding rate directly; the rest of the view differs per variant.

Its five strategy variants:
- **Funding Lean** — Funding + VWAP + ATR: leans against stretched funding,
  with VWAP to judge how far price has run.
- **Carry + Trend** — Funding + EMA-X + ADX: harvests the funding lean only
  when the trend agrees.
- **Squeeze Watch** — Funding + Donchian + ATR: watches for range breaks
  powered by crowded positioning.
- **Flow + Volume** — Funding + OBV + VWAP: pairs funding with real volume
  flow.
- **Full Flow** — Funding + RSI + MACD + OBV: the widest flow view, four
  indicators.

A typical setup: a fast 5-minute decision clock (flow flips quickly) and a
Calmar reward (return relative to worst drawdown — tail-aware, which suits
spiky events). It always sees the 7 base features on top of the variant's
indicators.

Honest trade-off: the events it lives for are rare, so it can sit quiet for a
while and its live track record matters more than any single backtest. It works
both directions — buying panics and crowded resets, and shorting blow-off tops
and crowded longs.
