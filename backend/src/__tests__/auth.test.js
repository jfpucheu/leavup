/**
 * Tests d'intégration — authentification
 * Routes : POST /api/auth/login, POST /api/register
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mock pg ─────────────────────────────────────────────────────────────────
const { mockQuery, mockClient } = vi.hoisted(() => {
  const mockClient = {
    query:   vi.fn(),
    release: vi.fn(),
  };
  return {
    mockQuery:  vi.fn(),
    mockClient,
  };
});

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(function () {
      this.query   = mockQuery;
      this.connect = vi.fn(() => Promise.resolve(mockClient));
    }),
  },
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
}));

import { app } from '../index.js';
import bcrypt from 'bcryptjs';

const HASH = await bcrypt.hash('motdepasse8', 10);

const USER = {
  id: 'user-uuid-1', org_id: 'org-uuid-1', identifier: 'ACM-JD-4321',
  name: 'Jean Dupont', firstname: null, lastname: null, role: 'admin',
  password_hash: HASH, annual_days: 30, email_hmac: null,
};
const ORG = {
  id: 'org-uuid-1', name: 'Acme SAS', slug: 'acme', plan: 'free',
  alert_threshold: 3, logo_data: null, logo_size: 'M', siret: null,
  contact_firstname: null, contact_lastname: null, contact_email: null,
  allow_unpaid_leave: false, allow_unpaid_when_exhausted: false,
};

beforeEach(() => {
  // mockReset vide la queue mockResolvedValueOnce et les implémentations
  // (contrairement à clearAllMocks qui ne vide que l'historique d'appels)
  mockQuery.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
});

describe('POST /api/auth/login', () => {
  it('retourne un token JWT avec les infos user/org pour un login valide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [USER] })   // recherche globale user
      .mockResolvedValueOnce({ rows: [ORG] });    // get org

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'ACM-JD-4321', password: 'motdepasse8' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('admin');
    expect(res.body.org.slug).toBe('acme');
  });

  it('retourne 401 pour un mauvais mot de passe', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [USER] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'ACM-JD-4321', password: 'mauvais_mdp' });

    expect(res.status).toBe(401);
  });

  it('retourne 401 si l\'utilisateur n\'existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'INCONNU', password: 'motdepasse8' });

    expect(res.status).toBe(401);
  });

  it('retourne 400 si les champs sont manquants', async () => {
    // La validation rejette avant toute requête DB
    const res = await request(app)
      .post('/api/auth/login')
      .send({}); // identifier ET password manquants

    expect(res.status).toBe(400);
  });

  it('connecte le superadmin avec SUPER_PASSWORD', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'superadmin', password: process.env.SUPER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('superadmin');
  });

  it('refuse le superadmin avec un mauvais mot de passe', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'superadmin', password: 'mauvais' });

    expect(res.status).toBe(401);
  });

  it('retourne 409 si plusieurs comptes ont le même identifiant', async () => {
    // 2 users avec le même identifier (collision rare mais possible)
    mockQuery.mockResolvedValueOnce({ rows: [USER, { ...USER, id: 'user-2', org_id: 'org-2' }] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'ACM-JD-4321', password: 'motdepasse8' });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/register', () => {
  it('retourne 400 si le mot de passe fait moins de 8 caractères', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ orgName: 'Test SARL', adminFirstname: 'Alice', adminLastname: 'Martin', adminEmail: 'alice@test.fr', adminPassword: 'court' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8/);
  });

  it('retourne 400 si des champs obligatoires manquent', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ orgName: 'Test SARL' });

    expect(res.status).toBe(400);
  });

  it('crée un compte avec des données valides', async () => {
    // slug uniqueness check
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // welcome email query (async, après la réponse)
    mockQuery.mockResolvedValue({ rows: [] });

    // Transaction client
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'new-org-id', slug: 'test-sarl' }] })  // INSERT org
      .mockResolvedValueOnce({ rows: [{ id: 'new-user-id' }] })                    // INSERT user
      .mockResolvedValueOnce({ rows: [] });                                         // COMMIT

    const res = await request(app)
      .post('/api/register')
      .send({ orgName: 'Test SARL', adminFirstname: 'Alice', adminLastname: 'Martin', adminEmail: 'alice@test.fr', adminPassword: 'motdepasse8' });

    expect(res.status).toBe(201);
    expect(res.body.identifier).toBeDefined();
    expect(res.body.slug).toBe('test-sarl');
  });
});
