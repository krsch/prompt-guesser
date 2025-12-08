# Prompt Guesser Cloudflare backend

This package hosts a Cloudflare Workers backend that keeps game state inside a Durable Object. Each game maps to a single Durable Object instance, which owns the authoritative MVCC state, schedules round timeouts via alarms, and broadcasts updates over WebSockets.

## Bindings

Add the Durable Object binding, Workers AI binding, and export the class from your Worker configuration:

```
[[durable_objects.bindings]]
name = "GAME"
class_name = "PromptGuesserDurableObject"

[[ai]]
binding = "AI"
```

Image generation runs through Workers AI using the bound `AI` service. When the binding is absent the backend falls back to placeholder URLs.

The repository includes a `wrangler.toml` with the binding preconfigured. Deploy with `wrangler deploy` after setting any desired secrets.
