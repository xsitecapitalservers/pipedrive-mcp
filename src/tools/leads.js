import { deals, getData, formatDeal } from '../pipedrive.js';
import { notifyNewLeads } from '../teams.js';
import { z } from 'zod';

export const leadTools = [

  {
    name: 'get_new_leads',
    description: 'Get deals created in Pipedrive within the last N days.',
    schema: z.object({
      days:  z.number().int().min(1).max(90).default(1),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    async handler({ days, limit }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const res      = await deals.getAll({ status: 'open', sort: 'add_time DESC', limit: 100 });
      const filtered = getData(res)
        .filter(d => d.add_time && d.add_time.slice(0, 10) >= cutoffStr)
        .slice(0, limit)
        .map(formatDeal);

      return {
        content: [{
          type: 'text',
          text: filtered.length === 0
            ? `No new deals found in the last ${days} day(s).`
            : `Found ${filtered.length} new deal(s) in the last ${days} day(s):\n\n` +
              filtered.map(d => `• **${d.title}** (${d.value}) — Owner: ${d.owner}\n  ${d.url}`).join('\n'),
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

      const res = await deals.getAll({ status: 'open', sort: 'add_time DESC', limit: 50 });
      const all = getData(res)
        .filter(d => d.add_time?.slice(0, 10) >= cutoffStr)
        .map(formatDeal);

      if (all.length === 0) {
        return { content: [{ type: 'text', text: `No new leads in the last ${days} day(s). No Teams notification sent.` }] };
      }

      const result = await notifyNewLeads(all, days);
      return {
        content: [{
          type: 'text',
          text: `Found ${all.length} new lead(s). Teams notification ${result.sent ? 'sent ✅' : 'skipped (' + result.reason + ')'}.`,
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
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const res      = await deals.getAll({ status, sort: 'update_time DESC', limit: 100 });
      const filtered = getData(res)
        .filter(d => d.update_time && d.update_time.slice(0, 10) >= cutoffStr)
        .slice(0, limit)
        .map(formatDeal);

      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: `No deals updated in the last ${days} day(s).` }] };
      }

      return {
        content: [{
          type: 'text',
          text: `${filtered.length} deal(s) updated in the last ${days} day(s):\n\n` +
            filtered.map(d => `• **${d.title}** | Status: ${d.status} | Updated: ${d.updated}\n  ${d.url}`).join('\n'),
        }],
      };
    },
  },
];
