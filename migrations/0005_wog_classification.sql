-- Remap stored classification codes to the DGE Whole-of-Government Data
-- Classification Framework v1.0 scale (Open / Confidential / Sensitive / Secret).
-- Legacy PUBLIC -> OPEN; INTERNAL -> CONFIDENTIAL (Internal is removed and
-- Confidential is the new default level for all data). CONFIDENTIAL and SECRET
-- keep their codes but change rank.
UPDATE "attributes" SET "column_data_classification" = 'OPEN' WHERE "column_data_classification" = 'PUBLIC';--> statement-breakpoint
UPDATE "attributes" SET "column_data_classification" = 'CONFIDENTIAL' WHERE "column_data_classification" = 'INTERNAL';--> statement-breakpoint
UPDATE "assets" SET "asset_classification" = 'OPEN' WHERE "asset_classification" = 'PUBLIC';--> statement-breakpoint
UPDATE "assets" SET "asset_classification" = 'CONFIDENTIAL' WHERE "asset_classification" = 'INTERNAL';--> statement-breakpoint
UPDATE "classifications" SET "level_code" = 'OPEN' WHERE "level_code" = 'PUBLIC';--> statement-breakpoint
UPDATE "classifications" SET "level_code" = 'CONFIDENTIAL' WHERE "level_code" = 'INTERNAL';--> statement-breakpoint
UPDATE "run_items" SET "suggested_level_code" = 'OPEN' WHERE "suggested_level_code" = 'PUBLIC';--> statement-breakpoint
UPDATE "run_items" SET "suggested_level_code" = 'CONFIDENTIAL' WHERE "suggested_level_code" = 'INTERNAL';--> statement-breakpoint
-- Drop the stale classification_rules app-setting so the app re-seeds it with the
-- new WoG rule mapping on next boot (seed re-inserts it via ON CONFLICT DO NOTHING).
DELETE FROM "app_settings" WHERE "key" = 'classification_rules';--> statement-breakpoint
DELETE FROM "classification_levels" WHERE "code" IN ('PUBLIC', 'INTERNAL');--> statement-breakpoint
INSERT INTO "classification_levels" ("code", "label", "rank", "color_token") VALUES
	('OPEN', 'Open', 0, 'success'),
	('CONFIDENTIAL', 'Confidential', 1, 'info'),
	('SENSITIVE', 'Sensitive', 2, 'warning'),
	('SECRET', 'Secret', 3, 'destructive')
ON CONFLICT ("code") DO UPDATE SET
	"label" = EXCLUDED."label",
	"rank" = EXCLUDED."rank",
	"color_token" = EXCLUDED."color_token";
