/**
 * Tests unitaires — chiffrement AES-256-GCM et HMAC
 * Ces fonctions sont critiques : elles protègent les données personnelles.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

// On recrée les helpers ici plutôt que d'importer index.js
// (évite la connexion DB au démarrage des tests)
const ENC_KEY  = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const HMAC_KEY = process.env.HMAC_KEY;

function encrypt(text) {
  if (text === null || text === undefined) return null;
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct     = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

function decrypt(val) {
  if (val === null || val === undefined) return null;
  const parts = String(val).split(':');
  if (parts.length !== 3) return val;
  try {
    const [ivB64, ctB64, tagB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(ctB64, 'base64')) + decipher.final('utf8');
  } catch { return val; }
}

function emailHmac(email) {
  if (!email) return null;
  return crypto.createHmac('sha256', HMAC_KEY).update(email.toLowerCase()).digest('hex');
}

describe('encrypt / decrypt', () => {
  it('chiffre et déchiffre une chaîne simple', () => {
    const original = 'Jean Dupont';
    const enc = encrypt(original);
    expect(enc).not.toBe(original);
    expect(decrypt(enc)).toBe(original);
  });

  it('produit un format iv:ct:tag (3 parties base64)', () => {
    const enc = encrypt('test');
    const parts = enc.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach(p => expect(() => Buffer.from(p, 'base64')).not.toThrow());
  });

  it('deux chiffrements du même texte donnent des résultats différents (IV aléatoire)', () => {
    const enc1 = encrypt('même texte');
    const enc2 = encrypt('même texte');
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(decrypt(enc2)); // mais déchiffrement identique
  });

  it('retourne null pour une valeur null', () => {
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  it('retourne null pour undefined', () => {
    expect(encrypt(undefined)).toBeNull();
    expect(decrypt(undefined)).toBeNull();
  });

  it('passe les données non chiffrées en clair (rétrocompatibilité migration)', () => {
    const plain = 'donnee_non_chiffree';
    expect(decrypt(plain)).toBe(plain);
  });

  it('chiffre les caractères spéciaux et accents', () => {
    const texte = 'Résidence "Les Acacias" — 75001 PARIS';
    expect(decrypt(encrypt(texte))).toBe(texte);
  });

  it('chiffre les emails', () => {
    const email = 'jean.dupont@example.com';
    expect(decrypt(encrypt(email))).toBe(email);
  });

  it('les données altérées ne se déchiffrent pas (authentification GCM)', () => {
    const enc = encrypt('data sensible');
    const parts = enc.split(':');
    // Altérer le ciphertext
    const corrompu = `${parts[0]}:AAAA:${parts[2]}`;
    // decrypt retourne la valeur corrompue telle quelle (exception catchée)
    expect(decrypt(corrompu)).toBe(corrompu);
  });
});

describe('emailHmac', () => {
  it('retourne un hash hex de 64 caractères', () => {
    const h = emailHmac('test@example.com');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('est déterministe — même email donne même hash', () => {
    const h1 = emailHmac('jean@test.fr');
    const h2 = emailHmac('jean@test.fr');
    expect(h1).toBe(h2);
  });

  it('normalise en minuscules', () => {
    expect(emailHmac('JEAN@TEST.FR')).toBe(emailHmac('jean@test.fr'));
    expect(emailHmac('Jean@Test.Fr')).toBe(emailHmac('jean@test.fr'));
  });

  it('emails différents → hashes différents', () => {
    expect(emailHmac('a@test.fr')).not.toBe(emailHmac('b@test.fr'));
  });

  it('retourne null pour une valeur vide', () => {
    expect(emailHmac('')).toBeNull();
    expect(emailHmac(null)).toBeNull();
  });
});
