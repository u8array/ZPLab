import { useRef } from "react";
import { useLabelStore } from "../store/labelStore";
import { serializeDesign, designFileErrors } from "@zplab/core/lib/designFile";
import { readFileAsText } from "../lib/readFile";
import { pickFileText, pickViaMenu, saveTextFile, saveErrorMessage, DESIGN_FILTER } from "../lib/fileDialogs";

export function useDesignFileActions() {
  const label = useLabelStore((s) => s.label);
  const pages = useLabelStore((s) => s.pages);
  const variables = useLabelStore((s) => s.variables);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const dataSourceRef = useLabelStore((s) => s.dataSourceRef);
  const newDesign = useLabelStore((s) => s.newDesign);
  const loadDesignText = useLabelStore((s) => s.loadDesignText);
  const setUserError = useLabelStore((s) => s.setUserError);
  const clearUserError = useLabelStore((s) => s.clearUserError);
  const loadInputRef = useRef<HTMLInputElement>(null);

  const handleNew = newDesign;

  const handleSave = () => {
    const data = serializeDesign(label, pages, variables, columnMapping, dataSourceRef);
    void saveTextFile(data, {
      filename: "label.json",
      mimeType: "application/json",
      filter: DESIGN_FILTER,
    })
      .then((wrote) => wrote && clearUserError())
      .catch(() => setUserError(saveErrorMessage));
  };

  // No clear here: a cancelled pick must leave any existing error in place;
  // loadDesignText clears on a successful load instead.
  const handleOpen = () => {
    pickViaMenu(
      loadInputRef,
      () => pickFileText(DESIGN_FILTER),
      (picked) => loadDesignText(picked.text),
      () => setUserError(designFileErrors.parse_error),
    );
  };

  const handleLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    let text: string;
    try {
      text = await readFileAsText(file);
    } catch {
      setUserError(designFileErrors.parse_error);
      return;
    }
    loadDesignText(text);
  };

  return { handleNew, handleSave, handleOpen, handleLoad, loadInputRef };
}
