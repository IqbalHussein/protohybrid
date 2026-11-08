import { requireUser } from "@/lib/auth";
import { ensureDefaultConflictRules } from "@/lib/settings";
import type { ConflictRule } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { describeRule } from "./conflict-rules-describe";
import { AddRuleForm, RuleEditor } from "./conflict-rules-form";

// Conflict rules editor for the settings page. Seeds the default rules the
// first time it is shown.
export async function ConflictRulesSection() {
  const { supabase } = await requireUser();
  const seedError = await ensureDefaultConflictRules(supabase);
  const { data, error } = await supabase
    .from("conflict_rules")
    .select("*")
    .order("created_at")
    .returns<ConflictRule[]>();
  const rules = data ?? [];
  const loadError = seedError ?? error?.message;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-chalk-muted">
        The week view warns you when your plan breaks one of these rules. Sessions without a start time count as starting
        at noon and lasting an hour.
      </p>
      {loadError && (
        <p role="alert" className="text-sm text-danger">
          Rules couldn&apos;t be loaded: {loadError}
        </p>
      )}
      {!loadError && rules.length === 0 && <EmptyState>No rules yet. Add one below to start getting warnings.</EmptyState>}
      {rules.map((rule) => (
        <RuleEditor key={rule.id} rule={rule} description={describeRule(rule)} />
      ))}
      <AddRuleForm />
    </div>
  );
}
