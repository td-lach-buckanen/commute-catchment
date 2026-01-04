"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "../components/Map";
import * as turf from "@turf/turf";

type Dest = { name: string; lat: number; lng: number };
type GeoResult = { name: string; lat: number; lng: number };

type CommunityHit = {
  name: string;
  mode: string;
};

function toArriveByISO(timeHHMM: string) {
  const [hh, mm] = timeHHMM.split(":").map(Number);

  // Next weekday (Mon–Fri)
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);

  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(hh).padStart(2, "0");
  const Min = String(mm).padStart(2, "0");

  // Halifax = Atlantic Time (UTC-4) for MVP
  return `${yyyy}-${MM}-${dd}T${HH}:${Min}:00-04:00`;
}

function pickCommunityName(props: any): string {
  if (!props || typeof props !== "object") return "Unnamed area";

  const candidates = [
    "GSA_NAME",
    "COMMUNITY",
    "COMMUNITY_NAME",
    "community_name",
    "NAME",
    "name",
    "label",
    "LABEL",
  ];

  for (const k of candidates) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  return "Unnamed area";
}

export default function Home() {
  const [destination, setDestination] = useState<Dest | null>(null);

  const [arriveBy, setArriveBy] = useState("08:30");
  const [minutes, setMinutes] = useState(30);
  const [mode, setMode] = useState<"public_transport" | "driving+public_transport">(
    "public_transport"
  );

  const [isochrone, setIsochrone] = useState<any | null>(null);
  const [loadingIso, setLoadingIso] = useState(false);

  const [communities, setCommunities] = useState<any | null>(null);
  const [within, setWithin] = useState<CommunityHit[]>([]);

  const arriveByISO = useMemo(() => toArriveByISO(arriveBy), [arriveBy]);

  // Load HRM boundaries once
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/data/hrm_community_boundaries.geojson", { cache: "no-store" });
        const data = await r.json();
        setCommunities(data);

        // Debug: log community stats + bbox
        const fc = data as turf.FeatureCollection;
        const bbox = turf.bbox(fc);
        console.log("🗺️ Communities loaded:", {
          features: fc.features?.length ?? 0,
          bbox: { minLng: bbox[0], minLat: bbox[1], maxLng: bbox[2], maxLat: bbox[3] },
          sampleProps: fc.features?.[0]?.properties ? Object.keys(fc.features[0].properties) : [],
        });
      } catch (e) {
        console.log("❌ Failed to load communities:", e);
        setCommunities(null);
      }
    })();
  }, []);

  // Fetch TravelTime isochrone whenever inputs change
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef<any>(null);

  useEffect(() => {
    if (!destination) return;

    if (tRef.current) clearTimeout(tRef.current);

    tRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      console.log("🕒 ArriveBy ISO being sent:", arriveByISO, "| minutes:", minutes, "| mode:", mode);

      setLoadingIso(true);
      try {
        const resp = await fetch("/api/isochrone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            lat: destination.lat,
            lng: destination.lng,
            arriveByISO,
            minutes,
            mode,
          }),
        });

        const data = await resp.json();
        setIsochrone(data);
      } finally {
        setLoadingIso(false);
      }
    }, 350);

    return () => {
      if (tRef.current) clearTimeout(tRef.current);
      abortRef.current?.abort();
    };
  }, [destination, arriveByISO, minutes, mode]);

  // Compute “areas within commute” using centroid-in-polygon (robust MVP)
  useEffect(() => {
    if (!isochrone || !communities) {
      setWithin([]);
      return;
    }

    const isoFC = isochrone as turf.FeatureCollection;
    if (!isoFC?.features?.length) {
      setWithin([]);
      return;
    }

    // Combine all isochrone pieces into one MultiPolygon feature
    const combinedFC = turf.combine(isoFC) as turf.FeatureCollection;
    const isoFeature = combinedFC.features?.[0] as turf.Feature<
      turf.Polygon | turf.MultiPolygon
    >;

    if (!isoFeature?.geometry) {
      setWithin([]);
      return;
    }

    const isoBbox = turf.bbox(isoFeature);
    console.log("📐 Isochrone bbox:", {
      minLng: isoBbox[0],
      minLat: isoBbox[1],
      maxLng: isoBbox[2],
      maxLat: isoBbox[3],
    });

    const hits: CommunityHit[] = [];
    const commFC = communities as turf.FeatureCollection;

    for (const f of commFC.features || []) {
      if (!f?.geometry) continue;

      // Quick bbox prefilter for speed
      const b = turf.bbox(f as any);
      const bboxIntersects =
        !(b[2] < isoBbox[0] || b[0] > isoBbox[2] || b[3] < isoBbox[1] || b[1] > isoBbox[3]);
      if (!bboxIntersects) continue;

      // Robust check: centroid inside isochrone
      let inside = false;
      try {
        const c = turf.centroid(f as any);
        inside = turf.booleanPointInPolygon(c, isoFeature as any);
      } catch {
        inside = false;
      }

      if (!inside) continue;

      const name = pickCommunityName((f as any).properties);
      hits.push({ name, mode: mode.replaceAll("_", " ") });
    }

    // De-dupe by name and sort
    const uniq = Array.from(new Map(hits.map((h) => [h.name, h])).values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    setWithin(uniq);
  }, [isochrone, communities, mode]);

  // ✅ UPDATED NSCC coordinates here
  const presets: Dest[] = [
    { name: "NSCC IT Campus", lat: 44.6695774, lng: -63.6147024 },
    { name: "Dalhousie University", lat: 44.6367, lng: -63.5952 },
    { name: "Saint Mary's University", lat: 44.6296, lng: -63.5782 },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Commute Catchment</h1>

      <div className="mt-6 space-y-4 border rounded-xl p-4 bg-white">
        <div className="flex gap-2 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.name}
              className="border rounded px-3 py-1 text-sm hover:bg-gray-50"
              onClick={() => setDestination(p)}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium">Arrive by</label>
            <input
              type="time"
              value={arriveBy}
              onChange={(e) => setArriveBy(e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="mt-1 w-full border rounded px-2 py-1"
            >
              <option value="public_transport">Public transport</option>
              <option value="driving+public_transport">Drive + public transport</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Max commute: {minutes} min</label>
            <input
              type="range"
              min={10}
              max={60}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="text-sm text-gray-700">
          {loadingIso
            ? "Loading isochrone…"
            : within.length === 0
            ? "No areas found yet."
            : `${within.length} areas within commute`}
        </div>

        {within.length > 0 && (
          <div className="grid md:grid-cols-2 gap-2">
            {within.map((w, i) => (
              <div key={`${w.name}-${i}`} className="border rounded p-2">
                <div className="font-medium">{w.name}</div>
                <div className="text-xs text-gray-600">{w.mode}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <MapView
          center={
            destination
              ? { lat: destination.lat, lng: destination.lng }
              : { lat: 44.6511, lng: -63.5827 }
          }
          marker={destination ? { lat: destination.lat, lng: destination.lng } : null}
          isochroneGeoJson={isochrone}
          onMapClick={(coords) =>
            setDestination({ name: "Dropped pin", lat: coords.lat, lng: coords.lng })
          }
        />
      </div>
    </main>
  );
}
