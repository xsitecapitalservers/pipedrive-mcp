/**
 * pipedrive.js
 * ─────────────────────────────────────────────
 * Wrapper around the official Pipedrive Node.js SDK (v22+).
 *
 * The SDK splits into two sub-packages:
 *   pipedrive/v1 — merge operations, notes, users
 *   pipedrive/v2 — main CRUD (deals, persons, orgs, activities, pipelines, stages)
 *
 * Each API method uses positional arguments, so we expose simple named-option
 * wrappers here so the rest of the code stays readable.
 */

// ── v2 imports (main CRUD) ────────────────────────────────────────────────────
import {
  Configuration,
  DealsApi,
  PersonsApi,
  OrganizationsApi,
  ActivitiesApi,
  PipelinesApi,
  StagesApi,
} from 'pipedrive/v2';

// ── v1 imports (merge, notes, users) ─────────────────────────────────────────
import {
  Configuration as ConfigV1,
  PersonsApi   as PersonsApiV1,
  OrganizationsApi as OrganizationsApiV1,
  NotesApi,
  UsersApi,
} from 'pipedrive/v1';

// ── Initialise clients ────────────────────────────────────────────────────────
const TOKEN = process.env.PIPEDRIVE_API_TOKEN;

const cfgV2 = new Configuration({ apiKey: TOKEN });
const cfgV1 = new ConfigV1({ apiKey: TOKEN });

const _dealsApi   = new DealsApi(cfgV2);
const _personsV2  = new PersonsApi(cfgV2);
const _orgsV2     = new OrganizationsApi(cfgV2);
const _actsApi    = new ActivitiesApi(cfgV2);
const _pipelinesApi = new PipelinesApi(cfgV2);
const _stagesApi  = new StagesApi(cfgV2);

const _personsV1  = new PersonsApiV1(cfgV1);
const _orgsV1     = new OrganizationsApiV1(cfgV1);
const _notesApi   = new NotesApi(cfgV1);
const _usersApi   = new UsersApi(cfgV1);

// ── Helper: extract data array from axios response ────────────────────────────
function getData(res) {
  // Axios wraps the response: res.data is the API JSON body
  // API body shape: { success: true, data: [...], additional_data: { next_cursor } }
  return res?.data?.data ?? res?.data ?? [];
}

function getNextCursor(res) {
  return res?.data?.additional_data?.next_cursor ?? null;
}

// ── Helper: cursor-based pagination (v2 style) ────────────────────────────────
/**
 * Fetches all pages of a v2 endpoint using cursor pagination.
 * @param {Function} fetchPage - async (cursor) => API response
 * @returns {Array} flat list of all items
 */
export async function fetchAll(fetchPage) {
  const results = [];
  let cursor = undefined;

  while (true) {
    const res  = await fetchPage(cursor);
    const data = getData(res);
    if (!data || data.length === 0) break;
    results.push(...data);
    cursor = getNextCursor(res);
    if (!cursor) break;
  }

  return results;
}

// ── Deals ─────────────────────────────────────────────────────────────────────
export const deals = {
  /**
   * @param {object} opts
   * @param {string}  [opts.status]      open | won | lost | deleted
   * @param {number}  [opts.pipeline_id]
   * @param {number}  [opts.stage_id]
   * @param {string}  [opts.updated_since]  ISO date string
   * @param {string}  [opts.sort_by]     id | update_time | add_time
   * @param {string}  [opts.sort_direction] asc | desc
   * @param {number}  [opts.limit]       max 100
   * @param {string}  [opts.cursor]
   */
  getAll: (opts = {}) => _dealsApi.getDeals(
    undefined,           // filter_id
    undefined,           // ids
    undefined,           // owner_id
    undefined,           // person_id
    undefined,           // org_id
    opts.pipeline_id,
    opts.stage_id,
    opts.status,
    opts.updated_since,
    undefined,           // updated_until
    opts.sort_by,
    opts.sort_direction,
    undefined,           // include_fields
    undefined,           // custom_fields
    opts.limit ?? 100,
    opts.cursor
  ),

  getOne:  (id) => _dealsApi.getDeal(id),
  update:  (id, body) => _dealsApi.updateDeal(id, body),
  search:  (term, opts = {}) => _dealsApi.searchDeals(
    term,
    undefined,           // fields
    undefined,           // exact_match
    undefined,           // person_id
    undefined,           // organization_id
    opts.status,
    undefined,           // include_fields
    opts.limit ?? 25,
    undefined            // cursor
  ),
};

// ── Persons ───────────────────────────────────────────────────────────────────
export const persons = {
  getAll:  (opts = {}) => _personsV2.getPersons(
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    opts.limit ?? 100, opts.cursor
  ),
  getOne:  (id) => _personsV2.getPerson(id),
  update:  (id, body) => _personsV2.updatePerson(id, body),
  search:  (term, opts = {}) => _personsV2.searchPersons(
    term, undefined, undefined, undefined, undefined, undefined, opts.limit ?? 25, undefined
  ),
  merge:   (keepId, deleteId) => _personsV1.mergePersons(keepId, { merge_with_id: deleteId }),
};

// ── Organizations ─────────────────────────────────────────────────────────────
export const organizations = {
  getAll:  (opts = {}) => _orgsV2.getOrganizations(
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    opts.limit ?? 100, opts.cursor
  ),
  getOne:  (id) => _orgsV2.getOrganization(id),
  merge:   (keepId, deleteId) => _orgsV1.mergeOrganizations(keepId, { merge_with_id: deleteId }),
};

// ── Activities ────────────────────────────────────────────────────────────────
export const activities = {
  /**
   * @param {object} opts
   * @param {number}  [opts.done]        0 = not done, 1 = done
   * @param {string}  [opts.updated_since]
   * @param {string}  [opts.updated_until]
   * @param {number}  [opts.limit]
   * @param {string}  [opts.cursor]
   */
  getAll:  (opts = {}) => _actsApi.getActivities(
    undefined,           // filter_id
    undefined,           // ids
    undefined,           // owner_id
    undefined,           // deal_id
    undefined,           // lead_id
    undefined,           // person_id
    undefined,           // org_id
    opts.done,
    opts.updated_since,
    opts.updated_until,
    undefined,           // sort_by
    undefined,           // sort_direction
    undefined,           // include_fields
    opts.limit ?? 100,
    opts.cursor
  ),
  create:  (body) => _actsApi.addActivity(body),
  update:  (id, body) => _actsApi.updateActivity(id, body),
};

// ── Pipelines & Stages ────────────────────────────────────────────────────────
export const pipelines = {
  getAll:  () => _pipelinesApi.getPipelines(),
};

export const stages = {
  getAll:  (pipelineId) => _stagesApi.getStages(pipelineId, undefined, undefined, 500, undefined),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = {
  getAll:  () => _usersApi.getUsers(),
};

// ── Notes ─────────────────────────────────────────────────────────────────────
export const notes = {
  create:  (body) => _notesApi.addNote(body),
};

// ── Formatters ────────────────────────────────────────────────────────────────
export function formatDeal(d) {
  return {
    id:           d.id,
    title:        d.title,
    value:        d.value != null ? `${d.currency ?? ''} ${Number(d.value).toLocaleString()}`.trim() : 'n/a',
    status:       d.status,
    stage:        d.stage_name ?? d.stage_id,
    owner:        d.owner_name ?? d.user_id?.name ?? d.user_id,
    person:       d.person_name ?? d.person_id?.name ?? d.person_id,
    organization: d.org_name ?? d.org_id?.name ?? d.org_id,
    created:      d.add_time    ? new Date(d.add_time).toLocaleDateString()    : 'n/a',
    updated:      d.update_time ? new Date(d.update_time).toLocaleDateString() : 'n/a',
    close_date:   d.expected_close_date ?? d.close_time ?? 'n/a',
    last_activity_date: d.last_activity_date ?? null,
    won_time:     d.won_time  ?? null,
    lost_time:    d.lost_time ?? null,
    lost_reason:  d.lost_reason ?? null,
    currency:     d.currency ?? '',
    url:          `https://app.pipedrive.com/deal/${d.id}`,
  };
}

export function formatPerson(p) {
  return {
    id:           p.id,
    name:         p.name,
    email:        p.emails?.[0]?.value ?? p.email?.[0]?.value ?? 'n/a',
    phone:        p.phones?.[0]?.value ?? p.phone?.[0]?.value ?? 'n/a',
    organization: p.org_name ?? p.org_id?.name ?? 'n/a',
    owner:        p.owner_name ?? p.owner_id?.name ?? 'n/a',
    created:      p.add_time ? new Date(p.add_time).toLocaleDateString() : 'n/a',
    url:          `https://app.pipedrive.com/person/${p.id}`,
  };
}

export function formatActivity(a) {
  return {
    id:        a.id,
    subject:   a.subject,
    type:      a.type,
    due_date:  a.due_date,
    due_time:  a.due_time ?? '',
    done:      a.done ? 'Yes' : 'No',
    owner:     a.owner_name ?? a.assigned_to_user_id ?? a.user_id,
    deal:      a.deal_title ?? (a.deal_id ? `Deal #${a.deal_id}` : null),
    deal_id:   a.deal_id,
    person:    a.person_name ?? a.person_id ?? null,
    note:      a.note ?? '',
    url:       a.deal_id ? `https://app.pipedrive.com/deal/${a.deal_id}` : '',
  };
}
