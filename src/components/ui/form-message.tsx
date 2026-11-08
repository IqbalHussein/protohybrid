// Inline result of a form action. role=status/alert so screen readers hear it.
export type ActionState = { error?: string; ok?: boolean; message?: string };

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className="text-sm text-chalk-muted">
        {state.message}
      </p>
    );
  }
  return null;
}
