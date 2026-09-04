.PHONY: help install dev test lint migrate seed run worker docker-up docker-down backup

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install:  ## Install runtime + dev dependencies into the active environment
	pip install -r requirements-dev.txt

test:  ## Run the full test suite
	pytest -q

lint:  ## Static checks
	ruff check app tests
	ruff format --check app tests

migrate:  ## Apply database migrations
	alembic upgrade head

revision:  ## Autogenerate a migration: make revision M="add coupons"
	alembic revision --autogenerate -m "$(M)"

seed:  ## Load the sample catalog
	python -m app.seed

run:  ## Run the API locally with reload
	uvicorn app.main:app --reload --port 8000

worker:  ## Run the background worker locally
	python -m app.worker

docker-up:  ## Build and start the full 24/7 stack
	docker compose up -d --build

docker-down:  ## Stop the stack
	docker compose down

backup:  ## Take an ad-hoc database backup
	docker compose exec -T db pg_dump -U meduza -d meduza -Fc > backups/manual-$$(date +%Y%m%dT%H%M%SZ).dump
