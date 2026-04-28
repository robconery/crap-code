/**
 * Thrown when Stripe webhook signature verification fails.
 *
 * The route handler catches this specifically to return HTTP 400 without
 * going through the normal Ping error path (the Ping may not yet exist).
 */
import { DomainError } from "./domain.error";

export class StripeVerificationError extends DomainError {}
