-- Account identity is independent of the workspace profile and the purchased plan.
ALTER TABLE omega_rag.tenants ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT 'UNCLASSIFIED'
    CHECK (account_type IN ('INDIVIDUAL', 'ORGANIZATION', 'UNCLASSIFIED'));
ALTER TABLE omega_rag.tenants ADD COLUMN owner_user_id UUID REFERENCES omega_rag.users(id);
-- Only classify historical accounts for which the registration left unambiguous evidence.
UPDATE omega_rag.tenants t SET account_type = 'INDIVIDUAL', owner_user_id = u.id
FROM omega_rag.users u WHERE u.tenant_id = t.id AND u.role = 'ANALYST'
    AND t.name = u.full_name AND (SELECT count(*) FROM omega_rag.users x WHERE x.tenant_id = t.id) = 1
    AND EXISTS (SELECT 1 FROM omega_rag.expedientes e WHERE e.tenant_id = t.id AND e.title = 'Espacio personal');

ALTER TABLE omega_rag.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_code_check;
UPDATE omega_rag.subscriptions SET plan_code = 'FREE' WHERE plan_code = 'PERSONAL';
ALTER TABLE omega_rag.subscriptions ALTER COLUMN plan_code SET DEFAULT 'FREE';
ALTER TABLE omega_rag.subscriptions ADD CHECK (plan_code IN ('FREE','PRO','ENTERPRISE'));
ALTER TABLE omega_rag.subscriptions ADD COLUMN paid_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE omega_rag.subscriptions ADD COLUMN billing_interval VARCHAR(10) NOT NULL DEFAULT 'MONTHLY'
    CHECK (billing_interval IN ('MONTHLY','ANNUAL'));
ALTER TABLE omega_rag.subscriptions ADD COLUMN mp_preapproval_id VARCHAR(100);
ALTER TABLE omega_rag.subscriptions ADD COLUMN source_payment_id VARCHAR(100);
ALTER TABLE omega_rag.subscriptions ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE omega_rag.billing_plans (
    plan_code VARCHAR(24) NOT NULL, interval VARCHAR(10) NOT NULL,
    name VARCHAR(40) NOT NULL, price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'COP', credits INTEGER NOT NULL CHECK (credits >= 0),
    max_devices INTEGER NOT NULL, max_users INTEGER NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY(plan_code, interval)
);
INSERT INTO omega_rag.billing_plans(plan_code,interval,name,price,credits,max_devices,max_users) VALUES
 ('FREE','MONTHLY','Gratis',0,30,1,1),
 ('PRO','MONTHLY','Pro',59900,500,5,1), ('PRO','ANNUAL','Pro',599000,500,5,1),
 ('ENTERPRISE','MONTHLY','Enterprise',299900,3000,25,5), ('ENTERPRISE','ANNUAL','Enterprise',2999000,3000,25,5);

CREATE TABLE omega_rag.billing_checkouts (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id),
    actor_user_id UUID NOT NULL REFERENCES omega_rag.users(id), kind VARCHAR(16) NOT NULL,
    plan_code VARCHAR(24), interval VARCHAR(10), amount NUMERIC(14,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'COP', credits INTEGER NOT NULL DEFAULT 0,
    mp_id VARCHAR(100) UNIQUE, checkout_url TEXT, status VARCHAR(24) NOT NULL DEFAULT 'CREATING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX billing_checkouts_tenant_idx ON omega_rag.billing_checkouts(tenant_id, created_at DESC);
CREATE TABLE omega_rag.billing_payments (
    mp_payment_id VARCHAR(100) PRIMARY KEY, checkout_id UUID NOT NULL REFERENCES omega_rag.billing_checkouts(id),
    tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id), amount NUMERIC(14,2) NOT NULL,
    currency VARCHAR(3) NOT NULL, status VARCHAR(40) NOT NULL,
    approved_at TIMESTAMPTZ, applied BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE omega_rag.billing_events (
    id UUID PRIMARY KEY, dedup_key VARCHAR(64) NOT NULL UNIQUE,
    topic VARCHAR(60) NOT NULL, resource_id VARCHAR(100) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, processed BOOLEAN NOT NULL DEFAULT FALSE,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX billing_events_pending_idx ON omega_rag.billing_events(next_attempt_at) WHERE NOT processed;

CREATE TABLE omega_rag.credit_grants (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id),
    grant_key VARCHAR(200) NOT NULL UNIQUE, source VARCHAR(24) NOT NULL,
    granted INTEGER NOT NULL CHECK (granted >= 0), remaining INTEGER NOT NULL CHECK (remaining >= 0 AND remaining <= granted),
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX credit_grants_balance_idx ON omega_rag.credit_grants(tenant_id,expires_at);
CREATE TABLE omega_rag.credit_reservations (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES omega_rag.tenants(id),
    actor_user_id UUID REFERENCES omega_rag.users(id), operation VARCHAR(50) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0), charged INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CONSUMED','RELEASED')),
    reference VARCHAR(150), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), settled_at TIMESTAMPTZ,
    UNIQUE(tenant_id, reference)
);
CREATE TABLE omega_rag.credit_allocations (
    reservation_id UUID NOT NULL REFERENCES omega_rag.credit_reservations(id),
    grant_id UUID NOT NULL REFERENCES omega_rag.credit_grants(id), amount INTEGER NOT NULL CHECK (amount > 0),
    PRIMARY KEY(reservation_id, grant_id)
);
