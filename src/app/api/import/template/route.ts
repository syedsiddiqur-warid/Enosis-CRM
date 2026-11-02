import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { COMPANY_PROP_PREFIX, CONTACT_PROP_PREFIX, importTargets, sampleValue, type ImportObject } from "@/lib/crm/import-shared";
import { getPropDefs } from "@/lib/crm/properties";

const OBJECTS: Record<string, ImportObject> = { contacts: "CONTACT", companies: "COMPANY" };

/** Columns every template starts with, in this order; the rest follow in property-group order.
 *  Each template also fills the other side: a contact row names and describes its company, a company row its lead person. */
const co = (n: string) => `${COMPANY_PROP_PREFIX}${n}`;
const person = (n: string) => `${CONTACT_PROP_PREFIX}${n}`;
const FIRST: Record<ImportObject, string[]> = {
  CONTACT: [
    "prop:firstName", "prop:lastName", "prop:email", "prop:jobTitle", "prop:phone", "prop:mobile", "prop:linkedinUrl", "prop:city", "prop:country", "prop:timeZone", "prop:ownerId",
    "company:name", "company:domain", co("phone"), co("industry"), co("employees"), co("city"), co("state"), co("country"), co("source"),
  ],
  COMPANY: [
    "prop:name", "prop:domain", "prop:phone", "phones", "prop:industry", "prop:employees", "prop:city", "prop:state", "prop:country", "prop:timeZone", "prop:source", "prop:listSource", "prop:ownerId",
    person("firstName"), person("lastName"), person("jobTitle"), person("email"), person("phone"), person("linkedinUrl"),
  ],
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
  const [defs, otherDefs] = await Promise.all([getPropDefs(object), getPropDefs(object === "CONTACT" ? "COMPANY" : "CONTACT")]);
  const targets = importTargets(object, defs, otherDefs);
  const otherPrefix = object === "CONTACT" ? COMPANY_PROP_PREFIX : CONTACT_PROP_PREFIX;
  const defOf = (t: string) => (t.startsWith(otherPrefix) ? otherDefs.find((d) => `${otherPrefix}${d.name}` === t) : defs.find((d) => `prop:${d.name}` === t));
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
    lines.push(cols.map((c) => csvCell(defOf(c.value)?.type === "USER" ? (session.user.email ?? "") : sampleValue(defOf(c.value), c.value, c.value.startsWith(otherPrefix) ? (object === "CONTACT" ? "COMPANY" : "CONTACT") : object))).join(","));
    file = `${plural}-import-template${kind === "full" ? "-all-columns" : ""}.csv`;
  }
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
  });
}
