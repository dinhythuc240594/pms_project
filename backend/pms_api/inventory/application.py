"""Inventory writes post one immutable document, movements and balance changes atomically."""

from collections import defaultdict
from decimal import Decimal, localcontext

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from pms_api.auth.application import validate_email
from pms_api.bookings.application import MONEY_LIMIT, decimal_text, string_value
from pms_api.catalog.application import bool_value, master_json, parse_date
from pms_api.finance.application import (
    begin,
    finish,
    invoice_row,
    local_date,
    pagination,
    tenant_currency,
)
from pms_api.ports import runtime

from ..catalog.models import Master
from ..core_models import uid
from ..extensions import db
from ..security import ApiError, audit
from ..subscriptions import feature_enabled
from ..validation import phone_value, tax_id_value
from .domain import allocate_cost as allocate_cost
from .domain import average as average
from .domain import cost_value as cost_value
from .domain import stock_quantity as stock_quantity
from .domain import value_text as value_text
from .models import (
    InventoryControl,
    InventoryDocument,
    ServiceStockIngredient,
    ServiceStockLink,
    StockBalance,
    StockMovement,
)

CATALOGS = {
    "warehouses": {"location", "isDefault"},
    "itemCategories": {"parentId", "sortOrder"},
    "items": {"sku", "categoryId", "unitId", "unit", "costPrice", "sellingPrice", "minStock"},
    "suppliers": {
        "contactPerson",
        "phone",
        "email",
        "address",
        "taxCode",
        "bankName",
        "bankAccount",
        "notes",
    },
}
EIGHT = Decimal("0.00000001")


def scoped_master(tenant_id, catalog, master_id, *, inactive=False):
    master_id = string_value(master_id, "Mã danh mục", 40, required=True)
    statement = select(Master).where(
        Master.tenant_id == tenant_id, Master.catalog == catalog, Master.id == master_id
    )
    if not inactive:
        statement = statement.where(Master.active.is_(True))
    row = db.session.scalar(
        statement.with_for_update(read=True).execution_options(populate_existing=True)
    )
    if not row:
        raise ApiError(
            422, "invalid_master", "Danh mục không tồn tại trong khách sạn hoặc đã ngừng dùng."
        )
    return row


def control(tenant_id):
    db.session.execute(
        insert(InventoryControl)
        .values(id=uid(), tenant_id=tenant_id, opening_locked=False)
        .on_conflict_do_nothing(index_elements=["tenant_id"])
    )
    # ponytail: tenant writes already serialize in security; pair locks below keep stock ordering explicit.
    return db.session.scalar(
        select(InventoryControl)
        .where(InventoryControl.tenant_id == tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def advance(control_row, day, *, opening=False):
    if day > local_date() or control_row.last_date and day < control_row.last_date:
        raise ApiError(
            409, "stock_date", "Ngày ghi kho phải từ ngày giao dịch gần nhất và không ở tương lai."
        )
    if opening and control_row.opening_locked:
        raise ApiError(
            409,
            "opening_locked",
            "Tồn kho đầu kỳ đã khóa sau lần khởi tạo hoặc giao dịch đầu tiên.",
        )
    control_row.opening_locked, control_row.last_date = True, day


def lock_balances(tenant_id, pairs):
    result = {}
    for warehouse_id, item_id in sorted(set(pairs)):
        db.session.execute(
            insert(StockBalance)
            .values(
                id=uid(),
                tenant_id=tenant_id,
                warehouse_id=warehouse_id,
                item_id=item_id,
                quantity=0,
                cost_value=0,
                version=0,
            )
            .on_conflict_do_nothing(index_elements=["tenant_id", "warehouse_id", "item_id"])
        )
        row = db.session.scalar(
            select(StockBalance)
            .where(
                StockBalance.tenant_id == tenant_id,
                StockBalance.warehouse_id == warehouse_id,
                StockBalance.item_id == item_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        result[(warehouse_id, item_id)] = row
    return result


def add_movement(document, balance, warehouse, item, quantity, value, *, origin=None):
    with localcontext() as context:
        context.prec = 60
        new_quantity, new_value = balance.quantity + quantity, balance.cost_value + value
    if (
        new_quantity < 0
        or new_quantity > MONEY_LIMIT
        or new_value < 0
        or new_value >= Decimal("1e30")
    ):
        raise ApiError(
            409,
            "insufficient_stock",
            "Tồn kho hoặc giá trị còn lại không đủ; giao dịch chưa được ghi.",
        )
    if new_quantity == 0 and new_value != 0:
        raise ApiError(
            409,
            "stock_value_conflict",
            "Giá trị tồn chưa khớp với số lượng; cần đối soát trước khi ghi.",
        )
    balance.quantity, balance.cost_value, balance.version = (
        new_quantity,
        new_value,
        balance.version + 1,
    )
    if quantity:
        movement = StockMovement(
            tenant_id=document.tenant_id,
            document_id=document.id,
            warehouse_id=warehouse.id,
            warehouse_name=warehouse.name,
            item_id=item.id,
            item_name=item.name,
            sku=(item.data or {}).get("sku", ""),
            unit=(item.data or {}).get("unit", ""),
            quantity=quantity,
            unit_cost=average(quantity.copy_abs(), value.copy_abs()),
            cost_value=value,
            origin_movement_id=origin.id if origin else None,
        )
        db.session.add(movement)
        return movement
    return None


def make_document(
    tenant_id,
    kind,
    day,
    warehouse,
    *,
    to_warehouse=None,
    supplier=None,
    note="",
    lines=None,
    reversal=None,
    invoice=None,
    currency=None,
):
    row = InventoryDocument(
        tenant_id=tenant_id,
        kind=kind,
        date=day,
        warehouse_id=warehouse.id,
        warehouse_name=warehouse.name,
        to_warehouse_id=to_warehouse.id if to_warehouse else None,
        to_warehouse_name=to_warehouse.name if to_warehouse else None,
        supplier_id=supplier.id if supplier else None,
        supplier_name=supplier.name if supplier else None,
        currency=currency or tenant_currency(tenant_id),
        note=note,
        input_lines=lines or [],
        reversal_of_id=reversal.id if reversal else None,
        pos_invoice_id=invoice.id if invoice else None,
        user_id=runtime().state.user.id,
    )
    db.session.add(row)
    db.session.flush()
    return row


def link_json(row):
    return {
        "id": row.id,
        "serviceId": row.service_id,
        "warehouseId": row.warehouse_id,
        "active": row.active,
        "lines": [
            {"itemId": line.item_id, "quantity": decimal_text(line.quantity)}
            for line in db.session.scalars(
                select(ServiceStockIngredient)
                .where(
                    ServiceStockIngredient.tenant_id == row.tenant_id,
                    ServiceStockIngredient.link_id == row.id,
                )
                .order_by(ServiceStockIngredient.item_id)
            )
        ],
    }


def masters_snapshot(tenant_id):
    result = {key: [] for key in CATALOGS}
    for row in db.session.scalars(
        select(Master)
        .where(Master.tenant_id == tenant_id, Master.catalog.in_(CATALOGS))
        .order_by(Master.name)
    ):
        result[row.catalog].append(master_json(row))
    settings = db.session.scalar(
        select(InventoryControl).where(InventoryControl.tenant_id == tenant_id)
    )
    return {
        **result,
        "openingLocked": bool(settings and settings.opening_locked),
        "serviceStockLinks": [
            link_json(row)
            for row in db.session.scalars(
                select(ServiceStockLink)
                .where(ServiceStockLink.tenant_id == tenant_id)
                .order_by(ServiceStockLink.service_id)
            )
        ],
    }


def handle_get_masters(tenant_id):
    return masters_snapshot(tenant_id)


def handle_save_master(tenant_id, catalog_name):
    if catalog_name not in CATALOGS:
        raise ApiError(404, "not_found", "Danh mục kho không được hỗ trợ.")
    data = runtime().payload()
    if set(data) - (CATALOGS[catalog_name] | {"id", "name", "active"}):
        raise ApiError(422, "invalid_input", "Danh mục chứa trường không được hỗ trợ.")
    control(tenant_id)
    row = (
        scoped_master(tenant_id, catalog_name, data.get("id"), inactive=True)
        if runtime().request.method == "PATCH"
        else Master(tenant_id=tenant_id, catalog=catalog_name, data={})
    )
    if runtime().request.method == "POST" and data.get("id"):
        raise ApiError(422, "invalid_input", "Mã danh mục do máy chủ tạo.")
    row.name = string_value(data.get("name", row.name), "Tên", 160, required=True)
    row.active = bool_value(data.get("active", row.active if row.active is not None else True))
    result = {
        **(row.data or {}),
        **{key: val for key, val in data.items() if key in CATALOGS[catalog_name]},
    }
    for key in CATALOGS[catalog_name] - {
        "isDefault",
        "sortOrder",
        "costPrice",
        "sellingPrice",
        "minStock",
    }:
        if key in result:
            result[key] = string_value(
                result[key],
                key,
                500 if key in {"address", "notes"} else 80 if key == "sku" else 160,
            )
    if catalog_name == "suppliers":
        if "phone" in result:
            result["phone"] = phone_value(result["phone"])
        if result.get("email"):
            result["email"] = validate_email(result["email"])
        if "taxCode" in result:
            result["taxCode"] = tax_id_value(result["taxCode"])
    elif catalog_name == "warehouses":
        result["isDefault"] = bool_value(result.get("isDefault", False))
        if result["isDefault"] and row.active:
            defaults = db.session.scalars(
                select(Master).where(
                    Master.tenant_id == tenant_id,
                    Master.catalog == "warehouses",
                    Master.id != row.id,
                    Master.data["isDefault"].astext == "true",
                )
            ).all()
            for other in defaults:
                other.data = {**other.data, "isDefault": False}
            db.session.flush()
    elif catalog_name == "itemCategories":
        order = result.get("sortOrder", 0)
        if isinstance(order, bool) or not isinstance(order, int) or not 0 <= order <= 100000:
            raise ApiError(422, "invalid_input", "Thứ tự phải là số nguyên không âm.")
        result["sortOrder"] = order
        ancestor, seen = result.get("parentId"), {row.id} if row.id else set()
        while ancestor:
            if ancestor in seen:
                raise ApiError(409, "category_cycle", "Danh mục cha tạo vòng lặp.")
            seen.add(ancestor)
            ancestor = (scoped_master(tenant_id, "itemCategories", ancestor).data or {}).get(
                "parentId"
            )
    elif catalog_name == "items":
        result["sku"] = string_value(result.get("sku"), "SKU", 80, required=True).upper()
        if result.get("categoryId"):
            scoped_master(tenant_id, "itemCategories", result["categoryId"])
        if result.get("unitId"):
            result["unit"] = scoped_master(tenant_id, "units", result["unitId"]).name
        result["unit"] = string_value(result.get("unit", "cái"), "Đơn vị", 80, required=True)
        for key in ("costPrice", "minStock"):
            result[key] = decimal_text(stock_quantity(result.get(key, 0), allow_zero=True))
        if result.get("sellingPrice") is not None:
            result["sellingPrice"] = decimal_text(
                stock_quantity(result["sellingPrice"], allow_zero=True)
            )
        if (
            row.id
            and (row.data or {}).get("unit") != result["unit"]
            and db.session.scalar(
                select(StockMovement.id)
                .where(StockMovement.tenant_id == tenant_id, StockMovement.item_id == row.id)
                .limit(1)
            )
        ):
            raise ApiError(
                409, "unit_has_history", "Không đổi đơn vị khi mặt hàng đã có giao dịch."
            )
    row.data = result
    db.session.add(row)
    db.session.flush()
    audit("inventory.master", "master", row.id, {"catalog": catalog_name, "active": row.active})
    return master_json(row), 200 if runtime().request.method == "PATCH" else 201


def handle_save_link(tenant_id):
    data = runtime().payload()
    control(tenant_id)
    service = scoped_master(tenant_id, "services", data.get("serviceId"))
    warehouse = scoped_master(tenant_id, "warehouses", data.get("warehouseId"))
    active = bool_value(data.get("active", True))
    lines = data.get("lines")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 100:
        raise ApiError(422, "invalid_lines", "Định mức cần từ 1 đến 100 mặt hàng.")
    parsed, seen = [], set()
    for line in lines:
        if not isinstance(line, dict):
            raise ApiError(422, "invalid_lines", "Định mức không hợp lệ.")
        item = scoped_master(tenant_id, "items", line.get("itemId"))
        if item.id in seen:
            raise ApiError(422, "duplicate_item", "Không lặp mặt hàng trong định mức.")
        seen.add(item.id)
        parsed.append((item.id, stock_quantity(line.get("quantity"))))
    row = db.session.scalar(
        select(ServiceStockLink)
        .where(ServiceStockLink.tenant_id == tenant_id, ServiceStockLink.service_id == service.id)
        .with_for_update()
    )
    if not row:
        row = ServiceStockLink(
            tenant_id=tenant_id, service_id=service.id, warehouse_id=warehouse.id
        )
        db.session.add(row)
        db.session.flush()
    row.warehouse_id, row.active = warehouse.id, active
    db.session.execute(
        delete(ServiceStockIngredient).where(
            ServiceStockIngredient.tenant_id == tenant_id,
            ServiceStockIngredient.link_id == row.id,
        )
    )
    for item_id, quantity in parsed:
        db.session.add(
            ServiceStockIngredient(
                tenant_id=tenant_id, link_id=row.id, item_id=item_id, quantity=quantity
            )
        )
    db.session.flush()
    audit(
        "inventory.recipe",
        "service_stock_link",
        row.id,
        {"serviceId": service.id, "warehouseId": warehouse.id, "active": active},
    )
    return link_json(row)


def movement_json(row):
    return {
        "id": row.id,
        "warehouseId": row.warehouse_id,
        "warehouse": row.warehouse_name,
        "itemId": row.item_id,
        "item": row.item_name,
        "sku": row.sku,
        "unit": row.unit,
        "quantity": decimal_text(row.quantity),
        "unitCost": decimal_text(row.unit_cost),
        "costValue": value_text(row.cost_value),
        "reversalOfId": row.origin_movement_id,
    }


def document_json(row):
    reversed_by = db.session.scalar(
        select(InventoryDocument.id).where(
            InventoryDocument.tenant_id == row.tenant_id, InventoryDocument.reversal_of_id == row.id
        )
    )
    return {
        "id": row.id,
        "kind": row.kind,
        "date": row.date.isoformat(),
        "warehouseId": row.warehouse_id,
        "warehouse": row.warehouse_name,
        "toWarehouseId": row.to_warehouse_id,
        "toWarehouse": row.to_warehouse_name,
        "supplierId": row.supplier_id,
        "supplier": row.supplier_name,
        "currency": row.currency,
        "note": row.note,
        "actorId": row.user_id,
        "createdAt": row.created_at.isoformat(),
        "reversalOfId": row.reversal_of_id,
        "posInvoiceId": row.pos_invoice_id,
        "reversedById": reversed_by,
        "canReverse": not reversed_by
        and not row.pos_invoice_id
        and row.kind not in {"opening", "reversal"},
        "inputLines": row.input_lines,
        "lines": [
            movement_json(line)
            for line in db.session.scalars(
                select(StockMovement)
                .where(
                    StockMovement.tenant_id == row.tenant_id, StockMovement.document_id == row.id
                )
                .order_by(StockMovement.warehouse_id, StockMovement.item_id, StockMovement.id)
            )
        ],
    }


def parsed_lines(tenant_id, kind, data, warehouse):
    if not isinstance(data, list) or not 1 <= len(data) <= 200:
        raise ApiError(422, "invalid_lines", "Phiếu kho cần từ 1 đến 200 dòng hàng.")
    lines, seen = [], set()
    for line in data:
        if not isinstance(line, dict) or set(line) - {
            "itemId",
            "quantity",
            "unitCost",
            "expectedVersion",
            "warehouseId",
        }:
            raise ApiError(422, "invalid_lines", "Dòng hàng chứa trường không được hỗ trợ.")
        item = scoped_master(tenant_id, "items", line.get("itemId"))
        line_warehouse = (
            scoped_master(tenant_id, "warehouses", line["warehouseId"])
            if kind == "opening" and line.get("warehouseId")
            else warehouse
        )
        if "warehouseId" in line and kind != "opening":
            raise ApiError(
                422, "invalid_lines", "Chỉ phiếu đầu kỳ hỗ trợ nhiều kho trong từng dòng."
            )
        pair = (line_warehouse.id, item.id)
        if pair in seen:
            raise ApiError(422, "duplicate_item", "Không lặp cùng mặt hàng và kho trong một phiếu.")
        seen.add(pair)
        quantity = stock_quantity(line.get("quantity"), allow_zero=kind in {"opening", "count"})
        unit_cost = (
            stock_quantity(
                line.get("unitCost", (item.data or {}).get("costPrice", 0)), allow_zero=True
            )
            if kind in {"opening", "receipt", "count"}
            else None
        )
        if kind in {"issue", "transfer"} and "unitCost" in line:
            raise ApiError(422, "invalid_cost", "Giá vốn xuất/chuyển kho do máy chủ xác định.")
        version = line.get("expectedVersion")
        if kind == "count" and (
            isinstance(version, bool)
            or not isinstance(version, int)
            or not 0 <= version <= 2147483647
        ):
            raise ApiError(
                422, "version_required", "Kiểm kê cần phiên bản tồn kho được tải trước khi đếm."
            )
        lines.append(
            {
                "warehouse": line_warehouse,
                "item": item,
                "quantity": quantity,
                "unitCost": unit_cost,
                "expectedVersion": version,
            }
        )
    return lines


def handle_create_document(tenant_id):
    data = runtime().payload()
    key, fingerprint, replay = begin(tenant_id, data)
    if replay is not None:
        return replay, 201
    kind = data.get("kind")
    if not isinstance(kind, str) or kind not in {
        "opening",
        "receipt",
        "issue",
        "transfer",
        "count",
    }:
        raise ApiError(422, "invalid_kind", "Loại phiếu kho không hợp lệ.")
    day = parse_date(data.get("date", local_date().isoformat()))
    settings = control(tenant_id)
    advance(settings, day, opening=kind == "opening")
    warehouse = scoped_master(tenant_id, "warehouses", data.get("warehouseId"))
    to_warehouse = (
        scoped_master(tenant_id, "warehouses", data.get("toWarehouseId"))
        if kind == "transfer"
        else None
    )
    if to_warehouse and to_warehouse.id == warehouse.id:
        raise ApiError(422, "same_warehouse", "Kho chuyển và kho nhận phải khác nhau.")
    if kind != "transfer" and data.get("toWarehouseId"):
        raise ApiError(422, "invalid_warehouse", "Chỉ phiếu chuyển kho được có kho nhận.")
    supplier = (
        scoped_master(tenant_id, "suppliers", data["supplierId"])
        if kind == "receipt" and data.get("supplierId")
        else None
    )
    if kind != "receipt" and data.get("supplierId"):
        raise ApiError(422, "invalid_supplier", "Chỉ phiếu nhập kho được gắn nhà cung cấp.")
    lines = parsed_lines(tenant_id, kind, data.get("lines"), warehouse)
    pairs = [(line["warehouse"].id, line["item"].id) for line in lines]
    if to_warehouse:
        pairs.extend((to_warehouse.id, line["item"].id) for line in lines)
    balances = lock_balances(tenant_id, pairs)
    snapshots = [
        {
            "warehouseId": line["warehouse"].id,
            "itemId": line["item"].id,
            "item": line["item"].name,
            "quantity": decimal_text(line["quantity"]),
            "unitCost": decimal_text(line["unitCost"]) if line["unitCost"] is not None else None,
            "expectedVersion": line["expectedVersion"],
        }
        for line in lines
    ]
    row = make_document(
        tenant_id,
        kind,
        day,
        warehouse,
        to_warehouse=to_warehouse,
        supplier=supplier,
        note=string_value(data.get("note", ""), "Ghi chú", 500),
        lines=snapshots,
    )
    for line in lines:
        source, item, quantity = line["warehouse"], line["item"], line["quantity"]
        balance = balances[(source.id, item.id)]
        if kind == "count":
            if line["expectedVersion"] != balance.version:
                raise ApiError(
                    409,
                    "stale_stock",
                    "Tồn kho đã thay đổi sau khi tải; hãy tải lại trước khi kiểm kê.",
                )
            quantity -= balance.quantity
        if kind in {"issue", "transfer"}:
            quantity = -quantity
        if quantity < 0:
            if -quantity > balance.quantity:
                raise ApiError(409, "insufficient_stock", "Số lượng xuất vượt tồn kho hiện tại.")
            value = allocate_cost(balance.quantity, balance.cost_value, -quantity).copy_negate()
        elif kind == "count" and balance.quantity:
            value = allocate_cost(balance.quantity, balance.cost_value, quantity)
        else:
            value = cost_value(quantity, line["unitCost"] or Decimal(0))
        add_movement(row, balance, source, item, quantity, value)
        if to_warehouse:
            add_movement(
                row,
                balances[(to_warehouse.id, item.id)],
                to_warehouse,
                item,
                -quantity,
                value.copy_negate(),
            )
    db.session.flush()
    audit(
        "inventory.post",
        "inventory_document",
        row.id,
        {"kind": kind, "warehouseId": warehouse.id, "date": day.isoformat()},
    )
    return finish(tenant_id, key, fingerprint, document_json(row))


def handle_list_documents(tenant_id):
    page, size = pagination()
    conditions = [InventoryDocument.tenant_id == tenant_id]
    if runtime().request.args.get("kind"):
        kind = runtime().request.args["kind"]
        if kind not in {
            "opening",
            "receipt",
            "issue",
            "transfer",
            "count",
            "reversal",
            "pos_issue",
            "pos_return",
        }:
            raise ApiError(422, "invalid_kind", "Loại phiếu không hợp lệ.")
        conditions.append(InventoryDocument.kind == kind)
    if runtime().request.args.get("warehouseId"):
        warehouse = string_value(runtime().request.args["warehouseId"], "Kho", 40, required=True)
        ids = select(StockMovement.document_id).where(
            StockMovement.tenant_id == tenant_id, StockMovement.warehouse_id == warehouse
        )
        conditions.append(
            (InventoryDocument.warehouse_id == warehouse) | (InventoryDocument.id.in_(ids))
        )
    start_value, end_value = runtime().date_range()
    for value, op in [
        (start_value, lambda day: InventoryDocument.date >= day),
        (end_value, lambda day: InventoryDocument.date <= day),
    ]:
        if value:
            conditions.append(op(parse_date(value)))
    count = db.session.scalar(
        select(func.count()).select_from(InventoryDocument).where(*conditions)
    )
    rows = db.session.scalars(
        select(InventoryDocument)
        .where(*conditions)
        .order_by(InventoryDocument.created_at.desc(), InventoryDocument.id)
        .offset((page - 1) * size)
        .limit(size)
    )
    return {
        "documents": [document_json(row) for row in rows],
        "pagination": {"page": page, "pageSize": size, "totalItems": count},
    }


def handle_get_document(tenant_id, document_id):
    row = db.session.scalar(
        select(InventoryDocument).where(
            InventoryDocument.tenant_id == tenant_id, InventoryDocument.id == document_id
        )
    )
    if not row:
        raise ApiError(404, "not_found", "Không tìm thấy phiếu kho.")
    return document_json(row)


def handle_reverse_document(tenant_id, document_id):
    data = runtime().payload()
    key, fingerprint, replay = begin(tenant_id, data)
    if replay is not None:
        return replay, 201
    settings = control(tenant_id)
    original = db.session.scalar(
        select(InventoryDocument)
        .where(InventoryDocument.tenant_id == tenant_id, InventoryDocument.id == document_id)
        .with_for_update()
    )
    if not original:
        raise ApiError(404, "not_found", "Không tìm thấy phiếu kho.")
    if original.kind in {"opening", "reversal"} or original.pos_invoice_id:
        raise ApiError(
            409,
            "not_reversible",
            "Phiếu đầu kỳ, phiếu đảo và xuất POS cần luồng điều chỉnh riêng.",
        )
    if db.session.scalar(
        select(InventoryDocument.id).where(
            InventoryDocument.tenant_id == tenant_id,
            InventoryDocument.reversal_of_id == original.id,
        )
    ):
        raise ApiError(409, "already_reversed", "Phiếu đã được đảo.")
    reason = string_value(data.get("reason"), "Lý do", 500, required=True)
    advance(settings, local_date())
    warehouse = scoped_master(tenant_id, "warehouses", original.warehouse_id, inactive=True)
    movements = list(
        db.session.scalars(
            select(StockMovement).where(
                StockMovement.tenant_id == tenant_id, StockMovement.document_id == original.id
            )
        )
    )
    balances = lock_balances(tenant_id, [(line.warehouse_id, line.item_id) for line in movements])
    row = make_document(
        tenant_id,
        "reversal",
        local_date(),
        warehouse,
        note=reason,
        reversal=original,
        currency=original.currency,
    )
    for line in sorted(movements, key=lambda line: (line.warehouse_id, line.item_id)):
        source = scoped_master(tenant_id, "warehouses", line.warehouse_id, inactive=True)
        item = scoped_master(tenant_id, "items", line.item_id, inactive=True)
        add_movement(
            row,
            balances[(source.id, item.id)],
            source,
            item,
            -line.quantity,
            line.cost_value.copy_negate(),
            origin=line,
        )
    db.session.flush()
    audit(
        "inventory.reverse",
        "inventory_document",
        row.id,
        {"reversalOfId": original.id, "reason": reason},
    )
    return finish(tenant_id, key, fingerprint, document_json(row))


def quantity_product(first, second):
    with localcontext() as context:
        context.prec = 60
        result = first * second
        rounded = result.quantize(Decimal("0.0001"))
    if result != rounded or result > MONEY_LIMIT:
        raise ApiError(422, "invalid_quantity", "Lượng xuất theo định mức phải có tối đa 4 số lẻ.")
    return rounded


def consume_pos(invoice):
    """A linked service consumes stock at posting; an unlinked service leaves it unchanged."""
    tenant_id = invoice.tenant_id
    service_ids = {line["serviceId"] for line in invoice.draft_items}
    links = list(
        db.session.scalars(
            select(ServiceStockLink)
            .where(
                ServiceStockLink.tenant_id == tenant_id,
                ServiceStockLink.service_id.in_(service_ids),
                ServiceStockLink.active.is_(True),
            )
            .order_by(ServiceStockLink.service_id)
            .with_for_update(read=True)
        )
    )
    if not links:
        return None
    if not feature_enabled("INVENTORY_WAREHOUSE", for_write=True):
        raise ApiError(
            403,
            "feature_disabled",
            "Dịch vụ có định mức kho cần gói đang bật quản lý kho.",
            {"feature": "INVENTORY_WAREHOUSE"},
        )
    settings = control(tenant_id)
    advance(settings, local_date())
    warehouse_map, item_map, requirements = {}, {}, defaultdict(lambda: Decimal(0))
    for link in links:
        warehouse_map[link.warehouse_id] = scoped_master(tenant_id, "warehouses", link.warehouse_id)
        service_quantity = sum(
            (
                Decimal(line["quantity"])
                for line in invoice.draft_items
                if line["serviceId"] == link.service_id
            ),
            Decimal(0),
        )
        ingredients = db.session.scalars(
            select(ServiceStockIngredient).where(
                ServiceStockIngredient.tenant_id == tenant_id,
                ServiceStockIngredient.link_id == link.id,
            )
        )
        for ingredient in ingredients:
            item_map[ingredient.item_id] = scoped_master(tenant_id, "items", ingredient.item_id)
            requirements[(link.warehouse_id, ingredient.item_id)] += quantity_product(
                service_quantity, ingredient.quantity
            )
    balances = lock_balances(tenant_id, requirements)
    snapshots = [
        {"warehouseId": warehouse_id, "itemId": item_id, "quantity": decimal_text(quantity)}
        for (warehouse_id, item_id), quantity in sorted(requirements.items())
    ]
    row = make_document(
        tenant_id,
        "pos_issue",
        local_date(),
        warehouse_map[sorted(warehouse_map)[0]],
        note=f"Xuất theo POS {invoice.id}",
        lines=snapshots,
        invoice=invoice,
        currency=invoice.currency,
    )
    for (warehouse_id, item_id), quantity in sorted(requirements.items()):
        balance = balances[(warehouse_id, item_id)]
        if quantity > balance.quantity:
            raise ApiError(409, "insufficient_stock", "Không đủ tồn kho để ghi sổ hóa đơn POS.")
        value = allocate_cost(balance.quantity, balance.cost_value, quantity)
        add_movement(
            row,
            balance,
            warehouse_map[warehouse_id],
            item_map[item_id],
            -quantity,
            value.copy_negate(),
        )
    db.session.flush()
    audit("inventory.pos_issue", "inventory_document", row.id, {"invoiceId": invoice.id})
    return row


def pos_consumptions(invoice):
    return list(
        db.session.scalars(
            select(StockMovement)
            .join(
                InventoryDocument,
                (InventoryDocument.tenant_id == StockMovement.tenant_id)
                & (InventoryDocument.id == StockMovement.document_id),
            )
            .where(
                StockMovement.tenant_id == invoice.tenant_id,
                InventoryDocument.pos_invoice_id == invoice.id,
                InventoryDocument.kind == "pos_issue",
                StockMovement.quantity < 0,
            )
            .order_by(StockMovement.id)
        )
    )


def remaining_consumption(movement):
    returned_quantity, returned_value = db.session.execute(
        select(
            func.coalesce(func.sum(StockMovement.quantity), 0),
            func.coalesce(func.sum(StockMovement.cost_value), 0),
        ).where(
            StockMovement.tenant_id == movement.tenant_id,
            StockMovement.origin_movement_id == movement.id,
            StockMovement.quantity > 0,
        )
    ).one()
    with localcontext() as context:
        context.prec = 60
        return movement.quantity.copy_negate() - Decimal(returned_quantity), (
            movement.cost_value.copy_negate() - Decimal(returned_value)
        )


def return_pos_stock(invoice, requested, reason):
    settings = control(invoice.tenant_id)
    advance(settings, local_date())
    warehouse_ids = {movement.warehouse_id for movement, quantity in requested}
    warehouses = {
        key: scoped_master(invoice.tenant_id, "warehouses", key, inactive=True)
        for key in sorted(warehouse_ids)
    }
    balances = lock_balances(
        invoice.tenant_id,
        [(movement.warehouse_id, movement.item_id) for movement, quantity in requested],
    )
    row = make_document(
        invoice.tenant_id,
        "pos_return",
        local_date(),
        warehouses[sorted(warehouses)[0]],
        note=reason,
        invoice=invoice,
        currency=invoice.currency,
        lines=[
            {"movementId": movement.id, "quantity": decimal_text(quantity)}
            for movement, quantity in requested
        ],
    )
    for movement, quantity in requested:
        remaining, value = remaining_consumption(movement)
        if quantity > remaining:
            raise ApiError(
                409, "over_return", "Số lượng nhập lại vượt phần POS chưa được trả hàng."
            )
        item = scoped_master(invoice.tenant_id, "items", movement.item_id, inactive=True)
        returned_value = allocate_cost(remaining, value, quantity)
        add_movement(
            row,
            balances[(movement.warehouse_id, movement.item_id)],
            warehouses[movement.warehouse_id],
            item,
            quantity,
            returned_value,
            origin=movement,
        )
        db.session.flush()
    audit(
        "inventory.pos_return",
        "inventory_document",
        row.id,
        {"invoiceId": invoice.id, "reason": reason},
    )
    return row


def cancel_pos_stock(invoice, reason):
    requested = []
    for movement in pos_consumptions(invoice):
        remaining, value = remaining_consumption(movement)
        if remaining:
            requested.append((movement, remaining))
    return return_pos_stock(invoice, requested, reason) if requested else None


def handle_return_pos(tenant_id, invoice_id):
    data = runtime().payload()
    invoice = invoice_row(tenant_id, invoice_id, locked=True)
    key, fingerprint, replay = begin(tenant_id, data)
    if replay is not None:
        return replay, 201
    if invoice.status != "POSTED":
        raise ApiError(409, "invoice_closed", "Chỉ nhập lại hàng từ hóa đơn POS đang ghi sổ.")
    lines = data.get("lines")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 200:
        raise ApiError(422, "invalid_lines", "Phiếu trả hàng cần từ 1 đến 200 dòng.")
    consumptions = {line.id: line for line in pos_consumptions(invoice)}
    requested, seen = [], set()
    for line in lines:
        if not isinstance(line, dict):
            raise ApiError(422, "invalid_lines", "Dòng trả hàng không hợp lệ.")
        movement_id = string_value(line.get("movementId"), "Mã dòng xuất", 40, required=True)
        if movement_id not in consumptions or movement_id in seen:
            raise ApiError(422, "invalid_movement", "Dòng xuất không thuộc POS này hoặc bị lặp.")
        seen.add(movement_id)
        requested.append((consumptions[movement_id], stock_quantity(line.get("quantity"))))
    reason = string_value(data.get("reason"), "Lý do trả hàng", 500, required=True)
    row = return_pos_stock(invoice, requested, reason)
    db.session.flush()
    return finish(tenant_id, key, fingerprint, document_json(row))


def stock_report(tenant_id, warehouse_id=None, start=None, end=None):
    end = end or local_date()
    if start and end < start:
        raise ApiError(422, "invalid_dates", "Ngày kết thúc phải từ ngày bắt đầu.")
    conditions = [StockBalance.tenant_id == tenant_id]
    if warehouse_id:
        conditions.append(StockBalance.warehouse_id == warehouse_id)
    balances = list(
        db.session.scalars(
            select(StockBalance)
            .where(*conditions)
            .order_by(StockBalance.warehouse_id, StockBalance.item_id)
        )
    )
    masters = {
        row.id: row
        for row in db.session.scalars(
            select(Master).where(
                Master.tenant_id == tenant_id, Master.catalog.in_(["items", "warehouses"])
            )
        )
    }
    movements = defaultdict(list)
    query = (
        select(StockMovement, InventoryDocument.date)
        .join(
            InventoryDocument,
            (StockMovement.tenant_id == InventoryDocument.tenant_id)
            & (StockMovement.document_id == InventoryDocument.id),
        )
        .where(StockMovement.tenant_id == tenant_id)
    )
    if warehouse_id:
        query = query.where(StockMovement.warehouse_id == warehouse_id)
    for movement, day in db.session.execute(query):
        movements[(movement.warehouse_id, movement.item_id)].append((movement, day))
    rows, reconciled = [], True
    with localcontext() as context:
        context.prec = 60
        for balance in balances:
            entries = movements[(balance.warehouse_id, balance.item_id)]
            opening = sum(
                (movement.quantity for movement, day in entries if start and day < start),
                Decimal(0),
            )
            period = [
                movement for movement, day in entries if (not start or day >= start) and day <= end
            ]
            received = sum(
                (movement.quantity for movement in period if movement.quantity > 0), Decimal(0)
            )
            issued = -sum(
                (movement.quantity for movement in period if movement.quantity < 0), Decimal(0)
            )
            closing = opening + received - issued
            closing_value = sum(
                (movement.cost_value for movement, day in entries if day <= end), Decimal(0)
            )
            matches = (
                sum((movement.quantity for movement, day in entries), Decimal(0))
                == balance.quantity
                and sum((movement.cost_value for movement, day in entries), Decimal(0))
                == balance.cost_value
            )
            reconciled = reconciled and matches
            item, warehouse = masters[balance.item_id], masters[balance.warehouse_id]
            minimum = stock_quantity((item.data or {}).get("minStock", 0), allow_zero=True)
            rows.append(
                {
                    "warehouseId": warehouse.id,
                    "warehouse": warehouse.name,
                    "itemId": item.id,
                    "item": item.name,
                    "sku": (item.data or {}).get("sku", ""),
                    "unit": (item.data or {}).get("unit", ""),
                    "openingQuantity": decimal_text(opening),
                    "received": decimal_text(received),
                    "issued": decimal_text(issued),
                    "closingQuantity": decimal_text(closing),
                    "quantity": decimal_text(balance.quantity),
                    "version": balance.version,
                    "unitCost": decimal_text(average(closing, closing_value)),
                    "costValue": value_text(closing_value),
                    "currentCostValue": value_text(balance.cost_value),
                    "minStock": decimal_text(minimum),
                    "lowStock": closing < minimum,
                    "reconciled": matches,
                }
            )
        valuation = sum((Decimal(row["costValue"]) for row in rows), Decimal(0))
    settings = db.session.scalar(
        select(InventoryControl).where(InventoryControl.tenant_id == tenant_id)
    )
    return {
        "rows": rows,
        "openingLocked": bool(settings and settings.opening_locked),
        "summary": {
            "rowCount": len(rows),
            "lowStockCount": sum(row["lowStock"] for row in rows),
            "valuation": value_text(valuation),
            "currency": (runtime().state.tenant.settings or {}).get("currency", "VND"),
            "start": start.isoformat() if start else None,
            "end": end.isoformat(),
            "reconciled": reconciled,
        },
    }


def handle_get_stock(tenant_id):
    warehouse = string_value(runtime().request.args.get("warehouseId"), "Kho", 40) or None
    start_value, end_value = runtime().date_range()
    start = parse_date(start_value) if start_value else None
    end = parse_date(end_value) if end_value else None
    return stock_report(tenant_id, warehouse, start, end)


def inventory_snapshot(tenant_id):
    settings = masters_snapshot(tenant_id)
    return {
        "inventoryDocuments": [
            document_json(row)
            for row in db.session.scalars(
                select(InventoryDocument)
                .where(InventoryDocument.tenant_id == tenant_id)
                .order_by(InventoryDocument.created_at.desc(), InventoryDocument.id)
                .limit(100)
            )
        ],
        "stockBalances": stock_report(tenant_id)["rows"],
        "openingLocked": settings["openingLocked"],
        "serviceStockLinks": settings["serviceStockLinks"],
    }
