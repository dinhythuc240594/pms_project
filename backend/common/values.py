from decimal import Decimal


class ValueFormatter:
    @staticmethod
    def iso(value):
        return value.isoformat() if value else None

    @staticmethod
    def decimal_text(amount):
        return format(Decimal(amount), ".4f")
