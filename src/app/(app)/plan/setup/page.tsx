import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { loadProfile } from "../data";
import { ProfileForm } from "./profile-form";

// One screen: preset, focus mix, availability, goal, experience.
export default async function PlanSetupPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={profile ? "Edit profile" : "Build your plan"}
        description="Answer a few questions and get a 4-week plan. You can change anything afterwards."
        actions={
          profile && (
            <Link href="/plan" className={buttonClass("ghost", "md", "h-11")}>
              Cancel
            </Link>
          )
        }
      />
      <ProfileForm initial={profile} />
    </div>
  );
}
