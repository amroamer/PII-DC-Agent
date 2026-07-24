CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ikc_asset_id" text NOT NULL,
	"name" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"asset_type" text,
	"business_domain" text,
	"subject_area" text,
	"department" text,
	"sector" text,
	"owner_id" text,
	"stewards" text,
	"storage" text,
	"retention_period" text,
	"pii_flag" boolean DEFAULT false NOT NULL,
	"cde_flag" boolean DEFAULT false NOT NULL,
	"asset_classification" text,
	"raw_row" jsonb,
	"ingest_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"column_name" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"data_type" text,
	"native_type" text,
	"is_primary_key" boolean DEFAULT false NOT NULL,
	"nullable" boolean DEFAULT true NOT NULL,
	"selected_data_class_name" text,
	"selected_data_class_confidence" real,
	"suggested_classes" jsonb,
	"column_data_classification" text,
	"pii_name" text,
	"pii_description" text,
	"cde_flag" boolean DEFAULT false NOT NULL,
	"raw_row" jsonb,
	"ingest_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"rationale" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_levels" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"rank" integer NOT NULL,
	"color_token" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target_id" integer NOT NULL,
	"level_code" text NOT NULL,
	"derived_from" text NOT NULL,
	"rationale" text,
	"superseded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooccurrence_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"attribute_ids" jsonb NOT NULL,
	"combination_label" text NOT NULL,
	"risk_score" real DEFAULT 0 NOT NULL,
	"rationale" text,
	"run_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_classes" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"category" text NOT NULL,
	"is_pii" boolean DEFAULT false NOT NULL,
	"is_special_category" boolean DEFAULT false NOT NULL,
	"detection_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detections" (
	"id" serial PRIMARY KEY NOT NULL,
	"attribute_id" integer NOT NULL,
	"layer" text NOT NULL,
	"criterion_code" text,
	"verdict" text NOT NULL,
	"data_class_code" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"rationale_en" text,
	"rationale_ar" text,
	"evidence" jsonb,
	"engine_version" text NOT NULL,
	"run_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"sheet_type" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "metadata_completion" (
	"id" serial PRIMARY KEY NOT NULL,
	"attribute_id" integer NOT NULL,
	"processing_purpose" text,
	"consent_status" text,
	"access_control_level" text,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_criteria" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text NOT NULL,
	"evaluation_mode" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"detection_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"assigned_to" integer,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"decision_rationale" text
);
--> statement-breakpoint
CREATE TABLE "system_prompts" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'steward' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "writeback_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"dispatched_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_ingest_run_id_ingest_runs_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooccurrence_findings" ADD CONSTRAINT "cooccurrence_findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_completion" ADD CONSTRAINT "metadata_completion_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_completion" ADD CONSTRAINT "metadata_completion_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_detection_id_detections_id_fk" FOREIGN KEY ("detection_id") REFERENCES "public"."detections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_ikc_asset_id_idx" ON "assets" USING btree ("ikc_asset_id");--> statement-breakpoint
CREATE INDEX "attributes_asset_id_idx" ON "attributes" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "classifications_scope_target_idx" ON "classifications" USING btree ("scope","target_id");--> statement-breakpoint
CREATE INDEX "data_classes_source_idx" ON "data_classes" USING btree ("source");--> statement-breakpoint
CREATE INDEX "detections_attribute_id_idx" ON "detections" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "detections_run_id_idx" ON "detections" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "review_items_status_idx" ON "review_items" USING btree ("status");