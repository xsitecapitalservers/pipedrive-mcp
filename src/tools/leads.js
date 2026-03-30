/**
 * tools/leads.js — New Lead Alerts
 */

import { deals, fetchAll, formatDeal } from '../pipedrive.js';
import { notifyNewLeads } from '../teams.js';
import { z } from 'zod';

export const leadTools = [

  {
    name: 'get_new_leads',
    description: 'Get deals created in Pipedrive within the last N days.',
    schema: z.object({
      days:  z.number().int().min(1).max(90).default(1).describe('How many days back to look'),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    async handler({ days, limit }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const res  = await deals.getAll({ status: 'open', sort_by: 'id', sort_direction: 'desc', limit: 100 });
      const all  = (res?.data?.data ?? res?.data ?? []);
      const filtered = all
        .filter(d => d.add_time && d.add_time.slice(0, 10) >= cutoffStr)
        .slice(0, limit)
        .map(formatDeal);

      return {
        content: [{
          type: 'text',
          text: filtered.length === 0
            ? `No new deals found in the last ${days} day(s).`
            : `Found ${filtered.length} new deal(s) in the last ${days} day(s):\n\n` +
              filtered.map(d =>
                `• **${d.title}** (${d.value}) — Stage: ${d.stage} — Owner: ${d.owner}\n  ${d.url}`
              ).join('\n'),
        }],
        _data: filtered,
      };
    },
  },

  {
    name: 'notify_new_leads',
    description: 'Fetch new deals from the last N days AND send a Microsoft Teams notification.',
    schema: z.object({
      days: z.number().int().min(1).max(30).default(1),
    }),
    async handler({ days }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const res = await deals.getAll({ status: 'open', sort_by: 'id', sort_direction: 'desc', limit: 50 });
      const all = (res?.data?.data ?? res?.data ?? [])
        .filter(d => d.add_time?.slice(0, 10) >= cutoffStr)
        .map(formatDeal);

      if (all.length === 0) {
        return { content: [{ type: 'text', text: `No new leads in the last ${days} day(s). No Teams notification sent.` }] };
      }

      const teamsResult = await notifyNewLeads(all, days);
      return {
        content: [{
          type: 'text',
          text: `Found ${all.length} new lead(s). Teams notification ${teamsResult.sent ? 'sent ✅' : 'skipped (' + teamsResult.reason + ')'}.`,
        }],
      };
    },
  },

  {
    name: 'get_recent_deals',
    description: 'Get deals that were updated (moved stage, won, or lost) in the last N days.',
    schema: z.object({
      days:   z.number().int().min(1).max(90).default(7),
      status: z.enum(['open', 'won', 'lost']).default('open'),
      limit:  z.number().int().min(1).max(100).default(25),
    }),
    async handler({ days, status, limit }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().replace('T', ' ').slice(0, 19); // YYYY-MM-DD HH:MM:SS

      const res = await deals.getAll({
        status,
        updated_since: cutoffStr,
        sort_by: 'update_time',
        sort_direction: 'desc',
        limit: Math.min(limit, 100),
      });
      const filtered = (res?.data?.data ?? res?.data ?? []).slice(0, limit).map(formatDeal);

      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: `No deals updated in the last ${days} day(s).` }] };
      }

      return {
        content: [{
          type: 'text',
          text: `${filtered.length} deal(s) updated in the last ${days} day(s):\n\n` +
            filtered.map(d =>
              `• **${d.title}** | Status: ${d.status} | Stage: ${d.stage} | Updated: ${d.updated}\n  ${d.url}`
            ).join('\n'),
        }],
      };
    },
  },
];
