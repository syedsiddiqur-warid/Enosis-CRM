"use client";

import { KeyRound, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pill, UserAvatar } from "@/components/index/values";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import { friendlyDateTime } from "@/lib/crm/dates";
import { createTeam, deleteTeam, inviteUser, setTeamMember, setUserActive, setUserPassword, setUserRole } from "@/lib/crm/settings-actions";
import { cn } from "@/lib/utils";
import { SettingsPage, SettingsSection } from "./settings-ui";

type User = { id: string; name: string | null; email: string; isActive: boolean; lastLoginAt: string | null; roleId: string | null; hasPassword: boolean; locked: boolean };

/** A readable starting password (no look-alike characters) for the admin to hand over. */
function newPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const out = [...bytes].map((b) => chars[b % chars.length]).join("");
  return /[0-9]/.test(out) ? out : `${out.slice(0, -1)}7`;
}
type Role = { id: string; name: string; description: string | null };
type Team = { id: string; name: string; members: { userId: string; isManager: boolean }[]; layouts: number };

const ROLE_HELP: Record<string, string> = {
  Admin: "Everything, including settings and integrations",
  Manager: "All records, delete, export, import, properties and lists",
  Caller: "All records, bulk edit; no delete, export or import",
  Researcher: "All records, export and import; no delete",
};

export function UsersSettings({
  users,
  roles,
  teams,
  currentUserId,
  isAdmin,
  allowedDomain,
}: {
  users: User[];
  roles: Role[];
  teams: Team[];
  currentUserId: string;
  isAdmin: boolean;
  allowedDomain: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [invite, setInvite] = useState({ email: "", name: "", password: "", roleId: roles.find((r) => r.name === "Caller")?.id ?? roles[0]?.id ?? "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong");
      after?.();
      router.refresh();
    });
  const lite = (u: User) => ({ id: u.id, name: u.name, email: u.email });

  return (
    <SettingsPage
      title="Users & teams"
      description={`People sign in with their @${allowedDomain} email and a password. Add each person here with a role and a starting password, and give them the password; they can change it after signing in (account menu → Change password).`}
    >
      {error && <p className="mb-4 rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {notice && <p className="mb-4 rounded-[3px] bg-[#e5f8f6] px-3 py-2 text-[13px]">{notice}</p>}

      <SettingsSection title={`Users (${users.filter((u) => u.isActive).length} active)`}>
        <div className="thin-scroll overflow-x-auto rounded-[4px] border border-line">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Teams</th>
                <th className="px-3 py-2">Last sign-in</th>
                <th className="px-3 py-2">Password</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={cn("border-t border-line", !u.isActive && "opacity-60")}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={lite(u)} />
                      <div className="min-w-0">
                        <div className="font-medium">
                          {u.name ?? u.email}
                          {u.id === currentUserId && <span className="ml-1 text-[12px] font-normal text-ink-subtle">(you)</span>}
                        </div>
                        <div className="text-[12px] text-ink-subtle">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Select className="h-8 w-[150px]" value={u.roleId ?? ""} disabled={!isAdmin || pending} onChange={(e) => run(() => setUserRole(u.id, e.target.value))} aria-label={`Role for ${u.name ?? u.email}`}>
                      {!u.roleId && <option value="">No role</option>}
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {teams
                        .filter((t) => t.members.some((m) => m.userId === u.id))
                        .map((t) => (
                          <Pill key={t.id} label={`${t.name}${t.members.find((m) => m.userId === u.id)?.isManager ? " (manager)" : ""}`} />
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{u.lastLoginAt ? friendlyDateTime(u.lastLoginAt) : "Never"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {u.locked ? <Pill label="Locked" color="#f2545b" /> : u.hasPassword ? <Pill label="Set" color="#00bda5" /> : <Pill label="Not set" color="#f5c26b" />}
                      {isAdmin && (
                        <SetPassword
                          user={u}
                          onSave={(password) =>
                            run(
                              () => setUserPassword(u.id, password),
                              () => setNotice(`New password for ${u.name ?? u.email} saved. Give it to them; they can change it after signing in.`),
                            )
                          }
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {isAdmin && u.id !== currentUserId ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setUserActive(u.id, !u.isActive))}>
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    ) : (
                      <span className="text-ink-muted">{u.isActive ? "Active" : "Deactivated"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => inviteUser(invite),
                () => {
                  setNotice(invite.password ? `${invite.email} added. Give them their password; they can change it after signing in.` : `${invite.email} added. Set a password for them before they sign in.`);
                  setInvite({ ...invite, email: "", name: "", password: "" });
                },
              );
            }}
          >
            <Input className="w-[260px]" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder={`name@${allowedDomain}`} aria-label="Email" />
            <Input className="w-[200px]" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} placeholder="Full name" aria-label="Full name" />
            <div className="flex items-center gap-1">
              <Input className="w-[180px] font-mono" value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} placeholder="Starting password" aria-label="Starting password" autoComplete="new-password" />
              <Button type="button" size="sm" variant="ghost" className="text-link" onClick={() => setInvite({ ...invite, password: newPassword() })}>
                Generate
              </Button>
            </div>
            <Select className="w-[150px]" value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} aria-label="Role">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" disabled={pending || !invite.email.trim()}>
              <Plus /> Add user
            </Button>
          </form>
        )}
        <dl className="mt-3 grid max-w-[760px] gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
          {roles.map((r) => (
            <div key={r.id}>
              <dt className="inline font-medium">{r.name}: </dt>
              <dd className="inline text-ink-muted">{r.description ?? ROLE_HELP[r.name] ?? ""}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-[12px] text-ink-subtle">Custom roles and per-object permissions arrive with the permissions editor (build step 11).</p>
      </SettingsSection>

      <SettingsSection title="Teams" description="Teams get their own record layouts (e.g. Research sees research cards first) and can share views.">
        <div className="grid gap-3 lg:grid-cols-2">
          {teams.map((t) => (
            <div key={t.id} className="rounded-[4px] border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="flex-1 text-[14px] font-medium">
                  {t.name} <span className="font-normal text-ink-subtle">({t.members.length})</span>
                </h3>
                {t.layouts > 0 && <span className="text-[12px] text-ink-subtle">{t.layouts} record layout{t.layouts === 1 ? "" : "s"}</span>}
                {isAdmin && (
                  <Tooltip content={t.layouts ? "Remove its layouts first" : "Delete team"}>
                    <span>
                      <Button size="icon-sm" variant="ghost" disabled={pending || t.layouts > 0} onClick={() => run(() => deleteTeam(t.id))} aria-label={`Delete team ${t.name}`}>
                        <Trash2 />
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </div>
              <ul className="space-y-1">
                {t.members.map((m) => {
                  const u = users.find((x) => x.id === m.userId);
                  if (!u) return null;
                  return (
                    <li key={m.userId} className="flex items-center gap-2 text-[13px]">
                      <UserAvatar user={lite(u)} size={20} />
                      <span className="min-w-0 flex-1 truncate">{u.name ?? u.email}</span>
                      <label className="flex items-center gap-1 text-[12px] text-ink-muted">
                        <Checkbox checked={m.isManager} disabled={!isAdmin || pending} onCheckedChange={(v) => run(() => setTeamMember(t.id, u.id, true, v === true))} aria-label={`${u.name ?? u.email} is a manager`} />
                        Manager
                      </label>
                      {isAdmin && (
                        <button className="rounded p-1 text-ink-subtle hover:bg-surface-hover" onClick={() => run(() => setTeamMember(t.id, u.id, false))} aria-label={`Remove ${u.name ?? u.email} from ${t.name}`}>
                          <X className="size-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
                {!t.members.length && <li className="text-[13px] text-ink-subtle">No members</li>}
              </ul>
              {isAdmin && (
                <AddMember
                  candidates={users.filter((u) => u.isActive && !t.members.some((m) => m.userId === u.id))}
                  onPick={(id) => run(() => setTeamMember(t.id, id, true))}
                />
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => createTeam(teamName),
                () => setTeamName(""),
              );
            }}
          >
            <Input className="w-[240px]" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="New team name" aria-label="New team name" maxLength={60} />
            <Button type="submit" variant="secondary" disabled={pending || !teamName.trim()}>
              <Plus /> Create team
            </Button>
          </form>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

function AddMember({ candidates, onPick }: { candidates: User[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!candidates.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="mt-1 text-link">
          <Plus /> Add member
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] py-1">
        {candidates.map((u) => (
          <button
            key={u.id}
            className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
            onClick={() => {
              setOpen(false);
              onPick(u.id);
            }}
          >
            {u.name ?? u.email}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Admin: give someone a new password (also unlocks a locked account). */
function SetPassword({ user, onSave }: { user: User; onSave: (password: string) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setPassword(newPassword());
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <KeyRound /> {user.hasPassword || user.locked ? "Reset" : "Set"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-3 text-[13px]">
        <div className="mb-2 font-medium">New password for {user.name ?? user.email}</div>
        <div className="flex gap-1">
          <Input className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New password" autoComplete="new-password" />
          <Button size="sm" variant="ghost" className="text-link" onClick={() => setPassword(newPassword())}>
            New
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-subtle">10+ characters with letters and a number. Copy it before saving and give it to them.</p>
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={password.length < 10}
            onClick={() => {
              onSave(password);
              setOpen(false);
            }}
          >
            Save password
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
