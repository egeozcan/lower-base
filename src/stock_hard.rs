//! Frozen pre-upgrade hard commander for simulation comparisons only.
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

use super::*;

impl Game {
    pub(super) fn ai_stock_hard(&mut self, team: Team) {
        let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
        let mut opposing = Force::default();
        let mut incoming = Force::default();
        let mut own = Force::default();
        let mut local = Force::default();
        let mut reserves = 0;
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
                }
            } else if u.on_field() {
                opposing.add(u.kind, u.hp);
                if u.z * direction < -5.0 {
                    incoming.add(u.kind, u.hp);
                }
                if u.kind == UnitKind::Demolition {
                    trucks += 1;
                    if u.z * direction < -5.0 {
                        incoming_trucks += 1;
                    }
                }
            }
        }
        let pressure = incoming.power_against(&local);
        let defense = local.power_against(&incoming);
        let threatened = pressure > 0.0 || incoming_trucks > 0;
        let retreating = self.team_mode(team) == Mode::Retreat;
        let can_rebuild = self.alive_building(team, BuildingKind::Barracks)
            || self.alive_building(team, BuildingKind::Factory);
        let retreat =
            can_rebuild && threatened && pressure > defense * if retreating { 1.0 } else { 1.3 };
        if retreat && !retreating {
            self.set_team_mode(team, Mode::Retreat);
        } else if retreating && !retreat {
            self.set_team_mode(team, Mode::Gather);
        }

        let wave = if team == Team::Enemy {
            self.ai_wave_timer
        } else {
            self.demo_wave_timer
        };
        let advantage = own.power_against(&opposing) > opposing.power_against(&own) * 1.12;
        let launch = !retreat
            && reserves > 0
            && (threatened
                || !can_rebuild
                || (wave <= 0.0
                    && ((advantage && reserves >= 4)
                        || reserves >= 10
                        || (wave < -25.0 && reserves >= 6))));
        if launch {
            // Commit a group together instead of sending isolated reinforcements
            // into a superior force. This is the same selection order players use.
            for u in &mut self.units {
                if u.team == team && u.kind != UnitKind::Collector && u.state == UnitState::Gather {
                    u.state = UnitState::Attack;
                }
            }
            if team == Team::Enemy {
                self.ai_wave_timer = 6.0;
            } else {
                self.demo_wave_timer = 6.0;
            }
        }

        // Only count our own queues. No decisions inspect opposing production,
        // garrisons, credits, cooldowns, commands, or future random values.
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

        // Expand only while safe and while nearby ore can repay the investment.
        // Avoid tying the factory up with harvesters during a base assault.
        let safe_ore: f32 = self
            .ore
            .iter()
            .filter(|o| o.z * direction < -5.0)
            .map(|o| o.amount)
            .sum();
        let collector_goal = if self.time < 18.0 { 2 } else { 3 };
        let expand = !threatened
            && collectors < collector_goal
            && safe_ore > (collectors + 1) as f32 * 350.0
            && self.alive_building(team, BuildingKind::Refinery)
            && self.alive_building(team, BuildingKind::Factory)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty();
        if expand {
            self.queue_unit(team, UnitKind::Collector);
            if self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
            {
                return; // Save the actual purchase price, without free credit.
            }
        }

        // Rank marginal combat value per credit against the visible matchup.
        // Re-evaluate after each purchase so both queues complement each other.
        for _ in 0..2 {
            let base_power = own.power_against(&opposing);
            let best = COMBAT_KINDS
                .iter()
                .copied()
                .filter(|kind| {
                    self.alive_building(team, kind.production_building())
                        && self
                            .production_queue(team, kind.production_building())
                            .is_empty()
                })
                .map(|kind| {
                    let mut projected = own.clone();
                    projected.add(kind, kind.health());
                    let mut value = (projected.power_against(&opposing) - base_power) / kind.cost();
                    // Keep enough ranged anti-vehicle fire to stop visible trucks.
                    if kind == UnitKind::Rocket && own.count[1] < trucks as f32 * 2.0 {
                        value *= 2.5;
                    }
                    (kind, value)
                })
                .max_by(|a, b| a.1.total_cmp(&b.1));
            let Some((kind, _)) = best else {
                break;
            };
            let credits = if team == Team::Enemy {
                self.ai_credits
            } else {
                self.credits
            };
            if credits < kind.cost() {
                break; // Save for the counter instead of buying a weaker unit.
            }
            self.queue_unit(team, kind);
            own.add(kind, kind.health());
        }
        if team == Team::Enemy {
            self.ai_status = if retreat {
                "PRESERVING FORCES AND REGROUPING"
            } else if threatened {
                "REINFORCING LOCAL DEFENSE"
            } else if expand {
                "EXPANDING ORE INCOME"
            } else if launch {
                "COMMITTING A COORDINATED ASSAULT"
            } else {
                "PLANNING THE NEXT COUNTER"
            }
            .into();
        }
    }
}
