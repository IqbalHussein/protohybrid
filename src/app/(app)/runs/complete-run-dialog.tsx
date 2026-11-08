"use client";

import type { ComponentProps } from "react";
import { CompleteRunForm } from "@/components/complete-run-form";
import { Dialog, useCloseDialog } from "@/components/ui/dialog";
import type { ButtonVariant } from "@/components/ui/button";

type FormProps = Omit<ComponentProps<typeof CompleteRunForm>, "onDone">;

function DialogBody(props: FormProps) {
  const close = useCloseDialog();
  return <CompleteRunForm {...props} onDone={close} />;
}

// Opens CompleteRunForm in a dialog that closes after a successful save.
export function CompleteRunDialog({
  trigger,
  title,
  triggerVariant = "run",
  ...props
}: FormProps & { trigger: string; title: string; triggerVariant?: ButtonVariant }) {
  return (
    <Dialog trigger={trigger} title={title} triggerVariant={triggerVariant} triggerSize="sm">
      <DialogBody {...props} />
    </Dialog>
  );
}
