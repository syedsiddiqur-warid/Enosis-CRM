import { cn } from "@/lib/utils";

/** Frame for a settings page: title, description and the page body. */
export function SettingsPage({ title, description, actions, children, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("thin-scroll h-full overflow-y-auto rounded-[6px] border border-line bg-surface px-7 py-5", className)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-medium">{title}</h1>
          {description && <p className="mt-1 max-w-[820px] text-[13px] text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

export function SettingsSection({ title, description, children, actions }: { title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="text-[12px] text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
