"""Repository-root pytest configuration.

`meduza-v/` is a self-contained project: it has its own `pytest.ini`, its own
dependencies (FastAPI, SQLAlchemy, an async driver) and its own CI workflow,
`.github/workflows/meduza-v-ci.yml`, which runs its suite against both SQLite
and PostgreSQL.

A bare `pytest` at the repository root would recurse into it anyway. That fails
at collection rather than at a test: its modules import `tests.conftest`, which
resolves against `meduza-v/` as rootdir, not against this directory — and even
if the import succeeded, the root workflow installs none of the dependencies
those tests need. One collection error aborts the whole run, so this took the
root workflow down with it.
"""

collect_ignore = ["meduza-v"]
