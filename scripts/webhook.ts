// pnpm paypal:webhook <public-url>: registers <public-url>/api/paypal/webhook with PayPal for this
// build's event types and prints the webhook id. Run after deploying; set PAYPAL_WEBHOOK_ID to the id.
import './env';
import { runWith } from '../lib/context';
import { createWebhook, deleteWebhook, listWebhooks, WEBHOOK_EVENTS } from '../lib/paypal';
import { setDoc } from '../lib/store';

async function main() {
  const base = process.argv[2];
  if (!base || !/^https:\/\//.test(base)) {
    console.error('Usage: pnpm paypal:webhook https://your-deployment.example');
    process.exit(1);
  }
  const url = `${base.replace(/\/$/, '')}/api/paypal/webhook`;
  await runWith({ sid: 'webhook-setup', mode: 'live', feature: 'Webhook setup' }, async () => {
    const existing = (await listWebhooks()).webhooks ?? [];
    for (const hook of existing.filter((w) => w.url === url)) {
      await deleteWebhook(hook.id);
      console.log(`Removed the previous registration ${hook.id}`);
    }
    const hook = await createWebhook(url);
    await setDoc('webhook', { id: hook.id, url });
    console.log(`Registered ${url}`);
    console.log(`Events: ${WEBHOOK_EVENTS.join(', ')}`);
    console.log(`Webhook id: ${hook.id}`);
    console.log(`Set PAYPAL_WEBHOOK_ID=${hook.id} in the deployment's environment.`);
  });
}

main().catch((e) => {
  console.error('Webhook registration failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
