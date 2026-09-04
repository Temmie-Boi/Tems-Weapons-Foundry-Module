# Tem's Weapons v1.0.0

For Foundry VTT v14 / D&D5e 5.3.x.

## Install

1. Shut down Foundry.
2. Remove or disable the old `charge-blade-automation` module so both automation modules do not run at once.
3. Extract the `tems-weapons` folder into `Data/modules/`.
4. Start Foundry and enable **Tem's Weapons** in Manage Modules.
5. Enter the world as a GM.

On first load, the module creates an Item folder named **Tem's weapons** and imports the bundled **Charge Blade** into it.

The import is idempotent: if a Charge Blade with identifier `charge-blade` already exists inside that folder, it will not create another one on later starts.

## Included

- Charge Blade Automation v2.1.1 behavior
- Charge Blade v2 weapon data with the short chat description fix
- Custom Charge Blade icon at `modules/tems-weapons/assets/charge-blade.png`
- Automatic world-folder/import setup

## Important

The old `charge-blade-automation` module and this module should not both be enabled. They would both listen to the same D&D5e hooks and could process the Charge Blade twice.


## v1.0.1

Fixed the Charge Blade item sheet opening itself whenever an activity changed weapon state.
The module now refreshes item/actor sheets only when those sheets are already open.
