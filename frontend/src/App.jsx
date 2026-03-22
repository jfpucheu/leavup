import { useState, useEffect, useCallback, useRef } from 'react';

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
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Erreur serveur (${res.status}) — réponse inattendue`); }
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

// ── Design tokens — Aurora ──────────────────────────────────────────────────
const C = {
  blue:      '#0ea5e9',
  blueDark:  '#0369a1',
  blueLight: '#e0f2fe',
  green:     '#059669',
  greenLight:'#d1fae5',
  red:       '#dc2626',
  redLight:  '#fee2e2',
  amber:     '#d97706',
  amberLight:'#fef3c7',
  border:    '#e2e8f0',
  bg:        '#f0f9ff',
  bgCard:    '#ffffff',
  bgSecond:  '#f1f5f9',
  text:      '#0f172a',
  textMuted: '#475569',
  textHint:  '#94a3b8',
};

const CARD = {
  background: C.bgCard,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: '1rem 1.25rem',
  boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
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
    border: 'none', borderRadius: 9, cursor: disabled ? 'default' : 'pointer',
    fontWeight: 600, fontFamily: 'inherit', opacity: disabled ? 0.55 : 1,
    padding: small ? '6px 12px' : '10px 18px',
    fontSize: small ? 12 : 14,
    width: full ? '100%' : 'auto', transition: 'opacity 0.15s, transform 0.1s',
    letterSpacing: '0.01em',
  };
  const variants = {
    primary: { background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', color: 'white', boxShadow: '0 2px 8px rgba(14,165,233,0.35)' },
    success: { background: 'linear-gradient(135deg, #059669, #10b981)', color: 'white', boxShadow: '0 2px 8px rgba(5,150,105,0.3)' },
    danger:  { background: 'linear-gradient(135deg, #dc2626, #ef4444)', color: 'white', boxShadow: '0 2px 8px rgba(220,38,38,0.3)' },
    ghost:   { background: 'white', color: C.text, border: `1px solid ${C.border}`, boxShadow: '0 1px 3px rgba(15,23,42,0.07)' },
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

function PasswordConfirmFields({ value, confirm, onChange, onConfirmChange, labelMain, labelConfirm, placeholder }) {
  const mismatch = confirm.length > 0 && value !== confirm;
  const match    = confirm.length > 0 && value === confirm;
  return (
    <>
      <Field label={labelMain || 'Mot de passe *'}>
        <input type="password" value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ''} style={{ width: '100%' }} />
      </Field>
      <Field label={labelConfirm || 'Confirmer le mot de passe *'}>
        <input type="password" value={confirm} onChange={e => onConfirmChange(e.target.value)}
          style={{ width: '100%', borderColor: mismatch ? C.red : match ? C.green : undefined }} />
        {mismatch && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>Les mots de passe ne correspondent pas.</div>}
        {match    && <div style={{ fontSize: 11, color: C.green, marginTop: 3 }}>Mots de passe identiques ✓</div>}
      </Field>
    </>
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
      background: 'white', borderRadius: 12, border: `1px solid ${C.border}`,
      boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
      padding: '14px 10px', textAlign: 'center', flex: 1,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Détection du sous-domaine ───────────────────────────────────────────────
function detectSubdomain() {
  const host  = window.location.hostname; // ex: "toto.leavup.com" ou "localhost"
  const parts = host.split('.');
  // Sous-domaine valide : ≥3 parties, premier segment ≠ "www" et ≠ "congeo"
  if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'leavup') {
    return parts[0];
  }
  // Fallback en dev : paramètre ?org=toto dans l'URL
  return new URLSearchParams(window.location.search).get('org') || null;
}

// ── Écran de réinitialisation de mot de passe ──────────────────────────────
function ResetPasswordScreen({ token, onDone }) {
  const [info, setInfo]   = useState(null);
  const [pw, setPw]       = useState('');
  const [pw2, setPw2]     = useState('');
  const [err, setErr]     = useState('');
  const [done, setDone]   = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('GET', `/auth/check-token?token=${token}`)
      .then(setInfo)
      .catch(e => setErr(e.message));
  }, [token]);

  const submit = async () => {
    if (!pw || pw.length < 6) return setErr('Mot de passe trop court (6 caractères minimum).');
    if (pw !== pw2) return setErr('Les mots de passe ne correspondent pas.');
    setSaving(true); setErr('');
    try {
      await api('POST', '/auth/reset-password', { token, password: pw });
      setDone(true);
      // Nettoie l'URL sans recharger la page
      window.history.replaceState({}, '', window.location.pathname);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background: C.bg, padding: 16 }}>
      <div style={{ ...CARD, width:'100%', maxWidth: 380 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 24, letterSpacing:'-0.02em' }}>Congéo</div>
        {done ? (
          <>
            <Alert type="success">Mot de passe défini avec succès !</Alert>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
              Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
            </p>
            <Btn full onClick={onDone}>Se connecter</Btn>
          </>
        ) : !info && !err ? (
          <Spinner />
        ) : err && !info ? (
          <>
            <Alert type="error">{err}</Alert>
            <Btn variant="ghost" full onClick={onDone}>Retour à la connexion</Btn>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Choisir mon mot de passe</h2>
            <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>
              Bonjour {info?.firstname} {info?.lastname} — définissez votre mot de passe pour activer votre compte.
            </p>
            <Field label="Nouveau mot de passe">
              <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(''); }}
                style={{ width:'100%' }} autoFocus />
            </Field>
            <Field label="Confirmer le mot de passe">
              <input type="password" value={pw2} onChange={e => { setPw2(e.target.value); setErr(''); }}
                style={{ width:'100%' }}
                onKeyDown={e => e.key === 'Enter' && submit()} />
            </Field>
            {err && <Alert type="error">{err}</Alert>}
            <Btn full onClick={submit} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Activer mon compte'}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ── Écran de connexion ─────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const subdomainSlug = detectSubdomain();
  // Si sous-domaine détecté → aller directement aux credentials
  const [step, setStep]       = useState(subdomainSlug ? 'creds' : 'org');
  const [orgSlug, setOrgSlug] = useState(subdomainSlug || '');
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
      justifyContent: 'center', padding: '1rem',
      background: 'linear-gradient(160deg, #0f172a 0%, #1e3a8a 50%, #0ea5e9 100%)',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: 60, height: 60, borderRadius: 18,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(8px)',
            margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: 'white', letterSpacing: '-0.04em' }}>
            Leav<span style={{ color: '#38bdf8' }}>up</span>
          </h1>
          {subdomainSlug ? (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
              {orgSlug}<span style={{ color: 'rgba(255,255,255,0.4)' }}>.leavup.com</span>
            </p>
          ) : (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
              Gestion des absences pour votre entreprise
            </p>
          )}
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 18, padding: '1.5rem',
          boxShadow: '0 8px 32px rgba(15,23,42,0.3)',
          border: '1px solid rgba(255,255,255,0.3)',
          backdropFilter: 'blur(16px)',
        }}>
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
                  <span>🏢 <strong>{orgSlug}</strong>.leavup.com</span>
                  {/* Permettre de changer d'org seulement si on n'est pas sur un sous-domaine */}
                  {!subdomainSlug && (
                    <button type="button" onClick={() => { setStep('org'); setErr(''); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.blue }}>
                      Changer
                    </button>
                  )}
                </div>
              )}
              {step === 'super' && (
                <Alert type="info">Connexion Super Admin — leavup.com</Alert>
              )}
              <Field label={step === 'super' ? 'Identifiant' : 'Identifiant ou email'}>
                <input
                  value={id}
                  onChange={e => { setId(e.target.value); setErr(''); }}
                  placeholder={step === 'super' ? 'superadmin' : 'TOJD-2J7M ou prenom@email.fr'}
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
function Layout({ user, org, onLogout, tabs, activeTab, onTab, pendingCount, fullWidth, children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
        padding: '0 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        height: 56, position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 12px rgba(15,23,42,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {org?.logoData ? (
            <img src={org.logoData} alt="logo"
              style={{ height: org?.logoSize === 'S' ? 24 : org?.logoSize === 'L' ? 48 : 34, objectFit: 'contain', borderRadius: 8, background: 'white', padding: 2 }} />
          ) : (
            <span style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>{org?.name}</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.45)', letterSpacing: '-0.02em' }}>
            Leav<span style={{ color: '#38bdf8' }}>up</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{user.name}</span>
          <button onClick={onLogout} style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
            color: 'white', borderRadius: 8, padding: '5px 12px', fontSize: 12,
            cursor: 'pointer', fontWeight: 500, backdropFilter: 'blur(4px)',
          }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        background: 'white', borderBottom: `1px solid ${C.border}`,
        display: 'flex', overflowX: 'auto', scrollbarWidth: 'none',
        padding: '0 8px',
      }}>
        {tabs.map((t, i) => (
          <button key={t} onClick={() => onTab(i)} style={{
            flex: '0 0 auto', padding: '12px 16px', fontSize: 13,
            border: 'none', cursor: 'pointer', background: 'none',
            color: activeTab === i ? C.blue : C.textMuted,
            borderBottom: activeTab === i ? `2px solid ${C.blue}` : '2px solid transparent',
            fontWeight: activeTab === i ? 600 : 400, whiteSpace: 'nowrap',
            fontFamily: 'inherit', transition: 'color 0.15s',
          }}>
            {t}
            {pendingCount > 0 && i === 2 && user.role === 'admin' && (
              <span style={{
                marginLeft: 6, background: C.red, color: 'white',
                borderRadius: 20, fontSize: 10, padding: '2px 7px', fontWeight: 700,
              }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '1.25rem 1rem', maxWidth: fullWidth ? '100%' : 660, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

// ── Formulaire organisation (top-level pour que le file input fonctionne) ──
function OrgFormFields({ form, setForm, isEdit }) {
  const handleLogo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setForm(f => ({ ...f, logoData: ev.target.result }));
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Field label="Logo de l'entreprise">
        <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
          {form.logoData && (
            <img src={form.logoData} alt="logo"
              style={{ height: 52, width: 52, objectFit:'contain', borderRadius: 8,
                border: `1px solid ${C.border}`, padding: 4, background: 'white' }} />
          )}
          <div style={{ display:'flex', alignItems:'center', gap: 8, flexWrap:'wrap' }}>
            <input type="file" accept="image/*"
              onChange={handleLogo}
              style={{ fontSize: 12, cursor:'pointer' }} />
            {form.logoData && (
              <button type="button" onClick={() => setForm(f=>({...f, logoData:''}))}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize: 11, color: C.red }}>
                Supprimer
              </button>
            )}
          </div>
        </div>
      </Field>

      <div style={{ fontWeight: 600, fontSize: 12, color: C.textMuted, marginBottom: 8, marginTop: 4 }}>ENTREPRISE</div>
      <Field label="Nom de l'entreprise *">
        <input value={form.name} onChange={e => setForm(f=>({...f, name: e.target.value}))} style={{ width:'100%' }} />
      </Field>
      <Field label="Code (slug) * — utilisé à la connexion">
        <input value={form.slug}
          onChange={e => setForm(f=>({...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}))}
          placeholder="acme-corp" style={{ width:'100%' }}
          disabled={isEdit} />
        {isEdit && (
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Non modifiable après création.</div>
        )}
      </Field>
      <Field label="SIRET">
        <input value={form.siret} maxLength={14} placeholder="12345678901234"
          onChange={e => setForm(f=>({...f, siret: e.target.value.replace(/\D/g,'')}))}
          style={{ width: 160 }} />
      </Field>

      <div style={{ fontWeight: 600, fontSize: 12, color: C.textMuted, marginBottom: 8, marginTop: 12 }}>ADRESSE</div>
      <Field label="Rue">
        <input value={form.addressStreet}
          onChange={e => setForm(f=>({...f, addressStreet: e.target.value}))}
          style={{ width:'100%' }} placeholder="12 rue de la Paix" />
      </Field>
      <div style={{ display:'flex', gap: 10 }}>
        <Field label="Code postal">
          <input value={form.addressZip}
            onChange={e => setForm(f=>({...f, addressZip: e.target.value}))}
            style={{ width: 90 }} placeholder="75001" />
        </Field>
        <div style={{ flex: 1 }}>
          <Field label="Ville">
            <input value={form.addressCity}
              onChange={e => setForm(f=>({...f, addressCity: e.target.value}))}
              style={{ width:'100%' }} placeholder="Paris" />
          </Field>
        </div>
      </div>
      <Field label="Pays">
        <input value={form.addressCountry}
          onChange={e => setForm(f=>({...f, addressCountry: e.target.value}))}
          style={{ width: 160 }} />
      </Field>

      <div style={{ fontWeight: 600, fontSize: 12, color: C.textMuted, marginBottom: 8, marginTop: 12 }}>COMPTE ADMIN</div>
      <div style={{ display:'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Field label="Prénom *">
            <input value={form.adminFirstname}
              onChange={e => {
                const v = e.target.value;
                setForm(f => ({
                  ...f, adminFirstname: v,
                  ...(!isEdit && { adminIdentifier: genIdentifier(f.slug, v, f.adminLastname) }),
                }));
              }}
              style={{ width:'100%' }} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Nom *">
            <input value={form.adminLastname}
              onChange={e => {
                const v = e.target.value;
                setForm(f => ({
                  ...f, adminLastname: v,
                  ...(!isEdit && { adminIdentifier: genIdentifier(f.slug, f.adminFirstname, v) }),
                }));
              }}
              style={{ width:'100%' }} />
          </Field>
        </div>
      </div>
      <div style={{ display:'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Field label="Email">
            <input type="email" value={form.adminEmail}
              onChange={e => setForm(f=>({...f, adminEmail: e.target.value}))}
              style={{ width:'100%' }} placeholder="prenom@entreprise.fr" />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Téléphone">
            <input type="tel" value={form.adminPhone}
              onChange={e => setForm(f=>({...f, adminPhone: e.target.value}))}
              style={{ width:'100%' }} placeholder="06 00 00 00 00" />
          </Field>
        </div>
      </div>
      <Field label="Identifiant de connexion">
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <input value={form.adminIdentifier} readOnly
            style={{ width:'100%', background: C.bgSecond, color: C.text, fontFamily:'monospace', fontWeight:600 }} />
          {!isEdit && (
            <button type="button" onClick={() => setForm(f => ({...f, adminIdentifier: genIdentifier(f.slug, f.adminFirstname, f.adminLastname)}))}
              style={{ whiteSpace:'nowrap', fontSize:11, padding:'4px 8px', border:`1px solid ${C.border}`, borderRadius:6, background:'white', cursor:'pointer', color: C.textMuted }}>
              ↺ Regénérer
            </button>
          )}
        </div>
        {isEdit && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Non modifiable après création.</div>}
      </Field>
      {isEdit ? (
        <Field label="Nouveau mot de passe (laisser vide pour ne pas changer)">
          <input type="password" value={form.adminPassword}
            onChange={e => setForm(f=>({...f, adminPassword: e.target.value}))}
            placeholder="••••••••" style={{ width:'100%' }} />
        </Field>
      ) : (
        <PasswordConfirmFields
          value={form.adminPassword}           onChange={v => setForm(f=>({...f, adminPassword: v}))}
          confirm={form.adminPasswordConfirm}  onConfirmChange={v => setForm(f=>({...f, adminPasswordConfirm: v}))}
        />
      )}
    </>
  );
}

// ── VUE SUPERADMIN ─────────────────────────────────────────────────────────
function SuperAdminView({ session, onLogout }) {
  const { token } = session;
  const [orgs, setOrgs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null); // 'create' | 'edit'
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving]   = useState(false);

  const emptyForm = {
    name:'', slug:'', adminPassword:'', adminPasswordConfirm:'',
    adminFirstname:'', adminLastname:'', adminEmail:'', adminPhone:'', adminIdentifier:'',
    siret:'', addressStreet:'', addressCity:'', addressZip:'', addressCountry:'France',
    logoData:'',
  };
  const [form, setForm]       = useState(emptyForm);
  const [editId, setEditId]   = useState(null);

  const load = useCallback(async () => {
    try { setOrgs(await api('GET', '/orgs', null, token)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);


  const createOrg = async () => {
    if (!form.name || !form.slug || !form.adminFirstname || !form.adminLastname || !form.adminIdentifier || !form.adminPassword)
      return setFormErr('Nom, slug, prénom/nom/identifiant admin et mot de passe sont obligatoires');
    if (form.adminPassword !== form.adminPasswordConfirm)
      return setFormErr('Les mots de passe ne correspondent pas');
    setSaving(true); setFormErr('');
    try {
      await api('POST', '/orgs', form, token);
      setModal(null); setForm(emptyForm); load();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const openEdit = (org) => {
    setForm({
      name:             org.name,
      slug:             org.slug,
      adminPassword:    '',
      adminFirstname:   org.admin_firstname  || '',
      adminLastname:    org.admin_lastname   || '',
      adminEmail:       org.admin_email      || '',
      adminPhone:       org.contact_phone    || '',
      adminIdentifier:  org.admin_identifier || '',
      siret:            org.siret            || '',
      addressStreet:    org.address_street   || '',
      addressCity:      org.address_city     || '',
      addressZip:       org.address_zip      || '',
      addressCountry:   org.address_country  || 'France',
      logoData:         org.logo_data        || '',
    });
    setEditId(org.id);
    setModal('edit'); setFormErr('');
  };

  const saveEdit = async () => {
    if (!form.name) return setFormErr('Le nom est obligatoire');
    setSaving(true); setFormErr('');
    try {
      await api('PUT', `/orgs/${editId}`, form, token);
      setModal(null); load();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const deleteOrg = async (id) => {
    if (!confirm('Supprimer cette organisation ? Toutes les données seront perdues.')) return;
    await api('DELETE', `/orgs/${id}`, null, token);
    load();
  };

  // Formulaire partagé création / édition
  // JSX du formulaire — inliné directement pour éviter le re-mount à chaque frappe

  return (
    <>
      {modal === 'create' && (
        <Modal title="Nouvelle organisation" onClose={() => { setModal(null); setFormErr(''); }}>
          <OrgFormFields form={form} setForm={setForm} isEdit={modal === 'edit'} />
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap:8, marginTop: 4 }}>
            <Btn onClick={createOrg} disabled={saving} full>Créer l'organisation</Btn>
            <Btn variant="ghost" onClick={() => setModal(null)} full>Annuler</Btn>
          </div>
        </Modal>
      )}
      {modal === 'edit' && (
        <Modal title="Modifier l'organisation" onClose={() => { setModal(null); setFormErr(''); }}>
          <OrgFormFields form={form} setForm={setForm} isEdit={modal === 'edit'} />
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap:8, marginTop: 4 }}>
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
          <span style={{ fontSize: 17, fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>
            Leavup <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.7 }}>· Super Admin</span>
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
            <Btn onClick={() => { setForm(emptyForm); setModal('create'); setFormErr(''); }}>
              + Nouvelle organisation
            </Btn>
          </div>

          {loading ? <Spinner /> : orgs.length === 0 ? (
            <div style={{ ...CARD, textAlign:'center', color: C.textHint, fontSize: 14, padding: '2rem' }}>
              Aucune organisation. Créez-en une pour commencer.
            </div>
          ) : orgs.map(org => (
            <div key={org.id} style={{ ...CARD, marginBottom: 10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: 12 }}>
                {/* Logo */}
                {org.logo_data && (
                  <img src={org.logo_data} alt="logo"
                    style={{ width: 44, height: 44, objectFit:'contain', borderRadius: 8,
                      border: `1px solid ${C.border}`, padding: 3, background: 'white', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{org.name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, display:'flex', gap: 10, flexWrap:'wrap', alignItems:'center' }}>
                    <span style={{ color: C.blue, fontWeight: 500 }}>
                      {org.slug}.leavup.com
                    </span>
                    {org.siret && <span>· SIRET : {org.siret}</span>}
                  </div>
                  {(org.address_city || org.address_street) && (
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                      📍 {[org.address_street, org.address_zip, org.address_city, org.address_country].filter(Boolean).join(', ')}
                    </div>
                  )}
                  {(org.contact_firstname || org.contact_lastname) && (
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                      👤 {[org.contact_firstname, org.contact_lastname].filter(Boolean).join(' ')}
                      {org.contact_email && ` · ${org.contact_email}`}
                    </div>
                  )}
                  <div style={{ display:'flex', gap: 14, fontSize: 12, color: C.textMuted, marginTop: 6 }}>
                    <span>👥 {org.user_count} utilisateur{org.user_count > 1 ? 's' : ''}</span>
                    {parseInt(org.pending_count) > 0 && (
                      <span style={{ color: C.amber }}>⏳ {org.pending_count} en attente</span>
                    )}
                    <span style={{ fontSize: 11, color: C.textHint }}>Créée le {fmt(org.created_at)}</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap: 6, flexShrink: 0 }}>
                  <Btn small variant="ghost" onClick={() => openEdit(org)}>Modifier</Btn>
                  <Btn small variant="danger" onClick={() => deleteOrg(org.id)}>Supprimer</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>

        <SmtpConfig token={token} />
      </div>
    </>
  );
}

function SmtpConfig({ token }) {
  const [cfg, setCfg]     = useState({ smtp_host:'', smtp_port:'587', smtp_secure:'false', smtp_user:'', smtp_pass:'', smtp_from:'' });
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg]     = useState(null); // { type, text }
  const [open, setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api('GET', '/superadmin/smtp', null, token)
      .then(data => setCfg(c => ({ ...c, ...data })))
      .catch(() => {});
  }, [open, token]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api('PUT', '/superadmin/smtp', cfg, token);
      setMsg({ type:'success', text:'Configuration sauvegardée.' });
    } catch (e) { setMsg({ type:'error', text: e.message }); }
    setSaving(false);
  };

  const test = async () => {
    if (!testTo) return setMsg({ type:'error', text:'Saisissez une adresse email de test.' });
    setSaving(true); setMsg(null);
    try {
      await api('POST', '/superadmin/smtp/test', { to: testTo }, token);
      setMsg({ type:'success', text:`Email de test envoyé à ${testTo}` });
    } catch (e) { setMsg({ type:'error', text: e.message }); }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 1rem 2rem' }}>
      <div style={{ ...CARD }}>
        <button onClick={() => setOpen(o => !o)} style={{
          width:'100%', background:'none', border:'none', cursor:'pointer',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          fontSize: 14, fontWeight: 600, padding: 0,
        }}>
          <span>⚙ Configuration email (SMTP)</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display:'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <Field label="Serveur SMTP (host)">
                  <input value={cfg.smtp_host} onChange={e => setCfg(c=>({...c, smtp_host: e.target.value}))}
                    placeholder="smtp.gmail.com" style={{ width:'100%' }} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Port">
                  <input value={cfg.smtp_port} onChange={e => setCfg(c=>({...c, smtp_port: e.target.value}))}
                    placeholder="587" style={{ width:'100%' }} />
                </Field>
              </div>
              <div style={{ flex: 1, paddingTop: 22 }}>
                <label style={{ display:'flex', alignItems:'center', gap: 6, fontSize: 13, cursor:'pointer' }}>
                  <input type="checkbox" checked={cfg.smtp_secure === 'true'}
                    onChange={e => setCfg(c=>({...c, smtp_secure: e.target.checked ? 'true' : 'false'}))} />
                  SSL/TLS
                </label>
              </div>
            </div>
            <Field label="Utilisateur SMTP">
              <input value={cfg.smtp_user} onChange={e => setCfg(c=>({...c, smtp_user: e.target.value}))}
                placeholder="noreply@leavup.com" style={{ width:'100%' }} autoComplete="off" />
            </Field>
            <Field label="Mot de passe SMTP">
              <input type="password" value={cfg.smtp_pass} onChange={e => setCfg(c=>({...c, smtp_pass: e.target.value}))}
                placeholder="••••••••" style={{ width:'100%' }} autoComplete="new-password" />
            </Field>
            <Field label="Email expéditeur (From)">
              <input type="email" value={cfg.smtp_from} onChange={e => setCfg(c=>({...c, smtp_from: e.target.value}))}
                placeholder="noreply@leavup.com" style={{ width:'100%' }} />
            </Field>

            {msg && <Alert type={msg.type}>{msg.text}</Alert>}

            <div style={{ display:'flex', gap: 8, marginTop: 8 }}>
              <Btn onClick={save} disabled={saving}>Sauvegarder</Btn>
              <div style={{ display:'flex', gap: 6, flex: 1 }}>
                <input value={testTo} onChange={e => setTestTo(e.target.value)}
                  placeholder="email@test.com"
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                    fontSize: 13, background: C.bg, color: C.text, outline: 'none' }} />
                <Btn variant="ghost" onClick={test} disabled={saving}>Tester</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── VUE ADMIN ──────────────────────────────────────────────────────────────
function AdminView({ session, onLogout, onLogoChange }) {
  const { token, org } = session;
  const [tab, setTab]               = useState(0);
  const [users, setUsers]           = useState([]);
  const [leaves, setLeaves]         = useState([]);
  const [contracts, setContracts]   = useState([]);
  const [settings, setSettings]     = useState({ alertThreshold: org.alertThreshold });
  const [loading, setLoading]       = useState(true);
  const [highlightLeave, setHighlightLeave] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [u, l, s, c] = await Promise.all([
        api('GET', '/users',     null, token),
        api('GET', '/leaves',    null, token),
        api('GET', '/settings',  null, token),
        api('GET', '/contracts', null, token),
      ]);
      setUsers(u); setLeaves(l); setSettings(s); setContracts(c);
    } catch (e) { console.error(e); }
    if (!silent) setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const pendingCount = leaves.filter(l => l.status === 'pending').length;
  const TABS = ['Tableau de bord', 'Salariés', 'Demandes', 'Contrats', 'Planning', 'Paramètres'];

  return (
    <Layout user={session.user} org={org} onLogout={onLogout}
      tabs={TABS} activeTab={tab} onTab={setTab} pendingCount={pendingCount}
      fullWidth={tab === 4}>
      {loading ? <Spinner /> : (
        <>
          {tab === 0 && <AdminDash users={users} leaves={leaves} settings={settings} />}
          {tab === 1 && <AdminUsers users={users} contracts={contracts} leaves={leaves} token={token} org={org} onRefresh={load} />}
          {tab === 2 && <AdminLeaves users={users} leaves={leaves} settings={settings} token={token} onRefresh={load} highlightLeave={highlightLeave} onHighlightDone={() => setHighlightLeave(null)} />}
          {tab === 3 && <AdminContracts contracts={contracts} token={token} onRefresh={load} />}
          {tab === 4 && <AdminPlanning users={users} leaves={leaves} onPendingClick={id => { setHighlightLeave(id); setTab(2); }} />}
          {tab === 5 && <AdminSettings settings={settings} token={token} org={org} onSaved={(s) => setSettings(s)} onLogoChange={onLogoChange} />}
        </>
      )}
    </Layout>
  );
}

function AdminDash({ users, leaves, settings }) {
  const todayStr = today();
  const pending  = leaves.filter(l => l.status === 'pending');
  const d10 = (d) => d ? String(d).slice(0, 10) : '';
  const onLeave  = leaves.filter(l =>
    l.status === 'approved' && d10(l.start_date) <= todayStr && d10(l.end_date) >= todayStr
  );
  const alertLeaves = pending.filter(req => {
    const ov = leaves.filter(l =>
      l.id !== req.id && l.status === 'approved' &&
      d10(l.start_date) <= d10(req.end_date) && d10(l.end_date) >= d10(req.start_date)
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

function genIdentifier(orgSlug, firstname, lastname) {
  const slugPart = (orgSlug || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
  const initials = ((firstname || '')[0] || '') + ((lastname || '')[0] || '');
  const prefix = (slugPart + initials.toUpperCase()).slice(0, 4);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${rand}`;
}

function AdminUsers({ users, contracts, leaves, token, org, onRefresh }) {
  const [modal, setModal]     = useState(null);
  const [target, setTarget]   = useState(null);
  const emptyForm = {
    identifier:'', firstname:'', lastname:'', password:'', passwordConfirm:'',
    phone:'', email:'',
    addressStreet:'', addressCity:'', addressZip:'', addressCountry:'France',
    entryDate:'', contractId:'', cpBalance:'0', rttBalance:'0', autoAccumulate:true,
  };
  const [form, setForm]       = useState(emptyForm);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving]   = useState(false);

  const takenDays = (userId) =>
    leaves.filter(l => l.user_id === userId && l.status === 'approved' && (l.leave_type || 'paid') === 'paid')
      .reduce((s, l) => s + l.days, 0);

  const takenUnpaidDays = (userId) =>
    leaves.filter(l => l.user_id === userId && l.status === 'approved' && l.leave_type === 'unpaid')
      .reduce((s, l) => s + l.days, 0);

  const openCreate = () => {
    setForm(emptyForm);
    setTarget(null); setFormErr('');
    setModal('form');
  };

  const openEdit = (u) => {
    setForm({
      identifier:     u.identifier,
      firstname:      u.firstname || '',
      lastname:       u.lastname  || '',
      password:       '',
      phone:          u.phone     || '',
      email:          u.email     || '',
      addressStreet:  u.address_street  || '',
      addressCity:    u.address_city    || '',
      addressZip:     u.address_zip     || '',
      addressCountry: u.address_country || 'France',
      entryDate:      u.entry_date ? u.entry_date.split('T')[0] : '',
      contractId:     u.contract_id || '',
      cpBalance:      u.cp_balance ?? 0,
      rttBalance:     u.rtt_balance ?? 0,
      autoAccumulate: u.auto_accumulate ?? true,
    });
    setTarget(u); setFormErr('');
    setModal('form');
  };

  const save = async () => {
    if ((!form.firstname && !form.lastname) || (!target && !form.identifier) || (!target && !form.password))
      return setFormErr('Identifiant, nom/prénom et mot de passe sont obligatoires');
    if (!target && form.password !== form.passwordConfirm)
      return setFormErr('Les mots de passe ne correspondent pas');
    if (!form.entryDate)
      return setFormErr('La date d\'entrée est obligatoire');
    setSaving(true); setFormErr('');
    const payload = {
      firstname:      form.firstname,
      lastname:       form.lastname,
      phone:          form.phone     || null,
      email:          form.email     || null,
      addressStreet:  form.addressStreet  || null,
      addressCity:    form.addressCity    || null,
      addressZip:     form.addressZip     || null,
      addressCountry: form.addressCountry || 'France',
      entryDate:      form.entryDate || null,
      contractId:     form.contractId || null,
      cpBalance:      parseFloat(form.cpBalance) || 0,
      rttBalance:     parseFloat(form.rttBalance) || 0,
      autoAccumulate: form.autoAccumulate,
      ...(form.password ? { password: form.password } : {}),
    };
    try {
      if (target) {
        await api('PUT', `/users/${target.id}`, payload, token);
      } else {
        await api('POST', '/users', { ...payload, identifier: form.identifier, password: form.password }, token);
      }
      setModal(null);
      onRefresh();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const del = async (u) => {
    if (!confirm(`Supprimer ${u.firstname || ''} ${u.lastname || u.name} ?`)) return;
    try {
      await api('DELETE', `/users/${u.id}`, null, token);
      onRefresh();
    } catch (e) { alert(e.message); }
  };

  const resendInvite = async (u) => {
    try {
      await api('POST', `/users/${u.id}/resend-invite`, {}, token);
      alert(`Invitation renvoyée à ${u.email}`);
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      {modal === 'form' && (
        <Modal
          title={target ? `Modifier — ${target.name}` : 'Nouveau salarié'}
          onClose={() => setModal(null)}
        >
          <div style={{ fontWeight:600, fontSize:12, color:C.textMuted, marginBottom:8 }}>IDENTITÉ</div>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ flex:1 }}>
              <Field label="Prénom *">
                <input value={form.firstname}
                  onChange={e => {
                    const firstname = e.target.value;
                    setForm(f => ({
                      ...f,
                      firstname,
                      ...(!target && { identifier: genIdentifier(org.slug, firstname, f.lastname) }),
                    }));
                  }}
                  style={{ width:'100%' }} />
              </Field>
            </div>
            <div style={{ flex:1 }}>
              <Field label="Nom *">
                <input value={form.lastname}
                  onChange={e => {
                    const lastname = e.target.value;
                    setForm(f => ({
                      ...f,
                      lastname,
                      ...(!target && { identifier: genIdentifier(org.slug, f.firstname, lastname) }),
                    }));
                  }}
                  style={{ width:'100%' }} />
              </Field>
            </div>
          </div>
          {!target && (
            <Field label="Identifiant de connexion *">
              <div style={{ display:'flex', gap: 6 }}>
                <input value={form.identifier}
                  onChange={e => setForm(f=>({...f, identifier: e.target.value}))}
                  style={{ flex:1, fontFamily:'monospace', letterSpacing: 1 }}
                  autoCapitalize="off" />
                <button type="button"
                  onClick={() => setForm(f=>({...f, identifier: genIdentifier(org.slug, f.firstname, f.lastname)}))}
                  title="Regénérer"
                  style={{ padding:'0 10px', borderRadius: 6, border:`1px solid ${C.border}`,
                    background: C.bg, cursor:'pointer', fontSize: 14, color: C.textMuted }}>
                  ↻
                </button>
              </div>
            </Field>
          )}
          {target ? (
            <Field label="Nouveau mot de passe (laisser vide = inchangé)">
              <input type="password" value={form.password}
                onChange={e => setForm(f=>({...f, password: e.target.value}))}
                style={{ width:'100%' }} />
            </Field>
          ) : (
            <PasswordConfirmFields
              value={form.password}           onChange={v => setForm(f=>({...f, password: v}))}
              confirm={form.passwordConfirm}  onConfirmChange={v => setForm(f=>({...f, passwordConfirm: v}))}
            />
          )}

          <div style={{ fontWeight:600, fontSize:12, color:C.textMuted, marginBottom:8, marginTop:12 }}>COORDONNÉES</div>
          <Field label="Téléphone">
            <input type="tel" value={form.phone}
              onChange={e => setForm(f=>({...f, phone: e.target.value}))}
              placeholder="06 00 00 00 00" style={{ width:'100%' }} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email}
              onChange={e => setForm(f=>({...f, email: e.target.value}))}
              placeholder="prenom.nom@email.fr" style={{ width:'100%' }} />
          </Field>
          <Field label="Rue">
            <input value={form.addressStreet}
              onChange={e => setForm(f=>({...f, addressStreet: e.target.value}))}
              style={{ width:'100%' }} placeholder="12 rue de la Paix" />
          </Field>
          <div style={{ display:'flex', gap:10 }}>
            <Field label="Code postal">
              <input value={form.addressZip}
                onChange={e => setForm(f=>({...f, addressZip: e.target.value}))}
                style={{ width:90 }} placeholder="75001" />
            </Field>
            <div style={{ flex:1 }}>
              <Field label="Ville">
                <input value={form.addressCity}
                  onChange={e => setForm(f=>({...f, addressCity: e.target.value}))}
                  style={{ width:'100%' }} placeholder="Paris" />
              </Field>
            </div>
          </div>
          <Field label="Pays">
            <input value={form.addressCountry}
              onChange={e => setForm(f=>({...f, addressCountry: e.target.value}))}
              style={{ width:'100%' }} placeholder="France" />
          </Field>

          <div style={{ fontWeight:600, fontSize:12, color:C.textMuted, marginBottom:8, marginTop:12 }}>CONTRAT</div>
          <Field label="Date d'entrée *">
            <input type="date" value={form.entryDate}
              onChange={e => setForm(f=>({...f, entryDate: e.target.value}))}
              style={{ width:'100%' }} />
          </Field>
          <Field label="Type de contrat">
            <select value={form.contractId}
              onChange={e => setForm(f=>({...f, contractId: e.target.value}))}
              style={{ width:'100%' }}>
              <option value="">— Aucun —</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id}>{c.nature} — {c.name} ({c.hours_per_week}h/sem)</option>
              ))}
            </select>
          </Field>
          <div style={{
            background: C.blueLight, borderRadius: 8, padding: '8px 12px',
            fontSize: 12, color: C.blueDark, marginBottom: 14,
          }}>
            📋 CP légaux : <strong>2,5 j ouvrables / mois</strong> = 30 j/an — fixé par le Code du travail (art. L3141-3), idem CDI/CDD/temps partiel.
          </div>
          <div style={{ display:'flex', gap: 12, marginBottom: 0 }}>
            <Field label="Solde CP actuel (jours)">
              <input type="number" step="0.5" min={0} value={form.cpBalance}
                onChange={e => setForm(f=>({...f, cpBalance: e.target.value}))}
                style={{ width: 90 }} />
            </Field>
            <Field label="Solde RTT actuel (jours)">
              <input type="number" step="0.5" min={0} value={form.rttBalance}
                onChange={e => setForm(f=>({...f, rttBalance: e.target.value}))}
                style={{ width: 90 }} />
            </Field>
          </div>
          <Field label="">
            <label style={{ display:'flex', alignItems:'center', gap: 8, fontSize: 13, cursor:'pointer' }}>
              <input type="checkbox" checked={form.autoAccumulate}
                onChange={e => setForm(f=>({...f, autoAccumulate: e.target.checked}))} />
              Cumul automatique des congés (selon contrat)
            </label>
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
        const taken       = takenDays(u.id);
        const takenUnpaid = takenUnpaidDays(u.id);
        const accrued     = parseFloat(u.accrued_cp ?? 0);
        const balance     = accrued + parseFloat(u.cp_balance || 0);
        const rem         = balance - taken;
        return (
          <div key={u.id} style={{ ...CARD, marginBottom: 10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {u.firstname || u.lastname ? `${u.firstname || ''} ${u.lastname || ''}`.trim() : u.name}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  {u.identifier}{u.email && ` · ${u.email}`}{u.phone && ` · ${u.phone}`}
                  {u.role === 'admin' && (
                    <span style={{
                      marginLeft: 6, fontSize: 10, background: C.blueLight,
                      color: C.blue, padding: '1px 6px', borderRadius: 20, fontWeight: 600,
                    }}>admin</span>
                  )}
                </div>
                {(u.contract_name || u.entry_date) && (
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, display:'flex', alignItems:'center', gap: 6 }}>
                    {u.contract_name && (
                      <>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20,
                          background: C.amberLight, color: C.amber,
                        }}>{contracts.find(c=>c.id===u.contract_id)?.nature || ''}</span>
                        <span>{u.contract_name}</span>
                      </>
                    )}
                    {u.entry_date && <span>· entré le {fmt(u.entry_date)}</span>}
                  </div>
                )}
                {u.role !== 'admin' && (
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 5, display:'flex', gap: 12, flexWrap:'wrap' }}>
                    <span>{accrued.toFixed(1)}j acquis · {taken}j pris · <strong style={{ color: rem <= 3 ? C.red : C.text }}>{rem.toFixed(1)}j restants</strong></span>
                    {parseFloat(u.cp_balance) > 0 && (
                      <span style={{ color: C.green }}>CP cumulé: {parseFloat(u.cp_balance).toFixed(1)}j</span>
                    )}
                    {parseFloat(u.rtt_balance) > 0 && (
                      <span style={{ color: C.blue }}>RTT: {parseFloat(u.rtt_balance).toFixed(1)}j</span>
                    )}
                    {takenUnpaid > 0 && (
                      <span style={{ color: C.textMuted }}>Sans solde: {takenUnpaid}j</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                {u.email && (
                  <Btn small variant="ghost" onClick={() => resendInvite(u)} title="Renvoyer l'invitation par email">✉</Btn>
                )}
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

function AdminLeaves({ users, leaves, settings, token, onRefresh, highlightLeave, onHighlightDone }) {
  const [rejectModal, setRejectModal] = useState(null);
  const [reason, setReason]           = useState('');
  const [saving, setSaving]           = useState(false);
  const highlightRef = useRef(null);

  useEffect(() => {
    if (highlightLeave && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(onHighlightDone, 2000);
      return () => clearTimeout(t);
    }
  }, [highlightLeave]);

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

  const d10 = (d) => d ? String(d).slice(0, 10) : '';
  const overlap = (req) => leaves.filter(l =>
    l.id !== req.id && l.status === 'approved' &&
    d10(l.start_date) <= d10(req.end_date) && d10(l.end_date) >= d10(req.start_date)
  );

  const userBalance = (userId) => {
    const u = users.find(x => x.id === userId);
    if (!u) return null;
    const taken = leaves.filter(l => l.user_id === userId && l.status === 'approved')
      .reduce((s, l) => s + l.days, 0);
    const accrued = parseFloat(u.accrued_cp ?? 0) + parseFloat(u.cp_balance || 0);
    return { accrued, taken, rem: accrued - taken };
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

          const isHighlighted = highlightLeave === l.id;
          return (
            <div key={l.id} ref={isHighlighted ? highlightRef : null}
              style={{ ...CARD, marginBottom: 10, transition: 'box-shadow 0.3s', boxShadow: isHighlighted ? `0 0 0 3px ${C.blue}` : CARD.boxShadow }}>
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

// ── Contrats (admin) ────────────────────────────────────────────────────────
function AdminContracts({ contracts, token, onRefresh }) {
  const [modal, setModal]     = useState(null);
  const [target, setTarget]   = useState(null);
  const empty = { name:'', nature:'CDI', hoursPerWeek:35, rttPerMonth:'0' };
  const [form, setForm]       = useState(empty);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving]   = useState(false);

  const openCreate = () => { setForm(empty); setTarget(null); setFormErr(''); setModal('form'); };
  const openEdit = (c) => {
    setForm({
      name:         c.name,
      nature:       c.nature || 'CDI',
      hoursPerWeek: c.hours_per_week,
      rttPerMonth:  c.rtt_per_month,
    });
    setTarget(c); setFormErr(''); setModal('form');
  };

  const save = async () => {
    if (!form.name) return setFormErr('Le nom est obligatoire');
    setSaving(true); setFormErr('');
    const payload = {
      name:         form.name,
      nature:       form.nature,
      hoursPerWeek: parseFloat(form.hoursPerWeek),
      rttPerMonth:  parseFloat(form.rttPerMonth),
    };
    try {
      if (target) await api('PUT', `/contracts/${target.id}`, payload, token);
      else        await api('POST', '/contracts', payload, token);
      setModal(null); onRefresh();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const del = async (c) => {
    if (!confirm(`Supprimer le contrat "${c.name}" ?`)) return;
    try { await api('DELETE', `/contracts/${c.id}`, null, token); onRefresh(); }
    catch (e) { alert(e.message); }
  };

  return (
    <>
      {modal === 'form' && (
        <Modal title={target ? `Modifier — ${target.name}` : 'Nouveau contrat'} onClose={() => setModal(null)}>
          <Field label="Nature du contrat">
            <div style={{ display:'flex', gap: 12 }}>
              {['CDI', 'CDD'].map(n => (
                <label key={n} style={{ display:'flex', alignItems:'center', gap: 6, fontSize: 13, cursor:'pointer', fontWeight: form.nature === n ? 600 : 400 }}>
                  <input type="radio" name="nature" value={n} checked={form.nature === n}
                    onChange={() => setForm(f=>({...f, nature: n}))} />
                  {n}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Nom du contrat *">
            <input value={form.name}
              onChange={e => setForm(f=>({...f, name: e.target.value}))}
              placeholder="35h, Temps partiel 80%…" style={{ width:'100%' }} />
          </Field>
          <Field label="Heures par semaine">
            <input type="number" step="0.5" min={1} max={60} value={form.hoursPerWeek}
              onChange={e => setForm(f=>({...f, hoursPerWeek: e.target.value}))}
              style={{ width: 90 }} />
          </Field>
          <div style={{
            background: C.blueLight, borderRadius: 8, padding: '8px 12px',
            fontSize: 12, color: C.blueDark, marginBottom: 14,
          }}>
            📋 CP : <strong>2,5 j ouvrables / mois</strong> (30 j/an) — règle légale fixe, identique CDI/CDD/temps partiel.
          </div>
          <Field label="Jours RTT acquis par mois">
            <input type="number" step="0.01" min={0} max={10} value={form.rttPerMonth}
              onChange={e => setForm(f=>({...f, rttPerMonth: e.target.value}))}
              style={{ width: 90 }} />
            <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8 }}>
              = {(parseFloat(form.rttPerMonth || 0) * 12).toFixed(1)}j/an
            </span>
          </Field>
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving} full>{target ? 'Enregistrer' : 'Ajouter'}</Btn>
            <Btn variant="ghost" onClick={() => setModal(null)} full>Annuler</Btn>
          </div>
        </Modal>
      )}

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom: 12 }}>
        <Btn onClick={openCreate}>+ Nouveau contrat</Btn>
      </div>

      {!contracts.length && (
        <div style={{ ...CARD, textAlign:'center', color: C.textHint, fontSize: 13, padding: '2rem' }}>
          Aucun contrat défini. Créez d'abord vos types de contrat.
        </div>
      )}

      {contracts.map(c => (
        <div key={c.id} style={{ ...CARD, marginBottom: 10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, display:'flex', alignItems:'center', gap: 8 }}>
                {c.name}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                  background: c.nature === 'CDI' ? C.blueLight : C.amberLight,
                  color: c.nature === 'CDI' ? C.blue : C.amber,
                }}>{c.nature}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, display:'flex', gap: 16 }}>
                <span>⏱ {c.hours_per_week}h/semaine</span>
                <span style={{ color: C.green }}>CP : 2,5j/mois (30j/an)</span>
                {parseFloat(c.rtt_per_month) > 0 && (
                  <span style={{ color: C.blue }}>RTT : {parseFloat(c.rtt_per_month).toFixed(2)}j/mois ({(parseFloat(c.rtt_per_month)*12).toFixed(1)}j/an)</span>
                )}
              </div>
            </div>
            <div style={{ display:'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
              <Btn small variant="ghost" onClick={() => openEdit(c)}>Modifier</Btn>
              <Btn small variant="danger" onClick={() => del(c)}>×</Btn>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ── Planning mensuel (admin) ────────────────────────────────────────────────
const MONTHS_FR = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
];
const DAYS_FR = ['D','L','M','M','J','V','S'];

function AdminPlanning({ users, leaves, onPendingClick }) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // pad YYYY-MM-DD
  const pad = (n) => String(n).padStart(2, '0');
  const monthStr = `${year}-${pad(month + 1)}`;

  // Normalise une date en YYYY-MM-DD (gère Date objects et ISO timestamps)
  const d10 = (d) => d ? String(d).slice(0, 10) : '';

  // leaves visibles ce mois (approved + pending)
  const visible = leaves.filter(l =>
    (l.status === 'approved' || l.status === 'pending') &&
    d10(l.start_date) <= `${monthStr}-${pad(daysInMonth)}` &&
    d10(l.end_date)   >= `${monthStr}-01`
  );

  function leaveForDay(userId, day) {
    const dayStr = `${monthStr}-${pad(day)}`;
    for (const l of visible) {
      if (l.user_id === userId && dayStr >= d10(l.start_date) && dayStr <= d10(l.end_date)) {
        return { id: l.id, status: l.status, type: l.leave_type || 'paid', period: l.period || 'full' };
      }
    }
    return null;
  }

  const isWeekend = (day) => {
    const d = new Date(year, month, day).getDay();
    return d === 0 || d === 6;
  };

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const COL_NAME = 130;
  const COL_DAY  = 26;

  // Couleur de base par type, atténuée si pending
  const typeColor = {
    paid:   C.green,
    rtt:    C.blue,
    unpaid: '#a855f7',
  };
  const cellColor = (type, status) => {
    const base = typeColor[type] || C.green;
    return status === 'pending' ? base + 'bb' : base;
  };

  if (!users.length) return (
    <div style={{ ...CARD, textAlign: 'center', color: C.textHint, fontSize: 13, padding: '2rem' }}>
      Aucun salarié dans cette organisation.
    </div>
  );

  return (
    <div style={{ ...CARD, padding: '1rem', overflowX: 'auto' }}>
      {/* Navigation */}
      <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 16 }}>
        <button onClick={prevMonth} style={{
          background: C.bgSecond, border: `1px solid ${C.border}`,
          borderRadius: 6, padding: '5px 10px', cursor:'pointer', fontSize: 14,
        }}>‹</button>
        <span style={{ fontWeight: 600, fontSize: 15, minWidth: 150, textAlign:'center' }}>
          {MONTHS_FR[month]} {year}
        </span>
        <button onClick={nextMonth} style={{
          background: C.bgSecond, border: `1px solid ${C.border}`,
          borderRadius: 6, padding: '5px 10px', cursor:'pointer', fontSize: 14,
        }}>›</button>
        <div style={{ marginLeft: 'auto', display:'flex', gap: 10, fontSize: 11, color: C.textMuted, flexWrap:'wrap' }}>
          {[
            { color: C.green,    label: 'CP' },
            { color: C.blue,     label: 'RTT' },
            { color: '#a855f7',  label: 'Sans solde' },
          ].map(({ color, label }) => (
            <span key={label} style={{ display:'flex', alignItems:'center', gap: 4 }}>
              <span style={{ width:12, height:12, background: color, borderRadius:2, display:'inline-block' }} />
              {label}
            </span>
          ))}
          <span style={{ display:'flex', alignItems:'center', gap: 4, marginLeft: 4, paddingLeft: 8, borderLeft: `1px solid ${C.border}` }}>
            <span style={{ width:12, height:12, borderRadius:2, display:'inline-block', background:'repeating-linear-gradient(45deg,#ef9f27 0px,#ef9f27 3px,#fde9c0 3px,#fde9c0 7px)' }} />
            En attente
          </span>
        </div>
      </div>

      {/* Grille */}
      <div style={{ minWidth: COL_NAME + daysInMonth * COL_DAY }}>
        {/* En-tête jours */}
        <div style={{ display:'flex' }}>
          <div style={{ width: COL_NAME, flexShrink: 0 }} />
          {days.map(d => (
            <div key={d} style={{
              width: COL_DAY, flexShrink: 0, textAlign:'center',
              fontSize: 10, fontWeight: 600,
              color: isWeekend(d) ? C.textHint : C.textMuted,
              paddingBottom: 2,
            }}>
              <div>{DAYS_FR[new Date(year, month, d).getDay()]}</div>
              <div style={{ fontSize: 11, color: isWeekend(d) ? C.textHint : C.text }}>{d}</div>
            </div>
          ))}
        </div>

        {/* Lignes employés */}
        {users.map((u, ui) => (
          <div key={u.id} style={{
            display:'flex', alignItems:'center',
            borderTop: `1px solid ${C.border}`,
            background: ui % 2 === 0 ? 'white' : C.bg,
            minHeight: 34,
          }}>
            {/* Nom */}
            <div style={{
              width: COL_NAME, flexShrink: 0, paddingRight: 8,
              fontSize: 12, fontWeight: 500, color: C.text,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            }} title={u.name}>
              {u.name}
            </div>

            {/* Cellules jours */}
            {days.map(d => {
              const leave = leaveForDay(u.id, d);
              const weekend = isWeekend(d);
              return (
                <div key={d} style={{
                  width: COL_DAY, flexShrink: 0, height: 30,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background: weekend ? C.bgSecond : 'transparent',
                }}>
                  {leave && (
                    <div
                      onClick={leave.status === 'pending' ? () => onPendingClick(leave.id) : undefined}
                      title={leave.status === 'pending' ? 'Cliquer pour valider' : undefined}
                      style={{
                        width:  leave.period === 'full' ? COL_DAY - 2 : Math.floor((COL_DAY - 2) / 2),
                        height: 18, borderRadius: 3,
                        background: leave.status === 'pending'
                          ? `repeating-linear-gradient(45deg, #ef9f27 0px, #ef9f27 3px, #fde9c0 3px, #fde9c0 7px)`
                          : cellColor(leave.type, leave.status),
                        marginLeft: leave.period === 'pm' ? 'auto' : undefined,
                        marginRight: leave.period === 'am' ? 'auto' : undefined,
                        cursor: leave.status === 'pending' ? 'pointer' : 'default',
                      }} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminSettings({ settings, token, org, onSaved, onLogoChange }) {
  const [threshold,            setThreshold]            = useState(settings.alertThreshold);
  const [allowUnpaid,          setAllowUnpaid]          = useState(!!settings.allowUnpaidLeave);
  const [allowWhenExhausted,   setAllowWhenExhausted]   = useState(!!settings.allowUnpaidWhenExhausted);
  const [notifyOnSubmit,       setNotifyOnSubmit]       = useState(settings.notifyOnSubmit  ?? true);
  const [notifyOnApprove,      setNotifyOnApprove]      = useState(settings.notifyOnApprove ?? true);
  const [notifyOnReject,       setNotifyOnReject]       = useState(settings.notifyOnReject  ?? true);
  const [notifyAdminNew,       setNotifyAdminNew]       = useState(settings.notifyAdminNew  ?? true);
  const [saved, setSaved]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoSize, setLogoSize] = useState(org?.logoSize || 'M');

  const handleLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setLogoSaving(true);
      try {
        const res = await api('PUT', '/settings/logo', { logoData: ev.target.result, logoSize }, token);
        onLogoChange(res.logoData, res.logoSize);
      } catch (err) { alert(err.message); }
      setLogoSaving(false);
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = async () => {
    setLogoSaving(true);
    try {
      await api('PUT', '/settings/logo', { logoData: null }, token);
      onLogoChange(null, logoSize);
    } catch (err) { alert(err.message); }
    setLogoSaving(false);
  };

  const handleLogoSize = async (size) => {
    setLogoSize(size);
    setLogoSaving(true);
    try {
      await api('PUT', '/settings/logo', { logoSize: size }, token);
      onLogoChange(org?.logoData, size);
    } catch (err) { alert(err.message); }
    setLogoSaving(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await api('PUT', '/settings', {
        alertThreshold:           parseInt(threshold),
        allowUnpaidLeave:         allowUnpaid,
        allowUnpaidWhenExhausted: allowWhenExhausted,
        notifyOnSubmit,
        notifyOnApprove,
        notifyOnReject,
        notifyAdminNew,
      }, token);
      onSaved(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const settingBlock = (title, desc, checked, onChange) => (
    <div style={{
      background: C.bgSecond, borderRadius: 10, padding: '14px', marginBottom: 12,
    }}>
      <label style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: 12, cursor:'pointer' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>{desc}</div>
        </div>
        <input type="checkbox" checked={checked}
          onChange={e => { onChange(e.target.checked); setSaved(false); }}
          style={{ marginTop: 2, flexShrink: 0, width: 16, height: 16, cursor:'pointer' }} />
      </label>
    </div>
  );

  return (
    <div style={CARD}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Paramètres de l'organisation</h2>

      {/* Logo */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform:'uppercase', letterSpacing:'.05em' }}>
        Logo
      </div>
      <div style={{ background: C.bgSecond, borderRadius: 10, padding: '14px', marginBottom: 16, display:'flex', alignItems:'center', gap: 16 }}>
        {org?.logoData ? (
          <img src={org.logoData} alt="logo" style={{ width: 56, height: 56, objectFit:'contain', borderRadius: 8, background:'white', padding: 4, border: `1px solid ${C.border}` }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 8, background: C.border, display:'flex', alignItems:'center', justifyContent:'center', fontSize: 22 }}>🏢</div>
        )}
        <div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Btn disabled={logoSaving}>
              {logoSaving ? 'Envoi…' : 'Changer le logo'}
            </Btn>
            <input type="file" accept="image/*" onChange={handleLogo} disabled={logoSaving}
              style={{
                position: 'absolute', inset: 0, opacity: 0,
                width: '100%', height: '100%', cursor: 'pointer',
              }} />
          </div>
          {org?.logoData && (
            <button onClick={removeLogo} disabled={logoSaving} style={{
              display: 'block', marginTop: 6, background: 'none', border: 'none',
              color: C.red, fontSize: 12, cursor: 'pointer', fontWeight: 500, padding: 0,
            }}>Supprimer le logo</button>
          )}
          <div style={{ fontSize: 11, color: C.textHint, marginTop: 4 }}>PNG, JPG — affiché dans le header</div>
          <div style={{ display:'flex', alignItems:'center', gap: 6, marginTop: 10 }}>
            <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Taille :</span>
            {['S','M','L'].map(s => (
              <button key={s} onClick={() => handleLogoSize(s)} disabled={logoSaving} style={{
                width: 32, height: 28, border: `1.5px solid ${logoSize === s ? C.blue : C.border}`,
                borderRadius: 7, background: logoSize === s ? C.blueLight : C.bgCard,
                color: logoSize === s ? C.blueDark : C.textMuted,
                fontWeight: 700, fontSize: 12, cursor: logoSaving ? 'default' : 'pointer',
              }}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Seuil alerte */}
      <div style={{ background: C.bgSecond, borderRadius: 10, padding: '14px', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Seuil d'alerte de chevauchement</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
          Alerte lorsque ce nombre de salariés sont en congé simultanément au moment de la validation.
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

      {/* Notifications email */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, margin: '16px 0 8px', textTransform:'uppercase', letterSpacing:'.05em' }}>
        Notifications email
      </div>
      {settingBlock(
        'Notifier le salarié à la soumission',
        "Le salarié reçoit un email de confirmation quand sa demande est enregistrée.",
        notifyOnSubmit,
        setNotifyOnSubmit
      )}
      {settingBlock(
        'Notifier le salarié à la validation',
        "Le salarié reçoit un email quand sa demande est approuvée.",
        notifyOnApprove,
        setNotifyOnApprove
      )}
      {settingBlock(
        'Notifier le salarié au refus',
        "Le salarié reçoit un email quand sa demande est refusée.",
        notifyOnReject,
        setNotifyOnReject
      )}
      {settingBlock(
        "Notifier l'admin lors d'une nouvelle demande",
        "L'administrateur reçoit un email dès qu'un salarié soumet une demande d'absence.",
        notifyAdminNew,
        setNotifyAdminNew
      )}

      {/* Congés sans solde */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, margin: '16px 0 8px', textTransform:'uppercase', letterSpacing:'.05em' }}>
        Congés sans solde
      </div>
      {settingBlock(
        'Autoriser les congés sans solde',
        'Les salariés peuvent poser des congés sans solde (non décomptés du solde CP).',
        allowUnpaid,
        (v) => { setAllowUnpaid(v); if (!v) setAllowWhenExhausted(false); }
      )}
      {allowUnpaid && settingBlock(
        'Uniquement si le solde CP est épuisé',
        'Le salarié ne peut poser un sans-solde que s\'il n\'a plus aucun jour de congé payé disponible.',
        allowWhenExhausted,
        setAllowWhenExhausted
      )}

      <div style={{ display:'flex', alignItems:'center', gap: 12, marginTop: 4 }}>
        <Btn onClick={save} disabled={saving}>Enregistrer</Btn>
        {saved && <span style={{ fontSize: 13, color: C.green, fontWeight: 500 }}>✓ Enregistré</span>}
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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [myData, lvs] = await Promise.all([
        api('GET', '/me',     null, token),
        api('GET', '/leaves', null, token),
      ]);
      setMe(myData); setLeaves(lvs);
    } catch (e) { console.error(e); }
    if (!silent) setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const TABS = ["Mon espace", "Nouvelle demande d'absence", 'Historique'];

  return (
    <Layout user={user} org={org} onLogout={onLogout}
      tabs={TABS} activeTab={tab} onTab={setTab} pendingCount={0}>
      {loading ? <Spinner /> : (
        <>
          {tab === 0 && <EmpHome me={me} leaves={leaves} />}
          {tab === 1 && <EmpRequest me={me} org={org} token={token} onDone={load} />}
          {tab === 2 && <EmpHistory leaves={leaves} />}
        </>
      )}
    </Layout>
  );
}

function EmpHome({ me, leaves }) {
  if (!me) return null;
  const todayStr = today();
  const accrued  = parseFloat(me.accrued_cp ?? 0) + parseFloat(me.cp_balance || 0);
  const rem      = accrued - me.taken_days;
  const remRTT   = parseFloat(me.rtt_balance || 0) - (me.taken_rtt_days || 0);
  const hasRTT   = parseFloat(me.rtt_balance || 0) > 0 || remRTT > 0;
  const d10 = (d) => d ? String(d).slice(0, 10) : '';
  const upcoming = leaves.filter(l =>
    l.status === 'approved' && d10(l.end_date) >= todayStr
  ).sort((a, b) => d10(a.start_date).localeCompare(d10(b.start_date)));
  const pending = leaves.filter(l => l.status === 'pending');

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>Congés payés</div>
      <div style={{ display:'flex', gap: 10, marginBottom: hasRTT ? 12 : '1.25rem' }}>
        <MetricCard label="Acquis"    value={accrued.toFixed(1)} />
        <MetricCard label="Pris"      value={me.taken_days} color={me.taken_days > 0 ? C.amber : C.text} />
        <MetricCard label="Restants"  value={rem.toFixed(1)} color={rem <= 5 ? C.red : C.green} />
      </div>
      {hasRTT && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>RTT</div>
          <div style={{ display:'flex', gap: 10, marginBottom: '1.25rem' }}>
            <MetricCard label="Attribués"  value={parseFloat(me.rtt_balance || 0).toFixed(1)} />
            <MetricCard label="Pris"       value={(me.taken_rtt_days || 0)} color={(me.taken_rtt_days || 0) > 0 ? C.amber : C.text} />
            <MetricCard label="Restants"   value={remRTT.toFixed(1)} color={remRTT <= 1 ? C.red : C.green} />
          </div>
        </>
      )}

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

function EmpRequest({ me, org, token, onDone }) {
  const [start, setStart]         = useState('');
  const [end, setEnd]             = useState('');
  const [period, setPeriod]       = useState('full'); // 'full' | 'am' | 'pm'
  const [comment, setComment]     = useState('');
  const [leaveType, setLeaveType] = useState('paid');
  const [err, setErr]             = useState('');
  const [done, setDone]           = useState(false);
  const [saving, setSaving]       = useState(false);

  if (!me) return null;
  const accrued     = parseFloat(me.accrued_cp ?? 0) + parseFloat(me.cp_balance || 0);
  const remCP       = accrued - (me.taken_days || 0);
  const remRTT      = parseFloat(me.rtt_balance || 0) - (me.taken_rtt_days || 0);
  const isSingleDay = start && end && start === end;
  const fullDays    = start && end && end >= start ? workDays(start, end) : 0;
  const days        = isSingleDay && period !== 'full' ? 0.5 : fullDays;
  const canUnpaid   = org?.allowUnpaidLeave;
  const canRTT      = remRTT > 0;

  // Types disponibles
  const leaveTypes = [
    { id: 'paid',   label: '💰 Congé payé',  balance: remCP,  show: true },
    { id: 'rtt',    label: '⏱ RTT',          balance: remRTT, show: canRTT },
    { id: 'unpaid', label: '📋 Sans solde',   balance: null,   show: canUnpaid },
  ].filter(t => t.show);

  const currentType = leaveTypes.find(t => t.id === leaveType) || leaveTypes[0];

  const submit = async () => {
    if (!start || !end) return setErr('Sélectionnez les deux dates.');
    if (end < start) return setErr('La date de fin doit être après le début.');
    if (days === 0) return setErr('Aucun jour ouvré sur cette période.');
    if (leaveType === 'paid' && days > remCP)
      return setErr(`Solde CP insuffisant (${remCP.toFixed(1)}j restants).`);
    if (leaveType === 'rtt' && days > remRTT)
      return setErr(`Solde RTT insuffisant (${remRTT.toFixed(1)}j restants).`);
    setSaving(true); setErr('');
    try {
      await api('POST', '/leaves', { startDate: start, endDate: end, days, comment, leaveType, period }, token);
      setDone(true); setStart(''); setEnd(''); setComment(''); setLeaveType('paid'); setPeriod('full');
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
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Nouvelle demande d'absence</h2>

      {leaveTypes.length > 1 && (
        <div style={{ display:'flex', gap: 8, marginBottom: 14 }}>
          {leaveTypes.map(t => (
            <button key={t.id} type="button"
              onClick={() => { setLeaveType(t.id); setErr(''); }}
              style={{
                flex: 1, padding: '8px', borderRadius: 8, cursor:'pointer', fontSize: 13, fontWeight: 500,
                border: `2px solid ${leaveType === t.id ? C.blue : C.border}`,
                background: leaveType === t.id ? C.blueLight : C.bgSecond,
                color: leaveType === t.id ? C.blueDark : C.textMuted,
              }}>
              {t.label}
              {t.balance !== null && (
                <span style={{ display:'block', fontSize: 11, opacity: 0.8, marginTop: 2 }}>
                  {t.balance.toFixed(1)}j dispo
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div style={{
        background: C.bgSecond, borderRadius: 8, padding: '9px 12px',
        marginBottom: 14, fontSize: 13, color: C.textMuted,
      }}>
        {leaveType === 'unpaid' ? (
          <span style={{ color: C.amber }}>Sans solde — non décompté de votre solde CP</span>
        ) : (
          <>Solde {leaveType === 'rtt' ? 'RTT' : 'CP'} disponible :
            <strong style={{ color: currentType.balance <= 3 ? C.red : C.text, marginLeft: 4 }}>
              {currentType.balance.toFixed(1)}j
            </strong>
          </>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="Date de début">
          <input type="date" value={start} min={today()}
            onChange={e => { setStart(e.target.value); setErr(''); if (e.target.value !== end) setPeriod('full'); }}
            style={{ width:'100%' }} />
        </Field>
        <Field label="Date de fin">
          <input type="date" value={end} min={start || today()}
            onChange={e => { setEnd(e.target.value); setErr(''); if (start !== e.target.value) setPeriod('full'); }}
            style={{ width:'100%' }} />
        </Field>
      </div>

      {isSingleDay && (
        <div style={{ display:'flex', gap: 6, marginBottom: 12 }}>
          {[
            { id: 'full', label: 'Journée entière' },
            { id: 'am',   label: 'Matin' },
            { id: 'pm',   label: 'Après-midi' },
          ].map(p => (
            <button key={p.id} type="button"
              onClick={() => { setPeriod(p.id); setErr(''); }}
              style={{
                flex: 1, padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                border: `2px solid ${period === p.id ? C.blue : C.border}`,
                background: period === p.id ? C.blueLight : C.bgSecond,
                color: period === p.id ? C.blueDark : C.textMuted,
              }}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {days > 0 && (
        <div style={{
          marginBottom: 12, padding: '8px 12px',
          background: C.blueLight, borderRadius: 8,
          fontSize: 13, color: C.blueDark, fontWeight: 500,
        }}>
          {days === 0.5 ? '½ journée' : `${days} jour${days > 1 ? 's' : ''} ouvré${days > 1 ? 's' : ''}`}
          {period === 'am' ? ' — matin' : period === 'pm' ? ' — après-midi' : ''}
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

// ── Idle timer ─────────────────────────────────────────────────────────────
const IDLE_TIMEOUT  = 10 * 60 * 1000; // 10 min
const WARN_BEFORE   =  1 * 60 * 1000; // avertissement 1 min avant

function useIdleTimer(onLogout, active) {
  const [warning, setWarning] = useState(false);
  const timerRef = useRef(null);
  const warnRef  = useRef(null);

  const reset = useCallback(() => {
    setWarning(false);
    clearTimeout(timerRef.current);
    clearTimeout(warnRef.current);
    warnRef.current  = setTimeout(() => setWarning(true),           IDLE_TIMEOUT - WARN_BEFORE);
    timerRef.current = setTimeout(() => { clearSession(); onLogout(); }, IDLE_TIMEOUT);
  }, [onLogout]);

  useEffect(() => {
    if (!active) return;
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      clearTimeout(timerRef.current);
      clearTimeout(warnRef.current);
    };
  }, [active, reset]);

  return warning;
}

// ── App root ───────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(() => loadSession());
  const resetToken = new URLSearchParams(window.location.search).get('token');

  const handleLogin = (data) => {
    const s = { token: data.token, user: data.user, org: data.org || null };
    saveSession(s);
    setSession(s);
  };

  const handleLogout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const idleWarning = useIdleTimer(handleLogout, !!session);

  // Lien d'activation reçu par email — prioritaire sur tout
  if (resetToken) return <ResetPasswordScreen token={resetToken} onDone={() => {
    window.history.replaceState({}, '', window.location.pathname);
    setSession(null);
  }} />;

  if (!session) return <LoginScreen onLogin={handleLogin} />;

  const role = session.user.role;
  const handleLogoChange = (logoData, logoSize) => {
    const updated = { ...session, org: { ...session.org, logoData, ...(logoSize !== undefined ? { logoSize } : {}) } };
    saveSession(updated);
    setSession(updated);
  };

  return (
    <>
      {idleWarning && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#d97706', color: 'white', textAlign: 'center',
          padding: '10px 16px', fontSize: 13, fontWeight: 600,
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16,
        }}>
          Déconnexion automatique dans 1 minute pour inactivité.
          <button onClick={handleLogout} style={{
            background: 'rgba(0,0,0,0.2)', border: 'none', color: 'white',
            borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12,
          }}>Se déconnecter maintenant</button>
        </div>
      )}
      {role === 'superadmin' && <SuperAdminView session={session} onLogout={handleLogout} />}
      {role === 'admin'      && <AdminView      session={session} onLogout={handleLogout} onLogoChange={handleLogoChange} />}
      {role === 'employee'   && <EmployeeView   session={session} onLogout={handleLogout} />}
    </>
  );
}
