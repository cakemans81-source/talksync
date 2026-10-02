// ── Gemini 출력 후처리: 타겟 언어 텍스트만 추출 ──────────
export function extractTranslation(raw: string, targetLangCode: string): string {
  // 마크다운 제거
  const text = raw.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim();

  // 언어별 문자 패턴
  let charPattern: RegExp | null = null;
  if (targetLangCode.startsWith('ja')) {
    charPattern = /[\u3040-\u30FF]/; // 히라가나/가타카나 필수
  } else if (targetLangCode.startsWith('ko')) {
    charPattern = /[\uAC00-\uD7AF]/; // 한글
  } else if (targetLangCode.startsWith('zh')) {
    charPattern = /[\u4E00-\u9FFF]/; // 한자
  }

  if (!charPattern) return text; // 라틴 계열은 후처리 없이 반환

  // 전략1: 따옴표 안의 타겟 언어 텍스트 중 마지막/가장 긴 것
  const quoteRe = /["""「『]([\s\S]*?)["""」』]/g;
  const quoted = [...text.matchAll(quoteRe)]
    .map((m) => m[1].trim())
    .filter((s) => charPattern!.test(s));
  if (quoted.length > 0) {
    // 가장 긴 인용구 반환 (보통 "combined translation"이 마지막/가장 김)
    return quoted.reduce((a, b) => (b.length >= a.length ? b : a));
  }

  // 전략2: 타겟 언어 문자를 포함하는 문장만 추출
  const sentences = text
    .split(/(?<=[。.!?！？\n])/)
    .map((s) => s.trim())
    .filter((s) => charPattern!.test(s));
  if (sentences.length > 0) return sentences.join(' ');

  return text;
}
