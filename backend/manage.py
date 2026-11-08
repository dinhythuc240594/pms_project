"""Project CLI: only pms_api.config may load the local environment file."""

from flask.cli import FlaskGroup

from pms_api import create_app

cli = FlaskGroup(create_app=create_app, load_dotenv=False)

if __name__ == "__main__":
    cli()
