import { TRADE } from "@/lib/balance";
import type { Country, TradeRoute } from "@prisma/client";

const GOOD_FIELD: Record<string, keyof Country> = {
  OIL: "oil",
  FOOD: "food",
  STEEL: "steel",
  RARE_MATERIALS: "rareMaterials",
};

/**
 * Move goods along active trade routes for one economy step. The importer pays
 * the exporter at the notional market price. Blockaded routes are skipped.
 */
export function stepTrade(routes: TradeRoute[], countriesById: Map<string, Country>, dtMs: number): void {
  const days = dtMs / 86_400_000;
  for (const r of routes) {
    if (!r.active || r.blockaded) continue;
    const field = GOOD_FIELD[r.good];
    if (!field) continue; // money/technology handled elsewhere

    const seller = countriesById.get(r.fromId);
    const buyer = countriesById.get(r.toId);
    if (!seller || !buyer) continue;

    let amount = r.ratePerDay * days;
    const available = seller[field] as number;
    if (available < amount) amount = Math.max(0, available);
    if (amount <= 0) continue;

    const cost = amount * (TRADE.price[r.good] ?? 0.05);
    if (buyer.money < cost) continue; // buyer can't pay this step

    (seller[field] as number) = available - amount;
    (buyer[field] as number) = (buyer[field] as number) + amount;
    seller.money += cost;
    buyer.money -= cost;
  }
}
