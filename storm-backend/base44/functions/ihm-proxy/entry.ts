import { createClientFromRequest } from "npm:@base44/sdk";

const IHM_KEY    = Deno.env.get("IHM_API_KEY")    ?? ""
const IHM_SECRET = Deno.env.get("IHM_API_SECRET") ?? ""
const IHM_AUTH   = "Basic " + btoa(`${IHM_KEY}:${IHM_SECRET}`)

Deno.serve(async (req: Request) => {
  const url  = new URL(req.url)
  const lat  = url.searchParams.get("lat") ?? url.searchParams.get("Lat")
  const lng  = url.searchParams.get("lng") ?? url.searchParams.get("Long")
  const months = url.searchParams.get("months") ?? "36"

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
