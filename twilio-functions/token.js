// Twilio Function — paste this into Twilio Console → Functions → Create Service → Add Function → /token
// Environment variables to set in the Function service:
//   TWIML_APP_SID   = AP... (your TwiML App SID — NOT the API Key)
//   API_KEY         = SK...
//   API_SECRET      = (the secret value)

exports.handler = function (context, event, callback) {
  const AccessToken = Twilio.jwt.AccessToken
  const VoiceGrant  = AccessToken.VoiceGrant

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: context.TWIML_APP_SID,
    incomingAllow: true,
  })

  const token = new AccessToken(
    context.ACCOUNT_SID,   // auto-set by Twilio Functions
    context.API_KEY,
    context.API_SECRET,
    { identity: 'agent', ttl: 3600 }
  )
  token.addGrant(voiceGrant)

  const response = new Twilio.Response()
  response.setStatusCode(200)
  response.appendHeader('Access-Control-Allow-Origin', '*')
  response.appendHeader('Content-Type', 'application/json')
  response.setBody({ token: token.toJwt() })

  return callback(null, response)
}
