//! Native-only tournament support. Both controllers use the actual simulation,
//! equal resources, ordinary orders and identical 0.05s physics substeps.
//! Player recordings use their original command times, sampled at 0.05s; exact
//! browser-frame replays are handled by scripts/replay-debug.mjs.
use super::*;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scenario {
    Standard,
    Armor,
    Infantry,
    ScarceOre,
    EarlyRush,
    RecordedArmor,
    MinimalArmor,
    ArmorTurtle,
    RecordedArmorLate,
    ArmorTurtleEarly,
    ArmorTurtleLate,
    ArmorTurtleGreedy,
    UnopposedInfantry,
}

impl Scenario {
    pub const ALL: [Self; 13] = [
        Self::Standard,
        Self::Armor,
        Self::Infantry,
        Self::ScarceOre,
        Self::EarlyRush,
        Self::RecordedArmor,
        Self::MinimalArmor,
        Self::ArmorTurtle,
        Self::RecordedArmorLate,
        Self::ArmorTurtleEarly,
        Self::ArmorTurtleLate,
        Self::ArmorTurtleGreedy,
        Self::UnopposedInfantry,
    ];
}

#[derive(Serialize)]
pub struct MatchResult {
    pub seed: u32,
    pub hard_team: Team,
    pub scenario: Scenario,
    /// None means a timeout, never a win inferred from surviving material.
    pub hard_won: Option<bool>,
    pub seconds: f32,
    pub hard_surviving_value: f32,
    /// Legacy JSON field name; scripted scenarios report the player's value here.
    pub stock_surviving_value: f32,
    /// Pressure, economy, anti-armor, anti-infantry, defend, finish.
    pub plans: [u32; 6],
    pub hard_demolition_built: usize,
    pub explosions: usize,
}

#[derive(serde::Deserialize)]
struct RecordedOrder {
    time: f32,
    #[serde(flatten)]
    order: RecordedAction,
}

#[derive(serde::Deserialize)]
#[serde(tag = "action", content = "args", rename_all = "snake_case")]
enum RecordedAction {
    Train { kind: String },
    SetMode { mode: String },
}

fn armor_turtle(game: &mut Game, team: Team, scenario: Scenario) {
    let attack_at = match scenario {
        Scenario::ArmorTurtleEarly => 20.0,
        Scenario::ArmorTurtleLate => 42.0,
        Scenario::ArmorTurtleGreedy => 48.0,
        _ => 32.0,
    };
    let mode = if game.time < attack_at {
        Mode::Gather
    } else if !matches!(scenario, Scenario::ArmorTurtle) || game.time < 48.0 {
        Mode::Attack
    } else if game.time < 51.0 {
        Mode::Retreat
    } else if game.time < 67.0 {
        Mode::Gather
    } else {
        Mode::Attack
    };
    if game.team_mode(team) != mode {
        game.set_team_mode(team, mode);
    }
    let collectors = game
        .units
        .iter()
        .filter(|u| u.team == team && u.kind == UnitKind::Collector)
        .count()
        + game
            .production_queue(team, BuildingKind::Factory)
            .iter()
            .filter(|&&k| k == UnitKind::Collector)
            .count();
    let collector_goal = if matches!(scenario, Scenario::ArmorTurtleGreedy) {
        if game.time >= 36.0 {
            4
        } else if game.time >= 24.0 {
            3
        } else if game.time >= 16.0 {
            2
        } else if game.time >= 8.0 {
            1
        } else {
            0
        }
    } else if game.time >= 56.0 {
        3
    } else if game.time >= 22.0 {
        2
    } else if game.time >= 8.0 {
        1
    } else {
        0
    };
    if game
        .production_queue(team, BuildingKind::Factory)
        .is_empty()
    {
        game.queue_unit(
            team,
            if collectors < collector_goal {
                UnitKind::Collector
            } else {
                UnitKind::Tank
            },
        );
    }
    if game.time >= 42.0
        && game
            .production_queue(team, BuildingKind::Barracks)
            .is_empty()
        && game
            .units
            .iter()
            .filter(|u| u.team == team && u.kind == UnitKind::Rocket)
            .count()
            < 1
    {
        game.queue_unit(team, UnitKind::Rocket);
    }
}

pub fn play(seed: u32, hard_team: Team, scenario: Scenario, max_seconds: f32) -> MatchResult {
    let mut game = Game::demo_with_difficulty(seed, Difficulty::Hard);
    match scenario {
        Scenario::UnopposedInfantry => {
            game.units.clear();
            let opponent = if hard_team == Team::Player {
                Team::Enemy
            } else {
                Team::Player
            };
            let direction = if hard_team == Team::Enemy { 1.0 } else { -1.0 };
            for i in 0..8 {
                game.spawn(opponent, UnitKind::Soldier);
                let unit = game.units.last_mut().unwrap();
                unit.x = (i % 4) as f32 * 2.0 - 3.0;
                unit.z = (24.0 + (i / 4) as f32 * 2.0) * direction;
                unit.state = UnitState::Attack;
            }
        }
        Scenario::Standard
        | Scenario::RecordedArmor
        | Scenario::MinimalArmor
        | Scenario::ArmorTurtle
        | Scenario::RecordedArmorLate
        | Scenario::ArmorTurtleEarly
        | Scenario::ArmorTurtleLate
        | Scenario::ArmorTurtleGreedy => (),
        Scenario::EarlyRush => {
            // A stress test: stock starts already advancing across midfield.
            // No extra units, resources, damage or speed are granted.
            let direction = if hard_team == Team::Enemy { 1.0 } else { -1.0 };
            for u in game.units.iter_mut().filter(|u| u.team != hard_team) {
                u.z = -direction * 12.0;
                u.state = UnitState::Attack;
            }
        }
        Scenario::ScarceOre => {
            for ore in &mut game.ore {
                ore.amount = 120.0;
                ore.max_amount = 120.0;
            }
        }
        Scenario::Armor | Scenario::Infantry => {
            game.units.clear();
            let kinds: &[UnitKind] = if matches!(scenario, Scenario::Armor) {
                &[
                    UnitKind::Tank,
                    UnitKind::Tank,
                    UnitKind::Tank,
                    UnitKind::Soldier,
                ]
            } else {
                &[UnitKind::Soldier; 10]
            };
            for team in [Team::Player, Team::Enemy] {
                for &kind in kinds {
                    game.spawn(team, kind);
                }
            }
        }
    }
    // Bypass only automatic decisions, never income, queues, combat or movement.
    game.ai_decision_timer = f32::INFINITY;
    let mut until_decision = 0.0;
    let scripted = matches!(
        scenario,
        Scenario::RecordedArmor
            | Scenario::MinimalArmor
            | Scenario::ArmorTurtle
            | Scenario::RecordedArmorLate
            | Scenario::ArmorTurtleEarly
            | Scenario::ArmorTurtleLate
            | Scenario::ArmorTurtleGreedy
    );
    let orders: Vec<RecordedOrder> = match scenario {
        Scenario::RecordedArmor => {
            serde_json::from_str(include_str!("fixtures/armor-orders.json")).unwrap()
        }
        Scenario::MinimalArmor => {
            serde_json::from_str(include_str!("fixtures/armor-minimal-orders.json")).unwrap()
        }
        Scenario::RecordedArmorLate => {
            serde_json::from_str(include_str!("fixtures/armor-late-orders.json")).unwrap()
        }
        _ => Vec::new(),
    };
    let opponent = if hard_team == Team::Player {
        Team::Enemy
    } else {
        Team::Player
    };
    let mut next_order = 0;
    let mut trucks = std::collections::HashSet::new();
    let mut explosions = std::collections::HashSet::new();
    let dt = if scripted { 0.05 } else { 0.25 };
    let trace = std::env::var_os("AI_BENCH_TRACE").is_some();
    let ticks = (max_seconds / dt).ceil() as usize;
    for tick in 0..ticks {
        if trace && tick % (5.0 / dt) as usize == 0 {
            eprintln!(
                "time {:.0}, new {:?}, plan {:?}",
                game.time,
                hard_team,
                game.hard_commanders[if hard_team == Team::Player { 0 } else { 1 }].strategy
            );
            for team in [Team::Player, Team::Enemy] {
                let counts: Vec<_> = [
                    UnitKind::Soldier,
                    UnitKind::Rocket,
                    UnitKind::Tank,
                    UnitKind::Collector,
                ]
                .iter()
                .map(|kind| {
                    game.units
                        .iter()
                        .filter(|u| u.team == team && u.kind == *kind)
                        .count()
                })
                .collect();
                eprintln!(
                    "  {team:?}: {counts:?}, mode {:?}, queues {:?}/{:?}, credits {:.0}",
                    game.team_mode(team),
                    game.production_queue(team, BuildingKind::Barracks),
                    game.production_queue(team, BuildingKind::Factory),
                    if team == Team::Player {
                        game.credits
                    } else {
                        game.ai_credits
                    }
                );
            }
        }
        while next_order < orders.len() && game.time >= orders[next_order].time {
            match &orders[next_order].order {
                RecordedAction::Train { kind } => {
                    game.queue_unit(opponent, UnitKind::parse(kind).unwrap())
                }
                RecordedAction::SetMode { mode } => game.set_team_mode(
                    opponent,
                    match mode.as_str() {
                        "attack" => Mode::Attack,
                        "retreat" => Mode::Retreat,
                        "gather" => Mode::Gather,
                        _ => panic!("unknown fixture mode"),
                    },
                ),
            }
            next_order += 1;
        }
        until_decision -= dt;
        if until_decision <= 0.0 {
            // Match the normal demo order and give both sides equal cadence.
            for team in [Team::Enemy, Team::Player] {
                if team == hard_team {
                    game.ai_hard(team);
                } else if matches!(
                    scenario,
                    Scenario::ArmorTurtle
                        | Scenario::ArmorTurtleEarly
                        | Scenario::ArmorTurtleLate
                        | Scenario::ArmorTurtleGreedy
                ) {
                    armor_turtle(&mut game, opponent, scenario);
                } else if !scripted {
                    game.ai_stock_hard(team);
                }
            }
            until_decision = Difficulty::Hard.decision_interval();
        }
        game.update(dt);
        for u in game
            .units
            .iter()
            .filter(|u| u.team == hard_team && u.kind == UnitKind::Demolition)
        {
            trucks.insert(u.id);
        }
        for explosion in &game.explosions {
            explosions.insert(explosion.id);
        }
        if game.outcome != Outcome::Playing {
            break;
        }
    }
    let value = |team| {
        game.units
            .iter()
            .filter(|u| u.team == team)
            .map(|u| u.kind.cost() * u.hp / u.max_hp)
            .sum()
    };
    MatchResult {
        seed,
        hard_team,
        scenario,
        hard_won: match game.outcome {
            Outcome::Playing => None,
            Outcome::Victory => Some(hard_team == Team::Player),
            Outcome::Defeat => Some(hard_team == Team::Enemy),
        },
        seconds: game.time,
        hard_surviving_value: value(hard_team),
        stock_surviving_value: value(if hard_team == Team::Player {
            Team::Enemy
        } else {
            Team::Player
        }),
        plans: game.hard_commanders[if hard_team == Team::Player { 0 } else { 1 }].plans,
        hard_demolition_built: trucks.len(),
        explosions: explosions.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_beats_frozen_stock_across_maps_and_sides() {
        let mut wins = 0;
        for seed in [26, 73, 1941] {
            for team in [Team::Player, Team::Enemy] {
                let result = play(seed, team, Scenario::Standard, 300.0);
                wins += usize::from(result.hard_won == Some(true));
            }
        }
        assert!(
            wins >= 5,
            "expected at least 5/6 wins against stock Hard; got {wins}"
        );
    }

    #[test]
    fn hard_repels_early_rushes_across_maps_and_sides() {
        let mut wins = 0;
        for seed in [2, 5, 11, 26, 73, 1941] {
            for team in [Team::Player, Team::Enemy] {
                let result = play(seed, team, Scenario::EarlyRush, 300.0);
                wins += usize::from(result.hard_won == Some(true));
            }
        }
        assert!(wins >= 11, "expected at least 11/12 rush wins; got {wins}");
    }

    #[test]
    fn hard_handles_banked_armor_and_the_minimized_player_recording() {
        let mut wins = 0;
        for seed in [2, 2_983_962_536, 2_451_821_014] {
            for team in [Team::Player, Team::Enemy] {
                for scenario in [
                    Scenario::RecordedArmor,
                    Scenario::MinimalArmor,
                    Scenario::RecordedArmorLate,
                ] {
                    wins += usize::from(play(seed, team, scenario, 300.0).hard_won == Some(true));
                }
            }
        }
        assert!(
            wins >= 17,
            "expected at least 17/18 wins against banked armor; got {wins}"
        );
    }

    #[test]
    fn a_timeout_is_a_draw_even_when_one_army_has_more_material() {
        let result = play(26, Team::Player, Scenario::Standard, 1.0);
        assert_eq!(result.hard_won, None);
    }
}
