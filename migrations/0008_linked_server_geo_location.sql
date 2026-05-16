ALTER TABLE linked_servers ADD COLUMN geo_latitude REAL;
ALTER TABLE linked_servers ADD COLUMN geo_longitude REAL;
ALTER TABLE linked_servers ADD COLUMN geo_country TEXT;
ALTER TABLE linked_servers ADD COLUMN geo_region TEXT;
ALTER TABLE linked_servers ADD COLUMN geo_city TEXT;
ALTER TABLE linked_servers ADD COLUMN geo_timezone TEXT;
ALTER TABLE linked_servers ADD COLUMN geo_source TEXT;
ALTER TABLE linked_servers ADD COLUMN geo_last_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_linked_servers_geo_location
ON linked_servers(geo_latitude, geo_longitude);

CREATE INDEX IF NOT EXISTS idx_linked_servers_geo_last_checked_at
ON linked_servers(geo_last_checked_at);
