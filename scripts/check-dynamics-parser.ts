/* Smoke test for the Dynamics Description / Caller Notes parsers.
   Usage: npx tsx scripts/check-dynamics-parser.ts */
import { parseDynamics } from "../src/lib/crm/dynamics-parser";

const OUTCOMES = ["VM", "No Answer", "Temp Busy", "Gatekeeper", "Transferred to VM", "Connected – Not Interested", "Connected – Interested", "Callback Requested", "Meeting Booked", "Wrong Number"];

const description = `Workforce management software; scaling mobile team.
Targets>>
Adam Whitfield (CTO) adam.whitfield@tcpsoftware.com
Priya Raman - VP of Engineering - 813-555-0177
Greg Holloway, Director of Product, https://www.linkedin.com/in/gregholloway
Dana Mercer
Numbers>>
813-555-0100 Main: DBND 9, Sales 1, OPT 0
(813) 555-0142 Sales 1 (Temp Busy)
+1 813 555 0187 Direct - Adam
813.555.0199 x204 wrong number`;

const callerNotes = `10/23/2026: 01:56 PM: CRT: (325-223-9500 OPT) VM.
10/24/2026: 10:12 AM: CRT: (813-555-0100 DBND) Gatekeeper - receptionist asked to email info to Adam
10/25/2026 2:30 PM - CRT: 813-555-0187 Direct. Spoke to Adam, interested, send case studies
10/26/2026: 11:00 AM: Sent follow-up email with WFM case study.
10/27/2026: 09:05 AM: CRT: (813-555-0142 OPT) line busy
31/10/2026: 04:15 PM: CRT: (813-555-0100 DBND) call back next week
13/45/2026: 99:99 PM: garbage date`;

const single = "Targets>> Mark Ellis (CEO); Jane Roe - COO Numbers>> 512-555-0100 DBND 4, OPT 0; 512-555-0111 Direct Jane";

for (const [label, d, n] of [
  ["Full lead", description, callerNotes],
  ["Single-line sections", single, null],
] as const) {
  const p = parseDynamics(d, n, OUTCOMES);
  console.log(`\n== ${label} ==`);
  console.log("Targets:");
  for (const t of p.targets) console.log(`  ${t.firstName} ${t.lastName ?? ""} | ${t.jobTitle ?? "-"} | ${t.email ?? "-"} | ${t.phone ?? "-"} | ${t.linkedinUrl ?? "-"}`);
  console.log("Numbers:");
  for (const x of p.numbers) console.log(`  ${x.number}${x.extension ? ` x${x.extension}` : ""} | ${x.type} | IVR ${x.ivrPath ?? "-"} | ${x.status ?? "-"} | hint ${x.contactHint ?? "-"}`);
  console.log("Calls:");
  for (const c of p.calls) console.log(`  ${c.at} | ${c.number ?? "-"} | ${c.path ?? "-"} | ${c.result ?? "(not recognised)"} | "${c.outcomeText}"`);
  console.log("Notes:");
  for (const o of p.notes) console.log(`  ${o.at ?? "-"} | ${o.body}`);
  console.log("Unparsed:", JSON.stringify(p.unparsed));
}
