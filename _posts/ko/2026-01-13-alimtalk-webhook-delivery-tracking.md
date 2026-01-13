---
layout: post
title: "\"알림톡 발송 성공\"이라고 믿었는데, 한 달간 아무도 못 받고 있었다"
date: 2026-01-12 11:00:00 +0900
categories: [Backend, Debugging]
tags: [alimtalk, webhook, spring-boot, bizgo, incident]
lang: ko
slug: "023"
thumbnail: /assets/images/posts/023-alimtalk-webhook/thumbnail.png
---

![알림톡 발송 실패 - 한 달간 몰랐던 사고](/assets/images/posts/023-alimtalk-webhook/thumbnail.png){: width="700"}

## TL;DR
비즈고 API의 "A000" 응답을 발송 성공으로 처리했다가, 한 달간 알림톡이 실제로는 전달되지 않았던 사고. A000은 "접수 성공"이지 "발송 성공"이 아니었다. Webhook으로 실제 결과를 추적해서 해결했다.

---

## 배경: API 응답 = 발송 성공?

우리 시스템의 알림 내역 화면. 모두 "발송 완료"로 표시되어 있었다:

![CheckUS 알림 내역 - 모두 성공으로 표시](/assets/images/posts/023-alimtalk-webhook/checkus-notification-history.jpg){: width="600"}

기존 코드는 이렇게 동작했다:

```java
ResponseEntity<String> response = restTemplate.postForEntity(url, entity, String.class);

if (response.getStatusCode() == HttpStatus.OK) {
    JsonNode responseJson = objectMapper.readTree(response.getBody());
    String code = responseJson.path("code").asText();

    if ("A000".equals(code)) {
        // 성공! → 바로 SENT 처리
        history.setStatus(NotificationStatus.SENT);
    }
}
```

문제는 **A000이 "발송 성공"이 아니라 "발송 요청 접수 성공"**이라는 점이다.

비즈고 API 응답 흐름:
```
우리 서버 → 비즈고 서버 → 카카오 서버 → 사용자 단말기
         ↑
    여기서 A000 반환
    (아직 카카오에 안 갔음)
```

실제로 카카오 서버까지 도달하고, 사용자 단말기에 전달되기까지는 추가 과정이 필요하다. 비즈고 블로그에서도 이 점을 명확히 설명한다:

> "A000 코드는 메시지 발송 요청이 비즈고 시스템에 '정상적으로 접수'되었다는 신호일 뿐, 고객의 휴대폰에 메시지가 도착했음을 보장하는 것은 아닙니다."
> — [비즈고 블로그](https://blog.bizgo.io/howto/messaging-api-integration-common-mistakes/)

---

## 문제 발견: 한 달 후

![슬랙 메세지](/assets/images/posts/023-alimtalk-webhook/slack-alert.png){: width="600"}

슬랙으로 에러 제보를 받고 이전에 자동이체 설정에 문제가 있어 연체된 적이 있던 것이 떠올라 비즈고 콘솔을 확인해보니 계정이 정지되어 있었다.

![비즈고 콘솔 - 발송 실패 내역](/assets/images/posts/023-alimtalk-webhook/bizgo-console-failed.jpg){: width="600"}

```
reportCode: 64008
resultMsg: 계정 사용 권한 없음
```

하지만 API 응답은 계속 A000(성공)이었기 때문에 **우리 시스템에서는 전혀 알 수 없었다**.

주요 실패 코드들:
- `10000`: 성공 (단말기 정상 도착)
- `64008`: 계정 사용 권한 없음
- `64016`: 카카오톡 미사용자
- `22000`: 전송 시간 초과

---

## 해결: Webhook으로 실제 결과 추적

비즈고는 발송 결과를 Webhook으로 전달해준다. 이걸 받아서 실제 상태를 업데이트하도록 변경했다.

### Webhook 등록 방법

여기서 삽질했다. **비즈고 관리 콘솔에서 Webhook URL을 직접 등록할 수 없다!**

처음엔 담당자에게 이메일로 요청했다:

> **문의 내용**
>
> 안녕하세요,
>
> 알림톡 발송 결과 리포트를 Webhook으로 수신하기 위해
> URL 등록을 요청드립니다.
>
> - Webhook URL: https://api.checkus.app/webhook/bizgo/alimtalk
> - Method: POST
> - Content-Type: application/json

담당자가 등록 완료 후 전화로 확인 방법을 알려줬다:

#### 1. 연동 관리 메뉴 접근

![비즈고 콘솔 - 연동 관리 메뉴](/assets/images/posts/023-alimtalk-webhook/bizgo-console-webhook-menu.jpg){: width="700"}

좌측 메뉴에서 **"연동 관리"** 클릭. 그런데 여기서 상세 정보를 보려면 각 항목의 **"상세"** 버튼을 클릭해야 한다.

#### 2. 리포트 탭에서 Webhook URL 확인

![비즈고 콘솔 - Webhook URL 확인](/assets/images/posts/023-alimtalk-webhook/bizgo-console-webhook-detail.jpg){: width="700"}

상세 팝업에서 **"리포트"** 탭을 클릭하면 등록된 Webhook URL을 확인할 수 있다.

```
❌ 관리 콘솔에서 직접 등록/수정 불가
✅ 담당자에게 요청 → 등록 완료 → 연동 관리 > 상세 > 리포트 탭에서 확인
```

등록 완료 후 테스트 발송으로 Webhook이 정상적으로 오는지 확인 필수.

### 변경된 상태 흐름

![알림톡 발송 상태 흐름](/assets/images/posts/023-alimtalk-webhook/status-flow-diagram.svg){: width="700"}

```
발송 요청 → API 성공(A000) → PENDING (msgKey 저장)
                        ↓
           Webhook 수신 → reportCode 확인
                        ↓
             10000 → SENT (발송 성공)
             기타  → DEAD_LETTER (발송 실패)
```

### 핵심 구현 코드

**1. msgKey 추출 및 저장**

```java
// DirectAlimtalkService.java
private String extractMsgKey(JsonNode responseJson) {
    // data 객체 안에 있는 경우
    JsonNode dataNode = responseJson.path("data");
    if (!dataNode.isMissingNode()) {
        String msgKey = dataNode.path("msgKey").asText();
        if (!msgKey.isEmpty()) {
            return msgKey;
        }
    }
    // 최상위에 있는 경우
    return responseJson.path("msgKey").asText();
}
```

msgKey는 비즈고가 발급하는 고유 식별자다. 나중에 Webhook이 올 때 어떤 발송 건인지 매칭하는 데 사용한다.

**2. Webhook Controller**

```java
@PostMapping("/alimtalk")
public ResponseEntity<Map<String, String>> receiveAlimtalkWebhook(
        @RequestBody BizgoWebhookRequest request,
        HttpServletRequest httpRequest) {

    String clientIp = getClientIp(httpRequest);

    // IP 검증 (비즈고 서버만 허용)
    if (!isAllowedIp(clientIp)) {
        log.warn("허용되지 않은 IP에서 Webhook 요청: {}", clientIp);
        // 보안상 403 대신 200 반환 (공격자에게 정보 노출 방지)
        return buildResponse(request.getMsgKey());
    }

    // Webhook 처리
    bizgoWebhookService.processWebhook(request);

    // 비즈고 규격: {"msgKey": "..."} 반환
    return buildResponse(request.getMsgKey());
}
```

**3. 상태 업데이트 서비스**

```java
@Transactional
public void processWebhook(BizgoWebhookRequest request) {
    String msgKey = request.getMsgKey();

    NotificationHistory history = historyRepository
        .findByExternalId(msgKey)
        .orElse(null);

    if (history == null) {
        log.warn("매칭되는 History 없음: msgKey={}", msgKey);
        return;
    }

    if (request.isSuccess()) {  // reportCode == "10000"
        history.setStatus(NotificationStatus.SENT);
    } else {
        history.setStatus(NotificationStatus.DEAD_LETTER);
        history.setErrorMessage(request.getResultMsg());
    }
}
```

---

## 보안 고려사항

Webhook 엔드포인트는 외부에서 호출하므로 보안이 중요하다.

**1. IP 허용 목록**

```java
private static final Set<String> ALLOWED_IPS = Set.of(
    "211.115.98.154",
    "211.115.98.155",
    "211.115.98.205",
    "3.37.214.83",
    "3.39.75.204",
    "43.200.251.230"
);
```

비즈고가 제공하는 Webhook 서버 IP만 허용한다.

**2. Spring Security 설정**

```java
.requestMatchers("/webhook/**").permitAll()
```

Webhook은 JWT 인증 없이 접근 가능해야 한다. 대신 IP 검증으로 보안을 확보한다.

**3. 응답 규격**

```java
// 항상 200 OK + msgKey 반환
// 실패해도 200을 반환해야 비즈고가 재시도하지 않음
return ResponseEntity.ok(Map.of("msgKey", msgKey));
```

비즈고는 5초 타임아웃, 최대 3회 재시도한다. 1일 실패 1,000회 초과 시 계정이 차단될 수 있으므로 주의.

---

## 결과

이제 발송 실패를 즉시 감지할 수 있다:

- **PENDING**: API 요청 접수됨, 결과 대기 중
- **SENT**: Webhook으로 성공 확인 (reportCode: 10000)
- **DEAD_LETTER**: Webhook으로 실패 확인

실제로 Webhook이 정상 작동하면서 이제는 실패 건을 바로 알 수 있게 되었다.

추후 DEAD_LETTER 건에 대해 알림을 보내거나, 대시보드에서 모니터링하는 기능을 추가할 수 있다.

---

## 배운 점

1. **API 응답 ≠ 최종 결과**: 외부 서비스 연동 시 응답 코드의 의미를 정확히 파악해야 한다
2. **비동기 처리는 Webhook으로**: 결과가 나중에 확정되는 작업은 Webhook이나 Polling으로 추적
3. **조용한 실패가 가장 위험**: 에러 없이 "성공"으로 보이는 장애는 발견이 늦어진다

---

## 참고 자료

- [비즈고 블로그 - 메시지 전송 결과 리포트](https://blog.bizgo.io/inside/message-delivery-report-webhook-polling/)
- [비즈고 블로그 - 개발자가 자주하는 실수](https://blog.bizgo.io/howto/messaging-api-integration-common-mistakes/)
- [비즈고 API 개발가이드](https://infobank-guide.gitbook.io/omni-api-v2/)