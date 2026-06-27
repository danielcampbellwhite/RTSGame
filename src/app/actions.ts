"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { ITEM_DEFS, type ItemDef } from "@/data/items";
import { RECIPES, upgradeCost, stationLevelReq, type Station } from "@/data/recipes";
import {
  SURV,
  depleteResources,
  clamp,
  resolveFight,
  resolveFlee,
  RESOURCE_KEYS,
  type ResourceKey,
  type PlayerCombat,
} from "@/lib/game";
import { mulberry32, hashSeed, randInt, chance } from "@/lib/rng";
import { tileAt, lootForTile, enemyForTile, wanderingEnemy, generateLoot, chebyshev, tierForDistance } from "@/lib/wasteland";
import { BIOMES } from "@/data/world";
import { sightFor, ambientLine, enemyEntrance, hazardLine, searchNothing } from "@/data/flavor";
import type {
  GameSnapshot,
  ItemView,
  ExpeditionView,
  TileView,
  EncounterView,
  CraftableView,
} from "@/lib/types";
import { revalidatePath } from "next/cache";

const WINDOW_RADIUS = 4;
const BASE_CARRY = 12;

// ── small helpers ────────────────────────────────────────────────────────────

type StackRow = {
  id: string;
  defKey: string;
  quantity: number;
  durability: number | null;
  location: string;
  equippedSlot: string | null;
};

function itemView(s: StackRow): ItemView {
  const def = ITEM_DEFS[s.defKey];
  return {
    id: s.id,
    defKey: s.defKey,
    name: def?.name ?? s.defKey,
    icon: def?.icon ?? "❔",
    category: def?.category ?? "MATERIAL",
    quantity: s.quantity,
    durability: s.durability,
    maxDurability: def?.maxDurability ?? null,
    slot: def?.slot ?? null,
    equippedSlot: s.equippedSlot,
    heal: def?.heal,
    reduceRad: def?.reduceRad,
    restoreStamina: def?.restoreStamina,
  };
}

function newSeed(): number {
  // No Math.random in scripts-era constraints elsewhere, but actions run at
  // request time; a time+entropy seed is fine here.
  return hashSeed(Date.now() & 0xffffffff, Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** Effective combat profile from equipped gear + carried ammo. */
function playerCombat(equipped: StackRow[], backpack: StackRow[]): PlayerCombat & { weaponId: string | null; weaponBroken: boolean } {
  let weapon: { def: ItemDef; row: StackRow } | null = null;
  let armor = 0;
  for (const s of equipped) {
    const def = ITEM_DEFS[s.defKey];
    if (!def) continue;
    if (def.category === "WEAPON" && (s.durability == null || s.durability > 0)) {
      if (!weapon || (def.damage ?? 0) > (weapon.def.damage ?? 0)) weapon = { def, row: s };
    }
    if (def.armor) armor += def.armor;
  }
  const usesAmmo = weapon?.def.usesAmmo ?? false;
  const hasAmmo = backpack.some((b) => b.defKey === "ammo" && b.quantity > 0);
  return {
    weaponDamage: weapon?.def.damage ?? SURV.basePunch,
    accuracy: weapon?.def.accuracy ?? 0.8,
    usesAmmo,
    hasAmmo,
    armor,
    weaponId: weapon?.row.id ?? null,
    weaponBroken: !weapon,
  };
}

// ── snapshot ──────────────────────────────────────────────────────────────────

async function loadSnapshot(playerId: string, flash: string | null = null): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player || !player.shelter) return null;

  // Passive shelter depletion since last read.
  const now = new Date();
  const fresh = depleteResources(
    {
      food: player.shelter.food,
      water: player.shelter.water,
      meds: player.shelter.meds,
      ammo: player.shelter.ammo,
      scrap: player.shelter.scrap,
      fuel: player.shelter.fuel,
      morale: player.shelter.morale,
      lastTickAt: player.shelter.lastTickAt,
    },
    now
  );
  if (fresh.lastTickAt !== player.shelter.lastTickAt) {
    await prisma.shelter.update({
      where: { id: player.shelter.id },
      data: { food: Math.round(fresh.food), water: Math.round(fresh.water), fuel: Math.round(fresh.fuel), morale: Math.round(fresh.morale), lastTickAt: now },
    });
  }

  const items = (await prisma.itemStack.findMany({ where: { playerId } })) as StackRow[];
  const storage = items.filter((i) => i.location === "STORAGE" && !i.equippedSlot);
  const equippedRows = items.filter((i) => i.equippedSlot);
  const backpack = items.filter((i) => i.location === "BACKPACK");

  const equipped: Record<string, ItemView | null> = { PRIMARY: null, SECONDARY: null, ARMOR: null, HELMET: null, BACKPACK: null };
  for (const e of equippedRows) if (e.equippedSlot) equipped[e.equippedSlot] = itemView(e);

  const sh = player.shelter;
  const craftables: CraftableView[] = RECIPES.map((r) => {
    const lvl = (sh as unknown as Record<string, number>)[`${r.station}Lvl`] ?? 0;
    const hasStation = lvl >= r.stationLvl;
    const resOk = !r.resources || RESOURCE_KEYS.every((k) => ((r.resources as Record<string, number>)[k] ?? 0) <= (sh as unknown as Record<string, number>)[k]);
    const itemsOk = !r.items || r.items.every((it) => storage.filter((s) => s.defKey === it.defKey).reduce((n, s) => n + s.quantity, 0) >= it.qty);
    const parts: string[] = [];
    if (r.resources) for (const k of RESOURCE_KEYS) if (r.resources[k]) parts.push(`${r.resources[k]} ${k}`);
    if (r.items) for (const it of r.items) parts.push(`${it.qty} ${ITEM_DEFS[it.defKey]?.name ?? it.defKey}`);
    return {
      key: r.key,
      name: r.name,
      station: r.station,
      affordable: hasStation && resOk && itemsOk,
      detail: hasStation ? parts.join(", ") || "free" : `needs ${r.station} L${r.stationLvl}`,
    };
  });

  let expedition: ExpeditionView | null = null;
  if (player.state === "IN_EXPEDITION") {
    const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
    if (exp) {
      // Entered tiles show their contents. Adjacent tiles are only "scouted":
      // you can see the terrain you could step into, but not what's there yet.
      const visited = new Set((exp.visited as unknown as string[]) ?? []);
      const scouted = new Set<string>();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) scouted.add(`${exp.posX + dx},${exp.posY + dy}`);

      const tiles: TileView[] = [];
      for (let dy = -WINDOW_RADIUS; dy <= WINDOW_RADIUS; dy++) {
        for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx++) {
          const x = exp.posX + dx;
          const y = exp.posY + dy;
          const key = `${x},${y}`;
          const isExit = x === 0 && y === 0;
          const t = tileAt(exp.seed, x, y);
          if (visited.has(key) || isExit) {
            tiles.push({
              x, y, revealed: true,
              icon: t.icon, label: t.label, feature: t.feature,
              color: BIOMES[t.biome].color,
              isPlayer: dx === 0 && dy === 0,
              isExit,
            });
          } else if (scouted.has(key)) {
            // terrain tint only — contents hidden
            tiles.push({ x, y, revealed: false, scouted: true, color: BIOMES[t.biome].color, isExit });
          } else {
            tiles.push({ x, y, revealed: false, isExit });
          }
        }
      }

      const carryBonus = equipped.BACKPACK ? ITEM_DEFS[equipped.BACKPACK.defKey]?.carryBonus ?? 0 : 0;
      const cur = tileAt(exp.seed, exp.posX, exp.posY);
      expedition = {
        id: exp.id,
        seed: exp.seed,
        posX: exp.posX,
        posY: exp.posY,
        distance: chebyshev(exp.posX, exp.posY),
        tier: tierForDistance(chebyshev(exp.posX, exp.posY)),
        tiles,
        windowRadius: WINDOW_RADIUS,
        biomeColor: BIOMES[cur.biome].color,
        biomeName: BIOMES[cur.biome].name,
        log: ((exp.log as unknown as string[]) ?? []).slice(0, 16),
        backpack: backpack.map(itemView),
        backpackUsed: backpack.reduce((n, b) => n + b.quantity, 0),
        carryCap: BASE_CARRY + carryBonus,
        pending: (exp.pending as unknown as EncounterView | null) ?? null,
        currentLabel: cur.label,
        atExit: exp.posX === 0 && exp.posY === 0,
      };
    }
  }

  return {
    player: {
      id: player.id,
      name: player.name,
      health: player.health,
      maxHealth: player.maxHealth,
      stamina: player.stamina,
      radiation: player.radiation,
      level: player.level,
      xp: player.xp,
      xpToNext: SURV.xpToLevel(player.level),
      reputation: player.reputation,
      state: player.state as "AT_SHELTER" | "IN_EXPEDITION",
    },
    shelter: {
      level: sh.level,
      food: Math.round(fresh.food),
      water: Math.round(fresh.water),
      meds: sh.meds,
      ammo: sh.ammo,
      scrap: sh.scrap,
      fuel: Math.round(fresh.fuel),
      morale: Math.round(fresh.morale),
      storageCap: sh.storageCap,
      storedCount: storage.length + equippedRows.length,
      workshopLvl: sh.workshopLvl,
      medicalLvl: sh.medicalLvl,
      ammoBenchLvl: sh.ammoBenchLvl,
      weaponBenchLvl: sh.weaponBenchLvl,
    },
    storage: storage.map(itemView),
    equipped,
    craftables,
    expedition,
    flash,
  };
}

// ── lifecycle ──────────────────────────────────────────────────────────────────

export async function createPlayer(name: string): Promise<{ playerId: string }> {
  // You start with nothing — no gear, no stores, no stations. Everything must
  // be scavenged from the wasteland.
  const player = await prisma.player.create({
    data: {
      name: name.trim().slice(0, 24) || "Survivor",
      shelter: {
        create: {
          food: 0, water: 0, meds: 0, ammo: 0, scrap: 0, fuel: 0,
          morale: 60,
          workshopLvl: 0, medicalLvl: 0, ammoBenchLvl: 0, weaponBenchLvl: 0,
        },
      },
    },
  });
  return { playerId: player.id };
}

export async function getState(playerId: string): Promise<GameSnapshot | null> {
  return loadSnapshot(playerId);
}

// ── shelter management ──────────────────────────────────────────────────────────

export async function equipItem(playerId: string, itemId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  const item = (await prisma.itemStack.findUnique({ where: { id: itemId } })) as StackRow | null;
  if (!player || player.state !== "AT_SHELTER" || !item || item.location !== "STORAGE") return loadSnapshot(playerId);
  const def = ITEM_DEFS[item.defKey];
  if (!def?.slot) return loadSnapshot(playerId);
  // Unequip whatever currently holds that slot.
  await prisma.itemStack.updateMany({ where: { playerId, equippedSlot: def.slot }, data: { equippedSlot: null } });
  await prisma.itemStack.update({ where: { id: itemId }, data: { equippedSlot: def.slot } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export async function unequipItem(playerId: string, itemId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  await prisma.itemStack.update({ where: { id: itemId }, data: { equippedSlot: null } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export async function craft(playerId: string, recipeKey: string): Promise<GameSnapshot | null> {
  const recipe = RECIPES.find((r) => r.key === recipeKey);
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!recipe || !player?.shelter || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  const sh = player.shelter;
  const lvl = (sh as unknown as Record<string, number>)[`${recipe.station}Lvl`] ?? 0;
  if (lvl < recipe.stationLvl) return loadSnapshot(playerId, "Station not built yet.");

  // Check + consume resources.
  if (recipe.resources) {
    for (const k of RESOURCE_KEYS) {
      const need = recipe.resources[k] ?? 0;
      if (need && (sh as unknown as Record<string, number>)[k] < need) return loadSnapshot(playerId, "Not enough resources.");
    }
  }
  // Check item inputs.
  if (recipe.items) {
    for (const it of recipe.items) {
      const have = (await prisma.itemStack.findMany({ where: { playerId, defKey: it.defKey, location: "STORAGE" } })).reduce((n, s) => n + s.quantity, 0);
      if (have < it.qty) return loadSnapshot(playerId, "Missing materials.");
    }
  }
  if (recipe.resources) {
    const dec: Record<string, { decrement: number }> = {};
    for (const k of RESOURCE_KEYS) if (recipe.resources[k]) dec[k] = { decrement: recipe.resources[k]! };
    await prisma.shelter.update({ where: { id: sh.id }, data: dec });
  }
  if (recipe.items) {
    for (const it of recipe.items) await consumeStorageItems(playerId, it.defKey, it.qty);
  }
  // Produce output.
  await addItem(playerId, recipe.output.defKey, recipe.output.qty, "STORAGE");
  revalidatePath("/");
  return loadSnapshot(playerId, `Crafted ${recipe.name}.`);
}

export async function upgrade(playerId: string, target: Station | "storage" | "shelter"): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  const sh = player.shelter;

  const field = target === "storage" || target === "shelter" ? null : (`${target}Lvl` as const);
  const isStation = field !== null;
  const curLevel = target === "shelter" ? sh.level : target === "storage" ? Math.floor((sh.storageCap - 240) / 60) + 1 : (sh as unknown as Record<string, number>)[field!] ?? 0;

  // Crafting stations are locked behind survivor rank — scavenge first, build later.
  if (isStation) {
    const req = stationLevelReq(curLevel + 1);
    if (player.level < req) return loadSnapshot(playerId, `Requires survivor level ${req} to build/upgrade this station.`);
  }

  const cost = upgradeCost(curLevel + 1);
  if (sh.scrap < cost.scrap || sh.fuel < cost.fuel) return loadSnapshot(playerId, `Need ${cost.scrap} scrap & ${cost.fuel} fuel.`);

  const data: Record<string, unknown> = { scrap: { decrement: cost.scrap }, fuel: { decrement: cost.fuel } };
  if (target === "storage") data.storageCap = { increment: 60 };
  else if (target === "shelter") {
    data.level = { increment: 1 };
    data.morale = { increment: 5 };
  } else data[field!] = { increment: 1 };

  await prisma.shelter.update({ where: { id: sh.id }, data });
  revalidatePath("/");
  return loadSnapshot(playerId, "Upgrade complete.");
}

// ── expedition ──────────────────────────────────────────────────────────────────

export async function startExpedition(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  await prisma.expedition.create({
    data: { playerId, seed: newSeed(), visited: ["0,0"], log: ["You step out into the wasteland."], posX: 0, posY: 0, distance: 0 },
  });
  await prisma.player.update({ where: { id: playerId }, data: { state: "IN_EXPEDITION", stamina: 100 } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export type Dir = "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW";
const DIRS: Record<Dir, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};
const DIR_NAME: Record<Dir, string> = {
  N: "north", S: "south", E: "east", W: "west",
  NE: "north-east", NW: "north-west", SE: "south-east", SW: "south-west",
};

export async function move(playerId: string, dir: Dir): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  if (exp.pending) return loadSnapshot(playerId, "Deal with the threat first.");
  if (player.stamina <= 0) return loadSnapshot(playerId, "Too exhausted — rest or head home.");

  const [dx, dy] = DIRS[dir];
  const x = exp.posX + dx;
  const y = exp.posY + dy;
  const key = `${x},${y}`;
  const visited = new Set((exp.visited as unknown as string[]) ?? []);
  const firstVisit = !visited.has(key);
  visited.add(key);
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  const narr = mulberry32(hashSeed(exp.seed, x, y, 555));

  let health = player.health;
  let radiation = player.radiation;
  const stamina = clamp(player.stamina - SURV.moveStaminaCost + SURV.staminaRegenOnTile, 0, 100);
  let pending: EncounterView | null = null;
  const entry: string[] = []; // chronological lines for this step

  const tile = tileAt(exp.seed, x, y);

  if (x === 0 && y === 0) {
    entry.push("You stagger back to the shelter exit — safety is a breath away.");
  } else {
    entry.push(`You head ${DIR_NAME[dir]}. ${sightFor(narr, tile.biome)}`);
    if (chance(narr, 0.22)) entry.push(ambientLine(narr));
    if (firstVisit && tile.feature === "ENEMY") {
      const e = enemyForTile(tile)!;
      pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power };
      entry.push(`${e.icon} ${enemyEntrance(narr, e.name)}`);
    } else if (firstVisit && (tile.feature === "LOOT" || tile.feature === "CACHE")) {
      const drops = lootForTile(exp.seed, tile);
      const added = await addLootToBackpack(playerId, drops);
      entry.push(added ? `${tile.icon} You scavenge the ${tile.label}. Recovered: ${added}.` : `${tile.icon} The ${tile.label} has already been stripped bare.`);
    } else if (firstVisit && tile.feature === "HAZARD") {
      const dose = Math.round(randInt(narr, SURV.radPerHazard[0], SURV.radPerHazard[1]) * (tile.hazard === "RADIATION" ? 1 : 0.6));
      radiation = clamp(radiation + dose);
      entry.push(`${tile.icon} ${hazardLine(narr, tile.hazard!)} (+${dose} rad)`);
    } else if (!firstVisit) {
      entry.push("Your own tracks cross this ground. Nothing new stirs.");
    }
  }

  if (radiation > SURV.radDamageThreshold) {
    const chip = Math.round((radiation - SURV.radDamageThreshold) / 8);
    if (chip > 0) {
      health = Math.max(0, health - chip);
      entry.push(`☢ Radiation sickness gnaws at you (−${chip} HP).`);
    }
  }

  for (const line of entry) log.unshift(line);
  log = log.slice(0, 24);

  if (health <= 0) {
    return applyDeath(playerId, exp.id, "You succumbed to the wasteland.");
  }

  await prisma.expedition.update({
    where: { id: exp.id },
    data: { posX: x, posY: y, distance: Math.max(exp.distance, chebyshev(x, y)), visited: [...visited], log, pending: pending ? (pending as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  });
  await prisma.player.update({ where: { id: playerId }, data: { health, radiation, stamina } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Non-movement interactions that make a tile feel alive: look around, search
 *  it thoroughly (loot or ambush), or rest to recover stamina (with risk). */
export async function interact(playerId: string, kind: "look" | "search" | "rest"): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  if (exp.pending) return loadSnapshot(playerId, "Deal with the threat first.");

  const tile = tileAt(exp.seed, exp.posX, exp.posY);
  const tier = tierForDistance(chebyshev(exp.posX, exp.posY));
  const salt = kind === "search" ? 222 : kind === "rest" ? 333 : 111;
  const narr = mulberry32(hashSeed(exp.seed, exp.posX, exp.posY, salt, Math.floor(Math.random() * 1e9)));
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  let stamina = player.stamina;
  let pending: EncounterView | null = null;

  if (kind === "look") {
    // Free reconnaissance: describe where you stand and the terrain around you
    // (terrain only — you still won't know what's in a tile until you enter it).
    log.unshift(`${tile.icon} ${tile.label}. ${sightFor(narr, tile.biome)}`);
    const around = ([["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]] as const).map(([name, dx, dy]) => {
      const nx = exp.posX + dx, ny = exp.posY + dy;
      const exit = nx === 0 && ny === 0 ? " (shelter!)" : "";
      return `${name} ${BIOMES[tileAt(exp.seed, nx, ny).biome].name}${exit}`;
    });
    log.unshift(`You scan the horizon — ${around.join(" · ")}.`);
  } else if (kind === "rest") {
    stamina = clamp(stamina + 30);
    log.unshift("You find cover, slow your breathing, and recover. (+stamina)");
    if (chance(narr, 0.15 + tier * 0.05)) {
      const e = wanderingEnemy(narr, tier);
      pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power };
      log.unshift(`${e.icon} Your rest is cut short — ${enemyEntrance(narr, e.name)}`);
    }
  } else {
    // search
    stamina = clamp(stamina - 5);
    const roll = narr();
    if (roll < 0.18 + tier * 0.03) {
      const e = wanderingEnemy(narr, tier);
      pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power };
      log.unshift(`${e.icon} You disturbed something — ${enemyEntrance(narr, e.name)}`);
    } else if (roll < 0.7) {
      const drops = generateLoot(narr, [["scrap", 4], ["cloth", 3], ["ration", 3], ["water_bottle", 3], ["ammo", 2]], tier, [1, 1]);
      const added = await addLootToBackpack(playerId, drops);
      log.unshift(added ? `You comb through the debris and turn up ${added}.` : searchNothing(narr));
    } else {
      log.unshift(searchNothing(narr));
    }
  }

  log = log.slice(0, 24);
  await prisma.expedition.update({ where: { id: exp.id }, data: { log, pending: pending ? (pending as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
  if (stamina !== player.stamina) await prisma.player.update({ where: { id: playerId }, data: { stamina } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export async function resolveEncounter(playerId: string, choice: "fight" | "flee"): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  const pending = exp?.pending as unknown as EncounterView | null;
  if (!exp || !pending) return loadSnapshot(playerId);

  const items = (await prisma.itemStack.findMany({ where: { playerId } })) as StackRow[];
  const equipped = items.filter((i) => i.equippedSlot);
  const backpack = items.filter((i) => i.location === "BACKPACK");
  const combat = playerCombat(equipped, backpack);
  const rng = mulberry32(hashSeed(exp.seed, exp.posX, exp.posY, player.health, Math.floor(Math.random() * 1e9)));
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 12);

  let health = player.health;
  let stamina = player.stamina;
  let xp = player.xp;
  let level = player.level;
  let newPending: EncounterView | null = pending;

  if (choice === "flee") {
    const tile = tileAt(exp.seed, exp.posX, exp.posY);
    const e = enemyForTile(tile)!;
    const res = resolveFlee(rng, e.fleeable, stamina, pending.power * 0.5, combat.armor);
    stamina = clamp(stamina - 14, 0, 100);
    if (res.escaped) {
      newPending = null;
      log.unshift(`🏃 You broke away from the ${pending.name}.`);
    } else {
      health = Math.max(0, health - res.damageTaken);
      log.unshift(`Failed to flee — took ${res.damageTaken} damage.`);
    }
  } else {
    const r = resolveFight(rng, combat, pending.power, pending.power * 0.6, pending.hp);
    health = Math.max(0, health - r.damageTaken);
    // consume ammo / weapon durability on the swing
    if (combat.usesAmmo && combat.hasAmmo) await spendAmmo(playerId);
    if (combat.weaponId) await prisma.itemStack.update({ where: { id: combat.weaponId }, data: { durability: { decrement: 1 } } }).catch(() => {});
    log.unshift(`⚔️ ${r.note}${r.damageTaken ? ` (−${r.damageTaken} HP)` : ""}`);
    if (r.win) {
      newPending = null;
      const reward = SURV.xpPerKill + pending.power / 4;
      xp += Math.round(reward);
      // small loot from the body
      const tier = tierForDistance(chebyshev(exp.posX, exp.posY));
      const drops = lootForTile(exp.seed, { ...tileAt(exp.seed, exp.posX, exp.posY), feature: "CACHE" });
      const added = await addLootToBackpack(playerId, drops.slice(0, 1 + Math.floor(tier / 2)));
      log.unshift(`🎖️ Defeated the ${pending.name}. +${Math.round(reward)} XP${added ? `, looted ${added}` : ""}.`);
    } else {
      newPending = { ...pending, hp: r.enemyHp };
    }
  }

  // level ups
  while (xp >= SURV.xpToLevel(level)) {
    xp -= SURV.xpToLevel(level);
    level += 1;
    log.unshift(`⭐ Reached level ${level}!`);
  }

  if (health <= 0) {
    return applyDeath(playerId, exp.id, `The ${pending.name} got you.`);
  }

  await prisma.expedition.update({ where: { id: exp.id }, data: { log, pending: newPending ? (newPending as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
  await prisma.player.update({ where: { id: playerId }, data: { health, stamina, xp, level, maxHealth: 100 + (level - 1) * 10 } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export async function useConsumable(playerId: string, itemId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  const item = (await prisma.itemStack.findUnique({ where: { id: itemId } })) as StackRow | null;
  if (!player || !item) return loadSnapshot(playerId);
  const def = ITEM_DEFS[item.defKey];
  if (!def || def.category !== "CONSUMABLE") return loadSnapshot(playerId);

  // Don't let the player waste a consumable that would do nothing right now.
  const wouldHeal = (def.heal ?? 0) > 0 && player.health < player.maxHealth;
  const wouldRad = (def.reduceRad ?? 0) > 0 && player.radiation > 0;
  const wouldStam = (def.restoreStamina ?? 0) > 0 && player.stamina < 100;
  if (!wouldHeal && !wouldRad && !wouldStam) {
    return loadSnapshot(playerId, `No need for ${def.name} right now.`);
  }

  const health = clamp(player.health + (def.heal ?? 0), 0, player.maxHealth);
  const radiation = clamp(player.radiation - (def.reduceRad ?? 0));
  const stamina = clamp(player.stamina + (def.restoreStamina ?? 0));
  await prisma.player.update({ where: { id: playerId }, data: { health, radiation, stamina } });
  await consumeStack(item, 1);
  revalidatePath("/");
  return loadSnapshot(playerId, `Used ${def.name}.`);
}

export async function returnHome(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);

  // The trek home: risk scales with how deep you pushed.
  const d = chebyshev(exp.posX, exp.posY);
  const rng = mulberry32(hashSeed(exp.seed, 777, d, Math.floor(Math.random() * 1e9)));
  let health = player.health;
  const ambushes = Math.floor(d / 2);
  let bitten = 0;
  for (let i = 0; i < ambushes; i++) {
    if (chance(rng, 0.25 + tierForDistance(d) * 0.05)) {
      const dmg = randInt(rng, 6, 10 + tierForDistance(d) * 4);
      health = Math.max(0, health - dmg);
      bitten += dmg;
      if (health <= 0) return applyDeath(playerId, exp.id, "Ambushed on the way home — you didn't make it.");
    }
  }

  // Safe return: secure the haul.
  const backpack = (await prisma.itemStack.findMany({ where: { playerId, location: "BACKPACK" } })) as StackRow[];
  const resourceGain: Partial<Record<ResourceKey, number>> = {};
  let kept = 0;
  let cap = player.shelter.storageCap - (await prisma.itemStack.count({ where: { playerId, location: "STORAGE" } }));
  for (const b of backpack) {
    const def = ITEM_DEFS[b.defKey];
    if (def?.resource) {
      resourceGain[def.resource] = (resourceGain[def.resource] ?? 0) + (def.resourceAmount ?? 0) * b.quantity;
      await prisma.itemStack.delete({ where: { id: b.id } });
    } else if (cap > 0) {
      await prisma.itemStack.update({ where: { id: b.id }, data: { location: "STORAGE" } });
      kept++;
      cap--;
    } else {
      await prisma.itemStack.delete({ where: { id: b.id } }); // storage full — overflow lost
    }
  }
  const resData: Record<string, { increment: number }> = {};
  for (const k of RESOURCE_KEYS) if (resourceGain[k]) resData[k] = { increment: Math.round(resourceGain[k]!) };
  if (Object.keys(resData).length) await prisma.shelter.update({ where: { id: player.shelter.id }, data: resData });

  await prisma.expedition.update({ where: { id: exp.id }, data: { status: "RETURNED", endedAt: new Date(), pending: Prisma.DbNull } });
  await prisma.player.update({
    where: { id: playerId },
    data: { state: "AT_SHELTER", health: clamp(health + 40, 0, player.maxHealth), stamina: 100, radiation: clamp(player.radiation - 10) },
  });

  const resSummary = Object.entries(resourceGain).map(([k, v]) => `+${Math.round(v)} ${k}`).join(", ");
  const flash = `Made it home${bitten ? ` (−${bitten} HP en route)` : ""}. Secured ${kept} item(s)${resSummary ? `, ${resSummary}` : ""}.`;
  revalidatePath("/");
  return loadSnapshot(playerId, flash);
}

// ── internal mutators ────────────────────────────────────────────────────────

async function applyDeath(playerId: string, expId: string, reason: string): Promise<GameSnapshot | null> {
  await prisma.itemStack.deleteMany({ where: { playerId, location: "BACKPACK" } });
  await prisma.expedition.update({ where: { id: expId }, data: { status: "DIED", endedAt: new Date(), pending: Prisma.DbNull } });
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  await prisma.player.update({
    where: { id: playerId },
    data: { state: "AT_SHELTER", health: player?.maxHealth ?? 100, stamina: 100, radiation: clamp((player?.radiation ?? 0) / 2) },
  });
  revalidatePath("/");
  return loadSnapshot(playerId, `☠️ ${reason} You lost everything you were carrying, but the shelter endures.`);
}

/** Add loot drops to the backpack, respecting carry capacity. Returns a summary. */
async function addLootToBackpack(playerId: string, drops: { defKey: string; quantity: number; durability: number | null }[]): Promise<string> {
  if (!drops.length) return "";
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  const equipped = (await prisma.itemStack.findMany({ where: { playerId, equippedSlot: { not: null } } })) as StackRow[];
  const bp = equipped.find((e) => e.equippedSlot === "BACKPACK");
  const carryCap = BASE_CARRY + (bp ? ITEM_DEFS[bp.defKey]?.carryBonus ?? 0 : 0);
  let used = (await prisma.itemStack.findMany({ where: { playerId, location: "BACKPACK" } })).reduce((n, s) => n + s.quantity, 0);
  if (!player) return "";

  const summary: string[] = [];
  for (const d of drops) {
    let qty = d.quantity;
    if (used + qty > carryCap) qty = Math.max(0, carryCap - used);
    if (qty <= 0) break;
    await addItem(playerId, d.defKey, qty, "BACKPACK", d.durability);
    used += qty;
    summary.push(`${qty}× ${ITEM_DEFS[d.defKey]?.name ?? d.defKey}`);
  }
  return summary.join(", ");
}

async function addItem(playerId: string, defKey: string, qty: number, location: "STORAGE" | "BACKPACK", durability: number | null = null): Promise<void> {
  const def = ITEM_DEFS[defKey];
  if (def?.stackable) {
    const existing = await prisma.itemStack.findFirst({ where: { playerId, defKey, location, equippedSlot: null } });
    if (existing) {
      await prisma.itemStack.update({ where: { id: existing.id }, data: { quantity: { increment: qty } } });
      return;
    }
  }
  await prisma.itemStack.create({
    data: { playerId, defKey, quantity: def?.stackable ? qty : 1, location, durability: durability ?? def?.maxDurability ?? null },
  });
  // non-stackables: create one row per unit
  if (!def?.stackable && qty > 1) {
    for (let i = 1; i < qty; i++) {
      await prisma.itemStack.create({ data: { playerId, defKey, quantity: 1, location, durability: durability ?? def?.maxDurability ?? null } });
    }
  }
}

async function consumeStack(item: StackRow, qty: number): Promise<void> {
  if (item.quantity > qty) await prisma.itemStack.update({ where: { id: item.id }, data: { quantity: { decrement: qty } } });
  else await prisma.itemStack.delete({ where: { id: item.id } });
}

async function consumeStorageItems(playerId: string, defKey: string, qty: number): Promise<void> {
  let remaining = qty;
  const rows = (await prisma.itemStack.findMany({ where: { playerId, defKey, location: "STORAGE" } })) as StackRow[];
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, r.quantity);
    await consumeStack(r, take);
    remaining -= take;
  }
}

async function spendAmmo(playerId: string): Promise<void> {
  const ammo = await prisma.itemStack.findFirst({ where: { playerId, defKey: "ammo", location: "BACKPACK" } });
  if (ammo) await consumeStack(ammo as StackRow, 1);
}
