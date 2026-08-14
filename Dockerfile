# 데이터 파이프라인 컨테이너 — 원본 CSV를 마운트하면 지역 데이터 팩을 재현 생성한다.
# 앱 서빙용이 아니다 (앱은 Vercel). 파이프라인 재현성 확보가 목적 (README §Docker).
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# 입출력은 전부 볼륨 마운트:
#   ./data        → /app/data        (원본 CSV — data/raw/*.csv, gitignore 대상)
#   ./public/data → /app/public/data (산출: 지역 팩 JSON + 레지스트리)
#   ./src/data    → /app/src/data    (산출: industry-risk.generated.json — 생존 분석 시)
ENTRYPOINT ["npx", "tsx"]
CMD ["scripts/build-region.ts", "--sigungu=11170"]
