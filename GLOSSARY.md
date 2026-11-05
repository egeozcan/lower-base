# Lower Base

A single-player real-time strategy game: two bases, one southern (player) and one northern (enemy), fight until one side has no units or buildings left.

## Match setup

**Game Mode**:
The ruleset a match is played under, which determines what each side starts with, how it earns credits and what it can construct. It is chosen separately from Difficulty.
_Avoid_: Mode type, scenario

**Deathmatch**:
The Game Mode where each side starts with its whole base and a small army, earns a large Passive Income and can construct only Guns. This is the default Game Mode.
_Avoid_: Classic, skirmish

**Standard**:
The Game Mode where each side starts with only a Command Center and has to construct the rest of its base on Sites.
_Avoid_: Normal, build mode

**Difficulty**:
How capable the computer commander's decisions are (Easy, Medium, Hard). It never changes resources or unit stats.
_Avoid_: Level, AI mode

## Base

**Command Center**:
A side's core building. It defends itself with its own gun and is required for all Construction.
_Avoid_: HQ, construction yard

**Site**:
A fixed, marked spot in a base where one specific structure can be constructed. Barracks, Factory, Refinery and each Gun have their own Site.
_Avoid_: Slot, lot, placement

**Pad**:
The Site of a Gun. Each base has two, left and right.
_Avoid_: Emplacement slot

**Gun**:
A fixed anti-tank defense constructed on a Pad.
_Avoid_: Turret, emplacement (in player-facing text)

**Structure**:
A building that can be constructed on a Site: Barracks, Factory, Refinery or Gun. The Command Center is a building but not a Structure.
_Avoid_: Building (when the constructible kind is meant)

**Construction**:
A Command Center building a Structure on its Site over time. The Structure exists, and can be attacked, while it is under Construction. Only one non-Gun Structure can be under Construction at a time, while each Pad builds its Gun independently.
_Avoid_: Placement, deploy

## Economy

**Passive Income**:
Credits each side earns per second regardless of what it does, set by the Game Mode.
_Avoid_: Trickle, tick income

**Refinery**:
The Structure where Collectors deliver ore. Every Refinery a Command Center constructs, including a rebuilt one, comes with one Collector. A side can only produce Collectors while it has a finished Refinery.
_Avoid_: Ore depot

**Collector**:
An unarmed unit that mines ore and delivers it to its side's Refinery.
_Avoid_: Harvester, miner
