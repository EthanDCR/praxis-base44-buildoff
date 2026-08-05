import { createClientFromRequest } from "npm:@base44/sdk"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  let twilio_number = ""
  try {
    const body = await req.json()
    twilio_number = (body.twilio_number ?? "").trim()
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400, headers: CORS })
  }

  if (!twilio_number) {
    return Response.json({ error: "twilio_number required" }, { status: 400, headers: CORS })
  }

  const base44 = createClientFromRequest(req)

  // Try exact match, then with/without leading +
  const variants = [twilio_number]
  if (twilio_number.startsWith("+")) variants.push(twilio_number.slice(1))
  else variants.push("+" + twilio_number)

  let identity: string | null = null
  for (const num of variants) {
    const profiles = await base44.asServiceRole.entities.UserProfile.filter(
      { twilio_number: num },
      undefined,
      1
    ) as any[]
    if (profiles[0]?.email) {
      // Derive identity the same way the frontend does — no stored field needed
      identity = profiles[0].email.replace(/[^a-zA-Z0-9_-]/g, '_')
      break
    }
  }

  return Response.json({ identity }, { headers: CORS })
})
