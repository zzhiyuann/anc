.PHONY: dev test build clean

dev:
	npx tsx src/index.ts serve &
	cd apps/web && npm run dev

test:
	npx vitest run
	cd apps/web && npx tsc --noEmit

build:
	npm run build
	cd apps/web && npm run build

clean:
	rm -rf dist apps/web/.next macos/build ios/build
