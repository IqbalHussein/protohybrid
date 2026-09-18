"use client";

/**
 * Submit button for a destructive form action.
 *
 * Deleting a workout or a routine can't be undone, and the server actions do
 * it without a second step, so the confirmation lives here. `confirm` blocks
 * submission when dismissed, which is the whole behaviour — no state needed.
 */
export default function ConfirmButton({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
