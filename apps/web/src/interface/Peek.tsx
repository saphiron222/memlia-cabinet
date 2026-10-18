import { PeekView } from "../upstream/plane/peek-view";
import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
export function Peek({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <PeekView
      ref={ref}
      className="context-peek"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button
        className="peek-close"
        aria-label="Fermer le détail"
        onClick={onClose}
      >
        <IconX size={18} />
      </button>
      {children}
    </PeekView>
  );
}
