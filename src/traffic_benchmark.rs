//! Movement under traffic, using the real navigation, collisions and mining.
//! Mining compares crowded collectors with one mining alone on the same map,
//! so a congested refinery route shows up as lost deliveries.
use super::*;

#[derive(Serialize)]
pub struct MiningResult {
    pub seed: u32,
    pub collectors: usize,
    /// Player, then enemy.
    pub deliveries: [usize; 2],
    pub fewest_deliveries: usize,
    /// Share of steps in which a collector heading somewhere barely moved.
    pub stalled_fraction: f32,
}

#[derive(Serialize)]
pub struct MarchResult {
    pub scenario: &'static str,
    pub kind: UnitKind,
    pub units: usize,
    pub arrived: usize,
    pub seconds_until_all_arrived: Option<f32>,
    pub stalled_fraction: f32,
}

pub const MINING_SEEDS: [u32; 8] = [0, 5, 7, 26, 42, 73, 1941, 2026];

pub fn mining_runs() -> Vec<MiningResult> {
    [1, 2, 3, 4, 6]
        .into_iter()
        .flat_map(|per_team| {
            MINING_SEEDS
                .into_iter()
                .map(move |seed| mining(seed, per_team, 180.0))
        })
        .collect()
}

/// Collectors are released one factory build time apart, as in a real match,
/// next to each side's idle starting army. Commanders are disabled.
pub fn mining(seed: u32, per_team: usize, seconds: f32) -> MiningResult {
    let mut game = Game::with_seed(seed);
    game.ai_decision_timer = f32::INFINITY;
    let mut deliveries = std::collections::HashMap::<u32, usize>::new();
    let (mut stalled, mut moving) = (0usize, 0usize);
    let dt = 0.05;
    for step in 0..(seconds / dt) as usize {
        let time = step as f32 * dt;
        let released = ((time / UnitKind::Collector.build_time()) as usize + 1).min(per_team);
        for team in [Team::Player, Team::Enemy] {
            let count = game
                .units
                .iter()
                .filter(|u| u.team == team && u.kind == UnitKind::Collector)
                .count();
            if count < released {
                game.spawn(team, UnitKind::Collector);
            }
        }
        let before: Vec<_> = game
            .units
            .iter()
            .filter(|u| u.kind == UnitKind::Collector)
            .map(|u| (u.id, u.x, u.z, u.cargo, collector_goal(&game, u)))
            .collect();
        game.update(dt);
        for (id, x, z, cargo, goal) in before {
            let Some(u) = game.units.iter().find(|u| u.id == id) else {
                continue;
            };
            if cargo > 0.0 && u.cargo == 0.0 {
                *deliveries.entry(id).or_default() += 1;
            }
            if goal.is_some_and(|(gx, gz, stop)| distance_sq(x, z, gx, gz).sqrt() > stop + 0.5) {
                moving += 1;
                if distance_sq(x, z, u.x, u.z).sqrt() < 0.3 * u.kind.speed() * dt {
                    stalled += 1;
                }
            }
        }
    }
    let collectors: Vec<_> = game
        .units
        .iter()
        .filter(|u| u.kind == UnitKind::Collector)
        .map(|u| (u.team, deliveries.get(&u.id).copied().unwrap_or(0)))
        .collect();
    let team_deliveries = |team| {
        collectors
            .iter()
            .filter(|(t, _)| *t == team)
            .map(|(_, d)| d)
            .sum()
    };
    MiningResult {
        seed,
        collectors: per_team,
        deliveries: [team_deliveries(Team::Player), team_deliveries(Team::Enemy)],
        fewest_deliveries: collectors.iter().map(|(_, d)| *d).min().unwrap_or(0),
        stalled_fraction: stalled as f32 / moving.max(1) as f32,
    }
}

// Where harvest_and_unload sends a collector, for measurement only.
fn collector_goal(game: &Game, unit: &Unit) -> Option<(f32, f32, f32)> {
    if !unit.on_field() {
        return None;
    }
    if unit.returning || unit.cargo >= COLLECTOR_CAPACITY {
        return game
            .buildings
            .iter()
            .filter(|b| b.team == unit.team && b.kind == BuildingKind::Refinery && b.hp > 0.0)
            .min_by(|a, b| {
                distance_sq(unit.x, unit.z, a.x, a.z)
                    .total_cmp(&distance_sq(unit.x, unit.z, b.x, b.z))
            })
            .map(|b| (b.x, b.z, UNLOAD_REACH));
    }
    let id = unit.deposit?;
    game.ore
        .iter()
        .find(|o| o.id == id && o.amount > 0.0)
        .map(|o| (o.x, o.z, MINING_REACH))
}

/// Groups march to rally points in Gather mode, without opponents, so the
/// arrival time measures navigation alone.
pub fn marches() -> Vec<MarchResult> {
    let mut results = Vec::new();
    for kind in [UnitKind::Soldier, UnitKind::Tank] {
        for count in [4, 8] {
            // Two lines swap places head-on through midfield.
            results.push(march("crossing", kind, count, |i, count| {
                let side = if i < count / 2 { 1.0 } else { -1.0 };
                let x = ((i % (count / 2)) as f32 - (count / 2) as f32 / 2.0) * 3.6;
                ((x, side * 14.0), (x, -side * 14.0))
            }));
            // A file follows its leader around the factory to parking spaces
            // behind the base.
            results.push(march("column", kind, count, |i, _| {
                (
                    (12.0, 26.0 - i as f32 * 4.0),
                    (6.0 + (i % 3) as f32 * 4.0, 50.0 + (i / 3) as f32 * 4.0),
                )
            }));
            // Half leave the back of the base while the rest arrive.
            results.push(march("counterflow", kind, count, |i, count| {
                let j = i % (count / 2);
                let rear = (8.0 - (j % 3) as f32 * 3.6, 55.0 + (j / 3) as f32 * 3.6);
                if i < count / 2 {
                    (rear, (12.0, 22.0 - j as f32 * 3.6))
                } else {
                    ((12.0, 28.0 - j as f32 * 3.6), rear)
                }
            }));
        }
    }
    results
}

fn march(
    scenario: &'static str,
    kind: UnitKind,
    count: usize,
    placement: impl Fn(usize, usize) -> ((f32, f32), (f32, f32)),
) -> MarchResult {
    let mut game = Game::with_seed(26);
    game.units.clear();
    game.ore.clear();
    game.buildings.retain(|b| b.team == Team::Player);
    game.ai_decision_timer = f32::INFINITY;
    for i in 0..count {
        let ((x, z), (rally_x, rally_z)) = placement(i, count);
        game.spawn(Team::Player, kind);
        let unit = game.units.last_mut().unwrap();
        unit.x = x;
        unit.z = z;
        unit.rally_x = rally_x;
        unit.rally_z = rally_z;
        unit.state = UnitState::Gather;
    }
    game.resolve_collisions();
    let dt = 0.05;
    let arrived = |u: &Unit| distance_sq(u.x, u.z, u.rally_x, u.rally_z) <= 1.5 * 1.5;
    let (mut stalled, mut moving) = (0usize, 0usize);
    let mut finished = None;
    for step in 0..1200 {
        let before: Vec<_> = game.units.iter().map(|u| (u.x, u.z, arrived(u))).collect();
        game.combat_and_move(dt);
        game.resolve_collisions();
        for (u, &(x, z, done)) in game.units.iter().zip(&before) {
            if !done {
                moving += 1;
                if distance_sq(x, z, u.x, u.z).sqrt() < 0.3 * kind.speed() * dt {
                    stalled += 1;
                }
            }
        }
        if game.units.iter().all(arrived) {
            finished = Some((step + 1) as f32 * dt);
            break;
        }
    }
    MarchResult {
        scenario,
        kind,
        units: count,
        arrived: game.units.iter().filter(|u| arrived(u)).count(),
        seconds_until_all_arrived: finished,
        stalled_fraction: stalled as f32 / moving.max(1) as f32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crowded_collectors_keep_their_delivery_rate() {
        // Two collectors share no lane, so they keep nearly a lone collector's
        // rate of about 14.
        for (per_team, average, fewest) in [(2, 13.5, 12), (4, 11.0, 9), (6, 9.2, 7)] {
            let results: Vec<_> = [0, 26, 73]
                .into_iter()
                .map(|seed| mining(seed, per_team, 180.0))
                .collect();
            let delivered: usize = results
                .iter()
                .map(|r| r.deliveries[0] + r.deliveries[1])
                .sum();
            let per_collector = delivered as f32 / (results.len() * per_team * 2) as f32;
            assert!(
                per_collector >= average,
                "{per_team} collectors per side averaged {per_collector} deliveries"
            );
            for r in &results {
                assert!(
                    r.fewest_deliveries >= fewest && r.stalled_fraction < 0.05,
                    "seed {}, {per_team} per side: fewest {}, stalled {}",
                    r.seed,
                    r.fewest_deliveries,
                    r.stalled_fraction
                );
            }
        }
    }

    #[test]
    fn crossing_and_converging_groups_arrive_promptly() {
        for r in marches() {
            let limit = if r.kind == UnitKind::Tank { 16.0 } else { 9.0 };
            assert!(
                r.seconds_until_all_arrived.is_some_and(|s| s <= limit),
                "{} {:?} x{}: {}/{} arrived, after {:?}s",
                r.scenario,
                r.kind,
                r.units,
                r.arrived,
                r.units,
                r.seconds_until_all_arrived
            );
        }
    }
}
