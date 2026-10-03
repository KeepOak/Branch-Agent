# Branch Agent Amazon Bedrock Provider

Official Branch Agent provider plugin for Amazon Bedrock. It adds Bedrock model discovery, text generation, embeddings, and guardrail-aware provider routing for agents that use AWS-hosted models.

Install from Branch Agent:

```bash
branch plugins install @branch/amazon-bedrock-provider
```

Configure AWS credentials and region through your normal Branch Agent credential/profile setup, then select Bedrock models with the `amazon-bedrock/...` provider prefix.
