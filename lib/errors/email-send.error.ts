/**
 * Thrown when the fulfillment email fails to send via Resend.
 *
 * Kept separate from FulfillmentError so callers can distinguish between
 * a DB write failure and an email delivery failure in logs and future
 * retry logic without touching the fulfillment path.
 */
import { DomainError } from "./domain.error";

export class EmailSendError extends DomainError {}
