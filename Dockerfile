# Coach Roostoo RAG backend — container for AWS App Runner (or any container host)
FROM python:3.12-slim

WORKDIR /app

# Install CPU-only PyTorch FIRST so we don't pull multi-GB CUDA libraries we don't need
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Then the rest of the dependencies (torch is already satisfied, so it won't be replaced)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Bake the embedding model + the RAG index into the image so the container starts fast
# (this downloads the sentence-transformers model and builds ./chroma_db from the cards)
RUN python rag.py

# App Runner injects PORT (default 8080); listen on it. Shell form so ${PORT} expands.
# --workers runs multiple processes so the CPU-bound RAG embedding parallelises
# across cores (bypassing the per-process GIL). Each worker loads its own copy of
# the model, so the task's memory must be sized for it (see the ECS task def).
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2
