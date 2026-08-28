.PHONY: build
build:
	@pnpm build

.PHONY: dev
dev:
	@pnpm dev

.PHONY: test
test:
	@pnpm test

.PHONY: host
host:
	@python3 -m http.server 9999 --bind 127.0.0.1 --directory web.static
