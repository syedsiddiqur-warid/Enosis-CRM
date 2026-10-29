# Importing your Dynamics CRM leads

Your Dynamics "Lead Advanced Find View" export has **one row per company**. Each row holds the company, one lead
person, and two free-text columns: **Description** (the targets and phone numbers) and **Caller Notes** (the call
history). The import turns each row into:

| From the row | Becomes in this CRM |
| --- | --- |
| Company Name, Website, Industry, Employees, Country, State/Province, … | A **company** |
| First Name, Last Name, Job Title, Email | The **lead person**: a contact linked to the company |
| Description → `Targets>>` lines | One **contact per target**, linked to the company |
| Description → each target's emails, numbers, `*208` extension, `DBND-627` code, remarks | The contact's email, other emails, phone numbers (their extension on the main line, with the DBND code), and a timeline note |
| Description → `Numbers>>` lines and Telephone 1 / 2 | The company's **phone numbers**, with their status ("wrong", "disconnected") and notes |
| Description → the text after `Targets>>` ("DBND-* (3 FN), Sales-2") | The **phone menu (IVR path)** of the main number |
| Description → "Types of service/apps", "Industry focus", "Career page", LinkedIn link, `*Tech123*` | Types of services or apps, career page, LinkedIn company page, tags |
| Caller Notes → `CRT:` and `T2T:` entries | **Logged calls** with date and time, number dialled, path (OPT / DBND / Direct), outcome and the person spoken to |
| Caller Notes → other dated entries ("UPDATED RESEARCH…") | Timeline **notes** with their date |
| Anything the import can't place | One note on the company, **kept exactly as written** |

Contacts and companies are linked both ways: a company's **Contacts** card lists all its targets, and each contact
shows its company in the header and in the **Companies** card. A contact's first company is its primary company.

## How to import

1. Export the leads from Dynamics to Excel (the same view and columns as `CRM all fields with data.xlsx`).
   Keep the `(Do Not Modify) Lead` column: it lets you re-import later without creating duplicates.
2. **Before the first import, add your team in Settings → Users & teams**, using the same full names as in Dynamics
   (Owner, Caller / Owner, Researched By, Viable / Callable Checked By). Names that don't match a user are not lost:
   they are listed in a note on the company and in the import results, and a later re-import fills them in.
3. Open **Companies → Import** (or `/import?object=companies`) and upload the file.
   The import recognises a Dynamics lead export and maps every column itself. It also ticks
   "add dropdown values that don't exist yet", so your sources, campaigns and research results are kept.
4. **Check the data**: the review lists, for every company, the targets, numbers, calls and notes it found.
   Untick anything wrong. Rows with unrecognised call outcomes or leftover text are marked so you can check them.
5. **Import.** Large files run in small batches; keep the tab open. The imported companies are also put in a
   static segment named after the file, so you can find the batch afterwards.

Re-importing the same export (or a newer one) is safe:

- Companies are matched by their Dynamics lead ID, then by website, then by name.
- Contacts are matched by any of their email addresses, then by name at the company.
- Existing values are kept; only empty fields are filled.
- Calls already imported (same time and number) and notes with the same text are skipped.

## Column mapping

| Dynamics column | CRM property |
| --- | --- |
| (Do Not Modify) Lead | Dynamics lead ID |
| Owner | Company owner |
| Country, State/Province | Country/Region, State/Province. The time zone is set from them |
| First Name, Last Name, Job Title, Email | Lead person › First name, Last name, Job title, Email |
| Company Name, Website, LinkedIn, Email Address 2 | Company name, Company domain name, LinkedIn company page, Company email |
| Industry, No. of Employees, Founded On, Technology Focus | Industry, Number of employees, Year founded, Technology focus |
| Employee Growth, Investment Information, Offer Type | Employee growth trend, Investment information, Offer type |
| Source, Campaign | Lead source, Campaign (legacy) |
| Viable Status / Checked By / Checked On | Viable, Viable checked by, Viable checked on |
| Callable Status / Checked By / Checked On | Callable, Callable checked by, Callable checked on |
| Research Result, Reseach Type, Researched By, Research Date | Research result, Research type, Researcher, Researched on |
| Research Notes | A note on the company |
| Address 1: Telephone 1 / 2 | Company phone numbers |
| Calling Outcome, Interest Level, Outsourcing Experience, Gatekeeper | The company properties of the same names |
| CRT Count | CRT count (never lowered by the imported calls) |
| Email Status, Caller / Owner | Email status, Caller |
| Description | Targets, numbers, phone menu and company details (see above) |
| Caller Notes | Calls and notes |

Not imported, and why:

- **Row Checksum, Modified On/By, Created On/By**: Dynamics bookkeeping.
- **Zone**: the time zone comes from the State/Province, which is more exact (Arizona, for example).
- **Name**: First Name and Last Name are used instead.
- **Target Count**: counted from the contacts linked to the company.
- **Lead State** ("Cold Lead"): the lead journey stage is set from Viable / Callable and then moved on by the
  imported calls (Calling, Connected…).
- **Last Call Date, Call Status**: worked out from the imported calls.
- **Follow-up Call Date**: the export holds placeholder dates (year 5500, 6600…).

You can change any of these on the mapping screen before importing, and save the mapping as a template.

## Writing the Description so it imports cleanly

The import understands the way your team writes today, including the variations in the export:

```
*Tech123*
Types of service/apps: Safety Data Platform
Industry focus: Healthcare
Career page: https://example.com/careers
Notes: https://www.linkedin.com/company/example/

Targets>> DBND-* (3 FN), Sales-2
Jordan Ellis - Founder & President, jellis@example.com, j.ellis@example.com, 512.555.0172, 512-555-0100 x202
Priya Raman - Vice President & Partner *208 (DBND-627)
Sam Ortega - Director Of Product Development *203 (DBND-332) (Prank VM)
D: 512.555.0188 (Seamless)
Alex Kim - Director of Engineering (No longer)
Morgan Hale - Co-Founder and CTO (DNC till 03/11/2027)

Numbers>>
512.555.0100
512.555.0199 (Wrong number)
```

- One person per line: **Name - Title** or **Name, Title**, then emails and numbers in any order.
- A line that starts with an email, a number or `D:` / `O:` / `M:` right under a person belongs to that person.
  Leave a blank line before a number that belongs to the company instead.
- `*208` or `x 208` is the person's extension on the main line; `DBND-627` / `627 DBND` is their dial-by-name code;
  `(x DBND)` or `(DBND not listed)` means they aren't in the directory.
- Write `(No longer)`, `(Not the right person)`, `(DNC till MM/DD/YYYY)`, `(EA - name)` in brackets.
  "No longer" contacts are kept with lead status *Unqualified*; a DNC date still ahead marks them *Do not call*.
- `Targets>>`, `Targets>>>`, `Targets:` and `Numbers>>`, `Numbers>`, `Number>>`, `Numbers:` all work.
- Caller Notes entries start a line with the date and time: `02/28/2025: 12:41 PM: CRT: …` or `… T2T: …`.
  Times are read as Bangladesh time (the callers' clock) unless you choose the company's time zone on the review step.

## Other spreadsheets (Seamless, Apollo, Lusha, your own lists)

- **Companies with one person per row**: import as companies; map the person's columns to *Lead person › …*.
- **People with their company**: import as contacts; map *Company name* or *Company domain* so each contact is
  linked to (or creates) its company, and the *Company › …* columns to fill the company's details.
- The import page has downloadable templates with every column and the allowed values.
