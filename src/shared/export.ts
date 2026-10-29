import { formatIce, iceScoreX10 } from './ice.js';
import { STAGES, STAGE_LABELS } from './stage.js';
import type { ExportIdea } from './types.js';

/** Human-readable export, grouped by stage in funnel order. Not meant to be imported back (use JSON for that). */
export function toMarkdown(ideas: ExportIdea[], exportedAt: string): string {
  const out = ['# Idea Funnel 导出', '', `导出时间：${exportedAt}，共 ${ideas.length} 条`];
  for (const stage of STAGES) {
    const group = ideas.filter((i) => i.stage === stage);
    if (!group.length) continue;
    out.push('', `## ${STAGE_LABELS[stage]}（${group.length}）`);
    for (const i of group) {
      out.push('', `### ${i.title}`, '');
      if (i.tags.length) out.push(`- 标签：${i.tags.map((t) => `#${t}`).join(' ')}`);
      if (i.impact != null && i.confidence != null && i.ease != null) {
        out.push(`- ICE：${formatIce(iceScoreX10(i.impact, i.confidence, i.ease))}（I ${i.impact} / C ${i.confidence} / E ${i.ease}）`);
      }
      if (i.source) out.push(`- 来源：${i.source}`);
      for (const link of i.links) out.push(`- 链接：<${link}>`);
      if (i.hypothesis) out.push(`- 验证假设：${i.hypothesis}`);
      if (i.successCriteria) out.push(`- 成功标准：${i.successCriteria}`);
      if (i.conclusion) out.push(`- 结论：${i.conclusion}`);
      out.push(`- 记录于：${i.createdAt.slice(0, 10)}`);
      if (i.description.trim()) out.push('', i.description.trim());
    }
  }
  return `${out.join('\n')}\n`;
}
