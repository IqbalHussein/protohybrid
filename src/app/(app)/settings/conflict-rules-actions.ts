"use server";

// Server actions follow one pattern: validate the form here (so users get
// specific messages), call a database function or RLS-guarded table, then
// revalidate the pages that show the data. Ownership is enforced by RLS and
// the database functions, not here.

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { DEFAULT_RULE_NAMES } from "@/lib/conflicts";
import { RUN_TYPES, type ConflictRuleType, type RunType, type SessionType } from "@/lib/types";
import type { ActionState } from "@/components/ui/form-message";
import { isUuid } from "@/lib/lifts";

const RULE_TYPES: ConflictRuleType[] = ["min_hours_between", "no_back_to_back_hard", "max_days_without_rest", "busy_block_overlap"];
const HARD_RUNS: RunType[] = ["tempo", "interval", "long", "race"];
const HARD_LIFTS = ["legs", "lower", "full-body"];

type RuleFields = {
  session_type_a: SessionType | null;
  session_type_b: SessionType | null;
  params: Record<string, unknown>;
};

function revalidate() {
  revalidatePath("/settings");
  revalidatePath("/week");
}

function runTypes(fd: FormData, key: string): RunType[] | null {
  const values = fd.getAll(key).map(String);
  if (!values.every((v): v is RunType => (RUN_TYPES as readonly string[]).includes(v))) return null;
  return [...new Set(values)];
}

function focuses(fd: FormData, key: string): string[] | null {
  const values = fd.getAll(key).map((v) => String(v).trim().toLowerCase());
  if (values.length > 30 || values.some((v) => v === "" || v.length > 50)) return null;
  return [...new Set(values)];
}

function sessionType(value: FormDataEntryValue | null): SessionType | null | undefined {
  const v = String(value ?? "");
  if (v === "") return null;
  return v === "run" || v === "lift" ? v : undefined;
}

// Validates and builds the stored shape for each rule type.
function parseFields(type: ConflictRuleType, fd: FormData): RuleFields | { error: string } {
  switch (type) {
    case "min_hours_between": {
      const hours = Number(fd.get("hours"));
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) return { error: "Hours must be between 1 and 168." };
      const a = sessionType(fd.get("session_type_a"));
      const b = sessionType(fd.get("session_type_b"));
      if (a === undefined || b === undefined) return { error: "Choose run, lift or any session." };
      const aRun = runTypes(fd, "a_run_types");
      const bRun = runTypes(fd, "b_run_types");
      const aLift = focuses(fd, "a_lift_focus");
      const bLift = focuses(fd, "b_lift_focus");
      if (!aRun || !bRun) return { error: "Unknown run type." };
      if (!aLift || !bLift) return { error: "Lift focuses must be short names." };
      // A run filter means nothing for a lift-only side, and vice versa.
      return {
        session_type_a: a,
        session_type_b: b,
        params: {
          hours: Math.round(hours * 2) / 2,
          a_run_types: a === "lift" ? [] : aRun,
          a_lift_focus: a === "run" ? [] : aLift,
          b_run_types: b === "lift" ? [] : bRun,
          b_lift_focus: b === "run" ? [] : bLift,
        },
      };
    }
    case "no_back_to_back_hard": {
      const hardRun = runTypes(fd, "hard_run_types");
      const hardLift = focuses(fd, "hard_lift_focus");
      if (!hardRun) return { error: "Unknown run type." };
      if (!hardLift) return { error: "Lift focuses must be short names." };
      if (hardRun.length === 0 && hardLift.length === 0)
        return { error: "Choose at least one hard run type or lift focus." };
      return { session_type_a: null, session_type_b: null, params: { hard_run_types: hardRun, hard_lift_focus: hardLift } };
    }
    case "max_days_without_rest": {
      const maxDays = Number(fd.get("max_days"));
      if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 30)
        return { error: "Training days in a row must be a whole number from 1 to 30." };
      return { session_type_a: null, session_type_b: null, params: { max_days: maxDays } };
    }
    case "busy_block_overlap":
      return { session_type_a: null, session_type_b: null, params: {} };
  }
}

function defaults(type: ConflictRuleType): RuleFields {
  switch (type) {
    case "min_hours_between":
      return {
        session_type_a: "lift",
        session_type_b: "run",
        params: { hours: 24, a_run_types: [], a_lift_focus: HARD_LIFTS, b_run_types: HARD_RUNS, b_lift_focus: [] },
      };
    case "no_back_to_back_hard":
      return { session_type_a: null, session_type_b: null, params: { hard_run_types: HARD_RUNS, hard_lift_focus: HARD_LIFTS } };
    case "max_days_without_rest":
      return { session_type_a: null, session_type_b: null, params: { max_days: 6 } };
    case "busy_block_overlap":
      return { session_type_a: null, session_type_b: null, params: {} };
  }
}

export async function saveRule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { error: "Unknown rule." };
  const name = String(fd.get("name") ?? "").trim();
  if (name.length > 80) return { error: "Name must be 80 characters or fewer." };

  const { supabase } = await requireUser();
  const { data: existing, error: readError } = await supabase
    .from("conflict_rules")
    .select("rule_type")
    .eq("id", id)
    .maybeSingle<{ rule_type: ConflictRuleType }>();
  if (readError) return { error: `Rule not saved: ${readError.message}` };
  if (!existing || !RULE_TYPES.includes(existing.rule_type)) return { error: "Rule not found." };

  const fields = parseFields(existing.rule_type, fd);
  if ("error" in fields) return fields;

  const { error } = await supabase
    .from("conflict_rules")
    .update({ ...fields, name: name || null, enabled: fd.get("enabled") === "on" })
    .eq("id", id);
  if (error) return { error: `Rule not saved: ${error.message}` };
  revalidate();
  return { ok: true, message: "Rule saved." };
}

export async function toggleRule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { error: "Unknown rule." };
  const enabled = fd.get("enabled") === "true";
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("conflict_rules").update({ enabled }).eq("id", id).select("id");
  if (error) return { error: `Rule not changed: ${error.message}` };
  if (!data?.length) return { error: "Rule not found." };
  revalidate();
  return { ok: true, message: enabled ? "Rule turned on." : "Rule turned off." };
}

export async function addRule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const type = String(fd.get("rule_type") ?? "") as ConflictRuleType;
  if (!RULE_TYPES.includes(type)) return { error: "Choose a rule type." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("conflict_rules")
    .insert({ user_id: user.id, rule_type: type, name: DEFAULT_RULE_NAMES[type], enabled: true, ...defaults(type) });
  if (error) return { error: `Rule not added: ${error.message}` };
  revalidate();
  return { ok: true, message: "Rule added. Adjust it below." };
}

export async function deleteRule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { error: "Unknown rule." };
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("conflict_rules").delete().eq("id", id).select("id");
  if (error) return { error: `Rule not deleted: ${error.message}` };
  if (!data?.length) return { error: "Rule not found." };
  revalidate();
  return { ok: true, message: "Rule deleted." };
}
