/**
 * tools/activities.js — Task & Activity Management
 * ─────────────────────────────────────────────
 * Tools:
 *   get_upcoming_activities  - list tasks due in the next N days
 *   get_overdue_activities   - list tasks that are past due
 *   notify_upcoming_tasks    - send Teams alert for upcoming tasks
 *   notify_overdue_tasks     - send Teams alert for overdue tasks
 *   create_activity          - create a new task/call/meeting in Pipedrive
 *   mark_activity_done       - mark an activity as completed
 */

import { activitiesApi, usersApi, formatActivity } from '../pipedrive.js';
import { notifyUpcomingTasks, notifyOverdueTasks } from '../teams.js';
import { z } from 'zod';

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function futureDateStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Tools ─────────────────────────────────────────────────────────────────────
export const activityTools = [

  // ── get_upcoming_activities ─────────────────────────────────────────────────
  {
    name: 'get_upcoming_activities',
    description: 'List all open (not yet done) activities due within the next N days. ' +
                 'Optionally filter by owner (Pipedrive user ID).',
    schema: z.object({
      days:    z.number().int().min(1).max(30).default(3).describe('How many days ahead to look'),
      user_id: z.number().int().optional().describe('Filter by Pipedrive user ID (omit for all users)'),
      limit:   z.number().int().min(1).max(100).default(50),
    }),
    async handler({ days, user_id, limit }) {
      const today  = todayStr();
      const future = futureDateStr(days);

      const params = {
        done: 0,            // 0 = not done
        start: 0,
        limit,
        start_date: today,
        end_date: future,
      };
      if (user_id) params.user_id = user_id;

      const res = await activitiesApi.getActivities(params);
      const items = (res?.data ?? []).map(formatActivity);

      if (items.length === 0) {
        return { content: [{ type: 'text', text: `No activities due in the next ${days} day(s).` }] };
      }

      return {
        content: [{
          type: 'text',
          text: `${items.length} upcoming activity/ies in the next ${days} day(s):\n\n` +
            items.map(a =>
              `• [${a.due_date} ${a.due_time}] **${a.subject}** (${a.type}) — Owner: ${a.owner}${a.deal ? ` — Deal: ${a.deal}` : ''}${a.url ? `\n  ${a.url}` : ''}`
            ).join('\n'),
        }],
        _data: items,
      };
    },
  },

  // ── get_overdue_activities ──────────────────────────────────────────────────
  {
    name: 'get_overdue_activities',
    description: 'List all activities that are past their due date and still not completed.',
    schema: z.object({
      user_id: z.number().int().optional().describe('Filter by user ID'),
      limit:   z.number().int().min(1).max(100).default(50),
    }),
    async handler({ user_id, limit }) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const params = {
        done:     0,
        start:    0,
        limit,
        end_date: yesterdayStr,  // due before today = overdue
      };
      if (user_id) params.user_id = user_id;

      const res = await activitiesApi.getActivities(params);
      const items = (res?.data ?? []).map(formatActivity);

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

  // ── notify_upcoming_tasks ───────────────────────────────────────────────────
  {
    name: 'notify_upcoming_tasks',
    description: 'Fetch upcoming activities and send a Microsoft Teams notification. ' +
                 'Schedule this daily for a morning standup digest.',
    schema: z.object({
      days: z.number().int().min(1).max(14).default(1),
    }),
    async handler({ days }) {
      const today  = todayStr();
      const future = futureDateStr(days);

      const res = await activitiesApi.getActivities({
        done: 0, start: 0, limit: 100,
        start_date: today,
        end_date: future,
      });
      const items = (res?.data ?? []).map(formatActivity);

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

  // ── notify_overdue_tasks ────────────────────────────────────────────────────
  {
    name: 'notify_overdue_tasks',
    description: 'Find all overdue activities and fire a Teams warning message.',
    schema: z.object({}),
    async handler() {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const res = await activitiesApi.getActivities({
        done: 0, start: 0, limit: 100,
        end_date: yesterday.toISOString().slice(0, 10),
      });
      const items = (res?.data ?? []).map(formatActivity);

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

  // ── create_activity ─────────────────────────────────────────────────────────
  {
    name: 'create_activity',
    description: 'Create a new task, call, meeting, email, or deadline in Pipedrive.',
    schema: z.object({
      subject:  z.string().describe('Short description of the activity, e.g. "Follow-up call with Acme"'),
      type:     z.enum(['call', 'meeting', 'task', 'deadline', 'email', 'lunch']).default('task'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format'),
      due_time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Time in HH:MM (24h) format'),
      deal_id:  z.number().int().optional().describe('Attach to a deal by its ID'),
      person_id: z.number().int().optional().describe('Attach to a person by their ID'),
      user_id:  z.number().int().optional().describe('Assign to a specific team member by user ID'),
      note:     z.string().optional().describe('Optional notes or details'),
    }),
    async handler(args) {
      const payload = {
        subject:   args.subject,
        type:      args.type,
        due_date:  args.due_date,
        ...(args.due_time  && { due_time:  args.due_time }),
        ...(args.deal_id   && { deal_id:   args.deal_id }),
        ...(args.person_id && { person_id: args.person_id }),
        ...(args.user_id   && { user_id:   args.user_id }),
        ...(args.note      && { note:      args.note }),
        done: false,
      };

      const res = await activitiesApi.addActivity({ AddActivityRequest: payload });
      const a = res?.data;

      if (!a) throw new Error('Failed to create activity — no data returned.');

      return {
        content: [{
          type: 'text',
          text: `✅ Activity created!\n` +
                `• Subject: ${a.subject}\n` +
                `• Type: ${a.type}\n` +
                `• Due: ${a.due_date}${a.due_time ? ' ' + a.due_time : ''}\n` +
                `• ID: ${a.id}`,
        }],
      };
    },
  },

  // ── mark_activity_done ──────────────────────────────────────────────────────
  {
    name: 'mark_activity_done',
    description: 'Mark a Pipedrive activity as completed.',
    schema: z.object({
      activity_id: z.number().int().describe('The numeric ID of the activity'),
    }),
    async handler({ activity_id }) {
      await activitiesApi.updateActivity({
        id: activity_id,
        UpdateActivityRequest: { done: true },
      });
      return {
        content: [{ type: 'text', text: `✅ Activity ${activity_id} marked as done.` }],
      };
    },
  },
];
