"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { ITEM_DEFS, type ItemDef } from "@/data/items";
import { RECIPES, upgradeCost, stationLevelReq, type Station } from "@/data/recipes";
import {
  SURV,
  tickShelter,
  clamp,
  resolveFight,
  resolveFlee,
  RESOURCE_KEYS,
  type ResourceKey,
  type PlayerCombat,
} from "@/lib/game";
import { mulberry32, hashSeed, randInt, chance, weighted, pick } from "@/lib/rng";
import { tileAt, lootForTile, enemyForTile, wanderingEnemy, generateLoot, chebyshev, tierForDistance } from "@/lib/wasteland";
import { BIOMES, ENEMIES } from "@/data/world";
import { sightFor, ambientLine, enemyEntrance, hazardLine, searchNothing, survivorIntro } from "@/data/flavor";
import { factionAt, FACTIONS, FACTION_KEYS, RIVAL, repOf, standing, type FactionKey, type RepMap } from "@/data/factions";
import { CONDITIONS, rollCondition, type Condition } from "@/data/conditions";
import { ZONES, ZONES_BY_KEY, ZONE_INDEX, ZONE_TYPE_META, type ZoneDef } from "@/data/zones";

/** Resolve the bounded zone the expedition is currently exploring (null on the
 *  overview map). Each zone gets its own deterministic seed and fixed tier. */
function zoneCtx(exp: { seed: number; zoneKey: string | null }): { zone: ZoneDef; seed: number; tier: number; faction: FactionKey | null; size: number } | null {
  if (!exp.zoneKey) return null;
  const zone = ZONES_BY_KEY[exp.zoneKey];
  if (!zone) return null;
  return { zone, seed: hashSeed(exp.seed, ZONE_INDEX[zone.key] + 1), tier: zone.tier, faction: zone.faction, size: zone.size };
}
function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}
function zoneSurroundings(seed: number, tier: number, size: number, x: number, y: number): string {
  const dirs = [["north", 0, -1], ["east", 1, 0], ["south", 0, 1], ["west", -1, 0]] as const;
  const parts: string[] = [];
  for (const [name, dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(size, nx, ny)) continue;
    const t = tileAt(seed, nx, ny, tier);
    if (NOTABLE_FEATURES.has(t.feature)) parts.push(`${t.label} to the ${name}`);
  }
  return parts.join("; ");
}

/** Apply standing changes to a player's faction reputation map (clamped ±100). */
async function adjustRep(playerId: string, current: RepMap, changes: Partial<Record<FactionKey, number>>): Promise<void> {
  const next: RepMap = { ...current };
  for (const k of Object.keys(changes) as FactionKey[]) {
    next[k] = clamp((next[k] ?? 0) + (changes[k] ?? 0), -100, 100);
  }
  await prisma.player.update({ where: { id: playerId }, data: { factionRep: next as unknown as Prisma.InputJsonValue } });
}

const NOTABLE_FEATURES = new Set(["LOOT", "ENEMY", "HAZARD", "SURVIVOR"]);

const TRADER_POOL = ["pistol", "shotgun", "rifle", "vest", "helmet", "jacket", "knife", "bat", "rucksack", "medkit", "bandage", "radaway", "stim", "ammo"];
const WORK_FIELD = { food: "workFood", water: "workWater", scrap: "workScrap", meds: "workMeds" } as const;

function offerPrice(defKey: string): number {
  const d = ITEM_DEFS[defKey];
  if (!d) return 4;
  const base = d.category === "WEAPON" ? 8 : d.category === "ARMOR" ? 6 : 2;
  return Math.max(2, base + d.tier * 3);
}

function traderOffers(rng: () => number, tier: number, discount = 0): { defKey: string; name: string; icon: string; price: number }[] {
  const pool = TRADER_POOL.filter((k) => (ITEM_DEFS[k]?.tier ?? 9) <= tier + 1);
  const picks: string[] = [];
  const n = 2 + Math.floor(rng() * 2);
  let guard = 0;
  while (picks.length < n && guard++ < 40) {
    const k = pool[Math.floor(rng() * pool.length)];
    if (k && !picks.includes(k)) picks.push(k);
  }
  return picks.map((k) => ({ defKey: k, name: ITEM_DEFS[k].name, icon: ITEM_DEFS[k].icon, price: Math.max(1, Math.round(offerPrice(k) * (1 - discount))) }));
}

async function backpackQty(playerId: string, defKey: string): Promise<number> {
  const rows = await prisma.itemStack.findMany({ where: { playerId, defKey, location: "BACKPACK" } });
  return rows.reduce((n, r) => n + r.quantity, 0);
}

async function consumeBackpack(playerId: string, defKey: string, qty: number): Promise<boolean> {
  const rows = (await prisma.itemStack.findMany({ where: { playerId, defKey, location: "BACKPACK" } })) as StackRow[];
  if (rows.reduce((n, r) => n + r.quantity, 0) < qty) return false;
  let remaining = qty;
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, r.quantity);
    await consumeStack(r, take);
    remaining -= take;
  }
  return true;
}

/** Brief readout of notable things in the 4 adjacent tiles. */
function surroundings(seed: number, x: number, y: number): string {
  const dirs = [["north", 0, -1], ["east", 1, 0], ["south", 0, 1], ["west", -1, 0]] as const;
  const parts: string[] = [];
  for (const [name, dx, dy] of dirs) {
    const t = tileAt(seed, x + dx, y + dy);
    if (NOTABLE_FEATURES.has(t.feature)) parts.push(`${t.label} to the ${name}`);
  }
  return parts.join("; ");
}
import type {
  GameSnapshot,
  ItemView,
  ExpeditionView,
  OverviewView,
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

  // Advance the shelter economy (worker production − population consumption).
  const now = new Date();
  const shRow = player.shelter;
  const fresh = tickShelter(
    {
      food: shRow.food, water: shRow.water, meds: shRow.meds, scrap: shRow.scrap, fuel: shRow.fuel, morale: shRow.morale,
      population: shRow.population,
      workFood: shRow.workFood, workWater: shRow.workWater, workScrap: shRow.workScrap, workMeds: shRow.workMeds,
      lastTickAt: shRow.lastTickAt,
    },
    now
  );
  if (fresh.changed) {
    await prisma.shelter.update({
      where: { id: shRow.id },
      data: {
        food: Math.round(fresh.food), water: Math.round(fresh.water), meds: Math.round(fresh.meds),
        scrap: Math.round(fresh.scrap), fuel: Math.round(fresh.fuel), morale: Math.round(fresh.morale), lastTickAt: now,
      },
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

  const rep = (player.factionRep as RepMap) ?? {};
  const carryBonus = equipped.BACKPACK ? ITEM_DEFS[equipped.BACKPACK.defKey]?.carryBonus ?? 0 : 0;
  let expedition: ExpeditionView | null = null;
  let overview: OverviewView | null = null;

  if (player.state === "IN_EXPEDITION") {
    const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
    if (exp) {
      const condDef = CONDITIONS[(exp.condition as Condition) ?? "CLEAR"] ?? CONDITIONS.CLEAR;
      const ctx = zoneCtx(exp);

      if (!ctx) {
        // On the overview city map — choosing where to raid.
        overview = {
          conditionName: condDef.name,
          conditionIcon: condDef.icon,
          conditionNote: condDef.note,
          backpackCount: backpack.reduce((n, b) => n + b.quantity, 0),
          carryCap: BASE_CARRY + carryBonus,
          zones: ZONES.map((z) => ({
            key: z.key,
            name: z.name,
            type: z.type,
            x: z.x,
            y: z.y,
            tier: z.tier,
            icon: ZONE_TYPE_META[z.type].icon,
            color: ZONE_TYPE_META[z.type].color,
            faction: z.faction ? FACTIONS[z.faction].name : null,
            standing: z.faction ? standing(repOf(rep, z.faction)) : null,
          })),
        };
      } else {
        // Exploring a bounded zone grid.
        const { zone, seed: zSeed, tier, faction, size } = ctx;
        const visited = new Set((exp.visited as unknown as string[]) ?? []);
        const spotted = new Set((exp.spotted as unknown as string[]) ?? []);
        const scouted = new Set<string>();
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = exp.posX + dx, ny = exp.posY + dy;
          if (inBounds(size, nx, ny)) scouted.add(`${nx},${ny}`);
        }

        const tiles: TileView[] = [];
        for (let dy = -WINDOW_RADIUS; dy <= WINDOW_RADIUS; dy++) {
          for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx++) {
            const x = exp.posX + dx;
            const y = exp.posY + dy;
            if (!inBounds(size, x, y)) {
              tiles.push({ x, y, revealed: false, edge: true });
              continue;
            }
            const keyT = `${x},${y}`;
            const isPlayer = dx === 0 && dy === 0;
            const t = tileAt(zSeed, x, y, tier);
            if (visited.has(keyT) || isPlayer) {
              tiles.push({ x, y, revealed: true, visited: visited.has(keyT) && !isPlayer, icon: t.icon, label: t.label, feature: t.feature, color: BIOMES[t.biome].color, isPlayer });
            } else if (spotted.has(keyT)) {
              tiles.push({ x, y, revealed: true, spotted: true, icon: t.icon, label: t.label, feature: t.feature, color: BIOMES[t.biome].color });
            } else if (scouted.has(keyT)) {
              tiles.push({ x, y, revealed: false, scouted: true, color: BIOMES[t.biome].color });
            } else {
              tiles.push({ x, y, revealed: false });
            }
          }
        }

        const cur = tileAt(zSeed, exp.posX, exp.posY, tier);
        const hereKey = `${exp.posX},${exp.posY}`;
        const groundHere = ((exp.ground as unknown as Record<string, { defKey: string; quantity: number; durability: number | null }[]>) ?? {})[hereKey] ?? [];
        const groundView = groundHere.map((g, idx) => ({
          idx, defKey: g.defKey, name: ITEM_DEFS[g.defKey]?.name ?? g.defKey, icon: ITEM_DEFS[g.defKey]?.icon ?? "❔",
          quantity: g.quantity, durability: g.durability,
        }));
        const searchedHere = new Set((exp.searched as unknown as string[]) ?? []).has(hereKey);
        expedition = {
          id: exp.id,
          seed: zSeed,
          posX: exp.posX,
          posY: exp.posY,
          distance: 0,
          tier,
          tiles,
          windowRadius: WINDOW_RADIUS,
          zoneName: zone.name,
          zoneType: zone.type,
          gridSize: size,
          biomeColor: BIOMES[cur.biome].color,
          biomeName: BIOMES[cur.biome].name,
          condition: condDef.key,
          conditionName: condDef.name,
          conditionIcon: condDef.icon,
          conditionNote: condDef.note,
          territoryFaction: faction,
          territoryName: faction ? FACTIONS[faction].name : null,
          territoryStanding: faction ? standing(repOf(rep, faction)) : null,
          log: ((exp.log as unknown as string[]) ?? []).slice(0, 16),
          backpack: backpack.map(itemView),
          backpackUsed: backpack.reduce((n, b) => n + b.quantity, 0),
          carryCap: BASE_CARRY + carryBonus,
          ground: groundView,
          searchedHere,
          pending: (exp.pending as unknown as EncounterView | null) ?? null,
          currentLabel: cur.label,
          atExit: false,
        };
      }
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
      population: sh.population,
      popCap: sh.popCap,
      food: Math.round(fresh.food),
      water: Math.round(fresh.water),
      meds: Math.round(fresh.meds),
      ammo: sh.ammo,
      scrap: Math.round(fresh.scrap),
      fuel: Math.round(fresh.fuel),
      morale: Math.round(fresh.morale),
      storageCap: sh.storageCap,
      storedCount: storage.length + equippedRows.length,
      workshopLvl: sh.workshopLvl,
      medicalLvl: sh.medicalLvl,
      ammoBenchLvl: sh.ammoBenchLvl,
      weaponBenchLvl: sh.weaponBenchLvl,
      workFood: sh.workFood,
      workWater: sh.workWater,
      workScrap: sh.workScrap,
      workMeds: sh.workMeds,
    },
    storage: storage.map(itemView),
    equipped,
    craftables,
    factions: FACTION_KEYS.map((k) => {
      const rep = ((player.factionRep as RepMap) ?? {})[k] ?? 0;
      return { key: k, name: FACTIONS[k].name, icon: FACTIONS[k].icon, color: FACTIONS[k].color, note: FACTIONS[k].note, rep, standing: standing(rep) };
    }),
    overview,
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

export async function upgrade(playerId: string, target: Station | "storage" | "shelter" | "beds"): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  const sh = player.shelter;

  const nonStation = target === "storage" || target === "shelter" || target === "beds";
  const field = nonStation ? null : (`${target}Lvl` as const);
  const isStation = field !== null;
  const curLevel =
    target === "shelter" ? sh.level :
    target === "storage" ? Math.floor((sh.storageCap - 240) / 60) + 1 :
    target === "beds" ? Math.floor((sh.popCap - 3) / 2) + 1 :
    (sh as unknown as Record<string, number>)[field!] ?? 0;

  // Crafting stations are locked behind survivor rank — scavenge first, build later.
  if (isStation) {
    const req = stationLevelReq(curLevel + 1);
    if (player.level < req) return loadSnapshot(playerId, `Requires survivor level ${req} to build/upgrade this station.`);
  }

  const cost = upgradeCost(curLevel + 1);
  if (sh.scrap < cost.scrap || sh.fuel < cost.fuel) return loadSnapshot(playerId, `Need ${cost.scrap} scrap & ${cost.fuel} fuel.`);

  const data: Record<string, unknown> = { scrap: { decrement: cost.scrap }, fuel: { decrement: cost.fuel } };
  if (target === "storage") data.storageCap = { increment: 60 };
  else if (target === "beds") data.popCap = { increment: 2 };
  else if (target === "shelter") {
    data.level = { increment: 1 };
    data.morale = { increment: 5 };
  } else data[field!] = { increment: 1 };

  await prisma.shelter.update({ where: { id: sh.id }, data });
  revalidatePath("/");
  return loadSnapshot(playerId, "Upgrade complete.");
}

/** Assign or unassign a survivor to a resource job (+1 / -1). */
export async function assignWork(playerId: string, job: "food" | "water" | "scrap" | "meds", delta: number): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  const sh = player.shelter;
  const field = WORK_FIELD[job];
  const assigned = sh.workFood + sh.workWater + sh.workScrap + sh.workMeds;
  const cur = (sh as unknown as Record<string, number>)[field];
  if (delta > 0) {
    if (assigned >= sh.population) return loadSnapshot(playerId, "No idle survivors to assign.");
    await prisma.shelter.update({ where: { id: sh.id }, data: { [field]: cur + 1 } });
  } else {
    if (cur <= 0) return loadSnapshot(playerId);
    await prisma.shelter.update({ where: { id: sh.id }, data: { [field]: cur - 1 } });
  }
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Repair a piece of gear at the workshop, restoring durability for scrap. */
export async function repairItem(playerId: string, itemId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  if (player.shelter.workshopLvl < 1) return loadSnapshot(playerId, "Build a Workshop to repair gear.");
  const item = (await prisma.itemStack.findFirst({ where: { id: itemId, playerId } })) as StackRow | null;
  if (!item) return loadSnapshot(playerId);
  const def = ITEM_DEFS[item.defKey];
  if (!def?.maxDurability || item.durability == null) return loadSnapshot(playerId, "Nothing to repair.");
  if (item.durability >= def.maxDurability) return loadSnapshot(playerId, "Already in good condition.");
  const cost = Math.max(1, Math.ceil((def.maxDurability - item.durability) / 12));
  if (player.shelter.scrap < cost) return loadSnapshot(playerId, `Need ${cost} scrap to repair.`);
  await prisma.shelter.update({ where: { id: player.shelter.id }, data: { scrap: { decrement: cost } } });
  await prisma.itemStack.update({ where: { id: itemId }, data: { durability: def.maxDurability } });
  revalidatePath("/");
  return loadSnapshot(playerId, `Repaired ${def.name} for ${cost} scrap.`);
}

// ── expedition ──────────────────────────────────────────────────────────────────

export async function startExpedition(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "AT_SHELTER") return loadSnapshot(playerId);
  const seed = newSeed();
  const condition = rollCondition(mulberry32(hashSeed(seed, 31)));
  const intro = condition === "CLEAR" ? "You head out into the city. Choose a zone to raid." : `You head out — ${CONDITIONS[condition].name}. ${CONDITIONS[condition].note}`;
  await prisma.expedition.create({
    data: { playerId, seed, condition, zoneKey: null, visited: [], log: [intro], posX: 0, posY: 0, distance: 0 },
  });
  await prisma.player.update({ where: { id: playerId }, data: { state: "IN_EXPEDITION", stamina: 100 } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Travel from the overview map into a zone and begin exploring its grid. */
export async function enterZone(playerId: string, zoneKey: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp || exp.zoneKey) return loadSnapshot(playerId);
  const zone = ZONES_BY_KEY[zoneKey];
  if (!zone || zone.type === "SAFE" || zone.size <= 0) return loadSnapshot(playerId);

  // Enter at the south edge, centred. Each zone is a fresh local map.
  const ex = Math.floor(zone.size / 2);
  const ey = zone.size - 1;
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  log.unshift(`You slip into ${zone.name} — Tier ${zone.tier}${zone.faction ? `, ${FACTIONS[zone.faction].name} turf` : ""}.`);
  await prisma.expedition.update({
    where: { id: exp.id },
    data: { zoneKey, posX: ex, posY: ey, visited: [`${ex},${ey}`], spotted: [], cleared: [], searched: [], ground: {}, pending: Prisma.DbNull, log },
  });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Pull back out of a zone to the overview city map. */
export async function leaveZone(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp || !exp.zoneKey || exp.pending) return loadSnapshot(playerId, exp?.pending ? "Deal with the threat first." : "");
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  log.unshift("You fall back to the city map.");
  await prisma.expedition.update({ where: { id: exp.id }, data: { zoneKey: null, log } });
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
  if (player.stamina <= 0) return loadSnapshot(playerId, "Too exhausted — rest, or leave the zone.");
  const ctx = zoneCtx(exp);
  if (!ctx) return loadSnapshot(playerId, "Pick a zone to explore.");
  const { tier, faction, size, seed: zSeed } = ctx;

  const [dx, dy] = DIRS[dir];
  const x = exp.posX + dx;
  const y = exp.posY + dy;
  if (!inBounds(size, x, y)) return loadSnapshot(playerId, "The edge of the district — only rubble beyond.");
  const key = `${x},${y}`;
  const visited = new Set((exp.visited as unknown as string[]) ?? []);
  const cleared = new Set((exp.cleared as unknown as string[]) ?? []);
  const firstVisit = !visited.has(key);
  visited.add(key);
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  const narr = mulberry32(hashSeed(zSeed, x, y, 555));

  let health = player.health;
  let radiation = player.radiation;
  const stamina = clamp(player.stamina - SURV.moveStaminaCost + SURV.staminaRegenOnTile, 0, 100);
  let pending: EncounterView | null = null;
  const entry: string[] = []; // chronological lines for this step

  const tile = tileAt(zSeed, x, y, tier);
  const cond = (exp.condition as Condition) ?? "CLEAR";
  const rep = (player.factionRep as RepMap) ?? {};
  const factionTag = faction ? ` (${FACTIONS[faction].name})` : "";

  entry.push(`You move ${DIR_NAME[dir]}. ${sightFor(narr, tile.biome)}`);
  if (chance(narr, 0.22)) entry.push(ambientLine(narr));
  if (firstVisit && tile.feature === "ENEMY") {
    const e = enemyForTile(tile)!;
    if (faction && repOf(rep, faction) >= 40 && chance(narr, 0.6)) {
      entry.push(`${FACTIONS[faction].icon} ${FACTIONS[faction].name} fighters recognise you and wave you through.`);
    } else {
      const elite = tier >= 4 && chance(narr, 0.25);
      const power = Math.round(e.power * (elite ? 1.6 : 1));
      const name = elite ? `Elite ${e.name}` : e.name;
      pending = { kind: "enemy", enemyKey: e.key, name, icon: elite ? "☠️" : e.icon, power, hp: power, maxHp: power, faction: faction ?? null, elite };
      entry.push(`${pending.icon} ${enemyEntrance(narr, name)}${factionTag}`);
    }
  } else if (tile.feature === "SURVIVOR" && !cleared.has(key)) {
    const name = tile.survivorName ?? "a stranger";
    const npcRng = mulberry32(hashSeed(zSeed, x, y, 909));
    const traderW = cond === "CARAVAN" ? 6 : 3;
    const sub = weighted(npcRng, [["recruit", 5], ["trader", traderW], ["injured", 2]]);
    if (sub === "injured") {
      const needDef = pick(npcRng, ["bandage", "medkit"]);
      const need = ITEM_DEFS[needDef].name;
      if (firstVisit) {
        pending = { kind: "injured", name, icon: "🩸", needDef, needName: need };
        entry.push(`🩸 ${name} lies wounded, begging for a ${need}.`);
      } else if (Math.random() < 0.35) {
        cleared.add(key);
        entry.push(`🩸 You return to find ${name} has bled out. You were too slow.`);
      } else {
        pending = { kind: "injured", name, icon: "🩸", needDef, needName: need };
        entry.push(`🩸 ${name} still clings to life, waiting for that ${need}.`);
      }
    } else if (sub === "trader") {
      const discount = clamp(repOf(rep, faction), 0, 100) / 200;
      pending = { kind: "trader", name, icon: "🧑‍🔧", offers: traderOffers(npcRng, tier, discount) };
      entry.push(`🧑‍🔧 ${name}, a trader, waves you over. "Got goods — if you've got scrap."`);
    } else {
      pending = { kind: "survivor", name, icon: "🧑" };
      entry.push(`🧑 ${survivorIntro(narr, name)}`);
    }
  } else if (tile.feature === "LOOT" || tile.feature === "CACHE") {
    const searched = new Set((exp.searched as unknown as string[]) ?? []);
    entry.push(searched.has(key) ? `${tile.icon} ${tile.label}. You've already picked through it.` : `${tile.icon} You reach ${tile.label}. Looks worth searching.`);
  } else if (firstVisit && tile.feature === "HAZARD") {
    const stormMult = cond === "RAD_STORM" ? 1.6 : 1;
    const dose = Math.round(randInt(narr, SURV.radPerHazard[0], SURV.radPerHazard[1]) * (tile.hazard === "RADIATION" ? 1 : 0.6) * stormMult);
    radiation = clamp(radiation + dose);
    entry.push(`${tile.icon} ${hazardLine(narr, tile.hazard!)} (+${dose} rad)`);
  } else if (!firstVisit) {
    entry.push("Your own tracks cross this ground. Nothing new stirs.");
  }

  if (!pending && firstVisit) {
    const hostileTerritory = faction != null && repOf(rep, faction) <= -40;
    const ambushChance = (cond === "RAIDER_ACTIVITY" ? 0.18 : 0) + (hostileTerritory ? 0.15 : 0);
    if (ambushChance > 0 && chance(narr, ambushChance)) {
      const e = wanderingEnemy(narr, tier);
      pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power, faction: faction ?? null };
      entry.push(`${e.icon} Ambush! ${enemyEntrance(narr, e.name)}${factionTag}`);
    }
  }

  if (cond === "RAD_STORM" && firstVisit) radiation = clamp(radiation + 2);

  if (!pending) {
    const near = zoneSurroundings(zSeed, tier, size, x, y);
    if (near) entry.push(`Nearby: ${near}.`);
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
    data: { posX: x, posY: y, visited: [...visited], cleared: [...cleared], log, pending: pending ? (pending as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
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
  const ctx = zoneCtx(exp);
  if (!ctx) return loadSnapshot(playerId, "Pick a zone to explore.");
  const { tier, size, seed: zSeed } = ctx;

  const tile = tileAt(zSeed, exp.posX, exp.posY, tier);
  const cond = (exp.condition as Condition) ?? "CLEAR";
  const key = `${exp.posX},${exp.posY}`;
  const salt = kind === "search" ? 222 : kind === "rest" ? 333 : 111;
  const narr = mulberry32(hashSeed(zSeed, exp.posX, exp.posY, salt, Math.floor(Math.random() * 1e9)));
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  let stamina = player.stamina;
  let pending: EncounterView | null = null;

  if (kind === "look") {
    // Inspect only the squares immediately around you (one step in any of the
    // eight directions). Their contents are revealed and pinned to the map;
    // the current tile's scavenge potential is assessed.
    log.unshift(`${tile.icon} ${tile.label}. ${sightFor(narr, tile.biome)}`);

    const spotted = new Set((exp.spotted as unknown as string[]) ?? []);
    const dirs8 = [
      ["north", 0, -1], ["north-east", 1, -1], ["east", 1, 0], ["south-east", 1, 1],
      ["south", 0, 1], ["south-west", -1, 1], ["west", -1, 0], ["north-west", -1, -1],
    ] as const;
    const sightings: string[] = [];
    for (const [name, dx, dy] of dirs8) {
      const nx = exp.posX + dx, ny = exp.posY + dy;
      if (!inBounds(size, nx, ny)) continue;
      spotted.add(`${nx},${ny}`);
      const nt = tileAt(zSeed, nx, ny, tier);
      if (NOTABLE_FEATURES.has(nt.feature)) sightings.push(`${name}: ${nt.label}`);
    }
    log.unshift(sightings.length ? `You scan your surroundings — ${sightings.join("; ")}.` : "Nothing notable in the squares around you.");

    const worth = tile.feature === "LOOT" || tile.feature === "CACHE" || tile.biome === "URBAN" || tile.biome === "INDUSTRIAL";
    log.unshift(worth ? "This place looks worth searching." : "Not much here worth digging through.");

    await prisma.expedition.update({ where: { id: exp.id }, data: { spotted: [...spotted] } });
  } else if (kind === "rest") {
    stamina = clamp(stamina + 30);
    log.unshift("You find cover, slow your breathing, and recover. (+stamina)");
    if (chance(narr, 0.15 + tier * 0.05)) {
      const e = wanderingEnemy(narr, tier);
      pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power };
      log.unshift(`${e.icon} Your rest is cut short — ${enemyEntrance(narr, e.name)}`);
    }
  } else {
    // search — reveal this tile's loot onto the ground (once), or spring a trap.
    stamina = clamp(stamina - 5);
    const searched = new Set((exp.searched as unknown as string[]) ?? []);
    const ground = ((exp.ground as unknown as Record<string, GroundEntry[]>) ?? {}) as Record<string, GroundEntry[]>;
    const roll = narr();
    if (roll < 0.18 + tier * 0.03) {
      const e = wanderingEnemy(narr, tier);
      pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power };
      log.unshift(`${e.icon} You disturbed something — ${enemyEntrance(narr, e.name)}`);
    } else if (searched.has(key)) {
      log.unshift("You've already picked this spot clean.");
    } else {
      const lootTier = cond === "BOUNTIFUL" ? tier + 1 : tier;
      let drops = lootForTile(zSeed, { ...tile, tier: lootTier });
      if (drops.length === 0) {
        drops = generateLoot(narr, [["scrap", 4], ["cloth", 3], ["ration", 3], ["water_bottle", 3], ["ammo", 2]], lootTier, [1, 2]);
      }
      searched.add(key);
      const added = addToGround(ground, key, drops);
      log.unshift(added ? `You search and turn up ${added}. (left on the ground — take what you want)` : searchNothing(narr));
      await prisma.expedition.update({ where: { id: exp.id }, data: { searched: [...searched], ground: ground as unknown as Prisma.InputJsonValue } });
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
  if (!exp || !pending || pending.kind !== "enemy") return loadSnapshot(playerId);

  const items = (await prisma.itemStack.findMany({ where: { playerId } })) as StackRow[];
  const equipped = items.filter((i) => i.equippedSlot);
  const backpack = items.filter((i) => i.location === "BACKPACK");
  const combat = playerCombat(equipped, backpack);
  const rng = mulberry32(hashSeed(exp.seed, exp.posX, exp.posY, player.health, Math.floor(Math.random() * 1e9)));
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 12);
  const key = `${exp.posX},${exp.posY}`;
  const ground = ((exp.ground as unknown as Record<string, GroundEntry[]>) ?? {}) as Record<string, GroundEntry[]>;

  let health = player.health;
  let stamina = player.stamina;
  let xp = player.xp;
  let level = player.level;
  let newPending: EncounterView | null = pending;

  if (choice === "flee") {
    // Read fleeability from the enemy definition — the current tile may not be
    // an ENEMY tile (ambushes, wandering threats), so don't derive it from the tile.
    const fleeable = ENEMIES[pending.enemyKey]?.fleeable ?? 0.5;
    const res = resolveFlee(rng, fleeable, stamina, pending.power * 0.5, combat.armor);
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
      const reward = (SURV.xpPerKill + pending.power / 4) * (pending.elite ? 1.8 : 1);
      xp += Math.round(reward);
      // The body's loot drops onto the ground for you to take.
      const ec = zoneCtx(exp);
      const tier = ec?.tier ?? 1;
      const eSeed = ec?.seed ?? exp.seed;
      const drops = lootForTile(eSeed, { ...tileAt(eSeed, exp.posX, exp.posY, tier), feature: "CACHE" });
      const added = addToGround(ground, key, drops.slice(0, (1 + Math.floor(tier / 2)) * (pending.elite ? 2 : 1)));
      log.unshift(`🎖️ Defeated the ${pending.name}. +${Math.round(reward)} XP${added ? `. They dropped ${added} — on the ground` : ""}.`);
      // Killing a faction's fighters sours your standing with them (and warms a rival).
      const f = pending.faction as FactionKey | null | undefined;
      if (f) {
        await adjustRep(playerId, (player.factionRep as RepMap) ?? {}, { [f]: -4, [RIVAL[f]]: 2 });
        log.unshift(`${FACTIONS[f].icon} Your standing with ${FACTIONS[f].name} has fallen.`);
      }
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

  await prisma.expedition.update({ where: { id: exp.id }, data: { log, ground: ground as unknown as Prisma.InputJsonValue, pending: newPending ? (newPending as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
  await prisma.player.update({ where: { id: playerId }, data: { health, stamina, xp, level, maxHealth: 100 + (level - 1) * 10 } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Respond to a survivor encounter: invite them to the shelter, or move on. */
export async function recruitSurvivor(playerId: string, accept: boolean): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  const pending = exp?.pending as unknown as EncounterView | null;
  if (!exp || !pending || pending.kind !== "survivor") return loadSnapshot(playerId);

  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 22);
  if (!accept) {
    log.unshift(`You wish ${pending.name} luck and move on.`);
  } else if (player.shelter.population >= player.shelter.popCap) {
    log.unshift(`${pending.name} would join you, but the shelter is full (${player.shelter.population}/${player.shelter.popCap}). Build more beds.`);
  } else {
    await prisma.shelter.update({ where: { id: player.shelter.id }, data: { population: { increment: 1 }, morale: { increment: 3 } } });
    const f = factionAt(exp.seed, exp.posX, exp.posY);
    const changes: Partial<Record<FactionKey, number>> = { COLLECTIVE: 5 };
    if (f && f !== "COLLECTIVE") changes[f] = 3;
    await adjustRep(playerId, (player.factionRep as RepMap) ?? {}, changes);
    log.unshift(`🤝 ${pending.name} will make their way to your shelter. Population +1.`);
  }
  const cleared = new Set((exp.cleared as unknown as string[]) ?? []);
  cleared.add(`${exp.posX},${exp.posY}`); // they're gone either way
  await prisma.expedition.update({ where: { id: exp.id }, data: { log, cleared: [...cleared], pending: Prisma.DbNull } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export type TradeOp = { type: "buy"; index: number } | { type: "sell"; itemId: string } | { type: "leave" };

/** Barter with a trader using the scrap you're carrying. */
export async function trade(playerId: string, op: TradeOp): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  const pending = exp?.pending as unknown as EncounterView | null;
  if (!exp || !pending || pending.kind !== "trader") return loadSnapshot(playerId);
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 22);

  if (op.type === "leave") {
    log.unshift(`You part ways with ${pending.name}.`);
    await prisma.expedition.update({ where: { id: exp.id }, data: { log, pending: Prisma.DbNull } });
  } else if (op.type === "buy") {
    const offer = pending.offers[op.index];
    if (!offer) return loadSnapshot(playerId);
    if ((await backpackQty(playerId, "scrap")) < offer.price) return loadSnapshot(playerId, `Not enough scrap (need ${offer.price}).`);
    await consumeBackpack(playerId, "scrap", offer.price);
    await addItem(playerId, offer.defKey, 1, "BACKPACK");
    const offers = pending.offers.filter((_, i) => i !== op.index);
    log.unshift(`Bought ${offer.name} for ${offer.price} scrap.`);
    await prisma.expedition.update({ where: { id: exp.id }, data: { log, pending: { ...pending, offers } as unknown as Prisma.InputJsonValue } });
  } else {
    const item = (await prisma.itemStack.findUnique({ where: { id: op.itemId } })) as StackRow | null;
    if (!item || item.location !== "BACKPACK" || item.defKey === "scrap") return loadSnapshot(playerId, "Can't sell that.");
    const price = Math.max(1, Math.round(offerPrice(item.defKey) / 2));
    await consumeStack(item, 1);
    await addItem(playerId, "scrap", price, "BACKPACK");
    log.unshift(`Sold ${ITEM_DEFS[item.defKey]?.name ?? item.defKey} for ${price} scrap.`);
    await prisma.expedition.update({ where: { id: exp.id }, data: { log } });
  }
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Help (or abandon) an injured survivor. Helping costs a consumable, grants
 *  reputation, and may earn a recruit. */
export async function helpInjured(playerId: string, accept: boolean): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  const pending = exp?.pending as unknown as EncounterView | null;
  if (!exp || !pending || pending.kind !== "injured") return loadSnapshot(playerId);
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 22);

  if (!accept) {
    log.unshift(`You leave ${pending.name} to their fate.`);
    await prisma.expedition.update({ where: { id: exp.id }, data: { log, pending: Prisma.DbNull } });
    revalidatePath("/");
    return loadSnapshot(playerId);
  }
  if (!(await consumeBackpack(playerId, pending.needDef, 1))) {
    return loadSnapshot(playerId, `You have no ${pending.needName} to give.`);
  }
  const joins = Math.random() < 0.5 && player.shelter.population < player.shelter.popCap;
  await prisma.player.update({ where: { id: playerId }, data: { reputation: { increment: 5 } } });
  if (joins) await prisma.shelter.update({ where: { id: player.shelter.id }, data: { population: { increment: 1 }, morale: { increment: 3 } } });
  const hf = factionAt(exp.seed, exp.posX, exp.posY);
  const hChanges: Partial<Record<FactionKey, number>> = { COLLECTIVE: 5 };
  if (hf && hf !== "COLLECTIVE") hChanges[hf] = 3;
  await adjustRep(playerId, (player.factionRep as RepMap) ?? {}, hChanges);
  log.unshift(`🩹 You patch up ${pending.name}. (+5 reputation)${joins ? ` Grateful, ${pending.name} will head to your shelter.` : ""}`);
  const cleared = new Set((exp.cleared as unknown as string[]) ?? []);
  cleared.add(`${exp.posX},${exp.posY}`);
  await prisma.expedition.update({ where: { id: exp.id }, data: { log, cleared: [...cleared], pending: Prisma.DbNull } });
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

/** Pick up a single ground stack on the current tile (respects carry cap). */
export async function takeGroundItem(playerId: string, idx: number): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  if (exp.pending) return loadSnapshot(playerId, "Not while something's in your face.");

  const key = `${exp.posX},${exp.posY}`;
  const ground = ((exp.ground as unknown as Record<string, GroundEntry[]>) ?? {}) as Record<string, GroundEntry[]>;
  const list = ground[key] ?? [];
  const entry = list[idx];
  if (!entry) return loadSnapshot(playerId);

  const remaining = await carryRemaining(playerId);
  if (remaining <= 0) return loadSnapshot(playerId, "Your pack is full — drop something first.");
  const def = ITEM_DEFS[entry.defKey];
  const take = def?.stackable ? Math.min(entry.quantity, remaining) : 1;
  await addItem(playerId, entry.defKey, take, "BACKPACK", entry.durability);
  if (def?.stackable && entry.quantity > take) entry.quantity -= take;
  else list.splice(idx, 1);
  if (list.length === 0) delete ground[key]; else ground[key] = list;

  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 22);
  log.unshift(`Picked up ${take}× ${def?.name ?? entry.defKey}.`);
  await prisma.expedition.update({ where: { id: exp.id }, data: { ground: ground as unknown as Prisma.InputJsonValue, log } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Pick up everything on the current tile that fits in your pack. */
export async function takeAllGround(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  if (exp.pending) return loadSnapshot(playerId, "Not while something's in your face.");

  const key = `${exp.posX},${exp.posY}`;
  const ground = ((exp.ground as unknown as Record<string, GroundEntry[]>) ?? {}) as Record<string, GroundEntry[]>;
  let list = ground[key] ?? [];
  let remaining = await carryRemaining(playerId);
  let took = 0;
  const kept: GroundEntry[] = [];
  for (const entry of list) {
    const def = ITEM_DEFS[entry.defKey];
    if (remaining <= 0) { kept.push(entry); continue; }
    const take = def?.stackable ? Math.min(entry.quantity, remaining) : 1;
    await addItem(playerId, entry.defKey, take, "BACKPACK", entry.durability);
    remaining -= take;
    took += take;
    if (def?.stackable && entry.quantity > take) kept.push({ ...entry, quantity: entry.quantity - take });
  }
  if (kept.length === 0) delete ground[key]; else ground[key] = kept;
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 22);
  log.unshift(took ? `Grabbed ${took} item(s) off the ground.${kept.length ? " Pack full — left the rest." : ""}` : "Your pack is full.");
  await prisma.expedition.update({ where: { id: exp.id }, data: { ground: ground as unknown as Prisma.InputJsonValue, log } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Drop a backpack stack onto the current tile's ground. */
export async function dropItem(playerId: string, itemId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  const item = (await prisma.itemStack.findFirst({ where: { id: itemId, playerId, location: "BACKPACK" } })) as StackRow | null;
  if (!item) return loadSnapshot(playerId);

  const key = `${exp.posX},${exp.posY}`;
  const ground = ((exp.ground as unknown as Record<string, GroundEntry[]>) ?? {}) as Record<string, GroundEntry[]>;
  addToGround(ground, key, [{ defKey: item.defKey, quantity: item.quantity, durability: item.durability }]);
  await prisma.itemStack.delete({ where: { id: item.id } });
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 22);
  log.unshift(`Dropped ${item.quantity}× ${ITEM_DEFS[item.defKey]?.name ?? item.defKey}.`);
  await prisma.expedition.update({ where: { id: exp.id }, data: { ground: ground as unknown as Prisma.InputJsonValue, log } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

export async function returnHome(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { shelter: true } });
  if (!player?.shelter || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  if (exp.zoneKey) return loadSnapshot(playerId, "Leave the zone before heading home.");

  // Banking from the overview map is safe — the risk is inside the zones.
  const rng = mulberry32(hashSeed(exp.seed, 777, Math.floor(Math.random() * 1e9)));
  const health = player.health;
  const bitten = 0;

  // Secure the haul.
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
  let flash = `Made it home${bitten ? ` (−${bitten} HP en route)` : ""}. Secured ${kept} item(s)${resSummary ? `, ${resSummary}` : ""}.`;

  // "While you were away" — the world kept turning at the shelter.
  const roll = Math.random();
  if (roll < 0.16) {
    const loss = randInt(rng, 4, 14);
    await prisma.shelter.update({ where: { id: player.shelter.id }, data: { scrap: { decrement: loss }, morale: { decrement: 5 } } });
    flash += ` ⚠ Raiders probed the shelter while you were out — lost ${loss} scrap.`;
  } else if (roll < 0.28 && player.shelter.population < player.shelter.popCap) {
    await prisma.shelter.update({ where: { id: player.shelter.id }, data: { population: { increment: 1 } } });
    flash += ` 🚪 A wanderer found your shelter and stayed. Population +1.`;
  } else if (roll < 0.36) {
    await prisma.shelter.update({ where: { id: player.shelter.id }, data: { food: { increment: 8 }, water: { increment: 8 } } });
    flash += ` 🌧 Good fortune: rain barrels filled and a garden bore fruit (+food/water).`;
  }

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
type GroundEntry = { defKey: string; quantity: number; durability: number | null };

/** Drop loot onto a tile's ground pile (stackables merge). Returns a summary. */
function addToGround(ground: Record<string, GroundEntry[]>, key: string, drops: GroundEntry[]): string {
  if (!drops.length) return "";
  const list = ground[key] ?? (ground[key] = []);
  const parts: string[] = [];
  for (const d of drops) {
    const def = ITEM_DEFS[d.defKey];
    if (def?.stackable) {
      const ex = list.find((g) => g.defKey === d.defKey);
      if (ex) ex.quantity += d.quantity;
      else list.push({ defKey: d.defKey, quantity: d.quantity, durability: null });
    } else {
      list.push({ defKey: d.defKey, quantity: 1, durability: d.durability ?? def?.maxDurability ?? null });
    }
    parts.push(`${d.quantity}× ${def?.name ?? d.defKey}`);
  }
  return parts.join(", ");
}

/** Remaining backpack capacity (cap − items carried). */
async function carryRemaining(playerId: string): Promise<number> {
  const equipped = (await prisma.itemStack.findMany({ where: { playerId, equippedSlot: { not: null } } })) as StackRow[];
  const bp = equipped.find((e) => e.equippedSlot === "BACKPACK");
  const cap = BASE_CARRY + (bp ? ITEM_DEFS[bp.defKey]?.carryBonus ?? 0 : 0);
  const used = (await prisma.itemStack.findMany({ where: { playerId, location: "BACKPACK" } })).reduce((n, s) => n + s.quantity, 0);
  return cap - used;
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
