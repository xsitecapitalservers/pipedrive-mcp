/**
 * tools/reports.js — Reports & Dashboards
 */

import { deals, activities, fetchAll, formatDeal } from '../pipedrive.js';
import { notifyPipelineReport, notifyCustom } from '../teams.js';
import { z } from 'zod';

export const reportTools = [

  {
    name: 'generate_pipeline_report',
    description: 'Generate a full pipeline snapshot and optionally send it to Teams.',
    schema: z.object({
      send_to_teams:    z.boolean().default(true),
      stale_after_days: z.number().int().default(14),
    }),
    async handler({ send_to_teams, stale_after_days }) {
      const allDeals = await fetchAll((cursor) =>
        deals.getAll({ status: 'open', limit: 100, cursor })
      );

      const totalValue = allDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const avgValue   = allDeals.length > 0 ? Math.round(totalValue / allDeals.length) : 0;
      const currency   = allDeals[0]?.currency ?? '';

      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - stale_after_days);
      const staleStr   = staleThreshold.toISOString().slice(0, 10);
      const staleCount = allDeals.filter(d => !d.last_activity_date || d.last_activity_date < staleStr).length;

      const todayStr = new Date().toISOString().slice(0, 10);
      const actsRes  = await activities.getAll({ done: 0, limit: 100 });
      const overdueCount = (actsRes?.data?.data ?? actsRes?.data ?? [])
        .filter(a => a.due_date && a.due_date < todayStr).length;

      const monthStart = new Date(); monthStart.setDate(1);
      const monthStr   = monthStart.toISOString().replace('T', ' ').slice(0, 19);

      const [wonRes, lostRes] = await Promise.all([
        deals.getAll({ status: 'won',  updated_since: monthStr, limit: 100 }),
        deals.getAll({ status: 'lost', updated_since: monthStr, limit: 100 }),
      ]);
      const wonMonth  = (wonRes?.data?.data  ?? wonRes?.data  ?? []).length;
      const lostMonth = (lostRes?.data?.data ?? lostRes?.data ?? []).length;

      const summary = {
        open_deals:         allDeals.length,
        total_value:        `${currency} ${totalValue.toLocaleString()}`,
        avg_deal_size:      `${currency} ${avgValue.toLocaleString()}`,
        won_this_month:     wonMonth,
        lost_this_month:    lostMonth,
        overdue_activities: overdueCount,
        stale_deals:        staleCount,
      };

      const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const reportText =
        `📊 **Pipeline Report — ${dateStr}**\n\n` +
        `• Open deals:            ${allDeals.length}\n` +
        `• Total pipeline value:  ${currency} ${totalValue.toLocaleString()}\n` +
        `• Average deal size:     ${currency} ${avgValue.toLocaleString()}\n` +
        `• Won this month:        ${wonMonth}\n` +
        `• Lost this month:       ${lostMonth}\n` +
        `• Stale deals:           ${staleCount}\n` +
        `• Overdue activities:    ${overdueCount}`;

      let teamsResult = { sent: false, reason: 'send_to_teams=false' };
      if (send_to_teams) teamsResult = await notifyPipelineReport(summary);

      return {
        content: [{
          type: 'text',
          text: reportText + `\n\nTeams: ${teamsResult.sent ? 'sent ✅' : 'skipped (' + teamsResult.reason + ')'}`,
        }],
      };
    },
  },

  {
    name: 'generate_activity_report',
    description: 'Show how many activities were completed vs overdue over the last N days.',
    schema: z.object({
      days: z.number().int().min(1).max(30).default(7),
    }),
    async handler({ days }) {
      const cutoff    = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().replace('T', ' ').slice(0, 19);
      const todayStr  = new Date().toISOString().slice(0, 10);

      const [doneRes, openRes] = await Promise.all([
        activities.getAll({ done: 1, updated_since: cutoffStr, limit: 100 }),
        activities.getAll({ done: 0, limit: 100 }),
      ]);

      const done    = doneRes?.data?.data ?? doneRes?.data ?? [];
      const overdue = (openRes?.data?.data ?? openRes?.data ?? [])
        .filter(a => a.due_date && a.due_date < todayStr);

      const byType = {};
      for (const a of done) { byType[a.type ?? 'other'] = (byType[a.type ?? 'other'] ?? 0) + 1; }
      const typeBreakdown = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `  • ${t}: ${n}`)
        .join('\n');

      const total = done.length + overdue.length;

      return {
        content: [{
          type: 'text',
          text:
            `📋 **Activity Report (last ${days} days)**\n\n` +
            `• Completed:      ${done.length}\n` +
            `• Still overdue:  ${overdue.length}\n` +
            `• Completion rate: ${total > 0 ? ((done.length / total) * 100).toFixed(0) + '%' : 'n/a'}\n\n` +
            (typeBreakdown ? `**Completed by type:**\n${typeBreakdown}` : ''),
        }],
      };
    },
  },

  {
    name: 'generate_weekly_digest',
    description: 'Comprehensive weekly digest sent to Teams: new leads, tasks, pipeline health, and wins.',
    schema: z.object({}),
    async handler() {
      const dateStr  = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoISO = weekAgo.toISOString().replace('T', ' ').slice(0, 19);
      const weekAgoDate = weekAgo.toISOString().slice(0, 10);
      const today    = new Date().toISOString().slice(0, 10);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekDate = nextWeek.toISOString().slice(0, 10);

      const [newDealsRes, wonRes, openDeals, actsRes] = await Promise.all([
        deals.getAll({ status: 'open', updated_since: weekAgoISO, sort_by: 'id', sort_direction: 'desc', limit: 50 }),
        deals.getAll({ status: 'won',  updated_since: weekAgoISO, limit: 50 }),
        fetchAll((cursor) => deals.getAll({ status: 'open', limit: 100, cursor })),
        activities.getAll({ done: 0, limit: 100 }),
      ]);

      const newDeals = (newDealsRes?.data?.data ?? newDealsRes?.data ?? [])
        .filter(d => d.add_time?.slice(0, 10) >= weekAgoDate);
      const wonWeek  = wonRes?.data?.data ?? wonRes?.data ?? [];
      const allActs  = actsRes?.data?.data ?? actsRes?.data ?? [];
      const upcoming = allActs.filter(a => a.due_date && a.due_date >= today && a.due_date <= nextWeekDate);
      const overdue  = allActs.filter(a => a.due_date && a.due_date < today);

      const totalValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const currency   = openDeals[0]?.currency ?? '';

      const body =
        `**New leads this week:** ${newDeals.length}\n` +
        `**Deals won this week:** ${wonWeek.length}\n` +
        `**Open pipeline:** ${openDeals.length} deals | ${currency} ${totalValue.toLocaleString()}\n` +
        `**Upcoming tasks (next 7 days):** ${upcoming.length}\n` +
        `**Overdue tasks:** ${overdue.length}\n\n` +
        `[View full pipeline →](https://app.pipedrive.com/deals)`;

      const teamsResult = await notifyCustom(`📅 Weekly Digest — ${dateStr}`, body, 'Accent');

      return {
        content: [{
          type: 'text',
          text:
            `Weekly digest for ${dateStr}:\n\n` +
            `• New leads:   ${newDeals.length}\n` +
            `• Won deals:   ${wonWeek.length}\n` +
            `• Open deals:  ${openDeals.length} (${currency} ${totalValue.toLocaleString()})\n` +
            `• Upcoming:    ${upcoming.length} tasks\n` +
            `• Overdue:     ${overdue.length} tasks\n\n` +
            `Teams: ${teamsResult.sent ? 'sent ✅' : 'skipped (' + teamsResult.reason + ')'}`,
        }],
      };
    },
  },

  {
    name: 'get_deals_closing_soon',
    description: 'List open deals whose expected close date falls within the next N days.',
    schema: z.object({
      days:  z.number().int().min(1).max(60).default(14),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    async handler({ days, limit }) {
      const today   = new Date().toISOString().slice(0, 10);
      const future  = new Date(); future.setDate(future.getDate() + days);
      const futureStr = future.toISOString().slice(0, 10);

      const allOpen = await fetchAll((cursor) =>
        deals.getAll({ status: 'open', limit: 100, cursor })
      );

      const closing = allOpen
        .filter(d => {
          const date = d.expected_close_date ?? d.close_time;
          return date && date >= today && date.slice(0, 10) <= futureStr;
        })
        .sort((a, b) => {
          const da = a.expected_close_date ?? a.close_time ?? '';
          const db = b.expected_close_date ?? b.close_time ?? '';
          return da.localeCompare(db);
        })
        .slice(0, limit)
        .map(formatDeal);

      if (closing.length === 0) {
        return { content: [{ type: 'text', text: `No deals expected to close in the next ${days} days.` }] };
      }

      return {
        content: [{
          type: 'text',
          text:
            `🗓 **${closing.length} deal(s) closing in the next ${days} days:**\n\n` +
            closing.map(d =>
              `• **${d.title}** | ${d.value} | Close: ${d.close_date} | Owner: ${d.owner}\n  ${d.url}`
            ).join('\n'),
        }],
      };
    },
  },
];
