# DNN Training

## Model Parallelism

### Pipeline Parallelism

#### GPipe

##### Micro-batches

###### Pipeline Bubbles

Stages sit idle while the pipeline fills and drains.

### Tensor Parallelism

Several GPUs share the work of a single layer.

# Optimizing LLMs

## KV Caching

Reuse keys and values from earlier tokens during decoding.
