# Keepers AI service

A small TypeScript backend for image-to-purchase lookups. It is independent of the existing FastAPI server and keeps AI API keys out of the Expo application.

## Provider layout

- `src/domain` owns the provider-neutral request and response schemas.
- `src/providers` contains the Google and OpenAI adapters.
- `src/prompts` contains the shared lookup behavior.
- `src/app.ts` exposes the HTTP API.

The request can select a provider, or omit it and use `AI_PROVIDER` from `.env`. Both adapters return the same JSON shape.

## Setup

From `ai-service`:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Put at least one key in `.env`:

```dotenv
AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=your-google-key
GOOGLE_MODEL=gemini-2.5-flash
```

Or:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-platform-key
OPENAI_MODEL=gpt-5-mini
```

The `.env` file is ignored by Git. Do not use an `EXPO_PUBLIC_` variable for either provider key.

The service binds to `127.0.0.1` by default. To call it from Expo on a physical phone, set `HOST=0.0.0.0`, use your computer's LAN IP in the app, and keep the service limited to a trusted network while it has no authentication.

## Test the service

Check configuration without making an AI request:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Run a lookup using a public image URL:

```powershell
$body = @{
  imageUrl = 'https://example.com/clothing-item.jpg'
  provider = 'google'
  maxResults = 5
  itemHint = 'Optional catalog title from Keepers'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8787/api/lookups/image `
  -ContentType 'application/json' `
  -Body $body
```

For a local image, convert it to a data URL before sending it:

```powershell
$path = 'C:\path\to\item.jpg'
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
$body = @{
  imageUrl = "data:image/jpeg;base64,$base64"
  provider = 'google'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8787/api/lookups/image `
  -ContentType 'application/json' `
  -Body $body
```

## API

### `GET /health`

Returns the default provider, configured provider flags, and model names. It never returns API keys.

### `POST /api/lookups/image`

Request:

```json
{
  "imageUrl": "https://example.com/item.jpg",
  "provider": "google",
  "maxResults": 5,
  "itemHint": "Optional existing catalog title"
}
```

- `provider` is optional: `google` or `openai`.
- `imageUrl` accepts an HTTP(S) URL or a base64 image data URL.
- `maxResults` defaults to 5 and is limited to 1-10.

The response contains the identified item, normalized listings, citations, provider, and model.

If Google reports that `gemini-2.5-flash` is unavailable to your project, change `GOOGLE_MODEL` to a vision-capable Gemini model available in your AI Studio project. Search-grounding availability and pricing can differ by model.

## Before deploying

This is intentionally a local-development service. Before exposing it publicly, add authentication and rate limiting, restrict `CORS_ORIGINS`, cap request frequency, and move secrets to the host's secret manager.
