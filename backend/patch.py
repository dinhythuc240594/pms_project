with open('pms_api/catalog/routes.py', 'rb') as f:
    content = f.read().decode('utf-8')

old_str1 = '    if room is None:\r\n        room = PhysicalRoom(id=uid(), tenant_id=tenant_id, number=number)'
new_str1 = '''    if room is None:\r\n        if getattr(g, "max_rooms", None) is not None:\r\n            from sqlalchemy import func\r\n            from flask import g\r\n            db.session.execute(select(Tenant.id).where(Tenant.id == tenant_id).with_for_update())\r\n            count = db.session.scalar(select(func.count()).select_from(PhysicalRoom).where(PhysicalRoom.tenant_id == tenant_id))\r\n            if count >= g.max_rooms:\r\n                raise ApiError(409, "QUOTA_EXCEEDED", "Gói hiện tại không cho phép thêm phòng.")\r\n        room = PhysicalRoom(id=uid(), tenant_id=tenant_id, number=number)'''

old_str2 = '            if room is None:\r\n                db.session.add('
new_str2 = '''            if room is None:\r\n                if getattr(g, "max_rooms", None) is not None:\r\n                    from sqlalchemy import func\r\n                    from flask import g\r\n                    db.session.execute(select(Tenant.id).where(Tenant.id == tenant_id).with_for_update())\r\n                    count = db.session.scalar(select(func.count()).select_from(PhysicalRoom).where(PhysicalRoom.tenant_id == tenant_id))\r\n                    if count >= g.max_rooms:\r\n                        raise ApiError(409, "QUOTA_EXCEEDED", "Gói hiện tại không cho phép thêm phòng.")\r\n                db.session.add('''

content = content.replace(old_str1, new_str1)
content = content.replace(old_str2, new_str2)

with open('pms_api/catalog/routes.py', 'wb') as f:
    f.write(content.encode('utf-8'))
print('Done!')
