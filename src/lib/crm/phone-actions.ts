"use server";

// Phone numbers on companies and contacts: add, edit, quick status change, delete (with undo).
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { toE164 } from "@/lib/utils";
import { OBJECT_LABELS } from "./defaults";
import type { CrmObject, PropOption } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

export interface PhoneInput {
  number: string;
  extension?: string | null;
  type: string;
  ivrPath?: string | null;
  status: string;
  notes?: string | null;
  /** Company records: the contact whose line this is (null = company line) */
  contactId?: string | null;
}

export interface PhoneSnapshot extends PhoneInput {
  companyId: string | null;
}

async function options(key: string) {
  const l = await db.optionList.findUnique({ where: { key } });
  return ((l?.options as PropOption[] | null) ?? []).map((o) => o.value);
}

function revalidate(object: CrmObject, recordId: string) {
  revalidatePath(`${OBJECT_LABELS[object].path}/${recordId}`);
  revalidatePath("/prospecting", "layout");
}

async function timeline(object: CrmObject, recordId: string, userId: string, label: string, to: string) {
  await db.activity.create({
    data: {
      type: "SYSTEM",
      ownerId: userId,
      systemData: { kind: "property_change", label, to },
      ...(object === "CONTACT" ? { contacts: { create: { contactId: recordId } } } : { companies: { create: { companyId: recordId } } }),
    },
  });
}

/** Where a number on this record lives: company records own company lines (optionally a contact's);
 *  contact records own the contact's line, also shown on its primary company. */
async function owner(object: CrmObject, recordId: string, contactId: string | null | undefined) {
  if (object === "COMPANY") {
    if (contactId) {
      const link = await db.contactCompany.count({ where: { contactId, companyId: recordId } });
      if (!link) throw new Error("That contact isn't associated with this company");
    }
    return { companyId: recordId, contactId: contactId || null };
  }
  const primary = await db.contactCompany.findFirst({ where: { contactId: recordId, isPrimary: true }, select: { companyId: true } });
  return { companyId: primary?.companyId ?? null, contactId: recordId };
}

async function clean(input: PhoneInput) {
  const number = toE164(input.number ?? "");
  if (!number) throw new Error("Enter a phone number with at least 7 digits");
  const [types, statuses] = await Promise.all([options("phoneType"), options("phoneStatus")]);
  if (types.length && !types.includes(input.type)) throw new Error("Unknown phone type");
  if (statuses.length && !statuses.includes(input.status)) throw new Error("Unknown phone status");
  const extension = input.extension?.replace(/[^\d#*]/g, "") || null;
  return { number, extension, type: input.type, status: input.status, ivrPath: input.ivrPath?.trim() || null, notes: input.notes?.trim() || null };
}

export async function savePhoneNumber(object: CrmObject, recordId: string, id: string | null, input: PhoneInput): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = await clean(input);
    const own = await owner(object, recordId, input.contactId);
    // The same number twice on one company / contact is a mistake
    const dupe = await db.phoneNumber.findFirst({
      where: {
        number: data.number,
        extension: data.extension,
        ...(id ? { id: { not: id } } : {}),
        OR: [...(own.companyId ? [{ companyId: own.companyId }] : []), ...(own.contactId ? [{ contactId: own.contactId }] : [])],
      },
    });
    if (dupe) throw new Error("This number is already on the record");
    let row;
    if (id) {
      const prev = await db.phoneNumber.findUniqueOrThrow({ where: { id } });
      row = await db.phoneNumber.update({ where: { id }, data: { ...data, contactId: object === "COMPANY" ? own.contactId : prev.contactId } });
      await db.auditLog.create({ data: { objectType: object, recordId, action: "update_phone", changes: { from: prev, to: data } as unknown as Prisma.InputJsonValue, userId: user.id } });
      if (prev.status !== data.status) await timeline(object, recordId, user.id, `Phone ${data.number} status`, data.status);
    } else {
      row = await db.phoneNumber.create({ data: { ...data, ...own } });
      await db.auditLog.create({ data: { objectType: object, recordId, action: "add_phone", changes: data as unknown as Prisma.InputJsonValue, userId: user.id } });
      await timeline(object, recordId, user.id, "Phone number added", `${data.number} (${data.type})`);
    }
    revalidate(object, recordId);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function setPhoneStatus(object: CrmObject, recordId: string, id: string, status: string): Promise<Result> {
  try {
    const user = await requireUser();
    const statuses = await options("phoneStatus");
    if (statuses.length && !statuses.includes(status)) throw new Error("Unknown phone status");
    const p = await db.phoneNumber.update({ where: { id }, data: { status } });
    await timeline(object, recordId, user.id, `Phone ${p.number} status`, status);
    revalidate(object, recordId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Delete a number. Calls keep the number they dialed; the snapshot lets the page undo. */
export async function deletePhoneNumber(object: CrmObject, recordId: string, id: string): Promise<Result<PhoneSnapshot>> {
  try {
    const user = await requireUser();
    const p = await db.phoneNumber.delete({ where: { id } });
    await db.auditLog.create({ data: { objectType: object, recordId, action: "delete_phone", changes: p as unknown as Prisma.InputJsonValue, userId: user.id } });
    revalidate(object, recordId);
    return {
      ok: true,
      data: { number: p.number, extension: p.extension, type: p.type, ivrPath: p.ivrPath, status: p.status, notes: p.notes, contactId: p.contactId, companyId: p.companyId },
    };
  } catch (e) {
    return fail(e);
  }
}
