// Twilio Function — paste into Twilio Console → your Function Service → Add Function → /swath-storms
// Environment variable to set in the Function service:
//   SWATH_API_KEY = sk_test_...

exports.handler = function (context, event, callback) {
  const https = require('https')

  const response = new Twilio.Response()
  response.appendHeader('Access-Control-Allow-Origin', '*')
  response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.appendHeader('Content-Type', 'application/json')

  if (event.request && event.request.method === 'OPTIONS') {
    response.setStatusCode(204)
    return callback(null, response)
  }

  const params = new URLSearchParams()
  if (event.bbox)  params.set('bbox',  event.bbox)
  if (event.since) params.set('since', event.since)

  const options = {
    hostname: 'swathapi.com',
    path:     `/v1/storms?${params.toString()}`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${context.SWATH_API_KEY}` },
  }

  const req = https.request(options, res => {
    let body = ''
    res.on('data', chunk => { body += chunk })
    res.on('end', () => {
      response.setStatusCode(res.statusCode)
      response.setBody(body)
      callback(null, response)
    })
  })

  req.on('error', err => {
    response.setStatusCode(500)
    response.setBody(JSON.stringify({ error: err.message }))
    callback(null, response)
  })

  req.end()
}
