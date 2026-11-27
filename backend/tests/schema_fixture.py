"""Prepare registered optional schemas only in explicit disposable test fixtures."""

from sqlalchemy import text

OPTIONAL_SCHEMAS = (
    ("chatbot_requests", "install-chatbot-schema"),
    ("marketing_pages", "install-marketing-schema"),
)


def require_test_app(app):
    if app.config.get("APP_ENV") != "testing" or app.config.get("TESTING") is not True:
        raise ValueError("Schema fixtures require an explicit testing application.")


def upgrade_test_schema(app):
    require_test_app(app)
    runner = app.test_cli_runner()
    tables = app.extensions["sqlalchemy"].metadata.tables
    commands = [["db", "upgrade"]]
    commands.extend([command] for marker, command in OPTIONAL_SCHEMAS if marker in tables)
    for args in commands:
        result = runner.invoke(args=args)
        if result.exit_code:
            raise RuntimeError(f"Test schema setup failed: {' '.join(args)}") from result.exception


def remove_optional_test_schemas(app, engine):
    """Remove extension dependencies before the disposable core downgrade-to-base test."""
    require_test_app(app)
    metadata = app.extensions["sqlalchemy"].metadata
    tables = [
        table
        for table in metadata.sorted_tables
        if table.name == "chatbot_requests" or table.name.startswith("marketing_")
    ]
    if not tables:
        return
    with engine.begin() as connection:
        metadata.drop_all(connection, tables=tables)
        if any(table.name.startswith("marketing_") for table in tables):
            connection.execute(text("DROP TABLE IF EXISTS marketing_schema_versions"))
            connection.execute(text("DROP FUNCTION IF EXISTS marketing_reject_mutation()"))
