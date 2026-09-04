# Tem's Weapons v1.2.0

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
