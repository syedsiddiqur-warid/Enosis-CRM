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

/** Where a number is now: one of the company's saved numbers, or the phone/mobile field on a contact record. */
export type NumberSource = { phoneId: string } | { contactId: string; field: "phone" | "mobile" };

/**
 * Callers find out which number is the company's and which is a person's direct line: move a number
 * to the company numbers (toContactId null) or to one of the company's people.
 */
export async function moveCompanyNumber(companyId: string, source: NumberSource, toContactId: string | null): Promise<Result> {
  try {
    const user = await requireUser();
    if (toContactId) await owner("COMPANY", companyId, toContactId);
    const who = toContactId ? await db.contact.findUnique({ where: { id: toContactId }, select: { firstName: true, lastName: true } }) : null;
    const label = who ? [who.firstName, who.lastName].filter(Boolean).join(" ") || "a contact" : "company numbers";
    if ("phoneId" in source) {
      const prev = await db.phoneNumber.findUniqueOrThrow({ where: { id: source.phoneId } });
      if (prev.companyId !== companyId) throw new Error("That number isn't on this company");
      if ((prev.contactId ?? null) === toContactId) return { ok: true };
      // A company line moved to a person is their direct line (and the other way round), unless the caller set something more specific
      const type = toContactId && prev.type === "Main" ? "Direct" : !toContactId && ["Direct", "Mobile"].includes(prev.type) ? "Main" : prev.type;
      await db.phoneNumber.update({ where: { id: prev.id }, data: { contactId: toContactId, type } });
      await db.auditLog.create({ data: { objectType: "COMPANY", recordId: companyId, action: "move_phone", changes: { number: prev.number, from: prev.contactId, to: toContactId }, userId: user.id } });
      await timeline("COMPANY", companyId, user.id, `Phone ${prev.number} moved to`, label);
    } else {
      // A number typed on the contact record becomes a saved number on the company, and leaves the contact field
      const c = await db.contact.findUniqueOrThrow({ where: { id: source.contactId }, select: { phone: true, mobile: true } });
      const number = toE164(c[source.field] ?? "");
      if (!number) throw new Error("That contact has no number there");
      const exists = await db.phoneNumber.findFirst({ where: { companyId, number, extension: null } });
      if (exists) await db.phoneNumber.update({ where: { id: exists.id }, data: { contactId: toContactId } });
      else
        await db.phoneNumber.create({
          data: { companyId, contactId: toContactId, number, type: toContactId ? (source.field === "mobile" ? "Mobile" : "Direct") : "Main", status: "Unknown" },
        });
      if (toContactId !== source.contactId) {
        await db.contact.update({ where: { id: source.contactId }, data: { [source.field]: null } });
        await db.auditLog.create({ data: { objectType: "CONTACT", recordId: source.contactId, action: "update", changes: { [source.field]: { from: c[source.field], to: null } }, userId: user.id } });
      }
      await timeline("COMPANY", companyId, user.id, `Phone ${number} moved to`, label);
    }
    revalidate("COMPANY", companyId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A caller's note on a number, e.g. "Ext 204 reaches the CTO". */
export async function setPhoneNotes(companyId: string, id: string, notes: string): Promise<Result> {
  try {
    const user = await requireUser();
    const prev = await db.phoneNumber.findUniqueOrThrow({ where: { id } });
    if (prev.companyId !== companyId) throw new Error("That number isn't on this company");
    const next = notes.trim().slice(0, 1000) || null;
    await db.phoneNumber.update({ where: { id }, data: { notes: next } });
    await db.auditLog.create({ data: { objectType: "COMPANY", recordId: companyId, action: "update_phone", changes: { number: prev.number, notes: { from: prev.notes, to: next } }, userId: user.id } });
    revalidate("COMPANY", companyId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
