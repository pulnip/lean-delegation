# lean-delegation

서브에이전트에 일을 나눠 맡길 때, 품질은 유지한 채 토큰과 시간을 줄이는 규칙.
Claude Code용 스킬 하나 + 범용 에이전트 6개로 구성되어 있음.

- `skills/lean-delegation/`
  - `SKILL.md`: 파이프라인, 역할별 생각 강도, 지시 템플릿, 커밋 전 확인, 프로젝트 준비 사항
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

## 설치

**방법 1: 링크** clone하고 실행한다.

```sh
./install.sh
```

`~/.claude/skills/lean-delegation`과 `~/.claude/agents/lean-*.md`가 이 저장소를 가리키는 링크, git pull하면 갱신.
세션이 시작할 때 에이전트 정의를 읽으므로 새 세션을 열어서 확인한다.

**방법 2: 플러그인.** `.claude-plugin/plugin.json`이 있으므로 플러그인 마켓플레이스를 통해 설치할 수도 있다.
주의: 방법 1과 같이 쓰지 않는다(같은 이름 두 번 생김).
