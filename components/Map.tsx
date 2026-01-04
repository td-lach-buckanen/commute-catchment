"use client";

import maplibregl, { LngLatLike, Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef } from "react";

type MapProps = {
  center: { lat: number; lng: number } | null;
  marker: { lat: number; lng: number } | null;
  isochroneGeoJson: any | null;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
};

export default function MapView({
  center,
  marker,
  isochroneGeoJson,
  onMapClick,
}: MapProps) {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const mapCenter = useMemo(() => {
    // Halifax default if no destination
    return center ?? { lat: 44.6511, lng: -63.5827 };
  }, [center]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`,
      center: [mapCenter.lng, mapCenter.lat] as LngLatLike,
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("click", (e) => {
      onMapClick?.({
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Recenter map when destination changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.easeTo({
      center: [mapCenter.lng, mapCenter.lat],
      duration: 400,
    });
  }, [mapCenter]);

  // Marker handling
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!marker) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [marker.lng, marker.lat];

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#111" })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      markerRef.current.setLngLat(lngLat);
    }
  }, [marker]);

  // Isochrone layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "isochrone";
    const fillId = "isochrone-fill";
    const lineId = "isochrone-line";

    const upsert = () => {
      if (!isochroneGeoJson) {
        if (map.getLayer(fillId)) map.removeLayer(fillId);
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }

      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;

      if (!src) {
        map.addSource(sourceId, {
          type: "geojson",
          data: isochroneGeoJson,
        });

        map.addLayer({
          id: fillId,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-opacity": 0.25,
          },
        });

        map.addLayer({
          id: lineId,
          type: "line",
          source: sourceId,
          paint: {
            "line-width": 2,
          },
        });
      } else {
        src.setData(isochroneGeoJson);
      }
    };

    if (map.isStyleLoaded()) upsert();
    else map.once("load", upsert);
  }, [isochroneGeoJson]);

  return (
    <div
      ref={containerRef}
      className="h-[520px] w-full rounded-xl border"
    />
  );
}
