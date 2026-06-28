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
import { lootForTile, enemyForTile, wanderingEnemy, generateLoot, type Tile } from "@/lib/wasteland";
import { BIOMES, ENEMIES } from "@/data/world";
import { sightFor, ambientLine, enemyEntrance, hazardLine, searchNothing, survivorIntro } from "@/data/flavor";
import { factionAt, FACTIONS, FACTION_KEYS, RIVAL, standing, type FactionKey, type RepMap } from "@/data/factions";
import { CONDITIONS, rollCondition, type Condition } from "@/data/conditions";
import {
  CITY_DIM, BUILDINGS, BUILDINGS_BY_ID, SHELTER_DOOR,
  cityTerrain, passable, cityTierAt, cityFeature, interiorTile, interiorSeed, type Building,
} from "@/lib/city";

/** The space the expedition currently occupies: out on the city streets
 *  (zoneKey null) or inside a building's interior room (zoneKey = building id). */
type Space = {
  mode: "CITY" | "INTERIOR";
  venture: number; // expedition seed — re-rolls enemies/loot each venture
  building: Building | null;
  size: number; // bound: CITY_DIM, or the building's interior size
  lootSeed: number; // seed for lootForTile lookups
};

function spaceOf(exp: { seed: number; zoneKey: string | null }): Space {
  if (exp.zoneKey) {
    const b = BUILDINGS_BY_ID[exp.zoneKey];
    if (b) return { mode: "INTERIOR", venture: exp.seed, building: b, size: b.size, lootSeed: interiorSeed(b, exp.seed) };
  }
  return { mode: "CITY", venture: exp.seed, building: null, size: CITY_DIM, lootSeed: hashSeed(exp.seed, 4242) };
}
function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}
/** The (dynamic) tile contents at a position in the current space. */
function spaceTile(sp: Space, x: number, y: number): Tile {
  return sp.mode === "CITY" ? cityFeature(sp.venture, x, y) : interiorTile(sp.building!, sp.venture, x, y);
}
function spaceTier(sp: Space, x: number, y: number): number {
  return sp.mode === "CITY" ? cityTierAt(x, y) : sp.building!.tier;
}
/** Tile-state key, namespaced per space so street and interior state coexist. */
function tkey(zoneKey: string | null, x: number, y: number): string {
  return zoneKey ? `${zoneKey}:${x},${y}` : `${x},${y}`;
}
/** Whether a neighbour tile can be stood on (interiors are open within bounds). */
function spacePassable(sp: Space, x: number, y: number): boolean {
  if (!inBounds(sp.size, x, y)) return false;
  return sp.mode === "CITY" ? passable(x, y) : true;
}
/** Brief readout of notable things in the four adjacent tiles. */
function nearbyNotables(sp: Space, x: number, y: number): string {
  const dirs = [["north", 0, -1], ["east", 1, 0], ["south", 0, 1], ["west", -1, 0]] as const;
  const parts: string[] = [];
  for (const [name, dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(sp.size, nx, ny)) continue;
    if (sp.mode === "CITY") {
      const ter = cityTerrain(nx, ny);
      if (ter.kind === "DOOR" && ter.building) { parts.push(`${ter.building.name} entrance to the ${name}`); continue; }
      if (ter.kind === "SHELTER") { parts.push(`your shelter to the ${name}`); continue; }
      if (!passable(nx, ny)) continue;
    }
    const t = spaceTile(sp, nx, ny);
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

  const carryBonus = equipped.BACKPACK ? ITEM_DEFS[equipped.BACKPACK.defKey]?.carryBonus ?? 0 : 0;
  let expedition: ExpeditionView | null = null;

  if (player.state === "IN_EXPEDITION") {
    const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
    if (exp) {
      const condDef = CONDITIONS[(exp.condition as Condition) ?? "CLEAR"] ?? CONDITIONS.CLEAR;
      const sp = spaceOf(exp);
      const visited = new Set((exp.visited as unknown as string[]) ?? []);
      const spotted = new Set((exp.spotted as unknown as string[]) ?? []);
      const cleared = new Set((exp.cleared as unknown as string[]) ?? []);
      const searched = new Set((exp.searched as unknown as string[]) ?? []);
      const SIGHT = 2;
      const exitX = Math.floor(sp.size / 2), exitY = sp.size - 1;

      const tiles: TileView[] = [];
      for (let dy = -WINDOW_RADIUS; dy <= WINDOW_RADIUS; dy++) {
        for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx++) {
          const x = exp.posX + dx, y = exp.posY + dy;
          const isPlayer = dx === 0 && dy === 0;
          const key = tkey(exp.zoneKey, x, y);

          if (sp.mode === "CITY") {
            const ter = cityTerrain(x, y);
            if (ter.kind === "EDGE") { tiles.push({ x, y, revealed: false, edge: true }); continue; }
            if (ter.kind === "BUILDING") { tiles.push({ x, y, revealed: true, kind: "BUILDING", label: "Building", color: "#2c2722", isPlayer }); continue; }
            if (ter.kind === "DOOR" && ter.building) { tiles.push({ x, y, revealed: true, kind: "DOOR", icon: ter.building.icon, label: ter.building.name, buildingName: ter.building.name, feature: "DOOR", color: "#3a342c", isPlayer }); continue; }
            if (ter.kind === "SHELTER") { tiles.push({ x, y, revealed: true, kind: "SHELTER", icon: "🏠", label: "Your Shelter", feature: "SHELTER", color: "#2f3a2a", isPlayer }); continue; }
            // walkable street / lot
            const open = ter.kind === "LOT";
            const inSight = Math.max(Math.abs(dx), Math.abs(dy)) <= SIGHT || isPlayer || visited.has(key);
            let icon = open ? "▢" : "·", label = open ? "Empty Lot" : "Street", feature = "EMPTY";
            if (inSight) {
              const f = cityFeature(sp.venture, x, y);
              if (f.feature === "ENEMY" && !cleared.has(key)) { icon = f.icon; label = f.label; feature = "ENEMY"; }
              else if (f.feature === "LOOT" && !searched.has(key)) { icon = f.icon; label = f.label; feature = "LOOT"; }
            }
            tiles.push({ x, y, revealed: true, visited: visited.has(key) && !isPlayer, kind: ter.kind, icon, label, feature, color: open ? "#46402f" : "#3b362f", isPlayer });
            continue;
          }

          // interior
          if (!inBounds(sp.size, x, y)) { tiles.push({ x, y, revealed: false, edge: true }); continue; }
          const isExit = x === exitX && y === exitY;
          const t = spaceTile(sp, x, y);
          const icon = isExit ? "🚪" : t.icon;
          const label = isExit ? "Exit to street" : t.label;
          const scouted = Math.abs(dx) + Math.abs(dy) === 1;
          if (visited.has(key) || isPlayer) {
            tiles.push({ x, y, revealed: true, visited: visited.has(key) && !isPlayer, icon, label, feature: isExit ? "EXIT" : t.feature, color: BIOMES[t.biome].color, isPlayer, isExit });
          } else if (spotted.has(key)) {
            tiles.push({ x, y, revealed: true, spotted: true, icon, label, feature: isExit ? "EXIT" : t.feature, color: BIOMES[t.biome].color, isExit });
          } else if (scouted) {
            tiles.push({ x, y, revealed: false, scouted: true, color: BIOMES[t.biome].color, isExit });
          } else {
            tiles.push({ x, y, revealed: false });
          }
        }
      }

      const hereKey = tkey(exp.zoneKey, exp.posX, exp.posY);
      const groundHere = ((exp.ground as unknown as Record<string, { defKey: string; quantity: number; durability: number | null }[]>) ?? {})[hereKey] ?? [];
      const groundView = groundHere.map((g, idx) => ({
        idx, defKey: g.defKey, name: ITEM_DEFS[g.defKey]?.name ?? g.defKey, icon: ITEM_DEFS[g.defKey]?.icon ?? "❔",
        quantity: g.quantity, durability: g.durability,
      }));

      const cur = spaceTile(sp, exp.posX, exp.posY);
      const tier = spaceTier(sp, exp.posX, exp.posY);
      const ter = sp.mode === "CITY" ? cityTerrain(exp.posX, exp.posY) : null;
      const onDoor = ter?.kind === "DOOR" && ter.building ? { id: ter.building.id, name: ter.building.name } : null;
      const nearShelter = sp.mode === "CITY" && Math.max(Math.abs(exp.posX - SHELTER_DOOR[0]), Math.abs(exp.posY - SHELTER_DOOR[1])) <= 1;
      const onExit = sp.mode === "INTERIOR" && exp.posX === exitX && exp.posY === exitY;
      const currentLabel =
        sp.mode === "CITY"
          ? (ter?.kind === "SHELTER" ? "Your Shelter" : ter?.kind === "DOOR" ? `${ter.building?.name} (entrance)` : cur.feature === "ENEMY" && !cleared.has(hereKey) ? cur.label : cur.feature === "LOOT" && !searched.has(hereKey) ? cur.label : ter?.kind === "LOT" ? "Empty Lot" : "Street")
          : onExit ? "Exit to street" : cur.label;

      expedition = {
        id: exp.id,
        mode: sp.mode,
        posX: exp.posX,
        posY: exp.posY,
        tier,
        tiles,
        windowRadius: WINDOW_RADIUS,
        locationName: sp.mode === "CITY" ? "City Streets" : sp.building!.name,
        locationIcon: sp.mode === "CITY" ? "🏙️" : sp.building!.icon,
        biomeColor: BIOMES[cur.biome].color,
        biomeName: sp.mode === "CITY" ? "Ruined City" : BIOMES[sp.building!.biome].name,
        condition: condDef.key,
        conditionName: condDef.name,
        conditionIcon: condDef.icon,
        conditionNote: condDef.note,
        territoryFaction: null,
        territoryName: null,
        territoryStanding: null,
        log: ((exp.log as unknown as string[]) ?? []).slice(0, 16),
        backpack: backpack.map(itemView),
        backpackUsed: backpack.reduce((n, b) => n + b.quantity, 0),
        carryCap: BASE_CARRY + carryBonus,
        ground: groundView,
        searchedHere: searched.has(hereKey),
        pending: (exp.pending as unknown as EncounterView | null) ?? null,
        currentLabel,
        onDoor,
        nearShelter,
        ventureSeed: exp.seed,
        buildingId: exp.zoneKey,
        searched: [...searched],
        cleared: [...cleared],
        cityDim: CITY_DIM,
        minimap: BUILDINGS.map((b) => ({ x: b.doorX, y: b.doorY, icon: b.icon, name: b.name, tier: b.tier, here: exp.zoneKey === b.id })),
        shelter: { x: SHELTER_DOOR[0], y: SHELTER_DOOR[1] },
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
  // Start on the street just outside the shelter door, facing the city.
  const sx = SHELTER_DOOR[0], sy = SHELTER_DOOR[1] - 1;
  const intro = condition === "CLEAR" ? "You step out of the shelter into the ruined city." : `You step out into the city — ${CONDITIONS[condition].name}. ${CONDITIONS[condition].note}`;
  await prisma.expedition.create({
    data: { playerId, seed, condition, zoneKey: null, visited: [`${sx},${sy}`], spotted: [], cleared: [], searched: [], ground: {}, log: [intro], posX: sx, posY: sy, distance: 0 },
  });
  await prisma.player.update({ where: { id: playerId }, data: { state: "IN_EXPEDITION", stamina: 100 } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Step in through a building's door into its interior room. */
export async function enterBuilding(playerId: string, buildingId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp || exp.zoneKey || exp.pending) return loadSnapshot(playerId, exp?.pending ? "Deal with the threat first." : "");
  const b = BUILDINGS_BY_ID[buildingId];
  if (!b) return loadSnapshot(playerId);

  // Enter at the interior's south-centre — that tile is the way back out.
  const ex = Math.floor(b.size / 2), ey = b.size - 1;
  const visited = new Set((exp.visited as unknown as string[]) ?? []);
  visited.add(tkey(buildingId, ex, ey));
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  log.unshift(`${b.icon} You push inside the ${b.name} — Tier ${b.tier}. The air is still.`);
  await prisma.expedition.update({ where: { id: exp.id }, data: { zoneKey: buildingId, posX: ex, posY: ey, visited: [...visited], log } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Step back out of a building onto the street, at its door. */
export async function exitBuilding(playerId: string): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp || !exp.zoneKey || exp.pending) return loadSnapshot(playerId, exp?.pending ? "Deal with the threat first." : "");
  const b = BUILDINGS_BY_ID[exp.zoneKey];
  const visited = new Set((exp.visited as unknown as string[]) ?? []);
  if (b) visited.add(tkey(null, b.doorX, b.doorY));
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  log.unshift("You step back out onto the street.");
  await prisma.expedition.update({ where: { id: exp.id }, data: { zoneKey: null, posX: b?.doorX ?? exp.posX, posY: b?.doorY ?? exp.posY, visited: [...visited], log } });
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
  if (player.stamina <= 0) return loadSnapshot(playerId, "Too exhausted — rest a moment, or head home.");
  const sp = spaceOf(exp);

  const [dx, dy] = DIRS[dir];
  const x = exp.posX + dx, y = exp.posY + dy;

  // Terrain gating differs by space.
  if (sp.mode === "CITY") {
    const ter = cityTerrain(x, y);
    if (ter.kind === "EDGE") return loadSnapshot(playerId, "The city ends here — only rubble beyond.");
    if (ter.kind === "BUILDING") return loadSnapshot(playerId, "A wall blocks the way. Find a door.");
    if (ter.kind === "DOOR" && ter.building) return enterBuilding(playerId, ter.building.id);
  } else if (!inBounds(sp.size, x, y)) {
    return loadSnapshot(playerId, "Just a wall — no way through there.");
  }

  const key = tkey(exp.zoneKey, x, y);
  const visited = new Set((exp.visited as unknown as string[]) ?? []);
  const cleared = new Set((exp.cleared as unknown as string[]) ?? []);
  const firstVisit = !visited.has(key);
  visited.add(key);
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  const venture = exp.seed;
  const tier = spaceTier(sp, x, y);
  const narr = mulberry32(hashSeed(sp.lootSeed, x, y, 555));

  let health = player.health;
  let radiation = player.radiation;
  const stamina = clamp(player.stamina - SURV.moveStaminaCost + SURV.staminaRegenOnTile, 0, 100);
  let pending: EncounterView | null = null;
  const entry: string[] = []; // chronological lines for this step
  const cond = (exp.condition as Condition) ?? "CLEAR";

  if (sp.mode === "CITY") {
    const ter = cityTerrain(x, y);
    if (ter.kind === "SHELTER") {
      entry.push("🏠 You reach your shelter door. Tap Return Home to bank your haul.");
    } else {
      const f = cityFeature(venture, x, y);
      entry.push(`You move ${DIR_NAME[dir]} ${ter.kind === "LOT" ? "across the open ground" : "down the street"}.`);
      if (chance(narr, 0.2)) entry.push(ambientLine(narr));
      if (firstVisit && f.feature === "ENEMY" && !cleared.has(key)) {
        const e = enemyForTile(f) ?? wanderingEnemy(narr, tier);
        const elite = tier >= 4 && chance(narr, 0.2);
        const power = Math.round(e.power * (elite ? 1.6 : 1));
        const name = elite ? `Elite ${e.name}` : e.name;
        pending = { kind: "enemy", enemyKey: e.key, name, icon: elite ? "☠️" : e.icon, power, hp: power, maxHp: power, faction: null, elite };
        entry.push(`${pending.icon} ${enemyEntrance(narr, name)}`);
      } else if (f.feature === "LOOT") {
        const searched = new Set((exp.searched as unknown as string[]) ?? []);
        entry.push(searched.has(key) ? `${f.icon} ${f.label} — already picked over.` : `${f.icon} ${f.label}. Worth a search.`);
      }
    }
  } else {
    // building interior — the varied encounters live in here
    const b = sp.building!;
    const tile = interiorTile(b, venture, x, y);
    const isExit = x === Math.floor(sp.size / 2) && y === sp.size - 1;
    entry.push(`You move ${DIR_NAME[dir]}. ${sightFor(narr, tile.biome)}`);
    if (chance(narr, 0.22)) entry.push(ambientLine(narr));
    if (isExit) entry.push("🚪 The way back out to the street is here.");
    if (firstVisit && tile.feature === "ENEMY") {
      const e = enemyForTile(tile)!;
      const elite = tier >= 4 && chance(narr, 0.25);
      const power = Math.round(e.power * (elite ? 1.6 : 1));
      const name = elite ? `Elite ${e.name}` : e.name;
      pending = { kind: "enemy", enemyKey: e.key, name, icon: elite ? "☠️" : e.icon, power, hp: power, maxHp: power, faction: null, elite };
      entry.push(`${pending.icon} ${enemyEntrance(narr, name)}`);
    } else if (tile.feature === "SURVIVOR" && !cleared.has(key)) {
      const name = tile.survivorName ?? "a stranger";
      const npcRng = mulberry32(hashSeed(sp.lootSeed, x, y, 909));
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
        pending = { kind: "trader", name, icon: "🧑‍🔧", offers: traderOffers(npcRng, tier, 0) };
        entry.push(`🧑‍🔧 ${name}, a trader, has set up here. "Got goods — if you've got scrap."`);
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
  }

  if (!pending && firstVisit && cond === "RAIDER_ACTIVITY" && chance(narr, 0.14)) {
    const e = wanderingEnemy(narr, tier);
    pending = { kind: "enemy", enemyKey: e.key, name: e.name, icon: e.icon, power: e.power, hp: e.power, maxHp: e.power, faction: null };
    entry.push(`${e.icon} Ambush! ${enemyEntrance(narr, e.name)}`);
  }

  if (cond === "RAD_STORM" && firstVisit) radiation = clamp(radiation + 2);

  if (!pending) {
    const near = nearbyNotables(sp, x, y);
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

/** The client renders + drives movement in real time; it commits the tile it
 *  settles on here so server-side actions (search, bank, battle) act on the
 *  right place. Landing on a fresh hazard tile still doses radiation. */
export async function syncPos(playerId: string, x: number, y: number): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp || exp.pending) return loadSnapshot(playerId);
  const sp = spaceOf(exp);
  if (sp.mode === "CITY") {
    if (!passable(x, y)) return loadSnapshot(playerId);
  } else if (!inBounds(sp.size, x, y)) {
    return loadSnapshot(playerId);
  }
  const key = tkey(exp.zoneKey, x, y);
  const visited = new Set((exp.visited as unknown as string[]) ?? []);
  const firstVisit = !visited.has(key);
  visited.add(key);
  let health = player.health;
  let radiation = player.radiation;
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  const stamina = clamp(player.stamina - SURV.moveStaminaCost + SURV.staminaRegenOnTile, 0, 100);

  if (firstVisit) {
    const cond = (exp.condition as Condition) ?? "CLEAR";
    const tile = spaceTile(sp, x, y);
    const narr = mulberry32(hashSeed(sp.lootSeed, x, y, 555));
    if (tile.feature === "HAZARD") {
      const stormMult = cond === "RAD_STORM" ? 1.6 : 1;
      const dose = Math.round(randInt(narr, SURV.radPerHazard[0], SURV.radPerHazard[1]) * (tile.hazard === "RADIATION" ? 1 : 0.6) * stormMult);
      radiation = clamp(radiation + dose);
      log.unshift(`${tile.icon} ${hazardLine(narr, tile.hazard!)} (+${dose} rad)`);
    }
    if (radiation > SURV.radDamageThreshold) {
      const chip = Math.round((radiation - SURV.radDamageThreshold) / 8);
      if (chip > 0) { health = Math.max(0, health - chip); log.unshift(`☢ Radiation sickness gnaws at you (−${chip} HP).`); }
    }
    log = log.slice(0, 24);
  }

  if (health <= 0) return applyDeath(playerId, exp.id, "The wasteland claimed you.");
  await prisma.expedition.update({ where: { id: exp.id }, data: { posX: x, posY: y, visited: [...visited], log } });
  await prisma.player.update({ where: { id: playerId }, data: { health, radiation, stamina } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Begin a battle with a roaming enemy the client walked into. The enemy's
 *  home tile (ox,oy) becomes the player's position so a win clears that tile
 *  and drops loot there. */
export async function engage(playerId: string, enemyKey: string, tier: number, ox: number, oy: number): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp || exp.pending) return loadSnapshot(playerId);
  const def = ENEMIES[enemyKey];
  if (!def) return loadSnapshot(playerId);
  const t = Math.max(1, Math.min(5, tier));
  const elite = t >= 4 && chance(mulberry32(hashSeed(exp.seed, ox, oy, 77)), 0.2);
  const power = Math.round(def.power * (1 + (t - 1) * 0.35) * (elite ? 1.6 : 1));
  const name = elite ? `Elite ${def.name}` : def.name;
  const pending: EncounterView = { kind: "enemy", enemyKey, name, icon: elite ? "☠️" : def.icon, power, hp: power, maxHp: power, faction: null, elite };
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  log.unshift(`${pending.icon} ${enemyEntrance(mulberry32(hashSeed(exp.seed, ox, oy, 99)), name)}`);
  await prisma.expedition.update({ where: { id: exp.id }, data: { posX: ox, posY: oy, log, pending: pending as unknown as Prisma.InputJsonValue } });
  revalidatePath("/");
  return loadSnapshot(playerId);
}

/** Non-movement interactions: search the tile (loot or ambush) or rest to
 *  recover stamina (with risk). */
export async function interact(playerId: string, kind: "search" | "rest"): Promise<GameSnapshot | null> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.state !== "IN_EXPEDITION") return loadSnapshot(playerId);
  const exp = await prisma.expedition.findFirst({ where: { playerId, status: "ACTIVE" } });
  if (!exp) return loadSnapshot(playerId);
  if (exp.pending) return loadSnapshot(playerId, "Deal with the threat first.");
  const sp = spaceOf(exp);

  const tile = spaceTile(sp, exp.posX, exp.posY);
  const tier = spaceTier(sp, exp.posX, exp.posY);
  const cond = (exp.condition as Condition) ?? "CLEAR";
  const key = tkey(exp.zoneKey, exp.posX, exp.posY);
  const salt = kind === "search" ? 222 : 333;
  const narr = mulberry32(hashSeed(sp.lootSeed, exp.posX, exp.posY, salt, Math.floor(Math.random() * 1e9)));
  let log = ((exp.log as unknown as string[]) ?? []).slice(0, 18);
  let stamina = player.stamina;
  let pending: EncounterView | null = null;

  if (kind === "rest") {
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
      // Loot only comes from actual stashes — a wreck/dumpster on the street, a
      // container in a building. Bare ground turns up nothing but the odd scrap.
      const lootTier = cond === "BOUNTIFUL" ? tier + 1 : tier;
      const isStash = tile.feature === "LOOT" || tile.feature === "CACHE";
      let drops = isStash ? lootForTile(sp.lootSeed, { ...tile, tier: lootTier }) : [];
      if (drops.length === 0 && !isStash && chance(narr, 0.12)) {
        drops = generateLoot(narr, [["scrap", 4], ["cloth", 3]], 1, [1, 1]);
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
  const sp = spaceOf(exp);
  const rng = mulberry32(hashSeed(exp.seed, exp.posX, exp.posY, player.health, Math.floor(Math.random() * 1e9)));
  const log = ((exp.log as unknown as string[]) ?? []).slice(0, 12);
  const key = tkey(exp.zoneKey, exp.posX, exp.posY);
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
      const tier = spaceTier(sp, exp.posX, exp.posY);
      const baseTile = spaceTile(sp, exp.posX, exp.posY);
      const drops = lootForTile(sp.lootSeed, { ...baseTile, feature: "CACHE" });
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

  // A defeated foe is gone for good this venture — clear its tile.
  const cleared = new Set((exp.cleared as unknown as string[]) ?? []);
  if (choice === "fight" && newPending === null) cleared.add(key);
  await prisma.expedition.update({ where: { id: exp.id }, data: { log, ground: ground as unknown as Prisma.InputJsonValue, cleared: [...cleared], pending: newPending ? (newPending as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
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
  cleared.add(tkey(exp.zoneKey, exp.posX, exp.posY)); // they're gone either way
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
  cleared.add(tkey(exp.zoneKey, exp.posX, exp.posY));
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

  const key = tkey(exp.zoneKey, exp.posX, exp.posY);
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

  const key = tkey(exp.zoneKey, exp.posX, exp.posY);
  const ground = ((exp.ground as unknown as Record<string, GroundEntry[]>) ?? {}) as Record<string, GroundEntry[]>;
  const list = ground[key] ?? [];
  if (list.length === 0) return loadSnapshot(playerId, "Nothing here to pick up.");
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

  const key = tkey(exp.zoneKey, exp.posX, exp.posY);
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
  if (exp.pending) return loadSnapshot(playerId, "Deal with the threat first.");
  if (exp.zoneKey) return loadSnapshot(playerId, "Step back out onto the street first.");
  const nearShelter = Math.max(Math.abs(exp.posX - SHELTER_DOOR[0]), Math.abs(exp.posY - SHELTER_DOOR[1])) <= 1;
  if (!nearShelter) return loadSnapshot(playerId, "Make your way back to the shelter to bank your haul.");

  // Banking at the shelter is safe — the risk is out in the city.
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
