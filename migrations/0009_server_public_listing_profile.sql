ALTER TABLE linked_servers ADD COLUMN public_short_description TEXT;
ALTER TABLE linked_servers ADD COLUMN public_description TEXT;
ALTER TABLE linked_servers ADD COLUMN public_discord_invite TEXT;
ALTER TABLE linked_servers ADD COLUMN public_website_url TEXT;
ALTER TABLE linked_servers ADD COLUMN public_rules TEXT;
ALTER TABLE linked_servers ADD COLUMN public_language TEXT;
ALTER TABLE linked_servers ADD COLUMN public_region_label TEXT;
ALTER TABLE linked_servers ADD COLUMN public_listing_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_linked_servers_public_listing_updated_at
ON linked_servers(public_listing_updated_at);
