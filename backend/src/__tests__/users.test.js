/**
 * Tests d'intégration — gestion des utilisateurs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('pg', () => ({
  default: { Pool: vi.fn(function () { this.query = mockQuery; this.connect = vi.fn(); }) },
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
}));

import { app } from '../index.js';

const adminToken = jwt.sign({ id: 'admin-1', orgId: 'org-1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const empToken   = jwt.sign({ id: 'emp-1',   orgId: 'org-1', role: 'employee' }, process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/users — création d\'un salarié', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).post('/api/users').send({});
    expect(res.status).toBe(401);
  });

  it('retourne 403 pour un employé', async () => {
    const res = await request(app).post('/api/users').set('Authorization', `Bearer ${empToken}`).send({});
    expect(res.status).toBe(403);
  });

  it('retourne 400 si le mot de passe fait moins de 8 caractères', async () => {
    const res = await request(app)
      .post('/api/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ identifier: 'TST-MM-0001', firstname: 'Marie', lastname: 'Martin', password: 'court' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8/);
  });

  it('retourne 400 si identifier ou nom manquent', async () => {
    const res = await request(app)
      .post('/api/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'motdepasse8' });
    expect(res.status).toBe(400);
  });

  it('retourne 403 si la limite du plan gratuit est atteinte (10 users)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: 'free', user_count: 10 }] });

    const res = await request(app)
      .post('/api/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ identifier: 'TST-XX-0001', firstname: 'Pierre', lastname: 'Durand', password: 'motdepasse8' });

    expect(res.status).toBe(403);
    expect(res.body.planLimit).toBe(true);
  });

  it('crée un salarié sur plan team (réponse 201)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ plan: 'team', user_count: 5 }] }) // plan check
      .mockResolvedValueOnce({ rows: [{ // INSERT RETURNING
        id: 'new-user-id', identifier: 'TST-PD-5678', name: 'Pierre Durand',
        firstname: null, lastname: null, role: 'employee', annual_days: 30,
        cp_balance: 0, rtt_balance: 0, auto_accumulate: true, team_id: null,
        phone: null, email: null, address_street: null, address_city: null,
        address_zip: null, address_country: 'France', entry_date: null, contract_id: null,
      }] })
      .mockResolvedValue({ rows: [] }); // email async (org + admin user) si email fourni

    const res = await request(app)
      .post('/api/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ identifier: 'TST-PD-5678', firstname: 'Pierre', lastname: 'Durand', password: 'motdepasse8' });

    expect(res.status).toBe(201);
    expect(res.body.identifier).toBe('TST-PD-5678');
  });
});

describe('DELETE /api/users/:id', () => {
  it('supprime un salarié (admin)', async () => {
    // Route DELETE simple : une seule query, contrôle via rowCount
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .delete('/api/users/user-2').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('retourne 404 si le salarié n\'appartient pas à l\'org', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete('/api/users/user-autre-org').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/users — liste des salariés', () => {
  it('retourne 403 pour un employé', async () => {
    const res = await request(app)
      .get('/api/users').set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(403);
  });

  it('retourne la liste pour un admin', async () => {
    // GET /api/users fait d'abord une query org settings, puis la liste
    mockQuery
      .mockResolvedValueOnce({ rows: [{ leave_period: 'civil', leave_grant_mode: 'progressive' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'u1', identifier: 'ACM-JD-0001', name: 'Jean Dupont',
            firstname: null, lastname: null, role: 'employee',
            cp_balance: 10, rtt_balance: 0, annual_days: 30, auto_accumulate: true,
            team_id: null, team_name: null, contract_id: null, contract_name: null,
            taken_days: 0, taken_rtt_days: 0, taken_unpaid_days: 0, days_outside_main: 0,
            phone: null, email: null, address_street: null, address_city: null,
            address_zip: null, address_country: null, entry_date: null, created_at: null,
          },
          {
            id: 'u2', identifier: 'ACM-AM-0002', name: 'Alice Martin',
            firstname: null, lastname: null, role: 'employee',
            cp_balance: 5, rtt_balance: 0, annual_days: 30, auto_accumulate: true,
            team_id: null, team_name: null, contract_id: null, contract_name: null,
            taken_days: 0, taken_rtt_days: 0, taken_unpaid_days: 0, days_outside_main: 0,
            phone: null, email: null, address_street: null, address_city: null,
            address_zip: null, address_country: null, entry_date: null, created_at: null,
          },
        ],
      });

    const res = await request(app)
      .get('/api/users').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
