# Tem's Weapons

A custom Foundry VTT module containing unique weapons, weapon mechanics, resource systems, transformations, combat modes, and automation built for the D&D5e system.

## Compatibility

- Foundry VTT: 14.366
- D&D5e system: 5.3.2
- Module version: 1.2.8
- Rules source: 2024

## Included Weapons

### Coral

- Greatsword
- Teleportation Chakram

### Gaunt

- Bombs
- Harpoon
- Meteor Hammer / Censer
- Jet Hammer

### Fault

- Sniper Rifle
- Twin Scimitars
- Cane Sword / Rifle

### Candy

- Electrified Javelin

### Rival

- Gunheels / Pistols

### STARS

- Sword & Shield
- Dual Blades
- Longsword
- Charge Blade
- Gunlance

## Weapon Automation

Tem's Weapons includes custom automation for weapons whose mechanics cannot be represented using the standard D&D5e item system alone.

Current systems include:

- Charge Blade modes, Charge, Phials, charged shield, Guard Points, AED, and SAED
- Dual Blades Demon Mode
- Longsword Spirit Gauge and Spirit Levels
- Gunlance Shelling and Wyvern's Fire
- Jet Hammer Fuel
- Harpoon tethering and reeling
- Cane Sword / Rifle transformation
- Teleportation Chakram deployment and teleportation
- Gunheels / Pistols combo tracking

Some weapon effects that are difficult or undesirable to automate are intentionally handled manually.

## Manual Installation

Download the release ZIP and extract its `tems-weapons` folder into:

```text
%LOCALAPPDATA%\FoundryVTT\Data\modules\
```

The final path must be:

```text
%LOCALAPPDATA%\FoundryVTT\Data\modules\tems-weapons\module.json
```

Restart Foundry and enable **Tem's Weapons** in the world.

The module automatically creates an Item folder named **Tem's weapons** and installs its bundled weapons.

Existing weapons are preserved when possible to prevent duplicate imports.

## Install Using a Manifest URL

Once GitHub release installation is configured, Tem's Weapons can be installed through Foundry's **Install Module** dialog using:

```text
https://github.com/Temmie-Boi/Tems-Weapons-Foundry-Module/releases/latest/download/module.json
```

Paste the URL into the **Manifest URL** field in Foundry's module installer.

## Creating a Release

Development versions are stored using Git tags matching the module version.

For example:

```bash
git add -A
git commit -m "Release v1.2.8"
git tag -a v1.2.8 -m "Tem's Weapons v1.2.8"

git push origin main
git push origin v1.2.8
```

Each version can then be published as a GitHub Release with its corresponding installable ZIP.

Current version history:

- v1.0.0
- v1.0.1
- v1.1.0
- v1.1.1
- v1.2.0
- v1.2.1
- v1.2.2
- v1.2.3
- v1.2.4
- v1.2.5
- v1.2.6
- v1.2.7
- v1.2.8

## Development

The repository's `main` branch contains the latest stable version of Tem's Weapons.

Development follows this general process:

1. Implement or modify weapons.
2. Test the module in Foundry VTT.
3. Confirm weapon automation and resources behave correctly.
4. Update the version in `module.json`.
5. Commit the stable version.
6. Create a matching Git tag.
7. Push the commit and tag to GitHub.
8. Publish the corresponding GitHub Release.

Major weapon batches use minor version increases, while stabilization and bug-fix releases use patch versions.

For example:

```text
v1.2.8  Current stable release
v1.3.0  Next weapon/content batch
v1.3.1  Bug fixes for v1.3.0
```

## Important

Tem's Weapons is a custom module intended for use with Foundry VTT and the D&D5e game system.

Some weapons use custom JavaScript automation tied to D&D5e activities and hooks. Changes to Foundry VTT or the D&D5e system may require updates to the module's automation.

The module is currently developed and tested against:

```text
Foundry VTT 14.366
D&D5e 5.3.2
2024 Rules
```
