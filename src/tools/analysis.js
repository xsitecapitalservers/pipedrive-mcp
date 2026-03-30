/**
 * tools/analysis.js — Pipeline & Sales Analysis
 */

import { deals, activities, stages, pipelines, users, fetchAll, formatDeal } from '../pipedrive.js';
import { z } from 'zod';

export const analysisTools = [

  {
    name: 'analyze_pipeline',
    description: 'Full pipeline health summary: total value, deal count, stale deals, overdue tasks.',
    schema: z.object({
      pipeline_id:      z.number().int().optional(),
      stale_after_days: z.number().int().min(1).max(180).default(14),
    }),
    async handler({ pipeline_id, stale_after_days }) {
      const allDeals = await fetchAll((cursor) =>
        deals.getAll({ status: 'open', pipeline_id, limit: 100, cursor })
      );

      if (allDeals.length === 0) {
        return { content: [{ type: 'text', text: 'No open deals found.' }] };
      }

      const totalValue = allDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const avgValue   = Math.round(totalValue / allDeals.length);
      const currency   = allDeals[0]?.currency ?? '';

      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - stale_after_days);
      const staleStr    = staleThreshold.toISOString().slice(0, 10);
      const staleDeals  = allDeals.filter(d => !d.last_activity_date || d.last_activity_date < staleStr);
      const noCloseDate = allDeals.filter(d => !d.expected_close_date);

      const byStage = {};
      for (const d of allDeals) {
        const s = d.stage_name ?? `Stage ${d.stage_id}` ?? 'Unknown';
        byStage[s] = (byStage[s] ?? 0) + 1;
      }
      const stageBreakdown = Object.entries(byStage)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `  ${s}: ${n}`)
        .join('\n');

      const today = new Date();
      today.setDate(today.getDate() - 1);
      const overdueRes = await activities.getAll({ done: 0, limit: 100 });
      const todayStr   = new Date().toISOString().slice(0, 10);
      const overdueCount = (overdueRes?.data?.data ?? overdueRes?.data ?? [])
        .filter(a => a.due_date && a.due_date < todayStr).length;

      return {
        content: [{
          type: 'text',
          text:
            `📊 **Pipeline Analysis**\n\n` +
            `• Open deals:         ${allDeals.length}\n` +
            `• Total value:        ${currency} ${totalValue.toLocaleString()}\n` +
            `• Average deal size:  ${currency} ${avgValue.toLocaleString()}\n` +
            `• Stale (>${stale_after_days}d no activity): ${staleDeals.length}\n` +
            `• No close date set:  ${noCloseDate.length}\n` +
            `• Overdue activities: ${overdueCount}\n\n` +
            `**By Stage:**\n${stageBreakdown}` +
            (staleDeals.length > 0
              ? `\n\n**Top stale deals:**\n` +
                staleDeals.slice(0, 5).map(d =>
                  `  • ${d.title} (last activity: ${d.last_activity_date ?? 'never'})`
                ).join('\n')
              : ''),
        }],
      };
    },
  },

  {
    name: 'get_win_loss_stats',
    description: 'Win rate, average deal value, and top loss reasons for a given period.',
    schema: z.object({
      months: z.number().int().min(1).max(24).default(3),
    }),
    async handler({ months }) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().replace('T', ' ').slice(0, 19);

      const [wonRes, lostRes] = await Promise.all([
        deals.getAll({ status: 'won',  updated_since: cutoffStr, limit: 100 }),
        deals.getAll({ status: 'lost', updated_since: cutoffStr, limit: 100 }),
      ]);

      const won  = wonRes?.data?.data  ?? wonRes?.data  ?? [];
      const lost = lostRes?.data?.data ?? lostRes?.data ?? [];

      const total   = won.length + lost.length;
      const winRate = total > 0 ? ((won.length / total) * 100).toFixed(1) : 'n/a';
      const currency = won[0]?.currency ?? lost[0]?.currency ?? '';
      const wonValue  = won.reduce((s, d) => s + (Number(d.value) || 0), 0);
      const avgWon    = won.length > 0 ? Math.round(wonValue / won.length) : 0;

      const lossReasons = {};
      for (const d of lost) {
        const r = d.lost_reason ?? 'Unspecified';
        lossReasons[r] = (lossReasons[r] ?? 0) + 1;
      }
      const lossBreakdown = Object.entries(lossReasons)
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `  • ${r}: ${n}`)
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

  {
    name: 'get_stage_conversion',
    description: 'Funnel breakdown: how many deals are in each stage.',
    schema: z.object({
      pipeline_id: z.number().int().optional(),
    }),
    async handler({ pipeline_id }) {
      let pid = pipeline_id;
      if (!pid) {
        const res = await pipelines.getAll();
        pid = (res?.data?.data ?? res?.data ?? [])[0]?.id;
      }
      if (!pid) throw new Error('No pipeline found.');

      const [stagesRes, allDeals] = await Promise.all([
        stages.getAll(pid),
        fetchAll((cursor) => deals.getAll({ status: 'open', pipeline_id: pid, limit: 100, cursor })),
      ]);

      const stageList = stagesRes?.data?.data ?? stagesRes?.data ?? [];
      if (stageList.length === 0) return { content: [{ type: 'text', text: 'No stages found.' }] };

      const lines = stageList.map(s => {
        const count = allDeals.filter(d => d.stage_id === s.id).length;
        const bar   = '█'.repeat(Math.min(count, 30));
        const pct   = allDeals.length > 0 ? ((count / allDeals.length) * 100).toFixed(0) : 0;
        return `  ${String(s.order_nr ?? '').padEnd(2)} ${s.name.padEnd(25)} ${bar} ${count} (${pct}%)`;
      });

      return {
        content: [{
          type: 'text',
          text: `🔽 **Funnel Breakdown** (${allDeals.length} open deals)\n\n` + lines.join('\n'),
        }],
      };
    },
  },

  {
    name: 'get_team_performance',
    description: 'Per-person breakdown of open deals, total pipeline value, and open activity count.',
    schema: z.object({}),
    async handler() {
      const [usersRes, allDeals, actsRes] = await Promise.all([
        users.getAll(),
        fetchAll((cursor) => deals.getAll({ status: 'open', limit: 100, cursor })),
        activities.getAll({ done: 0, limit: 100 }),
      ]);

      const allUsers = (usersRes?.data?.data ?? usersRes?.data ?? []).filter(u => u.active_flag);
      const acts     = actsRes?.data?.data ?? actsRes?.data ?? [];

      const rows = allUsers.map(u => {
        const userDeals = allDeals.filter(d => d.owner_id === u.id || d.user_id?.id === u.id);
        const userActs  = acts.filter(a => a.user_id === u.id || a.assigned_to_user_id === u.id);
        const value     = userDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const currency  = userDeals[0]?.currency ?? '';
        return `• **${u.name}** — ${userDeals.length} deal(s) | ${currency} ${value.toLocaleString()} | ${userActs.length} open task(s)`;
      });

      return {
        content: [{
          type: 'text',
          text: `👥 **Team Performance (Open Pipeline)**\n\n` + (rows.length ? rows.join('\n') : 'No data found.'),
        }],
      };
    },
  },
];
