-- Strike cooldown on fleets
ALTER TABLE "Fleet" ADD COLUMN "strikeReadyAt" TIMESTAMP(3);
