"use server";

// Company emails: the main address (built-in `email`) plus any others, edited from the Company emails card.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { OTHER_EMAILS, companyEmailList, uniqueEmails } from "./company-emails";
import { applyUpdate } from "./record-writes";

type Result = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Replace a company's emails; the first one becomes the main company email. */
export async function saveCompanyEmails(companyId: string, emails: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    const list = uniqueEmails(emails);
    const bad = list.find((e) => !EMAIL_RE.test(e));
    if (bad) return { ok: false, error: `${bad} isn't a valid email address` };

    const co = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { email: true, properties: true } });
    const before = companyEmailList(co);
    if (JSON.stringify(before) === JSON.stringify(list)) return { ok: true };

    const props = (co.properties ?? {}) as Prisma.JsonObject;
    await db.company.update({ where: { id: companyId }, data: { properties: { ...props, [OTHER_EMAILS]: list.slice(1) } } });
    // The main email goes through the normal property write so it's audited and on the timeline
    await applyUpdate("COMPANY", companyId, "email", list[0] ?? null, user.id);

    const added = list.filter((e) => !before.includes(e));
    const removed = before.filter((e) => !list.includes(e));
    if (added.length || removed.length) {
      await db.activity.create({
        data: {
          type: "SYSTEM",
          ownerId: user.id,
          systemData: { kind: "property_change", label: "Company emails", from: removed.join(", ") || null, to: added.join(", ") || null },
          companies: { create: { companyId } },
        },
      });
    }
    revalidatePath(`/companies/${companyId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
