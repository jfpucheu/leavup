import express        from 'express';
import cors           from 'cors';
import bcrypt         from 'bcryptjs';
import jwt            from 'jsonwebtoken';
import pg             from 'pg';
import dotenv         from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// ── Helpers ────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
const SUPER_PW   = process.env.SUPER_PASSWORD || 'superadmin';

function sign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

// ── Middleware auth ────────────────────────────────────────────────────────

/**
 * auth(roles) — vérifie le token JWT et restreint par rôle.
 * roles vide = tous les rôles authentifiés.
 */
function auth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Non authentifié' });
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.user = payload;
      if (roles.length && !roles.includes(payload.role))
        return res.status(403).json({ error: 'Accès interdit' });
      next();
    } catch {
      res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  };
}

// ── Auth ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { orgSlug?, identifier, password }
 *   - orgSlug absent → tentative superadmin
 *   - orgSlug présent → utilisateur de l'organisation
 */
app.post('/api/auth/login', async (req, res) => {
  const { orgSlug, identifier, password } = req.body;

  // Superadmin (pas d'org)
  if (!orgSlug) {
    if (identifier === 'superadmin' && password === SUPER_PW) {
      const token = sign({ id: 'superadmin', role: 'superadmin' });
      return res.json({
        token,
        user: { id: 'superadmin', name: 'Super Admin', role: 'superadmin' },
      });
    }
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  // Trouver l'organisation
  const { rows: orgs } = await pool.query(
    'SELECT * FROM organizations WHERE slug = $1', [orgSlug.toLowerCase()]
  );
  if (!orgs.length)
    return res.status(404).json({ error: 'Organisation introuvable' });
  const org = orgs[0];

  // Trouver l'utilisateur
  const { rows: users } = await pool.query(
    'SELECT * FROM users WHERE org_id = $1 AND identifier = $2',
    [org.id, identifier.trim().toUpperCase()]
  );
  if (!users.length)
    return res.status(401).json({ error: 'Identifiants invalides' });
  const user = users[0];

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Identifiants invalides' });

  const token = sign({ id: user.id, orgId: org.id, role: user.role });
  res.json({
    token,
    user: {
      id:          user.id,
      identifier:  user.identifier,
      name:        user.name,
      role:        user.role,
      annualDays:  user.annual_days,
    },
    org: {
      id:             org.id,
      name:           org.name,
      slug:           org.slug,
      alertThreshold: org.alert_threshold,
    },
  });
});

// ── Organisations (superadmin) ─────────────────────────────────────────────

app.get('/api/orgs', auth(['superadmin']), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      o.*,
      (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id)         AS user_count,
      (SELECT COUNT(*) FROM leave_requests lr WHERE lr.org_id = o.id
       AND lr.status = 'pending')                                   AS pending_count
    FROM organizations o
    ORDER BY o.created_at DESC
  `);
  res.json(rows);
});

app.post('/api/orgs', auth(['superadmin']), async (req, res) => {
  const {
    name, slug,
    adminIdentifier = 'ADMIN',
    adminPassword,
    alertThreshold = 3
  } = req.body;

  if (!name || !slug || !adminPassword)
    return res.status(400).json({ error: 'Champs obligatoires : name, slug, adminPassword' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (name, slug, alert_threshold)
       VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), slug.trim().toLowerCase(), alertThreshold]
    );
    const hash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO users (org_id, identifier, name, password_hash, role, annual_days)
       VALUES ($1, $2, $3, $4, 'admin', 0)`,
      [org.id, adminIdentifier.toUpperCase(), 'Administrateur', hash]
    );
    await client.query('COMMIT');
    res.status(201).json(org);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505')
      return res.status(409).json({ error: 'Ce slug est déjà utilisé' });
    throw e;
  } finally {
    client.release();
  }
});

app.put('/api/orgs/:id', auth(['superadmin']), async (req, res) => {
  const { name, alertThreshold } = req.body;
  const { rows: [org] } = await pool.query(
    `UPDATE organizations SET name = $1, alert_threshold = $2
     WHERE id = $3 RETURNING *`,
    [name, alertThreshold, req.params.id]
  );
  if (!org) return res.status(404).json({ error: 'Organisation introuvable' });
  res.json(org);
});

app.delete('/api/orgs/:id', auth(['superadmin']), async (req, res) => {
  await pool.query('DELETE FROM organizations WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── Utilisateurs ───────────────────────────────────────────────────────────

app.get('/api/users', auth(['admin']), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       u.id, u.identifier, u.name, u.role, u.annual_days, u.created_at,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'approved'), 0) AS taken_days
     FROM users u
     LEFT JOIN leave_requests lr ON lr.user_id = u.id
     WHERE u.org_id = $1
     GROUP BY u.id
     ORDER BY u.name`,
    [req.user.orgId]
  );
  res.json(rows);
});

app.post('/api/users', auth(['admin']), async (req, res) => {
  const { identifier, name, password, role = 'employee', annualDays = 25 } = req.body;
  if (!identifier || !name || !password)
    return res.status(400).json({ error: 'identifier, name et password sont obligatoires' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (org_id, identifier, name, password_hash, role, annual_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, identifier, name, role, annual_days`,
      [req.user.orgId, identifier.trim().toUpperCase(), name.trim(), hash, role, annualDays]
    );
    res.status(201).json({ ...user, taken_days: 0 });
  } catch (e) {
    if (e.code === '23505')
      return res.status(409).json({ error: 'Cet identifiant est déjà utilisé' });
    throw e;
  }
});

app.put('/api/users/:id', auth(['admin']), async (req, res) => {
  const { name, annualDays, password } = req.body;
  let q, p;
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    q = `UPDATE users SET name=$1, annual_days=$2, password_hash=$3
         WHERE id=$4 AND org_id=$5
         RETURNING id, identifier, name, role, annual_days`;
    p = [name, annualDays, hash, req.params.id, req.user.orgId];
  } else {
    q = `UPDATE users SET name=$1, annual_days=$2
         WHERE id=$3 AND org_id=$4
         RETURNING id, identifier, name, role, annual_days`;
    p = [name, annualDays, req.params.id, req.user.orgId];
  }
  const { rows: [user] } = await pool.query(q, p);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

app.delete('/api/users/:id', auth(['admin']), async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM users WHERE id=$1 AND org_id=$2 AND role != $3',
    [req.params.id, req.user.orgId, 'admin']
  );
  if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable ou suppression admin interdite' });
  res.json({ ok: true });
});

// ── Congés ─────────────────────────────────────────────────────────────────

const LEAVE_SELECT = `
  SELECT
    lr.*,
    u.name       AS employee_name,
    u.identifier AS employee_identifier
  FROM leave_requests lr
  JOIN users u ON u.id = lr.user_id
`;

app.get('/api/leaves', auth(['admin', 'employee']), async (req, res) => {
  let q = LEAVE_SELECT + ' WHERE lr.org_id = $1';
  let p = [req.user.orgId];
  if (req.user.role === 'employee') {
    q += ' AND lr.user_id = $2';
    p.push(req.user.id);
  }
  q += ' ORDER BY lr.created_at DESC';
  const { rows } = await pool.query(q, p);
  res.json(rows);
});

app.post('/api/leaves', auth(['employee']), async (req, res) => {
  const { startDate, endDate, days, comment } = req.body;
  if (!startDate || !endDate || !days)
    return res.status(400).json({ error: 'startDate, endDate et days sont obligatoires' });

  // Vérifier le solde
  const { rows: [bal] } = await pool.query(
    `SELECT
       u.annual_days,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'approved'), 0) AS taken
     FROM users u
     LEFT JOIN leave_requests lr ON lr.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.annual_days`,
    [req.user.id]
  );
  if (!bal || (bal.annual_days - parseInt(bal.taken)) < days)
    return res.status(400).json({ error: 'Solde de congés insuffisant' });

  const { rows: [leave] } = await pool.query(
    `INSERT INTO leave_requests (org_id, user_id, start_date, end_date, days, comment)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.orgId, req.user.id, startDate, endDate, days, comment || null]
  );
  res.status(201).json(leave);
});

app.put('/api/leaves/:id/approve', auth(['admin']), async (req, res) => {
  const { rows: [leave] } = await pool.query(
    `UPDATE leave_requests SET status = 'approved'
     WHERE id = $1 AND org_id = $2 AND status = 'pending'
     RETURNING *`,
    [req.params.id, req.user.orgId]
  );
  if (!leave) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });
  res.json(leave);
});

app.put('/api/leaves/:id/reject', auth(['admin']), async (req, res) => {
  const { rejectReason } = req.body;
  const { rows: [leave] } = await pool.query(
    `UPDATE leave_requests SET status = 'rejected', reject_reason = $1
     WHERE id = $2 AND org_id = $3 AND status = 'pending'
     RETURNING *`,
    [rejectReason || null, req.params.id, req.user.orgId]
  );
  if (!leave) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });
  res.json(leave);
});

// ── Paramètres de l'organisation ───────────────────────────────────────────

app.get('/api/settings', auth(['admin']), async (req, res) => {
  const { rows: [org] } = await pool.query(
    'SELECT name, slug, alert_threshold FROM organizations WHERE id = $1',
    [req.user.orgId]
  );
  res.json({ name: org.name, slug: org.slug, alertThreshold: org.alert_threshold });
});

app.put('/api/settings', auth(['admin']), async (req, res) => {
  const { alertThreshold } = req.body;
  if (!alertThreshold || alertThreshold < 1)
    return res.status(400).json({ error: 'Seuil invalide' });
  await pool.query(
    'UPDATE organizations SET alert_threshold = $1 WHERE id = $2',
    [alertThreshold, req.user.orgId]
  );
  res.json({ alertThreshold });
});

// ── Profil courant ─────────────────────────────────────────────────────────

app.get('/api/me', auth(['admin', 'employee']), async (req, res) => {
  const { rows: [user] } = await pool.query(
    `SELECT
       u.id, u.identifier, u.name, u.role, u.annual_days,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'approved'), 0) AS taken_days
     FROM users u
     LEFT JOIN leave_requests lr ON lr.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ ...user, taken_days: parseInt(user.taken_days) });
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Gestion des erreurs ────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀  API démarrée sur http://localhost:${PORT}`);
});
