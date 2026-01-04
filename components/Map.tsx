"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MapLibreMap, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type LatLng = { lat: number; lng: number };

type Props = {
  center: LatLng;
  marker: LatLng | null;
  isochroneGeoJson: any | null;
  onMapClick?: (coords: LatLng) => void;
};

function bboxFromGeoJSON(fc: any): [number, number, number, number] | null {
  try {
    // GeoJSON bbox order: [minLng, minLat, maxLng, maxLat]
    if (Array.isArray(fc?.bbox) && fc.bbox.length === 4) return fc.bbox;

    // compute bbox manually if needed
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

    const walk = (coords: any) => {
      if (!coords) return;
      if (typeof coords?.[0] === "number" && typeof coords?.[1] === "number") {
        const lng = coords[0], lat = coords[1];
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
        return;
      }
      if (Array.isArray(coords)) for (const c of coords) walk(c);
    };

    if (fc?.type === "FeatureCollection") {
      for (const f of fc.features || []) walk(f?.geometry?.coordinates);
    } else if (fc?.type === "Feature") {
      walk(fc?.geometry?.coordinates);
    } else if (fc?.coordinates) {
      walk(fc.coordinates);
    }

    if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) return null;
    return [minLng, minLat, maxLng, maxLat];
  } catch {
    return null;
  }
}

export default function MapView({ center, marker, isochroneGeoJson, onMapClick }: Props) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

    // Prefer MapTiler if key exists, otherwise fall back to the MapLibre demo style.
    const styleUrl = maptilerKey
      ? `https://api.maptiler.com/maps/streets/style.json?key=${maptilerKey}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [center.lng, center.lat],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("click", (e) => {
      onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.on("error", (e) => {
      // Helps diagnose "black map" issues quickly
      console.error("🗺️ Map error:", e?.error || e);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // keep map centered on selected pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [center.lng, center.lat], duration: 450 });
  }, [center.lat, center.lng]);

  // marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!marker) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker().setLngLat([marker.lng, marker.lat]).addTo(map);
    } else {
      markerRef.current.setLngLat([marker.lng, marker.lat]);
    }
  }, [marker?.lat, marker?.lng]);

  // isochrone polygon + auto-fit
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const srcId = "isochrone-src";
    const fillId = "isochrone-fill";
    const lineId = "isochrone-line";

    const ensureLayers = () => {
      if (!map.getSource(srcId)) {
        map.addSource(srcId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      if (!map.getLayer(fillId)) {
        map.addLayer({
          id: fillId,
          type: "fill",
          source: srcId,
          paint: { "fill-opacity": 0.25 },
        });
      }
      if (!map.getLayer(lineId)) {
        map.addLayer({
          id: lineId,
          type: "line",
          source: srcId,
          paint: { "line-width": 2 },
        });
      }
    };

    const update = () => {
      ensureLayers();
      const src = map.getSource(srcId) as any;
      src.setData(isochroneGeoJson || { type: "FeatureCollection", features: [] });

      // Auto-fit to polygon, with a nice pad, and keep centered roughly on marker
      if (isochroneGeoJson) {
        const b = bboxFromGeoJSON(isochroneGeoJson);
        if (b) {
          const bounds: LngLatBoundsLike = [
            [b[0], b[1]],
            [b[2], b[3]],
          ];
          map.fitBounds(bounds, { padding: 40, duration: 600 });
        }
      }
    };

    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [isochroneGeoJson]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: 520, borderRadius: 12, overflow: "hidden" }}
    />
  );
}
