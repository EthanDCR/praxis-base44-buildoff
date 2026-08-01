const IHM_KEY    = Deno.env.get("IHM_API_KEY")    ?? ""
const IHM_SECRET = Deno.env.get("IHM_API_SECRET") ?? ""
const IHM_AUTH   = "Basic " + btoa(`${IHM_KEY}:${IHM_SECRET}`)

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // base44 SDK invoke() sends params as POST JSON body
  let lat: string | null = null
  let lng: string | null = null
  let months = "36"

  try {
    const body = await req.json()
    lat    = body.lat    != null ? String(body.lat)    : null
    lng    = body.lng    != null ? String(body.lng)    : null
    months = body.months != null ? String(body.months) : "36"
  } catch { /* not a JSON body, fall through to query params */ }

  // fall back to query params (direct GET requests)
  if (!lat) lat    = url.searchParams.get("lat") ?? url.searchParams.get("Lat")
  if (!lng) lng    = url.searchParams.get("lng") ?? url.searchParams.get("Long")
  months           = url.searchParams.get("months") ?? months

  if (!lat || !lng) {
    return Response.json({ error: "lat and lng required" }, { status: 400 })
  }

  const upstream = `https://maps.interactivehailmaps.com/ExternalApi/ImpactDatesForLatLong?Lat=${lat}&Long=${lng}&Months=${months}`

  const res = await fetch(upstream, {
    headers: { Authorization: IHM_AUTH },
  })

  const body = await res.text()

  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
})
