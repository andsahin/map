"use client";

import {
  Autocomplete,
  GoogleMap,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import { useCallback, useEffect, useRef, useState } from "react";

const LIBRARIES: ("places")[] = ["places"];
const FALLBACK_CENTER = { lat: 23.7554, lng: 90.3758 };

type LatLng = { lat: number; lng: number };

interface RouteInfo {
  path: LatLng[];
  duration: string;
  distance: string;
  origin: LatLng;
  destination: LatLng;
  originName: string;
  destinationName: string;
}

// Decode Google-compatible polyline (used by OSRM overview geometry)
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} hr ${rem} min` : `${h} hr`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

async function geocodeAddress(address: string): Promise<LatLng> {
  const geocoder = new google.maps.Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      } else {
        reject(new Error(`Could not geocode: ${address}`));
      }
    });
  });
}

export default function RidePage() {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "ride-route-map",
    libraries: LIBRARIES,
  });

  const [center, setCenter] = useState<LatLng>(FALLBACK_CENTER);
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(loc);
        setMyLocation(loc);
      },
      () => {/* permission denied — keep fallback */},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  async function useMyLocation() {
    setLocLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLocation(loc);
        setCenter(loc);
        mapRef.current?.panTo(loc);
        try {
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: loc }, (results, status) => {
            const READABLE = [
              "street_address",
              "route",
              "neighborhood",
              "sublocality",
              "sublocality_level_1",
              "locality",
              "administrative_area_level_2",
            ];
            const best =
              status === "OK" && results
                ? (results.find((r) =>
                    r.types.some((t) => READABLE.includes(t)),
                  ) ?? results[0])
                : null;
            const label = best
              ? best.formatted_address
              : `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
            if (originInputRef.current) originInputRef.current.value = label;
          });
        } finally {
          setLocLoading(false);
        }
      },
      () => {
        setError("Location permission denied.");
        setLocLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const originAcRef = useRef<google.maps.places.Autocomplete | null>(null);
  const destAcRef = useRef<google.maps.places.Autocomplete | null>(null);
  type SavedPlace = { place: google.maps.places.PlaceResult; text: string };
  const originPlaceRef = useRef<SavedPlace | null>(null);
  const destPlaceRef = useRef<SavedPlace | null>(null);
  const originInputRef = useRef<HTMLInputElement | null>(null);
  const destInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const originMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  function clearMapOverlays() {
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
    originMarkerRef.current?.setMap(null);
    originMarkerRef.current = null;
    destMarkerRef.current?.setMap(null);
    destMarkerRef.current = null;
  }

  async function resolveCoords(
    placeRef: React.RefObject<SavedPlace | null>,
    inputText: string,
  ): Promise<{ coords: LatLng; name: string }> {
    const saved = placeRef.current;
    // Only use the stored place when the input text still matches what was selected
    if (saved?.place?.geometry?.location && saved.text === inputText) {
      const loc = saved.place.geometry.location;
      return {
        coords: { lat: loc.lat(), lng: loc.lng() },
        name: saved.place.formatted_address ?? saved.place.name ?? inputText,
      };
    }
    const coords = await geocodeAddress(inputText);
    return { coords, name: inputText };
  }

  async function calculateRoute() {
    const originText = originInputRef.current?.value.trim() ?? "";
    const destText = destInputRef.current?.value.trim() ?? "";

    if (!originText || !destText) {
      setError("Please enter both pickup and destination.");
      return;
    }

    // Remove previous overlays from the map immediately — no React render cycle
    clearMapOverlays();
    setRoute(null);
    setLoading(true);
    setError(null);

    try {
      const [originResult, destResult] = await Promise.all([
        resolveCoords(originPlaceRef, originText),
        resolveCoords(destPlaceRef, destText),
      ]);

      const { coords: origin, name: originName } = originResult;
      const { coords: destination, name: destinationName } = destResult;

      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
        `?overview=full&geometries=polyline`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Routing service unavailable.");
      const data = await res.json();
      console.log('osrm-return', data);
      if (data.code !== "Ok" || !data.routes?.length) {
        throw new Error("No route found between these locations.");
      }

      const osrmRoute = data.routes[0];
      const path = decodePolyline(osrmRoute.geometry as string);
      const map = mapRef.current;
      console.log('first', map);
      // Draw polyline imperatively
      polylineRef.current = new google.maps.Polyline({
        path,
        map,
        strokeColor: "#1e293b",
        strokeWeight: 5,
        strokeOpacity: 0.9,
      });

      // Origin marker — car icon
      originMarkerRef.current = new google.maps.Marker({
        position: origin,
        map,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(carSvg)}`,
          scaledSize: new google.maps.Size(38, 38),
          anchor: new google.maps.Point(19, 19),
        },
        zIndex: 10,
      });

      // Destination marker — arrow pin
      destMarkerRef.current = new google.maps.Marker({
        position: destination,
        map,
        icon: {
          path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 8,
          fillColor: "#1e293b",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 10,
      });

      const bounds = new google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map?.fitBounds(bounds, 80);

      setRoute({
        path,
        origin,
        destination,
        originName,
        destinationName,
        duration: formatDuration(osrmRoute.duration as number),
        distance: formatDistance(osrmRoute.distance as number),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find route.");
    } finally {
      setLoading(false);
    }
  }

  function clearRoute() {
    clearMapOverlays();
    setRoute(null);
    setError(null);
    originPlaceRef.current = null;
    destPlaceRef.current = null;
    if (originInputRef.current) originInputRef.current.value = "";
    if (destInputRef.current) destInputRef.current.value = "";
  }

  const carSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="18" fill="#1e293b" stroke="white" stroke-width="2"/><text x="19" y="24" text-anchor="middle" font-size="18" fill="white">🚗</text></svg>`;

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-600 text-lg">
        Loading map…
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-200">
      {/* Full-screen map */}
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%" }}
        center={route ? route.origin : center}
        zoom={13}
        onLoad={onMapLoad}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          zoomControl: true,
          zoomControlOptions: { position: 7 },
        }}
      >
        {/* My location pin — always visible */}
        {myLocation && (
          <Marker
            position={myLocation}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            }}
            zIndex={5}
          />
        )}

        {/* Route polyline + markers drawn imperatively via polylineRef/originMarkerRef/destMarkerRef */}
      </GoogleMap>

      {/* Search panel */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4">
        <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 space-y-2">
            {/* From */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-white shadow" />
                <div className="w-0.5 h-5 bg-slate-300" />
              </div>
              <Autocomplete
                onLoad={(ac) => (originAcRef.current = ac)}
                onPlaceChanged={() => {
                  const place = originAcRef.current?.getPlace();
                  originPlaceRef.current = place?.geometry
                    ? { place, text: originInputRef.current?.value ?? "" }
                    : null;
                }}
                options={{ componentRestrictions: { country: "bd" } }}
                className="flex-1"
              >
                <input
                  ref={originInputRef}
                  type="text"
                  placeholder="From — pickup location"
                  className="w-full text-sm text-slate-800 placeholder-slate-400 outline-none bg-slate-50 rounded-lg px-3 py-2 border border-slate-200 focus:border-blue-400 pr-9"
                />
              </Autocomplete>
              <button
                onClick={useMyLocation}
                disabled={locLoading}
                title="Use my current location"
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 disabled:opacity-50 transition-colors"
              >
                {locLoading ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                    <circle cx="12" cy="12" r="8" strokeDasharray="2 4"/>
                  </svg>
                )}
              </button>
            </div>

            {/* To */}
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <div className="w-3 h-3 rounded-sm bg-slate-800 border-2 border-white shadow" />
              </div>
              <Autocomplete
                onLoad={(ac) => (destAcRef.current = ac)}
                onPlaceChanged={() => {
                  const place = destAcRef.current?.getPlace();
                  destPlaceRef.current = place?.geometry
                    ? { place, text: destInputRef.current?.value ?? "" }
                    : null;
                }}
                options={{ componentRestrictions: { country: "bd" } }}
                className="flex-1"
              >
                <input
                  ref={destInputRef}
                  type="text"
                  placeholder="To — destination"
                  className="w-full text-sm text-slate-800 placeholder-slate-400 outline-none bg-slate-50 rounded-lg px-3 py-2 border border-slate-200 focus:border-blue-400"
                />
              </Autocomplete>
            </div>
          </div>

          {error && (
            <p className="px-4 text-xs text-red-600">{error}</p>
          )}

          <div className="px-4 pb-4 pt-2 flex gap-2">
            <button
              onClick={calculateRoute}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-60 transition-colors"
            >
              {loading ? "Finding route…" : "Find Route"}
            </button>
            {route && (
              <button
                onClick={clearRoute}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating info cards */}
      {route && (
        <>
          {/* Duration + origin pill */}
          <div className="absolute top-55 left-4 z-10 flex items-center gap-2">
            <div className="bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
              {route.duration}
            </div>
            <div className="bg-white text-slate-800 text-sm font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              From {shortName(route.originName)}
              <span className="text-slate-400">›</span>
            </div>
          </div>

          {/* Destination pill */}
          <div className="absolute bottom-24 right-4 z-10">
            <div className="bg-white text-slate-800 text-sm font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-slate-800 shrink-0" />
              To {shortName(route.destinationName)}
              <span className="text-slate-400">›</span>
            </div>
          </div>

          {/* Bottom strip */}
          <div className="absolute bottom-0 left-0 right-0 z-10 bg-white border-t border-slate-200 px-5 py-4 shadow-2xl">
            <div className="max-w-md mx-auto flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Route summary</p>
                <p className="text-base font-bold text-slate-900">
                  {route.distance}&nbsp;·&nbsp;{route.duration}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 truncate max-w-55">
                  {shortName(route.originName)} → {shortName(route.destinationName)}
                </p>
              </div>
              <button className="bg-slate-900 text-white text-sm font-semibold px-5 py-3 rounded-xl hover:bg-slate-700 transition-colors">
                Book Ride
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function shortName(address: string): string {
  const first = address.split(",")[0].trim();
  return first.length > 28 ? first.slice(0, 26) + "…" : first;
}
