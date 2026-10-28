"use server";

// Settings: workspace, users & teams, properties, dropdown lists and follow-up rules.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import type { CrmObject, PropOption } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function requireRole(roles: string[]) {
  const user = await requireUser();
  const me = await db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } });
  if (!roles.includes(me?.role?.name ?? "")) throw new Error(`Only ${roles.join(" and ").toLowerCase()}s can change this`);
  return user;
}
const requireAdmin = () => requireRole(["Admin"]);

async function audit(userId: string, changes: Record<string, unknown>) {
  await db.auditLog.create({ data: { action: "settings", changes: json(changes), userId } });
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

// ── Workspace ──

export async function updateWorkspace(input: { name: string; defaultTimeZone: string; aiEnabled: boolean }): Promise<Result> {
  try {
    const user = await requireAdmin();
    const name = input.name.trim();
    if (!name) throw new Error("Give the workspace a name");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.defaultTimeZone });
    } catch {
      throw new Error("Unknown time zone");
    }
    await db.workspaceSettings.upsert({
      where: { id: "workspace" },
      create: { id: "workspace", name: name.slice(0, 80), defaultTimeZone: input.defaultTimeZone, aiEnabled: input.aiEnabled },
      update: { name: name.slice(0, 80), defaultTimeZone: input.defaultTimeZone, aiEnabled: input.aiEnabled },
    });
    await audit(user.id, { workspace: input });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Users & teams ──

export async function setUserRole(userId: string, roleId: string): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (userId === me.id) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (role?.name !== "Admin") throw new Error("You can't remove your own admin role");
    }
    await db.user.update({ where: { id: userId }, data: { roleId } });
    await audit(me.id, { userRole: { userId, roleId } });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserActive(userId: string, isActive: boolean): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (userId === me.id && !isActive) throw new Error("You can't deactivate yourself");
    await db.user.update({ where: { id: userId }, data: { isActive } });
    await audit(me.id, { userActive: { userId, isActive } });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Pre-create a teammate so they get their role and team on first sign-in (sign-in itself goes through Google/Microsoft). */
export async function inviteUser(input: { email: string; name: string; roleId: string }): Promise<Result> {
  try {
    const me = await requireAdmin();
    const email = input.email.trim().toLowerCase();
    const domain = process.env.AUTH_ALLOWED_DOMAIN ?? "enosisbd.com";
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("Enter an email address");
    if (!email.endsWith(`@${domain}`)) throw new Error(`Only @${domain} addresses can sign in`);
    if (await db.user.findUnique({ where: { email } })) throw new Error("That person already has an account");
    await db.user.create({ data: { email, name: input.name.trim() || null, roleId: input.roleId, preferences: { timeZone: "Asia/Dhaka" } } });
    await audit(me.id, { addedUser: email });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createTeam(name: string): Promise<Result> {
  try {
    const me = await requireAdmin();
    const n = name.trim();
    if (!n) throw new Error("Name the team");
    if (await db.team.findUnique({ where: { name: n } })) throw new Error("A team with that name exists");
    await db.team.create({ data: { name: n.slice(0, 60) } });
    await audit(me.id, { createdTeam: n });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTeam(teamId: string): Promise<Result> {
  try {
    const me = await requireAdmin();
    const layouts = await db.recordLayout.count({ where: { teamId } });
    if (layouts) throw new Error("This team has its own record layouts; they'd be deleted too. Remove them first (step 11 layout editor).");
    const t = await db.team.delete({ where: { id: teamId } });
    await audit(me.id, { deletedTeam: t.name });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setTeamMember(teamId: string, userId: string, member: boolean, isManager = false): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (member) {
      await db.teamMember.upsert({ where: { teamId_userId: { teamId, userId } }, create: { teamId, userId, isManager }, update: { isManager } });
    } else {
      await db.teamMember.deleteMany({ where: { teamId, userId } });
    }
    await audit(me.id, { teamMember: { teamId, userId, member, isManager } });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Properties & dropdown options ──

/** Options keep their internal value forever (records store it); labels, colors and order can change, and
 *  options are archived rather than deleted so old records keep their value. */
function checkOptions(prev: PropOption[], next: PropOption[]) {
  const seen = new Set<string>();
  const clean = next.map((o, i) => {
    const label = o.label.trim();
    const value = (o.value || label).trim();
    if (!label || !value) throw new Error("Every option needs a label");
    const key = value.toLowerCase();
    if (seen.has(key)) throw new Error(`"${label}" is listed twice`);
    seen.add(key);
    return { ...o, value, label, order: i, color: o.color || undefined, archived: !!o.archived };
  });
  const missing = prev.filter((p) => !clean.some((c) => c.value === p.value));
  if (missing.length) throw new Error(`Archive options instead of deleting them: ${missing.map((m) => m.label).join(", ")}`);
  if (!clean.some((o) => !o.archived)) throw new Error("Keep at least one active option");
  return clean;
}

export async function updatePropertyDefinition(
  object: CrmObject,
  name: string,
  patch: { label?: string; description?: string | null; groupName?: string; options?: PropOption[] },
): Promise<Result> {
  try {
    const user = await requireRole(["Admin", "Manager"]);
    const def = await db.propertyDefinition.findUniqueOrThrow({ where: { objectType_name: { objectType: object, name } } });
    const data: Prisma.PropertyDefinitionUpdateInput = {};
    if (patch.label !== undefined) {
      if (!patch.label.trim()) throw new Error("Enter a label");
      data.label = patch.label.trim().slice(0, 80);
    }
    if (patch.description !== undefined) data.description = patch.description?.trim() || null;
    if (patch.groupName !== undefined) {
      const g = await db.propertyGroup.findUnique({ where: { objectType_name: { objectType: object, name: patch.groupName } } });
      if (!g) throw new Error("Unknown group");
      data.group = { connect: { id: g.id } };
    }
    if (patch.options !== undefined) {
      if (!["ENUM", "MULTI_ENUM", "RADIO"].includes(def.type)) throw new Error("This property has no options");
      data.options = json(checkOptions((def.options as PropOption[] | null) ?? [], patch.options));
    }
    await db.propertyDefinition.update({ where: { id: def.id }, data });
    await audit(user.id, { property: { object, name, ...patch } });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPropertyArchived(object: CrmObject, name: string, archived: boolean): Promise<Result> {
  try {
    const user = await requireRole(["Admin", "Manager"]);
    const def = await db.propertyDefinition.findUniqueOrThrow({ where: { objectType_name: { objectType: object, name } } });
    if (def.isBuiltIn) throw new Error("Built-in properties can't be archived");
    await db.propertyDefinition.update({ where: { id: def.id }, data: { archivedAt: archived ? new Date() : null } });
    await audit(user.id, { property: { object, name, archived } });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateOptionList(key: string, options: PropOption[]): Promise<Result> {
  try {
    const user = await requireRole(["Admin", "Manager"]);
    const list = await db.optionList.findUniqueOrThrow({ where: { key } });
    await db.optionList.update({ where: { key }, data: { options: json(checkOptions((list.options as PropOption[] | null) ?? [], options)) } });
    await audit(user.id, { optionList: key });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Follow-up rules ──

export async function saveFollowUpRule(id: string | null, input: { callResult: string; taskTitle: string; taskType: string; dueInDays: number; isActive: boolean }): Promise<Result> {
  try {
    const user = await requireRole(["Admin", "Manager"]);
    if (!input.callResult) throw new Error("Choose a call outcome");
    if (!input.taskTitle.trim()) throw new Error("Give the task a title");
    const days = Math.round(Number(input.dueInDays));
    if (!(days >= 0 && days <= 365)) throw new Error("Due in 0–365 days");
    const data = { callResult: input.callResult, taskTitle: input.taskTitle.trim().slice(0, 120), taskType: input.taskType || "Call", dueInDays: days, isActive: input.isActive };
    const clash = await db.followUpRule.findFirst({ where: { callResult: data.callResult, isActive: true, ...(id ? { id: { not: id } } : {}) } });
    if (clash && data.isActive) throw new Error(`"${data.callResult}" already has an active rule`);
    if (id) await db.followUpRule.update({ where: { id }, data });
    else await db.followUpRule.create({ data });
    await audit(user.id, { followUpRule: { id, ...data } });
    revalidatePath("/settings/lists");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteFollowUpRule(id: string): Promise<Result> {
  try {
    const user = await requireRole(["Admin", "Manager"]);
    await db.followUpRule.delete({ where: { id } });
    await audit(user.id, { deletedFollowUpRule: id });
    revalidatePath("/settings/lists");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
