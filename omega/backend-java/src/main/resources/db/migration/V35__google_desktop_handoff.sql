ALTER TABLE omega_rag.google_auth_attempts
    ADD COLUMN desktop BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN callback_code VARCHAR(2048),
    ADD COLUMN callback_canceled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT google_desktop_callback_scope
        CHECK ((desktop OR (callback_code IS NULL AND NOT callback_canceled))
            AND (callback_code IS NULL OR NOT callback_canceled));

-- Reverse
-- ALTER TABLE omega_rag.google_auth_attempts DROP CONSTRAINT google_desktop_callback_scope,
--     DROP COLUMN callback_canceled, DROP COLUMN callback_code, DROP COLUMN desktop;
