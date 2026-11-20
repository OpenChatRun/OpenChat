-- ADR-0024, step 1: the visitor's language on the conversation, and the language a member reads. ADD COLUMN only:
-- nothing is rebuilt, and the previous Worker never reads or writes them.
ALTER TABLE `conversations` ADD `visitor_language` text;--> statement-breakpoint
ALTER TABLE `users` ADD `language` text;
