#!/usr/bin/env python3
"""Compare paired tournament reports; optionally enforce rush/regression checks."""
import argparse
import json
from pathlib import Path


def read_report(path):
    report = json.loads(Path(path).read_text())
    results = report["results"]
    wins = sum(result["hard_won"] is True for result in results)
    losses = sum(result["hard_won"] is False for result in results)
    expected = {"games": len(results), "wins": wins, "losses": losses,
                "draws": len(results) - wins - losses}
    if any(report.get(key) != value for key, value in expected.items()):
        raise ValueError(f"summary does not match results: {path}")
    indexed = {}
    for result in results:
        # Older tournament reports predate demolition telemetry.
        result.setdefault("hard_demolition_built", 0)
        result.setdefault("explosions", 0)
        key = (result["seed"], result["hard_team"], result["scenario"])
        if key in indexed:
            raise ValueError(f"duplicate match: {key}")
        indexed[key] = result
    if not indexed:
        raise ValueError("empty tournament report")
    return indexed


def compare(before, after):
    if before.keys() != after.keys():
        raise ValueError("reports must contain the same seeds, sides and scenarios")
    groups = {}
    for key in before:
        scenario = key[2]
        group = groups.setdefault(scenario, {
            "games": 0, "before_wins": 0, "after_wins": 0,
            "before_draws": 0, "after_draws": 0,
            "gained_wins": 0, "lost_wins": 0, "identical_matches": 0,
        })
        old, new = before[key], after[key]
        group["games"] += 1
        group["before_wins"] += old["hard_won"] is True
        group["after_wins"] += new["hard_won"] is True
        group["before_draws"] += old["hard_won"] is None
        group["after_draws"] += new["hard_won"] is None
        group["gained_wins"] += old["hard_won"] is not True and new["hard_won"] is True
        group["lost_wins"] += old["hard_won"] is True and new["hard_won"] is not True
        group["identical_matches"] += old == new
    return groups


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--require-balanced-identical", action="store_true")
    parser.add_argument("--require-rush-improvement", action="store_true")
    parser.add_argument("--require-stock-outcomes-identical", action="store_true")
    parser.add_argument("--require-stock-nonregression", action="store_true")
    parser.add_argument("--require-player-armor-improvement", action="store_true")
    parser.add_argument("--require-mixed-wave-improvement", action="store_true")
    args = parser.parse_args()
    before, after = read_report(args.before), read_report(args.after)
    groups = compare(before, after)
    print(json.dumps(groups, indent=2))
    if args.require_balanced_identical:
        balanced = [group for scenario, group in groups.items()
                    if scenario in {"standard", "armor", "infantry", "scarce_ore"}]
        if not balanced or any(g["identical_matches"] != g["games"] for g in balanced):
            parser.exit(1, "balanced matches changed or are missing\n")
    if args.require_rush_improvement:
        rush = groups.get("early_rush")
        if not rush or rush["after_wins"] <= rush["before_wins"] or rush["after_draws"] > rush["before_draws"]:
            parser.exit(1, "rush wins did not improve, or timeouts increased\n")
    if args.require_stock_outcomes_identical:
        scenarios = {"standard", "armor", "infantry", "scarce_ore", "early_rush"}
        if not scenarios.issubset(groups) or any(
                before[key]["hard_won"] != after[key]["hard_won"]
                for key in before if key[2] in scenarios):
            parser.exit(1, "stock outcomes changed or stock scenarios are missing\n")
    if args.require_stock_nonregression:
        scenarios = {"standard", "armor", "infantry", "scarce_ore", "early_rush"}
        if not scenarios.issubset(groups) or any(
                groups[scenario]["after_wins"] < groups[scenario]["before_wins"]
                or groups[scenario]["after_draws"] > groups[scenario]["before_draws"]
                for scenario in scenarios):
            parser.exit(1, "stock scenario win rates regressed, timeouts increased, or scenarios are missing\n")
    if args.require_player_armor_improvement:
        scenarios = {"recorded_armor", "minimal_armor", "armor_turtle"}
        if not scenarios.issubset(groups) or any(
                groups[scenario]["after_wins"] <= groups[scenario]["before_wins"]
                or groups[scenario]["after_draws"] > groups[scenario]["before_draws"]
                for scenario in scenarios):
            parser.exit(1, "player armor scenarios did not improve, or timeouts increased\n")
    if args.require_mixed_wave_improvement:
        scenarios = {"recorded_mixed", "minimal_mixed", "mixed_assault",
                     "mixed_assault_early", "mixed_assault_late"}
        if not scenarios.issubset(groups) or any(
                groups[scenario]["after_wins"] < groups[scenario]["before_wins"]
                or groups[scenario]["after_draws"] > groups[scenario]["before_draws"]
                for scenario in scenarios) or sum(groups[s]["after_wins"] for s in scenarios) <= sum(
                    groups[s]["before_wins"] for s in scenarios):
            parser.exit(1, "mixed-wave results did not improve, a scenario regressed, or scenarios are missing\n")


if __name__ == "__main__":
    main()
