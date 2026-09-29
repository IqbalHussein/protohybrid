import Link from "next/link";
import ConfirmButton from "@/components/ConfirmButton";
import RuleForm from "@/components/settings/RuleForm";
import { requireUser } from "@/lib/auth";
import { RULE_TYPES, RULE_TYPE_LABELS, type RuleType } from "@/lib/calendar/conflicts";
import { getConflictRules } from "@/lib/calendar/rules";
import { calendarsToSync, googleConfigured, listGoogleCalendars, type GoogleCalendar } from "@/lib/integrations/google";
import { getConnection, PROVIDER_NAMES, type Provider } from "@/lib/integrations/oauth";
import { stravaConfigured } from "@/lib/integrations/strava";
import { APP_TIME_ZONE } from "@/lib/time";
import { deleteConflictRule, disconnect, saveGoogleCalendars, syncNow, toggleConflictRule } from "./actions";

const ERRORS: Record<string, string> = {
  oauth_state: "The connection attempt expired or didn't come from this browser. Try again.",
  strava_not_configured: "Strava isn't set up: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are missing.",
  google_not_configured: "Google Calendar isn't set up: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.",
  strava_denied: "Strava access was declined.",
  google_denied: "Google Calendar access was declined.",
  strava_scope: "Strava needs the “View data about your activities” permission to sync runs.",
  strava_failed: "Strava sync failed.",
  google_failed: "Google Calendar sync failed.",
};

const BLURBS: Record<Provider, string> = {
  strava: "Pulls in completed runs (distance, pace, heart rate, elevation) and matches them to the runs you planned.",
  google: "Imports the events you're busy for, so sessions get planned around classes and shifts.",
};

const ENV_VARS: Record<Provider, string> = {
  strava: "STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET",
  google: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string; connected?: string; synced?: string; newRule?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireUser();
  const [rules, strava, google] = await Promise.all([
    getConflictRules(),
    getConnection(supabase, "strava"),
    getConnection(supabase, "google"),
  ]);

  // The picker needs Google's live calendar list. A failure here (expired
  // grant, Google down) shouldn't take the whole Settings page with it.
  let calendars: GoogleCalendar[] | null = null;
  let calendarsError: string | null = null;
  if (google) {
    try {
      calendars = await listGoogleCalendars(supabase, user.id);
    } catch (e) {
      calendarsError = e instanceof Error ? e.message : "Could not load your calendars.";
    }
  }
  const newRule = RULE_TYPES.find((t) => t === params.newRule);
  const done = (params.connected ?? params.synced) as Provider | undefined;

  const integrations = [
    { provider: "strava" as const, connection: strava, configured: stravaConfigured() },
    { provider: "google" as const, connection: google, configured: googleConfigured() },
  ];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <span className="flex gap-3 text-sm text-neutral-500">
          <Link href="/calendar" className="underline">
            Week
          </Link>
          <Link href="/" className="underline">
            Home
          </Link>
        </span>
      </header>

      {params.error ? (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {ERRORS[params.error] ?? "Something went wrong."} {params.detail}
        </p>
      ) : done && done in PROVIDER_NAMES ? (
        <p role="status" className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          {params.connected ? `Connected ${PROVIDER_NAMES[done]}.` : `Synced ${PROVIDER_NAMES[done]}.`} {params.detail}
        </p>
      ) : null}

      <section id="rules" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Conflict rules</h2>
        <p className="text-sm text-neutral-600">
          Checked against planned sessions on the week calendar. Workouts started from the home page, runs imported
          without a plan, and skipped sessions are never flagged.
        </p>

        {rules.length === 0 ? <p className="text-sm text-neutral-500">No rules. Add one below.</p> : null}

        {rules.map((rule) => (
          <details key={rule.id} className="rounded border border-neutral-200 p-3">
            <summary className="flex cursor-pointer items-baseline justify-between gap-2 text-sm">
              <span className={rule.enabled ? "font-medium" : "text-neutral-400 line-through"}>
                {rule.name ?? RULE_TYPE_LABELS[rule.rule_type]}
              </span>
              <span className="text-xs text-neutral-400">{rule.enabled ? "On" : "Off"}</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <RuleForm rule={rule} ruleType={rule.rule_type} />
              <div className="flex gap-4 border-t border-neutral-100 pt-2 text-xs">
                <form action={toggleConflictRule}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <input type="hidden" name="enabled" value={String(!rule.enabled)} />
                  <button className="underline">{rule.enabled ? "Turn off" : "Turn on"}</button>
                </form>
                <form action={deleteConflictRule}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <ConfirmButton message="Delete this rule?" className="text-red-600 underline">
                    Delete
                  </ConfirmButton>
                </form>
              </div>
            </div>
          </details>
        ))}

        <div className="flex flex-col gap-2 rounded border border-dashed border-neutral-300 p-3 text-sm">
          <span className="font-medium">Add a rule</span>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(RULE_TYPE_LABELS) as [RuleType, string][]).map(([type, label]) => (
              <Link
                key={type}
                href={`/settings?newRule=${type}#rules`}
                className={`rounded border px-2 py-1 text-xs ${
                  newRule === type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
          {newRule ? <RuleForm key={newRule} ruleType={newRule} /> : null}
        </div>
      </section>

      <section id="integrations" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Integrations</h2>
        {integrations.map(({ provider, connection, configured }) => (
          <div key={provider} className="flex flex-col gap-2 rounded border border-neutral-200 p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{PROVIDER_NAMES[provider]}</h3>
              <span className={connection ? "text-green-700" : "text-neutral-400"}>
                {connection
                  ? `Connected${connection.external_account_name ? ` as ${connection.external_account_name}` : ""}`
                  : "Not connected"}
              </span>
            </div>
            <p className="text-neutral-600">{BLURBS[provider]}</p>

            {connection ? (
              <>
                <p className="text-xs text-neutral-500">
                  Last synced:{" "}
                  {connection.last_synced_at
                    ? new Date(connection.last_synced_at).toLocaleString("en-US", { timeZone: APP_TIME_ZONE })
                    : "never"}
                </p>
                {provider === "google" ? (
                  <CalendarPicker
                    calendars={calendars}
                    error={calendarsError}
                    chosen={calendars ? calendarsToSync(calendars, connection.calendar_ids) : []}
                  />
                ) : null}
                <div className="flex gap-3">
                  <form action={syncNow}>
                    <input type="hidden" name="provider" value={provider} />
                    <button className="rounded bg-neutral-900 px-3 py-1.5 text-white">Sync now</button>
                  </form>
                  <form action={disconnect}>
                    <input type="hidden" name="provider" value={provider} />
                    <ConfirmButton
                      message={
                        provider === "google"
                          ? "Disconnect Google Calendar? Its events will be removed from your week."
                          : "Disconnect Strava? Runs already imported stay."
                      }
                      className="rounded border border-neutral-300 px-3 py-1.5"
                    >
                      Disconnect
                    </ConfirmButton>
                  </form>
                </div>
              </>
            ) : configured ? (
              // A plain link, not <Link>: the route redirects off-site to the provider.
              <a href={`/api/auth/${provider}`} className="self-start rounded bg-neutral-900 px-3 py-1.5 text-white">
                Connect {PROVIDER_NAMES[provider]}
              </a>
            ) : (
              <p className="text-xs text-neutral-500">
                Needs {ENV_VARS[provider]} in the server environment. See the README.
              </p>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}

/**
 * Which calendars count as commitments. Your own are listed first; a calendar
 * someone else shares with you is labelled, since its events are theirs.
 */
function CalendarPicker({
  calendars,
  error,
  chosen,
}: {
  calendars: GoogleCalendar[] | null;
  error: string | null;
  chosen: string[];
}) {
  if (error) return <p className="text-xs text-red-700">Couldn&apos;t load your calendars: {error}</p>;
  if (!calendars?.length) return null;

  const own = (c: GoogleCalendar) => c.primary || c.accessRole === "owner";
  const sorted = [...calendars].sort(
    (a, b) => Number(!!b.primary) - Number(!!a.primary) || Number(own(b)) - Number(own(a)) ||
      (a.summary ?? a.id).localeCompare(b.summary ?? b.id),
  );

  return (
    <form action={saveGoogleCalendars} className="flex flex-col gap-1.5 rounded bg-neutral-50 p-3">
      <input type="hidden" name="provider" value="google" />
      <span className="text-xs text-neutral-500">Import events from:</span>
      {sorted.map((c) => (
        <label key={c.id} className="flex items-center gap-2">
          <input type="checkbox" name="calendarId" value={c.id} defaultChecked={chosen.includes(c.id)} />
          <span className="min-w-0 truncate">{c.summary ?? c.id}</span>
          {c.primary ? (
            <span className="text-xs text-neutral-400">primary</span>
          ) : own(c) ? null : (
            <span className="text-xs text-neutral-400">shared with you</span>
          )}
        </label>
      ))}
      <button className="self-start rounded border border-neutral-900 px-3 py-1 text-xs">Save and sync</button>
    </form>
  );
}
