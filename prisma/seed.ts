/* Seed: metadata (properties, lists, pipeline, views, layouts, rules) + sample data.
   Run with `npm run db:seed`. Safe to re-run: it wipes record data first. */
import { PrismaClient, type ObjectType, type Prisma } from "@prisma/client";
import {
  CAMPAIGNS,
  LEAD_SOURCES,
  LEAD_STATES,
  DEFAULT_CHIPS,
  DEFAULT_COLUMNS,
  DEFAULT_PIPELINE,
  DEFAULT_PREVIEW,
  INDUSTRIES,
  LIST_SOURCES,
  OPTION_LISTS,
  PROPERTIES,
  PROPERTY_GROUPS,
  TECHNOLOGIES,
} from "../src/lib/crm/defaults";

const db = new PrismaClient();

// Deterministic pseudo-random so the seed is stable between runs
let s = 42;
const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const daysAgo = (n: number, h = 10) => new Date(Date.now() - n * 864e5 - h * 36e5);
const daysAhead = (n: number) => new Date(Date.now() + n * 864e5);

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "siddiqur.rahim@enosisbd.com";
/** `npm run db:seed:prod` (--no-sample-data) or SEED_SAMPLE_DATA=false seeds only what a real workspace needs:
 *  the admin, roles, teams, properties, lists, layouts, pipeline and rules, with no sample people, companies or activity. */
const SAMPLE_DATA = !process.argv.includes("--no-sample-data") && process.env.SEED_SAMPLE_DATA !== "false";
const JOURNEY_PATH = LEAD_STATES.filter((o) => o.kind !== "exit").map((o) => o.value);

async function wipe() {
  // Order matters for FKs
  await db.$transaction([
    db.campaignCompany.deleteMany(),
    db.journeyEvent.deleteMany(),
    db.buyingSignal.deleteMany(),
    db.enrichmentRun.deleteMany(),
    db.importJob.deleteMany(),
    db.importMappingTemplate.deleteMany(),
    db.integration.deleteMany(),
    db.segmentMember.deleteMany(),
    db.segment.deleteMany(),
    db.activityContact.deleteMany(),
    db.activityCompany.deleteMany(),
    db.activityDeal.deleteMany(),
    db.activity.deleteMany(),
    db.campaign.deleteMany(),
    db.taskQueue.deleteMany(),
    db.dealContact.deleteMany(),
    db.dealCompany.deleteMany(),
    db.deal.deleteMany(),
    db.pipelineStage.deleteMany(),
    db.pipeline.deleteMany(),
    db.phoneNumber.deleteMany(),
    db.contactCompany.deleteMany(),
    db.contact.deleteMany(),
    db.company.deleteMany(),
    db.savedView.deleteMany(),
    db.objectSettings.deleteMany(),
    db.recordLayoutVersion.deleteMany(),
    db.recordLayout.deleteMany(),
    db.propertyDefinition.deleteMany(),
    db.propertyGroup.deleteMany(),
    db.optionList.deleteMany(),
    db.followUpRule.deleteMany(),
    db.associationLabel.deleteMany(),
    db.automationRule.deleteMany(),
    db.reportWidget.deleteMany(),
    db.dashboard.deleteMany(),
    db.caseStudy.deleteMany(),
    db.auditLog.deleteMany(),
    db.notification.deleteMany(),
    db.recentView.deleteMany(),
    db.userUiState.deleteMany(),
    db.teamMember.deleteMany(),
    db.team.deleteMany(),
  ]);
}

async function seedUsers() {
  const roles = {
    Admin: { contacts: { visibility: "ALL", delete: true, export: true, bulkEdit: true, import: true }, settings: { edit: true } },
    Manager: { contacts: { visibility: "ALL", delete: true, export: true, bulkEdit: true, import: true }, settings: { edit: false } },
    Caller: { contacts: { visibility: "ALL", delete: false, export: false, bulkEdit: true, import: false }, settings: { edit: false } },
    Researcher: { contacts: { visibility: "ALL", delete: false, export: true, bulkEdit: true, import: true }, settings: { edit: false } },
  };
  const roleIds: Record<string, string> = {};
  for (const [name, permissions] of Object.entries(roles)) {
    const r = await db.role.upsert({ where: { name }, update: { permissions }, create: { name, permissions, isSystem: true } });
    roleIds[name] = r.id;
  }

  const people = [
    { email: ADMIN_EMAIL, name: "Siddiqur Rahim", role: "Admin" },
    ...(SAMPLE_DATA
      ? [
          { email: "nadia.islam@enosisbd.com", name: "Nadia Islam", role: "Caller" },
          { email: "tanvir.ahmed@enosisbd.com", name: "Tanvir Ahmed", role: "Caller" },
          { email: "farhana.akter@enosisbd.com", name: "Farhana Akter", role: "Researcher" },
          { email: "rafiq.hasan@enosisbd.com", name: "Rafiq Hasan", role: "Manager" },
        ]
      : []),
  ];
  const users = [];
  for (const p of people) {
    users.push(
      await db.user.upsert({
        where: { email: p.email },
        update: { name: p.name, roleId: roleIds[p.role] },
        create: { email: p.email, name: p.name, roleId: roleIds[p.role], preferences: { timeZone: "Asia/Dhaka" } },
      }),
    );
  }

  const callers = await db.team.create({ data: { name: "Callers" } });
  const research = await db.team.create({ data: { name: "Research" } });
  await db.teamMember.createMany({
    data: SAMPLE_DATA
      ? [
          { teamId: callers.id, userId: users[1].id },
          { teamId: callers.id, userId: users[2].id },
          { teamId: callers.id, userId: users[4].id, isManager: true },
          { teamId: research.id, userId: users[3].id },
          { teamId: research.id, userId: users[0].id, isManager: true },
        ]
      : [
          // Real teammates are added in Settings → Users & teams
          { teamId: callers.id, userId: users[0].id, isManager: true },
          { teamId: research.id, userId: users[0].id, isManager: true },
        ],
  });
  return { users, teams: { callers, research } };
}

async function seedMetadata() {
  for (const objectType of ["CONTACT", "COMPANY", "DEAL"] as const) {
    const groupIds: Record<string, string> = {};
    for (const [i, g] of PROPERTY_GROUPS[objectType].entries()) {
      const row = await db.propertyGroup.create({ data: { objectType, name: g.name, label: g.label, order: i } });
      groupIds[g.name] = row.id;
    }
    await db.propertyDefinition.createMany({
      data: PROPERTIES[objectType].map((p, i) => ({
        objectType,
        name: p.name,
        label: p.label,
        type: p.type,
        groupId: groupIds[p.group],
        order: i,
        isBuiltIn: p.isBuiltIn ?? true,
        isReadOnly: p.isReadOnly ?? false,
        format: p.format,
        description: p.description,
        options: (p.options ?? undefined) as Prisma.InputJsonValue | undefined,
        showWhen: (p.showWhen ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });

    await db.objectSettings.create({
      data: {
        objectType,
        defaultColumns: DEFAULT_COLUMNS[objectType].map((property) => ({ property })),
        defaultQuickFilters: DEFAULT_CHIPS[objectType],
        previewProperties: DEFAULT_PREVIEW[objectType],
        boardCardProperties: objectType === "CONTACT" ? ["ownerId", "crtCount", "timeZone", "nextFollowUpAt"] : ["ownerId"],
        associationSettings: { maxShown: 5 },
      },
    });

    // System view tabs: All / My / Unassigned
    const plural = objectType === "COMPANY" ? "companies" : objectType.toLowerCase() + "s";
    const base = {
      objectType,
      visibility: "EVERYONE" as const,
      columns: DEFAULT_COLUMNS[objectType].map((property) => ({ property })),
      quickFilters: DEFAULT_CHIPS[objectType],
      sort: [{ property: "createdAt", direction: "desc" }],
    };
    await db.savedView.createMany({
      data: [
        { ...base, name: `All ${plural}`, systemKey: "all", order: 0 },
        { ...base, name: `My ${plural}`, systemKey: "mine", order: 1 },
        { ...base, name: `Unassigned ${plural}`, systemKey: "unassigned", order: 2 },
      ],
    });
  }

  await db.optionList.createMany({
    data: OPTION_LISTS.map((l) => ({ key: l.key, label: l.label, options: l.options as unknown as Prisma.InputJsonValue })),
  });

  await db.followUpRule.createMany({
    data: [
      { callResult: "VM", taskTitle: "Call again", dueInDays: 2 },
      { callResult: "No Answer", taskTitle: "Call again", dueInDays: 1 },
      { callResult: "Temp Busy", taskTitle: "Retry number", dueInDays: 1 },
      { callResult: "Callback Requested", taskTitle: "Call back", dueInDays: 1 },
      { callResult: "Connected – Interested", taskTitle: "Send follow-up email", taskType: "Email", dueInDays: 1 },
    ],
  });

  const labels: [ObjectType, ObjectType, string][] = [
    ["CONTACT", "COMPANY", "Primary"],
    ["CONTACT", "COMPANY", "Decision maker"],
    ["CONTACT", "COMPANY", "Gatekeeper"],
    ["CONTACT", "COMPANY", "Champion"],
    ["CONTACT", "COMPANY", "Former employee"],
  ];
  await db.associationLabel.createMany({
    data: labels.map(([fromObject, toObject, label], order) => ({ fromObject, toObject, label, order })),
  });

  // §6 automations as editable rules
  await db.automationRule.createMany({
    data: [
      {
        name: "First call → Attempted to contact",
        objectType: "CONTACT",
        isSystem: true,
        trigger: { kind: "activity_logged", activityType: "CALL" },
        conditions: { op: "AND", conditions: [{ property: "crtCount", operator: "eq", value: 1 }] },
        actions: [{ kind: "set_property", property: "leadStatus", value: "Attempted to contact" }],
        order: 0,
      },
      {
        name: "Connected call → Connected",
        objectType: "CONTACT",
        isSystem: true,
        trigger: { kind: "activity_logged", activityType: "CALL" },
        conditions: { op: "AND", conditions: [{ property: "callResult", operator: "starts_with", value: "Connected" }] },
        actions: [{ kind: "set_property", property: "leadStatus", value: "Connected" }],
        order: 1,
      },
      {
        name: "Deal created → Open Deal / Opportunity",
        objectType: "DEAL",
        isSystem: true,
        trigger: { kind: "record_created" },
        conditions: {},
        actions: [
          { kind: "set_property", target: "associated_contacts", property: "leadStatus", value: "Open Deal" },
          { kind: "set_property", target: "associated_contacts", property: "lifecycleStage", value: "Opportunity" },
        ],
        order: 2,
      },
    ],
  });

  await db.workspaceSettings.upsert({
    where: { id: "workspace" },
    update: {},
    create: { id: "workspace", name: "Enosis CRM", primaryColor: "#00806e", defaultTimeZone: "Asia/Dhaka" },
  });
}

async function seedLayouts(teams: { callers: { id: string }; research: { id: string } }) {
  const contactLayout = {
    left: {
      keyInfo: ["ownerId", "phone", "city", "timeZone", "lifecycleStage", "leadStatus", "lastContactedAt", "callStatus", "crtCount", "nextFollowUpAt"],
      cards: [
        { id: "about", title: "About this contact", group: "contact_info" },
        { id: "research", title: "Research", group: "research" },
        { id: "viability", title: "Viability & Callable", group: "viability" },
        { id: "calling", title: "Calling", group: "calling" },
        { id: "campaign", title: "Campaign", group: "campaign" },
      ],
      quickActions: ["note", "email", "call", "task", "meeting", "more"],
    },
    center: {
      tabs: [
        { id: "overview", label: "Overview", cards: [{ id: "insights", kind: "ai_insights" }, { id: "summary", kind: "activity_summary" }] },
        { id: "activities", label: "Activities", cards: [{ id: "timeline", kind: "activity_timeline" }] },
      ],
    },
    right: {
      cards: [
        { id: "companies", kind: "association", object: "COMPANY", limit: 5 },
        { id: "journey", kind: "lead_journey", title: "Company lead journey" },
        { id: "campaigns", kind: "campaigns", limit: 5 },
        { id: "phones", kind: "phone_numbers", limit: 5 },
        { id: "deals", kind: "association", object: "DEAL", limit: 5 },
        { id: "projects", kind: "case_studies", limit: 3 },
        { id: "segments", kind: "segments", limit: 5 },
      ],
    },
  };
  const callerLayout = {
    ...contactLayout,
    right: { cards: [contactLayout.right.cards.find((c) => c.id === "phones")!, ...contactLayout.right.cards.filter((c) => c.id !== "phones")] },
  };
  const researchLayout = {
    ...contactLayout,
    left: { ...contactLayout.left, cards: [contactLayout.left.cards[1], contactLayout.left.cards[2], contactLayout.left.cards[0], ...contactLayout.left.cards.slice(3)] },
  };
  const companyLayout = {
    left: {
      keyInfo: ["ownerId", "domain", "phone", "industry", "employees", "country", "timeZone", "leadState", "source", "callStatus", "crtCount", "lastCallAt"],
      cards: [
        { id: "about", title: "About this company", group: "company_info" },
        { id: "firmographics", title: "Firmographics", group: "firmographics" },
        { id: "research", title: "Sourcing & research", group: "research" },
        { id: "viability", title: "Viability & Callable", group: "viability" },
        { id: "calling", title: "Calling", group: "calling" },
        { id: "lifecycle", title: "Lifecycle & journey", group: "lifecycle" },
        { id: "tech", title: "Tech", group: "tech" },
        { id: "campaign", title: "Campaigns & signals", group: "campaign" },
      ],
      quickActions: ["note", "email", "call", "task", "meeting", "more"],
    },
    center: contactLayout.center,
    right: {
      cards: [
        { id: "journey", kind: "lead_journey", title: "Lead journey" },
        { id: "signals", kind: "buying_signals", limit: 5 },
        { id: "campaigns", kind: "campaigns", limit: 5 },
        { id: "contacts", kind: "association", object: "CONTACT", limit: 10 },
        { id: "phones", kind: "phone_numbers", limit: 5 },
        { id: "deals", kind: "association", object: "DEAL", limit: 5 },
        { id: "projects", kind: "case_studies", limit: 3 },
        { id: "segments", kind: "segments", limit: 5 },
      ],
    },
  };
  const layouts = [
    { objectType: "CONTACT" as const, name: "Default", isDefault: true, config: contactLayout },
    { objectType: "CONTACT" as const, name: "Callers", teamId: teams.callers.id, config: callerLayout },
    { objectType: "CONTACT" as const, name: "Research", teamId: teams.research.id, config: researchLayout },
    { objectType: "COMPANY" as const, name: "Default", isDefault: true, config: companyLayout },
    {
      objectType: "COMPANY" as const,
      name: "Research",
      teamId: teams.research.id,
      config: {
        ...companyLayout,
        left: { ...companyLayout.left, cards: ["research", "viability", "about", "firmographics", "tech", "lifecycle", "campaign", "calling"].map((id) => companyLayout.left.cards.find((c) => c.id === id)!) },
      },
    },
  ];
  for (const l of layouts) {
    const row = await db.recordLayout.create({ data: l });
    await db.recordLayoutVersion.create({ data: { layoutId: row.id, version: 1, config: l.config } });
  }
}

const FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Sarah", "David", "Emily", "Daniel", "Jessica", "Kevin", "Laura", "Brian", "Megan", "Steven", "Rachel", "Andrew", "Nicole", "Jason", "Hannah", "Eric", "Olivia", "Mark", "Grace"];
const LAST = ["Carter", "Nguyen", "Patel", "Brooks", "Reed", "Foster", "Hayes", "Kim", "Morgan", "Bennett", "Coleman", "Price", "Russell", "Sullivan", "Ward", "Hughes", "Myers", "Ford", "Powell", "Long"];
const TITLES = [
  ["CEO", "C-Level", "Executive"],
  ["CTO", "C-Level", "Engineering"],
  ["VP of Engineering", "VP", "Engineering"],
  ["Director of Engineering", "Director", "Engineering"],
  ["Head of Product", "Director", "Product"],
  ["COO", "C-Level", "Operations"],
  ["Engineering Manager", "Manager", "Engineering"],
  ["Founder", "Owner", "Executive"],
] as const;
const PLACES = [
  { city: "Austin", state: "TX", country: "United States", tz: "America/Chicago", area: "512" },
  { city: "Chicago", state: "IL", country: "United States", tz: "America/Chicago", area: "312" },
  { city: "Denver", state: "CO", country: "United States", tz: "America/Denver", area: "303" },
  { city: "Seattle", state: "WA", country: "United States", tz: "America/Los_Angeles", area: "206" },
  { city: "San Diego", state: "CA", country: "United States", tz: "America/Los_Angeles", area: "619" },
  { city: "Boston", state: "MA", country: "United States", tz: "America/New_York", area: "617" },
  { city: "Atlanta", state: "GA", country: "United States", tz: "America/New_York", area: "404" },
  { city: "Toronto", state: "ON", country: "Canada", tz: "America/New_York", area: "416" },
  { city: "London", state: "England", country: "United Kingdom", tz: "Europe/London", area: "20" },
];
const COMPANY_NAMES = [
  "Brightline Logistics", "Northwind Health", "Cobalt Ledger", "Maple Grove Learning", "Pinecrest Analytics", "Harborview Retail",
  "Summit Field Services", "Bluefin Payments", "Redwood Clinical", "Ironclad Compliance", "Lumen Property Group", "Quarry Labs",
  "Silverline Dispatch", "Orchard Benefits", "Copperleaf Insurance", "Tidewater Freight", "Kestrel Scheduling", "Granite HR",
  "Beacon Ed Tech", "Vantage Fleet", "Meridian Claims", "Foxglove Marketing", "Juniper Billing", "Atlas Workforce",
];

async function seedRecords(users: { id: string }[]) {
  const [admin, nadia, tanvir, farhana, rafiq] = users;
  const owners = [admin, nadia, tanvir, farhana, null];

  const pipeline = await db.pipeline.create({
    data: {
      name: DEFAULT_PIPELINE.name,
      stages: { create: DEFAULT_PIPELINE.stages.map((st, order) => ({ ...st, order })) },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  // ── TCP Software: the reference record (5 targets, 3 numbers, 3 CRTs) ──
  const tcp = await db.company.create({
    data: {
      name: "TCP Software",
      domain: "tcpsoftware.com",
      phone: "+18135550100",
      city: "Tampa",
      state: "FL",
      country: "United States",
      timeZone: "America/New_York",
      industry: "Computer Software",
      employees: 210,
      employeeGrowth: 6.5,
      foundedYear: 1989,
      offerType: "Product",
      technologies: [".NET", "Azure", "React"],
      description: "Workforce management software: time & attendance, employee scheduling and leave management.",
      servicesOrApps: "TimeClock Plus, Humanity Scheduling, mobile time-tracking apps",
      careerPageUrl: "https://tcpsoftware.com/careers",
      pitchNotes: "Scaling mobile + integrations team; .NET/Azure stack matches our WFM project experience.",
      listSource: "Directory - Capterra",
      source: "Online directory",
      campaign: "Q4 Oct–Dec 2026",
      batchNumber: "B-14",
      tags: ["Priority"],
      ownerId: nadia.id,
      lifecycleStage: "Lead",
      leadStatus: "Attempted to contact",
      leadState: "Calling",
      leadStateAt: daysAgo(6, 3),
      researchStatus: "Done",
      researcherId: farhana.id,
      researchedAt: daysAgo(11),
      crtCount: 3,
      callStatus: "Reached Gatekeeper",
      lastCallAt: daysAgo(1, 2),
      properties: {
        viable: "Yes",
        viableCheckedBy: farhana.id,
        viableCheckedOn: daysAgo(11).toISOString(),
        callable: "Yes",
        callableCheckedBy: farhana.id,
        callableCheckedOn: daysAgo(11).toISOString(),
        researchType: "Company research",
        researchResult: "Viable",
      },
      createdAt: daysAgo(13),
    },
  });
  const tcpTargets = [
    ["Adam", "Whitfield", "CTO", "C-Level", "Engineering", "yes"],
    ["Priya", "Raman", "VP of Engineering", "VP", "Engineering", "yes"],
    ["Greg", "Holloway", "Director of Product", "Director", "Product", "unknown"],
    ["Dana", "Mercer", "COO", "C-Level", "Operations", "no"],
    ["Luis", "Ortega", "Engineering Manager", "Manager", "Engineering", "yes"],
  ] as const;
  const tcpContacts = [];
  for (const [i, [firstName, lastName, jobTitle, seniority, department, inDbnd]] of tcpTargets.entries()) {
    tcpContacts.push(
      await db.contact.create({
        data: {
          firstName,
          lastName,
          jobTitle,
          seniority,
          department,
          inDbnd,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@tcpsoftware.com`,
          city: "Tampa",
          country: "United States",
          timeZone: "America/New_York",
          ownerId: nadia.id,
          lifecycleStage: "Lead",
          leadStatus: i === 0 ? "Attempted to contact" : "New",
          leadState: "Calling",
          campaign: "Q4 Oct–Dec 2026",
          callable: "Yes",
          callStatus: "Never Reached Targets",
          properties: { researchResult: "Viable", researchedOn: daysAgo(11).toISOString().slice(0, 10) },
          createdAt: daysAgo(12),
          companies: { create: { companyId: tcp.id, isPrimary: true, labels: i < 2 ? ["Decision maker"] : [] } },
        },
      }),
    );
  }
  const [main, sales, direct] = await Promise.all([
    db.phoneNumber.create({ data: { number: "+18135550100", type: "Main", ivrPath: "DBND 9, Sales 1, OPT 0", status: "Valid", companyId: tcp.id, lastDialedAt: daysAgo(1) } }),
    db.phoneNumber.create({ data: { number: "+18135550142", type: "Sales", ivrPath: "Sales 1", status: "Temp Busy", companyId: tcp.id, lastDialedAt: daysAgo(3) } }),
    db.phoneNumber.create({ data: { number: "+18135550187", type: "Direct", status: "Valid", companyId: tcp.id, contactId: tcpContacts[0].id, lastDialedAt: daysAgo(6) } }),
  ]);
  const crts = [
    { phone: direct, path: "Direct", result: "VM", at: daysAgo(6, 3), body: "Left VM introducing Enosis WFM experience." },
    { phone: sales, path: "OPT", result: "Temp Busy", at: daysAgo(3, 4), body: "Line busy." },
    { phone: main, path: "DBND", result: "Gatekeeper", at: daysAgo(1, 2), body: "Receptionist asked to email info; will forward to Adam." },
  ];
  for (const c of crts) {
    await db.activity.create({
      data: {
        type: "CALL",
        ownerId: nadia.id,
        occurredAt: c.at,
        phoneNumberId: c.phone.id,
        dialedNumber: c.phone.number,
        targetContactId: tcpContacts[0].id,
        callPath: c.path,
        callResult: c.result,
        gatekeeperType: c.result === "Gatekeeper" ? "Receptionist" : null,
        durationSec: c.result === "Gatekeeper" ? 95 : 40,
        body: c.body,
        contacts: { create: { contactId: tcpContacts[0].id } },
        companies: { create: { companyId: tcp.id } },
      },
    });
  }
  await db.contact.update({
    where: { id: tcpContacts[0].id },
    data: { crtCount: 3, lastCallAt: daysAgo(1, 2), lastContactedAt: daysAgo(1, 2), lastActivityAt: daysAgo(1, 2), callStatus: "Reached Gatekeeper", nextFollowUpAt: daysAhead(1) },
  });
  await db.company.update({ where: { id: tcp.id }, data: { lastActivityAt: daysAgo(1, 2), lastContactedAt: daysAgo(1, 2) } });
  await db.activity.create({
    data: {
      type: "TASK",
      title: "Call Adam Whitfield after info email",
      ownerId: nadia.id,
      assigneeId: nadia.id,
      dueAt: daysAhead(1),
      taskType: "Call",
      priority: "High",
      taskStatus: "NOT_STARTED",
      contacts: { create: { contactId: tcpContacts[0].id } },
      companies: { create: { companyId: tcp.id } },
    },
  });
  await db.activity.create({
    data: {
      type: "NOTE",
      ownerId: farhana.id,
      occurredAt: daysAgo(11),
      body: "<p>Researched via Capterra + LinkedIn. Hiring 4 .NET devs; recent Humanity acquisition means integration work.</p>",
      companies: { create: { companyId: tcp.id } },
    },
  });

  // ── Bulk sample companies & contacts ──
  const companies = [tcp];
  for (const [i, name] of COMPANY_NAMES.entries()) {
    const place = pick(PLACES);
    const domain = name.toLowerCase().replace(/[^a-z]+/g, "") + ".com";
    // Where the company is on its journey decides its research/viability fields
    const stage = pick(["Researched", "Viable", "Not viable", "Callable", "Callable", "In campaign", "Calling", "Calling", "Calling", "Connected", "Meeting booked", "Nurture"]);
    const order = JOURNEY_PATH.indexOf(stage);
    const viable = stage !== "Not viable" && stage !== "Researched";
    const callable = viable && (order >= JOURNEY_PATH.indexOf("Callable") || stage === "Nurture");
    const created = daysAgo(Math.floor(rand() * 80) + 10);
    companies.push(
      await db.company.create({
        data: {
          name,
          domain,
          phone: `+1${place.area.padEnd(3, "0")}555${String(1000 + i * 37).slice(0, 4)}`,
          city: place.city,
          state: place.state,
          country: place.country,
          timeZone: place.tz,
          industry: pick(INDUSTRIES).value,
          employees: Math.round(20 + rand() * 900),
          employeeGrowth: Math.round((rand() * 30 - 5) * 10) / 10,
          foundedYear: 1990 + Math.floor(rand() * 33),
          offerType: rand() > 0.4 ? "Product" : "Service",
          technologies: [pick(TECHNOLOGIES).value, pick(TECHNOLOGIES).value].filter((v, j, a) => a.indexOf(v) === j),
          listSource: pick(LIST_SOURCES).value,
          source: pick(LEAD_SOURCES).value,
          campaign: pick(CAMPAIGNS).value,
          batchNumber: `B-${10 + Math.floor(rand() * 6)}`,
          ownerId: pick(owners)?.id ?? null,
          lifecycleStage: pick(["Lead", "Lead", "Lead", "MQL", "SQL", "Subscriber"]),
          leadStatus: pick(["New", "New", "Open", "In progress", "Attempted to contact", "Connected", "Unqualified"]),
          leadState: stage,
          researchStatus: "Done",
          researcherId: pick([farhana, admin]).id,
          researchedAt: new Date(created.getTime() + 2 * 864e5),
          lastActivityAt: rand() > 0.3 ? daysAgo(Math.floor(rand() * 9)) : null,
          properties: {
            viable: viable ? "Yes" : stage === "Researched" ? null : "No",
            callable: viable ? (callable ? "Yes" : "No") : null,
            ...(stage === "Not viable" ? { disqualifyReason: pick(["Too small (under 20 devs)", "In-house team only", "Not a software buyer"]) } : {}),
          },
          createdAt: created,
        },
      }),
    );
  }

  // Companies just sourced by the research team (no research yet)
  const sourced = [
    ["Clearwater Dental Software", "clearwaterdental.io", "Seamless.AI"],
    ["Fieldnote CRM", "fieldnotecrm.com", "Apollo.io"],
    ["Pathway Telehealth", "pathwaytelehealth.com", "LinkedIn Sales Navigator"],
    ["Ridgeback Security", "ridgebacksec.com", "Lusha"],
    ["Orbit Freight Tech", "orbitfreight.tech", "Online directory"],
    ["Sproutly HR", "sproutlyhr.com", "Web portal"],
    ["Northstar Grants", "northstargrants.org", "Online directory"],
  ] as const;
  for (const [i, [name, domain, source]] of sourced.entries()) {
    await db.company.create({
      data: {
        name,
        domain,
        source,
        listSource: source === "Online directory" ? "Directory - Clutch" : null,
        batchNumber: "B-16",
        researchStatus: i < 3 ? "Not started" : "In progress",
        researcherId: i < 2 ? null : farhana.id,
        leadState: i < 3 ? "Sourced" : "Researching",
        leadStateAt: daysAgo(i < 3 ? 1 : 2),
        createdAt: daysAgo(3, i),
      },
    });
  }

  let contactCount = tcpContacts.length;
  for (const company of companies.slice(1)) {
    const n = 2 + Math.floor(rand() * 4);
    const pos = JOURNEY_PATH.indexOf(company.leadState!);
    const called = pos >= JOURNEY_PATH.indexOf("Calling") || company.leadState === "Nurture";
    const reached = pos >= JOURNEY_PATH.indexOf("Connected");
    for (let k = 0; k < n; k++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const [title, seniority, department] = pick(TITLES);
      const crt = called ? (k === 0 ? 2 : 0) + Math.floor(rand() * 4) : 0;
      const connected = reached && k === 0 ? 1 : 0;
      const status = crt === 0 ? "Never Reached Targets" : connected ? "Reached Target" : rand() > 0.5 ? "Reached Gatekeeper" : "Never Reached Targets";
      await db.contact.create({
        data: {
          firstName: first,
          lastName: last,
          jobTitle: title,
          seniority,
          department,
          email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.domain}`,
          phone: rand() > 0.5 ? `${company.phone?.slice(0, -2)}${10 + k}` : null,
          city: company.city,
          country: company.country,
          timeZone: company.timeZone,
          inDbnd: pick(["yes", "no", "unknown"]),
          interestLevel: crt > 0 ? pick(["High", "Medium", "Low", "None"]) : null,
          ownerId: rand() > 0.15 ? company.ownerId : null,
          lifecycleStage: company.lifecycleStage,
          leadStatus: crt === 0 ? "New" : connected ? "Connected" : "Attempted to contact",
          leadState: company.leadState,
          campaign: company.campaign,
          callable: (company.properties as { callable?: string }).callable ?? null,
          callStatus: status,
          crtCount: crt,
          connectedCount: connected,
          lastCallAt: crt ? daysAgo(Math.floor(rand() * 20)) : null,
          lastContactedAt: crt ? daysAgo(Math.floor(rand() * 20)) : null,
          lastActivityAt: crt ? daysAgo(Math.floor(rand() * 20)) : null,
          nextFollowUpAt: crt && rand() > 0.5 ? daysAhead(Math.floor(rand() * 10) - 3) : null,
          properties: rand() > 0.5 ? { researchResult: pick(["Viable", "Not viable", "Needs more info"]) } : {},
          createdAt: new Date(company.createdAt.getTime() + k * 36e5),
          companies: { create: { companyId: company.id, isPrimary: true, labels: k === 0 ? ["Decision maker"] : [] } },
        },
      });
      contactCount++;
    }
    await db.phoneNumber.create({
      data: { number: company.phone!, type: "Main", status: pick(["Valid", "Valid", "Unknown", "Temp Busy"]), ivrPath: rand() > 0.5 ? "DBND 9, OPT 0" : null, companyId: company.id },
    });
  }

  // Follow-up dates on a few of the admin's contacts (overdue, today, later this week) for the Home page
  const adminContacts = await db.contact.findMany({ where: { ownerId: admin.id }, select: { id: true }, take: 3, orderBy: { createdAt: "asc" } });
  for (const [i, c] of adminContacts.entries()) {
    await db.contact.update({ where: { id: c.id }, data: { nextFollowUpAt: [daysAgo(1), new Date(Date.now() + 3 * 36e5), daysAhead(3)][i] } });
  }

  // ── Company-level call rollups from their contacts ──
  const callRank = ["Never Reached Targets", "Reached Gatekeeper", "Reached Target"];
  for (const company of companies.slice(1)) {
    const cs = await db.contact.findMany({ where: { companies: { some: { companyId: company.id } } }, select: { crtCount: true, connectedCount: true, lastCallAt: true, callStatus: true } });
    const crt = cs.reduce((n, c) => n + c.crtCount, 0);
    const last = cs.map((c) => c.lastCallAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const best = cs.map((c) => c.callStatus ?? "").sort((a, b) => callRank.indexOf(b) - callRank.indexOf(a))[0] || null;
    await db.company.update({
      where: { id: company.id },
      data: { crtCount: crt, connectedCount: cs.reduce((n, c) => n + c.connectedCount, 0), lastCallAt: last, callStatus: crt ? best : null, lastContactedAt: last },
    });
  }

  // ── Lead journey history: walk each company along the path to its current stage ──
  const allCompanies = await db.company.findMany({ select: { id: true, leadState: true, createdAt: true, source: true, researcherId: true } });
  for (const co of allCompanies) {
    const stage = co.leadState ?? "Sourced";
    const path =
      stage === "Not viable"
        ? ["Sourced", "Researching", "Researched", "Not viable"]
        : stage === "Nurture"
          ? [...JOURNEY_PATH.slice(0, JOURNEY_PATH.indexOf("Connected") + 1), "Nurture"]
          : JOURNEY_PATH.slice(0, JOURNEY_PATH.indexOf(stage) + 1);
    const start = co.createdAt.getTime();
    const span = Math.max(Date.now() - 864e5 - start, 36e5);
    let prev: string | null = null;
    let at = new Date(start);
    for (const [i, to] of path.entries()) {
      at = new Date(start + (span * i) / Math.max(path.length, 2));
      await db.journeyEvent.create({
        data: {
          companyId: co.id,
          fromStage: prev,
          toStage: to,
          at,
          userId: ["Researching", "Researched", "Viable", "Callable", "Not viable"].includes(to) ? co.researcherId : null,
          source: to === "Sourced" ? "sourcing" : ["Researching", "Researched", "Viable", "Callable", "Not viable"].includes(to) ? "research" : to === "In campaign" ? "campaign" : to === "Nurture" ? "manual" : "call",
          reason: to === "Sourced" ? `Sourced from ${co.source ?? "Dynamics CRM import"}` : to === "Nurture" ? "Bad timing – revisit next quarter" : null,
        },
      });
      prev = to;
    }
    await db.company.update({ where: { id: co.id }, data: { leadStateAt: at } });
  }

  // ── Buying signals ──
  const signalSeeds = [
    { type: "Hiring developers", title: "Hiring 4 .NET developers (Indeed, LinkedIn)", source: "Job boards", strength: "High", days: 5 },
    { type: "Acquisition / merger", title: "Acquired Humanity scheduling – integration work ahead", source: "News", strength: "Medium", days: 40 },
  ];
  for (const s of signalSeeds) {
    await db.buyingSignal.create({ data: { companyId: tcp.id, type: s.type, title: s.title, source: s.source, strength: s.strength, detectedAt: daysAgo(s.days), createdById: farhana.id } });
  }
  const randomSignals = [
    ["Funding round", "Series B – $24M led by Insight Partners", "Crunchbase", "High"],
    ["Funding round", "Seed extension – $4M", "Apollo.io", "Medium"],
    ["Hiring developers", "6 open React/Node roles", "Job boards", "High"],
    ["Hiring developers", "Hiring a VP of Engineering", "LinkedIn", "Medium"],
    ["Leadership change", "New CTO joined from Oracle", "LinkedIn", "High"],
    ["Expansion / new office", "Opened a Denver office", "News", "Medium"],
    ["New product launch", "Launched a mobile app for field teams", "Company website", "Medium"],
    ["Outsourcing job post", "Upwork post: offshore QA team", "Job boards", "High"],
    ["Tech stack change", "Migrating from on-prem to Azure", "Manual research", "Medium"],
  ] as const;
  for (const [i, [type, title, source, strength]] of randomSignals.entries()) {
    const company = companies[2 + i * 2];
    if (!company) break;
    await db.buyingSignal.create({ data: { companyId: company.id, type, title, source, strength, detectedAt: daysAgo(3 + i * 6), createdById: farhana.id } });
  }
  for (const co of await db.company.findMany({ where: { signals: { some: {} } }, select: { id: true, signals: { select: { type: true, detectedAt: true }, orderBy: { detectedAt: "desc" } } } })) {
    await db.company.update({ where: { id: co.id }, data: { signalTypes: [...new Set(co.signals.map((s) => s.type))], lastSignalAt: co.signals[0].detectedAt } });
  }

  // ── Campaigns ──
  const exits = LEAD_STATES.filter((o) => o.kind === "exit").map((o) => o.value);
  const workable: Prisma.CompanyWhereInput = { deletedAt: null, properties: { path: ["callable"], equals: "Yes" }, OR: [{ leadState: null }, { leadState: { notIn: exits } }] };
  const memberStatus = (stage: string | null) =>
    ({ Calling: "In progress", Connected: "Connected", "Meeting booked": "Meeting booked", Nurture: "Nurture" })[stage ?? ""] ?? "Queued";

  const signalCampaign = await db.campaign.create({
    data: {
      name: "Q4 – Funded & hiring",
      type: "Buying signal",
      status: "ACTIVE",
      description: "Companies with a recent funding round or open developer roles: they have budget and a hiring gap.",
      ownerId: admin.id,
      startDate: daysAgo(14),
      endDate: daysAhead(60),
      criteria: [{ op: "AND", conditions: [{ property: "type", operator: "is_any_of", value: ["Funding round", "Hiring developers"], association: "SIGNAL" }] }],
      settings: { autoAdd: true, requireCallable: true, excludeExitStages: true, excludeOtherActive: false, excludeContactedDays: null, maxAttempts: 6 },
      goals: { companies: 20, connects: 8, meetings: 3 },
      pitch: "Open with the signal: congratulate them on the round / mention the roles they're hiring for. Offer a dedicated .NET/React team that can start in 2 weeks, without the 3-month hiring cycle.",
    },
  });
  const icpCampaign = await db.campaign.create({
    data: {
      name: "Q4 ICP – US software, 50–1,000 employees",
      type: "ICP",
      status: "ACTIVE",
      description: "Core ideal customer profile: US product companies in software/IT services with 50–1,000 employees.",
      ownerId: nadia.id,
      startDate: daysAgo(30),
      endDate: daysAhead(45),
      criteria: [{ op: "AND", conditions: [
        { property: "industry", operator: "is_any_of", value: ["Computer Software", "Information Technology & Services"] },
        { property: "country", operator: "is", value: "United States" },
        { property: "employees", operator: "between", value: [50, 1000] },
      ] }],
      settings: { autoAdd: true, requireCallable: true, excludeExitStages: true, excludeOtherActive: false, excludeContactedDays: null, maxAttempts: 8 },
      goals: { companies: 30, connects: 10, meetings: 4 },
      pitch: "Lead with relevant case studies (WFM modernization, logistics apps). Ask about their release roadmap and whether the in-house team is keeping up.",
    },
  });
  const q3Campaign = await db.campaign.create({
    data: {
      name: "Q3 – Clutch directory set",
      type: "Custom set",
      status: "COMPLETED",
      description: "Hand-picked companies from the Clutch directory, called in Q3.",
      ownerId: rafiq.id,
      startDate: daysAgo(120),
      endDate: daysAgo(30),
    },
  });
  await db.campaign.create({
    data: {
      name: "Re-engage: Q3 not interested",
      type: "Re-engagement",
      status: "DRAFT",
      description: "Companies that said no in Q3: try again with a new angle after 30 quiet days.",
      ownerId: admin.id,
      criteria: [{ op: "AND", conditions: [{ property: "status", operator: "is_any_of", value: ["Not interested", "Nurture"], association: "CAMPAIGN" }] }],
      settings: { autoAdd: false, requireCallable: false, excludeExitStages: true, excludeOtherActive: true, excludeContactedDays: 30, maxAttempts: 4 },
    },
  });

  const signalMembers = await db.company.findMany({ where: { ...workable, signals: { some: { type: { in: ["Funding round", "Hiring developers"] } } } }, select: { id: true, leadState: true, crtCount: true, connectedCount: true } });
  // TCP Software joins the ICP campaign below with its real logged calls
  const icpMembers = await db.company.findMany({
    where: { ...workable, id: { not: tcp.id }, industry: { in: ["Computer Software", "Information Technology & Services"] }, country: "United States", employees: { gte: 50, lte: 1000 } },
    select: { id: true, leadState: true, crtCount: true, connectedCount: true },
  });
  const callers = [nadia, tanvir, admin];
  const callResultsFor = (status: string, n: number) => {
    const last = { Connected: "Connected – Interested", "Meeting booked": "Meeting Booked", Nurture: "Connected – Not Interested", "In progress": pick(["VM", "Gatekeeper", "No Answer"]) }[status] ?? "VM";
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? last : pick(["VM", "No Answer", "Gatekeeper", "Temp Busy"])));
  };
  let worked = 0;
  for (const [campaign, members] of [[signalCampaign, signalMembers], [icpCampaign, icpMembers]] as const) {
    for (const [i, m] of members.entries()) {
      const status = memberStatus(m.leadState);
      const attempts = status === "Queued" ? 0 : Math.max(1, Math.min(m.crtCount, 4));
      const results = callResultsFor(status, attempts);
      const contact = await db.contactCompany.findFirst({ where: { companyId: m.id }, orderBy: { createdAt: "asc" }, select: { contactId: true } });
      // Spread the called companies over all three callers so everyone has call history
      const caller = status === "Queued" ? callers[i % 2] : callers[worked++ % callers.length];
      let lastAt: Date | null = null;
      for (const [k, result] of results.entries()) {
        lastAt = daysAgo(attempts - k + 1, 4 + k);
        await db.activity.create({
          data: {
            type: "CALL",
            ownerId: caller.id,
            occurredAt: lastAt,
            callResult: result,
            callPath: pick(["Direct", "OPT", "DBND"]),
            durationSec: /^Connected|Meeting/.test(result) ? 300 + Math.floor(rand() * 600) : 30 + Math.floor(rand() * 60),
            campaignId: campaign.id,
            targetContactId: contact?.contactId ?? null,
            contacts: contact ? { create: { contactId: contact.contactId } } : undefined,
            companies: { create: { companyId: m.id } },
          },
        });
      }
      await db.campaignCompany.create({
        data: {
          campaignId: campaign.id,
          companyId: m.id,
          status,
          addedVia: "criteria",
          addedAt: daysAgo(14),
          addedById: campaign.ownerId,
          assignedToId: caller.id,
          attempts,
          connects: results.filter((r) => /^Connected|Meeting/.test(r)).length,
          lastResult: results.at(-1) ?? null,
          lastCallAt: lastAt,
          // Some follow-ups are already due so the calling queue has work at the top
          nextActionAt: ["In progress", "Connected"].includes(status) ? daysAhead(Math.floor(rand() * 5) - 2) : null,
        },
      });
    }
  }
  // TCP Software is worked in the ICP campaign: its 3 logged calls belong to it
  await db.campaignCompany.create({
    data: { campaignId: icpCampaign.id, companyId: tcp.id, status: "In progress", addedVia: "manual", addedAt: daysAgo(10), assignedToId: nadia.id, attempts: 3, lastResult: "Gatekeeper", lastCallAt: daysAgo(1, 2), nextActionAt: daysAgo(0, 1) },
  });
  await db.activity.updateMany({ where: { type: "CALL", campaignId: null, companies: { some: { companyId: tcp.id } } }, data: { campaignId: icpCampaign.id } });
  // Q3 (completed): a few companies that said no or asked to wait
  const q3 = companies.slice(1).filter((c) => !signalMembers.some((m) => m.id === c.id) && !icpMembers.some((m) => m.id === c.id)).slice(0, 6);
  for (const [i, c] of q3.entries()) {
    await db.campaignCompany.create({
      data: {
        campaignId: q3Campaign.id,
        companyId: c.id,
        status: ["Not interested", "Not interested", "Nurture", "Completed", "Not interested", "Disqualified"][i],
        addedVia: "manual",
        addedAt: daysAgo(110),
        assignedToId: tanvir.id,
        attempts: 3 + i,
        connects: i < 3 ? 1 : 0,
        lastResult: i < 2 ? "Connected – Not Interested" : "VM",
        lastCallAt: daysAgo(40 + i),
      },
    });
  }

  await db.integration.createMany({
    data: [
      { provider: "apollo", enabled: false, settings: { autoEnrichOnCreate: false, overwrite: false, createSignals: true } },
      { provider: "lusha", enabled: false, settings: { autoEnrichOnCreate: false, overwrite: false, createSignals: true } },
    ],
  });

  // A handful of deals
  const dealCompanies = companies.slice(1, 7);
  for (const [i, company] of dealCompanies.entries()) {
    const stage = pipeline.stages[i % pipeline.stages.length];
    const contact = await db.contactCompany.findFirst({ where: { companyId: company.id } });
    await db.deal.create({
      data: {
        name: `${company.name} – ${pick(["Staff Augmentation", "Project", "Product Dev"])}`,
        amount: Math.round(20 + rand() * 180) * 1000,
        closeDate: daysAhead(15 + i * 10),
        ownerId: company.ownerId ?? admin.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        dealType: pick(["Staff Augmentation", "Project", "Product Dev"]),
        sourceCampaign: company.campaign,
        companies: { create: { companyId: company.id, isPrimary: true } },
        contacts: contact ? { create: { contactId: contact.contactId } } : undefined,
      },
    });
  }

  // Overdue + due-today tasks for the home page
  const someContacts = await db.contact.findMany({ take: 6, skip: 5, select: { id: true, firstName: true, lastName: true } });
  for (const [i, c] of someContacts.entries()) {
    await db.activity.create({
      data: {
        type: "TASK",
        title: `Follow up with ${c.firstName} ${c.lastName}`,
        ownerId: admin.id,
        assigneeId: pick([admin, nadia, tanvir]).id,
        dueAt: i < 2 ? daysAgo(i + 1) : daysAhead(i - 2),
        taskType: pick(["Call", "Email", "Research"]),
        priority: pick(["Low", "Medium", "High"]),
        taskStatus: "NOT_STARTED",
        contacts: { create: { contactId: c.id } },
      },
    });
  }

  // Today's meeting for the admin's Home page (evening in Dhaka = morning in the US)
  const dhakaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
  const meetingStart = new Date(`${dhakaToday}T21:00:00+06:00`);
  await db.activity.create({
    data: {
      type: "MEETING",
      title: "Discovery call – TCP Software",
      ownerId: admin.id,
      occurredAt: meetingStart,
      startAt: meetingStart,
      endAt: new Date(meetingStart.getTime() + 30 * 6e4),
      location: "https://teams.microsoft.com/l/meetup-join/example",
      meetingType: "Discovery",
      meetingOutcome: "Scheduled",
      attendees: ["adam.whitfield@tcpsoftware.com"],
      contacts: { create: { contactId: tcpContacts[0].id } },
      companies: { create: { companyId: tcp.id } },
    },
  });

  // A shared callback queue with call tasks for the admin (due today, overdue and tomorrow) for "Start tasks"
  const callbacks = await db.taskQueue.create({ data: { name: "Callbacks", shared: true, ownerId: admin.id } });
  const callTargets = await db.contact.findMany({
    where: { phoneNumbers: { none: {} }, companies: { some: { company: { phoneNumbers: { some: {} } } } } },
    select: { id: true, firstName: true, lastName: true, companies: { where: { isPrimary: true }, select: { companyId: true } } },
    take: 4,
    skip: 10,
  });
  for (const [i, c] of callTargets.entries()) {
    await db.activity.create({
      data: {
        type: "TASK",
        title: [`Call back ${c.firstName} about the proposal`, `Try ${c.firstName} on the direct line`, `Follow up with ${c.firstName} ${c.lastName}`, `Second attempt: ${c.firstName}`][i],
        ownerId: admin.id,
        assigneeId: admin.id,
        dueAt: [new Date(Date.now() + 2 * 36e5), new Date(Date.now() + 36e5), daysAgo(1), daysAhead(1)][i],
        taskType: "Call",
        priority: ["High", "Medium", "High", "Low"][i],
        taskStatus: "NOT_STARTED",
        queueId: i < 3 ? callbacks.id : null,
        contacts: { create: { contactId: c.id } },
        companies: c.companies[0] ? { create: { companyId: c.companies[0].companyId } } : undefined,
      },
    });
  }

  // "Created from Import" system events for everything
  const allContacts = await db.contact.findMany({ select: { id: true, createdAt: true } });
  for (const c of allContacts) {
    await db.activity.create({
      data: {
        type: "SYSTEM",
        occurredAt: c.createdAt,
        systemData: { kind: "imported", source: "Dynamics CRM export" },
        contacts: { create: { contactId: c.id } },
      },
    });
  }

  // Case studies
  await db.caseStudy.createMany({
    data: [
      { title: "Workforce scheduling platform modernization", industry: "Computer Software", technologies: [".NET", "Azure", "React"], summary: "Migrated a legacy scheduling suite to Azure with a React front end." },
      { title: "Logistics dispatch mobile apps", industry: "Logistics & Supply Chain", technologies: ["React", "Node.js"], summary: "Driver and dispatcher apps with offline sync." },
      { title: "Claims processing automation", industry: "Financial Services", technologies: ["Java", "AWS"], summary: "Rules engine and document pipeline for insurance claims." },
      { title: "EdTech LMS integrations", industry: "Education", technologies: ["PHP", "Python"], summary: "LTI integrations and analytics for a learning platform." },
    ],
  });

  // Segments
  const q4 = await db.segment.create({
    data: {
      name: "Q4 callable – Eastern time",
      objectType: "CONTACT",
      type: "ACTIVE",
      ownerId: admin.id,
      filters: [{ op: "AND", conditions: [
        { property: "campaign", operator: "is_any_of", value: ["Q4 Oct–Dec 2026"] },
        { property: "callable", operator: "is_any_of", value: ["Yes"] },
        { property: "timeZone", operator: "is_any_of", value: ["America/New_York"] },
      ] }],
    },
  });
  const staticSeg = await db.segment.create({ data: { name: "TCP Software targets", objectType: "CONTACT", type: "STATIC", ownerId: nadia.id } });
  await db.segmentMember.createMany({ data: tcpContacts.map((c) => ({ segmentId: staticSeg.id, recordId: c.id, contactId: c.id, addedById: nadia.id })) });
  const viableCompanies = await db.company.findMany({ where: { properties: { path: ["viable"], equals: "Yes" } }, select: { id: true }, take: 8 });
  const companySeg = await db.segment.create({ data: { name: "Viable companies – Nov batch", objectType: "COMPANY", type: "STATIC", ownerId: admin.id } });
  await db.segmentMember.createMany({ data: viableCompanies.map((c) => ({ segmentId: companySeg.id, recordId: c.id, companyId: c.id, addedById: admin.id })) });

  // A shared custom view
  await db.savedView.create({
    data: {
      objectType: "CONTACT",
      name: "Q4 callable",
      visibility: "EVERYONE",
      ownerId: admin.id,
      order: 3,
      columns: ["email", "phone", "ownerId", "primaryCompany", "callStatus", "crtCount", "timeZone", "leadStatus"].map((property) => ({ property })),
      quickFilters: DEFAULT_CHIPS.CONTACT,
      filters: {
        quick: {
          campaign: { property: "campaign", operator: "is_any_of", value: ["Q4 Oct–Dec 2026"] },
          callable: { property: "callable", operator: "is_any_of", value: ["Yes"] },
        },
        advanced: [],
      },
      sort: [{ property: "crtCount", direction: "desc" }],
    },
  });

  return { companies: companies.length, contacts: contactCount, segments: [q4.name, staticSeg.name, companySeg.name] };
}

/** The seed starts by wiping record data. On anything but a local database that already holds
 *  records, refuse unless SEED_FORCE=true, so a production CRM can't be erased by accident. */
async function guardRemoteWipe() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^[a-z+]+:\/\/([^@/]*@)?/i, "").split(/[:/?]/)[0];
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (local || process.env.SEED_FORCE === "true") return;
  const [contacts, companies] = await Promise.all([db.contact.count(), db.company.count()]);
  if (contacts || companies) {
    throw new Error(
      `Refusing to seed ${host}: it already has ${contacts} contacts and ${companies} companies, and seeding wipes them. ` +
        "Set SEED_FORCE=true only if you really want to erase this database.",
    );
  }
}

async function main() {
  await guardRemoteWipe();
  await wipe();
  const { users, teams } = await seedUsers();
  await seedMetadata();
  await seedLayouts(teams);
  if (!SAMPLE_DATA) {
    console.log(`Seeded the workspace setup (admin ${ADMIN_EMAIL}, roles, teams, properties, lists, layouts) without sample data.`);
    return;
  }
  const summary = await seedRecords(users);
  console.log(`Seeded ${users.length} users, ${summary.companies} companies, ${summary.contacts} contacts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
