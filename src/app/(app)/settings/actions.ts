"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings";
import type { ActionState } from "@/components/ui/form-message";

export async function saveWeightUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const unit = String(formData.get("weight_unit") ?? "");
  if (unit !== "lb" && unit !== "kg") return { error: "Choose lb or kg." };

  const { supabase, user } = await requireUser();
  await getUserSettings(supabase, user.id);
  const { error } = await supabase.from("user_settings").update({ weight_unit: unit }).eq("user_id", user.id);
  if (error) return { error: `Unit not saved: ${error.message}` };

  revalidatePath("/", "layout");
  return { ok: true, message: `Weights now show in ${unit}.` };
}
