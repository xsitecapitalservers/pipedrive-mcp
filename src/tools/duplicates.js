/**
 * tools/duplicates.js — Duplicate Detection & Merging
 * ─────────────────────────────────────────────
 * Tools:
 *   find_duplicate_persons       - find persons with the same name or email
 *   find_duplicate_organizations - find orgs with the same name or domain
 *   merge_persons                - merge two person records (keep one, delete the other)
 *   merge_organizations          - merge two organization records
 */

import { personsApi, organizationsApi, fetchAll, formatPerson } from '../pipedrive.js';
import { z } from 'zod';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a string for fuzzy comparison: lowercase, trim, collapse spaces */
function normalise(str = '') {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Extract the domain from an email address */
function emailDomain(email = '') {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

/** Group an array of items by a computed key */
function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const duplicateTools = [

  // ── find_duplicate_persons ──────────────────────────────────────────────────
  {
    name: 'find_duplicate_persons',
    description: 'Scan all persons in Pipedrive and find likely duplicates, grouped by ' +
                 'matching full name or email address. Returns each duplicate group so you ' +
                 'can review and then call merge_persons.',
    schema: z.object({
      match_by: z.enum(['name', 'email', 'both']).default('both')
        .describe('What to compare: name, email, or both'),
      max_groups: z.number().int().min(1).max(50).default(20)
        .describe('Maximum number of duplicate groups to return'),
    }),
    async handler({ match_by, max_groups }) {
      const allPersons = await fetchAll(({ start, limit }) =>
        personsApi.getPersons({ start, limit })
      );

      const groups = [];

      if (match_by === 'name' || match_by === 'both') {
        const byName = groupBy(allPersons, p => normalise(p.name));
        groups.push(...byName);
      }

      if (match_by === 'email' || match_by === 'both') {
        const byEmail = groupBy(allPersons, p => {
          const email = p.email?.[0]?.value;
          return email ? normalise(email) : null;
        });
        // avoid adding groups already caught by name
        for (const g of byEmail) {
          const ids = new Set(g.map(p => p.id));
          const alreadyCovered = groups.some(existing => existing.some(p => ids.has(p.id)));
          if (!alreadyCovered) groups.push(g);
        }
      }

      const limited = groups.slice(0, max_groups);

      if (limited.length === 0) {
        return { content: [{ type: 'text', text: 'No duplicate persons found 🎉' }] };
      }

      const lines = limited.map((group, i) => {
        const header = `**Group ${i + 1}** (${group.length} records)`;
        const members = group.map(p => {
          const email = p.email?.[0]?.value ?? 'no email';
          return `  • ID ${p.id} — ${p.name} — ${email} — ${p.org_name ?? 'no org'}\n    ${`https://app.pipedrive.com/person/${p.id}`}`;
        }).join('\n');
        return `${header}\n${members}`;
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${limited.length} duplicate group(s) (showing up to ${max_groups}):\n\n` +
                lines.join('\n\n') +
                `\n\nTo merge, call \`merge_persons\` with the IDs of the two records to combine.`,
        }],
      };
    },
  },

  // ── find_duplicate_organizations ────────────────────────────────────────────
  {
    name: 'find_duplicate_organizations',
    description: 'Scan all organizations and find likely duplicates by matching name. ' +
                 'Returns each group of duplicates for review.',
    schema: z.object({
      max_groups: z.number().int().min(1).max(50).default(20),
    }),
    async handler({ max_groups }) {
      const allOrgs = await fetchAll(({ start, limit }) =>
        organizationsApi.getOrganizations({ start, limit })
      );

      const groups = groupBy(allOrgs, o => normalise(o.name)).slice(0, max_groups);

      if (groups.length === 0) {
        return { content: [{ type: 'text', text: 'No duplicate organizations found 🎉' }] };
      }

      const lines = groups.map((group, i) => {
        const header = `**Group ${i + 1}** — "${group[0].name}" (${group.length} records)`;
        const members = group.map(o =>
          `  • ID ${o.id} — ${o.name} — ${o.people_count ?? 0} people — ${o.open_deals_count ?? 0} open deals\n    https://app.pipedrive.com/organization/${o.id}`
        ).join('\n');
        return `${header}\n${members}`;
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${groups.length} duplicate org group(s):\n\n` + lines.join('\n\n') +
                `\n\nCall \`merge_organizations\` with the two IDs to merge them.`,
        }],
      };
    },
  },

  // ── merge_persons ────────────────────────────────────────────────────────────
  {
    name: 'merge_persons',
    description: 'Merge two person records in Pipedrive. The "winner" record is kept and ' +
                 'all data (deals, activities, notes) from the "loser" is moved to it. ' +
                 'The loser record is then deleted. This action CANNOT be undone — review first!',
    schema: z.object({
      keep_id:   z.number().int().describe('ID of the person record to KEEP (the "winner")'),
      delete_id: z.number().int().describe('ID of the person record to DELETE (the "loser")'),
    }),
    async handler({ keep_id, delete_id }) {
      if (keep_id === delete_id) {
        return { content: [{ type: 'text', text: '❌ keep_id and delete_id must be different.' }] };
      }

      // Fetch both so we can show a summary before merging
      const [keepRes, deleteRes] = await Promise.all([
        personsApi.getPerson({ id: keep_id }),
        personsApi.getPerson({ id: delete_id }),
      ]);

      const keeper  = keepRes?.data;
      const deleter = deleteRes?.data;

      if (!keeper || !deleter) {
        return { content: [{ type: 'text', text: '❌ Could not find one or both person records. Double-check the IDs.' }] };
      }

      await personsApi.mergePersons({
        id: keep_id,
        MergePersonsRequest: { merge_with_id: delete_id },
      });

      return {
        content: [{
          type: 'text',
          text: `✅ Merged successfully!\n` +
                `• Kept:    **${keeper.name}** (ID ${keep_id})\n` +
                `• Deleted: **${deleter.name}** (ID ${delete_id})\n` +
                `All deals, notes, and activities have been moved to the surviving record.\n` +
                `https://app.pipedrive.com/person/${keep_id}`,
        }],
      };
    },
  },

  // ── merge_organizations ──────────────────────────────────────────────────────
  {
    name: 'merge_organizations',
    description: 'Merge two organization records. All data from the deleted org is moved to ' +
                 'the surviving org. This action CANNOT be undone.',
    schema: z.object({
      keep_id:   z.number().int().describe('ID of the organization to KEEP'),
      delete_id: z.number().int().describe('ID of the organization to DELETE'),
    }),
    async handler({ keep_id, delete_id }) {
      if (keep_id === delete_id) {
        return { content: [{ type: 'text', text: '❌ keep_id and delete_id must be different.' }] };
      }

      const [keepRes, deleteRes] = await Promise.all([
        organizationsApi.getOrganization({ id: keep_id }),
        organizationsApi.getOrganization({ id: delete_id }),
      ]);

      const keeper  = keepRes?.data;
      const deleter = deleteRes?.data;

      if (!keeper || !deleter) {
        return { content: [{ type: 'text', text: '❌ Could not find one or both organizations.' }] };
      }

      await organizationsApi.mergeOrganizations({
        id: keep_id,
        MergeOrganizationsRequest: { merge_with_id: delete_id },
      });

      return {
        content: [{
          type: 'text',
          text: `✅ Organizations merged!\n` +
                `• Kept:    **${keeper.name}** (ID ${keep_id})\n` +
                `• Deleted: **${deleter.name}** (ID ${delete_id})\n` +
                `https://app.pipedrive.com/organization/${keep_id}`,
        }],
      };
    },
  },
];
