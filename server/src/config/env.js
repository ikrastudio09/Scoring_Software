// Central configuration. Every environment variable the server reads is listed here.

const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

export const config = {
  env: NODE_ENV,
  isProd,
  isTest: NODE_ENV === 'test',
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cricket',
  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '14h',
  corsOrigins: list(process.env.CORS_ORIGINS),
  trustProxy: int(process.env.TRUST_PROXY, isProd ? 1 : 0),
  logLevel: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  serveStatic: bool(process.env.SERVE_STATIC, true),
  bootstrapAdmin: {
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
  rateLimit: {
    loginPerMinute: int(process.env.RATE_LIMIT_LOGIN_PER_MIN, 10),
    publicPerMinute: int(process.env.RATE_LIMIT_PUBLIC_PER_MIN, 600),
  },
};

export function assertProductionConfig() {
  if (!config.isProd) return;
  const problems = [];
  if (!config.jwtSecret || config.jwtSecret.length < 32) problems.push('JWT_SECRET must be set (≥ 32 chars)');
  if (!process.env.MONGODB_URI) problems.push('MONGODB_URI must be set');
  if (problems.length) throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
}
