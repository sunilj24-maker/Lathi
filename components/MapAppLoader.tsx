"use client";

import dynamic from "next/dynamic";

const MapApp = dynamic(() => import("./MapApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-slate-100 text-sm text-slate-600">
      Loading the IITK map…
    </div>
  ),
});

export default function MapAppLoader() {
  return <MapApp />;
}
