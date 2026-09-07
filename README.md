# Tem's Weapons

A custom weapon library and automation module for **Foundry Virtual Tabletop** using the **D&D5e** system.

Tem's Weapons is built around unusual, character-specific weapons with custom resources, modes, reactions, movement riders, and combat automation. The module is designed to handle repetitive bookkeeping while leaving positioning or table-dependent rulings visible to the player/GM when automatic resolution would be unreliable.

## Current Version

**v1.4.0**

Tested with:

- Foundry VTT **v14**
- D&D5e **5.3.2**
- 2024 ruleset

## Installation

### Manual installation

1. Download the ZIP for the version you want from the GitHub Releases page.
2. Shut down Foundry VTT.
3. Extract the module into your Foundry data folder at:

   `Data/modules/tems-weapons/`

4. Start Foundry.
5. Open your world and enable **Tem's Weapons** under **Manage Modules**.
6. Enter the world as a GM so bundled items and migrations can initialize.

When updating manually, replace the contents of the existing `tems-weapons` module folder with the new release.

## What the module does

Tem's Weapons provides custom D&D5e items and automation for weapon-specific mechanics such as:

- custom resource counters
- weapon modes and transformations
- hit-confirmed resource generation and spending
- multi-attack sequences
- reactions and temporary AC changes
- stateful combat mechanics
- activity visibility based on weapon state
- combat-reset resources
- token movement for selected abilities
- automatic migration of older bundled items when required

The module uses stable identifiers to avoid duplicating bundled weapons when a world already contains them.

## Included Weapons and Features

### STARS

- **Charge Blade**
  - Sword and Axe modes
  - Charge and Phials
  - Shield charging
  - Element Discharge, AED, and SAED
  - Guard Point
  - charged Axe bonus damage

- **Sword & Shield**
  - Sword Slash
  - +2 AC while equipped
  - Shield Bash

- **Dual Blades**
  - two-hit Flurry
  - Demon Mode
  - +10 ft movement and -2 AC while Demon Mode is active
  - empowered second Flurry strike

- **Longsword**
  - Spirit resource from 0-100
  - White / Yellow / Red Spirit levels
  - Spirit Slash
  - Roundslash
  - Helm Breaker

- **Gunlance**
  - Shell resource
  - Shelling
  - Full Burst
  - Reload
  - Wyvern's Fire

### Coral

- **Greatsword**
  - Greatsword Slash
  - Charged Slash
  - Shoulder Tackle

- **Teleportation Chakram**
  - thrown attack
  - location marking
  - teleport to marked location
  - recall / clear mark

- **Tire Iron & Tires**
  - Tire Iron
  - Launch Tire
  - Ricochet Tire
  - Tire Boost
  - 3-Tire reloadable resource

### Gaunt

- **Bombs**
  - 3-use bomb pouch
  - Throw Bomb
  - Prime Bomb
  - Throw Primed Bomb

- **Harpoon**
  - Harpoon Shot
  - tethered target tracking
  - Reel Target
  - Reel Self
  - Release Tether

- **Meteor Hammer / Censer**
  - Meteor Strike
  - Sweeping Censer
  - Dazed save rider

- **Jet Hammer**
  - 3 Fuel
  - Swing
  - Jet Smash
  - Jet Launch
  - Maximum Thrust
  - Vent / Refuel

### Fault

- **Sniper Rifle**
  - 2d10 piercing
  - 150/600 range
  - Take Aim
  - critical Headshot bonus

- **Twin Scimitars**
  - two separate scimitar attacks
  - Crosscut Bonus

- **Cane Sword / Rifle**
  - Sword and Rifle modes
  - Sword Slash
  - Rifle Shot
  - Transform

- **Built-In Blades & Bare-Knuckle Brawling**
  - Bare-Knuckle Strike
  - Chitin Blade
  - Twin Blade Flurry
  - Raking Lunge
  - Mantis Guard

### Candy

- **Electrified Javelin**
  - piercing + lightning damage
  - Overcharged Throw

- **Hatchet**
  - fast thrown slashing weapon
  - 20/60 range

- **Sawblade**
  - thrown slashing weapon
  - 30/90 range
  - 10-ft reposition rider on hit

- **Cleaver**
  - heavy melee slash
  - Momentum Cleave after moving 10 ft

- **Blast Fists**
  - 3 Blast Charges
  - Blast Punch
  - Heavy Blast Punch
  - Blast Launch
  - Reload Charges

### Rival

- **Gunheels / Pistols**
  - Combo resource
  - Pistol Barrage
  - Heel Shot
  - Afterburner Kick
  - Dodge Offset
  - Bullet Climax

### Claire's Might

A custom feat that directly interacts with the owned **Charge Blade** rather than replacing it.

- **3 Surges per combat**
- **Claire's Stance** lasts 3 of Claire's turns
- Stance activation grants at least Yellow Charge
- **Ratchet** functions as a persistent Charge engine during Stance
- **Phial Cascade** performs a two-hit sequence and can load Phials on hit
- **Axe Pump Load** rapidly loads Phials while remaining in Axe Mode
- **Axe Guard Point** and **Axe Counter**
- **Boosted Sword Combo**
- **Boosted Axe Combo**
- **Morph** shares the real Charge Blade Sword/Axe state
- **Earth-Shattering SAED** consumes an additional Surge and all loaded Phials

At 5 loaded Phials, Earth-Shattering SAED deals:

`3d12 slashing + 10d8 force`

and returns the Charge Blade to Sword Mode.

## Manual / Positioning Riders

Not every movement or positioning effect is automatically enforced. Some abilities deliberately provide their movement or push instructions in the activity text so the player and GM can resolve the exact destination at the table.

In v1.4.0 this includes effects such as:

- Tire Boost movement
- Launch Tire push
- Sawblade repositioning
- Raking Lunge movement
- other effects whose exact position depends on battlefield geometry

This is intentional and does not indicate that the attack itself is malfunctioning.

## Version Highlights

### v1.4.0

Adds the first new weapon batch after Claire's Might:

- Coral — Tire Iron & Tires
- Candy — Hatchet
- Candy — Sawblade
- Candy — Cleaver
- Candy — Blast Fists
- Fault — Built-In Blades & Bare-Knuckle Brawling

Also includes automatic Twin Blade Flurry follow-up handling and Mantis Guard automation.

### v1.3.x

Introduced and stabilized **Claire's Might**, including:

- Claire's Stance
- Surges
- Ratchet engine
- Phial Cascade
- shared Charge Blade Morph state
- boosted Sword/Axe attacks
- Axe defensive tools
- Earth-Shattering SAED

The final v1.3.13 build corrected Ratchet and Phial Cascade's automatic second-strike behavior and paired hit counting.

### v1.2.x

Added the mechanic-heavy weapon batch and stabilized the module's shared automation systems, including:

- Longsword
- Gunlance
- Jet Hammer
- Harpoon
- Teleportation Chakram
- Meteor Hammer / Censer
- Cane Sword / Rifle
- Gunheels / Pistols

Also stabilized Dual Blades Demon Mode, resource synchronization, activity visibility, and startup behavior.

### v1.1.x

Added the first straightforward weapon batch:

- Greatsword
- Bombs
- Sniper Rifle
- Twin Scimitars
- Electrified Javelin
- Sword & Shield
- Dual Blades

### v1.0.x

Initial Charge Blade release and automation foundation.

## Updating Existing Worlds

Tem's Weapons attempts to preserve existing bundled items and update required data without creating duplicates.

Because custom weapons may store state in item flags or Active Effects, it is still recommended to:

1. update the module while Foundry is closed;
2. launch the world as a GM;
3. allow startup migrations to finish;
4. test major weapon modes/resources before a session after installing a large update.

## Troubleshooting

If an activity behaves unexpectedly:

1. Confirm the correct version of Tem's Weapons is installed and enabled.
2. Reload the Foundry world after updating.
3. Check that the actor owns the expected weapon/feat copy.
4. Verify required resources, mode, and combat state.
5. Check the browser developer console for red errors.
6. When reporting a bug, include the weapon/activity name, what you clicked, what you expected, what happened instead, and a screenshot or console stack trace when available.

## Project Status

Tem's Weapons is actively being expanded. Additional custom weapons and larger weapon systems are planned for later releases.

## License / Usage

This is a custom Foundry VTT module made for private tabletop use. Any third-party game names or inspirations referenced by individual weapon concepts belong to their respective owners.
