import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_FEATURE_FLAGS = [
  'FEATURE_COUPONS',
  'FEATURE_WISHLIST',
  'FEATURE_ALERTS',
  'FEATURE_ADDRESSES',
  'FEATURE_SAVE_LATER',
  'FEATURE_COMPARE',
  'FEATURE_ASSISTANT',
  'FEATURE_REVIEWS',
  'FEATURE_SUPPORT',
  'FEATURE_SIM_SCREENS',
];

// Ephemeral in-memory secrets when env vars are unset in local preview
const ephemeralJwtSecret = crypto.randomBytes(32).toString('hex');
const ephemeralOtpSecret = crypto.randomBytes(32).toString('hex');

export function getFeatureFlags(): Set<string> {
  const raw = process.env.FEATURE_FLAGS;
  if (raw === undefined) {
    return new Set(DEFAULT_FEATURE_FLAGS);
  }
  if (raw.trim() === '') {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isFeatureEnabled(flag: string): boolean {
  return getFeatureFlags().has(flag);
}

export const envConfig = {
  port: Number(process.env.PORT || 3000),
  frontendUrl: process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000',
  pgUri: process.env.PG_URI || '',
  kafkaBrokers: (process.env.KAFKA_BROKERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  kafkaSecurityProtocol: process.env.KAFKA_SECURITY_PROTOCOL || 'SASL_SSL',
  kafkaSaslMechanism: process.env.KAFKA_SASL_MECHANISM || 'SCRAM-SHA-256',
  kafkaSaslUsername: process.env.KAFKA_SASL_USERNAME || '',
  kafkaSaslPassword: process.env.KAFKA_SASL_PASSWORD || '',
  kafkaCaPath: process.env.KAFKA_CA_PATH || '',
  kafkaServiceCertPath: process.env.KAFKA_SERVICE_CERT_PATH || '',
  kafkaServiceKeyPath: process.env.KAFKA_SERVICE_KEY_PATH || '',
  openSearchUrl: process.env.OPENSEARCH_URL || '',
  openSearchUser: process.env.OPENSEARCH_USER || process.env.OPENSEARCH_USERNAME || '',
  openSearchPassword: process.env.OPENSEARCH_PASSWORD || '',
  jwtSecret: process.env.JWT_SECRET || ephemeralJwtSecret,
  otpHashSecret: process.env.OTP_HASH_SECRET || ephemeralOtpSecret,
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  get isPgConfigured() {
    return Boolean(this.pgUri);
  },
  get isKafkaConfigured() {
    return this.kafkaBrokers.length > 0;
  },
  get isOpenSearchConfigured() {
    return Boolean(this.openSearchUrl);
  },
  get isGeminiConfigured() {
    return Boolean(this.geminiApiKey && this.geminiApiKey !== 'MY_GEMINI_API_KEY');
  },
};
