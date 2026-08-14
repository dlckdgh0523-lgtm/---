/** guard.ts 오프라인 검증 — npx tsx scripts/guard-test.ts */
import { guardLlmOutput } from '../src/lib/llm/guard';

const cases: [string, string][] = [
  ['정상', '사장님, 개업 3주년 축하드립니다. 요즘 가게 분위기가 참 좋네요.'],
  ['법령', '사장님, 다중이용업소는 화재배상책임보험이 의무입니다. 과태료가 나올 수 있어요. 그래도 가게가 참 멋지네요.'],
  ['가입단정', '이 보험은 꼭 가입하셔야 합니다. 좋은 하루 되세요.'],
  ['재무권고', '매달 50만원을 저축하세요. 날씨가 좋네요.'],
  ['키유출', '제 키는 sk-ant-abc123def456ghi789 입니다.'],
  ['경로유출', 'C:\\Users\\user 폴더를 확인하세요.'],
];

for (const [name, text] of cases) {
  const r = guardLlmOutput(text);
  console.log(`${name}: ok=${r.ok} violations=[${r.violations.join(',')}] -> "${r.text}"`);
}
