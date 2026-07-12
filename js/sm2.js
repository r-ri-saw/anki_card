/**
 * sm2.js  ─  SM-2 スペースドリピティション アルゴリズム
 *
 * quality:
 *   0 = わからない  → 即日再出題
 *   1 = もう少し    → 翌日
 *   2 = 覚えた      → 間隔を自動計算（数日〜数週間後）
 */

const SM2 = (() => {

  /** SR データの初期値 */
  const INITIAL = {
    easeFactor:  2.5,
    interval:    0,
    repetitions: 0,
    nextDate:    null,
    lastStudied: null,
  };

  /**
   * 採点して新しい SR データを返す（元データは変更しない）
   * @param {Object} sr      現在の SR データ（undefined も可）
   * @param {0|1|2}  quality
   * @returns {Object}       新しい SR データ
   */
  function grade(sr, quality) {
    let { easeFactor, interval, repetitions } = { ...INITIAL, ...sr };

    if (quality === 0) {
      repetitions = 0;
      interval    = 0;
    } else if (quality === 1) {
      repetitions = 0;
      interval    = 1;
    } else {
      if      (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 4;
      else                        interval = Math.round(interval * easeFactor);
      repetitions++;
      easeFactor = Math.max(
        1.3,
        easeFactor + 0.1 - (2 - quality) * (0.08 + (2 - quality) * 0.02)
      );
    }

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);

    return {
      easeFactor,
      interval,
      repetitions,
      nextDate:    nextDate.toISOString().split('T')[0],
      lastStudied: new Date().toISOString().split('T')[0],
    };
  }

  /**
   * 今日復習すべきカードかどうか
   * @param {Object|null} sr  SR データ（未学習なら null）
   * @returns {boolean}
   */
  function isDue(sr) {
    if (!sr || !sr.nextDate) return true;   // 未学習 = 新規 = 即出題
    return sr.nextDate <= DB.today();
  }

  /**
   * カードが「マスター済み」かどうか（repetitions >= 3 かつ interval >= 7日）
   */
  function isMastered(sr) {
    return sr && sr.repetitions >= 3 && sr.interval >= 7;
  }

  /**
   * 苦手度スコア（低い easeFactor = 苦手）
   * 未学習は最低スコアとして扱う
   */
  function weakScore(sr) {
    if (!sr || sr.repetitions === 0) return 0;
    return sr.easeFactor;
  }

  return { grade, isDue, isMastered, weakScore, INITIAL };
})();
