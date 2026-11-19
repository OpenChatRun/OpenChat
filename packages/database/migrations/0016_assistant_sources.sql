-- ADR-0022, step 1: the AI assistant's settings, sources, chunks and usage. New tables only, so the previous Worker
-- is unaffected.

CREATE TABLE `assistant_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`source_id`) REFERENCES `assistant_sources`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_chunks_source_idx` ON `assistant_chunks` (`workspace_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `assistant_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_settings_tenant_uq` ON `assistant_settings` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_settings_website_uq` ON `assistant_settings` (`workspace_id`,`website_id`);--> statement-breakpoint
CREATE TABLE `assistant_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`content` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_code` text,
	`generation` integer DEFAULT 1 NOT NULL,
	`indexed_generation` integer,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`indexed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_sources_kind_ck" CHECK("assistant_sources"."kind" IN ('page','text')),
	CONSTRAINT "assistant_sources_status_ck" CHECK("assistant_sources"."status" IN ('pending','indexing','ready','failed')),
	CONSTRAINT "assistant_sources_shape_ck" CHECK(("assistant_sources"."kind" = 'page') = ("assistant_sources"."url" IS NOT NULL) AND ("assistant_sources"."kind" = 'text') = ("assistant_sources"."content" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `assistant_sources_website_idx` ON `assistant_sources` (`workspace_id`,`website_id`);--> statement-breakpoint
CREATE INDEX `assistant_sources_refresh_idx` ON `assistant_sources` (`indexed_at`) WHERE "assistant_sources"."kind" = 'page';--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_sources_tenant_uq` ON `assistant_sources` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `assistant_usage` (
	`workspace_id` text NOT NULL,
	`day` text NOT NULL,
	`answers` integer DEFAULT 0 NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`chunks` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `day`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
