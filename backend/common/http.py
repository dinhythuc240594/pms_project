"""Class-based HTTP views and URL registration without application dependencies."""

from importlib import import_module
from threading import Lock
from weakref import WeakKeyDictionary

from flask import current_app, jsonify, request
from flask.views import MethodView

from .errors import ApiError

_registered_views = WeakKeyDictionary()


class RequestData:
    @staticmethod
    def date_range(*, aliases=("start", "end")):
        """Read canonical date bounds without changing their format or semantics."""
        bounds = []
        for canonical, alias in zip(("start_date", "end_date"), aliases, strict=True):
            values = []
            for key in dict.fromkeys((canonical, alias)):
                if key in request.args:
                    supplied = request.args.getlist(key)
                    if len(supplied) != 1:
                        raise ApiError(422, "invalid_dates", "Tham số khoảng ngày bị lặp.")
                    values.extend(supplied)
            if len(set(values)) > 1:
                raise ApiError(422, "invalid_dates", "Tham số khoảng ngày không nhất quán.")
            bounds.append(values[0] if values else None)
        return tuple(bounds)

    @staticmethod
    def payload():
        try:
            value = request.get_json(silent=True)
        except RecursionError:
            value = None
        if not isinstance(value, dict):
            raise ApiError(422, "invalid_json", "Nội dung phải là một JSON object.")
        # JSON escapes can decode to lone surrogates or NULs, which cannot be
        # stored as PostgreSQL text. Check nested values and keys too.
        pending = [value]
        try:
            while pending:
                item = pending.pop()
                if isinstance(item, dict):
                    pending.extend(item)
                    pending.extend(item.values())
                elif isinstance(item, list):
                    pending.extend(item)
                elif isinstance(item, str):
                    if "\x00" in item:
                        raise ApiError(422, "invalid_json", "Nội dung JSON chứa ký tự NUL.")
                    item.encode("utf-8")
        except UnicodeEncodeError:
            raise ApiError(422, "invalid_json", "Nội dung JSON chứa Unicode không hợp lệ.") from None
        return value


class CommonMethodView(MethodView):
    """Shared registration and JSON helpers for HTTP handlers.

    Static dispatch_request handlers retain their existing security signatures;
    standard instance get/post handlers also work through MethodView.
    """

    payload = staticmethod(RequestData.payload)

    @staticmethod
    def json_response(data, status=200):
        return jsonify(data), status

    @classmethod
    def register(cls, target, rule, *, endpoint=None, methods=None, **options):
        """Register on a Flask app or blueprint, reusing a view per endpoint.

        A separate cache per target lets app factories create independent apps
        and permits multiple method rules to share the same endpoint.
        """
        endpoint = endpoint or cls.__name__
        views = _registered_views.setdefault(target, {})
        view = views.get(endpoint)
        if view is None:
            view = cls.as_view(endpoint)
        elif getattr(view, "view_class", None) is not cls:
            raise ValueError(f"Endpoint {endpoint!r} is already registered for another view.")
        if methods is not None:
            options["methods"] = methods
        target.add_url_rule(rule, endpoint=endpoint, view_func=view, **options)
        views[endpoint] = view
        return view


class CommonURL:
    """Base for module URL constants and their common registration operation."""

    @classmethod
    def register(cls, target, rule, view_class, *, endpoint=None, methods=None, **options):
        if isinstance(view_class, str):
            return cls.register_lazy(
                target, rule, view_class, endpoint=endpoint, methods=methods, **options
            )
        return view_class.register(target, rule, endpoint=endpoint, methods=methods, **options)

    @classmethod
    def register_lazy(cls, target, rule, view_path, *, endpoint=None, methods=None, **options):
        """Register routing metadata now and import module:View on first dispatch.

        Imports occur under a per-view lock and are cached only after success.
        Flask handles routing, 404/405 and automatic OPTIONS without loading a view.
        """
        module_name, separator, class_name = view_path.partition(":")
        if not separator or not module_name or not class_name or ":" in class_name:
            raise ValueError("Lazy view paths must use 'module:ViewClass'.")
        if not methods:
            raise ValueError("Lazy URL registration requires explicit HTTP methods.")
        endpoint = endpoint or class_name
        views = _registered_views.setdefault(target, {})
        lazy_view = views.get(endpoint)
        if lazy_view is not None:
            if getattr(lazy_view, "lazy_view_path", None) != view_path:
                raise ValueError(f"Endpoint {endpoint!r} is already registered for another view.")
        else:
            resolved_view = None
            lock = Lock()

            def lazy_view(**kwargs):
                nonlocal resolved_view
                if resolved_view is None:
                    with lock:
                        if resolved_view is None:
                            view_class = getattr(import_module(module_name), class_name)
                            if not isinstance(view_class, type) or not issubclass(
                                view_class, CommonMethodView
                            ):
                                raise TypeError(f"{view_path!r} must reference a CommonMethodView.")
                            resolved_view = view_class.as_view(endpoint)
                return current_app.ensure_sync(resolved_view)(**kwargs)

            lazy_view.__name__ = endpoint
            lazy_view.lazy_view_path = view_path
        target.add_url_rule(
            rule, endpoint=endpoint, view_func=lazy_view, methods=methods, **options
        )
        views[endpoint] = lazy_view
        return lazy_view
