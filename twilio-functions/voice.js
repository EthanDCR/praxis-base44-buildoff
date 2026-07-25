// Twilio Function — paste into the same service → Add Function → /voice
// Set this function's URL as the Voice Request URL on your TwiML App in the console.
// Environment variables:
//   FROM_NUMBER = +1XXXXXXXXXX  (your Twilio phone number in E.164 format)

exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse()
  const dial  = twiml.dial({ callerId: context.FROM_NUMBER })
  dial.number(event.To)
  return callback(null, twiml)
}
