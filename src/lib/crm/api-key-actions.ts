"use server";

// Settings › Intake API: access keys for lead generation tools. The full key is shown once, when it's created.
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { newApiKey } from "./intake";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

async function requireAdmin() {
  const user = await requireUser();
  const me = await db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } });
  if (me?.role?.name !== "Admin") throw new Error("Only admins can manage API keys");
  return user;
}

export interface ApiKeyInput {
  name: string;
  source: string | null;
  researcherIds: string[];
  addMissingOptions: boolean;
}

async function clean(input: ApiKeyInput) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("Name the key after the tool that will use it");
  const researchers = await db.user.findMany({ where: { id: { in: input.researcherIds }, isActive: true }, select: { id: true } });
  return { name, source: input.source?.trim() || null, researcherIds: researchers.map((r) => r.id), addMissingOptions: input.addMissingOptions };
}

export async function createApiKey(input: ApiKeyInput): Promise<Result<{ key: string }>> {
  try {
    const user = await requireAdmin();
    const data = await clean(input);
    const { key, prefix, hash } = newApiKey();
    const row = await db.apiKey.create({ data: { ...data, prefix, hash, createdById: user.id } });
    await db.auditLog.create({ data: { action: "settings", changes: { apiKey: { created: row.name, prefix } }, userId: user.id } });
    revalidatePath("/settings/api");
    return { ok: true, data: { key } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateApiKey(id: string, input: ApiKeyInput): Promise<Result> {
  try {
    const user = await requireAdmin();
    const row = await db.apiKey.update({ where: { id }, data: await clean(input) });
    await db.auditLog.create({ data: { action: "settings", changes: { apiKey: { updated: row.name, prefix: row.prefix } }, userId: user.id } });
    revalidatePath("/settings/api");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKey(id: string): Promise<Result> {
  try {
    const user = await requireAdmin();
    const row = await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await db.auditLog.create({ data: { action: "settings", changes: { apiKey: { revoked: row.name, prefix: row.prefix } }, userId: user.id } });
    revalidatePath("/settings/api");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
