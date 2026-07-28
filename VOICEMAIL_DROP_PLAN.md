# Voicemail Drop System — Plan

## The Full Flow

```
[Target List]
     │
     ▼
Fill script template        ← name, address, hail date auto-injected
     │
     ▼
ElevenLabs API              ← synthesizes MP3 in your voice
     │
     ▼
Cloudflare R2               ← hosts the MP3 at a public URL
     │
     ▼
Drop.co API                 ← drops to voicemail without ringing
     │
     └── shows your Twilio number as caller ID
```

## Stack

| Layer | Tool | Notes |
|---|---|---|
| Script engine | TypeScript template literals | Vars: name, address, city, hail_date, hail_size, agent_name |
| Voice synthesis | ElevenLabs API | Clone your own voice or use a stock voice |
| Audio hosting | Cloudflare R2 | Free tier, public URL required by Drop.co |
| Voicemail drop | Drop.co `/VMDropCreate` + `/Delivery` | IVR option: press 1 to connect, press 2 for DNC |
| Caller ID / callbacks | Existing Twilio number | Already paying for it |
| In-app notification | Twilio Voice SDK (inbound) | Already have SDK, just needs `device.register()` |

## Drop.co Key Endpoints

- `POST /VMDropCreate` — create a campaign with audio URL + settings
- `POST /Delivery` — submit phone numbers to a campaign
- `POST /VMDropStats` — check campaign progress
- Webhook (configured in profile) — fires on delivery status / callback

## Script Template

```ts
function buildScript(target: Target, agent: Agent): string {
  const firstName = target.contacts?.[0]?.name?.split(' ')[0] ?? 'there'
  const address = target.line1
  const city = target.line2?.split(',')[0]?.trim()
  const hailDate = formatDate(target.hail_date)
  const hailSize = target.hail_size

  return `Hi ${firstName}, this is ${agent.name} with ${agent.company}.
I'm reaching out about your property at ${address} in ${city}.
Our records show your area was hit with ${hailSize}-inch hail on ${hailDate}.
Many homeowners in your area are getting full roof replacements covered by insurance.
I'd love to stop by and do a free inspection — no cost to you.
Call me back at this number and I can get you on the schedule.
Thanks ${firstName}, talk soon.`
}
```

## ElevenLabs Integration

```ts
async function synthesize(script: string): Promise<Blob> {
  const res = await fetch('/elevenlabs-api/text-to-speech/{voice_id}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: script, model_id: 'eleven_monolingual_v1' })
  })
  return res.blob()
}
```

Add to vite.config.ts proxy:
```ts
'/elevenlabs-api': {
  target: 'https://api.elevenlabs.io/v1',
  changeOrigin: true,
  rewrite: path => path.replace(/^\/elevenlabs-api/, ''),
  headers: { 'xi-api-key': env.VITE_ELEVENLABS_API_KEY }
}
```

## Cloudflare R2 Upload

```ts
async function uploadAudio(blob: Blob, filename: string): Promise<string> {
  // PUT to R2 bucket via public upload URL
  await fetch(`https://<bucket>.r2.cloudflarestorage.com/${filename}`, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': 'audio/mpeg' }
  })
  return `https://<your-public-domain>/${filename}`
}
```

## Drop.co Campaign Flow

```ts
async function sendDrop(audioUrl: string, phones: string[]) {
  // 1. Create campaign
  const campaign = await fetch('/dropcо-api/VMDropCreate', {
    method: 'POST',
    body: JSON.stringify({ audio_url: audioUrl, callback_number: TWILIO_NUMBER })
  })

  // 2. Submit numbers
  await fetch('/dropco-api/Delivery', {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaign.id, phones })
  })
}
```

## Callback Handling (See CALLBACK_PLAN.md)

When prospect calls back → Twilio routes to browser → app surfaces popup with their full data.

## Open Questions

- [ ] Which ElevenLabs voice? Clone agent voice or stock?
- [ ] Dedicated callback number per campaign or one shared number?
- [ ] IVR mode (press 1 to connect) vs straight drop?
- [ ] TCPA compliance check on residential lists
- [ ] Where to trigger drop from UI: per-target button, or "drop all new" per list?

## Env Vars Needed

```
VITE_ELEVENLABS_API_KEY=
VITE_ELEVENLABS_VOICE_ID=
VITE_DROPCO_API_KEY=
VITE_CLOUDFLARE_R2_BUCKET=
VITE_CLOUDFLARE_R2_PUBLIC_URL=
```
