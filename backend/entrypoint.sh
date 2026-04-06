#!/bin/sh
set -e

# ── Génération d'un certificat TLS auto-signé à chaque démarrage ─────────────
# Utilisé pour chiffrer le trafic interne nginx → backend (Docker network).
# Valide 1 jour uniquement — renouvelé automatiquement au prochain démarrage.

CERT_DIR=/app/certs
mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out    "$CERT_DIR/cert.pem" \
  -days 180 \
  -subj "/C=FR/O=Leavup/CN=backend" \
  -addext "subjectAltName=DNS:backend,IP:127.0.0.1" \
  2>/dev/null

echo "🔑  Certificat TLS interne généré (valide 180 jours)"

exec node src/index.js
