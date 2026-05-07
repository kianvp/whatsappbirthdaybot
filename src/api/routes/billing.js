import { Router } from 'express';
import Stripe from 'stripe';
import { requireAuth } from '../middleware/auth.js';

const PLANS = {
  pro: { priceId: process.env.STRIPE_PRO_PRICE_ID, name: 'Pro' },
  business: { priceId: process.env.STRIPE_BUSINESS_PRICE_ID, name: 'Business' },
};

export default function billingRoutes(db) {
  const router = Router();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Create Stripe Checkout session
  router.post('/checkout', requireAuth(db), async (req, res) => {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: { userId: String(req.user.id) },
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, req.user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: PLANS[plan].priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/dashboard.html?payment=success`,
      cancel_url: `${process.env.APP_URL}/dashboard.html?payment=cancelled`,
      subscription_data: {
        metadata: { userId: String(req.user.id), plan },
      },
    });

    res.json({ url: session.url });
  });

  // Stripe Customer Portal (manage/cancel subscription)
  router.post('/portal', requireAuth(db), async (req, res) => {
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${process.env.APP_URL}/dashboard.html`,
    });
    res.json({ url: session.url });
  });

  // Stripe webhook — raw body required (mounted before express.json())
  router.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const getSubscription = async (subscriptionId) =>
      stripe.subscriptions.retrieve(subscriptionId);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const sub = await getSubscription(session.subscription);
          const plan = sub.metadata?.plan || 'pro';
          const userId = sub.metadata?.userId;
          if (userId) {
            db.prepare(`
              UPDATE users SET
                plan = ?,
                stripe_subscription_id = ?,
                subscription_status = 'active',
                subscription_ends_at = ?
              WHERE id = ?
            `).run(plan, sub.id, sub.current_period_end, userId);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        const plan = sub.metadata?.plan || 'pro';
        if (userId) {
          db.prepare(`
            UPDATE users SET
              plan = ?,
              subscription_status = ?,
              subscription_ends_at = ?
            WHERE id = ?
          `).run(
            sub.status === 'active' ? plan : 'free',
            sub.status,
            sub.current_period_end,
            userId
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (userId) {
          db.prepare(`
            UPDATE users SET plan = 'free', subscription_status = 'cancelled', stripe_subscription_id = NULL
            WHERE id = ?
          `).run(userId);
        }
        break;
      }
    }

    res.json({ received: true });
  });

  return router;
}
