import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/crm/dates";
import { loadQueryContext } from "@/lib/crm/context";
import { DEFAULT_COLUMNS } from "@/lib/crm/defaults";
import { loadIndex, type IndexSearchParams } from "@/lib/crm/index-loader";
import { buildWhere, fetchRows, searchWhere, type Where } from "@/lib/crm/query";
import { segmentRecordsWhere, segmentVisibilityWhere } from "@/lib/crm/segments";
import type { CrmObject, SortSpec } from "@/lib/crm/types";

const OBJECTS: Record<string, CrmObject> = { contacts: "CONTACT", companies: "COMPANY" };
const MAX_ROWS = 10000;

function csvCell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export of the current view (same params as the index page), or selected ids. */
export async function GET(req: Request, { params }: { params: Promise<{ object: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const object = OBJECTS[(await params).object];
  if (!object) return new NextResponse("Not found", { status: 404 });

  const user = await db.user.findUnique({ where: { id: session.user.id }, include: { role: true } });
  const perms = (user?.role?.permissions ?? {}) as { contacts?: { export?: boolean } };
  if (perms.contacts?.export === false) return new NextResponse("Your role can't export", { status: 403 });

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams) as IndexSearchParams & { ids?: string; segment?: string; campaign?: string };
  const ctx = await loadQueryContext(session.user.id);
  const defs = ctx.defs[object];

  let where: Where;
  let sort: SortSpec | null;
  let columns: string[];
  let label: string;
  if (sp.campaign && object === "COMPANY") {
    // Campaign export: its current companies
    const campaign = await db.campaign.findUnique({ where: { id: sp.campaign }, select: { id: true, name: true } });
    if (!campaign) return new NextResponse("Not found", { status: 404 });
    where = { deletedAt: null, campaigns: { some: { campaignId: campaign.id, removedAt: null } } };
    sort = null;
    columns = DEFAULT_COLUMNS[object];
    label = campaign.name;
  } else if (sp.segment) {
    // Segment export: its members, with the object's default columns
    const segment = await db.segment.findFirst({ where: { AND: [{ id: sp.segment, objectType: object }, await segmentVisibilityWhere(session.user.id)] } });
    if (!segment) return new NextResponse("Not found", { status: 404 });
    where = { AND: [segmentRecordsWhere(object, segment.id, ctx), searchWhere(object, sp.q ?? "") ?? {}] };
    sort = null;
    columns = DEFAULT_COLUMNS[object];
    label = segment.name;
  } else {
    // Reuse the index loader to resolve the view + overrides, then fetch every row
    const base = await loadIndex(object, { ...sp, page: "1", size: "25" }, session.user.id);
    const active = base.views.find((v) => v.id === base.activeViewId)!;
    where = buildWhere(object, active.systemKey, base.state, base.q, ctx);
    sort = base.state.sort;
    columns = base.state.columns.map((c) => c.property);
    label = active.name;
  }
  if (sp.ids) where = { AND: [where, { id: { in: sp.ids.split(",") } }] };
  const { rows } = await fetchRows(object, where, sort, 0, MAX_ROWS, defs);

  const users = new Map((await db.user.findMany({ select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  const cols = columns.map((c) => defs.find((d) => d.name === c)).filter((d) => !!d);
  const header = ["Record ID", object === "CONTACT" ? "Name" : "Company name", ...cols.map((d) => d.label)];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const cells = cols.map((d) => {
      const v = r.values[d.name];
      if (d.type === "USER") return users.get(String(v)) ?? "";
      if (d.type === "DATETIME" && v) return formatDateTime(String(v));
      return v;
    });
    lines.push([r.id, r.name, ...cells].map(csvCell).join(","));
  }

  await db.auditLog.create({ data: { objectType: object, action: "export", changes: { rows: rows.length, ...(sp.campaign ? { campaign: label } : sp.segment ? { segment: label } : { view: label }) }, userId: session.user.id } });
  const fileName = `${(await params).object}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"` },
  });
}
