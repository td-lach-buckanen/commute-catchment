import { NextResponse } from "next/server";

type IsochroneRequest = {
  lat: number;
  lng: number;
  arriveByISO: string;
  minutes: number;
  mode: "public_transport" | "driving+public_transport";
};

const cache = new Map<string, { expiresAt: number; geojson: any }>();

function cacheKey(body: IsochroneRequest) {
  return `${body.lat.toFixed(5)},${body.lng.toFixed(5)}|${body.arriveByISO}|${body.minutes}|${body.mode}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IsochroneRequest;

    // Basic validation
    if (
      !Number.isFinite(body?.lat) ||
      !Number.isFinite(body?.lng) ||
      typeof body?.arriveByISO !== "string" ||
      !Number.isFinite(body?.minutes) ||
      typeof body?.mode !== "string"
    ) {
      return NextResponse.json({ error: "Invalid request body", body }, { status: 400 });
    }

    const appId = process.env.TRAVELTIME_APP_ID;
    const apiKey = process.env.TRAVELTIME_API_KEY;

    if (!appId || !apiKey) {
      return NextResponse.json(
        { error: "Missing env vars TRAVELTIME_APP_ID / TRAVELTIME_API_KEY" },
        { status: 500 }
      );
    }

    const key = cacheKey(body);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return NextResponse.json(hit.geojson);
    }

    const travelTimeSeconds = Math.max(60, Math.min(Math.round(body.minutes * 60), 10800));

    // MVP: use Fast endpoint with arrival time period
    const payload = {
      arrival_searches: {
        many_to_one: [
          {
            id: "isochrone_1",
            coords: { lat: body.lat, lng: body.lng },
            transportation: { type: body.mode },
            arrival_time_period: "weekday_morning",
            travel_time: travelTimeSeconds,
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

    const contentType = resp.headers.get("content-type") || "";
    const text = await resp.text();

    // If TravelTime returns JSON, parse it; if not, return as error text
    if (!resp.ok) {
      return NextResponse.json(
        {
          error: "TravelTime request failed",
          status: resp.status,
          contentType,
          detail: text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    let geojson: any;
    try {
      geojson = contentType.includes("json") ? JSON.parse(text) : text;
    } catch {
      // In case content-type lies, still protect the client
      return NextResponse.json(
        {
          error: "TravelTime returned non-JSON response",
          status: resp.status,
          contentType,
          detail: text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    cache.set(key, { expiresAt: now + 10 * 60 * 1000, geojson });
    return NextResponse.json(geojson);
  } catch (err: any) {
    // Always return JSON so the client never tries to parse HTML
    return NextResponse.json(
      { error: "Isochrone route crashed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
