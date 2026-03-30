/**
 * tools/analysis.js — Pipeline & Sales Analysis
 * ─────────────────────────────────────────────
 * Tools:
 *   analyze_pipeline      - full pipeline health summary (open deals, value, stale, etc.)
 *   get_win_loss_stats    - win rate, average deal size, loss reasons
 *   get_stage_conversion  - how many deals move between each stage (funnel analysis)
 *   get_team_performance  - deals owned and activities per user
 */

import { dealsApi, activitiesApi, stagesApi, pipelinesApi, usersApi, fetchAll, formatDeal } from '../pipedrive.js';
import { z } from 'zod';

export const analysisTools = [

  // ── analyze_pipeline ─────────────────────────────────────────────────────────
  {
    name: 'analyze_pipeline',
    description: 'Get a full health summary of your open pipeline: total value, deal count, ' +
                 'average size, stale deals (no activity in X days), and overdue tasks.',
    schema: z.object({
      pipeline_id:       z.number().int().optional().describe('Filter to a specific pipeline (omit for all)'),
      stale_after_days:  z.number().int().min(1).max(180).default(14)
        .describe('A deal is considered stale if it had no activity in this many days'),
    }),
    async handler({ pipeline_id, stale_after_days }) {
      // Fetch all open deals
      const allDeals = await fetchAll(({ start, limit }) =>
        dealsApi.getDeals({ status: 'open', start, limit, ...(pipeline_id && { pipeline_id }) })
      );

      if (allDeals.length === 0) {
        return { content: [{ type: 'text', text: 'No open deals found.' }] };
      }

      const totalValue = allDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
      const avgValue   = totalValue / allDeals.length;
      const currency   = allDeals[0]?.currency ?? '';

      // Stale deals: last_activity_date is older than stale_after_days ago (or null)
      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - stale_after_days);
      const staleStr = staleThreshold.toISOString().slice(0, 10);

      const staleDeals = allDeals.filter(d => {
        const lastActivity = d.last_activity_date;
        return !lastActivity || lastActivity < staleStr;
      });

      // Deals with no close date set
      const noCloseDate = allDeals.filter(d => !d.expected_close_date && !d.close_time);

      // Group by stage
      const byStage = {};
      for (const d of allDeals) {
        const stage = d.stage_name ?? d.stage_id ?? 'Unknown';
        byStage[stage] = (byStage[stage] ?? 0) + 1;
      }

      const stageBreakdown = Object.entries(byStage)
        .sort((a, b) => b[1] - a[1])
        .map(([stage, count]) => `  ${stage}: ${count} deal(s)`)
        .join('\n');

      // Overdue activities
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const overdueRes = await activitiesApi.getActivities({
        done: 0, start: 0, limit: 100,
        end_date: yesterday.toISOString().slice(0, 10),
      });
      const overdueCount = overdueRes?.data?.length ?? 0;

      const summary = {
        open_deals:         allDeals.length,
        total_value:        `${currency} ${totalValue.toLocaleString()}`,
        avg_deal_size:      `${currency} ${Math.round(avgValue).toLocaleString()}`,
        won_this_month:     null,
        lost_this_month:    null,
        overdue_activities: overdueCount,
        stale_deals:        staleDeals.length,
      };

      return {
        content: [{
          type: 'text',
          text:
            `📊 **Pipeline Analysis**\n\n` +
            `• Open deals:         ${allDeals.length}\n` +
            `• Total value:        ${currency} ${totalValue.toLocaleString()}\n` +
            `• Average deal size:  ${currency} ${Math.round(avgValue).toLocaleString()}\n` +
            `• Stale deals (>${stale_after_days}d no activity): ${staleDeals.length}\n` +
            `• Deals with no close date: ${noCloseDate.length}\n` +
            `• Overdue activities: ${overdueCount}\n\n` +
            `**By Stage:**\n${stageBreakdown}\n\n` +
            (staleDeals.length > 0
              ? `**Top stale deals:**\n` + staleDeals.slice(0, 5).map(d =>
                  `  • ${d.title} (last activity: ${d.last_activity_date ?? 'never'})`
                ).join('\n')
              : ''),
        }],
        _summary: summary,
      };
    },
  },

  // ── get_win_loss_stats ───────────────────────────────────────────────────────
  {
    name: 'get_win_loss_stats',
    description: 'Calculate win rate, average deal value, and top loss reasons for a given period.',
    schema: z.object({
      months: z.number().int().min(1).max(24).default(3)
        .describe('How many months back to include in the analysis'),
    }),
    async handler({ months }) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const [wonRes, lostRes] = await Promise.all([
        dealsApi.getDeals({ status: 'won',  limit: 100 }),
        dealsApi.getDeals({ status: 'lost', limit: 100 }),
      ]);

      const won  = (wonRes?.data  ?? []).filter(d => (d.won_time  ?? d.close_time ?? '') >= cutoffStr);
      const lost = (lostRes?.data ?? []).filter(d => (d.lost_time ?? d.close_time ?? '') >= cutoffStr);

      const total    = won.length + lost.length;
      const winRate  = total > 0 ? ((won.length / total) * 100).toFixed(1) : 'n/a';
      const currency = won[0]?.currency ?? lost[0]?.currency ?? '';

      const wonValue  = won.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const avgWon    = won.length > 0 ? Math.round(wonValue / won.length) : 0;

      // Loss reasons breakdown
      const lossReasons = {};
      for (const d of lost) {
        const r = d.lost_reason ?? 'Unspecified';
        lossReasons[r] = (lossReasons[r] ?? 0) + 1;
      }
      const lossBreakdown = Object.entries(lossReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `  • ${reason}: ${count}`)
        .join('\n');

      return {
        content: [{
          type: 'text',
          text:
            `📈 **Win/Loss Analysis (last ${months} month(s))**\n\n` +
            `• Won deals:       ${won.length}\n` +
            `• Lost deals:      ${lost.length}\n` +
            `• Win rate:        ${winRate}%\n` +
            `• Total won value: ${currency} ${wonValue.toLocaleString()}\n` +
            `• Avg won deal:    ${currency} ${avgWon.toLocaleString()}\n\n` +
            (lost.length > 0 ? `**Loss reasons:**\n${lossBreakdown}` : ''),
        }],
      };
    },
  },

  // ── get_stage_conversion ─────────────────────────────────────────────────────
  {
    name: 'get_stage_conversion',
    description: 'Show a funnel breakdown: how many deals are in each stage and what ' +
                 'percentage are in the top half vs bottom half of the pipeline.',
    schema: z.object({
      pipeline_id: z.number().int().optional().describe('Pipeline ID (omit for first/default pipeline)'),
    }),
    async handler({ pipeline_id }) {
      // Get pipeline
      let pid = pipeline_id;
      if (!pid) {
        const res = await pipelinesApi.getPipelines();
        pid = res?.data?.[0]?.id;
      }
      if (!pid) throw new Error('No pipeline found.');

      const [stagesRes, dealsRes] = await Promise.all([
        stagesApi.getStages({ pipeline_id: pid }),
        fetchAll(({ start, limit }) => dealsApi.getDeals({ status: 'open', pipeline_id: pid, start, limit })),
      ]);

      const stages = stagesRes?.data ?? [];
      const deals  = dealsRes;

      if (stages.length === 0) return { content: [{ type: 'text', text: 'No stages found.' }] };

      const lines = stages.map(s => {
        const count = deals.filter(d => d.stage_id === s.id).length;
        const bar   = '█'.repeat(Math.min(count, 30));
        const pct   = deals.length > 0 ? ((count / deals.length) * 100).toFixed(0) : 0;
        return `  Stage ${s.order_nr}: ${s.name.padEnd(25)} ${bar} ${count} (${pct}%)`;
      });

      return {
        content: [{
          type: 'text',
          text:
            `🔽 **Funnel Breakdown** (${deals.length} open deals)\n\n` +
            lines.join('\n'),
        }],
      };
    },
  },

  // ── get_team_performance ────────────────────────────────────────────────────
  {
    name: 'get_team_performance',
    description: 'Show a per-person breakdown of open deals, total pipeline value, and activity count.',
    schema: z.object({}),
    async handler() {
      const [usersRes, dealsData, activitiesData] = await Promise.all([
        usersApi.getUsers(),
        fetchAll(({ start, limit }) => dealsApi.getDeals({ status: 'open', start, limit })),
        activitiesApi.getActivities({ done: 0, start: 0, limit: 100 }),
      ]);

      const users      = (usersRes?.data ?? []).filter(u => u.active_flag);
      const allDeals   = dealsData;
      const activities = activitiesData?.data ?? [];

      const rows = users.map(u => {
        const userDeals = allDeals.filter(d => d.user_id?.id === u.id || d.user_id === u.id);
        const userActs  = activities.filter(a => a.assigned_to_user_id === u.id || a.user_id === u.id);
        const value     = userDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const currency  = userDeals[0]?.currency ?? '';
        return `• **${u.name}** — ${userDeals.length} deal(s) | ${currency} ${value.toLocaleString()} | ${userActs.length} open task(s)`;
      });

      return {
        content: [{
          type: 'text',
          text: `👥 **Team Performance (Open Pipeline)**\n\n` + rows.join('\n'),
        }],
      };
    },
  },
];
