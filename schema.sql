-- Activer pgcrypto pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Organisations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  slug             TEXT        UNIQUE NOT NULL,
  alert_threshold  INT         NOT NULL DEFAULT 3,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Utilisateurs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS leave_requests (
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
CREATE INDEX IF NOT EXISTS idx_users_org        ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_leaves_org       ON leave_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_leaves_user      ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status    ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leaves_dates     ON leave_requests(start_date, end_date);

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
CREATE TABLE IF NOT EXISTS contracts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  nature         TEXT        NOT NULL DEFAULT 'CDI' CHECK (nature IN ('CDI', 'CDD')),
  hours_per_week NUMERIC(4,1) NOT NULL DEFAULT 35,
  -- cp_per_month est fixé par la loi à 2.5j ouvrables/mois (Code du travail art. L3141-3)
  rtt_per_month  NUMERIC(4,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_org ON contracts(org_id);

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
  CHECK (leave_type IN ('paid', 'unpaid', 'rtt', 'remote'));

-- Migration : élargir la contrainte si elle existe déjà avec l'ancienne liste
DO $$ BEGIN
  ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
  ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_leave_type_check
    CHECK (leave_type IN ('paid', 'unpaid', 'rtt', 'remote'));
EXCEPTION WHEN others THEN NULL; END $$;
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

-- ── Plan / tarification ─────────────────────────────────────────────────────
-- free : 1 admin + 4 employés (5 max) — pro : illimité (activé par superadmin)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro'));

-- Migration : élargir les valeurs autorisées pour les nouveaux plans
DO $$ BEGIN
  ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
  ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
    CHECK (plan IN ('free', 'team', 'business', 'enterprise'));
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Période de référence des congés ─────────────────────────────────────────
-- civil     : 1er janvier → 31 décembre
-- reference : 1er juin    → 31 mai (période légale française)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS leave_period TEXT NOT NULL DEFAULT 'civil'
  CHECK (leave_period IN ('civil', 'reference'));

-- ── Mode d'attribution des congés ───────────────────────────────────────────
-- progressive : les jours s'accumulent au fil des mois (2,08 j/mois)
-- advance     : tous les jours sont crédités dès le début de la période
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS leave_grant_mode TEXT NOT NULL DEFAULT 'progressive'
  CHECK (leave_grant_mode IN ('progressive', 'advance'));

-- ── Token de calendrier personnel (abonnement .ics) ─────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);

-- ── Type de décompte des jours de congés ─────────────────────────────────────
-- ouvre    : lundi–vendredi hors jours fériés (25 jours/an)
-- ouvrable : lundi–samedi  hors jours fériés et dimanches (30 jours/an)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS day_count_type TEXT NOT NULL DEFAULT 'ouvre'
  CHECK (day_count_type IN ('ouvre', 'ouvrable'));

-- ── Limites de télétravail par organisation ───────────────────────────────────
-- -1 = illimité ; > 0 = nombre max de jours autorisés
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS remote_max_per_week  INT NOT NULL DEFAULT -1;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS remote_max_per_month INT NOT NULL DEFAULT -1;

-- ── Report de jours non pris (carry-over) ────────────────────────────────────
-- cp_carryover_max     : 0 = désactivé, -1 = illimité, n = nb jours max reportés
-- cp_carryover_expires : mois avant expiration des jours reportés (0 = jamais)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cp_carryover_max      INT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cp_carryover_expires  INT NOT NULL DEFAULT 12;

-- ── Événements familiaux (Art. L3142-1) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_event_types (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key TEXT        NOT NULL,
  label     TEXT        NOT NULL,
  days      NUMERIC(4,1) NOT NULL,
  active    BOOLEAN     NOT NULL DEFAULT true,
  UNIQUE(org_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_family_events_org ON family_event_types(org_id);

-- Clé d'événement sur les demandes (non nulle uniquement si leave_type = 'event')
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS event_key TEXT;

-- Élargir le CHECK leave_type pour inclure 'event'
DO $$ BEGIN
  ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
  ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_leave_type_check
    CHECK (leave_type IN ('paid', 'unpaid', 'rtt', 'remote', 'event'));
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Équipes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  leader_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);
CREATE INDEX IF NOT EXISTS idx_teams_org    ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leader_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);

-- ── Paramètres plateforme (config SMTP, etc.) ────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ── RGPD : date de consentement ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_date TIMESTAMPTZ;
