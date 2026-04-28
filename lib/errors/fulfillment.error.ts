/**
 * Thrown when order fulfillment fails at any stage after the Ping is saved.
 *
 * The outer catch in the route handler catches this (and any DomainError)
 * to set ping.status = 'error' before rethrowing for Cloudflare logs.
 */
import { DomainError } from "./domain.error";

export class FulfillmentError extends DomainError {}
