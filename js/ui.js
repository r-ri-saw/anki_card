/**
 * ui.js  ─  画面遷移・共通 UI ヘルパー
 */

const UI = (() => {

  // ── 画面遷移 ────────────────────────────────────────
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');
    // スクロールを先頭に戻す
    const sc = el.querySelector('.page-scroll');
    if (sc) sc.scrollTop = 0;
  }

  // ── トースト通知 ─────────────────────────────────────
  function toast(msg, type = 'info', duration = 2800) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `toast toast-${type} show`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── ローディングオーバーレイ ─────────────────────────
  function showLoading(msg = '読み込み中…') {
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading-overlay').classList.add('show');
  }
  function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('show');
  }

  // ── モーダル ─────────────────────────────────────────
  /**
   * シンプル確認ダイアログ
   * @returns {Promise<boolean>}
   */
  function confirm(title, message, okLabel = 'OK', cancelLabel = 'キャンセル') {
    return new Promise(resolve => {
      const modal = document.getElementById('confirm-modal');
      modal.querySelector('.cm-title').textContent   = title;
      modal.querySelector('.cm-message').textContent = message;
      const okBtn  = modal.querySelector('.cm-ok');
      const noBtn  = modal.querySelector('.cm-cancel');
      okBtn.textContent     = okLabel;
      cancelLabel ? noBtn.textContent = cancelLabel : noBtn.style.display = 'none';

      const cleanup = (val) => {
        modal.classList.remove('open');
        okBtn.onclick  = null;
        noBtn.onclick  = null;
        noBtn.style.display = '';
        resolve(val);
      };
      okBtn.onclick  = () => cleanup(true);
      noBtn.onclick  = () => cleanup(false);
      modal.classList.add('open');
    });
  }

  // ── 科目カラーパレット ────────────────────────────────
  const PALETTE = [
    { bg: '#4f8ef7', light: '#deeaff' },
    { bg: '#f7884f', light: '#ffeadc' },
    { bg: '#4fcb7e', light: '#d6f7e7' },
    { bg: '#a78bfa', light: '#ede9fe' },
    { bg: '#f7c44f', light: '#fef9e7' },
    { bg: '#f06292', light: '#fce4ec' },
    { bg: '#26c6da', light: '#e0f7fa' },
    { bg: '#ff8a65', light: '#fbe9e7' },
  ];
  const _colorMap = {};

  function subjectColor(subject) {
    if (!_colorMap[subject]) {
      const idx = Object.keys(_colorMap).length % PALETTE.length;
      _colorMap[subject] = PALETTE[idx];
    }
    return _colorMap[subject];
  }

  function setAccent(subject) {
    const c = subjectColor(subject);
    document.documentElement.style.setProperty('--accent',       c.bg);
    document.documentElement.style.setProperty('--accent-light', c.light);
  }

  // ── アイコン推定 ──────────────────────────────────────
  function subjectIcon(name) {
    if (/理科/.test(name))         return '🔬';
    if (/社会|地理|歴史|公民/.test(name)) return '🌍';
    if (/英語/.test(name))         return '🔤';
    if (/数学/.test(name))         return '📐';
    if (/国語/.test(name))         return '📖';
    if (/音楽/.test(name))         return '🎵';
    if (/美術|図工/.test(name))    return '🎨';
    if (/体育/.test(name))         return '⚽';
    return '📚';
  }

  // ── 数値フォーマット ──────────────────────────────────
  function fmt(n) { return n.toLocaleString(); }

  return { show, toast, showLoading, hideLoading, confirm, subjectColor, setAccent, subjectIcon, fmt };
})();
