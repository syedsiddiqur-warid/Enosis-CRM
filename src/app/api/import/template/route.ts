import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { importTargets, sampleValue, type ImportObject } from "@/lib/crm/import-shared";
import { getPropDefs } from "@/lib/crm/properties";

const OBJECTS: Record<string, ImportObject> = { contacts: "CONTACT", companies: "COMPANY" };

/** Columns every template starts with, in this order; the rest follow in property-group order. */
const FIRST: Record<ImportObject, string[]> = {
  CONTACT: ["prop:firstName", "prop:lastName", "prop:email", "prop:jobTitle", "prop:phone", "prop:mobile", "company:name", "company:domain", "prop:linkedinUrl", "prop:city", "prop:country", "prop:timeZone", "prop:ownerId"],
  COMPANY: ["prop:name", "prop:domain", "prop:phone", "phones", "prop:industry", "prop:employees", "prop:city", "prop:state", "prop:country", "prop:timeZone", "prop:source", "prop:listSource", "prop:ownerId"],
};

function csvCell(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** GET ?object=contacts|companies&kind=template|values|full
 *  template: the common columns with a sample row; full: every importable column; values: allowed values per column. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const object = OBJECTS[url.searchParams.get("object") ?? ""];
  if (!object) return new NextResponse("Not found", { status: 404 });
  const kind = url.searchParams.get("kind") ?? "template";
  const defs = await getPropDefs(object);
  const targets = importTargets(object, defs);
  const defOf = (t: string) => defs.find((d) => `prop:${d.name}` === t);
  const plural = object === "CONTACT" ? "contacts" : "companies";

  let lines: string[];
  let file: string;
  if (kind === "values") {
    // Reference sheet: column → what to put in it
    lines = [["Column", "Group", "Format / allowed values"].map(csvCell).join(",")];
    for (const t of targets) lines.push([t.label, t.group, t.hint ?? ""].map(csvCell).join(","));
    const users = await db.user.findMany({ where: { isActive: true }, select: { email: true } });
    lines.push(["(Owner / user columns)", "", `Users: ${users.map((u) => u.email).join("; ")}`].map(csvCell).join(","));
    file = `${plural}-import-format.csv`;
  } else {
    const chosen = kind === "full" ? [...FIRST[object].filter((t) => targets.some((x) => x.value === t)), ...targets.map((t) => t.value).filter((t) => !FIRST[object].includes(t))] : FIRST[object];
    const cols = chosen.map((t) => targets.find((x) => x.value === t)!).filter(Boolean);
    // Headers are the property labels, so the importer maps them automatically
    lines = [cols.map((c) => csvCell(c.value === "company:name" ? "Company name" : c.value === "company:domain" ? "Company domain" : c.value === "phones" ? "Other phone numbers" : c.label)).join(",")];
    // Owner-type sample cells use the downloader's own email so the sample row imports cleanly
    lines.push(cols.map((c) => csvCell(defOf(c.value)?.type === "USER" ? (session.user.email ?? "") : sampleValue(defOf(c.value), c.value, object))).join(","));
    file = `${plural}-import-template${kind === "full" ? "-all-columns" : ""}.csv`;
  }
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
  });
}
