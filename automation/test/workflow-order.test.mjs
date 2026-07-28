/**
 * 워크플로 단계 순서 회귀 테스트.
 *
 * 상태를 git 에 저장하는 설계에서는 **"상태를 바꾸는 스크립트"가 "커밋하는
 * 단계"보다 먼저 실행되어야** 그 변경이 살아남는다. 순서가 뒤집히면
 * 러너 안에서는 전부 성공으로 보이고, 다음 버튼을 눌렀을 때에야
 * "아직 검수할 카드가 없습니다" 로 드러난다 (실제로 겪은 버그).
 *
 * 단위 테스트로는 잡히지 않는 종류라 워크플로 파일 자체를 검사한다.
 * YAML 파서 의존성을 들이지 않으려고 단계 이름의 등장 위치로 비교한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function workflow(name) {
  return readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

/** 단계 이름이 파일에서 등장하는 위치 (없으면 테스트 실패) */
function stepAt(source, stepName) {
  const at = source.indexOf(`- name: ${stepName}`);
  assert.notEqual(at, -1, `워크플로에 '${stepName}' 단계가 없습니다`);
  return at;
}

test('제작 워크플로: 검수 발송이 상태 커밋보다 먼저여야 한다', () => {
  const source = workflow('produce-card.yml');
  const send = stepAt(source, '검수 요청 발송');
  const commit = stepAt(source, '검수 대기 상태 커밋');
  assert.ok(
    send < commit,
    'send-result.mjs 가 상태를 review 로 바꾸므로, 그 뒤에 커밋해야 변경이 저장된다',
  );
});

test('제작 워크플로: 산출물 커밋이 검수 발송보다 먼저여야 한다', () => {
  const source = workflow('produce-card.yml');
  // 발송이 실패해도 만들어 둔 카드는 저장소에 남아야 한다.
  assert.ok(stepAt(source, '산출물 커밋') < stepAt(source, '검수 요청 발송'));
});

test('확정/폐기 워크플로: 상태 갱신이 커밋보다 먼저여야 한다', () => {
  const source = workflow('finalize-card.yml');
  assert.ok(stepAt(source, '상태 갱신 및 처리 로그 기록') < stepAt(source, '결과 커밋'));
});

test('후보 선별 워크플로: 커밋이 발송보다 먼저여야 한다', () => {
  const source = workflow('daily-candidates.yml');
  // 후보 파일이 커밋되어 있어야 Choose 를 눌렀을 때 러너가 후보를 찾을 수 있다.
  assert.ok(stepAt(source, '결과 커밋') < stepAt(source, 'Telegram 으로 후보 발송'));
});

test('검수 재발송: 발송이 상태 커밋보다 먼저여야 한다', () => {
  const source = workflow('resend-review.yml');
  assert.ok(stepAt(source, '검수 요청 재발송') < stepAt(source, '검수 대기 상태 커밋'));
});

test('상태를 바꾸는 워크플로는 모두 commit-push 헬퍼를 쓴다', () => {
  // 각자 git 명령을 직접 쓰면 push 재시도가 빠져 동시 실행 시 조용히 실패한다.
  for (const name of [
    'produce-card.yml',
    'finalize-card.yml',
    'daily-candidates.yml',
    'resend-review.yml',
  ]) {
    const source = workflow(name);
    assert.match(source, /commit-push\.sh/, `${name} 이 commit-push.sh 를 쓰지 않습니다`);
    assert.doesNotMatch(source, /^\s+git commit /m, `${name} 에 직접 git commit 이 남아 있습니다`);
  }
});
