/**
 * Tem's Weapons v1.0.0
 * Foundry VTT v14 / D&D5e 5.3.x
 *
 * Weapon identifier:
 *   system.identifier === "charge-blade"
 *
 * State stored on Item flags.world:
 *   chargeBladeMode                 "sword" | "axe"
 *   chargeBladeCharge               0..5
 *   chargeBladePhials               0..5
 *   chargeBladeShieldCharged        boolean
 *   chargeBladeShieldChargedUntil   epoch ms
 *   chargeBladeLastSAEDPhials       0..5
 */

const IDENTIFIER = "charge-blade";
const SCOPE = "world";
const AC_EFFECT_NAME = "Charge Blade — Sword Shield";
const GUARD_EFFECT_NAME = "Charge Blade — Guard Point";

const acSyncLocks = new Set();
const visibilityLocks = new Set();

/**
 * Tracks attacks that began legally, so Foundry can revisit the same
 * activity later in the attack/damage workflow without the activity
 * invalidating itself after its state changes.
 *
 * key = item.uuid + activity.id
 * value = expiry timestamp
 */
const pendingActivities = new Map();

const NAMES = Object.freeze({
  SWORD: "Sword Slash",
  AXE: "Axe Slash",
  ED: "Element Discharge",
  AED: "Amped Element Discharge (AED)",
  SAED: "Super Amped Element Discharge (SAED)",
  MORPH: "Morph",
  LOAD: "Load Phials",
  SHIELD: "Charge Shield",
  GUARD: "Guard Point"
});

const AXE_DAMAGE_ACTIVITIES = new Set([
  NAMES.AXE, NAMES.ED, NAMES.AED, NAMES.SAED
]);

function isChargeBlade(item) {
  return item?.type === "weapon" && item?.system?.identifier === IDENTIFIER;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function getItem(activity) {
  return activity?.item ?? activity?.parent ?? null;
}

function pendingKey(item, activity) {
  return `${item?.uuid ?? item?.id}:${activity?.id ?? activity?._id ?? activity?.name}`;
}

function markPending(item, activity, ms=30000) {
  pendingActivities.set(pendingKey(item, activity), Date.now() + ms);
}

function isPending(item, activity) {
  const key = pendingKey(item, activity);
  const until = pendingActivities.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    pendingActivities.delete(key);
    return false;
  }
  return true;
}

function clearPending(item, activity) {
  pendingActivities.delete(pendingKey(item, activity));
}

function readState(item) {
  const until = Number(item.getFlag(SCOPE, "chargeBladeShieldChargedUntil") ?? 0);
  const rawCharged = Boolean(item.getFlag(SCOPE, "chargeBladeShieldCharged") ?? false);
  const activeCharged = rawCharged && (!until || Date.now() < until);

  return {
    mode: item.getFlag(SCOPE, "chargeBladeMode") ?? "sword",
    charge: clamp(item.getFlag(SCOPE, "chargeBladeCharge") ?? 0, 0, 5),
    phials: clamp(item.getFlag(SCOPE, "chargeBladePhials") ?? 0, 0, 5),
    shieldCharged: activeCharged,
    shieldChargedUntil: until,
    lastSAEDPhials: clamp(item.getFlag(SCOPE, "chargeBladeLastSAEDPhials") ?? 0, 0, 5)
  };
}

async function writeState(item, state, {sync=true}={}) {
  await item.update({
    "flags.world.chargeBladeMode": state.mode,
    "flags.world.chargeBladeCharge": clamp(state.charge, 0, 5),
    "flags.world.chargeBladePhials": clamp(state.phials, 0, 5),
    "flags.world.chargeBladeShieldCharged": Boolean(state.shieldCharged),
    "flags.world.chargeBladeShieldChargedUntil": Number(state.shieldChargedUntil ?? 0),
    "flags.world.chargeBladeLastSAEDPhials": clamp(state.lastSAEDPhials ?? 0, 0, 5)
  });

  if (sync) {
    await syncSwordShieldAC(item);
    await syncActivityVisibility(item);
  }
}

function statusText(state) {
  const mode = state.mode === "axe" ? "Axe" : "Sword";
  const shield = state.shieldCharged ? "Charged" : "Normal";
  return `${mode} Mode | Charge ${state.charge}/5 | Phials ${state.phials}/5 | Shield ${shield}`;
}

function notifyState(item, prefix="") {
  const text = statusText(readState(item));
  ui.notifications.info(prefix ? `${prefix} — ${text}` : text);
}

/* ------------------------------------------------------------------------- */
/* AC                                                                        */
/* ------------------------------------------------------------------------- */

async function removeNamedEffect(actor, name) {
  if (!actor) return;

  const ids = actor.effects
    .filter(e => e.name === name)
    .map(e => e.id)
    .filter(Boolean);

  for (const id of ids) {
    const current = actor.effects.get(id);
    if (!current) continue;

    try {
      await current.delete();
    } catch (err) {
      if (!String(err?.message ?? err).includes("does not exist")) throw err;
    }
  }
}

async function syncSwordShieldAC(item) {
  const actor = item?.actor;
  if (!actor) return;

  const lockKey = item.uuid;
  if (acSyncLocks.has(lockKey)) return;

  acSyncLocks.add(lockKey);
  try {
    const state = readState(item);
    const desiredBonus = state.mode === "sword" ? (state.shieldCharged ? 3 : 2) : 0;
    const existing = actor.effects.filter(e => e.name === AC_EFFECT_NAME);

    if (!desiredBonus) {
      await removeNamedEffect(actor, AC_EFFECT_NAME);
      return;
    }

    if (existing.length === 1) {
      const effect = existing[0];
      const change = effect.changes?.find(c => c.key === "system.attributes.ac.bonus");
      const sourceItemId = effect.getFlag("tems-weapons", "sourceItemId");

      if (String(change?.value) === String(desiredBonus) &&
          (!sourceItemId || sourceItemId === item.id)) {
        return;
      }
    }

    await removeNamedEffect(actor, AC_EFFECT_NAME);

    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: AC_EFFECT_NAME,
      img: item.img,
      origin: item.uuid,
      disabled: false,
      transfer: false,
      duration: {},
      changes: [{
        key: "system.attributes.ac.bonus",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(desiredBonus),
        priority: 20
      }],
      flags: {
        "tems-weapons": {
          sourceItemId: item.id,
          bonus: desiredBonus
        }
      }
    }]);
  } finally {
    acSyncLocks.delete(lockKey);
  }
}

/* ------------------------------------------------------------------------- */
/* NATIVE D&D5E ACTIVITY VISIBILITY                                          */
/* ------------------------------------------------------------------------- */

/**
 * D&D5e 5.2+ uses visibility.level to determine whether an activity is hidden.
 * We use max=-1 for hidden activities, which no normal actor level can satisfy.
 * Visible activities restore min/max to null.
 *
 * This updates the actual activity visibility data, so hidden options disappear
 * from the item Play sheet and the activity-use picker rather than being
 * visually hidden with CSS.
 */
function activityShouldBeVisible(name, state) {
  if (name === NAMES.MORPH) return true;

  if (state.mode === "sword") {
    switch (name) {
      case NAMES.SWORD:
        return true;
      case NAMES.LOAD:
        return state.charge >= 3;
      case NAMES.SHIELD:
        return state.phials >= 1;
      case NAMES.GUARD:
        return true;
      case NAMES.AXE:
      case NAMES.ED:
      case NAMES.AED:
      case NAMES.SAED:
        return false;
      default:
        return true;
    }
  }

  // Axe Mode
  switch (name) {
    case NAMES.AXE:
      return true;
    case NAMES.ED:
    case NAMES.AED:
      return state.phials >= 1;
    case NAMES.SAED:
      return state.phials >= 1 && state.shieldCharged;
    case NAMES.SWORD:
    case NAMES.LOAD:
    case NAMES.SHIELD:
    case NAMES.GUARD:
      return false;
    default:
      return true;
  }
}

async function syncActivityVisibility(item) {
  if (!isChargeBlade(item)) return;

  const lockKey = item.uuid;
  if (visibilityLocks.has(lockKey)) return;

  visibilityLocks.add(lockKey);
  try {
    const state = readState(item);
    const updates = {};

    for (const activity of item.system.activities ?? []) {
      const visible = activityShouldBeVisible(activity.name, state);
      const currentMin = activity.visibility?.level?.min ?? null;
      const currentMax = activity.visibility?.level?.max ?? null;

      const desiredMin = null;
      const desiredMax = visible ? null : -1;

      if (currentMin !== desiredMin) {
        updates[`system.activities.${activity.id}.visibility.level.min`] = desiredMin;
      }
      if (currentMax !== desiredMax) {
        updates[`system.activities.${activity.id}.visibility.level.max`] = desiredMax;
      }
    }

    if (Object.keys(updates).length) {
      await item.update(updates);
    }

    // Ask open sheets to refresh immediately.
    item.sheet?.render?.({force: true});
    item.actor?.sheet?.render?.({force: true});
  } finally {
    visibilityLocks.delete(lockKey);
  }
}

/* ------------------------------------------------------------------------- */
/* SHIELD EXPIRATION                                                         */
/* ------------------------------------------------------------------------- */

async function expireShieldIfNeeded(item) {
  const raw = Boolean(item.getFlag(SCOPE, "chargeBladeShieldCharged") ?? false);
  const until = Number(item.getFlag(SCOPE, "chargeBladeShieldChargedUntil") ?? 0);

  if (raw && until > 0 && Date.now() >= until) {
    const state = readState(item);
    state.shieldCharged = false;
    state.shieldChargedUntil = 0;
    await writeState(item, state);
    ui.notifications.info("Charge Blade shield charge expired.");
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------------- */
/* ATTACK HIT DETECTION                                                      */
/* ------------------------------------------------------------------------- */

function naturalD20(roll) {
  try {
    const die = roll.dice?.find(d => d.faces === 20);
    if (!die) return null;
    const active = die.results?.filter(r => r.active !== false);
    if (!active?.length) return null;
    return Number(active[0].result);
  } catch {
    return null;
  }
}

function targetAC(token) {
  return Number(token?.actor?.system?.attributes?.ac?.value ?? NaN);
}

function attackHitsTarget(roll, token) {
  const nat = naturalD20(roll);
  if (nat === 1) return false;
  if (nat === 20) return true;

  const ac = targetAC(token);
  if (!Number.isFinite(ac)) return false;
  return Number(roll.total) >= ac;
}

/* ------------------------------------------------------------------------- */
/* VALIDATION                                                                */
/* ------------------------------------------------------------------------- */

Hooks.on("dnd5e.preUseActivity", async (activity) => {
  const item = getItem(activity);
  if (!isChargeBlade(item)) return;

  await expireShieldIfNeeded(item);

  /**
   * Foundry may re-enter useActivity while resolving an existing attack card.
   * If this exact action already began legally, let its own workflow finish.
   */
  if (isPending(item, activity)) return;

  const state = readState(item);
  const name = activity.name;

  if (name === NAMES.SWORD && state.mode !== "sword") {
    ui.notifications.warn("Sword Slash requires Sword Mode.");
    return false;
  }

  if (AXE_DAMAGE_ACTIVITIES.has(name) && state.mode !== "axe") {
    ui.notifications.warn(`${name} requires Axe Mode.`);
    return false;
  }

  if ([NAMES.ED, NAMES.AED].includes(name) && state.phials < 1) {
    ui.notifications.warn(`${name} requires at least 1 Phial.`);
    return false;
  }

  if (name === NAMES.SAED) {
    if (!state.shieldCharged) {
      ui.notifications.warn("SAED requires a charged shield.");
      return false;
    }
    if (state.phials < 1) {
      ui.notifications.warn("SAED requires at least 1 Phial.");
      return false;
    }
  }

  if (name === NAMES.LOAD && state.charge < 3) {
    ui.notifications.warn("Load Phials requires at least 3 Charge.");
    return false;
  }

  if (name === NAMES.SHIELD && state.phials < 1) {
    ui.notifications.warn("Charge Shield requires at least 1 loaded Phial.");
    return false;
  }

  // Attack activities are allowed to complete their full workflow.
  if ([NAMES.SWORD, NAMES.AXE, NAMES.ED, NAMES.AED, NAMES.SAED].includes(name)) {
    markPending(item, activity);
  }
});

/* ------------------------------------------------------------------------- */
/* IMMEDIATE NON-ATTACK STATE CHANGES                                        */
/* ------------------------------------------------------------------------- */

Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  const item = getItem(activity);
  if (!isChargeBlade(item)) return;

  await expireShieldIfNeeded(item);

  const state = readState(item);

  switch (activity.name) {
    case NAMES.MORPH:
      state.mode = state.mode === "sword" ? "axe" : "sword";
      await writeState(item, state);
      notifyState(item, `Morphed to ${state.mode === "axe" ? "Axe" : "Sword"} Mode`);
      break;

    case NAMES.LOAD: {
      const gained = state.charge >= 5 ? 5 : 3;
      state.phials = gained;
      state.charge = 0;
      await writeState(item, state);
      notifyState(item, `Loaded ${gained} Phials`);
      break;
    }

    case NAMES.SHIELD: {
      const spent = state.phials;
      state.phials = 0;
      state.shieldCharged = true;
      state.shieldChargedUntil = Date.now() + (spent * 60_000);
      await writeState(item, state);
      notifyState(item, `Shield charged for ${spent} minute${spent === 1 ? "" : "s"}`);
      break;
    }
  }
});

/* ------------------------------------------------------------------------- */
/* CONFIRMED-HIT SWORD CHARGE                                                */
/* ------------------------------------------------------------------------- */

Hooks.on("dnd5e.postRollAttack", async (rolls, data) => {
  const activity = data?.subject;
  const item = getItem(activity);

  if (!isChargeBlade(item)) return;

  // Non-Sword attacks just keep their pending workflow alive until damage.
  if (activity?.name !== NAMES.SWORD) return;

  const state = readState(item);
  if (state.mode !== "sword") return;

  const targets = Array.from(game.user.targets ?? []);
  if (!targets.length) {
    ui.notifications.warn("Sword Slash rolled with no target selected; Charge was not awarded automatically.");
    return;
  }

  const hit = (rolls ?? []).some(roll =>
    targets.some(token => attackHitsTarget(roll, token))
  );

  if (!hit) {
    ui.notifications.info(`Sword Slash missed — ${statusText(state)}`);
    clearPending(item, activity);
    return;
  }

  if (state.charge >= 5) {
    ui.notifications.info(`Sword Slash hit — Charge already full. ${statusText(state)}`);
    clearPending(item, activity);
    return;
  }

  state.charge = clamp(state.charge + 1, 0, 5);
  await writeState(item, state);
  notifyState(item, "Sword Slash hit: +1 Charge");

  // Sword Slash has no state consequence after damage.
  clearPending(item, activity);
});

/* ------------------------------------------------------------------------- */
/* DAMAGE-TIME STATE CONSEQUENCES                                            */
/* ------------------------------------------------------------------------- */

Hooks.on("dnd5e.rollDamage", async (rolls, data) => {
  const activity = data?.subject;
  const item = getItem(activity);
  if (!isChargeBlade(item)) return;

  await expireShieldIfNeeded(item);

  const state = readState(item);
  const actor = item.actor;
  const speaker = ChatMessage.getSpeaker({ actor });
  const name = activity?.name;

  /**
   * Dynamic SAED phial burst.
   *
   * We snapshot the live phial count HERE, immediately before spending it.
   * This avoids returning to Sword Mode before Foundry has completed the
   * attack/damage workflow.
   */
  if (name === NAMES.SAED) {
    const spent = state.phials;

    if (spent > 0) {
      const roll = await new CONFIG.Dice.DamageRoll(
        `${spent}d8`,
        actor?.getRollData?.() ?? {},
        {type: "force"}
      ).evaluate();

      await roll.toMessage({
        speaker,
        flavor: `${item.name} — SAED Phial Burst (${spent} Phial${spent === 1 ? "" : "s"})`
      });
    }

    // Charged shield +1d4 uses the pre-resolution state.
    if (state.shieldCharged) {
      const bonus = await new CONFIG.Dice.DamageRoll(
        "1d4",
        actor?.getRollData?.() ?? {},
        {type: "force"}
      ).evaluate();

      await bonus.toMessage({
        speaker,
        flavor: `${item.name} — Charged Shield Axe Bonus`
      });
    }

    state.lastSAEDPhials = spent;
    state.phials = 0;
    state.mode = "sword";

    await writeState(item, state);
    clearPending(item, activity);
    notifyState(item, `SAED: spent ${spent} Phial${spent === 1 ? "" : "s"}, returned to Sword Mode`);
    return;
  }

  /**
   * Charged shield +1d4 for the other Axe-family damage rolls.
   */
  if (AXE_DAMAGE_ACTIVITIES.has(name) && state.shieldCharged) {
    const bonus = await new CONFIG.Dice.DamageRoll(
      "1d4",
      actor?.getRollData?.() ?? {},
      {type: "force"}
    ).evaluate();

    await bonus.toMessage({
      speaker,
      flavor: `${item.name} — Charged Shield Axe Bonus`
    });
  }

  switch (name) {
    case NAMES.ED:
      state.phials = clamp(state.phials - 1, 0, 5);
      await writeState(item, state);
      clearPending(item, activity);
      notifyState(item, "Element Discharge: -1 Phial");
      break;

    case NAMES.AED:
      state.phials = clamp(state.phials - 1, 0, 5);
      state.mode = "sword";
      await writeState(item, state);
      clearPending(item, activity);
      notifyState(item, "AED: -1 Phial, returned to Sword Mode");
      break;

    case NAMES.AXE:
      clearPending(item, activity);
      break;
  }
});

/* ------------------------------------------------------------------------- */
/* GUARD POINT                                                               */
/* ------------------------------------------------------------------------- */

Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  const item = getItem(activity);
  if (!isChargeBlade(item) || activity?.name !== NAMES.GUARD) return;

  const actor = item.actor;
  if (!actor) return;

  await removeNamedEffect(actor, GUARD_EFFECT_NAME);

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: GUARD_EFFECT_NAME,
    img: item.img,
    origin: item.uuid,
    disabled: false,
    transfer: false,
    duration: {
      seconds: 6,
      rounds: 1
    },
    changes: [{
      key: "system.attributes.ac.bonus",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "2",
      priority: 30
    }]
  }]);

  const state = readState(item);

  if (state.shieldCharged) {
    const roll = await new CONFIG.Dice.DamageRoll(
      "1d6",
      actor.getRollData?.() ?? {},
      {type: "force"}
    ).evaluate();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({actor}),
      flavor: `${item.name} — Charged Guard Point Retaliation`
    });
  }

  ui.notifications.info("Guard Point active: +2 AC for 1 round.");
});

/* ------------------------------------------------------------------------- */
/* ITEM UPDATES                                                              */
/* ------------------------------------------------------------------------- */

Hooks.on("updateItem", async (item, changes) => {
  if (!isChargeBlade(item)) return;

  const flat = foundry.utils.flattenObject(changes ?? {});
  const relevant = Object.keys(flat).some(k =>
    k.startsWith("flags.world.chargeBlade") ||
    k.startsWith("system.equipped")
  );

  if (!relevant) return;

  await expireShieldIfNeeded(item);
  await syncSwordShieldAC(item);
  await syncActivityVisibility(item);
});


/* ------------------------------------------------------------------------- */
/* ITEM USE / ACTIVITY CHOOSER SYNC                                          */
/* ------------------------------------------------------------------------- */

/**
 * D&D5e builds its multi-activity chooser from:
 *
 *   item.system.activities.filter(activity => activity.canUse)
 *
 * The Charge Blade's visibility can occasionally be stale until another item
 * update (such as Morph) forces a prepare/render pass. To guarantee that the
 * chooser always reflects the CURRENT Charge Blade state, wrap Item5e#use and
 * synchronize visibility immediately before D&D5e builds the chooser list.
 *
 * This wrapper only changes behavior for items identified as "charge-blade".
 */
function installChargeBladeItemUseWrapper() {
  const Item5e = CONFIG.Item?.documentClass;
  if (!Item5e?.prototype?.use) {
    console.warn("Tem's Weapons | Could not locate Item5e#use; chooser pre-sync unavailable.");
    return;
  }

  const proto = Item5e.prototype;

  // Avoid wrapping it twice if the module is hot-reloaded during development.
  if (proto._chargeBladeAutomationUseWrapped) return;

  const originalUse = proto.use;

  proto.use = async function(config={}, dialog={}, message={}) {
    if (isChargeBlade(this)) {
      try {
        await expireShieldIfNeeded(this);
        await syncSwordShieldAC(this);
        await syncActivityVisibility(this);

        // Force the system data model to be prepared with the newly-written
        // visibility values before original Item.use reads activity.canUse.
        this.prepareData?.();
      } catch (err) {
        console.error("Tem's Weapons | Pre-use visibility sync failed", err);
      }
    }

    return originalUse.call(this, config, dialog, message);
  };

  Object.defineProperty(proto, "_chargeBladeAutomationUseWrapped", {
    value: true,
    configurable: true
  });

  console.log("Tem's Weapons | Item.use chooser pre-sync installed.");
}

/* ------------------------------------------------------------------------- */
/* BUNDLED WEAPON INSTALLER                                                  */
/* ------------------------------------------------------------------------- */

const TEMS_FOLDER_NAME = "Tem's weapons";
const BUNDLED_CHARGE_BLADE_PATH = "modules/tems-weapons/items/charge-blade.json";

async function installBundledChargeBlade() {
  // World document creation should only be performed by a GM.
  if (!game.user.isGM) return;

  let folder = game.folders.find(f => f.type === "Item" && f.name === TEMS_FOLDER_NAME);
  if (!folder) {
    folder = await Folder.create({
      name: TEMS_FOLDER_NAME,
      type: "Item",
      sorting: "a",
      folder: null
    });
    console.log(`Tem's Weapons | Created Item folder: ${TEMS_FOLDER_NAME}`);
  }

  // Only treat a Charge Blade already inside our folder as the bundled copy.
  // This lets an older/test Charge Blade elsewhere in the world coexist without
  // causing a duplicate inside Tem's weapons every startup.
  const existing = game.items.find(i =>
    i.system?.identifier === IDENTIFIER && i.folder?.id === folder.id
  );
  if (existing) return existing;

  try {
    const response = await fetch(BUNDLED_CHARGE_BLADE_PATH);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    delete data._id;
    data.folder = folder.id;
    data.img = "modules/tems-weapons/assets/charge-blade.png";

    const item = await Item.create(data);
    console.log(`Tem's Weapons | Imported bundled Charge Blade into ${TEMS_FOLDER_NAME}`);
    ui.notifications.info(`Tem's Weapons: Charge Blade added to ${TEMS_FOLDER_NAME}.`);
    return item;
  } catch (err) {
    console.error("Tem's Weapons | Failed to import bundled Charge Blade", err);
    ui.notifications.error("Tem's Weapons could not import the bundled Charge Blade. Check the console.");
  }
}

/* ------------------------------------------------------------------------- */
/* READY / TEST API                                                          */
/* ------------------------------------------------------------------------- */

Hooks.once("ready", async () => {
  installChargeBladeItemUseWrapper();
  await installBundledChargeBlade();

  game.chargeBladeAutomation = {
    getState(item) {
      if (!isChargeBlade(item)) return null;
      return readState(item);
    },

    async set(item, changes={}) {
      if (!isChargeBlade(item)) throw new Error("Item is not a Charge Blade.");

      const state = {...readState(item), ...changes};
      await writeState(item, state);
      notifyState(item, "Charge Blade state updated");
      return readState(item);
    },

    async reset(item) {
      if (!isChargeBlade(item)) throw new Error("Item is not a Charge Blade.");

      const state = {
        mode: "sword",
        charge: 0,
        phials: 0,
        shieldCharged: false,
        shieldChargedUntil: 0,
        lastSAEDPhials: 0
      };

      await writeState(item, state);
      notifyState(item, "Charge Blade reset");
      return state;
    },

    async sync(item) {
      if (!isChargeBlade(item)) throw new Error("Item is not a Charge Blade.");

      await expireShieldIfNeeded(item);
      await syncSwordShieldAC(item);
      await syncActivityVisibility(item);

      return readState(item);
    },

    async showAllActivities(item) {
      if (!isChargeBlade(item)) throw new Error("Item is not a Charge Blade.");

      const updates = {};
      for (const activity of item.system.activities ?? []) {
        updates[`system.activities.${activity.id}.visibility.level.min`] = null;
        updates[`system.activities.${activity.id}.visibility.level.max`] = null;
      }

      await item.update(updates);
      item.sheet?.render?.({force: true});
      item.actor?.sheet?.render?.({force: true});
    }
  };

  for (const actor of game.actors) {
    for (const item of actor.items) {
      if (!isChargeBlade(item)) continue;

      try {
        await expireShieldIfNeeded(item);
        await syncSwordShieldAC(item);
        await syncActivityVisibility(item);
      } catch (err) {
        console.warn("Tem's Weapons | Initial sync failed", item, err);
      }
    }
  }

  console.log("Tem's Weapons | v2.1.1 Ready");
});
