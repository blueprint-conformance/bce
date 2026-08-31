/**
 * Server-side billing. This file imports the payment SDK ON PURPOSE and is CONFORMANT:
 * charging a card is exactly what the server package is for, and the secret key never
 * leaves this process.
 *
 * The constraint authored in the walkthrough is scoped to `packages/web/**` only, so this
 * import is out of scope and is never flagged. That narrowing is the point of the monorepo
 * first win — see ../../../README.md.
 */
import Stripe from 'stripe';

const client = new Stripe(process.env.PAYMENTS_SECRET_KEY ?? '');

export async function createCheckoutSession(cartId: string, amountCents: number) {
  return client.checkout.sessions.create({
    client_reference_id: cartId,
    line_items: [{ price_data: { unit_amount: amountCents } }],
  });
}
