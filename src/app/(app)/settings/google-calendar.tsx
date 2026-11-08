import { requireUser } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";
import { CALLBACK_PATH, getConnection, googleConfig } from "@/lib/google";
import { formatDateLabel, formatTime, zonedParts } from "@/lib/time";
import { Panel } from "@/components/ui/panel";
import { buttonClass } from "@/components/ui/button";
import { GoogleControls } from "./google-controls";

const STATUS: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar connected and synced." },
  denied: { tone: "error", text: "Google access wasn't granted, so nothing was connected." },
  error: { tone: "error", text: "Google Calendar couldn't be connected. Try again." },
  missing_scope: {
    tone: "error",
    text: "Calendar access wasn't granted. Connect again and allow ProtoHybrid to see your calendar.",
  },
  sync_failed: { tone: "error", text: "Connected, but the first sync failed. Use Sync now to retry." },
  not_configured: { tone: "error", text: "Google Calendar isn't set up on this server yet." },
  reconnect: { tone: "error", text: "Google access expired. Connect again to keep syncing." },
};

// Shows Google Calendar connection state with connect / sync / disconnect.
export async function GoogleCalendarSection({ status }: { status?: string }) {
  const banner = status ? STATUS[status] : undefined;
  const configured = googleConfig() !== null;
  const { supabase, user } = await requireUser();
  const connection = configured ? await getConnection(supabase, user.id) : null;
  const tz = await getTimeZone();

  let lastSynced: string | null = null;
  if (connection?.last_synced_at) {
    const p = zonedParts(connection.last_synced_at, tz);
    lastSynced = `${formatDateLabel(p.date)} at ${formatTime(p.minutes)}`;
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Google Calendar</h3>
        <p className="max-w-prose text-sm text-chalk-muted">
          Timed events from your primary calendar show up as busy time on your week, so you can plan sessions
          around them. ProtoHybrid only reads your calendar.
        </p>
      </div>

      {banner && (
        <p role={banner.tone === "error" ? "alert" : "status"} className={banner.tone === "error" ? "text-sm text-danger" : "text-sm text-chalk"}>
          {banner.text}
        </p>
      )}

      {!configured ? (
        <div className="flex flex-col gap-2 text-sm text-chalk-muted">
          <p>To turn this on, create a Google OAuth client (web application) and set these environment variables:</p>
          <ul className="list-disc pl-5">
            <li>
              <code className="text-chalk">GOOGLE_CLIENT_ID</code> and <code className="text-chalk">GOOGLE_CLIENT_SECRET</code>
            </li>
          </ul>
          <p>Add these authorized redirect URIs to the OAuth client:</p>
          <ul className="list-disc pl-5">
            <li>
              <code className="text-chalk">http://localhost:3000{CALLBACK_PATH}</code>
            </li>
            <li>
              <code className="text-chalk">https://protohybrid.vercel.app{CALLBACK_PATH}</code>
            </li>
          </ul>
        </div>
      ) : connection ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-chalk-faint">Account</dt>
            <dd>{connection.external_account_name ?? "Connected"}</dd>
            <dt className="text-chalk-faint">Last synced</dt>
            <dd>{lastSynced ?? "Not yet"}</dd>
          </dl>
          <GoogleControls />
        </div>
      ) : (
        <div>
          {/* Plain link: the OAuth start route redirects off-site. */}
          <a href="/api/auth/google" className={buttonClass("secondary")}>
            Connect Google Calendar
          </a>
        </div>
      )}
    </Panel>
  );
}
