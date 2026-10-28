"use client";

import { Settings2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Tooltip } from "@/components/ui/overlays";
import { updateProperty } from "@/lib/crm/actions";
import { setCardCollapsed } from "@/lib/crm/record-actions";
import type { RecordData } from "@/lib/crm/record-loader";
import type { ComposerKind, RecordActivity } from "@/lib/crm/record-types";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { LeftColumn } from "./left-column";
import { Overview } from "./overview";
import { RecordContext, type RecordContextValue, type Toast } from "./record-context";
import { RightColumn } from "./right-column";
import { Timeline } from "./timeline";

/** HubSpot-style 3-column record page, rendered from the stored RecordLayout. */
export function RecordPage({ data }: { data: RecordData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [composer, setComposer] = useState<{ kind: ComposerKind; editing?: RecordActivity; preset?: Partial<RecordActivity>; key: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [collapsed, setCollapsed] = useState(() => new Set(data.collapsed));

  const tabs = data.layout.config.center.tabs.filter((t) => !t.hidden);
  const tab = tabs.find((t) => t.id === sp.get("tab"))?.id ?? tabs[0]?.id ?? "activities";

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  const ctx = useMemo<RecordContextValue>(
    () => ({
      data,
      refresh,
      toast: setToast,
      editProperty: async (property, value) => {
        const res = await updateProperty(data.object, data.id, property, value);
        if (!res.ok) return res.error;
        refresh();
        return null;
      },
      openComposer: (kind, editing, preset) => setComposer({ kind, editing, preset, key: Date.now() }),
      setTab: (t) => {
        const p = new URLSearchParams(sp.toString());
        p.set("tab", t);
        router.replace(`${pathname}?${p.toString()}`, { scroll: false });
      },
      isCollapsed: (id) => collapsed.has(id),
      toggleCard: (id) => {
        const next = !collapsed.has(id);
        setCollapsed((s) => {
          const n = new Set(s);
          if (next) n.add(id);
          else n.delete(id);
          return n;
        });
        void setCardCollapsed(data.object, id, next);
      },
    }),
    [data, refresh, collapsed, sp, pathname, router],
  );

  const cardKinds = new Set(tabs.find((t) => t.id === tab)?.cards.map((c) => c.kind) ?? []);
  const showTimeline = cardKinds.has("activity_timeline") || (!cardKinds.size && tab === "activities");
  const showOverview = cardKinds.has("activity_summary") || cardKinds.has("ai_insights") || (!cardKinds.size && tab === "overview");

  return (
    <RecordContext.Provider value={ctx}>
      {pending && <div className="fixed inset-x-0 top-12 z-30 h-0.5 animate-pulse bg-link" />}
      <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(280px,320px)] lg:overflow-hidden">
        <LeftColumn />

        <section className="flex min-h-0 flex-col rounded-[6px] border border-line bg-surface">
          <div className="flex items-end gap-1 border-b border-line px-5 pt-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => ctx.setTab(t.id)}
                className={cn("-mb-px border-b-[3px] px-4 py-2.5 text-[14px]", tab === t.id ? "border-[#2d3e50] font-medium" : "border-transparent text-ink-muted hover:text-ink")}
                aria-pressed={tab === t.id}
              >
                {t.label}
              </button>
            ))}
            <Tooltip content={`Layout: ${data.layout.name}. The layout editor arrives in build step 11`}>
              <span className="mb-2 ml-auto flex items-center gap-1 text-[13px] text-ink-subtle">
                <Settings2 className="size-4" /> Customize
              </span>
            </Tooltip>
          </div>
          <div className="@container thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {showOverview && <Overview />}
            {showTimeline && <Timeline />}
            {!showOverview && !showTimeline && <p className="text-[13px] text-ink-subtle">This tab has no cards yet.</p>}
          </div>
        </section>

        <RightColumn />
      </div>

      {composer && <Composer key={composer.key} kind={composer.kind} editing={composer.editing} preset={composer.preset} onClose={() => setComposer(null)} />}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast.message}
          {toast.undo && (
            <button
              className="font-medium underline"
              onClick={async () => {
                await toast.undo!();
                setToast({ message: "Undone" });
                refresh();
              }}
            >
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </RecordContext.Provider>
  );
}
