-- ADR-0024, step 3: a member's reply sent translated says which language they wrote it in; what they wrote is kept in
-- message_translations. ADD COLUMN only: nothing is rebuilt, and the previous Worker never reads or writes it.
ALTER TABLE `messages` ADD `original_language` text;