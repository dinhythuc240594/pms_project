from alembic.script import ScriptDirectory
from flask import Flask
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from common import CommonMethodView, CommonURL

from .admin.features_urls import features
from .admin.urls import admin
from .auth.urls import auth
from .bookings.urls import booking
from .catalog.urls import catalog
from .channels.urls import channels
from .commands import register_commands
from .config import BACKEND_DIR, load_config
from .extensions import db, migrate
from .finance.urls import finance
from .health_urls import health as health_blueprint
from .housekeeping.urls import housekeeping
from .inventory.urls import inventory
from .model_registry import register_models
from .notifications_urls import notifications as notifications_blueprint
from .pricing.urls import pricing
from .reconciliation.urls import reconciliation
from .reports.urls import reports
from .saas_billing.urls import billing
from .security import register_security
from .workspace_urls import URL as WorkspaceURL


class URL(CommonURL):
    INDEX = "/"


class IndexView(CommonMethodView):
    def get(self):
        return self.json_response({"service": "LOHA PMS Backend API", "status": "running"})


def create_app(environ=None, *, env_file=BACKEND_DIR / ".env"):
    app = Flask(__name__)
    app.config.update(load_config(environ, env_file=env_file))
    proxies = app.config["TRUSTED_PROXY_COUNT"]
    if proxies:
        # Behind Coolify/Traefik every client otherwise shares the proxy's IP, which
        # turns the per-IP login limit into a global lockout anyone can trigger.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=proxies, x_proto=proxies)
    register_models()
    db.init_app(app)
    migration_directory = BACKEND_DIR / "migrations"
    migrate.init_app(app, db, directory=str(migration_directory), render_as_batch=False)
    app.extensions["migration_heads"] = set(ScriptDirectory(str(migration_directory)).get_heads())
    if app.config["CORS_ORIGINS"]:
        CORS(
            app,
            resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
            supports_credentials=True,
        )
    register_security(app)
    app.register_blueprint(health_blueprint)
    app.register_blueprint(auth)
    app.register_blueprint(admin)
    app.register_blueprint(features)
    app.register_blueprint(catalog)
    app.register_blueprint(channels)
    app.register_blueprint(booking)
    app.register_blueprint(finance)
    app.register_blueprint(housekeeping)
    app.register_blueprint(inventory)
    app.register_blueprint(notifications_blueprint)
    app.register_blueprint(pricing)
    app.register_blueprint(reports)
    app.register_blueprint(reconciliation)
    app.register_blueprint(billing)
    register_commands(app)

    WorkspaceURL.register(
        app,
        WorkspaceURL.WORKSPACE,
        "pms_api.workspace:WorkspaceView",
        endpoint="workspace",
        methods=["GET"],
    )

    URL.register(app, URL.INDEX, IndexView, endpoint="index", methods=["GET"])

    return app
