/**
 * migrate-encrypt.js
 * Chiffre les données personnelles existantes en BDD (migration one-shot).
 *
 * Pré-requis : ENCRYPTION_KEY et HMAC_KEY doivent être définis dans .env
 *
 * Usage :
 *   node src/migrate-encrypt.js
 * ou via Docker :
 *   docker compose exec backend node src/migrate-encrypt.js
 */

import dotenv  from 'dotenv';
import crypto  from 'crypto';
import pg      from 'pg';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ENC_KEY  = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : null;
const HMAC_KEY = process.env.HMAC_KEY || null;

if (!ENC_KEY)  { console.error('ENCRYPTION_KEY manquant'); process.exit(1); }
if (!HMAC_KEY) { console.error('HMAC_KEY manquant'); process.exit(1); }
if (ENC_KEY.length !== 32) { console.error('ENCRYPTION_KEY doit faire 64 hex chars'); process.exit(1); }

function isEncrypted(val) {
  if (!val) return false;
  return String(val).split(':').length === 3;
}

function encrypt(text) {
  if (text === null || text === undefined) return null;
  if (isEncrypted(text)) return text; // déjà chiffré
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct     = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

function emailHmac(email) {
  if (!email) return null;
  return crypto.createHmac('sha256', HMAC_KEY).update(email.toLowerCase()).digest('hex');
}

const USER_PII = ['name', 'firstname', 'lastname', 'phone', 'email',
                  'address_street', 'address_city', 'address_zip', 'address_country'];
const ORG_PII  = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone'];

async function migrateUsers() {
  const { rows } = await pool.query(
    `SELECT id, ${USER_PII.join(', ')}, email FROM users`
  );
  let updated = 0;
  for (const row of rows) {
    const sets = [];
    const vals = [];
    for (const f of USER_PII) {
      if (row[f] !== null && row[f] !== undefined && !isEncrypted(row[f])) {
        sets.push(`${f}=$${vals.length + 1}`);
        vals.push(encrypt(row[f]));
      }
    }
    // email_hmac : toujours recalculé si email présent
    if (row.email) {
      const plainEmail = isEncrypted(row.email)
        ? null // email déjà chiffré, on ne peut pas recalculer le hmac ici
        : row.email;
      if (plainEmail) {
        sets.push(`email_hmac=$${vals.length + 1}`);
        vals.push(emailHmac(plainEmail));
      }
    }
    if (sets.length) {
      vals.push(row.id);
      await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
      updated++;
    }
  }
  console.log(`Users : ${updated}/${rows.length} mis à jour`);
}

async function migrateOrgs() {
  const { rows } = await pool.query(
    `SELECT id, ${ORG_PII.join(', ')} FROM organizations`
  );
  let updated = 0;
  for (const row of rows) {
    const sets = [];
    const vals = [];
    for (const f of ORG_PII) {
      if (row[f] !== null && row[f] !== undefined && !isEncrypted(row[f])) {
        sets.push(`${f}=$${vals.length + 1}`);
        vals.push(encrypt(row[f]));
      }
    }
    if (sets.length) {
      vals.push(row.id);
      await pool.query(`UPDATE organizations SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
      updated++;
    }
  }
  console.log(`Organisations : ${updated}/${rows.length} mises à jour`);
}

async function run() {
  console.log('Migration chiffrement AES-256-GCM...');
  await migrateUsers();
  await migrateOrgs();
  console.log('Migration terminée.');
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
