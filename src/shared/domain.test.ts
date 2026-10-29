import { describe, expect, it } from 'vitest';
import { iceScoreX10, formatIce, truncateRate } from './ice';
import { checkTransition, STAGES } from './stage';
import { parseCapture } from './capture';

describe('ICE score', () => {
  it('truncates instead of rounding', () => {
    expect(iceScoreX10(7, 8, 8)).toBe(76); // 7.666…
    expect(iceScoreX10(9, 5, 3)).toBe(56); // 5.666…
    expect(iceScoreX10(6, 5, 5)).toBe(53); // 5.333…
    expect(iceScoreX10(10, 10, 10)).toBe(100);
    expect(iceScoreX10(1, 1, 1)).toBe(10);
  });

  it('formats with exactly one decimal', () => {
    expect(formatIce(76)).toBe('7.6');
    expect(formatIce(70)).toBe('7.0');
    expect(formatIce(100)).toBe('10.0');
    expect(formatIce(null)).toBe('—');
  });

  it('truncates rates to one decimal percent', () => {
    expect(truncateRate(2, 3)).toBe('66.6%');
    expect(truncateRate(1, 3)).toBe('33.3%');
    expect(truncateRate(0, 0)).toBe('—');
  });
});

describe('stage transitions', () => {
  const unscored = { stage: 'evaluating' as const, scored: false, conclusion: '' };
  const scored = { ...unscored, scored: true };

  it('requires a score before validating or building', () => {
    expect(checkTransition(unscored, 'validating')).toEqual({ ok: false, need: 'score' });
    expect(checkTransition(unscored, 'building')).toEqual({ ok: false, need: 'score' });
    expect(checkTransition(scored, 'validating')).toEqual({ ok: true });
  });

  it('requires a conclusion before shipped or dropped', () => {
    expect(checkTransition(scored, 'shipped')).toEqual({ ok: false, need: 'conclusion' });
    expect(checkTransition({ ...unscored, stage: 'inbox' }, 'dropped')).toEqual({ ok: false, need: 'conclusion' });
    expect(checkTransition({ ...unscored, stage: 'inbox', conclusion: '有成熟竞品' }, 'dropped')).toEqual({ ok: true });
  });

  it('allows moving back and dropping unscored ideas', () => {
    expect(checkTransition({ ...unscored, stage: 'validating', scored: true }, 'inbox')).toEqual({ ok: true });
    expect(checkTransition({ ...unscored, stage: 'inbox' }, 'evaluating')).toEqual({ ok: true });
  });

  it('only reopens closed ideas back to evaluating', () => {
    const closed = { stage: 'dropped' as const, scored: true, conclusion: 'x' };
    expect(checkTransition(closed, 'evaluating')).toEqual({ ok: true });
    expect(checkTransition(closed, 'building')).toEqual({ ok: false, need: 'reopen' });
  });

  it('rejects a no-op move', () => {
    expect(checkTransition(unscored, 'evaluating')).toEqual({ ok: false, need: 'same' });
  });

  it('lists six stages in funnel order', () => {
    expect(STAGES).toEqual(['inbox', 'evaluating', 'validating', 'building', 'shipped', 'dropped']);
  });
});

describe('capture parsing', () => {
  it('extracts #tags and keeps the rest as title', () => {
    expect(parseCapture('做个记账小程序 #工具 #小程序')).toEqual({ title: '做个记账小程序', tags: ['工具', '小程序'] });
  });

  it('handles tags in the middle and full-width ＃', () => {
    expect(parseCapture('播客 #AI 搜索引擎 ＃搜索')).toEqual({ title: '播客 搜索引擎', tags: ['AI', '搜索'] });
  });

  it('dedupes tags and ignores a lone #', () => {
    expect(parseCapture('C# 入门 # 教程 #学习 #学习')).toEqual({ title: 'C# 入门 # 教程', tags: ['学习'] });
  });

  it('returns empty title when only tags given', () => {
    expect(parseCapture('  #工具 ')).toEqual({ title: '', tags: ['工具'] });
  });
});
