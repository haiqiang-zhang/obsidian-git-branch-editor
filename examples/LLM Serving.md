# Inference engine

Each step assigns GPU time to a batch of requests.

## Batch scheduler

### Admission control

#### Memory budget

##### KV cache

###### Block size

Smaller blocks limit unused slots at the end of a sequence.

#### Token budget

Split long prompts into chunks to leave room for decode tokens.

## Latency metrics

Track time to first token and the gaps between output tokens.
