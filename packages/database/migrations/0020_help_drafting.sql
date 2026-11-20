-- ADR-0023, step 2: Draft with AI. A new table, and columns added to help_articles with ADD COLUMN, which changes the
-- schema and no rows. Nothing is rebuilt.
CREATE TABLE `help_draft_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`language` text NOT NULL,
	`collection_id` text,
	`read_website` integer DEFAULT false NOT NULL,
	`links_json` text DEFAULT '[]' NOT NULL,
	`files_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`error_code` text,
	`outline_json` text,
	`planned` integer DEFAULT 0 NOT NULL,
	`failed_json` text DEFAULT '[]' NOT NULL,
	`material_chars` integer DEFAULT 0 NOT NULL,
	`created_by_member_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "help_draft_runs_status_ck" CHECK("help_draft_runs"."status" IN ('uploading','queued','reading','writing','done','failed'))
);
--> statement-breakpoint
CREATE INDEX `help_draft_runs_website_idx` ON `help_draft_runs` (`workspace_id`,`website_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `help_draft_runs_open_idx` ON `help_draft_runs` (`updated_at`) WHERE "help_draft_runs"."status" NOT IN ('done','failed');--> statement-breakpoint
CREATE UNIQUE INDEX `help_draft_runs_tenant_uq` ON `help_draft_runs` (`workspace_id`,`id`);--> statement-breakpoint
ALTER TABLE `help_articles` ADD `draft_run_id` text;--> statement-breakpoint
ALTER TABLE `help_articles` ADD `draft_index` integer;--> statement-breakpoint
ALTER TABLE `help_articles` ADD `ai_drafted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `help_articles` ADD `ai_sources_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `help_articles_draft_uq` ON `help_articles` (`draft_run_id`,`draft_index`) WHERE "help_articles"."draft_run_id" IS NOT NULL;