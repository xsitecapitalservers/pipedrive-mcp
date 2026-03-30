/**
 * tools/automation.js — Task Automation
 * ─────────────────────────────────────────────
 * Tools:
 *   update_deal_stage        - move a deal to a different pipeline stage
 *   update_deal_owner        - reassign a deal to another team member
 *   bulk_update_deal_stage   - move multiple deals at once
 *   add_note_to_deal         - add a text note to a deal
 *   search_deals             - search for deals by title, person, or org
 *   get_pipelines_and_stages - list all pipelines and their stages (useful for finding stage IDs)
 *   get_users                - list all team members and their IDs
 */

import { dealsApi, pipelinesApi, stagesApi, usersApi, notesApi, formatDeal } from '../pipedrive.js';
import { z } from 'zod';

export const automationTools = [

  // ── get_pipelines_and_stages ─────────────────────────────────────────────────
  {
    name: 'get_pipelines_and_stages',
    description: 'List all pipelines and their stages with IDs. Use this first to find the ' +
                 'stage_id you need before calling update_deal_stage.',
    schema: z.object({}),
    async handler() {
      const pipelinesRes = await pipelinesApi.getPipelines();
      const pipelines    = pipelinesRes?.data ?? [];

      if (pipelines.length === 0) {
        return { content: [{ type: 'text', text: 'No pipelines found.' }] };
      }

      const lines = [];
      for (const p of pipelines) {
        lines.push(`\n**Pipeline: ${p.name}** (ID: ${p.id})`);
        const stagesRes = await stagesApi.getStages({ pipeline_id: p.id });
        const stages = stagesRes?.data ?? [];
        for (const s of stages) {
          lines.push(`  Stage ID ${s.id}: ${s.name}`);
        }
      }

      return {
        content: [{ type: 'text', text: 'Your pipelines and stages:\n' + lines.join('\n') }],
      };
    },
  },

  // ── get_users ────────────────────────────────────────────────────────────────
  {
    name: 'get_users',
    description: 'List all active Pipedrive team members with their IDs. ' +
                 'Use this to find a user_id before reassigning a deal.',
    schema: z.object({}),
    async handler() {
      const res   = await usersApi.getUsers();
      const users = (res?.data ?? []).filter(u => u.active_flag);

      if (users.length === 0) {
        return { content: [{ type: 'text', text: 'No active users found.' }] };
      }

      return {
        content: [{
          type: 'text',
          text: 'Active team members:\n\n' +
            users.map(u => `• ID ${u.id} — ${u.name} (${u.email})`).join('\n'),
        }],
      };
    },
  },

  // ── update_deal_stage ────────────────────────────────────────────────────────
  {
    name: 'update_deal_stage',
    description: 'Move a deal to a different stage in the pipeline. ' +
                 'Call get_pipelines_and_stages first to find the correct stage_id.',
    schema: z.object({
      deal_id:  z.number().int().describe('The ID of the deal to update'),
      stage_id: z.number().int().describe('The ID of the destination stage'),
    }),
    async handler({ deal_id, stage_id }) {
      const res = await dealsApi.updateDeal({
        id: deal_id,
        UpdateDealRequest: { stage_id },
      });
      const d = res?.data;
      if (!d) throw new Error('Update failed — no data returned.');

      return {
        content: [{
          type: 'text',
          text: `✅ Deal moved!\n• Deal: ${d.title} (ID ${d.id})\n• New stage: ${d.stage_id}\n• https://app.pipedrive.com/deal/${d.id}`,
        }],
      };
    },
  },

  // ── update_deal_owner ────────────────────────────────────────────────────────
  {
    name: 'update_deal_owner',
    description: 'Reassign a deal to a different team member. Call get_users first if you need the user_id.',
    schema: z.object({
      deal_id: z.number().int(),
      user_id: z.number().int().describe('The Pipedrive user ID of the new owner'),
    }),
    async handler({ deal_id, user_id }) {
      const res = await dealsApi.updateDeal({
        id: deal_id,
        UpdateDealRequest: { user_id },
      });
      const d = res?.data;
      if (!d) throw new Error('Update failed.');

      return {
        content: [{
          type: 'text',
          text: `✅ Deal reassigned!\n• Deal: ${d.title} (ID ${d.id})\n• New owner ID: ${user_id}\n• https://app.pipedrive.com/deal/${d.id}`,
        }],
      };
    },
  },

  // ── bulk_update_deal_stage ───────────────────────────────────────────────────
  {
    name: 'bulk_update_deal_stage',
    description: 'Move multiple deals to the same stage at once. Useful for batch pipeline clean-up.',
    schema: z.object({
      deal_ids: z.array(z.number().int()).min(1).max(50).describe('Array of deal IDs to update'),
      stage_id: z.number().int().describe('Destination stage ID'),
    }),
    async handler({ deal_ids, stage_id }) {
      const results = await Promise.allSettled(
        deal_ids.map(id =>
          dealsApi.updateDeal({ id, UpdateDealRequest: { stage_id } })
        )
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

  // ── add_note_to_deal ─────────────────────────────────────────────────────────
  {
    name: 'add_note_to_deal',
    description: 'Add a text note to a deal in Pipedrive.',
    schema: z.object({
      deal_id: z.number().int(),
      content: z.string().min(1).describe('The note text (supports HTML)'),
    }),
    async handler({ deal_id, content }) {
      const res = await notesApi.addNote({
        AddNoteRequest: { content, deal_id },
      });
      const note = res?.data;
      if (!note) throw new Error('Note creation failed.');

      return {
        content: [{
          type: 'text',
          text: `✅ Note added to deal ${deal_id} (note ID: ${note.id})`,
        }],
      };
    },
  },

  // ── search_deals ─────────────────────────────────────────────────────────────
  {
    name: 'search_deals',
    description: 'Search deals by title, person name, or organization name.',
    schema: z.object({
      query:  z.string().min(1).describe('Search term'),
      status: z.enum(['open', 'won', 'lost', 'all']).default('open'),
      limit:  z.number().int().min(1).max(50).default(10),
    }),
    async handler({ query, status, limit }) {
      const apiStatus = status === 'all' ? undefined : status;
      const res = await dealsApi.searchDeals({
        term:           query,
        status:         apiStatus,
        include_fields: 'deal.title,deal.value,deal.stage_name',
        limit,
      });

      const items = (res?.data?.items ?? []).map(i => formatDeal(i.item));

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
