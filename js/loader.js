/**
 * loader.js  ─  問題データ取得・パース
 *
 * 【設計方針】
 *   DataSource インターフェースを介してデータを取得する。
 *   現在の実装: GitHub Pages 上の Excel ファイルを fetch
 *   将来の切り替え例:
 *     DataSource.current = DataSource.json('data/cards.json');
 *
 * 【列構成】A:ID  B:単元  C:問題  D:答え  （1行目はヘッダー）
 * 【シート名】= 科目名
 *
 * 返り値: { "理科": [{id,cardId,subject,unit,q,a}, ...], ... }
 */

// ============================================================
// パーサー（フォーマット非依存）
// ============================================================
const Parser = (() => {

  function rowToCard(row, subject) {
    const id   = String(row[0] ?? '').trim();
    const unit = String(row[1] ?? '').trim();
    const q    = String(row[2] ?? '').trim();
    const a    = String(row[3] ?? '').trim();
    if (!id || !q || !a) return null;
    return { id: `${subject}::${id}`, cardId: id, subject, unit: unit || '未分類', q, a };
  }

  /** ArrayBuffer → { subject: [card,...] } */
  function xlsx(arrayBuffer) {
    const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const result = {};
    wb.SheetNames.forEach(name => {
      const rows  = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      const cards = rows.slice(1).map(r => rowToCard(r, name)).filter(Boolean);
      if (cards.length > 0) result[name] = cards;
    });
    return result;
  }

  /** JSON 形式（将来用）
   *  期待する形式:
   *  { "理科": [ {"id":"s1","unit":"生命","q":"...","a":"..."}, ... ], ... }
   */
  function json(obj) {
    const result = {};
    Object.entries(obj).forEach(([subject, rows]) => {
      const cards = rows
        .map(r => rowToCard([r.id, r.unit, r.q, r.a], subject))
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
   * @param {string} url  fetch する URL
   */
  function excel(url) {
    return {
      type: 'excel',
      url,
      /** @returns {Promise<{data:Object, etag:string|null, size:number}>} */
      async fetch() {
        const res = await globalThis.fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        const buf  = await res.arrayBuffer();
        const etag = res.headers.get('ETag') || res.headers.get('Last-Modified') || null;
        return {
          data:  Parser.xlsx(buf),
          etag:  etag || String(buf.byteLength),   // ETag がなければサイズで代替
          size:  buf.byteLength,
        };
      },
    };
  }

  /**
   * JSON ソース（将来用）
   * cards.json に切り替える場合はここを差し替えるだけ
   * @param {string} url
   */
  function json(url) {
    return {
      type: 'json',
      url,
      async fetch() {
        const res = await globalThis.fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        const obj  = await res.json();
        const etag = res.headers.get('ETag') || res.headers.get('Last-Modified') || null;
        return {
          data:  Parser.json(obj),
          etag:  etag || JSON.stringify(obj).length.toString(),
          size:  0,
        };
      },
    };
  }

  // ★ 現在使用するデータソースをここで指定 ★
  // 将来 JSON に切り替える場合: current = json('data/cards.json');
  const current = excel('data/暗記カード.xlsx');

  return { excel, json, current };
})();

// ============================================================
// Loader  ─  公開 API
// ============================================================
const Loader = (() => {

  /**
   * GitHub 上のデータを fetch し、変更があれば DB を更新する。
   *
   * 処理フロー:
   *   1. DataSource.current.fetch() でデータ取得
   *   2. DB に保存済みの etag と比較
   *   3. 変更あり → DB.saveQuestions()（SR は保持）、etag 更新
   *   4. 変更なし → スキップ
   *
   * @returns {Promise<{
   *   status: 'updated'|'no-change'|'offline'|'error',
   *   message: string,
   *   subjects?: number,
   *   total?: number,
   * }>}
   */
  async function syncFromRemote() {
    if (!navigator.onLine) {
      return { status: 'offline', message: 'オフラインです。保存済みデータを使用します。' };
    }

    try {
      const { data, etag } = await DataSource.current.fetch();

      // バリデーション
      const v = validate(data);
      if (!v.ok) return { status: 'error', message: v.msg };

      // 変更チェック
      const savedEtag = await DB.getMeta('dataEtag');
      if (savedEtag && savedEtag === etag) {
        return { status: 'no-change', message: '問題データは最新です。' };
      }

      // DB 更新（SR は保持）
      await DB.saveQuestions(data);
      await DB.setMeta('dataEtag',    etag);
      await DB.setMeta('lastUpdated', new Date().toISOString());
      await DB.setMeta('dataVersion', ((await DB.getMeta('dataVersion')) || 0) + 1);

      return { status: 'updated', message: '問題データを更新しました。', ...v };

    } catch (err) {
      return { status: 'error', message: `最新データを取得できませんでした。保存済みデータを使用します。` };
    }
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
