---
layout: post
title: "CI/CD 배포 Slack 알림 + Release Note 자동 추출 — 비개발자도 읽는 배포 알림 만들기"
date: 2026-03-31 10:00:00 +0900
categories: [DevOps, CI/CD]
tags: [GitHub Actions, CI/CD, Slack, Automation, DevOps]
lang: ko
slug: "049"
thumbnail: /assets/images/posts/049-slack-deploy-notification/thumbnail-ko.png
published: true
---

![CI/CD 배포할 때마다 Slack으로 알림 받기](/assets/images/posts/049-slack-deploy-notification/thumbnail-ko.png)

## 문제: 배포했는데, 아무도 모른다

배포 버튼을 누르고 나면 불안해진다.

성공했나? 서버가 정상적으로 올라왔나? 언제부터 새 버전이 적용된 건지 알 수 없다. 터미널을 열어서 GitHub Actions 탭을 확인하고, SSH로 서버에 접속해서 `docker logs`를 보고, 그제야 "아, 올라왔구나" 하고 안심한다. 1인 개발이라 나 말고는 확인해줄 사람이 없다.

더 큰 문제는 사용자 쪽이다. CheckUS를 쓰는 학원 선생님들은 개발자가 아니다. 시스템이 업데이트되면 "뭐가 바뀌었어요?" 하고 물어본다. 매번 카톡으로 "출석부 화면에서 이런 기능이 추가됐습니다" 하고 직접 알려줘야 한다. 안 알려주면 새 기능이 있는지도 모른 채 예전 방식으로 계속 쓴다. 이전에 수정한 버그에 대해 "이거 아직 안 고쳐진 건가요?" 라는 질문을 받은 적도 있다. 진작에 고쳐서 배포했는데 안내를 안 한 거다.

GitHub Marketplace에 `slackapi/slack-github-action`이나 `rtCamp/action-slack-notify` 같은 기성 Action이 있다. 설정만 하면 배포 알림을 보낼 수 있다. 하지만 메시지 내용까지 세밀하게 커스터마이즈하려면 — 특히 커밋에서 release note를 추출해서 한국어로 포맷팅하는 것까지 — 결국 curl로 직접 webhook을 호출하는 게 낫다.

그래서 배포 파이프라인에 Slack 알림을 직접 붙이기로 했다. 목표는 세 가지였다.

1. 배포 시작/완료/실패를 실시간으로 알 것
2. 뭐가 바뀌었는지 변경사항을 자동으로 추출해서 보여줄 것
3. 비개발자가 읽어도 이해할 수 있는 한국어 메시지일 것

## 구조: 3단계 알림

GitHub Actions 워크플로우에 세 곳에 Slack webhook 호출을 넣었다. 서버(Spring Boot), 선생님웹(React), 학생앱(React) — 서브모듈마다 각각의 배포 워크플로우가 있고, 구조는 동일하다.

```
main에 push
  -> 빌드 & 배포 시작
  -> [Slack] "서버 업데이트를 시작합니다"
  -> 실제 배포 (Docker pull, 컨테이너 재시작)
  -> Health check (최대 5분)
  -> [Slack] "업데이트가 완료되었습니다" + 변경사항
  -> (실패 시) [Slack] "배포에 실패했습니다"
```

시작 알림이 중요한 이유가 있다. 서버 배포는 Docker 컨테이너를 내렸다가 다시 올리는 과정이 포함된다. 그 사이 10~20초 정도 접속이 불안정해질 수 있다. 선생님이 출석 체크를 하다가 갑자기 에러가 나면 당황할 수 있으니까, "잠시 접속이 불안정할 수 있습니다"라는 사전 안내를 보내는 거다.

프론트엔드(Cloudflare Pages)는 무중단 배포라서 시작 알림 없이 완료/실패만 보낸다.

![Slack 배포 알림 3단계](/assets/images/posts/049-slack-deploy-notification/slack-messages.png)

## Health Check: 배포 "완료"의 기준

Spring Boot 서버는 올라오는 데 시간이 좀 걸린다. Docker 컨테이너가 시작됐다고 해서 바로 트래픽을 받을 수 있는 게 아니다. t3.small(2GB RAM) 인스턴스에서 Spring Boot가 완전히 부팅되려면 보통 30초~1분, swap을 많이 쓰는 날은 2분까지도 걸린다.

그래서 배포 완료를 선언하기 전에 health check 루프를 돌린다.

```bash
# Spring Boot 부팅 완료 대기 (최대 60회 x 5초 = 5분)
echo "Waiting for server to be ready..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/public/health > /dev/null 2>&1; then
    echo "Server is ready! (attempt $i)"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "Server did not become ready within 60 attempts"
    exit 1
  fi
  sleep 5
done
```

`/public/health`는 인증 없이 접근 가능한 엔드포인트다. `curl -sf`로 HTTP 200이 돌아오면 성공, 아니면 5초 대기 후 재시도. 60번(5분) 안에 응답이 없으면 `exit 1`로 워크플로우를 실패시킨다. 그러면 자동으로 실패 알림이 Slack에 간다.

이 루프가 없었을 때는 배포 후 수동으로 브라우저를 열어서 사이트가 뜨는지 확인했다. 지금은 Slack에 완료 메시지가 오면 그게 곧 "정상 동작 확인 완료"다.

## Release Note 자동 추출

배포 알림에서 가장 중요한 부분이다. "업데이트 완료"만으로는 부족하다. **뭐가** 바뀌었는지 알려줘야 한다.

커밋 메시지에서 `[release-note]` 태그가 붙은 줄을 자동으로 추출한다.

```bash
# 1차: [release-note] 태그 추출
RELEASE_NOTES=""

if [ "$BEFORE_SHA" != "0000000000000000000000000000000000000000" ]; then
  NOTES_FROM_COMMITS=$(git log "${BEFORE_SHA}..${AFTER_SHA}" \
    --format="%B" \
    | grep '^\[release-note\]' \
    | sed 's/^\[release-note\] /• /' || true)
  if [ -n "$NOTES_FROM_COMMITS" ]; then
    RELEASE_NOTES="$NOTES_FROM_COMMITS"
  fi
fi

# 2차: [release-note]가 없으면 커밋 subject로 fallback
if [ -z "$RELEASE_NOTES" ]; then
  NOTES_FALLBACK=$(git log "${BEFORE_SHA}..${AFTER_SHA}" \
    --format="• %s" --no-merges \
    | grep -v "^• chore:" || true)
  if [ -n "$NOTES_FALLBACK" ]; then
    RELEASE_NOTES="$NOTES_FALLBACK"
  fi
fi
```

`$BEFORE_SHA`와 `$AFTER_SHA`는 GitHub Actions가 제공하는 `github.event.before`와 `github.event.after`다. 이 범위의 커밋 본문에서 `[release-note]`로 시작하는 줄만 뽑아서 불릿 포인트로 변환한다.

`[release-note]`가 하나도 없는 push라면? 그때는 fallback으로 커밋 제목(`%s`)을 쓴다. `chore:` 접두사가 붙은 커밋은 사용자에게 의미 없는 작업이니 제외한다. merge 커밋도 `--no-merges`로 걸러낸다.

`|| true`가 곳곳에 붙어 있는 건 `grep` 결과가 없을 때 exit code 1이 나와서 전체 스크립트가 실패하는 걸 방지하기 위해서다. 쉘 스크립트에서 `set -e`가 걸려 있으면 `grep`이 매칭 0건일 때 파이프라인 전체가 죽는다.

## JSON 이스케이프: 슬랙 Webhook의 함정

Release note를 추출했으면 Slack에 보내야 한다. 여기서 한 번 삽질했다. 커밋 메시지에 큰따옴표(`"`)나 줄바꿈이 들어 있으면 JSON이 깨진다.

```bash
# 슬랙 메시지 구성
if [ -n "$RELEASE_NOTES" ]; then
  MESSAGE="✅ CheckUS 서버 업데이트가 완료되었습니다.\n\n📋 변경사항:\n${RELEASE_NOTES}"
else
  MESSAGE="✅ CheckUS 서버 업데이트가 완료되었습니다."
fi

# Python으로 JSON-safe 이스케이프
ESCAPED_MESSAGE=$(echo -e "$MESSAGE" \
  | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')

curl -s -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"text\":${ESCAPED_MESSAGE}}"
```

`jq`를 쓸 수도 있지만, GitHub Actions의 Ubuntu runner에는 Python3가 기본 설치되어 있어서 `json.dumps`를 썼다. `json.dumps`는 큰따옴표, 역슬래시, 줄바꿈 등을 모두 올바르게 이스케이프해준다. 출력값 자체가 따옴표로 감싸져 나오기 때문에 curl 호출에서 `${ESCAPED_MESSAGE}`를 그대로 넣으면 된다.

최종적으로 Slack에 오는 메시지는 이런 모양이다:

```
✅ CheckUS 서버 업데이트가 완료되었습니다.

📋 변경사항:
• 등록 체크리스트에서 학생/학부모에게 개별 가입 안내를 발송할 수 있습니다
• 알림톡 발송 상태가 '접수됨'/'발송 완료'로 구분됩니다
• 보호자 정보 전체 삭제 시 저장 안 되던 문제 수정
```

## 컨벤션의 진화: 왜 V1이 실패했는가

처음에는 단순한 규칙을 세웠다. 모든 `fix:` / `feat:` 커밋에 `[release-note]`를 붙이자.

```
feat: add bulk invite feature for registration checklist

[release-note] 등록 체크리스트에서 학생/학부모에게 개별 가입 안내를 발송할 수 있습니다
```

논리적으로는 맞다. 변경사항이 생길 때마다 기록하니까 누락될 일이 없다. 하지만 실전에서는 문제가 있었다.

한 번의 기능 개발에 커밋이 10~15개 생긴다. 서버, 프론트엔드, 문서까지 합치면 더 많다. 각 커밋마다 `[release-note]`를 달면 배포 알림이 20~30줄짜리 장문이 된다. Slack에 긴 메시지가 오면 사람들이 안 읽는다. 특히 비개발자는 첫 두 줄만 보고 넘긴다.

그래서 커밋 단위 기록에서 **배포 단위 요약**으로 바꿨다.

![V1 vs V2 릴리즈 노트 비교](/assets/images/posts/049-slack-deploy-notification/v1-v2-comparison.png)

### V2: 서브모듈당 하나의 Release Summary

개별 커밋에서는 `[release-note]`를 쓰지 않는다. 대신 main에 push하기 직전에 서브모듈마다 하나의 summary 커밋을 추가한다.

```
chore: release notes for F279 signup, F275 design

[release-note] 등록 체크리스트에서 학생/학부모에게 개별 가입 안내를 발송할 수 있습니다
[release-note] 알림톡 발송 상태가 '접수됨'/'발송 완료'로 구분됩니다
[release-note] 보호자 정보 전체 삭제 시 저장 안 되던 문제 수정
```

규칙은 간단하다.

- 한국어로 사용자 친화적 설명
- 서브모듈당 5줄 이내
- 관련 커밋은 하나로 그룹화 (예: 모달 수정 4건을 "모달 UI 개선" 1줄로)
- `chore:` 커밋이라 fallback에도 안 잡힌다 — `[release-note]` 라인만 추출됨

CI 코드는 하나도 안 바꿨다. 기존에 `grep '^\[release-note\]'`로 추출하던 로직이 그대로 동작한다. 커밋이 분산되어 있든, 하나의 summary 커밋에 모여 있든, grep 입장에서는 차이가 없다.

이건 도구의 문제가 아니라 **커뮤니케이션 설계**의 문제였다. 기술적으로는 V1도 V2도 동일하게 동작한다. 차이는 받는 사람이 읽느냐 안 읽느냐다. 배포 알림은 개발자를 위한 로그가 아니라, 사용자를 위한 안내문이다. 안내문은 짧아야 한다.

## 실패 알림: 단순하지만 중요하다

```yaml
- name: Notify Slack - Deploy Failed
  if: failure()
  run: |
    curl -s -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json; charset=utf-8' \
      -d '{"text":"❌ CheckUS 서버 배포에 실패했습니다. 확인이 필요합니다."}'
```

GitHub Actions의 `if: failure()`는 이전 step 중 하나라도 실패하면 실행된다. 빌드 실패, 배포 실패, health check 타임아웃 — 원인이 뭐든 이 알림은 온다.

1인 개발에서 실패 알림의 가치는 크다. 금요일 저녁에 배포하고 퇴근했는데 실패한 줄 모르면, 주말 내내 서비스가 죽어있을 수 있다. Slack 알림 하나로 바로 확인할 수 있다.

## 결과

이 시스템을 운영한 지 두 달 정도 됐다. 체감하는 변화는 세 가지다.

**선생님들이 배포 알림을 읽기 시작했다.** V1에서 20줄짜리 메시지를 보낼 때는 반응이 없었다. V2로 바꾸고 3~4줄짜리 요약을 보내니까 "아, 이 기능 추가됐군요" 하고 바로 써보는 경우가 생겼다. "이거 언제 고쳐져요?" 같은 질문도 줄었다. 이미 배포 알림으로 답이 갔으니까.

**배포 실패를 즉시 알 수 있다.** 예전에는 사용자가 "접속이 안 돼요" 하고 연락이 와서야 알았다. 지금은 실패 알림이 오면 핸드폰으로 바로 확인하고 조치한다. 한 번은 EC2에서 디스크 공간이 부족해서 Docker 이미지 pull이 실패한 적이 있었는데, 실패 알림 덕분에 5분 만에 대응했다.

**변경 이력이 자동으로 남는다.** Slack 채널에 배포 메시지가 시간순으로 쌓인다. "이 기능 언제 배포됐지?" 싶으면 Slack 검색하면 된다. 별도의 changelog 파일을 관리할 필요가 없어졌다.

## 마무리

전체 구조를 정리하면 이렇다.

![전체 구조 요약](/assets/images/posts/049-slack-deploy-notification/summary-table.png)

기술적으로 복잡한 건 없다. bash 스크립트, curl, grep, Python 한 줄. 이미 GitHub Actions를 쓰고 있다면 30분이면 붙일 수 있다.

중요한 건 도구보다 설계다. 누구에게, 어떤 정보를, 얼마나 짧게 전달할 것인가. 개발자끼리는 커밋 로그 전체를 보내도 읽는다. 하지만 배포 알림의 독자가 비개발자라면, 그건 안내문이지 로그가 아니다. V1에서 V2로 바꾼 게 코드 한 줄 수정이 아니라 커뮤니케이션 방식의 전환이었다는 게 이 작업에서 얻은 가장 큰 교훈이다.
