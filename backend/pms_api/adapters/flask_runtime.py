"""Flask context adapter. Local proxies remain scoped to the active request/app."""

from flask import current_app, g, jsonify, request

from common import RequestData


class FlaskRuntime:
    @staticmethod
    def request_scope(path, *, method):
        return current_app.test_request_context(path, method=method)

    @staticmethod
    def app_scope():
        return current_app.app_context()

    @property
    def reservations(self):
        return current_app.extensions["pms_services"].reservations

    @property
    def pricing(self):
        return current_app.extensions["pms_services"].pricing

    @property
    def channels(self):
        return current_app.extensions["pms_services"].channels

    @property
    def revisions(self):
        return current_app.extensions["pms_services"].revisions

    @property
    def state(self):
        return g

    @property
    def request(self):
        return request

    @property
    def config(self):
        return current_app.config

    @property
    def extensions(self):
        return current_app.extensions

    @property
    def logger(self):
        return current_app.logger

    payload = staticmethod(RequestData.payload)
    date_range = staticmethod(RequestData.date_range)
    json_response = staticmethod(jsonify)
