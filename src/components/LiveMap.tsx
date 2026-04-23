"use client";

import {
  GoogleMap,
  InfoWindow,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import { useMemo, useState } from "react";
import type { LiveLocation } from "@/lib/types";

const containerStyle = {
  width: "100%",
  height: "100%",
};

const defaultCenter = { lat: 23.8103, lng: 90.4125 };

const MARKER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return MARKER_COLORS[Math.abs(hash) % MARKER_COLORS.length];
}

interface Props {
  locations: LiveLocation[];
}

export default function LiveMap({ locations }: Props) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "ride-tracker-map",
  });
  const [selected, setSelected] = useState<string | null>(null);

  const center = useMemo(() => {
    if (locations.length === 0) return defaultCenter;
    const avg = locations.reduce(
      (acc, l) => ({ lat: acc.lat + l.latitude, lng: acc.lng + l.longitude }),
      { lat: 0, lng: 0 },
    );
    return {
      lat: avg.lat / locations.length,
      lng: avg.lng / locations.length,
    };
  }, [locations]);

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-200 text-slate-600">
        Loading map...
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={locations.length > 0 ? 13 : 11}
      options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: true,
      }}
    >
      {locations.map((loc) => {
        const color = colorForUser(loc.userId);
        const svg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">
            <path d="M20 0C9 0 0 9 0 20c0 14 20 32 20 32s20-18 20-32C40 9 31 0 20 0z"
                  fill="${color}" stroke="white" stroke-width="2"/>
            <circle cx="20" cy="20" r="10" fill="white"/>
          </svg>
        `;
        return (
        <Marker
          key={loc.userId}
          position={{ lat: loc.latitude, lng: loc.longitude }}
          icon={{
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new window.google.maps.Size(40, 52),
            anchor: new window.google.maps.Point(20, 52),
            labelOrigin: new window.google.maps.Point(20, 20),
          }}
          label={{
            text: loc.name.charAt(0).toUpperCase(),
            color,
            fontWeight: "bold",
            fontSize: "14px",
          }}
          title={loc.name}
          onClick={() => setSelected(loc.userId)}
        >
          {selected === loc.userId && (
            <InfoWindow onCloseClick={() => setSelected(null)}>
              <div className="text-sm text-slate-800">
                <div className="font-bold">{loc.name}</div>
                <div className="text-xs">{loc.email}</div>
                <div className="mt-1">
                  {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                </div>
                {loc.speed !== null && (
                  <div>Speed: {loc.speed.toFixed(1)} m/s</div>
                )}
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(loc.updatedAt).toLocaleTimeString()}
                </div>
              </div>
            </InfoWindow>
          )}
        </Marker>
        );
      })}
    </GoogleMap>
  );
}
