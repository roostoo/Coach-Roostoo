"""
Gene card — a plain, reviewable summary of a validated v1 config.

Only real v1 parameters appear: coins, signal family, strategy variant (which
fixes the indicator subset the agent sees), decision frequency, reward, and
training length. Each user/coach value carries one short plain-language
reason; a small "fixed by the platform" section lists the things the user
can't change (PPO, lookback, the always-on base features, long/short direction).
No internal reward-shaping math, no bps, no jargon.
"""

from . import schema as S
from .breakeven import estimate_for_config

_FREQ_LABEL = {"1m": "every minute", "5m": "every 5 minutes", "15m": "every 15 minutes"}


def _row(path, label, value, tier, rationale=None, locked_reason=None):
    return {"path": path, "label": label, "value": value, "tier": tier,
            "rationale": rationale, "locked_reason": locked_reason,
            "editable": tier != S.PLATFORM}


def build_gene_card(config, rationale, classification, warnings=None):
    rationale = rationale or {}
    family = config.get("signal_family") or (classification or {}).get("signal_family")
    variant = config.get("variant") or (classification or {}).get("variant")
    blurb = S.FAMILY_BLURB.get(family, "a trading agent")
    v = S.VARIANTS.get(variant) or {}
    v_title = v.get("title", variant or "?")
    v_inds = list(v.get("indicators") or ())

    def r(k):
        return rationale.get(k)

    def pct(v):
        return "%g%%" % (round(v * 100, 2))

    choices = [
        _row("assets", "Coins", ", ".join(config["assets"]), S.USER, r("assets")),
        _row("signal_family", "Signal family",
             S.FAMILY_LABEL.get(family, family or "?"), S.COACH, r("signal_family")),
        _row("variant", "Strategy variant",
             "%s (%s)" % (v_title, " + ".join(v_inds)) if v_inds else v_title,
             S.COACH, r("variant")),
        _row("indicators", "What it sees",
             "%d of %d selectable indicators, set by the variant"
             % (len(v_inds), len(S.SELECTABLE_INDICATORS)),
             S.COACH,
             r("indicators") or ("The %s variant watches %s — plus the always-on "
                                 "base features." % (v_title, ", ".join(v_inds)))),
        _row("candle_interval", "Trades", _FREQ_LABEL.get(config["candle_interval"],
             config["candle_interval"]), S.COACH, r("candle_interval")),
        _row("reward", "Optimizes for", S.REWARD_LABEL.get(config["reward"], config["reward"]),
             S.COACH, r("reward")),
        _row("training_steps", "Training length", "%dk steps" % (config["training_steps"] // 1000),
             S.COACH, r("training_steps")),
        _row("stop_loss", "Stop-loss", pct(config["stop_loss"]), S.USER, r("stop_loss")),
        _row("take_profit", "Take-profit", pct(config["take_profit"]), S.USER,
             r("take_profit")),
        _row("max_trade", "Max per trade", pct(config["max_trade"]) + " of capital",
             S.USER, r("max_trade")),
        _row("min_trade", "Min per trade", pct(config["min_trade"]) + " of capital",
             S.USER, r("min_trade")),
    ]

    fixed = [
        _row("policy", "Model", "PPO (reinforcement learning)", S.PLATFORM,
             locked_reason="Every Roostoo agent is a PPO policy — not a fixed rule, not an LLM."),
        _row("direction", "Direction", "long & short", S.PLATFORM,
             locked_reason="Every market is a perpetual, so the policy can go long or short; direction is not a user setting."),
        _row("base_features", "Always-on features", ", ".join(S.ALWAYS_ON_FEATURES), S.PLATFORM,
             locked_reason="These %d base features are part of every agent's view, "
                           "on top of the variant's indicators." % len(S.ALWAYS_ON_FEATURES)),
        _row("lookback", "Memory", "%d candles" % S.LOOKBACK, S.PLATFORM,
             locked_reason="It reads the last %d candles each decision." % S.LOOKBACK),
        _row("training_data", "Trained on", "full available history", S.PLATFORM,
             locked_reason="Trained on all available history for each coin."),
    ]

    # Deterministic fee-hurdle (breakeven-alpha) preview — the paper's single
    # best fee-education moment, computed in Python (never LLM math) so the
    # number on the card is exact and gate-consistent. Both frontends already
    # carry the styling for `archetype`, `fee_drag` and the `breakeven` band.
    be = estimate_for_config(config, family)
    warnings = list(warnings or [])
    if be.get("warning"):
        warnings.append(be["warning"])

    return {
        "name": config.get("name"),
        "blurb": blurb,
        "classification": classification,
        # User-safe personality word + fee-drag tier for the card header.
        # (`archetype` kept as the key name for frontend back-compat.)
        "archetype": be.get("family_label", "trading"),
        "signal_family": family,
        "variant": variant,
        "variant_title": v_title,
        "indicators": v_inds,
        "fee_drag": be.get("fee_drag", "Low"),
        "breakeven": be,
        "sections": [
            {"block": "Your choices", "rows": choices},
            {"block": "Fixed by the platform", "rows": fixed},
        ],
        "warnings": warnings,
        "config": config,
    }


def render_text(card):
    """Terminal rendering for the CLI demo / eyeball tests."""
    lines = ["=" * 64,
             "GENE CARD  ·  %s" % card["name"],
             card["blurb"],
             "personality: %s   ·   fee drag: %s"
             % (card.get("archetype", "trading"), card.get("fee_drag", "Low")),
             "=" * 64]
    for sec in card["sections"]:
        lines.append("")
        lines.append("[%s]" % sec["block"])
        for row in sec["rows"]:
            tier = {"user": "you  ", "coach": "coach", "platform": "fixed"}[row["tier"]]
            lines.append("  (%s) %-16s %s" % (tier, row["label"] + ":", row["value"]))
            why = row.get("rationale") or row.get("locked_reason")
            if why:
                lines.append("          -> %s" % why)
    be = card.get("breakeven")
    if be:
        lines.append("")
        lines.append("[Breakeven preview]")
        lines.append("  %s" % be.get("explanation", ""))
    for w in card.get("warnings", []):
        lines.append("  ! %s: %s" % (w.get("path"), w.get("message")))
    return "\n".join(lines)
