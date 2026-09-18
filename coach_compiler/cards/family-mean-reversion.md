---
id: family-mean-reversion
title: Mean Reversion family (signal family + its strategy variants)
tags: mean reversion, dip, buy the dip, rsi, bollinger, stochrsi, vwap, fade, overreaction, pullback, snap back, mrv
---
The Mean Reversion family fades stretched moves — it bets that a sharp move
overshoots and price snaps back toward its recent average. Lots of small wins,
with the risk that a "dip" is actually the start of a real downtrend.

Its five strategy variants each fix a different indicator view:
- **Band Fade** — Bollinger + RSI + ATR: the classic stretched-too-far view.
- **VWAP Fade** — VWAP + StochRSI + ATR: fades moves that stray far from the
  session's average traded price.
- **Double Oscillator** — RSI + StochRSI + Bollinger: two oscillators must
  both scream "overdone".
- **Volume Divergence** — Bollinger + OBV + ATR: looks for moves that volume
  doesn't confirm.
- **Crowded Fade** — Bollinger + RSI + Funding: adds funding to fade moves the
  crowd has piled into.

A typical setup: a faster 5-minute decision clock (to catch quick pullbacks)
and a Volatility-Penalty or Calmar reward (keeps it calm and drawdown-averse —
the "never blow up" part). It always sees the 7 base features on top of the
variant's indicators.

Honest trade-off: by design it struggles in strong one-way trends — it fades
stretched moves in both directions (buying oversold drops, shorting overbought
rallies), so a trend that just keeps running will stop it out.
