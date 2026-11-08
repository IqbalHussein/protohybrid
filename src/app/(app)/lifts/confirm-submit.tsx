"use client";

import { SubmitButton } from "@/components/ui/submit-button";
import type { ButtonSize, ButtonVariant } from "@/components/ui/button";

// Submit button that asks for confirmation first (for destructive actions).
export function ConfirmSubmit({
  children,
  confirmMessage,
  pendingLabel,
  variant = "danger",
  size = "sm",
}: {
  children: React.ReactNode;
  confirmMessage: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <SubmitButton
      variant={variant}
      size={size}
      pendingLabel={pendingLabel}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </SubmitButton>
  );
}
