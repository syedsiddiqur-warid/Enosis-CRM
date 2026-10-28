"use client";

import { createContext, useContext } from "react";
import type { RecordData } from "@/lib/crm/record-loader";
import type { ComposerKind, RecordActivity } from "@/lib/crm/record-types";

export interface Toast {
  message: string;
  undo?: () => Promise<void>;
}

export interface RecordContextValue {
  data: RecordData;
  /** Saves one property; resolves to an error message or null */
  editProperty: (property: string, value: unknown) => Promise<string | null>;
  openComposer: (kind: ComposerKind, editing?: RecordActivity, preset?: Partial<RecordActivity>) => void;
  toast: (t: Toast) => void;
  refresh: () => void;
  setTab: (tab: string) => void;
  isCollapsed: (cardId: string) => boolean;
  toggleCard: (cardId: string) => void;
}

export const RecordContext = createContext<RecordContextValue | null>(null);

export function useRecord() {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error("useRecord outside RecordPage");
  return ctx;
}
