import { activities, fetchAll, getData, formatActivity } from '../pipedrive.js';
import { notifyUpcomingTasks, notifyOverdueTasks } from '../teams.js';
import { z } from 'zod';

const todayStr      = () => new Date().toISOString().slice(0, 10);
const futureDateStr = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

// Fetch ALL activities for a specific user (paginated) or a capped batch for all users.
async function fetchActivities(opts = {}) {
  const { user_id, ...rest } = opts;
  if (user_id) {
    return fetchAll((pageOpts) => activities.getAll({ user_id, ...rest, ...pageOpts }));
  }
  const page1 = await activities.getAll({ ...rest, limit: 100, start: 0 });
  return getData(page1);
}

export const activityTools = [

  {
    name: 'get_upcoming_activities',
    description: 'List open activities due within the next N days. Optionally filter by a specific team member — use get_users to find their user_id.',
    schema: z.object({
      days:    z.number().int().min(1).max(30).default(3),
      limit:   z.number().int().min(1).max(200).default(50),
      user_id: z.number().int().optional().describe('Filter to a specific team member. Omit for all users.'),
    }),
    async handler({ days, limit, user_id }) {
      const today  = todayStr();
      const cutoff = futureDateStr(days);
      const all    = await fetchActivities({ done: 0, user_id });
      const items  = all
        .filter(a => a.due_date && a.due_date >= today && a.due_date <= cutoff)
        .slice(0, limit)
        .map(formatActivity);

      const who = user_id ? `user ${user_id}` : 'all users';
      if (items.length === 0) {
        return { content: [{ type: 'text', text: `No activities due in the next ${days} day(s) for ${who}.` }] };
      }
      return {
        content: [{
          type: 'text',
          text: `${items.length} activity/ies due in the next ${days} day(s) (${who}):\n\n` +
            items.map(a => `• [${a.due_date} ${a.due_time || ''}] **${a.subject}** (${a.type}) — Owner: ${a.owner}${a.deal ? ` — ${a.deal}` : ''}${a.url ? `\n  ${a.url}` : ''}`).join('\n'),
        }],
        _data: items,
      };
    },
  },

  {
    name: 'get_overdue_activities',
    description: 'List activities that are past their due date and still not completed. Optionally filter by a specific team member — use get_users to find their user_id.',
    schema: z.object({
      limit:   z.number().int().min(1).max(200).default(50),
      user_id: z.number().int().optional().describe('Filter to a specific team member. Omit for all users.'),
    }),
    async handler({ limit, user_id }) {
      const today = todayStr();
      const all   = await fetchActivities({ done: 0, user_id });
      const items = all
        .filter(a => a.due_date && a.due_date < today)
        .slice(0, limit)
        .map(formatActivity);

      const who = user_id ? `user ${user_id}` : 'all users';
      if (items.length === 0) {
        return { content: [{ type: 'text', text: `No overdue activities for ${who} 🎉` }] };
      }
      return {
        content: [{
          type: 'text',
          text: `⚠️ ${items.length} overdue activity/ies (${who}):\n\n` +
            items.map(a => `• **[OVERDUE: ${a.due_date}]** ${a.subject} (${a.type}) — Owner: ${a.owner}${a.deal ? ` — ${a.deal}` : ''}`).join('\n'),
        }],
        _data: items,
      };
    },
  },

  {
    name: 'notify_upcoming_tasks',
    description: 'Fetch upcoming activities and send a Microsoft Teams notification.',
    schema: z.object({
      days:    z.number().int().min(1).max(14).default(1),
      user_id: z.number().int().optional().describe('Filter to a specific team member. Omit for all users.'),
    }),
    async handler({ days, user_id }) {
      const today  = todayStr();
      const cutoff = futureDateStr(days);
      const all    = await fetchActivities({ done: 0, user_id });
      const items  = all
        .filter(a => a.due_date && a.due_date >= today && a.due_date <= cutoff)
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
    schema: z.object({
      user_id: z.number().int().optional().describe('Filter to a specific team member. Omit for all users.'),
    }),
    async handler({ user_id }) {
      const today = todayStr();
      const all   = await fetchActivities({ done: 0, user_id });
      const items = all.filter(a => a.due_date && a.due_date < today).map(formatActivity);

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
      user_id:   z.number().int().optional().describe('Assign to a specific team member. Use get_users to find IDs.'),
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
      const a   = res?.data ?? getData(res)?.[0];
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
