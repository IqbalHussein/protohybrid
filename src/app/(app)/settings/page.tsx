import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings";
import { signOut } from "@/app/auth/actions";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { WeightUnitForm } from "./weight-unit-form";
import { ConflictRulesSection } from "./conflict-rules";
import { GoogleCalendarSection } from "./google-calendar";
import { BusyBlocksSection } from "./busy-blocks";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const { supabase, user } = await requireUser();
  const settings = await getUserSettings(supabase, user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <PageHeader title="Settings" />

      <section className="flex flex-col gap-4">
        <SectionTitle>Conflict warnings</SectionTitle>
        <ConflictRulesSection />
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>Calendar</SectionTitle>
        <GoogleCalendarSection status={google} />
        <BusyBlocksSection />
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>Weight unit</SectionTitle>
        <Panel>
          <WeightUnitForm current={settings.weight_unit} />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>Account</SectionTitle>
        <Panel className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-chalk-muted">
            Signed in as <span className="text-chalk">{user.email}</span>
          </p>
          <form action={signOut}>
            <SubmitButton variant="secondary" size="sm" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </Panel>
      </section>
    </div>
  );
}
