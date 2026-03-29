import { useState, useEffect, useCallback, useRef } from 'react';

// ── API helper ─────────────────────────────────────────────────────────────
const BASE = '/api';

async function api(method, path, body, _token) {
  // _token ignoré — authentification via cookie HttpOnly (Set-Cookie par le backend)
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
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

// ── Auth context (métadonnées en sessionStorage — token uniquement en cookie HttpOnly) ──
function loadSession() {
  try {
    const raw = sessionStorage.getItem('leavup_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSession(s) { sessionStorage.setItem('leavup_session', JSON.stringify(s)); }
function clearSession() { sessionStorage.removeItem('leavup_session'); }

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
  borderRadius: 16,
  padding: '1.25rem 1.5rem',
  boxShadow: '0 2px 8px rgba(15,23,42,0.07)',
};

// ── Styles globaux — injectés une seule fois ────────────────────────────────
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }

  /* ── Champs de formulaire ─────────────────────────────────────────────── */
  input:not([type=checkbox]):not([type=radio]):not([type=file]),
  select,
  textarea {
    font-family: inherit;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 14px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    line-height: 1.5;
  }
  input:not([type=checkbox]):not([type=radio]):not([type=file]):hover,
  select:hover,
  textarea:hover { border-color: #cbd5e1; background: #fafcff; }

  input:not([type=checkbox]):not([type=radio]):not([type=file]):focus,
  select:focus,
  textarea:focus {
    border-color: #0ea5e9;
    box-shadow: 0 0 0 3px rgba(14,165,233,0.14);
    background: #ffffff;
  }
  input:not([type=checkbox]):not([type=radio]):not([type=file])::placeholder,
  textarea::placeholder { color: #94a3b8; }

  input[disabled]:not([type=checkbox]):not([type=radio]),
  select[disabled],
  textarea[disabled] { opacity: 0.55; cursor: not-allowed; background: #f1f5f9; }

  select {
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='7' fill='none' viewBox='0 0 12 7'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }
  textarea { resize: vertical; min-height: 76px; }

  /* ── Animations ──────────────────────────────────────────────────────── */
  @keyframes spin     { to { transform: rotate(360deg); } }
  @keyframes modal-in { from { opacity:0; transform:translateY(-10px) scale(0.97); } to { opacity:1; transform:none; } }
  @keyframes fade-in  { from { opacity:0; } to { opacity:1; } }
`;

function GlobalStyle() {
  return <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />;
}

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

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 600,
        color: C.textMuted, marginBottom: 6, letterSpacing: '0.02em',
      }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textHint, marginTop: 5 }}>{hint}</div>}
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
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(15,23,42,0.45)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem', zIndex: 200,
    }}>
      <div style={{
        ...CARD, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(15,23,42,0.22)',
        animation: 'modal-in 0.18s ease-out',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>{title}</h3>
          <button onClick={onClose} style={{
            background: C.bgSecond, border: `1px solid ${C.border}`,
            borderRadius: 8, cursor: 'pointer',
            width: 30, height: 30, fontSize: 17, color: C.textMuted,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const CONTACT_EMAIL = 'contact@leavup.com';

function ContactModal({ subject, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(CONTACT_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Modal title="Nous contacter" onClose={onClose}>
      <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
        Pour en savoir plus sur ce plan, écrivez-nous à :
      </p>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: C.bgSecond, borderRadius: 10, padding: '10px 14px',
        border: `1px solid ${C.border}`, marginBottom: 20,
      }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.text }}>
          {CONTACT_EMAIL}
        </span>
        <button onClick={copy} style={{
          border: 'none', borderRadius: 7, cursor: 'pointer',
          background: copied ? '#dcfce7' : C.blueLight,
          color: copied ? '#16a34a' : C.blue,
          fontWeight: 600, fontSize: 12, padding: '5px 12px',
          transition: 'background 0.2s, color 0.2s',
        }}>
          {copied ? '✓ Copié' : 'Copier'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: C.textHint }}>
        Objet suggéré : <em>{subject}</em>
      </p>
    </Modal>
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
// ── Landing page marketing ──────────────────────────────────────────────────
function PricingSection({ onRegister }) {
  const [annual, setAnnual] = useState(false);
  const [contactSubject, setContactSubject] = useState(null);

  const plans = [
    {
      name: 'Starter', color: null, price: 0, priceAnnual: 0, period: 'gratuit pour toujours',
      users: "jusqu'à 10 utilisateurs",
      features: ['Demandes & validation', 'Planning visuel', 'Notifications email'],
      cta: 'Démarrer gratuitement', onCta: onRegister, ctaBg: '#0f172a',
    },
    {
      name: 'Teams', color: 'gradient', price: 39, priceAnnual: 31, period: '/mois',
      users: "jusqu'à 30 utilisateurs",
      features: ['Tout Starter', 'Équipes & délégation', 'Historique illimité', 'Export CSV', 'Support email'],
      badge: 'Populaire', cta: 'Contactez-nous',
      onCta: () => setContactSubject('Leavup Teams'),
      ctaBg: '#0ea5e9',
    },
    {
      name: 'Enterprise', color: 'dark', price: null, priceAnnual: null, period: null,
      users: '30+ utilisateurs',
      features: ['Tout Teams', 'Intégration SIRH', 'SSO / SAML', 'Hébergement dédié', 'Contrat sur-mesure'],
      cta: 'Contactez-nous',
      onCta: () => setContactSubject('Leavup Enterprise'),
      ctaBg: '#0ea5e9',
    },
  ];

  const priceLabel = (p) => {
    if (p.price === null) return null;
    if (p.price === 0) return '0 €';
    return `${annual ? p.priceAnnual : p.price} €`;
  };

  return (
    <>
      {/* Toggle mensuel / annuel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 40 }}>
        <span style={{ fontSize: 13, color: annual ? '#94a3b8' : '#0f172a', fontWeight: annual ? 400 : 600 }}>Mensuel</span>
        <div onClick={() => setAnnual(a => !a)} style={{
          width: 44, height: 24, borderRadius: 12, background: annual ? '#0ea5e9' : '#cbd5e1',
          cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0,
        }}>
          <div style={{
            position: 'absolute', top: 3, left: annual ? 23 : 3,
            width: 18, height: 18, borderRadius: '50%', background: 'white',
            transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
        <span style={{ fontSize: 13, color: annual ? '#0f172a' : '#94a3b8', fontWeight: annual ? 600 : 400 }}>
          Annuel{' '}
          <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>-20%</span>
        </span>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 1100, margin: '0 auto' }}>
        {plans.map(p => {
          const isDark = p.color === 'gradient' || p.color === 'dark';
          const bg = p.color === 'gradient' ? 'linear-gradient(135deg,#0f172a,#1d4ed8)'
                   : p.color === 'dark'     ? '#0f172a'
                   : 'white';
          const pl = priceLabel(p);
          return (
            <div key={p.name} style={{
              background: bg, borderRadius: 20, padding: '28px 24px',
              border: p.color ? 'none' : '2px solid #e2e8f0',
              flex: '1 1 180px', maxWidth: 210,
              position: 'relative', display: 'flex', flexDirection: 'column',
            }}>
              {p.badge && (
                <div style={{ position: 'absolute', top: 14, right: 14, background: '#0ea5e9', borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700, color: 'white' }}>
                  {p.badge}
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: isDark ? 'rgba(255,255,255,0.5)' : '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {p.name}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#7dd3fc' : '#0ea5e9', marginBottom: 10 }}>
                {p.users}
              </div>
              {pl !== null ? (
                <>
                  <div style={{ fontSize: 34, fontWeight: 800, color: isDark ? 'white' : '#0f172a', lineHeight: 1 }}>{pl}</div>
                  <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.4)' : '#94a3b8', marginBottom: 18, marginTop: 3 }}>
                    {p.price === 0 ? p.period : `${p.period}${annual ? ' · facturé annuellement' : ''}`}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'white', lineHeight: 1 }}>Sur devis</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 18, marginTop: 3 }}>contactez-nous</div>
                </>
              )}
              <div style={{ flex: 1 }}>
                {p.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: isDark ? 'rgba(255,255,255,0.8)' : '#334155', marginBottom: 8 }}>
                    <span style={{ color: isDark ? '#38bdf8' : '#22c55e', fontWeight: 700, flexShrink: 0 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button onClick={p.onCta} style={{
                width: '100%', marginTop: 20, border: 'none', color: 'white',
                borderRadius: 10, padding: '11px', fontSize: 13, cursor: 'pointer',
                fontWeight: 700, background: p.ctaBg,
              }}>{p.cta}</button>
            </div>
          );
        })}
      </div>
      {contactSubject && <ContactModal subject={contactSubject} onClose={() => setContactSubject(null)} />}
    </>
  );
}

function LandingPage({ onLogin, onRegister, onPrivacy }) {
  const GRAD = 'linear-gradient(160deg, #0f172a 0%, #1e3a8a 60%, #0ea5e9 100%)';
  const features = [
    { icon: '📅', title: 'Demandes en ligne', desc: 'Vos salariés posent leurs absences depuis n\'importe où, en quelques clics.' },
    { icon: '✅', title: 'Validation rapide', desc: 'Approuvez ou refusez en un clic. Notifications email automatiques.' },
    { icon: '📊', title: 'Planning visuel', desc: 'Visualisez toutes les absences de votre équipe sur un calendrier partagé.' },
    { icon: '👥', title: 'Gestion d\'équipes', desc: 'Déléguez la validation des congés à des chefs d\'équipe.' },
  ];
  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#fff', minHeight: '100vh' }}>
      {/* Navbar */}
      <nav style={{
        background: GRAD, padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: 'white', letterSpacing: '-0.04em' }}>
          Leav<span style={{ color: '#38bdf8' }}>up</span>
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onLogin} style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
            color: 'white', borderRadius: 8, padding: '8px 18px', fontSize: 13,
            cursor: 'pointer', fontWeight: 600, backdropFilter: 'blur(4px)',
          }}>Connexion</button>
          <button onClick={onRegister} style={{
            background: '#0ea5e9', border: 'none', color: 'white',
            borderRadius: 8, padding: '8px 18px', fontSize: 13,
            cursor: 'pointer', fontWeight: 700,
          }}>Essai gratuit</button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ background: GRAD, padding: '72px 24px 80px', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', background: 'rgba(14,165,233,0.18)',
          border: '1px solid rgba(56,189,248,0.35)', borderRadius: 20,
          color: '#7dd3fc', fontSize: 12, fontWeight: 700, padding: '5px 14px', marginBottom: 24,
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>Gratuit jusqu'à 10 utilisateurs</div>
        <h1 style={{
          fontSize: 42, fontWeight: 800, color: 'white', letterSpacing: '-0.04em',
          maxWidth: 620, margin: '0 auto 18px', lineHeight: 1.15,
        }}>La gestion des absences simplifiée pour votre équipe</h1>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.72)', maxWidth: 480, margin: '0 auto 36px', lineHeight: 1.6 }}>
          Planifiez, validez et suivez les congés de vos employés — sans paperasse, sans tableur Excel.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onRegister} style={{
            background: '#0ea5e9', border: 'none', color: 'white',
            borderRadius: 10, padding: '14px 28px', fontSize: 15,
            cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 16px rgba(14,165,233,0.4)',
          }}>Commencer gratuitement →</button>
          <button onClick={onLogin} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
            color: 'white', borderRadius: 10, padding: '14px 28px', fontSize: 15,
            cursor: 'pointer', fontWeight: 600, backdropFilter: 'blur(4px)',
          }}>Se connecter</button>
        </div>

        {/* Trust bar */}
        <div style={{ display: 'flex', gap: 28, justifyContent: 'center', flexWrap: 'wrap', marginTop: 36 }}>
          {[
            { icon: '🇫🇷', label: 'Hébergé en France' },
            { icon: '🇫🇷', label: 'Développé en France' },
            { icon: '🔒', label: 'Données personnelles chiffrées' },
            { icon: '🛡️', label: 'Conforme RGPD' },
          ].map(({ icon, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span style={{ fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '64px 24px', maxWidth: 960, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 26, fontWeight: 800, color: '#0f172a', marginBottom: 48, letterSpacing: '-0.03em' }}>
          Tout ce dont vous avez besoin
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 24 }}>
          {features.map(f => (
            <div key={f.title} style={{
              background: '#f8fafc', borderRadius: 16, padding: '28px 24px',
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: '#f8fafc', padding: '64px 24px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 26, fontWeight: 800, color: '#0f172a', marginBottom: 8, letterSpacing: '-0.03em' }}>
          Des tarifs simples et transparents
        </h2>
        <p style={{ textAlign: 'center', fontSize: 14, color: '#64748b', marginBottom: 48 }}>
          Pas de coût par utilisateur — un forfait fixe selon la taille de votre équipe.
        </p>
        <PricingSection onRegister={onRegister} />
      </section>

      {/* Footer */}
      <footer style={{ background: '#0f172a', padding: '28px 24px', textAlign: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'white', letterSpacing: '-0.03em' }}>
          Leav<span style={{ color: '#38bdf8' }}>up</span>
        </span>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
          © {new Date().getFullYear()} Leavup — Gestion des absences simplifiée
        </p>
        <p style={{ marginTop: 6 }}>
          <button onClick={onPrivacy} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.45)', fontSize: 11, textDecoration:'underline' }}>
            Politique de confidentialité
          </button>
        </p>
      </footer>
    </div>
  );
}

// ── Politique de confidentialité ──────────────────────────────────────────
function PrivacyPage({ onBack }) {
  const GRAD = 'linear-gradient(160deg, #0f172a 0%, #1e3a8a 60%, #0ea5e9 100%)';
  const section = (title, content) => (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{title}</h3>
      <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>{content}</div>
    </div>
  );
  return (
    <div style={{ minHeight: '100vh', background: GRAD, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 16, padding: 0 }}>
          ← Retour
        </button>
        <div style={{ background: 'white', borderRadius: 18, padding: '2rem 2.5rem', boxShadow: '0 8px 32px rgba(15,23,42,0.3)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>Politique de confidentialité</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 28 }}>Dernière mise à jour : {new Date().toLocaleDateString('fr-FR')}</p>

          {section('1. Responsable du traitement',
            <p>Leavup est édité et hébergé en France. Le responsable du traitement est l'administrateur de chaque organisation utilisant la plateforme Leavup.</p>
          )}
          {section('2. Données collectées',
            <ul style={{ paddingLeft: 20 }}>
              <li>Données d'identification : prénom, nom, identifiant de connexion</li>
              <li>Coordonnées : adresse email, numéro de téléphone, adresse postale</li>
              <li>Données professionnelles : date d'entrée, contrat, soldes de congés</li>
              <li>Données de connexion : identifiant, mot de passe haché (bcrypt)</li>
            </ul>
          )}
          {section('3. Finalités du traitement',
            <ul style={{ paddingLeft: 20 }}>
              <li>Gestion des demandes d'absence et de congés</li>
              <li>Communication par email (notifications de congés)</li>
              <li>Administration des comptes utilisateurs</li>
            </ul>
          )}
          {section('4. Base légale',
            <p>Le traitement est fondé sur l'exécution d'un contrat (gestion des absences en entreprise) et, pour la collecte initiale, sur le consentement de l'utilisateur (art. 6(1)(b) et 6(1)(a) du RGPD).</p>
          )}
          {section('5. Sécurité des données',
            <p>Toutes les données personnelles sont chiffrées en base de données. Les mots de passe sont hachés (bcrypt). L'infrastructure est hébergée en France.</p>
          )}
          {section('6. Durée de conservation',
            <p>Les données sont conservées pendant toute la durée de l'abonnement actif, puis supprimées dans un délai de 30 jours après la résiliation du compte.</p>
          )}
          {section('7. Vos droits',
            <>
              <p style={{ marginBottom: 8 }}>Conformément au RGPD, vous disposez des droits suivants :</p>
              <ul style={{ paddingLeft: 20 }}>
                <li><strong>Droit d'accès</strong> : exporter vos données personnelles depuis votre espace</li>
                <li><strong>Droit de rectification</strong> : modifier vos informations via votre profil</li>
                <li><strong>Droit à l'effacement</strong> : demander la suppression de votre compte à votre administrateur</li>
                <li><strong>Droit à la portabilité</strong> : télécharger vos données au format JSON</li>
              </ul>
              <p style={{ marginTop: 8 }}>Pour exercer ces droits, contactez votre administrateur ou écrivez à l'éditeur de la plateforme.</p>
            </>
          )}
          {section('8. Transferts de données',
            <p>Les données ne sont pas transférées en dehors de l'Union européenne.</p>
          )}
          {section('9. Contact',
            <p>Pour toute question relative à vos données personnelles, contactez l'administrateur de votre organisation ou l'éditeur de Leavup.</p>
          )}

          <button onClick={onBack} style={{
            marginTop: 8, background: '#0f172a', border: 'none', color: 'white',
            borderRadius: 10, padding: '11px 24px', fontSize: 14, cursor: 'pointer', fontWeight: 700,
          }}>← Retour</button>
        </div>
      </div>
    </div>
  );
}

// ── Inscription (auto-souscription plan gratuit) ──────────────────────────
function RegisterScreen({ onBack, onPrivacy }) {
  const [form, setForm] = useState({ orgName:'', firstname:'', lastname:'', email:'', password:'', passwordConfirm:'', consent: false });
  const [err, setErr]       = useState('');
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.orgName || !form.firstname || !form.lastname || !form.email || !form.password)
      return setErr('Tous les champs sont obligatoires');
    if (form.password !== form.passwordConfirm)
      return setErr('Les mots de passe ne correspondent pas');
    if (form.password.length < 8)
      return setErr('Mot de passe trop court (8 caractères minimum)');
    if (!form.consent)
      return setErr('Vous devez accepter la politique de confidentialité');
    setLoading(true); setErr('');
    try {
      const data = await api('POST', '/register', {
        orgName: form.orgName, adminFirstname: form.firstname,
        adminLastname: form.lastname, adminEmail: form.email, adminPassword: form.password,
      });
      setSuccess(data);
    } catch (ex) { setErr(ex.message); }
    setLoading(false);
  };

  const GRAD = 'linear-gradient(160deg, #0f172a 0%, #1e3a8a 60%, #0ea5e9 100%)';

  if (success) return (
    <div style={{ minHeight:'100vh', background: GRAD, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div style={{ background:'white', borderRadius:18, padding:'2rem', maxWidth:400, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🎉</div>
        <h2 style={{ fontSize:20, fontWeight:800, color:'#0f172a', marginBottom:8 }}>Compte créé !</h2>
        <p style={{ fontSize:13, color:'#64748b', marginBottom:20, lineHeight:1.6 }}>
          Votre espace <strong>{success.slug}</strong> est prêt.<br/>
          Votre identifiant de connexion : <code style={{ background:'#f1f5f9', padding:'2px 8px', borderRadius:6, fontWeight:700, fontSize:14 }}>{success.identifier}</code>
        </p>
        {success.identifier && (
          <p style={{ fontSize:12, color:'#94a3b8', marginBottom:20 }}>
            Conservez cet identifiant. Un email de bienvenue vous a été envoyé si le SMTP est configuré.
          </p>
        )}
        <button onClick={onBack} style={{
          width:'100%', background:'#0f172a', border:'none', color:'white',
          borderRadius:10, padding:'12px', fontSize:14, cursor:'pointer', fontWeight:700,
        }}>Se connecter maintenant →</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background: GRAD, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:'1.5rem' }}>
          <h1 style={{ fontSize:28, fontWeight:800, color:'white', letterSpacing:'-0.04em' }}>
            Leav<span style={{ color:'#38bdf8' }}>up</span>
          </h1>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.65)', marginTop:6 }}>
            Créez votre espace gratuitement — 1 admin + 9 employés inclus
          </p>
        </div>
        <div style={{ background:'rgba(255,255,255,0.97)', borderRadius:18, padding:'1.75rem', boxShadow:'0 8px 32px rgba(15,23,42,0.3)' }}>
          <form onSubmit={submit}>
            <Field label="Nom de votre entreprise *">
              <input value={form.orgName} onChange={e=>f('orgName',e.target.value)} style={{width:'100%'}} placeholder="Mon Entreprise SAS" autoFocus />
            </Field>
            <div style={{ display:'flex', gap:10 }}>
              <div style={{ flex:1 }}><Field label="Prénom *"><input value={form.firstname} onChange={e=>f('firstname',e.target.value)} style={{width:'100%'}} /></Field></div>
              <div style={{ flex:1 }}><Field label="Nom *"><input value={form.lastname} onChange={e=>f('lastname',e.target.value)} style={{width:'100%'}} /></Field></div>
            </div>
            <Field label="Email professionnel *">
              <input type="email" value={form.email} onChange={e=>f('email',e.target.value)} style={{width:'100%'}} placeholder="vous@entreprise.com" />
            </Field>
            <PasswordConfirmFields
              value={form.password}          onChange={v=>f('password',v)}
              confirm={form.passwordConfirm} onConfirmChange={v=>f('passwordConfirm',v)}
            />
            <label style={{ display:'flex', alignItems:'flex-start', gap: 8, marginBottom: 14, fontSize: 12, color: '#475569', cursor:'pointer' }}>
              <input type="checkbox" checked={form.consent} onChange={e => f('consent', e.target.checked)}
                style={{ marginTop: 2, flexShrink: 0 }} />
              <span>
                J'ai lu et j'accepte la{' '}
                <button type="button" onClick={onPrivacy} style={{ background:'none', border:'none', cursor:'pointer', color: C.blue, fontSize: 12, fontWeight: 600, padding: 0 }}>
                  politique de confidentialité
                </button>
              </span>
            </label>
            {err && <Alert type="error">{err}</Alert>}
            <Btn full disabled={loading}>{loading ? 'Création…' : 'Créer mon espace gratuit'}</Btn>
          </form>
          <p style={{ textAlign:'center', fontSize:12, color:'#94a3b8', marginTop:16 }}>
            Déjà un compte ?{' '}
            <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:C.blue, fontSize:12, fontWeight:600 }}>Se connecter</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Écran de connexion ──────────────────────────────────────────────────────
function LoginScreen({ onLogin, onBack, onRegister }) {
  const subdomainSlug = detectSubdomain();
  const [id, setId]       = useState('');
  const [pwd, setPwd]     = useState('');
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const [isSuper, setIsSuper] = useState(false);

  const doLogin = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const data = await api('POST', '/auth/login', {
        ...(subdomainSlug && !isSuper ? { orgSlug: subdomainSlug } : {}),
        identifier: id.trim(),
        password: pwd,
      });
      onLogin(data);
    } catch (ex) { setErr(ex.message); }
    setLoading(false);
  };

  const GRAD = 'linear-gradient(160deg, #0f172a 0%, #1e3a8a 60%, #0ea5e9 100%)';
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem', background: GRAD }}>
      <div style={{ width:'100%', maxWidth:380 }}>
        <div style={{ textAlign:'center', marginBottom:'2rem' }}>
          <h1 style={{ fontSize:30, fontWeight:800, color:'white', letterSpacing:'-0.04em' }}>
            Leav<span style={{ color:'#38bdf8' }}>up</span>
          </h1>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.65)', marginTop:6 }}>
            {subdomainSlug ? `${subdomainSlug}.leavup.com` : 'Gestion des absences pour votre entreprise'}
          </p>
        </div>

        <div data-nosnippet style={{ background:'rgba(255,255,255,0.97)', borderRadius:18, padding:'1.5rem', boxShadow:'0 8px 32px rgba(15,23,42,0.3)' }}>
          <form onSubmit={doLogin}>
            {isSuper && <Alert type="info">Connexion Super Admin — leavup.com</Alert>}
            <Field label={isSuper ? 'Identifiant' : 'Identifiant ou email'}>
              <input value={id} onChange={e=>{setId(e.target.value);setErr('');}}
                placeholder={isSuper ? 'superadmin' : 'TOJD-2J7M ou prenom@email.fr'}
                style={{width:'100%'}} autoCapitalize="off" autoFocus />
            </Field>
            <Field label="Mot de passe">
              <input type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr('');}}
                placeholder="••••••••" style={{width:'100%'}} />
            </Field>
            {err && <Alert type="error">{err}</Alert>}
            <Btn full disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</Btn>
          </form>
        </div>

        <div style={{ textAlign:'center', marginTop:14, display:'flex', flexDirection:'column', gap:8 }}>
          {!isSuper && onRegister && (
            <p style={{ fontSize:13, color:'rgba(255,255,255,0.75)' }}>
              Pas encore de compte ?{' '}
              <button onClick={onRegister} style={{ background:'none', border:'none', cursor:'pointer', color:'#38bdf8', fontSize:13, fontWeight:700 }}>
                Essai gratuit →
              </button>
            </p>
          )}
          {onBack && (
            <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'rgba(255,255,255,0.5)' }}>
              ← Retour à l'accueil
            </button>
          )}
        </div>
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
            {pendingCount > 0 && t === 'Demandes' && (
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
function AdminView({ session, onLogout, onLogoChange, onPlanChange }) {
  const { token, org } = session;
  const [tab, setTab]               = useState(0);
  const [users, setUsers]           = useState([]);
  const [leaves, setLeaves]         = useState([]);
  const [contracts, setContracts]   = useState([]);
  const [teams, setTeams]           = useState([]);
  const [settings, setSettings]     = useState({ alertThreshold: org.alertThreshold });
  const [loading, setLoading]       = useState(true);
  const [highlightLeave, setHighlightLeave] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [u, l, s, c, t] = await Promise.all([
        api('GET', '/users',     null, token),
        api('GET', '/leaves',    null, token),
        api('GET', '/settings',  null, token),
        api('GET', '/contracts', null, token),
        api('GET', '/teams',     null, token),
      ]);
      setUsers(u); setLeaves(l); setSettings(s); setContracts(c); setTeams(t);
    } catch (e) { console.error(e); }
    if (!silent) setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const pendingCount = leaves.filter(l => l.status === 'pending').length;
  const TABS = ['Tableau de bord', 'Salariés', 'Équipes', 'Demandes', 'Contrats', 'Planning', 'Paramètres'];

  return (
    <Layout user={session.user} org={org} onLogout={onLogout}
      tabs={TABS} activeTab={tab} onTab={setTab} pendingCount={pendingCount}
      fullWidth={tab === 5}>
      {loading ? <Spinner /> : (
        <>
          {tab === 0 && <AdminDash users={users} leaves={leaves} settings={settings} teams={teams} />}
          {tab === 1 && <AdminUsers users={users} contracts={contracts} leaves={leaves} teams={teams} token={token} org={org} onRefresh={load} />}
          {tab === 2 && <AdminTeams teams={teams} users={users} token={token} onRefresh={load} />}
          {tab === 3 && <AdminLeaves users={users} leaves={leaves} settings={settings} token={token} onRefresh={load} highlightLeave={highlightLeave} onHighlightDone={() => setHighlightLeave(null)} />}
          {tab === 4 && <AdminContracts contracts={contracts} token={token} onRefresh={load} />}
          {tab === 5 && <AdminPlanning users={users} leaves={leaves} onPendingClick={id => { setHighlightLeave(id); setTab(3); }} />}
          {tab === 6 && <AdminSettings settings={settings} token={token} org={org} onSaved={(s) => setSettings(s)} onLogoChange={onLogoChange} onPlanChange={onPlanChange} />}
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

function AdminUsers({ users, contracts, leaves, teams, token, org, onRefresh }) {
  const [modal, setModal]     = useState(null);
  const [target, setTarget]   = useState(null);
  const emptyForm = {
    identifier:'', firstname:'', lastname:'', password:'', passwordConfirm:'',
    phone:'', email:'',
    addressStreet:'', addressCity:'', addressZip:'', addressCountry:'France',
    entryDate:'', contractId:'', cpBalance:'0', rttBalance:'0', autoAccumulate:true,
    teamId:'',
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
      teamId:         u.team_id || '',
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
      teamId:         form.teamId || null,
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
          <Field label="Équipe">
            <select value={form.teamId}
              onChange={e => setForm(f=>({...f, teamId: e.target.value}))}
              style={{ width:'100%' }}>
              <option value="">— Aucune équipe —</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
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

      <div style={{ display:'flex', justifyContent:'flex-end', gap: 8, marginBottom: 12 }}>
        <CsvDownloadBtn url="/api/users/export" filename="salaries.csv" token={token} label="Exporter CSV" />
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
                {(u.contract_name || u.entry_date || u.team_name) && (
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, display:'flex', alignItems:'center', gap: 6, flexWrap:'wrap' }}>
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
                    {u.team_name && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20,
                        background: '#ede9fe', color: '#7c3aed',
                      }}>⬡ {u.team_name}</span>
                    )}
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

function AdminTeams({ teams, users, token, onRefresh }) {
  const [modal, setModal] = useState(null);
  const [target, setTarget] = useState(null);
  const emptyForm = { name: '', leaderId: '' };
  const [form, setForm] = useState(emptyForm);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  const employees = users.filter(u => u.role !== 'admin');

  const openCreate = () => { setForm(emptyForm); setTarget(null); setFormErr(''); setModal('form'); };
  const openEdit = (t) => { setForm({ name: t.name, leaderId: t.leader_id || '' }); setTarget(t); setFormErr(''); setModal('form'); };

  const save = async () => {
    if (!form.name.trim()) return setFormErr('Le nom de l\'équipe est obligatoire');
    setSaving(true); setFormErr('');
    try {
      if (target) {
        await api('PUT', `/teams/${target.id}`, { name: form.name, leaderId: form.leaderId || null }, token);
      } else {
        await api('POST', '/teams', { name: form.name, leaderId: form.leaderId || null }, token);
      }
      setModal(null); onRefresh();
    } catch (e) { setFormErr(e.message); }
    setSaving(false);
  };

  const del = async (t) => {
    if (!confirm(`Supprimer l'équipe "${t.name}" ? Les membres seront détachés.`)) return;
    try { await api('DELETE', `/teams/${t.id}`, null, token); onRefresh(); }
    catch (e) { alert(e.message); }
  };

  const leaderName = (t) => {
    if (!t.leader_id) return null;
    const fn = t.leader_firstname || '';
    const ln = t.leader_lastname  || '';
    return (fn || ln) ? `${fn} ${ln}`.trim() : t.leader_name;
  };

  return (
    <>
      {modal === 'form' && (
        <Modal title={target ? `Modifier — ${target.name}` : 'Nouvelle équipe'} onClose={() => setModal(null)}>
          <Field label="Nom de l'équipe *">
            <input value={form.name} onChange={e => setForm(f=>({...f, name: e.target.value}))}
              style={{ width:'100%' }} placeholder="ex: Développement, Commercial…" />
          </Field>
          <Field label="Chef d'équipe">
            <select value={form.leaderId} onChange={e => setForm(f=>({...f, leaderId: e.target.value}))}
              style={{ width:'100%' }}>
              <option value="">— Aucun —</option>
              {employees.map(u => (
                <option key={u.id} value={u.id}>
                  {u.firstname || u.lastname ? `${u.firstname||''} ${u.lastname||''}`.trim() : u.name}
                  {' '}({u.identifier})
                </option>
              ))}
            </select>
          </Field>
          {formErr && <Alert type="error">{formErr}</Alert>}
          <div style={{ display:'flex', gap: 8 }}>
            <Btn onClick={save} disabled={saving} full>{target ? 'Enregistrer' : 'Créer'}</Btn>
            <Btn variant="ghost" onClick={() => setModal(null)} full>Annuler</Btn>
          </div>
        </Modal>
      )}

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom: 12 }}>
        <Btn onClick={openCreate}>+ Nouvelle équipe</Btn>
      </div>

      {teams.length === 0 ? (
        <div style={{ ...CARD, textAlign:'center', color: C.textHint, fontSize: 13, padding:'2rem' }}>
          Aucune équipe. Créez votre première équipe pour déléguer la gestion des congés.
        </div>
      ) : teams.map(t => {
        const leader = leaderName(t);
        const members = users.filter(u => u.team_id === t.id);
        return (
          <div key={t.id} style={{ ...CARD, marginBottom: 10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>⬡ {t.name}</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3, display:'flex', gap: 12, flexWrap:'wrap' }}>
                  <span>{t.member_count} membre{t.member_count !== 1 ? 's' : ''}</span>
                  {leader && (
                    <span>Chef : <strong style={{ color: C.text }}>{leader}</strong></span>
                  )}
                  {!leader && (
                    <span style={{ color: C.amber }}>Aucun chef d'équipe désigné</span>
                  )}
                </div>
                {members.length > 0 && (
                  <div style={{ marginTop: 8, display:'flex', gap: 6, flexWrap:'wrap' }}>
                    {members.map(m => (
                      <span key={m.id} style={{
                        fontSize: 11, padding:'2px 8px', borderRadius: 20,
                        background: '#ede9fe', color: '#7c3aed', fontWeight: 500,
                      }}>
                        {m.firstname || m.lastname ? `${m.firstname||''} ${m.lastname||''}`.trim() : m.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                <Btn small variant="ghost" onClick={() => openEdit(t)}>Modifier</Btn>
                <Btn small variant="danger" onClick={() => del(t)}>×</Btn>
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
  const [exportYear, setExportYear]   = useState(String(new Date().getFullYear()));
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

      <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap: 8, marginBottom: 16 }}>
        <select
          value={exportYear}
          onChange={e => setExportYear(e.target.value)}
          style={{ padding:'6px 8px', borderRadius: 6, border:`1px solid ${C.border}`, fontSize: 12, color: C.text, background: C.bg }}
        >
          {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i)).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
          <option value="">Toutes années</option>
        </select>
        <CsvDownloadBtn
          url={`/api/leaves/export${exportYear ? `?year=${exportYear}` : ''}`}
          filename={exportYear ? `conges-${exportYear}.csv` : 'conges.csv'}
          token={token}
          label="Exporter CSV"
        />
      </div>

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

// ── Plans disponibles ───────────────────────────────────────────────────────
const PLANS_DEF = [
  { id: 'free',       label: 'Starter',    price: 0,    maxUsers: 10,     desc: "jusqu'à 10 salariés" },
  { id: 'team',       label: 'Teams',      price: 39,   maxUsers: 30,     desc: "jusqu'à 30 salariés", badge: 'Populaire' },
  { id: 'enterprise', label: 'Enterprise', price: null, maxUsers: 999999, desc: '30+ salariés' },
];

function PlanSection({ currentPlan, userCount, token, onChange }) {
  const [confirmPlan,    setConfirmPlan]    = useState(null);
  const [contactSubject, setContactSubject] = useState(null);
  const [saving, setSaving]                = useState(false);
  const [err, setErr]                      = useState('');

  const current = PLANS_DEF.find(p => p.id === (currentPlan || 'free')) || PLANS_DEF[0];
  const pct = current.maxUsers === 999999 ? 0
    : Math.min(100, Math.round((userCount / current.maxUsers) * 100));
  const usageTense = pct >= 100 ? C.red : pct >= 80 ? C.amber : C.blue;

  const select = (plan) => {
    if (plan.id === (currentPlan || 'free')) return;
    if (plan.price !== 0) {
      setContactSubject(`Leavup ${plan.label} — demande de renseignements`);
      return;
    }
    setErr(''); setConfirmPlan(plan);
  };

  const confirm = async () => {
    setSaving(true); setErr('');
    try {
      const res = await api('PUT', '/settings/plan', { plan: confirmPlan.id }, token);
      onChange(res.plan);
      setConfirmPlan(null);
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <>
      {/* Statut plan actuel */}
      <div style={{ background: C.bgSecond, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 10 }}>
          <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Plan actuel</span>
            <span style={{
              background: currentPlan === 'free' ? C.bgCard : C.blueLight,
              color:      currentPlan === 'free' ? C.textMuted : C.blueDark,
              border:     `1px solid ${currentPlan === 'free' ? C.border : C.blue}`,
              borderRadius: 20, padding: '2px 11px', fontSize: 12, fontWeight: 700,
            }}>{current.label}</span>
          </div>
          <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>
            {userCount} / {current.maxUsers === 999999 ? '∞' : current.maxUsers} salariés
          </span>
        </div>
        {current.maxUsers !== 999999 && (
          <>
            <div style={{ height: 6, borderRadius: 4, background: C.border, overflow:'hidden' }}>
              <div style={{
                height:'100%', borderRadius: 4, background: usageTense,
                width: `${pct}%`, transition: 'width 0.4s ease',
              }} />
            </div>
            {pct >= 80 && (
              <div style={{ fontSize: 11, color: usageTense, marginTop: 5, fontWeight: 500 }}>
                {pct >= 100
                  ? '⛔ Limite atteinte — impossible d\'ajouter des salariés.'
                  : '⚠ Vous approchez la limite de votre plan.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Grille des plans */}
      <div style={{ display:'flex', gap: 8, flexWrap:'wrap', marginBottom: 4 }}>
        {PLANS_DEF.map(p => {
          const isActive      = p.id === (currentPlan || 'free');
          const cantDowngrade = p.maxUsers < userCount;
          return (
            <button key={p.id} onClick={() => select(p)}
              disabled={isActive || cantDowngrade}
              title={cantDowngrade
                ? `Impossible : vous avez ${userCount} salariés (limite ${p.maxUsers})`
                : isActive ? 'Plan actuel' : `Passer au plan ${p.label}`}
              style={{
                flex: '1 1 90px', padding: '12px 10px', borderRadius: 12, textAlign:'left',
                border:      `${isActive ? 2 : 1.5}px solid ${isActive ? C.blue : C.border}`,
                background:  isActive ? C.blueLight : cantDowngrade ? C.bgSecond : 'white',
                cursor:      isActive || cantDowngrade ? 'default' : 'pointer',
                opacity:     cantDowngrade ? 0.45 : 1,
                transition:  'border-color 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { if (!isActive && !cantDowngrade) e.currentTarget.style.boxShadow = `0 0 0 3px rgba(14,165,233,0.12)`; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              {p.badge && (
                <div style={{
                  fontSize: 9, fontWeight: 700, color: C.blue,
                  background: C.blueLight, borderRadius: 6, padding: '1px 6px',
                  display:'inline-block', marginBottom: 4, letterSpacing: '.03em',
                }}>{p.badge}</div>
              )}
              <div style={{ fontSize: 10, fontWeight: 700, textTransform:'uppercase',
                letterSpacing:'.05em', marginBottom: 4,
                color: isActive ? C.blue : C.textMuted,
              }}>
                {p.label}{isActive ? ' ✓' : ''}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1, marginBottom: 2,
                color: isActive ? C.blueDark : C.text,
              }}>
                {p.price === null ? 'Devis' : p.price === 0 ? 'Gratuit' : `${p.price} €`}
              </div>
              {p.price !== null && p.price > 0 && (
                <div style={{ fontSize: 10, color: C.textHint, marginBottom: 4 }}>/mois HT</div>
              )}
              <div style={{ fontSize: 11, color: isActive ? C.blue : C.textMuted }}>{p.desc}</div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.textHint, marginBottom: 16 }}>
        Pour passer à un plan payant, contactez-nous à{' '}
        <a href="mailto:contact@leavup.com" style={{ color: C.blue }}>contact@leavup.com</a>.
      </div>

      {/* Modal confirmation */}
      {confirmPlan && (
        <Modal title={`Passer au plan ${confirmPlan.label}`}
          onClose={() => { setConfirmPlan(null); setErr(''); }}>
          <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
            {confirmPlan.price > 0 ? (
              <>Vous allez passer au plan <strong>{confirmPlan.label}</strong> —{' '}
              <strong>{confirmPlan.price} €/mois HT</strong> pour jusqu'à{' '}
              <strong>{confirmPlan.maxUsers} salariés</strong>.<br />
              La modification est immédiate et la facturation sera ajustée à votre prochain cycle.</>
            ) : (
              <>Vous allez repasser au plan <strong>Starter</strong> (gratuit, 10 salariés maximum).<br />
              Assurez-vous d'avoir 10 salariés ou moins avant de confirmer.</>
            )}
          </p>
          {err && <Alert type="error">{err}</Alert>}
          <div style={{ display:'flex', gap: 8 }}>
            <Btn full onClick={confirm} disabled={saving}>
              {saving ? 'Mise à jour…' : `Confirmer — ${confirmPlan.label}`}
            </Btn>
            <Btn variant="ghost" full onClick={() => { setConfirmPlan(null); setErr(''); }}>
              Annuler
            </Btn>
          </div>
        </Modal>
      )}
      {contactSubject && <ContactModal subject={contactSubject} onClose={() => setContactSubject(null)} />}
    </>
  );
}

function AdminSettings({ settings, token, org, onSaved, onLogoChange, onPlanChange }) {
  const [threshold,            setThreshold]            = useState(settings.alertThreshold);
  const [allowUnpaid,          setAllowUnpaid]          = useState(!!settings.allowUnpaidLeave);
  const [allowWhenExhausted,   setAllowWhenExhausted]   = useState(!!settings.allowUnpaidWhenExhausted);
  const [notifyOnSubmit,       setNotifyOnSubmit]       = useState(settings.notifyOnSubmit  ?? true);
  const [notifyOnApprove,      setNotifyOnApprove]      = useState(settings.notifyOnApprove ?? true);
  const [notifyOnReject,       setNotifyOnReject]       = useState(settings.notifyOnReject  ?? true);
  const [notifyAdminNew,       setNotifyAdminNew]       = useState(settings.notifyAdminNew  ?? true);
  const [leavePeriod,          setLeavePeriod]          = useState(settings.leavePeriod    || 'civil');
  const [leaveGrantMode,       setLeaveGrantMode]       = useState(settings.leaveGrantMode || 'progressive');
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
        leavePeriod,
        leaveGrantMode,
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

      {/* Plan & Abonnement */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, margin: '16px 0 10px', textTransform:'uppercase', letterSpacing:'.05em' }}>
        Plan &amp; Abonnement
      </div>
      <PlanSection
        currentPlan={settings.plan}
        userCount={settings.userCount || 0}
        token={token}
        onChange={(plan) => {
          onSaved({ ...settings, plan });
          if (onPlanChange) onPlanChange(plan);
        }}
      />

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

      {/* Période de référence des congés */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, margin: '16px 0 8px', textTransform:'uppercase', letterSpacing:'.05em' }}>
        Période de référence des congés
      </div>
      <div style={{ background: C.bgSecond, borderRadius: 10, padding: '14px', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Année de référence</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
          Définit le début et la fin de la période sur laquelle les congés sont comptabilisés.
        </div>
        {[
          { id: 'civil',     label: 'Année civile',         desc: '1er janvier → 31 décembre' },
          { id: 'reference', label: 'Année de référence CP', desc: '1er juin → 31 mai (période légale française)' },
        ].map(opt => (
          <label key={opt.id} onClick={() => { setLeavePeriod(opt.id); setSaved(false); }} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
            marginBottom: 8, padding: '10px 12px', borderRadius: 8,
            border: `1.5px solid ${leavePeriod === opt.id ? C.blue : C.border}`,
            background: leavePeriod === opt.id ? C.blueLight : 'white',
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
              border: `2px solid ${leavePeriod === opt.id ? C.blue : C.border}`,
              background: leavePeriod === opt.id ? C.blue : 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {leavePeriod === opt.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: leavePeriod === opt.id ? C.blueDark : C.text }}>{opt.label}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{opt.desc}</div>
            </div>
          </label>
        ))}
      </div>

      <div style={{ background: C.bgSecond, borderRadius: 10, padding: '14px', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Attribution des jours de congés</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
          Définit comment les jours sont crédités sur le compte du salarié.
        </div>
        {[
          { id: 'progressive', label: 'Acquisition progressive', desc: 'Les jours s\'accumulent mois par mois (~2,08 j/mois pour 25 j/an).' },
          { id: 'advance',     label: 'Attribution par anticipation', desc: 'Tous les jours de la période sont crédités dès le premier jour.' },
        ].map(opt => (
          <label key={opt.id} onClick={() => { setLeaveGrantMode(opt.id); setSaved(false); }} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
            marginBottom: 8, padding: '10px 12px', borderRadius: 8,
            border: `1.5px solid ${leaveGrantMode === opt.id ? C.blue : C.border}`,
            background: leaveGrantMode === opt.id ? C.blueLight : 'white',
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
              border: `2px solid ${leaveGrantMode === opt.id ? C.blue : C.border}`,
              background: leaveGrantMode === opt.id ? C.blue : 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {leaveGrantMode === opt.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: leaveGrantMode === opt.id ? C.blueDark : C.text }}>{opt.label}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{opt.desc}</div>
            </div>
          </label>
        ))}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap: 12, marginTop: 4 }}>
        <Btn onClick={save} disabled={saving}>Enregistrer</Btn>
        {saved && <span style={{ fontSize: 13, color: C.green, fontWeight: 500 }}>✓ Enregistré</span>}
      </div>

      {/* RGPD */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, margin: '24px 0 8px', textTransform:'uppercase', letterSpacing:'.05em' }}>
        RGPD &amp; données personnelles
      </div>
      <RgpdAdminSection token={token} />
    </div>
  );
}

function RgpdAdminSection({ token }) {
  const [delModal, setDelModal]   = useState(false);
  const [delPwd,   setDelPwd]     = useState('');
  const [delErr,   setDelErr]     = useState('');
  const [deleting, setDeleting]   = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/admin/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'export-organisation-leavup.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
    setExporting(false);
  };

  const handleDelete = async () => {
    setDelErr('');
    if (!delPwd) return setDelErr('Mot de passe requis');
    setDeleting(true);
    try {
      await api('DELETE', '/admin/account', { password: delPwd }, token);
      // Suppression réussie — vider la session et recharger
      clearSession();
      window.location.reload();
    } catch (e) { setDelErr(e.message); }
    setDeleting(false);
  };

  return (
    <>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Exporter toutes les données</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
          Télécharge un fichier JSON contenant toutes les données de votre organisation (salariés, demandes, paramètres).
        </div>
        <Btn onClick={handleExport} disabled={exporting}>{exporting ? 'Export…' : 'Télécharger l\'export'}</Btn>
      </div>

      <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: C.red }}>Supprimer le compte organisation</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
          Supprime définitivement l'organisation et toutes ses données (salariés, demandes). Cette action est irréversible.
        </div>
        <Btn variant="danger" onClick={() => { setDelModal(true); setDelPwd(''); setDelErr(''); }}>Supprimer le compte</Btn>
      </div>

      {delModal && (
        <Modal title="Confirmer la suppression" onClose={() => setDelModal(false)}>
          <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
            Cette action supprimera définitivement votre organisation et toutes ses données. Entrez votre mot de passe pour confirmer.
          </p>
          <Field label="Mot de passe administrateur">
            <input type="password" value={delPwd} onChange={e => setDelPwd(e.target.value)}
              style={{ width: '100%' }} autoFocus />
          </Field>
          {delErr && <Alert type="error">{delErr}</Alert>}
          <div style={{ display:'flex', gap: 8 }}>
            <Btn variant="danger" onClick={handleDelete} disabled={deleting} full>
              {deleting ? 'Suppression…' : 'Confirmer la suppression'}
            </Btn>
            <Btn variant="ghost" onClick={() => setDelModal(false)} full>Annuler</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── VUE EMPLOYÉ ────────────────────────────────────────────────────────────
function EmployeeView({ session, onLogout }) {
  const { token, user, org } = session;
  const [tab, setTab]         = useState(0);
  const [me, setMe]           = useState(null);
  const [leaves, setLeaves]   = useState([]);
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [myData, lvs] = await Promise.all([
        api('GET', '/me',     null, token),
        api('GET', '/leaves', null, token),
      ]);
      setMe(myData); setLeaves(lvs);
      // Charger les données d'équipe si chef d'équipe
      if (myData?.led_team_id) {
        try {
          const td = await api('GET', '/teams/my/leaves', null, token);
          setTeamData(td);
        } catch { setTeamData(null); }
      }
    } catch (e) { console.error(e); }
    if (!silent) setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const isLeader = !!me?.led_team_id;
  const TABS = isLeader
    ? ["Mon espace", "Nouvelle demande d'absence", 'Historique', `Mon équipe${teamData ? ` (${teamData.leaves.filter(l=>l.status==='pending').length})` : ''}`]
    : ["Mon espace", "Nouvelle demande d'absence", 'Historique'];

  return (
    <Layout user={user} org={org} onLogout={onLogout}
      tabs={TABS} activeTab={tab} onTab={setTab} pendingCount={0}>
      {loading ? <Spinner /> : (
        <>
          {tab === 0 && <EmpHome me={me} leaves={leaves} token={token} />}
          {tab === 1 && <EmpRequest me={me} org={org} token={token} onDone={load} />}
          {tab === 2 && <EmpHistory leaves={leaves} token={token} />}
          {tab === 3 && isLeader && <TeamLeaderView teamData={teamData} token={token} onRefresh={load} />}
        </>
      )}
    </Layout>
  );
}

function TeamLeaderView({ teamData, token, onRefresh }) {
  const [rejectModal, setRejectModal] = useState(null);
  const [reason, setReason]           = useState('');
  const [saving, setSaving]           = useState(false);

  if (!teamData) return <div style={{ ...CARD, textAlign:'center', color: C.textHint, fontSize: 13 }}>Chargement…</div>;

  const { team, members, leaves } = teamData;
  const pending = leaves.filter(l => l.status === 'pending').sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
  const done    = leaves.filter(l => l.status !== 'pending').sort((a,b) => new Date(b.created_at)-new Date(a.created_at));

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
      setRejectModal(null); setReason(''); onRefresh();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const empName = (l) => {
    const fn = l.employee_firstname || '';
    const ln = l.employee_lastname  || '';
    return (fn || ln) ? `${fn} ${ln}`.trim() : l.employee_name;
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
            <Btn variant="danger" onClick={doReject} disabled={saving} full>Confirmer le refus</Btn>
            <Btn variant="ghost" onClick={() => { setRejectModal(null); setReason(''); }} full>Annuler</Btn>
          </div>
        </Modal>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, marginBottom: 12 }}>
        Équipe : <span style={{ color: C.text }}>⬡ {team.name}</span>
        <span style={{ fontWeight: 400, marginLeft: 8 }}>— {members.length} membre{members.length !== 1 ? 's' : ''}</span>
      </div>

      {members.length > 0 && (
        <div style={{ display:'flex', gap: 6, flexWrap:'wrap', marginBottom: 16 }}>
          {members.map(m => (
            <span key={m.id} style={{
              fontSize: 12, padding:'3px 10px', borderRadius: 20,
              background: '#ede9fe', color: '#7c3aed', fontWeight: 500,
            }}>
              {m.firstname || m.lastname ? `${m.firstname||''} ${m.lastname||''}`.trim() : m.name}
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>
        En attente ({pending.length})
      </div>
      {pending.length === 0 ? (
        <div style={{ ...CARD, fontSize: 13, color: C.textHint, textAlign:'center', padding:'1.5rem', marginBottom: 16 }}>
          Aucune demande en attente.
        </div>
      ) : pending.map(l => (
        <div key={l.id} style={{ ...CARD, marginBottom: 8, borderLeft: `3px solid ${C.amber}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{empName(l)}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {fmt(l.start_date)} → {fmt(l.end_date)} · <strong>{l.days}j</strong>
                {' · '}{{paid:'CP', unpaid:'Sans solde', rtt:'RTT'}[l.leave_type] || l.leave_type}
              </div>
              {l.comment && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>"{l.comment}"</div>}
            </div>
            <div style={{ display:'flex', gap: 6, flexShrink: 0 }}>
              <Btn small onClick={() => approve(l.id)} disabled={saving}>Approuver</Btn>
              <Btn small variant="danger" onClick={() => setRejectModal(l.id)} disabled={saving}>Refuser</Btn>
            </div>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, margin: '16px 0 10px' }}>
            Historique ({done.length})
          </div>
          {done.map(l => (
            <div key={l.id} style={{ ...CARD, marginBottom: 6,
              borderLeft: `3px solid ${l.status === 'approved' ? C.green : C.red}`,
              opacity: 0.85,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{empName(l)}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {fmt(l.start_date)} → {fmt(l.end_date)} · {l.days}j
                {' · '}<Badge s={l.status} />
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function EmpHome({ me, leaves, token }) {
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

      <EmpExportButton token={token} />
    </>
  );
}

function CsvDownloadBtn({ url, filename, token, label = 'Exporter CSV' }) {
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { alert(e.message); }
    setLoading(false);
  };
  return (
    <Btn variant="ghost" onClick={download} disabled={loading}>
      {loading ? '…' : `↓ ${label}`}
    </Btn>
  );
}

function EmpExportButton({ token }) {
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/me/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'mes-donnees-leavup.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
    setExporting(false);
  };
  return (
    <div style={{ ...CARD, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>Mes données personnelles (RGPD)</div>
      <div style={{ fontSize: 12, color: C.textHint, marginBottom: 10 }}>
        Téléchargez l'ensemble de vos données personnelles au format JSON.
      </div>
      <Btn onClick={handleExport} disabled={exporting}>{exporting ? 'Export…' : 'Exporter mes données'}</Btn>
    </div>
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

function EmpHistory({ leaves, token }) {
  if (!leaves.length) return (
    <div style={{ ...CARD, fontSize: 13, color: C.textHint, textAlign:'center', padding:'2rem' }}>
      Aucune demande de congé.
    </div>
  );
  return (
    <>
      <CsvDownloadBtn
        url="/api/me/leaves/export"
        filename="mes-conges.csv"
        token={token}
        label="Exporter mes congés (CSV)"
      />
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
  const [screen, setScreen]   = useState('landing'); // 'landing' | 'login' | 'register' | 'privacy'
  const prevScreenRef = useRef('landing');
  const resetToken = new URLSearchParams(window.location.search).get('token');

  const handleLogin = (data) => {
    // Le token JWT est stocké en cookie HttpOnly par le backend — on ne le conserve pas côté JS
    const s = { user: data.user, org: data.org || null };
    saveSession(s);
    setSession(s);
    setScreen('landing');
  };

  const handleLogout = useCallback(async () => {
    try { await api('POST', '/auth/logout'); } catch { /* best-effort */ }
    clearSession();
    setSession(null);
    setScreen('landing');
  }, []);

  const idleWarning = useIdleTimer(handleLogout, !!session);

  // Lien d'activation reçu par email — prioritaire sur tout
  if (resetToken) return <ResetPasswordScreen token={resetToken} onDone={() => {
    window.history.replaceState({}, '', window.location.pathname);
    setSession(null);
  }} />;

  const goPrivacy = (from) => { prevScreenRef.current = from; setScreen('privacy'); };

  if (!session) {
    if (screen === 'privacy')  return <PrivacyPage onBack={() => setScreen(prevScreenRef.current)} />;
    if (screen === 'login')    return <LoginScreen    onLogin={handleLogin} onBack={() => setScreen('landing')} onRegister={() => setScreen('register')} />;
    if (screen === 'register') return <RegisterScreen onBack={() => setScreen('login')} onPrivacy={() => goPrivacy('register')} />;
    return <LandingPage onLogin={() => setScreen('login')} onRegister={() => setScreen('register')} onPrivacy={() => goPrivacy('landing')} />;
  }

  const role = session.user.role;
  const handleLogoChange = (logoData, logoSize) => {
    const updated = { ...session, org: { ...session.org, logoData, ...(logoSize !== undefined ? { logoSize } : {}) } };
    saveSession(updated);
    setSession(updated);
  };

  const handlePlanChange = (plan) => {
    const updated = { ...session, org: { ...session.org, plan } };
    saveSession(updated);
    setSession(updated);
  };

  return (
    <>
      <GlobalStyle />
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
      {role === 'admin'      && <AdminView      session={session} onLogout={handleLogout} onLogoChange={handleLogoChange} onPlanChange={handlePlanChange} />}
      {role === 'employee'   && <EmployeeView   session={session} onLogout={handleLogout} />}
    </>
  );
}
