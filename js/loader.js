/**
 * loader.js  ─  問題データ取得・パース
 *
 * 【設計方針】
 *   DataSource インターフェースを介してデータを取得する。
 *   現在の実装: GitHub Pages 上の Excel ファイルを fetch
 *
 *   将来 JSON に切り替える場合:
 *     DataSource.current = DataSource.json('data/cards.json');
 *
 * 【列構成】A:ID  B:単元  C:問題  D:答え  （1行目はヘッダー）
 * 【シート名】= 科目名
 */

// ============================================================
// Parser  ─  バイナリ/テキスト → カードオブジェクト変換
// ============================================================
const Parser = (() => {

  function rowToCard(row, subject, rowIndex) {
    const id   = String(row[0] ?? '').trim();
    const unit = String(row[1] ?? '').trim();
    const q    = String(row[2] ?? '').trim();
    const a    = String(row[3] ?? '').trim();
    if (!id || !q || !a) return null;
    // rowIndex: Excelの行順を保持するために使用（単元フィルターの並び順に影響）
    return { id: `${subject}::${id}`, cardId: id, subject, unit: unit || '未分類', q, a, rowIndex };
  }

  /** ArrayBuffer → { subject: [card,...] } */
  function xlsx(arrayBuffer) {
    const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const result = {};
    wb.SheetNames.forEach(name => {
      const rows  = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      const cards = rows.slice(1).map((r, i) => rowToCard(r, name, i)).filter(Boolean);
      if (cards.length > 0) result[name] = cards;
    });
    return result;
  }

  /**
   * JSON 形式（将来用）
   * 期待する形式:
   * { "理科": [ {"id":"s1","unit":"生命","q":"...","a":"..."}, ... ], ... }
   */
  function json(obj) {
    const result = {};
    Object.entries(obj).forEach(([subject, rows]) => {
      const cards = rows
        .map((r, i) => rowToCard([r.id, r.unit, r.q, r.a], subject, i))
        .filter(Boolean);
      if (cards.length > 0) result[subject] = cards;
    });
    return result;
  }

  return { xlsx, json };
})();

// ============================================================
// DataSource  ─  取得戦略の抽象レイヤー
// ============================================================
const DataSource = (() => {

  /**
   * Excel ソース（現在の実装）
   * @param {string} url  fetch する URL（ASCII のみ推奨）
   */
  function excel(url) {
    return {
      type: 'excel',
      url,
      async fetch() {
        // タイムアウト 15 秒
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await globalThis.fetch(url, {
            cache: 'no-cache',
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText}): ${url}`);

          const buf  = await res.arrayBuffer();
          if (buf.byteLength === 0) throw new Error('ファイルが空です: ' + url);

          // ETag → Last-Modified → ファイルサイズ の順で変更識別子を取得
          const etag = res.headers.get('ETag')
                    || res.headers.get('Last-Modified')
                    || String(buf.byteLength);

          return { data: Parser.xlsx(buf), etag, size: buf.byteLength };

        } catch (err) {
          clearTimeout(timer);
          if (err.name === 'AbortError') throw new Error('タイムアウト: ' + url);
          throw err;
        }
      },
    };
  }

  /**
   * JSON ソース（将来用）
   * cards.json に切り替える場合はここを差し替えるだけ
   */
  function json(url) {
    return {
      type: 'json',
      url,
      async fetch() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await globalThis.fetch(url, {
            cache: 'no-cache',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
          const obj  = await res.json();
          const etag = res.headers.get('ETag')
                    || res.headers.get('Last-Modified')
                    || JSON.stringify(obj).length.toString();
          return { data: Parser.json(obj), etag, size: 0 };
        } catch (err) {
          clearTimeout(timer);
          if (err.name === 'AbortError') throw new Error('タイムアウト: ' + url);
          throw err;
        }
      },
    };
  }

  // ★ 現在使用するデータソースをここで指定 ★
  // ファイル名は ASCII のみ（日本語ファイル名は fetch で失敗することがある）
  // 将来 JSON に切り替える場合: current = json('data/cards.json');
  const current = excel('data/cards.xlsx');

  return { excel, json, current };
})();

// ============================================================
// Loader  ─  公開 API
// ============================================================
const Loader = (() => {

  /**
   * リモートからデータを取得し、変更があれば DB を更新する。
   *
   * 処理フロー:
   *   1. fetch で Excel を取得
   *   2. 保存済み etag と比較 → 同一なら 'no-change'
   *   3. 異なれば DB.saveQuestions()（SR は保持）
   *
   * ※ navigator.onLine はスマホで誤判定があるため「オフライン確定」
   *    の判定には使わず、fetch の失敗だけを判断基準にする。
   *
   * @returns {Promise<{
   *   status: 'updated'|'no-change'|'offline'|'error',
   *   message: string,
   *   detail?: string,    ← デバッグ用エラー詳細
   *   subjects?: number,
   *   total?: number,
   * }>}
   */
  async function syncFromRemote() {
    let fetchResult;
    try {
      fetchResult = await DataSource.current.fetch();
    } catch (err) {
      // fetch 失敗 = ネット未接続 or URL誤り or サーバーエラー
      const isOffline = !navigator.onLine
                     || err.message.includes('Failed to fetch')
                     || err.message.includes('NetworkError')
                     || err.message.includes('network');
      return {
        status:  isOffline ? 'offline' : 'error',
        message: isOffline
          ? 'オフラインです。保存済みデータを使用します。'
          : '最新データを取得できませんでした。保存済みデータを使用します。',
        detail: err.message,
      };
    }

    // バリデーション
    const v = validate(fetchResult.data);
    if (!v.ok) {
      return { status: 'error', message: v.msg, detail: 'validate failed' };
    }

    // 変更チェック（etag が同じなら更新不要）
    const savedEtag = await DB.getMeta('dataEtag');
    if (savedEtag && savedEtag === fetchResult.etag) {
      return { status: 'no-change', message: '問題データは最新です。' };
    }

    // DB 更新（SR データは saveQuestions が保持する）
    try {
      await DB.saveQuestions(fetchResult.data);
      await DB.setMeta('dataEtag',    fetchResult.etag);
      await DB.setMeta('lastUpdated', new Date().toISOString());
      await DB.setMeta('dataVersion', ((await DB.getMeta('dataVersion')) || 0) + 1);
    } catch (err) {
      return { status: 'error', message: 'データの保存に失敗しました。', detail: err.message };
    }

    return {
      status:   'updated',
      message:  '問題データを更新しました。',
      subjects: v.subjects,
      total:    v.total,
    };
  }

  /** バリデーション */
  function validate(data) {
    const subjects = Object.keys(data);
    if (subjects.length === 0) {
      return { ok: false, msg: '問題データが見つかりませんでした。列構成（ID・単元・問題・答え）を確認してください。' };
    }
    const total = subjects.reduce((s, k) => s + data[k].length, 0);
    return { ok: true, subjects: subjects.length, total };
  }

  return { syncFromRemote, validate };
})();
