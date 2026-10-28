//! Equal-credit battles use the real movement, targeting and damage simulation.
use super::*;

#[derive(Serialize)]
pub struct BattleResult {
    pub counter: UnitKind,
    pub target: UnitKind,
    pub counter_team: Team,
    pub budget: f32,
    pub starting_gap: f32,
    pub offset: f32,
    pub counter_won: Option<bool>,
    pub counter_remaining_fraction: f32,
    pub target_remaining_fraction: f32,
    pub seconds: f32,
}

pub fn battles() -> Vec<BattleResult> {
    let mut results = Vec::new();
    for (counter, target, base_budget) in [
        (UnitKind::Soldier, UnitKind::Rocket, 180.0),
        (UnitKind::Rocket, UnitKind::Tank, 450.0),
        (UnitKind::Tank, UnitKind::Soldier, 300.0),
    ] {
        for size in [1.0, 2.0, 4.0] {
            for team in [Team::Player, Team::Enemy] {
                for gap in [12.0, 30.0] {
                    for offset in [0.0, 1.7] {
                        results.push(battle(
                            counter,
                            target,
                            team,
                            base_budget * size,
                            gap,
                            offset,
                        ));
                    }
                }
            }
        }
    }
    results
}

fn battle(
    counter: UnitKind,
    target: UnitKind,
    counter_team: Team,
    budget: f32,
    gap: f32,
    offset: f32,
) -> BattleResult {
    let mut game = Game::with_seed(26);
    game.units.clear();
    game.buildings.clear();
    game.ore.clear();
    game.ai_decision_timer = f32::INFINITY;
    for team in [Team::Player, Team::Enemy] {
        let kind = if team == counter_team {
            counter
        } else {
            target
        };
        let count = (budget / kind.cost()) as usize;
        assert_eq!(count as f32 * kind.cost(), budget);
        for i in 0..count {
            game.spawn(team, kind);
            let unit = game.units.last_mut().unwrap();
            let columns = (count - i / 5 * 5).min(5);
            unit.x = (i % 5) as f32 * 3.4 - (columns - 1) as f32 * 1.7
                + if team == counter_team { 0.0 } else { offset };
            unit.z =
                (gap / 2.0 + (i / 5) as f32 * 3.4) * if team == Team::Player { 1.0 } else { -1.0 };
            unit.state = UnitState::Attack;
        }
    }
    for _ in 0..240 {
        game.update(0.25);
        if game.outcome != Outcome::Playing {
            break;
        }
    }
    let remaining = |team| {
        game.units
            .iter()
            .filter(|u| u.team == team)
            .map(|u| u.kind.cost() * u.hp / u.max_hp)
            .sum::<f32>()
            / budget
    };
    BattleResult {
        counter,
        target,
        counter_team,
        budget,
        starting_gap: gap,
        offset,
        counter_won: match game.outcome {
            Outcome::Playing => None,
            Outcome::Victory => Some(counter_team == Team::Player),
            Outcome::Defeat => Some(counter_team == Team::Enemy),
        },
        counter_remaining_fraction: remaining(counter_team),
        target_remaining_fraction: remaining(if counter_team == Team::Player {
            Team::Enemy
        } else {
            Team::Player
        }),
        seconds: game.time,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_dominate_equal_credit_armies_across_sizes_sides_and_formations() {
        let results = battles();
        for counter in [UnitKind::Soldier, UnitKind::Rocket, UnitKind::Tank] {
            let matches: Vec<_> = results.iter().filter(|r| r.counter == counter).collect();
            let wins = matches
                .iter()
                .filter(|r| r.counter_won == Some(true))
                .count();
            let remaining = matches
                .iter()
                .map(|r| r.counter_remaining_fraction)
                .sum::<f32>()
                / matches.len() as f32;
            eprintln!(
                "{counter:?}: {wins}/{} wins, {:.1}% surviving value",
                matches.len(),
                remaining * 100.0
            );
            assert!(
                wins >= 22,
                "{counter:?} should win at least 22/24 equal-credit counter matchups; got {wins}"
            );
            assert!(
                remaining >= 0.3,
                "{counter:?} should retain a clear material advantage; got {remaining}"
            );
        }
    }
}
