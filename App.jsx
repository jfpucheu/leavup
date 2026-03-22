import { useState, useEffect, useCallback } from 'react';

// ── API helper ─────────────────────────────────────────────────────────────
const BASE = '/api';

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

// ── Auth context (token dans localStorage) ─────────────────────────────────
function loadSession() {
  try {
    const raw = localStorage.getItem('conges_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSession(s) { localStorage.setItem('conges_session', JSON.stringify(s)); }
function clearSession() { localStorage.removeItem('conges_session'); }

// ── Utilitaires ────────────────────────────────────────────────────────────
function workDays(start, end) {
  let n = 0;
  const d = new Date(start + 'T12:00:00');
  const e = new Date(end   + 'T12:00:00');
  while (d <= e) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function fmt(s) {
  return new Date(s + (s.includes('T') ? '' : 'T12:00:00'))
    .toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function today() { return new Date().toISOString().split('T')[0]; }

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  blue:      '#185FA5',
  blueDark:  '#0c447c',
  blueLight: '#e6f1fb',
  green:     '#3b6d11',
  greenLight:'#eaf3de',
  red:       '#a32d2d',
  redLight:  '#fcebeb',
  amber:     '#633806',
  amberLight:'#faeeda',
  border:    '#e0dfd7',
  bg:        '#f5f5f0',
  bgCard:    '#ffffff',
  bgSecond:  '#f1efe8',
  text:      '#1a1a1a',
  textMuted: '#6b6b65',
  textHint:  '#9d9d97',
};

const CARD = {
  background: C.bgCard, border: `1px solid ${C.border}`,
  borderRadius: 12, padding: '1rem 1.25rem',
};

// ── Composants UI ──────────────────────────────────────────────────────────
function Badge({ s }) {
  const cfg = {
    pending:  [C.amberLight, C.amber,  'En attente'],
    approved: [C.greenLight, C.green,  'Approuvé'],
    rejected: [C.redLight,   C.red,    'Refusé'],
  }[s] || [C.bgSecond, C.textMuted, s];
  return (
    <span style={{
      background: cfg[0], color: cfg[1], fontSize: 11, fontWeight: 600,
      padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}>{cfg[2]}</span>
  );
}

function Btn({ children, onClick, variant='primary', disabled, full, small, style }) {
  const base = {
    border: 'none', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
    fontWeight: 500, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
    padding: small ? '6px 12px' : '9px 16px',
    fontSize: small ? 12 : 14,
    width: full ? '100%' : 'auto', transition: 'opacity 0.1s',
  };
  const variants = {
    primary: { background: C.blue,   color: 'white' },
    success: { background: C.green,  color: 'white' },
    danger:  { background: C.red,    color: 'white' },
    ghost:   { background: C.bgSecond, color: C.text, border: `1px solid ${C.border}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

function Alert({ type = 'warning', children }) {
  const cfg = {
    warning: [C.amberLight, '#ef9f27', C.amber],
    info:    [C.blueLight,  '#378add', C.blueDark],
    error:   [C.redLight,   '#e24b4a', C.red],
    success: [C.greenLight, '#639922', C.green],
  }[type];
  return (
    <div style={{
      background: cfg[0], border: `1px solid ${cfg[1]}`, borderRadius: 8,
      padding: '10px 14px', fontSize: 13, color: cfg[2], marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        border: `3px solid ${C.border}`, borderTopColor: C.blue,
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem', zIndex: 200,
    }}>
      <div style={{ ...CARD, width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 20, color: C.textMuted, lineHeight: 1,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }) {
  return (
    <div style={{
      background: C.bgSecond, borderRadius: 10,
      padding: '12px 8px', textAlign: 'center', flex: 1,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: color || C.text, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Écran de connexion ─────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [step, setStep]       = useState('org');   // 'org' | 'creds' | 'super'
  const [orgSlug, setOrgSlug] = useState('');
  const [id, setId]           = useState('');
  const [pwd, setPwd]         = useState('');
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(false);

  const goCredentials = async (e) => {
    e.preventDefault();
    if (!orgSlug.trim()) return setErr('Veuillez saisir le code de votre entreprise');
    setStep('creds');
    setErr('');
  };

  const doLogin = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const data = await api('POST', '/auth/login', {
        orgSlug: step === 'super' ? undefined : orgSlug.trim(),
        identifier: id.trim(),
        password: pwd,
      });
      onLogin(data);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: C.bg, padding: '1rem',
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: C.blue,
            margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>
            CongiSaaS
          </h1>
          <p style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
            Gestion des congés pour votre entreprise
          </p>
        </div>

        <div style={CARD}>
          {step === 'org' && (
            <form onSubmit={goCredentials}>
              <Field label="Code de votre entreprise">
                <input
                  value={orgSlug}
                  onChange={e => { setOrgSlug(e.target.value); setErr(''); }}
                  placeholder="mon-entreprise"
                  style={{ width: '100%' }}
                  autoFocus
                />
              </Field>
              {err && <Alert type="error">{err}</Alert>}
              <Btn full>Continuer →</Btn>
            </form>
          )}

          {(step === 'creds' || step === 'super') && (
            <form onSubmit={doLogin}>
              {step === 'creds' && (
                <div style={{
                  background: C.blueLight, borderRadius: 8, padding: '8px 12px',
                  fontSize: 12, color: C.blueDark, marginBottom: 14,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>🏢 <strong>{orgSlug}</strong></span>
                  <button type="button" onClick={() => { setStep('org'); setErr(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.blue }}>
                    Changer
                  </button>
                </div>
              )}
              {step === 'super' && (
                <Alert type="info">Connexion Super Admin</Alert>
              )}
              <Field label="Identifiant">
                <input
                  value={id}
                  onChange={e => { setId(e.target.value); setErr(''); }}
                  placeholder={step === 'super' ? 'superadmin' : 'EMP001'}
                  style={{ width: '100%' }}
                  autoCapitalize="off"
                  autoFocus
                />
              </Field>
              <Field label="Mot de passe">
                <input
                  type="password" value={pwd}
                  onChange={e => { setPwd(e.target.value); setErr(''); }}
                  placeholder="••••••••"
                  style={{ width: '100%' }}
                />
              </Field>
              {err && <Alert type="error">{err}</Alert>}
              <Btn full disabled={loading}>
                {loading ? 'Connexion…' : 'Se connecter'}
              </Btn>
            </form>
          )}
        </div>

        {step !== 'super' && (
          <p style={{ textAlign: 'center', marginTop: 16 }}>
            <button onClick={() => { setStep('super'); setErr(''); setId(''); setPwd(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.textMuted }}>
              Accès administrateur plateforme
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Layout commun ──────────────────────────────────────────────────────────
function Layout({ user, org, onLogout, tabs, activeTab, onTab, pendingCount, children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* Header */}
      <div style={{
        background: C.blue, padding: '0 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        height: 52, position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'white', letterSpacing: '-0.01em' }}>
            CongiSaaS
          </span>
          {org && (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginLeft: 8 }}>
              {org.name}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>{user.name}</span>
          <button onClick={onLogout} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
            borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
          }}>
            Quitter
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        background: 'white', borderBottom: `1px solid ${C.border}`,
        display: 'flex', overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {tabs.map((t, i) => (
          <button key={t} onClick={() => onTab(i)} style={{
            flex: '0 0 auto', padding: '11px 14px', fontSize: 13,
            border: 'none', cursor: 'pointer', background: 'none',
            color: activeTab === i ? C.blue : C.textMuted,
            borderBottom: activeTab === i ? `2px solid ${C.blue}` : '2px solid transparent',
            fontWeight: activeTab === i ? 600 : 400, whiteSpace: 'nowrap',
            fontFamily: 'inherit',
          }}>
            {t}
            {pendingCount > 0 && i === 2 && user.role === 'admin' && (
              <span style={{
                marginLeft: 5, background: C.red, color: 'white',
                borderRadius: 20, fontSize: 10, padding: '1px 6px', fontWeight: 700,
              }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '1rem', maxWidth: 640, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

// ── VUE SUPERADMIN ─────────────────────────────────────────────────────────
function SuperAdminView({ session, onLogout }) {
  const { token } = session;
  const [orgs, setOrgs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);
  const [form, setForm]       = useState({ name:'', slug:'', adminPassword:'', alertThreshold:3 });
  const [editForm, setEditForm]   = useState({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('GET', '/orgs', null, token);
      setOrgs(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const createOrg = async () => {
    if (!form.name || !form.slug || !form.adminPassword)
      return setFormErr('Tous les champs sont obligatoires');
    setSaving(true); setFormErr('');
    try {
      await api('POST', '/orgs', form, token);
      setModal(null);
      setForm({ name:'', slug:'', adminPassword:'', alertThreshold:3 });
      load();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const deleteOrg = async (id) => {
    if (!confirm('Supprimer cette organisation ? Toutes les données seront perdues.')) return;
    await api('DELETE', `/orgs/${id}`, null, token);
    load();
  };

  const openEdit = (org) => {
    setEditForm({ id: org.id, name: org.name, alertThreshold: org.alert_threshold });
    setModal('edit');
    setFormErr('');
  };

  const saveEdit = async () => {
    setSaving(true); setFormErr('');
    try {
      await api('PUT', `/orgs/${editForm.id}`, {
        name: editForm.name, alertThreshold: editForm.alertThreshold
      }, token);
      setModal(null);
      load();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  return (
    <>
      {modal === 'create' && (
        <Modal title="Nouvelle organisation" onClose={() => { setModal(null); setFormErr(''); }}>
          <Field label="Nom de l'entreprise *">
            <input value={form.name} onChange={e => setForm(f=>({...f, name: e.target.value}))} style={{ width:'100%' }} />
          </Field>
          <Field label="Slug (URL) * — ex: acme-corp">
            <input value={form.slug} onChange={e => setForm(f=>({...f, slug: e.target.value.toLowerCase().replace(/\s/g,'-')}))} style={{ width:'100%' }} placeholder="acme-corp" />
          </Field>
          <Field label="Mot de passe admin *">
            <input type="password" value={form.adminPassword} onChange={e => setForm(f=>({...f, adminPassword: e.target.value}))} style={{ width:'100%' }} />
          </Field>
          <Field label="Seuil d'alerte (nbre de salariés simultanés)">
            <input type="number" min={1} max={50} value={form.alertThreshold} onChange={e => setForm(f=>({...f, alertThreshold: e.target.value}))} style={{ width: 80 }} />
          </Field>
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={createOrg} disabled={saving} full>Créer</Btn>
            <Btn variant="ghost" onClick={() => setModal(null)} full>Annuler</Btn>
          </div>
        </Modal>
      )}

      {modal === 'edit' && (
        <Modal title="Modifier l'organisation" onClose={() => { setModal(null); setFormErr(''); }}>
          <Field label="Nom">
            <input value={editForm.name} onChange={e => setEditForm(f=>({...f, name: e.target.value}))} style={{ width:'100%' }} />
          </Field>
          <Field label="Seuil d'alerte">
            <input type="number" min={1} max={50} value={editForm.alertThreshold} onChange={e => setEditForm(f=>({...f, alertThreshold: e.target.value}))} style={{ width: 80 }} />
          </Field>
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={saveEdit} disabled={saving} full>Enregistrer</Btn>
            <Btn variant="ghost" onClick={() => setModal(null)} full>Annuler</Btn>
          </div>
        </Modal>
      )}

      <div style={{ minHeight:'100vh', background: C.bg }}>
        <div style={{
          background: '#1a1a1a', padding: '0 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          height: 52, position: 'sticky', top: 0, zIndex: 100,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>
            CongiSaaS — Super Admin
          </span>
          <button onClick={onLogout} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
            borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
          }}>Quitter</button>
        </div>

        <div style={{ padding: '1rem', maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>
              Organisations ({orgs.length})
            </h2>
            <Btn onClick={() => { setModal('create'); setFormErr(''); }}>
              + Nouvelle organisation
            </Btn>
          </div>

          {loading ? <Spinner /> : orgs.length === 0 ? (
            <div style={{ ...CARD, textAlign:'center', color: C.textHint, fontSize: 14, padding: '2rem' }}>
              Aucune organisation. Créez-en une pour commencer.
            </div>
          ) : orgs.map(org => (
            <div key={org.id} style={{ ...CARD, marginBottom: 10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{org.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
                    slug : <code style={{ background: C.bgSecond, padding: '1px 5px', borderRadius: 4 }}>{org.slug}</code>
                    {' '}· identifiant admin : <code style={{ background: C.bgSecond, padding: '1px 5px', borderRadius: 4 }}>ADMIN</code>
                  </div>
                  <div style={{ display:'flex', gap: 16, fontSize: 13, color: C.textMuted }}>
                    <span>👥 {org.user_count} utilisateurs</span>
                    {parseInt(org.pending_count) > 0 && (
                      <span style={{ color: C.amber }}>⏳ {org.pending_count} en attente</span>
                    )}
                    <span>Seuil alerte : {org.alert_threshold}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textHint, marginTop: 4 }}>
                    Créée le {fmt(org.created_at)}
                  </div>
                </div>
                <div style={{ display:'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                  <Btn small variant="ghost" onClick={() => openEdit(org)}>Modifier</Btn>
                  <Btn small variant="danger" onClick={() => deleteOrg(org.id)}>Supprimer</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── VUE ADMIN ──────────────────────────────────────────────────────────────
function AdminView({ session, onLogout }) {
  const { token, org } = session;
  const [tab, setTab]       = useState(0);
  const [users, setUsers]   = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [settings, setSettings] = useState({ alertThreshold: org.alertThreshold });
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, l, s] = await Promise.all([
        api('GET', '/users',    null, token),
        api('GET', '/leaves',   null, token),
        api('GET', '/settings', null, token),
      ]);
      setUsers(u); setLeaves(l); setSettings(s);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const pendingCount = leaves.filter(l => l.status === 'pending').length;
  const TABS = ['Tableau de bord', 'Salariés', 'Demandes', 'Paramètres'];

  return (
    <Layout user={session.user} org={org} onLogout={onLogout}
      tabs={TABS} activeTab={tab} onTab={setTab} pendingCount={pendingCount}>
      {loading ? <Spinner /> : (
        <>
          {tab === 0 && <AdminDash users={users} leaves={leaves} settings={settings} />}
          {tab === 1 && <AdminUsers users={users} leaves={leaves} token={token} onRefresh={load} />}
          {tab === 2 && <AdminLeaves users={users} leaves={leaves} settings={settings} token={token} onRefresh={load} />}
          {tab === 3 && <AdminSettings settings={settings} token={token} onSaved={(s) => setSettings(s)} />}
        </>
      )}
    </Layout>
  );
}

function AdminDash({ users, leaves, settings }) {
  const todayStr = today();
  const pending  = leaves.filter(l => l.status === 'pending');
  const onLeave  = leaves.filter(l =>
    l.status === 'approved' && l.start_date <= todayStr && l.end_date >= todayStr
  );
  const alertLeaves = pending.filter(req => {
    const ov = leaves.filter(l =>
      l.id !== req.id && l.status === 'approved' &&
      l.start_date <= req.end_date && l.end_date >= req.start_date
    );
    return ov.length + 1 >= settings.alertThreshold;
  });

  return (
    <>
      <div style={{ display:'flex', gap: 10, marginBottom: '1.25rem' }}>
        <MetricCard label="Salariés"   value={users.length} />
        <MetricCard label="En attente" value={pending.length} color={pending.length ? C.amber : C.textMuted} />
        <MetricCard label="En congé"   value={onLeave.length} />
      </div>

      {alertLeaves.length > 0 && (
        <Alert type="warning">
          ⚠ {alertLeaves.length} demande{alertLeaves.length > 1 ? 's' : ''} en attente dépasserai{alertLeaves.length > 1 ? 'ent' : 't'} le seuil de
          {' '}{settings.alertThreshold} salariés simultanément. Vérifiez l'onglet Demandes.
        </Alert>
      )}

      {onLeave.length > 0 && (
        <div style={{ ...CARD, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>
            En congé aujourd'hui
          </div>
          {onLeave.map((l, i) => (
            <div key={l.id} style={{
              fontSize: 13, padding: '6px 0',
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            }}>
              {l.employee_name} — retour le {fmt(l.end_date)}
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div style={CARD}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>
            Demandes en attente
          </div>
          {pending.map((l, i) => {
            const ov = leaves.filter(x =>
              x.id !== l.id && x.status === 'approved' &&
              x.start_date <= l.end_date && x.end_date >= l.start_date
            );
            return (
              <div key={l.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 0', borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{l.employee_name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    {fmt(l.start_date)} → {fmt(l.end_date)} · {l.days}j
                  </div>
                </div>
                {ov.length + 1 >= settings.alertThreshold && (
                  <span style={{
                    fontSize: 10, background: C.amberLight, color: C.amber,
                    padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                  }}>⚠ Alerte</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!pending.length && !onLeave.length && (
        <div style={{ ...CARD, fontSize: 13, color: C.textHint, textAlign: 'center', padding: '2rem' }}>
          Aucune activité en cours.
        </div>
      )}
    </>
  );
}

function AdminUsers({ users, leaves, token, onRefresh }) {
  const [modal, setModal]   = useState(null);
  const [target, setTarget] = useState(null);
  const [form, setForm]     = useState({ identifier:'', name:'', password:'', annualDays:25 });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  const takenDays = (userId) =>
    leaves.filter(l => l.user_id === userId && l.status === 'approved')
      .reduce((s, l) => s + l.days, 0);

  const openCreate = () => {
    setForm({ identifier:'', name:'', password:'1234', annualDays:25 });
    setTarget(null); setFormErr('');
    setModal('form');
  };

  const openEdit = (u) => {
    setForm({ identifier: u.identifier, name: u.name, password: '', annualDays: u.annual_days });
    setTarget(u); setFormErr('');
    setModal('form');
  };

  const save = async () => {
    if (!form.name || (!target && !form.identifier) || (!target && !form.password))
      return setFormErr('Champs obligatoires manquants');
    setSaving(true); setFormErr('');
    try {
      if (target) {
        await api('PUT', `/users/${target.id}`, {
          name: form.name, annualDays: parseInt(form.annualDays),
          ...(form.password ? { password: form.password } : {}),
        }, token);
      } else {
        await api('POST', '/users', {
          identifier: form.identifier, name: form.name,
          password: form.password, annualDays: parseInt(form.annualDays),
        }, token);
      }
      setModal(null);
      onRefresh();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const del = async (u) => {
    if (!confirm(`Supprimer ${u.name} ?`)) return;
    try {
      await api('DELETE', `/users/${u.id}`, null, token);
      onRefresh();
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      {modal === 'form' && (
        <Modal
          title={target ? `Modifier — ${target.name}` : 'Nouveau salarié'}
          onClose={() => setModal(null)}
        >
          {!target && (
            <Field label="Identifiant de connexion *">
              <input value={form.identifier}
                onChange={e => setForm(f=>({...f, identifier: e.target.value}))}
                placeholder="EMP004" style={{ width:'100%' }} />
            </Field>
          )}
          <Field label="Nom complet *">
            <input value={form.name}
              onChange={e => setForm(f=>({...f, name: e.target.value}))}
              placeholder="Prénom Nom" style={{ width:'100%' }} />
          </Field>
          <Field label={target ? 'Nouveau mot de passe (laisser vide = inchangé)' : 'Mot de passe *'}>
            <input type="password" value={form.password}
              onChange={e => setForm(f=>({...f, password: e.target.value}))}
              style={{ width:'100%' }} />
          </Field>
          <Field label="Jours de congé annuels">
            <input type="number" min={0} max={60} value={form.annualDays}
              onChange={e => setForm(f=>({...f, annualDays: e.target.value}))}
              style={{ width: 90 }} />
          </Field>
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving} full>{target ? 'Enregistrer' : 'Ajouter'}</Btn>
            <Btn variant="ghost" onClick={() => setModal(null)} full>Annuler</Btn>
          </div>
        </Modal>
      )}

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom: 12 }}>
        <Btn onClick={openCreate}>+ Nouveau salarié</Btn>
      </div>

      {users.map(u => {
        const taken = takenDays(u.id);
        const rem   = u.annual_days - taken;
        return (
          <div key={u.id} style={{ ...CARD, marginBottom: 10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  {u.identifier}
                  {u.role === 'admin' && (
                    <span style={{
                      marginLeft: 6, fontSize: 10, background: C.blueLight,
                      color: C.blue, padding: '1px 6px', borderRadius: 20, fontWeight: 600,
                    }}>admin</span>
                  )}
                </div>
                {u.role !== 'admin' && (
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 5 }}>
                    {u.annual_days}j annuels · {taken}j pris ·{' '}
                    <strong style={{ color: rem <= 3 ? C.red : C.text }}>
                      {rem}j restants
                    </strong>
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                <Btn small variant="ghost" onClick={() => openEdit(u)}>Modifier</Btn>
                {u.role !== 'admin' && (
                  <Btn small variant="danger" onClick={() => del(u)}>×</Btn>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function AdminLeaves({ users, leaves, settings, token, onRefresh }) {
  const [rejectModal, setRejectModal] = useState(null);
  const [reason, setReason]           = useState('');
  const [saving, setSaving]           = useState(false);

  const pending = [...leaves.filter(l => l.status === 'pending')]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const done = [...leaves.filter(l => l.status !== 'pending')]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const approve = async (id) => {
    setSaving(true);
    try { await api('PUT', `/leaves/${id}/approve`, {}, token); onRefresh(); }
    catch (e) { alert(e.message); }
    setSaving(false);
  };

  const doReject = async () => {
    setSaving(true);
    try {
      await api('PUT', `/leaves/${rejectModal}/reject`, { rejectReason: reason }, token);
      setRejectModal(null); setReason('');
      onRefresh();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const overlap = (req) => leaves.filter(l =>
    l.id !== req.id && l.status === 'approved' &&
    l.start_date <= req.end_date && l.end_date >= req.start_date
  );

  const userBalance = (userId) => {
    const u = users.find(x => x.id === userId);
    if (!u) return null;
    const taken = leaves.filter(l => l.user_id === userId && l.status === 'approved')
      .reduce((s, l) => s + l.days, 0);
    return { annual: u.annual_days, taken, rem: u.annual_days - taken };
  };

  return (
    <>
      {rejectModal && (
        <Modal title="Motif de refus" onClose={() => { setRejectModal(null); setReason(''); }}>
          <Field label="Motif (optionnel)">
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3} style={{ width:'100%' }} placeholder="Indisponibilité, chevauchement…" />
          </Field>
          <div style={{ display:'flex', gap: 8 }}>
            <Btn variant="danger" onClick={doReject} disabled={saving} full>
              Confirmer le refus
            </Btn>
            <Btn variant="ghost" onClick={() => { setRejectModal(null); setReason(''); }} full>
              Annuler
            </Btn>
          </div>
        </Modal>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>
          En attente de validation ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div style={{ ...CARD, fontSize: 13, color: C.textHint, textAlign:'center', padding:'1.5rem' }}>
            Aucune demande en attente.
          </div>
        ) : pending.map(l => {
          const ov  = overlap(l);
          const bal = userBalance(l.user_id);
          const isAlert = ov.length + 1 >= settings.alertThreshold;

          return (
            <div key={l.id} style={{ ...CARD, marginBottom: 10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{l.employee_name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    {fmt(l.start_date)} → {fmt(l.end_date)} · {l.days} jour{l.days > 1 ? 's' : ''}
                  </div>
                  {bal && (
                    <div style={{ fontSize: 11, color: C.textHint, marginTop: 2 }}>
                      Solde avant : {bal.rem}j · après : {bal.rem - l.days}j
                    </div>
                  )}
                  {l.comment && (
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, fontStyle:'italic' }}>
                      « {l.comment} »
                    </div>
                  )}
                </div>
                <Badge s="pending" />
              </div>

              {isAlert && (
                <Alert type="warning">
                  ⚠ {ov.length} salarié{ov.length > 1 ? 's' : ''} déjà en congé
                  ({ov.map(x => x.employee_name).join(', ')}).
                  Approuver dépasserait le seuil de {settings.alertThreshold}.
                </Alert>
              )}
              {ov.length > 0 && !isAlert && (
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
                  Chevauchement avec : {ov.map(x => x.employee_name).join(', ')}
                </div>
              )}

              <div style={{ display:'flex', gap: 8 }}>
                <Btn variant="success" onClick={() => approve(l.id)} disabled={saving} full>
                  ✓ Approuver
                </Btn>
                <Btn variant="danger" onClick={() => setRejectModal(l.id)} disabled={saving} full>
                  × Refuser
                </Btn>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>
          Historique ({done.length})
        </div>
        {done.map(l => (
          <div key={l.id} style={{ ...CARD, marginBottom: 8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{l.employee_name}</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  {fmt(l.start_date)} → {fmt(l.end_date)} · {l.days}j
                </div>
                {l.reject_reason && (
                  <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>
                    {l.reject_reason}
                  </div>
                )}
              </div>
              <Badge s={l.status} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AdminSettings({ settings, token, onSaved }) {
  const [threshold, setThreshold] = useState(settings.alertThreshold);
  const [saved, setSaved]         = useState(false);
  const [saving, setSaving]       = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const data = await api('PUT', '/settings', { alertThreshold: parseInt(threshold) }, token);
      onSaved(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div style={CARD}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Paramètres de l'organisation</h2>

      <div style={{
        background: C.bgSecond, borderRadius: 10,
        padding: '14px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Seuil d'alerte de chevauchement
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
          Une alerte s'affiche lorsque le nombre de salariés en congé simultanément
          atteint ce seuil au moment de la validation.
        </div>
        <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
          <input type="number" value={threshold} min={1} max={50}
            onChange={e => { setThreshold(e.target.value); setSaved(false); }}
            style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: C.textMuted }}>
            salarié{threshold > 1 ? 's' : ''} simultané{threshold > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
        <Btn onClick={save} disabled={saving}>Enregistrer</Btn>
        {saved && (
          <span style={{ fontSize: 13, color: C.green, fontWeight: 500 }}>✓ Enregistré</span>
        )}
      </div>
    </div>
  );
}

// ── VUE EMPLOYÉ ────────────────────────────────────────────────────────────
function EmployeeView({ session, onLogout }) {
  const { token, user, org } = session;
  const [tab, setTab]       = useState(0);
  const [me, setMe]         = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [myData, lvs] = await Promise.all([
        api('GET', '/me',     null, token),
        api('GET', '/leaves', null, token),
      ]);
      setMe(myData); setLeaves(lvs);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const TABS = ['Mon espace', 'Nouvelle demande', 'Historique'];

  return (
    <Layout user={user} org={org} onLogout={onLogout}
      tabs={TABS} activeTab={tab} onTab={setTab} pendingCount={0}>
      {loading ? <Spinner /> : (
        <>
          {tab === 0 && <EmpHome me={me} leaves={leaves} />}
          {tab === 1 && <EmpRequest me={me} leaves={leaves} token={token} onDone={load} />}
          {tab === 2 && <EmpHistory leaves={leaves} />}
        </>
      )}
    </Layout>
  );
}

function EmpHome({ me, leaves }) {
  if (!me) return null;
  const todayStr = today();
  const rem = me.annual_days - me.taken_days;
  const upcoming = leaves.filter(l =>
    l.status === 'approved' && l.end_date >= todayStr
  ).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const pending = leaves.filter(l => l.status === 'pending');

  return (
    <>
      <div style={{ display:'flex', gap: 10, marginBottom: '1.25rem' }}>
        <MetricCard label="Annuels"   value={me.annual_days} />
        <MetricCard label="Pris"      value={me.taken_days} color={me.taken_days > 0 ? C.amber : C.text} />
        <MetricCard label="Restants"  value={rem} color={rem <= 5 ? C.red : C.green} />
      </div>

      {pending.length > 0 && (
        <Alert type="info">
          ⏳ {pending.length} demande{pending.length > 1 ? 's' : ''} en attente de validation.
        </Alert>
      )}

      {upcoming.length > 0 && (
        <div style={{ ...CARD, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>
            Prochains congés approuvés
          </div>
          {upcoming.map((l, i) => (
            <div key={l.id} style={{
              display: 'flex', justifyContent:'space-between', fontSize: 13,
              padding: '6px 0', borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            }}>
              <span>{fmt(l.start_date)} → {fmt(l.end_date)}</span>
              <span style={{ color: C.textMuted }}>{l.days}j</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EmpRequest({ me, leaves, token, onDone }) {
  const [start, setStart]   = useState('');
  const [end, setEnd]       = useState('');
  const [comment, setComment] = useState('');
  const [err, setErr]       = useState('');
  const [done, setDone]     = useState(false);
  const [saving, setSaving] = useState(false);

  if (!me) return null;
  const rem  = me.annual_days - me.taken_days;
  const days = start && end && end >= start ? workDays(start, end) : 0;

  const submit = async () => {
    if (!start || !end) return setErr('Sélectionnez les deux dates.');
    if (end < start) return setErr('La date de fin doit être après le début.');
    if (days === 0) return setErr('Aucun jour ouvré sur cette période.');
    if (days > rem) return setErr(`Solde insuffisant (${rem} jour${rem > 1 ? 's' : ''} restant${rem > 1 ? 's' : ''}).`);
    setSaving(true); setErr('');
    try {
      await api('POST', '/leaves', { startDate: start, endDate: end, days, comment }, token);
      setDone(true); setStart(''); setEnd(''); setComment('');
      onDone();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  if (done) return (
    <div style={{ ...CARD, textAlign:'center' }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Demande envoyée</h2>
      <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
        En attente de validation par l'administrateur.
      </p>
      <Btn variant="ghost" onClick={() => setDone(false)}>Nouvelle demande</Btn>
    </div>
  );

  return (
    <div style={CARD}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Nouvelle demande de congé</h2>

      <div style={{
        background: C.bgSecond, borderRadius: 8, padding: '9px 12px',
        marginBottom: 14, fontSize: 13, color: C.textMuted,
      }}>
        Solde disponible :
        <strong style={{ color: rem <= 3 ? C.red : C.text, marginLeft: 4 }}>
          {rem} jour{rem > 1 ? 's' : ''}
        </strong>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Date de début">
          <input type="date" value={start} min={today()}
            onChange={e => { setStart(e.target.value); setErr(''); }}
            style={{ width:'100%' }} />
        </Field>
        <Field label="Date de fin">
          <input type="date" value={end} min={start || today()}
            onChange={e => { setEnd(e.target.value); setErr(''); }}
            style={{ width:'100%' }} />
        </Field>
      </div>

      {days > 0 && (
        <div style={{
          marginBottom: 12, padding: '8px 12px',
          background: C.blueLight, borderRadius: 8,
          fontSize: 13, color: C.blueDark, fontWeight: 500,
        }}>
          {days} jour{days > 1 ? 's' : ''} ouvré{days > 1 ? 's' : ''}
        </div>
      )}

      <Field label="Commentaire (optionnel)">
        <textarea value={comment} onChange={e => setComment(e.target.value)}
          rows={3} placeholder="Motif, précision…" style={{ width:'100%' }} />
      </Field>

      {err && <Alert type="error">{err}</Alert>}
      <Btn full onClick={submit} disabled={saving || !days}>
        {saving ? 'Envoi…' : 'Soumettre la demande'}
      </Btn>
    </div>
  );
}

function EmpHistory({ leaves }) {
  if (!leaves.length) return (
    <div style={{ ...CARD, fontSize: 13, color: C.textHint, textAlign:'center', padding:'2rem' }}>
      Aucune demande de congé.
    </div>
  );
  return (
    <>
      {[...leaves].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(l => (
        <div key={l.id} style={{ ...CARD, marginBottom: 10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>
                {fmt(l.start_date)} → {fmt(l.end_date)}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {l.days} jour{l.days > 1 ? 's' : ''} ouvré{l.days > 1 ? 's' : ''}
              </div>
              {l.comment && (
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, fontStyle:'italic' }}>
                  « {l.comment} »
                </div>
              )}
              {l.reject_reason && (
                <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>
                  Motif de refus : {l.reject_reason}
                </div>
              )}
              <div style={{ fontSize: 11, color: C.textHint, marginTop: 4 }}>
                Déposée le {fmt(l.created_at)}
              </div>
            </div>
            <Badge s={l.status} />
          </div>
        </div>
      ))}
    </>
  );
}

// ── App root ───────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(() => loadSession());

  const handleLogin = (data) => {
    const s = { token: data.token, user: data.user, org: data.org || null };
    saveSession(s);
    setSession(s);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session) return <LoginScreen onLogin={handleLogin} />;

  const role = session.user.role;
  if (role === 'superadmin') return <SuperAdminView session={session} onLogout={handleLogout} />;
  if (role === 'admin')      return <AdminView      session={session} onLogout={handleLogout} />;
  return                            <EmployeeView   session={session} onLogout={handleLogout} />;
}
