ALTER TABLE adm_import_jobs ADD COLUMN import_hit_lines INTEGER DEFAULT 0;
ALTER TABLE adm_import_jobs ADD COLUMN raw_kill_lines_found INTEGER DEFAULT 0;
ALTER TABLE adm_import_jobs ADD COLUMN last_chunk_index INTEGER DEFAULT -1;
ALTER TABLE adm_import_jobs ADD COLUMN failed_chunk_index INTEGER;
