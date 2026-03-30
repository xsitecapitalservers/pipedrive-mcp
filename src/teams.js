/**
 * teams.js
 * ─────────────────────────────────────────────
 * Sends rich Adaptive Card messages to a Microsoft Teams channel
 * via an Incoming Webhook URL.
 *
 * How to set up a webhook in Teams:
 *  1. Open the Teams channel you want alerts in
 *  2. Click "..." → "Connectors" (or "Manage channel" → "Connectors")
 *  3. Search for "Incoming Webhook" → Configure
 *  4. Give it a name like "Pipedrive Alerts"
 *  5. Copy the webhook URL into your .env as TEAMS_WEBHOOK_URL
 */

const WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;

/**
 * Low-level sender. Posts a raw Adaptive Card payload to Teams.
 */
async function sendCard(card) {
  if (!WEBHOOK_URL) {
    console.warn('[Teams] TEAMS_WEBHOOK_URL is not set — skipping notification.');
    return { sent: false, reason: 'TEAMS_WEBHOOK_URL not configured' };
  }

  const payload = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: card,
    }],
  };

  const res = await fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Teams webhook failed (${res.status}): ${text}`);
  }

  return { sent: true };
}

// ── Public notification functions ─────────────────────────────────────────────

/**
 * Alert: new leads/deals created recently.
 * @param {Array}  items     - array of formatted deals/leads
 * @param {number} days      - how many days back we looked
 */
export async function notifyNewLeads(items, days = 1) {
  const rows = items.slice(0, 10).map(d => ({
    type: 'ColumnSet',
    columns: [
      { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `[${d.title}](${d.url})`, wrap: true }] },
      { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: d.value, color: 'Good' }] },
      { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: d.stage ?? '', color: 'Accent' }] },
    ],
  }));

  return sendCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type:    'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: `🆕 ${items.length} New Lead${items.length !== 1 ? 's' : ''} in the last ${days} day${days !== 1 ? 's' : ''}` },
      { type: 'TextBlock', text: 'Here are the latest deals that just entered your pipeline:', wrap: true, spacing: 'Small' },
      ...rows,
      items.length > 10
        ? { type: 'TextBlock', text: `…and ${items.length - 10} more. [View all in Pipedrive](https://app.pipedrive.com/deals)`, wrap: true, color: 'Accent' }
        : null,
    ].filter(Boolean),
  });
}

/**
 * Alert: upcoming activities / tasks due soon.
 * @param {Array}  activities  - array of formatted activities
 * @param {number} days        - how many days ahead we looked
 */
export async function notifyUpcomingTasks(activities, days = 1) {
  const rows = activities.slice(0, 15).map(a => ({
    type: 'ColumnSet',
    columns: [
      { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${a.subject}**${a.deal ? ` — ${a.deal}` : ''}`, wrap: true }] },
      { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: `${a.due_date} ${a.due_time}`.trim() }] },
      { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: a.owner ?? '', color: 'Accent' }] },
    ],
  }));

  return sendCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type:    'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: `📋 ${activities.length} Task${activities.length !== 1 ? 's' : ''} Due in the Next ${days} Day${days !== 1 ? 's' : ''}` },
      ...rows,
    ],
  });
}

/**
 * Alert: overdue activities that haven't been completed.
 * @param {Array} activities - array of formatted overdue activities
 */
export async function notifyOverdueTasks(activities) {
  const rows = activities.slice(0, 15).map(a => ({
    type: 'ColumnSet',
    columns: [
      { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${a.subject}**${a.deal ? ` — ${a.deal}` : ''}`, wrap: true }] },
      { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: a.due_date, color: 'Attention' }] },
      { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: a.owner ?? '' }] },
    ],
  }));

  return sendCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type:    'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', color: 'Attention', text: `⚠️ ${activities.length} Overdue Task${activities.length !== 1 ? 's' : ''}` },
      { type: 'TextBlock', text: 'These activities are past due and not yet marked complete:', wrap: true, spacing: 'Small' },
      ...rows,
    ],
  });
}

/**
 * Send any custom text message to Teams.
 * @param {string} title   - bold heading
 * @param {string} body    - message body (supports markdown)
 * @param {string} color   - 'Good' | 'Warning' | 'Attention' | 'Accent' | 'Default'
 */
export async function notifyCustom(title, body, color = 'Default') {
  return sendCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type:    'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', color, text: title },
      { type: 'TextBlock', text: body, wrap: true },
    ],
  });
}

/**
 * Alert: pipeline health summary.
 */
export async function notifyPipelineReport(summary) {
  return sendCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type:    'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: '📊 Pipeline Health Report' },
      { type: 'FactSet', facts: [
        { title: 'Total open deals',    value: String(summary.open_deals ?? 0) },
        { title: 'Total value',         value: summary.total_value ?? 'n/a' },
        { title: 'Avg deal size',       value: summary.avg_deal_size ?? 'n/a' },
        { title: 'Won this month',      value: String(summary.won_this_month ?? 0) },
        { title: 'Lost this month',     value: String(summary.lost_this_month ?? 0) },
        { title: 'Overdue activities',  value: String(summary.overdue_activities ?? 0) },
        { title: 'Deals with no activity', value: String(summary.stale_deals ?? 0) },
      ]},
      { type: 'ActionSet', actions: [
        { type: 'Action.OpenUrl', title: 'Open Pipedrive', url: 'https://app.pipedrive.com/deals' },
      ]},
    ],
  });
}
