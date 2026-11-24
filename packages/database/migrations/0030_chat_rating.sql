-- What a visitor said of a resolved conversation: good or bad, a comment if they left one, and when. One per
-- conversation. ADD COLUMN only: nothing is rebuilt, and the previous Worker never reads or writes them. The CHECK is
-- written here by hand, as in 0017, because declaring it in the schema would make Drizzle rebuild the table.
ALTER TABLE `conversations` ADD `visitor_rating` text CONSTRAINT `conversations_visitor_rating_ck` CHECK (`visitor_rating` IN ('good', 'bad'));--> statement-breakpoint
ALTER TABLE `conversations` ADD `visitor_rating_comment` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `visitor_rated_at` integer;
