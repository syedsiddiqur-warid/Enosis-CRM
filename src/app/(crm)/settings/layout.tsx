import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 gap-3">
      <SettingsNav />
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
