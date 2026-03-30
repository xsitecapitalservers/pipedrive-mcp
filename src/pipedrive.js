/**
 * pipedrive.js
 * ─────────────────────────────────────────────
 * A thin wrapper around the official Pipedrive Node.js client.
 * All API calls go through the functions here, so the rest of the
 * codebase never has to worry about auth or pagination.
 */

import * as pipedrive from 'pipedrive';

// ── Initialise the client once ────────────────────────────────────────────────
const config = new pipedrive.Configuration({
  apiKey: process.env.PIPEDRIVE_API_TOKEN,
});

export const dealsApi        = new pipedrive.DealsApi(config);
export const personsApi      = new pipedrive.PersonsApi(config);
export const organizationsApi = new pipedrive.OrganizationsApi(config);
export const activitiesApi   = new pipedrive.ActivitiesApi(config);
export const leadsApi        = new pipedrive.LeadsApi(config);
export const pipelinesApi    = new pipedrive.PipelinesApi(config);
export const stagesApi       = new pipedrive.StagesApi(config);
export const usersApi        = new pipedrive.UsersApi(config);
export const notesApi        = new pipedrive.NotesApi(config);

// ── Helper: paginate through all results ─────────────────────────────────────
/**
 * Many Pipedrive endpoints return up to 100 items per page.
 * This helper keeps fetching until there are no more pages.
 *
 * @param {Function} fetchFn  - async function that accepts { start, limit }
 *                              and returns the raw API response.
 * @param {number}   limit    - items per page (max 100)
 * @returns {Array}           - flat array of all items
 */
export async function fetchAll(fetchFn, limit = 100) {
  const results = [];
  let start = 0;

  while (true) {
    const response = await fetchFn({ start, limit });
    const data = response?.data ?? response?.body?.data ?? [];
    if (!data || data.length === 0) break;

    results.push(...data);

    const moreItems = response?.additional_data?.pagination?.more_items_in_collection
      ?? response?.body?.additional_data?.pagination?.more_items_in_collection;

    if (!moreItems) break;
    start += limit;
  }

  return results;
}

// ── Helper: format a deal for display ────────────────────────────────────────
export function formatDeal(d) {
  return {
    id:           d.id,
    title:        d.title,
    value:        d.value ? `${d.currency} ${Number(d.value).toLocaleString()}` : 'n/a',
    status:       d.status,
    stage:        d.stage_name ?? d.stage_id,
    owner:        d.owner_name ?? d.user_id?.name,
    person:       d.person_name ?? d.person_id?.name,
    organization: d.org_name ?? d.org_id?.name,
    created:      d.add_time ? new Date(d.add_time).toLocaleDateString() : 'n/a',
    updated:      d.update_time ? new Date(d.update_time).toLocaleDateString() : 'n/a',
    close_date:   d.close_time ?? d.expected_close_date ?? 'n/a',
    won_time:     d.won_time ?? null,
    lost_reason:  d.lost_reason ?? null,
    url:          `https://app.pipedrive.com/deal/${d.id}`,
  };
}

// ── Helper: format a person for display ──────────────────────────────────────
export function formatPerson(p) {
  return {
    id:           p.id,
    name:         p.name,
    email:        p.email?.[0]?.value ?? 'n/a',
    phone:        p.phone?.[0]?.value ?? 'n/a',
    organization: p.org_name ?? p.org_id?.name ?? 'n/a',
    owner:        p.owner_name ?? p.owner_id?.name ?? 'n/a',
    created:      p.add_time ? new Date(p.add_time).toLocaleDateString() : 'n/a',
    url:          `https://app.pipedrive.com/person/${p.id}`,
  };
}

// ── Helper: format an activity for display ────────────────────────────────────
export function formatActivity(a) {
  return {
    id:          a.id,
    subject:     a.subject,
    type:        a.type,
    due_date:    a.due_date,
    due_time:    a.due_time ?? '',
    done:        a.done ? 'Yes' : 'No',
    owner:       a.owner_name ?? a.assigned_to_user_id,
    deal:        a.deal_title ?? a.deal_id ?? 'n/a',
    person:      a.person_name ?? a.person_id ?? 'n/a',
    note:        a.note ?? '',
    url:         a.deal_id ? `https://app.pipedrive.com/deal/${a.deal_id}` : '',
  };
}
