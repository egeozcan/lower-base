//! Demolition trucks choose what to hit by what a blast would destroy: enemy
//! units and structures, minus anything of their own caught in it. A truck
//! drives at the most valuable target it expects to reach under fire and
//! detonates once it has all it can get there, or once getting closer stops
//! paying, such as when the target's escorts block the way. A waiting truck
//! parks ahead of its rally line, beyond blast reach of the troops there, and
//! strikes enemies that come close to it.
use super::*;

// Distance from the center line to where a waiting truck parks, more than a
// blast radius ahead of the front rally row.
const POST: f32 = 19.0;
// A waiting truck strikes only targets this close to its post: for at least
// its own price, or for less once it is under fire and would otherwise be
// destroyed for nothing.
const GUARD_RADIUS: f32 = 13.0;
const GUARD_VALUE: f32 = 250.0;
const UNDER_FIRE_VALUE: f32 = 100.0;
// Seconds without a better blast before a truck settles for the one it has.
const PATIENCE: f32 = 0.3;
// A new target must be this much better before a truck turns away.
const STICKINESS: f32 = 1.15;
// Driving distance at which a target counts for half: far targets move,
// gain escorts, or are reached by other troops first.
const HALF_VALUE_DRIVE: f32 = 30.0;

/// Where `team`'s waiting truck parks.
pub(super) fn post(team: Team) -> (f32, f32) {
    let direction = if team == Team::Player { 1.0 } else { -1.0 };
    (0.0, direction * POST)
}

/// What a truck is driving at, and how its blast value has developed.
#[derive(Clone, Copy, Default)]
pub(super) struct Fuse {
    aim: Option<u32>,
    best: f32,
    waiting: f32,
}

/// Credits a blast at `at` destroys, by health removed: opposing units and
/// structures, minus `team`'s own. The truck itself is excluded.
fn blast_value(
    units: &[Unit],
    buildings: &[Building],
    team: Team,
    truck: u32,
    at: (f32, f32),
) -> f32 {
    let units = units
        .iter()
        .filter(|u| u.id != truck && u.on_field())
        .map(|u| {
            let damage = demolition_damage(distance_sq(at.0, at.1, u.x, u.z).sqrt());
            let value = (u.kind.cost() + u.cargo) * damage.min(u.hp) / u.max_hp;
            if u.team == team {
                -value
            } else {
                value
            }
        });
    let buildings = buildings.iter().filter(|b| b.hp > 0.0).map(|b| {
        let damage = demolition_damage(footprint_distance(b, at.0, at.1));
        let value = structure_value(b, damage);
        if b.team == team {
            -value
        } else {
            value
        }
    });
    units.chain(buildings).sum()
}

/// Credits of a structure that `damage` destroys. Guns are worth their price.
/// Other structures cannot be rebuilt but keep working until destroyed, so
/// damage counts for little unless it finishes one, which is worth half a
/// credit per hit point of the original structure.
fn structure_value(b: &Building, damage: f32) -> f32 {
    match b.kind {
        BuildingKind::Emplacement => EMPLACEMENT_COST * damage.min(b.hp) / b.max_hp,
        _ if damage >= b.hp => 0.25 * b.hp + 0.5 * b.max_hp,
        _ => 0.25 * damage,
    }
}

/// Distance from a point to the nearest edge of a building's footprint.
pub(super) fn footprint_distance(b: &Building, x: f32, z: f32) -> f32 {
    let (hx, hz) = building_half_size(b.kind);
    let dx = ((x - b.x).abs() - hx).max(0.0);
    let dz = ((z - b.z).abs() - hz).max(0.0);
    (dx * dx + dz * dz).sqrt()
}

/// How far from a building's center a truck coming from `from` touches it.
fn building_reach(b: &Building, from: (f32, f32)) -> f32 {
    let (hx, hz) = building_half_size(b.kind);
    let dx = from.0 - b.x;
    let dz = from.1 - b.z;
    let distance = (dx * dx + dz * dz).sqrt();
    // Intersect the approach ray with the rectangular footprint.
    let edge = (hx / dx.abs().max(0.001)).min(hz / dz.abs().max(0.001));
    distance * edge.min(1.0) + UnitKind::Demolition.radius() + 0.6
}

#[derive(Clone, Copy)]
enum Weapon {
    Unit(UnitKind),
    Command,
    Emplacement,
}

impl Weapon {
    /// How strongly the weapon wants a target at `distance`, by the same
    /// rules combat uses to choose: the highest preference is fired on.
    fn preference(self, target: UnitKind, distance: f32) -> f32 {
        match self {
            Self::Unit(kind) => fire_preference(kind, target, distance),
            Self::Command => -distance,
            Self::Emplacement => emplacement_preference(target, distance * distance),
        }
    }
}

#[derive(Clone, Copy)]
struct Threat {
    x: f32,
    z: f32,
    weapon: Weapon,
    range: f32,
    damage: f32,
    interval: f32,
    // The weapon's preference for its best other target in range now.
    engaged: f32,
}

// Every weapon able to fire on `team`'s truck. Each fires on it only while
// it prefers the truck to the other targets it has now; they stay put.
fn threats(units: &[Unit], buildings: &[Building], team: Team, truck: u32) -> Vec<Threat> {
    let weapons = units
        .iter()
        .filter(|u| u.team != team && u.on_field())
        .filter(|u| u.kind.damage(Some(UnitKind::Demolition)) > 0.0)
        .map(|u| {
            (
                u.x,
                u.z,
                Weapon::Unit(u.kind),
                u.kind.range(),
                u.kind.damage(Some(UnitKind::Demolition)),
                u.kind.interval(),
            )
        });
    let structures = buildings
        .iter()
        .filter(|b| b.team != team && b.hp > 0.0)
        .filter_map(|b| match b.kind {
            BuildingKind::Command => Some((
                b.x,
                b.z,
                Weapon::Command,
                COMMAND_RANGE,
                COMMAND_DAMAGE,
                COMMAND_INTERVAL,
            )),
            BuildingKind::Emplacement if b.construction_remaining <= 0.0 => Some((
                b.x,
                b.z,
                Weapon::Emplacement,
                EMPLACEMENT_RANGE,
                emplacement_damage(UnitKind::Demolition),
                EMPLACEMENT_INTERVAL,
            )),
            _ => None,
        });
    weapons
        .chain(structures)
        .map(|(x, z, weapon, range, damage, interval)| Threat {
            x,
            z,
            weapon,
            range,
            damage,
            interval,
            engaged: units
                .iter()
                .filter(|u| u.team == team && u.on_field() && u.id != truck)
                .map(|u| (u, distance_sq(x, z, u.x, u.z).sqrt()))
                .filter(|&(_, d)| d <= range)
                .map(|(u, d)| weapon.preference(u.kind, d))
                .fold(f32::NEG_INFINITY, f32::max),
        })
        .collect()
}

/// A target for a truck, valued by a straight drive at it under fire.
#[derive(Clone, Copy)]
struct Strike {
    id: u32,
    x: f32,
    z: f32,
    /// How far from the target the truck stops.
    stop: f32,
    travel: f32,
    /// Blast value where the truck stops, if it survives the drive.
    reach: f32,
    /// Blast value where fire on the way is expected to destroy it, which is
    /// where it explodes, or `reach` if it survives.
    expected: f32,
}

impl Strike {
    // Nearer targets are more certain.
    fn score(&self) -> f32 {
        self.expected / (1.0 + self.travel / HALF_VALUE_DRIVE)
    }
}

/// Every target a truck of `team` at `from` with `hp` could drive at.
fn strikes(
    units: &[Unit],
    buildings: &[Building],
    team: Team,
    truck: u32,
    from: (f32, f32),
    hp: f32,
) -> Vec<Strike> {
    let threats = threats(units, buildings, team, truck);
    let (radius, speed) = (UnitKind::Demolition.radius(), UnitKind::Demolition.speed());
    let unit_targets = units
        .iter()
        .filter(|u| u.team != team && u.on_field())
        .map(|u| (u.id, u.x, u.z, u.kind.radius() + radius + 0.1));
    let building_targets = buildings
        .iter()
        .filter(|b| b.team != team && b.hp > 0.0)
        .map(|b| (b.id, b.x, b.z, building_reach(b, from)));
    unit_targets
        .chain(building_targets)
        .map(|(id, x, z, stop)| {
            let (dx, dz) = (x - from.0, z - from.1);
            let length = (dx * dx + dz * dz).sqrt();
            let dir = if length > 1e-3 {
                (dx / length, dz / length)
            } else {
                (0.0, 0.0)
            };
            let mut travel = (length - stop).max(0.0);
            // Opposing units on the way stop the truck before it gets there.
            for u in units
                .iter()
                .filter(|u| u.team != team && u.on_field() && u.id != id)
            {
                let (px, pz) = (u.x - from.0, u.z - from.1);
                let along = px * dir.0 + pz * dir.1;
                let contact = u.kind.radius() + radius;
                let across_sq = px * px + pz * pz - along * along;
                if along > 0.0 && across_sq < contact * contact {
                    travel = travel.min((along - (contact * contact - across_sq).sqrt()).max(0.0));
                }
            }
            let mut shots = Vec::new();
            for t in &threats {
                let (px, pz) = (t.x - from.0, t.z - from.1);
                let along = px * dir.0 + pz * dir.1;
                let across_sq = (px * px + pz * pz - along * along).max(0.0);
                if across_sq > t.range * t.range {
                    continue;
                }
                let half_chord = (t.range * t.range - across_sq).sqrt();
                let mut d = (along - half_chord).max(0.0);
                while d <= travel.min(along + half_chord) {
                    let (x, z) = (from.0 + dir.0 * d, from.1 + dir.1 * d);
                    let distance = distance_sq(t.x, t.z, x, z).sqrt();
                    if t.weapon.preference(UnitKind::Demolition, distance) > t.engaged {
                        shots.push((d, t.damage));
                    }
                    d += t.interval * speed;
                }
            }
            shots.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut taken = 0.0;
            let mut destroyed_at = None;
            for (d, damage) in shots {
                taken += damage;
                if taken >= hp {
                    destroyed_at = Some(d);
                    break;
                }
            }
            let at = |d: f32| (from.0 + dir.0 * d, from.1 + dir.1 * d);
            let reach = blast_value(units, buildings, team, truck, at(travel));
            let expected =
                destroyed_at.map_or(reach, |d| blast_value(units, buildings, team, truck, at(d)));
            Strike {
                id,
                x,
                z,
                stop,
                travel,
                reach,
                expected,
            }
        })
        .collect()
}

/// The target a truck drives at now: the best strike anywhere once it has
/// been sent, or a worthwhile one near its post while it waits.
fn choose(unit: &Unit, units: &[Unit], buildings: &[Building]) -> Option<Strike> {
    let waiting = unit.state != UnitState::Attack;
    let under_fire = threats(units, buildings, unit.team, unit.id)
        .iter()
        .any(|t| {
            let distance = distance_sq(t.x, t.z, unit.x, unit.z).sqrt();
            distance <= t.range && t.weapon.preference(UnitKind::Demolition, distance) > t.engaged
        });
    let floor = if !waiting {
        0.0
    } else if under_fire {
        UNDER_FIRE_VALUE
    } else {
        GUARD_VALUE
    };
    let options: Vec<_> = strikes(
        units,
        buildings,
        unit.team,
        unit.id,
        (unit.x, unit.z),
        unit.hp,
    )
    .into_iter()
    .filter(|s| {
        !waiting || distance_sq(unit.rally_x, unit.rally_z, s.x, s.z) <= GUARD_RADIUS.powi(2)
    })
    .collect();
    let best = |value: fn(&Strike) -> f32| {
        options
            .iter()
            .filter(|s| value(s) > floor)
            .max_by(|a, b| {
                let score = |s: &Strike| {
                    value(s) / (1.0 + s.travel / HALF_VALUE_DRIVE)
                        * if Some(s.id) == unit.fuse.aim {
                            STICKINESS
                        } else {
                            1.0
                        }
                };
                score(a).total_cmp(&score(b))
            })
            .copied()
    };
    // A sent truck expected to be destroyed before any blast pays still
    // follows its order and drives at the most it could reach. So does a
    // waiting truck under fire: turning back would not save it.
    best(|s| s.expected).or_else(|| {
        if waiting && !under_fire {
            None
        } else {
            best(|s| s.reach)
        }
    })
}

/// Steer a truck for one step. Returns whether it detonates.
pub(super) fn drive(unit: &mut Unit, dt: f32, units: &[Unit], buildings: &[Building]) -> bool {
    let target = choose(unit, units, buildings);
    unit.fuse.aim = target.map(|s| s.id);
    let here = blast_value(units, buildings, unit.team, unit.id, (unit.x, unit.z));
    let fuse = &mut unit.fuse;
    if here <= 0.0 {
        fuse.best = 0.0;
        fuse.waiting = 0.0;
    } else if here > fuse.best + 1.0 {
        fuse.best = here;
        fuse.waiting = 0.0;
    } else {
        fuse.waiting += dt;
    }
    let stalled = fuse.waiting >= PATIENCE && here >= 0.75 * fuse.best;
    let detonate = unit.cooldown <= 0.0
        && here > 0.0
        && match target {
            Some(s) => here >= 0.999 * s.reach || (stalled && here >= 0.5 * s.reach),
            None => stalled && here >= GUARD_VALUE,
        };
    if detonate {
        return true;
    }
    match target {
        Some(s) => navigation::move_toward(
            unit,
            (s.x, s.z),
            s.stop,
            dt,
            units,
            buildings,
            navigation::RightOfWay::Assault,
        ),
        None if unit.state != UnitState::Attack => navigation::move_toward(
            unit,
            (unit.rally_x, unit.rally_z),
            0.15,
            dt,
            units,
            buildings,
            navigation::RightOfWay::Regroup,
        ),
        None => (),
    }
    false
}

impl Game {
    /// Send `team`'s waiting truck when it can expect to destroy at least
    /// `worth` credits anywhere. Uses the same order as selecting it and
    /// sending it.
    pub(super) fn send_truck(&mut self, team: Team, worth: f32) -> bool {
        let Some(truck) = self.units.iter().find(|u| {
            u.team == team && u.kind == UnitKind::Demolition && u.state == UnitState::Gather
        }) else {
            return false;
        };
        let send = strikes(
            &self.units,
            &self.buildings,
            team,
            truck.id,
            (truck.x, truck.z),
            truck.hp,
        )
        .into_iter()
        .max_by(|a, b| a.score().total_cmp(&b.score()))
        .is_some_and(|s| s.expected >= worth);
        if send {
            let id = truck.id;
            for u in self.units.iter_mut().filter(|u| u.id == id) {
                u.state = UnitState::Attack;
            }
        }
        send
    }
}
