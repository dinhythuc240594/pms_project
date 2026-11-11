import re

from common import ApiError


def phone_value(value):
    if (
        not isinstance(value, str)
        or value
        and (
            not re.fullmatch(r"\+?[0-9 .()-]+", value)
            or not 7 <= len(re.sub(r"[^0-9]", "", value)) <= 15
        )
    ):
        raise ApiError(
            422,
            "invalid_phone",
            "Số điện thoại cần từ 7 đến 15 chữ số, chỉ cho phép dấu + ở đầu và dấu cách, chấm, gạch ngang, ngoặc đơn.",
        )
    return value


def tax_id_value(value):
    if not isinstance(value, str) or value and not re.fullmatch(r"[0-9]+(?:-[0-9]{3})?", value):
        raise ApiError(422, "invalid_tax_id", "Mã số thuế chỉ gồm chữ số và có thể có hậu tố -xxx.")
    return value
