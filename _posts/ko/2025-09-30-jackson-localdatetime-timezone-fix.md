---
layout: post
title: "Spring Boot에서 LocalDateTime을 UTC로 직렬화할 때 타임존 표시(Z) 추가하기"
date: 2025-09-30 17:30:00 +0900
categories: [Spring Boot, Jackson]
tags: [spring-boot, jackson, localdatetime, timezone, serialization]
lang: ko
slug: "002"
---


## TL;DR

Spring Boot + Jackson 환경에서 `LocalDateTime`을 JSON으로 직렬화할 때, **타임존 정보(Z)가 누락**되어 프론트엔드에서 시간이 잘못 표시되는 문제를 **커스텀 Serializer**로 해결한 경험을 공유합니다.

```java
// 문제: Z가 없어서 브라우저가 로컬 타임존으로 해석
"startTime": "2025-10-01T01:44:06"

// 해결: Z를 붙여서 UTC임을 명시
"startTime": "2025-10-01T01:44:06Z"
```

---

## 문제 상황

### 증상

학생 관리 시스템에서 **공부 시작 시간이 9시간 과거로 기록**되는 버그가 발생했습니다.

- **실제 시작 시간**: 오전 10:44
- **화면 표시**: 오전 01:44 (9시간 차이!)

### 원인 분석

1. **서버 측**:
   - JVM 타임존: UTC (TimeZoneConfig로 설정)
   - `LocalDateTime.now()` 호출 → UTC 시간 01:44 반환
   - DB에 UTC 01:44 저장 ✅

2. **API 응답**:
   ```json
   {
     "startTime": "2025-10-01T01:44:06"  // ❌ Z 없음!
   }
   ```

3. **프론트엔드 (React)**:
   ```javascript
   // Z가 없으면 브라우저가 로컬 타임존으로 해석
   new Date("2025-10-01T01:44:06")
     .toLocaleString('ko-KR')
   // → "2025. 10. 1. 오전 1:44:06" ❌ (한국 시간 01:44로 해석)

   // Z가 있으면 UTC로 인식 후 자동 변환
   new Date("2025-10-01T01:44:06Z")
     .toLocaleString('ko-KR')
   // → "2025. 10. 1. 오전 10:44:06" ✅ (UTC → 한국 시간 변환)
   ```

### 근본 원인

**Jackson의 기본 `LocalDateTimeSerializer`가 타임존 표시자(Z)를 붙이지 않았습니다.**

---

## 왜 LocalDateTime은 Z를 안 붙이나?

웹 검색 결과, 이는 **설계상 의도된 동작**이었습니다:

> "LocalDateTime cannot use zone offset patterns (like XXXX) because it has no offset information, and ISO8601 discourages using Local Time as it's ambiguous when communicating across different time zones."
>
> — [Stack Overflow: How to serialize LocalDateTime with Jackson?](https://stackoverflow.com/questions/41749539/how-to-serialize-localdatetime-with-jackson)

**핵심**:
- `LocalDateTime`은 타임존 정보가 없는 "로컬 시간"
- 따라서 `Z`(UTC)를 붙이는 것은 기술적으로 모순
- ISO 8601 표준도 타임존 정보 없는 Local Time 사용을 권장하지 않음

**권장 해결책**:
- `ZonedDateTime` 또는 `OffsetDateTime` 사용

하지만 이미 DB에 `LocalDateTime`을 사용 중이라면?

---

## 기존 해결 방법들을 찾아보니...

### 한국 블로그에서 찾은 방법들

타임존 문제를 검색하다 보니 여러 한국 블로그에서 비슷한 문제를 다루고 있었습니다:

1. **@JsonFormat 어노테이션 사용** ([lejewk.github.io](https://lejewk.github.io/jpa-localdatetime-jsonformat/))
   ```java
   @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss'Z'", timezone = "UTC")
   private LocalDateTime startTime;
   ```
   - ❌ **모든 필드마다** 어노테이션을 붙여야 함
   - ❌ 유지보수 어려움 (놓치기 쉬움)

2. **JavaTimeModule 등록** ([velog.io/@sago_mungcci](https://velog.io/@sago_mungcci/스프링-Java-8-LocalDateTime-직렬화-역직렬화-오류))
   ```java
   ObjectMapper mapper = new ObjectMapper();
   mapper.registerModule(new JavaTimeModule());
   mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
   ```
   - ❌ 기본 설정으로는 Z를 안 붙여줌

3. **application.properties 설정**
   ```properties
   spring.jackson.serialization.write-dates-as-timestamps=false
   spring.jackson.date-format=yyyy-MM-dd'T'HH:mm:ss'Z'
   ```
   - ❓ LocalDateTime에 적용되는지 불확실

### 해외 자료에서 찾은 힌트

결국 [Stack Overflow](https://stackoverflow.com/questions/41749539/how-to-serialize-localdatetime-with-jackson)와 [Baeldung](https://www.baeldung.com/spring-boot-customize-jackson-objectmapper)에서 답을 찾았습니다:

> "LocalDateTime에 Z를 붙이는 건 기술적으로 모순이지만, 커스텀 Serializer를 만들면 가능하다"

---

## 우리의 해결 방법: 커스텀 Serializer

**핵심 아이디어**:
- "DB의 모든 `LocalDateTime`은 UTC로 간주한다"는 Convention을 정하고
- Jackson 직렬화 시 **전역적으로** Z를 추가
- 필드마다 어노테이션 붙이는 번거로움 제거

### 1. 커스텀 Serializer 작성

```java
package saomath.checkusserver.common.config;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.TimeZone;

@Configuration
public class JacksonConfig {

    /**
     * LocalDateTime을 UTC 기준으로 직렬화하는 커스텀 Serializer
     * 출력 형식: yyyy-MM-ddTHH:mm:ssZ (예: 2025-10-01T01:44:06Z)
     */
    public static class UtcLocalDateTimeSerializer extends JsonSerializer<LocalDateTime> {
        private static final DateTimeFormatter FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");

        @Override
        public void serialize(LocalDateTime value, JsonGenerator gen,
                            SerializerProvider serializers) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.format(FORMATTER));
            }
        }
    }

    @Bean
    @Primary
    public ObjectMapper objectMapper() {
        JavaTimeModule module = new JavaTimeModule();

        // LocalDateTime 직렬화: UTC 기준으로 Z 포함
        module.addSerializer(LocalDateTime.class, new UtcLocalDateTimeSerializer());

        return new ObjectMapper()
                .registerModule(module)
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .setTimeZone(TimeZone.getTimeZone("UTC"));
    }
}
```

### 2. 핵심 포인트

**DateTimeFormatter 패턴**:
```java
DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'")
//                                                 ^^^
//                           작은따옴표로 감싼 'Z'는 문자 그대로 출력
```

**JsonGenerator 사용**:
```java
gen.writeString(value.format(FORMATTER));
// JsonGenerator를 직접 사용하여 문자열 출력
// 이렇게 해야 Z가 확실히 포함됨
```

### 3. 왜 기본 LocalDateTimeSerializer는 안 됐을까?

처음에는 이렇게 시도했지만 실패했습니다:

```java
// ❌ 이렇게 하면 Z가 안 붙음
private static final DateTimeFormatter UTC_FORMATTER =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");

module.addSerializer(LocalDateTime.class,
    new LocalDateTimeSerializer(UTC_FORMATTER));
```

**원인**:
- Spring Boot의 Auto-configuration과 충돌
- `LocalDateTimeSerializer`의 내부 구현이 포맷터를 무시하는 경우가 있음
- 따라서 `JsonSerializer`를 직접 상속받아 `gen.writeString()` 사용

---

## 결과

### Before
```json
{
  "startTime": "2025-10-01T01:44:06",
  "endTime": "2025-10-01T01:53:08"
}
```

브라우저 표시: **오전 01:44** ❌ (9시간 과거)

### After
```json
{
  "startTime": "2025-10-01T01:44:06Z",
  "endTime": "2025-10-01T01:53:08Z"
}
```

브라우저 표시: **오전 10:44** ✅ (정상)

---

## 전체 흐름 정리

```
┌─────────────────┐
│  Server (UTC)   │
│  10:44 KST =    │
│  01:44 UTC      │
└────────┬────────┘
         │
         │ LocalDateTime.now()
         │ → 01:44 (UTC)
         │
         ▼
┌─────────────────┐
│   Database      │
│   01:44 저장    │
└────────┬────────┘
         │
         │ API Response
         │
         ▼
┌─────────────────────────────┐
│  Jackson Serializer         │
│  UtcLocalDateTimeSerializer │
│  → "2025-10-01T01:44:06Z"   │
└────────┬────────────────────┘
         │
         │ JSON
         │
         ▼
┌──────────────────────────────┐
│  Frontend (Browser)          │
│  new Date("...Z")            │
│  → UTC 01:44 인식            │
│  → 한국 시간 10:44로 변환    │
│  → 화면에 10:44 표시 ✅      │
└──────────────────────────────┘
```

---

## 대안: ZonedDateTime 사용

더 나은 장기적 해결책은 `ZonedDateTime` 또는 `OffsetDateTime`을 사용하는 것입니다:

```java
// Entity
@Column(name = "start_time")
private ZonedDateTime startTime;

// Service
ZonedDateTime now = ZonedDateTime.now(ZoneId.of("UTC"));
```

**장점**:
- 타임존 정보가 객체에 포함됨
- Jackson이 자동으로 올바른 형식으로 직렬화
- 타입 안정성 증가

**단점**:
- 기존 DB 마이그레이션 필요
- 코드 전체 수정 필요

---

## 참고 자료

### 한국어 자료
- [스프링 Java 8 LocalDateTime 직렬화 역직렬화 오류](https://velog.io/@sago_mungcci/스프링-Java-8-LocalDateTime-직렬화-역직렬화-오류) - @JsonFormat 사용법
- [JPA LocalDateTime의 JSON format 처리](https://lejewk.github.io/jpa-localdatetime-jsonformat/) - 필드별 어노테이션 방식
- [HomoEfficio - Java8 LocalDateTime Jackson 직렬화 문제](https://github.com/HomoEfficio/dev-tips/blob/master/Java8-LocalDateTime-Jackson-%EC%A7%81%EB%A0%AC%ED%99%94-%EB%AC%B8%EC%A0%9C.md) - JavaTimeModule 설정

**특징**: 대부분 역직렬화(Z 파싱) 문제를 다루거나, 필드별 어노테이션 방식 소개. **커스텀 Serializer를 통한 전역 Z 추가 방법은 다루지 않음**.

### 영어 자료
- [Stack Overflow - How to serialize LocalDateTime with Jackson?](https://stackoverflow.com/questions/41749539/how-to-serialize-localdatetime-with-jackson) - 커스텀 Serializer 힌트
- [Baeldung - Customize Jackson ObjectMapper in Spring Boot](https://www.baeldung.com/spring-boot-customize-jackson-objectmapper) - ObjectMapper 커스터마이징
- [Mkyong - Jackson Custom Serializer Examples](https://mkyong.com/java/jackson-custom-serializer-and-deserializer-examples/) - Serializer 구현 예제

---

## 마치며

`LocalDateTime`의 타임존 문제는 Spring Boot + React 조합에서 흔히 발생하는 이슈입니다.

**핵심은**:
1. 서버는 UTC로 저장 (글로벌 표준)
2. API 응답에 명시적으로 `Z` 포함 (타임존 정보 제공)
3. 프론트엔드는 브라우저의 `Date` 객체가 자동 변환하도록 위임

이 방법으로 타임존 문제를 깔끔하게 해결할 수 있습니다!

---

**작성일**: 2025-10-01
**기술 스택**: Spring Boot 3.4.5, Jackson 2.x, React, TypeScript
**프로젝트**: CheckUS (학생 관리 시스템)
