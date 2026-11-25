-- Counts for published help articles: views, and answers to "Was this helpful?". A new table that only the new
-- Worker reads or writes, so the previous Worker is unaffected. Nothing about a reader is stored.
CREATE TABLE `help_article_stats` (
	`workspace_id` text NOT NULL,
	`article_id` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`helpful` integer DEFAULT 0 NOT NULL,
	`not_helpful` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `article_id`),
	FOREIGN KEY (`workspace_id`,`article_id`) REFERENCES `help_articles`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
