/**
 * Zod schemas for every Stripe webhook event type this system handles.
 *
 * All incoming webhook bodies are parsed through these schemas at the route
 * layer before any data reaches lib/. Downstream code only sees validated,
 * typed domain inputs — never raw JSON.
 *
 * Inferred types from these schemas are the canonical types for the event
 * shapes throughout the codebase. No hand-written duplicate type declarations.
 */
import { z } from "zod";

// ─── Shared sub-schemas ────────────────────────────────────────────────────

const checkoutSessionSchema = z.object({
  id: z.string(),
  object: z.literal("checkout.session"),
  customer: z.string().nullable(),
  customer_email: z.string().nullable(),
  customer_details: z
    .object({
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .optional(),
  amount_total: z.number().nullable(),
  currency: z.string().nullable(),
  metadata: z
    .object({
      offer: z.string().optional(),
      store: z.string().optional(),
      slug: z.string().optional(),
    })
    .optional(),
});

const invoiceSchema = z.object({
  id: z.string(),
  object: z.literal("invoice"),
  customer: z.string(),
  customer_email: z.string().nullable(),
  customer_name: z.string().nullable().optional(),
  subscription: z.string().nullable(),
  // Distinguishes first payment from renewals — used by SubscriptionPaymentHandler.
  billing_reason: z.enum(["subscription_create", "subscription_cycle", "manual", "subscription"]),
  status: z.string().nullable(),
});

const subscriptionSchema = z.object({
  id: z.string(),
  object: z.literal("subscription"),
  customer: z.string(),
  status: z.string(),
});

// ─── Event schemas ─────────────────────────────────────────────────────────

export const checkoutSessionCompletedSchema = z.object({
  id: z.string(),
  type: z.literal("checkout.session.completed"),
  data: z.object({ object: checkoutSessionSchema }),
});

export const invoicePaymentSucceededSchema = z.object({
  id: z.string(),
  type: z.literal("invoice.payment_succeeded"),
  data: z.object({ object: invoiceSchema }),
});

export const subscriptionDeletedSchema = z.object({
  id: z.string(),
  type: z.literal("customer.subscription.deleted"),
  data: z.object({ object: subscriptionSchema }),
});

export const subscriptionUpdatedSchema = z.object({
  id: z.string(),
  type: z.literal("customer.subscription.updated"),
  data: z.object({ object: subscriptionSchema }),
});

// ─── Union of all handled events ──────────────────────────────────────────

/**
 * Discriminated union of every webhook event type this system handles.
 * The route handler parses the raw body against this schema after signature
 * verification. The `type` field is the discriminant.
 */
export const stripeWebhookEventSchema = z.discriminatedUnion("type", [
  checkoutSessionCompletedSchema,
  invoicePaymentSucceededSchema,
  subscriptionDeletedSchema,
  subscriptionUpdatedSchema,
]);

export type StripeWebhookEvent = z.infer<typeof stripeWebhookEventSchema>;
export type CheckoutSessionCompleted = z.infer<typeof checkoutSessionCompletedSchema>;
export type InvoicePaymentSucceeded = z.infer<typeof invoicePaymentSucceededSchema>;
export type SubscriptionDeleted = z.infer<typeof subscriptionDeletedSchema>;
export type SubscriptionUpdated = z.infer<typeof subscriptionUpdatedSchema>;

/**
 * Schema for the raw event envelope — used to extract the type field
 * before full parsing, so the router can decide which handler to invoke.
 */
export const rawEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
});
