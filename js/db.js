/**
 * db.js  ─  IndexedDB ラッパー
 *
 * ストア構成:
 *   questions  { id(PK), subject, unit, q, a }
 *   sr_data    { id(PK: subject+":"+cardId), subject, cardId,
 *                easeFactor, interval, repetitions, nextDate, lastStudied }
 *   meta       { key(PK), value }   ← "dataVersion", "lastUpdated" など
 */

const DB = (() => {
  const DB_NAME    = 'ankiApp';
  const DB_VERSION = 1;
  let _db = null;

  // ── 初期化 ──────────────────────────────────────────
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('questions')) {
          const qs = db.createObjectStore('questions', { keyPath: 'id' });
          qs.createIndex('by_subject', 'subject', { unique: false });
          qs.createIndex('by_unit',    'unit',    { unique: false });
        }
        if (!db.objectStoreNames.contains('sr_data')) {
          const sr = db.createObjectStore('sr_data', { keyPath: 'id' });
          sr.createIndex('by_subject', 'subject', { unique: false });
          sr.createIndex('by_next',    'nextDate', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function promisify(req) {
    return new Promise((res, rej) => {
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  // ── meta ────────────────────────────────────────────
  async function getMeta(key)        { await open(); return promisify(tx('meta').get(key)).then(r => r?.value ?? null); }
  async function setMeta(key, value) { await open(); return promisify(tx('meta','readwrite').put({ key, value })); }

  // ── questions ────────────────────────────────────────
  /** 全問題を subjects の Map 形式で返す { subject: [card,...] } */
  async function getAllQuestions() {
    await open();
    return new Promise((resolve, reject) => {
      const result = {};
      const req = tx('questions').openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          const c = cursor.value;
          if (!result[c.subject]) result[c.subject] = [];
          result[c.subject].push(c);
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  /** 科目一覧を取得 */
  async function getSubjects() {
    const all = await getAllQuestions();
    return Object.keys(all);
  }

  /**
   * 問題データを一括保存（既存を全削除してから書き直す）
   * srData は保持するので questions ストアのみ操作
   */
  async function saveQuestions(subjectMap) {
    await open();
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction('questions', 'readwrite');
      const store = transaction.objectStore('questions');
      transaction.oncomplete = resolve;
      transaction.onerror   = e => reject(e.target.error);

      // 全削除
      store.clear();
      // 書き込み
      Object.entries(subjectMap).forEach(([subject, cards]) => {
        cards.forEach(c => {
          store.put({ ...c, subject });
        });
      });
    });
  }

  // ── sr_data ─────────────────────────────────────────
  function srKey(subject, cardId) { return `${subject}:${cardId}`; }

  async function getSR(subject, cardId) {
    await open();
    return promisify(tx('sr_data').get(srKey(subject, cardId)));
  }

  async function setSR(subject, cardId, data) {
    await open();
    return promisify(tx('sr_data','readwrite').put({
      id: srKey(subject, cardId),
      subject,
      cardId,
      ...data,
    }));
  }

  /** 科目の全 SR データを Map {cardId: data} で返す */
  async function getAllSR(subject) {
    await open();
    return new Promise((resolve, reject) => {
      const result = {};
      const idx = tx('sr_data').index('by_subject');
      const req  = idx.openCursor(IDBKeyRange.only(subject));
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          result[cursor.value.cardId] = cursor.value;
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  /** 科目の SR データだけリセット */
  async function resetSR(subject) {
    await open();
    return new Promise((resolve, reject) => {
      const transaction = _db.transaction('sr_data', 'readwrite');
      const idx  = transaction.objectStore('sr_data').index('by_subject');
      const req  = idx.openCursor(IDBKeyRange.only(subject));
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      transaction.oncomplete = resolve;
      transaction.onerror    = e => reject(e.target.error);
    });
  }

  // ── 便利ヘルパー ────────────────────────────────────
  /** 今日の日付文字列 YYYY-MM-DD */
  function today() { return new Date().toISOString().split('T')[0]; }

  return {
    open, getMeta, setMeta,
    getAllQuestions, getSubjects, saveQuestions,
    getSR, setSR, getAllSR, resetSR,
    today,
  };
})();
