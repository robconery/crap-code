# Stripe Webhook Receiver

This project is a Stripe order receiver that handles digital fulfillment of a downloadable product purchase.

## The Stack

- This will be a Cloudflare worker on the free tier.
- Local development uses SQLite, production uses Cloudflare D1. Use Drizzle as the ORM.
- The run time is Bun with built in testing.
- File storage is at Firebase
- I don't sell products, I sell offers. One order = one offer with either course access or downloadable items.

## Architectural Guidelines

- No repositories
- Use Command/Query separation, with commands encapsulating one or more writes in a transaction, Queries returning data as needed.
- Use of SOLID principles is mandatatory, with particular emphasis on SRP. One class = one job = one reason to change.
- User Stories are required
- Testing is behavior-driven design based on user stories.
- All logic lives in service classes in `/lib`.
- All testing lives in the `/tests` directory.

## The Flow

The application will receive webhooks from Stripe for payments for both orders and subscriptions.

### Order Fulfillment

An order will come in via Stripe webhook, and the flow looks like:

- Verify the order is valid (using Stripe verification).
- Log the incoming order with the order number to the console so it's picked up by Cloudflare.
- Save the raw JSON order as a webhook `ping`, with a status of `received`.
- Assign an order number using the last 8 digits of the Stripe order with a "BIGZ-" prefix.
- Create an `Order` using the schema in data/order.json.
- Create an `Authorization` using the schema in `data/authorization.json`.
- Create a `FullfilmentOrder` using shema in `data/fulfillment.json`.
- Create `User` record using `name` and `email`.
- Open a transaction, add the `order`, `authorization`, `fulfillment`, and `user` in one go and then commit the transaction.
- Update the `ping` to `fulfilled` status.
- For every downloadable item on the `offer`, create an expiring firebase storage link (2 hours) but DO NOT SAVE IT. It shold be used for the email in the next step.
- Send an email to the `user` using the template in `data/new_order_email.html`. Send from `rob@bigmachine.io`. I will be using Resend for this so set up whatever mailing package is needed.
- Update the `ping` to `closed` status.

If an order exists already, update its existing properties using an upsert. Fulfill the order by deleting existing authorization and fulfillment records, and rebuilding them.

Upsert conflicting customer records.

### Subscription Fulfillment

When a `payment` is received for a `subscription` invoice:

- Create a `user` record if none exists, storing the `stripe_customer_id` and `email`.
- Create a `subscription` record if none exists, relating it to the `user`.
- The Stripe API will be used for all `subscription` information, so only store what is required for authorizing `user` access at the application level.

When a `subscription` is changed (canceled, updated, renewed), update the `subscription` record.


## Errors

When an error happens in the process:

- It should NEVER be swallowed by a `try`/`catch` anywhere. An outer `try`/`catch` must be used, but when the error handling process is done, the error should be rethrown so it's picked up by the logs.
- Update the `ping` to `error` status if possible. That means the `ping` save event must happen before *any* `try`/`catch` block.
