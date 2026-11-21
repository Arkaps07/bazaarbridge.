import crypto from 'crypto';
import { envConfig } from '../config/env';

/**
 * Deterministic HMAC-based 6-digit OTP derivation (v7.1/v7.2 locked contract).
 * ONLY used by:
 * 1) Group creation (to compute otp_hash stored in fulfilment_groups.otp_hash)
 * 2) GET /api/orders/:id (owning customer only, while undelivered, labelled SAMPLE DEMO OTP)
 * 3) GET /api/admin/groups/:id/demo-otp (admin only)
 * Raw codes NEVER enter outbox payloads, Kafka, logs, OpenSearch, or live-proof.
 */
export function deriveOtp(groupId: string, secret: string = envConfig.otpHashSecret): string {
  const raw = crypto.createHmac('sha256', secret).update(`otp:${groupId}`).digest('hex');
  const numeric = parseInt(raw.slice(0, 8), 16) % 1000000;
  return String(numeric).padStart(6, '0');
}

/**
 * Converts a submitted 6-digit OTP code into its non-reversible HMAC proof.
 * Only this proof travels in outbox payloads, Kafka messages, and live-proof.
 */
export function hashOtpSubmission(code: string, secret: string = envConfig.otpHashSecret): string {
  return crypto.createHmac('sha256', secret).update(`hash:${code.trim()}`).digest('hex');
}

export function computeGroupOtpHash(groupId: string, secret: string = envConfig.otpHashSecret): string {
  return hashOtpSubmission(deriveOtp(groupId, secret), secret);
}

/**
 * Constant-time comparison of submitted proof against stored fulfilment_groups.otp_hash.
 * Never derives or inspects a raw OTP code inside the consumer.
 */
export function verifyOtpProofConstantTime(expectedHash: string, submittedProof: string): boolean {
  if (!expectedHash || !submittedProof || expectedHash.length !== submittedProof.length) {
    return false;
  }
  const a = Buffer.from(expectedHash, 'utf8');
  const b = Buffer.from(submittedProof, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Helper to generate a deterministic wrong OTP for the simulator's "Deliver - Wrong OTP" button.
 */
export function computeWrongOtp(correctCode: string): string {
  const wrong = (parseInt(correctCode, 10) + 1) % 1000000;
  return String(wrong).padStart(6, '0');
}
