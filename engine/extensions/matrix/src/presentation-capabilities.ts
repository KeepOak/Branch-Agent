import type { ChannelOutboundAdapter } from "branch/plugin-sdk/channel-contract";

export const matrixPresentationCapabilities = {
  supported: true,
  buttons: true,
  selects: true,
  context: true,
  divider: true,
  limits: {
    text: {
      markdownDialect: "markdown",
      supportsEdit: true,
    },
  },
} satisfies NonNullable<ChannelOutboundAdapter["presentationCapabilities"]>;
