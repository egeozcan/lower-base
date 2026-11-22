//! Empirical Ore Depot evaluation: controlled mining ROI curves and
//! paired side-swapped A/B AI duels across Deathmatch and Standard modes.
use super::*;

#[derive(Serialize)]
pub struct RoiHorizon {
    pub seconds: u32,
    pub gross_mined: f32,
    pub delta_vs_zero_depot: f32,
    pub net_profit: f32,
}

#[derive(Serialize)]
pub struct RoiRow {
    pub collectors: usize,
    pub depots: usize,
    pub break_even_seconds: Option<f32>,
    pub horizons: Vec<RoiHorizon>,
}

#[derive(Serialize)]
pub struct DuelSummary {
    pub bucket: String,
    pub games: usize,
    pub depot_wins: usize,
    pub depot_losses: usize,
    pub draws: usize,
    pub win_rate: f32,
    pub avg_depots_built: f32,
    pub avg_seconds: f32,
}

#[derive(Serialize)]
pub struct DepotBenchmarkReport {
    pub roi: Vec<RoiRow>,
    pub duels: Vec<DuelSummary>,
}

pub fn mining_roi() -> Vec<RoiRow> {
    const SEEDS: [u32; 8] = [0, 5, 7, 26, 42, 73, 1941, 2026];
    const HORIZONS: [u32; 4] = [60, 90, 120, 180];
    let mut rows = Vec::new();
    let n = SEEDS.len() as f32;

    for collectors in [1, 2, 3, 4] {
        let mut zero_avg_at_sec = [0.0f32; 181];
        for depots in [0, 1, 2] {
            let mut sum_mined = [0.0f32; 181];
            for &seed in &SEEDS {
                let mut game = Game::with_options(seed, Difficulty::Hard, GameMode::Deathmatch);
                game.units.clear();
                game.ai_decision_timer = f32::INFINITY;
                game.credits = CREDIT_CAP;
                for _ in 0..collectors {
                    game.spawn(Team::Player, UnitKind::Collector);
                }
                for _ in 0..depots {
                    game.build_pad("ore_depot");
                }
                game.credits = 0.0;
                let passive = game.game_mode.passive_income();
                let mut mined = 0.0f32;
                for sec in 1..=180 {
                    for _ in 0..20 {
                        let before = game.credits;
                        game.update(0.05);
                        let delta = (game.credits - before - passive * 0.05).max(0.0);
                        mined += delta;
                        if game.credits > 1000.0 {
                            game.credits = 0.0;
                        }
                    }
                    sum_mined[sec] += mined;
                }
            }
            let avg_at_sec = sum_mined.map(|s| s / n);
            if depots == 0 {
                zero_avg_at_sec = avg_at_sec;
            }
            let depot_cost = ORE_DEPOT_COST * depots as f32;
            let break_even_seconds = if depots == 0 {
                Some(0.0)
            } else {
                (1..=180)
                    .find(|&sec| (avg_at_sec[sec] - zero_avg_at_sec[sec]) >= depot_cost)
                    .map(|sec| sec as f32)
            };
            let horizons = HORIZONS
                .iter()
                .map(|&h| {
                    let s = h as usize;
                    let gross = avg_at_sec[s];
                    let delta = gross - zero_avg_at_sec[s];
                    RoiHorizon {
                        seconds: h,
                        gross_mined: gross,
                        delta_vs_zero_depot: delta,
                        net_profit: delta - depot_cost,
                    }
                })
                .collect();
            rows.push(RoiRow {
                collectors,
                depots,
                break_even_seconds,
                horizons,
            });
        }
    }
    rows
}

pub fn ab_duels(seed_count: u32, first_seed: u32, max_seconds: f32) -> Vec<DuelSummary> {
    let buckets = [
        ("deathmatch_hard", Difficulty::Hard, GameMode::Deathmatch),
        ("standard_hard", Difficulty::Hard, GameMode::Standard),
        ("deathmatch_medium", Difficulty::Medium, GameMode::Deathmatch),
        ("standard_medium", Difficulty::Medium, GameMode::Standard),
    ];
    let mut summaries = Vec::new();
    for (name, difficulty, game_mode) in buckets {
        let mut depot_wins = 0usize;
        let mut depot_losses = 0usize;
        let mut draws = 0usize;
        let mut total_depots = 0usize;
        let mut total_seconds = 0.0f32;
        let games = seed_count as usize * 2;
        for seed in first_seed..first_seed + seed_count {
            for depot_team in [Team::Player, Team::Enemy] {
                let mut game = Game::demo_with_options(seed, difficulty, game_mode);
                game.allow_ai_ore_depots = match depot_team {
                    Team::Player => [true, false],
                    Team::Enemy => [false, true],
                };
                let mut seen_depots = std::collections::HashSet::new();
                while game.outcome == Outcome::Playing && game.time < max_seconds {
                    game.update(0.25);
                    for b in &game.buildings {
                        if b.team == depot_team && b.kind == BuildingKind::OreDepot {
                            seen_depots.insert(b.id);
                        }
                    }
                }
                total_depots += seen_depots.len();
                total_seconds += game.time;
                match game.outcome {
                    Outcome::Playing => draws += 1,
                    Outcome::Victory => {
                        if depot_team == Team::Player {
                            depot_wins += 1;
                        } else {
                            depot_losses += 1;
                        }
                    }
                    Outcome::Defeat => {
                        if depot_team == Team::Enemy {
                            depot_wins += 1;
                        } else {
                            depot_losses += 1;
                        }
                    }
                }
            }
        }
        summaries.push(DuelSummary {
            bucket: name.into(),
            games,
            depot_wins,
            depot_losses,
            draws,
            win_rate: depot_wins as f32 / games as f32,
            avg_depots_built: total_depots as f32 / games as f32,
            avg_seconds: total_seconds / games as f32,
        });
    }
    summaries
}

pub fn run(seed_count: u32, first_seed: u32, max_seconds: f32) -> DepotBenchmarkReport {
    DepotBenchmarkReport {
        roi: mining_roi(),
        duels: ab_duels(seed_count, first_seed, max_seconds),
    }
}
