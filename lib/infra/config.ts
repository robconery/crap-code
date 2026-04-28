/**
 * AppConfig — typed, validated configuration service.
 *
 * Reads all environment bindings and secrets at boot time and validates them
 * with zod. If any required value is missing the Worker throws immediately
 * (fail-fast) rather than surfacing a confusing runtime error mid-request.
 *
 * This is the ONLY place in the codebase that reads env vars or bindings.
 * Services receive only the slice of config they need via constructor injection.
 */
import { z } from "zod";

// Schema for all required environment bindings and secrets.
const configSchema = z.object({
  stripeWebhookSecret: z
    .string()
    .min(1, "STRIPE_WEBHOOK_SECRET is required — set it as a Wrangler secret"),
  stripeApiKey: z.string().min(1, "STRIPE_API_KEY is required — set it as a Wrangler secret"),
  resendApiKey: z.string().min(1, "RESEND_API_KEY is required — set it as a Wrangler secret"),
  firebaseServiceAccount: z
    .string()
    .min(1, "FIREBASE_SERVICE_ACCOUNT is required — JSON string of the service account"),
  // Bucket name is required separately so the Firebase adapter can be validated
  // at boot rather than failing silently on the first signed URL request.
  firebaseStorageBucket: z
    .string()
    .min(1, "FIREBASE_STORAGE_BUCKET is required — e.g. your-project.appspot.com"),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Builds and validates the typed AppConfig from the Worker env object.
 * Throws a descriptive zod error if any required secret is missing or empty.
 * Call once in the composition root and pass slices to individual services.
 */
export function createConfig(env: {
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_API_KEY: string;
  RESEND_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  FIREBASE_STORAGE_BUCKET: string;
}): AppConfig {
  const result = configSchema.safeParse({
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    stripeApiKey: env.STRIPE_API_KEY,
    resendApiKey: env.RESEND_API_KEY,
    firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT,
    firebaseStorageBucket: env.FIREBASE_STORAGE_BUCKET,
  });

  if (!result.success) {
    // Fail loudly at boot — a Worker that starts without required config
    // will fail on every request, which is harder to diagnose than a boot error.
    throw new Error(`Config validation failed:\n${result.error.message}`);
  }

  return result.data;
}
