"""The API key and the provider transport stay on the authenticated backend."""

from flask import current_app, g, jsonify, request
from sqlalchemy import select

from common import ApiError

from ..extensions import db
from ..security import payload, require_tenant
from . import service
from .models import ChatbotRequest


@require_tenant("chatbot.view")
def config(tenant_id):
    return jsonify(
        available=service.available(),
        maxMessageChars=service.MAX_MESSAGE_CHARS,
        dailyLimit=current_app.config.get("OPENAI_CHAT_DAILY_LIMIT", 30),
    )


@require_tenant("chatbot.send")
def messages(tenant_id):
    data = service.validate(payload())
    user_id = g.user.id
    row, replay = service.reserve(
        tenant_id, user_id, request.headers.get("Idempotency-Key", ""), data
    )
    if replay:
        return jsonify(service.result(row))
    row_id, model = row.id, row.model
    # Persist quota/idempotency before transport, and release the tenant lock.
    db.session.commit()
    answer, failure = None, None
    try:
        answer = service.respond(data, model)
    except service.ProviderError as error:
        failure = error
    except Exception:
        failure = service.ProviderError("provider_outcome_unknown", unknown=True)

    # A reply must not be delivered after membership/role/subscription revocation.
    @require_tenant("chatbot.send")
    def finish(tenant_id):
        saved = db.session.scalar(
            select(ChatbotRequest)
            .where(
                ChatbotRequest.tenant_id == tenant_id,
                ChatbotRequest.user_id == user_id,
                ChatbotRequest.id == row_id,
            )
            .with_for_update()
        )
        if saved is None:
            raise ApiError(404, "chatbot_request_missing", "Không tìm thấy yêu cầu trò chuyện.")
        if saved.status != "running":
            raise ApiError(409, "chatbot_outcome_unknown", "Trạng thái yêu cầu đã thay đổi.")
        if failure:
            saved.status = "unknown" if failure.unknown else "failed"
            saved.error_code = failure.code
            db.session.commit()
            raise ApiError(
                503,
                "chatbot_outcome_unknown" if failure.unknown else "chatbot_provider_failed",
                "Chưa thể nhận phản hồi từ trợ lý. Yêu cầu không được tự động gửi lại.",
            )
        saved.status, saved.answer = "completed", answer
        db.session.flush()
        return jsonify(service.result(saved))

    g.pop("user", None)
    g.pop("auth_session", None)
    return finish(tenant_id)
