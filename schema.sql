-- Activer pgcrypto pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Organisations ──────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  slug             TEXT        UNIQUE NOT NULL,
  alert_threshold  INT         NOT NULL DEFAULT 3,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Utilisateurs ───────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  identifier    TEXT        NOT NULL,          -- ex: EMP001, identifiant de connexion
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  annual_days   INT         NOT NULL DEFAULT 25,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, identifier)
);

-- ── Demandes de congé ──────────────────────────────────────────────────────
CREATE TABLE leave_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  days          NUMERIC(5,1) NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
  comment       TEXT,
  reject_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Index ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_users_org        ON users(org_id);
CREATE INDEX idx_leaves_org       ON leave_requests(org_id);
CREATE INDEX idx_leaves_user      ON leave_requests(user_id);
CREATE INDEX idx_leaves_status    ON leave_requests(status);
CREATE INDEX idx_leaves_dates     ON leave_requests(start_date, end_date);

-- ── Extensions champs organisations ────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS siret            TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_street   TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_city     TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_zip      TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_country  TEXT DEFAULT 'France';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_firstname TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_lastname  TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email     TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_data         TEXT; -- base64 data URL

-- ── Contrats ────────────────────────────────────────────────────────────────
CREATE TABLE contracts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  nature         TEXT        NOT NULL DEFAULT 'CDI' CHECK (nature IN ('CDI', 'CDD')),
  hours_per_week NUMERIC(4,1) NOT NULL DEFAULT 35,
  -- cp_per_month est fixé par la loi à 2.5j ouvrables/mois (Code du travail art. L3141-3)
  rtt_per_month  NUMERIC(4,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contracts_org ON contracts(org_id);

-- ── Extensions champs utilisateurs ─────────────────────────────────────────
-- annual_days fixé à 30 (2.5j × 12 mois) — règle légale française non modifiable
ALTER TABLE users ALTER COLUMN annual_days SET DEFAULT 30;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firstname       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lastname        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address_street  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address_city    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address_zip     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address_country TEXT DEFAULT 'France';
ALTER TABLE users ADD COLUMN IF NOT EXISTS entry_date      DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_id     UUID REFERENCES contracts(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cp_balance      NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rtt_balance     NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_accumulate BOOLEAN     NOT NULL DEFAULT true;

-- ── Extension contact organisation ──────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- ── Congés sans solde ───────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allow_unpaid_leave          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allow_unpaid_when_exhausted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_type TEXT NOT NULL DEFAULT 'paid'
  CHECK (leave_type IN ('paid', 'unpaid', 'rtt'));
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS period TEXT NOT NULL DEFAULT 'full'
  CHECK (period IN ('full', 'am', 'pm'));

-- ── Tokens de réinitialisation de mot de passe ───────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user  ON password_reset_tokens(user_id);

-- ── Taille du logo dans le header ───────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_size TEXT NOT NULL DEFAULT 'M' CHECK (logo_size IN ('S', 'M', 'L'));

-- ── Chiffrement des données personnelles ────────────────────────────────────
-- email_hmac : HMAC-SHA256 de l'email (minuscule) — permet la recherche login
--              sans déchiffrer ; NULL si pas de clef HMAC configurée.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hmac TEXT;
CREATE INDEX IF NOT EXISTS idx_users_email_hmac ON users(org_id, email_hmac);

-- ── Notifications email par organisation ─────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_leaves     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_on_submit  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_on_approve BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_on_reject  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_admin_new  BOOLEAN NOT NULL DEFAULT true;

-- ── Paramètres plateforme (config SMTP, etc.) ────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
