/**
 * Tests d'intégration — demandes de congé
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

const adminToken = jwt.sign({ id: 'admin-1', orgId: 'org-1', role: 'admin' },    process.env.JWT_SECRET, { expiresIn: '1h' });
const empToken   = jwt.sign({ id: 'emp-1',   orgId: 'org-1', role: 'employee' }, process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => vi.resetAllMocks());

// Mock org renvoyé par la première query de POST /api/leaves
const ORG_MOCK = { rows: [{
  allow_unpaid_leave: false, allow_unpaid_when_exhausted: false,
  leave_period: 'civil', leave_grant_mode: 'progressive', annual_days: 30,
}]};

// Mock solde renvoyé par la deuxième query de POST /api/leaves
const balMock = (cp = 0, taken = 0) => ({ rows: [{
  cp_balance: cp, rtt_balance: 0, taken_paid: taken, taken_rtt: 0,
  entry_date: null, annual_days: 30, auto_accumulate: true, days_outside_main: 0,
}]});

describe('POST /api/leaves — création de demande', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).post('/api/leaves').send({});
    expect(res.status).toBe(401);
  });

  it('retourne 400 si le solde CP est insuffisant', async () => {
    // Ordre : 1) org settings  2) balance utilisateur
    mockQuery
      .mockResolvedValueOnce(ORG_MOCK)
      .mockResolvedValueOnce(balMock(0, 0));

    const res = await request(app)
      .post('/api/leaves').set('Authorization', `Bearer ${empToken}`)
      .send({ startDate: '2026-07-01', endDate: '2026-07-05', leaveType: 'paid', period: 'full' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/solde|insuffisant/i);
  });

  it('crée une demande CP avec un solde suffisant', async () => {
    mockQuery
      .mockResolvedValueOnce(ORG_MOCK)                    // org settings
      .mockResolvedValueOnce(balMock(15, 0))              // balance
      .mockResolvedValueOnce({ rows: [{ id: 'leave-1', status: 'pending', days: 5, leave_type: 'paid',
          start_date: '2026-08-04', end_date: '2026-08-08', period: 'full',
          comment: null, org_id: 'org-1', user_id: 'emp-1' }] }) // INSERT
      .mockResolvedValue({ rows: [] });                   // notification async

    const res = await request(app)
      .post('/api/leaves').set('Authorization', `Bearer ${empToken}`)
      .send({ startDate: '2026-08-04', endDate: '2026-08-08', leaveType: 'paid', period: 'full' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  it('retourne 400 si la plage ne contient aucun jour ouvré', async () => {
    // Samedi + Dimanche uniquement — la route retourne 400 avant toute requête DB
    const res = await request(app)
      .post('/api/leaves').set('Authorization', `Bearer ${empToken}`)
      .send({ startDate: '2026-08-01', endDate: '2026-08-02', leaveType: 'paid', period: 'full' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ouvré/i);
  });

  it('refuse un congé sans solde si non autorisé par l\'org', async () => {
    // org settings (allow_unpaid_leave: false) puis balance
    mockQuery
      .mockResolvedValueOnce({ rows: [{ allow_unpaid_leave: false, allow_unpaid_when_exhausted: false,
          leave_period: 'civil', leave_grant_mode: 'progressive', annual_days: 30 }] })
      .mockResolvedValueOnce(balMock(0, 0));

    const res = await request(app)
      .post('/api/leaves').set('Authorization', `Bearer ${empToken}`)
      .send({ startDate: '2026-07-01', endDate: '2026-07-03', leaveType: 'unpaid', period: 'full' });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/leaves/:id/approve — validation', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).put('/api/leaves/leave-1/approve').send({});
    expect(res.status).toBe(401);
  });

  it('approuve une demande en tant qu\'admin', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'leave-1', org_id: 'org-1', status: 'approved',
          user_id: 'emp-1', days: 3, leave_type: 'paid',
          start_date: '2026-08-04', end_date: '2026-08-06', period: 'full', comment: null }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .put('/api/leaves/leave-1/approve').set('Authorization', `Bearer ${adminToken}`).send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('rejette une demande avec un motif', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'leave-1', org_id: 'org-1', status: 'rejected',
          user_id: 'emp-1', days: 3, leave_type: 'paid',
          start_date: '2026-07-01', end_date: '2026-07-03', period: 'full', comment: null,
          reject_reason: 'Période chargée' }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .put('/api/leaves/leave-1/reject').set('Authorization', `Bearer ${adminToken}`)
      .send({ rejectReason: 'Période chargée' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});

describe('GET /api/leaves — liste des congés', () => {
  it('retourne les congés de l\'employé connecté', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'leave-1', start_date: '2026-08-04', end_date: '2026-08-08', days: 5, status: 'approved',
          leave_type: 'paid', period: 'full', comment: null, org_id: 'org-1', user_id: 'emp-1',
          employee_name: 'Emp Un', employee_identifier: 'EMP-001' },
        { id: 'leave-2', start_date: '2026-09-01', end_date: '2026-09-01', days: 1, status: 'pending',
          leave_type: 'rtt', period: 'full', comment: null, org_id: 'org-1', user_id: 'emp-1',
          employee_name: 'Emp Un', employee_identifier: 'EMP-001' },
      ],
    });

    const res = await request(app)
      .get('/api/leaves').set('Authorization', `Bearer ${empToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
