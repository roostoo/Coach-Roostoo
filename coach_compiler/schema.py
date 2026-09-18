"""
The v1 parameter registry — the ONLY parameters the platform actually exposes.

Coach compiles user intent into a config over exactly these fields; nothing
else. The registry mirrors the Roostoo Mint Agent wizard exactly:

v1 registry (authoritative, = the Mint Agent wizard):
  User-selectable : assets (1-12 of 12), signal_family {MOM,MRV,BRK,FLW,ALL},
                    variant (one of the family's strategy variants — the
                    variant fixes WHICH selectable indicators the agent sees),
                    candle_interval {1m,5m,15m},
                    training_steps {250k,300k,350k},
                    reward {sharpe,sortino,calmar,entropy,volatility_penalty}
  Fixed (platform): PPO policy, continuous action space, 50-candle lookback,
                    full historical training data, the 7 always-on base
                    features (log-return, volume ratio, hour, weekday, cash
                    ratio, position ratio, unrealized PnL)
Direction: the policy trades both long and short — every market is a perpetual.

Risk management (stop_loss, take_profit, max_trade, min_trade) is a DETERMINISTIC
SAFETY LAYER above the learned policy, not part of the reward. It bounds the
agent at execution time regardless of what the policy decided — which matters for
out-of-distribution market states and for staying inside the -5% hard-demotion
threshold in the tier system. See https://roostoo.com/docs risk-management.
"""

# ── Governance tiers (for the gene card badges) ─────────────────────────────
USER = "user"          # a choice the user owns
COACH = "coach"        # inferred from intent, user can change
PLATFORM = "platform"  # fixed by the platform, not tunable

# ── Fixed architecture (registry: Fixed / not user-selectable) ──────────────
POLICY = "PPO"
ACTION_SPACE = "continuous target position"
LOOKBACK = 50                      # candles in the observation
TRAINING_DATA = "full available history per coin"
LONG_ONLY = False                  # every market is a perpetual now — agents can go long or short

# The 7 base features every agent always sees, on top of its variant's
# indicator subset. Not toggleable.
ALWAYS_ON_FEATURES = ("Log-return", "Volume ratio", "Hour", "Weekday",
                      "Cash ratio", "Position ratio", "Unrealized PnL")

# The 11 selectable indicators. An agent never picks these one by one — its
# strategy VARIANT fixes the active subset (family ALL = all 11).
SELECTABLE_INDICATORS = ("RSI", "MACD", "StochRSI", "EMA-X", "VWAP", "OBV",
                         "Bollinger", "ATR", "ADX", "Donchian", "Funding")

# ── Universe (registry: 1-12 of these) ──────────────────────────────────────
SUPPORTED_ASSETS = (
    "BTC", "ETH", "XRP", "BNB", "SOL", "DOGE", "LINK", "TRX", "LTC", "SUI",
    "ZEC", "XAUT",
)
QUOTE = "USDT"
MIN_ASSETS = 1
MAX_ASSETS = 12
# Fan-out cap: at most this many agents compiled from ONE strategy in a single
# request (e.g. "run an agent per coin"). Keeps a single ask from spawning a
# training job for every market at once.
MAX_AGENTS_PER_BATCH = 6

# Assignment order (majors first) for when a user asks for a COUNT of agents/coins
# but defers WHICH coins ("your pick", "you choose"). Coach assigns from this
# order so each agent gets a distinct, liquid set — choosing an agent's coins is a
# configuration act, NOT investment advice. Must be a permutation of
# SUPPORTED_ASSETS (asserted in tests).
RECOMMENDED_ORDER = (
    "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "LINK", "LTC", "TRX", "SUI",
    "ZEC", "XAUT",
)

# ── User-selectable knobs (discrete sets) ───────────────────────────────────
TRAINING_STEPS = (250000, 300000, 350000)
REWARDS = ("sharpe", "sortino", "calmar", "entropy", "volatility_penalty")
REWARD_LABEL = {
    "sharpe": "Sharpe Ratio", "sortino": "Sortino Ratio",
    "calmar": "Calmar Ratio", "entropy": "Entropy",
    "volatility_penalty": "Volatility Penalty",
}
CANDLE_INTERVALS = ("1m", "5m", "15m")

# ── Risk management (continuous percentages, per the docs' registry) ─────────
# All four are 1%-100%. stop_loss / take_profit are percentages of the
# competition portfolio's value at which it is auto-liquidated / auto-taken to
# profit; max_trade / min_trade bound a single order as a % of agent capital.
PCT_BOUNDS = (0.01, 1.00)
RISK_FIELDS = ("stop_loss", "take_profit", "max_trade", "min_trade")

# ── Signal families & strategy variants ─────────────────────────────────────
# A config stores BOTH: the family (the strategy personality) and the variant
# (which indicator subset the agent trains on). This mirrors the Mint Agent
# wizard exactly: family -> variant -> the observation set is fixed by the
# variant, never hand-picked indicator by indicator.
SIGNAL_FAMILIES = ("MOM", "MRV", "BRK", "FLW", "ALL")

FAMILY_LABEL = {
    "MOM": "Momentum",
    "MRV": "Mean Reversion",
    "BRK": "Breakout",
    "FLW": "Flow",
    "ALL": "All Indicators",
}

# Plain-language personality line shown in prose (never the raw code).
FAMILY_BLURB = {
    "MOM": "a momentum agent that rides sustained price trends",
    "MRV": "a mean-reversion agent that fades stretched moves back to the mean",
    "BRK": "a breakout agent that enters on range breakouts and expansions",
    "FLW": "a flow agent that trades funding and order-flow signals",
    "ALL": "an agent that blends every signal family, reading all 11 indicators",
}

# variant code -> {family, title, indicators}. The indicator tuples are the
# EXACT observation subsets the wizard shows; family ALL has the one variant
# that reads all 11 selectable indicators.
VARIANTS = {
    "MOM1": {"family": "MOM", "title": "Classic Cross",
             "indicators": ("EMA-X", "MACD", "ATR")},
    "MOM2": {"family": "MOM", "title": "Strength-Filtered",
             "indicators": ("EMA-X", "ADX", "ATR")},
    "MOM3": {"family": "MOM", "title": "Channel Rider",
             "indicators": ("EMA-X", "Donchian", "ADX")},
    "MOM4": {"family": "MOM", "title": "Volume-Confirmed",
             "indicators": ("MACD", "OBV", "VWAP")},
    "MOM5": {"family": "MOM", "title": "Momentum + Funding",
             "indicators": ("EMA-X", "MACD", "Funding")},

    "MRV1": {"family": "MRV", "title": "Band Fade",
             "indicators": ("Bollinger", "RSI", "ATR")},
    "MRV2": {"family": "MRV", "title": "VWAP Fade",
             "indicators": ("VWAP", "StochRSI", "ATR")},
    "MRV3": {"family": "MRV", "title": "Double Oscillator",
             "indicators": ("RSI", "StochRSI", "Bollinger")},
    "MRV4": {"family": "MRV", "title": "Volume Divergence",
             "indicators": ("Bollinger", "OBV", "ATR")},
    "MRV5": {"family": "MRV", "title": "Crowded Fade",
             "indicators": ("Bollinger", "RSI", "Funding")},

    "BRK1": {"family": "BRK", "title": "Channel Break",
             "indicators": ("Donchian", "ATR", "OBV")},
    "BRK2": {"family": "BRK", "title": "Squeeze Pop",
             "indicators": ("Bollinger", "ATR", "Donchian")},
    "BRK3": {"family": "BRK", "title": "Break + Volume Flow",
             "indicators": ("Donchian", "OBV", "VWAP")},
    "BRK4": {"family": "BRK", "title": "Funding-Fueled Break",
             "indicators": ("Donchian", "Funding", "ATR")},
    "BRK5": {"family": "BRK", "title": "Trend-Gated Break",
             "indicators": ("Donchian", "ADX", "EMA-X")},

    "FLW1": {"family": "FLW", "title": "Funding Lean",
             "indicators": ("Funding", "VWAP", "ATR")},
    "FLW2": {"family": "FLW", "title": "Carry + Trend",
             "indicators": ("Funding", "EMA-X", "ADX")},
    "FLW3": {"family": "FLW", "title": "Squeeze Watch",
             "indicators": ("Funding", "Donchian", "ATR")},
    "FLW4": {"family": "FLW", "title": "Flow + Volume",
             "indicators": ("Funding", "OBV", "VWAP")},
    "FLW5": {"family": "FLW", "title": "Full Flow",
             "indicators": ("Funding", "RSI", "MACD", "OBV")},

    "ALL":  {"family": "ALL", "title": "All Features",
             "indicators": SELECTABLE_INDICATORS},
}

# family -> its variant codes, in wizard display order.
FAMILY_VARIANTS = {
    fam: tuple(code for code in
               ("%s%d" % (fam, i) for i in range(1, 6))
               if code in VARIANTS) or (("ALL",) if fam == "ALL" else ())
    for fam in SIGNAL_FAMILIES
}


def variant_indicators(code):
    """The exact indicator subset a variant trains on."""
    v = VARIANTS.get(code)
    return tuple(v["indicators"]) if v else ()


# Per-family v1 DEFAULTS (all within the registry sets above). These are
# starting points Coach adjusts from the user's words; every one is a real v1
# knob. The default variant is each family's first wizard entry.
# Risk defaults follow the docs' "conservative for first-time users" guidance and
# its practical heuristics: stop-loss 5-10% general exposure (tighter for
# Elite-bound agents under the 8% drawdown threshold), take-profit often left
# wide (20%+) so a run can extend, max trade 10-25% of capital, min trade not so
# low that a fill can't move the needle.
FAMILY_DEFAULTS = {
    "MOM": {
        "variant": "MOM1",                 # Classic Cross
        "candle_interval": "15m",          # calmer clock -> fewer whipsaws
        "reward": "sortino",               # rewards upside, punishes downside vol
        "training_steps": 350000,
        "stop_loss": 0.10, "take_profit": 0.25,
        "max_trade": 0.25, "min_trade": 0.05,
    },
    "MRV": {
        "variant": "MRV1",                 # Band Fade
        "candle_interval": "5m",
        "reward": "volatility_penalty",    # keeps it calm; averse to big swings
        "training_steps": 300000,
        "stop_loss": 0.05, "take_profit": 0.10,
        "max_trade": 0.15, "min_trade": 0.02,
    },
    "BRK": {
        "variant": "BRK1",                 # Channel Break
        "candle_interval": "15m",
        "reward": "sortino",
        "training_steps": 350000,
        "stop_loss": 0.08, "take_profit": 0.30,
        "max_trade": 0.25, "min_trade": 0.05,
    },
    "FLW": {
        "variant": "FLW1",                 # Funding Lean
        "candle_interval": "5m",
        "reward": "calmar",                # return over worst drawdown; tail-aware
        "training_steps": 350000,
        "stop_loss": 0.05, "take_profit": 0.15,
        "max_trade": 0.20, "min_trade": 0.05,
    },
    "ALL": {
        "variant": "ALL",
        "candle_interval": "5m",
        "reward": "sharpe",
        "training_steps": 300000,
        "stop_loss": 0.08, "take_profit": 0.20,
        "max_trade": 0.20, "min_trade": 0.05,
    },
}


def default_config_for(family, assets=None, name=None):
    """A schema-valid v1 config built purely from a family's defaults."""
    if family not in FAMILY_DEFAULTS:
        raise ValueError("unknown signal family: %r" % (family,))
    d = FAMILY_DEFAULTS[family]
    return {
        "name": name or (FAMILY_LABEL[family].lower().replace(" ", "-") + "-agent"),
        "assets": list(assets or ["BTC" + QUOTE]),
        "signal_family": family,
        "variant": d["variant"],
        "candle_interval": d["candle_interval"],
        "reward": d["reward"],
        "training_steps": d["training_steps"],
        "stop_loss": d["stop_loss"],
        "take_profit": d["take_profit"],
        "max_trade": d["max_trade"],
        "min_trade": d["min_trade"],
    }


# ── Fan-out: one strategy -> many agents (different coins) ──────────────────

def _asset_suffix(assets):
    """A short, human tag for a coin set, used to auto-name fan-out agents."""
    coins = [a[:-len(QUOTE)] if a.endswith(QUOTE) else a for a in (assets or [])]
    if not coins:
        return ""
    if len(coins) <= 2:
        return "+".join(coins)
    return "+".join(coins[:2]) + "+%d" % (len(coins) - 2)   # e.g. BTC+ETH+1


def expand_configs(base, agents=None):
    """Fan a single base config out into one config per per-agent patch.

    Each entry in `agents` is a partial patch: it inherits every field from
    `base` and overrides only the keys it sets (typically `assets`). With no
    patches this returns ``[base]`` unchanged — so the single-agent path is
    untouched. When a patch doesn't name itself, the agent is auto-named by its
    coin(s), and names are de-duplicated so the roster never shows two
    identical labels.

    This is the deterministic half of the fan-out: the model authors ONE
    strategy plus the per-agent differences; Python does the cloning, so "same
    strategy across coins" is guaranteed by code, not hoped for from the model.
    """
    base = dict(base or {})
    if not agents:
        return [base]
    out, used = [], set()
    stem = base.get("name") or "agent"
    for i, v in enumerate(agents):
        merged = dict(base)
        merged.update({k: val for k, val in (v or {}).items() if val is not None})
        if not (v or {}).get("name"):
            suffix = _asset_suffix(merged.get("assets")) or str(i + 1)
            merged["name"] = ("%s-%s" % (stem, suffix))[:40]
        base_name, n, name = merged["name"], 2, merged["name"]
        while name in used:
            name = "%s-%d" % (base_name[:37], n)
            n += 1
        merged["name"] = name
        used.add(name)
        out.append(merged)
    return out


# ── emit_config tool: exactly the v1 user-selectable knobs ──────────────────

def _variant_menu():
    """One compact line per family listing its variants + indicator subsets —
    reused by the tool schema and the prompt so they can never drift apart."""
    lines = []
    for fam in SIGNAL_FAMILIES:
        entries = ["%s %s (%s)" % (code, VARIANTS[code]["title"],
                                   " + ".join(VARIANTS[code]["indicators"]))
                   for code in FAMILY_VARIANTS[fam]]
        lines.append("%s (%s): %s" % (fam, FAMILY_LABEL[fam], "; ".join(entries)))
    return lines


def _config_field_properties():
    """The v1 config field schemas — shared by emit_config's `config` object AND
    each per-agent `agents` patch, so the two can never drift apart.

    Deliberately NO value constraints (`enum`, `minimum`/`maximum`,
    `minItems`/`maxItems`, `maxLength`): value sets and ranges are stated in each
    field's `description` and enforced by the deterministic validator
    (validator.validate_config), NOT pinned in the JSON schema. A strict provider
    (e.g. Groq) hard-rejects an out-of-set tool call with an opaque 400 that
    bypasses our repair loop — so one bad coin would sink an entire multi-agent
    request. Keeping only TYPES here lets every bad pick reach the validator,
    which turns it into a clean error the model can repair from. The prompt's
    OPERATING ENVELOPE lists the same allowed values, so the model stays steered."""
    coins = ", ".join(a + QUOTE for a in SUPPORTED_ASSETS)
    return {
        "name": {"type": "string",
                 "description": "1-40 chars: letters, digits, spaces, - _"},
        "assets": {
            "type": "array",
            "items": {"type": "string"},
            "description": ("%d-%d coins, each EXACTLY one of: %s"
                            % (MIN_ASSETS, MAX_ASSETS, coins)),
        },
        "signal_family": {
            "type": "string",
            "description": "one of: " + ", ".join(
                "%s (%s)" % (f, FAMILY_LABEL[f]) for f in SIGNAL_FAMILIES),
        },
        "variant": {
            "type": "string",
            "description": ("a variant code belonging to signal_family — it fixes "
                            "which indicators the agent sees. "
                            + " | ".join(_variant_menu())),
        },
        "candle_interval": {"type": "string",
                            "description": "one of: " + ", ".join(CANDLE_INTERVALS)},
        "reward": {"type": "string",
                   "description": "one of: " + ", ".join(REWARDS)},
        "training_steps": {"type": "integer",
                           "description": "one of: "
                           + ", ".join(str(s) for s in TRAINING_STEPS)},
        "stop_loss": {"type": "number",
                      "description": ("auto-liquidate below this % of portfolio "
                                      "value; fraction 0.01-1.00")},
        "take_profit": {"type": "number",
                        "description": ("auto-take-profit above this % of "
                                        "portfolio value; fraction 0.01-1.00")},
        "max_trade": {"type": "number",
                      "description": "max fraction of capital per order, 0.01-1.00"},
        "min_trade": {"type": "number",
                      "description": ("min fraction of capital per order, 0.01-1.00; "
                                      "must be <= max_trade")},
    }


def build_emit_config_tool():
    return {
        "type": "function",
        "function": {
            "name": "emit_config",
            "description": (
                "Submit a v1 agent configuration for validation. Call this only "
                "after the intent is classified and the elicitation slots "
                "(family, tempo, assets) are answered or defaulted. Use ONLY the "
                "fields below — these are the only parameters the platform has. "
                "To build SEVERAL agents from one shared strategy in a single "
                "go, add `agents` (see its description)."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "required": ["classification", "config", "rationale"],
                "properties": {
                    "classification": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["signal_family", "variant", "confidence"],
                        "properties": {
                            "signal_family": {"type": "string",
                                              "description": ("internal only, never shown to the "
                                                              "user; one of: "
                                                              + ", ".join(SIGNAL_FAMILIES))},
                            "variant": {"type": "string",
                                        "description": ("the chosen variant code, e.g. MOM1 — "
                                                        "must belong to signal_family")},
                            "confidence": {"type": "number", "description": "0-1"},
                            "signals_heard": {"type": "array", "items": {"type": "string"}},
                        },
                    },
                    "config": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["name", "assets", "signal_family", "variant",
                                     "candle_interval", "reward", "training_steps",
                                     "stop_loss", "take_profit", "max_trade",
                                     "min_trade"],
                        "properties": _config_field_properties(),
                    },
                    "agents": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": _config_field_properties(),
                        },
                        "description": (
                            "OPTIONAL. Use ONLY to build multiple agents from ONE "
                            "shared strategy in a single request — most commonly "
                            "one {\"assets\": [...]} entry per agent. Each entry "
                            "inherits every field from `config` and overrides only "
                            "what it names. Leave this out for a single agent. At "
                            "most %d agents per request. Example — 'run 3 agents on "
                            "different coins' -> agents:[{\"assets\":[\"BTCUSDT\"]},"
                            "{\"assets\":[\"ETHUSDT\"]},{\"assets\":[\"SOLUSDT\"]}]. "
                            "Do NOT use this for one agent that trades a basket of "
                            "coins (that is a single `config` with several assets)."
                            % MAX_AGENTS_PER_BATCH
                        ),
                    },
                    "rationale": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": ("One short plain-language sentence per "
                                        "inferred value, tied to what the user said. "
                                        "Keys are config field names."),
                    },
                },
            },
        },
    }


def build_retrieve_tool():
    return {
        "type": "function",
        "function": {
            "name": "retrieve",
            "description": ("Look up Roostoo knowledge cards (signal families, "
                            "strategy variants, indicators, reward metrics, "
                            "platform mechanics)."),
            "parameters": {
                "type": "object",
                "required": ["query"],
                "properties": {"query": {"type": "string"},
                               "k": {"type": "integer", "minimum": 1, "maximum": 5}},
            },
        },
    }


def all_tools():
    return [build_emit_config_tool(), build_retrieve_tool()]
