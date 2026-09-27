interface Env { RAZORPAY_KEY_ID: string; RAZORPAY_KEY_SECRET: string }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json() as { planCode?: string; amount?: number; paymentMethod?: string };
    if (!body.planCode || !Number.isInteger(body.amount) || Number(body.amount) <= 0) {
      return Response.json({ error: 'Invalid plan payment.' }, { status: 400 });
    }
    if (!context.env.RAZORPAY_KEY_ID || !context.env.RAZORPAY_KEY_SECRET) {
      return Response.json({ error: 'Razorpay server keys are not configured.' }, { status: 500 });
    }
    const auth = btoa(`${context.env.RAZORPAY_KEY_ID}:${context.env.RAZORPAY_KEY_SECRET}`);
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: body.amount,
        currency: 'INR',
        receipt: `khushi_${body.planCode}_${Date.now()}`,
        notes: { product: 'KHUSHI HOMES Smart Home', planCode: body.planCode, paymentMethod: body.paymentMethod || 'UPI' },
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) return Response.json({ error: data?.error?.description || 'Razorpay order creation failed.' }, { status: 502 });
    return Response.json({ orderId: data.id, keyId: context.env.RAZORPAY_KEY_ID, amount: data.amount, currency: data.currency });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Could not create payment order.' }, { status: 500 });
  }
};
