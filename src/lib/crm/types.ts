export type CrmObject = "CONTACT" | "COMPANY" | "DEAL";

export type PropType =
  | "TEXT"
  | "TEXTAREA"
  | "RICH_TEXT"
  | "NUMBER"
  | "DATE"
  | "DATETIME"
  | "ENUM"
  | "MULTI_ENUM"
  | "RADIO"
  | "BOOLEAN"
  | "USER"
  | "PHONE"
  | "EMAIL"
  | "URL"
  | "FILE"
  | "CALCULATED"
  | "AUTO_NUMBER";

export interface PropOption {
  value: string;
  label: string;
  color?: string;
  order?: number;
  archived?: boolean;
  /** Lead journey: exit stages (Not viable, Disqualified…) sit outside the forward path */
  kind?: "exit";
}

/** Serializable property definition passed to the client. */
export interface PropDef {
  name: string;
  label: string;
  type: PropType;
  groupName: string | null;
  groupLabel: string | null;
  isBuiltIn: boolean;
  isReadOnly: boolean;
  /** Not stored on the record; derived from associations (e.g. primary company). */
  isVirtual?: boolean;
  format?: string | null;
  options?: PropOption[];
  description?: string | null;
  /** Dependent property: only shown on record pages when another property has one of these values */
  showWhen?: { property: string; in: string[] } | null;
}

export type Operator =
  // enum / user / multi-enum
  | "is_any_of"
  | "is_none_of"
  // text
  | "contains"
  | "not_contains"
  | "is"
  | "starts_with"
  // number
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "between"
  // date
  | "on"
  | "before"
  | "after"
  | "date_between"
  | "more_than_days_ago"
  | "less_than_days_ago"
  | "relative"
  // all
  | "is_known"
  | "is_unknown";

export interface FilterCondition {
  property: string;
  operator: Operator;
  /** string[] for enums, string for text, number|[n,n] for numbers, ISO|[ISO,ISO]|preset for dates */
  value?: unknown;
  /** Filter on an associated object's property, e.g. contacts where company.industry = …,
   *  or on related rows (logged calls, buying signals, campaign memberships): conditions on the
   *  same kind of row in one AND group must all match the same row. */
  association?: "COMPANY" | "CONTACT" | RelatedKind;
}

/** Related rows that filters can reach: logged calls, buying signals, campaign memberships. */
export type RelatedKind = "CALL" | "SIGNAL" | "CAMPAIGN";
export const RELATED_KINDS: RelatedKind[] = ["CALL", "SIGNAL", "CAMPAIGN"];
export const RELATED_LABELS: Record<RelatedKind, string> = { CALL: "Call", SIGNAL: "Buying signal", CAMPAIGN: "Campaign" };
export type RelatedDefs = Partial<Record<RelatedKind, PropDef[]>>;
export const isRelated = (a: string | undefined): a is RelatedKind => !!a && (RELATED_KINDS as string[]).includes(a);

/** Pseudo-property for "is a member of segment …" conditions (value: segment ids). */
export const SEGMENT_PROPERTY = "__segment";

export interface FilterGroup {
  op: "AND" | "OR";
  conditions: FilterCondition[];
}

export interface ColumnSpec {
  property: string;
  width?: number;
  /** Frozen columns stay visible when scrolling sideways; they are always the leading columns. */
  frozen?: boolean;
}

export interface SortSpec {
  property: string;
  direction: "asc" | "desc";
}

/** The part of an index page's state that a saved view persists. */
export interface ViewState {
  quick: Record<string, FilterCondition>;
  chips: string[];
  columns: ColumnSpec[];
  sort: SortSpec | null;
  advanced: FilterGroup[];
}

export interface ViewSummary {
  id: string;
  name: string;
  systemKey: string | null;
  visibility: "PRIVATE" | "TEAM" | "EVERYONE";
  isOwn: boolean;
  ownerName: string | null;
  teamId: string | null;
  teamName: string | null;
  /** Admin-pinned shared view: always shown as a tab for everyone who can see it */
  isPinned: boolean;
  /** Shown as a tab (system, pinned, or opened by this user) */
  isOpen: boolean;
  isDefault: boolean;
  state: ViewState;
  pageSize: number;
}

export interface SegmentSummary {
  id: string;
  name: string;
  objectType: CrmObject;
  type: "ACTIVE" | "STATIC";
}

export interface UserLite {
  id: string;
  name: string | null;
  email: string;
}
