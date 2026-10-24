# lean-delegation

서브에이전트에 일을 나눠 맡길 때, 품질은 유지한 채 토큰과 시간을 줄이는 규칙.
Claude Code용 스킬 하나 + 범용 에이전트 6개를 플러그인 하나로 묶었음.

- `skills/lean-delegation/`
  - `SKILL.md`: 위임할지 판단, 파이프라인, 역할별 생각 강도, 지시 템플릿, 단위 마무리 확인, 프로젝트 준비 사항
  - `templates/workflow.js`: Workflow 도구용 단계 템플릿 (args로 저장소·단계·담당 파일을 전달한다)
  - `profile_agents.py`: 에이전트 기록에서 호출 수·문맥·캐시 읽기/쓰기·추정 비용을 구한다.
- `agents/`

  | 에이전트 | 모델 | 생각 강도 | 도구 |
  |---|---|---|---|
  | `lean-finder` | Haiku | low | 읽기 전용 |
  | `lean-gate` | Haiku | low | 읽기 + 명령 실행 |
  | `lean-explorer` | Sonnet | medium | 읽기 전용 |
  | `lean-implementer` | Sonnet | high | 편집 가능 |
  | `lean-fixer` | Sonnet | high | 편집 가능 |
  | `lean-reviewer` | Opus | high | 읽기 전용 |

  플러그인으로 읽히므로 이름 앞에 `lean-delegation:`이 붙는다 (예: `lean-delegation:lean-finder`, 스킬은 `/lean-delegation:lean-delegation`).

## 설치

`~/.claude/skills/` 아래에 clone한다.
Claude Code는 `.claude-plugin/plugin.json`이 있는 그 폴더를 플러그인(`lean-delegation@skills-dir`)으로 그 자리에서 읽는다. 링크도 마켓플레이스도 필요 없다.

macOS·Linux:

```sh
git clone <저장소 URL> ~/.claude/skills/lean-delegation
```

Windows (PowerShell):

```powershell
git clone <저장소 URL> "$env:USERPROFILE\.claude\skills\lean-delegation"
```

- 새 세션을 열면 스킬과 에이전트가 뜬다. 이미 열린 세션에서는 `/reload-plugins`를 실행한다.
- 갱신: `git pull` 뒤 `/reload-plugins` 또는 새 세션. 복사본이 아니라 그 자리에서 읽으므로 버전을 올리지 않아도 된다.
- 같은 이름의 플러그인을 마켓플레이스로도 설치하면 그쪽이 우선이고 이 폴더는 로드되지 않는다. 하나만 쓴다.
