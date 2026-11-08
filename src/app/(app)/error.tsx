"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Shown when a page fails to load or a form action throws (e.g. a delete the
// database rejected). Next.js hides server error details in production.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-start gap-4 py-10">
      <h1 className="stretch-wide text-2xl font-extrabold">That didn&apos;t go through</h1>
      <p className="text-sm text-chalk-muted">
        Your last change wasn&apos;t saved, or this page couldn&apos;t load. Try again; if it keeps failing, reload the
        page to see the latest data.
      </p>
      {error.digest && <p className="text-xs text-chalk-faint">Reference: {error.digest}</p>}
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
