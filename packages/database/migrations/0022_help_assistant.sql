-- ADR-0023, step 4: published help articles as an assistant source. A new table and two added columns: nothing is
-- rebuilt, and the previous Worker neither reads nor writes them.
CREATE TABLE `help_article_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`website_id` text NOT NULL,
	`article_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`article_id`) REFERENCES `help_articles`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `help_article_chunks_article_idx` ON `help_article_chunks` (`workspace_id`,`article_id`);--> statement-breakpoint
ALTER TABLE `help_articles` ADD `indexed_version` integer;--> statement-breakpoint
ALTER TABLE `help_articles` ADD `indexed_chunks` integer DEFAULT 0 NOT NULL;