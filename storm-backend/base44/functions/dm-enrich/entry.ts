const DM_API_KEY = Deno.env.get("DEALMACHINE_API_KEY") ?? ""

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS })
  }

  let address: string | null = null
  try {
    const body = await req.json()
    address = body.address ?? null
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!address) {
    return Response.json({ error: "address required" }, { status: 400 })
  }

  const dmRes = await fetch("https://api.v2.dealmachine.com/v1/enrichment/enrich-by-address", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: [{ full_address: address }],
      fields: [
        "year_built", "square_footage", "roof_age", "roof_material",
        "property_type", "property_subtype", "estimated_value", "equity_percent",
      ],
      contact_audience: "owners",
    }),
  })

  if (!dmRes.ok) {
    const detail = await dmRes.text()
    return Response.json(
      { error: `DealMachine error: ${dmRes.status}`, detail },
      { status: dmRes.status, headers: CORS }
    )
  }

  const payload = await dmRes.json()
  const result = payload.data?.[0]

  if (!result?.matched) {
    return Response.json({ matched: false }, { headers: CORS })
  }

  const contacts = (result.contacts ?? []).map((c: any) => ({
    name: c.full_name ?? [c.first_name, c.last_name].filter(Boolean).join(" "),
    phones: (c.phones ?? []).map((p: any) => ({ number: p.number, type: p.type ?? null })),
    emails: (c.emails ?? []).map((e: any) => (typeof e === "string" ? e : e.address)),
  }))

  return Response.json({
    matched:          true,
    dm_property_id:   result.dm_property_id,
    property_type:    result.property_type ?? null,
    property_subtype: result.property_subtype ?? null,
    year_built:       result.year_built != null ? String(result.year_built) : null,
    square_footage:   result.square_footage ?? null,
    roof_age:         result.roof_age ?? null,
    roof_material:    result.roof_material ?? null,
    estimated_value:  result.estimated_value ?? null,
    equity_percent:   result.equity_percent ?? null,
    contacts,
  }, { headers: CORS })
})
