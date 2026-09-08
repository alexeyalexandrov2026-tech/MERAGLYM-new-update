# Swagger UI (vendored)

The unmodified Swagger UI distribution, served from this project's own
`/static` so that `/docs` works on a machine with no internet access. The demo
installer runs entirely offline, and a docs page that silently renders blank
because a CDN is unreachable is worse than no docs page at all.

* Upstream: <https://github.com/swagger-api/swagger-ui> (Apache-2.0, see LICENSE)
* Obtained from the `swagger-ui-py` 25.7.1 PyPI wheel
  (<https://github.com/PWZER/swagger-ui-py>), which repackages that
  distribution without modification.
* Swagger UI 5.x. The exact upstream patch version is not recorded inside the
  artifact, so it is deliberately not claimed here; the directory is named
  after its provenance rather than a version that would be a guess. What
  matters for this project is that the bundle carries the `OpenAPI31` plugin:
  FastAPI emits an OpenAPI **3.1** schema, and Swagger UI 4.x rejects it with
  "The provided definition does not specify a valid version field".
* Only `swagger-ui-bundle.js` and `swagger-ui.css` are needed; FastAPI's
  `get_swagger_ui_html` references exactly these two.

Do not edit these files. To upgrade, replace both with a newer 5.x release.
