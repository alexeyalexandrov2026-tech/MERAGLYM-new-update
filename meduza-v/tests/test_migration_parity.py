"""The migration and the models must not drift apart.

There is no PostgreSQL server in the test environment, so instead of applying
the migration we compile it to PostgreSQL DDL offline (exactly what
``alembic upgrade head --sql`` produces) and compare the tables and columns it
creates against ``Base.metadata``. A column added to a model without a
migration — the classic way a deploy breaks — fails this test.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models import Base
from tests.conftest import TEST_DATABASE_URL, requires_postgres

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _compiled_migration_sql() -> str:
    """Run every migration in offline mode against the PostgreSQL dialect."""
    from alembic.runtime.environment import EnvironmentContext
    from alembic.runtime.migration import MigrationContext  # noqa: F401

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    script = ScriptDirectory.from_config(config)
    buffer = io.StringIO()

    def do_run(rev, context):
        return script._upgrade_revs("head", rev)

    with EnvironmentContext(
        config, script, fn=do_run, as_sql=True, output_buffer=buffer,
        destination_rev="head", starting_rev=None,
    ) as env:
        env.configure(dialect_name="postgresql", as_sql=True)
        with env.begin_transaction():
            env.run_migrations()
    return buffer.getvalue()


def _tables_from_sql(sql: str) -> dict[str, set[str]]:
    tables: dict[str, set[str]] = {}
    for match in re.finditer(
        r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.DOTALL
    ):
        name, body = match.group(1), match.group(2)
        columns = set()
        for line in body.split("\n"):
            line = line.strip().rstrip(",")
            # Word-boundary match: "checkout_url" must not read as "CHECK".
            if not line or re.match(
                r"(PRIMARY KEY|UNIQUE|CONSTRAINT|FOREIGN KEY|CHECK)\b", line.upper()
            ):
                continue
            columns.add(line.split()[0])
        tables[name] = columns
    return tables


@pytest.fixture(scope="module")
def migration_tables() -> dict[str, set[str]]:
    return _tables_from_sql(_compiled_migration_sql())


def test_every_model_table_exists_in_the_migration(migration_tables):
    model_tables = set(Base.metadata.tables)
    missing = model_tables - set(migration_tables) - {"alembic_version"}
    assert not missing, f"models define tables the migration never creates: {missing}"


def test_every_model_column_exists_in_the_migration(migration_tables):
    drift: dict[str, set[str]] = {}
    for name, table in Base.metadata.tables.items():
        migrated = migration_tables.get(name)
        if migrated is None:
            continue
        missing = {c.name for c in table.columns} - migrated
        if missing:
            drift[name] = missing
    assert not drift, f"columns present in models but not in the migration: {drift}"


def test_migration_creates_no_table_the_models_do_not_define(migration_tables):
    extra = set(migration_tables) - set(Base.metadata.tables) - {"alembic_version"}
    assert not extra, f"migration creates tables the models do not define: {extra}"


def test_webhook_dedupe_constraint_is_present():
    sql = _compiled_migration_sql()
    assert "uq_webhook_provider_event" in sql, "webhook idempotency index is missing"
    assert "UNIQUE (dedupe_key)" in sql, "receipt dedupe index is missing"
    # JSONB, not TEXT — the payload is queried by key in production.
    assert "payload JSONB" in sql


# --------------------------------------------------------------------------- #
# The strongest parity check available: apply the migrations to a real server
# and ask alembic whether the resulting schema differs from the models at all.
# --------------------------------------------------------------------------- #
@requires_postgres
def test_applied_migration_matches_the_models_exactly():
    """Run `alembic upgrade head` on a live database, then diff against the ORM.

    The text-based checks above catch missing tables and columns. This catches
    everything else alembic knows about: type mismatches, nullability, server
    defaults, indexes and constraints.
    """
    import asyncio

    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy.ext.asyncio import create_async_engine

    sync_url = TEST_DATABASE_URL.replace("+asyncpg", "")
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", sync_url)

    async def build_schema_from_migrations() -> list:
        engine = create_async_engine(TEST_DATABASE_URL)
        try:
            # Start from nothing so the migration builds the whole schema.
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
            await asyncio.to_thread(command.upgrade, config, "head")
            async with engine.connect() as conn:
                return await conn.run_sync(
                    lambda sync_conn: compare_metadata(
                        MigrationContext.configure(sync_conn), Base.metadata
                    )
                )
        finally:
            await engine.dispose()

    diffs = asyncio.run(build_schema_from_migrations())
    # alembic reports the bookkeeping table as an addition; it is not ours.
    real = [d for d in diffs if "alembic_version" not in str(d)]
    assert not real, f"migration and models disagree: {real}"
