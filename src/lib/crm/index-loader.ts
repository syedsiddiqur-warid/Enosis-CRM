import { db } from "@/lib/db";
import { fromBase64Url } from "@/lib/utils";
import { loadQueryContext } from "./context";
import { getPropertyGroups } from "./properties";
import { buildWhere, fetchRows } from "./query";
import { segmentSummaries } from "./segments";
import type { CrmObject, PropDef, PropOption, UserLite, ViewState, ViewSummary } from "./types";
import { viewStateFromRow } from "./view-state";

export const PAGE_SIZES = [25, 50, 100];

export interface IndexSearchParams {
  view?: string;
  q?: string;
  page?: string;
  size?: string;
  st?: string;
  create?: string;
}

/** Per-user tab state for an object's index page (UserUiState "views:<OBJECT>"). */
export interface ViewTabPrefs {
  /** Custom views the user keeps open as tabs; missing = every visible view is open */
  open?: string[];
  default?: string;
}

export const viewPrefsKey = (object: CrmObject) => `views:${object}`;

export async function visibleViews(objectType: CrmObject, userId: string) {
  const teamIds = (await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })).map((t) => t.teamId);
  return db.savedView.findMany({
    where: {
      objectType,
      OR: [{ systemKey: { not: null } }, { ownerId: userId }, { visibility: "EVERYONE" }, { visibility: "TEAM", teamId: { in: teamIds } }],
    },
    include: { owner: { select: { name: true, email: true } }, team: { select: { name: true } } },
    // System tabs first, then admin-pinned views, then the rest in their saved order
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

export async function loadIndex(object: CrmObject, sp: IndexSearchParams, userId: string) {
  const [ctx, groups, viewRows, users, settings, me, prefsRow, segments, campaignTypes, taskTypes, taskPriorities] = await Promise.all([
    loadQueryContext(userId),
    getPropertyGroups(object),
    visibleViews(object, userId),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.objectSettings.findUnique({ where: { objectType: object } }),
    db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } }, teams: { select: { team: { select: { id: true, name: true } } } } } }),
    db.userUiState.findUnique({ where: { userId_key: { userId, key: viewPrefsKey(object) } } }),
    segmentSummaries(userId, object),
    db.optionList.findUnique({ where: { key: "campaignType" } }),
    db.optionList.findUnique({ where: { key: "taskType" } }),
    db.optionList.findUnique({ where: { key: "taskPriority" } }),
  ]);
  const activeOptions = (l: { options: unknown } | null) => ((l?.options as PropOption[] | null) ?? []).filter((o) => !o.archived);
  const defsByObject: Record<CrmObject, PropDef[]> = ctx.defs;
  const defs = defsByObject[object];
  const isAdmin = me?.role?.name === "Admin";
  const prefs = (prefsRow?.value ?? {}) as ViewTabPrefs;

  const views: ViewSummary[] = viewRows
    .map((v) => ({
      id: v.id,
      name: v.name,
      systemKey: v.systemKey,
      visibility: v.visibility,
      isOwn: v.ownerId === userId,
      ownerName: v.owner?.name ?? v.owner?.email ?? null,
      teamId: v.teamId,
      teamName: v.team?.name ?? null,
      isPinned: v.isPinned && !v.systemKey,
      isOpen: !!v.systemKey || (v.isPinned && v.visibility !== "PRIVATE") || (prefs.open ? prefs.open.includes(v.id) : true),
      isDefault: prefs.default === v.id,
      state: viewStateFromRow(v),
      pageSize: v.pageSize,
    }))
    .sort((a, b) => Number(!!b.systemKey) - Number(!!a.systemKey) || Number(b.isPinned) - Number(a.isPinned));
  const fallback = views.find((v) => v.id === prefs.default) ?? views.find((v) => v.systemKey === "all") ?? views[0];
  const active = views.find((v) => v.id === sp.view) ?? fallback;
  const override = fromBase64Url<ViewState>(sp.st);
  const state: ViewState = override ? { ...active.state, ...override } : active.state;

  const pageSize = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : active.pageSize;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q ?? "";

  const where = buildWhere(object, active.systemKey, state, q, ctx);
  const { rows, total } = await fetchRows(object, where, state.sort, (page - 1) * pageSize, pageSize, defs);

  const myTeams = (me?.teams ?? []).map((t) => t.team);
  const teams = isAdmin ? await db.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : myTeams;

  return {
    object,
    views,
    activeViewId: active.id,
    state,
    dirty: !!override,
    rows,
    total,
    page,
    pageSize,
    q,
    defs,
    associatedDefs: object === "CONTACT" ? defsByObject.COMPANY : defsByObject.CONTACT,
    relatedDefs: ctx.relatedDefs,
    segments,
    groups,
    users: users as UserLite[],
    teams,
    currentUserId: userId,
    isAdmin,
    previewProperties: (settings?.previewProperties as string[] | null) ?? [],
    defaultChips: (settings?.defaultQuickFilters as string[] | null) ?? [],
    campaignTypes: activeOptions(campaignTypes),
    taskTypes: activeOptions(taskTypes),
    taskPriorities: activeOptions(taskPriorities),
  };
}

export type IndexData = Awaited<ReturnType<typeof loadIndex>>;
