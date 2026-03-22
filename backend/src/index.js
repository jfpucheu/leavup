import express        from 'express';
import cors           from 'cors';
import bcrypt         from 'bcryptjs';
import jwt            from 'jsonwebtoken';
import pg             from 'pg';
import dotenv         from 'dotenv';
import crypto         from 'crypto';
import nodemailer     from 'nodemailer';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// ── Helpers ────────────────────────────────────────────────────────────────

const JWT_SECRET      = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
const SUPER_PW        = process.env.SUPER_PASSWORD || 'superadmin';
const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'leavup.com';

// ── Chiffrement AES-256-GCM des données personnelles ────────────────────────

const ENC_KEY  = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : null;
const HMAC_KEY = process.env.HMAC_KEY || null;

if (ENC_KEY && ENC_KEY.length !== 32)
  throw new Error('ENCRYPTION_KEY doit faire 64 caractères hexadécimaux (32 octets)');

/** Chiffre une valeur texte → "<iv>:<ct>:<tag>" (base64) ou null */
function encrypt(text) {
  if (text === null || text === undefined) return null;
  if (!ENC_KEY) return String(text);
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct     = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

/** Déchiffre une valeur chiffrée, retourne la valeur telle quelle si non chiffrée */
function decrypt(val) {
  if (val === null || val === undefined) return null;
  if (!ENC_KEY) return val;
  const parts = String(val).split(':');
  if (parts.length !== 3) return val; // donnée non chiffrée (migration)
  try {
    const [ivB64, ctB64, tagB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(ctB64, 'base64')) + decipher.final('utf8');
  } catch { return val; }
}

/** HMAC-SHA256 de l'email (minuscule) pour la recherche login sans déchiffrement */
function emailHmac(email) {
  if (!email || !HMAC_KEY) return null;
  return crypto.createHmac('sha256', HMAC_KEY).update(email.toLowerCase()).digest('hex');
}

const USER_PII = ['name', 'firstname', 'lastname', 'phone', 'email',
                  'address_street', 'address_city', 'address_zip', 'address_country'];
const ORG_PII  = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone'];

function encryptFields(obj, fields) {
  const out = { ...obj };
  for (const f of fields) if (f in out) out[f] = encrypt(out[f]);
  return out;
}
function decryptFields(obj, fields) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const f of fields) if (f in out) out[f] = decrypt(out[f]);
  return out;
}

const encryptUser = obj => encryptFields(obj, USER_PII);
const decryptUser = obj => decryptFields(obj, USER_PII);
const encryptOrg  = obj => encryptFields(obj, ORG_PII);
const decryptOrg  = obj => decryptFields(obj, ORG_PII);

// ── Email / SMTP ────────────────────────────────────────────────────────────

async function getSmtpConfig() {
  const { rows } = await pool.query(
    "SELECT key, value FROM platform_settings WHERE key LIKE 'smtp_%'"
  );
  const db = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    host:   db.smtp_host   || process.env.SMTP_HOST   || null,
    port:   parseInt(db.smtp_port || process.env.SMTP_PORT || '587'),
    secure: (db.smtp_secure || process.env.SMTP_SECURE || 'false') === 'true',
    user:   db.smtp_user   || process.env.SMTP_USER   || null,
    pass:   db.smtp_pass   || process.env.SMTP_PASS   || null,
    from:   db.smtp_from   || process.env.SMTP_FROM   || null,
  };
}

async function getTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg.host || !cfg.user) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

async function generateResetToken(userId) {
  // Invalide les anciens tokens non utilisés
  await pool.query(
    "UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false",
    [userId]
  );
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
  await pool.query(
    "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [userId, token, expiresAt]
  );
  return token;
}

function buildResetUrl(orgSlug, token) {
  const base = process.env.NODE_ENV === 'production'
    ? `https://${orgSlug}.${PLATFORM_DOMAIN}`
    : (process.env.FRONTEND_URL || `http://localhost:5173`);
  return `${base}?token=${token}`;
}

// ── Templates email ─────────────────────────────────────────────────────────

function emailBase(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f9ff;margin:0;padding:24px}
  .card{background:white;border-radius:12px;padding:36px;max-width:520px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .logo{font-size:22px;font-weight:800;color:#0f172a;margin-bottom:28px;letter-spacing:-.02em}
  .logo span{color:#0ea5e9}
  h1{font-size:18px;font-weight:600;margin:0 0 12px;color:#111}
  p{font-size:14px;color:#555;line-height:1.7;margin:0 0 12px}
  hr{border:none;border-top:1px solid #eee;margin:24px 0}
  .lbl{font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  .val{font-size:14px;color:#111;background:#f8f8f8;padding:8px 12px;border-radius:6px;margin-bottom:14px;word-break:break-all}
  .val-mono{font-family:'Courier New',monospace}
  .btn{display:inline-block;background:linear-gradient(135deg,#0f172a,#1d4ed8);color:white;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;margin-top:4px}
  .approved{color:#059669;font-weight:700} .rejected{color:#dc2626;font-weight:700} .pending{color:#d97706;font-weight:700}
  .footer{font-size:12px;color:#bbb;margin-top:28px;text-align:center}
</style></head><body>
<div class="card">
  <div class="logo">Leav<span>up</span></div>
  ${content}
  <div class="footer">Leavup — Gestion des absences simplifiée</div>
</div></body></html>`;
}

function fmtDateEmail(d) {
  return new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
}
function leaveTypeLabel(t) {
  return t === 'rtt' ? 'RTT' : t === 'unpaid' ? 'Sans solde' : 'Congé payé';
}

function emailWelcomeHtml({ firstname, lastname, adminName, platformUrl, identifier, password, resetUrl }) {
  return emailBase(`
    <h1>Bienvenue sur Leavup !</h1>
    <p>Bonjour <strong>${firstname} ${lastname}</strong>,</p>
    <p>${adminName ? `Votre responsable <strong>${adminName}</strong> vous a` : 'Un'} compte a été créé sur <strong>Leavup</strong>, l'application de gestion des absences.</p>
    <hr>
    <div class="lbl">Adresse de connexion</div><div class="val">${platformUrl}</div>
    <div class="lbl">Identifiant</div><div class="val val-mono">${identifier}</div>
    <div class="lbl">Mot de passe provisoire</div><div class="val val-mono">${password}</div>
    <hr>
    <p>Merci de changer votre mot de passe dès votre première connexion.</p>
    <a href="${resetUrl}" class="btn">→ Accéder à Leavup</a>
  `);
}

function emailLeaveSubmittedEmployeeHtml({ firstname, days, startDate, endDate, leaveType, appUrl }) {
  return emailBase(`
    <h1>Demande d'absence reçue</h1>
    <p>Bonjour <strong>${firstname}</strong>,</p>
    <p>Votre demande d'absence a bien été enregistrée. Elle est <span class="pending">en attente de validation</span>.</p>
    <hr>
    <div class="lbl">Type</div><div class="val">${leaveTypeLabel(leaveType)}</div>
    <div class="lbl">Du</div><div class="val">${fmtDateEmail(startDate)}</div>
    <div class="lbl">Au</div><div class="val">${fmtDateEmail(endDate)}</div>
    <div class="lbl">Durée</div><div class="val">${days} jour${days > 1 ? 's' : ''}</div>
    <hr>
    <p>Vous serez notifié(e) dès que votre responsable aura traité votre demande.</p>
    <a href="${appUrl}" class="btn">→ Voir ma demande</a>
  `);
}

function emailLeaveSubmittedAdminHtml({ employeeName, days, startDate, endDate, leaveType, appUrl }) {
  return emailBase(`
    <h1>Nouvelle demande d'absence</h1>
    <p><strong>${employeeName}</strong> a soumis une demande d'absence en attente de votre validation.</p>
    <hr>
    <div class="lbl">Salarié</div><div class="val">${employeeName}</div>
    <div class="lbl">Type</div><div class="val">${leaveTypeLabel(leaveType)}</div>
    <div class="lbl">Du</div><div class="val">${fmtDateEmail(startDate)}</div>
    <div class="lbl">Au</div><div class="val">${fmtDateEmail(endDate)}</div>
    <div class="lbl">Durée</div><div class="val">${days} jour${days > 1 ? 's' : ''}</div>
    <hr>
    <a href="${appUrl}" class="btn">→ Valider la demande</a>
  `);
}

function emailLeaveApprovedHtml({ firstname, days, startDate, endDate, leaveType, appUrl }) {
  return emailBase(`
    <h1>Demande d'absence approuvée</h1>
    <p>Bonjour <strong>${firstname}</strong>,</p>
    <p>Votre demande d'absence a été <span class="approved">approuvée ✓</span>.</p>
    <hr>
    <div class="lbl">Type</div><div class="val">${leaveTypeLabel(leaveType)}</div>
    <div class="lbl">Du</div><div class="val">${fmtDateEmail(startDate)}</div>
    <div class="lbl">Au</div><div class="val">${fmtDateEmail(endDate)}</div>
    <div class="lbl">Durée</div><div class="val">${days} jour${days > 1 ? 's' : ''}</div>
    <hr>
    <a href="${appUrl}" class="btn">→ Voir mon planning</a>
  `);
}

function emailLeaveRejectedHtml({ firstname, days, startDate, endDate, leaveType, rejectReason, appUrl }) {
  return emailBase(`
    <h1>Demande d'absence refusée</h1>
    <p>Bonjour <strong>${firstname}</strong>,</p>
    <p>Votre demande d'absence a été <span class="rejected">refusée</span>.</p>
    <hr>
    <div class="lbl">Type</div><div class="val">${leaveTypeLabel(leaveType)}</div>
    <div class="lbl">Du</div><div class="val">${fmtDateEmail(startDate)}</div>
    <div class="lbl">Au</div><div class="val">${fmtDateEmail(endDate)}</div>
    <div class="lbl">Durée</div><div class="val">${days} jour${days > 1 ? 's' : ''}</div>
    ${rejectReason ? `<div class="lbl">Motif</div><div class="val">${rejectReason}</div>` : ''}
    <hr>
    <a href="${appUrl}" class="btn">→ Voir mon historique</a>
  `);
}

async function sendMail(to, subject, html) {
  const transporter = await getTransporter();
  if (!transporter) { console.warn('SMTP non configuré — email non envoyé'); return; }
  const cfg = await getSmtpConfig();
  const from = `"Leavup" <${cfg.from || `noreply@${PLATFORM_DOMAIN}`}>`;
  await transporter.sendMail({ from, to, subject, html });
}

async function sendWelcomeEmail({ user, org, adminName, plainPassword }) {
  if (!user.email) return;
  try {
    const token = await generateResetToken(user.id);
    const resetUrl = buildResetUrl(org.slug, token);
    const platformUrl = process.env.NODE_ENV === 'production'
      ? `https://${org.slug}.${PLATFORM_DOMAIN}`
      : resetUrl.split('?')[0];
    await sendMail(
      user.email,
      'Bienvenue sur Leavup — votre compte est prêt',
      emailWelcomeHtml({
        firstname: user.firstname || '', lastname: user.lastname || '',
        adminName: adminName || '', platformUrl,
        identifier: user.identifier, password: plainPassword, resetUrl,
      })
    );
  } catch (err) { console.error('Erreur email welcome:', err); }
}

async function sendLeaveEmails(type, { leave, employee, adminEmail, appUrl, notifyEmployee = true }) {
  const fn = employee.firstname || employee.name || '';
  const leaveData = { days: leave.days, startDate: leave.start_date, endDate: leave.end_date, leaveType: leave.leave_type };
  try {
    if (type === 'submitted') {
      if (notifyEmployee && employee.email)
        await sendMail(employee.email, "Votre demande d'absence a été reçue",
          emailLeaveSubmittedEmployeeHtml({ firstname: fn, ...leaveData, appUrl }));
      if (adminEmail) {
        const name = [employee.firstname, employee.lastname].filter(Boolean).join(' ') || employee.name;
        await sendMail(adminEmail, `Nouvelle demande d'absence — ${name}`,
          emailLeaveSubmittedAdminHtml({ employeeName: name, ...leaveData, appUrl }));
      }
    } else if (type === 'approved') {
      if (employee.email)
        await sendMail(employee.email, "Votre demande d'absence a été approuvée",
          emailLeaveApprovedHtml({ firstname: fn, ...leaveData, appUrl }));
    } else if (type === 'rejected') {
      if (employee.email)
        await sendMail(employee.email, "Votre demande d'absence a été refusée",
          emailLeaveRejectedHtml({ firstname: fn, ...leaveData, rejectReason: leave.reject_reason, appUrl }));
    }
  } catch (err) { console.error('Erreur email leave:', err); }
}

/**
 * Calcule les CP acquis depuis la date d'entrée.
 * Règle légale : 2,5 j ouvrables par mois travaillé, plafonné à 30j/an.
 * Si pas de date d'entrée → on considère le plafond annuel (30j).
 * @param {string|Date|null} entryDate
 * @returns {number}
 */
function computeAccruedCP(entryDate) {
  if (!entryDate) return 0;
  const entry = new Date(entryDate);
  const now   = new Date();
  if (entry > now) return 0;
  const months =
    (now.getFullYear() - entry.getFullYear()) * 12 +
    (now.getMonth() - entry.getMonth()) +
    (now.getDate() >= entry.getDate() ? 0 : -1);
  // 2.5j × mois complets, plafonné à 30j
  return Math.min(30, Math.max(0, months) * 2.5);
}

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

  // Trouver l'utilisateur — par identifiant ou email (via HMAC si chiffrement actif)
  const login = identifier.trim();
  const hmac  = emailHmac(login); // null si pas de HMAC_KEY configuré
  const { rows: users } = await pool.query(
    `SELECT * FROM users WHERE org_id = $1 AND (
       identifier = $2
       OR ($3::text IS NOT NULL AND email_hmac = $3)
       OR ($3::text IS NULL AND email IS NOT NULL AND lower(email) = $4)
     )`,
    [org.id, login.toUpperCase(), hmac, login.toLowerCase()]
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
      id:                      org.id,
      name:                    org.name,
      slug:                    org.slug,
      alertThreshold:          org.alert_threshold,
      logoData:                org.logo_data || null,
      logoSize:                org.logo_size || 'M',
      siret:                   org.siret || null,
      contactFirstname:        org.contact_firstname || null,
      contactLastname:         org.contact_lastname  || null,
      contactEmail:            org.contact_email     || null,
      allowUnpaidLeave:        org.allow_unpaid_leave         || false,
      allowUnpaidWhenExhausted:org.allow_unpaid_when_exhausted|| false,
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
       AND lr.status = 'pending')                                   AS pending_count,
      a.id         AS admin_id,
      a.identifier AS admin_identifier,
      a.firstname  AS admin_firstname,
      a.lastname   AS admin_lastname,
      a.email      AS admin_email
    FROM organizations o
    LEFT JOIN users a ON a.org_id = o.id AND a.role = 'admin'
    ORDER BY o.created_at DESC
  `);
  res.json(rows.map(r => ({
    ...decryptOrg(r),
    admin_firstname: decrypt(r.admin_firstname),
    admin_lastname:  decrypt(r.admin_lastname),
    admin_email:     decrypt(r.admin_email),
  })));
});

app.post('/api/orgs', auth(['superadmin']), async (req, res) => {
  const {
    name, slug,
    adminFirstname, adminLastname, adminEmail = null, adminPhone = null, adminIdentifier,
    adminPassword,
    siret         = null,
    addressStreet = null,
    addressCity   = null,
    addressZip    = null,
    addressCountry= 'France',
    logoData      = null,
  } = req.body;

  if (!name || !slug || !adminPassword || !adminFirstname || !adminLastname || !adminIdentifier)
    return res.status(400).json({ error: 'Champs obligatoires : name, slug, prénom/nom/identifiant admin, adminPassword' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const encContact = encryptOrg({
      contact_firstname: adminFirstname, contact_lastname: adminLastname,
      contact_email: adminEmail, contact_phone: adminPhone,
    });
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations
         (name, slug, alert_threshold,
          siret, address_street, address_city, address_zip, address_country,
          contact_firstname, contact_lastname, contact_email, contact_phone, logo_data)
       VALUES ($1,$2,3, $3,$4,$5,$6,$7, $8,$9,$10,$11,$12)
       RETURNING *`,
      [name.trim(), slug.trim().toLowerCase(),
       siret, addressStreet, addressCity, addressZip, addressCountry,
       encContact.contact_firstname, encContact.contact_lastname,
       encContact.contact_email, encContact.contact_phone, logoData]
    );
    const hash = await bcrypt.hash(adminPassword, 10);
    const fullName = [adminFirstname, adminLastname].filter(Boolean).join(' ').trim();
    const encAdmin = encryptUser({ name: fullName, firstname: adminFirstname.trim(), lastname: adminLastname.trim(), email: adminEmail || null });
    await client.query(
      `INSERT INTO users (org_id, identifier, name, firstname, lastname, email, email_hmac, password_hash, role, annual_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'admin', 30)`,
      [org.id, adminIdentifier.toUpperCase(), encAdmin.name, encAdmin.firstname, encAdmin.lastname,
       encAdmin.email, emailHmac(adminEmail), hash]
    );
    await client.query('COMMIT');
    res.status(201).json(org);

    // Welcome email à l'admin
    if (adminEmail) {
      const adminUser = { id: null, firstname: adminFirstname, lastname: adminLastname,
        email: adminEmail, identifier: adminIdentifier.toUpperCase() };
      // Récupère l'id du user admin pour le reset token
      pool.query('SELECT id FROM users WHERE org_id = $1 AND role = $2', [org.id, 'admin'])
        .then(({ rows: [u] }) => {
          if (u) sendWelcomeEmail({ user: { ...adminUser, id: u.id }, org, adminName: 'Leavup', plainPassword: adminPassword });
        }).catch(e => console.error('Welcome email admin:', e));
    }
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
  const {
    name,
    siret, addressStreet, addressCity, addressZip, addressCountry, logoData,
    adminFirstname, adminLastname, adminEmail, adminPhone, adminPassword,
  } = req.body;
  const encContact = encryptOrg({
    contact_firstname: adminFirstname || null, contact_lastname: adminLastname || null,
    contact_email: adminEmail || null, contact_phone: adminPhone || null,
  });
  const { rows: [org] } = await pool.query(
    `UPDATE organizations SET
       name=$1,
       siret=$2, address_street=$3, address_city=$4, address_zip=$5, address_country=$6,
       contact_firstname=$7, contact_lastname=$8, contact_email=$9, contact_phone=$10, logo_data=$11
     WHERE id=$12 RETURNING *`,
    [name, siret, addressStreet, addressCity, addressZip, addressCountry,
     encContact.contact_firstname, encContact.contact_lastname,
     encContact.contact_email, encContact.contact_phone, logoData, req.params.id]
  );
  if (!org) return res.status(404).json({ error: 'Organisation introuvable' });
  // Mise à jour de l'utilisateur admin
  if (adminFirstname || adminLastname || adminEmail !== undefined || adminPassword) {
    const sets = [];
    const vals = [];
    if (adminFirstname) { sets.push(`firstname=$${vals.length+1}`); vals.push(encrypt(adminFirstname.trim())); }
    if (adminLastname)  { sets.push(`lastname=$${vals.length+1}`);  vals.push(encrypt(adminLastname.trim())); }
    if (adminFirstname || adminLastname) {
      const fn = adminFirstname || '';
      const ln = adminLastname  || '';
      sets.push(`name=$${vals.length+1}`); vals.push(encrypt([fn, ln].filter(Boolean).join(' ').trim()));
    }
    if (adminEmail !== undefined) {
      sets.push(`email=$${vals.length+1}`);      vals.push(encrypt(adminEmail || null));
      sets.push(`email_hmac=$${vals.length+1}`); vals.push(emailHmac(adminEmail));
    }
    if (adminPhone !== undefined) { sets.push(`phone=$${vals.length+1}`);  vals.push(encrypt(adminPhone || null)); }
    if (adminPassword) {
      const hash = await bcrypt.hash(adminPassword, 10);
      sets.push(`password_hash=$${vals.length+1}`); vals.push(hash);
    }
    if (sets.length) {
      vals.push(req.params.id);
      await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE org_id=$${vals.length} AND role='admin'`,
        vals
      );
    }
  }
  res.json({ ...decryptOrg(org) });
});

app.delete('/api/orgs/:id', auth(['superadmin']), async (req, res) => {
  await pool.query('DELETE FROM organizations WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── Utilisateurs ───────────────────────────────────────────────────────────

app.get('/api/users', auth(['admin']), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       u.id, u.identifier, u.name, u.firstname, u.lastname,
       u.phone, u.email,
       u.address_street, u.address_city, u.address_zip, u.address_country,
       u.role, u.annual_days,
       u.entry_date, u.contract_id, u.cp_balance, u.rtt_balance, u.auto_accumulate,
       u.created_at,
       c.name AS contract_name,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status IN ('approved','pending') AND lr.leave_type = 'paid'),   0) AS taken_days,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status IN ('approved','pending') AND lr.leave_type = 'rtt'),    0) AS taken_rtt_days,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status IN ('approved','pending') AND lr.leave_type = 'unpaid'), 0) AS taken_unpaid_days
     FROM users u
     LEFT JOIN contracts c ON c.id = u.contract_id
     LEFT JOIN leave_requests lr ON lr.user_id = u.id
     WHERE u.org_id = $1
     GROUP BY u.id, c.name
     ORDER BY u.lastname, u.firstname, u.name`,
    [req.user.orgId]
  );
  res.json(rows.map(u => ({ ...decryptUser(u), accrued_cp: computeAccruedCP(u.entry_date) })));
});

app.post('/api/users', auth(['admin']), async (req, res) => {
  const {
    identifier, firstname = '', lastname = '', password, role = 'employee',
    phone = null, email = null,
    addressStreet = null, addressCity = null, addressZip = null, addressCountry = 'France',
    entryDate = null, contractId = null, cpBalance = 0, rttBalance = 0, autoAccumulate = true,
  } = req.body;
  if (!identifier || (!firstname && !lastname) || !password)
    return res.status(400).json({ error: 'identifier, nom/prénom et password sont obligatoires' });
  const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();
  const hash = await bcrypt.hash(password, 10);
  // Chiffrement des champs PII avant insertion
  const enc = encryptUser({
    name: fullName, firstname: firstname.trim(), lastname: lastname.trim(),
    phone: phone || null, email: email || null,
    address_street: addressStreet, address_city: addressCity,
    address_zip: addressZip, address_country: addressCountry,
  });
  try {
    const { rows: [user] } = await pool.query(
      `INSERT INTO users
         (org_id, identifier, name, firstname, lastname, password_hash, role, annual_days,
          phone, email, email_hmac, address_street, address_city, address_zip, address_country,
          entry_date, contract_id, cp_balance, rtt_balance, auto_accumulate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,30, $8,$9,$10,$11,$12,$13,$14, $15,$16,$17,$18,$19)
       RETURNING id, identifier, name, firstname, lastname, role, annual_days,
                 phone, email, address_street, address_city, address_zip, address_country,
                 entry_date, contract_id, cp_balance, rtt_balance, auto_accumulate`,
      [req.user.orgId, identifier.trim().toUpperCase(),
       enc.name, enc.firstname, enc.lastname, hash, role,
       enc.phone, enc.email, emailHmac(email),
       enc.address_street, enc.address_city, enc.address_zip, enc.address_country,
       entryDate || null, contractId || null, cpBalance, rttBalance, autoAccumulate]
    );
    res.status(201).json({ ...decryptUser(user), taken_days: 0 });

    // Envoi email de bienvenue en arrière-plan (utilise les valeurs en clair, avant chiffrement)
    if (email) {
      const { rows: [org] } = await pool.query(
        'SELECT id, slug FROM organizations WHERE id = $1', [req.user.orgId]
      );
      const { rows: [adminUser] } = await pool.query(
        'SELECT firstname, lastname, name FROM users WHERE id = $1', [req.user.id]
      );
      const decAdmin = decryptUser(adminUser);
      const adminName = decAdmin
        ? [decAdmin.firstname, decAdmin.lastname].filter(Boolean).join(' ') || decAdmin.name
        : 'L\'administrateur';
      sendWelcomeEmail({ user: { ...user, firstname, lastname, email }, org, adminName, plainPassword: password })
        .catch(err => console.error('Erreur envoi email bienvenue:', err));
    }
  } catch (e) {
    if (e.code === '23505')
      return res.status(409).json({ error: 'Cet identifiant est déjà utilisé' });
    throw e;
  }
});

app.put('/api/users/:id', auth(['admin']), async (req, res) => {
  const {
    firstname = '', lastname = '', password,
    phone, email,
    addressStreet, addressCity, addressZip, addressCountry,
    entryDate, contractId, cpBalance, rttBalance, autoAccumulate,
  } = req.body;
  const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();
  // Chiffrement des champs PII avant mise à jour
  const enc = encryptUser({
    name: fullName, firstname: firstname.trim(), lastname: lastname.trim(),
    phone: phone || null, email: email || null,
    address_street: addressStreet || null, address_city: addressCity || null,
    address_zip: addressZip || null, address_country: addressCountry || 'France',
  });
  // annual_days non modifiable — fixé à 30 par la loi française
  const sets = [
    'name=$1', 'firstname=$2', 'lastname=$3',
    'phone=$4', 'email=$5', 'email_hmac=$6',
    'address_street=$7', 'address_city=$8', 'address_zip=$9', 'address_country=$10',
    'entry_date=$11', 'contract_id=$12',
    'cp_balance=$13', 'rtt_balance=$14', 'auto_accumulate=$15',
  ];
  const p = [
    enc.name, enc.firstname, enc.lastname,
    enc.phone, enc.email, emailHmac(email),
    enc.address_street, enc.address_city, enc.address_zip, enc.address_country,
    entryDate || null, contractId || null,
    cpBalance ?? 0, rttBalance ?? 0, autoAccumulate ?? true,
  ];
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    sets.push(`password_hash=$${p.length + 1}`);
    p.push(hash);
  }
  p.push(req.params.id, req.user.orgId);
  const q = `UPDATE users SET ${sets.join(', ')}
             WHERE id=$${p.length - 1} AND org_id=$${p.length}
             RETURNING id, identifier, name, firstname, lastname, role, annual_days,
                       phone, email, address_street, address_city, address_zip, address_country,
                       entry_date, contract_id, cp_balance, rtt_balance, auto_accumulate`;
  const { rows: [user] } = await pool.query(q, p);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(decryptUser(user));
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
  const { startDate, endDate, comment, leaveType = 'paid', period = 'full' } = req.body;
  if (!startDate || !endDate)
    return res.status(400).json({ error: 'startDate et endDate sont obligatoires' });
  if (!['paid', 'unpaid', 'rtt'].includes(leaveType))
    return res.status(400).json({ error: 'Type de congé invalide' });
  if (!['full', 'am', 'pm'].includes(period))
    return res.status(400).json({ error: 'Période invalide' });
  // Demi-journée : forcément 1 seul jour, 0.5j décompté
  const days = (period !== 'full') ? 0.5 : (req.body.days || 0);

  // Soldes courants
  const { rows: [bal] } = await pool.query(
    `SELECT
       u.entry_date, u.cp_balance, u.rtt_balance,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'approved' AND lr.leave_type = 'paid'),   0) AS taken_paid,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status = 'approved' AND lr.leave_type = 'rtt'),    0) AS taken_rtt
     FROM users u
     LEFT JOIN leave_requests lr ON lr.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.entry_date, u.cp_balance, u.rtt_balance`,
    [req.user.id]
  );
  const availableCP  = computeAccruedCP(bal?.entry_date) + parseFloat(bal?.cp_balance || 0) - parseFloat(bal?.taken_paid || 0);
  const availableRTT = parseFloat(bal?.rtt_balance || 0) - parseFloat(bal?.taken_rtt || 0);

  if (leaveType === 'rtt') {
    if (availableRTT < days)
      return res.status(400).json({ error: `Solde RTT insuffisant (${availableRTT.toFixed(1)}j disponibles)` });
  } else if (leaveType === 'unpaid') {
    const { rows: [org] } = await pool.query(
      'SELECT allow_unpaid_leave, allow_unpaid_when_exhausted FROM organizations WHERE id = $1',
      [req.user.orgId]
    );
    if (!org.allow_unpaid_leave)
      return res.status(403).json({ error: 'Les congés sans solde ne sont pas autorisés par votre organisation.' });
    if (org.allow_unpaid_when_exhausted && availableCP > 0)
      return res.status(400).json({ error: `Vous devez épuiser votre solde CP avant de poser des sans-solde (${availableCP.toFixed(1)}j restants).` });
  } else {
    // Congé payé
    if (!bal || availableCP < days)
      return res.status(400).json({ error: `Solde CP insuffisant (${availableCP.toFixed(1)}j disponibles)` });
  }

  const { rows: [leave] } = await pool.query(
    `INSERT INTO leave_requests (org_id, user_id, start_date, end_date, days, comment, leave_type, period)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.user.orgId, req.user.id, startDate, endDate, days, comment || null, leaveType, period]
  );
  res.status(201).json(leave);

  // Notifications email (asynchrone, n'affecte pas la réponse)
  pool.query(
    `SELECT u.firstname, u.lastname, u.name, u.email,
            o.notify_on_submit, o.notify_admin_new,
            (SELECT a.email FROM users a WHERE a.org_id = o.id AND a.role = 'admin' LIMIT 1) AS admin_email
     FROM users u JOIN organizations o ON o.id = u.org_id
     WHERE u.id = $1`, [req.user.id]
  ).then(({ rows: [row] }) => {
    const appUrl = process.env.FRONTEND_URL || `http://localhost:5173`;
    const adminEmail = row?.notify_admin_new ? decrypt(row.admin_email) : null;
    if (row?.notify_on_submit || adminEmail)
      sendLeaveEmails('submitted', {
        leave, employee: decryptUser(row),
        adminEmail,
        notifyEmployee: !!row?.notify_on_submit,
        appUrl,
      });
  }).catch(e => console.error(e));
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

  pool.query(
    `SELECT u.firstname, u.lastname, u.name, u.email, o.notify_on_approve
     FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [leave.user_id]
  ).then(({ rows: [row] }) => {
    if (!row?.notify_on_approve) return;
    sendLeaveEmails('approved', { leave, employee: decryptUser(row), appUrl: process.env.FRONTEND_URL || `http://localhost:5173` });
  }).catch(e => console.error(e));
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

  pool.query(
    `SELECT u.firstname, u.lastname, u.name, u.email, o.notify_on_reject
     FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [leave.user_id]
  ).then(({ rows: [row] }) => {
    if (!row?.notify_on_reject) return;
    sendLeaveEmails('rejected', { leave, employee: decryptUser(row), appUrl: process.env.FRONTEND_URL || `http://localhost:5173` });
  }).catch(e => console.error(e));
});

// ── Contrats ────────────────────────────────────────────────────────────────

app.get('/api/contracts', auth(['admin']), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM contracts WHERE org_id = $1 ORDER BY name`,
    [req.user.orgId]
  );
  res.json(rows);
});

app.post('/api/contracts', auth(['admin']), async (req, res) => {
  const { name, nature = 'CDI', hoursPerWeek = 35, rttPerMonth = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Le nom est obligatoire' });
  const { rows: [c] } = await pool.query(
    `INSERT INTO contracts (org_id, name, nature, hours_per_week, rtt_per_month)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.orgId, name.trim(), nature, hoursPerWeek, rttPerMonth]
  );
  res.status(201).json(c);
});

app.put('/api/contracts/:id', auth(['admin']), async (req, res) => {
  const { name, nature = 'CDI', hoursPerWeek, rttPerMonth } = req.body;
  const { rows: [c] } = await pool.query(
    `UPDATE contracts SET name=$1, nature=$2, hours_per_week=$3, rtt_per_month=$4
     WHERE id=$5 AND org_id=$6 RETURNING *`,
    [name, nature, hoursPerWeek, rttPerMonth, req.params.id, req.user.orgId]
  );
  if (!c) return res.status(404).json({ error: 'Contrat introuvable' });
  res.json(c);
});

app.delete('/api/contracts/:id', auth(['admin']), async (req, res) => {
  await pool.query(
    'DELETE FROM contracts WHERE id=$1 AND org_id=$2',
    [req.params.id, req.user.orgId]
  );
  res.json({ ok: true });
});

// ── Paramètres de l'organisation ───────────────────────────────────────────

app.get('/api/settings', auth(['admin']), async (req, res) => {
  const { rows: [org] } = await pool.query(
    `SELECT name, slug, alert_threshold, allow_unpaid_leave, allow_unpaid_when_exhausted,
            notify_on_submit, notify_on_approve, notify_on_reject, notify_admin_new
     FROM organizations WHERE id = $1`,
    [req.user.orgId]
  );
  res.json({
    name: org.name,
    slug: org.slug,
    alertThreshold:           org.alert_threshold,
    allowUnpaidLeave:         org.allow_unpaid_leave,
    allowUnpaidWhenExhausted: org.allow_unpaid_when_exhausted,
    notifyOnSubmit:           org.notify_on_submit  ?? true,
    notifyOnApprove:          org.notify_on_approve ?? true,
    notifyOnReject:           org.notify_on_reject  ?? true,
    notifyAdminNew:           org.notify_admin_new  ?? true,
  });
});

app.put('/api/settings', auth(['admin']), async (req, res) => {
  const { alertThreshold, allowUnpaidLeave, allowUnpaidWhenExhausted,
          notifyOnSubmit, notifyOnApprove, notifyOnReject, notifyAdminNew } = req.body;
  if (!alertThreshold || alertThreshold < 1)
    return res.status(400).json({ error: 'Seuil invalide' });
  await pool.query(
    `UPDATE organizations
     SET alert_threshold = $1, allow_unpaid_leave = $2, allow_unpaid_when_exhausted = $3,
         notify_on_submit = $4, notify_on_approve = $5, notify_on_reject = $6, notify_admin_new = $7
     WHERE id = $8`,
    [alertThreshold, !!allowUnpaidLeave, !!allowUnpaidWhenExhausted,
     !!notifyOnSubmit, !!notifyOnApprove, !!notifyOnReject, !!notifyAdminNew,
     req.user.orgId]
  );
  res.json({ alertThreshold, allowUnpaidLeave: !!allowUnpaidLeave, allowUnpaidWhenExhausted: !!allowUnpaidWhenExhausted,
    notifyOnSubmit: !!notifyOnSubmit, notifyOnApprove: !!notifyOnApprove,
    notifyOnReject: !!notifyOnReject, notifyAdminNew: !!notifyAdminNew });
});

app.put('/api/settings/logo', auth(['admin']), async (req, res) => {
  const { logoData, logoSize } = req.body;
  const updates = [];
  const vals = [];
  if (logoData !== undefined) { updates.push(`logo_data = $${vals.length+1}`); vals.push(logoData || null); }
  if (logoSize !== undefined && ['S','M','L'].includes(logoSize)) { updates.push(`logo_size = $${vals.length+1}`); vals.push(logoSize); }
  if (updates.length) {
    vals.push(req.user.orgId);
    await pool.query(`UPDATE organizations SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals);
  }
  const { rows: [org] } = await pool.query('SELECT logo_data, logo_size FROM organizations WHERE id = $1', [req.user.orgId]);
  res.json({ logoData: org.logo_data || null, logoSize: org.logo_size || 'M' });
});

// ── Profil courant ─────────────────────────────────────────────────────────

app.get('/api/me', auth(['admin', 'employee']), async (req, res) => {
  const { rows: [user] } = await pool.query(
    `SELECT
       u.id, u.identifier, u.name, u.firstname, u.lastname, u.role, u.annual_days,
       u.phone, u.email, u.address_street, u.address_city, u.address_zip, u.address_country,
       u.entry_date, u.cp_balance, u.rtt_balance, u.auto_accumulate,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status IN ('approved','pending') AND lr.leave_type = 'paid'),   0) AS taken_days,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status IN ('approved','pending') AND lr.leave_type = 'rtt'),    0) AS taken_rtt_days,
       COALESCE(SUM(lr.days) FILTER (WHERE lr.status IN ('approved','pending') AND lr.leave_type = 'unpaid'), 0) AS taken_unpaid_days
     FROM users u
     LEFT JOIN leave_requests lr ON lr.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const accrued_cp = computeAccruedCP(user.entry_date);
  res.json({ ...decryptUser(user), taken_days: parseInt(user.taken_days), accrued_cp });
});

// ── Reset mot de passe ─────────────────────────────────────────────────────

// Vérifie un token (utilisé par le frontend pour afficher le formulaire)
app.get('/api/auth/check-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token manquant' });
  const { rows: [row] } = await pool.query(
    `SELECT prt.*, u.firstname, u.lastname, u.identifier, o.slug AS org_slug
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     JOIN organizations o ON o.id = u.org_id
     WHERE prt.token = $1`,
    [token]
  );
  if (!row)            return res.status(404).json({ error: 'Lien invalide' });
  if (row.used)        return res.status(410).json({ error: 'Lien déjà utilisé' });
  if (new Date(row.expires_at) < new Date())
                       return res.status(410).json({ error: 'Lien expiré' });
  res.json({ firstname: decrypt(row.firstname), lastname: decrypt(row.lastname), identifier: row.identifier, orgSlug: row.org_slug });
});

// Applique le nouveau mot de passe
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
  if (password.length < 6)  return res.status(400).json({ error: 'Mot de passe trop court (6 car. min)' });
  const { rows: [row] } = await pool.query(
    `SELECT * FROM password_reset_tokens WHERE token = $1`, [token]
  );
  if (!row || row.used || new Date(row.expires_at) < new Date())
    return res.status(410).json({ error: 'Lien invalide ou expiré' });
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, row.user_id]);
  await pool.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [row.id]);
  res.json({ ok: true });
});

// Renvoyer l'invitation (génère un nouveau token + renvoie l'email)
app.post('/api/users/:id/resend-invite', auth(['admin']), async (req, res) => {
  const { rows: [user] } = await pool.query(
    'SELECT * FROM users WHERE id = $1 AND org_id = $2',
    [req.params.id, req.user.orgId]
  );
  if (!user)       return res.status(404).json({ error: 'Utilisateur introuvable' });
  const userDec = decryptUser(user);
  if (!userDec.email) return res.status(400).json({ error: 'Cet utilisateur n\'a pas d\'adresse email' });
  const { rows: [org] } = await pool.query(
    'SELECT id, slug FROM organizations WHERE id = $1', [req.user.orgId]
  );
  const { rows: [adminUser] } = await pool.query(
    'SELECT firstname, lastname, name FROM users WHERE id = $1', [req.user.id]
  );
  const decAdmin = decryptUser(adminUser);
  const adminName = decAdmin
    ? [decAdmin.firstname, decAdmin.lastname].filter(Boolean).join(' ') || decAdmin.name
    : 'L\'administrateur';
  const token = await generateResetToken(user.id);
  const resetUrl = buildResetUrl(org.slug, token);
  const platformUrl = process.env.NODE_ENV === 'production'
    ? `https://${org.slug}.${PLATFORM_DOMAIN}`
    : resetUrl.split('?')[0];
  const transporter = await getTransporter();
  if (!transporter) return res.status(503).json({ error: 'SMTP non configuré' });
  const smtpCfg = await getSmtpConfig();
  const fromAddr = smtpCfg.from || `noreply@${PLATFORM_DOMAIN}`;
  await transporter.sendMail({
    from: `"Leavup" <${fromAddr}>`,
    to: userDec.email,
    subject: 'Leavup — Nouvelle invitation à activer votre compte',
    html: emailWelcomeHtml({
      firstname: userDec.firstname || '',
      lastname:  userDec.lastname  || '',
      adminName,
      platformUrl,
      identifier: user.identifier,
      password: '(inchangé — utilisez votre mot de passe actuel ou le lien ci-dessous)',
      resetUrl,
    }),
  });
  res.json({ ok: true });
});

// ── Config SMTP (Super Admin) ──────────────────────────────────────────────

app.get('/api/superadmin/smtp', auth(['superadmin']), async (req, res) => {
  const { rows } = await pool.query(
    "SELECT key, value FROM platform_settings WHERE key LIKE 'smtp_%'"
  );
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Masque le mot de passe
  if (cfg.smtp_pass) cfg.smtp_pass = '••••••••';
  res.json(cfg);
});

app.put('/api/superadmin/smtp', auth(['superadmin']), async (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from } = req.body;
  const entries = { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_from };
  if (smtp_pass && smtp_pass !== '••••••••') entries.smtp_pass = smtp_pass;
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    await pool.query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]
    );
  }
  res.json({ ok: true });
});

app.post('/api/superadmin/smtp/test', auth(['superadmin']), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Adresse email de test requise' });
  let transporter;
  try {
    transporter = await getTransporter();
  } catch (e) {
    return res.status(503).json({ error: `Erreur config SMTP : ${e.message}` });
  }
  if (!transporter) return res.status(503).json({ error: 'SMTP non configuré (host/user manquants)' });
  try {
    // Vérifie la connexion avant d'envoyer
    await transporter.verify();
    const testCfg = await getSmtpConfig();
    const testFrom = testCfg.from || `noreply@${PLATFORM_DOMAIN}`;
    await transporter.sendMail({
      from: `"Leavup" <${testFrom}>`,
      to,
      subject: 'Leavup — Test de configuration SMTP',
      html: '<p>La configuration SMTP de Leavup fonctionne correctement. ✅</p>',
    });
    res.json({ ok: true });
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('wrong version number'))
      return res.status(500).json({ error: 'Erreur SSL : mauvaise combinaison port/SSL. Essayez port 587 sans SSL, ou port 465 avec SSL.' });
    if (msg.includes('Invalid login') || msg.includes('535'))
      return res.status(500).json({ error: 'Authentification refusée. Vérifiez utilisateur/mot de passe.' });
    if (msg.includes('ECONNREFUSED'))
      return res.status(500).json({ error: `Connexion refusée sur ${(await getSmtpConfig()).host}. Vérifiez l'hôte et le port.` });
    res.status(500).json({ error: msg });
  }
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
