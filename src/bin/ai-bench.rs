use lower_base::simulation::{
    ai_benchmark::{play, Scenario},
    Team,
};
use serde::Serialize;

#[derive(Serialize)]
struct Summary {
    wins: usize,
    losses: usize,
    draws: usize,
    games: usize,
    win_rate: f32,
    results: Vec<lower_base::simulation::ai_benchmark::MatchResult>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--balance") {
        println!(
            "{}",
            serde_json::to_string_pretty(&lower_base::simulation::balance_benchmark::battles())
                .unwrap()
        );
        return;
    }
    if args.iter().any(|arg| arg == "--help") {
        println!("ai-bench [seed-count=12] [first-seed=0] [max-seconds=360] [standard|rush|balanced|stock|player-armor|interception|mixed-wave|tank-opening|all]\nstock: five original scenarios; player-armor: three recordings and four automated tank strategies; interception: an unopposed infantry wave; mixed-wave: two recordings and three mixed-army attacks; tank-opening: a recording and three armor-first infantry rushes; all: all twenty-two scenarios.\nai-bench --balance runs 72 equal-credit counter battles.\nPrints JSON; timeouts count as draws.");
        return;
    }
    let number = |i: usize, default: u32| -> u32 {
        args.get(i)
            .map(|s| s.parse().expect("expected an unsigned integer"))
            .unwrap_or(default)
    };
    let count = number(0, 12);
    let first = number(1, 0);
    let seconds = number(2, 360);
    assert!(
        count > 0 && seconds > 0,
        "seed count and duration must be positive"
    );
    let scenarios = match args.get(3).map(String::as_str).unwrap_or("standard") {
        "standard" => &Scenario::ALL[..1],
        "rush" => &Scenario::ALL[4..5],
        "balanced" => &Scenario::ALL[..4],
        "player-armor" => &Scenario::ALL[5..12],
        "interception" => &Scenario::ALL[12..13],
        "mixed-wave" => &Scenario::ALL[13..18],
        "tank-opening" => &Scenario::ALL[18..],
        "stock" => &Scenario::ALL[..5],
        "all" => &Scenario::ALL[..],
        _ => panic!(
            "scenario must be standard, rush, balanced, player-armor, interception, mixed-wave, tank-opening, stock or all"
        ),
    };
    let mut results = Vec::new();
    for seed in first..first.checked_add(count).expect("seed range overflow") {
        for &scenario in scenarios {
            for team in [Team::Player, Team::Enemy] {
                let result = play(seed, team, scenario, seconds as f32);
                eprintln!(
                    "seed {seed}, {scenario:?}, Hard {team:?}: {} at {:.1}s",
                    match result.hard_won {
                        Some(true) => "win",
                        Some(false) => "loss",
                        None => "draw",
                    },
                    result.seconds
                );
                results.push(result);
            }
        }
    }
    let wins = results.iter().filter(|r| r.hard_won == Some(true)).count();
    let losses = results.iter().filter(|r| r.hard_won == Some(false)).count();
    println!(
        "{}",
        serde_json::to_string_pretty(&Summary {
            wins,
            losses,
            draws: results.len() - wins - losses,
            games: results.len(),
            win_rate: wins as f32 / results.len() as f32,
            results,
        })
        .unwrap()
    );
}
