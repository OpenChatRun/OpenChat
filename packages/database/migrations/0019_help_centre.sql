-- ADR-0023, step 1: the help centre. New tables, and columns added to websites with ADD COLUMN, which changes the
-- schema and no rows. Nothing is rebuilt.
CREATE TABLE `help_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`collection_id` text,
	`translation_group_id` text NOT NULL,
	`language` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`body_markdown` text DEFAULT '' NOT NULL,
	`body_html` text DEFAULT '' NOT NULL,
	`search_title` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`published_at` integer,
	`updated_by_member_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`collection_id`) REFERENCES `help_collections`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "help_articles_status_ck" CHECK("help_articles"."status" IN ('draft','published')),
	CONSTRAINT "help_articles_published_ck" CHECK(("help_articles"."status" = 'published') = ("help_articles"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `help_articles_website_idx` ON `help_articles` (`workspace_id`,`website_id`);--> statement-breakpoint
CREATE INDEX `help_articles_public_idx` ON `help_articles` (`website_id`,`language`,`status`);--> statement-breakpoint
CREATE INDEX `help_articles_collection_idx` ON `help_articles` (`workspace_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `help_articles_group_idx` ON `help_articles` (`workspace_id`,`translation_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `help_articles_tenant_uq` ON `help_articles` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `help_articles_slug_uq` ON `help_articles` (`website_id`,`language`,`slug`);--> statement-breakpoint
CREATE TABLE `help_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`filename` text NOT NULL,
	`created_by_member_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "help_assets_type_ck" CHECK("help_assets"."content_type" IN ('image/png','image/jpeg','image/gif','image/webp'))
);
--> statement-breakpoint
CREATE INDEX `help_assets_website_idx` ON `help_assets` (`workspace_id`,`website_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `help_assets_tenant_uq` ON `help_assets` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `help_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`language` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`website_id`) REFERENCES `websites`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `help_collections_website_idx` ON `help_collections` (`workspace_id`,`website_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `help_collections_tenant_uq` ON `help_collections` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `help_collections_slug_uq` ON `help_collections` (`website_id`,`language`,`slug`);--> statement-breakpoint
ALTER TABLE `websites` ADD `help_slug` text;--> statement-breakpoint
ALTER TABLE `websites` ADD `help_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `websites` ADD `help_noindex` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `websites_help_slug_uq` ON `websites` (`help_slug`) WHERE "websites"."help_slug" IS NOT NULL;