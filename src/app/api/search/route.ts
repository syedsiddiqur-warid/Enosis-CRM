import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json([], { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);

  const contains = { contains: q, mode: "insensitive" as const };
  const digits = q.replace(/\D/g, "");
  const [first, ...rest] = q.split(/\s+/);

  const [contacts, companies, deals, phones] = await Promise.all([
    db.contact.findMany({
      where: {
        deletedAt: null,
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
          ...(rest.length ? [{ AND: [{ firstName: { contains: first, mode: "insensitive" as const } }, { lastName: { contains: rest.join(" "), mode: "insensitive" as const } }] }] : []),
        ],
      },
      take: 6,
      select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true },
    }),
    db.company.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { domain: contains }] }, take: 6, select: { id: true, name: true, domain: true } }),
    db.deal.findMany({ where: { deletedAt: null, name: contains }, take: 4, select: { id: true, name: true, stage: { select: { name: true } } } }),
    digits.length >= 3
      ? db.phoneNumber.findMany({ where: { number: { contains: digits } }, take: 5, select: { id: true, number: true, type: true, company: { select: { id: true, name: true } } } })
      : Promise.resolve([]),
  ]);

  return NextResponse.json([
    ...contacts.map((c) => ({ type: "contact", id: c.id, title: fullName(c), subtitle: [c.jobTitle, c.email].filter(Boolean).join(" · "), href: `/contacts/${c.id}` })),
    ...companies.map((c) => ({ type: "company", id: c.id, title: c.name, subtitle: c.domain ?? undefined, href: `/companies/${c.id}` })),
    ...deals.map((d) => ({ type: "deal", id: d.id, title: d.name, subtitle: d.stage.name, href: `/deals/${d.id}` })),
    ...phones.map((p) => ({
      type: "phone",
      id: p.id,
      title: p.number,
      subtitle: [p.type, p.company?.name].filter(Boolean).join(" · "),
      href: p.company ? `/companies/${p.company.id}` : "/companies",
    })),
  ]);
}
