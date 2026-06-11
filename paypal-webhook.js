/**
 * api/paypal-webhook.js — Vercel Edge Function
 *
 * Receives PayPal webhook events, verifies the signature with PayPal's API,
 * then updates the Supabase purchase record accordingly.
 *
 * Register this URL in PayPal Developer Dashboard:
 *   https://your-project.vercel.app/api/paypal-webhook
 *
 * Subscribe to these events:
 *   PAYMENT.CAPTURE.COMPLETED   — double-confirms a payment
 *   PAYMENT.CAPTURE.REFUNDED    — marks purchase refunded
 *   PAYMENT.CAPTURE.REVERSED    — marks purchase reversed (chargeback)
 *   PAYMENT.CAPTURE.DENIED      — logs failed captures
 *
 * Env vars (same as verify-order.js plus):
 *   PAYPAL_WEBHOOK_ID  — copy from PayPal Dashboard after registering the webhook URL
 */

export const config = { runtime: "edge" };

// ─── PayPal helpers ───────────────────────────────────────────────────────────
async function getPayPalAccessToken() {
  const credentials = btoa(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  );
  const res = await fetch(`${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization:  `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token failed: ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

/**
 * Verify the webhook signature using PayPal's verify-webhook-signature API.
 * This is the ONLY way to confirm a webhook truly came from PayPal.
 * https://developer.paypal.com/api/rest/webhooks/
 */
async function verifyPayPalSignature({
  authAlgo, certUrl, transmissionId,
  transmissionSig, transmissionTime,
  webhookEvent,
}) {
  const accessToken = await getPayPalAccessToken();

  const res = await fetch(
    `${process.env.PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo:         authAlgo,
        cert_url:          certUrl,
        transmission_id:   transmissionId,
        transmission_sig:  transmissionSig,
        transmission_time: transmissionTime,
        webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
        webhook_event:     webhookEvent,
      }),
    }
  );

  if (!res.ok) throw new Error(`Signature verify request failed: ${res.status}`);
  const { verification_status } = await res.json();
  return verification_status === "SUCCESS";
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
function sbHeaders() {
  return {
    apikey:         process.env.SUPABASE_SERVICE_KEY,
    Authorization:  `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer:         "return=minimal",
  };
}

async function updatePurchaseByCaptureId(captureId, update) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/purchases?capture_id=eq.${encodeURIComponent(captureId)}`;
  const res = await fetch(url, {
    method:  "PATCH",
    headers: sbHeaders(),
    body:    JSON.stringify(update),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase PATCH failed ${res.status}: ${err}`);
  }
}

async function updatePurchaseByOrderId(orderId, update) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/purchases?order_id=eq.${encodeURIComponent(orderId)}`;
  const res = await fetch(url, {
    method:  "PATCH",
    headers: sbHeaders(),
    body:    JSON.stringify(update),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase PATCH by orderId failed ${res.status}: ${err}`);
  }
}

async function logWebhookEvent(record) {
  // Fire-and-forget — never fail the main handler because of logging
  fetch(`${process.env.SUPABASE_URL}/rest/v1/webhook_events`, {
    method:  "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body:    JSON.stringify(record),
  }).catch(e => console.error("[webhook] log failed:", e.message));
}

// ─── Event handlers ───────────────────────────────────────────────────────────
async function handleCaptureCompleted(resource, eventId) {
  const captureId = resource.id;
  const orderId   = resource.supplementary_data?.related_ids?.order_id || null;
  const amount    = parseFloat(resource.amount?.value || "0");

  await logWebhookEvent({
    event_id:   eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    capture_id: captureId,
    order_id:   orderId,
    amount,
    raw:        resource,
    created_at: new Date().toISOString(),
  });

  // Mark purchase as webhook-confirmed in Supabase
  if (captureId) {
    await updatePurchaseByCaptureId(captureId, {
      webhook_confirmed:    true,
      webhook_confirmed_at: new Date().toISOString(),
      status:               "webhook_confirmed",
    });
  } else if (orderId) {
    await updatePurchaseByOrderId(orderId, {
      webhook_confirmed:    true,
      webhook_confirmed_at: new Date().toISOString(),
      status:               "webhook_confirmed",
    });
  }

  console.log(`[webhook] ✓ Capture confirmed: ${captureId}`);
}

async function handleCaptureRefunded(resource, eventId) {
  // resource here is the refund object; original capture is in links
  const refundId  = resource.id;
  const captureId = resource.links?.find(l => l.rel === "up")?.href?.split("/").pop() || null;

  await logWebhookEvent({
    event_id:   eventId,
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    capture_id: captureId,
    refund_id:  refundId,
    amount:     parseFloat(resource.amount?.value || "0"),
    raw:        resource,
    created_at: new Date().toISOString(),
  });

  if (captureId) {
    await updatePurchaseByCaptureId(captureId, {
      status:      "refunded",
      refund_id:   refundId,
      refunded_at: new Date().toISOString(),
    });
  }

  console.log(`[webhook] ↩ Refund recorded: refund ${refundId} for capture ${captureId}`);
}

async function handleCaptureReversed(resource, eventId) {
  const captureId = resource.id;

  await logWebhookEvent({
    event_id:   eventId,
    event_type: "PAYMENT.CAPTURE.REVERSED",
    capture_id: captureId,
    raw:        resource,
    created_at: new Date().toISOString(),
  });

  if (captureId) {
    await updatePurchaseByCaptureId(captureId, {
      status:      "reversed",
      reversed_at: new Date().toISOString(),
    });
  }

  console.log(`[webhook] ⚠ Capture reversed (chargeback?): ${captureId}`);
}

async function handleCaptureDenied(resource, eventId) {
  await logWebhookEvent({
    event_id:   eventId,
    event_type: "PAYMENT.CAPTURE.DENIED",
    capture_id: resource.id || null,
    raw:        resource,
    created_at: new Date().toISOString(),
  });
  console.log(`[webhook] ✗ Capture denied: ${resource.id}`);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // ── Verify PayPal signature ────────────────────────────────────────────────
  let signatureValid = false;
  try {
    signatureValid = await verifyPayPalSignature({
      authAlgo:        req.headers.get("paypal-auth-algo"),
      certUrl:         req.headers.get("paypal-cert-url"),
      transmissionId:  req.headers.get("paypal-transmission-id"),
      transmissionSig: req.headers.get("paypal-transmission-sig"),
      transmissionTime:req.headers.get("paypal-transmission-time"),
      webhookEvent:    event,
    });
  } catch (e) {
    console.error("[webhook] Signature verification error:", e.message);
    // If PayPal's own API is down for verification, we log and accept rather
    // than reject — PayPal recommends this to avoid missed events.
    // In production you may want to quarantine these for manual review.
    signatureValid = false;
  }

  if (!signatureValid) {
    console.warn(`[webhook] ✗ Invalid signature for event ${event.id}`);
    // Return 200 to prevent PayPal retrying (it's likely not from PayPal)
    return new Response(
      JSON.stringify({ received: true, verified: false }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const eventType = event.event_type;
  const resource  = event.resource || {};
  const eventId   = event.id;

  console.log(`[webhook] Received verified event: ${eventType} (${eventId})`);

  try {
    switch (eventType) {
      case "PAYMENT.CAPTURE.COMPLETED":
        await handleCaptureCompleted(resource, eventId);
        break;
      case "PAYMENT.CAPTURE.REFUNDED":
        await handleCaptureRefunded(resource, eventId);
        break;
      case "PAYMENT.CAPTURE.REVERSED":
        await handleCaptureReversed(resource, eventId);
        break;
      case "PAYMENT.CAPTURE.DENIED":
        await handleCaptureDenied(resource, eventId);
        break;
      default:
        console.log(`[webhook] Unhandled event type: ${eventType} — logging only`);
        await logWebhookEvent({
          event_id:   eventId,
          event_type: eventType,
          raw:        resource,
          created_at: new Date().toISOString(),
        });
    }
  } catch (err) {
    console.error(`[webhook] Error processing ${eventType}:`, err.message);
    // Always return 200 to PayPal — otherwise it retries for 3 days.
    // Errors are logged in Supabase / Vercel logs for manual resolution.
  }

  return new Response(
    JSON.stringify({ received: true, verified: true, eventType }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
