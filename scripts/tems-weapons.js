/**
 * Tem's Weapons v1.2.1
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
    if (item.sheet?.rendered) item.sheet.render({force: true});
    if (item.actor?.sheet?.rendered) item.actor.sheet.render({force: true});
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
/* STRAIGHTFORWARD WEAPON AUTOMATION                                         */
/* ------------------------------------------------------------------------- */

const TEMS_IDS = Object.freeze({
  SWORD_SHIELD: "tems-stars-sword-shield",
  DUAL_BLADES: "tems-stars-dual-blades"
});

const SNS_AC_EFFECT = "Tem's Weapons — Sword & Shield Guard";
const DEMON_EFFECT = "Tem's Weapons — Demon Mode";

function hasIdentifier(item, identifier) {
  return item?.type === "weapon" && item?.system?.identifier === identifier;
}

async function syncSwordShieldGuard(item) {
  if (!hasIdentifier(item, TEMS_IDS.SWORD_SHIELD) || !item.actor) return;

  const actor = item.actor;
  const equipped = Boolean(item.system.equipped);
  const existing = actor.effects.filter(e =>
    e.name === SNS_AC_EFFECT &&
    e.getFlag("tems-weapons", "sourceItemId") === item.id
  );

  if (!equipped) {
    for (const effect of existing) {
      try { await effect.delete(); } catch {}
    }
    return;
  }

  if (existing.length) return;

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: SNS_AC_EFFECT,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: {},
    changes: [{
      key: "system.attributes.ac.bonus",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "2",
      priority: 20
    }],
    flags: {
      "tems-weapons": {
        sourceItemId: item.id
      }
    }
  }]);
}

async function syncDemonMode(item) {
  if (!hasIdentifier(item, TEMS_IDS.DUAL_BLADES) || !item.actor) return;

  const actor = item.actor;
  const active = Boolean(item.getFlag("world", "temsDualBladesDemonMode"));
  const existing = actor.effects.filter(e =>
    e.name === DEMON_EFFECT &&
    e.getFlag("tems-weapons", "sourceItemId") === item.id
  );

  for (const effect of existing) {
    try { await effect.delete(); } catch {}
  }

  if (!active) return;

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: DEMON_EFFECT,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: {},
    changes: [
      {
        key: "system.attributes.ac.bonus",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "-2",
        priority: 20
      },
      {
        key: "system.attributes.movement.walk",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "10",
        priority: 20
      }
    ],
    flags: {
      "tems-weapons": {
        sourceItemId: item.id
      }
    }
  }]);
}

Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  const item = activity?.item ?? activity?.parent;
  if (!item) return;

  if (hasIdentifier(item, TEMS_IDS.DUAL_BLADES) && activity.name === "Demon Mode") {
    const active = !Boolean(item.getFlag("world", "temsDualBladesDemonMode"));
    await item.setFlag("world", "temsDualBladesDemonMode", active);
    await syncDemonMode(item);
    ui.notifications.info(`Dual Blades: Demon Mode ${active ? "ON" : "OFF"}.`);
  }
});

Hooks.on("dnd5e.rollDamage", async (rolls, data) => {
  const activity = data?.subject;
  const item = activity?.item ?? activity?.parent;
  if (!item || !hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) return;

  if (activity?.name !== "Flurry — Second Blade") return;
  if (!Boolean(item.getFlag("world", "temsDualBladesDemonMode"))) return;

  const actor = item.actor;
  const roll = await new CONFIG.Dice.DamageRoll(
    "1d6",
    actor?.getRollData?.() ?? {},
    {type: "slashing"}
  ).evaluate();

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({actor}),
    flavor: `${item.name} — Demon Mode Flurry Bonus`
  });
});

Hooks.on("updateItem", async (item, changes) => {
  if (hasIdentifier(item, TEMS_IDS.SWORD_SHIELD)) {
    const flat = foundry.utils.flattenObject(changes ?? {});
    if (Object.keys(flat).some(k => k.startsWith("system.equipped"))) {
      await syncSwordShieldGuard(item);
    }
  }
});


/* ------------------------------------------------------------------------- */
/* MECHANIC-HEAVY WEAPONS                                                    */
/* ------------------------------------------------------------------------- */
const HEAVY = {
  METEOR:"tems-gaunt-meteor-hammer", GUNHEELS:"tems-rival-gunheels-pistols",
  LONGSWORD:"tems-stars-longsword", GUNLANCE:"tems-stars-gunlance",
  CANE:"tems-fault-cane-rifle", HARPOON:"tems-gaunt-harpoon",
  CHAKRAM:"tems-coral-teleport-chakram", JETHAMMER:"tems-gaunt-jet-hammer"
};
const ident = i => i?.system?.identifier;
const heavyClamp=(v,a,b)=>Math.max(a,Math.min(b,v));

async function heavyUse(activity) {
  const item=activity?.item ?? activity?.parent; if(!item) return;
  const id=ident(item), n=activity.name, actor=item.actor;

  if(id===HEAVY.CANE && n==="Transform"){
    const m=item.getFlag("world","temsCaneMode")==="rifle"?"sword":"rifle";
    await item.setFlag("world","temsCaneMode",m); ui.notifications.info(`Cane weapon: ${m.toUpperCase()} mode.`);
  }
  if(id===HEAVY.GUNLANCE){
    let sh=Number(item.getFlag("world","temsGunlanceShells")??5);
    if(n==="Reload"){ await item.setFlag("world","temsGunlanceShells",5); ui.notifications.info("Gunlance reloaded: 5 shells."); }
    if(n==="Shelling" && sh>0){ await item.setFlag("world","temsGunlanceShells",sh-1); }
    if(n==="Full Burst" && sh>0){ await item.setFlag("world","temsGunlanceShells",0); }
    if(n==="Wyvern's Fire"){ await item.setFlag("world","temsGunlanceWyvernReady",false); }
  }
  if(id===HEAVY.JETHAMMER){
    let f=Number(item.getFlag("world","temsJetFuel")??3);
    const cost=n==="Maximum Thrust"?2:(["Jet Smash","Jet Launch"].includes(n)?1:0);
    if(cost) await item.setFlag("world","temsJetFuel",heavyClamp(f-cost,0,3));
    if(n==="Vent / Refuel") await item.setFlag("world","temsJetFuel",3);
  }
  if(id===HEAVY.LONGSWORD){
    let sp=Number(item.getFlag("world","temsLongswordSpirit")??0);
    if(n==="Spirit Slash") await item.setFlag("world","temsLongswordSpirit",heavyClamp(sp-20,0,100));
    if(n==="Spirit Roundslash") await item.setFlag("world","temsLongswordSpirit",heavyClamp(sp-30,0,100));
    if(n==="Spirit Helm Breaker"){
      const lv=Number(item.getFlag("world","temsLongswordLevel")??0);
      await item.setFlag("world","temsLongswordLevel",heavyClamp(lv-1,0,3));
    }
  }
  if(id===HEAVY.GUNHEELS && n==="Dodge Offset"){
    ui.notifications.info(`Dodge Offset: Combo ${item.getFlag("world","temsGunheelsCombo")??0} preserved.`);
  }
  if(id===HEAVY.HARPOON){
    if(n==="Set Tether"){
      const t=Array.from(game.user.targets)[0];
      if(t){ await item.setFlag("world","temsHarpoonTethered",true); await item.setFlag("world","temsHarpoonTarget",t.document.uuid); ui.notifications.info(`Harpoon tethered to ${t.name}.`); }
      else ui.notifications.warn("Target a token before setting the tether.");
    }
    if(n==="Release Tether"){ await item.setFlag("world","temsHarpoonTethered",false); await item.setFlag("world","temsHarpoonTarget",""); }
  }
  if(id===HEAVY.CHAKRAM){
    if(n==="Mark Chakram Location"){
      const t=Array.from(game.user.targets)[0];
      if(t){ await item.update({"flags.world.temsChakramDeployed":true,"flags.world.temsChakramX":t.document.x,"flags.world.temsChakramY":t.document.y,"flags.world.temsChakramScene":canvas.scene.id}); ui.notifications.info("Chakram location marked."); }
      else ui.notifications.warn("Target a token at the chakram destination first.");
    }
    if(n==="Recall Chakram") await item.setFlag("world","temsChakramDeployed",false);
    if(n==="Teleport to Chakram"){
      const tok=actor?.getActiveTokens?.()[0];
      if(tok && item.getFlag("world","temsChakramDeployed") && item.getFlag("world","temsChakramScene")===canvas.scene.id){
        await tok.document.update({x:Number(item.getFlag("world","temsChakramX")),y:Number(item.getFlag("world","temsChakramY"))});
        await item.setFlag("world","temsChakramDeployed",false);
      } else ui.notifications.warn("No deployed chakram location is available in this scene.");
    }
  }
}
Hooks.on("dnd5e.postCreateUsageMessage", heavyUse);

Hooks.on("dnd5e.postRollAttack", async (activity, roll) => {
  const item=activity?.item ?? activity?.parent; if(!item || !roll) return;
  const target=Array.from(game.user.targets)[0];
  let hit=true;
  if(target?.actor) hit=roll.total >= (target.actor.system.attributes.ac.value??10);
  if(roll.dice?.[0]?.total===1) hit=false; if(roll.dice?.[0]?.total===20) hit=true;
  if(!hit) return;

  if(ident(item)===HEAVY.LONGSWORD){
    let sp=Number(item.getFlag("world","temsLongswordSpirit")??0);
    if(activity.name==="Overhead Slash") await item.setFlag("world","temsLongswordSpirit",heavyClamp(sp+20,0,100));
    if(activity.name==="Thrust") await item.setFlag("world","temsLongswordSpirit",heavyClamp(sp+15,0,100));
    if(activity.name==="Spirit Roundslash"){
      const lv=Number(item.getFlag("world","temsLongswordLevel")??0);
      await item.setFlag("world","temsLongswordLevel",heavyClamp(lv+1,0,3));
    }
  }
  if(ident(item)===HEAVY.GUNHEELS && ["Pistol Barrage","Heel Shot","Afterburner Kick"].includes(activity.name)){
    const c=Number(item.getFlag("world","temsGunheelsCombo")??0);
    await item.setFlag("world","temsGunheelsCombo",heavyClamp(c+1,0,3));
  }
  if(ident(item)===HEAVY.GUNHEELS && activity.name==="Bullet Climax") await item.setFlag("world","temsGunheelsCombo",0);
});

Hooks.on("dnd5e.rollDamage", async (rolls,data)=>{
  const a=data?.subject, item=a?.item ?? a?.parent; if(!item) return;
  if(ident(item)===HEAVY.GUNLANCE && a.name==="Full Burst"){
    const spent=Number(item.getFlag("world","temsGunlanceLastBurst")??0);
  }
});

/* ------------------------------------------------------------------------- */
/* BUNDLED WEAPON INSTALLER                                                  */
/* ------------------------------------------------------------------------- */

const TEMS_FOLDER_NAME = "Tem's weapons";

const BUNDLED_WEAPONS = [
  { path: "items/charge-blade.json", identifier: "charge-blade", folder: null, icon: "assets/charge-blade.png" },
  { path: "items/coral/greatsword.json", identifier: "tems-coral-greatsword", folder: "Coral" },
  { path: "items/gaunt/bombs.json", identifier: "tems-gaunt-bombs", folder: "Gaunt" },
  { path: "items/fault/sniper-rifle.json", identifier: "tems-fault-sniper-rifle", folder: "Fault" },
  { path: "items/fault/twin-scimitars.json", identifier: "tems-fault-twin-scimitars", folder: "Fault", icon: "assets/twin-scimitars.png" },
  { path: "items/candy/electrified-javelin.json", identifier: "tems-candy-electrified-javelin", folder: "Candy", icon: "assets/electrified-javelin.png" },
  { path: "items/stars/sword-shield.json", identifier: "tems-stars-sword-shield", folder: "STARS", icon: "assets/sword-shield.png" },
  { path: "items/stars/dual-blades.json", identifier: "tems-stars-dual-blades", folder: "STARS" },
  { path: "items/coral/teleportation-chakram.json", identifier: "tems-coral-teleport-chakram", folder: "Coral" },
  { path: "items/gaunt/harpoon.json", identifier: "tems-gaunt-harpoon", folder: "Gaunt" },
  { path: "items/gaunt/meteor-hammer-censer.json", identifier: "tems-gaunt-meteor-hammer", folder: "Gaunt" },
  { path: "items/gaunt/jet-hammer.json", identifier: "tems-gaunt-jet-hammer", folder: "Gaunt" },
  { path: "items/fault/cane-sword-rifle.json", identifier: "tems-fault-cane-rifle", folder: "Fault" },
  { path: "items/rival/gunheels-pistols.json", identifier: "tems-rival-gunheels-pistols", folder: "Rival" },
  { path: "items/stars/longsword.json", identifier: "tems-stars-longsword", folder: "STARS" },
  { path: "items/stars/gunlance.json", identifier: "tems-stars-gunlance", folder: "STARS" }
];

async function ensureItemFolder(name, parent=null) {
  const parentId = parent?.id ?? null;
  let folder = game.folders.find(f =>
    f.type === "Item" &&
    f.name === name &&
    (f.folder?.id ?? null) === parentId
  );

  if (!folder) {
    folder = await Folder.create({
      name,
      type: "Item",
      sorting: "a",
      folder: parentId
    });
    console.log(`Tem's Weapons | Created Item folder: ${name}`);
  }

  return folder;
}

async function installBundledWeapons() {
  if (!game.user.isGM) return;

  const root = await ensureItemFolder(TEMS_FOLDER_NAME);
  const subfolders = new Map();

  for (const entry of BUNDLED_WEAPONS) {
    let targetFolder = root;

    if (entry.folder) {
      if (!subfolders.has(entry.folder)) {
        subfolders.set(entry.folder, await ensureItemFolder(entry.folder, root));
      }
      targetFolder = subfolders.get(entry.folder);
    }

    // Search the entire Tem's Weapons hierarchy by stable identifier.
    const existing = game.items.find(i => {
      if (i.system?.identifier !== entry.identifier) return false;
      let f = i.folder;
      while (f) {
        if (f.id === root.id) return true;
        f = f.folder;
      }
      return false;
    });

    if (existing) continue;

    try {
      const response = await fetch(`modules/tems-weapons/${entry.path}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      delete data._id;
      data.folder = targetFolder.id;

      if (entry.icon) data.img = `modules/tems-weapons/${entry.icon}`;

      await Item.create(data);
      console.log(`Tem's Weapons | Imported ${data.name} into ${targetFolder.name}`);
    } catch (err) {
      console.error(`Tem's Weapons | Failed to import ${entry.identifier}`, err);
      ui.notifications.error(`Tem's Weapons could not import ${entry.identifier}. Check the console.`);
    }
  }
}

/* ------------------------------------------------------------------------- */
/* READY / TEST API                                                          */
/* ------------------------------------------------------------------------- */

Hooks.once("ready", async () => {
  installChargeBladeItemUseWrapper();
  await installBundledWeapons();

  // Sync straightforward weapon effects already embedded on actors.
  for (const actor of game.actors) {
    for (const item of actor.items) {
      try {
        if (hasIdentifier(item, TEMS_IDS.SWORD_SHIELD)) await syncSwordShieldGuard(item);
        if (hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) await syncDemonMode(item);
      } catch (err) {
        console.warn("Tem's Weapons | Straightforward weapon initial sync failed", item, err);
      }
    }
  }

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
      if (item.sheet?.rendered) item.sheet.render({force: true});
      if (item.actor?.sheet?.rendered) item.actor.sheet.render({force: true});
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
