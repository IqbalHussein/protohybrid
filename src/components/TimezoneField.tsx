"use client";

import { useRef } from "react";

export function TimezoneField({ defaultValue }: { defaultValue: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="flex gap-2">
      <input
        ref={ref}
        name="timezone"
        defaultValue={defaultValue}
        required
        className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
      />
      <button
        type="button"
        onClick={() => {
          if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
        }}
        className="shrink-0 rounded border border-neutral-300 px-3 py-2 text-sm"
      >
        Use this device’s
      </button>
    </span>
  );
}
