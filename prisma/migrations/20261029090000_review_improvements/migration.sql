-- Validation plan: what an idea in 验证中 sets out to prove, and how to tell it worked.
ALTER TABLE "ideas" ADD COLUMN "hypothesis" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ideas" ADD COLUMN "success_criteria" TEXT NOT NULL DEFAULT '';

-- Timeline entries for ICE score changes.
ALTER TABLE "idea_events" DROP CONSTRAINT IF EXISTS "idea_events_type_check";
ALTER TABLE "idea_events" ADD CONSTRAINT "idea_events_type_check" CHECK ("type" IN ('created', 'stage', 'note', 'score'));
