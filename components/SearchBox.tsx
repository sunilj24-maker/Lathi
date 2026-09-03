"use client";

import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/types";

type Props = {
  label: string;
  places: Place[];
  value: Place | null;
  onChange: (place: Place | null) => void;
};

export function SearchBox({ label, places, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const shown = value ? value.name : query;

  const fuse = useMemo(
    () =>
      new Fuse(places, {
        keys: ["name", "kind"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [places],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return places.slice(0, 8);
    return fuse.search(q).slice(0, 8).map((r) => r.item);
  }, [fuse, places, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <input
        value={shown}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Building, entrance, landmark"
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:ring-2"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50"
                onClick={() => {
                  onChange(place);
                  setQuery(place.name);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-slate-900">{place.name}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-400">
                  {place.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
