/**
 * Cloudflare Worker entry point.
 *
 * Deliberately thin: routes the single inbound fetch event to the webhook
 * handler. All business logic lives in /lib — this file is just the glue
 * between the Cloudflare runtime and the composition root.
 *
 * The correlation ID is set to a synthetic request id at entry since the
 * Stripe event id is not yet known before signature verification.
 */
import { createCompositionRoot } from "@/lib/composition-root";
import { handleWebhook } from "@/src/routes/webhook";

// Env declares all Cloudflare Worker bindings and secrets.
// Re-exported so lib/composition-root.ts can reference this type.
export interface Env {
  DATABASE: D1Database;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_API_KEY: string;
  RESEND_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  /** Firebase Storage bucket name (e.g. "bigmachine-files.appspot.com") */
  FIREBASE_STORAGE_BUCKET: string;
}

export default {
  /**
   * The single entry point for all inbound requests.
   * Only POST /webhook is handled — everything else returns 404.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook") {
      // Correlation id is synthetic at route entry (event id not yet known).
      const correlationId = `req-${Date.now()}`;
      const { webhookDeps } = createCompositionRoot(env, correlationId);
      return handleWebhook(request, webhookDeps);
    }

    return new Response("Not found", { status: 404 });
  },
};
