use serde::Serialize;

#[path = "navigation.rs"]
mod navigation;

const FIELD_EDGE: f32 = 17.0;
const QUEUE_LIMIT: usize = 8;
const COLLECTOR_CAPACITY: f32 = 100.0;
const MINING_RATE: f32 = 25.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Team {
    Player,
    Enemy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitKind {
    Soldier,
    Rocket,
    Tank,
    Collector,
}

impl UnitKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "soldier" => Some(Self::Soldier),
            "rocket" => Some(Self::Rocket),
            "tank" => Some(Self::Tank),
            "collector" => Some(Self::Collector),
            _ => None,
        }
    }
    fn cost(self) -> f32 {
        match self {
            Self::Soldier => 60.0,
            Self::Rocket => 90.0,
            Self::Tank => 150.0,
            Self::Collector => 200.0,
        }
    }
    fn build_time(self) -> f32 {
        match self {
            Self::Soldier => 2.0,
            Self::Rocket => 2.8,
            Self::Tank => 4.0,
            Self::Collector => 5.0,
        }
    }
    fn health(self) -> f32 {
        match self {
            Self::Soldier => 100.0,
            Self::Rocket => 80.0,
            Self::Tank => 280.0,
            Self::Collector => 220.0,
        }
    }
    fn speed(self) -> f32 {
        match self {
            Self::Soldier => 7.4,
            Self::Rocket => 6.6,
            Self::Tank => 5.6,
            Self::Collector => 6.0,
        }
    }
    fn radius(self) -> f32 {
        match self {
            Self::Soldier | Self::Rocket => 0.7,
            Self::Tank => 1.45,
            Self::Collector => 1.65,
        }
    }
    fn range(self) -> f32 {
        match self {
            Self::Soldier => 7.0,
            Self::Rocket => 10.0,
            Self::Tank => 10.5,
            Self::Collector => 0.0,
        }
    }
    fn interval(self) -> f32 {
        match self {
            Self::Soldier => 0.7,
            Self::Rocket => 1.35,
            Self::Tank => 1.15,
            Self::Collector => 1.0,
        }
    }
    fn damage(self, victim: Option<Self>) -> f32 {
        match (self, victim) {
            (Self::Soldier, Some(Self::Rocket)) => 19.0,
            (Self::Soldier, Some(Self::Tank)) => 5.0,
            (Self::Soldier, _) => 12.0,
            (Self::Rocket, Some(Self::Tank | Self::Collector)) => 52.0,
            (Self::Rocket, Some(Self::Soldier | Self::Rocket)) => 13.0,
            (Self::Rocket, None) => 36.0,
            (Self::Tank, Some(Self::Soldier | Self::Rocket)) => 34.0,
            (Self::Tank, _) => 28.0,
            (Self::Collector, _) => 0.0,
        }
    }
    fn production_building(self) -> BuildingKind {
        match self {
            Self::Tank | Self::Collector => BuildingKind::Factory,
            _ => BuildingKind::Barracks,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitState {
    Gather,
    Attack,
    Harvest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildingKind {
    Command,
    Barracks,
    Factory,
    Refinery,
}

#[derive(Clone, Serialize)]
pub struct OreDeposit {
    pub id: u32,
    pub x: f32,
    pub z: f32,
    pub amount: f32,
    pub max_amount: f32,
}

#[derive(Clone, Serialize)]
pub struct Unit {
    pub id: u32,
    pub team: Team,
    pub kind: UnitKind,
    pub x: f32,
    pub z: f32,
    pub hp: f32,
    pub max_hp: f32,
    pub state: UnitState,
    pub cargo: f32,
    pub returning: bool,
    #[serde(skip)]
    cooldown: f32,
    #[serde(skip)]
    navigation: navigation::Navigation,
    #[serde(skip)]
    rally_x: f32,
    #[serde(skip)]
    rally_z: f32,
}

#[derive(Clone, Serialize)]
pub struct Building {
    pub id: u32,
    pub team: Team,
    pub kind: BuildingKind,
    pub x: f32,
    pub z: f32,
    pub hp: f32,
    pub max_hp: f32,
    #[serde(skip)]
    cooldown: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Gather,
    Attack,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Playing,
    Victory,
    Defeat,
}

#[derive(Clone, Serialize)]
pub struct TankShot {
    pub id: u32,
    pub time: f32,
    pub unit_id: u32,
    pub x: f32,
    pub z: f32,
    pub target_x: f32,
    pub target_z: f32,
}

#[derive(Serialize)]
pub struct Game {
    pub time: f32,
    pub credits: f32,
    pub mode: Mode,
    pub outcome: Outcome,
    pub units: Vec<Unit>,
    pub buildings: Vec<Building>,
    pub ore: Vec<OreDeposit>,
    pub barracks_queue: Vec<UnitKind>,
    pub factory_queue: Vec<UnitKind>,
    pub barracks_progress: f32,
    pub factory_progress: f32,
    pub ai_status: String,
    pub player_kills: u32,
    pub enemy_kills: u32,
    pub tank_shots: Vec<TankShot>,
    #[serde(skip)]
    next_shot_id: u32,
    #[serde(skip)]
    next_id: u32,
    #[serde(skip)]
    enemy_barracks_queue: Vec<UnitKind>,
    #[serde(skip)]
    enemy_factory_queue: Vec<UnitKind>,
    #[serde(skip)]
    enemy_barracks_progress: f32,
    #[serde(skip)]
    enemy_factory_progress: f32,
    #[serde(skip)]
    ai_decision_timer: f32,
    #[serde(skip)]
    ai_wave_timer: f32,
    #[serde(skip)]
    ai_credits: f32,
}

impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}
impl Game {
    pub fn new() -> Self {
        Self::with_seed(1941)
    }
    pub fn with_seed(seed: u32) -> Self {
        let mut g = Self {
            time: 0.0,
            credits: 500.0,
            mode: Mode::Gather,
            outcome: Outcome::Playing,
            units: Vec::new(),
            buildings: Vec::new(),
            ore: Vec::new(),
            barracks_queue: vec![],
            factory_queue: vec![],
            barracks_progress: 0.0,
            factory_progress: 0.0,
            ai_status: "ASSESSING YOUR FORCES".into(),
            player_kills: 0,
            enemy_kills: 0,
            tank_shots: Vec::new(),
            next_shot_id: 1,
            next_id: 1,
            enemy_barracks_queue: vec![],
            enemy_factory_queue: vec![],
            enemy_barracks_progress: 0.0,
            enemy_factory_progress: 0.0,
            ai_decision_timer: 0.0,
            ai_wave_timer: 7.0,
            ai_credits: 300.0,
        };
        for team in [Team::Player, Team::Enemy] {
            let z = if team == Team::Player { 43.0 } else { -43.0 };
            g.add_building(team, BuildingKind::Command, 0.0, z, 1400.0);
            g.add_building(team, BuildingKind::Barracks, -10.0, z, 800.0);
            g.add_building(team, BuildingKind::Factory, 10.0, z, 1000.0);
            g.add_building(team, BuildingKind::Refinery, 0.0, z.signum() * 50.0, 900.0);
            for kind in [
                UnitKind::Soldier,
                UnitKind::Soldier,
                UnitKind::Soldier,
                UnitKind::Tank,
            ] {
                g.spawn(team, kind);
            }
        }
        g.generate_ore(seed);
        g
    }
    fn generate_ore(&mut self, mut seed: u32) {
        let mut random = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed as f64 / 4294967296.0) as f32
        };
        // Three bands, on both flanks, guarantee accessible starting ore and
        // contested deposits. Rotate each deposit 180 degrees for equal access.
        for band in 0..3 {
            for side in [-1.0, 1.0] {
                let x = side * (9.0 + random() * 5.0);
                let z = 7.0 + band as f32 * 10.0 + random() * 4.0;
                let amount = 1400.0 + (random() * 800.0).floor();
                for (x, z) in [(x, z), (-x, -z)] {
                    let id = self.id();
                    self.ore.push(OreDeposit {
                        id,
                        x,
                        z,
                        amount,
                        max_amount: amount,
                    });
                }
            }
        }
    }
    fn id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
    fn add_building(&mut self, team: Team, kind: BuildingKind, x: f32, z: f32, hp: f32) {
        let id = self.id();
        self.buildings.push(Building {
            id,
            team,
            kind,
            x,
            z,
            hp,
            max_hp: hp,
            cooldown: 0.0,
        });
    }
    fn spawn(&mut self, team: Team, kind: UnitKind) {
        let id = self.id();
        let index = self
            .units
            .iter()
            .filter(|u| u.team == team && u.state == UnitState::Gather)
            .count();
        let x = ((index % 7) as f32 - 3.0) * 3.4;
        let row = (index / 7).min(3) as f32;
        let direction = if team == Team::Player { 1.0 } else { -1.0 };
        let state = if kind == UnitKind::Collector {
            UnitState::Harvest
        } else if team == Team::Player && self.mode == Mode::Attack {
            UnitState::Attack
        } else {
            UnitState::Gather
        };
        self.units.push(Unit {
            id,
            team,
            kind,
            x: if kind == UnitKind::Collector { 10.0 } else { x },
            z: direction * (35.0 + row * 2.2),
            hp: kind.health(),
            max_hp: kind.health(),
            state,
            cargo: 0.0,
            returning: false,
            cooldown: 0.2,
            navigation: navigation::Navigation::default(),
            rally_x: x,
            rally_z: direction * (27.0 + row * 2.2),
        });
    }
    pub fn set_mode(&mut self, mode: &str) {
        if self.outcome != Outcome::Playing {
            return;
        }
        match mode {
            "attack" => {
                self.mode = Mode::Attack;
                for u in &mut self.units {
                    if u.team == Team::Player && u.kind != UnitKind::Collector {
                        u.state = UnitState::Attack;
                    }
                }
            }
            "gather" => self.mode = Mode::Gather,
            _ => {}
        }
    }
    pub fn attack_selected(&mut self, ids: &[u32]) {
        if self.outcome != Outcome::Playing {
            return;
        }
        for u in &mut self.units {
            if u.team == Team::Player && u.state == UnitState::Gather && ids.contains(&u.id) {
                u.state = UnitState::Attack;
            }
        }
    }
    pub fn train(&mut self, kind: &str) {
        if self.outcome != Outcome::Playing {
            return;
        }
        let Some(kind) = UnitKind::parse(kind) else {
            return;
        };
        let building = kind.production_building();
        if kind == UnitKind::Collector && !self.alive_building(Team::Player, BuildingKind::Refinery)
        {
            return;
        }
        if !self.alive_building(Team::Player, building) || self.credits < kind.cost() {
            return;
        }
        let queue = if building == BuildingKind::Factory {
            &mut self.factory_queue
        } else {
            &mut self.barracks_queue
        };
        if queue.len() >= QUEUE_LIMIT {
            return;
        }
        queue.push(kind);
        self.credits -= kind.cost();
    }
    fn alive_building(&self, team: Team, kind: BuildingKind) -> bool {
        self.buildings
            .iter()
            .any(|b| b.team == team && b.kind == kind && b.hp > 0.0)
    }
    pub fn update(&mut self, dt: f32) {
        if self.outcome != Outcome::Playing || !dt.is_finite() || dt <= 0.0 {
            return;
        }
        let mut remaining = dt.min(0.25);
        while remaining > 0.0001 && self.outcome == Outcome::Playing {
            let step = remaining.min(0.05);
            self.step(step);
            remaining -= step;
        }
    }
    fn step(&mut self, dt: f32) {
        self.time += dt;
        self.tank_shots.retain(|shot| self.time - shot.time < 1.0);
        self.credits = (self.credits + 24.0 * dt).min(2000.0);
        self.ai_credits = (self.ai_credits + 32.0 * dt).min(800.0);
        self.harvest_and_unload(dt);
        self.ai_decision_timer -= dt;
        self.ai_wave_timer -= dt;
        if self.ai_decision_timer <= 0.0 {
            self.ai_decide();
            self.ai_decision_timer = 1.0;
        }
        let pb = self.alive_building(Team::Player, BuildingKind::Barracks);
        let pf = self.alive_building(Team::Player, BuildingKind::Factory);
        let eb = self.alive_building(Team::Enemy, BuildingKind::Barracks);
        let ef = self.alive_building(Team::Enemy, BuildingKind::Factory);
        if pb {
            if let Some(k) =
                progress_queue(&mut self.barracks_queue, &mut self.barracks_progress, dt)
            {
                self.spawn(Team::Player, k);
            }
        }
        if pf {
            if let Some(k) = progress_queue(&mut self.factory_queue, &mut self.factory_progress, dt)
            {
                self.spawn(Team::Player, k);
            }
        }
        if eb {
            if let Some(k) = progress_queue(
                &mut self.enemy_barracks_queue,
                &mut self.enemy_barracks_progress,
                dt,
            ) {
                self.spawn(Team::Enemy, k);
            }
        }
        if ef {
            if let Some(k) = progress_queue(
                &mut self.enemy_factory_queue,
                &mut self.enemy_factory_progress,
                dt,
            ) {
                self.spawn(Team::Enemy, k);
            }
        }
        self.combat_and_move(dt);
        self.resolve_collisions();
        self.units.retain(|u| u.hp > 0.0);
        self.buildings.retain(|b| b.hp > 0.0);
        if !self.alive_building(Team::Player, BuildingKind::Barracks) {
            self.barracks_queue.clear();
            self.barracks_progress = 0.0;
        }
        if !self.alive_building(Team::Player, BuildingKind::Factory) {
            self.factory_queue.clear();
            self.factory_progress = 0.0;
        }
        let player_alive = self.units.iter().any(|u| u.team == Team::Player)
            || self.buildings.iter().any(|b| b.team == Team::Player);
        let enemy_alive = self.units.iter().any(|u| u.team == Team::Enemy)
            || self.buildings.iter().any(|b| b.team == Team::Enemy);
        self.outcome = if !player_alive {
            Outcome::Defeat
        } else if !enemy_alive {
            Outcome::Victory
        } else {
            Outcome::Playing
        };
    }
    fn ai_decide(&mut self) {
        let collectors = self
            .units
            .iter()
            .filter(|u| u.team == Team::Enemy && u.kind == UnitKind::Collector)
            .count()
            + self
                .enemy_factory_queue
                .iter()
                .filter(|&&k| k == UnitKind::Collector)
                .count();
        let wants_collector = self.time >= 3.0
            && collectors < 2
            && self.alive_building(Team::Enemy, BuildingKind::Refinery)
            && self.alive_building(Team::Enemy, BuildingKind::Factory)
            && self.enemy_factory_queue.is_empty()
            && self.ore.iter().any(|o| o.amount > 0.0);
        if wants_collector && self.ai_credits >= UnitKind::Collector.cost() {
            self.ai_credits -= UnitKind::Collector.cost();
            self.enemy_factory_queue.push(UnitKind::Collector);
        }
        // Read both fielded forces and committed production: the opponent can prepare
        // a counter while a player order is still being built.
        let mut player = [0.0f32; 3];
        let mut enemy = [0.0f32; 3];
        for u in &self.units {
            if u.kind == UnitKind::Collector {
                continue;
            }
            let index = unit_index(u.kind);
            if u.team == Team::Player {
                player[index] += 1.0;
            } else {
                // A unit deep in enemy territory is less useful as a local reserve.
                enemy[index] += if u.state == UnitState::Attack && u.z > 5.0 {
                    0.5
                } else {
                    1.0
                };
            }
        }
        for k in self.barracks_queue.iter().chain(&self.factory_queue) {
            if *k == UnitKind::Collector {
                continue;
            }
            player[unit_index(*k)] += 1.0;
        }
        for k in self
            .enemy_barracks_queue
            .iter()
            .chain(&self.enemy_factory_queue)
        {
            if *k == UnitKind::Collector {
                continue;
            }
            enemy[unit_index(*k)] += 1.0;
        }

        let threatened = self
            .units
            .iter()
            .any(|u| u.team == Team::Player && u.state == UnitState::Attack && u.z < -10.0);
        let reserves = self
            .units
            .iter()
            .filter(|u| u.team == Team::Enemy && u.state == UnitState::Gather)
            .count();
        if threatened
            || (self.ai_wave_timer <= 0.0 && (reserves >= 3 || self.ai_wave_timer <= -4.0))
        {
            for u in &mut self.units {
                if u.team == Team::Enemy && u.state == UnitState::Gather {
                    u.state = UnitState::Attack;
                }
            }
            self.ai_wave_timer = if threatened { 7.0 } else { 9.0 };
        }

        // Soldiers counter rockets, rockets counter armor, and tanks counter infantry.
        // A baseline of every role prevents a single small scout from pulling the
        // entire army into one unit type.
        let desired_soldiers = 2.0 + player[1] * 1.3 + player[0] * 0.25;
        let desired_rockets = 1.0 + player[2] * 1.4;
        let desired_tanks = 1.0 + player[0] * 0.55;
        let soldier_need = desired_soldiers - enemy[0];
        let rocket_need = desired_rockets - enemy[1];
        let choice = if rocket_need > soldier_need {
            UnitKind::Rocket
        } else {
            UnitKind::Soldier
        };
        self.ai_status = if threatened {
            "INTERCEPTING YOUR ADVANCE"
        } else if player[2] > player[0] && player[2] >= player[1] {
            "COUNTERING YOUR ARMOR"
        } else if player[1] > player[2] {
            "COUNTERING YOUR ROCKET TROOPS"
        } else {
            "BUILDING A COMBINED FORCE"
        }
        .into();
        if wants_collector && !threatened && self.enemy_factory_queue.is_empty() {
            // Save for the economy while reserves still handle wave deployment.
            return;
        }
        // Avoid feeding armor into a rocket-heavy army. Save for a tank when
        // an infantry-heavy opponent makes armor the most urgent missing role.
        let tank_limit = if player[1] > player[0] {
            1.0
        } else {
            desired_tanks
        };
        let tank_need = tank_limit - enemy[2];
        let wants_tank = self.alive_building(Team::Enemy, BuildingKind::Factory)
            && self.enemy_factory_queue.is_empty()
            && tank_need > 0.0;
        let prioritize_tank =
            wants_tank && player[0] > player[2] && tank_need > soldier_need.max(rocket_need);
        if prioritize_tank && self.ai_credits >= UnitKind::Tank.cost() {
            self.ai_credits -= UnitKind::Tank.cost();
            self.enemy_factory_queue.push(UnitKind::Tank);
        }
        if (!prioritize_tank || !self.enemy_factory_queue.is_empty())
            && self.alive_building(Team::Enemy, BuildingKind::Barracks)
            && self.enemy_barracks_queue.len() < 2
            && self.ai_credits >= choice.cost()
        {
            self.ai_credits -= choice.cost();
            self.enemy_barracks_queue.push(choice);
        }
        if wants_tank
            && self.enemy_factory_queue.is_empty()
            && self.ai_credits >= UnitKind::Tank.cost()
        {
            self.ai_credits -= UnitKind::Tank.cost();
            self.enemy_factory_queue.push(UnitKind::Tank);
        }
    }
    fn harvest_and_unload(&mut self, dt: f32) {
        let snapshot = self.units.clone();
        for unit in &mut self.units {
            if unit.kind != UnitKind::Collector || unit.hp <= 0.0 {
                continue;
            }
            let refinery = self
                .buildings
                .iter()
                .filter(|b| b.team == unit.team && b.kind == BuildingKind::Refinery && b.hp > 0.0)
                .min_by(|a, b| {
                    distance_sq(unit.x, unit.z, a.x, a.z)
                        .total_cmp(&distance_sq(unit.x, unit.z, b.x, b.z))
                });
            let Some(refinery) = refinery else {
                continue;
            };
            let deposit = self
                .ore
                .iter()
                .enumerate()
                .filter(|(_, o)| o.amount > 0.0)
                .min_by(|(_, a), (_, b)| {
                    distance_sq(unit.x, unit.z, a.x, a.z)
                        .total_cmp(&distance_sq(unit.x, unit.z, b.x, b.z))
                })
                .map(|(i, _)| i);
            unit.returning |=
                unit.cargo >= COLLECTOR_CAPACITY || (deposit.is_none() && unit.cargo > 0.0);
            let (x, z, stopping_distance) = if unit.returning {
                (refinery.x, refinery.z, 5.4)
            } else if let Some(i) = deposit {
                (self.ore[i].x, self.ore[i].z, 3.0)
            } else {
                continue;
            };
            let distance = distance_sq(unit.x, unit.z, x, z).sqrt();
            if distance > stopping_distance + 0.01 {
                navigation::move_toward(
                    unit,
                    (x, z),
                    stopping_distance,
                    dt,
                    &snapshot,
                    &self.buildings,
                );
            } else if unit.returning {
                if unit.team == Team::Player {
                    self.credits = (self.credits + unit.cargo).min(2000.0);
                } else {
                    self.ai_credits = (self.ai_credits + unit.cargo).min(800.0);
                }
                unit.cargo = 0.0;
                unit.returning = false;
            } else if let Some(i) = deposit {
                let ore = &mut self.ore[i];
                let mined = (MINING_RATE * dt)
                    .min(ore.amount)
                    .min(COLLECTOR_CAPACITY - unit.cargo);
                unit.cargo += mined;
                ore.amount -= mined;
                // Deliver a partial load when this deposit is exhausted.
                unit.returning = unit.cargo >= COLLECTOR_CAPACITY || ore.amount <= 0.0;
            }
        }
    }
    // Resolve all units together, including collectors and opposing teams. Small
    // simulation steps prevent moving units from tunneling through one another.
    fn resolve_collisions(&mut self) {
        for _ in 0..48 {
            let mut overlap_found = false;
            for unit in &mut self.units {
                if unit.hp <= 0.0 {
                    continue;
                }
                let radius = unit.kind.radius();
                for building in self.buildings.iter().filter(|b| b.hp > 0.0) {
                    let (half_x, half_z) = building_half_size(building.kind);
                    let dx = unit.x - building.x;
                    let dz = unit.z - building.z;
                    let closest_x = dx.clamp(-half_x, half_x);
                    let closest_z = dz.clamp(-half_z, half_z);
                    let (ox, oz) = (dx - closest_x, dz - closest_z);
                    let distance = (ox * ox + oz * oz).sqrt();
                    if distance > 0.0 && distance < radius {
                        overlap_found = true;
                        unit.x += ox / distance * (radius - distance);
                        unit.z += oz / distance * (radius - distance);
                    } else if distance == 0.0 {
                        overlap_found = true;
                        // A newly spawned or displaced unit inside the footprint
                        // leaves through its nearest side.
                        let x_gap = half_x - dx.abs();
                        let z_gap = half_z - dz.abs();
                        if x_gap < z_gap {
                            unit.x =
                                building.x + if dx < 0.0 { -1.0 } else { 1.0 } * (half_x + radius);
                        } else {
                            unit.z =
                                building.z + if dz < 0.0 { -1.0 } else { 1.0 } * (half_z + radius);
                        }
                    }
                }
                unit.x = unit.x.clamp(-FIELD_EDGE, FIELD_EDGE);
            }
            for i in 0..self.units.len() {
                let (left, right) = self.units.split_at_mut(i + 1);
                let a = &mut left[i];
                if a.hp <= 0.0 {
                    continue;
                }
                for b in right.iter_mut().filter(|u| u.hp > 0.0) {
                    let (dx, dz) = (b.x - a.x, b.z - a.z);
                    let distance = (dx * dx + dz * dz).sqrt();
                    let overlap = a.kind.radius() + b.kind.radius() - distance;
                    if overlap > 0.00001 {
                        overlap_found = true;
                        let (nx, nz) = if distance > 0.0001 {
                            (dx / distance, dz / distance)
                        } else {
                            (if a.id < b.id { 1.0 } else { -1.0 }, 0.0)
                        };
                        a.x = (a.x - nx * overlap * 0.5).clamp(-FIELD_EDGE, FIELD_EDGE);
                        a.z -= nz * overlap * 0.5;
                        b.x = (b.x + nx * overlap * 0.5).clamp(-FIELD_EDGE, FIELD_EDGE);
                        b.z += nz * overlap * 0.5;
                    }
                }
            }
            if !overlap_found {
                break;
            }
        }
    }
    fn combat_and_move(&mut self, dt: f32) {
        // Work from one snapshot so every unit acts simultaneously and targeting is deterministic.
        let snapshot = self.units.clone();
        let buildings = self.buildings.clone();
        let mut unit_damage = vec![0.0f32; snapshot.len()];
        let mut building_damage = vec![0.0f32; buildings.len()];
        for unit in &mut self.units {
            if unit.kind == UnitKind::Collector {
                continue;
            }
            unit.cooldown = (unit.cooldown - dt).max(0.0);
            let target_unit = snapshot
                .iter()
                .enumerate()
                .filter(|(_, v)| v.team != unit.team && v.hp > 0.0)
                .map(|(j, v)| (j, distance_sq(unit.x, unit.z, v.x, v.z)))
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let target_building = buildings
                .iter()
                .enumerate()
                .filter(|(_, b)| b.team != unit.team && b.hp > 0.0)
                .map(|(j, b)| (j, distance_sq(unit.x, unit.z, b.x, b.z)))
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let nearest_unit_distance = target_unit.map(|(_, d)| d).unwrap_or(f32::INFINITY);
            let nearest_building_distance =
                target_building.map(|(_, d)| d).unwrap_or(f32::INFINITY);
            // Units in reserve defend locally, but never chase away from the rally area.
            let range = unit.kind.range();
            let firing_target = snapshot
                .iter()
                .enumerate()
                .filter(|(_, v)| {
                    v.team != unit.team
                        && v.hp > 0.0
                        && distance_sq(unit.x, unit.z, v.x, v.z) <= range * range
                })
                .max_by(|(_, a), (_, b)| {
                    let score = |v: &Unit| {
                        unit.kind.damage(Some(v.kind))
                            / (1.0 + distance_sq(unit.x, unit.z, v.x, v.z).sqrt() / range * 0.3)
                    };
                    score(a).total_cmp(&score(b))
                })
                .map(|(j, _)| j);
            let unit_in_range = firing_target.is_some();
            let building_in_range = nearest_building_distance <= (range + 2.3) * (range + 2.3);
            if unit.cooldown <= 0.0 && (unit_in_range || building_in_range) {
                if unit_in_range {
                    let j = firing_target.unwrap();
                    unit_damage[j] += unit.kind.damage(Some(snapshot[j].kind));
                } else {
                    let (j, _) = target_building.unwrap();
                    building_damage[j] += unit.kind.damage(None);
                }
                if unit.kind == UnitKind::Tank {
                    let (target_x, target_z) = if let Some(j) = firing_target {
                        (snapshot[j].x, snapshot[j].z)
                    } else {
                        let (j, _) = target_building.unwrap();
                        (buildings[j].x, buildings[j].z)
                    };
                    self.tank_shots.push(TankShot {
                        id: self.next_shot_id,
                        time: self.time,
                        unit_id: unit.id,
                        x: unit.x,
                        z: unit.z,
                        target_x,
                        target_z,
                    });
                    self.next_shot_id += 1;
                }
                unit.cooldown = unit.kind.interval();
            } else if !unit_in_range && !building_in_range {
                let destination = if unit.state == UnitState::Gather {
                    Some((unit.rally_x, unit.rally_z))
                } else if nearest_unit_distance <= nearest_building_distance {
                    target_unit.map(|(j, _)| (snapshot[j].x, snapshot[j].z))
                } else {
                    target_building.map(|(j, _)| (buildings[j].x, buildings[j].z))
                };
                if let Some((x, z)) = destination {
                    let stop = if unit.state == UnitState::Gather {
                        0.15
                    } else if nearest_unit_distance <= nearest_building_distance {
                        range * 0.95
                    } else {
                        (range + 2.3) * 0.95
                    };
                    navigation::move_toward(unit, (x, z), stop, dt, &snapshot, &buildings);
                }
            }
        }
        // Command centers provide short-range point defense to prevent runaway snowballs.
        for b in &mut self.buildings {
            b.cooldown = (b.cooldown - dt).max(0.0);
            if b.kind == BuildingKind::Command && b.cooldown <= 0.0 {
                if let Some((j, _)) = snapshot
                    .iter()
                    .enumerate()
                    .filter(|(_, u)| {
                        u.team != b.team && distance_sq(b.x, b.z, u.x, u.z) < 11.0 * 11.0
                    })
                    .map(|(j, u)| (j, distance_sq(b.x, b.z, u.x, u.z)))
                    .min_by(|a, b| a.1.total_cmp(&b.1))
                {
                    unit_damage[j] += 18.0;
                    b.cooldown = 1.0;
                }
            }
        }
        for (u, damage) in self.units.iter_mut().zip(unit_damage) {
            u.hp -= damage;
            if u.hp <= 0.0 && damage > 0.0 {
                if u.team == Team::Enemy {
                    self.player_kills += 1;
                } else {
                    self.enemy_kills += 1;
                }
            }
        }
        for (b, damage) in self.buildings.iter_mut().zip(building_damage) {
            b.hp -= damage;
            if b.hp <= 0.0 && damage > 0.0 {
                if b.team == Team::Enemy {
                    self.player_kills += 1;
                } else {
                    self.enemy_kills += 1;
                }
            }
        }
    }
}

fn building_half_size(kind: BuildingKind) -> (f32, f32) {
    match kind {
        BuildingKind::Command => (3.65, 3.3),
        BuildingKind::Barracks => (2.85, 2.65),
        BuildingKind::Factory => (3.225, 3.05),
        BuildingKind::Refinery => (3.55, 2.8),
    }
}

fn unit_index(kind: UnitKind) -> usize {
    match kind {
        UnitKind::Soldier => 0,
        UnitKind::Rocket => 1,
        UnitKind::Tank => 2,
        UnitKind::Collector => unreachable!("collectors are excluded from army composition"),
    }
}
fn progress_queue(queue: &mut Vec<UnitKind>, progress: &mut f32, dt: f32) -> Option<UnitKind> {
    if let Some(kind) = queue.first().copied() {
        *progress += dt / kind.build_time();
        if *progress >= 1.0 {
            *progress = 0.0;
            queue.remove(0);
            return Some(kind);
        }
    } else {
        *progress = 0.0;
    }
    None
}
fn distance_sq(x: f32, z: f32, other_x: f32, other_z: f32) -> f32 {
    (x - other_x).powi(2) + (z - other_z).powi(2)
}

#[cfg(test)]
mod tests {
    #[test]
    fn tank_shot_records_actual_target_even_on_lethal_hit() {
        let mut g = super::Game::new();
        g.units.clear();
        g.buildings.clear();
        g.spawn(super::Team::Player, super::UnitKind::Tank);
        g.spawn(super::Team::Enemy, super::UnitKind::Soldier);
        g.units[0].x = 0.0;
        g.units[0].z = 0.0;
        g.units[0].cooldown = 0.0;
        g.units[1].x = 3.0;
        g.units[1].z = 0.0;
        g.units[1].hp = 1.0;
        let tank_id = g.units[0].id;
        g.combat_and_move(0.05);
        assert!(g.units[1].hp <= 0.0);
        assert_eq!(g.tank_shots.len(), 1);
        let shot = &g.tank_shots[0];
        assert_eq!(shot.unit_id, tank_id);
        assert_eq!(
            (shot.x, shot.z, shot.target_x, shot.target_z),
            (0.0, 0.0, 3.0, 0.0)
        );
        g.combat_and_move(0.05);
        assert_eq!(g.tank_shots.len(), 1, "cooldown prevents duplicate shots");
    }
    use super::*;
    #[test]
    fn gathering_unit_routes_around_building_and_stationary_unit() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        g.add_building(Team::Player, BuildingKind::Factory, 0.0, 0.0, 1000.0);
        g.spawn(Team::Player, UnitKind::Soldier);
        g.spawn(Team::Player, UnitKind::Tank);
        g.units[0].x = 0.0;
        g.units[0].z = -10.0;
        g.units[0].rally_x = 0.0;
        g.units[0].rally_z = 12.0;
        g.units[1].x = 4.0;
        g.units[1].z = 0.0;
        g.units[1].rally_x = 4.0;
        g.units[1].rally_z = 0.0;
        for _ in 0..240 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        let unit = &g.units[0];
        assert!(
            distance_sq(unit.x, unit.z, 0.0, 12.0) < 1.0,
            "unit failed to reach rally: {}, {}",
            unit.x,
            unit.z
        );
    }

    #[test]
    fn units_passing_in_opposite_directions_do_not_deadlock() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        for _ in 0..2 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        g.units[0].x = 0.0;
        g.units[0].z = -9.0;
        g.units[0].rally_x = 0.0;
        g.units[0].rally_z = 9.0;
        g.units[1].x = 0.0;
        g.units[1].z = 9.0;
        g.units[1].rally_x = 0.0;
        g.units[1].rally_z = -9.0;
        for _ in 0..240 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        assert!(
            g.units[0].z > 7.0 && g.units[1].z < -7.0,
            "units stalled: ({}, {}), ({}, {})",
            g.units[0].x,
            g.units[0].z,
            g.units[1].x,
            g.units[1].z
        );
    }

    #[test]
    fn attacking_unit_routes_around_friendly_building() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        g.add_building(Team::Player, BuildingKind::Command, 0.0, 0.0, 1400.0);
        g.add_building(Team::Enemy, BuildingKind::Factory, 0.0, 24.0, 1000.0);
        g.spawn(Team::Player, UnitKind::Soldier);
        g.units[0].state = UnitState::Attack;
        g.units[0].x = 0.0;
        g.units[0].z = -12.0;
        for _ in 0..220 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        assert!(
            g.buildings[1].hp < g.buildings[1].max_hp,
            "unit did not reach firing range: {}, {}",
            g.units[0].x,
            g.units[0].z
        );
    }

    #[test]
    fn collision_separates_all_units_and_building_footprints() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Tank);
        for unit in &mut g.units {
            unit.x = 0.0;
            unit.z = 39.0;
        }
        g.resolve_collisions();
        let a = &g.units[0];
        let b = &g.units[1];
        assert!(
            distance_sq(a.x, a.z, b.x, b.z).sqrt() >= a.kind.radius() + b.kind.radius() - 0.001
        );
        for unit in &g.units {
            let dx = (unit.x.abs() - 3.65).max(0.0);
            let dz = ((unit.z - 43.0).abs() - 3.3).max(0.0);
            assert!((dx * dx + dz * dz).sqrt() >= unit.kind.radius() - 0.001);
        }
    }

    #[test]
    fn collectors_on_both_teams_make_repeated_deliveries_in_traffic() {
        let mut g = Game::new();
        g.units.clear();
        for team in [Team::Player, Team::Enemy] {
            g.spawn(team, UnitKind::Collector);
            g.spawn(team, UnitKind::Collector);
        }
        g.resolve_collisions();
        g.credits = 0.0;
        g.ai_credits = 0.0;
        for _ in 0..2400 {
            g.harvest_and_unload(0.05);
            g.resolve_collisions();
        }
        assert!(
            g.credits >= 200.0,
            "player collectors delivered {}",
            g.credits
        );
        assert!(
            g.ai_credits >= 200.0,
            "enemy collectors delivered {}",
            g.ai_credits
        );
    }

    #[test]
    fn collector_can_deliver_with_collisions_enabled() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.credits = 0.0;
        g.ai_decision_timer = 1000.0;
        g.ai_wave_timer = 1000.0;
        for _ in 0..800 {
            g.update(0.05);
        }
        // Passive income is 960 credits; a delivery adds up to 100.
        assert!(
            g.credits > 1000.0,
            "collector must complete a delivery: {}, position {}, {}, cargo {}",
            g.credits,
            g.units[0].x,
            g.units[0].z,
            g.units[0].cargo
        );
    }

    #[test]
    fn ore_is_seeded_symmetric_and_clear_of_starting_buildings() {
        for seed in 0..128 {
            let g = Game::with_seed(seed);
            assert_eq!(g.ore.len(), 12);
            for pair in g.ore.chunks_exact(2) {
                assert_eq!(pair[0].x, -pair[1].x);
                assert_eq!(pair[0].z, -pair[1].z);
                assert_eq!(pair[0].amount, pair[1].amount);
                assert!((1400.0..=2200.0).contains(&pair[0].amount));
            }
            for ore in &g.ore {
                assert!(ore.x.abs() <= FIELD_EDGE - 2.5);
                assert!(ore.x.abs() >= 8.0);
                for b in &g.buildings {
                    assert!(distance_sq(ore.x, ore.z, b.x, b.z) > 7.0 * 7.0);
                }
                for other in &g.ore {
                    if ore.id != other.id {
                        assert!(distance_sq(ore.x, ore.z, other.x, other.z) > 5.0 * 5.0);
                    }
                }
            }
        }
        let a = Game::with_seed(12);
        let b = Game::with_seed(13);
        let repeat = Game::with_seed(12);
        assert_ne!(a.ore[0].x, b.ore[0].x);
        assert_eq!(a.ore[0].x, repeat.ore[0].x);
        assert_eq!(a.ore[0].amount, repeat.ore[0].amount);
    }
    #[test]
    fn both_teams_start_with_a_refinery() {
        let g = Game::new();
        for team in [Team::Player, Team::Enemy] {
            assert!(g.alive_building(team, BuildingKind::Refinery));
            assert_eq!(g.buildings.iter().filter(|b| b.team == team).count(), 4);
        }
    }
    #[test]
    fn collectors_use_the_factory_and_ignore_army_orders() {
        let mut g = Game::new();
        g.set_mode("attack");
        g.train("collector");
        assert_eq!(g.credits, 300.0);
        assert_eq!(g.factory_queue, vec![UnitKind::Collector]);
        for _ in 0..110 {
            g.update(0.05);
        }
        let id = g
            .units
            .iter()
            .find(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
            .unwrap()
            .id;
        g.set_mode("attack");
        g.attack_selected(&[id]);
        g.set_mode("gather");
        assert_eq!(
            g.units.iter().find(|u| u.id == id).unwrap().state,
            UnitState::Harvest
        );
    }
    #[test]
    fn collector_training_checks_refinery_factory_credits_and_queue() {
        for missing in [BuildingKind::Refinery, BuildingKind::Factory] {
            let mut g = Game::new();
            g.buildings
                .retain(|b| !(b.team == Team::Player && b.kind == missing));
            g.train("collector");
            assert!(g.factory_queue.is_empty());
            assert_eq!(g.credits, 500.0);
        }
        let mut g = Game::new();
        g.credits = 199.0;
        g.train("collector");
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.credits, 199.0);
        g.credits = 500.0;
        g.factory_queue = vec![UnitKind::Tank; QUEUE_LIMIT];
        g.train("collector");
        assert_eq!(g.factory_queue.len(), QUEUE_LIMIT);
        assert_eq!(g.credits, 500.0);
        g.factory_queue.clear();
        g.outcome = Outcome::Defeat;
        g.train("collector");
        assert!(g.factory_queue.is_empty());
    }
    #[test]
    fn collectors_mine_and_deliver_without_creating_ore() {
        let mut g = Game::new();
        g.credits = 0.0;
        g.spawn(Team::Player, UnitKind::Collector);
        let initial_ore: f32 = g.ore.iter().map(|o| o.amount).sum();
        for _ in 0..1200 {
            g.harvest_and_unload(0.05);
        }
        let collector = g
            .units
            .iter()
            .find(|u| u.kind == UnitKind::Collector)
            .unwrap();
        let remaining_ore: f32 = g.ore.iter().map(|o| o.amount).sum();
        assert!(g.credits >= 200.0, "must complete multiple round trips");
        assert!((initial_ore - remaining_ore - g.credits - collector.cargo).abs() < 0.1);
        assert!((0.0..=COLLECTOR_CAPACITY).contains(&collector.cargo));
        assert!(g.ore.iter().all(|o| o.amount >= 0.0));
    }
    #[test]
    fn collectors_deliver_partial_loads_after_depletion_and_stop_without_refinery() {
        let mut g = Game::new();
        g.credits = 0.0;
        g.ore.truncate(1);
        g.ore[0].amount = 12.0;
        g.spawn(Team::Player, UnitKind::Collector);
        let collector = g.units.last_mut().unwrap();
        collector.x = g.ore[0].x;
        collector.z = g.ore[0].z;
        for _ in 0..400 {
            g.harvest_and_unload(0.05);
        }
        assert_eq!(g.credits, 12.0);
        assert_eq!(g.ore[0].amount, 0.0);
        assert_eq!(g.units.last().unwrap().cargo, 0.0);
        g.ore[0].amount = 200.0;
        g.buildings
            .retain(|b| !(b.team == Team::Player && b.kind == BuildingKind::Refinery));
        g.units.last_mut().unwrap().cargo = 100.0;
        for _ in 0..400 {
            g.harvest_and_unload(0.05);
        }
        assert_eq!(g.credits, 12.0);
        assert_eq!(g.ore[0].amount, 200.0);
        assert_eq!(g.units.last().unwrap().cargo, 100.0);
    }
    #[test]
    fn collectors_are_unarmed_and_can_be_destroyed() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Rocket);
        for u in &mut g.units {
            u.x = 0.0;
            u.z = 0.0;
        }
        g.combat_and_move(0.25);
        assert!(g.units[0].hp < g.units[0].max_hp);
        assert_eq!(g.units[1].hp, g.units[1].max_hp);
        for _ in 0..140 {
            g.combat_and_move(0.05);
        }
        assert!(g.units[0].hp <= 0.0);
    }
    #[test]
    fn ai_builds_collectors_and_does_not_treat_them_as_soldiers() {
        let mut g = Game::new();
        g.train("collector");
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Collector);
        g.time = 3.0;
        g.ai_credits = 500.0;
        g.ai_decide();
        assert_eq!(g.enemy_factory_queue.first(), Some(&UnitKind::Collector));
        assert!(g
            .units
            .iter()
            .filter(|u| u.kind == UnitKind::Collector)
            .all(|u| u.state == UnitState::Harvest));
        let mut g = Game::new();
        for _ in 0..400 {
            g.update(0.05);
        }
        assert!(g
            .units
            .iter()
            .any(|u| u.team == Team::Enemy && u.kind == UnitKind::Collector));
    }
    #[test]
    fn modes_commit_only_the_correct_units() {
        let mut g = Game::new();
        let player_ids: Vec<_> = g
            .units
            .iter()
            .filter(|u| u.team == Team::Player)
            .map(|u| u.id)
            .collect();
        g.attack_selected(&player_ids[..1]);
        assert_eq!(
            g.units
                .iter()
                .filter(|u| u.team == Team::Player && u.state == UnitState::Attack)
                .count(),
            1
        );
        g.set_mode("attack");
        g.set_mode("gather");
        assert_eq!(
            g.units
                .iter()
                .filter(|u| u.team == Team::Player && u.state == UnitState::Attack)
                .count(),
            player_ids.len()
        );
    }
    #[test]
    fn training_respects_cost_and_mode() {
        let mut g = Game::new();
        g.set_mode("attack");
        g.train("soldier");
        assert_eq!(g.credits, 440.0);
        for _ in 0..42 {
            g.update(0.05);
        }
        assert!(g.units.iter().any(|u| u.id > 14
            && u.team == Team::Player
            && u.kind == UnitKind::Soldier
            && u.state == UnitState::Attack));
    }
    #[test]
    fn ai_produces_rockets_to_counter_a_tank_force() {
        let mut g = Game::new();
        for _ in 0..4 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));
        assert_eq!(g.ai_status, "COUNTERING YOUR ARMOR");
    }
    #[test]
    fn ai_anticipates_queued_units_and_deploys_defenders() {
        let mut g = Game::new();
        g.factory_queue.extend([UnitKind::Tank; 4]);
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));

        let mut g = Game::new();
        g.barracks_queue.extend([UnitKind::Rocket; 4]);
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Soldier));
        assert!(
            g.enemy_factory_queue.is_empty(),
            "avoid extra tanks against rocket troops"
        );

        let mut g = Game::new();
        g.barracks_queue.extend([UnitKind::Soldier; 6]);
        g.ai_decide();
        assert_eq!(g.enemy_factory_queue.first(), Some(&UnitKind::Tank));

        let mut g = Game::new();
        let intruder = g.units.iter_mut().find(|u| u.team == Team::Player).unwrap();
        intruder.state = UnitState::Attack;
        intruder.z = -15.0;
        g.ai_decide();
        assert!(g
            .units
            .iter()
            .filter(|u| u.team == Team::Enemy)
            .all(|u| u.state == UnitState::Attack));
        assert_eq!(g.ai_status, "INTERCEPTING YOUR ADVANCE");
    }
    #[test]
    fn ai_respects_its_economy() {
        let mut g = Game::new();
        g.ai_credits = 0.0;
        g.ai_decide();
        assert!(g.enemy_barracks_queue.is_empty());
        assert!(g.enemy_factory_queue.is_empty());
    }
    #[test]
    fn victory_and_defeat_require_all_units_and_buildings_to_be_gone() {
        let mut g = Game::new();
        g.buildings.retain(|b| b.team == Team::Player);
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Playing);
        g.units.retain(|u| u.team == Team::Player);
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Victory);
        let mut g = Game::new();
        g.units.retain(|u| u.team == Team::Enemy);
        g.buildings.retain(|b| b.team == Team::Enemy);
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Defeat);
    }
    #[test]
    fn destroyed_factory_cannot_train() {
        let mut g = Game::new();
        g.buildings
            .retain(|b| !(b.team == Team::Player && b.kind == BuildingKind::Factory));
        g.train("tank");
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.credits, 500.0);
    }
}
