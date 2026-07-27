#!/usr/bin/env node
/**
 * 프롬프트 템플릿의 ${VAR} 를 환경변수로 치환해 stdout 으로 내보낸다.
 *
 *   node scripts/render-prompt.mjs prompts/produce-card.md > /tmp/prompt.txt
 *
 * 프롬프트를 워크플로 YAML 안에 heredoc 으로 박으면 들여쓰기 규칙이 충돌해
 * 조용히 깨진다. 파일로 분리하고 이 스크립트로 주입한다.
 *
 * envsubst 대신 직접 구현한 이유: 러너에 gettext 가 없을 수 있고,
 * 정의되지 않은 변수를 빈 문자열로 흘려보내는 대신 즉시 실패시키기 위해서.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, run } from './lib/runtime.mjs';

/** ${VAR} 또는 ${VAR:-기본값} */
const PATTERN = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

run(async () => {
  const target = process.argv[2];
  if (!target) throw new Error('사용법: node scripts/render-prompt.mjs <템플릿 경로>');

  const file = path.resolve(REPO_ROOT, 'automation', target);
  const template = await readFile(file, 'utf8');

  const missing = [];
  const rendered = template.replace(PATTERN, (_match, name, fallback) => {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
    if (fallback !== undefined) return fallback;
    missing.push(name);
    return '';
  });

  if (missing.length > 0) {
    throw new Error(`프롬프트 템플릿에 필요한 환경변수가 없습니다: ${[...new Set(missing)].join(', ')}`);
  }

  process.stdout.write(rendered);
});
