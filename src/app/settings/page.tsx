import Link from "next/link";
import { requireUser } from "@/lib/lift/queries";
import { getConflictRules, getSettings } from "@/lib/settings";
import { RULE_TYPE_LABELS, type RuleType } from "@/lib/conflicts";
import { getConnection } from "@/lib/integrations/oauth";
import { stravaConfigured } from "@/lib/integrations/strava";
import { googleConfigured } from "@/lib/integrations/google";
import { ConfirmButton } from "@/components/ConfirmButton";
import { RuleForm } from "@/components/RuleForm";
import { TimezoneField } from "@/components/TimezoneField";
import { deleteConflictRule, disconnect, saveSettings, syncNow, toggleConflictRule } from "./actions";

const ERRORS: Record<string, string> = {
  oauth_state: "The connection attempt expired or didn't match. Try again.",
  strava_not_configured: "Strava isn't configured: set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.",
  google_not_configured: "Google Calendar isn't configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  strava_denied: "Strava access was declined.",
  google_denied: "Google Calendar access was declined.",
  strava_scope: "Strava needs the “View data about your activities” permission to sync runs.",
  strava_failed: "Strava sync failed.",
  google_failed: "Google Calendar sync failed.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string; connected?: string; synced?: string; newRule?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireUser();
  const [settings, rules, strava, google] = await Promise.all([
    getSettings(),
    getConflictRules(),
    getConnection(supabase, "strava"),
    getConnection(supabase, "google"),
  ]);
  const newRule = (Object.keys(RULE_TYPE_LABELS) as RuleType[]).find((t) => t === params.newRule);

  const integrations = [
    {
      provider: "strava" as const,
      name: "Strava",
      blurb: "Pulls in completed runs (distance, pace, HR, elevation) and matches them to planned runs.",
      conn: strava,
      configured: stravaConfigured(),
    },
    {
      provider: "google" as const,
      name: "Google Calendar",
      blurb: "Imports busy events from your calendars so sessions can be planned around them.",
      conn: google,
      configured: googleConfigured(),
    },
  ];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      {params.error ? (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {ERRORS[params.error] ?? "Something went wrong."} {params.detail}
        </p>
      ) : params.connected || params.synced ? (
        <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          {params.connected ? `Connected ${params.connected === "google" ? "Google Calendar" : "Strava"}.` : "Synced."} {params.detail}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Preferences</h2>
        <form action={saveSettings} className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Timezone
            <TimezoneField defaultValue={settings.timezone} />
            <span className="text-xs text-neutral-500">Used for “today”, session times, and calendar events.</span>
          </label>
          <label className="flex flex-col gap-1">
            Default rest timer (seconds)
            <input
              name="defaultRestSeconds"
              inputMode="numeric"
              defaultValue={settings.default_rest_seconds}
              className="w-32 rounded border border-neutral-300 px-3 py-2 text-base"
            />
          </label>
          <button className="self-start rounded bg-neutral-900 px-4 py-2 text-white">Save</button>
        </form>
      </section>

      <section id="integrations" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Integrations</h2>
        {integrations.map(({ provider, name, blurb, conn, configured }) => (
          <div key={provider} className="flex flex-col gap-2 rounded border border-neutral-200 p-4 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium">{name}</h3>
              <span className={conn ? "text-green-700" : "text-neutral-400"}>
                {conn ? `Connected${conn.external_account_name ? ` as ${conn.external_account_name}` : ""}` : "Not connected"}
              </span>
            </div>
            <p className="text-neutral-600">{blurb}</p>
            {conn ? (
              <>
                <p className="text-xs text-neutral-500">
                  Last synced: {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString("en-US", { timeZone: settings.timezone }) : "never"}
                </p>
                <div className="flex gap-3">
                  <form action={syncNow}>
                    <input type="hidden" name="provider" value={provider} />
                    <button className="rounded bg-neutral-900 px-3 py-1.5 text-white">Sync now</button>
                  </form>
                  <form action={disconnect}>
                    <input type="hidden" name="provider" value={provider} />
                    <ConfirmButton message={`Disconnect ${name}?`} className="rounded border border-neutral-300 px-3 py-1.5">
                      Disconnect
                    </ConfirmButton>
                  </form>
                </div>
              </>
            ) : configured ? (
              // Plain link: the route handler redirects off-site to the provider.
              <a href={`/api/auth/${provider}`} className="self-start rounded bg-neutral-900 px-3 py-1.5 text-white">
                Connect {name}
              </a>
            ) : (
              <p className="text-xs text-neutral-500">
                Needs {provider === "strava" ? "STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET" : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"} in
                the server environment (see README).
              </p>
            )}
          </div>
        ))}
      </section>

      <section id="rules" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Conflict rules</h2>
        <p className="text-sm text-neutral-600">
          Checked against planned sessions on the calendar. Ad-hoc workouts and skipped sessions are never flagged.
        </p>
        {rules.map((rule) => (
          <details key={rule.id} className="rounded border border-neutral-200 p-3">
            <summary className="flex cursor-pointer items-baseline justify-between gap-2 text-sm">
              <span className={rule.enabled ? "font-medium" : "text-neutral-400 line-through"}>
                {rule.name ?? RULE_TYPE_LABELS[rule.rule_type]}
              </span>
              <span className="text-xs text-neutral-400">{rule.enabled ? "on" : "off"}</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <RuleForm rule={rule} ruleType={rule.rule_type} />
              <div className="flex gap-3 border-t border-neutral-100 pt-2 text-xs">
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
                className={`rounded border px-2 py-1 text-xs ${newRule === type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
              >
                {label}
              </Link>
            ))}
          </div>
          {newRule ? <RuleForm ruleType={newRule} /> : null}
        </div>
      </section>
    </main>
  );
}
