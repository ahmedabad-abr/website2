/**
 * Editorial planner: a task board (who is doing what) and a calendar of publication cycles.
 *  - Tasks: assigned to a team member, optionally linked to an issue and/or article, with a due date.
 *    Columns: To do → In progress → In review → Done.
 *  - Calendar: milestones (deadlines, meetings, publication days) plus, automatically, task due dates,
 *    published articles, issue publications and EiC/COO term ends.
 *  - "Plan a cycle" creates the standard milestones for an issue from its target publication date.
 * The Chair, EiC and COO can assign work to anyone; editors manage their own tasks.
 */

var TASK_COLS = ['id', 'title', 'notes', 'kind', 'status', 'assignee', 'createdBy', 'issueKey', 'articleId', 'due',
                 'priority', 'createdAt', 'updatedAt', 'doneAt'];
var EVENT_COLS = ['id', 'title', 'date', 'kind', 'issueKey', 'notes', 'createdBy', 'createdAt'];

var PLANNER_LEADS = ['chair', 'eic', 'coo'];
var TASK_STATUSES = ['todo', 'doing', 'review', 'done'];
var TASK_KINDS = {
  write: 'Writing', edit: 'Editing', factcheck: 'Fact-check', review: 'Review', design: 'Design and cover',
  statement: 'Issue statement', social: 'Social and newsletter', admin: 'Admin', other: 'Other'
};
var EVENT_KINDS = { deadline: 'Deadline', meeting: 'Meeting', publication: 'Publication', event: 'Event' };

// Standard publication cycle, counted back from the issue's publication day.
var CYCLE_STEPS = [
  [-42, 'Pitches and article list agreed', 'meeting'],
  [-28, 'First drafts due', 'deadline'],
  [-18, 'Edits and fact-checks complete', 'deadline'],
  [-12, 'Statements from the EiC, COO and editors due', 'deadline'],
  [-10, 'Chair’s foreword due', 'deadline'],
  [-7,  'Cover, contents and compiled PDF checked', 'deadline'],
  [-3,  'Final approval by the Chair', 'deadline'],
  [0,   'Issue published', 'publication']
];

var CYCLE_NOTE = 'Part of the standard publication cycle';

var PLANNER_ROUTES = {
  'planner.board':        plannerBoard_,
  'planner.task.save':    plannerTaskSave_,
  'planner.task.move':    plannerTaskMove_,
  'planner.task.delete':  plannerTaskDelete_,
  'planner.calendar':     plannerCalendar_,
  'planner.event.save':   plannerEventSave_,
  'planner.event.delete': plannerEventDelete_,
  'planner.cycle':        plannerCycle_
};

function readTasks_() { return sheetRows_('Tasks', TASK_COLS); }
function readEvents_() { return sheetRows_('Calendar', EVENT_COLS); }
function isLead_(u) { return PLANNER_LEADS.indexOf(u.role) !== -1; }
function plannerId_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }

function taskView_(t, users) {
  var a = users[t.assignee] || {};
  var today = todayIST_();
  return {
    id: t.id, title: t.title, notes: t.notes, kind: t.kind, kindLabel: TASK_KINDS[t.kind] || 'Other', status: t.status,
    assignee: t.assignee, assigneeName: a.name || t.assignee || 'Unassigned', createdBy: t.createdBy,
    issueKey: t.issueKey, articleId: t.articleId, due: t.due, priority: t.priority || 'normal',
    overdue: !!(t.due && t.status !== 'done' && t.due < today), dueSoon: !!(t.due && t.status !== 'done' && t.due >= today && daysBetween_(today, t.due) <= 2),
    createdAt: t.createdAt, updatedAt: t.updatedAt, doneAt: t.doneAt
  };
}

function plannerBoard_(p, req) {
  var u = requireUser_(req);
  var users = usersByEmail_();
  var tasks = readTasks_();
  var cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  var list = tasks.filter(function (t) { return t.status !== 'done' || String(t.doneAt) > cutoff; })   // done tasks drop off after 30 days
    .map(function (t) { return taskView_(t, users); })
    .sort(function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; });
  var team = readUsers_().filter(function (x) { return truthy_(x.active); }).map(function (x) {
    var mine = list.filter(function (t) { return t.assignee === x.email && t.status !== 'done'; });
    return { email: x.email, name: x.name, role: x.role, title: x.title || ROLES[x.role],
             open: mine.length, doing: mine.filter(function (t) { return t.status === 'doing'; }).length,
             overdue: mine.filter(function (t) { return t.overdue; }).length,
             current: mine.filter(function (t) { return t.status === 'doing'; }).map(function (t) { return t.title; }).slice(0, 3) };
  });
  var issues = readIssues_().map(function (i) { return { key: i.key, label: issueLabel_(i), status: i.status }; });
  var articles = readMeta_().filter(function (a) { return a.status !== 'published' && a.status !== 'withdrawn'; })
    .map(function (a) { return { id: a.id, title: a.title, status: a.status }; });
  return { tasks: list, team: team, issues: issues, articles: articles, kinds: TASK_KINDS, eventKinds: EVENT_KINDS,
           canAssign: isLead_(u), me: u.email };
}

function plannerTaskSave_(p, req) {
  var u = requireUser_(req);
  var users = usersByEmail_();
  var t = p.id ? readTasks_().filter(function (x) { return x.id === p.id; })[0] : null;
  if (p.id && !t) throw new Error('Task not found.');
  if (t && !isLead_(u) && t.assignee !== u.email && t.createdBy !== u.email) throw new Error('You can only edit your own tasks.');
  var title = String(p.title || '').trim();
  if (title.length < 3) throw new Error('Give the task a title.');
  var assignee = String(p.assignee || u.email).trim().toLowerCase();
  if (!users[assignee]) throw new Error('Choose a team member.');
  if (!isLead_(u) && assignee !== u.email) throw new Error('Only the Chair, EiC or COO can assign tasks to others.');
  var prevAssignee = t ? t.assignee : '';
  t = t || { id: plannerId_('T'), createdBy: u.email, createdAt: now_(), status: 'todo', doneAt: '' };
  t.title = title.slice(0, 200);
  t.notes = String(p.notes || '').slice(0, 2000);
  t.kind = TASK_KINDS[p.kind] ? p.kind : 'other';
  if (p.status && TASK_STATUSES.indexOf(p.status) !== -1) { if (p.status === 'done' && t.status !== 'done') t.doneAt = now_(); if (p.status !== 'done') t.doneAt = ''; t.status = p.status; }
  t.assignee = assignee;
  t.issueKey = String(p.issueKey || '').slice(0, 20);
  t.articleId = /^ABR-\d{4}-\d{4}$/.test(p.articleId || '') ? p.articleId : '';
  t.due = isoDay_(p.due);
  t.priority = p.priority === 'high' ? 'high' : 'normal';
  t.updatedAt = now_();
  writeRow_('Tasks', TASK_COLS, t);
  logRaw_(u.email, 'task.save', t.articleId, t.id + ' ' + t.title);
  if (assignee !== prevAssignee && assignee !== u.email) {
    notify_(assignee, 'New task: ' + t.title,
      '<p>' + esc_(u.name) + ' assigned you a task in the ABR planner.</p><p><b>' + esc_(t.title) + '</b><br>' + esc_(TASK_KINDS[t.kind]) +
      (t.due ? ' · due ' + esc_(t.due) : '') + (t.priority === 'high' ? ' · <b>high priority</b>' : '') + '</p>' +
      (t.notes ? '<p>' + esc_(t.notes) + '</p>' : '') + portalLink_());
  }
  return taskView_(t, users);
}

function plannerTaskMove_(p, req) {
  var u = requireUser_(req);
  var t = readTasks_().filter(function (x) { return x.id === p.id; })[0];
  if (!t) throw new Error('Task not found.');
  if (!isLead_(u) && t.assignee !== u.email) throw new Error('You can only move your own tasks.');
  if (TASK_STATUSES.indexOf(p.status) === -1) throw new Error('Unknown column.');
  t.status = p.status; t.updatedAt = now_(); t.doneAt = p.status === 'done' ? now_() : '';
  writeRow_('Tasks', TASK_COLS, t);
  logRaw_(u.email, 'task.' + p.status, t.articleId, t.id);
  if (p.status === 'review' && t.createdBy && t.createdBy !== u.email) {
    notify_(t.createdBy, 'Ready for review: ' + t.title, '<p>' + esc_(u.name) + ' moved <b>' + esc_(t.title) + '</b> to In review.</p>' + portalLink_());
  }
  return taskView_(t, usersByEmail_());
}

function plannerTaskDelete_(p, req) {
  var u = requireUser_(req);
  var t = readTasks_().filter(function (x) { return x.id === p.id; })[0];
  if (!t) throw new Error('Task not found.');
  if (!isLead_(u) && t.createdBy !== u.email) throw new Error('Only the person who created this task, or the Chair, EiC or COO, can delete it.');
  sheet_('Tasks').deleteRow(t._row);
  logRaw_(u.email, 'task.delete', '', t.id + ' ' + t.title);
  return { ok: true };
}

// Everything for a date range: milestones, task due dates, publications and term ends.
function plannerCalendar_(p, req) {
  requireUser_(req);
  var from = isoDay_(p.from) || todayIST_().slice(0, 8) + '01';
  var to = isoDay_(p.to) || Utilities.formatDate(new Date(new Date(from + 'T12:00:00Z').getTime() + 42 * 86400000), 'UTC', 'yyyy-MM-dd');
  var inRange = function (d) { return d && d >= from && d <= to; };
  var users = usersByEmail_();
  var items = [];
  readEvents_().forEach(function (e) {
    if (inRange(e.date)) items.push({ id: e.id, date: e.date, type: 'event', kind: e.kind, title: e.title, notes: e.notes, issueKey: e.issueKey, editable: true });
  });
  readTasks_().forEach(function (t) {
    if (inRange(t.due)) {
      var v = taskView_(t, users);
      items.push({ id: t.id, date: t.due, type: 'task', kind: t.kind, title: t.title, who: v.assigneeName, status: t.status, overdue: v.overdue, issueKey: t.issueKey });
    }
  });
  readMeta_().forEach(function (a) {
    var d = String(a.publishedAt || '').slice(0, 10);
    if (a.status === 'published' && inRange(d)) items.push({ id: a.id, date: d, type: 'published', title: a.title });
  });
  readIssues_().forEach(function (i) {
    var d = String(i.publishedAt || '').slice(0, 10);
    if (i.status === 'published' && inRange(d)) items.push({ id: i.key, date: d, type: 'issue', title: issueLabel_(i) + ' published' });
  });
  readUsers_().forEach(function (x) {
    if (truthy_(x.active) && TERM_ROLES.indexOf(x.role) !== -1 && inRange(x.termEnd)) {
      items.push({ id: 'term-' + x.email, date: x.termEnd, type: 'term', title: 'Term ends: ' + x.name + ' (' + ROLES[x.role] + ')' });
    }
  });
  items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { from: from, to: to, items: items, today: todayIST_() };
}

function plannerEventSave_(p, req) {
  var u = requireUser_(req);
  if (!isLead_(u)) throw new Error('Only the Chair, EiC or COO can add calendar dates.');
  var e = p.id ? readEvents_().filter(function (x) { return x.id === p.id; })[0] : null;
  if (p.id && !e) throw new Error('Calendar entry not found.');
  var title = String(p.title || '').trim();
  if (!title) throw new Error('Give the entry a title.');
  if (!isoDay_(p.date)) throw new Error('Choose a date.');
  e = e || { id: plannerId_('E'), createdBy: u.email, createdAt: now_() };
  e.title = title.slice(0, 200); e.date = p.date; e.kind = EVENT_KINDS[p.kind] ? p.kind : 'deadline';
  e.issueKey = String(p.issueKey || '').slice(0, 20); e.notes = String(p.notes || '').slice(0, 1000);
  writeRow_('Calendar', EVENT_COLS, e);
  logRaw_(u.email, 'calendar.save', '', e.id + ' ' + e.date + ' ' + e.title);
  return e;
}

function plannerEventDelete_(p, req) {
  var u = requireUser_(req);
  if (!isLead_(u)) throw new Error('Only the Chair, EiC or COO can remove calendar dates.');
  var e = readEvents_().filter(function (x) { return x.id === p.id; })[0];
  if (!e) throw new Error('Calendar entry not found.');
  sheet_('Calendar').deleteRow(e._row);
  logRaw_(u.email, 'calendar.delete', '', e.id + ' ' + e.title);
  return { ok: true };
}

// Create the standard milestones for an issue, counted back from its publication day.
function plannerCycle_(p, req) {
  var u = requireUser_(req);
  if (!isLead_(u)) throw new Error('Only the Chair, EiC or COO can plan a cycle.');
  var i = findIssue_(p.issueKey);
  var pub = isoDay_(p.publishDate);
  if (!pub) throw new Error('Choose the publication date.');
  var label = 'Vol. ' + i.volume + ' No. ' + i.number;
  var existing = readEvents_().filter(function (e) { return e.issueKey === i.key && e.notes === CYCLE_NOTE; });
  if (existing.length && !p.replace) throw new Error('This issue already has cycle dates. Tick “Replace existing dates” to create them again.');
  existing.sort(function (a, b) { return b._row - a._row; }).forEach(function (e) { sheet_('Calendar').deleteRow(e._row); });
  var base = new Date(pub + 'T12:00:00+05:30').getTime();
  var made = CYCLE_STEPS.map(function (s) {
    var e = { id: plannerId_('E'), title: label + ': ' + s[1], date: Utilities.formatDate(new Date(base + s[0] * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd'),
              kind: s[2], issueKey: i.key, notes: CYCLE_NOTE, createdBy: u.email, createdAt: now_() };
    writeRow_('Calendar', EVENT_COLS, e);
    return e;
  });
  log_(u.email, 'planner.cycle', '', i.key + ' ' + pub);
  return { created: made.length, events: made };
}

// Daily at 9 am IST: email each person their tasks that are overdue or due within two days.
function plannerReminders_() {
  var props = PropertiesService.getScriptProperties();
  var day = todayIST_();
  if (props.getProperty('PLANNER_REMIND') === day || Number(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'H')) < 9) return;
  props.setProperty('PLANNER_REMIND', day);
  var users = usersByEmail_();
  var by = {};
  readTasks_().forEach(function (t) {
    var v = taskView_(t, users);
    if ((v.overdue || v.dueSoon) && users[t.assignee] && truthy_(users[t.assignee].active)) (by[t.assignee] = by[t.assignee] || []).push(v);
  });
  Object.keys(by).forEach(function (email) {
    var list = by[email];
    notify_(email, list.length + ' ABR task' + (list.length === 1 ? '' : 's') + ' need' + (list.length === 1 ? 's' : '') + ' attention',
      '<p>Here are your tasks that are overdue or due in the next two days:</p><ul>' +
      list.map(function (t) { return '<li><b>' + esc_(t.title) + '</b>, ' + (t.overdue ? '<b>overdue</b> (was due ' : 'due ') + esc_(t.due) + (t.overdue ? ')' : '') + '</li>'; }).join('') +
      '</ul>' + portalLink_());
  });
}
