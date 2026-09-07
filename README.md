# Tem's Weapons v1.2.8

Foundry VTT v14 / D&D5e 5.3.x

## Included weapons

Tem's weapons
- Charge Blade
- Coral
  - Greatsword
- Gaunt
  - Bombs
- Fault
  - Sniper Rifle
  - Twin Scimitars
- Candy
  - Electrified Javelin
- STARS
  - Sword & Shield
  - Dual Blades

## Installation

1. Shut down Foundry.
2. Replace the existing `Data/modules/tems-weapons/` folder with this version.
3. Start Foundry and enable **Tem's Weapons**.
4. Enter the world as a GM.

The module automatically creates missing folders and bundled weapon items. Existing bundled
weapons are detected by stable identifier and are not duplicated.

## Straightforward batch mechanics

### Coral — Greatsword
- Greatsword Slash: 2d6 slashing.
- Charged Slash: 4d6 slashing; intended only when the wielder has not moved before the attack.
- Shoulder Tackle: reaction, roll 1d8 + STR modifier to reduce incoming physical damage.

### Gaunt — Bombs
- Bomb Pouch: 3 item uses.
- Throw Bomb: 2d6 fire, 10-ft blast, Dexterity save described on the activity.
- Prime Bomb: bonus-action setup.
- Throw Primed Bomb: 3d6 fire, 15-ft blast.
- Bomb activities consume one item use when D&D5e consumption is available.

### Fault — Sniper Rifle
- 2d10 piercing, range 150/600.
- Take Aim: bonus-action tactical activity; advantage/cover are currently applied by the player.
- Headshot: critical hits add an extra 2d10 automatically through the attack activity.

### Fault — Twin Scimitars
- Two 1d6 slashing attacks.
- Crosscut Bonus: explicit 1d6 roll used once per turn if both attacks hit the same target.

### Candy — Electrified Javelin
- 1d6 piercing + 1d6 lightning, range 30/120.
- Overcharged Throw includes the Constitution-save / no-reactions rider in its chat instructions.

### STARS — Sword & Shield
- Sword Slash: 1d8 slashing.
- Equipped weapon automatically grants +2 AC.
- Shield Bash: bonus-action 1d4 bludgeoning with the 5-ft push rider described in chat.

### STARS — Dual Blades
- Flurry uses two explicit 1d6 slashing attacks.
- Demon Mode is a bonus-action toggle.
- Demon Mode automatically gives +10 ft walking speed and -2 AC.
- While Demon Mode is active, damage from Flurry — Second Blade automatically rolls +1d6 slashing.

## Notes

The module automates bookkeeping where the rules are unambiguous. Tactical conditions such as
"did not move before Charged Slash", Take Aim's positioning requirement, both scimitars hitting
the same target, and save riders remain explicit activities/instructions rather than hidden
automatic decisions.

## v1.1.1 icon update

Added supplied custom icons for:
- Fault — Twin Scimitars
- Candy — Electrified Javelin
- STARS — Sword & Shield

The bundled item and its activities use the matching icon.


## v1.2.0 Mechanic-heavy batch
Adds Teleportation Chakram, Harpoon, Meteor Hammer/Censer, Jet Hammer, Cane Sword/Rifle, Gunheels/Pistols, Longsword, and Gunlance. Also removes the duplicate Dual Blades Demon Mode update hook that caused the ActiveEffect deletion race.


## v1.2.1 hotfix
Fixes a duplicate JavaScript helper declaration that prevented the module script from loading, so the mechanic-heavy bundled weapons now import on GM ready.

## v1.2.2 mechanic-heavy stabilization

- Harpoon Reel Target and Reel Self now physically move tokens 10 ft toward the other end of the tether.
- Meteor Hammer/Censer automatically rolls a CON save after a confirmed hit and applies Dazed for 1 round on failure.
- Jet Hammer Fuel is mirrored to the D&D5e item Uses counter and announced after fuel actions.
- Longsword Spirit is mirrored to the item Uses counter; notifications show Spirit and White/Yellow/Red level.
- Gunlance Shells are mirrored to the item Uses counter and announced after shell actions.
- Cane Sword/Rifle now synchronizes native D&D5e activity visibility before the activity chooser opens.
- Dual Blades Demon Mode now adds/removes a real 1d6 slashing damage part on Flurry — Second Blade instead of relying on a separate damage hook.
- Existing world/actor items are migrated on GM ready; deletion/re-import should not be necessary.

## v1.2.3 state-order fixes

- Meteor Hammer/Censer CON save and Dazed are intentionally manual.
- Jet Hammer Fuel is checked and spent in `dnd5e.preUseActivity`, preventing powered attacks at insufficient Fuel.
- Vent / Refuel restores Fuel to 3 without spending Fuel first.
- Longsword Spirit gain/spend and Spirit Level changes occur only after a confirmed hit.
- Longsword Spirit attacks are blocked before use if the required Spirit/Spirit Level is unavailable.
- Dual Blades Demon Mode now toggles from the actor's real ActiveEffect state, fixing inverted ON/OFF behavior.

## v1.2.4 synchronization fixes

- Jet Hammer Fuel flag and visible Uses counter are now updated atomically, eliminating the one-step display lag.
- Longsword uses the same correct `dnd5e.postRollAttack(rolls, data)` hit-confirmation pattern as Charge Blade.
- Longsword state and its visible 0–100 indicator are updated together.
- Dual Blades now resets to a known Demon Mode OFF state on world load and toggles only from its authoritative stored state.

## v1.2.5 Dual Blades toggle debounce

- Demon Mode now ignores duplicate D&D5e activity callbacks from the same button press.
- One button press can only toggle Demon Mode once.
- This fixes the first-press no-op / second-press inverted-state behavior.

## v1.2.6 Dual Blades ActiveEffect cleanup

- Demon Mode now removes all stale/duplicate effects before creating a new one.
- Turning Demon Mode OFF removes every effect tied to that Dual Blades item.
- Turning Demon Mode ON creates exactly one `-2 AC / +10 ft movement` effect.
- World load cleanup purges legacy stacked Demon Mode effects and initializes the weapon OFF.
- Prevents AC from stacking downward across repeated activations.

## v1.2.7 Dual Blades authoritative effect state

- Demon Mode no longer decides ON/OFF from the stored flag.
- The actual Demon Mode ActiveEffect is now authoritative.
- If the effect exists, the next press turns Demon Mode OFF.
- If no effect exists, the next press turns Demon Mode ON.
- The stored flag is synchronized afterward to mirror the actual effect state.

## v1.2.8 startup silence + Dual Blades rewrite

- Jet Hammer and Longsword migration/synchronization no longer emit notifications on world startup.
- Dual Blades Demon Mode toggle logic was rewritten rather than further patched.
- Startup only cleans legacy effects and establishes a silent OFF state.
- Each Demon Mode use explicitly flips OFF->ON or ON->OFF once.
- Applying the mode first removes every legacy effect from the weapon, then creates exactly one effect when ON.
- AC, movement, stored state, and Second Blade damage are synchronized from the requested boolean state.


## v1.3.1 — Claire's Might
Adds the Claire's Might feat and Combat Tracker-driven Charge Blade stance automation (3 Surges per combat, 3-turn stance, Ratchet engine, boosted combos, Axe Pump Load/Guard Point/Counter, Phial Cascade, and Earth-Shattering SAED).

## v1.3.3 — Claire activity routing fix
Suppresses forced Charge Blade actor-sheet rerenders while Claire's Might is resolving. This prevents the originating Claire activity click from being invalidated and falling through to the Charge Blade item chooser.


### v1.3.10
- Blocks the stray Charge Blade activity chooser at the official `dnd5e.preUseItem` hook after a Claire's Might activity.
- Keeps the guard one-shot and actor-scoped so ordinary Charge Blade use remains unchanged.


### v1.3.10
- Claire's Might now opens a short actor-scoped activity window that completely bypasses the legacy Charge Blade Item.use chooser route during Claire activity resolution.
- Charge Blade chooser pre-sync no longer rerenders the actor sheet during the originating click.


## v1.3.10 Claire's Might architecture reset
Claire's Might now owns its own activity flow. Its activities stay visible and validate their requirements at use-time. The feat reads/writes the existing Charge Blade's state directly but never invokes or depends on the Charge Blade item-use/activity chooser. Older v1.3.x visibility state on owned Claire's Might feats is reset automatically on startup.
