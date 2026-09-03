"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { Layer, Marker, Popup, Source } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ACADEMIC_AREA_CENTER,
  CAMPUS_BBOX,
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  OSM_RASTER_STYLE,
  type ProfileId,
} from "@/data/config";
import type { FeatureProps, Place } from "@/lib/types";
import { FeaturePopup } from "./FeaturePopup";
import { ProfilePicker } from "./ProfilePicker";
import { RouteSummary } from "./RouteSummary";
import { SearchBox } from "./SearchBox";

type RouteStatus = "idle" | "loading" | "ok" | "no-route" | "outside" | "error";

type RouteResponse = {
  type: string;
  message?: string;
  geometry?: GeoJSON.LineString;
  summary?: {
    distanceM: number;
    rampsUsed: number;
    stairsUsed: number;
    stairsAvoided: boolean;
  };
};

type FeatureGj = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: FeatureProps & { notes?: string };
    geometry: { type: string; coordinates: number[] | number[][] };
  }[];
};

type AcademicGj = {
  type: "FeatureCollection";
  features: {
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
  }[];
};

const KIND_COLOR: Record<string, string> = {
  ramp: "#15803d",
  stairs: "#c2410c",
  skywalk: "#6d28d9",
  crossing: "#ca8a04",
  elevator: "#1d4ed8",
  entrance: "#0f766e",
  bench: "#92400e",
  rest_area: "#3f6212",
  other: "#334155",
};

export default function MapApp() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [features, setFeatures] = useState<FeatureGj | null>(null);
  const [academic, setAcademic] = useState<AcademicGj | null>(null);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [profile, setProfile] = useState<ProfileId>("wheelchair");
  const [routeResult, setRouteResult] = useState<{
    key: string;
    data: RouteResponse;
  } | null>(null);
  const [popup, setPopup] = useState<{
    lon: number;
    lat: number;
    properties: FeatureProps & { notes?: string };
  } | null>(null);

  const routeKey = from && to ? `${from.id}|${to.id}|${profile}` : "";
  const live = routeResult && routeResult.key === routeKey ? routeResult.data : null;
  const status: RouteStatus = !from || !to
    ? "idle"
    : !live
      ? "loading"
      : live.type === "ok"
        ? "ok"
        : live.type === "outside"
          ? "outside"
          : live.type === "no-route"
            ? "no-route"
            : "error";
  const routeGeom = live?.type === "ok" ? live.geometry ?? null : null;
  const summary = live?.type === "ok" ? live.summary : undefined;
  const message = live?.message;

  useEffect(() => {
    Promise.all([
      fetch("/data/places.json").then((r) => r.json()) as Promise<Place[]>,
      fetch("/data/features.geojson").then((r) => r.json()) as Promise<FeatureGj>,
      fetch("/data/academic-area.geojson").then((r) => r.json()) as Promise<AcademicGj>,
    ]).then(([p, f, a]) => {
      setPlaces(p);
      setFeatures(f);
      setAcademic(a);
    });
  }, []);

  const mask = useMemo(() => {
    if (!academic?.features[0]) return null;
    const hole = academic.features[0].geometry.coordinates[0];
    const outer: [number, number][] = [
      [CAMPUS_BBOX.west, CAMPUS_BBOX.south],
      [CAMPUS_BBOX.east, CAMPUS_BBOX.south],
      [CAMPUS_BBOX.east, CAMPUS_BBOX.north],
      [CAMPUS_BBOX.west, CAMPUS_BBOX.north],
      [CAMPUS_BBOX.west, CAMPUS_BBOX.south],
    ];
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [outer, [...hole].reverse()],
      },
    };
  }, [academic]);

  const routeFc = useMemo(
    () =>
      routeGeom
        ? { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: routeGeom }] }
        : { type: "FeatureCollection" as const, features: [] },
    [routeGeom],
  );

  useEffect(() => {
    if (!from || !to || !routeKey) return;
    const controller = new AbortController();
    const key = routeKey;
    fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, fromPlaceId: from.id, toPlaceId: to.id }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: RouteResponse) => {
        setRouteResult({ key, data });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRouteResult({
          key,
          data: { type: "error", message: "Routing failed." },
        });
      });
    return () => controller.abort();
  }, [from, to, profile, routeKey]);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const hit = e.features?.find((f) => f.layer.id === "features-circle" || f.layer.id === "features-line");
    if (!hit || !hit.properties) {
      setPopup(null);
      return;
    }
    const props = hit.properties as FeatureProps & { notes?: string; tags?: string };
    const tags =
      typeof props.tags === "string"
        ? (JSON.parse(props.tags) as Record<string, string>)
        : ((props.tags as Record<string, string> | undefined) ?? {});
    setPopup({
      lon: e.lngLat.lng,
      lat: e.lngLat.lat,
      properties: { ...props, tags },
    });
  }, []);

  return (
    <div className="relative h-dvh w-full">
      <Map
        mapStyle={OSM_RASTER_STYLE}
        initialViewState={{
          longitude: ACADEMIC_AREA_CENTER.lon,
          latitude: ACADEMIC_AREA_CENTER.lat,
          zoom: INITIAL_ZOOM,
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={[
          CAMPUS_BBOX.west,
          CAMPUS_BBOX.south,
          CAMPUS_BBOX.east,
          CAMPUS_BBOX.north,
        ]}
        interactiveLayerIds={["features-circle", "features-line"]}
        onClick={onClick}
        attributionControl={{ compact: true }}
        style={{ width: "100%", height: "100%" }}
      >
        {mask && (
          <Source id="mask" type="geojson" data={mask as GeoJSON.Feature}>
            <Layer
              id="mask-fill"
              type="fill"
              paint={{ "fill-color": "#0f172a", "fill-opacity": 0.28 }}
            />
          </Source>
        )}
        {academic && (
          <Source id="academic" type="geojson" data={academic as unknown as GeoJSON.GeoJSON}>
            <Layer
              id="academic-line"
              type="line"
              paint={{
                "line-color": "#0369a1",
                "line-width": 2,
                "line-dasharray": [1.4, 1.2],
              }}
            />
          </Source>
        )}
        {features && (
          <Source id="features" type="geojson" data={features as unknown as GeoJSON.GeoJSON}>
            <Layer
              id="features-line"
              type="line"
              filter={["==", ["geometry-type"], "LineString"]}
              paint={{
                "line-color": [
                  "match",
                  ["get", "kind"],
                  "ramp",
                  KIND_COLOR.ramp,
                  "stairs",
                  KIND_COLOR.stairs,
                  "skywalk",
                  KIND_COLOR.skywalk,
                  KIND_COLOR.other,
                ],
                "line-width": 3,
              }}
            />
            <Layer
              id="features-circle"
              type="circle"
              filter={["==", ["geometry-type"], "Point"]}
              paint={{
                "circle-radius": 6,
                "circle-stroke-width": 1,
                "circle-stroke-color": "#ffffff",
                "circle-color": [
                  "match",
                  ["get", "kind"],
                  "ramp",
                  KIND_COLOR.ramp,
                  "stairs",
                  KIND_COLOR.stairs,
                  "crossing",
                  KIND_COLOR.crossing,
                  "elevator",
                  KIND_COLOR.elevator,
                  "entrance",
                  KIND_COLOR.entrance,
                  "bench",
                  KIND_COLOR.bench,
                  "rest_area",
                  KIND_COLOR.rest_area,
                  KIND_COLOR.other,
                ],
              }}
            />
          </Source>
        )}
        <Source id="route" type="geojson" data={routeFc}>
          <Layer
            id="route-line"
            type="line"
            paint={{
              "line-color": profile === "wheelchair" ? "#0f766e" : "#1d4ed8",
              "line-width": 5,
              "line-opacity": 0.92,
            }}
          />
        </Source>
        {from && (
          <Marker longitude={from.lon} latitude={from.lat} color="#0369a1" />
        )}
        {to && (
          <Marker longitude={to.lon} latitude={to.lat} color="#b45309" />
        )}
        {popup && (
          <Popup
            longitude={popup.lon}
            latitude={popup.lat}
            onClose={() => setPopup(null)}
            closeOnClick={false}
            maxWidth="260px"
          >
            <FeaturePopup properties={popup.properties} />
          </Popup>
        )}
      </Map>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
        <div className="pointer-events-auto w-full max-w-md space-y-2">
          <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-base font-semibold text-slate-900">IITK Accessible</h1>
                <p className="text-xs text-slate-500">
                  Academic Area routes — suitable, not just shortest
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <SearchBox label="From" places={places} value={from} onChange={setFrom} />
              <SearchBox label="To" places={places} value={to} onChange={setTo} />
              <ProfilePicker value={profile} onChange={setProfile} />
            </div>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50/95 px-3 py-2 text-xs text-sky-900 shadow-sm">
            Detailed accessibility coverage is the dashed Academic Area. The rest of
            campus is base map only.
          </div>
        </div>
        <div className="pointer-events-auto w-full max-w-md">
          <RouteSummary
            status={status}
            message={message}
            summary={summary}
            profileLabel={profile === "wheelchair" ? "Wheelchair" : "Normal"}
          />
        </div>
      </div>
    </div>
  );
}
