FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/python

COPY python/pyproject.toml ./pyproject.toml
RUN pip install --no-cache-dir \
    "httpx>=0.28.1" \
    "psycopg[binary]>=3.3.4" \
    "pydantic>=2.13.4" \
    "python-dotenv>=1.2.2"

COPY python/ ./

CMD ["python", "-m", "meraglym.etl.worker"]
