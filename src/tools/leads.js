/**
 * tools/leads.js — New Lead Alerts
 * ─────────────────────────────────────────────
 * Tools:
 *   get_new_leads       - list deals/leads created in the last N days
 *   notify_new_leads    - send a Teams alert about new leads
 *   get_recent_deals    - deals updated recently (won, lost, or moved stage)
 */

import { dealsApi, leadsApi, fetchAll, formatDeal } from '../pipedrive.js';
import { notifyNewLeads } from '../teams.js';
import { z } from 'zod';

export const leadTools = [

  // ── get_new_leads ───────────────────────────────────────────────────────────
  {
    name: 'get_new_leads',
    description: 'Get deals and leads that were created in Pipedrive within the last N days. ' +
                 'Useful for a morning briefing or a "what came in" alert.',
    schema: z.object({
      days: z.number().int().min(1).max(90).default(1)
        .describe('How many days back to look (default: 1, meaning "since yesterday")'),
      limit: z.number().int().min(1).max(100).default(25)
        .describe('Maximum number of results to return'),
    }),
    async handler({ days, limit }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

      const res = await dealsApi.getDeals({
        status: 'open',
        sort: 'add_time DESC',
        start: 0,
        limit: 100,
      });

      const all = res?.data ?? [];
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
        // also return structured data so other tools can consume it
        _data: filtered,
      };
    },
  },

  // ── notify_new_leads ────────────────────────────────────────────────────────
  {
    name: 'notify_new_leads',
    description: 'Fetch new deals from the last N days AND send a Microsoft Teams notification ' +
                 'to your configured channel. Great for a scheduled morning alert.',
    schema: z.object({
      days: z.number().int().min(1).max(30).default(1)
        .describe('How many days back to look'),
    }),
    async handler({ days }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const res = await dealsApi.getDeals({ status: 'open', sort: 'add_time DESC', limit: 50 });
      const all = (res?.data ?? [])
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

  // ── get_recent_deals ────────────────────────────────────────────────────────
  {
    name: 'get_recent_deals',
    description: 'Get deals that were updated (moved stage, won, or lost) in the last N days.',
    schema: z.object({
      days:   z.number().int().min(1).max(90).default(7).describe('Days back to look'),
      status: z.enum(['open', 'won', 'lost', 'all']).default('all').describe('Filter by deal status'),
      limit:  z.number().int().min(1).max(100).default(25),
    }),
    async handler({ days, status, limit }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const apiStatus = status === 'all' ? undefined : status;
      const res = await dealsApi.getDeals({
        status: apiStatus,
        sort: 'update_time DESC',
        limit: 100,
      });

      const filtered = (res?.data ?? [])
        .filter(d => d.update_time?.slice(0, 10) >= cutoffStr)
        .slice(0, limit)
        .map(formatDeal);

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
