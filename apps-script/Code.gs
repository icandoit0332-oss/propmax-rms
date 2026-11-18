// ══════════════════════════════════════════════════════════════════
//  PROPMAX REQUIREMENT MANAGEMENT SYSTEM — BACKEND (Google Apps Script)
//
//  One web app serves all four departments:
//    PropMax, Arch Tech, IT  → their own Google Sheets (read + write)
//    SAP                     → the existing SAP RMS sheet (read-only for now)
//
//  Sign-in: same Firebase project as the SAP RMS (imarat-sap-aff7f).
//  Every call carries the user's Firebase ID token; the script verifies it.
//  Write access: the "Access" tab of each department sheet (admin / editor).
//
//  Deploy:  Deploy → New deployment → Web app
//           Execute as: Me    ·    Who has access: Anyone
//  Then paste the /exec URL into config.js in the GitHub repo.
// ══════════════════════════════════════════════════════════════════

var CFG = {
  firebaseApiKey: 'AIzaSyBei-lo6GIehz3UT93xg2KTs5bU_1-4osQ',
  attachmentsFolderId: '1fn1qe1zjQ9G6gLTn6-p5omFX6DInOaqT',
  sapRmsSheetId: '10Zcp6407H-jyETfeVjM-elZ8U9CSi9tD0ZIb5-s9B7s',
  sapRmsUrl: 'https://icandoit0332-oss.github.io/imarat-sap/team.html',
  depts: [
    { key: 'propmax',  sheetId: '1skfviu3J99gE8AThM3ySo7R89QSbmLaKF7o603XY6QA' },
    { key: 'sap',      sheetId: null },
    { key: 'archtech', sheetId: '1wPzHCJgaquWSUxB5Hm9mSizIpr4JCE1bS0a4Q-XEbNM' },
    { key: 'it',       sheetId: '1NyJX6rdEYL_XJOArQQVt2T6-Eyme2x82Ww4UXfjzVa8' }
  ],
  // global admins: can edit every department
  admins: ['abdul.wasay@imarat.com.pk']
};

// SAP team (SAP is read from the RMS sheet, which has no Team tab)
var SAP_TEAM = [
  ['','Muhammad Momin Fiaz','Senior Finance Executive'], ['','Muhammad Sarmad Mudassar','Consultant'],
  ['','Muhammad Saad','Consultant'], ['','Ayaz Mehmood','Consultant'], ['','Abdul Wasay','SAP FICO Consultant'],
  ['','Hassan Abbasi','Senior Executive'], ['','Zeeshan Hashim','Consultant'], ['','Hussain Abbas','Junior ABAP Developer'],
  ['','Aliza Waheed','Intern'], ['','Shahzad Ahmed Iqbal','Consultant']
];
// RMS short names → full names on the team list
var SAP_NAMES = { 'Hassan':'Hassan Abbasi', 'Ayaz':'Ayaz Mehmood', 'Sarmad':'Muhammad Sarmad Mudassar', 'Shahzad Iqbal':'Shahzad Ahmed Iqbal',
  'Saad':'Muhammad Saad', 'Zeeshan':'Zeeshan Hashim', 'Hussain':'Hussain Abbas', 'Momin':'Muhammad Momin Fiaz' };
var SAP_USERS = { 'abdul.wasay':'Abdul Wasay', 'muhammad.momin':'Muhammad Momin Fiaz', 'h.abbasi':'Hassan Abbasi', 'saadzahid537':'Muhammad Saad' };

var REQ_COLS = ['ID','Created','Group','Type','Title','Description','Requester','Requesting Dept','Priority','Owner','Supporting',
  'Target Date','Stage','Completed On','Collaborators','Last Updated','Sample'];
var FIELD_COL = { group:'Group', type:'Type', title:'Title', notes:'Description', requester:'Requester', rdept:'Requesting Dept',
  priority:'Priority', owner:'Owner', support:'Supporting', target:'Target Date', stage:'Stage', completedOn:'Completed On' };
var TZ = 'Asia/Karachi';

// ── ROUTER ──────────────────────────────────────────────────────────
function doGet(e)  { return handle_(e && e.parameter || {}); }
function doPost(e) {
  var p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { p = e && e.parameter || {}; }
  return handle_(p);
}
function handle_(p) {
  try {
    var me = auth_(p.idToken);
    if (!me) return out_({ ok:false, error:'auth', message:'Please sign in again.' });
    switch (p.action) {
      case 'read':    return out_(read_(me));
      case 'create':  return out_(withLock_(function(){ var r = create_(me, p); bust_(); return r; }));
      case 'update':  return out_(withLock_(function(){ var r = update_(me, p); bust_(); return r; }));
      case 'comment': return out_(withLock_(function(){ var r = comment_(me, p); bust_(); return r; }));
      case 'collab':  return out_(withLock_(function(){ var r = collab_(me, p); bust_(); return r; }));
      default:        return out_({ ok:false, error:'action', message:'Unknown action.' });
    }
  } catch (err) {
    return out_({ ok:false, error:'server', message:String(err && err.message || err) });
  }
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function withLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }

// ── AUTH ────────────────────────────────────────────────────────────
function auth_(idToken) {
  if (!idToken) return null;
  var cache = CacheService.getScriptCache();
  var key = 'pmx_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key); if (hit) return JSON.parse(hit);
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CFG.firebaseApiKey,
    { method:'post', contentType:'application/json', payload:JSON.stringify({ idToken:idToken }), muteHttpExceptions:true });
  if (r.getResponseCode() !== 200) return null;
  var u = (JSON.parse(r.getContentText()).users || [])[0];
  if (!u || !u.email) return null;
  var me = { uid:u.localId, email:String(u.email).toLowerCase(), name:u.displayName || nameFromEmail_(u.email) };
  cache.put(key, JSON.stringify(me), 600);
  return me;
}
function nameFromEmail_(e) { return String(e).split('@')[0].split(/[._]/).map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }
function roleIn_(me, dept) {
  if (CFG.admins.indexOf(me.email) >= 0) return 'admin';
  if (!dept.sheetId) return 'viewer';
  var rows = values_(ss_(dept), 'Access');
  for (var i = 1; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === me.email) return String(rows[i][2] || 'viewer').trim().toLowerCase();
  return 'viewer';
}
function canWrite_(me, dept) { if (!dept.sheetId) return false; var r = roleIn_(me, dept); return r === 'admin' || r === 'editor'; }

// ── SHEET HELPERS ───────────────────────────────────────────────────
var _ss = {};
function ss_(dept) { return _ss[dept.key] || (_ss[dept.key] = SpreadsheetApp.openById(dept.sheetId)); }
function dept_(key) { for (var i = 0; i < CFG.depts.length; i++) if (CFG.depts[i].key === key) return CFG.depts[i]; throw new Error('Unknown department'); }
function values_(ss, tab) { var sh = ss.getSheetByName(tab); return sh ? sh.getDataRange().getValues() : [[]]; }
function d_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = String(v);
  if (s.indexOf('T') > 0) { var t = new Date(s); if (!isNaN(t)) return Utilities.formatDate(t, TZ, 'yyyy-MM-dd'); }
  return s.slice(0, 10);
}
function now_() { return new Date().toISOString(); }
function settings_(ss) { var o = {}; values_(ss, 'Settings').slice(1).forEach(function(r){ if (r[0]) o[String(r[0]).trim()] = String(r[1] || '').trim(); }); return o; }
function list_(s) { return String(s || '').split('|').map(function(x){ return x.trim(); }).filter(String); }
function hdrIndex_(row) { var o = {}; row.forEach(function(h, i){ o[String(h).trim()] = i; }); return o; }

// ── READ ────────────────────────────────────────────────────────────
// ── READ (cached: the whole data set is kept for 2 minutes, cleared on every save) ──
var CACHE_KEY = 'pmx_core_v1', CACHE_SECS = 120;
function bust_() { var c = CacheService.getScriptCache(), n = +(c.get(CACHE_KEY + '_n') || 0), k = [CACHE_KEY + '_n']; for (var i = 0; i < n; i++) k.push(CACHE_KEY + '_' + i); c.removeAll(k); }
function cachedCore_() {
  var c = CacheService.getScriptCache(), n = +(c.get(CACHE_KEY + '_n') || 0);
  if (n) {
    var keys = []; for (var i = 0; i < n; i++) keys.push(CACHE_KEY + '_' + i);
    var got = c.getAll(keys), parts = keys.map(function(k){ return got[k]; });
    if (parts.every(function(x){ return x; })) {
      try { return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(parts.join('')), 'application/x-gzip')).getDataAsString()); } catch (e) {}
    }
  }
  var core = readCore_();
  try {
    var b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(core), 'application/json')).getBytes());
    var size = 90000, put = {}, m = Math.ceil(b64.length / size);
    for (var j = 0; j < m; j++) put[CACHE_KEY + '_' + j] = b64.substr(j * size, size);
    put[CACHE_KEY + '_n'] = String(m);
    c.putAll(put, CACHE_SECS);
  } catch (e) {}
  return core;
}
function read_(me) {
  var core = cachedCore_();
  core.depts.forEach(function(d) {
    var role = 'viewer';
    if (CFG.admins.indexOf(me.email) >= 0) role = 'admin';
    else if (d.access && d.access[me.email]) role = d.access[me.email];
    d.role = role; d.canEdit = d.source !== 'rms' && (role === 'admin' || role === 'editor');
    delete d.access;
  });
  core.ok = true; core.me = me; core.syncedAt = now_();
  return core;
}
function readCore_() {
  var depts = [], reqs = [], team = [];
  CFG.depts.forEach(function(dept) {
    if (dept.key === 'sap') { var s = readSap_(); depts.push(s.dept); reqs = reqs.concat(s.reqs); team = team.concat(s.team); return; }
    var ss = ss_(dept), st = settings_(ss), access = {};
    values_(ss, 'Access').slice(1).forEach(function(a){ if (a[0]) access[String(a[0]).trim().toLowerCase()] = String(a[2] || 'viewer').trim().toLowerCase(); });
    var tm = values_(ss, 'Team').slice(1).filter(function(r){ return r[1]; }).map(function(r){ return { no:String(r[0]), name:String(r[1]).trim(), position:String(r[2] || ''), dept:dept.key }; });
    team = team.concat(tm);
    depts.push({ key:dept.key, name:st['Department'], sub:st['Description'], prefix:st['ID Prefix'], groupLabel:st['Group Label'] || 'Group',
      stages:list_(st['Stages']), typeLabel:st['Type Label'] || '', types:list_(st['Types']), people:tm.map(function(t){ return t.name; }),
      source:'sheet', access:access });
    var rows = values_(ss, 'Requirements'), H = hdrIndex_(rows[0]);
    var byId = {};
    rows.slice(1).forEach(function(r) {
      if (!r[H['ID']]) return;
      var collab = []; try { collab = JSON.parse(r[H['Collaborators']] || '[]'); } catch (e) {}
      var q = { id:String(r[H['ID']]), dept:dept.key, created:d_(r[H['Created']]), group:String(r[H['Group']] || ''), type:String(r[H['Type']] || ''),
        title:String(r[H['Title']] || ''), notes:String(r[H['Description']] || ''), requester:String(r[H['Requester']] || ''), rdept:String(r[H['Requesting Dept']] || ''),
        priority:String(r[H['Priority']] || 'Medium'), owner:String(r[H['Owner']] || ''), support:String(r[H['Supporting']] || ''), target:d_(r[H['Target Date']]),
        stage:String(r[H['Stage']] || ''), completedOn:d_(r[H['Completed On']]), collab:collab, sample:String(r[H['Sample']]).toUpperCase() === 'TRUE',
        comments:[], history:[] };
      byId[q.id] = q; reqs.push(q);
    });
    values_(ss, 'Comments').slice(1).forEach(function(c) {
      var q = byId[String(c[1])]; if (!q) return;
      var files = []; try { files = JSON.parse(c[6] || '[]'); } catch (e) {}
      q.comments.push({ id:String(c[0]), at:c[2] instanceof Date ? c[2].toISOString() : String(c[2]), by:String(c[3]), email:String(c[4]), text:String(c[5] || ''), files:files });
    });
    values_(ss, 'History').slice(1).forEach(function(h) {
      var q = byId[String(h[1])]; if (!q) return;
      q.history.push({ d:d_(h[0]), t:String(h[3]) + (h[2] ? ' (' + h[2] + ')' : '') });
    });
  });
  return { depts:depts, reqs:reqs, team:team };
}

function readSap_() {
  var ss = SpreadsheetApp.openById(CFG.sapRmsSheetId);
  var rows = values_(ss, 'Requirements'), H = hdrIndex_(rows[0]);
  var map = function(n){ n = String(n || '').trim(); return SAP_NAMES[n] || n; };
  var reqs = rows.slice(1).filter(function(r){ return r[H['ID']]; }).map(function(r) {
    var status = String(r[H['Status']] || 'Not Started');
    var desc = String(r[H['Description']] || '').trim(), note = String(r[H['Notes']] || '').trim();
    var q = { id:String(r[H['ID']]), dept:'sap', created:d_(r[H['Timestamp']]), group:String(r[H['Module']] || ''), type:'',
      title:String(r[H['Title']] || '').trim(), notes:desc + (note && note !== desc ? '\n' + note : ''), requester:String(r[H['Requester']] || ''),
      rdept:String(r[H['Department']] || ''), priority:String(r[H['Priority']] || 'Medium'), owner:map(r[H['Consultant']]), support:map(r[H['ABAP Dev']]),
      target:d_(r[H['Target Date']]), stage:status, completedOn: status === 'Completed' ? d_(r[H['Column 2']]) : '', collab:[], comments:[], history:[] };
    var cm = []; try { cm = JSON.parse(r[H['Comments']] || '[]'); } catch (e) {}
    cm.forEach(function(c, i) {
      var who = SAP_USERS[c.author] || c.author || 'RMS user';
      if (c.type === 'system') q.history.push({ d:d_(c.time), t:c.text + ' (RMS · ' + who + ')' });
      else q.comments.push({ id:'rms-' + i, at:c.time || '', by:who, text:(c.text || '') + (c.attachCount ? (c.text ? '\n' : '') + '📎 ' + c.attachCount + ' attachment(s) held in the SAP RMS' : ''), files:[] });
    });
    return q;
  });
  var team = SAP_TEAM.map(function(t){ return { no:t[0], name:t[1], position:t[2], dept:'sap' }; });
  return { reqs:reqs, team:team, dept:{ key:'sap', name:'SAP', sub:'S/4HANA programme · FICO, MM, HCM, PM, PS', prefix:'REQ', groupLabel:'Module',
    stages:['Not Started','In Progress','UAT','Completed'], typeLabel:'', types:[], people:team.map(function(t){ return t.name; }),
    source:'rms', canEdit:false, role:'viewer', rmsUrl:CFG.sapRmsUrl } };
}

// ── WRITE ───────────────────────────────────────────────────────────
function reqSheet_(dept) { return ss_(dept).getSheetByName('Requirements'); }
function findRow_(sh, id) {
  var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return -1;
}
function history_(dept, id, by, lines) {
  if (!lines || !lines.length) return;
  var sh = ss_(dept).getSheetByName('History'), t = now_();
  sh.getRange(sh.getLastRow() + 1, 1, lines.length, 4).setValues(lines.map(function(l){ return [t, id, by, l]; }));
}
function guard_(me, key) { var dept = dept_(key); if (!canWrite_(me, dept)) throw new Error(key === 'sap' ? 'SAP is read-only here. Update it in the SAP RMS.' : 'You have view access only for this department. Ask an admin to add you on the Access tab.'); return dept; }

function create_(me, p) {
  var dept = guard_(me, p.dept), f = p.fields || {};
  if (!f.title || !f.group) throw new Error('Title and ' + 'group are required.');
  var sh = reqSheet_(dept), st = settings_(ss_(dept)), prefix = st['ID Prefix'] || 'REQ';
  var ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().slice(1).map(function(r){ return +String(r[0]).split('-')[1] || 0; });
  var id = prefix + '-' + (Math.max.apply(null, ids.concat([1000])) + 1);
  var stage = list_(st['Stages'])[0] || 'New', today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var row = [id, today, f.group, f.type || '', f.title, f.notes || '', f.requester || '', f.rdept || '', f.priority || 'Medium', f.owner || '', '',
    f.target || '', stage, '', '[]', now_(), 'FALSE'];
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  history_(dept, id, me.name, ['Logged']);
  return { ok:true, id:id, created:today, stage:stage };
}

function update_(me, p) {
  var dept = guard_(me, p.dept), sh = reqSheet_(dept), r = findRow_(sh, p.id);
  if (r < 0) throw new Error('Requirement ' + p.id + ' not found.');
  var H = hdrIndex_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]), f = p.fields || {};
  Object.keys(f).forEach(function(k) {
    var col = FIELD_COL[k]; if (!col || H[col] === undefined) return;
    sh.getRange(r, H[col] + 1).setNumberFormat('@').setValue(f[k] === null ? '' : String(f[k]));
  });
  sh.getRange(r, H['Last Updated'] + 1).setValue(now_());
  history_(dept, p.id, me.name, p.history || []);
  return { ok:true };
}

function collab_(me, p) {
  var dept = guard_(me, p.dept), sh = reqSheet_(dept), r = findRow_(sh, p.id);
  if (r < 0) throw new Error('Requirement ' + p.id + ' not found.');
  var H = hdrIndex_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  sh.getRange(r, H['Collaborators'] + 1).setValue(JSON.stringify(p.list || []));
  sh.getRange(r, H['Last Updated'] + 1).setValue(now_());
  history_(dept, p.id, me.name, p.history || []);
  return { ok:true };
}

function comment_(me, p) {
  var dept = dept_(p.dept);
  if (dept.key === 'sap') throw new Error('Comment on SAP requirements in the SAP RMS.');
  // anyone signed in may comment; files need editor rights
  var files = [];
  if (p.files && p.files.length) {
    if (!canWrite_(me, dept)) throw new Error('Only editors can attach files.');
    var root = DriveApp.getFolderById(CFG.attachmentsFolderId);
    var it = root.getFoldersByName(dept.key), folder = it.hasNext() ? it.next() : root.createFolder(dept.key);
    p.files.forEach(function(f) {
      var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.type || 'application/octet-stream', f.name);
      var file = folder.createFile(blob).setName(p.id + ' · ' + f.name);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      files.push({ name:f.name, url:file.getUrl(), size:blob.getBytes().length, type:f.type || '' });
    });
  }
  var sh = ss_(dept).getSheetByName('Comments'), c = { id:'c' + Date.now(), at:now_(), by:me.name, email:me.email, text:String(p.text || ''), files:files };
  sh.appendRow([c.id, p.id, c.at, c.by, c.email, c.text, JSON.stringify(files)]);
  return { ok:true, comment:c };
}

// Run once from the editor to grant permissions and check the sheets open.
function setupCheck() {
  CFG.depts.forEach(function(d){ if (d.sheetId) Logger.log(d.key + ': ' + SpreadsheetApp.openById(d.sheetId).getName()); });
  Logger.log('SAP RMS: ' + SpreadsheetApp.openById(CFG.sapRmsSheetId).getName());
  Logger.log('Attachments: ' + DriveApp.getFolderById(CFG.attachmentsFolderId).getName());
}
