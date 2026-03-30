/**
 * pipedrive.js
 * ─────────────────────────────────────────────
 * Wrapper around the official Pipedrive Node.js SDK (v22).
 *
 * This version of the SDK (v22.x) is a CommonJS package. All API classes
 * live at the top level of require('pipedrive') — there are no v1/v2 sub-namespaces.
 * Authentication uses ApiClient, not Configuration.
 * Methods accept an opts object ({ status, limit, start, sort, ... }).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pipedrive = require('pipedrive');

// ── Initialise the shared API client ──────────────────────────────────────────
const apiClient = new pipedrive.ApiClient();
apiClient.authentications['api_key'].apiKey = process.env.PIPEDRIVE_API_TOKEN;

// ── API instances ─────────────────────────────────────────────────────────────
const _deals     = new pipedrive.DealsApi(apiClient);
const _persons   = new pipedrive.PersonsApi(apiClient);
const _orgs      = new pipedrive.OrganizationsApi(apiClient);
const _acts      = new pipedrive.ActivitiesApi(apiClient);
const _pipes     = new pipedrive.PipelinesApi(apiClient);
const _stages    = new pipedrive.StagesApi(apiClient);
const _users     = new pipedrive.UsersApi(apiClient);
const _notes     = new pipedrive.NotesApi(apiClient);

// ── Helper: extract data from response ───────────────────────────────────────
// The SDK returns { data: [...], additional_data: { pagination: { more_items_in_collection, start, limit } } }
export function getData(res) {
  return res?.data ?? [];
}
export function hasMore(res) {
  return res?.additional_data?.pagination?.more_items_in_collection === true;
}

// ── Helper: fetch all pages (offset-based pagination) ────────────────────────
export async function fetchAll(fetchFn, limit = 100) {
  const results = [];
  let start = 0;
  while (true) {
    const res  = await fetchFn({ start, limit });
    const data = getData(res);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (!hasMore(res)) break;
    start += limit;
  }
  return results;
}

// ── Deals ─────────────────────────────────────────────────────────────────────
export const deals = {
  getAll:  (opts = {}) => _deals.getDeals(opts),
  getOne:  (id)        => _deals.getDeal(id),
  update:  (id, body)  => _deals.updateDeal(id, { updateDealRequest: body }),
  search:  (term, opts = {}) => _deals.searchDeals(term, opts),
};

// ── Persons ───────────────────────────────────────────────────────────────────
export const persons = {
  getAll: (opts = {}) => _persons.getPersons(opts),
  getOne: (id)        => _persons.getPerson(id),
  merge:  (keepId, deleteId) => _persons.mergePersons(keepId, { merge_with_id: deleteId }),
};

// ── Organizations ─────────────────────────────────────────────────────────────
export const organizations = {
  getAll: (opts = {})        => _orgs.getOrganizations(opts),
  getOne: (id)               => _orgs.getOrganization(id),
  merge:  (keepId, deleteId) => _orgs.mergeOrganizations(keepId, { merge_with_id: deleteId }),
};

// ── Activities ────────────────────────────────────────────────────────────────
export const activities = {
  getAll: (opts = {}) => _acts.getActivities(opts),
  create: (body)      => _acts.addActivity({ addActivityRequest: body }),
  update: (id, body)  => _acts.updateActivity(id, { updateActivityRequest: body }),
};

// ── Pipelines & Stages ────────────────────────────────────────────────────────
export const pipelines = {
  getAll: () => _pipes.getPipelines(),
};
export const stages = {
  getAll: (pipelineId) => _stages.getStages({ pipeline_id: pipelineId, limit: 500 }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = {
  getAll: () => _users.getUsers(),
};

// ── Notes ─────────────────────────────────────────────────────────────────────
export const notes = {
  create: (body) => _notes.addNote({ addNoteRequest: body }),
};

// ── Formatters ────────────────────────────────────────────────────────────────
export function formatDeal(d) {
  return {
    id:           d.id,
    title:        d.title,
    value:        d.value != null ? `${d.currency ?? ''} ${Number(d.value).toLocaleString()}`.trim() : 'n/a',
    status:       d.status,
    stage:        d.stage_id,
    owner:        d.owner_name ?? d.user_id?.name ?? d.user_id,
    person:       d.person_name ?? d.person_id?.name,
    organization: d.org_name ?? d.org_id?.name,
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
    email:        p.email?.[0]?.value ?? 'n/a',
    phone:        p.phone?.[0]?.value ?? 'n/a',
    organization: p.org_name ?? p.org_id?.name ?? 'n/a',
    created:      p.add_time ? new Date(p.add_time).toLocaleDateString() : 'n/a',
    url:          `https://app.pipedrive.com/person/${p.id}`,
  };
}

export function formatActivity(a) {
  return {
    id:       a.id,
    subject:  a.subject,
    type:     a.type,
    due_date: a.due_date,
    due_time: a.due_time ?? '',
    done:     a.done ? 'Yes' : 'No',
    owner:    a.owner_name ?? a.assigned_to_user_id ?? a.user_id,
    deal:     a.deal_title ?? (a.deal_id ? `Deal #${a.deal_id}` : null),
    deal_id:  a.deal_id,
    note:     a.note ?? '',
    url:      a.deal_id ? `https://app.pipedrive.com/deal/${a.deal_id}` : '',
  };
}
