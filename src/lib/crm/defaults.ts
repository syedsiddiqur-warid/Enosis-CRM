// Default metadata seeded into the database. After seeding, the database is the
// source of truth — admins edit these in Settings, and pages read them from there.
import type { CrmObject, PropOption, PropType } from "./types";

const opts = (pairs: [string, string?][]): PropOption[] =>
  pairs.map(([label, color], i) => ({ value: label, label, color, order: i }));

// ─── Status lists (§6) ───
export const LIFECYCLE_STAGES = opts([
  ["Subscriber", "#7c98b6"],
  ["Lead", "#f2545b"],
  ["MQL", "#f5c26b"],
  ["SQL", "#00bda5"],
  ["Opportunity", "#6a78d1"],
  ["Customer", "#00a4bd"],
  ["Other", "#cbd6e2"],
]);

export const LEAD_STATUSES = opts([
  ["New", "#00a4bd"],
  ["Open", "#6a78d1"],
  ["In progress", "#f5c26b"],
  ["Open Deal", "#00bda5"],
  ["Unqualified", "#cbd6e2"],
  ["Attempted to contact", "#ff8f59"],
  ["Connected", "#00bda5"],
  ["Bad timing", "#f2545b"],
]);

/** Lead journey (Company.leadState): the forward path in order, then exit stages. */
export const LEAD_STATES: PropOption[] = [
  ...opts([
    ["Sourced", "#99afc4"],
    ["Researching", "#7c98b6"],
    ["Researched", "#00a4bd"],
    ["Viable", "#6a78d1"],
    ["Callable", "#00bda5"],
    ["In campaign", "#f5c26b"],
    ["Calling", "#ff8f59"],
    ["Connected", "#e3459b"],
    ["Meeting booked", "#0091ae"],
    ["Opportunity", "#6a78d1"],
    ["Customer", "#0e7c6b"],
  ]),
  ...opts([["Not viable", "#f2545b"], ["Nurture", "#cbd6e2"], ["Disqualified", "#f2545b"], ["Do not contact", "#33475b"]]).map((o, i) => ({
    ...o,
    order: 100 + i,
    kind: "exit" as const,
  })),
];

export const RESEARCH_STATUSES = opts([["Not started", "#cbd6e2"], ["In progress", "#f5c26b"], ["Needs more info", "#ff8f59"], ["Done", "#00bda5"]]);

/** Where a company was sourced from (lead-generation tools and directories). */
export const LEAD_SOURCES = opts([
  ["Seamless.AI"],
  ["Apollo.io"],
  ["LinkedIn Sales Navigator"],
  ["Lusha"],
  ["ZoomInfo"],
  ["Online directory"],
  ["Web portal"],
  ["Conference / event"],
  ["Referral"],
  ["Inbound"],
  ["Dynamics CRM import"],
  ["Manual research"],
]);

export const SIGNAL_TYPES = opts([
  ["Funding round", "#00bda5"],
  ["Hiring developers", "#6a78d1"],
  ["Leadership change", "#e3459b"],
  ["Expansion / new office", "#00a4bd"],
  ["New product launch", "#f5c26b"],
  ["Tech stack change", "#ff8f59"],
  ["Acquisition / merger", "#0091ae"],
  ["Outsourcing job post", "#0e7c6b"],
  ["RFP / tender", "#f2545b"],
  ["Website / intent activity", "#7c98b6"],
]);
export const SIGNAL_STRENGTHS = opts([["High", "#00bda5"], ["Medium", "#f5c26b"], ["Low", "#cbd6e2"]]);
export const SIGNAL_SOURCES = opts([["Manual research"], ["Apollo.io"], ["Lusha"], ["LinkedIn"], ["Crunchbase"], ["Job boards"], ["News"], ["Company website"]]);

export const CAMPAIGN_TYPES = opts([["Buying signal"], ["ICP"], ["Custom set"], ["Re-engagement"], ["Event"]]);
export const CAMPAIGN_MEMBER_STATUSES = opts([
  ["Queued", "#cbd6e2"],
  ["In progress", "#f5c26b"],
  ["Connected", "#e3459b"],
  ["Meeting booked", "#00bda5"],
  ["Not interested", "#f2545b"],
  ["Nurture", "#7c98b6"],
  ["Disqualified", "#33475b"],
  ["Completed", "#0e7c6b"],
]);

export const CALL_STATUSES = opts([
  ["Never Reached Targets", "#cbd6e2"],
  ["Reached Gatekeeper", "#f5c26b"],
  ["Reached Target", "#00bda5"],
  ["Do Not Call", "#f2545b"],
]);

export const CALL_RESULTS = opts([
  ["VM"],
  ["No Answer"],
  ["Temp Busy"],
  ["Gatekeeper"],
  ["Transferred to VM"],
  ["Connected – Not Interested"],
  ["Connected – Interested"],
  ["Callback Requested"],
  ["Meeting Booked"],
  ["Wrong Number"],
]);

export const CALL_PATHS = opts([["Direct"], ["OPT"], ["DBND"], ["Transferred"]]);
export const TASK_TYPES = opts([["Call"], ["Email"], ["Research"], ["To-do"]]);
export const TASK_PRIORITIES = opts([["Low", "#7c98b6"], ["Medium", "#f5c26b"], ["High", "#f2545b"]]);
export const GATEKEEPER_TYPES = opts([["Receptionist"], ["Executive Assistant"], ["IVR only"], ["Office Manager"]]);
export const MEETING_TYPES = opts([["Discovery"], ["Presentation"], ["Follow-up"]]);
export const MEETING_OUTCOMES = opts([["Scheduled"], ["Completed"], ["Rescheduled"], ["No show"], ["Canceled"]]);
export const PHONE_TYPES = opts([["Main"], ["Direct"], ["Mobile"], ["Sales"], ["Operator"]]);
export const PHONE_STATUSES = opts([
  ["Valid", "#00bda5"],
  ["Temp Busy", "#f5c26b"],
  ["Wrong", "#f2545b"],
  ["Disconnected", "#f2545b"],
  ["Unknown", "#cbd6e2"],
]);

export const YES_NO = opts([["Yes", "#00bda5"], ["No", "#f2545b"]]);
export const YES_NO_UNKNOWN = opts([["Yes", "#00bda5"], ["No", "#f2545b"], ["Unknown", "#cbd6e2"]]);
export const INTEREST_LEVELS = opts([["High", "#00bda5"], ["Medium", "#f5c26b"], ["Low", "#ff8f59"], ["None", "#cbd6e2"]]);
export const CAMPAIGNS = opts([["Q3 Jul–Sep 2026"], ["Q4 Oct–Dec 2026"], ["Q1 Jan–Mar 2027"]]);
export const LIST_SOURCES = opts([
  ["Directory - Capterra"],
  ["Directory - Clutch"],
  ["Directory - G2"],
  ["LinkedIn Sales Navigator"],
  ["Conference list"],
  ["Referral"],
]);
export const INDUSTRIES = opts([
  ["Computer Software"],
  ["Information Technology & Services"],
  ["Financial Services"],
  ["Healthcare"],
  ["Logistics & Supply Chain"],
  ["Education"],
  ["Retail"],
  ["Real Estate"],
  ["Marketing & Advertising"],
]);
export const SENIORITIES = opts([["Owner"], ["C-Level"], ["VP"], ["Director"], ["Manager"], ["Individual contributor"]]);
export const DEPARTMENTS = opts([["Executive"], ["Engineering"], ["Product"], ["Operations"], ["Sales"], ["Marketing"], ["Finance"]]);
export const OFFER_TYPES = opts([["Product"], ["Service"]]);
export const TIME_ZONES = opts([
  ["America/New_York"],
  ["America/Chicago"],
  ["America/Denver"],
  ["America/Los_Angeles"],
  ["Europe/London"],
  ["Europe/Berlin"],
  ["Australia/Sydney"],
  ["Asia/Dhaka"],
]);
export const TECHNOLOGIES = opts([
  [".NET"],
  ["Java"],
  ["Node.js"],
  ["React"],
  ["Angular"],
  ["Python"],
  ["AWS"],
  ["Azure"],
  ["Salesforce"],
  ["PHP"],
]);
export const RESEARCH_RESULTS = opts([["Viable", "#00bda5"], ["Not viable", "#f2545b"], ["Needs more info", "#f5c26b"]]);
export const RESEARCH_TYPES = opts([["Company research"], ["Target research"], ["Number research"]]);

// Editable activity lists (§7A-E)
export const OPTION_LISTS: { key: string; label: string; options: PropOption[] }[] = [
  { key: "callResult", label: "Call outcomes", options: CALL_RESULTS },
  { key: "callPath", label: "Call paths", options: CALL_PATHS },
  { key: "gatekeeperType", label: "Gatekeeper types", options: GATEKEEPER_TYPES },
  { key: "taskType", label: "Task types", options: TASK_TYPES },
  { key: "taskPriority", label: "Task priorities", options: TASK_PRIORITIES },
  { key: "meetingType", label: "Meeting types", options: MEETING_TYPES },
  { key: "meetingOutcome", label: "Meeting outcomes", options: MEETING_OUTCOMES },
  { key: "phoneType", label: "Phone number types", options: PHONE_TYPES },
  { key: "phoneStatus", label: "Phone number statuses", options: PHONE_STATUSES },
  { key: "signalType", label: "Buying signal types", options: SIGNAL_TYPES },
  { key: "signalStrength", label: "Buying signal strengths", options: SIGNAL_STRENGTHS },
  { key: "signalSource", label: "Buying signal sources", options: SIGNAL_SOURCES },
  { key: "campaignType", label: "Campaign types", options: CAMPAIGN_TYPES },
  { key: "campaignMemberStatus", label: "Campaign company statuses", options: CAMPAIGN_MEMBER_STATUSES },
];

// ─── Property groups & definitions ───
export interface SeedGroup {
  name: string;
  label: string;
}

export interface SeedProp {
  name: string;
  label: string;
  type: PropType;
  group: string;
  isBuiltIn?: boolean; // default true
  isReadOnly?: boolean;
  format?: string;
  options?: PropOption[];
  description?: string;
  showWhen?: unknown;
}

export const PROPERTY_GROUPS: Record<CrmObject, SeedGroup[]> = {
  CONTACT: [
    { name: "contact_info", label: "Contact info" },
    { name: "lifecycle", label: "Lifecycle" },
    { name: "research", label: "Research" },
    { name: "viability", label: "Viability & Callable" },
    { name: "calling", label: "Calling" },
    { name: "campaign", label: "Campaign" },
  ],
  COMPANY: [
    { name: "company_info", label: "Company info" },
    { name: "firmographics", label: "Firmographics" },
    { name: "lifecycle", label: "Lifecycle & journey" },
    { name: "research", label: "Sourcing & research" },
    { name: "viability", label: "Viability & Callable" },
    { name: "calling", label: "Calling" },
    { name: "tech", label: "Tech" },
    { name: "campaign", label: "Campaigns & signals" },
  ],
  DEAL: [{ name: "deal_info", label: "Deal info" }],
};

const lifecycleProps = (group = "lifecycle"): SeedProp[] => [
  { name: "ownerId", label: "Owner", type: "USER", group },
  { name: "lifecycleStage", label: "Lifecycle stage", type: "ENUM", group, options: LIFECYCLE_STAGES },
  { name: "leadStatus", label: "Lead status", type: "ENUM", group, options: LEAD_STATUSES },
  { name: "leadState", label: "Lead journey stage", type: "ENUM", group, options: LEAD_STATES },
  { name: "createdAt", label: "Create date", type: "DATETIME", group, isReadOnly: true },
  { name: "lastActivityAt", label: "Last activity date", type: "DATETIME", group, isReadOnly: true },
  { name: "lastContactedAt", label: "Last contacted", type: "DATETIME", group, isReadOnly: true },
  { name: "nextFollowUpAt", label: "Next follow-up", type: "DATE", group },
];

export const PROPERTIES: Record<CrmObject, SeedProp[]> = {
  CONTACT: [
    { name: "firstName", label: "First name", type: "TEXT", group: "contact_info" },
    { name: "lastName", label: "Last name", type: "TEXT", group: "contact_info" },
    { name: "email", label: "Email", type: "EMAIL", group: "contact_info" },
    { name: "phone", label: "Phone number", type: "PHONE", group: "contact_info" },
    { name: "mobile", label: "Mobile phone number", type: "PHONE", group: "contact_info" },
    { name: "jobTitle", label: "Job title", type: "TEXT", group: "contact_info" },
    { name: "seniority", label: "Seniority", type: "ENUM", group: "contact_info", options: SENIORITIES },
    { name: "department", label: "Department", type: "ENUM", group: "contact_info", options: DEPARTMENTS },
    { name: "primaryCompany", label: "Primary company", type: "TEXT", group: "contact_info", isReadOnly: true },
    { name: "linkedinUrl", label: "LinkedIn", type: "URL", group: "contact_info" },
    { name: "city", label: "City", type: "TEXT", group: "contact_info" },
    { name: "country", label: "Country", type: "TEXT", group: "contact_info" },
    { name: "timeZone", label: "Time zone", type: "ENUM", group: "contact_info", options: TIME_ZONES },
    ...lifecycleProps(),
    { name: "inDbnd", label: "In DBND", type: "ENUM", group: "calling", options: YES_NO_UNKNOWN, description: "Listed in the dial-by-name directory" },
    { name: "callStatus", label: "Call status", type: "ENUM", group: "calling", options: CALL_STATUSES, isReadOnly: true },
    { name: "crtCount", label: "CRT count", type: "NUMBER", group: "calling", isReadOnly: true, description: "Number of logged call attempts" },
    { name: "connectedCount", label: "Connected calls", type: "NUMBER", group: "calling", isReadOnly: true },
    { name: "lastCallAt", label: "Last call date", type: "DATETIME", group: "calling", isReadOnly: true },
    { name: "interestLevel", label: "Interest level", type: "ENUM", group: "calling", options: INTEREST_LEVELS },
    { name: "outsourcingExperience", label: "Outsourcing experience", type: "ENUM", group: "calling", options: YES_NO_UNKNOWN },
    { name: "doNotCall", label: "Do not call", type: "BOOLEAN", group: "calling" },
    { name: "campaign", label: "Campaign", type: "ENUM", group: "campaign", options: CAMPAIGNS },
    { name: "callable", label: "Callable", type: "ENUM", group: "viability", options: YES_NO },
    // Custom (jsonb) properties — created the same way admins create new ones
    { name: "researchResult", label: "Research result", type: "ENUM", group: "research", isBuiltIn: false, options: RESEARCH_RESULTS },
    { name: "researchedOn", label: "Researched on", type: "DATE", group: "research", isBuiltIn: false },
    { name: "researchNotes", label: "Research notes", type: "TEXTAREA", group: "research", isBuiltIn: false },
    {
      name: "disqualifyReason",
      label: "Disqualify reason",
      type: "TEXT",
      group: "lifecycle",
      isBuiltIn: false,
      showWhen: { property: "leadState", in: ["Disqualified"] },
    },
  ],
  COMPANY: [
    { name: "name", label: "Company name", type: "TEXT", group: "company_info" },
    { name: "domain", label: "Company domain name", type: "URL", group: "company_info" },
    { name: "phone", label: "Phone number", type: "PHONE", group: "company_info" },
    { name: "email", label: "Company email", type: "EMAIL", group: "company_info" },
    { name: "linkedinUrl", label: "LinkedIn company page", type: "URL", group: "company_info" },
    { name: "country", label: "Country/Region", type: "TEXT", group: "company_info" },
    { name: "state", label: "State/Region", type: "TEXT", group: "company_info" },
    { name: "city", label: "City", type: "TEXT", group: "company_info" },
    { name: "timeZone", label: "Time zone", type: "ENUM", group: "company_info", options: TIME_ZONES },
    { name: "description", label: "Description", type: "TEXTAREA", group: "company_info" },
    { name: "industry", label: "Industry", type: "ENUM", group: "firmographics", options: INDUSTRIES },
    { name: "employees", label: "Number of employees", type: "NUMBER", group: "firmographics" },
    { name: "employeeGrowth", label: "Employee growth", type: "NUMBER", group: "firmographics", format: "percent" },
    { name: "annualRevenue", label: "Annual revenue", type: "NUMBER", group: "firmographics", format: "currency" },
    { name: "foundedYear", label: "Year founded", type: "NUMBER", group: "firmographics" },
    { name: "investmentInfo", label: "Investment information", type: "TEXT", group: "firmographics" },
    { name: "offerType", label: "Offer type", type: "ENUM", group: "firmographics", options: OFFER_TYPES },
    { name: "servicesOrApps", label: "Types of services or apps", type: "TEXTAREA", group: "research" },
    { name: "careerPageUrl", label: "Career page", type: "URL", group: "research" },
    { name: "pitchNotes", label: "Pitch notes", type: "TEXTAREA", group: "research" },
    { name: "technologies", label: "Technology focus", type: "MULTI_ENUM", group: "tech", options: TECHNOLOGIES },
    { name: "source", label: "Lead source", type: "ENUM", group: "research", options: LEAD_SOURCES, description: "Tool or channel the company was sourced from" },
    { name: "listSource", label: "Topic / list source", type: "ENUM", group: "research", options: LIST_SOURCES },
    { name: "researchStatus", label: "Research status", type: "ENUM", group: "research", options: RESEARCH_STATUSES },
    { name: "researcherId", label: "Researcher", type: "USER", group: "research" },
    { name: "researchedAt", label: "Researched on", type: "DATETIME", group: "research", isReadOnly: true },
    { name: "lastEnrichedAt", label: "Last enriched", type: "DATETIME", group: "research", isReadOnly: true },
    { name: "campaign", label: "Campaign (legacy)", type: "ENUM", group: "campaign", options: CAMPAIGNS, description: "Campaign text imported from Dynamics. Campaign membership lives on Campaigns." },
    { name: "signalTypes", label: "Buying signals", type: "MULTI_ENUM", group: "campaign", options: SIGNAL_TYPES, isReadOnly: true, description: "Types of buying signal logged for this company" },
    { name: "lastSignalAt", label: "Last signal date", type: "DATETIME", group: "campaign", isReadOnly: true },
    { name: "callStatus", label: "Call status", type: "ENUM", group: "calling", options: CALL_STATUSES, isReadOnly: true, description: "Best call outcome across the company's contacts" },
    { name: "crtCount", label: "CRT count", type: "NUMBER", group: "calling", isReadOnly: true, description: "Calls logged to this company or its contacts" },
    { name: "connectedCount", label: "Connected calls", type: "NUMBER", group: "calling", isReadOnly: true },
    { name: "lastCallAt", label: "Last call date", type: "DATETIME", group: "calling", isReadOnly: true },
    { name: "batchNumber", label: "Batch number", type: "TEXT", group: "campaign" },
    { name: "tags", label: "Tags", type: "MULTI_ENUM", group: "campaign", options: opts([["Priority"], ["Enterprise"], ["Startup"], ["Re-engage"]]) },
    { name: "targetCount", label: "Target count", type: "NUMBER", group: "campaign", isReadOnly: true, description: "Number of associated contacts" },
    ...lifecycleProps(),
    { name: "leadStateAt", label: "Entered journey stage", type: "DATETIME", group: "lifecycle", isReadOnly: true },
    { name: "viable", label: "Viable", type: "ENUM", group: "viability", isBuiltIn: false, options: YES_NO },
    { name: "viableCheckedBy", label: "Viable checked by", type: "USER", group: "viability", isBuiltIn: false, isReadOnly: true },
    { name: "viableCheckedOn", label: "Viable checked on", type: "DATETIME", group: "viability", isBuiltIn: false, isReadOnly: true },
    { name: "callable", label: "Callable", type: "ENUM", group: "viability", isBuiltIn: false, options: YES_NO },
    { name: "callableCheckedBy", label: "Callable checked by", type: "USER", group: "viability", isBuiltIn: false, isReadOnly: true },
    { name: "callableCheckedOn", label: "Callable checked on", type: "DATETIME", group: "viability", isBuiltIn: false, isReadOnly: true },
    { name: "disqualifyReason", label: "Disqualify reason", type: "TEXT", group: "lifecycle", isBuiltIn: false, showWhen: { property: "leadState", in: ["Disqualified", "Not viable", "Do not contact"] } },
    { name: "researchType", label: "Research type", type: "ENUM", group: "research", isBuiltIn: false, options: RESEARCH_TYPES },
    { name: "researchResult", label: "Research result", type: "ENUM", group: "research", isBuiltIn: false, options: RESEARCH_RESULTS },
  ],
  DEAL: [
    { name: "name", label: "Deal name", type: "TEXT", group: "deal_info" },
    { name: "amount", label: "Amount", type: "NUMBER", group: "deal_info", format: "currency" },
    { name: "closeDate", label: "Close date", type: "DATE", group: "deal_info" },
    { name: "ownerId", label: "Deal owner", type: "USER", group: "deal_info" },
    { name: "dealType", label: "Deal type", type: "ENUM", group: "deal_info", options: opts([["Staff Augmentation"], ["Project"], ["Product Dev"]]) },
    { name: "sourceCampaign", label: "Source campaign", type: "TEXT", group: "deal_info" },
    { name: "createdAt", label: "Create date", type: "DATETIME", group: "deal_info", isReadOnly: true },
  ],
};

/** Properties derived from associations rather than stored on the record. */
export const VIRTUAL_PROPERTIES: Record<CrmObject, string[]> = {
  CONTACT: ["primaryCompany"],
  COMPANY: ["targetCount"],
  DEAL: [],
};

// ─── Default index configuration (§3, §7A-B) ───
export const DEFAULT_COLUMNS: Record<CrmObject, string[]> = {
  CONTACT: ["email", "phone", "ownerId", "primaryCompany", "lastActivityAt", "leadStatus", "createdAt"],
  COMPANY: ["domain", "ownerId", "leadState", "source", "signalTypes", "crtCount", "callStatus", "lastActivityAt", "country", "industry"],
  DEAL: ["stage", "closeDate", "ownerId", "amount"],
};

export const DEFAULT_CHIPS: Record<CrmObject, string[]> = {
  CONTACT: ["ownerId", "createdAt", "lastActivityAt", "leadStatus", "campaign", "callable", "callStatus", "timeZone"],
  COMPANY: ["ownerId", "leadState", "source", "signalTypes", "callStatus", "lastActivityAt", "industry", "country"],
  DEAL: ["ownerId", "closeDate", "createdAt"],
};

export const DEFAULT_PREVIEW: Record<CrmObject, string[]> = {
  CONTACT: ["email", "phone", "ownerId", "lifecycleStage", "leadStatus", "callStatus", "crtCount", "timeZone", "nextFollowUpAt"],
  COMPANY: ["domain", "phone", "ownerId", "leadState", "source", "industry", "employees", "country", "timeZone", "crtCount", "callStatus"],
  DEAL: ["amount", "closeDate", "ownerId", "dealType"],
};

export const DEFAULT_PIPELINE = {
  name: "Sales Pipeline",
  stages: [
    { name: "Appointment Scheduled", color: "#0091ae", probability: 20, stageType: "OPEN" as const },
    { name: "Qualified To Buy", color: "#ff8f59", probability: 40, stageType: "OPEN" as const },
    { name: "Presentation Scheduled", color: "#e3459b", probability: 60, stageType: "OPEN" as const },
    { name: "Decision Maker Bought-In", color: "#6a78d1", probability: 80, stageType: "OPEN" as const },
    { name: "Contract Sent", color: "#f5c26b", probability: 90, stageType: "OPEN" as const },
    { name: "Closed Won", color: "#00bda5", probability: 100, stageType: "WON" as const },
    { name: "Closed Lost", color: "#f2545b", probability: 0, stageType: "LOST" as const },
  ],
};

export const OBJECT_LABELS: Record<CrmObject, { singular: string; plural: string; path: string }> = {
  CONTACT: { singular: "contact", plural: "contacts", path: "/contacts" },
  COMPANY: { singular: "company", plural: "companies", path: "/companies" },
  DEAL: { singular: "deal", plural: "deals", path: "/deals" },
};
