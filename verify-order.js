/**
 * api/verify-order.js — Vercel Edge Function
 *
 * Called by the frontend AFTER PayPal client-side capture succeeds.
 * We re-verify the order server-side with PayPal's API, confirm the
 * amount matches the plan, write a purchase record to Supabase, and
 * only then return success so the frontend can unlock Pro.
 *
 * POST /api/verify-order
 * Body: { orderID: string, planId: "match"|"tournament", fingerprint: string }
 *
 * Env vars (set in Vercel dashboard → Settings → Environment Variables):
 *   PAYPAL_CLIENT_ID        from developer.paypal.com
 *   PAYPAL_CLIENT_SECRET    from developer.paypal.com
 *   PAYPAL_BASE_URL         https://api-m.sandbox.paypal.com  (sandbox)
 *                           https://api-m.paypal.com          (live)
 *   SUPABASE_URL            https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY    service_role key from Supabase → Settings → API
 *   ALLOWED_ORIGIN          your frontend URL e.g. https://fannav.vercel.app
 */

export const config = { runtime: "edge" };

// ─── Plan catalogue ────────────────────────────────────────────────────────────
const PLANS = {
  match:      { price: 9.00,  label: "Match Pass"      },
  tournament: { price: 49.00, label: "Tournament Pass"  },
};

// ─── CORS headers ─────────────────────────────────────────────────────────────
function corsHeaders(req) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal token error ${res.status}: ${err}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

async function fetchPayPalOrder(orderID, accessToken) {
  const res = await fetch(
    `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal order fetch error ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
function sbHeaders() {
  return {
    apikey:          process.env.SUPABASE_SERVICE_KEY,
    Authorization:   `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    "Content-Type":  "application/json",
    Prefer:          "return=representation",
  };
}

async function purchaseExists(orderId) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/purchases?order_id=eq.${encodeURIComponent(orderId)}&select=id,status`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

async function insertPurchase(record) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/purchases`, {
    method:  "POST",
    headers: sbHeaders(),
    body:    JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.text();
    // 23505 = unique violation (duplicate order) — treat as success
    if (err.includes("23505") || err.includes("duplicate")) return null;
    throw new Error(`Supabase insert failed ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  const cors = corsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, cors);
  }

  const { orderID, planId, fingerprint } = body;

  // ── Input validation ────────────────────────────────────────────────────────
  if (!orderID || typeof orderID !== "string" || orderID.length > 64) {
    return json({ error: "Missing or invalid orderID" }, 400, cors);
  }
  if (!planId || !PLANS[planId]) {
    return json({ error: `Invalid planId. Must be one of: ${Object.keys(PLANS).join(", ")}` }, 400, cors);
  }

  const plan = PLANS[planId];

  try {
    // ── Idempotency: check if we already processed this order ──────────────────
    const existing = await purchaseExists(orderID);
    if (existing) {
      // Already verified — return success immediately (safe retry)
      return json({
        success:   true,
        plan:      planId,
        orderId:   orderID,
        idempotent: true,
        message:   "Order already verified",
      }, 200, cors);
    }

    // ── Get PayPal access token ────────────────────────────────────────────────
    let accessToken;
    try {
      accessToken = await getPayPalAccessToken();
    } catch (e) {
      console.error("[verify-order] PayPal auth failed:", e.message);
      return json({ error: "Payment provider authentication failed. Try again." }, 502, cors);
    }

    // ── Fetch the order from PayPal ────────────────────────────────────────────
    let order;
    try {
      order = await fetchPayPalOrder(orderID, accessToken);
    } catch (e) {
      console.error("[verify-order] PayPal order fetch failed:", e.message);
      return json({ error: "Could not retrieve order from payment provider." }, 502, cors);
    }

    // ── Verify order status ────────────────────────────────────────────────────
    if (order.status !== "COMPLETED") {
      return json({
        error:  `Payment not completed. Order status: ${order.status}`,
        status: order.status,
      }, 402, cors);
    }

    // ── Verify amount matches the plan ─────────────────────────────────────────
    const capture     = order.purchase_units?.[0]?.payments?.captures?.[0];
    const paidAmount  = parseFloat(capture?.amount?.value || "0");
    const paidCurrency = capture?.amount?.currency_code || "";

    if (Math.abs(paidAmount - plan.price) > 0.01) {
      console.error(`[verify-order] Amount mismatch: paid ${paidAmount}, expected ${plan.price}`);
      return json({
        error: `Payment amount mismatch. Expected $${plan.price}, received $${paidAmount}.`,
      }, 402, cors);
    }

    if (paidCurrency !== "USD") {
      return json({ error: `Unexpected currency: ${paidCurrency}` }, 402, cors);
    }

    // ── Extract metadata ───────────────────────────────────────────────────────
    const captureId  = capture?.id || null;
    const payerEmail = order.payer?.email_address || null;
    const payerName  = [
      order.payer?.name?.given_name,
      order.payer?.name?.surname,
    ].filter(Boolean).join(" ") || null;

    // ── Write purchase to Supabase ─────────────────────────────────────────────
    const purchaseRecord = {
      order_id:        orderID,
      capture_id:      captureId,
      plan_id:         planId,
      amount:          paidAmount,
      currency:        paidCurrency,
      status:          "completed",
      payer_email:     payerEmail,
      payer_name:      payerName,
      fingerprint:     fingerprint || null,
      created_at:      new Date().toISOString(),
      webhook_confirmed: false,
    };

    await insertPurchase(purchaseRecord);

    // ── Return verified success ────────────────────────────────────────────────
    console.log(`[verify-order] ✓ Verified ${planId} for ${payerEmail} — order ${orderID}`);

    return json({
      success:    true,
      plan:       planId,
      planLabel:  plan.label,
      orderId:    orderID,
      captureId,
      amount:     paidAmount,
      payerEmail,
    }, 200, cors);

  } catch (err) {
    console.error("[verify-order] Unhandled error:", err);
    return json({
      error: "Internal server error. Your payment was NOT affected — contact support if needed.",
    }, 500, cors);
  }
}
