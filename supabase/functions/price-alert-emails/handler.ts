type Job = {
  notification_id: string;
  lease_id: string;
  recipient: string;
  item_name: string;
  price: number;
  target_price: number;
  direction: 'increase' | 'decrease' | null;
  item_img: string | null;
};

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function createPriceAlertEmail(job: Job) {
  const label = job.direction === 'increase' ? 'Price increase' : job.direction === 'decrease' ? 'Price decrease' : 'Price alert';
  const price = `$${Number(job.price).toFixed(2)}`;
  const target = `$${Number(job.target_price).toFixed(2)}`;
  let image = '';
  try {
    const url = new URL(job.item_img ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password) {
      image = `<img src="${escapeHtml(url.href)}" alt="${escapeHtml(job.item_name)}" width="320" style="display:block;width:100%;max-width:320px;height:auto;margin:24px 0;" />`;
    }
  } catch { /* Items without a valid image still receive their price alert. */ }
  return {
    subject: `Keepers ${label.toLowerCase()}: your target was reached`,
    text: `${label}: ${job.item_name} is now ${price} in the Keepers catalog.\n` +
      `Your target was ${target}.\n`,
    html: '<!doctype html><html lang="en"><head><meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" /></head>' +
      '<body style="margin:0;padding:24px;background:#ffffff;color:#18211e;font-family:Arial,sans-serif;">' +
      '<main style="max-width:560px;margin:0 auto;line-height:1.6;">' +
      `<h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;">${label}</h1>` +
      `<p>${escapeHtml(job.item_name)} is now <strong>${price}</strong> in the Keepers catalog.</p>` +
      `<p>Your target was ${target}.</p>${image}</main></body></html>`,
  };
}

export function createHandler(env: (name: string) => string | undefined, request = fetch) {
  return async (incoming: Request): Promise<Response> => {
    // Supabase injects the project's named API keys. Fail closed if unavailable.
    let serviceKey: unknown;
    try {
      serviceKey = JSON.parse(env('SUPABASE_SECRET_KEYS') ?? '{}')?.default;
    } catch {
      return new Response('Secret key configuration is unavailable', { status: 503 });
    }
    if (typeof serviceKey !== 'string' || !serviceKey.startsWith('sb_secret_')) {
      return new Response('Secret key configuration is unavailable', { status: 503 });
    }
    // Secret keys are not JWTs: authenticate here, with the platform JWT check disabled.
    if (incoming.headers.get('apikey') !== serviceKey) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (incoming.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const url = env('SUPABASE_URL');
    const resendKey = env('RESEND_API_KEY');
    const from = env('PRICE_ALERT_EMAIL_FROM');
    if (!url || !resendKey || !from) {
      // Do not claim jobs until the provider is configured.
      return new Response('Email provider is not configured', { status: 503 });
    }
    const rpc = async (name: string, body: unknown) => {
      const response = await request(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Queue operation failed');
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };
    try {
      const jobs: Job[] = await rpc('claim_price_alert_emails', {});
      let sent = 0;
      for (const job of jobs) {
        if (!await rpc('price_alert_email_allowed', {
          p_notification_id: job.notification_id, p_lease_id: job.lease_id,
        })) continue;
        let error: string | null = null;
        try {
          const response = await request('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json',
              'Idempotency-Key': `price-alert/${job.notification_id}`,
            },
            body: JSON.stringify({
              from, to: [job.recipient], ...createPriceAlertEmail(job),
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) error = `provider_http_${response.status}`;
          else if (!(await response.json()).id) error = 'provider_invalid_response';
        } catch {
          error = 'provider_request_failed';
        }
        await rpc('finish_price_alert_email', {
          p_notification_id: job.notification_id, p_lease_id: job.lease_id, p_error: error,
        });
        if (error === null) sent++;
      }
      return Response.json({ processed: jobs.length, sent });
    } catch {
      // Failed leases become eligible again after five minutes. Never expose provider errors/PII.
      console.error('Price alert email queue operation failed');
      return new Response('Queue operation failed', { status: 500 });
    }
  };
}
