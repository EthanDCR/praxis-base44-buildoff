// Twilio Function — paste into your existing service → Add Function → /incoming-call
// Then in Twilio Console: Phone Numbers → your number → Voice → "A call comes in" → Webhook → this URL
// e.g. https://praxis-base-dialer-4210.twil.io/incoming-call

// All Twilio numbers point to this one function.
// Looks up the rep by their assigned twilio_number in Base44 — no manual mapping needed.
// Set BASE44_APP_ID in Twilio Function Environment Variables.

exports.handler = async function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse()

  let identity = 'agent'
  try {
    const res = await fetch(
      `https://base44.app/api/apps/${context.BASE44_APP_ID}/functions/rep-identity-lookup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twilio_number: event.To }),
      }
    )
    const data = await res.json()
    if (data.identity) identity = data.identity
  } catch (err) {
    console.error('rep lookup failed:', err)
  }

  const dial = twiml.dial()
  dial.client(identity)
  return callback(null, twiml)
}
