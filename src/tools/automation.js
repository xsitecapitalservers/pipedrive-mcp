/**
 * tools/automation.js — Task Automation
 */

import { deals, pipelines, stages, users, notes, formatDeal } from '../pipedrive.js';
import { z } from 'zod';

export const automationTools = [

  {
    name: 'get_pipelines_and_stages',
    description: 'List all pipelines and their stages with IDs. Use this first to find the stage_id before calling update_deal_stage.',
    schema: z.object({}),
    async handler() {
      const res      = await pipelines.getAll();
      const allPipes = res?.data?.data ?? res?.data ?? [];

      if (allPipes.length === 0) {
        return { content: [{ type: 'text', text: 'No pipelines found.' }] };
      }

      const lines = [];
      for (const p of allPipes) {
        lines.push(`\n**Pipeline: ${p.name}** (ID: ${p.id})`);
        const stagesRes = await stages.getAll(p.id);
        const stageList = stagesRes?.data?.data ?? stagesRes?.data ?? [];
        for (const s of stageList) {
          lines.push(`  Stage ID ${s.id}: ${s.name}`);
        }
      }

      return { content: [{ type: 'text', text: 'Your pipelines and stages:\n' + lines.join('\n') }] };
    },
  },

  {
    name: 'get_users',
    description: 'List all active Pipedrive team members with their IDs.',
    schema: z.object({}),
    async handler() {
      const res       = await users.getAll();
      const allUsers  = (res?.data?.data ?? res?.data ?? []).filter(u => u.active_flag);

      if (allUsers.length === 0) {
        return { content: [{ type: 'text', text: 'No active users found.' }] };
      }

      return {
        content: [{
          type: 'text',
          text: 'Active team members:\n\n' +
            allUsers.map(u => `• ID ${u.id} — ${u.name} (${u.email})`).join('\n'),
        }],
      };
    },
  },

  {
    name: 'update_deal_stage',
    description: 'Move a deal to a different pipeline stage. Call get_pipelines_and_stages first to find the stage_id.',
    schema: z.object({
      deal_id:  z.number().int(),
      stage_id: z.number().int(),
    }),
    async handler({ deal_id, stage_id }) {
      const res = await deals.update(deal_id, { stage_id });
      const d   = res?.data?.data ?? res?.data;

      if (!d) throw new Error('Update failed — no data returned.');

      return {
        content: [{
          type: 'text',
          text: `✅ Deal moved!\n• Deal: ${d.title} (ID ${d.id})\n• Stage ID: ${d.stage_id}\n• https://app.pipedrive.com/deal/${d.id}`,
        }],
      };
    },
  },

  {
    name: 'update_deal_owner',
    description: 'Reassign a deal to a different team member. Call get_users first to find the user_id.',
    schema: z.object({
      deal_id: z.number().int(),
      user_id: z.number().int(),
    }),
    async handler({ deal_id, user_id }) {
      const res = await deals.update(deal_id, { owner_id: user_id });
      const d   = res?.data?.data ?? res?.data;

      if (!d) throw new Error('Update failed.');

      return {
        content: [{
          type: 'text',
          text: `✅ Deal reassigned!\n• Deal: ${d.title} (ID ${d.id})\n• New owner ID: ${user_id}\n• https://app.pipedrive.com/deal/${d.id}`,
        }],
      };
    },
  },

  {
    name: 'bulk_update_deal_stage',
    description: 'Move multiple deals to the same stage at once.',
    schema: z.object({
      deal_ids: z.array(z.number().int()).min(1).max(50),
      stage_id: z.number().int(),
    }),
    async handler({ deal_ids, stage_id }) {
      const results = await Promise.allSettled(
        deal_ids.map(id => deals.update(id, { stage_id }))
      );

      const ok     = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return {
        content: [{
          type: 'text',
          text: `Bulk update complete.\n✅ ${ok} deal(s) moved to stage ${stage_id}${failed > 0 ? `\n❌ ${failed} deal(s) failed` : ''}`,
        }],
      };
    },
  },

  {
    name: 'add_note_to_deal',
    description: 'Add a text note to a deal in Pipedrive.',
    schema: z.object({
      deal_id: z.number().int(),
      content: z.string().min(1).describe('The note text'),
    }),
    async handler({ deal_id, content }) {
      const res  = await notes.create({ content, deal_id });
      const note = res?.data?.data ?? res?.data;

      if (!note) throw new Error('Note creation failed.');

      return {
        content: [{
          type: 'text',
          text: `✅ Note added to deal ${deal_id} (note ID: ${note.id})`,
        }],
      };
    },
  },

  {
    name: 'search_deals',
    description: 'Search deals by title keyword.',
    schema: z.object({
      query:  z.string().min(1),
      status: z.enum(['open', 'won', 'lost']).optional(),
      limit:  z.number().int().min(1).max(50).default(10),
    }),
    async handler({ query, status, limit }) {
      const res   = await deals.search(query, { status, limit });
      const items = (res?.data?.data?.items ?? res?.data?.items ?? []).map(i => formatDeal(i.item ?? i));

      if (items.length === 0) {
        return { content: [{ type: 'text', text: `No deals found matching "${query}".` }] };
      }

      return {
        content: [{
          type: 'text',
          text: `${items.length} deal(s) found for "${query}":\n\n` +
            items.map(d =>
              `• ID ${d.id} — **${d.title}** | ${d.value} | Stage: ${d.stage} | Owner: ${d.owner}\n  ${d.url}`
            ).join('\n'),
        }],
      };
    },
  },
];
