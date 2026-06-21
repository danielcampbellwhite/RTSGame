-- Ranged/air strike cooldown on armies
ALTER TABLE "Army" ADD COLUMN "strikeReadyAt" TIMESTAMP(3);
