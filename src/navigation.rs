//! Units route around buildings, then choose each step's velocity from where
//! nearby units are heading. Moving units share a right of way, so a unit that
//! meets oncoming traffic in a narrow gap backs out instead of deadlocking, and
//! followers keep pace behind their leader. Collision resolution remains
//! responsible for physical contact.
use super::{building_half_size, distance_sq, Building, Team, Unit, FIELD_EDGE};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

// Routes keep this clearance from buildings beyond the unit's hull.
const MARGIN: f32 = 0.15;
// Units keep this gap when predicting contact with each other.
const BUFFER: f32 = 0.1;
// Seconds of predicted motion weighed when choosing a velocity.
const HORIZON: f32 = 2.0;
// A unit expected to give way is avoided only when contact is imminent.
const YIELDING_HORIZON: f32 = 0.3;
const WALL_HORIZON: f32 = 0.6;
// Larger values avoid earlier; this also sets the gap behind a stopped unit.
const AVOIDANCE: f32 = 0.6;
// Discourages flipping between equally good velocities on successive steps.
const SMOOTHING: f32 = 0.15;
// Oncoming allies both prefer the same turn, so they pass instead of
// mirroring each other. The bases are mirror images, so each team's
// preference, like its search order around goals, is mirrored too.
const SIDE_BIAS: f32 = 0.03;
// Seconds without progress before a unit routes around the stationary units
// near it, how long it keeps doing so, and how long it waits to look again
// when there is no way around.
const DETOUR_AFTER: f32 = 0.5;
const DETOUR: f32 = 3.0;
const DETOUR_RETRY: f32 = 1.0;
// Seconds without progress before a unit shoves idle units out of its way.
const PUSH_AFTER: f32 = 1.0;
// A unit with right of way this many seconds away makes others clear its lane.
const YIELD_AHEAD: f32 = 1.2;
// Cost of standing in such a lane, judged by the clearest point a velocity
// reaches within these times; crossing a lane can be the way out of it.
const LANE_WEIGHT: f32 = 1.5;
const LANE_LOOKAHEAD: [f32; 3] = [0.4, 0.8, 1.2];
// Turns from the preferred heading, with the fractions of full speed tried.
const TURNS: [(f32, &[f32]); 10] = [
    (0.0, &[1.0, 0.75, 0.5, 0.25]),
    (0.26, &[1.0, 0.75, 0.5]),
    (0.52, &[1.0, 0.6]),
    (0.79, &[1.0, 0.5]),
    (1.05, &[1.0, 0.5]),
    (1.4, &[1.0, 0.5]),
    (1.75, &[1.0, 0.5]),
    (2.36, &[1.0, 0.5]),
    (2.8, &[1.0, 0.5]),
    (std::f32::consts::PI, &[1.0, 0.5]),
];

/// Which moving unit gives way when two cannot both pass. Idle units do not
/// steer, so others route around them and push through only when stuck.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum RightOfWay {
    #[default]
    Idle,
    Settle,
    Regroup,
    Harvest,
    Assault,
    Delivery,
}

#[derive(Clone, Default)]
pub(super) struct Navigation {
    path: Vec<(f32, f32)>,
    pub(super) goal: (f32, f32),
    retry: f32,
    // Published to other units: the velocity chosen this step and where it
    // left the unit, the direction it wants to travel and how far before its
    // next waypoint, and its right of way.
    velocity: (f32, f32),
    moved_to: Option<(f32, f32)>,
    heading: (f32, f32),
    ahead: f32,
    right_of_way: RightOfWay,
    blocked: f32,
    // Seconds left routing around stationary units, or negative while
    // waiting to look for such a route again.
    detour: f32,
    // A goal reached before; returning to it after being pushed aside is settling.
    parked: Option<(f32, f32)>,
}

#[derive(Clone, Copy)]
struct Entry {
    index: usize,
    score: f32,
}
impl Eq for Entry {}
impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index && self.score == other.score
    }
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .score
            .total_cmp(&self.score)
            .then_with(|| other.index.cmp(&self.index))
    }
}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// A building footprint grown by a unit's radius: the unit's center must stay out.
#[derive(Clone, Copy)]
struct Block {
    x0: f32,
    x1: f32,
    z0: f32,
    z1: f32,
}

impl Block {
    fn around(building: &Building, clearance: f32) -> Self {
        let (hx, hz) = building_half_size(building.kind);
        Self {
            x0: building.x - hx - clearance,
            x1: building.x + hx + clearance,
            z0: building.z - hz - clearance,
            z1: building.z + hz + clearance,
        }
    }
    fn square(center: (f32, f32), half: f32) -> Self {
        Self {
            x0: center.0 - half,
            x1: center.0 + half,
            z0: center.1 - half,
            z1: center.1 + half,
        }
    }
    fn contains(&self, p: (f32, f32)) -> bool {
        p.0 > self.x0 && p.0 < self.x1 && p.1 > self.z0 && p.1 < self.z1
    }
    fn corners(&self) -> [(f32, f32); 4] {
        let e = 0.01;
        [
            (self.x0 - e, self.z0 - e),
            (self.x1 + e, self.z0 - e),
            (self.x0 - e, self.z1 + e),
            (self.x1 + e, self.z1 + e),
        ]
    }
    /// Parameter range in which `p + v * t` is inside, if any.
    fn overlap(&self, p: (f32, f32), v: (f32, f32), mut enter: f32, mut exit: f32) -> (f32, f32) {
        for (p, v, lo, hi) in [(p.0, v.0, self.x0, self.x1), (p.1, v.1, self.z0, self.z1)] {
            if v.abs() < 1e-6 {
                if p <= lo || p >= hi {
                    return (1.0, 0.0);
                }
            } else {
                let (a, b) = ((lo - p) / v, (hi - p) / v);
                enter = enter.max(a.min(b));
                exit = exit.min(a.max(b));
            }
        }
        (enter, exit)
    }
    // Sliding along an edge or touching a corner does not cross the block.
    fn crossed(&self, a: (f32, f32), b: (f32, f32)) -> bool {
        let d = (b.0 - a.0, b.1 - a.1);
        let (enter, exit) = self.overlap(a, d, 0.0, 1.0);
        (exit - enter) * (d.0 * d.0 + d.1 * d.1).sqrt() > 0.01
    }
    // Seconds until a point moving at `v` enters; never for a point already
    // inside, which collisions push out.
    fn entry_time(&self, p: (f32, f32), v: (f32, f32)) -> f32 {
        if self.contains(p) {
            return f32::INFINITY;
        }
        let (enter, exit) = self.overlap(p, v, 0.0, f32::INFINITY);
        if enter < exit {
            enter
        } else {
            f32::INFINITY
        }
    }
}

/// Buildings as seen by one unit size: `route` adds a margin for planning,
/// `hull` is the contact boundary. Stationary units occupy `taken` places.
/// `hand` is 1 or -1 to mirror the search order between the two teams.
struct Terrain {
    route: Vec<Block>,
    hull: Vec<Block>,
    taken: Vec<((f32, f32), f32)>,
    hand: f32,
}

impl Terrain {
    fn new(buildings: &[Building], unit: &Unit) -> Self {
        let radius = unit.kind.radius();
        let alive = || buildings.iter().filter(|b| b.hp > 0.0);
        Self {
            route: alive().map(|b| Block::around(b, radius + MARGIN)).collect(),
            hull: alive().map(|b| Block::around(b, radius - 0.02)).collect(),
            taken: Vec::new(),
            hand: if unit.team == Team::Player { 1.0 } else { -1.0 },
        }
    }
    fn open(&self, p: (f32, f32)) -> bool {
        p.0.abs() <= FIELD_EDGE && !self.hull.iter().any(|b| b.contains(p))
    }
    fn vacant(&self, p: (f32, f32)) -> bool {
        self.open(p) && self.taken.iter().all(|&(q, reach)| distance(p, q) >= reach)
    }
    // Stationary units near `from` become obstacles too, for a route around a
    // crowd. Their contact squares are trimmed toward the round hulls.
    fn with_crowd(&self, from: (f32, f32)) -> Self {
        let mut terrain = Self {
            route: self.route.clone(),
            hull: self.hull.clone(),
            taken: self.taken.clone(),
            hand: self.hand,
        };
        for &(p, reach) in self.taken.iter().filter(|(p, _)| distance(*p, from) < 15.0) {
            terrain.route.push(Block::square(p, reach + MARGIN));
            terrain.hull.push(Block::square(p, reach * 0.75));
        }
        terrain
    }
    fn clear(&self, a: (f32, f32), b: (f32, f32)) -> bool {
        self.route.iter().zip(&self.hull).all(|(route, hull)| {
            // A unit touching a building may move along or away from it, and
            // a destination may lie beside one; neither may cut through it.
            let block = if route.contains(a) || route.contains(b) {
                hull
            } else {
                route
            };
            block.contains(a) || block.contains(b) || !block.crossed(a, b)
        })
    }
}

fn length(v: (f32, f32)) -> f32 {
    (v.0 * v.0 + v.1 * v.1).sqrt()
}

fn distance(a: (f32, f32), b: (f32, f32)) -> f32 {
    distance_sq(a.0, a.1, b.0, b.1).sqrt()
}

fn circle(center: (f32, f32), radius: f32, hand: f32) -> impl Iterator<Item = (f32, f32)> {
    (0..16).map(move |i| {
        let angle = i as f32 * std::f32::consts::TAU / 16.0;
        (
            center.0 + angle.cos() * radius,
            center.1 + angle.sin() * radius * hand,
        )
    })
}

// Places to stop around a goal, for when its nearest side is blocked.
fn ring(goal: (f32, f32), reach: f32, hand: f32) -> impl Iterator<Item = (f32, f32)> {
    circle(goal, reach, hand).take(if reach >= 1.0 { 16 } else { 0 })
}

// Where to stop for a goal: the nearest point within reach, or the nearest
// vacant one when a stationary unit already stands there. When every such
// place is taken, wait at the closest vacant spot beside them.
fn destination(from: (f32, f32), goal: (f32, f32), reach: f32, terrain: &Terrain) -> (f32, f32) {
    let nearest = approach(from, goal, reach);
    if terrain.vacant(nearest) {
        return nearest;
    }
    let closest = |points: &mut dyn Iterator<Item = (f32, f32)>| {
        points
            .filter(|&p| terrain.vacant(p))
            .min_by(|a, b| distance(from, *a).total_cmp(&distance(from, *b)))
    };
    let hand = terrain.hand;
    closest(&mut ring(goal, reach, hand))
        .or_else(|| {
            (1..=8).find_map(|step| closest(&mut circle(goal, reach + step as f32 * 0.5, hand)))
        })
        .unwrap_or(nearest)
}

// Point `reach` from the goal on the way to `from`: the nearest place to stop.
fn approach(from: (f32, f32), goal: (f32, f32), reach: f32) -> (f32, f32) {
    let d = distance(from, goal);
    if d <= reach || d < 1e-4 {
        return from;
    }
    (
        goal.0 + (from.0 - goal.0) * reach / d,
        goal.1 + (from.1 - goal.1) * reach / d,
    )
}

/// Shortest route around buildings to any point within `stop` of the goal.
/// Bends only at block corners, so the waypoints are few and straight runs
/// follow walls closely. An unreachable goal yields the closest approach and
/// `false`.
fn route(
    from: (f32, f32),
    goal: (f32, f32),
    stop: f32,
    terrain: &Terrain,
) -> (Vec<(f32, f32)>, bool) {
    let mut nodes = vec![from];
    for block in &terrain.route {
        for corner in block.corners() {
            if corner.0.abs() <= FIELD_EDGE && !terrain.route.iter().any(|b| b.contains(corner)) {
                nodes.push(corner);
            }
        }
    }
    let reach = stop.max(0.0);
    let around: Vec<(f32, f32)> = ring(goal, reach, terrain.hand)
        .filter(|&p| terrain.vacant(p))
        .collect();
    let remaining = |p: (f32, f32)| (distance(p, goal) - stop).max(0.0);
    let mut costs = vec![f32::INFINITY; nodes.len()];
    let mut parents = vec![usize::MAX; nodes.len()];
    let mut closed = vec![false; nodes.len()];
    let mut open = BinaryHeap::new();
    costs[0] = 0.0;
    open.push(Entry {
        index: 0,
        score: remaining(from),
    });
    let mut best: Option<(f32, usize, (f32, f32))> = None;
    let mut nearest = (remaining(from), 0);
    while let Some(Entry { index, score }) = open.pop() {
        if closed[index] {
            continue;
        }
        if best.is_some_and(|(cost, _, _)| score >= cost) {
            break;
        }
        closed[index] = true;
        let p = nodes[index];
        if remaining(p) < nearest.0 {
            nearest = (remaining(p), index);
        }
        let projected = approach(p, goal, reach);
        for end in std::iter::once(projected).chain(around.iter().copied()) {
            let cost = costs[index] + distance(p, end);
            if best.is_none_or(|(b, _, _)| cost < b) && terrain.open(end) && terrain.clear(p, end) {
                best = Some((cost, index, end));
            }
        }
        for next in 1..nodes.len() {
            let cost = costs[index] + distance(p, nodes[next]);
            if !closed[next] && cost < costs[next] && terrain.clear(p, nodes[next]) {
                costs[next] = cost;
                parents[next] = index;
                open.push(Entry {
                    index: next,
                    score: cost + remaining(nodes[next]),
                });
            }
        }
    }
    let (mut node, mut path) = match best {
        Some((_, node, end)) => (node, vec![end]),
        None => (nearest.1, Vec::new()),
    };
    while node != 0 {
        path.push(nodes[node]);
        node = parents[node];
    }
    path.reverse();
    (path, best.is_some())
}

/// Driving distances around buildings for one unit size, ignoring other units.
pub(super) struct Roads(Terrain);

impl Roads {
    pub(super) fn new(buildings: &[Building], unit: &Unit) -> Self {
        Self(Terrain::new(buildings, unit))
    }
    /// Length of the route to within `stop` of `goal`; infinite when there is none.
    pub(super) fn distance(&self, from: (f32, f32), goal: (f32, f32), stop: f32) -> f32 {
        let (path, found) = route(from, goal, stop, &self.0);
        if !found {
            return f32::INFINITY;
        }
        path.iter()
            .fold((0.0, from), |(sum, p), &q| (sum + distance(p, q), q))
            .0
    }
}

/// What one unit knows about another when choosing its velocity.
struct Neighbor {
    offset: (f32, f32),
    velocity: (f32, f32),
    reach: f32,
    // Expected to get out of the way, so only imminent contact matters.
    yields: bool,
    // Being pushed aside; ignored entirely.
    shoved: bool,
}

/// What a unit publishes about its movement for others to give way by.
#[derive(Clone, Copy)]
struct Traffic {
    position: (f32, f32),
    heading: (f32, f32),
    right_of_way: RightOfWay,
}

impl Traffic {
    fn of(unit: &Unit) -> Self {
        Self {
            position: (unit.x, unit.z),
            heading: unit.navigation.heading,
            right_of_way: unit.navigation.right_of_way,
        }
    }
    /// `Less` when this unit gives way to `other`. Equals meeting or crossing
    /// both turn aside, each preferring the same side.
    fn precedence(&self, other: &Self) -> Ordering {
        if self.right_of_way != other.right_of_way {
            return self.right_of_way.cmp(&other.right_of_way);
        }
        let (a, b) = (self.heading, other.heading);
        if a.0 * b.0 + a.1 * b.1 <= 0.5 {
            return Ordering::Equal;
        }
        // Travelling together: the unit behind follows the one ahead.
        let ahead = (other.position.0 - self.position.0) * (a.0 + b.0)
            + (other.position.1 - self.position.1) * (a.1 + b.1);
        if ahead > 0.05 {
            Ordering::Less
        } else if ahead < -0.05 {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    }
}

// Seconds until two moving circles touch: `offset` is the other's position
// relative to this unit and `closing` this unit's velocity relative to it.
fn collision_time(offset: (f32, f32), closing: (f32, f32), reach: f32) -> f32 {
    let gap = offset.0 * offset.0 + offset.1 * offset.1 - reach * reach;
    let approach = offset.0 * closing.0 + offset.1 * closing.1;
    if approach <= 0.0 {
        return f32::INFINITY;
    }
    if gap <= 0.0 {
        return 0.0;
    }
    let speed_sq = closing.0 * closing.0 + closing.1 * closing.1;
    let discriminant = approach * approach - speed_sq * gap;
    if discriminant <= 0.0 {
        f32::INFINITY
    } else {
        (approach - discriminant.sqrt()) / speed_sq
    }
}

/// The path ahead of a unit with right of way, relative to the unit giving way.
/// It ends where that unit will stop or turn.
struct Lane {
    origin: (f32, f32),
    heading: (f32, f32),
    half_width: f32,
    length: f32,
}

impl Lane {
    // How far inside the lane a point is, from 0 at its edge to 1 at its center.
    fn depth(&self, p: (f32, f32)) -> f32 {
        let rel = (p.0 - self.origin.0, p.1 - self.origin.1);
        let along = rel.0 * self.heading.0 + rel.1 * self.heading.1;
        let lateral = (self.heading.0 * rel.1 - self.heading.1 * rel.0).abs();
        if along > -0.5 * self.half_width && along < self.length && lateral < self.half_width {
            1.0 - lateral / self.half_width
        } else {
            0.0
        }
    }
}

/// The movement a unit wants this step.
struct Intent {
    position: (f32, f32),
    speed: f32,
    preferred: (f32, f32),
    previous: (f32, f32),
    // Distance to the next waypoint. Walls beyond it do not matter: a unit
    // stopping or turning beside a building is not about to drive into it.
    travel: f32,
    // The waypoint is the destination, where the unit will stop.
    stopping: bool,
    hand: f32,
}

// Choose the velocity closest to the preferred one that avoids predicted
// contact with nearby units, buildings and the field edges, and that clears
// the lanes of units this one gives way to. Running ahead of such a unit only
// helps between walls; elsewhere, stepping aside lets it pass.
fn steer(intent: &Intent, neighbors: &[Neighbor], lanes: &[Lane], hull: &[Block]) -> (f32, f32) {
    let Intent {
        position,
        speed,
        preferred,
        previous,
        travel,
        stopping,
        hand,
    } = *intent;
    // A unit holding its place samples every direction to step aside.
    let preferred_speed = length(preferred);
    let direction = if preferred_speed < 1e-4 {
        (1.0, 0.0)
    } else {
        (preferred.0 / preferred_speed, preferred.1 / preferred_speed)
    };
    let penalty = |tau: f32, horizon: f32| {
        if tau < horizon {
            AVOIDANCE * (1.0 / tau.max(0.02) - 1.0 / horizon)
        } else {
            0.0
        }
    };
    let mut best = ((0.0, 0.0), f32::INFINITY);
    let mut consider = |v: (f32, f32), bias: f32| {
        let deviation = (length((v.0 - preferred.0, v.1 - preferred.1))
            + SMOOTHING * length((v.0 - previous.0, v.1 - previous.1)))
            / speed
            + bias;
        let edge = if v.0 > 1e-6 {
            (FIELD_EDGE - position.0) / v.0
        } else if v.0 < -1e-6 {
            (position.0 + FIELD_EDGE) / -v.0
        } else {
            f32::INFINITY
        };
        let arrival = travel / length(v).max(1e-6);
        let (stuck, wall) = hull
            .iter()
            .map(|block| block.entry_time(position, v))
            .chain([edge])
            .fold((f32::INFINITY, 0.0f32), |(stuck, wall), tau| {
                let hit = if tau < arrival {
                    penalty(tau, WALL_HORIZON)
                } else {
                    0.0
                };
                (stuck.min(tau), wall.max(hit))
            });
        // A unit cannot leave a lane through a wall.
        let deviation = deviation
            + LANE_WEIGHT
                * LANE_LOOKAHEAD
                    .iter()
                    .map(|&t| {
                        let t = t.min(stuck);
                        lanes
                            .iter()
                            .map(|lane| lane.depth((v.0 * t, v.1 * t)))
                            .fold(0.0, f32::max)
                    })
                    .fold(f32::INFINITY, f32::min);
        let mut cost = deviation + wall;
        if cost >= best.1 {
            return;
        }
        for n in neighbors.iter().filter(|n| !n.shoved) {
            let mut tau =
                collision_time(n.offset, (v.0 - n.velocity.0, v.1 - n.velocity.1), n.reach);
            if stopping && tau > arrival {
                // Contact after arriving only happens if the other unit comes
                // to the destination.
                let offset = (
                    n.offset.0 + (n.velocity.0 - v.0) * arrival,
                    n.offset.1 + (n.velocity.1 - v.1) * arrival,
                );
                tau = arrival + collision_time(offset, (-n.velocity.0, -n.velocity.1), n.reach);
            }
            let horizon = if n.yields { YIELDING_HORIZON } else { HORIZON };
            cost = cost.max(deviation + penalty(tau, horizon));
            if cost >= best.1 {
                return;
            }
        }
        if cost < best.1 {
            best = (v, cost);
        }
    };
    consider(preferred, 0.0);
    consider((0.0, 0.0), 0.0);
    for (turn, fractions) in TURNS {
        let (sin, cos) = turn.sin_cos();
        for side in [hand, -hand] {
            if side < 0.0 && (turn == 0.0 || turn == std::f32::consts::PI) {
                continue;
            }
            let heading = (
                direction.0 * cos - direction.1 * sin * side,
                direction.0 * sin * side + direction.1 * cos,
            );
            for fraction in fractions {
                consider(
                    (heading.0 * speed * fraction, heading.1 * speed * fraction),
                    if side * hand > 0.0 { SIDE_BIAS } else { 0.0 },
                );
            }
        }
    }
    best.0
}

/// A unit that will not move this step; others treat it as an obstacle.
pub(super) fn hold(unit: &mut Unit) {
    unit.navigation.velocity = (0.0, 0.0);
    unit.navigation.moved_to = Some((unit.x, unit.z));
    unit.navigation.right_of_way = RightOfWay::Idle;
}

// How a unit actually moved last step: a unit pressing against an obstacle is
// pushed back by collisions and is not going anywhere.
fn motion(unit: &Unit, dt: f32) -> (f32, f32) {
    let n = &unit.navigation;
    match n.moved_to {
        Some((x, z)) => (
            n.velocity.0 + (unit.x - x) / dt,
            n.velocity.1 + (unit.z - z) / dt,
        ),
        None => n.velocity,
    }
}

// The nearest open point for a unit pushed against or into a building,
// such as into a gap narrower than itself.
fn escape(from: (f32, f32), terrain: &Terrain) -> Option<(f32, f32)> {
    (1..=16)
        .find_map(|step| circle(from, step as f32 * 0.25, terrain.hand).find(|&p| terrain.open(p)))
}

// Follow the route to the goal, replanning when it is blocked or the goal
// moves. Returns the preferred velocity, the distance to the next waypoint
// and whether that waypoint is where the unit stops.
fn plan(
    unit: &mut Unit,
    goal: (f32, f32),
    stop: f32,
    dt: f32,
    terrain: &Terrain,
) -> ((f32, f32), f32, bool) {
    let from = (unit.x, unit.z);
    let speed = unit.kind.speed();
    if !terrain.open(from) {
        if let Some(exit) = escape(from, terrain) {
            // Plan afresh once clear.
            unit.navigation.path.clear();
            unit.navigation.retry = 0.0;
            let gap = distance(from, exit);
            return (
                (
                    (exit.0 - from.0) / gap * speed,
                    (exit.1 - from.1) / gap * speed,
                ),
                gap,
                false,
            );
        }
    }
    let direct = destination(from, goal, stop.max(0.0), terrain);
    let navigation = &mut unit.navigation;
    navigation.retry -= dt;
    if terrain.open(direct) && terrain.clear(from, direct) {
        navigation.path.clear();
        navigation.path.push(direct);
        navigation.goal = goal;
    } else if distance(goal, navigation.goal) > 1.0
        || navigation
            .path
            .first()
            .is_some_and(|&p| !terrain.clear(from, p))
        || (navigation.retry <= 0.0
            && (navigation.path.is_empty() || navigation.blocked > PUSH_AFTER))
    {
        navigation.path = route(from, goal, stop, terrain).0;
        navigation.goal = goal;
        navigation.retry = 0.5;
    }
    // Cut corners as soon as the following waypoint is in sight.
    while navigation.path.len() > 1 && terrain.clear(from, navigation.path[1]) {
        navigation.path.remove(0);
    }
    let target = navigation.path.first().copied().unwrap_or(direct);
    let gap = distance(from, target);
    navigation.ahead = gap;
    let last_leg = navigation.path.len() <= 1;
    let preferred_speed = if last_leg { speed.min(gap / dt) } else { speed };
    if gap < 1e-4 || preferred_speed < 1e-4 {
        return ((0.0, 0.0), gap, last_leg);
    }
    navigation.heading = ((target.0 - from.0) / gap, (target.1 - from.1) / gap);
    (
        (
            navigation.heading.0 * preferred_speed,
            navigation.heading.1 * preferred_speed,
        ),
        gap,
        last_leg,
    )
}

pub(super) fn move_toward(
    unit: &mut Unit,
    goal: (f32, f32),
    stop: f32,
    dt: f32,
    units: &[Unit],
    buildings: &[Building],
    right_of_way: RightOfWay,
) {
    let from = (unit.x, unit.z);
    let remaining = distance(from, goal);
    let (radius, speed) = (unit.kind.radius(), unit.kind.speed());
    // An arrived unit only moves to let others through. Units taking their
    // place give way to traffic passing through it.
    let arrived = remaining <= stop + 0.01;
    if arrived {
        unit.navigation.parked = Some(goal);
    }
    let mut settling = remaining - stop < radius + 0.5;
    let displaced = unit
        .navigation
        .parked
        .is_some_and(|parked| distance(parked, goal) < 1.0);
    let right_of_way = if settling || displaced {
        RightOfWay::Settle
    } else {
        right_of_way
    };
    let mut terrain = Terrain::new(buildings, unit);
    let (preferred, travel, stopping) = if arrived {
        unit.navigation.path.clear();
        unit.navigation.blocked = 0.0;
        unit.navigation.ahead = 0.0;
        ((0.0, 0.0), f32::INFINITY, false)
    } else {
        terrain.taken = units
            .iter()
            .filter(|u| {
                u.id != unit.id && u.on_field() && u.navigation.right_of_way == RightOfWay::Idle
            })
            .map(|u| ((u.x, u.z), radius + u.kind.radius()))
            .collect();
        // Held up by stationary units: route around them for a while, if
        // there is a way around; otherwise push through.
        let navigation = &mut unit.navigation;
        navigation.detour = if navigation.detour > 0.0 {
            (navigation.detour - dt).max(0.0)
        } else {
            (navigation.detour + dt).min(0.0)
        };
        if navigation.blocked > DETOUR_AFTER && navigation.detour == 0.0 {
            if route(from, goal, stop, &terrain.with_crowd(from)).1 {
                navigation.detour = DETOUR;
                navigation.path.clear();
                navigation.retry = 0.0;
            } else {
                navigation.detour = -DETOUR_RETRY;
            }
        }
        let planned = if navigation.detour > 0.0 {
            plan(unit, goal, stop, dt, &terrain.with_crowd(from))
        } else {
            plan(unit, goal, stop, dt, &terrain)
        };
        // Waiting beside a goal that others occupy.
        settling |= length(planned.0) < 1e-3;
        planned
    };
    let pushing = unit.navigation.blocked > PUSH_AFTER;
    let traffic = Traffic {
        right_of_way,
        ..Traffic::of(unit)
    };
    let mut previous = (0.0, 0.0);
    let mut neighbors = Vec::new();
    let mut lanes = Vec::new();
    for other in units {
        if other.id == unit.id {
            previous = motion(other, dt);
            continue;
        }
        if !other.on_field() {
            continue;
        }
        let offset = (other.x - from.0, other.z - from.1);
        let reach = radius + other.kind.radius() + BUFFER;
        // Opposing units stop to fight at range instead of driving through,
        // so only where they stand matters.
        let ally = other.team == unit.team;
        let mut velocity = if ally { motion(other, dt) } else { (0.0, 0.0) };
        // Too far away to touch within the horizon.
        if length(offset) - reach > (speed + other.kind.speed()) * HORIZON {
            continue;
        }
        // Only allies make way for each other.
        let idle = other.navigation.right_of_way == RightOfWay::Idle;
        let precedence = if ally {
            Traffic::of(other).precedence(&traffic)
        } else {
            Ordering::Equal
        };
        let yields = !idle && precedence == Ordering::Less;
        if !idle && precedence == Ordering::Greater {
            // Clear the way for a unit with right of way that is coming
            // through, unless already travelling ahead of it at its pace.
            let heading = other.navigation.heading;
            let lane = Lane {
                origin: offset,
                heading,
                half_width: reach + 0.3,
                length: other.navigation.ahead + reach,
            };
            let along = -offset.0 * heading.0 - offset.1 * heading.1;
            let leaving =
                preferred.0 * heading.0 + preferred.1 * heading.1 >= 0.8 * other.kind.speed();
            if !leaving
                && along - reach < other.kind.speed() * YIELD_AHEAD
                && lane.depth((0.0, 0.0)) > 0.0
            {
                lanes.push(lane);
                // Expect it to keep coming, even if it paused for this unit:
                // moving back into its way whenever it hesitates would
                // leave both units shuffling in place.
                velocity = (
                    heading.0 * other.kind.speed(),
                    heading.1 * other.kind.speed(),
                );
            }
        }
        neighbors.push(Neighbor {
            offset,
            velocity,
            reach,
            yields,
            shoved: ally && (idle || yields),
        });
    }
    // A unit giving way never shoves others toward the unit it is making
    // room for.
    let yielding = !lanes.is_empty();
    for n in &mut neighbors {
        n.shoved &= pushing && !yielding;
    }
    if arrived && lanes.is_empty() {
        return;
    }
    let velocity = steer(
        &Intent {
            position: from,
            speed,
            preferred,
            previous,
            travel: if yielding { f32::INFINITY } else { travel },
            stopping: !yielding && stopping,
            hand: terrain.hand,
        },
        &neighbors,
        &lanes,
        &terrain.hull,
    );
    unit.x = (unit.x + velocity.0 * dt).clamp(-FIELD_EDGE, FIELD_EDGE);
    unit.z += velocity.1 * dt;
    let navigation = &mut unit.navigation;
    navigation.velocity = velocity;
    navigation.moved_to = Some((unit.x, unit.z));
    // A unit stopped at its destination is part of the terrain: others route
    // around it instead of waiting for it to move.
    navigation.right_of_way = if settling && length(velocity) < 0.05 * speed {
        RightOfWay::Idle
    } else {
        right_of_way
    };
    let heading = navigation.heading;
    if !settling && velocity.0 * heading.0 + velocity.1 * heading.1 < 0.3 * length(preferred) {
        navigation.blocked += dt;
    } else {
        navigation.blocked = (navigation.blocked - dt).max(0.0);
    }
}
