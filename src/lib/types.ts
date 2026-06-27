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
  revealed: boolean;
  icon?: string;
  label?: string;
  feature?: string;
  color?: string;
  isPlayer?: boolean;
  isExit?: boolean;
}

export interface EncounterView {
  kind: "enemy";
  enemyKey: string;
  name: string;
  icon: string;
  power: number;
  hp: number;
  maxHp: number;
}

export interface ExpeditionView {
  id: string;
  seed: number;
  posX: number;
  posY: number;
  distance: number;
  tier: number;
  tiles: TileView[]; // window around the player
  windowRadius: number;
  log: string[];
  backpack: ItemView[];
  backpackUsed: number;
  carryCap: number;
  pending: EncounterView | null;
  currentLabel: string;
  atExit: boolean;
}

export interface ShelterView {
  level: number;
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
  expedition: ExpeditionView | null;
  flash: string | null; // one-off message (e.g. death summary)
}
