/**
 * Browser-side checkout.
 *
 * This file carries the seeded violation for the monorepo first win: the browser bundle
 * imports the payment SDK directly. The project's rule says the SDK is server-only —
 * see the walkthrough in ../../../README.md.
 */
import Stripe from 'stripe';

const client = new Stripe(process.env.PAYMENTS_SECRET_KEY ?? '');

export async function startCheckout(cartId: string, amountCents: number) {
  const session = await client.checkout.sessions.create({
    client_reference_id: cartId,
    line_items: [{ price_data: { unit_amount: amountCents } }],
  });
  window.location.assign(session.url);
}
