/**
 * session.js  ─  学習セッション管理
 *
 * モード:
 *   today   - 今日の復習（期限が来たカード）
 *   all     - 全問題ランダム
 *   unit    - 単元指定
 *   weak    - 苦手問題（easeFactor が低い順）
 *   random  - 完全ランダム（単元フィルタ付き）
 */

const Session = (() => {
  let _subject  = null;
  let _queue    = [];     // 出題キュー（わからないは末尾に再追加）
  let _initLen  = 0;      // 初期キュー長（進捗バー用）
  let _idx      = 0;
  let _srCache  = {};     // { cardId: srData }
  let _stats    = { done: 0, good: 0, almost: 0, wrong: 0 };

  // Fisher-Yates
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * セッション開始
   * @param {string}  subject
   * @param {Array}   cards    フィルタ済みカード配列
   * @param {string}  mode     'today'|'all'|'weak'|'random'
   * @param {Object}  srMap    { cardId: srData }
   * @returns {{ ok:boolean, message?:string }}
   */
  function start(subject, cards, mode, srMap) {
    _subject  = subject;
    _srCache  = srMap;
    _stats    = { done: 0, good: 0, almost: 0, wrong: 0 };
    _idx      = 0;

    let queue;

    if (mode === 'today') {
      queue = cards.filter(c => SM2.isDue(srMap[c.cardId]));
      if (queue.length === 0)
        return { ok: false, message: '今日の復習はありません！\n「全問題」または「ランダム」で練習しましょう。' };
      shuffle(queue);

    } else if (mode === 'weak') {
      // easeFactor 低い順、未学習は末尾
      const studied   = cards.filter(c => srMap[c.cardId]?.repetitions > 0);
      const unstudied = cards.filter(c => !srMap[c.cardId] || srMap[c.cardId].repetitions === 0);
      studied.sort((a, b) => SM2.weakScore(srMap[a.cardId]) - SM2.weakScore(srMap[b.cardId]));
      queue = [...studied, ...unstudied];
      if (queue.length === 0)
        return { ok: false, message: '苦手問題がありません。まず「全問題」で学習しましょう。' };

    } else {
      // all / random
      queue = shuffle([...cards]);
    }

    _queue   = queue;
    _initLen = queue.length;
    return { ok: true };
  }

  function currentCard()  { return _queue[_idx] || null; }
  function remaining()    { return _queue.length - _idx; }
  function initLength()   { return _initLen; }
  function doneCount()    { return _idx; }
  function progress()     { return _initLen === 0 ? 1 : Math.min(_idx / _initLen, 1); }
  function getStats()     { return { ..._stats }; }
  function getSubject()   { return _subject; }

  /**
   * 採点して DB を更新、次へ進む
   * @param {0|1|2} quality
   * @returns {Promise<{finished:boolean}>}
   */
  async function judge(quality) {
    const card = currentCard();
    if (!card) return { finished: true };

    const prev    = _srCache[card.cardId] || {};
    const updated = SM2.grade(prev, quality);
    _srCache[card.cardId] = updated;

    await DB.setSR(_subject, card.cardId, updated);

    _stats.done++;
    if      (quality === 2) _stats.good++;
    else if (quality === 1) _stats.almost++;
    else                  { _stats.wrong++; _queue.push(card); }

    _idx++;
    return { finished: _idx >= _queue.length };
  }

  // ── 統計計算（ホーム表示用）────────────────────────────
  /**
   * @param {Array}  cards   科目の全カード
   * @param {Object} srMap   { cardId: srData }
   * @returns {{ total, newCount, todayCount, learnedCount, masterCount }}
   */
  function calcStats(cards, srMap) {
    let newCount = 0, todayCount = 0, learnedCount = 0, masterCount = 0;
    const today = DB.today();

    cards.forEach(c => {
      const sr = srMap[c.cardId];
      if (!sr || sr.repetitions === 0)    { newCount++; }
      if (SM2.isDue(sr) && sr)             todayCount++;
      if (sr && sr.repetitions > 0)        learnedCount++;
      if (SM2.isMastered(sr))              masterCount++;
    });

    // 新規 = 期限なし（全て今日対象）→ todayCount に含まれていないので合算
    const dueTotal = newCount + todayCount;

    return { total: cards.length, newCount, todayCount, dueTotal, learnedCount, masterCount };
  }

  return { start, currentCard, remaining, initLength, doneCount, progress, getStats, getSubject, judge, calcStats };
})();
