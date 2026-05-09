# common/events

In-process event bus for loose coupling between clinic modules.

Modules emit events via `eventBus.emitSafe(EVENTS.X, payload)`.
Other modules subscribe via `eventBus.on(EVENTS.X, handler)`.

When we scale to microservices, this gets replaced with Redis Pub/Sub
without changing publisher/subscriber code.

Files (will be added):

- `eventBus.js` — TypedEventBus class + canonical EVENTS constants
