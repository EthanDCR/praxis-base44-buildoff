const XW_CID = Deno.env.get("XWEATHER_CLIENT_ID") ?? ""
const XW_CS  = Deno.env.get("XWEATHER_CLIENT_SECRET") ?? ""

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS })
  }

  let path: string | null = null
  try {
    const body = await req.json()
    path = body.path ?? null
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!path) {
    return Response.json({ error: "path required" }, { status: 400 })
  }

  const sep = path.includes("?") ? "&" : "?"
  const url = `https://data.api.xweather.com${path}${sep}client_id=${XW_CID}&client_secret=${XW_CS}`

  const res = await fetch(url)
  const body2 = await res.text()

  return new Response(body2, {
    status: res.status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
})
