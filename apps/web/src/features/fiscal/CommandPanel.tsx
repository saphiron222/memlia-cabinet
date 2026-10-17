import { NativeDialog } from "../../upstream/plane/controls";
import { useEffect, useRef } from "react";
import { Button } from "@memlia/ui";
import type { FiscalDetail, FiscalEvent } from "@memlia/contracts";
import { CommandForm } from "./CommandForm";
import { actionLabels } from "./labels";
import { ErrorSummary } from "../../forms";
export function CommandPanel({
  detail,
  busy,
  disabled,
  error,
  allowedKinds,
  onCommand,
  onClose,
}: {
  detail: FiscalDetail;
  busy: boolean;
  disabled: boolean;
  error: string;
  allowedKinds: FiscalEvent["kind"][];
  onCommand: (event: FiscalEvent) => Promise<boolean>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <NativeDialog
      ref={ref}
      className="record-panel fiscal-command-panel"
      aria-labelledby="fiscal-command-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2 id="fiscal-command-title">{actionLabels[allowedKinds[0]!]}</h2>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Fermer l’action
        </Button>
      </header>
      <p className="muted">{detail.record.title}</p>
      <ErrorSummary message={error || undefined} />
      <CommandForm
        detail={detail}
        busy={busy}
        disabled={disabled}
        allowedKinds={allowedKinds}
        onCommand={async (event) => {
          if (await onCommand(event)) onClose();
        }}
      />
    </NativeDialog>
  );
}
