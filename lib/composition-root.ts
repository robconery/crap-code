import { SendFulfillmentEmailCommand } from "@/lib/email/send-fulfillment-email.command";
import { createDb } from "@/lib/infra/db/client";
import { ResendEmailAdapter } from "@/lib/infra/email/resend-email.adapter";
import { Logger } from "@/lib/infra/logger";
import { FirebaseFileStorageAdapter } from "@/lib/infra/storage/firebase-file-storage.adapter";
import { StripeVerifierAdapter } from "@/lib/infra/stripe/stripe-verifier.adapter";
import { FulfillOrderCommand } from "@/lib/orders/fulfill-order.command";
import { SavePingCommand } from "@/lib/ping/save-ping.command";
import { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import { UpdateSubscriptionStatusCommand } from "@/lib/subscriptions/update-subscription-status.command";
import { UpsertSubscriptionCommand } from "@/lib/subscriptions/upsert-subscription.command";
import { UpsertUserCommand } from "@/lib/users/upsert-user.command";
import { OrderWebhookHandler } from "@/lib/webhooks/handlers/order-webhook.handler";
import { SubscriptionChangeHandler } from "@/lib/webhooks/handlers/subscription-change.handler";
import { SubscriptionPaymentHandler } from "@/lib/webhooks/handlers/subscription-payment.handler";
import type { WebhookHandler } from "@/lib/webhooks/webhook-handler.types";
import { WebhookRouter } from "@/lib/webhooks/webhook-router";
/**
 * Composition Root — the single place where all concrete adapter and command
 * instances are created and wired together.
 *
 * Why a single composition root: dependency injection without a framework.
 * Having one place that builds the entire object graph means:
 *  - Only this file imports concrete adapter classes.
 *  - Domain classes (commands, handlers, router) remain decoupled from infra.
 *  - Swapping an adapter (e.g. Resend → SES) is a single-file change.
 *
 * This function is called once per request — Cloudflare Workers are
 * stateless; there is no long-lived container.
 */
import type { Env } from "@/src/index";
import type { WebhookHandlerDeps } from "@/src/routes/webhook";

export interface CompositionRoot {
  /** The fully wired deps object for the webhook route handler. */
  webhookDeps: WebhookHandlerDeps;
}

/**
 * Builds the full dependency graph for one request.
 *
 * @param env - Cloudflare Worker environment bindings (D1, secrets)
 * @param correlationId - Stripe event id (or a generated id at route entry).
 *   Threaded through every logger instance for log correlation.
 */
export function createCompositionRoot(env: Env, correlationId: string): CompositionRoot {
  // One logger per request — correlation id comes from the Stripe event id
  // (available after signature verification) or a synthetic id before that.
  const logger = new Logger(correlationId);

  // ─── Infra layer (adapters) ──────────────────────────────────────────────
  const db = createDb(env.DATABASE);
  const emailSender = new ResendEmailAdapter(env.RESEND_API_KEY, logger);
  const fileStorage = new FirebaseFileStorageAdapter(
    env.FIREBASE_SERVICE_ACCOUNT,
    env.FIREBASE_STORAGE_BUCKET,
    logger
  );
  const verifier = new StripeVerifierAdapter(env.STRIPE_API_KEY, env.STRIPE_WEBHOOK_SECRET, logger);

  // ─── Ping commands ───────────────────────────────────────────────────────
  const savePing = new SavePingCommand(db, logger);
  const updatePingStatus = new UpdatePingStatusCommand(db, logger);

  // ─── User commands ───────────────────────────────────────────────────────
  const upsertUser = new UpsertUserCommand(db, logger);

  // ─── Order commands ──────────────────────────────────────────────────────
  const fulfillOrder = new FulfillOrderCommand(db, logger);
  const sendEmail = new SendFulfillmentEmailCommand(fileStorage, emailSender, logger);

  // ─── Subscription commands ───────────────────────────────────────────────
  const upsertSubscription = new UpsertSubscriptionCommand(db, logger);
  const updateSubscriptionStatus = new UpdateSubscriptionStatusCommand(db, logger);

  // ─── Webhook handlers (Strategy pattern — ADR-001) ───────────────────────
  const orderHandler = new OrderWebhookHandler(
    { fulfillOrder, sendEmail, updatePingStatus },
    logger
  );

  const subscriptionPaymentHandler = new SubscriptionPaymentHandler(
    { upsertUser, upsertSubscription, updateSubscriptionStatus, updatePingStatus },
    logger
  );

  const subscriptionChangeHandler = new SubscriptionChangeHandler(
    { updateSubscriptionStatus, updatePingStatus },
    logger
  );

  // Router map: event type → handler. Adding a new event = adding one entry here.
  const handlerMap = new Map<string, WebhookHandler>([
    ["checkout.session.completed", orderHandler],
    ["invoice.payment_succeeded", subscriptionPaymentHandler],
    ["customer.subscription.deleted", subscriptionChangeHandler],
    ["customer.subscription.updated", subscriptionChangeHandler],
  ]);

  const router = new WebhookRouter(handlerMap, logger);

  return {
    webhookDeps: { verifier, savePing, updatePingStatus, router, logger },
  };
}
