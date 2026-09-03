import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { createRoot } from "react-dom/client";
import {
  ACADEMIC_AREA_CENTER,
  BASEMAP_STYLE_URL,
  CAMPUS_BBOX,
  FEATURE_KINDS,
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
} from "../../data/config.js";
import { bboxToBounds, coordsBbox, padBbox } from "../lib/geo/bbox.js";
import { buildingPlace, pointPlace } from "../lib/data.js";
import FeaturePopup from "./FeaturePopup.jsx";

const EMPTY = { type: "FeatureCollection", features: [] };
const WORLD = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90],
];

/** MapLibre "match" expression colouring features by kind. */
function kindColorExpr() {
  const pairs = [];
  for (const [k, v] of Object.entries(FEATURE_KINDS)) pairs.push(k, v.color);
  return ["match", ["get", "kind"], ...pairs, "#64748b"];
}

function markerElement(kind) {
  const el = document.createElement("div");
  el.className = `pin pin-${kind}`;
  el.innerHTML = `<span>${kind === "from" ? "A" : "B"}</span>`;
  return el;
}

/**
 * The campus map: basemap locked to IITK, Academic Area overlay, buildings,
 * accessibility features, route rendering, from/to pins, and popups.
 */
export default function MapView({
  academicArea,
  buildings,
  features,
  places,
  from,
  to,
  result,
  hoveredStep,
  focus,
  onSetFrom,
  onSetTo,
  showFeatures = true,
  showBuildings = true,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const popupRootRef = useRef(null);
  const fromMarker = useRef(null);
  const toMarker = useRef(null);
  const callbacks = useRef({ onSetFrom, onSetTo, places });
  const [loaded, setLoaded] = useState(false);

  callbacks.current = { onSetFrom, onSetTo, places };

  // ---- create the map once ---------------------------------------------------
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center: [ACADEMIC_AREA_CENTER.lon, ACADEMIC_AREA_CENTER.lat],
      zoom: INITIAL_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: bboxToBounds(padBbox(CAMPUS_BBOX, 0.15)),
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

    map.on("load", () => {
      // Sources
      map.addSource("mask", { type: "geojson", data: EMPTY });
      map.addSource("academic-area", { type: "geojson", data: EMPTY });
      map.addSource("buildings", { type: "geojson", data: EMPTY });
      map.addSource("features", { type: "geojson", data: EMPTY });
      map.addSource("route-compare", { type: "geojson", data: EMPTY });
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addSource("connectors", { type: "geojson", data: EMPTY });
      map.addSource("step", { type: "geojson", data: EMPTY });

      // Dim everything outside the Academic Area ("coverage limited").
      map.addLayer({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": "#0f172a", "fill-opacity": 0.08 } });
      map.addLayer({
        id: "academic-fill",
        type: "fill",
        source: "academic-area",
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "academic-outline",
        type: "line",
        source: "academic-area",
        paint: { "line-color": "#2563eb", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.8 },
      });

      // Buildings: named ones get a highlight + label; others a faint outline.
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: {
          "fill-color": ["case", ["boolean", ["get", "inAcademicArea"], false], "#93c5fd", "#cbd5e1"],
          "fill-opacity": ["case", ["has", "name"], 0.35, 0.12],
        },
      });
      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        paint: { "line-color": "#475569", "line-width": ["case", ["has", "name"], 1, 0.4], "line-opacity": 0.6 },
      });
      map.addLayer({
        id: "buildings-label",
        type: "symbol",
        source: "buildings",
        minzoom: 15.5,
        filter: ["has", "name"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 15.5, 10, 18, 13],
          "text-max-width": 8,
          "text-padding": 4,
          "text-optional": true,
        },
        paint: { "text-color": "#1e293b", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
      });

      // Accessibility features drawn as lines (stairs, ramps, skywalks).
      map.addLayer({
        id: "features-line",
        type: "line",
        source: "features",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": kindColorExpr(),
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 3, 18, 7],
          "line-opacity": 0.9,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      // Comparison (shortest) route in grey when the wheelchair route differs.
      map.addLayer({
        id: "route-compare-line",
        type: "line",
        source: "route-compare",
        paint: { "line-color": "#64748b", "line-width": 4, "line-dasharray": [2, 2], "line-opacity": 0.7 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      // Main route: white casing + blue line, like Google Maps.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 6, 18, 12] },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": ["match", ["get", "profile"], "wheelchair", "#0e7490", "#1a73e8"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 8],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "connectors-line",
        type: "line",
        source: "connectors",
        paint: { "line-color": "#1a73e8", "line-width": 3, "line-dasharray": [0.6, 1.4], "line-opacity": 0.8 },
        layout: { "line-cap": "round" },
      });

      // Point features.
      map.addLayer({
        id: "features-point",
        type: "circle",
        source: "features",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 6, 19, 9],
          "circle-color": kindColorExpr(),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });

      // Highlighted direction step.
      map.addLayer({
        id: "step-point",
        type: "circle",
        source: "step",
        paint: { "circle-radius": 10, "circle-color": "#1a73e8", "circle-opacity": 0.25, "circle-stroke-color": "#1a73e8", "circle-stroke-width": 2 },
      });

      // Cursor + clicks
      for (const id of ["features-point", "features-line", "buildings-fill"]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("click", (e) => handleClick(map, e));

      setLoaded(true);
    });

    return () => {
      closePopup();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- popups -------------------------------------------------------------------
  function closePopup() {
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    if (popupRootRef.current) {
      const root = popupRootRef.current;
      popupRootRef.current = null;
      queueMicrotask(() => root.unmount());
    }
  }

  function openPopup(map, lngLat, node) {
    closePopup();
    const el = document.createElement("div");
    const root = createRoot(el);
    root.render(node);
    popupRootRef.current = root;
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "320px", offset: 8 })
      .setLngLat(lngLat)
      .setDOMContent(el)
      .addTo(map);
    popupRef.current.on("close", () => {
      if (popupRootRef.current === root) {
        popupRootRef.current = null;
        queueMicrotask(() => root.unmount());
      }
      popupRef.current = null;
    });
  }

  function handleClick(map, e) {
    const { onSetFrom, onSetTo, places } = callbacks.current;
    const hits = map.queryRenderedFeatures(e.point, { layers: ["features-point", "features-line", "buildings-fill"] });
    const feat = hits.find((h) => h.layer.id.startsWith("features")) ?? hits[0];

    if (feat) {
      const geo = { type: "Feature", properties: feat.properties, geometry: feat.geometry };
      let place;
      if (feat.layer.id === "buildings-fill") {
        place = buildingPlace(geo, places);
      } else {
        const c = feat.geometry.type === "Point" ? feat.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
        place = pointPlace(c[0], c[1], feat.properties.name || FEATURE_KINDS[feat.properties.kind]?.label || "Feature");
      }
      const anchor = feat.geometry.type === "Point" ? feat.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
      openPopup(
        map,
        anchor,
        <FeaturePopup
          feature={geo}
          onFrom={() => {
            onSetFrom(place);
            closePopup();
          }}
          onTo={() => {
            onSetTo(place);
            closePopup();
          }}
        />,
      );
      return;
    }

    // Plain map click: a dropped pin with From/To actions.
    const place = pointPlace(e.lngLat.lng, e.lngLat.lat);
    openPopup(
      map,
      e.lngLat,
      <div className="popup">
        <div className="popup-title">Dropped pin</div>
        <div className="popup-sub">
          {e.lngLat.lat.toFixed(5)}, {e.lngLat.lng.toFixed(5)}
        </div>
        <div className="popup-actions">
          <button
            type="button"
            className="btn btn-from"
            onClick={() => {
              onSetFrom(place);
              closePopup();
            }}
          >
            Directions from here
          </button>
          <button
            type="button"
            className="btn btn-to"
            onClick={() => {
              onSetTo(place);
              closePopup();
            }}
          >
            Directions to here
          </button>
        </div>
      </div>,
    );
  }

  // ---- static overlays --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !academicArea) return;
    map.getSource("academic-area").setData(academicArea);
    const ring = academicArea.features?.[0]?.geometry?.coordinates?.[0];
    if (ring) {
      map.getSource("mask").setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [WORLD, ring] },
      });
    }
  }, [loaded, academicArea]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !buildings) return;
    map.getSource("buildings").setData(buildings);
  }, [loaded, buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !features) return;
    map.getSource("features").setData(features);
  }, [loaded, features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const vis = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("features-point", showFeatures);
    vis("features-line", showFeatures);
    vis("buildings-fill", showBuildings);
    vis("buildings-outline", showBuildings);
    vis("buildings-label", showBuildings);
  }, [loaded, showFeatures, showBuildings]);

  // ---- from / to pins -----------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const sync = (ref, place, kind) => {
      if (!place) {
        ref.current?.remove();
        ref.current = null;
        return;
      }
      if (!ref.current) {
        ref.current = new maplibregl.Marker({ element: markerElement(kind), anchor: "bottom" }).setLngLat([place.lon, place.lat]).addTo(map);
      } else {
        ref.current.setLngLat([place.lon, place.lat]);
      }
    };
    sync(fromMarker, from, "from");
    sync(toMarker, to, "to");

    // Only one endpoint chosen so far: gently centre on it.
    if ((from && !to) || (!from && to)) {
      const p = from ?? to;
      map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16.5), duration: 500 });
    }
  }, [loaded, from, to]);

  // ---- route --------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    closePopup();
    if (!result) {
      map.getSource("route").setData(EMPTY);
      map.getSource("route-compare").setData(EMPTY);
      map.getSource("connectors").setData(EMPTY);
      return;
    }
    const { main, comparison } = result;
    map.getSource("route").setData(main.line);
    map.getSource("connectors").setData(main.connectors);
    map.getSource("route-compare").setData(comparison && !comparison.sameAsMain ? comparison.line : EMPTY);

    const coords = [...main.line.geometry.coordinates, [main.from.lon, main.from.lat], [main.to.lon, main.to.lat]];
    const b = coordsBbox(coords);
    const desktop = window.matchMedia("(min-width: 900px)").matches;
    map.fitBounds(bboxToBounds(b), {
      padding: desktop ? { top: 60, bottom: 60, left: 440, right: 60 } : { top: 80, bottom: 320, left: 40, right: 40 },
      maxZoom: 18,
      duration: 700,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, result]);

  // ---- hovered direction step ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    map.getSource("step").setData(
      hoveredStep?.coord ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: hoveredStep.coord } } : EMPTY,
    );
  }, [loaded, hoveredStep]);

  // ---- focus request from the panel (clicking a step) -----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !focus?.coord) return;
    map.easeTo({ center: focus.coord, zoom: Math.max(map.getZoom(), 18), duration: 600 });
  }, [loaded, focus]);

  return <div ref={containerRef} className="map" role="application" aria-label="Map of IIT Kanpur" />;
}
