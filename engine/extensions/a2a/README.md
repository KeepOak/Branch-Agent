# A2A

Connect Branch Agent to other agents using the Agent2Agent protocol. The plugin
publishes an Agent Card, receives authenticated tasks, and sends messages to
configured peers using A2A 1.0 JSON-RPC.

## Get started

Enable `channels.a2a`, set your public `advertisedUrl`, and configure a separate
bearer token for each trusted peer under `channels.a2a.peers`. Add a peer's URL
and outbound token when Branch Agent should initiate messages to it.

Agent Card discovery is public. Limit `channels.a2a.exposeAgents` if only selected
agents should be advertised.

Peers can submit text tasks, not operator slash commands. Each peer can stream
replies (`SendStreamingMessage`, `SubscribeToTask`), list and cancel its own
tasks, and register push notification webhooks for task updates. Task records
are kept in Branch Agent's state store, so they survive a gateway restart; a
task that was still running when the gateway stopped is reported as failed.
File transfer is not supported.

See the [A2A guide](https://docs.openclaw.ai/channels/a2a) for configuration,
authentication, and task polling.
