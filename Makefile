.PHONY: install dev build lint typecheck test format clean docker ci

install:
	pnpm install

ci: typecheck lint test build
	@echo "==> CI passed (typecheck + lint + test + build)"

dev:
	pnpm dev

build:
	pnpm build

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

format:
	pnpm format

clean:
	pnpm clean

docker:
	docker build -f docker/Dockerfile -t athena-shell:dev .

docker-run:
	docker run --rm -e MOCK_AUTH=1 -p 8080:8080 athena-shell:dev
