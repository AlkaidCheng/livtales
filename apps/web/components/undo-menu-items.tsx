"use client";

import { useTranslations } from "next-intl";
import { describeCommand } from "../lib/commands";
import { undoShortcuts } from "../lib/keyboard";
import { useCommandState, useCommandTransition } from "../lib/queries";
import { useStepRefusalNotice } from "../lib/undo-refusal";
import { RedoIcon, UndoIcon } from "./icons";
import { MenuItem } from "./quiet-menu";

/**
 * Undo edit and Redo edit for a page's More menu: the caller's content
 * command stack in this workspace. Each item shows its keys and names the
 * command this browser ran, or why it will not run: nothing to undo, or an
 * edit by someone else since, which pressing it explains and takes off the
 * list.
 */
export function UndoMenuItems() {
  const t = useTranslations("undo");
  const shortcuts = undoShortcuts();
  const state = useCommandState();
  const undo = useCommandTransition("undo", useStepRefusalNotice("undo"));
  const redo = useCommandTransition("redo", useStepRefusalNotice("redo"));
  const item = (direction: "undo" | "redo") => {
    const head = state.data?.[direction] ?? null;
    const known = head === null ? undefined : describeCommand(head.commandId);
    const hint =
      head === null
        ? t(direction === "undo" ? "nothing" : "nothingRedo")
        : !head.available
          ? t("changedElsewhere")
          : known === undefined
            ? undefined
            : t(direction === "undo" ? "named" : "redoNamed", {
                command: t(`commands.${known.kind}`, { name: known.name }),
              });
    const transition = direction === "undo" ? undo : redo;
    return (
      <MenuItem
        disabled={head === null || undo.isPending || redo.isPending}
        hint={hint}
        icon={direction === "undo" ? <UndoIcon /> : <RedoIcon />}
        onSelect={() => transition.mutate()}
        shortcut={shortcuts[direction]}
      >
        {t(direction === "undo" ? "edit" : "redoEdit")}
      </MenuItem>
    );
  };
  return (
    <>
      {item("undo")}
      {item("redo")}
    </>
  );
}
