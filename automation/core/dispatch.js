/**
 * GitHub `repository_dispatch` 발사기 — 웹훅과 실제 작업을 잇는 다리.
 *
 * 서버리스 웹훅은 실행 시간이 짧고(수십 초) 헤드리스 브라우저를 못 돌리므로,
 * 수 분짜리 생성 작업은 GitHub Actions 러너에 넘긴다.
 * 이 모듈이 그 "넘기는" 부분이다.
 *
 * 이 파일은 프로젝트에 종속되지 않는다.
 */

/** client_payload 는 최상위 속성 10개까지만 허용된다 (GitHub 제한) */
const MAX_PAYLOAD_KEYS = 10;

export class GitHubDispatcher {
  /**
   * @param {object} config
   * @param {string} config.token `repo` 스코프 PAT (fine-grained 는 Contents: write)
   * @param {string} config.repo "owner/name" 형식
   * @param {string} [config.userAgent] GitHub API 는 User-Agent 를 요구한다
   */
  constructor(config) {
    if (!config.token) throw new Error('GitHubDispatcher: token 이 비어 있습니다');
    if (!config.repo?.includes('/')) {
      throw new Error(`GitHubDispatcher: repo 는 "owner/name" 형식이어야 합니다 — ${config.repo}`);
    }
    this.token = config.token;
    this.repo = config.repo;
    this.userAgent = config.userAgent ?? 'telegram-approval-bot';
  }

  /**
   * 워크플로를 트리거한다.
   *
   * @param {string} eventType 워크플로의 `on.repository_dispatch.types` 와 일치해야 한다
   * @param {Record<string, unknown>} [clientPayload] 워크플로에서 `github.event.client_payload` 로 읽는다
   */
  async dispatch(eventType, clientPayload = {}) {
    const keys = Object.keys(clientPayload);
    if (keys.length > MAX_PAYLOAD_KEYS) {
      throw new Error(
        `GitHubDispatcher: client_payload 최상위 키가 ${keys.length}개로 상한(${MAX_PAYLOAD_KEYS})을 넘었습니다`,
      );
    }

    const response = await fetch(`https://api.github.com/repos/${this.repo}/dispatches`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'user-agent': this.userAgent,
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    });

    // 성공 시 204 No Content — 본문이 없다.
    if (response.status === 204) return;

    const detail = await response.text().catch(() => '');
    throw new Error(
      `GitHub dispatch 실패 (${response.status}): ${detail || '응답 본문 없음'}. ` +
        `토큰 권한과 저장소 이름(${this.repo})을 확인하세요.`,
    );
  }
}
