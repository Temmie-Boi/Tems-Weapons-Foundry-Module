/**
 * Tem's Weapons v1.3.5
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

async function writeState(item, state, {sync=true, renderActor=true}={}) {
  const updateOptions = {temsWeaponsSuppressActorRender: !renderActor};
  // Foundry's own embedded-document update can rerender the actor sheet even
  // when our module does not explicitly call sheet.render(). During a sheet
  // activity click that synchronous rerender can replace the clicked DOM node
  // before D&D5e finishes handling the click, producing a click-through into
  // another item. Claire's Might state changes deliberately use renderActor=false,
  // so suppress the core document render for those updates as well.
  if (!renderActor) updateOptions.render = false;

  await item.update({
    "flags.world.chargeBladeMode": state.mode,
    "flags.world.chargeBladeCharge": clamp(state.charge, 0, 5),
    "flags.world.chargeBladePhials": clamp(state.phials, 0, 5),
    "flags.world.chargeBladeShieldCharged": Boolean(state.shieldCharged),
    "flags.world.chargeBladeShieldChargedUntil": Number(state.shieldChargedUntil ?? 0),
    "flags.world.chargeBladeLastSAEDPhials": clamp(state.lastSAEDPhials ?? 0, 0, 5)
  }, updateOptions);

  if (sync) {
    await syncSwordShieldAC(item);
    await syncActivityVisibility(item, {renderActor});
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

async function syncActivityVisibility(item, {renderActor=true}={}) {
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
    if (renderActor && item.actor?.sheet?.rendered) item.actor.sheet.render({force: true});
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

Hooks.on("updateItem", async (item, changes, options={}) => {
  if (!isChargeBlade(item)) return;

  const flat = foundry.utils.flattenObject(changes ?? {});
  const relevant = Object.keys(flat).some(k =>
    k.startsWith("flags.world.chargeBlade") ||
    k.startsWith("system.equipped")
  );

  if (!relevant) return;

  await expireShieldIfNeeded(item);
  await syncSwordShieldAC(item);
  await syncActivityVisibility(item, {renderActor: !options.temsWeaponsSuppressActorRender});
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
    // Claire's Might activities can cause the D&D5e actor sheet to issue a
    // second, unintended Item.use() for the owned Charge Blade during the same
    // click.  Suppress only that immediate stray call; ordinary Charge Blade
    // uses remain unchanged.
    if (isChargeBlade(this) && cmShouldSuppressChargeBladeUse(this)) {
      console.debug("Tem's Weapons | Suppressed stray Charge Blade chooser after Claire's Might activity.");
      return null;
    }

    if (isChargeBlade(this)) {
      try {
        await expireShieldIfNeeded(this);
        await syncSwordShieldAC(this);
        await syncActivityVisibility(this);
        this.prepareData?.();
      } catch (err) {
        console.error("Tem's Weapons | Charge Blade pre-use visibility sync failed", err);
      }
    }


    if (this?.system?.identifier === "tems-fault-cane-rifle") {
      try {
        await syncCaneVisibility(this);
        this.prepareData?.();
      } catch (err) {
        console.error("Tem's Weapons | Cane pre-use visibility sync failed", err);
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

const DUAL_TOGGLE_GUARD = new Map();

function dualToggleGuarded(item) {
  const now = Date.now();
  const last = Number(DUAL_TOGGLE_GUARD.get(item.uuid) ?? 0);
  if (now - last < 750) return true;
  DUAL_TOGGLE_GUARD.set(item.uuid, now);
  setTimeout(() => {
    if (DUAL_TOGGLE_GUARD.get(item.uuid) === now) DUAL_TOGGLE_GUARD.delete(item.uuid);
  }, 1000);
  return false;
}


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

async function applyDualBladeMode(item, active) {
  if (!hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) return;
  const actor = item.actor;
  if (!actor) return;

  // Purge every Demon Mode effect from this weapon before applying requested state.
  const ids = actor.effects
    .filter(e =>
      e.name === DEMON_EFFECT &&
      (
        e.getFlag("tems-weapons", "sourceItemId") === item.id ||
        e.origin === item.uuid
      )
    )
    .map(e => e.id)
    .filter(Boolean);

  if (ids.length) {
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    } catch (err) {
      console.warn("Tem's Weapons | Dual Blades effect cleanup race", err);
    }
  }

  if (active) {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: DEMON_EFFECT,
      img: item.img,
      origin: item.uuid,
      disabled: false,
      transfer: false,
      flags: {
        "tems-weapons": {sourceItemId: item.id}
      },
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
      ]
    }]);
  }

  // Set the logical state only after the actor effect operation succeeds.
  await item.setFlag("world", "temsDualBladesDemonMode", Boolean(active));
  await syncDualBladeDamage(item);

  if (actor.sheet?.rendered) actor.sheet.render({force:true});
}

async function cleanAllDualBladeEffects(item) {
  if (!hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) return;
  const actor = item.actor;
  if (!actor) return;

  const ids = actor.effects
    .filter(e =>
      e.name === DEMON_EFFECT &&
      (
        e.getFlag("tems-weapons", "sourceItemId") === item.id ||
        e.origin === item.uuid
      )
    )
    .map(e => e.id)
    .filter(Boolean);

  if (!ids.length) return;

  try {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  } catch (err) {
    console.warn("Tem's Weapons | Startup Demon Mode cleanup had a deletion race", err);
  }
}

async function syncDualBladeDamage(item) {
  if (!hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) return;

  const active = Boolean(item.getFlag("world", "temsDualBladesDemonMode"));
  const activity = Array.from(item.system.activities ?? [])
    .find(a => a.name === "Flurry — Second Blade");
  if (!activity) return;

  const desired = active ? [{
    custom: {enabled: false, formula: ""},
    number: 1,
    denomination: 6,
    bonus: "",
    types: ["slashing"],
    scaling: {number: 1}
  }] : [];

  const current = activity.damage?.parts ?? [];
  const alreadyCorrect =
    (!active && current.length === 0) ||
    (active && current.length === 1 &&
      Number(current[0]?.number) === 1 &&
      Number(current[0]?.denomination) === 6 &&
      current[0]?.types?.includes?.("slashing"));

  if (alreadyCorrect) return;

  await item.update({
    [`system.activities.${activity.id}.damage.parts`]: desired
  });

  if (item.sheet?.rendered) item.sheet.render({force: true});
  if (item.actor?.sheet?.rendered) item.actor.sheet.render({force: true});
}

Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  const item = activity?.item ?? activity?.parent;
  if (!item) return;

  if (hasIdentifier(item, TEMS_IDS.DUAL_BLADES) && activity.name === "Demon Mode") {
    if (dualToggleGuarded(item)) return;

    const current = Boolean(item.getFlag("world", "temsDualBladesDemonMode"));
    const next = !current;

    await applyDualBladeMode(item, next);

    ui.notifications.info(
      `Dual Blades: Demon Mode ${next ? "ON" : "OFF"} — ` +
      `${next ? "+10 ft movement, -2 AC, Second Blade +1d6" : "normal movement/AC/damage"}.`
    );
  }
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


const HEAVY_VISIBILITY_LOCKS = new Set();

function heavyActivity(item, name) {
  return Array.from(item?.system?.activities ?? []).find(a => a.name === name);
}

function remainingUses(item) {
  const max = Number(item?.system?.uses?.max || 0);
  const spent = Number(item?.system?.uses?.spent || 0);
  return Math.max(0, max - spent);
}

async function setVisibleActivity(activity, visible, updates) {
  if (!activity) return;
  const curMin = activity.visibility?.level?.min ?? null;
  const curMax = activity.visibility?.level?.max ?? null;
  const desiredMin = null;
  const desiredMax = visible ? null : -1;
  if (curMin !== desiredMin) updates[`system.activities.${activity.id}.visibility.level.min`] = desiredMin;
  if (curMax !== desiredMax) updates[`system.activities.${activity.id}.visibility.level.max`] = desiredMax;
}

async function syncCaneVisibility(item) {
  if (ident(item) !== HEAVY.CANE) return;
  if (HEAVY_VISIBILITY_LOCKS.has(item.uuid)) return;
  HEAVY_VISIBILITY_LOCKS.add(item.uuid);
  try {
    const mode = item.getFlag("world", "temsCaneMode") === "rifle" ? "rifle" : "sword";
    const updates = {};
    await setVisibleActivity(heavyActivity(item, "Cane Sword Slash"), mode === "sword", updates);
    await setVisibleActivity(heavyActivity(item, "Cane Rifle Shot"), mode === "rifle", updates);
    await setVisibleActivity(heavyActivity(item, "Transform"), true, updates);
    if (Object.keys(updates).length) await item.update(updates);
    item.prepareData?.();
    if (item.sheet?.rendered) item.sheet.render({force:true});
    if (item.actor?.sheet?.rendered) item.actor.sheet.render({force:true});
  } finally {
    HEAVY_VISIBILITY_LOCKS.delete(item.uuid);
  }
}

async function syncHeavyResource(item) {
  const id = ident(item);

  if (id === HEAVY.JETHAMMER) {
    const fuel = heavyClamp(Number(item.getFlag("world","temsJetFuel") ?? 3), 0, 3);
    const spent = 3 - fuel;
    if (String(item.system.uses?.max ?? "") !== "3" || Number(item.system.uses?.spent ?? -1) !== spent) {
      await item.update({"system.uses.max":"3", "system.uses.spent":spent});
    }
  }

  if (id === HEAVY.GUNLANCE) {
    const shells = heavyClamp(Number(item.getFlag("world","temsGunlanceShells") ?? 5), 0, 5);
    const spent = 5 - shells;
    if (String(item.system.uses?.max ?? "") !== "5" || Number(item.system.uses?.spent ?? -1) !== spent) {
      await item.update({"system.uses.max":"5", "system.uses.spent":spent});
    }
  }

  if (id === HEAVY.LONGSWORD) {
    const spirit = heavyClamp(Number(item.getFlag("world","temsLongswordSpirit") ?? 0), 0, 100);
    const spent = 100 - spirit;
    if (String(item.system.uses?.max ?? "") !== "100" || Number(item.system.uses?.spent ?? -1) !== spent) {
      await item.update({"system.uses.max":"100", "system.uses.spent":spent});
    }
  }
}


async function setJetFuel(item, value, {notify=true}={}) {
  const fuel = heavyClamp(Number(value) || 0, 0, 3);
  await item.update({
    "flags.world.temsJetFuel": fuel,
    "system.uses.max": "3",
    "system.uses.spent": 3 - fuel
  });
  if (notify) ui.notifications.info(`Jet Hammer — Fuel ${fuel}/3`);
  return fuel;
}

async function setLongswordState(item, {spirit=null, level=null, notify=true}={}) {
  const updates = {};
  let nextSpirit = spirit === null
    ? heavyClamp(Number(item.getFlag("world","temsLongswordSpirit") ?? 0), 0, 100)
    : heavyClamp(Number(spirit), 0, 100);
  let nextLevel = level === null
    ? heavyClamp(Number(item.getFlag("world","temsLongswordLevel") ?? 0), 0, 3)
    : heavyClamp(Number(level), 0, 3);

  updates["flags.world.temsLongswordSpirit"] = nextSpirit;
  updates["flags.world.temsLongswordLevel"] = nextLevel;
  updates["system.uses.max"] = "100";
  updates["system.uses.spent"] = 100 - nextSpirit;

  await item.update(updates);
  if (notify) {
    ui.notifications.info(
      `Longsword — Spirit ${nextSpirit}/100 | Level ${spiritLevelName(nextLevel)}`
    );
  }
  return {spirit:nextSpirit, level:nextLevel};
}

function spiritLevelName(level) {
  return ["None", "White", "Yellow", "Red"][heavyClamp(Number(level)||0,0,3)];
}

function notifyHeavyResource(item) {
  const id = ident(item);
  if (id === HEAVY.JETHAMMER) {
    ui.notifications.info(`Jet Hammer — Fuel ${item.getFlag("world","temsJetFuel") ?? 3}/3`);
  } else if (id === HEAVY.GUNLANCE) {
    const ready = Boolean(item.getFlag("world","temsGunlanceWyvernReady") ?? true);
    ui.notifications.info(`Gunlance — Shells ${item.getFlag("world","temsGunlanceShells") ?? 5}/5 | Wyvern's Fire ${ready ? "READY" : "COOLDOWN"}`);
  } else if (id === HEAVY.LONGSWORD) {
    const spirit = item.getFlag("world","temsLongswordSpirit") ?? 0;
    const level = item.getFlag("world","temsLongswordLevel") ?? 0;
    ui.notifications.info(`Longsword — Spirit ${spirit}/100 | Level ${spiritLevelName(level)}`);
  }
}

function tokenCenter(doc) {
  const size = canvas.grid.size;
  const w = (doc.width ?? 1) * size;
  const h = (doc.height ?? 1) * size;
  return {x: doc.x + w/2, y: doc.y + h/2};
}

async function moveTokenToward(mover, destination, feet) {
  if (!mover || !destination || !canvas?.scene) return false;
  const a = tokenCenter(mover);
  const b = tokenCenter(destination);
  const dx = b.x-a.x, dy=b.y-a.y;
  const pxDist = Math.hypot(dx,dy);
  if (!pxDist) return true;

  const gridDistance = Number(canvas.scene.grid.distance || 5);
  const pixelsPerGrid = Number(canvas.grid.size || 100);
  const requestedPx = (Number(feet) / gridDistance) * pixelsPerGrid;
  const movePx = Math.min(requestedPx, pxDist);
  const ratio = movePx / pxDist;

  await mover.update({
    x: Math.round(mover.x + dx*ratio),
    y: Math.round(mover.y + dy*ratio)
  }, {animate:true});
  return true;
}

async function resolveHarpoonTarget(item) {
  const uuid = item.getFlag("world","temsHarpoonTarget");
  if (!uuid) return null;
  try {
    const doc = await fromUuid(uuid);
    return doc?.documentName === "Token" ? doc : (doc?.document ?? null);
  } catch {
    return null;
  }
}

function weaponSaveDC(item) {
  const actor = item?.actor;
  if (!actor) return 10;
  const prof = Number(actor.system?.attributes?.prof ?? actor.system?.attributes?.proficiency ?? 2);
  const str = Number(actor.system?.abilities?.str?.mod ?? 0);
  return 8 + prof + str;
}

async function rollConSaveAndDaze(item, targetToken) {
  const actor = targetToken?.actor;
  if (!actor) return;

  const dc = weaponSaveDC(item);
  const con = actor.system?.abilities?.con ?? {};
  const saveBonus = Number(con.save ?? con.mod ?? 0);

  const roll = await new Roll("1d20 + @bonus", {bonus: saveBonus}).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({actor}),
    flavor: `${item.name} — CON Save vs Daze (DC ${dc})`
  });

  if (roll.total >= dc) {
    ui.notifications.info(`${targetToken.name} resisted Dazed (${roll.total} vs DC ${dc}).`);
    return;
  }

  const dazedStatus = (CONFIG.statusEffects ?? []).find(s =>
    String(s.id ?? "").toLowerCase() === "dazed" ||
    String(s.name ?? "").toLowerCase() === "dazed"
  );

  const effectData = {
    name: "Dazed",
    img: dazedStatus?.img ?? "icons/svg/daze.svg",
    origin: item.uuid,
    disabled: false,
    transfer: false,
    duration: {rounds: 1, seconds: 6},
    changes: []
  };
  if (dazedStatus?.id) effectData.statuses = [dazedStatus.id];

  await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  ui.notifications.warn(`${targetToken.name} failed the CON save and is Dazed.`);
}


Hooks.on("dnd5e.preUseActivity", async (activity) => {
  const item = activity?.item ?? activity?.parent;
  if (!item) return true;

  const id = ident(item);
  const name = activity.name;

  // Jet Hammer: validate and spend Fuel atomically BEFORE Foundry starts the activity.
  if (id === HEAVY.JETHAMMER) {
    const fuel = heavyClamp(Number(item.getFlag("world", "temsJetFuel") ?? 3), 0, 3);

    if (name === "Vent / Refuel") {
      await setJetFuel(item, 3);
      return true;
    }

    const cost =
      name === "Maximum Thrust" ? 2 :
      ["Jet Smash", "Jet Launch"].includes(name) ? 1 : 0;

    if (cost > 0) {
      if (fuel < cost) {
        ui.notifications.warn(`Jet Hammer — not enough Fuel (${fuel}/${cost} required).`);
        return false;
      }

      await setJetFuel(item, fuel - cost);
    }
  }

  // Longsword: hard-gate Spirit spending before the activity begins.
  if (id === HEAVY.LONGSWORD) {
    const spirit = Number(item.getFlag("world", "temsLongswordSpirit") ?? 0);
    const level = Number(item.getFlag("world", "temsLongswordLevel") ?? 0);

    if (name === "Spirit Slash" && spirit < 20) {
      ui.notifications.warn(`Longsword — not enough Spirit (${spirit}/20 required).`);
      return false;
    }

    if (name === "Spirit Roundslash" && spirit < 30) {
      ui.notifications.warn(`Longsword — not enough Spirit (${spirit}/30 required).`);
      return false;
    }

    if (name === "Spirit Helm Breaker" && level < 1) {
      ui.notifications.warn("Longsword — Spirit Helm Breaker requires at least White Spirit Level.");
      return false;
    }
  }

  return true;
});

async function heavyUse(activity) {
  const item=activity?.item ?? activity?.parent; if(!item) return;
  const id=ident(item), n=activity.name, actor=item.actor;

  if(id===HEAVY.CANE && n==="Transform"){
    const m=item.getFlag("world","temsCaneMode")==="rifle"?"sword":"rifle";
    await item.setFlag("world","temsCaneMode",m);
    await syncCaneVisibility(item);
    ui.notifications.info(`Cane weapon: ${m.toUpperCase()} mode.`);
  }

  if(id===HEAVY.GUNLANCE){
    let sh=Number(item.getFlag("world","temsGunlanceShells")??5);
    if(n==="Reload"){
      await item.setFlag("world","temsGunlanceShells",5);
    }
    if(n==="Shelling"){
      if(sh <= 0) ui.notifications.warn("Gunlance — no shells loaded.");
      else await item.setFlag("world","temsGunlanceShells",sh-1);
    }
    if(n==="Full Burst"){
      if(sh <= 0) ui.notifications.warn("Gunlance — no shells loaded.");
      else {
        await item.setFlag("world","temsGunlanceLastBurst",sh);
        await item.setFlag("world","temsGunlanceShells",0);
      }
    }
    if(n==="Wyvern's Fire"){
      await item.setFlag("world","temsGunlanceWyvernReady",false);
    }
    await syncHeavyResource(item);
    notifyHeavyResource(item);
  }



  if(id===HEAVY.GUNHEELS && n==="Dodge Offset"){
    ui.notifications.info(`Dodge Offset: Combo ${item.getFlag("world","temsGunheelsCombo")??0} preserved.`);
  }

  if(id===HEAVY.HARPOON){
    if(n==="Set Tether"){
      const t=Array.from(game.user.targets)[0];
      if(t){
        await item.setFlag("world","temsHarpoonTethered",true);
        await item.setFlag("world","temsHarpoonTarget",t.document.uuid);
        ui.notifications.info(`Harpoon tethered to ${t.name}.`);
      } else ui.notifications.warn("Target a token before setting the tether.");
    }

    if(n==="Reel Target"){
      if(!item.getFlag("world","temsHarpoonTethered")) {
        ui.notifications.warn("Harpoon — nothing is tethered.");
      } else {
        const targetDoc=await resolveHarpoonTarget(item);
        const selfDoc=actor?.getActiveTokens?.()[0]?.document;
        if(targetDoc && selfDoc){
          try {
            await moveTokenToward(targetDoc,selfDoc,10);
            ui.notifications.info(`Harpoon — reeled ${targetDoc.name} 10 ft toward you.`);
          } catch(err) {
            console.error("Tem's Weapons | Reel Target failed",err);
            ui.notifications.error("Harpoon could not move the tethered token. Check token permissions/console.");
          }
        } else ui.notifications.warn("Harpoon — tethered token could not be found in this scene.");
      }
    }

    if(n==="Reel Self"){
      if(!item.getFlag("world","temsHarpoonTethered")) {
        ui.notifications.warn("Harpoon — nothing is tethered.");
      } else {
        const targetDoc=await resolveHarpoonTarget(item);
        const selfDoc=actor?.getActiveTokens?.()[0]?.document;
        if(targetDoc && selfDoc){
          try {
            await moveTokenToward(selfDoc,targetDoc,10);
            ui.notifications.info("Harpoon — reeled yourself 10 ft toward the tether.");
          } catch(err) {
            console.error("Tem's Weapons | Reel Self failed",err);
            ui.notifications.error("Harpoon could not move your token. Check the console.");
          }
        } else ui.notifications.warn("Harpoon — tethered token or your active token could not be found.");
      }
    }

    if(n==="Release Tether"){
      await item.setFlag("world","temsHarpoonTethered",false);
      await item.setFlag("world","temsHarpoonTarget","");
      ui.notifications.info("Harpoon tether released.");
    }
  }

  if(id===HEAVY.CHAKRAM){
    if(n==="Mark Chakram Location"){
      const t=Array.from(game.user.targets)[0];
      if(t){
        await item.update({
          "flags.world.temsChakramDeployed":true,
          "flags.world.temsChakramX":t.document.x,
          "flags.world.temsChakramY":t.document.y,
          "flags.world.temsChakramScene":canvas.scene.id
        });
        ui.notifications.info("Chakram location marked.");
      }
      else ui.notifications.warn("Target a token at the chakram destination first.");
    }
    if(n==="Recall Chakram") await item.setFlag("world","temsChakramDeployed",false);
    if(n==="Teleport to Chakram"){
      const tok=actor?.getActiveTokens?.()[0];
      if(tok && item.getFlag("world","temsChakramDeployed") && item.getFlag("world","temsChakramScene")===canvas.scene.id){
        await tok.document.update({
          x:Number(item.getFlag("world","temsChakramX")),
          y:Number(item.getFlag("world","temsChakramY"))
        });
        await item.setFlag("world","temsChakramDeployed",false);
      } else ui.notifications.warn("No deployed chakram location is available in this scene.");
    }
  }
}
Hooks.on("dnd5e.postCreateUsageMessage", heavyUse);

Hooks.on("dnd5e.postRollAttack", async (rolls, data) => {
  const activity = data?.subject;
  const item = activity?.item ?? activity?.parent;
  if (!item) return;

  const targets = Array.from(game.user.targets ?? []);
  if (!targets.length) return;

  // Use the same confirmed-hit logic that the working Charge Blade uses.
  const hit = (rolls ?? []).some(roll =>
    targets.some(token => attackHitsTarget(roll, token))
  );
  if (!hit) return;

  if (ident(item) === HEAVY.LONGSWORD) {
    let spirit = heavyClamp(Number(item.getFlag("world","temsLongswordSpirit") ?? 0), 0, 100);
    let level = heavyClamp(Number(item.getFlag("world","temsLongswordLevel") ?? 0), 0, 3);

    switch (activity.name) {
      case "Overhead Slash":
        spirit = heavyClamp(spirit + 20, 0, 100);
        break;

      case "Thrust":
        spirit = heavyClamp(spirit + 15, 0, 100);
        break;

      case "Spirit Slash":
        spirit = heavyClamp(spirit - 20, 0, 100);
        break;

      case "Spirit Roundslash":
        spirit = heavyClamp(spirit - 30, 0, 100);
        level = heavyClamp(level + 1, 0, 3);
        break;

      case "Spirit Helm Breaker":
        level = heavyClamp(level - 1, 0, 3);
        break;

      default:
        return;
    }

    await setLongswordState(item, {spirit, level});
  }

  if (ident(item) === HEAVY.GUNHEELS &&
      ["Pistol Barrage","Heel Shot","Afterburner Kick"].includes(activity.name)) {
    const c = Number(item.getFlag("world","temsGunheelsCombo") ?? 0);
    const next = heavyClamp(c + 1, 0, 3);
    await item.setFlag("world","temsGunheelsCombo",next);
    ui.notifications.info(`Gunheels / Pistols — Combo ${next}/3`);
  }

  if (ident(item) === HEAVY.GUNHEELS && activity.name === "Bullet Climax") {
    await item.setFlag("world","temsGunheelsCombo",0);
    ui.notifications.info("Gunheels / Pistols — Combo consumed.");
  }
});

Hooks.on("dnd5e.rollDamage", async (rolls,data)=>{
  const a=data?.subject, item=a?.item ?? a?.parent; if(!item) return;
  if(ident(item)===HEAVY.GUNLANCE && a.name==="Full Burst"){
    const spent=Number(item.getFlag("world","temsGunlanceLastBurst")??0);
    // The activity already contributes 1d8, so add the remaining shell dice.
    if(spent>1){
      const actor=item.actor;
      const roll=await new CONFIG.Dice.DamageRoll(
        `${spent-1}d8`,
        actor?.getRollData?.() ?? {},
        {type:"fire"}
      ).evaluate();
      await roll.toMessage({
        speaker:ChatMessage.getSpeaker({actor}),
        flavor:`${item.name} — Full Burst (${spent} shells total)`
      });
    }
    await item.setFlag("world","temsGunlanceLastBurst",0);
  }
});


/* ------------------------------------------------------------------------- */
/* CLAIRE'S MIGHT                                                            */
/* ------------------------------------------------------------------------- */

const CM_IDENTIFIER = "tems-claires-might";
const CM_STANCE_EFFECT = "Claire's Stance";
const CM_RATCHET_EFFECT = "Claire's Might — Ratchet";
const CM_GUARD_EFFECT = "Claire's Might — Axe Guard Point";
const CM_MAX_SURGES = 3;
const cmVisibilityLocks = new Set();
const cmCombatTurnCache = new Map();
const cmChargeBladeUseSuppressUntil = new Map();
const cmDeferredRenderTimers = new Map();

/**
 * Claire's Might changes several owned documents in response to one activity.
 * Synchronous actor-sheet rerenders during that click are unsafe: D&D5e can
 * continue processing against a freshly-replaced DOM tree and open the item
 * underneath the original pointer. Keep the document updates render-silent,
 * then refresh the actor sheet after the click stack has fully completed.
 */
function cmScheduleActorRender(actor, delay=200) {
  if (!actor?.id || !actor.sheet?.rendered) return;
  const old = cmDeferredRenderTimers.get(actor.id);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    cmDeferredRenderTimers.delete(actor.id);
    try {
      if (actor.sheet?.rendered) actor.sheet.render({force:true});
    } catch (err) {
      console.warn("Tem's Weapons | Deferred Claire actor-sheet render failed", err);
    }
  }, delay);
  cmDeferredRenderTimers.set(actor.id, timer);
}

function cmArmChargeBladeUseSuppression(actor, ms=1500) {
  if (!actor?.id) return;
  cmChargeBladeUseSuppressUntil.set(actor.id, Date.now() + ms);
}

function cmShouldSuppressChargeBladeUse(blade) {
  const actorId = blade?.actor?.id;
  if (!actorId) return false;
  const until = Number(cmChargeBladeUseSuppressUntil.get(actorId) ?? 0);
  if (!until) return false;
  if (Date.now() > until) {
    cmChargeBladeUseSuppressUntil.delete(actorId);
    return false;
  }
  // One-shot suppression: consume the guard as soon as the stray call arrives.
  cmChargeBladeUseSuppressUntil.delete(actorId);
  return true;
}

const CM_NAMES = Object.freeze({
  STANCE: "Claire's Stance",
  RATCHET_1: "Ratchet",
  RATCHET_2: "Ratchet — Second Strike",
  CASCADE_1: "Phial Cascade",
  CASCADE_2: "Phial Cascade — Second Strike",
  PUMP: "Axe Pump Load",
  GUARD: "Axe Guard Point",
  COUNTER: "Axe Counter",
  SWORD_1: "Boosted Sword Combo",
  SWORD_2: "Boosted Sword Combo — Second Slash",
  AXE_1: "Boosted Axe Combo",
  AXE_2: "Boosted Axe Combo — Discharge",
  EARTH: "Earth-Shattering SAED"
});

function isClairesMight(item) {
  return item?.type === "feat" && item?.system?.identifier === CM_IDENTIFIER;
}

function getClaireFeat(actor) {
  return actor?.items?.find?.(isClairesMight) ?? null;
}

function getClaireChargeBlade(actor) {
  return actor?.items?.find?.(isChargeBlade) ?? null;
}

function getActiveCombatForActor(actor) {
  if (!actor) return null;
  return game.combats?.find?.(c => c.started && c.combatants?.some?.(cb => cb.actor?.id === actor.id)) ?? null;
}

function cmTurnKey(actor) {
  const combat = getActiveCombatForActor(actor);
  if (!combat) return "no-combat";
  return `${combat.id}:${combat.round ?? 0}:${combat.turn ?? -1}`;
}

function cmRead(feat) {
  return {
    surges: clamp(feat?.getFlag(SCOPE, "temsClaireSurges") ?? CM_MAX_SURGES, 0, CM_MAX_SURGES),
    stanceActive: Boolean(feat?.getFlag(SCOPE, "temsClaireStanceActive") ?? false),
    stanceTurn: clamp(feat?.getFlag(SCOPE, "temsClaireStanceTurn") ?? 0, 0, 3),
    ratchetActive: Boolean(feat?.getFlag(SCOPE, "temsClaireRatchetActive") ?? false),
    counterReady: Boolean(feat?.getFlag(SCOPE, "temsClaireCounterReady") ?? false)
  };
}

async function cmRemoveEffect(actor, name) {
  if (!actor) return;
  const ids = actor.effects.filter(e => e.name === name).map(e => e.id).filter(Boolean);
  if (!ids.length) return;
  try {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, {render:false});
    cmScheduleActorRender(actor);
  }
  catch (err) { console.warn(`Tem's Weapons | Claire effect cleanup race: ${name}`, err); }
}

async function cmApplyMarkerEffect(actor, feat, name) {
  if (!actor || !feat) return;
  await cmRemoveEffect(actor, name);
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name,
    origin: feat.uuid,
    disabled: false,
    transfer: false,
    duration: {},
    changes: [],
    flags: {"tems-weapons": {sourceItemId: feat.id}}
  }], {render:false});
  cmScheduleActorRender(actor);
}

async function cmSetSurges(feat, value) {
  const surges = clamp(value, 0, CM_MAX_SURGES);
  await feat.update({
    "flags.world.temsClaireSurges": surges,
    "system.uses.max": String(CM_MAX_SURGES),
    "system.uses.spent": CM_MAX_SURGES - surges
  }, {render:false});
  cmScheduleActorRender(feat.actor);
  return surges;
}

async function cmSetState(feat, changes={}, {sync=true}={}) {
  const update = {};
  if ("surges" in changes) {
    const surges = clamp(changes.surges, 0, CM_MAX_SURGES);
    update["flags.world.temsClaireSurges"] = surges;
    update["system.uses.max"] = String(CM_MAX_SURGES);
    update["system.uses.spent"] = CM_MAX_SURGES - surges;
  }
  if ("stanceActive" in changes) update["flags.world.temsClaireStanceActive"] = Boolean(changes.stanceActive);
  if ("stanceTurn" in changes) update["flags.world.temsClaireStanceTurn"] = clamp(changes.stanceTurn, 0, 3);
  if ("ratchetActive" in changes) update["flags.world.temsClaireRatchetActive"] = Boolean(changes.ratchetActive);
  if ("counterReady" in changes) update["flags.world.temsClaireCounterReady"] = Boolean(changes.counterReady);
  if ("ratchetHits" in changes) update["flags.world.temsClaireRatchetHits"] = clamp(changes.ratchetHits, 0, 2);
  if ("ratchetTurnKey" in changes) update["flags.world.temsClaireRatchetTurnKey"] = String(changes.ratchetTurnKey ?? "");
  if ("cascadeHits" in changes) update["flags.world.temsClaireCascadeHits"] = clamp(changes.cascadeHits, 0, 2);
  if ("cascadeTurnKey" in changes) update["flags.world.temsClaireCascadeTurnKey"] = String(changes.cascadeTurnKey ?? "");

  if (Object.keys(update).length) {
    await feat.update(update, {render:false});
    cmScheduleActorRender(feat.actor);
  }
  if (sync) await cmSyncVisibility(feat);
}

function cmActivityVisible(name, feat, blade) {
  if (!feat?.actor || !blade) return true;
  const cm = cmRead(feat);
  const cb = readState(blade);
  const inCombat = Boolean(getActiveCombatForActor(feat.actor));

  if (name === CM_NAMES.STANCE) return inCombat && !cm.stanceActive && cm.surges >= 1;
  if (!cm.stanceActive) return false;

  switch (name) {
    case CM_NAMES.RATCHET_1:
    case CM_NAMES.RATCHET_2:
      return true;
    case CM_NAMES.CASCADE_1:
    case CM_NAMES.CASCADE_2:
    case CM_NAMES.SWORD_1:
    case CM_NAMES.SWORD_2:
      return cb.mode === "sword";
    case CM_NAMES.PUMP:
      return cb.mode === "axe" && cb.charge >= 3;
    case CM_NAMES.GUARD:
      return cb.mode === "axe";
    case CM_NAMES.COUNTER:
      return cb.mode === "axe" && cm.counterReady;
    case CM_NAMES.AXE_1:
      return cb.mode === "axe";
    case CM_NAMES.AXE_2:
      return cb.mode === "axe" && cb.phials >= 1;
    case CM_NAMES.EARTH:
      return cb.mode === "axe" && cb.shieldCharged && cb.phials >= 1 && cm.surges >= 1;
    default:
      return true;
  }
}

async function cmSyncVisibility(feat) {
  if (!isClairesMight(feat) || !feat.actor) return;
  const blade = getClaireChargeBlade(feat.actor);
  const key = feat.uuid;
  if (cmVisibilityLocks.has(key)) return;
  cmVisibilityLocks.add(key);
  try {
    const updates = {};
    for (const activity of feat.system.activities ?? []) {
      const visible = cmActivityVisible(activity.name, feat, blade);
      const curMin = activity.visibility?.level?.min ?? null;
      const curMax = activity.visibility?.level?.max ?? null;
      const wantMin = null;
      const wantMax = visible ? null : -1;
      if (curMin !== wantMin) updates[`system.activities.${activity.id}.visibility.level.min`] = wantMin;
      if (curMax !== wantMax) updates[`system.activities.${activity.id}.visibility.level.max`] = wantMax;
    }
    if (Object.keys(updates).length) await feat.update(updates, {render:false});
    // Never synchronously replace the actor/item sheet DOM from inside a Claire
    // activity click. Refresh shortly after the current click stack finishes.
    cmScheduleActorRender(feat.actor);
    if (feat.sheet?.rendered) {
      setTimeout(() => {
        try { if (feat.sheet?.rendered) feat.sheet.render({force:true}); }
        catch (err) { console.warn("Tem's Weapons | Deferred Claire item-sheet render failed", err); }
      }, 200);
    }
  } finally {
    cmVisibilityLocks.delete(key);
  }
}

async function cmSyncActor(actor) {
  const feat = getClaireFeat(actor);
  if (feat) await cmSyncVisibility(feat);
}

async function cmEndStance(feat, {notify=true}={}) {
  if (!feat?.actor) return;
  const wasActive = cmRead(feat).stanceActive;
  await cmSetState(feat, {
    stanceActive:false,
    stanceTurn:0,
    ratchetActive:false,
    counterReady:false,
    ratchetHits:0,
    cascadeHits:0
  }, {sync:false});
  await cmRemoveEffect(feat.actor, CM_STANCE_EFFECT);
  await cmRemoveEffect(feat.actor, CM_RATCHET_EFFECT);
  await cmRemoveEffect(feat.actor, CM_GUARD_EFFECT);
  await cmSyncVisibility(feat);
  if (notify && wasActive) ui.notifications.info("Claire's Stance ended. Ratchet shut down.");
}

async function cmResetForCombat(actor, combat) {
  const feat = getClaireFeat(actor);
  if (!feat) return;
  await cmEndStance(feat, {notify:false});
  await cmSetSurges(feat, CM_MAX_SURGES);
  await feat.setFlag(SCOPE, "temsClaireCombatId", combat?.id ?? "");
  await cmSyncVisibility(feat);
  ui.notifications.info("Claire's Might — 3 Surges ready for combat.");
}

async function cmRatchetTick(feat, blade) {
  if (!feat || !blade || !cmRead(feat).ratchetActive) return;
  const cb = readState(blade);
  const before = cb.charge;
  if (cb.charge < 3) cb.charge = 3;
  else if (cb.charge < 5) cb.charge = 5;
  else return; // Red: engine idles.
  await writeState(blade, cb, {renderActor:false});
  ui.notifications.info(`Ratchet engine: Charge ${before} → ${cb.charge}.`);
}

async function cmStartClaireTurn(actor) {
  const feat = getClaireFeat(actor);
  if (!feat) return;
  const blade = getClaireChargeBlade(actor);
  const cm = cmRead(feat);

  // A leftover Axe Counter is no longer an immediate follow-up once Claire's turn begins.
  if (cm.counterReady) {
    await cmSetState(feat, {counterReady:false}, {sync:false});
    await cmRemoveEffect(actor, CM_GUARD_EFFECT);
  }

  if (cm.stanceActive) {
    const nextTurn = clamp(cm.stanceTurn + 1, 1, 3);
    await cmSetState(feat, {stanceTurn:nextTurn}, {sync:false});
    if (blade && cm.ratchetActive) await cmRatchetTick(feat, blade);
    ui.notifications.info(`Claire's Stance — Turn ${nextTurn}/3.`);
  }
  await cmSyncVisibility(feat);
}

function cmFindActorInCombat(combat, actorId) {
  return combat?.combatants?.find?.(c => c.actor?.id === actorId)?.actor ?? game.actors?.get?.(actorId) ?? null;
}

async function cmHandleCombatTurn(combat) {
  if (!combat?.started) return;
  const current = combat.combatant;
  const currentActorId = current?.actor?.id ?? null;
  const turnKey = `${combat.round ?? 0}:${combat.turn ?? -1}:${current?.id ?? "none"}`;
  const previous = cmCombatTurnCache.get(combat.id);
  if (previous?.turnKey === turnKey) return;

  if (previous?.actorId) {
    const prevActor = cmFindActorInCombat(combat, previous.actorId);
    const prevFeat = getClaireFeat(prevActor);
    if (prevFeat) {
      const cm = cmRead(prevFeat);
      if (cm.stanceActive && cm.stanceTurn >= 3) await cmEndStance(prevFeat);
    }
  }

  cmCombatTurnCache.set(combat.id, {turnKey, actorId:currentActorId});
  if (current?.actor) await cmStartClaireTurn(current.actor);
}

Hooks.on("combatStart", async combat => {
  const seen = new Set();
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    if (getClaireFeat(actor)) await cmResetForCombat(actor, combat);
  }
  const current = combat.combatant;
  cmCombatTurnCache.set(combat.id, {
    turnKey:`${combat.round ?? 0}:${combat.turn ?? -1}:${current?.id ?? "none"}`,
    actorId:current?.actor?.id ?? null
  });
});

Hooks.on("createCombatant", async combatant => {
  const combat = combatant?.parent;
  if (!combat?.started || !combatant.actor || !getClaireFeat(combatant.actor)) return;
  await cmResetForCombat(combatant.actor, combat);
});

Hooks.on("updateCombat", async (combat, changes) => {
  if (!("turn" in (changes ?? {}) || "round" in (changes ?? {}))) return;
  await cmHandleCombatTurn(combat);
});

Hooks.on("deleteCombat", async combat => {
  cmCombatTurnCache.delete(combat.id);
  const seen = new Set();
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    const feat = getClaireFeat(actor);
    if (feat) await cmEndStance(feat, {notify:false});
  }
});

// D&D5e can invoke an item-level use path directly from the actor sheet.
// That path can open activity-choices.hbs without passing through our wrapped
// Item5e#use method. Catch it at the system-supported preUseItem hook instead.
// Returning false here prevents the stray Charge Blade item use before the
// multi-activity chooser is configured, while consuming the one-shot guard.
Hooks.on("dnd5e.preUseItem", (item) => {
  if (!isChargeBlade(item)) return;
  if (!cmShouldSuppressChargeBladeUse(item)) return;
  console.warn("Tem's Weapons | Blocked stray Charge Blade item-use after Claire's Might (preUseItem).");
  return false;
});

Hooks.on("dnd5e.preUseActivity", async activity => {
  const feat = getItem(activity);
  if (!isClairesMight(feat)) return;
  const actor = feat.actor;
  const blade = getClaireChargeBlade(actor);
  const cm = cmRead(feat);
  const cb = blade ? readState(blade) : null;
  const n = activity.name;

  if (!actor || !blade) {
    ui.notifications.warn("Claire's Might requires an owned Charge Blade on the same actor.");
    return false;
  }

  // Guard the current click against the actor-sheet click-through that can
  // otherwise open the Charge Blade's multi-activity chooser after this
  // Claire's Might activity resolves.
  cmArmChargeBladeUseSuppression(actor);

  if (n === CM_NAMES.STANCE) {
    if (!getActiveCombatForActor(actor)) {
      ui.notifications.warn("Claire's Stance can only be activated while Claire is in an active combat.");
      return false;
    }
    if (cm.stanceActive) {
      ui.notifications.warn("Claire's Stance is already active.");
      return false;
    }
    if (cm.surges < 1) {
      ui.notifications.warn("Claire's Might has no Surges remaining this combat.");
      return false;
    }
    return;
  }

  if (!cm.stanceActive) {
    ui.notifications.warn(`${n} requires Claire's Stance.`);
    return false;
  }

  if ([CM_NAMES.CASCADE_1, CM_NAMES.CASCADE_2, CM_NAMES.SWORD_1, CM_NAMES.SWORD_2].includes(n) && cb.mode !== "sword") {
    ui.notifications.warn(`${n} requires Sword Mode.`);
    return false;
  }

  if ([CM_NAMES.PUMP, CM_NAMES.GUARD, CM_NAMES.COUNTER, CM_NAMES.AXE_1, CM_NAMES.AXE_2, CM_NAMES.EARTH].includes(n) && cb.mode !== "axe") {
    ui.notifications.warn(`${n} requires Axe Mode.`);
    return false;
  }

  if (n === CM_NAMES.PUMP && cb.charge < 3) {
    ui.notifications.warn("Axe Pump Load requires at least 3 Charge.");
    return false;
  }

  if (n === CM_NAMES.COUNTER) {
    if (!cm.counterReady) {
      ui.notifications.warn("Axe Counter is only available immediately after a successful Axe Guard Point.");
      return false;
    }
    if (cb.phials < 1) {
      ui.notifications.warn("Axe Counter requires at least 1 loaded Phial.");
      return false;
    }
  }

  if (n === CM_NAMES.AXE_2 && cb.phials < 1) {
    ui.notifications.warn("Boosted Axe Combo's discharge requires at least 1 loaded Phial.");
    return false;
  }

  if (n === CM_NAMES.EARTH) {
    if (!cb.shieldCharged) {
      ui.notifications.warn("Earth-Shattering SAED requires a charged shield.");
      return false;
    }
    if (cb.phials < 1) {
      ui.notifications.warn("Earth-Shattering SAED requires at least 1 loaded Phial.");
      return false;
    }
    if (cm.surges < 1) {
      ui.notifications.warn("Earth-Shattering SAED requires 1 additional Surge.");
      return false;
    }
  }
});

Hooks.on("dnd5e.postCreateUsageMessage", async activity => {
  const feat = getItem(activity);
  if (!isClairesMight(feat)) return;
  const actor = feat.actor;
  const blade = getClaireChargeBlade(actor);
  if (!actor || !blade) return;
  const n = activity.name;

  if (n === CM_NAMES.STANCE) {
    const cm = cmRead(feat);
    await cmSetState(feat, {
      surges:cm.surges - 1,
      stanceActive:true,
      stanceTurn:1,
      ratchetActive:false,
      counterReady:false,
      ratchetHits:0,
      cascadeHits:0
    }, {sync:false});
    const cb = readState(blade);
    cb.charge = Math.max(cb.charge, 3);
    await writeState(blade, cb, {renderActor:false});
    await cmApplyMarkerEffect(actor, feat, CM_STANCE_EFFECT);
    await cmSyncVisibility(feat);
    ui.notifications.info(`Claire's Stance activated — Turn 1/3, ${cm.surges - 1} Surge${cm.surges - 1 === 1 ? "" : "s"} remaining, Charge ${cb.charge}/5.`);
    return;
  }

  if (n === CM_NAMES.RATCHET_1) {
    await cmSetState(feat, {
      ratchetActive:true,
      ratchetHits:0,
      ratchetTurnKey:cmTurnKey(actor)
    }, {sync:false});
    await cmApplyMarkerEffect(actor, feat, CM_RATCHET_EFFECT);
    await cmSyncVisibility(feat);
    ui.notifications.info("Ratchet engine engaged.");
    return;
  }

  if (n === CM_NAMES.CASCADE_1) {
    await cmSetState(feat, {cascadeHits:0, cascadeTurnKey:cmTurnKey(actor)}, {sync:false});
    return;
  }

  if (n === CM_NAMES.PUMP) {
    const cb = readState(blade);
    const gained = cb.charge >= 5 ? 5 : 3;
    cb.phials = gained;
    cb.charge = 0;
    await writeState(blade, cb, {renderActor:false});
    await cmSyncVisibility(feat);
    ui.notifications.info(`Axe Pump Load — loaded ${gained} Phials; remained in Axe Mode.`);
    return;
  }

  if (n === CM_NAMES.GUARD) {
    await cmRemoveEffect(actor, CM_GUARD_EFFECT);
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: CM_GUARD_EFFECT,
      origin: feat.uuid,
      disabled:false,
      transfer:false,
      duration:{seconds:6, rounds:1},
      changes:[{
        key:"system.attributes.ac.bonus",
        mode:CONST.ACTIVE_EFFECT_MODES.ADD,
        value:"2",
        priority:30
      }],
      flags:{"tems-weapons":{sourceItemId:feat.id}}
    }], {render:false});
    cmScheduleActorRender(actor);
    await cmSetState(feat, {counterReady:true});
    ui.notifications.info("Axe Guard Point: +2 AC. If this turns the triggering hit into a miss, use Axe Counter immediately.");
    return;
  }

  if (n === CM_NAMES.EARTH) {
    const cm = cmRead(feat);
    await cmSetState(feat, {surges:cm.surges - 1});
    ui.notifications.info(`Earth-Shattering SAED initiated — 1 Surge spent (${cm.surges - 1} remaining).`);
  }
});

Hooks.on("dnd5e.postRollAttack", async (rolls, data) => {
  const activity = data?.subject;
  const feat = getItem(activity);
  if (!isClairesMight(feat)) return;
  const actor = feat.actor;
  const blade = getClaireChargeBlade(actor);
  if (!actor || !blade) return;

  const targets = Array.from(game.user.targets ?? []);
  const hit = targets.length && (rolls ?? []).some(roll => targets.some(token => attackHitsTarget(roll, token)));
  const n = activity.name;

  if (!targets.length) {
    ui.notifications.warn(`${n} rolled with no target selected; Claire's Might hit-based automation could not confirm a hit.`);
  }

  if ([CM_NAMES.RATCHET_1, CM_NAMES.RATCHET_2].includes(n)) {
    const key = cmTurnKey(actor);
    const storedKey = String(feat.getFlag(SCOPE,"temsClaireRatchetTurnKey") ?? "");
    let hits = storedKey === key ? clamp(feat.getFlag(SCOPE,"temsClaireRatchetHits") ?? 0, 0, 2) : 0;
    if (hit) hits = clamp(hits + 1, 0, 2);
    const cb = readState(blade);
    if (hits >= 2) cb.charge = Math.max(cb.charge, 4);
    else if (hits >= 1) cb.charge = Math.max(cb.charge, 3);
    await writeState(blade, cb, {renderActor:false});
    await cmSetState(feat, {ratchetActive:true, ratchetHits:hits, ratchetTurnKey:key}, {sync:false});
    await cmSyncVisibility(feat);
    ui.notifications.info(`Ratchet: ${hits}/2 confirmed hit${hits === 1 ? "" : "s"} this turn — Charge ${cb.charge}/5.`);
    return;
  }

  if ([CM_NAMES.CASCADE_1, CM_NAMES.CASCADE_2].includes(n)) {
    const key = cmTurnKey(actor);
    const storedKey = String(feat.getFlag(SCOPE,"temsClaireCascadeTurnKey") ?? "");
    let hits = storedKey === key ? clamp(feat.getFlag(SCOPE,"temsClaireCascadeHits") ?? 0, 0, 2) : 0;
    const cb = readState(blade);
    if (hit) {
      hits = clamp(hits + 1, 0, 2);
      cb.charge = clamp(cb.charge + 1, 0, 5);
      await writeState(blade, cb, {renderActor:false});
    }
    await cmSetState(feat, {cascadeHits:hits, cascadeTurnKey:key}, {sync:false});

    if (n === CM_NAMES.CASCADE_2) {
      const live = readState(blade);
      if (hits >= 1 && live.charge >= 3) {
        const gained = live.charge >= 5 ? 5 : 3;
        live.phials = gained;
        live.charge = 0;
        await writeState(blade, live, {renderActor:false});
        ui.notifications.info(`Phial Cascade: ${hits} hit${hits === 1 ? "" : "s"}; automatically loaded ${gained} Phials.`);
      } else if (hits >= 1) {
        ui.notifications.info(`Phial Cascade hit, but Charge ${live.charge}/5 is below the loading threshold.`);
      } else {
        ui.notifications.info("Phial Cascade missed — no automatic load.");
      }
      await cmSetState(feat, {cascadeHits:0}, {sync:false});
    }
    await cmSyncVisibility(feat);
    return;
  }

  if ([CM_NAMES.SWORD_1, CM_NAMES.SWORD_2].includes(n)) {
    if (hit) {
      const cb = readState(blade);
      cb.charge = clamp(cb.charge + 1, 0, 5);
      await writeState(blade, cb, {renderActor:false});
      ui.notifications.info(`${n} hit: +1 Charge (${cb.charge}/5).`);
    }
    await cmSyncVisibility(feat);
    return;
  }

  if (n === CM_NAMES.AXE_2) {
    if (hit) {
      const cb = readState(blade);
      cb.phials = clamp(cb.phials - 1, 0, 5);
      await writeState(blade, cb, {renderActor:false});
      ui.notifications.info(`Boosted Axe Combo discharge hit: -1 Phial (${cb.phials}/5).`);
    }
    await cmSyncVisibility(feat);
    return;
  }

  if (n === CM_NAMES.COUNTER) {
    if (hit) {
      const cb = readState(blade);
      cb.phials = clamp(cb.phials - 1, 0, 5);
      await writeState(blade, cb, {renderActor:false});
      ui.notifications.info(`Axe Counter hit: -1 Phial (${cb.phials}/5).`);
    } else {
      ui.notifications.info("Axe Counter missed — no Phial spent.");
    }
    await cmSetState(feat, {counterReady:false}, {sync:false});
    await cmRemoveEffect(actor, CM_GUARD_EFFECT);
    await cmSyncVisibility(feat);
  }
});

Hooks.on("dnd5e.rollDamage", async (rolls, data) => {
  const activity = data?.subject;
  const feat = getItem(activity);
  if (!isClairesMight(feat) || activity?.name !== CM_NAMES.EARTH) return;
  const actor = feat.actor;
  const blade = getClaireChargeBlade(actor);
  if (!actor || !blade) return;

  const cb = readState(blade);
  const spent = cb.phials;
  if (spent > 0) {
    const force = await new CONFIG.Dice.DamageRoll(
      `${spent * 2}d8`,
      actor.getRollData?.() ?? {},
      {type:"force"}
    ).evaluate();
    await force.toMessage({
      speaker:ChatMessage.getSpeaker({actor}),
      flavor:`${feat.name} — Earth-Shattering SAED Phial Burst (${spent} Phial${spent === 1 ? "" : "s"})`
    });
  }

  cb.phials = 0;
  cb.mode = "sword";
  await writeState(blade, cb, {renderActor:false});
  await cmSyncVisibility(feat);
  ui.notifications.info(`Earth-Shattering SAED: spent ${spent} Phial${spent === 1 ? "" : "s"}, returned to Sword Mode. Claire's Stance continues if time remains.`);
});

Hooks.on("updateItem", async (item, changes) => {
  if (isChargeBlade(item) && item.actor) {
    const flat = foundry.utils.flattenObject(changes ?? {});
    if (Object.keys(flat).some(k => k.startsWith("flags.world.chargeBlade"))) {
      await cmSyncActor(item.actor);
    }
  }
  if (isClairesMight(item) && item.actor) {
    const flat = foundry.utils.flattenObject(changes ?? {});
    if (Object.keys(flat).some(k => k.startsWith("flags.world.temsClaire") || k.startsWith("system.uses"))) {
      await cmSyncVisibility(item);
    }
  }
});

Hooks.on("createItem", async item => {
  if (!item?.actor) return;
  if (isClairesMight(item) || isChargeBlade(item)) await cmSyncActor(item.actor);
});

/* ------------------------------------------------------------------------- */
/* BUNDLED WEAPON INSTALLER                                                  */
/* ------------------------------------------------------------------------- */

const TEMS_FOLDER_NAME = "Tem's weapons";

const BUNDLED_WEAPONS = [
  { path: "items/claire/claires-might.json", identifier: "tems-claires-might", folder: null },
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

  // Sync Claire's Might on actors without changing existing Charge Blade state.
  for (const actor of game.actors) {
    const feat = getClaireFeat(actor);
    if (!feat) continue;
    try {
      const surges = clamp(feat.getFlag(SCOPE, "temsClaireSurges") ?? CM_MAX_SURGES, 0, CM_MAX_SURGES);
      await cmSetSurges(feat, surges);
      await cmSyncVisibility(feat);
    } catch (err) {
      console.warn("Tem's Weapons | Claire's Might initial sync failed", actor, err);
    }
  }

  // Sync straightforward weapon effects already embedded on actors.
  for (const actor of game.actors) {
    for (const item of actor.items) {
      try {
        if (hasIdentifier(item, TEMS_IDS.SWORD_SHIELD)) await syncSwordShieldGuard(item);
        if (hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) {
          await cleanAllDualBladeEffects(item);
          await item.setFlag("world", "temsDualBladesDemonMode", false);
          await syncDualBladeDamage(item);
        }
        if (ident(item) === HEAVY.CANE) await syncCaneVisibility(item);
        if (ident(item) === HEAVY.JETHAMMER) {
          await setJetFuel(item, Number(item.getFlag("world","temsJetFuel") ?? 3), {notify:false});
        }
        if (ident(item) === HEAVY.LONGSWORD) {
          await setLongswordState(item, {notify:false});
        }
        if (ident(item) === HEAVY.GUNLANCE) {
          await syncHeavyResource(item);
        }
      } catch (err) {
        console.warn("Tem's Weapons | Straightforward weapon initial sync failed", item, err);
      }
    }
  }

  // Migrate/sync bundled world Items that were imported by earlier module versions.
  for (const item of game.items) {
    try {
      if (hasIdentifier(item, TEMS_IDS.DUAL_BLADES)) {
        await item.setFlag("world", "temsDualBladesDemonMode", false);
        await syncDualBladeDamage(item);
      }
      if (ident(item) === HEAVY.CANE) await syncCaneVisibility(item);
      if (ident(item) === HEAVY.JETHAMMER) {
        await setJetFuel(item, Number(item.getFlag("world","temsJetFuel") ?? 3), {notify:false});
      }
      if (ident(item) === HEAVY.LONGSWORD) {
        await setLongswordState(item, {notify:false});
      }
      if (ident(item) === HEAVY.GUNLANCE) {
        await syncHeavyResource(item);
      }
    } catch (err) {
      console.warn("Tem's Weapons | World item migration failed", item, err);
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

  console.log("Tem's Weapons | v1.3.4 Ready");
});
