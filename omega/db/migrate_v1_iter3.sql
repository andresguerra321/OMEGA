-- Aislamiento por sesión/espacio de trabajo del analista (RNF8)
ALTER TABLE osint_monitored_assets
ADD COLUMN IF NOT EXISTS owner_token VARCHAR(128) NOT NULL DEFAULT 'default_analyst';

ALTER TABLE osint_monitored_assets
DROP CONSTRAINT IF EXISTS osint_monitored_assets_asset_value_key;

ALTER TABLE osint_monitored_assets
DROP CONSTRAINT IF EXISTS uq_osint_owner_asset;

ALTER TABLE osint_monitored_assets
ADD CONSTRAINT uq_osint_owner_asset UNIQUE (owner_token, asset_value);

