"""Pricing persistence. Locking and ordering are part of the repository contract."""

from sqlalchemy import select

from ..core_models import Tenant
from .models import ExchangeRate, PricingRule, Promotion, Voucher, VoucherRedemption


class SQLAlchemyPricingRepository:
    def __init__(self, session):
        self.session = session

    def tenant(self, tenant_id):
        return self.session.get(Tenant, tenant_id)

    def exchange_rate(self, tenant_id, currency, base):
        return self.session.scalar(
            select(ExchangeRate).where(
                ExchangeRate.tenant_id == tenant_id,
                ExchangeRate.currency == currency,
                ExchangeRate.base_currency == base,
            )
        )

    def rules(self, tenant_id):
        return list(
            self.session.scalars(
                select(PricingRule)
                .where(PricingRule.tenant_id == tenant_id, PricingRule.active.is_(True))
                .order_by(PricingRule.priority.desc(), PricingRule.id)
            )
        )

    def voucher_by_code(self, tenant_id, code, *, locked=False):
        statement = select(Voucher).where(Voucher.tenant_id == tenant_id, Voucher.code == code)
        if locked:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return self.session.scalar(statement)

    def promotions(self, tenant_id):
        return self.session.scalars(
            select(Promotion)
            .where(Promotion.tenant_id == tenant_id, Promotion.active.is_(True))
            .order_by(Promotion.id)
        )

    def voucher_by_id(self, tenant_id, voucher_id):
        return self.session.scalar(
            select(Voucher)
            .where(Voucher.tenant_id == tenant_id, Voucher.id == voucher_id)
            .with_for_update()
        )

    def add_redemption(self, tenant_id, voucher_id, reservation_id, discount):
        self.session.add(
            VoucherRedemption(
                tenant_id=tenant_id,
                voucher_id=voucher_id,
                reservation_id=reservation_id,
                discount=discount,
            )
        )
