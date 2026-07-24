CREATE TABLE "criterion_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_item_id" integer NOT NULL,
	"criterion_code" text NOT NULL,
	"applies" boolean DEFAULT false NOT NULL,
	"rationale_en" text,
	"rationale_ar" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"signals" jsonb
);
--> statement-breakpoint
CREATE TABLE "engine_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"engine_type" text NOT NULL,
	"scope_selection" jsonb NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"initiated_by" integer,
	"run_note" text,
	"justification" text,
	"model_id" text,
	"prompt_version" text,
	"framework_version_id" integer,
	"engine_version" text,
	"temperature" real DEFAULT 0 NOT NULL,
	"seed" integer,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"cached_items" integer DEFAULT 0 NOT NULL,
	"error_items" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "export_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" jsonb NOT NULL,
	"filters" jsonb,
	"columns" jsonb NOT NULL,
	"row_keys" jsonb,
	"filename" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"framework_id" integer NOT NULL,
	"version" text NOT NULL,
	"definition" jsonb NOT NULL,
	"author_id" integer,
	"change_note" text,
	"immutable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frameworks" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"active_version_id" integer,
	CONSTRAINT "frameworks_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"export_batch_id" integer,
	"filename" text NOT NULL,
	"status" text DEFAULT 'validating' NOT NULL,
	"match_mode" text DEFAULT 'batch' NOT NULL,
	"summary" jsonb,
	"justification" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "import_diffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_batch_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"field" text NOT NULL,
	"current_value" text,
	"incoming_value" text,
	"change_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"input_hash" text PRIMARY KEY NOT NULL,
	"response" jsonb NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"framework_version_id" integer,
	"engine_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_hit_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"verdict" text,
	"suggested_class_code" text,
	"suggested_level_code" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"rationale_en" text,
	"rationale_ar" text,
	"source_layers" jsonb,
	"conflict" boolean DEFAULT false NOT NULL,
	"current_value" jsonb,
	"steward_decision" text DEFAULT 'pending' NOT NULL,
	"override_value" jsonb,
	"override_rationale" text,
	"input_hash" text,
	"cached" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"screen" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"columns" jsonb,
	"shared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "source" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "run_id" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "import_batch_id" integer;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "framework_version" text;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "cached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "classifications" ADD COLUMN "overridden_by_import" integer;--> statement-breakpoint
ALTER TABLE "detections" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "detections" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "detections" ADD COLUMN "framework_version" text;--> statement-breakpoint
ALTER TABLE "detections" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "detections" ADD COLUMN "cached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "criterion_assessments" ADD CONSTRAINT "criterion_assessments_run_item_id_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_framework_version_id_framework_versions_id_fk" FOREIGN KEY ("framework_version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_batches" ADD CONSTRAINT "export_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_versions" ADD CONSTRAINT "framework_versions_framework_id_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."frameworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "framework_versions" ADD CONSTRAINT "framework_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_export_batch_id_export_batches_id_fk" FOREIGN KEY ("export_batch_id") REFERENCES "public"."export_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_diffs" ADD CONSTRAINT "import_diffs_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_engine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."engine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "criterion_assessments_run_item_idx" ON "criterion_assessments" USING btree ("run_item_id");--> statement-breakpoint
CREATE INDEX "framework_versions_framework_idx" ON "framework_versions" USING btree ("framework_id");--> statement-breakpoint
CREATE INDEX "import_diffs_batch_idx" ON "import_diffs" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "run_items_run_idx" ON "run_items" USING btree ("run_id");