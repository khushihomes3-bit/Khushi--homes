interface Env { RAZORPAY_KEY_SECRET: string }

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
    if (!body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) {
      return Response.json({ error: 'Missing payment verification fields.' }, { status: 400 });
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(context.env.RAZORPAY_KEY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${body.razorpay_order_id}|${body.razorpay_payment_id}`));
    const expected = toHex(signature);
    if (expected !== body.razorpay_signature) return Response.json({ error: 'Payment signature verification failed.', verified: false }, { status: 400 });
    return Response.json({ verified: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Could not verify payment.', verified: false }, { status: 500 });
  }
};
