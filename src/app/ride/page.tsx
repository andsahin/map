"use client";

import {
  Autocomplete,
  GoogleMap,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type DriverVehicle = "bike" | "car" | "cng";
interface NearbyDriver {
  driverId: string;
  lat: number;
  lng: number;
  vehicleType: DriverVehicle;
  rating: number;
  heading: number;
}
interface NearestResponse {
  drivers: NearbyDriver[];
}

const VEHICLE_LOGO: Record<DriverVehicle, string> = {
  car: "/logos/car.png",
  bike: "/logos/bike.png",
  cng: "/logos/cng.png",
};

// Cache of background-removed logos as data URLs.
const transparentLogoCache = new Map<DriverVehicle, string>();
const transparentLogoPending = new Map<DriverVehicle, Promise<string>>();

/**
 * Loads a logo PNG, removes near-white / blue-ish background pixels via canvas,
 * and returns a transparent PNG data URL. Result is cached per vehicle.
 */
function getTransparentLogo(vehicle: DriverVehicle): Promise<string> {
  const cached = transparentLogoCache.get(vehicle);
  if (cached) return Promise.resolve(cached);
  const pending = transparentLogoPending.get(vehicle);
  if (pending) return pending;

  const url = VEHICLE_LOGO[vehicle];
  const promise = new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(url);
      ctx.drawImage(img, 0, 0);
      try {
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i];
          const g = px[i + 1];
          const b = px[i + 2];
          // Treat blue-dominant pixels OR near-white pixels as background.
          const isBlueBg = b > 110 && b > r + 25 && b > g + 10;
          const isLightBg = r > 235 && g > 235 && b > 235;
          if (isBlueBg || isLightBg) {
            px[i + 3] = 0; // transparent
          }
        }
        ctx.putImageData(data, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(url);
      }
    };
    img.onerror = reject;
    img.src = url;
  })
    .then((result) => {
      transparentLogoCache.set(vehicle, result);
      transparentLogoPending.delete(vehicle);
      return result;
    })
    .catch((err) => {
      transparentLogoPending.delete(vehicle);
      throw err;
    });

  transparentLogoPending.set(vehicle, promise);
  return promise;
}

const LIBRARIES: ("places")[] = ["places"];
const FALLBACK_CENTER = { lat: 23.8554, lng: 90.3758 };

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

  // Always use live location, never fallback to static or localStorage
  useEffect(() => {
    let watchId: number | null = null;
    function update(pos: GeolocationPosition) {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      console.log("Got location update:", loc);
      setCenter(loc);
      setMyLocation(loc);
    }
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        update,
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    }
    return () => {
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
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
  const driverMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Render / refresh nearby driver markers whenever location changes (poll every 5s)
  useEffect(() => {
    if (!isLoaded || !myLocation) return;
    let cancelled = false;

    async function refresh() {
      try {
        const data = await api.get<NearestResponse>(
          `/drivers/nearest?riderLat=${myLocation!.lat}&riderLng=${myLocation!.lng}&maxResults=10`,
        );
        if (cancelled || !mapRef.current) return;

        // Spread out drivers that share (almost) the same coordinates so
        // their markers don't stack on the map. Offsets are deterministic
        // per (lat,lng) bucket so positions stay stable across polls.
        const SAME_SPOT_M = 25; // bucket size in metres
        const SPREAD_M = 30;    // ring radius for fanned-out markers
        const buckets = new Map<string, NearbyDriver[]>();
        for (const d of data.drivers ?? []) {
          // ~0.0001 deg ≈ 11 m, so dividing by 0.00025 ≈ 27 m buckets
          const key = `${(d.lat / 0.00025).toFixed(0)}:${(d.lng / 0.00025).toFixed(0)}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(d);
        }
        const renderPos = new Map<string, { lat: number; lng: number }>();
        for (const group of buckets.values()) {
          if (group.length === 1) {
            const d = group[0];
            renderPos.set(d.driverId, { lat: d.lat, lng: d.lng });
            continue;
          }
          // Sort to keep stable ordering, then fan out around the centroid
          group.sort((a, b) => a.driverId.localeCompare(b.driverId));
          const cLat = group.reduce((s, d) => s + d.lat, 0) / group.length;
          const cLng = group.reduce((s, d) => s + d.lng, 0) / group.length;
          const dLat = SPREAD_M / 111_320; // metres → degrees latitude
          const dLng =
            SPREAD_M / (111_320 * Math.cos((cLat * Math.PI) / 180));
          group.forEach((d, idx) => {
            const angle = (2 * Math.PI * idx) / group.length;
            renderPos.set(d.driverId, {
              lat: cLat + Math.sin(angle) * dLat,
              lng: cLng + Math.cos(angle) * dLng,
            });
          });
        }
        void SAME_SPOT_M;

        const seen = new Set<string>();
        for (const d of data.drivers ?? []) {
          seen.add(d.driverId);
          const existing = driverMarkersRef.current.get(d.driverId);
          const iconUrl = await getTransparentLogo(d.vehicleType).catch(
            () => VEHICLE_LOGO[d.vehicleType] ?? VEHICLE_LOGO.car,
          );
          if (cancelled || !mapRef.current) return;
          const icon: google.maps.Icon = {
            url: iconUrl,
            scaledSize: new google.maps.Size(56, 56),
            anchor: new google.maps.Point(28, 28),
          };
          const pos = renderPos.get(d.driverId) ?? { lat: d.lat, lng: d.lng };
          if (existing) {
            existing.setPosition(pos);
            existing.setIcon(icon);
          } else {
            const marker = new google.maps.Marker({
              position: pos,
              map: mapRef.current,
              icon,
              title: `${d.vehicleType.toUpperCase()} \u2605 ${d.rating.toFixed(1)}`,
              zIndex: 8,
            });
            driverMarkersRef.current.set(d.driverId, marker);
          }
        }
        // Remove markers no longer present
        for (const [id, marker] of driverMarkersRef.current) {
          if (!seen.has(id)) {
            marker.setMap(null);
            driverMarkersRef.current.delete(id);
          }
        }
      } catch {
        // ignore polling errors silently
      }
    }

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoaded, myLocation]);

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
