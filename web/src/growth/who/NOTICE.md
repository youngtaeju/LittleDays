# WHO 성장 기준 데이터

이 폴더의 JSON 파일(`length-height-boys.json`, `length-height-girls.json`, `weight-boys.json`, `weight-girls.json`)은 WHO Child Growth Standards 의 확장 표(Expanded tables, z-scores, 일 단위 L, M, S)를 0~60개월 월 단위로 줄인 것입니다. 변환 스크립트는 `web/scripts/who-lms.mjs` 입니다.

## 출처

- WHO Child Growth Standards: https://www.who.int/tools/child-growth-standards/standards
- Length/height-for-age: https://www.who.int/tools/child-growth-standards/standards/length-height-for-age
  - `lhfa-boys-zscore-expanded-tables.xlsx`, `lhfa-girls-zscore-expanded-tables.xlsx`
- Weight-for-age: https://www.who.int/tools/child-growth-standards/standards/weight-for-age
  - `wfa-boys-zscore-expanded-tables.xlsx`, `wfa-girls-zscore-expanded-tables.xlsx`
- 받은 날짜: 2026-11-13

## 인용

WHO Child Growth Standards. Geneva: World Health Organization; 2006.

## 라이선스

WHO 출판물 기준 CC BY-NC-SA 3.0 IGO 로 간주(표 자체에는 명시 없음)

- 라이선스 본문: https://creativecommons.org/licenses/by-nc-sa/3.0/igo/

## 비상업 조건 안내

CC BY-NC-SA 3.0 IGO 는 출처 표시, 비상업적 이용, 같은 조건으로 공유를 요구합니다. 이 데이터를 상업적으로 이용하려면(이 데이터가 들어 있는 LittleDays 빌드를 상업적으로 배포하는 경우 포함) WHO 의 허가가 필요할 수 있습니다. 재배포할 때는 이 안내를 함께 두어야 합니다. WHO 는 이 데이터나 이를 이용한 결과물을 보증하거나 지지하지 않습니다.

## 변환 방법

- m개월은 m × 30.4375일에 가장 가까운 날(반올림)의 L, M, S 를 씁니다(WHO 확장 표 안내의 개월 환산).
- 키는 0~23개월에 누운 키(length, 0~730일), 24~60개월에 선 키(height, 731일부터)를 씁니다.
- 곡선 값은 LMS 공식 P = M × (1 + L × S × z)^(1/L) (L = 0 이면 M × e^(S × z))로 계산합니다.
