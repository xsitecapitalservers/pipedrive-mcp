/**
 * tools/duplicates.js — Duplicate Detection & Merging
 */

import { persons, organizations, fetchAll, formatPerson } from '../pipedrive.js';
import { z } from 'zod';

function normalise(str = '') {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

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

export const duplicateTools = [

  {
    name: 'find_duplicate_persons',
    description: 'Scan all persons and find likely duplicates by matching name or email.',
    schema: z.object({
      match_by:   z.enum(['name', 'email', 'both']).default('both'),
      max_groups: z.number().int().min(1).max(50).default(20),
    }),
    async handler({ match_by, max_groups }) {
      const allPersons = await fetchAll((cursor) =>
        persons.getAll({ limit: 100, cursor })
      );

      const groups = [];

      if (match_by === 'name' || match_by === 'both') {
        groups.push(...groupBy(allPersons, p => normalise(p.name)));
      }

      if (match_by === 'email' || match_by === 'both') {
        const byEmail = groupBy(allPersons, p => {
          const email = p.emails?.[0]?.value ?? p.email?.[0]?.value;
          return email ? normalise(email) : null;
        });
        for (const g of byEmail) {
          const ids = new Set(g.map(p => p.id));
          const already = groups.some(ex => ex.some(p => ids.has(p.id)));
          if (!already) groups.push(g);
        }
      }

      const limited = groups.slice(0, max_groups);
      if (limited.length === 0) {
        return { content: [{ type: 'text', text: 'No duplicate persons found 🎉' }] };
      }

      const lines = limited.map((group, i) => {
        const header = `**Group ${i + 1}** (${group.length} records)`;
        const members = group.map(p => {
          const email = p.emails?.[0]?.value ?? p.email?.[0]?.value ?? 'no email';
          return `  • ID ${p.id} — ${p.name} — ${email}\n    https://app.pipedrive.com/person/${p.id}`;
        }).join('\n');
        return `${header}\n${members}`;
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${limited.length} duplicate group(s):\n\n` +
                lines.join('\n\n') +
                `\n\nTo merge, call \`merge_persons\` with the two IDs.`,
        }],
      };
    },
  },

  {
    name: 'find_duplicate_organizations',
    description: 'Scan all organizations and find likely duplicates by name.',
    schema: z.object({
      max_groups: z.number().int().min(1).max(50).default(20),
    }),
    async handler({ max_groups }) {
      const allOrgs = await fetchAll((cursor) =>
        organizations.getAll({ limit: 100, cursor })
      );

      const groups = groupBy(allOrgs, o => normalise(o.name)).slice(0, max_groups);

      if (groups.length === 0) {
        return { content: [{ type: 'text', text: 'No duplicate organizations found 🎉' }] };
      }

      const lines = groups.map((group, i) => {
        const header = `**Group ${i + 1}** — "${group[0].name}" (${group.length} records)`;
        const members = group.map(o =>
          `  • ID ${o.id} — ${o.name} — ${o.people_count ?? 0} people\n    https://app.pipedrive.com/organization/${o.id}`
        ).join('\n');
        return `${header}\n${members}`;
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${groups.length} duplicate org group(s):\n\n` + lines.join('\n\n') +
                `\n\nCall \`merge_organizations\` to merge them.`,
        }],
      };
    },
  },

  {
    name: 'merge_persons',
    description: 'Merge two person records. The "winner" is kept; all data from the "loser" moves to it. CANNOT be undone.',
    schema: z.object({
      keep_id:   z.number().int().describe('ID of the person to KEEP'),
      delete_id: z.number().int().describe('ID of the person to DELETE'),
    }),
    async handler({ keep_id, delete_id }) {
      if (keep_id === delete_id) {
        return { content: [{ type: 'text', text: '❌ keep_id and delete_id must be different.' }] };
      }

      const [keepRes, deleteRes] = await Promise.all([
        persons.getOne(keep_id),
        persons.getOne(delete_id),
      ]);

      const keeper  = keepRes?.data?.data ?? keepRes?.data;
      const deleter = deleteRes?.data?.data ?? deleteRes?.data;

      if (!keeper || !deleter) {
        return { content: [{ type: 'text', text: '❌ Could not find one or both person records.' }] };
      }

      await persons.merge(keep_id, delete_id);

      return {
        content: [{
          type: 'text',
          text: `✅ Merged!\n• Kept: **${keeper.name}** (ID ${keep_id})\n• Deleted: **${deleter.name}** (ID ${delete_id})\n` +
                `https://app.pipedrive.com/person/${keep_id}`,
        }],
      };
    },
  },

  {
    name: 'merge_organizations',
    description: 'Merge two organization records. All data moves to the surviving org. CANNOT be undone.',
    schema: z.object({
      keep_id:   z.number().int().describe('ID of the org to KEEP'),
      delete_id: z.number().int().describe('ID of the org to DELETE'),
    }),
    async handler({ keep_id, delete_id }) {
      if (keep_id === delete_id) {
        return { content: [{ type: 'text', text: '❌ keep_id and delete_id must be different.' }] };
      }

      const [keepRes, deleteRes] = await Promise.all([
        organizations.getOne(keep_id),
        organizations.getOne(delete_id),
      ]);

      const keeper  = keepRes?.data?.data ?? keepRes?.data;
      const deleter = deleteRes?.data?.data ?? deleteRes?.data;

      if (!keeper || !deleter) {
        return { content: [{ type: 'text', text: '❌ Could not find one or both organizations.' }] };
      }

      await organizations.merge(keep_id, delete_id);

      return {
        content: [{
          type: 'text',
          text: `✅ Organizations merged!\n• Kept: **${keeper.name}** (ID ${keep_id})\n• Deleted: **${deleter.name}** (ID ${delete_id})\n` +
                `https://app.pipedrive.com/organization/${keep_id}`,
        }],
      };
    },
  },
];
