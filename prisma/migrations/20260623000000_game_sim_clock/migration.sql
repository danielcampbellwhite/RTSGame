-- Add a simulation clock to Game. Existing rows seed it to "now" (≈ their
-- current wall clock), which matches their in-flight wall-clock deadlines.
ALTER TABLE "Game" ADD COLUMN "simClock" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
