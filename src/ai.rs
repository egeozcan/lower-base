//! Difficulty changes decisions only. All orders use the normal production and
//! deployment paths; combat, movement, mining and income are shared with players.
use super::*;

const COMBAT_KINDS: [UnitKind; 3] = [UnitKind::Soldier, UnitKind::Rocket, UnitKind::Tank];

#[derive(Clone, Default)]
struct Force {
    count: [f32; 3],
    health: f32,
}

impl Force {
    fn add(&mut self, kind: UnitKind, hp: f32) {
        if let Some(i) = COMBAT_KINDS.iter().position(|&k| k == kind) {
            // Wounded units still fire at full speed until killed, but contribute
            // less staying power. Trucks are handled as a separate blast threat.
            self.count[i] += 1.0;
            self.health += hp;
        }
    }

    fn power_against(&self, other: &Self) -> f32 {
        let total: f32 = other.count.iter().sum();
        let dps: f32 = COMBAT_KINDS
            .iter()
            .enumerate()
            .map(|(i, &kind)| {
                let damage = if total > 0.0 {
                    COMBAT_KINDS
                        .iter()
                        .enumerate()
                        .map(|(j, &target)| kind.damage(Some(target)) * other.count[j] / total)
                        .sum()
                } else {
                    kind.damage(None)
                };
                // Range matters when closing on a firing line.
                self.count[i] * damage / kind.interval() * (kind.range() / 7.0).sqrt()
            })
            .sum();
        (self.health * dps).sqrt()
    }
}

// Rockets travel faster than tanks but have less range and much less health.
// Stagger their departure so the armored screen reaches the firing line first.
fn rocket_ready(unit: &Unit, units: &[Unit], launching: bool) -> bool {
    let target = units
        .iter()
        .filter(|u| u.team != unit.team && u.on_field() && COMBAT_KINDS.contains(&u.kind))
        .min_by(|a, b| {
            distance_sq(unit.x, unit.z, a.x, a.z).total_cmp(&distance_sq(unit.x, unit.z, b.x, b.z))
        });
    let Some(target) = target else {
        return true;
    };
    let distance = distance_sq(unit.x, unit.z, target.x, target.z).sqrt();
    if distance <= unit.kind.range() {
        return true;
    }
    let screen_eta = units
        .iter()
        .filter(|u| {
            u.team == unit.team
                && u.on_field()
                && u.kind == UnitKind::Tank
                && u.hp > u.max_hp * 0.35
                && (u.state == UnitState::Attack || launching)
        })
        .map(|u| {
            (distance_sq(u.x, u.z, target.x, target.z).sqrt() - u.kind.range()).max(0.0)
                / u.kind.speed()
        })
        .min_by(f32::total_cmp);
    screen_eta.is_none_or(|eta| (distance - unit.kind.range()) / unit.kind.speed() >= eta + 0.35)
}

impl Game {
    pub(super) fn ai_easy(&mut self, team: Team) {
        let wave = if team == Team::Enemy {
            self.ai_wave_timer
        } else {
            self.demo_wave_timer
        };
        // A slow, predictable commander: no counter-picking, one collector, and
        // small waves with long recovery windows. Its troops still fight normally.
        if wave <= -13.0 {
            for u in self
                .units
                .iter_mut()
                .filter(|u| {
                    u.team == team && u.kind != UnitKind::Collector && u.state == UnitState::Gather
                })
                .take(3)
            {
                u.state = UnitState::Attack;
            }
            if team == Team::Enemy {
                self.ai_wave_timer = 11.0;
            } else {
                self.demo_wave_timer = 11.0;
            }
        }
        let collectors = self
            .units
            .iter()
            .filter(|u| u.team == team && u.kind == UnitKind::Collector && u.hp > 0.0)
            .count();
        if self.time >= 24.0
            && collectors == 0
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
        {
            self.queue_unit(team, UnitKind::Collector);
        } else if self.time >= 50.0
            && (self.time as u32 / 4).is_multiple_of(3)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
        {
            self.queue_unit(team, UnitKind::Tank);
        }
        if self
            .production_queue(team, BuildingKind::Barracks)
            .is_empty()
        {
            let kind = if (self.time as u32 / 4) % 4 == 3 {
                UnitKind::Rocket
            } else {
                UnitKind::Soldier
            };
            self.queue_unit(team, kind);
        }
        if team == Team::Enemy {
            self.ai_status = "PREPARING A SMALL PATROL".into();
        }
    }
}

/// Plans persist for several decisions; randomness breaks close strategic and
/// production ties without overruling an emergency or a decisive counter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Strategy {
    Pressure,
    Economy,
    AntiArmor,
    AntiInfantry,
    Defend,
    Finish,
}

#[cfg_attr(feature = "dev-debug", derive(Serialize))]
pub(super) struct HardCommander {
    rng: u32,
    pub(super) strategy: Strategy,
    plan_until: f32,
    aggression: f32,
    economy: usize,
    // Opening pressure earns a short recovery window before a counterattack.
    rush_recovery_until: f32,
    pub(super) plans: [u32; 6],
}

impl HardCommander {
    pub(super) fn new(seed: u32) -> Self {
        // Avalanche nearby map seeds before drawing a personality. Separate
        // per-team streams never consume map generation or opponent randomness.
        let mut seed = seed.wrapping_add(0x9e3779b9);
        seed = (seed ^ (seed >> 16)).wrapping_mul(0x85ebca6b);
        seed = (seed ^ (seed >> 13)).wrapping_mul(0xc2b2ae35);
        seed ^= seed >> 16;
        let mut commander = Self {
            rng: seed,
            strategy: Strategy::Pressure,
            plan_until: 0.0,
            aggression: 0.0,
            economy: 2,
            rush_recovery_until: 0.0,
            plans: [0; 6],
        };
        commander.aggression = commander.random();
        commander.economy = if commander.random() < 0.35 { 3 } else { 2 };
        commander
    }

    fn random(&mut self) -> f32 {
        self.rng = self.rng.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.rng as f64 / 4294967296.0) as f32
    }
}

impl Game {
    /// Save for a prepared position against visible massed armor. Never spend
    /// emergency money on a pad already within enemy firing range.
    pub(super) fn prepare_emplacement(&mut self, team: Team) -> bool {
        if !self.alive_building(team, BuildingKind::Command) {
            return false;
        }
        let tanks = self
            .units
            .iter()
            .filter(|u| u.team != team && u.on_field() && u.kind == UnitKind::Tank)
            .count();
        let infantry = self
            .units
            .iter()
            .filter(|u| u.team != team && u.on_field() && u.kind == UnitKind::Soldier)
            .count();
        // Static defense must not divert reinforcements from an army that
        // already matches the opposing armor. This also avoids unnecessary
        // purchases when a successful rush defense turns into a counterattack.
        let own_tanks = self
            .units
            .iter()
            .filter(|u| u.team == team && u.hp > 0.0 && u.kind == UnitKind::Tank)
            .count();
        let goal = if tanks >= 5 {
            2
        } else if tanks >= 3 {
            1
        } else {
            0
        };
        let existing = self
            .buildings
            .iter()
            .filter(|b| b.team == team && b.hp > 0.0 && b.kind == BuildingKind::Emplacement)
            .count();
        if existing >= goal || infantry > tanks * 2 || own_tanks >= tanks {
            return false;
        }
        let pad = self
            .defense_slots
            .iter()
            .find(|p| {
                p.team == team
                    && !self
                        .buildings
                        .iter()
                        .any(|b| b.team == team && b.hp > 0.0 && b.defense_slot == Some(p.slot))
                    && !self.units.iter().any(|u| {
                        u.team != team
                            && u.on_field()
                            && u.kind != UnitKind::Collector
                            && distance_sq(p.x, p.z, u.x, u.z) < 18.0_f32.powi(2)
                    })
            })
            .copied();
        let Some(pad) = pad else { return false };
        let built = self.build_emplacement_for(team, pad.slot);
        if team == Team::Enemy {
            self.ai_status = "PREPARING AN ANTI-TANK POSITION".into();
        }
        !built
    }

    fn demolition_interception(&self, team: Team) -> bool {
        if !self.alive_building(team, BuildingKind::Factory) || self.has_demolition(team) {
            return false;
        }
        let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
        let credits = if team == Team::Enemy {
            self.ai_credits
        } else {
            self.credits
        };
        let progress = if team == Team::Enemy {
            self.enemy_factory_progress
        } else {
            self.factory_progress
        };
        let wait = (self
            .production_queue(team, BuildingKind::Factory)
            .iter()
            .map(|kind| kind.build_time())
            .sum::<f32>()
            - progress)
            .max(0.0);
        let ready_in = wait
            + UnitKind::Demolition.build_time()
            + (UnitKind::Demolition.cost() - credits).max(0.0) / PASSIVE_INCOME;
        let index = self
            .units
            .iter()
            .filter(|u| {
                u.team == team && matches!(u.state, UnitState::Gather | UnitState::Garrison)
            })
            .count();
        let start_x = ((index % 7) as f32 - 3.0) * 3.4;
        let start_z = -(35.0 + (index / 7).min(3) as f32 * 2.2);
        for anchor in self.units.iter().filter(|u| {
            u.team != team
                && u.on_field()
                && COMBAT_KINDS.contains(&u.kind)
                && u.z * direction < 25.0
        }) {
            let cluster: Vec<_> = self
                .units
                .iter()
                .filter(|u| {
                    u.team != team
                        && u.on_field()
                        && COMBAT_KINDS.contains(&u.kind)
                        && distance_sq(anchor.x, anchor.z, u.x, u.z) <= DEMOLITION_RADIUS.powi(2)
                })
                .collect();
            let speed = cluster.iter().map(|u| u.kind.speed()).fold(0.0, f32::max);
            let after_build = anchor.z * direction - speed * ready_in;
            if after_build <= start_z {
                continue;
            }
            let travel = ((anchor.x - start_x).powi(2) + (after_build - start_z).powi(2)).sqrt()
                / (speed + UnitKind::Demolition.speed());
            // Detonation happens at attack range, before the truck reaches the
            // enemy center. Its blast is correspondingly closer to our base.
            let detonation_offset = UnitKind::Demolition.range() * UnitKind::Demolition.speed()
                / (speed + UnitKind::Demolition.speed());
            let blast_z = (after_build - speed * travel - detonation_offset) * direction;
            // Intercept in front of the base, with a margin for the prediction.
            if self.buildings.iter().any(|b| {
                b.team == team && b.hp > 0.0 && {
                    let (hx, hz) = building_half_size(b.kind);
                    let dx = ((b.x - anchor.x).abs() - hx).max(0.0);
                    let dz = ((b.z - blast_z).abs() - hz).max(0.0);
                    dx * dx + dz * dz < (DEMOLITION_RADIUS + 1.0).powi(2)
                }
            }) {
                continue;
            }
            let enemy_value: f32 = cluster
                .iter()
                .map(|u| {
                    u.kind.cost()
                        * demolition_damage(distance_sq(anchor.x, anchor.z, u.x, u.z).sqrt())
                            .min(u.hp)
                        / u.max_hp
                })
                .sum();
            // Long-range weapons that kill the truck in one volley prevent it
            // reaching the blast radius. Do not replace useful counters with it.
            let ranged_burst: f32 = cluster
                .iter()
                .filter(|u| u.kind.range() > DEMOLITION_RADIUS)
                .map(|u| u.kind.damage(Some(UnitKind::Demolition)))
                .sum();
            if ranged_burst >= UnitKind::Demolition.health() {
                continue;
            }
            let friendly_value: f32 = self
                .units
                .iter()
                .filter(|u| u.team == team && u.on_field())
                .map(|u| {
                    (u.kind.cost() + u.cargo)
                        * demolition_damage(distance_sq(anchor.x, blast_z, u.x, u.z).sqrt())
                            .min(u.hp)
                        / u.max_hp
                })
                .sum();
            let covered = self.units.iter().any(|u| {
                u.team == team
                    && u.on_field()
                    && COMBAT_KINDS.contains(&u.kind)
                    && distance_sq(anchor.x, blast_z, u.x, u.z) < (DEMOLITION_RADIUS + 3.0).powi(2)
            });
            if !covered
                && (cluster.len() >= 4 || enemy_value >= 250.0)
                && enemy_value - friendly_value >= 180.0
            {
                return true;
            }
        }
        false
    }

    pub(super) fn ai_hard(&mut self, team: Team) {
        let index = if team == Team::Player { 0 } else { 1 };
        let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
        let mut opposing = Force::default();
        let mut incoming = Force::default();
        let mut own = Force::default();
        let mut local = Force::default();
        let mut reserves = 0;
        let mut attackers = 0;
        let mut collectors = 0;
        let mut trucks = 0;
        let mut incoming_trucks = 0;
        for u in self.units.iter().filter(|u| u.hp > 0.0) {
            if u.team == team {
                own.add(u.kind, u.hp);
                if u.z * direction < 5.0 {
                    local.add(u.kind, u.hp);
                }
                if u.kind == UnitKind::Collector {
                    collectors += 1;
                } else if matches!(u.state, UnitState::Gather | UnitState::Garrison) {
                    reserves += 1;
                } else {
                    attackers += 1;
                }
            } else if u.on_field() {
                opposing.add(u.kind, u.hp);
                if u.z * direction < -5.0 {
                    incoming.add(u.kind, u.hp);
                    if u.kind == UnitKind::Demolition {
                        incoming_trucks += 1;
                    }
                }
                if u.kind == UnitKind::Demolition {
                    trucks += 1;
                }
            }
        }
        let pressure = incoming.power_against(&local);
        let defense = local.power_against(&incoming);
        let threatened = pressure > 0.0 || incoming_trucks > 0;
        let advantage = own.power_against(&opposing) / opposing.power_against(&own).max(1.0);
        let can_rebuild = self.alive_building(team, BuildingKind::Barracks)
            || self.alive_building(team, BuildingKind::Factory);
        let enemy_production = self
            .buildings
            .iter()
            .filter(|b| {
                b.team != team
                    && b.hp > 0.0
                    && matches!(b.kind, BuildingKind::Barracks | BuildingKind::Factory)
            })
            .count();
        let safe_ore: f32 = self
            .ore
            .iter()
            .filter(|o| o.z * direction < -5.0)
            .map(|o| o.amount)
            .sum();
        let refinery = self.alive_building(team, BuildingKind::Refinery);

        let commander = &mut self.hard_commanders[index];
        // React to visible opening pressure, never a benchmark scenario flag.
        // Preserve the firing line instead of chasing survivors before the first
        // miners can pay for replacement troops. Ordinary openings are unchanged.
        if self.time < 8.0 && threatened {
            commander.rush_recovery_until = self.time + 50.0;
        }
        // Stronger counters reward a consolidated firing line. End recovery
        // early only after income is restored and a safe counterattack exists.
        let counterattack_ready =
            self.time > 20.0 && collectors >= 2 && !threatened && advantage > 1.8;
        let recovering_rush = self.time < commander.rush_recovery_until && !counterattack_ready;
        // Immediate threats override plan commitment. Otherwise choose between
        // condition-appropriate plans, and retain them long enough to execute.
        let urgent = if threatened && pressure > defense * 0.85 {
            Some(Strategy::Defend)
        } else if enemy_production == 0 || (advantage > 1.8 && self.time > 25.0) {
            Some(Strategy::Finish)
        } else if trucks > 0 || opposing.count[2] > opposing.count[0] * 0.6 + 1.0 {
            Some(Strategy::AntiArmor)
        } else if opposing.count[0] > opposing.count[2] * 2.0 + 3.0 {
            Some(Strategy::AntiInfantry)
        } else {
            None
        };
        if urgent.is_some_and(|s| s != commander.strategy)
            || self.time >= commander.plan_until
            || (commander.strategy == Strategy::Defend && !threatened)
        {
            commander.strategy = urgent.unwrap_or_else(|| {
                if !threatened
                    && refinery
                    && safe_ore > 1200.0
                    && collectors < commander.economy
                    && advantage >= 0.9
                    && commander.random() < 0.6
                {
                    Strategy::Economy
                } else {
                    Strategy::Pressure
                }
            });
            commander.plan_until = self.time + 8.0 + commander.random() * 10.0;
            commander.plans[commander.strategy as usize] += 1;
        }
        let strategy = commander.strategy;
        let aggression = commander.aggression;
        if team == Team::Enemy {
            self.ai_status = match strategy {
                Strategy::Defend => "HOLDING THE LINE AND REBUILDING",
                Strategy::Finish => "PRESSING THE ADVANTAGE",
                Strategy::AntiArmor => "ASSEMBLING AN ANTI-ARMOR FORCE",
                Strategy::AntiInfantry => "COUNTERING INFANTRY WITH ARMOR",
                Strategy::Economy => "INVESTING IN ORE CONTROL",
                Strategy::Pressure if aggression > 0.5 => "MASSING A RAPID ASSAULT",
                Strategy::Pressure => "REINFORCING THE ADVANCE",
            }
            .into();
        }

        // Recall an outmatched army, but release sheltered reinforcements before
        // demanding global superiority. Waiting for that can concede the base.
        let active_interceptor = self
            .units
            .iter()
            .any(|u| u.team == team && u.hp > 0.0 && u.kind == UnitKind::Demolition)
            && self.units.iter().any(|u| {
                u.team != team
                    && u.on_field()
                    && COMBAT_KINDS.contains(&u.kind)
                    && u.z * direction < 25.0
            });
        let retreating = self.team_mode(team) == Mode::Retreat;
        let retreat = can_rebuild
            && !active_interceptor
            && threatened
            && pressure > defense * if retreating { 1.05 } else { 1.8 }
            && !self.units.iter().any(|u| {
                u.team != team
                    && u.on_field()
                    && u.kind != UnitKind::Collector
                    && u.z * direction < -27.0
            });
        if retreat && !retreating {
            self.set_team_mode(team, Mode::Retreat);
        } else if retreating && !retreat {
            self.set_team_mode(team, Mode::Gather);
        }
        if active_interceptor {
            // Release through the normal Gather order if it completed while
            // sheltered, then send the truck separately from the reserves.
            for u in self.units.iter_mut().filter(|u| {
                u.team == team && u.kind == UnitKind::Demolition && u.state == UnitState::Gather
            }) {
                u.state = UnitState::Attack;
            }
            if team == Team::Enemy {
                self.ai_status = "INTERCEPTING AN UNOPPOSED WAVE".into();
            }
        }
        let wave = if team == Team::Enemy {
            self.ai_wave_timer
        } else {
            self.demo_wave_timer
        };
        let group_size = match strategy {
            Strategy::Pressure => {
                if aggression > 0.5 {
                    5
                } else {
                    6
                }
            }
            Strategy::Economy => 8,
            Strategy::Finish => 2,
            _ => 5,
        };
        // Reserves can be picked off row by row if they wait for a global
        // advantage while longer-ranged enemies fire on the front line. Join
        // that local fight when the defensive army can support the advance.
        // Armor-dominated enemy lines still need the patient screened response.
        let defending_contact = self.units.iter().any(|u| {
            u.team == team
                && u.state == UnitState::Gather
                && COMBAT_KINDS.contains(&u.kind)
                && self.units.iter().any(|enemy| {
                    enemy.team != team
                        && enemy.on_field()
                        && COMBAT_KINDS.contains(&enemy.kind)
                        && distance_sq(u.x, u.z, enemy.x, enemy.z) <= enemy.kind.range().powi(2)
                        && distance_sq(u.x, u.z, enemy.x, enemy.z) > u.kind.range().powi(2)
                })
        });
        let launch = !retreat
            && (!recovering_rush || !can_rebuild)
            && reserves > 0
            && ((threatened && advantage > 1.25 + aggression * 0.2)
                || (threatened
                    && defending_contact
                    && opposing.count[1] > opposing.count[2]
                    && advantage > 0.9
                    && defense > pressure * 1.05)
                || !can_rebuild
                || (wave <= 0.0
                    && ((reserves >= group_size && advantage > 1.25 + aggression * 0.2)
                        || (attackers >= 3 && reserves >= 1 && advantage > 1.2)
                        || (advantage > 1.6 && reserves >= 3)
                        || (wave < -24.0 && advantage > 1.15)
                        // Equal armies must eventually contest the map. Vary the
                        // deadline, but never use it to charge an overwhelming
                        // force or abandon a base that is already under attack.
                        || (!threatened && wave < -(18.0 + aggression * 12.0)
                            && reserves >= group_size.max(6) && advantage > 0.85))));
        // Delay rocket-heavy waves against an armored firing line. A lone
        // support rocket in a mixed assault does not need formation management.
        let screen_rockets = opposing.count[2] >= 3.0
            && opposing.count[2] >= opposing.count[0] + opposing.count[1]
            && own.count[1] >= 3.0
            && own.count[1] > own.count[2]
            && own.count[2] > 0.0;
        let follow_screen = screen_rockets
            && self.units.iter().any(|u| {
                u.team == team
                    && u.on_field()
                    && u.kind == UnitKind::Tank
                    && u.state == UnitState::Attack
                    && u.hp > u.max_hp * 0.35
            })
            && advantage > 0.9
            && !retreat
            && !recovering_rush;
        if launch || follow_screen {
            let ready: Vec<u32> = self
                .units
                .iter()
                .filter(|u| {
                    u.team == team
                        && u.kind == UnitKind::Rocket
                        && u.state == UnitState::Gather
                        && (!screen_rockets || rocket_ready(u, &self.units, launch))
                })
                .map(|u| u.id)
                .collect();
            for u in &mut self.units {
                if u.team == team
                    && u.kind != UnitKind::Collector
                    && u.state == UnitState::Gather
                    && ((launch && u.kind != UnitKind::Rocket) || ready.contains(&u.id))
                {
                    u.state = UnitState::Attack;
                }
            }
        }
        if launch {
            let delay = 2.5 + self.hard_commanders[index].random() * 3.5;
            if team == Team::Enemy {
                self.ai_wave_timer = delay;
            } else {
                self.demo_wave_timer = delay;
            }
        }
        // Own queued units count toward composition and economic investment.
        // Opposing queues, money and garrisons are never consulted.
        for &kind in self
            .production_queue(team, BuildingKind::Barracks)
            .iter()
            .chain(self.production_queue(team, BuildingKind::Factory))
        {
            own.add(kind, kind.health());
            if kind == UnitKind::Collector {
                collectors += 1;
            }
        }
        if self.demolition_interception(team) {
            self.queue_unit(team, UnitKind::Demolition);
            if team == Team::Enemy {
                self.ai_status = "PREPARING A DEMOLITION INTERCEPTION".into();
            }
            // Saving for this real purchase must not be undercut by smaller
            // purchases. Normal credit, factory, queue and one-truck rules apply.
            if !self.has_demolition(team) {
                return;
            }
        }
        if self.prepare_emplacement(team) {
            return;
        }
        let enemy_emplacements = self
            .buildings
            .iter()
            .filter(|b| b.team != team && b.hp > 0.0 && b.kind == BuildingKind::Emplacement)
            .count() as f32;
        let collector_goal = if recovering_rush {
            2
        } else if strategy == Strategy::Economy {
            self.hard_commanders[index].economy
        } else if self.time < 25.0 {
            1
        } else {
            2
        };
        // A few surviving riflemen should not block economic recovery when
        // our defenders comfortably outmatch them. Armor and trucks remain a
        // reason to keep the factory on emergency combat production.
        let manageable_rush = recovering_rush
            && incoming.count[2] == 0.0
            && incoming_trucks == 0
            && defense > pressure * 1.4;
        let expand = (!threatened || manageable_rush)
            && (strategy != Strategy::Finish || recovering_rush)
            && refinery
            && collectors < collector_goal
            && safe_ore > (collectors + 1) as f32 * 500.0
            && self.alive_building(team, BuildingKind::Factory)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
            && (collectors == 0
                || (attackers == 0 && advantage > 0.95)
                || (self.time > 40.0 && advantage > 1.2 && own.health > 900.0));
        if expand {
            self.queue_unit(team, UnitKind::Collector);
            if self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
            {
                return;
            }
        }

        // Score marginal power with a composition target. Pure health/DPS
        // optimization undervalues the first few rockets against armored armies.
        for _ in 0..2 {
            let base_power = own.power_against(&opposing) / opposing.power_against(&own).max(1.0);
            let mut choices = Vec::new();
            for (i, kind) in COMBAT_KINDS.into_iter().enumerate() {
                if !self.alive_building(team, kind.production_building())
                    || !self
                        .production_queue(team, kind.production_building())
                        .is_empty()
                {
                    continue;
                }
                let mut projected = own.clone();
                projected.add(kind, kind.health());
                let desired = match kind {
                    UnitKind::Soldier => {
                        1.0 + opposing.count[1] * 1.4
                            + opposing.count[0] * 0.25
                            + enemy_emplacements * 4.0
                    }
                    UnitKind::Rocket => 1.0 + opposing.count[2] * 1.8 + trucks as f32 * 3.0,
                    _ => 1.0 + opposing.count[0] * 0.65,
                };
                let coverage = (desired / (own.count[i] + 1.0)).clamp(0.45, 2.5);
                let mut score = (projected.power_against(&opposing)
                    / opposing.power_against(&projected).max(1.0)
                    - base_power)
                    / kind.cost()
                    * coverage;
                if (strategy == Strategy::AntiArmor && kind == UnitKind::Rocket)
                    || (strategy == Strategy::AntiInfantry && kind == UnitKind::Tank)
                {
                    score *= 1.2;
                }
                // Independent random values only perturb near-equal choices.
                score *= 0.92 + self.hard_commanders[index].random() * 0.16;
                choices.push((kind, score));
            }
            choices.sort_by(|a, b| b.1.total_cmp(&a.1));
            let Some(&(kind, _)) = choices.first() else {
                break;
            };
            let credits = if team == Team::Enemy {
                self.ai_credits
            } else {
                self.credits
            };
            if credits < kind.cost() {
                break;
            }
            self.queue_unit(team, kind);
            own.add(kind, kind.health());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFFICULTIES: [Difficulty; 3] = [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard];

    fn unopposed_infantry(team: Team, kind: UnitKind, z: f32) -> Game {
        let mut game = Game::with_difficulty(26, Difficulty::Hard);
        game.units.clear();
        game.ai_decision_timer = f32::INFINITY;
        let opponent = if team == Team::Player {
            Team::Enemy
        } else {
            Team::Player
        };
        let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
        for i in 0..8 {
            game.spawn(opponent, kind);
            let unit = game.units.last_mut().unwrap();
            unit.x = (i % 4) as f32 * 2.0 - 3.0;
            unit.z = (z + (i / 4) as f32 * 2.0) * direction;
            unit.state = UnitState::Attack;
        }
        game
    }

    #[test]
    fn hard_builds_and_sends_a_truck_to_break_an_unopposed_wave() {
        for team in [Team::Player, Team::Enemy] {
            let mut game = unopposed_infantry(team, UnitKind::Soldier, 24.0);
            assert!(game.demolition_interception(team));
            game.ai_hard(team);
            assert!(game
                .production_queue(team, BuildingKind::Factory)
                .contains(&UnitKind::Demolition));
            let mut deployed = false;
            let mut exploded = false;
            for tick in 0..400 {
                if tick % 10 == 0 {
                    game.ai_hard(team);
                }
                game.update(0.05);
                deployed |= game.units.iter().any(|u| {
                    u.team == team && u.kind == UnitKind::Demolition && u.state == UnitState::Attack
                });
                exploded |= !game.explosions.is_empty();
                assert!(
                    game.units
                        .iter()
                        .filter(|u| u.team == team && u.kind == UnitKind::Demolition)
                        .count()
                        <= 1
                );
            }
            assert!(deployed, "the truck must not wait in reserve or shelter");
            assert!(exploded, "the interception must reach an actual detonation");
            assert!(
                game.units.iter().all(|u| u.team == team),
                "the incoming wave should be eliminated"
            );
            assert!(
                game.buildings
                    .iter()
                    .filter(|b| b.team == team)
                    .all(|b| b.hp == b.max_hp),
                "intercept before the base is damaged"
            );
        }
    }

    #[test]
    fn trucks_are_not_bought_into_one_volley_counters_or_unsafe_late_intercepts() {
        for team in [Team::Player, Team::Enemy] {
            for (kind, z) in [
                (UnitKind::Rocket, 24.0),
                (UnitKind::Tank, 24.0),
                (UnitKind::Soldier, -20.0),
                (UnitKind::Soldier, 27.0),
            ] {
                let mut game = unopposed_infantry(team, kind, z);
                assert!(
                    !game.demolition_interception(team),
                    "{team:?} {kind:?} at {z}"
                );
                game.ai_hard(team);
                assert!(!game
                    .production_queue(team, BuildingKind::Factory)
                    .contains(&UnitKind::Demolition));
            }
            let mut game = unopposed_infantry(team, UnitKind::Soldier, 24.0);
            game.units
                .iter_mut()
                .filter(|u| u.team != team)
                .for_each(|u| u.x *= 4.0);
            assert!(
                !game.demolition_interception(team),
                "a widely dispersed army is a poor blast target"
            );
        }
    }

    #[test]
    fn rockets_wait_for_armor_to_make_contact_but_can_fight_without_a_screen() {
        let mut game = Game::with_difficulty(5, Difficulty::Hard);
        game.units.clear();
        game.spawn(Team::Enemy, UnitKind::Tank);
        game.spawn(Team::Enemy, UnitKind::Rocket);
        game.spawn(Team::Player, UnitKind::Tank);
        for unit in &mut game.units {
            unit.x = 0.0;
            unit.z = if unit.team == Team::Enemy {
                -25.0
            } else {
                25.0
            };
        }
        // Equal departure positions would put the faster, shorter-ranged rocket
        // in front. Releasing it now repeats the captured player's exploit.
        assert!(!rocket_ready(&game.units[1], &game.units, true));
        game.units[0].z = -12.0;
        assert!(rocket_ready(&game.units[1], &game.units, true));
        game.units[0].hp = 0.0;
        assert!(rocket_ready(&game.units[1], &game.units, true));
        game.units[0].hp = UnitKind::Tank.health();
        game.units[0].z = -30.0;
        game.units[2].z = -16.0;
        assert!(
            rocket_ready(&game.units[1], &game.units, true),
            "do not delay units already in combat"
        );
    }

    #[test]
    fn rocket_screening_ignores_sheltered_opponents() {
        let mut game = Game::with_difficulty(5, Difficulty::Hard);
        game.units.clear();
        game.spawn(Team::Enemy, UnitKind::Tank);
        game.spawn(Team::Enemy, UnitKind::Rocket);
        game.spawn(Team::Player, UnitKind::Tank);
        for unit in &mut game.units {
            unit.x = 0.0;
            unit.z = if unit.team == Team::Enemy {
                -25.0
            } else {
                25.0
            };
        }
        let before = rocket_ready(&game.units[1], &game.units, true);
        game.set_team_mode(Team::Player, Mode::Retreat);
        game.spawn(Team::Player, UnitKind::Tank);
        let hidden = game.units.last_mut().unwrap();
        hidden.x = 0.0;
        hidden.z = -24.0;
        assert_eq!(rocket_ready(&game.units[1], &game.units, true), before);
    }

    #[test]
    fn medium_is_the_default_and_unknown_difficulties_fall_back_to_it() {
        assert_eq!(Game::new().difficulty, Difficulty::Medium);
        assert_eq!(Game::demo_with_seed(5).difficulty, Difficulty::Medium);
        assert_eq!(Difficulty::parse("invalid"), Difficulty::Medium);
        for (name, expected) in [
            ("easy", Difficulty::Easy),
            ("medium", Difficulty::Medium),
            ("hard", Difficulty::Hard),
        ] {
            assert_eq!(Difficulty::parse(name), expected);
        }
    }

    #[test]
    fn every_difficulty_has_equal_starting_resources_income_and_caps() {
        for difficulty in DIFFICULTIES {
            for demo in [false, true] {
                let mut g = if demo {
                    Game::demo_with_difficulty(5, difficulty)
                } else {
                    Game::with_difficulty(5, difficulty)
                };
                assert_eq!(g.credits, 500.0);
                assert_eq!(g.ai_credits, g.credits);
                g.ai_decision_timer = f32::INFINITY;
                g.update(0.25);
                assert!((g.credits - 506.0).abs() < 0.001);
                assert_eq!(g.credits, g.ai_credits);
                g.credits = 1999.0;
                g.ai_credits = 1999.0;
                g.update(0.25);
                assert_eq!(g.credits, 2000.0);
                assert_eq!(g.ai_credits, g.credits);
            }
        }
    }

    fn orders(g: &Game, team: Team) -> (Vec<UnitKind>, Vec<UnitKind>, Mode, Vec<UnitState>) {
        (
            g.production_queue(team, BuildingKind::Barracks).to_vec(),
            g.production_queue(team, BuildingKind::Factory).to_vec(),
            g.team_mode(team),
            g.units
                .iter()
                .filter(|u| u.team == team)
                .map(|u| u.state)
                .collect(),
        )
    }

    #[test]
    fn decisions_do_not_change_when_private_opponent_information_changes() {
        for difficulty in DIFFICULTIES {
            for team in [Team::Player, Team::Enemy] {
                let mut baseline = Game::with_difficulty(26, difficulty);
                let mut hidden = Game::with_difficulty(26, difficulty);
                let opponent = if team == Team::Player {
                    Team::Enemy
                } else {
                    Team::Player
                };
                // Change queues, money and protected garrisons without changing
                // anything the commander can see on the open battlefield.
                if opponent == Team::Player {
                    hidden.factory_queue = vec![UnitKind::Tank; 8];
                    hidden.barracks_queue = vec![UnitKind::Rocket; 8];
                    hidden.credits = 0.0;
                } else {
                    hidden.enemy_factory_queue = vec![UnitKind::Tank; 8];
                    hidden.enemy_barracks_queue = vec![UnitKind::Rocket; 8];
                    hidden.ai_credits = 0.0;
                }
                hidden.set_team_mode(opponent, Mode::Retreat);
                for _ in 0..8 {
                    hidden.spawn(opponent, UnitKind::Rocket);
                }
                hidden.spawn(opponent, UnitKind::Demolition);
                baseline.time = 40.0;
                hidden.time = 40.0;
                baseline.ai_decide_for(team);
                hidden.ai_decide_for(team);
                assert_eq!(
                    orders(&baseline, team),
                    orders(&hidden, team),
                    "{difficulty:?} {team:?}"
                );
            }
        }
    }

    #[test]
    fn ai_orders_obey_money_buildings_queue_limits_and_demolition_limit() {
        for difficulty in DIFFICULTIES {
            let mut g = Game::with_difficulty(5, difficulty);
            g.ai_credits = 59.0;
            g.queue_unit(Team::Enemy, UnitKind::Soldier);
            assert_eq!(g.ai_credits, 59.0);
            assert!(g.enemy_barracks_queue.is_empty());
            g.ai_credits = 2000.0;
            for _ in 0..10 {
                g.queue_unit(Team::Enemy, UnitKind::Soldier);
            }
            assert_eq!(g.enemy_barracks_queue.len(), QUEUE_LIMIT);
            assert_eq!(g.ai_credits, 2000.0 - 60.0 * QUEUE_LIMIT as f32);
            g.queue_unit(Team::Enemy, UnitKind::Demolition);
            g.queue_unit(Team::Enemy, UnitKind::Demolition);
            assert_eq!(g.enemy_factory_queue, vec![UnitKind::Demolition]);
            g.enemy_factory_queue.clear();
            g.buildings
                .retain(|b| b.team != Team::Enemy || b.kind == BuildingKind::Command);
            let credits = g.ai_credits;
            for kind in [UnitKind::Collector, UnitKind::Tank, UnitKind::Demolition] {
                g.queue_unit(Team::Enemy, kind);
            }
            assert!(g.enemy_factory_queue.is_empty());
            assert_eq!(g.ai_credits, credits);
        }
    }

    #[test]
    fn hard_counters_visible_armor_and_protects_its_economy_under_pressure() {
        let mut g = Game::with_difficulty(5, Difficulty::Hard);
        g.time = 40.0;
        for _ in 0..6 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
            u.z = -15.0;
        }
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));
        assert!(!g.enemy_factory_queue.contains(&UnitKind::Collector));
        assert_eq!(g.enemy_mode, Mode::Retreat);
        for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
            u.z = 30.0;
        }
        g.ai_credits = 500.0;
        g.enemy_factory_queue.clear();
        g.ai_decide();
        assert_eq!(g.enemy_mode, Mode::Gather);
        assert_eq!(g.enemy_factory_queue.first(), Some(&UnitKind::Collector));
    }

    #[test]
    fn hard_selects_visible_counters_and_spends_on_them() {
        for (opponent, expected, counter) in [
            (UnitKind::Tank, Strategy::AntiArmor, UnitKind::Rocket),
            (UnitKind::Soldier, Strategy::AntiInfantry, UnitKind::Tank),
            (UnitKind::Demolition, Strategy::AntiArmor, UnitKind::Rocket),
        ] {
            for team in [Team::Player, Team::Enemy] {
                let mut g = Game::with_difficulty(5, Difficulty::Hard);
                let other = if team == Team::Player {
                    Team::Enemy
                } else {
                    Team::Player
                };
                g.units.retain(|u| u.team == team);
                // An established economy removes expansion from this choice.
                for _ in 0..3 {
                    g.spawn(team, UnitKind::Collector);
                }
                for _ in 0..10 {
                    g.spawn(other, opponent);
                }
                g.credits = 2000.0;
                g.ai_credits = 2000.0;
                g.ai_hard(team);
                let index = if team == Team::Player { 0 } else { 1 };
                assert_eq!(g.hard_commanders[index].strategy, expected);
                assert_eq!(
                    g.production_queue(team, counter.production_building())
                        .first(),
                    Some(&counter)
                );
            }
        }
    }

    fn rush_position(team: Team) -> f32 {
        if team == Team::Enemy {
            -12.0
        } else {
            12.0
        }
    }

    #[test]
    fn hard_holds_the_line_and_funds_miners_against_outmatched_rush_survivors() {
        for team in [Team::Player, Team::Enemy] {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            let other = if team == Team::Player {
                Team::Enemy
            } else {
                Team::Player
            };
            g.units.retain(|u| u.team == team);
            for _ in 0..5 {
                g.spawn(team, UnitKind::Tank);
            }
            g.spawn(other, UnitKind::Soldier);
            for u in g.units.iter_mut().filter(|u| u.team == other) {
                u.z = rush_position(team);
            }
            g.ai_wave_timer = -30.0;
            g.demo_wave_timer = -30.0;
            g.ai_hard(team);
            let index = if team == Team::Player { 0 } else { 1 };
            assert!(
                g.hard_commanders[index].rush_recovery_until > 0.0
                    && g.hard_commanders[index].rush_recovery_until <= 60.0
            );
            assert!(g
                .units
                .iter()
                .filter(|u| u.team == team)
                .all(|u| u.state == UnitState::Gather));
            assert_eq!(
                g.production_queue(team, BuildingKind::Factory).first(),
                Some(&UnitKind::Collector)
            );
            // Once recovery ends, a favorable counterattack is allowed.
            g.time = g.hard_commanders[index].rush_recovery_until + 1.0;
            g.units.retain(|u| u.team == team);
            g.ai_hard(team);
            assert!(g
                .units
                .iter()
                .any(|u| u.team == team && u.state == UnitState::Attack));
        }
    }

    #[test]
    fn rush_recovery_never_replaces_armor_or_truck_defense_with_collectors() {
        for kind in [UnitKind::Tank, UnitKind::Demolition] {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            g.units.retain(|u| u.team == Team::Enemy);
            for _ in 0..5 {
                g.spawn(Team::Enemy, UnitKind::Tank);
            }
            g.spawn(Team::Player, kind);
            for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
                u.z = -12.0;
            }
            g.ai_hard(Team::Enemy);
            assert!(g.hard_commanders[1].rush_recovery_until > g.time);
            assert!(!g.enemy_factory_queue.contains(&UnitKind::Collector));
        }
    }

    #[test]
    fn ordinary_and_late_pressure_do_not_trigger_opening_recovery() {
        for late_pressure in [false, true] {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            if late_pressure {
                g.time = 9.0;
                for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
                    u.z = -12.0;
                }
            }
            g.ai_hard(Team::Enemy);
            assert_eq!(g.hard_commanders[1].rush_recovery_until, 0.0);
        }
    }

    #[test]
    fn rush_recovery_ends_early_when_income_and_a_decisive_counterattack_are_ready() {
        let mut game = unopposed_infantry(Team::Enemy, UnitKind::Soldier, -12.0);
        for _ in 0..8 {
            game.spawn(Team::Enemy, UnitKind::Tank);
        }
        game.ai_hard(Team::Enemy);
        assert!(game.hard_commanders[1].rush_recovery_until > 20.0);
        game.units.retain(|u| u.team == Team::Enemy);
        game.spawn(Team::Enemy, UnitKind::Collector);
        game.spawn(Team::Enemy, UnitKind::Collector);
        game.time = 21.0;
        game.ai_wave_timer = -10.0;
        game.ai_hard(Team::Enemy);
        assert!(game.units.iter().any(|u| u.team == Team::Enemy
            && u.kind == UnitKind::Tank
            && u.state == UnitState::Attack));
    }

    #[test]
    fn opening_recovery_does_not_hold_the_last_army_after_production_is_lost() {
        let mut g = Game::with_difficulty(26, Difficulty::Hard);
        for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
            u.z = -12.0;
        }
        g.buildings.retain(|b| {
            b.team != Team::Enemy
                || !matches!(b.kind, BuildingKind::Barracks | BuildingKind::Factory)
        });
        g.ai_hard(Team::Enemy);
        assert!(g
            .units
            .iter()
            .any(|u| u.team == Team::Enemy && u.state == UnitState::Attack));
    }

    #[test]
    fn hard_releases_sheltered_defenders_when_the_base_is_breached() {
        for team in [Team::Player, Team::Enemy] {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            let other = if team == Team::Player {
                Team::Enemy
            } else {
                Team::Player
            };
            g.set_team_mode(team, Mode::Retreat);
            g.spawn(team, UnitKind::Rocket);
            for _ in 0..10 {
                g.spawn(other, UnitKind::Tank);
            }
            let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
            for u in g.units.iter_mut().filter(|u| u.team == other) {
                u.z = -direction * 32.0;
            }
            g.ai_hard(team);
            assert_eq!(g.team_mode(team), Mode::Gather);
            assert!(g
                .units
                .iter()
                .filter(|u| u.team == team)
                .all(|u| u.state != UnitState::Garrison));
            assert!(!g
                .production_queue(team, BuildingKind::Factory)
                .contains(&UnitKind::Collector));
        }
    }

    #[test]
    fn hard_does_not_invest_in_a_depleted_or_destroyed_economy() {
        for refinery in [false, true] {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            if refinery {
                g.ore.clear();
            } else {
                g.buildings
                    .retain(|b| b.team != Team::Enemy || b.kind != BuildingKind::Refinery);
            }
            g.ai_hard(Team::Enemy);
            assert_ne!(g.hard_commanders[1].strategy, Strategy::Economy);
            assert!(!g.enemy_factory_queue.contains(&UnitKind::Collector));
        }
    }

    #[test]
    fn hard_finishes_when_visible_enemy_production_is_destroyed() {
        let mut g = Game::with_difficulty(26, Difficulty::Hard);
        g.buildings.retain(|b| {
            b.team != Team::Player
                || !matches!(b.kind, BuildingKind::Barracks | BuildingKind::Factory)
        });
        g.units.retain(|u| u.team == Team::Enemy);
        g.ai_wave_timer = 0.0;
        g.ai_hard(Team::Enemy);
        assert_eq!(g.hard_commanders[1].strategy, Strategy::Finish);
        assert!(g
            .units
            .iter()
            .filter(|u| u.team == Team::Enemy)
            .all(|u| u.state == UnitState::Attack));
        assert!(!g.enemy_factory_queue.contains(&UnitKind::Collector));
    }

    #[test]
    fn commander_randomness_is_repeatable_independent_and_changes_real_orders() {
        // Hold the map and visible armies fixed, varying only commander seeds.
        // Compare actual opening plans, production and wave timings, not RNG output.
        let opening = |seed| {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            g.hard_commanders[1] = HardCommander::new(seed);
            g.ai_decision_timer = f32::INFINITY;
            g.ai_hard(Team::Enemy);
            let plan = g.hard_commanders[1].strategy;
            let mut first_attack = None;
            for tick in 0..80 {
                if tick % 2 == 0 {
                    g.ai_hard(Team::Enemy);
                }
                if first_attack.is_none()
                    && g.units
                        .iter()
                        .any(|u| u.team == Team::Enemy && u.state == UnitState::Attack)
                {
                    first_attack = Some(tick);
                }
                g.update(0.25);
            }
            (plan, first_attack, serde_json::to_string(&g).unwrap())
        };
        let mut signatures = std::collections::HashSet::new();
        let mut plans = Vec::new();
        for seed in 0..16 {
            let result = opening(seed);
            plans.push(result.0);
            signatures.insert(format!("{:?}/{:?}", result.0, result.1));
            if seed == 5 {
                assert_eq!(result, opening(seed));
            }
        }
        assert!(plans.contains(&Strategy::Pressure));
        assert!(plans.contains(&Strategy::Economy));
        assert!(
            signatures.len() >= 3,
            "openings should vary on the same battlefield"
        );
        let mut a = Game::with_difficulty(26, Difficulty::Hard);
        let mut b = Game::with_difficulty(26, Difficulty::Hard);
        // The other commander's private RNG draws cannot perturb our decisions.
        for _ in 0..100 {
            b.hard_commanders[0].random();
        }
        a.ai_hard(Team::Enemy);
        b.ai_hard(Team::Enemy);
        assert_eq!(orders(&a, Team::Enemy), orders(&b, Team::Enemy));
    }

    #[test]
    fn hard_eventually_contests_an_even_army_but_does_not_suicide_on_a_deadline() {
        for overwhelming in [false, true] {
            let mut g = Game::with_difficulty(26, Difficulty::Hard);
            for _ in 0..5 {
                g.spawn(Team::Enemy, UnitKind::Soldier);
            }
            for _ in 0..5 {
                g.spawn(
                    Team::Player,
                    if overwhelming {
                        UnitKind::Tank
                    } else {
                        UnitKind::Soldier
                    },
                );
            }
            g.ai_wave_timer = -60.0;
            g.ai_hard(Team::Enemy);
            assert_eq!(
                g.units
                    .iter()
                    .any(|u| u.team == Team::Enemy && u.state == UnitState::Attack),
                !overwhelming
            );
        }
    }

    #[test]
    fn hard_demos_do_not_stall_when_both_commanders_are_cautious() {
        for seed in (0..16).chain([26, 1941]) {
            let mut g = Game::demo_with_difficulty(seed, Difficulty::Hard);
            for _ in 0..1200 {
                g.update(0.25);
                if g.outcome != Outcome::Playing {
                    break;
                }
            }
            assert!(
                g.player_kills + g.enemy_kills > 10,
                "seed {seed} never developed into a battle"
            );
            assert_ne!(
                g.outcome,
                Outcome::Playing,
                "seed {seed} stalled at {}s",
                g.time
            );
        }
    }

    #[test]
    fn hard_beats_lower_difficulties_across_seeds_and_starting_sides() {
        for weaker in [Difficulty::Easy, Difficulty::Medium] {
            let mut wins = 0;
            for seed in [5, 26, 1941] {
                for hard_team in [Team::Player, Team::Enemy] {
                    let mut g = Game::demo_with_seed(seed);
                    g.ai_decision_timer = f32::INFINITY;
                    let mut timers = [0.0f32; 2];
                    for _ in 0..1200 {
                        for (i, team) in [Team::Player, Team::Enemy].into_iter().enumerate() {
                            let difficulty = if team == hard_team {
                                Difficulty::Hard
                            } else {
                                weaker
                            };
                            timers[i] -= 0.25;
                            if timers[i] <= 0.0 {
                                g.difficulty = difficulty;
                                g.ai_decide_for(team);
                                timers[i] = difficulty.decision_interval();
                            }
                        }
                        g.update(0.25);
                        if g.outcome != Outcome::Playing {
                            break;
                        }
                    }
                    let won = g.outcome
                        == if hard_team == Team::Player {
                            Outcome::Victory
                        } else {
                            Outcome::Defeat
                        };
                    if won {
                        wins += 1;
                    }
                    eprintln!(
                        "Hard {hard_team:?} vs {weaker:?}, seed {seed}: {:?} at {:.0}s",
                        g.outcome, g.time
                    );
                }
            }
            eprintln!("Hard wins against {weaker:?}: {wins}/6");
            assert!(
                wins >= 5,
                "Hard should consistently beat {weaker:?}; won {wins}/6"
            );
        }
    }

    #[test]
    fn easy_is_beatable_with_a_simple_mixed_army_and_attack_order() {
        for seed in [5, 26, 1941] {
            let mut g = Game::with_difficulty(seed, Difficulty::Easy);
            for tick in 0..1000 {
                if tick % 20 == 0 {
                    g.train("soldier");
                }
                if tick % 60 == 0 {
                    g.train("rocket");
                }
                if tick % 48 == 0 {
                    g.train("tank");
                }
                if tick == 80 {
                    g.set_mode("attack");
                }
                g.update(0.25);
                if g.outcome != Outcome::Playing {
                    break;
                }
            }
            assert_eq!(g.outcome, Outcome::Victory, "seed {seed}, time {}", g.time);
        }
    }

    #[test]
    fn ai_and_human_units_take_the_same_time_and_have_the_same_stats() {
        for difficulty in DIFFICULTIES {
            for kind in [
                UnitKind::Soldier,
                UnitKind::Rocket,
                UnitKind::Tank,
                UnitKind::Demolition,
                UnitKind::Collector,
            ] {
                let mut g = Game::with_difficulty(5, difficulty);
                g.units.clear();
                g.ai_decision_timer = f32::INFINITY;
                g.queue_unit(Team::Player, kind);
                g.queue_unit(Team::Enemy, kind);
                for _ in 0..((kind.build_time() / 0.05) as usize - 1) {
                    g.update(0.05);
                }
                assert!(
                    g.units.is_empty(),
                    "no early completion: {difficulty:?} {kind:?}"
                );
                g.update(0.1);
                assert_eq!(g.units.len(), 2);
                for u in &g.units {
                    assert_eq!(u.hp, kind.health());
                    assert_eq!(u.max_hp, kind.health());
                    assert_eq!(u.kind, kind);
                }
                assert_eq!(g.credits, g.ai_credits);
            }
        }
    }
}
