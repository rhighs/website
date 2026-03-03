# Building a mini reverse proxy in Go

A reverse proxy sits between clients and your backend servicehub. A request comes in, the proxy decides where it should go, forwards it, and returns the response. That's the whole job.

I like building small versions of tools like this because they make the "magic" feel concrete. Once you build one yourself, HTTP routing and middleware patterns stop feeling abstract.

This post walks through `mini-rproxy`: a small reverse proxy written in Go. It supports path-prefix routing, header normalization, a health endpoint, and a runtime plugin system for request/response processing - all in a few hundred lines of code.

The full source is at [github.com/rhighs/mini-rproxy](https://github.com/rhighs/mini-rproxy).

## What we'll cover

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

With a forward proxy, *you* configure your browser or machine to send traffic through it, and it speaks on your behalf.

With a reverse proxy, the client usually has no idea it's there. The client hits one public address, and the proxy quietly decides which upstream service should handle the request.

Nginx, Caddy, Envoy, Kong: all of them are reverse proxies at heart. Their extra features (TLS termination, load balancing, auth, rate limiting) are the product. Underneath that, the loop is still simple: receive request, match route, forward request, return response.

Building one from scratch forces you to think about details most frameworks hide: how `Host` headers interact with upstreams, how query params should be preserved, what happens to hop-by-hop headers, and where request/response interception should live.

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

The flow is intentionally straightforward: route by prefix, rewrite and forward, then let plugins hook into request and response phases.

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

A request to `/fitness/users/123` matches `/fitness`, then that prefix gets stripped before forwarding. The upstream receives `/users/123`.

The matching rule is **longest prefix wins**. If both `/api` and `/api/v2` exist, a request to `/api/v2/users` should go to `/api/v2`, not `/api`.

In `mini-rproxy`, that behavior is implemented with a simple linear scan:

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

For a small route table, this is fine. If you had thousands of routes, you'd likely switch to a trie or radix tree. I kept it linear here because it is easy to read and easy to debug.

<br>

## The proxy handler

Go's standard library includes `net/http/httputil.ReverseProxy`. It handles forwarding, connection reuse, and response copying. The part you customize is the `Director` function, where you mutate the outgoing request before it is sent:

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

A few details are easy to miss:

- `strings.TrimPrefix` removes the matched route prefix. `/fitness/users/123` becomes `/users/123` before hitting upstream.
- `req.Host` needs to be rewritten. If you skip this, the upstream may see `localhost:8080` instead of its own host and route incorrectly.
- `X-Forwarded-Host` preserves the original host the client requested.
- `pluginAbortTransport` wraps `http.DefaultTransport` and checks a special abort header. If a plugin sets `X-MiniRProxy-Plugin-Abort`, the proxy exits early instead of forwarding:

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

The plugin system is where this project got interesting for me. Instead of hardcoding middleware, `mini-rproxy` loads `.so` files at startup (Go shared objects compiled with `-buildmode=plugin`). That lets you add request/response behavior without rebuilding the proxy binary.

### The plugin interface

Every plugin implements two methods:

```go
type Plugin interface {
    Name() string
    Handle(ctx *Context) error
}
```

`Context` carries everything a plugin needs: the request, the response (during response phase), a shared values map for passing state between phases, and the current phase:

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

Each plugin is called twice per request: once before forwarding and once after the upstream responds. The `Phase` field tells the plugin which stage it is in.

### Loading plugins at runtime

On startup, the proxy scans `-plugindir` for `.so` files and loads each one:

```go
plug, err := plugin.Open(path)
sym, err := plug.Lookup("MiniRProxyPluginInstance")
p := sym.(pluginapi.Plugin)
plugins = append(plugins, p)
```

Go's `plugin` package resolves exported symbols by name. By convention, each `mini-rproxy` plugin exports `MiniRProxyPluginInstance`. If it is missing, loading fails.

One gotcha: the main binary and all plugins must be built with the exact same Go version and the same `pluginapi` package. If they drift, plugin loading can panic. If you upgrade Go or change interfaces, rebuild everything together.

### Writing your own plugin

Here is a minimal plugin that adds a header in both phases:

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

Configuration lives in one YAML file:

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

`listen_addr` is where the proxy listens. `routes` is a list of prefix-to-upstream mappings. Longest prefix match wins.

CLI flags:

| Flag | Default | Description |
|---|---|---|
| `-config` | `config.yaml` | Path to YAML config |
| `-verbose` | `false` | Log each proxied request with upstream info |
| `-plugindir` | (empty) | Directory to scan for `.so` plugins |

<br>

## Health and configz endpoints

Two built-in endpoints bypass route matching:

- `GET /health` returns `{"message":"OK"}` with status 200. Useful for load balancers and orchestrators.

```bash
curl -i http://localhost:8080/health
```

- `GET /configz` returns the active route config as JSON. Useful for checking what the process actually loaded.

```bash
curl http://localhost:8080/configz | jq
```

<br>

## Running it

Local:

```bash
cp config.example.yml config.yaml
make run
```

Docker:

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

The most interesting parts were not route matching or YAML parsing. Those were straightforward. The hard parts were where HTTP details leak through: `Host` header behavior, hop-by-hop headers (thankfully handled by `httputil.ReverseProxy`), and plugin aborts that needed a transport wrapper.

`httputil.ReverseProxy` does most of the heavy lifting, and it is worth reading [the source](https://cs.opensource.google/go/go/+/refs/tags/go1.22.0:src/net/http/httputil/reverseproxy.go). The `Director` pattern is refreshingly simple: you get a pointer to the outgoing request and adjust it in place.

If I revisited this project, I would redesign the plugin layer first. Go's native plugin mechanism works, but the build coupling between the main binary and `.so` files is fragile. For many teams, an in-process middleware chain (`[]func(http.Handler) http.Handler`) is simpler. If runtime extensibility is a hard requirement, WebAssembly-based plugins are probably a better fit.

Full source:

```bash
git clone https://github.com/rhighs/mini-rproxy.git
cd mini-rproxy
cp config.example.yml config.yaml
make run
```

Thanks for reading.
