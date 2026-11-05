//! Mirror demos: both commanders at one difficulty, in either game mode.
//! Measures how quickly each side completes its base (Standard), whether
//! matches resolve, and which side wins: mirrors should not favor a side.
use super::*;

#[derive(Serialize)]
pub struct StandardRun {
    pub seed: u32,
    pub difficulty: Difficulty,
    pub outcome: Outcome,
    pub seconds: f32,
    /// Seconds until each side (player, enemy) first had all three site
    /// structures finished, if it ever did.
    pub base_complete: [Option<f32>; 2],
    pub rebuilds: [usize; 2],
}

pub fn runs(
    seeds: std::ops::Range<u32>,
    max_seconds: f32,
    game_mode: GameMode,
) -> Vec<StandardRun> {
    let mut runs = Vec::new();
    for difficulty in [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard] {
        for seed in seeds.clone() {
            runs.push(play(seed, difficulty, max_seconds, game_mode));
        }
    }
    runs
}

fn play(seed: u32, difficulty: Difficulty, max_seconds: f32, game_mode: GameMode) -> StandardRun {
    let mut game = Game::demo_with_options(seed, difficulty, game_mode);
    let mut base_complete = [None; 2];
    let mut seen: [Vec<u32>; 2] = [Vec::new(), Vec::new()];
    while game.outcome == Outcome::Playing && game.time < max_seconds {
        game.update(0.05);
        for (i, team) in [Team::Player, Team::Enemy].into_iter().enumerate() {
            if base_complete[i].is_none()
                && BuildingKind::SITE_STRUCTURES
                    .iter()
                    .all(|&kind| game.alive_building(team, kind))
            {
                base_complete[i] = Some(game.time);
            }
            for b in game
                .buildings
                .iter()
                .filter(|b| b.team == team && BuildingKind::SITE_STRUCTURES.contains(&b.kind))
            {
                if !seen[i].contains(&b.id) {
                    seen[i].push(b.id);
                }
            }
        }
    }
    StandardRun {
        seed,
        difficulty,
        outcome: game.outcome,
        seconds: game.time,
        base_complete,
        rebuilds: seen.map(|ids| ids.len().saturating_sub(3)),
    }
}
