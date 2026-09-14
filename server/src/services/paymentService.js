import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { forbidden } from '../utils/errors.js';

const activeEvents = new Set([
  'PURCHASE_APPROVED',
  'PURCHASE_COMPLETE',
  'PURCHASE_COMPLETED',
  'SUBSCRIPTION_REACTIVATED'
]);

const inactiveEvents = new Set([
  'PURCHASE_CANCELED',
  'PURCHASE_CANCELLED',
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'SUBSCRIPTION_CANCELLATION',
  'SUBSCRIPTION_CANCELED',
  'SUBSCRIPTION_CANCELLED'
]);

function findBuyerEmail(payload) {
  return (
    payload?.data?.buyer?.email ||
    payload?.data?.shopper?.email ||
    payload?.data?.subscriber?.email ||
    payload?.buyer?.email ||
    payload?.shopper?.email ||
    payload?.email ||
    payload?.Email ||
    null
  );
}

function normalizeEvent(payload) {
  const eventName = String(payload?.event || payload?.status || payload?.Status || 'UNKNOWN').toUpperCase();
  const providerEventId = String(
    payload?.id ||
      payload?.data?.purchase?.transaction ||
      payload?.transaction ||
      payload?.Transaction ||
      `${eventName}-${Date.now()}`
  );
  const status = String(payload?.data?.purchase?.status || payload?.status || payload?.Status || eventName).toUpperCase();
  const buyerEmail = findBuyerEmail(payload)?.toLowerCase() || null;
  const subscriptionCode =
    payload?.data?.subscriber?.code ||
    payload?.data?.subscription?.subscriber_code ||
    payload?.Subscriber_code ||
    null;

  return { eventName, providerEventId, status, buyerEmail, subscriptionCode };
}

export async function processHotmartWebhook(headers, payload) {
  const receivedHottok = headers['x-hotmart-hottok'];
  if (env.hotmartHottok && receivedHottok !== env.hotmartHottok) {
    throw forbidden('Webhook Hotmart com Hottok invalido.');
  }

  const normalized = normalizeEvent(payload);

  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO payment_events (provider, provider_event_id, event_name, buyer_email, status, payload)
       VALUES ('hotmart', $1, $2, $3, $4, $5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        normalized.providerEventId,
        normalized.eventName,
        normalized.buyerEmail,
        normalized.status,
        JSON.stringify(payload)
      ]
    );

    if (inserted.rowCount === 0) {
      return { processed: false, reason: 'duplicate', ...normalized };
    }

    if (!normalized.buyerEmail) {
      return { processed: true, matchedTrainer: false, reason: 'missing_buyer_email', ...normalized };
    }

    const trainer = await client.query(
      `SELECT id FROM users
       WHERE role = 'personal'
         AND lower(email) = lower($1)`,
      [normalized.buyerEmail]
    );

    if (trainer.rowCount === 0) {
      return { processed: true, matchedTrainer: false, reason: 'trainer_not_found', ...normalized };
    }

    const trainerId = trainer.rows[0].id;
    const isActive = activeEvents.has(normalized.eventName) || ['APPROVED', 'COMPLETED'].includes(normalized.status);
    const isInactive = inactiveEvents.has(normalized.eventName) || ['CANCELED', 'CANCELLED', 'REFUNDED', 'CHARGEBACK'].includes(normalized.status);

    if (isActive) {
      await client.query(
        `INSERT INTO trainer_billing
          (trainer_id, free_student_limit, paid_student_limit, status, hotmart_subscription_code, hotmart_buyer_email)
         VALUES ($1, $2, $3, 'active', $4, $5)
         ON CONFLICT (trainer_id)
         DO UPDATE SET
          paid_student_limit = EXCLUDED.paid_student_limit,
          status = 'active',
          hotmart_subscription_code = EXCLUDED.hotmart_subscription_code,
          hotmart_buyer_email = EXCLUDED.hotmart_buyer_email`,
        [
          trainerId,
          env.maxFreeStudents,
          env.hotmartPaidStudentLimit,
          normalized.subscriptionCode,
          normalized.buyerEmail
        ]
      );
    }

    if (isInactive) {
      const status = normalized.eventName.includes('REFUND')
        ? 'refunded'
        : normalized.eventName.includes('CHARGEBACK')
          ? 'chargeback'
          : 'canceled';
      await client.query(
        `UPDATE trainer_billing
         SET paid_student_limit = 0, status = $2
         WHERE trainer_id = $1`,
        [trainerId, status]
      );
    }

    return { processed: true, matchedTrainer: true, trainerId, ...normalized };
  });
}
