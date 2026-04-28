/**
 * Thrown when subscription processing fails — e.g. an update or cancellation
 * event arrives for a stripe_subscription_id that does not exist locally.
 *
 * Per Story 7 AC5: this must NOT be silently swallowed. The handler catches
 * it to produce a non-2xx response and log the failure.
 */
import { DomainError } from "./domain.error";

export class SubscriptionError extends DomainError {}
