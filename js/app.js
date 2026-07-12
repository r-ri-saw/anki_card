/**
 * app.js  ─  アプリケーション全体制御
 * 依存: db.js / loader.js / sm2.js / session.js / ui.js
 */

// ============================================================
// アプリ状態
// ============================================================
let _allData     = {};   // { subject: [card,...] }
let _currentSubj = null;
let _activeUnits = new Set();
let _srMap       = {};   // 現在科目の SR キャッシュ

// ============================================================
// 起動
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  bindGlobalEvents();
  await boot();
});

async function boot() {
  UI.showLoading('データを確認中…');
  try {
    await DB.open();

    // ① オンラインなら GitHub から最新を取得・差分更新
    const syncResult = await Loader.syncFromRemote();

    // ② DB から問題データをロード
    _allData = await DB.getAllQuestions();
    const hasData = Object.keys(_allData).length > 0;

    UI.hideLoading();

    if (!hasData) {
      // 保存済みデータなし・オフライン or 取得失敗
      showNoDataScreen(syncResult);
      return;
    }

    // 同期結果をトーストで通知
    if (syncResult.status === 'updated') {
      UI.toast(`更新しました（${syncResult.subjects}科目・${syncResult.total}問）`, 'success');
    } else if (syncResult.status === 'offline') {
      UI.toast('オフライン：保存済みデータを使用します', 'warn', 3000);
    } else if (syncResult.status === 'error') {
      UI.toast('最新データを取得できませんでした。保存済みデータを使用します。', 'warn', 4000);
    }
    // 'no-change' はトースト不要（静か）

    renderHome();
    UI.show('screen-home');

  } catch (e) {
    UI.hideLoading();
    showNoDataScreen({ status: 'error', message: 'データベースの初期化に失敗しました。' });
  }
}

// データがない場合の画面
function showNoDataScreen(syncResult) {
  const msgEl = document.getElementById('nodata-message');
  if (syncResult.status === 'offline' || syncResult.status === 'error') {
    msgEl.textContent = '問題データを取得できませんでした。\nネット接続を確認して再度お試しください。';
  } else {
    msgEl.textContent = '問題データを取得してください。';
  }
  UI.show('screen-nodata');
}

// ============================================================
// グローバルイベント
// ============================================================
function bindGlobalEvents() {
  // 「再試行」ボタン（no-data 画面）
  document.getElementById('btn-retry').addEventListener('click', boot);
}

// ============================================================
// ホーム画面
// ============================================================
async function renderHome() {
  const subjects  = Object.keys(_allData);
  const container = document.getElementById('subject-cards');
  container.innerHTML = '';

  let totalDue = 0;

  for (const subj of subjects) {
    const cards = _allData[subj];
    const srMap = await DB.getAllSR(subj);
    const stats = Session.calcStats(cards, srMap);
    totalDue += stats.dueTotal;

    const color = UI.subjectColor(subj);
    const pct   = stats.total > 0 ? Math.round(stats.masterCount / stats.total * 100) : 0;

    const card = document.createElement('div');
    card.className = 'subj-card';
    card.style.setProperty('--subj-color', color.bg);
    card.style.setProperty('--subj-light', color.light);
    card.innerHTML = `
      <div class="subj-card-header">
        <span class="subj-icon">${UI.subjectIcon(subj)}</span>
        <div class="subj-info">
          <div class="subj-name">${subj}</div>
          <div class="subj-count">${stats.total}問</div>
        </div>
        <div class="subj-due ${stats.dueTotal > 0 ? 'has-due' : ''}">
          <span class="due-num">${stats.dueTotal}</span>
          <span class="due-lbl">今日</span>
        </div>
      </div>
      <div class="subj-progress">
        <div class="subj-bar-bg">
          <div class="subj-bar-fill" style="width:${pct}%;background:${color.bg}"></div>
        </div>
        <span class="subj-pct">${pct}%</span>
      </div>
      <div class="subj-stats">
        <span>🆕 新規 ${stats.newCount}</span>
        <span>📚 学習済 ${stats.learnedCount}</span>
        <span>⭐ マスター ${stats.masterCount}</span>
      </div>`;
    card.addEventListener('click', () => openSubject(subj));
    container.appendChild(card);
  }

  const badge = document.getElementById('home-due-badge');
  badge.textContent  = totalDue > 0 ? totalDue : '';
  badge.style.display = totalDue > 0 ? 'inline-flex' : 'none';
}

// ============================================================
// 問題データ更新（手動ボタン）
// ============================================================
async function updateData() {
  const ok = await UI.confirm(
    '問題データを更新',
    'GitHub から最新の問題データを取得します。\n学習履歴（SR記録）はそのまま保持されます。',
    '更新する', 'キャンセル'
  );
  if (!ok) return;

  UI.showLoading('最新データを取得中…');

  // etag をリセットして強制再取得
  await DB.setMeta('dataEtag', null);

  const result = await Loader.syncFromRemote();
  _allData = await DB.getAllQuestions();
  UI.hideLoading();

  if (result.status === 'updated') {
    UI.toast(`更新しました（${result.subjects}科目・${result.total}問）`, 'success');
    renderHome();
    UI.show('screen-home');
  } else if (result.status === 'offline') {
    UI.toast('オフラインのため更新できませんでした', 'warn');
  } else {
    UI.toast('最新データを取得できませんでした。保存済みデータを使用します。', 'warn', 4000);
  }
}

// ============================================================
// 科目メニュー画面
// ============================================================
async function openSubject(subj) {
  _currentSubj = subj;
  _srMap       = await DB.getAllSR(subj);
  _activeUnits = new Set(getUnits());

  UI.setAccent(subj);

  const cards = _allData[subj];
  const stats = Session.calcStats(cards, _srMap);
  const color = UI.subjectColor(subj);

  document.getElementById('subj-title').textContent = UI.subjectIcon(subj) + ' ' + subj;

  const pct = stats.total > 0 ? Math.round(stats.masterCount / stats.total * 100) : 0;
  document.getElementById('sm-total').textContent    = stats.total;
  document.getElementById('sm-new').textContent      = stats.newCount;
  document.getElementById('sm-today').textContent    = stats.dueTotal;
  document.getElementById('sm-learned').textContent  = stats.learnedCount;
  document.getElementById('sm-master').textContent   = stats.masterCount;
  document.getElementById('sm-bar').style.width      = pct + '%';
  document.getElementById('sm-bar').style.background = color.bg;
  document.getElementById('sm-pct').textContent      = pct + '%';

  renderUnitList();
  UI.show('screen-subject');
}

// ── 単元リスト ────────────────────────────────────────────
function getUnits() {
  if (!_currentSubj || !_allData[_currentSubj]) return [];
  return [...new Set(_allData[_currentSubj].map(c => c.unit))];
}

function filteredCards() {
  if (!_currentSubj) return [];
  return _allData[_currentSubj].filter(c => _activeUnits.has(c.unit));
}

function renderUnitList() {
  const units = getUnits();
  const list  = document.getElementById('unit-list');
  list.innerHTML = '';

  units.forEach(unit => {
    const short  = unit.includes('：') ? unit.split('：').slice(1).join('：') : unit;
    const cnt    = _allData[_currentSubj].filter(c => c.unit === unit).length;
    const sel    = _activeUnits.has(unit);
    const li     = document.createElement('label');
    li.className = 'unit-item' + (sel ? ' sel' : '');
    li.innerHTML = `
      <input type="checkbox" ${sel ? 'checked' : ''} data-unit="${unit}" style="display:none">
      <span class="unit-check">${sel ? '✓' : ''}</span>
      <span class="unit-name">${short}</span>
      <span class="unit-cnt">${cnt}問</span>`;
    li.querySelector('input').addEventListener('change', e => {
      const u = e.target.dataset.unit;
      e.target.checked ? _activeUnits.add(u) : _activeUnits.delete(u);
      li.classList.toggle('sel', e.target.checked);
      li.querySelector('.unit-check').textContent = e.target.checked ? '✓' : '';
    });
    list.appendChild(li);
  });
}

function selectAllUnits() { getUnits().forEach(u => _activeUnits.add(u)); renderUnitList(); }
function clearAllUnits()  { _activeUnits.clear();                          renderUnitList(); }

// ============================================================
// 学習開始
// ============================================================
async function startStudy(mode) {
  const cards = filteredCards();
  if (cards.length === 0) {
    UI.toast('単元を1つ以上選んでください', 'warn');
    return;
  }

  const result = Session.start(_currentSubj, cards, mode, _srMap);
  if (!result.ok) {
    UI.toast(result.message, 'warn', 3500);
    return;
  }

  const modeLabel = {
    today:  '📅 今日の復習',
    all:    '📋 全問題',
    weak:   '💪 苦手問題',
    random: '🎲 ランダム',
  }[mode] || mode;

  document.getElementById('study-mode-label').textContent = modeLabel;
  renderStudyCard();
  UI.show('screen-study');
}

// ============================================================
// 学習画面
// ============================================================
function renderStudyCard() {
  const card  = Session.currentCard();
  const total = Session.initLength();
  const done  = Session.doneCount();
  const pct   = Session.progress() * 100;

  document.getElementById('card-unit').textContent  = card.unit;
  document.getElementById('card-q').textContent     = card.q;
  document.getElementById('card-a').textContent     = card.a;
  document.getElementById('study-prog-txt').textContent  = `${done + 1} / ${total}`;
  document.getElementById('study-prog-fill').style.width = pct + '%';

  document.getElementById('answer-section').classList.add('hidden');
  document.getElementById('btn-show-answer').classList.remove('hidden');
  document.getElementById('btn-show-answer').disabled = false;
}

function showAnswer() {
  document.getElementById('answer-section').classList.remove('hidden');
  document.getElementById('btn-show-answer').classList.add('hidden');
  setTimeout(() => {
    document.getElementById('answer-section')
      .scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 80);
}

async function judge(quality) {
  document.querySelectorAll('.judge-btn').forEach(b => b.disabled = true);
  const result = await Session.judge(quality);
  if (result.finished) {
    renderFinish();
    UI.show('screen-finish');
  } else {
    renderStudyCard();
  }
}

// ============================================================
// 完了画面
// ============================================================
function renderFinish() {
  const s   = Session.getStats();
  const pct = s.done > 0 ? Math.round(s.good / s.done * 100) : 0;

  let emoji = '😅', title = 'よく頑張りました！';
  if      (pct >= 90) { emoji = '🏆'; title = '完璧！すばらしい！'; }
  else if (pct >= 70) { emoji = '🎉'; title = 'とてもいい感じ！'; }
  else if (pct >= 50) { emoji = '😊'; title = 'なかなかいい感じ！'; }
  else if (pct >= 30) { emoji = '🤔'; title = 'もう少しで覚えられる！'; }

  document.getElementById('fin-emoji').textContent    = emoji;
  document.getElementById('fin-title').textContent    = title;
  document.getElementById('fin-pct').textContent      = pct + '%';
  document.getElementById('f-done').textContent       = s.done   + '問';
  document.getElementById('f-good').textContent       = s.good   + '問';
  document.getElementById('f-almost').textContent     = s.almost + '問';
  document.getElementById('f-wrong').textContent      = s.wrong  + '問';

  DB.getAllSR(_currentSubj).then(sr => { _srMap = sr; });
}

// ============================================================
// リセット
// ============================================================
async function resetSubjectData() {
  const ok = await UI.confirm(
    '学習データをリセット',
    `「${_currentSubj}」の学習記録をすべて削除します。\nこの操作は元に戻せません。`,
    'リセット', 'キャンセル'
  );
  if (!ok) return;
  await DB.resetSR(_currentSubj);
  _srMap = {};
  UI.toast('リセットしました', 'success');
  await openSubject(_currentSubj);
}

// ============================================================
// ナビゲーション
// ============================================================
function goHome() {
  renderHome();
  UI.show('screen-home');
}

function goSubject() {
  _currentSubj ? openSubject(_currentSubj) : goHome();
}
