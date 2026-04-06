import { vi } from 'vitest';

// Variables d'env nécessaires à l'app
process.env.NODE_ENV     = 'test';
process.env.JWT_SECRET   = 'test_secret_key_32_chars_minimum!!';
process.env.SUPER_PASSWORD = 'supertest';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes en hex valide
process.env.HMAC_KEY     = 'test_hmac_key';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.PLATFORM_DOMAIN = 'leavup.test';
