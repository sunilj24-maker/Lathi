"use client";

import { PROFILES, type ProfileId } from "@/data/config";

type Props = {
  value: ProfileId;
  onChange: (id: ProfileId) => void;
};

export function ProfilePicker({ value, onChange }: Props) {
  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Profile
      </legend>
      <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        {PROFILES.map((p) => {
          const active = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              onClick={() => onChange(p.id)}
              className={`rounded-md px-2 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
