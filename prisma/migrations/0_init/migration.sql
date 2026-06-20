-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TerritoryKind" AS ENUM ('CAPITAL', 'MAJOR_CITY', 'INDUSTRIAL', 'PORT', 'MILITARY', 'RURAL');

-- CreateEnum
CREATE TYPE "Terrain" AS ENUM ('PLAINS', 'FOREST', 'MOUNTAIN', 'DESERT', 'URBAN', 'COASTAL');

-- CreateEnum
CREATE TYPE "BuildingType" AS ENUM ('HOUSING', 'FACTORY', 'POWER_PLANT', 'FARM', 'HOSPITAL', 'BARRACKS', 'AIR_BASE', 'NAVAL_BASE', 'MISSILE_SILO', 'RADAR', 'ROAD', 'RAILWAY', 'PORT', 'AIRPORT');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('INFANTRY', 'MECHANIZED', 'TANK', 'ARTILLERY', 'AIR_DEFENSE', 'FIGHTER', 'BOMBER', 'DRONE', 'TRANSPORT_AIR', 'FRIGATE', 'DESTROYER', 'SUBMARINE', 'CARRIER', 'MISSILE', 'NUKE', 'INTEL');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('IDLE', 'MOVING', 'ENGAGED');

-- CreateEnum
CREATE TYPE "TradeGood" AS ENUM ('MONEY', 'OIL', 'FOOD', 'STEEL', 'RARE_MATERIALS', 'TECHNOLOGY');

-- CreateEnum
CREATE TYPE "TradeMode" AS ENUM ('SHIPPING', 'AIR_CARGO', 'LAND');

-- CreateEnum
CREATE TYPE "ResearchCategory" AS ENUM ('MILITARY', 'ECONOMY', 'ENERGY', 'INTELLIGENCE', 'INFRASTRUCTURE');

-- CreateEnum
CREATE TYPE "WarStatus" AS ENUM ('ACTIVE', 'CEASEFIRE', 'ENDED');

-- CreateEnum
CREATE TYPE "EventScope" AS ENUM ('GLOBAL', 'REGIONAL', 'COUNTRY');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('RECESSION', 'PANDEMIC', 'REFUGEE_CRISIS', 'OIL_SHORTAGE', 'NATURAL_DISASTER', 'CYBER_ATTACK', 'POLITICAL_INSTABILITY', 'BATTLE', 'CONSTRUCTION', 'RESEARCH', 'DIPLOMACY', 'TRADE', 'ECONOMY', 'SYSTEM');

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "playerName" TEXT NOT NULL DEFAULT 'Commander',
    "playerEmail" TEXT,
    "playerCountry" TEXT NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "iso3" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capitalLng" DOUBLE PRECISION NOT NULL,
    "capitalLat" DOUBLE PRECISION NOT NULL,
    "isPlayer" BOOLEAN NOT NULL DEFAULT false,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "population" DOUBLE PRECISION NOT NULL,
    "gdp" DOUBLE PRECISION NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "techLevel" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "influence" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "morale" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "infrastructure" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "money" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "oil" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "food" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "electricity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "steel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rareMaterials" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manpower" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "militaryBudgetPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "welfareBudgetPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "infraBudgetPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "researchBudgetPct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "aiAggression" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "aiEconomyFocus" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "aiMilitaryFocus" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "aiDiplomacyPref" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "aiRiskTolerance" DOUBLE PRECISION NOT NULL DEFAULT 40,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TerritoryKind" NOT NULL DEFAULT 'RURAL',
    "terr" "Terrain" NOT NULL DEFAULT 'PLAINS',
    "lng" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "population" DOUBLE PRECISION NOT NULL,
    "morale" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "economy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "infrastructure" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "defenses" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "unrest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "originalOwner" TEXT NOT NULL,
    "controlPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "occupied" BOOLEAN NOT NULL DEFAULT false,
    "neighbors" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "type" "BuildingType" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "buildingToLevel" INTEGER,
    "completesAt" TIMESTAMP(3),

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Army" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationTerritoryId" TEXT,
    "state" "OrderState" NOT NULL DEFAULT 'IDLE',
    "targetTerritoryId" TEXT,
    "arrivesAt" TIMESTAMP(3),
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "morale" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "supply" DOUBLE PRECISION NOT NULL DEFAULT 100,

    CONSTRAINT "Army_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'IDLE',
    "targetLng" DOUBLE PRECISION,
    "targetLat" DOUBLE PRECISION,
    "arrivesAt" TIMESTAMP(3),
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "morale" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "supply" DOUBLE PRECISION NOT NULL DEFAULT 100,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirWing" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseTerritoryId" TEXT,
    "state" "OrderState" NOT NULL DEFAULT 'IDLE',
    "targetLng" DOUBLE PRECISION,
    "targetLat" DOUBLE PRECISION,
    "arrivesAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "morale" DOUBLE PRECISION NOT NULL DEFAULT 70,

    CONSTRAINT "AirWing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "health" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "armyId" TEXT,
    "fleetId" TEXT,
    "airWingId" TEXT,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiplomaticRelation" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "opinion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allied" BOOLEAN NOT NULL DEFAULT false,
    "embargo" BOOLEAN NOT NULL DEFAULT false,
    "sanctioned" BOOLEAN NOT NULL DEFAULT false,
    "guaranteed" BOOLEAN NOT NULL DEFAULT false,
    "atWar" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DiplomaticRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeRoute" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "good" "TradeGood" NOT NULL,
    "mode" "TradeMode" NOT NULL DEFAULT 'SHIPPING',
    "ratePerDay" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blockaded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TradeRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "techKey" TEXT NOT NULL,
    "category" "ResearchCategory" NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completesAt" TIMESTAMP(3),

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "War" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WarStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "War_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarParticipant" (
    "id" TEXT NOT NULL,
    "warId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "attacker" BOOLEAN NOT NULL DEFAULT false,
    "warScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "WarParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "scope" "EventScope" NOT NULL DEFAULT 'GLOBAL',
    "category" "EventCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "countryIso" TEXT,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_playerEmail_idx" ON "Game"("playerEmail");

-- CreateIndex
CREATE INDEX "Country_gameId_idx" ON "Country"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Country_gameId_iso3_key" ON "Country"("gameId", "iso3");

-- CreateIndex
CREATE INDEX "Territory_countryId_idx" ON "Territory"("countryId");

-- CreateIndex
CREATE INDEX "Building_territoryId_idx" ON "Building"("territoryId");

-- CreateIndex
CREATE INDEX "Army_countryId_idx" ON "Army"("countryId");

-- CreateIndex
CREATE INDEX "Fleet_countryId_idx" ON "Fleet"("countryId");

-- CreateIndex
CREATE INDEX "AirWing_countryId_idx" ON "AirWing"("countryId");

-- CreateIndex
CREATE INDEX "Unit_armyId_idx" ON "Unit"("armyId");

-- CreateIndex
CREATE INDEX "Unit_fleetId_idx" ON "Unit"("fleetId");

-- CreateIndex
CREATE INDEX "Unit_airWingId_idx" ON "Unit"("airWingId");

-- CreateIndex
CREATE INDEX "DiplomaticRelation_fromId_idx" ON "DiplomaticRelation"("fromId");

-- CreateIndex
CREATE INDEX "DiplomaticRelation_toId_idx" ON "DiplomaticRelation"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "DiplomaticRelation_fromId_toId_key" ON "DiplomaticRelation"("fromId", "toId");

-- CreateIndex
CREATE INDEX "TradeRoute_fromId_idx" ON "TradeRoute"("fromId");

-- CreateIndex
CREATE INDEX "TradeRoute_toId_idx" ON "TradeRoute"("toId");

-- CreateIndex
CREATE INDEX "ResearchProject_countryId_idx" ON "ResearchProject"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProject_countryId_techKey_key" ON "ResearchProject"("countryId", "techKey");

-- CreateIndex
CREATE INDEX "War_gameId_idx" ON "War"("gameId");

-- CreateIndex
CREATE INDEX "WarParticipant_warId_idx" ON "WarParticipant"("warId");

-- CreateIndex
CREATE UNIQUE INDEX "WarParticipant_warId_countryId_key" ON "WarParticipant"("warId", "countryId");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_createdAt_idx" ON "GameEvent"("gameId", "createdAt");

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Territory" ADD CONSTRAINT "Territory_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Army" ADD CONSTRAINT "Army_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirWing" ADD CONSTRAINT "AirWing_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_armyId_fkey" FOREIGN KEY ("armyId") REFERENCES "Army"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_airWingId_fkey" FOREIGN KEY ("airWingId") REFERENCES "AirWing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaticRelation" ADD CONSTRAINT "DiplomaticRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomaticRelation" ADD CONSTRAINT "DiplomaticRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRoute" ADD CONSTRAINT "TradeRoute_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeRoute" ADD CONSTRAINT "TradeRoute_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "War" ADD CONSTRAINT "War_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarParticipant" ADD CONSTRAINT "WarParticipant_warId_fkey" FOREIGN KEY ("warId") REFERENCES "War"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarParticipant" ADD CONSTRAINT "WarParticipant_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

