-- The page a visitor is on now, without its query or fragment, and when their widget said so. The current one
-- only. ADD COLUMN only: nothing is rebuilt, and the previous Worker never reads or writes them.
ALTER TABLE `conversations` ADD `visitor_page_url` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `visitor_page_at` integer;
