ALTER TABLE visitor ADD COLUMN device TEXT CHECK(device IS NULL OR (json_valid(device) AND length(device) <= 1024));
