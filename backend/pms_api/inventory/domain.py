"""Domain values and rules without Flask or database access."""

from decimal import ROUND_HALF_UP, Decimal, localcontext

from ..bookings.domain import money_value

EIGHT = Decimal("0.00000001")


def stock_quantity(value, *, allow_zero=False):
    return money_value(value, allow_zero=allow_zero)


def cost_value(quantity, unit_cost):
    with localcontext() as context:
        context.prec = 60
        return (quantity * unit_cost).quantize(EIGHT)


def allocate_cost(quantity, value, issued):
    if issued == quantity:
        return value
    with localcontext() as context:
        context.prec = 60
        return (value * issued / quantity).quantize(EIGHT, rounding=ROUND_HALF_UP)


def value_text(value):
    return format(value, ".8f")


def average(quantity, value):
    if not quantity:
        return Decimal(0)
    with localcontext() as context:
        context.prec = 60
        return (value / quantity).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
