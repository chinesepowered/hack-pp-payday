import { runWith } from '@/lib/context';
import { mutate, refreshPayouts, syncItem } from '@/lib/flows';
import { verifyWebhookSignature } from '@/lib/paypal';
import { getDoc } from '@/lib/store';

type Event = { id: string; event_type: string; resource?: { payout_item_id?: string; batch_header?: { payout_batch_id?: string } } };

// POST /api/paypal/webhook: PayPal payout events. The signature is verified with
// POST /v1/notifications/verify-webhook-signature, and each event id is processed once. The app
// also polls PayPal, so nothing here is required for the screens to be correct.
export async function POST(req: Request) {
  const raw = await req.text();
  return runWith({ sid: 'webhook', mode: 'live', feature: 'Webhook' }, async () => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? (await getDoc<{ id: string }>('webhook'))?.id;
    if (!webhookId) return Response.json({ error: 'No webhook id is configured. Run pnpm paypal:webhook <public-url>.' }, { status: 503 });
    let event: Event;
    try {
      event = JSON.parse(raw) as Event;
    } catch {
      return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
    }
    const verified = await verifyWebhookSignature(req.headers, raw, webhookId).catch(() => false);
    if (!verified) return Response.json({ error: 'Signature verification failed.' }, { status: 400 });

    const fresh = await mutate((state) => {
      if (state.webhookEvents.includes(event.id)) return false;
      state.webhookEvents = [...state.webhookEvents, event.id].slice(-500);
      return true;
    });
    if (!fresh) return Response.json({ ok: true, duplicate: true });

    // Handlers re-read the resource from PayPal instead of trusting the payload, which also makes
    // them safe to run twice.
    if (event.event_type.startsWith('PAYMENT.PAYOUTS-ITEM.') && event.resource?.payout_item_id) await syncItem(event.resource.payout_item_id);
    else if (event.event_type.startsWith('PAYMENT.PAYOUTSBATCH.')) await refreshPayouts({ all: true });
    return Response.json({ ok: true, handled: event.event_type });
  });
}
