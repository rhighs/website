# Building a mini reverse proxy in Go

A reverse proxy sits between clients and your upstream servicehub. It receives requests, figures out where they should go, forwards them, and hands the response back. That's it. The concept is simple, which makes it a great thing to build from scratch — you learn a lot about HTTP, routing, and middleware patterns without drowning in complexity.

This article walks through `mini-rproxy`: a small, self-contained reverse proxy written in Go. It supports path-prefix routing, header normalization, a health endpoint, and a runtime plugin system for request/response processing — all in a few hundred lines of code.

The full source is at [github.com/rhighs/mini-rproxy](https://github.com/rhighs/mini-rproxy).

## Table of contents

- [What a reverse proxy actually does](#what-a-reverse-proxy-actually-does)
- [Architecture](#architecture)
- [Route matching](#route-matching)
- [The proxy handler](#the-proxy-handler)
- [Plugin system](#plugin-system)
  - [The plugin interface](#the-plugin-interface)
  - [Plugin phases](#plugin-phases)
  - [Loading plugins at runtime](#loading-plugins-at-runtime)
  - [Writing your own plugin](#writing-your-own-plugin)
- [Config format](#config-format)
- [Health and configz endpoints](#health-and-configz-endpoints)
- [Running it](#running-it)
- [To wrap up](#to-wrap-up)

<br>

## What a reverse proxy actually does

The forward proxy case is when *you* configure your browser to send traffic through a proxy — the proxy speaks on your behalf. A reverse proxy flips that: the client doesn't know or care about it. They hit one address, and the proxy decides where the request actually goes.

Nginx, Caddy, Envoy, Kong — all reverse proxies at their engine. The logic they add on top (TLS termination, load balancing, auth, rate limiting) is the real product. But the foundational piece is: receive request, match a route, rewrite and forward, return response.

Building one from scratch forces you to think about things you'd usually take for granted: how `Host` headers interact with upstreams, how to preserve query parameters, what happens to hop-by-hop headers, how you'd intercept the request/response cycle cleanly.

<br>

## Architecture

Here's the full request flow:

```
                    ┌─────────────────────────────────────┐
                    │           mini-rproxy                │
                    │                                      │
  Client            │  ┌──────────┐    ┌────────────────┐ │
─────────  HTTP ──► │  │  Router  │───►│ Plugin (Req)   │ │
  request           │  │(prefix)  │    └───────┬────────┘ │
                    │  └──────────┘            │          │
                    │                          ▼          │
                    │                  ┌───────────────┐  │
                    │                  │ ReverseProxy  │  │
                    │                  │  (Director)   │  │
                    │                  └───────┬───────┘  │
                    └──────────────────────────┼──────────┘
                                               │
                                               │  HTTP
                                               ▼
                               ┌───────────────────────────┐
                               │        Upstreams          │
                               │  /fitness → service A     │
                               │  /engine    → service B     │
                               │  /connect    → service C     │
                               └───────────────────────────┘
                                               │
                                               │  response
                                               ▼
                    ┌──────────────────────────────────────┐
                    │  Plugin (Resp) → Client              │
                    └──────────────────────────────────────┘
```

The router matches the incoming path against configured prefixes, the proxy rewrites and forwards to the right upstream, and plugins get to intercept at both ends.

<br>

## Route matching

Routes are prefix-based. Each route maps a path prefix to an upstream base URL:

```yaml
routes:
  - prefix: /fitness
    upstream: https://fitness.example.com
  - prefix: /engine
    upstream: https://engine.example.com
```

A request to `/fitness/users/123` matches `/fitness`, which gets stripped before forwarding — the upstream sees `/users/123`.

The matching rule is **longest prefix wins**. If you have `/api` and `/api/v2` configured, a request to `/api/v2/users` matches `/api/v2`, not `/api`. This is the sensible behavior and it's implemented as a simple linear scan:

```go
func findRoute(routes []Route, p string) (Route, bool) {
    var best Route
    hit := false
    bestLen := -1
    for _, r := range routes {
        if strings.HasPrefix(p, r.Prefix) && len(r.Prefix) > bestLen {
            best = r
            hit = true
            bestLen = len(r.Prefix)
        }
    }
    return best, hit
}
```

For a small number of routes this is fine. If you had thousands, you'd want a trie. But for a mini proxy, linear is readable and correct.

<br>

## The proxy handler

Go's standard library ships `net/http/httputil.ReverseProxy`. It handles the actual forwarding, connection pooling, and response copying. What you control is the `Director` function — it mutates the outgoing request before it's forwarded:

```go
proxy := &httputil.ReverseProxy{
    Director: func(req *http.Request) {
        req.URL.Scheme = up.Scheme
        req.URL.Host = up.Host
        req.URL.Path = strings.TrimPrefix(req.URL.Path, route.Prefix)
        req.Host = up.Host
        req.Header.Set("X-Forwarded-Host", req.Host)
    },
    Transport: &pluginAbortTransport{base: http.DefaultTransport},
}
```

A few things worth noting:

**Prefix stripping** — `strings.TrimPrefix` removes the matched route prefix from the path. `/fitness/users/123` becomes `/users/123` before hitting the upstream.

**Host header rewrite** — this one trips people up. If you don't rewrite `req.Host`, the upstream receives the original host (e.g. `localhost:8080`) instead of its own hostname. Most upstreams use the `Host` header for virtual hosting, so getting this wrong breaks things quietly.

**X-Forwarded-Host** — standard header that tells the upstream what host the original client requested. Useful for generating absolute URLs in responses.

**Transport wrapping** — `pluginAbortTransport` is a thin wrapper around `http.DefaultTransport` that checks for a special abort header. If a plugin sets `X-MiniRProxy-Plugin-Abort`, the proxy short-circuits and returns an error instead of forwarding:

```go
type pluginAbortTransport struct {
    base http.RoundTripper
}

func (t *pluginAbortTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    if msg := req.Header.Get(abortHeader); msg != "" {
        return nil, errors.New(msg)
    }
    return t.base.RoundTrip(req)
}
```

<br>

## Plugin system

The plugin system is where things get interesting. Rather than hardcoding middleware, mini-rproxy loads `.so` files at startup — Go shared objects compiled with `-buildmode=plugin`. This lets you add request/response processing without recompiling the proxy.

### The plugin interface

Every plugin implements two methods:

```go
type Plugin interface {
    Name() string
    Handle(ctx *Context) error
}
```

`Context` carries everything a plugin needs: the request, the response (if we're in the response phase), a shared values map for passing state between phases, and the current phase:

```go
type Context struct {
    Phase    Phase
    Request  *http.Request
    Response *http.Response
    Values   map[string]any
}
```

### Plugin phases

```
Request arrives
      │
      ▼
┌──────────────┐
│ PhaseRequest │  ← read/modify headers, body, or abort entirely
└──────┬───────┘
       │
       ▼
  Forward to upstream
       │
       ▼
┌───────────────┐
│ PhaseResponse │  ← read/modify response headers, body
└──────┬────────┘
       │
       ▼
Response sent to client
```

Each plugin is called twice per request — once before forwarding, once after receiving the upstream response. The `Phase` field tells the plugin which stage it's in.

### Loading plugins at runtime

On startup, the proxy scans the `-plugindir` directory for `.so` files and loads each one:

```go
plug, err := plugin.Open(path)
sym, err := plug.Lookup("MiniRProxyPluginInstance")
p := sym.(pluginapi.Plugin)
plugins = append(plugins, p)
```

Go's `plugin` package looks up an exported symbol by name. The convention is that every mini-rproxy plugin exports `MiniRProxyPluginInstance`. If the symbol isn't there, loading fails.

> **Important gotcha**: the main binary and all plugins must be compiled with the exact same Go version and the same `pluginapi` package. A mismatch causes a panic at load time. If you update Go or change the interface, rebuild everything.

### Writing your own plugin

Minimal plugin that adds a header to every proxied request:

```go
package main

import "github.com/tgym-digital/mini-rproxy/engine/pluginapi"

type HeaderDemo struct{}

func (h *HeaderDemo) Name() string { return "header-demo" }

func (h *HeaderDemo) Handle(ctx *pluginapi.Context) error {
    switch ctx.Phase {
    case pluginapi.PhaseRequest:
        ctx.Request.Header.Set("X-Demo-Request", "hello")
    case pluginapi.PhaseResponse:
        if ctx.Response != nil {
            ctx.Response.Header.Set("X-Demo-Response", "hello")
        }
    }
    return nil
}

var MiniRProxyPluginInstance pluginapi.Plugin = &HeaderDemo{}
```

Build it and run:

```bash
go build -buildmode=plugin -o bin/plugins/headerdemo.so ./plugins/headerdemo
./bin/mini-rproxy -config ./config.yaml -plugindir ./bin/plugins
```

<br>

## Config format

Everything lives in a single YAML file:

```yaml
listen_addr: ":8080"
routes:
  - prefix: /fitness
    upstream: https://fitness.example.com
  - prefix: /engine
    upstream: https://engine.example.com
  - prefix: /connect
    upstream: https://connect.example.com
```

`listen_addr` is the address the proxy listens on. Routes are a list of prefix → upstream pairs. Longest match wins.

CLI flags:

| Flag | Default | Description |
|---|---|---|
| `-config` | `config.yaml` | Path to YAML config |
| `-verbose` | `false` | Log each proxied request with upstream info |
| `-plugindir` | (empty) | Directory to scan for `.so` plugins |

<br>

## Health and configz endpoints

Two built-in endpoints that bypass the route matcher:

**`GET /health`** — returns `{"message":"OK"}` with 200. For load balancers and orchestrators.

```bash
curl -i http://localhost:8080/health
```

**`GET /configz`** — returns the current route config as JSON. Useful for verifying what's loaded without reading the file.

```bash
curl http://localhost:8080/configz | jq
```

<br>

## Running it

**Local:**

```bash
cp config.example.yml config.yaml
make run
```

**Docker:**

```bash
docker build -t mini-rproxy:latest .
docker run --rm \
  -p 8080:8080 \
  -v "$(pwd)/config.yaml:/app/config.yml:ro" \
  mini-rproxy:latest
```

Test with one of the example routes:

```bash
# proxies to https://fitness.example.com/hello-demo
curl http://localhost:8080/fitness/hello-demo | jq
```

<br>

## To wrap up

The interesting parts of building this weren't the routing or config parsing — those are straightforward. The interesting bits were the places where HTTP's design leaks through: the `Host` header rewrite, hop-by-hop header handling that `httputil.ReverseProxy` handles for you, and the plugin abort mechanism which required wrapping the transport rather than intercepting at a higher level.

Go's `httputil.ReverseProxy` does most of the heavy lifting and it's worth reading [its source](https://cs.opensource.google/go/go/+/refs/tags/go1.22.0:src/net/http/httputil/reverseproxy.go). The `Director` pattern is clean: you get a pointer to the outgoing request and mutate it however you want.

The plugin system is the part I'd redesign. Go's native plugin system works but the build coupling between main binary and `.so` files is painful. A better approach for most use cases would be a plain in-process middleware chain — `[]func(http.Handler) http.Handler` — or if you actually need runtime extensibility, something like WebAssembly plugins where isolation comes for free.

Full source:

```bash
git clone https://github.com/rhighs/mini-rproxy.git
cd mini-rproxy
cp config.example.yml config.yaml
make run
```

Thanks for reading.
