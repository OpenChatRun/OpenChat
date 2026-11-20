-- ADR-0023, step 3: the help article a visitor came from, on the conversation they start. ADD COLUMN only: nothing is
-- rebuilt, and the previous Worker never reads or writes it.
ALTER TABLE `conversations` ADD `help_article_id` text;