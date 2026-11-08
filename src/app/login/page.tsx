import { sendMagicLink } from "@/app/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Wordmark } from "@/components/wordmark";

const errorMessages: Record<string, string> = {
  email: "Enter your email address.",
  link: "That sign-in link is invalid or has expired. Request a new one.",
  send: "The sign-in link couldn't be sent.",
};

// A sample week of load, blue runs over orange lifts, as the page's one image.
const SAMPLE_WEEK: [number, number][] = [
  [40, 0],
  [0, 60],
  [55, 0],
  [25, 45],
  [0, 0],
  [90, 0],
  [0, 50],
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; message?: string }>;
}) {
  const { sent, error, message } = await searchParams;

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl content-center gap-12 px-6 py-16 lg:grid-cols-[1fr_22rem] lg:items-end">
      <div className="flex flex-col gap-10">
        <Wordmark />
        <h1 className="stretch-wide max-w-xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Your runs and lifts, planned as one week.
        </h1>
        <div aria-hidden className="flex h-28 items-end gap-2 sm:gap-3">
          {SAMPLE_WEEK.map(([run, lift], i) => (
            <div key={i} className="flex w-full max-w-12 flex-col justify-end gap-1">
              {run > 0 && <div className="rounded-sm bg-run" style={{ height: run }} />}
              {lift > 0 && <div className="rounded-sm bg-lift" style={{ height: lift }} />}
              {run + lift === 0 && <div className="h-1 rounded-sm bg-ink-line" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {sent ? (
          <div role="status" className="flex flex-col gap-2 rounded-panel border border-ink-line bg-ink-raised p-5">
            <h2 className="stretch-semi text-lg font-bold">Check your email</h2>
            <p className="text-sm text-chalk-muted">
              We sent you a sign-in link. Open it in this browser to continue.
            </p>
          </div>
        ) : (
          <form action={sendMagicLink} className="flex flex-col gap-4">
            <h2 className="stretch-semi text-lg font-bold">Sign in</h2>
            <Field label="Email" hint="We'll email you a one-time sign-in link.">
              <Input type="email" name="email" required autoComplete="email" />
            </Field>
            <SubmitButton pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessages[error] ?? "Sign-in failed. Try again."}
            {message ? ` (${message})` : null}
          </p>
        )}
      </div>
    </main>
  );
}
