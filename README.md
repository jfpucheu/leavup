# Leavup — Gestion des absences multi-entreprises

SaaS de gestion des absences pour PME. Multi-tenant, 3 niveaux d'accès.

## Architecture

```
leavup/
├── schema.sql          ← Schéma PostgreSQL
├── docker-compose.yml  ← Démarrage en une commande
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── index.js    ← API Express (REST + JWT)
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        └── App.jsx     ← React SPA
```

## Rôles

| Rôle         | Accès                                                          |
|--------------|----------------------------------------------------------------|
| `superadmin` | Créer/modifier/supprimer des organisations                     |
| `admin`      | Gérer les salariés, valider les demandes, paramétrer le seuil  |
| `employee`   | Déposer des demandes, consulter son solde et son historique    |

## Démarrage rapide (Docker)

```bash
# 1. Cloner le projet
cd leavup

# 2. Lancer tout en une commande
docker compose up --build
```

- Frontend → http://localhost:5173
- API      → http://localhost:3000/api/health

## Démarrage en développement (sans Docker)

### Prérequis
- Node.js 20+
- PostgreSQL 14+

### Base de données

```bash
createdb leavup
psql leavup < schema.sql
```

### Backend

```bash
cd backend
cp .env.example .env
# → Renseigner DATABASE_URL, JWT_SECRET, SUPER_PASSWORD
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev    # Vite sur http://localhost:5173
              # Proxy /api → backend via nginx
```

## Première connexion

### Super Admin
- Identifiant : `superadmin`
- Mot de passe : valeur de `SUPER_PASSWORD` dans le `.env`
- Cliquer « Accès administrateur plateforme » sur l'écran de login

### Créer une première organisation
1. Se connecter en Super Admin
2. Cliquer **+ Nouvelle organisation**
3. Renseigner : nom, slug (ex: `acme`), mot de passe admin
4. Le compte admin est automatiquement créé avec l'identifiant `ADMIN`

### Se connecter en tant qu'admin de l'organisation
- Code entreprise : `acme` (le slug choisi)
- Identifiant : `ADMIN`
- Mot de passe : celui saisi à la création

## API Reference

### Auth
| Méthode | Endpoint        | Description                    |
|---------|-----------------|--------------------------------|
| POST    | /api/auth/login | Connexion (orgSlug? + creds)   |

### Organisations (superadmin)
| Méthode | Endpoint        | Description                     |
|---------|-----------------|---------------------------------|
| GET     | /api/orgs       | Lister toutes les organisations  |
| POST    | /api/orgs       | Créer une organisation           |
| PUT     | /api/orgs/:id   | Modifier                         |
| DELETE  | /api/orgs/:id   | Supprimer                        |

### Utilisateurs (admin)
| Méthode | Endpoint        | Description                    |
|---------|-----------------|--------------------------------|
| GET     | /api/users      | Lister les salariés de l'org   |
| POST    | /api/users      | Créer un salarié               |
| PUT     | /api/users/:id  | Modifier                       |
| DELETE  | /api/users/:id  | Supprimer                      |

### Absences
| Méthode | Endpoint                   | Description                     |
|---------|----------------------------|---------------------------------|
| GET     | /api/leaves                | Lister (admin = tout, emp = soi)|
| POST    | /api/leaves                | Déposer une demande             |
| PUT     | /api/leaves/:id/approve    | Approuver (admin)               |
| PUT     | /api/leaves/:id/reject     | Refuser avec motif (admin)      |

### Profil & paramètres
| Méthode | Endpoint          | Description                    |
|---------|-------------------|--------------------------------|
| GET     | /api/me           | Profil + solde (employee)      |
| GET     | /api/settings     | Paramètres org (admin)         |
| PUT     | /api/settings     | Modifier paramètres (admin)    |
| PUT     | /api/settings/logo| Changer logo et taille (admin) |

## Tests automatisés

Les deux projets (backend et frontend) utilisent **Vitest**.

### Via Docker (recommandé — aucune dépendance locale requise)

```bash
# Backend (43 tests d'intégration)
docker exec leavup-backend-1 npx vitest run

# Frontend (tests composants React)
docker exec leavup-frontend-1 npx vitest run
```

### En développement local

```bash
# Backend
cd backend
npm test              # exécution unique
npm run test:watch    # mode watch (relance à chaque modification)
npm run test:coverage # rapport de couverture

# Frontend
cd frontend
npm test
npm run test:watch
npm run test:coverage
```

> Les tests backend utilisent des mocks pg/nodemailer — aucune base de données réelle nécessaire.

---

## Déploiement NAS Synology

Utiliser `docker-compose.synology.yml` — voir le fichier pour les instructions.

```bash
docker compose -f docker-compose.synology.yml up -d
```
