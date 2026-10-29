import { describe, expect, it } from 'vitest';
import { funnelSteps } from './insights.js';
import { parseBatch } from './capture.js';
import { toMarkdown } from './export.js';
import type { ExportIdea } from './types.js';

describe('funnel conversion', () => {
  it('counts every idea for each stage it ever reached and truncates the rates', () => {
    // furthest stage reached → how many ideas stopped there
    const steps = funnelSteps({ inbox: 4, evaluating: 3, validating: 1, building: 0, shipped: 1 });
    expect(steps).toEqual([
      { stage: 'inbox', reached: 9, rate: null },
      { stage: 'evaluating', reached: 5, rate: '55.5%' }, // 5/9 = 55.55…
      { stage: 'validating', reached: 2, rate: '40.0%' },
      { stage: 'building', reached: 1, rate: '50.0%' },
      { stage: 'shipped', reached: 1, rate: '100.0%' },
    ]);
  });

  it('shows no rate when the previous step is empty', () => {
    const steps = funnelSteps({});
    expect(steps.map((s) => [s.reached, s.rate])).toEqual([[0, null], [0, '—'], [0, '—'], [0, '—'], [0, '—']]);
  });
});

describe('batch import parsing', () => {
  it('parses one idea per line with #tags and skips blank lines', () => {
    const { items, errors } = parseBatch('记账小程序 #工具\n\n  \n播客搜索 #AI #工具\r\n');
    expect(items).toEqual([
      { line: 1, title: '记账小程序', tags: ['工具'] },
      { line: 4, title: '播客搜索', tags: ['AI', '工具'] },
    ]);
    expect(errors).toEqual([]);
  });

  it('reports lines that cannot become an idea instead of importing them', () => {
    const { items, errors } = parseBatch(`#只有标签\n${'长'.repeat(201)}\n正常`);
    expect(items.map((i) => i.title)).toEqual(['正常']);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [1, '没有标题'],
      [2, '标题超过 200 字'],
    ]);
  });

  it('caps a batch at 500 ideas', () => {
    const { items, errors } = parseBatch(Array.from({ length: 502 }, (_, i) => `想法 ${i}`).join('\n'));
    expect(items).toHaveLength(500);
    expect(errors).toEqual([{ line: 501, text: '想法 500', reason: '一次最多导入 500 条' }, { line: 502, text: '想法 501', reason: '一次最多导入 500 条' }]);
  });
});

describe('markdown export', () => {
  const base: ExportIdea = {
    id: '00000000-0000-4000-8000-000000000001',
    title: '记账小程序',
    description: '',
    stage: 'inbox',
    impact: null,
    confidence: null,
    ease: null,
    source: '',
    links: [],
    conclusion: '',
    tags: [],
    stageChangedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    events: [],
  };

  it('groups by stage in funnel order, omits empty stages and truncates ICE', () => {
    const md = toMarkdown(
      [
        { ...base, title: '已放弃的', stage: 'dropped', conclusion: '有成熟竞品' },
        { ...base, title: '评估中的', stage: 'evaluating', impact: 7, confidence: 8, ease: 8, tags: ['工具'], description: '**重点**' },
        base,
      ],
      '2026-10-29T08:00:00.000Z',
    );
    const headings = md.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## 收集箱（1）', '## 评估中（1）', '## 已放弃（1）']);
    expect(md).toContain('### 评估中的');
    expect(md).toContain('- ICE：7.6（I 7 / C 8 / E 8）'); // 7.666… truncated
    expect(md).toContain('- 标签：#工具');
    expect(md).toContain('**重点**');
    expect(md).toContain('- 结论：有成熟竞品');
    expect(md).toContain('共 3 条');
  });
});
