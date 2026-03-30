import { deals, activities, fetchAll, getData, formatDeal } from '../pipedrive.js';
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
      const allDeals = await fetchAll((opts) => deals.getAll({ ...opts, status: 'open' }));
      const totalValue = allDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const avgValue   = allDeals.length > 0 ? Math.round(totalValue / allDeals.length) : 0;
      const currency   = allDeals[0]?.currency ?? '';

      const staleDate = new Date(); staleDate.setDate(staleDate.getDate() - stale_after_days);
      const staleStr  = staleDate.toISOString().slice(0, 10);
      const staleCount = allDeals.filter(d => !d.last_activity_date || d.last_activity_date < staleStr).length;

      const today    = new Date().toISOString().slice(0, 10);
      const actsRes  = await activities.getAll({ done: 0, limit: 100 });
      const overdueCount = getData(actsRes).filter(a => a.due_date && a.due_date < today).length;

      const monthStart = new Date(); monthStart.setDate(1);
      const monthStr   = monthStart.toISOString().slice(0, 10);

      const [wonRes, lostRes] = await Promise.all([
        deals.getAll({ status: 'won',  limit: 100, sort: 'update_time DESC' }),
        deals.getAll({ status: 'lost', limit: 100, sort: 'update_time DESC' }),
      ]);
      const wonMonth  = getData(wonRes).filter(d  => (d.won_time  ?? d.update_time ?? '') >= monthStr).length;
      const lostMonth = getData(lostRes).filter(d => (d.lost_time ?? d.update_time ?? '') >= monthStr).length;

      const summary = {
        open_deals: allDeals.length,
        total_value: `${currency} ${totalValue.toLocaleString()}`,
        avg_deal_size: `${currency} ${avgValue.toLocaleString()}`,
        won_this_month: wonMonth,
        lost_this_month: lostMonth,
        overdue_activities: overdueCount,
        stale_deals: staleCount,
      };

      const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const reportText =
        `📊 **Pipeline Report — ${dateLabel}**\n\n` +
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
      const today    = new Date().toISOString().slice(0, 10);
      const [doneRes, openRes] = await Promise.all([
        activities.getAll({ done: 1, limit: 100 }),
        activities.getAll({ done: 0, limit: 100 }),
      ]);

      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const done    = getData(doneRes).filter(a => (a.update_time ?? '') >= cutoffStr);
      const overdue = getData(openRes).filter(a => a.due_date && a.due_date < today);

      const byType = {};
      for (const a of done) { byType[a.type ?? 'other'] = (byType[a.type ?? 'other'] ?? 0) + 1; }
      const typeBreakdown = Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`  • ${t}: ${n}`).join('\n');
      const total = done.length + overdue.length;

      return {
        content: [{
          type: 'text',
          text:
            `📋 **Activity Report (last ${days} days)**\n\n` +
            `• Completed:       ${done.length}\n` +
            `• Still overdue:   ${overdue.length}\n` +
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
      const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const today     = new Date().toISOString().slice(0, 10);
      const weekAgo   = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);
      const nextWeek  = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().slice(0, 10);

      const [openDeals, wonRes, actsRes, newDealsRes] = await Promise.all([
        fetchAll((opts) => deals.getAll({ ...opts, status: 'open' })),
        deals.getAll({ status: 'won',  limit: 50, sort: 'update_time DESC' }),
        activities.getAll({ done: 0, limit: 100 }),
        deals.getAll({ status: 'open', limit: 50, sort: 'add_time DESC' }),
      ]);

      const newDeals  = getData(newDealsRes).filter(d => d.add_time?.slice(0,10) >= weekAgoStr);
      const wonWeek   = getData(wonRes).filter(d  => (d.won_time ?? d.update_time ?? '') >= weekAgoStr);
      const allActs   = getData(actsRes);
      const upcoming  = allActs.filter(a => a.due_date && a.due_date >= today && a.due_date <= nextWeekStr);
      const overdue   = allActs.filter(a => a.due_date && a.due_date < today);
      const totalValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const currency   = openDeals[0]?.currency ?? '';

      const body =
        `**New leads this week:** ${newDeals.length}\n` +
        `**Deals won this week:** ${wonWeek.length}\n` +
        `**Open pipeline:** ${openDeals.length} deals | ${currency} ${totalValue.toLocaleString()}\n` +
        `**Upcoming tasks (next 7 days):** ${upcoming.length}\n` +
        `**Overdue tasks:** ${overdue.length}\n\n` +
        `[View full pipeline →](https://app.pipedrive.com/deals)`;

      const teamsResult = await notifyCustom(`📅 Weekly Digest — ${dateLabel}`, body, 'Accent');
      return {
        content: [{
          type: 'text',
          text:
            `Weekly digest for ${dateLabel}:\n\n` +
            `• New leads: ${newDeals.length} | Won: ${wonWeek.length} | Open: ${openDeals.length} (${currency} ${totalValue.toLocaleString()})\n` +
            `• Upcoming: ${upcoming.length} tasks | Overdue: ${overdue.length} tasks\n\n` +
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

      const allOpen = await fetchAll((opts) => deals.getAll({ ...opts, status: 'open' }));
      const closing = allOpen
        .filter(d => {
          const date = d.expected_close_date ?? d.close_time;
          return date && date >= today && date.slice(0, 10) <= futureStr;
        })
        .sort((a, b) => (a.expected_close_date ?? '').localeCompare(b.expected_close_date ?? ''))
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
            closing.map(d => `• **${d.title}** | ${d.value} | Close: ${d.close_date} | Owner: ${d.owner}\n  ${d.url}`).join('\n'),
        }],
      };
    },
  },
];
