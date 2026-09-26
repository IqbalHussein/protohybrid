"use client";

import type { ComponentProps } from "react";

// A submit button that asks before running a destructive form action.
export function ConfirmButton({
  message,
  onClick,
  ...props
}: ComponentProps<"button"> & { message: string }) {
  return (
    <button
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
        onClick?.(e);
      }}
    />
  );
}
