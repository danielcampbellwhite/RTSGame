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
  edge?: boolean; // outside the zone bounds — impassable rubble
  icon?: string;
  label?: string;
  feature?: string;
  color?: string;
  isPlayer?: boolean;
  isExit?: boolean;
}

export interface OverviewZone {
  key: string;
  name: string;
  type: string; // SAFE | POI | DANGER | WASTELAND
  x: number; // 0–100 map %
  y: number;
  tier: number;
  icon: string;
  color: string;
  faction: string | null;
  standing: string | null;
}

export interface OverviewView {
  conditionName: string;
  conditionIcon: string;
  conditionNote: string;
  zones: OverviewZone[];
  backpackCount: number;
  carryCap: number;
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
  faction?: string | null;
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
  seed: number;
  posX: number;
  posY: number;
  distance: number;
  tier: number;
  tiles: TileView[]; // window around the player
  windowRadius: number;
  zoneName: string;
  zoneType: string;
  gridSize: number;
  biomeColor: string;
  biomeName: string;
  condition: string;
  conditionName: string;
  conditionIcon: string;
  conditionNote: string;
  territoryFaction: string | null; // controlling faction key
  territoryName: string | null;
  territoryStanding: string | null;
  log: string[];
  backpack: ItemView[];
  backpackUsed: number;
  carryCap: number;
  ground: GroundItemView[]; // items lying on the player's current tile
  searchedHere: boolean;
  pending: EncounterView | null;
  currentLabel: string;
  atExit: boolean;
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

export interface FactionStanding {
  key: string;
  name: string;
  icon: string;
  color: string;
  note: string;
  rep: number;
  standing: string;
}

export interface GameSnapshot {
  player: PlayerView;
  shelter: ShelterView;
  storage: ItemView[];
  equipped: Record<string, ItemView | null>;
  craftables: CraftableView[];
  factions: FactionStanding[];
  overview: OverviewView | null; // the city map (between zones)
  expedition: ExpeditionView | null; // exploring a zone
  flash: string | null; // one-off message (e.g. death summary)
}
