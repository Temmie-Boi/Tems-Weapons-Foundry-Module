# Tem's Weapons

Custom D&D5e weapons and automation for Foundry VTT.

**Current version:** `1.6.2`  
**Foundry VTT:** v14  
**D&D5e system:** 5.3.x (`5.3.2` verified)

## What this module does

Tem's Weapons installs a library of custom weapons, a custom feat, and their supporting automation into a D&D5e world.

On GM world load the module creates a root **Tem's weapons** Item folder and imports any bundled Items that are missing. Existing bundled Items are detected by their stable `system.identifier`, so normal reloads do not create duplicate copies.

Several existing world Items and actor-owned copies are also migrated/synchronized when newer automation requires it.

## Included content

### Charge Blade

A fully stateful Charge Blade implementation with:

- Sword Slash
- Axe Slash
- Element Discharge
- Amped Element Discharge (AED)
- Super Amped Element Discharge (SAED)
- Morph
- Load Phials
- Charge Shield
- Guard Point

The automation tracks Charge, Phials, weapon mode, charged-shield state, mode-dependent activity visibility, and the Charge Blade's special attacks.

### Claire's Might

A custom feat that extends the existing Charge Blade rather than replacing it.

Included actions:

- Claire's Stance
- Ratchet
- Phial Cascade
- Axe Pump Load
- Axe Guard Point
- Axe Counter
- Boosted Sword Combo
- Boosted Axe Combo
- Earth-Shattering SAED
- Morph

Core behavior includes:

- **3 Surges per combat**
- **Claire's Stance lasts 3 of Claire's turns**
- entering Stance raises Charge to at least Yellow / 3 Charge
- Ratchet functions as a Charge-building engine while Stance is active
- Ratchet's two confirmed hits accelerate Charge to 4
- Phial Cascade performs two strikes and can load available Charge into Phials after connecting
- Axe Pump Load loads Phials while remaining in Axe Mode
- boosted Sword and Axe combinations use automatic internal follow-up strikes
- Earth-Shattering SAED requires Stance, Axe Mode, a charged shield, loaded Phials, and an additional Surge
- Earth-Shattering SAED deals `3d12 slashing + 2d8 force per loaded Phial`, consumes the loaded Phials, and returns the Charge Blade to Sword Mode
- Claire's Might and the Charge Blade share the same actual Sword/Axe mode

Internal follow-up activities are hidden from the normal activity picker and are resolved automatically by the module.

## Weapon library

The current bundle contains the following weapon Items:

- Argus Class Steamknight
- Berried Delight
- Blast Fists
- Bombs
- Bouquet of Roses
- Built-In Blades & Bare-Knuckle Brawling
- Cane Sword / Cane Rifle
- Charge Blade
- Cleaver
- Dual Blades
- Electrified Javelin
- Greatsword
- Gunheels / Pistols
- Gunlance
- Harpoon
- Hatchet
- Jet Hammer
- Jet-Propelled Skateboard
- Kanabo / Iron Maiden
- Longsword
- Meteor Hammer / Censer
- Motorbike / Chainsaw / Chaingun
- Paris Class Steamknight
- Sawblade
- Sniper Rifle
- Sword & Shield
- Teleportation Chakram
- Tire Iron & Tires
- Twin Scimitars

Claire's Might is bundled separately as a Feat.

## Selected automated systems

### Motorbike / Chainsaw / Chaingun

A three-mode weapon. Only the activities for the current mode are presented for use.

**Motorbike Mode**
- Drive
- Ram
- Burnout

**Chainsaw Mode**
- Chainsaw Slash
- Revving Cut
- Grind
- Rip Through

**Chaingun Mode**
- Chaingun Burst
- Spin Up
- Full Auto
- Strafing Fire

Revving Cut, Chaingun Burst, Full Auto, and Strafing Fire use hidden internal follow-up attacks. Spin Up enables Full Auto. Switching modes clears incompatible temporary state. Version 1.6.2 synchronizes mode visibility before the D&D5e picker opens, so the new mode appears on the first click after switching.

### Argus Class Steamknight

- Heavy Cannon
- Sustained Fire
- Suppressive Barrage
- Brace
- Advance
- Overwatch

Brace grants **+2 to Heavy Cannon attack rolls** and adds a **fourth Sustained Fire shot**. Moving the token ends Brace automatically.

### Paris Class Steamknight

- High-Speed Strike
- Burst Fire
- Jet Dash
- Drive-By Attack
- Disengage Burst
- Alpha Strike

Burst Fire resolves as three separate attack rolls. Position-dependent movement remains player/GM controlled.

### Berried Delight

- Judgement Cut
- Rapid Draw
- Sheathe Counter
- Blink Slash
- Perfect Cut

Rapid Draw performs two attack rolls. Blink Slash primes the next appropriate attack for its bonus damage.

### Jet-Propelled Skateboard

Uses a 3-Fuel resource and includes:

- Board Bash
- Jet Rush
- Drive-By Strike
- Rocket Jump
- Refuel

### Kanabo / Iron Maiden

- Kanabo Smash
- Driving Blow
- Iron Maiden
- Crushing Closure

Control and forced-movement riders are intentionally resolved manually.

### Bouquet of Roses

- Rose Strike
- Thorn Scatter
- Stem Lash
- Petal Feint

Petal Feint's tactical Advantage rider is player/GM resolved.

### Tire Iron & Tires

Uses a 3-Tire resource and includes:

- Tire Iron
- Launch Tire
- Ricochet Tire
- Tire Boost
- Reload Tires

### Blast Fists

Uses 3 Blast Charges and includes:

- Blast Punch
- Heavy Blast Punch
- Blast Launch
- Reload Charges

### Built-In Blades & Bare-Knuckle Brawling

- Bare-Knuckle Strike
- Chitin Blade
- Twin Blade Flurry
- Raking Lunge
- Mantis Guard

Twin Blade Flurry resolves its second blade automatically. Mantis Guard applies its AC effect through Foundry.

## Other automated weapons

The module also contains established automation for:

- **Dual Blades** — Demon Mode toggles a real Active Effect, applying `-2 AC`, `+10 ft` walking speed, and the second-blade damage bonus.
- **Longsword** — tracks Spirit and Spirit Level, with hit-confirmed generation/spending and Spirit attack gating.
- **Gunlance** — tracks Shells, Full Burst spending, Reload, and Wyvern's Fire state.
- **Jet Hammer** — tracks Fuel and blocks powered attacks when Fuel is insufficient.
- **Cane Sword / Cane Rifle** — transformation state and activity visibility are synchronized before the picker opens.
- **Harpoon** — tether state plus Reel Target / Reel Self token movement.
- **Teleportation Chakram** — stores a marked token position and can teleport the wielder's active token to it.
- **Gunheels / Pistols** — combo-state attacks and Bullet Climax behavior.
- **Sword & Shield** — equipped AC bonus and Shield Bash activity.

The remaining simpler weapons primarily use native D&D5e activities with their special riders written directly into the activity descriptions.

## Manual / table-positioning mechanics

Not every positional rule is force-automated. This is intentional.

Depending on the weapon, the player or GM may still resolve:

- movement granted by an activity
- pushes and pulls
- movement-distance prerequisites
- cone/radius placement and affected targets
- firing-lane / Overwatch triggers
- some save-based riders
- some grapple, restraint, or control riders
- tactical Advantage conditions

This avoids having the module guess table geometry or make positional decisions for the player.

## Installation

### Manual installation

1. Download the ZIP for the release you want.
2. Extract it as a folder named `tems-weapons` inside Foundry's `Data/modules/` directory.
3. Start or restart Foundry VTT.
4. Enable **Tem's Weapons** for the D&D5e world.
5. Enter the world as a GM so bundled Items can be imported/synchronized.

When updating manually, replace the contents of the existing `Data/modules/tems-weapons/` folder with the new release.

### Manifest URL

The repository's current manifest is available at:

```text
https://raw.githubusercontent.com/Temmie-Boi/Tems-Weapons-Foundry-Module/main/module.json
```

**Important:** the current `1.6.2` `module.json` does not yet define Foundry `manifest` and `download` fields. The URL above points to the manifest file, but automatic install/update through Foundry should not be considered configured until those fields are added in a future release. Use the release ZIP for reliable installation of v1.6.2.

## Updating and duplicate behavior

Bundled Items are keyed by stable identifiers. On startup, the module searches the Tem's Weapons Item hierarchy for existing copies before importing missing Items.

This means updating the module should not normally create a second copy of every bundled weapon. Some versions also migrate specific activities or synchronization behavior on existing world and actor-owned copies where required.

## Version highlights

### v1.6.2

- Fixed Motorbike / Chainsaw / Chaingun mode switching so activity visibility is synchronized **before** the D&D5e activity picker is built.
- Mode changes now present the correct activity set on the first subsequent use.

### v1.6.1

- Added immediate mode-state and prepared-data refreshes after Motorbike / Chainsaw / Chaingun mode changes.

### v1.6.0

- Added Motorbike / Chainsaw / Chaingun.
- Added Argus Class Steamknight.
- Added Paris Class Steamknight.

### v1.5.1

- Corrected Berried Delight's Rapid Draw follow-up so its second attack resolves without consuming/checking for a second Action and rolls its own damage on a confirmed hit.

### v1.5.0

- Added Kanabo / Iron Maiden.
- Added Bouquet of Roses.
- Added Jet-Propelled Skateboard.
- Added Berried Delight.

### v1.4.0

- Added Tire Iron & Tires.
- Added Hatchet.
- Added Sawblade.
- Added Cleaver.
- Added Blast Fists.
- Added Built-In Blades & Bare-Knuckle Brawling.

### v1.3.x

Introduced and stabilized Claire's Might, including Stance, Surges, Ratchet, Phial Cascade, boosted Charge Blade actions, Morph synchronization, automatic follow-up attacks, and Earth-Shattering SAED.

### v1.2.x

Added the mechanic-heavy weapon batch and stabilization work for Teleportation Chakram, Harpoon, Meteor Hammer / Censer, Jet Hammer, Cane Sword / Cane Rifle, Gunheels / Pistols, Longsword, Gunlance, and Dual Blades.

## Development status

`v1.6.2` completes the currently implemented NPC weapon set. Additional player-character weapon systems are still planned for later releases.

## Repository

GitHub repository:

```text
https://github.com/Temmie-Boi/Tems-Weapons-Foundry-Module
```

