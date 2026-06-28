// Shared view types returned by server actions to the client.

export interface ItemView {
  id: string;
  defKey: string;
  name: string;
  icon: string;
  category: string;
  quantity: number;
  durability: number | null;
  maxDurability: number | null;
  slot: string | null; // equip slot the item *can* occupy
  equippedSlot: string | null; // slot it currently occupies (if equipped)
  // consumable effect hints for the UI
  heal?: number;
  reduceRad?: number;
  restoreStamina?: number;
}

export interface TileView {
  x: number;
  y: number;
  revealed: boolean; // entered — contents known
  visited?: boolean; // part of your trail
  spotted?: boolean; // seen from afar via look — contents known, not entered
  scouted?: boolean; // adjacent — terrain visible, contents hidden
  edge?: boolean; // outside the map bounds
  kind?: string; // city terrain: STREET | LOT | BUILDING | DOOR | SHELTER
  buildingName?: string; // name of the building a DOOR leads to
  icon?: string;
  label?: string;
  feature?: string;
  color?: string;
  isPlayer?: boolean;
  isExit?: boolean; // interior tile that returns you to the street
}

export interface MinimapBuilding {
  x: number;
  y: number; // door tile in city coords
  icon: string;
  name: string;
  tier: number;
  here: boolean; // the building you're currently inside
}

export interface GroundItemView {
  idx: number; // index in the tile's ground array
  defKey: string;
  name: string;
  icon: string;
  quantity: number;
  durability: number | null;
}

export interface EnemyEncounter {
  kind: "enemy";
  enemyKey: string;
  name: string;
  icon: string;
  power: number;
  hp: number;
  maxHp: number;
  elite?: boolean;
}

export interface SurvivorEncounter {
  kind: "survivor";
  name: string;
  icon: string;
}

export interface TradeOffer {
  defKey: string;
  name: string;
  icon: string;
  price: number; // in scrap carried in your pack
}

export interface TraderEncounter {
  kind: "trader";
  name: string;
  icon: string;
  offers: TradeOffer[];
}

export interface InjuredEncounter {
  kind: "injured";
  name: string;
  icon: string;
  needDef: string; // consumable required to help (e.g. "bandage" | "medkit")
  needName: string;
}

export type EncounterView = EnemyEncounter | SurvivorEncounter | TraderEncounter | InjuredEncounter;

export interface ExpeditionView {
  id: string;
  mode: "CITY" | "INTERIOR";
  posX: number;
  posY: number;
  tier: number;
  tiles: TileView[]; // window around the player
  windowRadius: number;
  locationName: string; // "City Streets" or the building's name
  locationIcon: string;
  biomeColor: string;
  biomeName: string;
  condition: string;
  conditionName: string;
  conditionIcon: string;
  conditionNote: string;
  log: string[];
  backpack: ItemView[];
  backpackUsed: number;
  carryCap: number;
  ground: GroundItemView[]; // items lying on the player's current tile
  searchedHere: boolean;
  pending: EncounterView | null;
  currentLabel: string;
  onDoor: { id: string; name: string } | null; // standing on a building door
  nearShelter: boolean; // on/next to the shelter — can bank
  // real-time engine state (client renders the world deterministically)
  ventureSeed: number; // re-rolls enemies/loot each venture
  buildingId: string | null; // null = streets, else the interior you're inside
  searched: string[]; // tile keys already searched this venture
  cleared: string[]; // tile keys whose enemy/NPC is gone this venture
  // minimap (city-wide)
  cityDim: number;
  minimap: MinimapBuilding[];
  shelter: { x: number; y: number };
}

export interface ShelterView {
  level: number;
  population: number;
  popCap: number;
  food: number;
  water: number;
  meds: number;
  ammo: number;
  scrap: number;
  fuel: number;
  morale: number;
  storageCap: number;
  storedCount: number;
  workshopLvl: number;
  medicalLvl: number;
  ammoBenchLvl: number;
  weaponBenchLvl: number;
  workFood: number;
  workWater: number;
  workScrap: number;
  workMeds: number;
}

export interface PlayerView {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  stamina: number;
  radiation: number;
  level: number;
  xp: number;
  xpToNext: number;
  reputation: number;
  state: "AT_SHELTER" | "IN_EXPEDITION";
}

export interface CraftableView {
  key: string;
  name: string;
  station: string;
  affordable: boolean;
  detail: string;
}

export interface GameSnapshot {
  player: PlayerView;
  shelter: ShelterView;
  storage: ItemView[];
  equipped: Record<string, ItemView | null>;
  craftables: CraftableView[];
  expedition: ExpeditionView | null; // out in the city / inside a building
  flash: string | null; // one-off message (e.g. death summary)
}
