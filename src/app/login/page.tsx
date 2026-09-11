"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(signIn, null);

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
      <div>
        <h1 className="text-2xl font-semibold">ProtoHybrid</h1>
        <p className="mt-1 text-sm text-neutral-600">Sign in to your training log.</p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
