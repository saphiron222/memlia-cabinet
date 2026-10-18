import { DialogPopup } from "@makeplane/propel/elements/dialog";
/** Memlia adapters over the actual, unmodified Propel0.7.3 styled elements.
 * Native select behavior and current tab focus/URL handlers are retained via render.
 * Propel AGPL-3.0-only sources/CSS/maps are distributed in corresponding source.
 */
import type { ComponentProps } from "react";
import { SelectTrigger } from "@makeplane/propel/elements/select";
import { TextArea } from "@makeplane/propel/elements/text-area";
import { Tab } from "@makeplane/propel/elements/tabs";
export function NativeSelect(props: ComponentProps<"select">) {
  return <SelectTrigger size="lg" render={<select {...props} />} />;
}
export function TabButton(props: ComponentProps<"button">) {
  return (
    <Tab
      variant="underline"
      stretch="auto"
      render={
        <button {...props} data-active={props["aria-selected"] || undefined} />
      }
    />
  );
}

export function NativeTextArea(props: ComponentProps<"textarea">) {
  return (
    <TextArea size="lg" surface="field" render={<textarea {...props} />} />
  );
}

export function NativeDialog(props: ComponentProps<"dialog">) {
  return <DialogPopup size="lg" render={<dialog {...props} />} />;
}
