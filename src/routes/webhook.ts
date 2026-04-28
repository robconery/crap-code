/**
 * POST /webhook — the single inbound Stripe webhook route handler.
 *
 * Deliberately thin: no business logic lives here. This file is responsible for:
 *   1. Extracting the raw body as a string (preserving bytes for HMAC)
 *   2. Calling StripeVerifierAdapter.verify() — returns 400 on failure (AC 1.2)
 *   3. Parsing the event with the Zod discriminated union schema
 *   4. Calling SavePingCommand BEFORE the outer try/catch (ADR-003)
 *   5. Dispatching to WebhookRouter inside the outer try/catch
 *   6. Returning 200 on success
 *
 * The outer catch logs the error and rethrows — Cloudflare's error boundary
 * handles the unhandled rejection and logs it to the Workers log tail.
 */
import { stripeWebhookEventSchema } from "@/lib/contracts/stripe-webhook.schema";
import { StripeVerificationError } from "@/lib/errors/stripe-verification.error";
import type { Logger } from "@/lib/infra/logger";
import type { StripeVerifierAdapter } from "@/lib/infra/stripe/stripe-verifier.adapter";
import type { SavePingCommand } from "@/lib/ping/save-ping.command";
import type { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import type { WebhookRouter } from "@/lib/webhooks/webhook-router";

export interface WebhookHandlerDeps {
  verifier: StripeVerifierAdapter;
  savePing: SavePingCommand;
  updatePingStatus: UpdatePingStatusCommand;
  router: WebhookRouter;
  logger: Logger;
}

/**
 * Handles POST /webhook.
 * Returns 400 on bad signature, 200 on all other outcomes (success or handled error).
 * Rethrows unhandled errors so Cloudflare logs them and returns 500.
 */
export async function handleWebhook(request: Request, deps: WebhookHandlerDeps): Promise<Response> {
  const { verifier, savePing, updatePingStatus, router, logger } = deps;

  // Read the raw body exactly once as a string — re-parsing would alter bytes
  // and break the HMAC signature check (AC 1.3).
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature") ?? "";

  logger.info("webhook.received", { path: "/webhook" });

  // ─── Step 1: Verify Stripe signature ────────────────────────────────────
  let stripeEvent: Awaited<ReturnType<typeof verifier.verify>>;
  try {
    stripeEvent = await verifier.verify(rawBody, signatureHeader);
  } catch (err: unknown) {
    if (err instanceof StripeVerificationError) {
      // Bad or missing signature — return 400 without processing (AC 1.2).
      logger.warn("webhook.bad-signature", { reason: err.message });
      return new Response("Bad signature", { status: 400 });
    }
    throw err;
  }

  // ─── Step 2: Parse into domain event type ───────────────────────────────
  const parsed = stripeWebhookEventSchema.safeParse(stripeEvent);

  if (!parsed.success) {
    // Unrecognised event type — log and 200 so Stripe doesn't retry.
    logger.warn("webhook.unhandled-event-type", {
      eventType: (stripeEvent as { type?: string }).type ?? "unknown",
    });
    return new Response("ok", { status: 200 });
  }

  const event = parsed.data;

  // ─── Step 3: Save Ping BEFORE try/catch (ADR-003) ───────────────────────
  // Audits every processed event regardless of downstream failure.
  // If SavePingCommand throws, the error escapes the handler — no catch here.
  const { ping, shouldSkip } = await savePing.execute({
    stripeEventId: event.id,
    eventType: event.type,
    rawPayload: rawBody,
  });

  if (shouldSkip) {
    logger.info("webhook.skipped-duplicate", { stripeEventId: event.id, pingId: ping.id });
    return new Response("ok", { status: 200 });
  }

  // ─── Step 4: Dispatch to handler strategy ───────────────────────────────
  try {
    await router.dispatch(event, ping.id);
  } catch (err: unknown) {
    // Best-effort Ping → error transition. The handler may have already done this;
    // the command is idempotent and safe to call twice.
    await updatePingStatus.execute({ pingId: ping.id, status: "error" }).catch(() => {});

    logger.error("webhook.processing-failed", {
      stripeEventId: event.id,
      pingId: ping.id,
      reason: err instanceof Error ? err.message : String(err),
    });

    // Rethrow so Cloudflare logs the raw error in the Workers log tail.
    throw err;
  }

  logger.info("webhook.ok", { stripeEventId: event.id, pingId: ping.id });
  return new Response("ok", { status: 200 });
}
