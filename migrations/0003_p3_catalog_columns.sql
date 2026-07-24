ALTER TABLE "assets" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "creator_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "table_type" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "table_schema" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "connection_path" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "backup_frequency" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "num_columns" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "num_children" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "quality_score" real;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "analysed_row_count" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "length" integer;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "scale" integer;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "signed" boolean;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "quality_score" real;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "business_terms" jsonb;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "suggested_terms" jsonb;