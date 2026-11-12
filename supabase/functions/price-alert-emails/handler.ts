type Job = {
  notification_id: string;
  lease_id: string;
  recipient: string;
  item_name: string;
  price: number;
  target_price: number;
};

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
        let error: string | null = null;
        try {
          const response = await request('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json',
              'Idempotency-Key': `price-alert/${job.notification_id}`,
            },
            body: JSON.stringify({
              from, to: [job.recipient], subject: 'Keepers price alert: your target was reached',
              text: `${job.item_name} is now $${Number(job.price).toFixed(2)} in the Keepers catalog.\n` +
                `Your target was $${Number(job.target_price).toFixed(2)}.\n\n` +
                'Open Keepers to view your price alerts. Store prices may differ.\n',
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
