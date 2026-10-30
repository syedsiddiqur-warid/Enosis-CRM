// A company's emails: the main one is the built-in `email` property, the rest live in properties.otherEmails.
export const OTHER_EMAILS = "otherEmails";

export function companyEmailList(co: { email: string | null; properties: unknown }): string[] {
  const props = (co.properties ?? {}) as Record<string, unknown>;
  const others = Array.isArray(props[OTHER_EMAILS]) ? (props[OTHER_EMAILS] as unknown[]).filter((e): e is string => typeof e === "string") : [];
  return uniqueEmails([co.email, ...others]);
}

export function uniqueEmails(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw?.trim();
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
  }
  return out;
}
