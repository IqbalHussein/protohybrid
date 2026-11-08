"use client";

import { useActionState } from "react";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { disconnectGoogleAction, syncGoogleNow } from "./google-actions";

export function GoogleControls() {
  const [syncState, syncAction] = useActionState<ActionState>(syncGoogleNow, {});
  const [disconnectState, disconnectAction] = useActionState<ActionState>(disconnectGoogleAction, {});
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form action={syncAction}>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Syncing…">
            Sync now
          </SubmitButton>
        </form>
        <form action={disconnectAction}>
          <SubmitButton variant="danger" size="sm" pendingLabel="Disconnecting…">
            Disconnect
          </SubmitButton>
        </form>
      </div>
      <FormMessage state={syncState.error || syncState.ok ? syncState : disconnectState} />
    </div>
  );
}
