/**
 * tools/reports.js — Reports & Dashboards
 * ─────────────────────────────────────────────
 * Tools:
 *   generate_pipeline_report  - full pipeline snapshot sent to Teams
 *   generate_activity_report  - team activity completion rates
 *   generate_weekly_digest    - all-in-one weekly summary to Teams
 *   get_deals_closing_soon    - deals with close dates in the next N days
 */

import { dealsApi, activitiesApi, fetchAll, formatDeal, formatActivity } from '../pipedrive.js';
import { notifyPipelineReport, notifyCustom } from '../teams.js';
import { z } from 'zod';

export const reportTools = [

  // ── generate_pipeline_report ─────────────────────────────────────────────────
  {
    name: 'generate_pipeline_report',
    description: 'Generate a full pipeline snapshot and optionally send it to Teams. ' +
                 'Great for end-of-week or Monday morning reports.',
    schema: z.object({
      send_to_teams:    z.boolean().default(true).describe('Also post the report to Microsoft Teams'),
      stale_after_days: z.number().int().default(14),
    }),
    async handler({ send_to_teams, stale_after_days }) {
      const allDeals = await fetchAll(({ start, limit }) =>
        dealsApi.getDeals({ status: 'open', start, limit })
      );

      const totalValue = allDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const avgValue   = allDeals.length > 0 ? Math.round(totalValue / allDeals.length) : 0;
      const currency   = allDeals[0]?.currency ?? '';

      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - stale_after_days);
      const staleStr = staleThreshold.toISOString().slice(0, 10);
      const staleCount = allDeals.filter(d => !d.last_activity_date || d.last_activity_date < staleStr).length;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const overdueRes = await activitiesApi.getActivities({
        done: 0, start: 0, limit: 100,
        end_date: yesterday.toISOString().slice(0, 10),
      });
      const overdueCount = overdueRes?.data?.length ?? 0;

      // Won/Lost this month
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStr = monthStart.toISOString().slice(0, 10);

      const [wonRes, lostRes] = await Promise.all([
        dealsApi.getDeals({ status: 'won',  limit: 100 }),
        dealsApi.getDeals({ status: 'lost', limit: 100 }),
      ]);
      const wonMonth  = (wonRes?.data  ?? []).filter(d => (d.won_time  ?? '') >= monthStr).length;
      const lostMonth = (lostRes?.data ?? []).filter(d => (d.lost_time ?? '') >= monthStr).length;

      const summary = {
        open_deals:         allDeals.length,
        total_value:        `${currency} ${totalValue.toLocaleString()}`,
        avg_deal_size:      `${currency} ${avgValue.toLocaleString()}`,
        won_this_month:     wonMonth,
        lost_this_month:    lostMonth,
        overdue_activities: overdueCount,
        stale_deals:        staleCount,
      };

      const reportText =
        `📊 **Pipeline Report — ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}**\n\n` +
        `• Open deals:            ${allDeals.length}\n` +
        `• Total pipeline value:  ${currency} ${totalValue.toLocaleString()}\n` +
        `• Average deal size:     ${currency} ${avgValue.toLocaleString()}\n` +
        `• Won this month:        ${wonMonth}\n` +
        `• Lost this month:       ${lostMonth}\n` +
        `• Stale deals:           ${staleCount}\n` +
        `• Overdue activities:    ${overdueCount}`;

      let teamsResult = { sent: false, reason: 'send_to_teams=false' };
      if (send_to_teams) {
        teamsResult = await notifyPipelineReport(summary);
      }

      return {
        content: [{
          type: 'text',
          text: reportText +
            `\n\nTeams notification: ${teamsResult.sent ? 'sent ✅' : 'skipped (' + teamsResult.reason + ')'}`,
        }],
      };
    },
  },

  // ── generate_activity_report ─────────────────────────────────────────────────
  {
    name: 'generate_activity_report',
    description: 'Show how many activities were completed vs overdue over the last N days.',
    schema: z.object({
      days: z.number().int().min(1).max(30).default(7),
    }),
    async handler({ days }) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const [doneRes, overdueRes] = await Promise.all([
        activitiesApi.getActivities({ done: 1, start: 0, limit: 100, start_date: cutoffStr }),
        activitiesApi.getActivities({ done: 0, start: 0, limit: 100, end_date: cutoffStr }),
      ]);

      const done    = doneRes?.data ?? [];
      const overdue = overdueRes?.data ?? [];

      // Group completed by type
      const byType = {};
      for (const a of done) {
        byType[a.type ?? 'other'] = (byType[a.type ?? 'other'] ?? 0) + 1;
      }
      const typeBreakdown = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  • ${type}: ${count}`)
        .join('\n');

      return {
        content: [{
          type: 'text',
          text:
            `📋 **Activity Report (last ${days} days)**\n\n` +
            `• Completed activities: ${done.length}\n` +
            `• Still overdue:        ${overdue.length}\n` +
            `• Completion rate:      ${done.length + overdue.length > 0
              ? ((done.length / (done.length + overdue.length)) * 100).toFixed(0) + '%'
              : 'n/a'}\n\n` +
            (typeBreakdown ? `**Completed by type:**\n${typeBreakdown}` : ''),
        }],
      };
    },
  },

  // ── generate_weekly_digest ───────────────────────────────────────────────────
  {
    name: 'generate_weekly_digest',
    description: 'Generate and send a comprehensive weekly digest to Teams: new leads, ' +
                 'upcoming tasks, pipeline health, and win/loss stats all in one message.',
    schema: z.object({}),
    async handler() {
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const weekAgo   = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);

      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().slice(0, 10);

      const [newDealsRes, upcomingRes, overdueRes, wonRes, openDealsData] = await Promise.all([
        dealsApi.getDeals({ status: 'open', sort: 'add_time DESC', limit: 50 }),
        activitiesApi.getActivities({ done: 0, start: 0, limit: 50, start_date: new Date().toISOString().slice(0,10), end_date: nextWeekStr }),
        activitiesApi.getActivities({ done: 0, start: 0, limit: 50, end_date: weekAgoStr }),
        dealsApi.getDeals({ status: 'won', limit: 50 }),
        fetchAll(({ start, limit }) => dealsApi.getDeals({ status: 'open', start, limit })),
      ]);

      const newDeals  = (newDealsRes?.data ?? []).filter(d => d.add_time?.slice(0,10) >= weekAgoStr);
      const upcoming  = upcomingRes?.data ?? [];
      const overdue   = overdueRes?.data ?? [];
      const wonWeek   = (wonRes?.data ?? []).filter(d => (d.won_time ?? '') >= weekAgoStr);
      const openDeals = openDealsData;

      const totalValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const currency   = openDeals[0]?.currency ?? '';

      const body =
        `**New leads this week:** ${newDeals.length}\n` +
        `**Deals won this week:** ${wonWeek.length}\n` +
        `**Open pipeline:** ${openDeals.length} deals | ${currency} ${totalValue.toLocaleString()}\n` +
        `**Upcoming tasks (next 7 days):** ${upcoming.length}\n` +
        `**Overdue tasks:** ${overdue.length}\n\n` +
        `[View full pipeline →](https://app.pipedrive.com/deals)`;

      const teamsResult = await notifyCustom(`📅 Weekly Digest — ${today}`, body, 'Accent');

      return {
        content: [{
          type: 'text',
          text:
            `Weekly digest generated for ${today}:\n\n` +
            `• New leads:   ${newDeals.length}\n` +
            `• Won deals:   ${wonWeek.length}\n` +
            `• Open deals:  ${openDeals.length} (${currency} ${totalValue.toLocaleString()})\n` +
            `• Upcoming:    ${upcoming.length} tasks\n` +
            `• Overdue:     ${overdue.length} tasks\n\n` +
            `Teams notification: ${teamsResult.sent ? 'sent ✅' : 'skipped (' + teamsResult.reason + ')'}`,
        }],
      };
    },
  },

  // ── get_deals_closing_soon ───────────────────────────────────────────────────
  {
    name: 'get_deals_closing_soon',
    description: 'List open deals whose expected close date falls within the next N days. ' +
                 'Useful for spotting deals that need attention before they lapse.',
    schema: z.object({
      days:  z.number().int().min(1).max(60).default(14),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    async handler({ days, limit }) {
      const today   = new Date().toISOString().slice(0, 10);
      const future  = new Date(); future.setDate(future.getDate() + days);
      const futureStr = future.toISOString().slice(0, 10);

      const allOpen = await fetchAll(({ start, limit: l }) =>
        dealsApi.getDeals({ status: 'open', start, limit: l })
      );

      const closing = allOpen
        .filter(d => {
          const date = d.expected_close_date ?? d.close_time;
          return date && date >= today && date <= futureStr;
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
