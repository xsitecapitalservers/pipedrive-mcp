/**
 * tools/activities.js — Task & Activity Management
 */

import { activities, formatActivity } from '../pipedrive.js';
import { notifyUpcomingTasks, notifyOverdueTasks } from '../teams.js';
import { z } from 'zod';

function todayStr()         { return new Date().toISOString().slice(0, 10); }
function dateStr(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().replace('T', ' ').slice(0, 19); // YYYY-MM-DD HH:MM:SS
}

export const activityTools = [

  {
    name: 'get_upcoming_activities',
    description: 'List all open activities due within the next N days.',
    schema: z.object({
      days:  z.number().int().min(1).max(30).default(3),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async handler({ days, limit }) {
      const now    = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const future = dateStr(days);

      const res   = await activities.getAll({ done: 0, updated_since: now, limit });
      const all   = (res?.data?.data ?? res?.data ?? []);

      // Filter to those with due_date within range
      const today  = todayStr();
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const items = all
        .filter(a => a.due_date && a.due_date >= today && a.due_date <= cutoffStr)
        .slice(0, limit)
        .map(formatActivity);

      if (items.length === 0) {
        return { content: [{ type: 'text', text: `No activities due in the next ${days} day(s).` }] };
      }

      return {
        content: [{
          type: 'text',
          text: `${items.length} activity/ies due in the next ${days} day(s):\n\n` +
            items.map(a =>
              `• [${a.due_date} ${a.due_time}] **${a.subject}** (${a.type}) — Owner: ${a.owner}${a.deal ? ` — Deal: ${a.deal}` : ''}${a.url ? `\n  ${a.url}` : ''}`
            ).join('\n'),
        }],
        _data: items,
      };
    },
  },

  {
    name: 'get_overdue_activities',
    description: 'List all activities that are past their due date and still not completed.',
    schema: z.object({
      limit: z.number().int().min(1).max(100).default(50),
    }),
    async handler({ limit }) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const cutoffStr = yesterday.toISOString().slice(0, 10);

      // Fetch not-done activities updated any time, filter by due_date < today
      const res   = await activities.getAll({ done: 0, limit: 100 });
      const today = todayStr();
      const items = (res?.data?.data ?? res?.data ?? [])
        .filter(a => a.due_date && a.due_date < today)
        .slice(0, limit)
        .map(formatActivity);

      if (items.length === 0) {
        return { content: [{ type: 'text', text: 'No overdue activities 🎉 Everyone is on track!' }] };
      }

      return {
        content: [{
          type: 'text',
          text: `⚠️ ${items.length} overdue activity/ies:\n\n` +
            items.map(a =>
              `• **[OVERDUE: ${a.due_date}]** ${a.subject} (${a.type}) — Owner: ${a.owner}${a.deal ? ` — Deal: ${a.deal}` : ''}`
            ).join('\n'),
        }],
        _data: items,
      };
    },
  },

  {
    name: 'notify_upcoming_tasks',
    description: 'Fetch upcoming activities and send a Microsoft Teams notification.',
    schema: z.object({
      days: z.number().int().min(1).max(14).default(1),
    }),
    async handler({ days }) {
      const today     = todayStr();
      const cutoff    = new Date(); cutoff.setDate(cutoff.getDate() + days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const res   = await activities.getAll({ done: 0, limit: 100 });
      const items = (res?.data?.data ?? res?.data ?? [])
        .filter(a => a.due_date && a.due_date >= today && a.due_date <= cutoffStr)
        .map(formatActivity);

      if (items.length === 0) {
        return { content: [{ type: 'text', text: `No upcoming tasks in ${days} day(s). No Teams alert sent.` }] };
      }

      const result = await notifyUpcomingTasks(items, days);
      return {
        content: [{
          type: 'text',
          text: `${items.length} tasks found. Teams notification ${result.sent ? 'sent ✅' : 'skipped (' + result.reason + ')'}.`,
        }],
      };
    },
  },

  {
    name: 'notify_overdue_tasks',
    description: 'Find all overdue activities and fire a Teams warning message.',
    schema: z.object({}),
    async handler() {
      const today = todayStr();

      const res   = await activities.getAll({ done: 0, limit: 100 });
      const items = (res?.data?.data ?? res?.data ?? [])
        .filter(a => a.due_date && a.due_date < today)
        .map(formatActivity);

      if (items.length === 0) {
        return { content: [{ type: 'text', text: 'No overdue tasks. No Teams alert sent.' }] };
      }

      const result = await notifyOverdueTasks(items);
      return {
        content: [{
          type: 'text',
          text: `${items.length} overdue task(s). Teams notification ${result.sent ? 'sent ✅' : 'skipped (' + result.reason + ')'}.`,
        }],
      };
    },
  },

  {
    name: 'create_activity',
    description: 'Create a new task, call, meeting, or deadline in Pipedrive.',
    schema: z.object({
      subject:   z.string().describe('Short description, e.g. "Follow-up call with Acme"'),
      type:      z.enum(['call', 'meeting', 'task', 'deadline', 'email', 'lunch']).default('task'),
      due_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
      due_time:  z.string().regex(/^\d{2}:\d{2}$/).optional().describe('HH:MM (24h)'),
      deal_id:   z.number().int().optional(),
      person_id: z.number().int().optional(),
      user_id:   z.number().int().optional().describe('Assign to a specific team member'),
      note:      z.string().optional(),
    }),
    async handler(args) {
      const body = {
        subject:  args.subject,
        type:     args.type,
        due_date: args.due_date,
        done:     false,
        ...(args.due_time  && { due_time:  args.due_time }),
        ...(args.deal_id   && { deal_id:   args.deal_id }),
        ...(args.person_id && { person_id: args.person_id }),
        ...(args.user_id   && { user_id:   args.user_id }),
        ...(args.note      && { note:      args.note }),
      };

      const res = await activities.create(body);
      const a   = res?.data?.data ?? res?.data;

      if (!a) throw new Error('Failed to create activity — no data returned.');

      return {
        content: [{
          type: 'text',
          text: `✅ Activity created!\n• Subject: ${a.subject}\n• Type: ${a.type}\n• Due: ${a.due_date}${a.due_time ? ' ' + a.due_time : ''}\n• ID: ${a.id}`,
        }],
      };
    },
  },

  {
    name: 'mark_activity_done',
    description: 'Mark a Pipedrive activity as completed.',
    schema: z.object({
      activity_id: z.number().int(),
    }),
    async handler({ activity_id }) {
      await activities.update(activity_id, { done: true });
      return { content: [{ type: 'text', text: `✅ Activity ${activity_id} marked as done.` }] };
    },
  },
];
