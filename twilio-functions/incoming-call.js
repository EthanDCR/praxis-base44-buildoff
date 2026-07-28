// Twilio Function — paste into your existing service → Add Function → /incoming-call
// Then in Twilio Console: Phone Numbers → your number → Voice → "A call comes in" → Webhook → this URL
// e.g. https://praxis-base-dialer-4210.twil.io/incoming-call

exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse()
  const dial  = twiml.dial()
  dial.client('agent') // must match identity in token.js
  return callback(null, twiml)
}
