"use client";

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "@/lib/cn";

const CloseContext = createContext<() => void>(() => {});

// Call inside dialog content (e.g. after a successful action) to close it.
export function useCloseDialog() {
  return useContext(CloseContext);
}

// Native <dialog> with its trigger button. Esc and the backdrop close it;
// focus returns to the trigger.
export function Dialog({
  trigger,
  triggerVariant = "secondary",
  triggerSize = "md",
  triggerClassName,
  triggerAriaLabel,
  title,
  children,
}: {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => ref.current?.close(), []);

  return (
    <>
      <button
        type="button"
        aria-label={triggerAriaLabel}
        className={triggerClassName ?? buttonClass(triggerVariant, triggerSize)}
        onClick={() => ref.current?.showModal()}
      >
        {trigger}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
        className={cn(
          "m-auto w-[min(100%-2rem,32rem)] rounded-panel border border-ink-line-strong bg-ink-raised p-0 text-chalk",
          "backdrop:bg-black/70",
        )}
      >
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="stretch-semi text-lg font-bold">{title}</h2>
            <button type="button" onClick={close} className={buttonClass("ghost", "sm")} aria-label="Close">
              Close
            </button>
          </div>
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </div>
      </dialog>
    </>
  );
}
