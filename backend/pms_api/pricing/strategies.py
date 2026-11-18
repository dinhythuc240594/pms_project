"""Interchangeable discount calculations with the existing rounding rules."""

from collections import defaultdict
from decimal import Decimal
from typing import Protocol

from .domain import rounded


class PromotionStrategy(Protocol):
    def discount(self, policy: dict, nightly: list[dict]) -> Decimal: ...


class PercentagePromotion:
    def discount(self, policy, nightly):
        return rounded(
            sum((Decimal(n["price"]) for n in nightly), Decimal(0))
            * Decimal(policy["percent"])
            / 100
        )


class StayPayPromotion:
    def discount(self, policy, nightly):
        rooms = defaultdict(list)
        for night in nightly:
            rooms[night["room"]].append(Decimal(night["price"]))
        return sum(
            (
                sum(
                    sorted(prices)[
                        : len(prices) // policy["stayN"] * (policy["stayN"] - policy["payM"])
                    ],
                    Decimal(0),
                )
                for prices in rooms.values()
            ),
            Decimal(0),
        )


def promotion_strategy(kind) -> PromotionStrategy:
    return StayPayPromotion() if kind == "staypay" else PercentagePromotion()
