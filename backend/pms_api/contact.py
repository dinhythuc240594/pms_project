"""Bounded public contact mail; visitors cannot choose recipients or sender headers."""

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from flask import current_app, jsonify, request

from common import ApiError, CommonMethodView

from .auth.routes import count_attempt, validate_email
from .extensions import db
from .security import check_origin
from .validation import phone_value

RECIPIENT = "info@lohapms.com"
SMTP_TIMEOUT = 10


def contact_values(data):
    if set(data) - {"name", "email", "phone", "hotel", "message"}:
        raise ApiError(422, "invalid_contact", "Thông tin liên hệ không hợp lệ.")
    result = {}
    for field, maximum, required in (
        ("name", 120, True),
        ("email", 254, True),
        ("phone", 40, False),
        ("hotel", 180, False),
        ("message", 4000, True),
    ):
        value = data.get(field, "")
        allowed_controls = "\r\n\t" if field == "message" else ""
        if (
            not isinstance(value, str)
            or len(value) > maximum
            or required
            and not value.strip()
            or any(
                (ord(char) < 32 and char not in allowed_controls) or ord(char) == 127
                for char in value
            )
        ):
            raise ApiError(422, "invalid_contact", "Thông tin liên hệ không hợp lệ.")
        result[field] = value.strip()
    result["email"] = validate_email(result["email"])
    result["phone"] = phone_value(result["phone"])
    return result


def smtp_settings():
    values = {
        key: current_app.config.get(f"CONTACT_SMTP_{key}")
        for key in ("HOST", "USERNAME", "PASSWORD", "FROM")
    }
    security = current_app.config.get("CONTACT_SMTP_SECURITY", "starttls")
    try:
        if any(not isinstance(value, str) or not value.strip() for value in values.values()):
            raise ValueError
        host = values["HOST"].strip()
        if (
            len(host) > 253
            or any(ord(char) <= 32 or ord(char) > 126 for char in host)
            or "/" in host
        ):
            raise ValueError
        if security not in {"starttls", "ssl"}:
            raise ValueError
        raw_port = current_app.config.get("CONTACT_SMTP_PORT")
        raw_port = (465 if security == "ssl" else 587) if raw_port in (None, "") else raw_port
        port = int(raw_port)
        if str(port) != str(raw_port) or not 1 <= port <= 65535:
            raise ValueError
        sender = validate_email(values["FROM"])
    except (ValueError, TypeError, ApiError):
        raise ApiError(
            503,
            "contact_unavailable",
            "Biểu mẫu liên hệ chưa sẵn sàng. Vui lòng gửi email tới info@lohapms.com.",
        ) from None
    return {**values, "HOST": host, "PORT": port, "SECURITY": security, "FROM": sender}


def send_contact_mail(values, settings):
    message = EmailMessage()
    message["From"] = settings["FROM"]
    message["To"] = RECIPIENT
    message["Reply-To"] = values["email"]
    message["Subject"] = "LOHA PMS website contact"
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid(domain=settings["FROM"].split("@", 1)[1])
    message.set_content(
        "\n".join(
            [
                "Yêu cầu liên hệ từ website LOHA PMS",
                "",
                f"Họ và tên: {values['name']}",
                f"Email: {values['email']}",
                f"Số điện thoại: {values['phone'] or '(không cung cấp)'}",
                f"Khách sạn / cơ sở lưu trú: {values['hotel'] or '(không cung cấp)'}",
                "",
                "Nội dung:",
                values["message"],
            ]
        )
    )
    client = None
    try:
        context = ssl.create_default_context()
        if settings["SECURITY"] == "ssl":
            client = smtplib.SMTP_SSL(
                settings["HOST"], settings["PORT"], timeout=SMTP_TIMEOUT, context=context
            )
        else:
            client = smtplib.SMTP(settings["HOST"], settings["PORT"], timeout=SMTP_TIMEOUT)
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
        client.login(settings["USERNAME"], settings["PASSWORD"])
        refused = client.send_message(message, from_addr=settings["FROM"], to_addrs=[RECIPIENT])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    except (smtplib.SMTPException, OSError, ValueError, UnicodeError) as error:
        # Provider errors can contain addresses, message bodies or credentials.
        current_app.logger.warning("contact_mail_failure error_type=%s", type(error).__name__)
        raise ApiError(
            502,
            "contact_send_failed",
            "Chưa xác nhận được việc gửi lời nhắn. Vui lòng liên hệ info@lohapms.com.",
        ) from None
    finally:
        if client is not None:
            try:
                client.quit()
            except (smtplib.SMTPException, OSError):
                try:
                    client.close()
                except OSError:
                    pass


class ContactView(CommonMethodView):
    @staticmethod
    def dispatch_request():
        check_origin()
        request.max_content_length = 65536
        values = contact_values(CommonMethodView.payload())
        settings = smtp_settings()
        limited = count_attempt("contact:ip:" + (request.remote_addr or "unknown")) > 5
        if not limited:
            limited = count_attempt("contact:global") > 100
        # Persist attempts across workers before the nontransactional SMTP send.
        # No pending tenant writes exist on this anonymous marketing route.
        db.session.commit()
        if limited:
            raise ApiError(
                429, "contact_rate_limited", "Bạn gửi lời nhắn quá nhiều lần. Vui lòng chờ 15 phút."
            )
        send_contact_mail(values, settings)
        return jsonify(sent=True)
