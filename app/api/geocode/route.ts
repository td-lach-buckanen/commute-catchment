import { NextResponse } from "next/server";

type IsochroneRequest = {
  lat: number;
  lng: number;
  arriveByISO: string; // e.g. "2026-01-03T08:30:00-04:00"
  minutes: number; // e.g. 30
  mode: "public_transport" | "walking+ferry" | "cycling+ferry" | "driving+public_transport";
};

// Tiny in-memory cache (fine for MVP/local). Later: Redis/Upstash.
const cache = new Map<string, { expiresAt: number; geojson: any }>();

function cacheKey(body: IsochroneRequest) {
  // Round coords slightly so cache hits are more likely when users click around
  const lat = body.lat.toFixed(5);
  const lng = body.lng.toFixed(5);
  return `${lat},${lng}|${body.arriveByISO}|${body.minutes}|${body.mode}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IsochroneRequest;

    if (
      typeof body?.lat !== "number" ||
      typeof body?.lng !== "number" ||
      typeof body?.arriveByISO !== "string" ||
      typeof body?.minutes !== "number" ||
      typeof body?.mode !== "string"
    ) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const appId = process.env.TRAVELTIME_APP_ID;
    const apiKey = process.env.TRAVELTIME_API_KEY;

    if (!appId || !apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing TRAVELTIME_APP_ID / TRAVELTIME_API_KEY. Add them to .env.local and restart `npm run dev`.",
        },
        { status: 500 }
      );
    }

    const key = cacheKey(body);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return NextResponse.json(hit.geojson);
    }

    // TravelTime Isochrones Fast: /v4/time-map/fast
    // We'll request GeoJSON output via Accept header. :contentReference[oaicite:2]{index=2}
    const travelTimeSeconds = Math.max(60, Math.min(body.minutes * 60, 10800)); // clamp 1 min .. 3 hours

    const payload = {
      arrival_searches: {
        many_to_one: [
          {
            id: "isochrone_1",
            coords: { lat: body.lat, lng: body.lng },
            transportation: { type: body.mode },
            arrival_time_period: "weekday_morning", // Fast endpoint is limited; good MVP default
            travel_time: travelTimeSeconds,
            // Optional: tweak detail if needed
            level_of_detail: { scale_type: "simple", level: "medium" },
          },
        ],
      },
    };

    const resp = await fetch("https://api.traveltimeapp.com/v4/time-map/fast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/geo+json",
        "X-Application-Id": appId,
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: "TravelTime error", status: resp.status, detail: text },
        { status: 502 }
      );
    }

    const geojson = await resp.json();

    // Cache for 10 minutes (tune later)
    cache.set(key, { expiresAt: now + 10 * 60 * 1000, geojson });

    return NextResponse.json(geojson);
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", detail: String(err) }, { status: 500 });
  }
}
