// Two stacked bars, blue over orange: one training load, two disciplines.
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden className="flex h-5 w-2 flex-col gap-0.5">
        <span className="flex-[3] rounded-sm bg-run" />
        <span className="flex-[2] rounded-sm bg-lift" />
      </span>
      <span className="stretch-wide text-base font-extrabold tracking-tight">ProtoHybrid</span>
    </span>
  );
}
