'use strict';
// ModruleSync -- UI layer. Talks only to ModruleSyncEngine (match-engine.js) and the DOM; nothing
// here ever touches a network request, per the spec's own hard "zero-backend" requirement. Plain
// script (no ES module, no framework) so the page works from a local file:// open, not just when
// served over http/https.
//
// Interaction model for the Sort screen (drag/select/search) is a deliberate port of the real
// PGPatcher Load Order Editor's own first-ever drag-and-drop list (vortex-collection-tools'
// web/public/pgpatcher-app.js, ~lines 437-654) -- same shift-click range-select, ctrl/cmd-click
// toggle-select, search-highlights-not-hides, per-row enabled toggle with bulk-apply, and the
// "Priority order" undo-Sort-A-Z button. Deliberately NOT ported: Cut/Paste and conflict-winner/loser
// highlighting -- both are specific to the live Load Order Editor's own conflict-resolution workflow,
// outside this tool's scope (spec's own UI flow has no conflicts concept at all).

// ---------- Screen navigation ----------
var MS_SCREENS = ['screenUpload', 'screenReport', 'screenReconcile', 'screenSort', 'screenDownload'];
function showScreen(id) {
  MS_SCREENS.forEach(function (s) {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

// ---------- State ----------
var msAuthorRules = null;
var msUserRules = null;
var msAuthorFileName = '';
var msUserFileName = '';

var msReport = null;          // { exact, normalized, review, newMods } -- see match-engine.js
var msReconcileWarned = false;

var msRankedNames = [];       // Sort screen, top -> bottom = highest -> lowest priority
var msUnrankedNames = [];
var msOriginalRankedOrder = []; // snapshot for the "Priority order" restore button
var msTags = new Map();       // name -> 'from-author' | 'hand-adjusted' (ranked panel display only)
var msEnabled = new Map();    // name -> boolean, seeded from the end-user's own file, user-editable
var msSelected = new Set();   // keys are `${panel}:${name}`
var msLastClicked = null;     // { panel, name } -- shift-click anchor
var msDragging = null;        // { names, fromPanel }
var msDownloadUrl = null;     // last-created object URL, revoked on rebuild/reset

// ---------- Upload screen ----------
function showUploadError(message) {
  var box = document.getElementById('uploadError');
  box.textContent = message;
  box.classList.remove('hidden');
}
function hideUploadError() {
  document.getElementById('uploadError').classList.add('hidden');
}

function dropCardParts(slot) {
  var card = document.getElementById(slot === 'author' ? 'dropAuthor' : 'dropUser');
  return {
    card: card,
    empty: card.querySelector('.drop-card__empty'),
    filled: card.querySelector('.drop-card__filled'),
  };
}

function renderDropCard(slot) {
  var parts = dropCardParts(slot);
  var rules = slot === 'author' ? msAuthorRules : msUserRules;
  var fname = slot === 'author' ? msAuthorFileName : msUserFileName;
  document.getElementById(slot === 'author' ? 'authorFileName' : 'userFileName').textContent = fname;
  document.getElementById(slot === 'author' ? 'authorFileMeta' : 'userFileMeta').textContent = Object.keys(rules).length + ' mods';
  parts.card.classList.add('drop-card--filled');
  parts.empty.classList.add('hidden');
  parts.filled.classList.remove('hidden');
}

function resetDropCard(slot) {
  var parts = dropCardParts(slot);
  parts.card.classList.remove('drop-card--filled');
  parts.empty.classList.remove('hidden');
  parts.filled.classList.add('hidden');
}

function updateBuildReportBtn() {
  document.getElementById('buildReportBtn').disabled = !(msAuthorRules && msUserRules);
}

function handleFile(slot, file) {
  hideUploadError();
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try {
      parsed = ModruleSyncEngine.parseModrulesJson(String(reader.result));
    } catch (e) {
      showUploadError((slot === 'author' ? "Author's file: " : "Your file: ") + e.message);
      return;
    }
    if (Object.keys(parsed).length === 0) {
      showUploadError((slot === 'author' ? "Author's file" : "Your file") + " has no mods in it — nothing to match against.");
      return;
    }
    if (slot === 'author') { msAuthorRules = parsed; msAuthorFileName = file.name; }
    else { msUserRules = parsed; msUserFileName = file.name; }
    renderDropCard(slot);
    updateBuildReportBtn();
  };
  reader.onerror = function () {
    showUploadError("Couldn't read that file — try choosing it again.");
  };
  reader.readAsText(file);
}

function wireDropZone(slot, dropId, inputId, chooseBtnId) {
  var drop = document.getElementById(dropId);
  var input = document.getElementById(inputId);
  var chooseBtn = document.getElementById(chooseBtnId);

  chooseBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    input.click();
  });
  drop.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () {
    if (input.files && input.files[0]) handleFile(slot, input.files[0]);
  });
  drop.addEventListener('dragover', function (e) {
    e.preventDefault();
    drop.classList.add('drop-card--dragover');
  });
  drop.addEventListener('dragleave', function () { drop.classList.remove('drop-card--dragover'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('drop-card--dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(slot, e.dataTransfer.files[0]);
  });
}
wireDropZone('author', 'dropAuthor', 'authorFileInput', 'chooseAuthorBtn');
wireDropZone('user', 'dropUser', 'userFileInput', 'chooseUserBtn');

document.getElementById('buildReportBtn').addEventListener('click', function () {
  if (!msAuthorRules || !msUserRules) return;
  msReport = ModruleSyncEngine.buildMatchReport(msAuthorRules, msUserRules);
  msReconcileWarned = false;
  msRenderReport();
  showScreen('screenReport');
});

// ---------- Match report screen ----------
document.querySelectorAll('.bucket__head[data-bucket]').forEach(function (head) {
  head.addEventListener('click', function () {
    var body = head.parentElement.querySelector('.bucket__body');
    if (body) body.classList.toggle('hidden');
  });
});

function msRenderReport() {
  var userCount = Object.keys(msUserRules).length;
  var authorCount = Object.keys(msAuthorRules).length;
  document.getElementById('reportSummary').textContent =
    userCount + ' of your mods checked against the author’s ' + authorCount + '.';

  document.getElementById('bucketExactCount').textContent = msReport.exact.length + ' mods';
  document.getElementById('bucketNormalizedCount').textContent = msReport.normalized.length + ' mods';
  document.getElementById('bucketReviewCount').textContent = msReport.review.length + ' mods';
  document.getElementById('bucketNewCount').textContent =
    msReport.newMods.length + ' mods — not in the author’s file, left exactly as they are. Nothing to do here.';

  var exactList = document.getElementById('bucketExactList');
  exactList.innerHTML = '';
  msReport.exact.slice().sort(function (a, b) { return a.userName.localeCompare(b.userName); }).forEach(function (m) {
    var d = document.createElement('div');
    d.textContent = m.userName;
    exactList.appendChild(d);
  });

  var normList = document.getElementById('bucketNormalizedList');
  normList.innerHTML = '';
  msReport.normalized.slice().sort(function (a, b) { return a.userName.localeCompare(b.userName); }).forEach(function (m) {
    var d = document.createElement('div');
    d.textContent = m.userName + '  →  ' + m.authorName;
    normList.appendChild(d);
  });
}

document.getElementById('reportBackBtn').addEventListener('click', function () { showScreen('screenUpload'); });
document.getElementById('reportContinueBtn').addEventListener('click', function () {
  if (msReport.review.length > 0) {
    msRenderReconcile();
    showScreen('screenReconcile');
  } else {
    initializeSortState();
    showScreen('screenSort');
  }
});

// ---------- Reconciliation screen ----------
// Gating choice (flagged per the build task's own instruction, judgment call): proceeding with
// pending rows is NOT hard-blocked -- a first click on Continue shows a nudge and requires a second
// click to actually proceed, rather than disabling the button outright. Every fuzzy match already
// requires human confirmation before it's ever applied (match-engine.js never auto-applies tier 3),
// so a forced-proceed row just falls back to "unranked", the same safe default as if the user had
// clicked "Leave unranked"/"Not the same mod" themselves -- nothing is silently mismatched, only
// silently left for later. A hard block felt more annoying than useful for a list that could have a
// dozen-plus rows on a large real collection.
function msRenderReconcile() {
  var container = document.getElementById('reconcileRows');
  container.innerHTML = '';

  msReport.review.forEach(function (row) {
    var stateClass = row.status === 'confirmed' ? ' reconcile-row--confirmed'
      : row.status === 'declined' ? ' reconcile-row--declined'
      : (row.candidates.length === 0 ? ' reconcile-row--none' : '');
    var div = document.createElement('div');
    div.className = 'reconcile-row' + stateClass;

    var modDiv = document.createElement('div');
    modDiv.className = 'reconcile-row__mod';
    var modLabel = document.createElement('div');
    modLabel.className = 'reconcile-row__label';
    modLabel.textContent = 'Your mod';
    var modName = document.createElement('div');
    modName.className = 'reconcile-row__name';
    modName.textContent = row.userName;
    modDiv.appendChild(modLabel);
    modDiv.appendChild(modName);
    div.appendChild(modDiv);

    var arrow = document.createElement('div');
    arrow.className = 'reconcile-row__arrow';
    arrow.textContent = '→';
    div.appendChild(arrow);

    var candDiv = document.createElement('div');
    candDiv.className = 'reconcile-row__candidate';
    if (row.candidates.length === 0) {
      candDiv.textContent = row.status === 'declined'
        ? 'Marked as a different mod — will stay unranked.'
        : 'No candidate found above the match threshold (another row may have already claimed it).';
    } else {
      var top = row.candidates[0];
      var label = document.createElement('div');
      label.className = 'reconcile-row__label';
      label.appendChild(document.createTextNode('Best candidate'));
      var score = document.createElement('span');
      score.className = 'reconcile-row__score';
      score.textContent = Math.round(top.score * 100) + '% match';
      label.appendChild(score);
      candDiv.appendChild(label);

      var nameEl = document.createElement('div');
      nameEl.className = 'reconcile-row__name';
      nameEl.textContent = row.status === 'confirmed' ? (row.chosenAuthorName || top.authorName) : top.authorName;
      candDiv.appendChild(nameEl);

      if (row.status === 'pending' && row.candidates.length > 1) {
        var multi = document.createElement('div');
        multi.className = 'reconcile-row__multi';
        var link = document.createElement('a');
        link.href = '#';
        var otherCount = row.candidates.length - 1;
        link.textContent = otherCount + ' other candidate' + (otherCount === 1 ? '' : 's');
        link.addEventListener('click', function (e) {
          e.preventDefault();
          msToggleCandidatePicker(row, candDiv);
        });
        multi.appendChild(link);
        candDiv.appendChild(multi);
      }
    }
    div.appendChild(candDiv);

    var actions = document.createElement('div');
    actions.className = 'reconcile-row__actions';
    if (row.status === 'confirmed' || row.status === 'declined') {
      var statusEl = document.createElement('span');
      statusEl.className = 'reconcile-row__status';
      if (row.status === 'declined') statusEl.style.color = 'var(--text-muted)';
      statusEl.textContent = row.status === 'confirmed' ? '✓ Confirmed' : 'Left unranked';
      var undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'btn btn--ghost btn--small';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', function () { msUndoReconcileRow(row); });
      actions.appendChild(statusEl);
      actions.appendChild(undoBtn);
    } else if (row.candidates.length > 0) {
      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn--success btn--small';
      confirmBtn.textContent = '✓ Confirm match';
      confirmBtn.addEventListener('click', function () { msConfirmReconcileRow(row, row.candidates[0].authorName); });
      var declineBtn = document.createElement('button');
      declineBtn.type = 'button';
      declineBtn.className = 'btn btn--danger-ghost btn--small';
      declineBtn.textContent = 'Not the same mod';
      declineBtn.addEventListener('click', function () { msDeclineReconcileRow(row); });
      actions.appendChild(confirmBtn);
      actions.appendChild(declineBtn);
    } else {
      var leaveBtn = document.createElement('button');
      leaveBtn.type = 'button';
      leaveBtn.className = 'btn btn--ghost btn--small';
      leaveBtn.textContent = 'Leave unranked';
      leaveBtn.addEventListener('click', function () { msDeclineReconcileRow(row); });
      actions.appendChild(leaveBtn);
    }
    div.appendChild(actions);

    container.appendChild(div);
  });
}

function msToggleCandidatePicker(row, candDiv) {
  var existing = candDiv.querySelector('.reconcile-row__picker');
  if (existing) { existing.remove(); return; }
  var picker = document.createElement('div');
  picker.className = 'reconcile-row__picker';
  row.candidates.slice(1).forEach(function (c) {
    var opt = document.createElement('span');
    opt.className = 'reconcile-row__candidate-pick';
    opt.textContent = c.authorName + ' (' + Math.round(c.score * 100) + '% match)';
    opt.addEventListener('click', function () { msConfirmReconcileRow(row, c.authorName); });
    picker.appendChild(opt);
  });
  candDiv.appendChild(picker);
}

function msResetReconcileNudge() {
  msReconcileWarned = false;
  document.getElementById('reconcileNudge').classList.add('hidden');
}

function msConfirmReconcileRow(row, authorName) {
  var cand = row.candidates.filter(function (c) { return c.authorName === authorName; })[0];
  row.status = 'confirmed';
  row.chosenAuthorName = authorName;
  row.chosenPriority = cand ? cand.priority : -1;
  // Claim this author entry everywhere else so two different unmatched mods can never both end up
  // confirmed against the same author priority.
  ModruleSyncEngine.removeCandidateEverywhere(msReport.review, authorName, row.userName);
  msResetReconcileNudge();
  msRenderReconcile();
}
function msDeclineReconcileRow(row) {
  row.status = 'declined';
  msResetReconcileNudge();
  msRenderReconcile();
}
function msUndoReconcileRow(row) {
  // Known, accepted v1 limitation (flagged in the handoff): undoing a confirmed match does NOT
  // restore that author entry to other rows it may have been silently removed from via
  // removeCandidateEverywhere above -- a rare double-undo edge case, not pursued further.
  row.status = 'pending';
  row.chosenAuthorName = null;
  row.chosenPriority = null;
  msRenderReconcile();
}

document.getElementById('reconcileBackBtn').addEventListener('click', function () { showScreen('screenReport'); });
document.getElementById('reconcileContinueBtn').addEventListener('click', function () {
  var pendingCount = msReport.review.filter(function (r) { return r.status === 'pending' && r.candidates.length > 0; }).length;
  if (pendingCount > 0 && !msReconcileWarned) {
    msReconcileWarned = true;
    var nudge = document.getElementById('reconcileNudge');
    nudge.textContent = '⚠ ' + pendingCount + ' mod' + (pendingCount === 1 ? '' : 's') + ' still need'
      + (pendingCount === 1 ? 's' : '') + ' review. Continuing now leaves ' + (pendingCount === 1 ? 'it' : 'them')
      + ' unranked — click Continue again to proceed anyway.';
    nudge.classList.remove('hidden');
    return;
  }
  msResetReconcileNudge();
  initializeSortState();
  showScreen('screenSort');
});

// ---------- Sort screen ----------
function initializeSortState() {
  var rankedEntries = [];
  msReport.exact.forEach(function (m) { rankedEntries.push({ name: m.userName, priority: m.priority, tag: 'from-author' }); });
  msReport.normalized.forEach(function (m) { rankedEntries.push({ name: m.userName, priority: m.priority, tag: 'from-author' }); });
  msReport.review.forEach(function (r) {
    if (r.status === 'confirmed' && r.chosenAuthorName) {
      rankedEntries.push({ name: r.userName, priority: (r.chosenPriority != null ? r.chosenPriority : -1), tag: 'from-author' });
    }
  });
  // Highest author priority first -- same descending order PGModManager::compareMods uses for real.
  rankedEntries.sort(function (a, b) { return b.priority - a.priority; });

  msRankedNames = rankedEntries.map(function (e) { return e.name; });
  msOriginalRankedOrder = msRankedNames.slice();
  msTags = new Map();
  rankedEntries.forEach(function (e) { msTags.set(e.name, e.tag); });

  var rankedSet = new Set(msRankedNames);
  msUnrankedNames = Object.keys(msUserRules).filter(function (name) { return !rankedSet.has(name); });

  msEnabled = new Map();
  Object.keys(msUserRules).forEach(function (name) {
    var existing = msUserRules[name] || {};
    msEnabled.set(name, existing.enabled !== undefined ? !!existing.enabled : true);
  });

  msSelected = new Set();
  msLastClicked = null;

  document.getElementById('sortLead').textContent =
    'Priorities are pre-filled from the author’s file. The ' + msUnrankedNames.length
    + ' mod' + (msUnrankedNames.length === 1 ? '' : 's') + ' the author’s file didn’t include land'
    + (msUnrankedNames.length === 1 ? 's' : '') + ' on the right, same as PGPatcher’s own real "new mod" state —'
    + ' drag any of them into the ranked list to give them a priority; leave them where they are otherwise.';

  msRenderSortAll();
}

function msKey(panel, name) { return panel + ':' + name; }
function msPanelList(panel) { return panel === 'ranked' ? msRankedNames : msUnrankedNames; }
function msPanelId(panel, suffix) { return panel + suffix; }

function msToggleEnabled(panel, name) {
  var k = msKey(panel, name);
  var bulk = msSelected.has(k) && msSelected.size > 1;
  var newState = !msEnabled.get(name);
  if (bulk) {
    msSelected.forEach(function (sk) { msEnabled.set(sk.slice(sk.indexOf(':') + 1), newState); });
  } else {
    msEnabled.set(name, newState);
  }
  msRenderSortAll();
}

function msRenderList(panel) {
  var container = document.getElementById(msPanelId(panel, 'List'));
  var filter = document.getElementById(msPanelId(panel, 'SearchInput')).value.trim().toLowerCase();
  container.innerHTML = '';
  var names = msPanelList(panel);
  var firstMatchRow = null;

  names.forEach(function (name, idx) {
    var isMatch = !!filter && name.toLowerCase().indexOf(filter) !== -1;
    var k = msKey(panel, name);
    var row = document.createElement('div');
    row.className = 'pgp-row' + (msSelected.has(k) ? ' selected' : '') + (isMatch ? ' search-match' : '');
    row.draggable = true;
    row.setAttribute('data-panel', panel);
    row.setAttribute('data-name', name);
    if (isMatch && !firstMatchRow) firstMatchRow = row;

    var handle = document.createElement('span');
    handle.className = 'pgp-row__handle';
    handle.textContent = '::';
    row.appendChild(handle);

    if (panel === 'ranked') {
      var modEnabled = msEnabled.get(name);
      var isBulkTarget = msSelected.has(k) && msSelected.size > 1;
      var toggle = document.createElement('span');
      toggle.className = 'pgp-row__toggle' + (modEnabled ? ' enabled' : '');
      toggle.title = (modEnabled ? 'Will be patched' : 'Won’t be patched')
        + (isBulkTarget ? (' — click to toggle all ' + msSelected.size + ' selected mods') : ' — click to toggle');
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        msToggleEnabled(panel, name);
      });
      row.appendChild(toggle);

      var rank = document.createElement('span');
      rank.className = 'pgp-row__rank';
      rank.textContent = String(idx + 1);
      row.appendChild(rank);
    }

    var nameEl = document.createElement('span');
    nameEl.className = 'pgp-row__name';
    nameEl.textContent = name;
    row.appendChild(nameEl);

    if (panel === 'ranked') {
      var tag = msTags.get(name);
      if (tag) {
        var tagEl = document.createElement('span');
        tagEl.className = 'pgp-row__tag ' + (tag === 'from-author' ? 'pgp-row__tag--applied' : 'pgp-row__tag--adjusted');
        tagEl.textContent = tag === 'from-author' ? 'from author' : 'hand-adjusted';
        row.appendChild(tagEl);
      }
    }

    row.addEventListener('click', function (e) {
      if (e.shiftKey && msLastClicked && msLastClicked.panel === panel) {
        var list = msPanelList(panel);
        var a = list.indexOf(msLastClicked.name);
        var b = list.indexOf(name);
        var lo = Math.min(a, b), hi = Math.max(a, b);
        for (var i = lo; i <= hi; i++) msSelected.add(msKey(panel, list[i]));
      } else if (e.ctrlKey || e.metaKey) {
        if (msSelected.has(k)) msSelected.delete(k); else msSelected.add(k);
      } else {
        msSelected.clear();
        msSelected.add(k);
      }
      msLastClicked = { panel: panel, name: name };
      msRenderSortAll();
    });

    row.addEventListener('dragstart', function () {
      // Deliberately no re-render here even if this row wasn't already selected -- rebuilding the
      // DOM mid-drag would destroy the element the browser is currently dragging.
      if (!msSelected.has(k)) { msSelected.clear(); msSelected.add(k); }
      var draggedNames = Array.from(msSelected)
        .filter(function (s) { return s.indexOf(panel + ':') === 0; })
        .map(function (s) { return s.slice(panel.length + 1); });
      msDragging = { names: draggedNames, fromPanel: panel };
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
    row.addEventListener('dragover', function (e) { e.preventDefault(); });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      if (msDragging) msHandleDrop(panel, name);
    });

    container.appendChild(row);
  });

  if (firstMatchRow) firstMatchRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
  container.addEventListener('dragover', function (e) { e.preventDefault(); });
  container.addEventListener('drop', function (e) {
    e.preventDefault();
    if (msDragging && e.target === container) msHandleDrop(panel, null);
  });
}

function msHandleDrop(targetPanel, beforeName) {
  if (!msDragging) return;
  var names = msDragging.names, fromPanel = msDragging.fromPanel;
  var fromList = msPanelList(fromPanel);
  for (var i = fromList.length - 1; i >= 0; i--) {
    if (names.indexOf(fromList[i]) !== -1) fromList.splice(i, 1);
  }
  var toList = msPanelList(targetPanel);
  var insertAt = toList.length;
  if (beforeName) {
    var foundAt = toList.indexOf(beforeName);
    if (foundAt !== -1) insertAt = foundAt;
  }
  toList.splice.apply(toList, [insertAt, 0].concat(names));

  // Any mod landing in Ranked as a result of a drag is, by definition, a hand adjustment -- "from
  // author" specifically means "still exactly where the author's own priority put it" (mockup's own
  // two-tag design). Leaving Ranked entirely drops the tag; there's nothing to tag in New Mods.
  if (targetPanel === 'ranked') {
    names.forEach(function (n) { msTags.set(n, 'hand-adjusted'); });
  } else {
    names.forEach(function (n) { msTags.delete(n); });
  }

  // Carry selection across the panel switch (delete the old `fromPanel:name` key, add the new
  // `toPanel:name` one) -- without this, a dragged row's stale selection key lingers in the panel it
  // just LEFT, so that panel's own selection-count readout keeps showing a nonzero count even once
  // it's empty. Caught live during this build's own browser verification pass.
  names.forEach(function (n) {
    if (msSelected.has(msKey(fromPanel, n))) {
      msSelected.delete(msKey(fromPanel, n));
      msSelected.add(msKey(targetPanel, n));
    }
  });

  msDragging = null;
  msRenderSortAll();
}

function msRenderSortAll() {
  msRenderList('ranked');
  msRenderList('unranked');
  document.getElementById('rankedCount').textContent = String(msRankedNames.length);
  document.getElementById('unrankedCount').textContent = String(msUnrankedNames.length);
  ['ranked', 'unranked'].forEach(function (panel) {
    var n = Array.from(msSelected).filter(function (sk) { return sk.indexOf(panel + ':') === 0; }).length;
    document.getElementById(msPanelId(panel, 'SelectionCount')).textContent = n > 0 ? (n + ' selected') : '';
  });
}

function msWireToolbar(panel) {
  document.getElementById(msPanelId(panel, 'SearchInput')).addEventListener('input', msRenderSortAll);
  document.getElementById(msPanelId(panel, 'SortAzBtn')).addEventListener('click', function () {
    msPanelList(panel).sort(function (a, b) { return a.localeCompare(b); });
    msRenderSortAll();
  });
  document.getElementById(msPanelId(panel, 'SelectAllBtn')).addEventListener('click', function () {
    msPanelList(panel).forEach(function (name) { msSelected.add(msKey(panel, name)); });
    msRenderSortAll();
  });
  document.getElementById(msPanelId(panel, 'ClearSelBtn')).addEventListener('click', function () {
    Array.from(msSelected).forEach(function (sk) { if (sk.indexOf(panel + ':') === 0) msSelected.delete(sk); });
    msRenderSortAll();
  });
  document.getElementById(msPanelId(panel, 'InvertBtn')).addEventListener('click', function () {
    msPanelList(panel).forEach(function (name) {
      var k = msKey(panel, name);
      if (msSelected.has(k)) msSelected.delete(k); else msSelected.add(k);
    });
    msRenderSortAll();
  });
}
msWireToolbar('ranked');
msWireToolbar('unranked');

// Ranked panel only -- restores pgpOriginalRankedOrder's relative order for every mod still ranked;
// anything dragged INTO ranked since (not in that snapshot) is appended at the end, preserving its
// own relative order. A mod dragged OUT since is simply no longer in msRankedNames, correctly left
// alone in New Mods.
document.getElementById('rankedPriorityOrderBtn').addEventListener('click', function () {
  var snapshotSet = new Set(msOriginalRankedOrder);
  var stillPresent = msOriginalRankedOrder.filter(function (name) { return msRankedNames.indexOf(name) !== -1; });
  var draggedInSince = msRankedNames.filter(function (name) { return !snapshotSet.has(name); });
  msRankedNames = stillPresent.concat(draggedInSince);
  msRenderSortAll();
});

document.getElementById('sortBackBtn').addEventListener('click', function () { showScreen('screenReport'); });
document.getElementById('sortContinueBtn').addEventListener('click', function () {
  msBuildDownload();
  showScreen('screenDownload');
});

// ---------- Download screen ----------
function msBuildDownload() {
  var enabledObj = {};
  msEnabled.forEach(function (v, k) { enabledObj[k] = v; });
  var finalRules = ModruleSyncEngine.buildFinalRules(msUserRules, msRankedNames, msUnrankedNames, enabledObj);
  var json = JSON.stringify(finalRules, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  if (msDownloadUrl) URL.revokeObjectURL(msDownloadUrl);
  msDownloadUrl = URL.createObjectURL(blob);
  document.getElementById('downloadBtn').href = msDownloadUrl;
}

document.getElementById('startOverBtn').addEventListener('click', function () {
  msAuthorRules = null; msUserRules = null; msAuthorFileName = ''; msUserFileName = '';
  msReport = null; msReconcileWarned = false;
  msRankedNames = []; msUnrankedNames = []; msOriginalRankedOrder = [];
  msTags = new Map(); msEnabled = new Map(); msSelected = new Set(); msLastClicked = null; msDragging = null;
  if (msDownloadUrl) { URL.revokeObjectURL(msDownloadUrl); msDownloadUrl = null; }
  resetDropCard('author');
  resetDropCard('user');
  document.getElementById('authorFileInput').value = '';
  document.getElementById('userFileInput').value = '';
  hideUploadError();
  updateBuildReportBtn();
  showScreen('screenUpload');
});
